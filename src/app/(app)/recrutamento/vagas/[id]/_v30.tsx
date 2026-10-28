// v30 · vaga: avaliadores com notas independentes, página pública de vagas e saúde da vaga
import Link from "@/components/Link";
import { sql } from "@/db";
import { Card, Badge, Btn, Field, Select, Textarea, Input } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { fmtData, hoje, addDays } from "@/lib/utils";
import { ETAPA_LABEL } from "@/lib/talento";
import { consolidar, feedbacksDaVaga, RECOMENDACAO, RECOMENDACAO_TOM, type SaudeVaga } from "@/lib/recrutamento-v30";
import { convidarAvaliadores, cancelarConvite, salvarPublicacao } from "../../v30-actions";

type App = { id: number; nome: string; etapa: string };
const n1 = (v: number | null) => (v === null ? "—" : v.toFixed(1).replace(".", ","));

export async function AvaliadoresVaga({ userId, rid, apps, criterios, podeAgir, prazoDias, unitId }: { userId: number; rid: number; apps: App[]; criterios: string[]; podeAgir: boolean; prazoDias: number; unitId: number }) {
  const [fs, users] = await Promise.all([
    feedbacksDaVaga(rid),
    podeAgir ? sql<{ id: number; nome: string; papel: string }[]>`SELECT u.id, u.nome, CASE WHEN u.role IN ('RH','DIRECAO') THEN 'rede' ELSE coalesce(un.nome, 'rede') END AS papel FROM users u LEFT JOIN units un ON un.id=u.unit_id WHERE u.ativo AND (u.unit_id IS NULL OR u.unit_id=${unitId}) ORDER BY u.nome LIMIT 400` : Promise.resolve([]),
  ]);
  const ativos = apps.filter(a => !["REPROVADO", "DESISTIU", "CONTRATADO"].includes(a.etapa));
  const comConvite = [...new Set(fs.map(f => f.application_id))];
  const linhas = apps.filter(a => comConvite.includes(a.id) || ativos.some(x => x.id === a.id));
  return <Card title="Avaliadores das entrevistas (notas independentes)" actions={podeAgir && ativos.length ? <Modal label="Convidar avaliadores" title="Convidar avaliadores para uma candidatura">
    <form action={convidarAvaliadores} className="space-y-2">
      <p className="text-xs text-slate-600">Cada avaliador recebe o convite em Minhas pendências e dá as notas sem ver as dos outros. Quando todos enviam, o cartão mostra “precisa de decisão”.</p>
      <Field label="Candidatura"><Select name="applicationId" required defaultValue="">{[<option key="" value="">Escolha</option>, ...ativos.map(a => <option key={a.id} value={a.id}>{a.nome} · {ETAPA_LABEL[a.etapa] ?? a.etapa}</option>)]}</Select></Field>
      <div className="grid grid-cols-2 gap-2"><Field label="Etapa (vazio = a atual)"><Select name="etapa" defaultValue="">{[<option key="" value="">a etapa atual</option>, ...["ENTREVISTA_RH", "TESTE", "ENTREVISTA_GESTOR"].map(e => <option key={e} value={e}>{ETAPA_LABEL[e]}</option>)]}</Select></Field><Field label="Enviar até"><Input name="prazo" type="date" defaultValue={addDays(hoje(), prazoDias)} /></Field></div>
      <Field label="Avaliadores (segure Ctrl para escolher vários)"><select name="avaliadores" multiple required className="h-40 w-full rounded-md border border-line p-1 text-sm">{users.map(u => <option key={u.id} value={u.id}>{u.nome} · {u.papel}</option>)}</select></Field>
      <Btn small>Convidar</Btn></form></Modal> : undefined}>
    <div id="avaliadores" />
    {linhas.length === 0 ? <p className="text-sm text-slate-500">Nenhuma candidatura em processo.</p> :
      <ul className="space-y-2">{linhas.map(a => { const da = fs.filter(f => f.application_id === a.id); const etapas = [...new Set(da.map(f => f.etapa))];
        return <li key={a.id} className="rounded-md border border-line p-2 text-sm"><div className="font-medium text-ink">{a.nome} <span className="text-xs font-normal text-slate-500">· {ETAPA_LABEL[a.etapa] ?? a.etapa}</span></div>
          {etapas.length === 0 ? <div className="text-xs text-slate-500">Sem avaliadores convidados.</div> : etapas.map(et => { const xs = da.filter(f => f.etapa === et); const c = consolidar(xs, criterios);
            const meuPendente = xs.some(f => f.avaliador_user_id === userId && !f.cancelado_em && !f.enviado_em); // independência: o consolidado só depois das suas notas
            return <div key={et} className="mt-1 border-t border-line pt-1">
              <div className="flex flex-wrap items-center gap-2 text-xs"><b>{ETAPA_LABEL[et] ?? et}</b><span className="text-slate-500">{c.enviados}/{c.convidados} enviaram</span>{c.completo && a.etapa === et && <Badge v="PENDENTE" label="precisa de decisão" />}{meuPendente ? <span className="text-slate-500">você também avalia — o consolidado aparece depois que você enviar as suas notas</span> : <>{c.media !== null && <span>média <b>{n1(c.media)}</b></span>}{c.recomendacoes.map(r => <Badge key={r.k} v={RECOMENDACAO_TOM[r.k]} label={`${RECOMENDACAO[r.k]} ${r.n}`} />)}{c.divergentes.length > 0 && <span className="text-aviso">divergem em: {c.divergentes.join(", ")}</span>}</>}</div>
              <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-600">{xs.filter(f => !f.cancelado_em).map(f => <li key={f.id}>{f.enviado_em ? "✓" : f.prazo && f.prazo < hoje() ? "⚠" : "…"} <Link className="text-acao" href={`/recrutamento/avaliar/${f.id}`}>{f.avaliador}</Link>{!f.enviado_em && f.prazo ? <span className={f.prazo < hoje() ? "text-erro" : ""}> · até {fmtData(f.prazo)}</span> : null}{podeAgir && !f.enviado_em && <form action={cancelarConvite} className="ml-1 inline"><input type="hidden" name="id" value={f.id} /><button className="text-slate-400 underline hover:text-erro">cancelar</button></form>}</li>)}</ul>
            </div>; })}
        </li>; })}</ul>}
  </Card>;
}

