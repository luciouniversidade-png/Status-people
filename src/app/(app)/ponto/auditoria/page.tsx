import { redirect } from "next/navigation";
import Link from "@/components/Link";
import { requireSession, scopeUnit } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Table, Td, Flash, Field, Btn, Input, Select, Badge, Stat, Textarea } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { audit, fmtData, fmtMin } from "@/lib/utils";
import { mesAtual } from "@/lib/ponto";
import { divergencias, resumoAuditoria, DIV_TIPO, DIV_STATUS, ACOES } from "@/lib/auditoria-ponto";
import { processarAuditoriaMes, decidirDivergencia, aceitarLoteDivergencias, anexarAtestado } from "./actions";

export const dynamic = "force-dynamic";
const PERFIS = ["RH", "DIRECAO", "DIRETOR_UNIDADE"];
const LOTE = ["ATRASO", "SAIDA_ANTECIPADA", "DEFICIT", "HORA_EXTRA"];
const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const ROT_ACAO: Record<string, string> = { ACEITAR: "Aceitar", DEVOLVER: "Devolver ao relógio", CORRIGIR_CH: "Corrigir para a CH da jornada", ANEXAR: "Anexar atestado" };

/** T-050 · Auditoria do ponto (Secullum): espelho × CH esperada da jornada/grade, divergências tipificadas e decisão com trilha. */
export default async function AuditoriaPonto({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const sp = await searchParams;
  if (!PERFIS.includes(s.role)) { await audit(s, "acesso negado: auditoria do ponto", "timesheet_audit", null, null, { papel: s.role }); redirect("/?erro=" + encodeURIComponent("A auditoria do ponto é do RH, da Direção e do diretor(a) da unidade — a tentativa foi registrada.")); }
  const escopo = scopeUnit(s); const mes = sp.mes && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.mes) ? sp.mes : mesAtual();
  const units = await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ${escopo === null ? sql`` : sql`WHERE id=${escopo}`} ORDER BY nome`;
  const unitId = escopo ?? (units.some(u => u.id === Number(sp.unidade)) ? Number(sp.unidade) : null);
  const status = sp.situacao === "todas" ? null : sp.situacao && DIV_STATUS[sp.situacao] ? sp.situacao : "ABERTA";
  const tipo = sp.tipo && DIV_TIPO[sp.tipo] ? sp.tipo : null; const emp = Number(sp.colaborador) || null;
  const [lista, resumo, [proc]] = await Promise.all([divergencias(unitId, mes, { status, tipo, employeeId: emp }), resumoAuditoria(unitId, mes),
    sql<{ em: string | null }[]>`SELECT max(at)::text AS em FROM audit_log WHERE acao='processar auditoria do ponto' AND (depois->>'mes')=${mes}`]);
  const voltar = `/ponto/auditoria?${new URLSearchParams(Object.entries({ mes, unidade: unitId ? String(unitId) : "", situacao: sp.situacao ?? "", tipo: tipo ?? "", colaborador: emp ? String(emp) : "" }).filter(([, v]) => v)).toString()}`;
  const abertas = resumo.reduce((a, r) => a + r.abertas, 0); const deficit = resumo.reduce((a, r) => a + r.deficit, 0); const extra = resumo.reduce((a, r) => a + r.extra, 0);
  const normais = lista.filter(d => d.status === "ABERTA" && LOTE.includes(d.tipo));
  const exportar = `/api/export/auditoria-ponto?mes=${mes}${unitId ? `&unidade=${unitId}` : ""}${emp ? `&colaborador=${emp}` : ""}`;
  return (
    <Page title="Auditoria do ponto" sub={`Espelho do relógio (Secullum) confrontado dia a dia com a CH da jornada ou da grade vigente. ${proc?.em ? `Processada em ${fmtData(proc.em.slice(0, 10))}.` : "Ainda não processada neste mês."} Divergência só some com decisão ou com a reimportação corrigida.`}
      actions={<><Btn kind="ghost" href={exportar}>Planilha da auditoria (CSV)</Btn><Btn kind="ghost" href="/ponto/importar">Importar espelhos</Btn><Btn kind="ghost" href={`/ponto?mes=${mes}`}>Fechamento</Btn></>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <form className="flex flex-wrap items-end gap-2"><Field label="Mês"><Input type="month" name="mes" defaultValue={mes} /></Field>
          {escopo === null && <Field label="Unidade"><Select name="unidade" defaultValue={unitId ?? ""}><option value="">Rede</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>}
          <Field label="Situação"><Select name="situacao" defaultValue={sp.situacao ?? "ABERTA"}><option value="ABERTA">Abertas</option>{Object.entries(DIV_STATUS).filter(([k]) => k !== "ABERTA").map(([k, [, r]]) => <option key={k} value={k}>{r}</option>)}<option value="todas">Todas</option></Select></Field>
          <Field label="Tipo"><Select name="tipo" defaultValue={tipo ?? ""}><option value="">Todos</option>{Object.entries(DIV_TIPO).map(([k, t]) => <option key={k} value={k}>{t.rotulo}</option>)}</Select></Field>
          <Btn kind="ghost">Filtrar</Btn></form>
        <form action={processarAuditoriaMes}><input type="hidden" name="mes" value={mes} />{unitId && <input type="hidden" name="unitId" value={unitId} />}<input type="hidden" name="voltar" value={voltar} /><Btn>Processar o mês</Btn></form>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Divergências abertas" value={String(abertas)} hint={`${resumo.length} colaborador(es) com achado`} />
        <Stat label="Déficit (atraso, saída, sem marcação)" value={fmtMin(-deficit)} hint="soma dos achados do mês" />
        <Stat label="Hora extra e trabalho sem jornada" value={fmtMin(extra)} hint="a decidir antes do fechamento" />
        <Stat label="Erros de marcação / CH divergente" value={`${resumo.reduce((a, r) => a + r.marcacao, 0)} / ${resumo.reduce((a, r) => a + r.ch, 0)}`} hint="devolver ao relógio ou corrigir" />
      </div>
      {normais.length > 0 && <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-white px-3 py-2 text-sm"><span className="text-slate-600">Marque atrasos, saídas e horas extras normais e aceite de uma vez — erro de marcação, CH divergente e atestado são decisão individual.</span><form id="lote-aud" action={aceitarLoteDivergencias}><input type="hidden" name="voltar" value={voltar} /><Btn small>Aceitar marcadas em lote</Btn></form></div>}
      <Card title={`Divergências (${lista.length})`} className="mb-4">
        <Table head={["", "Colaborador(a)", "Dia", "Tipo", "Minutos", "Detalhe", "Situação", "Decisão"]} empty={proc?.em ? "Nenhuma divergência com este filtro." : "Processe o mês para confrontar o espelho com a CH esperada."}>
          {lista.map(d => <tr key={d.id}>
            <Td>{d.status === "ABERTA" && LOTE.includes(d.tipo) ? <input type="checkbox" name="ids" value={d.id} form="lote-aud" aria-label={`Incluir no lote: ${d.nome} ${fmtData(d.data)}`} /> : null}</Td>
            <Td className="font-medium"><Link className="text-acao" href={`/ponto/${d.employee_id}?mes=${mes}`}>{d.nome}</Link>{!unitId && <div className="text-[11px] font-normal text-slate-500">{d.unidade}</div>}</Td>
            <Td className="whitespace-nowrap">{fmtData(d.data)} <span className="text-[11px] text-slate-500">{DIAS[new Date(d.data + "T12:00:00Z").getUTCDay()]}</span></Td>
            <Td><span title={DIV_TIPO[d.tipo]?.ajuda}>{DIV_TIPO[d.tipo]?.rotulo ?? d.tipo}</span></Td>
            <Td className="whitespace-nowrap tabular-nums">{d.minutos ? fmtMin(["HORA_EXTRA", "TRABALHO_SEM_ESCALA"].includes(d.tipo) ? d.minutos : -Math.abs(d.minutos)) : "—"}</Td>
            <Td className="text-xs">{d.detalhe}</Td>
            <Td><Badge v={DIV_STATUS[d.status]?.[0] ?? "NEUTRO"} label={DIV_STATUS[d.status]?.[1] ?? d.status} />{d.decidido_por && <div className="text-[11px] text-slate-500">{d.decidido_por}{d.decisao_obs ? ` · ${d.decisao_obs}` : ""}</div>}</Td>
            <Td>{(d.status === "ABERTA" || d.status === "DEVOLVIDA") && <div className="flex flex-wrap gap-1">{(ACOES[d.tipo] ?? []).map(a => a === "ANEXAR" ? (["RH", "DIRECAO"].includes(s.role) && <Modal key={a} label={ROT_ACAO[a]} title={`Atestado de ${d.nome} — ${fmtData(d.data)}`}><form action={anexarAtestado} className="space-y-2"><input type="hidden" name="id" value={d.id} /><input type="hidden" name="voltar" value={voltar} /><Field label="Arquivo (PDF ou imagem)"><input type="file" name="arquivo" required className="block w-full text-xs" /></Field><p className="text-[11px] text-slate-500">Só o documento: não registre CID nem diagnóstico. O arquivo fica restrito ao RH e à Direção.</p><Btn small>Anexar</Btn></form></Modal>)
              : <Modal key={a} label={ROT_ACAO[a]} kind={a === "DEVOLVER" ? "ghost" : undefined} title={`${ROT_ACAO[a]} — ${d.nome}, ${fmtData(d.data)}`}><form action={decidirDivergencia} className="space-y-2"><input type="hidden" name="id" value={d.id} /><input type="hidden" name="acao" value={a} /><input type="hidden" name="voltar" value={voltar} /><p className="text-xs text-slate-600">{d.detalhe}</p><Field label={a === "DEVOLVER" ? "O que corrigir no relógio" : a === "ACEITAR" && ["CH_DIVERGENTE", "MARCACAO_IMPAR", "SEM_MARCACAO"].includes(d.tipo) ? "Justificativa (por que fica como está)" : "Observação (opcional)"}><Textarea name="obs" className="min-h-[60px]" /></Field>{a === "ACEITAR" && LOTE.concat(["TRABALHO_SEM_ESCALA", "SEM_MARCACAO"]).includes(d.tipo) && <p className="text-[11px] text-slate-500">O lançamento do dia segue para aprovação em Aprovações (alçada do banco de horas).</p>}<Btn small>{ROT_ACAO[a]}</Btn></form></Modal>)}</div>}</Td>
          </tr>)}
        </Table>
      </Card>
      <Card title="Resumo por colaborador">
        <Table head={["Colaborador(a)", "Achados", "Abertos", "Déficit", "Extra", "Marcação", "CH", "Atestado", ""]} empty="Sem achados no mês.">
          {resumo.map(r => <tr key={r.employee_id}><Td className="font-medium">{r.nome}{!unitId && <div className="text-[11px] font-normal text-slate-500">{r.unidade}</div>}</Td><Td>{r.total}</Td><Td>{r.abertas ? <b>{r.abertas}</b> : 0}</Td><Td className="whitespace-nowrap tabular-nums">{r.deficit ? fmtMin(-r.deficit) : "—"}</Td><Td className="whitespace-nowrap tabular-nums">{r.extra ? fmtMin(r.extra) : "—"}</Td><Td>{r.marcacao || "—"}</Td><Td>{r.ch || "—"}</Td><Td>{r.atestado || "—"}</Td>
            <Td><div className="flex flex-wrap gap-2 text-xs"><Link className="text-acao underline" href={`/ponto/auditoria?mes=${mes}&colaborador=${r.employee_id}&situacao=todas${unitId ? `&unidade=${unitId}` : ""}`}>ver</Link><Link className="text-acao underline" href={`/api/export/auditoria-ponto?mes=${mes}&colaborador=${r.employee_id}`}>planilha</Link></div></Td></tr>)}
        </Table>
        <p className="mt-2 text-[11px] text-slate-500">Tolerância do dia e hora extra mínima em Configurações → Conciliação, despesas e ponto (v25) → Auditoria do ponto. Divergências abertas entram nas pendências do fechamento do mês.</p>
      </Card>
    </Page>
  );
}
