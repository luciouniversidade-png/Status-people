import { requireGestao, scopeUnit } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Badge, Flash, Field, Select, Textarea, Btn } from "@/components/ui";
import { fmtDataHora } from "@/lib/utils";
import { TAREFAS_ESTRATEGIA, fatosEstrategicos } from "@/lib/ia-estrategia";
import { gerarAssistente, decidirAssistente } from "../gestao-actions";
import { SubNav } from "../_ui";

export const dynamic = "force-dynamic";
type Draft = { id: number; tarefa: string; unidade: string | null; modelo: string | null; texto: string; alertas: string[] | null; status: string; criador: string | null; created_by: number | null; created_at: Date; aprovador: string | null; aprovado_em: Date | null; nfatos: number };

export default async function Assistente({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireGestao(); const sp = await searchParams; const u = scopeUnit(s);
  const pode = ["DIRECAO", "RH", "DIRETOR_UNIDADE"].includes(s.role); const ESTR = ["DIRECAO", "RH"].includes(s.role); const ligada = !!process.env.AI_API_KEY;
  const [fatos, drafts] = await Promise.all([pode ? fatosEstrategicos(u) : Promise.resolve([]),
    pode ? sql<Draft[]>`SELECT d.id, d.tarefa, un.nome AS unidade, d.modelo, d.texto, d.alertas, d.status, uc.nome AS criador, d.created_by, d.created_at, ua.nome AS aprovador, d.aprovado_em, coalesce(jsonb_array_length(d.fontes), 0)::int AS nfatos
      FROM strategy_ai_drafts d LEFT JOIN units un ON un.id=d.unit_id LEFT JOIN users uc ON uc.id=d.created_by LEFT JOIN users ua ON ua.id=d.aprovado_por
      WHERE ${u === null ? sql`true` : sql`d.unit_id=${u}`} ORDER BY d.id DESC LIMIT 20` : Promise.resolve([] as Draft[])]);
  return (
    <Page title="Assistente estratégico" sub="IA como apoio, nível N1: lê só os fatos agregados do painel (sem nomes de famílias ou colaboradores), cita a origem de cada afirmação e entrega um rascunho que a Direção revisa. Não decide e não altera nada.">
      <SubNav atual="assistente" />
      <Flash ok={sp.ok} erro={sp.erro} />
      {!pode ? <Card><p className="text-sm text-slate-600">O assistente estratégico é usado pela Direção/RH e pelos diretores de unidade.</p></Card> : <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <div className="space-y-4">
          {drafts.length === 0 && <Card><p className="text-sm text-slate-500">Nenhum rascunho ainda.</p></Card>}
          {drafts.map(d => <Card key={d.id} title={<span className="flex flex-wrap items-center gap-2">{TAREFAS_ESTRATEGIA[d.tarefa] ?? d.tarefa} <Badge v={d.status === "APROVADO" ? "APROVADA" : d.status === "DESCARTADO" ? "CANCELADA" : "PENDENTE"} label={d.status === "APROVADO" ? "Aprovado" : d.status === "DESCARTADO" ? "Descartado" : "Rascunho — revisar"} /></span>}
            actions={<span className="text-xs text-slate-500">{fmtDataHora(d.created_at)} · {d.criador ?? "—"} · {d.unidade ?? "rede"}</span>}>
            {(d.alertas ?? []).length > 0 && <ul className="mb-2 space-y-0.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-aviso">{(d.alertas ?? []).map((a, k) => <li key={k}>⚠ {a}</li>)}</ul>}
            {d.status === "RASCUNHO" && (ESTR || d.created_by === s.id) ? <form action={decidirAssistente} className="space-y-2"><input type="hidden" name="id" value={d.id} />
              <Textarea name="texto" defaultValue={d.texto} className="min-h-[220px] text-sm" aria-label="Texto revisado" />
              <div className="flex flex-wrap gap-2"><Btn small name="decisao" value="APROVAR">Aprovar versão revisada</Btn><Btn small kind="ghost" name="decisao" value="DESCARTAR">Descartar</Btn></div></form>
              : <pre className="whitespace-pre-wrap font-sans text-sm text-slate-800">{d.texto}</pre>}
            <p className="mt-2 text-[11px] text-slate-500">{d.nfatos} fato(s) enviados · modelo {d.modelo ?? "—"}{d.aprovador ? ` · aprovado por ${d.aprovador} em ${fmtDataHora(d.aprovado_em)}` : ""} · as referências [E…] apontam para a lista de fatos do momento da geração.</p>
          </Card>)}
        </div>
        <div className="space-y-4">
          <Card title="Gerar rascunho">
            {!ligada && <p className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-aviso">IA desligada nesta instalação: sem a variável AI_API_KEY nada é gerado nem simulado. O restante do sistema funciona normalmente.</p>}
            <form action={gerarAssistente} className="space-y-2"><Field label="O que preparar"><Select name="tarefa">{Object.entries(TAREFAS_ESTRATEGIA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field><Btn small pendingText="Gerando…">Gerar rascunho</Btn></form>
          </Card>
          <Card title={`Fatos que serão enviados (${fatos.length})`}>
            <details><summary className="cursor-pointer text-xs text-acao">ver exatamente o que a IA recebe</summary>
              <ol className="mt-2 space-y-1 text-xs text-slate-700">{fatos.map(f => <li key={f.id}><b className="text-slate-500">[E{f.id}]</b> {f.texto}</li>)}</ol></details>
            <p className="mt-2 text-[11px] text-slate-500">Só números e títulos institucionais do painel. Afirmações sem fato citado e citações inexistentes são sinalizadas no rascunho.</p>
          </Card>
        </div>
      </div>}
    </Page>
  );
}