export function PublicacaoVaga({ r, ativa, podeAgir }: { r: { id: number; publicar: boolean; descricaoPublica: string | null; slug: string | null; visualizacoes: number; status: string; requisitos: string | null }; ativa: boolean; podeAgir: boolean }) {
  return <Card title="Página de vagas (Trabalhe conosco)">
    <div id="publicacao" />
    <p className="text-xs text-slate-600">{ativa ? "A página pública está ligada." : "A página pública está desligada (Configurações → Recrutamento). Ligue só depois do GO da homologação."} {r.publicar ? <>Esta vaga está publicada{r.status !== "ABERTA" ? " — mas só aparece enquanto estiver aberta" : ""}.</> : "Esta vaga não está publicada."} {r.visualizacoes ? `${r.visualizacoes} visualização(ões).` : ""}</p>
    {r.publicar && r.slug && ativa && r.status === "ABERTA" && <p className="mt-1 text-xs"><Link className="text-acao" href={`/vagas/${r.slug}`}>ver como o candidato vê</Link></p>}
    {podeAgir && <form action={salvarPublicacao} className="mt-2 space-y-2"><input type="hidden" name="id" value={r.id} />
      <Field label="Descrição pública" hint="O que a pessoa vai fazer, requisitos, jornada e unidade — sem salário de outras pessoas nem dado interno."><Textarea name="descricaoPublica" defaultValue={r.descricaoPublica ?? r.requisitos ?? ""} className="min-h-[90px]" /></Field>
      <Field label="Na página de vagas"><Select name="publicar" defaultValue={r.publicar ? "1" : "0"}><option value="0">Não publicar</option><option value="1">Publicar enquanto estiver aberta</option></Select></Field>
      <Btn small kind="ghost">Salvar</Btn></form>}
  </Card>;
}

export function SaudeDaVaga({ saude }: { saude: SaudeVaga | undefined }) {
  if (!saude) return null; const tom = saude.score >= 80 ? "text-ok" : saude.score >= 60 ? "text-aviso" : "text-erro";
  return <Card className="mb-4" title="Saúde desta vaga">
    <div className="flex flex-wrap items-center gap-4"><div className={`text-3xl font-semibold tabular-nums ${tom}`}>{saude.score}<span className="text-sm text-slate-500">/100</span></div>
      <ul className="min-w-0 flex-1 space-y-0.5 text-xs text-slate-700">{saude.motivos.length ? saude.motivos.map(m => <li key={m}>• {m}</li>) : <li className="text-ok">Tudo em ordem: candidaturas suficientes, fluxo andando, no prazo e notas em dia.</li>}</ul></div>
  </Card>;
}
