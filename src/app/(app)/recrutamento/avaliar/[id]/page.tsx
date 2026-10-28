import { notFound } from "next/navigation";
import Link from "@/components/Link";
import { sql } from "@/db";
import { requireSession, scopeUnit } from "@/lib/auth";
import { Page, Card, Flash, Badge, Btn, Field, Select, Textarea, Table, Td } from "@/components/ui";
import { getSettings, fmtData, fmtDataHora } from "@/lib/utils";
import { ETAPA_LABEL } from "@/lib/talento";
import { consolidar, RECOMENDACAO, RECOMENDACAO_TOM, type Feedback } from "@/lib/recrutamento-v30";
import { enviarAvaliacao } from "../../v30-actions";

export const dynamic = "force-dynamic";
const GESTAO = ["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR"];
const n1 = (v: number | null) => (v === null ? "—" : v.toFixed(1).replace(".", ","));

/** v30 · Avaliação independente de um candidato: o avaliador dá as notas sem ver as dos outros; depois de enviar, vê o consolidado. */
export default async function Avaliar({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const { id } = await params; const sp = await searchParams; const cfg = await getSettings();
  const [f] = await sql<{ id: number; application_id: number; etapa: string; avaliador_user_id: number; prazo: string | null; enviado_em: string | null; cancelado_em: string | null; candidato: string; cidade: string | null; formacao: string | null; curriculo_texto: string | null; curriculo_link: string | null; vaga: string; requisitos: string | null; unidade: string; unit_id: number; requisition_id: number; etapa_atual: string }[]>`
    SELECT f.id, f.application_id, f.etapa, f.avaliador_user_id, f.prazo::text, f.enviado_em::text, f.cancelado_em::text, c.nome AS candidato, c.cidade, c.formacao, c.curriculo_texto, c.curriculo_link, r.titulo AS vaga, r.requisitos, u.nome AS unidade, r.unit_id, r.id AS requisition_id, a.etapa AS etapa_atual
    FROM interview_feedback f JOIN applications a ON a.id=f.application_id JOIN candidates c ON c.id=a.candidate_id JOIN requisitions r ON r.id=a.requisition_id JOIN units u ON u.id=r.unit_id WHERE f.id=${Number(id)}`;
  if (!f) notFound();
  const meu = f.avaliador_user_id === s.id; const gestao = GESTAO.includes(s.role) && (scopeUnit(s) === null || scopeUnit(s) === f.unit_id);
  if (!meu && !gestao) notFound();
  const todos = await sql<Feedback[]>`SELECT f.id, f.application_id, f.etapa, f.avaliador_user_id, u.nome AS avaliador, f.prazo::text, f.notas, f.recomendacao, f.pontos_fortes, f.pontos_atencao, f.enviado_em::text, f.cancelado_em::text FROM interview_feedback f JOIN users u ON u.id=f.avaliador_user_id WHERE f.application_id=${f.application_id} AND f.etapa=${f.etapa} ORDER BY f.id`;
  // independência: quem tem convite PENDENTE nesta candidatura e etapa não vê as notas dos outros — nem abrindo o convite de outra pessoa
  const meuConvite = todos.find(t => t.avaliador_user_id === s.id && !t.cancelado_em && t.etapa === f.etapa && t.application_id === f.application_id);
  const ver = meuConvite ? !!meuConvite.enviado_em : true;
  const cons = consolidar(todos, cfg.recrutamento.criterios);
  const encerrada = ["REPROVADO", "DESISTIU", "CONTRATADO"].includes(f.etapa_atual);
  return (
    <Page title={`Avaliação · ${f.candidato}`} sub={<>{f.vaga.includes(f.unidade) ? f.vaga : `${f.vaga} · ${f.unidade}`} · etapa {ETAPA_LABEL[f.etapa] ?? f.etapa}{f.prazo ? ` · enviar até ${fmtData(f.prazo)}` : ""}{gestao ? <> · <Link className="text-acao" href={`/recrutamento/vagas/${f.requisition_id}#avaliadores`}>vaga</Link></> : null}</>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <div className="space-y-4">
          {meu && !f.enviado_em && !f.cancelado_em && !encerrada && <Card title="As suas notas (independentes)">
            <p className="mb-3 rounded-md bg-mist p-2 text-xs text-slate-600">Avalie pelo que você observou na conversa. As notas dos outros avaliadores ficam ocultas até você enviar as suas — assim ninguém é influenciado. Critério que você não observou: deixe em branco (não vira zero).</p>
            <form action={enviarAvaliacao} className="space-y-3"><input type="hidden" name="id" value={f.id} />
              <div className="space-y-2">{cfg.recrutamento.criterios.map((c, i) => <div key={c} className="grid grid-cols-[minmax(0,1fr)_11rem] items-center gap-2 text-sm"><span>{c}</span><Select name={`sc_${i}`} defaultValue="" aria-label={c}><option value="">não observei</option>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n} · {["insuficiente", "abaixo", "adequado", "bom", "excelente"][n - 1]}</option>)}</Select></div>)}</div>
              <Field label="Sua recomendação"><Select name="recomendacao" required defaultValue="">{[<option key="" value="">Escolha</option>, ...Object.entries(RECOMENDACAO).map(([k, v]) => <option key={k} value={k}>{v}</option>)]}</Select></Field>
              <Field label="Pontos fortes (o que você observou)"><Textarea name="pontosFortes" className="min-h-[60px]" /></Field>
              <Field label="Pontos de atenção"><Textarea name="pontosAtencao" className="min-h-[60px]" /></Field>
              <p className="text-[11px] text-slate-500">Avalie competências e evidências. Não registre idade, estado civil, filhos, religião, saúde ou outra característica pessoal.</p>
              <Btn>Enviar as minhas notas</Btn></form>
          </Card>}
          {meu && f.cancelado_em && <Card><p className="text-sm text-slate-600">Este convite foi cancelado pelo RH.</p></Card>}
          {meu && !f.enviado_em && encerrada && <Card><p className="text-sm text-slate-600">A candidatura já foi encerrada — não é mais preciso enviar notas.</p></Card>}
          {ver ? <Card title={`Consolidado dos avaliadores — ${cons.enviados} de ${cons.convidados} enviaram`}>
            <Table head={["Critério", "Média", "Notas"]}>{cons.porCriterio.map(p => <tr key={p.criterio}><Td>{p.criterio}{p.divergente && <div><Badge v="PENDENTE" label="avaliadores divergem (≥ 2 pontos)" /></div>}</Td><Td className="tabular-nums font-medium">{n1(p.media)}</Td><Td className="text-xs text-slate-500">{p.n} nota(s)</Td></tr>)}</Table>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">{cons.recomendacoes.map(r => <Badge key={r.k} v={RECOMENDACAO_TOM[r.k]} label={`${RECOMENDACAO[r.k]}: ${r.n}`} />)}{!cons.recomendacoes.length && <span className="text-slate-500">Nenhuma recomendação enviada ainda.</span>}</div>
            <ul className="mt-3 space-y-2 text-sm">{todos.filter(x => x.enviado_em && !x.cancelado_em).map(x => <li key={x.id} className="rounded border border-line p-2"><div className="flex flex-wrap items-center gap-2"><b>{x.avaliador}</b><Badge v={RECOMENDACAO_TOM[x.recomendacao ?? ""] ?? "PENDENTE"} label={RECOMENDACAO[x.recomendacao ?? ""] ?? "—"} /><span className="text-[11px] text-slate-500">{fmtDataHora(x.enviado_em)}</span></div>{x.pontos_fortes && <div className="text-xs text-slate-700"><b>Fortes:</b> {x.pontos_fortes}</div>}{x.pontos_atencao && <div className="text-xs text-slate-700"><b>Atenção:</b> {x.pontos_atencao}</div>}</li>)}</ul>
            {todos.some(x => !x.enviado_em && !x.cancelado_em) && <p className="mt-2 text-[11px] text-slate-500">Aguardando: {todos.filter(x => !x.enviado_em && !x.cancelado_em).map(x => x.avaliador).join(", ")}.</p>}
          </Card> : <Card><p className="text-sm text-slate-600">As notas dos outros avaliadores aparecem aqui depois que você enviar as suas.</p></Card>}
        </div>
        <Card title="Candidato">
          <dl className="space-y-1.5 text-sm"><div><dt className="text-[11px] text-slate-500">Cidade</dt><dd>{f.cidade ?? "—"}</dd></div><div><dt className="text-[11px] text-slate-500">Formação</dt><dd>{f.formacao ?? "—"}</dd></div>{f.curriculo_link && <div><dt className="text-[11px] text-slate-500">Currículo</dt><dd><a className="text-acao" href={f.curriculo_link} target="_blank" rel="noreferrer">abrir o link</a></dd></div>}</dl>
          {f.requisitos && <div className="mt-3"><div className="text-[11px] text-slate-500">Requisitos da vaga</div><p className="whitespace-pre-line text-xs text-slate-700">{f.requisitos}</p></div>}
          {f.curriculo_texto && <details className="mt-3"><summary className="cursor-pointer text-xs text-acao">Currículo em texto</summary><p className="mt-1 max-h-80 overflow-y-auto whitespace-pre-line text-xs text-slate-700">{f.curriculo_texto}</p></details>}
        </Card>
      </div>
    </Page>
  );
}
