import Link from "next/link";
import { requireStaff, scopeUnit, can } from "@/lib/auth";
import { sql, db, schema } from "@/db";
import { asc, and, ne, eq } from "drizzle-orm";
import { Page, Table, Td, Badge, Flash, Select, Field, Btn, Card, Input, Stat } from "@/components/ui";
import { fmtData, fmtMin, HOUR_LABEL, HOUR_STATUS, HOUR_TIPOS, getSettings, hoje } from "@/lib/utils";
import { lancarHoras, decidirHoras } from "./actions";

export const dynamic = "force-dynamic";

export default async function Banco({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaff(); const sp = await searchParams; const u = scopeUnit(s); const cfg = await getSettings();
  const uf = u === null ? sql`` : sql`AND e.unit_id=${u}`;
  const [saldos, pendentes, [tot]] = await Promise.all([
    sql<{ id: number; nome: string; unidade: string; saldo: number; pendentes: number }[]>`SELECT e.id, e.nome, u.nome AS unidade,
        coalesce((SELECT sum(minutos) FROM hour_entries h WHERE h.employee_id=e.id AND h.status='APROVADO'),0)::int AS saldo,
        (SELECT count(*) FROM hour_entries h WHERE h.employee_id=e.id AND h.status='PENDENTE')::int AS pendentes
      FROM employees e JOIN units u ON u.id=e.unit_id WHERE e.situacao <> 'DESLIGADO' ${uf}
      ${sp.ordem === "nome" ? sql`ORDER BY e.nome` : sql`ORDER BY 4 ASC`} LIMIT 500`,
    sql<{ id: number; nome: string; employee_id: number; data: string; tipo: string; minutos: number; descricao: string | null }[]>`SELECT h.id, e.nome, e.id AS employee_id, h.data::text, h.tipo, h.minutos, h.descricao FROM hour_entries h JOIN employees e ON e.id=h.employee_id WHERE h.status='PENDENTE' ${uf} ORDER BY h.data LIMIT 100`,
    sql<{ neg: number; pos: number; devedores: number }[]>`SELECT coalesce(sum(CASE WHEN x.saldo<0 THEN x.saldo END),0)::int AS neg, coalesce(sum(CASE WHEN x.saldo>0 THEN x.saldo END),0)::int AS pos, count(*) FILTER (WHERE x.saldo<0)::int AS devedores FROM (SELECT e.id, coalesce(sum(h.minutos),0) AS saldo FROM employees e LEFT JOIN hour_entries h ON h.employee_id=e.id AND h.status='APROVADO' WHERE e.situacao<>'DESLIGADO' ${uf} GROUP BY e.id) x`,
  ]);
  const emps = await db.select({ id: schema.employees.id, nome: schema.employees.nome }).from(schema.employees).where(u === null ? ne(schema.employees.situacao, "DESLIGADO") : and(ne(schema.employees.situacao, "DESLIGADO"), eq(schema.employees.unitId, u))).orderBy(asc(schema.employees.nome));
  const podeAprovar = can.aprovar(s, cfg.alcadas.banco);
  return (
    <Page title="Banco de horas" sub="Saldo em horas dos lançamentos aprovados. Crédito = hora extra; débito = atraso, falta ou compensação."
      actions={<><Btn kind="ghost" href="/api/export/banco">Exportar CSV</Btn>{can.editar(s) && <Btn kind="ghost" href="/banco-de-horas/importar">Importar saldos da planilha</Btn>}</>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Débito total" value={<span className="text-erro">{fmtMin(tot.neg)}</span>} hint={`${tot.devedores} colaborador(es) com saldo negativo`} />
        <Stat label="Crédito total" value={<span className="text-ok">{fmtMin(tot.pos)}</span>} />
        <Stat label="Lançamentos aguardando aprovação" value={pendentes.length} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          {pendentes.length > 0 && (
            <Card title="Aguardando aprovação">
              <Table head={["Colaborador", "Data", "Tipo", "Minutos", "Descrição", ""]}>
                {pendentes.map(x => <tr key={x.id}><Td><Link className="text-acao" href={`/colaboradores/${x.employee_id}#banco`}>{x.nome}</Link></Td><Td>{fmtData(x.data)}</Td><Td>{HOUR_LABEL[x.tipo]}</Td><Td className={x.minutos < 0 ? "text-erro" : "text-ok"}>{fmtMin(x.minutos)}</Td><Td className="text-slate-600">{x.descricao ?? "—"}</Td>
                  <Td>{podeAprovar && <form action={decidirHoras} className="flex gap-1"><input type="hidden" name="id" value={x.id} /><input type="hidden" name="voltar" value="/banco-de-horas" /><Btn small name="decisao" value="APROVADO">Aprovar</Btn><Btn small kind="ghost" name="decisao" value="REJEITADO">Rejeitar</Btn></form>}</Td></tr>)}
              </Table>
            </Card>
          )}
          <Card title="Saldo por colaborador" actions={<form className="flex items-center gap-1 text-xs"><Select name="ordem" defaultValue={sp.ordem ?? "saldo"} className="!w-auto !py-1 !text-xs"><option value="saldo">Maior débito primeiro</option><option value="nome">Por nome</option></Select><Btn small kind="ghost">Ordenar</Btn></form>}>
            <Table head={["Colaborador", "Unidade", "Saldo", "Pendentes"]} empty="Nenhum colaborador ativo.">
              {saldos.map(r => <tr key={r.id}><Td><Link className="text-acao" href={`/colaboradores/${r.id}#banco`}>{r.nome}</Link></Td><Td>{r.unidade}</Td><Td className={`font-medium tabular-nums ${r.saldo < 0 ? "text-erro" : r.saldo > 0 ? "text-ok" : ""}`}>{fmtMin(r.saldo)}</Td><Td>{r.pendentes ? <Badge v="PENDENTE" label={`${r.pendentes}`} /> : "—"}</Td></tr>)}
            </Table>
          </Card>
        </div>
        {can.solicitar(s) && (
          <Card title="Novo lançamento">
            <form action={lancarHoras} className="space-y-2"><input type="hidden" name="voltar" value="/banco-de-horas" />
              <Field label="Colaborador"><Select name="employeeId" required><option value="">Escolha</option>{emps.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}</Select></Field>
              <Field label="Data"><Input name="data" type="date" required defaultValue={hoje()} /></Field>
              <Field label="Tipo"><Select name="tipo" defaultValue="EXTRA">{HOUR_TIPOS.map(t => <option key={t} value={t}>{HOUR_LABEL[t]}</option>)}</Select></Field>
              <div className="grid grid-cols-3 gap-2"><Field label="Horas"><Input name="horas" type="number" min={0} defaultValue={0} /></Field><Field label="Minutos"><Input name="minutos" type="number" min={0} max={59} defaultValue={0} /></Field><Field label="Ajuste"><Select name="sinal" defaultValue="+"><option value="+">+</option><option value="-">−</option></Select></Field></div>
              <Field label="Descrição"><Input name="descricao" /></Field>
              <Btn>{podeAprovar ? "Lançar" : "Enviar para aprovação"}</Btn>
              <p className="text-xs text-slate-500">Lançamentos de {cfg.alcadas.banco.join(", ")} entram aprovados; os demais aguardam aprovação. Saldos iniciais podem ser importados como “Ajuste” com a data do fechamento da planilha.</p>
            </form>
          </Card>
        )}
      </div>
    </Page>
  );
}
