import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Badge, Flash, Btn, Field, Textarea } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { fmtData, fmtDataHora, hoje } from "@/lib/utils";
import { SOL_STATUS, SOL_TOM, podeDecidir, vePainel, fmtValorBr, type Campo, type EtapaSnap } from "@/lib/solicitacoes";
import { decidirSolicitacao, reenviarSolicitacao, cancelarSolicitacao, comentarSolicitacao } from "../actions";
import { CamposForm, valorCampo } from "../_ui";
import { Anexos } from "@/components/Anexos";

export const dynamic = "force-dynamic";

export default async function Solicitacao({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const { id } = await params; const sp = await searchParams;
  const [r] = await sql<{ id: number; numero: string; titulo: string; tipo: string; campos: Campo[]; dados: Record<string, unknown>; valor: string | null; unit_id: number | null; unidade: string | null; solicitante_user_id: number; solicitante_nome: string | null; status: string; etapa_atual: number; etapas: EtapaSnap[]; prazo_etapa: string | null; created_at: string; concluida_em: string | null }[]>`SELECT r.id, r.numero, r.titulo, t.nome AS tipo, t.campos, r.dados, r.valor::text, r.unit_id, u.nome AS unidade, r.solicitante_user_id, r.solicitante_nome, r.status, r.etapa_atual, r.etapas, r.prazo_etapa::text, r.created_at::text, r.concluida_em::text FROM requests r JOIN request_types t ON t.id=r.type_id LEFT JOIN units u ON u.id=r.unit_id WHERE r.id=${Number(id)}`;
  if (!r) notFound();
  const envolvido = r.solicitante_user_id === s.id || r.etapas.some(e => e.aprovadores.includes(s.id)) || ["DIRECAO", "RH", "FINANCEIRO"].includes(s.role) || (s.role === "DIRETOR_UNIDADE" && r.unit_id === s.unitId);
  if (!envolvido) notFound();
  const ids = [...new Set(r.etapas.flatMap(e => e.aprovadores))]; const nomes = new Map((ids.length ? await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM users WHERE id = ANY(${ids})` : []).map(u => [u.id, u.nome]));
  const eventos = await sql<{ tipo: string; texto: string | null; user_nome: string | null; created_at: string }[]>`SELECT tipo, texto, user_nome, created_at::text FROM request_events WHERE request_id=${r.id} ORDER BY id`;
  const decide = podeDecidir(s, r) && r.solicitante_user_id !== s.id; const dono = r.solicitante_user_id === s.id; const aberta = ["EM_APROVACAO", "DEVOLVIDA"].includes(r.status);
  const atraso = r.status === "EM_APROVACAO" && r.prazo_etapa && r.prazo_etapa < hoje();
  return (
    <Page title={r.titulo} sub={`${r.numero} · ${r.tipo} · ${r.solicitante_nome}${r.unidade ? ` · ${r.unidade}` : ""} · aberta ${fmtDataHora(r.created_at)}`} actions={<Btn kind="ghost" href="/solicitacoes">Solicitações</Btn>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      {decide && <Card className="mb-4 border-2 border-acao" title={`Sua decisão — etapa “${r.etapas[r.etapa_atual].nome}”`}>
        <div className="flex flex-wrap gap-2">
          <form action={decidirSolicitacao} className="flex-1 sm:flex-none"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="decisao" value="APROVAR" /><Btn>Aprovar{r.valor !== null ? ` ${fmtValorBr(r.valor)}` : ""}</Btn></form>
          <Modal label="Devolver para ajuste" small={false} title="Devolver para ajuste"><form action={decidirSolicitacao} className="space-y-2"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="decisao" value="DEVOLVER" /><Field label="O que precisa ser ajustado"><Textarea name="obs" required /></Field><Btn small>Devolver</Btn></form></Modal>
          <Modal label="Rejeitar" kind="danger" small={false} title="Rejeitar"><form action={decidirSolicitacao} className="space-y-2"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="decisao" value="REJEITAR" /><Field label="Motivo"><Textarea name="obs" required /></Field><Btn small danger>Rejeitar</Btn></form></Modal>
        </div>{atraso && <p className="mt-2 text-xs text-aviso">Prazo desta etapa venceu em {fmtData(r.prazo_etapa)}.</p>}</Card>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="space-y-4">
          <Card title="Pedido" actions={<Badge v={SOL_TOM[r.status]} label={SOL_STATUS[r.status]} />}>
            <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">{r.campos.map(c => <div key={c.id} className={c.tipo === "TEXTO_LONGO" ? "sm:col-span-2" : ""}><dt className="text-xs text-slate-500">{c.rotulo}</dt><dd className="whitespace-pre-wrap">{valorCampo(c, r.dados[c.id])}</dd></div>)}</dl>
            {r.status === "APROVADA" && <p className="mt-3 rounded border border-emerald-200 bg-emerald-50 p-2 text-sm text-ok">Aprovada em {fmtDataHora(r.concluida_em)}. {r.valor !== null ? "Siga com o financeiro para o pagamento (fora do ONE)." : ""}</p>}
          </Card>
          {dono && r.status === "DEVOLVIDA" && <Card title="Ajustar e reenviar" className="border-amber-300"><form action={reenviarSolicitacao} className="space-y-2"><input type="hidden" name="id" value={r.id} /><CamposForm campos={r.campos} dados={r.dados} /><Field label="O que mudou"><Textarea name="obs" className="min-h-[50px]" /></Field><Btn small>Reenviar</Btn></form></Card>}
          <Anexos entidade="request" id={r.id} voltar={`/solicitacoes/${r.id}`} titulo="Comprovantes e anexos" podeEnviar={dono || decide || ["DIRECAO", "RH"].includes(s.role)} />
          <Card title="Histórico">
            <ul className="space-y-1.5 text-sm">{eventos.map((e, i) => <li key={i}><span className="text-xs text-slate-500">{fmtDataHora(e.created_at)} · {e.user_nome}</span> — <b>{e.tipo === "CRIADA" ? "Aberta" : e.tipo === "APROVADA" ? "Aprovou" : e.tipo === "REJEITADA" ? "Rejeitou" : e.tipo === "DEVOLVIDA" ? "Devolveu" : e.tipo === "REENVIADA" ? "Reenviou" : e.tipo === "CANCELADA" ? "Cancelou" : "Comentário"}</b>{e.texto ? `: ${e.texto}` : ""}</li>)}</ul>
            <form action={comentarSolicitacao} className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3"><input type="hidden" name="id" value={r.id} /><Field label="Comentário" className="min-w-0 flex-1"><Textarea name="texto" className="min-h-[40px]" /></Field><Btn small kind="ghost">Comentar</Btn></form>
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Etapas de aprovação"><ol className="space-y-2">{r.etapas.map((e, i) => <li key={i} className={`rounded-md border p-2 text-sm ${i === r.etapa_atual && r.status === "EM_APROVACAO" ? "border-acao bg-sky-50" : "border-line"}`}>
            <div className="flex items-center justify-between gap-2"><b>{i + 1}. {e.nome}</b>{e.decisao ? <Badge v={e.decisao === "APROVADA" ? "APROVADA" : e.decisao === "REJEITADA" ? "REJEITADA" : "PENDENTE"} label={e.decisao === "APROVADA" ? "aprovada" : e.decisao === "REJEITADA" ? "rejeitada" : "devolvida"} /> : i === r.etapa_atual && r.status === "EM_APROVACAO" ? <Badge v="PENDENTE" label="aguardando" /> : null}</div>
            <div className="text-[11px] text-slate-500">{e.decisao ? `${e.porNome} · ${fmtDataHora(e.em)}${e.obs ? ` · ${e.obs}` : ""}` : `aprovadores: ${e.aprovadores.map(a => nomes.get(a) ?? `#${a}`).join(", ")}`}</div></li>)}</ol></Card>
          {dono && aberta && <Card title="Cancelar"><form action={cancelarSolicitacao} className="space-y-2"><input type="hidden" name="id" value={r.id} /><Field label="Motivo (opcional)"><Textarea name="obs" className="min-h-[40px]" /></Field><Btn small danger>Cancelar solicitação</Btn></form></Card>}
          {vePainel(s) && !dono && !decide && <p className="text-xs text-slate-500">Você vê esta solicitação pelo painel de gestão.</p>}
        </div>
      </div>
    </Page>
  );
}
