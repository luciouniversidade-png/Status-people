import { redirect } from "next/navigation";
import Link from "@/components/Link";
import { requireSession } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Badge, Flash, Btn, Field, Input, Textarea, Stat, Table, Td, Select } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { fmtData, fmtMin, hoje, addDays, periodosFerias, LEAVE_LABEL, LEAVE_STATUS, HOUR_LABEL, HOUR_STATUS } from "@/lib/utils";
import { montarMes, PONTO_LABEL, diffDia } from "@/lib/ponto";
import { DIAS_CURTO } from "@/lib/cobertura";
import { SOL_STATUS, SOL_TOM } from "@/lib/solicitacoes";
import { minhasPendencias } from "@/lib/pendencias";
import { solicitarAfastamento } from "../ferias/actions";
import { atualizarContato } from "./actions";

export const dynamic = "force-dynamic";
const DOW = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"] as const;
const mesTxt = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });

/** T-104 · Portal do colaborador: a home pessoal — jornada do dia, espelho e saldo, férias, solicitações, ciências, holerites e contato. Só dados próprios. */
export default async function MeuEspaco({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); if (!s.employeeId) redirect("/conta"); const sp = await searchParams;
  const eid = s.employeeId; const h = hoje(); const dow = new Date(h + "T12:00:00Z").getUTCDay();
  const meses = [0, 1, 2, 3, 4, 5].map(k => { const d = new Date(`${h.slice(0, 7)}-15T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - k); return d.toISOString().slice(0, 7); });
  const mes = sp.mes && meses.includes(sp.mes) ? sp.mes : meses[0];
  const [[e], [jorn], [cal], leaves, [banco], lanc, aulas, reqs, holerites, [div], tipos] = await Promise.all([
    sql<{ nome: string; cargo: string | null; unidade: string; unit_id: number; gestor: string | null; admissao: string; regime: string; telefone: string | null; email: string | null; endereco: string | null; contato_emergencia: string | null; ferias_quitadas_ate: string | null; jornada_min_dia: number | null }[]>`SELECT e.nome, p.nome AS cargo, u.nome AS unidade, e.unit_id, g.nome AS gestor, e.admissao::text, e.regime, e.telefone, e.email, e.endereco, e.contato_emergencia, e.ferias_quitadas_ate::text, e.jornada_min_dia
      FROM employees e JOIN units u ON u.id=e.unit_id LEFT JOIN positions p ON p.id=e.position_id LEFT JOIN employees g ON g.id=e.gestor_id WHERE e.id=${eid}`,
    sql<{ seg: number; ter: number; qua: number; qui: number; sex: number; sab: number; dom: number; horarios: string | null; vigencia_inicio: string }[]>`SELECT seg, ter, qua, qui, sex, sab, dom, horarios, vigencia_inicio::text FROM schedules WHERE employee_id=${eid} AND vigencia_inicio <= ${h} AND (vigencia_fim IS NULL OR vigencia_fim >= ${h}) ORDER BY vigencia_inicio DESC LIMIT 1`,
    sql<{ tipo: string; descricao: string | null }[]>`SELECT c.tipo, c.descricao FROM calendar_days c JOIN employees e ON e.id=${eid} WHERE c.data=${h} AND (c.publico='TODOS' OR c.publico=e.regime) AND (c.unit_id IS NULL OR c.unit_id=e.unit_id) LIMIT 1`,
    sql<{ id: number; tipo: string; inicio: string; fim: string; dias: number; status: string; periodo_ref: string | null }[]>`SELECT id, tipo, inicio::text, fim::text, dias, status, periodo_ref::text FROM leave_requests WHERE employee_id=${eid} ORDER BY inicio DESC LIMIT 30`,
    sql<{ saldo: number; pend: number; npend: number }[]>`SELECT coalesce(sum(minutos) FILTER (WHERE status='APROVADO'),0)::int AS saldo, coalesce(sum(minutos) FILTER (WHERE status='PENDENTE'),0)::int AS pend, count(*) FILTER (WHERE status='PENDENTE')::int AS npend FROM hour_entries WHERE employee_id=${eid}`,
    sql<{ data: string; minutos: number; tipo: string; status: string; descricao: string | null }[]>`SELECT data::text, minutos, tipo, status, descricao FROM hour_entries WHERE employee_id=${eid} ORDER BY data DESC, id DESC LIMIT 6`,
    sql<{ inicio: string; fim: string; turma: string; disciplina: string | null; unidade: string; sala: string | null }[]>`SELECT t.inicio, t.fim, t.turma, t.disciplina, u.nome AS unidade, sp.nome AS sala FROM teacher_slots t JOIN units u ON u.id=t.unit_id LEFT JOIN spaces sp ON sp.id=t.space_id WHERE t.employee_id=${eid} AND t.ativo AND slot_vigente(t.version_id, ${h}::date) AND t.dia_semana=${dow} ORDER BY t.inicio`,
    sql<{ id: number; numero: string; titulo: string; status: string; created_at: string; pago_em: string | null; valor: string | null }[]>`SELECT id, numero, titulo, status, created_at::text, pago_em::text, valor::text FROM requests WHERE solicitante_user_id=${s.id} ORDER BY created_at DESC LIMIT 5`,
    sql<{ attachment_id: number; competencia: string }[]>`SELECT d.attachment_id, c.competencia FROM payroll_docs d JOIN payroll_cycles c ON c.id=d.cycle_id WHERE d.employee_id=${eid} AND d.tipo='HOLERITES' ORDER BY c.competencia DESC LIMIT 6`.catch(() => []),
    sql<{ n: number }[]>`SELECT count(*)::int AS n FROM timesheet_audit WHERE employee_id=${eid} AND status IN ('ABERTA','DEVOLVIDA') AND to_char(data, 'YYYY-MM')=${mes}`.catch(() => [{ n: 0 }]),
    sql<{ id: number; codigo: string }[]>`SELECT id, codigo FROM request_types WHERE ativo AND codigo='DECLARACAO'`,
  ]);
  if (!e) redirect("/conta");
  const { dias } = await montarMes(eid, mes); const salvos = dias.filter(d => d.salvo);
  const per = periodosFerias(e.admissao, leaves.filter(l => l.status === "APROVADA" && l.tipo === "FERIAS" && l.periodo_ref).map(l => ({ periodoRef: l.periodo_ref, dias: l.dias })), undefined, e.ferias_quitadas_ate);
  const aberto = per.find(p => (p.status === "ABERTO" || p.status === "VENCIDO") && p.saldo > 0); const emAquis = per.find(p => p.status === "EM_AQUISICAO");
  const agora = leaves.find(l => l.status === "APROVADA" && l.inicio <= h && l.fim >= h); const proximas = leaves.filter(l => l.status === "APROVADA" && l.inicio > h).sort((a, b) => a.inicio.localeCompare(b.inicio));
  const emAnalise = leaves.filter(l => l.status === "SOLICITADA");
  const pend = await minhasPendencias(s, { semTreinamentos: false }).catch(() => ({ itens: [], falhas: [] }));
  const ciencias = pend.itens.filter(p => p.grupo === "CIENCIA" || p.grupo === "ATENDER").slice(0, 8);
  const cargaHoje = jorn ? jorn[DOW[dow]] : (dow === 0 || dow === 6 ? 0 : e.jornada_min_dia ?? 0);
  const primeiro = e.nome.split(" ")[0];
  const saldoMes = salvos.reduce((a, d) => a + diffDia(d), 0);
  const hojeTxt = agora ? `Você está em ${LEAVE_LABEL[agora.tipo].toLowerCase()} até ${fmtData(agora.fim)}.` : cal && cal.tipo !== "RECESSO" ? `Hoje é ${cal.descricao ?? cal.tipo.toLowerCase()} — sem expediente.` : cargaHoje ? `Jornada de hoje: ${fmtMin(cargaHoje).replace("+", "")}${jorn?.horarios ? ` · ${jorn.horarios}` : ""}.` : "Hoje não há jornada prevista para você.";
  return (
    <Page title={`Olá, ${primeiro}`} sub={`${e.cargo ?? "Colaborador(a)"} · ${e.unidade}${e.gestor ? ` · gestor(a): ${e.gestor}` : ""}. Seu espaço: só os seus dados.`} actions={<Btn kind="ghost" href="/solicitacoes/nova">Nova solicitação</Btn>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <Card className="mb-4" title="Hoje">
        <p className="text-sm">{hojeTxt}</p>
        {aulas.length > 0 && !agora && <ul className="mt-2 grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">{aulas.map((a, i) => <li key={i} className="rounded border border-line px-2 py-1"><span className="tabular-nums font-medium">{a.inicio}–{a.fim}</span> · {a.turma}{a.disciplina ? ` · ${a.disciplina}` : ""}<span className="text-xs text-slate-500"> · {a.unidade}{a.sala ? ` · ${a.sala}` : ""}</span></li>)}</ul>}
      </Card>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Saldo do banco de horas" value={fmtMin(banco?.saldo ?? 0)} hint={banco?.npend ? `${banco.npend} lançamento(s) aguardando aprovação (${fmtMin(banco.pend)})` : "aprovado"} />
        <Stat label="Férias disponíveis" value={aberto ? `${aberto.saldo} dia(s)` : "—"} hint={aberto ? `período ${aberto.inicio.slice(0, 4)}–${aberto.fim.slice(0, 4)} · tirar até ${fmtData(aberto.concessivoAte)}` : emAquis ? `próximo período completa em ${fmtData(emAquis.fim)}` : "sem período aberto"} />
        <Stat label="Próximas férias ou folga" value={proximas[0] ? fmtData(proximas[0].inicio) : "—"} hint={proximas[0] ? `${LEAVE_LABEL[proximas[0].tipo]} até ${fmtData(proximas[0].fim)}` : emAnalise.length ? `${emAnalise.length} pedido(s) em análise` : "nada marcado"} />
        <Stat label="Pendências" value={String(pend.itens.length)} hint="ciências, cursos e tarefas" href="/pendencias" />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] xl:items-start">
        <div className="min-w-0 space-y-4">
          <Card title={`Meu espelho de ponto — ${mesTxt(mes)}`} actions={<form className="flex items-center gap-1"><Select name="mes" defaultValue={mes} aria-label="Mês" className="!py-1 !text-xs">{meses.map(m => <option key={m} value={m}>{mesTxt(m)}</option>)}</Select><Btn small kind="ghost">Ver</Btn></form>}>
            {salvos.length === 0 ? <p className="text-sm text-slate-500">O ponto deste mês ainda não foi lançado. Assim que o RH importar o espelho do relógio, ele aparece aqui.</p> : <>
              <Table head={["Dia", "Situação", "Esperado", "Trabalhado", "Saldo"]}>
                {salvos.map(d => { const df = diffDia(d); return <tr key={d.data}><Td className="whitespace-nowrap">{fmtData(d.data).slice(0, 5)} <span className="text-[11px] text-slate-500">{DIAS_CURTO[d.dow]}</span></Td><Td className="text-xs">{PONTO_LABEL[d.status] ?? d.status}{d.marcacoes ? <div className="text-[11px] tabular-nums text-slate-500">{d.marcacoes}</div> : null}</Td><Td className="tabular-nums">{d.esperado ? fmtMin(d.esperado).replace("+", "") : "—"}</Td><Td className="tabular-nums">{d.trabalhado ? fmtMin(d.trabalhado).replace("+", "") : "—"}</Td><Td className={`tabular-nums ${df < 0 ? "text-erro" : df > 0 ? "text-ok" : "text-slate-400"}`}>{df ? fmtMin(df) : "0"}</Td></tr>; })}
              </Table>
              <p className="mt-2 text-xs text-slate-600">Saldo do mês: <b className="tabular-nums">{fmtMin(saldoMes)}</b> · lançamentos entram no banco depois da aprovação.{div?.n ? ` ${div.n} dia(s) em análise pelo RH na auditoria do ponto.` : ""} <a className="text-acao underline" href={`/api/export/meu-espelho?mes=${mes}`}>Baixar (CSV)</a></p>
            </>}
          </Card>
          <Card title="Banco de horas — últimos lançamentos">
            {lanc.length === 0 ? <p className="text-sm text-slate-500">Nenhum lançamento ainda.</p> : <ul className="divide-y divide-line text-sm">{lanc.map((l, i) => <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-1.5"><span className="min-w-0">{fmtData(l.data)} · {HOUR_LABEL[l.tipo] ?? l.tipo}<span className="block text-[11px] text-slate-500 [overflow-wrap:anywhere]">{l.descricao}</span></span><span className="flex items-center gap-2"><span className={`tabular-nums ${l.minutos < 0 ? "text-erro" : "text-ok"}`}>{fmtMin(l.minutos)}</span><Badge v={l.status === "APROVADO" ? "APROVADA" : l.status === "REJEITADO" ? "REJEITADA" : "PENDENTE"} label={HOUR_STATUS[l.status] ?? l.status} /></span></li>)}</ul>}
          </Card>
          <Card title="Férias e folgas" actions={<span className="flex gap-1">
              <Modal label="Pedir férias" title="Pedir férias"><form action={solicitarAfastamento} className="space-y-2"><input type="hidden" name="employeeId" value={eid} /><input type="hidden" name="tipo" value="FERIAS" /><input type="hidden" name="voltar" value="/eu" />
                <div className="grid grid-cols-2 gap-2"><Field label="Início"><Input type="date" name="inicio" required min={addDays(h, 1)} /></Field><Field label="Fim"><Input type="date" name="fim" required min={addDays(h, 1)} /></Field></div>
                <Field label="Observação (opcional)"><Textarea name="justificativa" className="min-h-[50px]" /></Field>
                <p className="text-[11px] text-slate-500">{aberto ? `Saldo: ${aberto.saldo} dia(s) do período ${aberto.inicio.slice(0, 4)}–${aberto.fim.slice(0, 4)}.` : "Sem período com saldo no momento."} Mínimo de 5 dias corridos; o pedido segue a aprovação normal (cobertura mínima da equipe).</p><Btn small>Enviar pedido</Btn></form></Modal>
              <Modal label="Pedir folga do banco" title="Folga do banco de horas"><form action={solicitarAfastamento} className="space-y-2"><input type="hidden" name="employeeId" value={eid} /><input type="hidden" name="tipo" value="FOLGA_BANCO" /><input type="hidden" name="voltar" value="/eu" />
                <div className="grid grid-cols-2 gap-2"><Field label="De"><Input type="date" name="inicio" required min={addDays(h, 1)} /></Field><Field label="Até"><Input type="date" name="fim" required min={addDays(h, 1)} /></Field></div>
                <p className="text-[11px] text-slate-500">Saldo aprovado: {fmtMin(banco?.saldo ?? 0)}. A folga desconta a CH do dia do banco.</p><Btn small>Enviar pedido</Btn></form></Modal></span>}>
            <ul className="space-y-1 text-sm">
              {per.filter(p => p.status !== "QUITADO").slice(-3).reverse().map(p => <li key={p.inicio} className="flex flex-wrap justify-between gap-2"><span>Período {fmtData(p.inicio)} a {fmtData(p.fim)}</span><span className="text-xs text-slate-600">{p.status === "EM_AQUISICAO" ? "em aquisição" : `${p.saldo} dia(s) · tirar até ${fmtData(p.concessivoAte)}`}{p.status === "VENCIDO" ? " · vencido" : ""}</span></li>)}
            </ul>
            {leaves.length > 0 && <ul className="mt-3 divide-y divide-line border-t border-line text-sm">{leaves.slice(0, 6).map(l => <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5"><span>{LEAVE_LABEL[l.tipo] ?? l.tipo} · {fmtData(l.inicio)} a {fmtData(l.fim)} ({l.dias} dia(s))</span><Badge v={l.status} label={LEAVE_STATUS[l.status] ?? l.status} /></li>)}</ul>}
          </Card>
        </div>
        <div className="min-w-0 space-y-4">
          <Card title="Minhas solicitações" actions={<Link className="text-xs text-acao underline" href="/solicitacoes?aba=minhas">todas</Link>}>
            {reqs.length === 0 ? <p className="text-sm text-slate-500">Nenhuma solicitação. <Link className="text-acao underline" href="/solicitacoes/nova">Abrir uma</Link> (reembolso, material, declaração…).</p> :
              <ul className="divide-y divide-line text-sm">{reqs.map(r => <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5"><Link className="min-w-0 text-acao [overflow-wrap:anywhere]" href={`/solicitacoes/${r.id}`}>{r.titulo}</Link><span className="flex gap-1"><Badge v={SOL_TOM[r.status]} label={SOL_STATUS[r.status]} />{r.status === "APROVADA" && r.valor && Number(r.valor) > 0 ? <Badge v={r.pago_em ? "APROVADA" : "PENDENTE"} label={r.pago_em ? "paga" : "a pagar"} /> : null}</span></li>)}</ul>}
          </Card>
          <Card title="Documentos e ciências" actions={<Link className="text-xs text-acao underline" href="/pendencias">pendências</Link>}>
            {ciencias.length === 0 ? <p className="text-sm text-ok">Nada pendente: comunicados lidos, POPs e cursos em dia.</p> : <ul className="space-y-1 text-sm">{ciencias.map(p => <li key={p.chave}><Link className="text-acao" href={p.href}>{p.titulo}</Link>{p.prazo ? <span className="text-xs text-slate-500"> · até {fmtData(p.prazo)}</span> : null}</li>)}</ul>}
          </Card>
          <Card title="Holerites e comprovantes">
            <ul className="space-y-1 text-sm">
              {holerites.map(x => <li key={x.attachment_id}><a className="text-acao" href={`/api/anexos/${x.attachment_id}`} target="_blank" rel="noreferrer">Holerite {x.competencia.split("-").reverse().join("/")}</a></li>)}
              {holerites.length === 0 && <li className="text-slate-500">Holerites aparecem aqui quando o RH arquivar a folha do mês.</li>}
              <li><a className="text-acao" href={`/api/export/meu-espelho?mes=${mes}`}>Espelho do ponto de {mesTxt(mes)} (CSV)</a></li>
              {tipos[0] && <li><Link className="text-acao" href={`/solicitacoes/nova?tipo=${tipos[0].id}`}>Pedir declaração (vínculo, frequência)</Link></li>}
            </ul>
          </Card>
          <Card title="Meus dados de contato" actions={<Modal label="Atualizar" title="Atualizar meus dados de contato"><form action={atualizarContato} className="space-y-2">
              <Field label="Telefone (com DDD)"><Input name="telefone" defaultValue={e.telefone ?? ""} inputMode="tel" /></Field><Field label="E-mail"><Input name="email" type="email" defaultValue={e.email ?? ""} /></Field>
              <Field label="Endereço"><Textarea name="endereco" defaultValue={e.endereco ?? ""} className="min-h-[50px]" /></Field><Field label="Contato de emergência (nome e telefone)"><Input name="contatoEmergencia" defaultValue={e.contato_emergencia ?? ""} /></Field>
              <p className="text-[11px] text-slate-500">Nome, CPF, cargo e salário só o RH altera. A mudança fica registrada.</p><Btn small>Salvar</Btn></form></Modal>}>
            <div id="contato" />
            <dl className="space-y-1 text-sm"><div className="flex justify-between gap-2"><dt className="text-slate-500">Telefone</dt><dd>{e.telefone ?? "—"}</dd></div><div className="flex justify-between gap-2"><dt className="text-slate-500">E-mail</dt><dd className="[overflow-wrap:anywhere]">{e.email ?? "—"}</dd></div><div className="flex justify-between gap-2"><dt className="text-slate-500">Endereço</dt><dd className="text-right [overflow-wrap:anywhere]">{e.endereco ?? "—"}</dd></div><div className="flex justify-between gap-2"><dt className="text-slate-500">Emergência</dt><dd className="text-right [overflow-wrap:anywhere]">{e.contato_emergencia ?? "—"}</dd></div></dl>
          </Card>
          <Card title="Acesso rápido"><ul className="space-y-1 text-sm"><li><Link className="text-acao" href={`/colaboradores/${eid}/painel`}>Meu painel de desenvolvimento</Link></li><li><Link className="text-acao" href="/desempenho/minha">Minha avaliação</Link></li><li><Link className="text-acao" href="/academy/minha">Meus treinamentos</Link></li>{e.regime === "DOCENTE" && <li><Link className="text-acao" href="/cobertura/minha">Minhas substituições e minha grade</Link></li>}<li><Link className="text-acao" href={`/colaboradores/${eid}`}>Minha ficha completa</Link></li></ul></Card>
        </div>
      </div>
    </Page>
  );
}
