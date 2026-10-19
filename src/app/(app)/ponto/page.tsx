import Link from "@/components/Link";
import { requireStaff, scopeUnit, can } from "@/lib/auth";
import { Page, Table, Td, Badge, Flash, Field, Btn, Input, Stat } from "@/components/ui";
import { fmtMin } from "@/lib/utils";
import { resumoMes, mesAtual } from "@/lib/ponto";
import { sql } from "@/db";
import { locksDoMes, pendenciasFechamento } from "@/lib/folha";
import { fecharPonto, reabrirPonto } from "../folha/actions";
import { Card, Textarea } from "@/components/ui";
import { fmtDataHora } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function Ponto({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaff(); const sp = await searchParams; const u = scopeUnit(s);
  const mes = sp.mes && /^\d{4}-\d{2}$/.test(sp.mes) ? sp.mes : mesAtual();
  const rows = await resumoMes(u, mes);
  const semJornada = rows.filter(r => !r.tem_jornada && !r.jornada_min_dia).length; const semFolha = rows.filter(r => r.dias_salvos === 0).length;
  const saldo = rows.reduce((a, r) => a + r.saldo_mes, 0);
  // v24 · fechamento do mês por unidade (CRQ-TMP-V3-04): congela o espelho e libera o pacote da folha
  const unidades = await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ${u === null ? sql`` : sql`WHERE id=${u}`} ORDER BY nome`;
  const locks = await locksDoMes(mes); const pend = await Promise.all(unidades.map(x => pendenciasFechamento(x.id, mes)));
  const podeFechar = ["RH", "DIRECAO", "DIRETOR_UNIDADE"].includes(s.role); const podeReabrir = ["RH", "DIRECAO"].includes(s.role);
  const voltar = `/ponto?mes=${mes}`;
  return (
    <Page title="Ponto e jornada" sub="Folha mensal por colaborador: dia a dia com carga esperada, trabalhada e situação. Cada dia salvo vira lançamento no banco de horas."
      actions={<><Btn kind="ghost" href="/ponto/jornadas">Jornadas</Btn><Btn kind="ghost" href="/ponto/calendario">Calendário</Btn>{["RH", "DIRECAO", "DIRETOR_UNIDADE"].includes(s.role) && <Btn kind="ghost" href={`/ponto/auditoria?mes=${mes}`}>Auditoria</Btn>}{can.editar(s) && <Btn kind="ghost" href="/ponto/importar">Importar planilhas</Btn>}</>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <form className="mb-4 flex items-end gap-2"><Field label="Mês"><Input type="month" name="mes" defaultValue={mes} /></Field><Btn kind="ghost">Ver</Btn></form>
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="Colaboradores" value={rows.length} />
        <Stat label="Sem folha no mês" value={<span className={semFolha ? "text-aviso" : ""}>{semFolha}</span>} />
        <Stat label="Sem jornada definida" value={<span className={semJornada ? "text-aviso" : ""}>{semJornada}</span>} hint="defina em Jornadas" />
        <Stat label="Saldo gerado no mês" value={<span className={saldo < 0 ? "text-erro" : "text-ok"}>{fmtMin(saldo)}</span>} />
      </div>
      <Card title={`Fechamento de ${mes.split("-").reverse().join("/")} por unidade`} className="mb-4" actions={<Link href={`/folha?mes=${mes}`} className="text-xs font-medium text-acao">Ciclo da folha →</Link>}>
        <div id="fechamento" className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {unidades.map((x, i) => { const l = locks.get(x.id); const p = pend[i]; const fechado = l?.status === "FECHADO"; return (
            <div key={x.id} className={`rounded-md border p-3 text-sm ${fechado ? "border-emerald-200 bg-emerald-50/50" : "border-line"}`}>
              <div className="flex flex-wrap items-center justify-between gap-2"><b className="text-navy">{x.nome}</b>{fechado ? <Badge v="APROVADA" label="Fechado" /> : l?.status === "REABERTO" ? <Badge v="PENDENTE" label="Reaberto" /> : <Badge v="ABERTO" label="Aberto" />}</div>
              {fechado ? <p className="mt-1 text-xs text-slate-600">por {l!.fechado_por_nome ?? "—"} em {fmtDataHora(l!.fechado_em)}{l!.ressalva ? ` · ressalva: ${l!.ressalva}` : ""}</p>
                : <ul className="mt-1 space-y-0.5 text-xs text-slate-600"><li>{p.ativos} no quadro do mês</li><li className={p.sem_folha ? "text-aviso" : ""}>{p.sem_folha} sem folha no mês</li><li className={p.sem_jornada ? "text-aviso" : ""}>{p.sem_jornada} sem jornada definida</li><li className={p.pendentes ? "text-erro" : ""}>{p.pendentes} lançamento(s) aguardando aprovação</li><li className={p.divergencias ? "text-aviso" : ""}>{p.divergencias} divergência(s) da auditoria em aberto</li>{l?.status === "REABERTO" && <li>reaberto: {l.motivo_reabertura}</li>}</ul>}
              {!fechado && podeFechar && <form action={fecharPonto} className="mt-2 space-y-2"><input type="hidden" name="unitId" value={x.id} /><input type="hidden" name="mes" value={mes} /><input type="hidden" name="voltar" value={voltar} />
                {p.total > 0 && podeReabrir && <Textarea name="ressalva" placeholder="Ressalva (obrigatória com pendências): o que fica em aberto e por quê" className="min-h-[56px] text-xs" />}
                <Btn small kind={p.total ? "ghost" : "primary"}>{p.total ? "Fechar com ressalva" : "Fechar o mês"}</Btn></form>}
              {fechado && podeReabrir && <details className="mt-2"><summary className="cursor-pointer text-xs text-acao">Reabrir com justificativa</summary><form action={reabrirPonto} className="mt-2 space-y-2"><input type="hidden" name="unitId" value={x.id} /><input type="hidden" name="mes" value={mes} /><input type="hidden" name="voltar" value={voltar} /><Textarea name="motivo" required minLength={10} placeholder="Por que reabrir (fica na auditoria)" className="min-h-[56px] text-xs" /><Btn small danger>Reabrir</Btn></form></details>}
            </div>); })}
        </div>
        <p className="mt-2 text-xs text-slate-500">Fechado, o espelho do mês fica congelado (ponto e banco de horas). O pacote da folha só sai com o ponto de todas as unidades da entidade fechado (CRQ-FOL-V3-01).</p>
      </Card>
      <Table head={["Colaborador", "Unidade", "Regime", "Jornada", "Dias salvos", "Esperado", "Trabalhado", "Faltas", "Atestados", "Saldo do mês"]} empty="Nenhum colaborador ativo.">
        {rows.map(r => <tr key={r.id} className="hover:bg-mist/60">
          <Td><Link className="font-medium text-acao" href={`/ponto/${r.id}?mes=${mes}`}>{r.nome}</Link></Td><Td>{r.unidade}</Td><Td className="text-xs">{r.regime === "DOCENTE" ? "Docente" : "Administrativo"}</Td>
          <Td>{r.tem_jornada ? <Badge v="ATIVO" label="definida" /> : r.jornada_min_dia ? <span className="text-xs text-slate-600">{fmtMin(r.jornada_min_dia).slice(1)}/dia</span> : <Badge v="PENDENTE" label="sem jornada" />}</Td>
          <Td>{r.dias_salvos || <span className="text-slate-400">—</span>}</Td><Td className="tabular-nums">{r.dias_salvos ? fmtMin(r.esperado).slice(1) : "—"}</Td><Td className="tabular-nums">{r.dias_salvos ? fmtMin(r.trabalhado).slice(1) : "—"}</Td><Td>{r.faltas || "—"}</Td><Td>{r.atestados || "—"}</Td>
          <Td className={`font-medium tabular-nums ${r.saldo_mes < 0 ? "text-erro" : r.saldo_mes > 0 ? "text-ok" : ""}`}>{r.dias_salvos ? fmtMin(r.saldo_mes) : "—"}</Td>
        </tr>)}
      </Table>
    </Page>
  );
}
