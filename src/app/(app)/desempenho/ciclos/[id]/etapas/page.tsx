import Link from "@/components/Link";
import { notFound, redirect } from "next/navigation";
import { sql } from "@/db";
import { requireStaff, scopeUnit } from "@/lib/auth";
import { Page, Card, Flash, Stat, Field, Input, Textarea, Btn } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { BarrasH, Funil, COR } from "@/components/graficos";
import { EtapasC13, type EstadoC13 } from "@/components/Etapas";
import { etapasDoCiclo, progressoEtapas, quebraEtapa, estadoEtapa, ETAPAS_CICLO, ESTADO_ETAPA, NOME_ETAPA } from "@/lib/ciclo-etapas";
import { fmtPct } from "@/lib/formato";
import { hoje, fmtData, fmtDataHora } from "@/lib/utils";
import { criarEtapas, moverJanela, fecharEtapa, lembrarPendentes } from "../../../etapas-actions";

export const dynamic = "force-dynamic";
const dm = (iso: string) => iso.split("-").reverse().slice(0, 2).join("/");

/** T-058 · Painel do ciclo (funil de etapas, quebra por área/unidade, pendências nominais com lembrete) + T-059 · Timeline com janelas. */
export default async function EtapasCiclo({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaff(); if (!["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR"].includes(s.role)) redirect("/desempenho"); const { id } = await params; const sp = await searchParams; const cid = Number(id); const h = hoje();
  const [c] = await sql<{ id: number; nome: string; fase: string; status: string; inicio: string; fim: string }[]>`SELECT id, nome, fase, status, inicio::text, fim::text FROM perf_cycles WHERE id=${cid}`; if (!c) notFound();
  const conduz = ["RH", "DIRECAO"].includes(s.role); const lembra = conduz || s.role === "DIRETOR_UNIDADE";
  const [etapas, prog] = await Promise.all([etapasDoCiclo(cid), progressoEtapas(cid, scopeUnit(s))]);
  const sel = ETAPAS_CICLO.find(e => e.chave === sp.etapa)?.chave ?? etapas.find(e => ["ABERTA", "VENCIDA"].includes(estadoEtapa(e, h)))?.etapa ?? "GESTOR";
  const est = etapas.find(e => e.etapa === sel) ?? null; const itens = prog.por[sel] ?? []; const pend = itens.filter(x => !x.feito); const res = prog.resumo.find(r => r.chave === sel)!;
  const mudancas = est ? await sql<{ id: number; de_fim: string | null; para_fim: string | null; motivo: string; user_nome: string | null; created_at: Date }[]>`SELECT id, de_fim::text, para_fim::text, motivo, user_nome, created_at FROM perf_stage_changes WHERE stage_id=${est.id} ORDER BY created_at DESC` : [];
  const c13 = ETAPAS_CICLO.map(e => { const st = etapas.find(x => x.etapa === e.chave); const r = prog.resumo.find(x => x.chave === e.chave)!; const ee = st ? estadoEtapa(st, h) : null;
    const estado: EstadoC13 = !st ? "PENDING" : ee === "FECHADA" ? (r.pendentes > 0 ? "CLOSED" : "COMPLETED") : (r.total > 0 && r.pendentes === 0 && ee !== "PLANEJADA") ? "COMPLETED" : ee === "VENCIDA" ? "LATE" : ee === "ABERTA" ? "CURRENT" : "PENDING";
    return { nome: e.nome, estado, href: `/desempenho/ciclos/${cid}/etapas?etapa=${e.chave}`, sub: <>{st ? `${dm(st.inicio)}–${dm(st.fim)}` : "sem janela"} · {r.total ? `${r.feitos}/${r.total}` : "—"}{st?.mudancas ? ` · ${st.mudancas} mudança(s)` : ""}</> }; });
  const base = `/desempenho/ciclos/${cid}/etapas?etapa=${sel}`;
  const qUn = quebraEtapa(itens, "unidade"); const qAr = quebraEtapa(itens, "area");
  return (
    <Page title={`Etapas do ciclo · ${c.nome}`} sub={`Janelas, progresso e pendências nominais por etapa. Fase atual do ciclo: ${c.fase.toLowerCase()} · ${fmtData(c.inicio)} a ${fmtData(c.fim)}. Encerrar o ciclo (somente leitura dali em diante) é a fase Conclusão, na página do ciclo.`}
      actions={<Btn kind="ghost" href={`/desempenho/ciclos/${cid}`}>Página do ciclo</Btn>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      {etapas.length === 0 ? <Card title="Etapas ainda não configuradas"><p className="text-sm text-slate-600">As seis etapas (nominação, autoavaliação, pares, gestor, calibração e publicação) nascem com janelas-padrão calculadas pelas datas do ciclo; depois, cada mudança de janela exige motivo e avisa os participantes.</p>{conduz && <form action={criarEtapas} className="mt-2"><input type="hidden" name="cycleId" value={cid} /><Btn small>Criar etapas</Btn></form>}</Card> : <>
        <Card title="Linha do tempo do ciclo" className="mb-4"><EtapasC13 etapas={c13} rotulo="Etapas do ciclo de avaliação" /></Card>
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Avaliações no ciclo" value={prog.estados.total} hint={scopeUnit(s) ? "da sua unidade" : "rede"} />
          <Stat label="A iniciar" value={prog.estados.aIniciar} hint="sem auto, sem nominação" />
          <Stat label="Em andamento" value={prog.estados.andamento} />
          <Stat label="Finalizadas" value={<span className="text-ok">{prog.estados.finalizadas}</span>} hint="publicadas (inclui contestadas)" />
        </div>
        <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
          <Card title="Funil das etapas (concluídos)"><Funil etapas={prog.resumo.map(r => ({ rotulo: r.nome, valor: r.feitos, sub: r.total ? `${r.feitos}/${r.total}${r.pct !== null ? ` · ${fmtPct(r.pct, 0)}` : ""}` : "sem itens", href: `/desempenho/ciclos/${cid}/etapas?etapa=${r.chave}` }))} rotulo="Itens concluídos por etapa" /><p className="mt-1 text-[11px] text-slate-500">Números absolutos por etapa (ex.: pares respondidos ÷ convidados).</p></Card>
          <Card title={`${NOME_ETAPA[sel]} — ${res.feitos}/${res.total} (${res.pct === null ? "—" : fmtPct(res.pct, 0)})`} actions={est ? <span className="text-xs text-slate-600">{ESTADO_ETAPA[estadoEtapa(est, h)]} · {fmtData(est.inicio)} a {fmtData(est.fim)}</span> : null}>
            <nav className="mb-2 flex flex-wrap gap-1" aria-label="Etapas">{ETAPAS_CICLO.map(e => <Link key={e.chave} href={`/desempenho/ciclos/${cid}/etapas?etapa=${e.chave}`} className={`rounded-full border px-2.5 py-0.5 text-xs ${e.chave === sel ? "border-acao bg-acao text-white" : "border-line bg-white text-slate-700 hover:bg-mist"}`}>{e.nome}</Link>)}</nav>
            {qUn.length > 1 && <><h3 className="mt-2 text-xs font-semibold text-slate-600">Por unidade</h3><BarrasH itens={qUn.map(q => ({ rotulo: q.chave, valor: q.pct, texto: `${q.feitos}/${q.total}`, cor: q.pct >= 100 ? COR.ok : q.pct >= 60 ? COR.acao : COR.aviso }))} max={100} formato={x => fmtPct(x, 0)} rotulo="Conclusão da etapa por unidade" /></>}
            {qAr.length > 1 && <><h3 className="mt-2 text-xs font-semibold text-slate-600">Por área</h3><BarrasH itens={qAr.map(q => ({ rotulo: q.chave, valor: q.pct, texto: `${q.feitos}/${q.total}`, cor: q.pct >= 100 ? COR.ok : q.pct >= 60 ? COR.acao : COR.aviso }))} max={100} formato={x => fmtPct(x, 0)} rotulo="Conclusão da etapa por área" /></>}
            {est && conduz && est.status !== "FECHADA" && <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-2 print:hidden">
              <Modal label="Mover janela" title={`Mover janela · ${NOME_ETAPA[sel]}`}><form action={moverJanela} className="space-y-2"><input type="hidden" name="stageId" value={est.id} /><div className="grid grid-cols-2 gap-2"><Field label="Início"><Input name="inicio" type="date" defaultValue={est.inicio} /></Field><Field label="Fim"><Input name="fim" type="date" defaultValue={est.fim} required /></Field></div><Field label="Motivo (fica registrado e vai aos participantes)"><Textarea name="motivo" required minLength={10} /></Field><Btn small>Mover e avisar</Btn></form></Modal>
              <Modal label="Fechar etapa" kind="danger" title={`Fechar · ${NOME_ETAPA[sel]}`}><form action={fecharEtapa} className="space-y-2"><input type="hidden" name="stageId" value={est.id} /><p className="text-sm">{pend.length ? `${pend.length} pendência(s) ainda abertas.` : "Todas as pendências resolvidas."}</p>{pend.length > 0 && <Field label="Justificativa para fechar com pendências"><Textarea name="justificativa" required minLength={10} /></Field>}<Btn small danger>Fechar etapa</Btn></form></Modal>
            </div>}
            {est?.status === "FECHADA" && <p className="mt-2 text-xs text-slate-600">Fechada em {est.fechada_em ? fmtDataHora(est.fechada_em) : "—"} por {est.fechada_por ?? "—"}.</p>}
          </Card>
        </div>
        <Card title={`Pendências nominais — ${NOME_ETAPA[sel]} (${pend.length})`} className="mb-4">
          {pend.length === 0 ? <p className="text-sm text-slate-600">Nenhuma pendência nesta etapa.</p> : <form action={lembrarPendentes}>
            <input type="hidden" name="stageId" value={est?.id ?? 0} />
            <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-sm"><thead className="bg-mist text-xs text-slate-600"><tr>{lembra && <th className="w-8 px-2 py-1.5" />}<th className="px-2 py-1.5 text-left font-medium">Avaliado(a)</th><th className="px-2 py-1.5 text-left font-medium">Quem precisa agir</th><th className="px-2 py-1.5 text-left font-medium">Unidade · área</th><th className="px-2 py-1.5 text-left font-medium">Lembretes</th></tr></thead>
              <tbody className="divide-y divide-line">{pend.map((x, i) => <tr key={`${x.employee_id}-${x.responsavel_user_id}-${i}`}>{lembra && <td className="px-2 py-1.5"><input type="checkbox" name="employeeId" value={x.employee_id} disabled={x.lembretes >= 2} aria-label={`Selecionar ${x.nome}`} /></td>}<td className="px-2 py-1.5"><Link href={`/desempenho/avaliacoes/${x.review_id}`} className="text-acao hover:underline">{x.nome}</Link></td><td className="px-2 py-1.5 text-xs">{x.responsavel ?? <span className="text-aviso">sem usuário vinculado</span>}</td><td className="px-2 py-1.5 text-xs">{x.unidade ?? "—"} · {x.area ?? "—"}</td><td className="px-2 py-1.5 text-xs">{x.lembretes}/2{x.escalado ? <span className="ml-1 rounded bg-red-50 px-1 text-erro">escalado</span> : null}</td></tr>)}</tbody></table></div>
            {lembra && est && <div className="mt-2 flex flex-wrap gap-2 print:hidden"><Btn small kind="ghost">Lembrar selecionados</Btn><Btn small name="todos" value="1">Lembrar todos ({pend.filter(x => x.lembretes < 2).length})</Btn><span className="self-center text-[11px] text-slate-500">Máx. 2 por pessoa e etapa; o 2º escala ao diretor da unidade (só a contagem).</span></div>}
          </form>}
        </Card>
        {mudancas.length > 0 && <Card title={`Mudanças de janela — ${NOME_ETAPA[sel]}`}><ul className="space-y-1 text-sm">{mudancas.map(m => <li key={m.id} className="border-l-2 border-amber-300 pl-2"><div className="text-[11px] text-slate-500">{fmtDataHora(m.created_at)} · {m.user_nome ?? "—"}{m.de_fim && m.para_fim && m.de_fim !== m.para_fim ? ` · fim ${fmtData(m.de_fim)} → ${fmtData(m.para_fim)}` : ""}</div><div>{m.motivo}</div></li>)}</ul></Card>}
      </>}
      <p className="mt-3 text-[11px] text-slate-500"><Link href={base} className="text-acao">Atualizar</Link> · Pendências derivadas do próprio ciclo (nominações, autoavaliações, contribuições, envios do gestor, calibração e ciência).</p>
    </Page>
  );
}
