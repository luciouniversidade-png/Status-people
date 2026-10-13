import { requireGestao } from "@/lib/auth";
import { Page, Card, Flash, Field, Textarea, Btn, Badge } from "@/components/ui";
import { fmtData } from "@/lib/utils";
import { identidadeAtual, type Identidade } from "@/lib/gestao-estrategica";
import { salvarIdentidade, publicarIdentidade, novaVersaoIdentidade } from "../gestao-actions";
import { SubNav } from "../_ui";

export const dynamic = "force-dynamic";

function Bloco({ titulo, texto }: { titulo: string; texto: string | null }) {
  return <div><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{titulo}</div><p className={`mt-0.5 whitespace-pre-line text-sm ${texto ? "text-ink" : "text-slate-400"}`}>{texto || "não definido"}</p></div>;
}
function Visao({ i }: { i: Identidade }) {
  const valores = i.valores ?? [];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2"><Bloco titulo="Missão — por que existimos" texto={i.missao} /><Bloco titulo="Visão — onde queremos chegar" texto={i.visao} /></div>
      {i.proposito && <Bloco titulo="Propósito" texto={i.proposito} />}
      <div><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Valores e a prática observável de cada um</div>
        {valores.length === 0 ? <p className="text-sm text-slate-400">nenhum valor</p> : <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">{valores.map(v => <li key={v.nome} className="rounded-md border border-line p-2.5"><div className="text-sm font-semibold text-navy">{v.nome}</div><div className={`text-xs ${v.pratica ? "text-slate-700" : "text-aviso"}`}>{v.pratica || "prática observável ainda não descrita"}</div></li>)}</ul>}
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3"><Bloco titulo="Proposta de valor às famílias" texto={i.proposta_valor} /><Bloco titulo="Posicionamento" texto={i.posicionamento} /><Bloco titulo="Horizonte do plano" texto={i.horizonte} /></div>
    </div>
  );
}

export default async function IdentidadePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireGestao(); const sp = await searchParams; const id = await identidadeAtual();
  const pode = ["DIRECAO", "RH"].includes(s.role); const r = id.rascunho;
  return (
    <Page title="Identidade institucional" sub="Missão, visão, valores com prática observável, proposta de valor e posicionamento — a base do mapa estratégico, dos rituais e da avaliação de desempenho. Versionada: a vigente vale até a próxima ser publicada.">
      <SubNav atual="identidade" />
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <div className="space-y-4">
          <Card title={id.vigente ? <span className="flex flex-wrap items-center gap-2">Vigente <Badge v="APROVADA" label={`versão ${id.vigente.versao}`} /></span> : "Vigente"} actions={id.vigente ? <span className="text-xs text-slate-500">publicada em {fmtData(id.vigente.aprovado_em)}{id.vigente.aprovador ? ` por ${id.vigente.aprovador}` : ""}</span> : undefined}>
            {id.vigente ? <Visao i={id.vigente} /> : <p className="text-sm text-aviso">Nenhuma versão publicada ainda. {r ? "Revise o rascunho ao lado e publique quando estiver aprovado." : ""}</p>}
          </Card>
          {r && !pode && <Card title={`Rascunho em discussão (versão ${r.versao})`}><Visao i={r} /></Card>}
          {id.historico.length > 0 && <Card title="Versões anteriores">{id.historico.map(h => <details key={h.id} className="border-b border-line py-2 last:border-0"><summary className="cursor-pointer text-sm text-acao">Versão {h.versao} · vigente de {fmtData(h.vigencia_inicio)}{h.aprovador ? ` · aprovada por ${h.aprovador}` : ""}</summary><div className="mt-2"><Visao i={h} /></div></details>)}</Card>}
        </div>
        {pode && <div className="space-y-4">
          {r ? <Card title={`Rascunho — versão ${r.versao}`}>
            <form action={salvarIdentidade} className="space-y-2">
              <Field label="Missão"><Textarea name="missao" defaultValue={r.missao ?? ""} className="min-h-[60px]" placeholder="Por que a escola existe, para quem e com que compromisso" /></Field>
              <Field label="Visão"><Textarea name="visao" defaultValue={r.visao ?? ""} className="min-h-[60px]" placeholder="Onde queremos chegar, com horizonte" /></Field>
              <Field label="Propósito (opcional)"><Textarea name="proposito" defaultValue={r.proposito ?? ""} className="min-h-[50px]" /></Field>
              <Field label="Valores" hint="Um por linha: Valor | prática observável (o que se vê alguém fazendo quando vive o valor)."><Textarea name="valores" defaultValue={(r.valores ?? []).map(v => `${v.nome} | ${v.pratica}`).join("\n")} className="min-h-[160px] font-mono text-xs" /></Field>
              <Field label="Proposta de valor às famílias"><Textarea name="propostaValor" defaultValue={r.proposta_valor ?? ""} className="min-h-[50px]" /></Field>
              <Field label="Posicionamento"><Textarea name="posicionamento" defaultValue={r.posicionamento ?? ""} className="min-h-[50px]" /></Field>
              <Field label="Horizonte do plano"><Textarea name="horizonte" defaultValue={r.horizonte ?? ""} className="min-h-[40px]" placeholder="Ex.: 2027–2029" /></Field>
              <Btn small>Salvar rascunho</Btn>
            </form>
            <form action={publicarIdentidade} className="mt-3 border-t border-line pt-3"><Btn small kind="ghost" pendingText="Publicando…">Publicar como vigente</Btn><p className="mt-1 text-xs text-slate-500">Exige missão, visão e a prática observável de cada valor. A versão vigente atual é arquivada (fica no histórico).</p></form>
          </Card> : <Card title="Nova versão"><form action={novaVersaoIdentidade}><Btn small>Criar rascunho a partir da vigente</Btn></form><p className="mt-2 text-xs text-slate-500">A versão vigente continua valendo até o rascunho ser publicado.</p></Card>}
        </div>}
      </div>
    </Page>
  );
}
