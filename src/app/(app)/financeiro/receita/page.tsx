import { requireFinanceiro, scopeUnit, can } from "@/lib/auth";
import { db, schema, sql } from "@/db";
import { asc } from "drizzle-orm";
import { Page, Card, Table, Td, Flash, Field, Select, Btn, Input, Stat } from "@/components/ui";
import { getSettings } from "@/lib/utils";
import { receita, brl } from "@/lib/financeiro";
import { salvarPreco } from "../actions";

export const dynamic = "force-dynamic";

export default async function Receita({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireFinanceiro(); const sp = await searchParams; const cfg = await getSettings(); const scope = scopeUnit(s); const unitId = scope ?? (sp.unidade ? Number(sp.unidade) : null); const ano = sp.ano ? Number(sp.ano) : cfg.matriculas.anoLetivo;
  const [rec, units, grades, precos] = await Promise.all([receita(ano, unitId), db.select().from(schema.units).orderBy(asc(schema.units.nome)), db.select().from(schema.grades).orderBy(asc(schema.grades.ordem)), sql<{ id: number; unidade: string; serie: string | null; modalidade: string; valor_mensal: number; parcelas: number }[]>`SELECT t.id, u.nome AS unidade, g.nome AS serie, t.modalidade, t.valor_mensal::float, t.parcelas FROM tuition_prices t JOIN units u ON u.id=t.unit_id LEFT JOIN grades g ON g.id=t.grade_id WHERE t.ano=${ano} ${unitId === null ? sql`` : sql`AND t.unit_id=${unitId}`} ORDER BY u.nome, t.modalidade, g.ordem`]);
  const totalEmitido = rec.real.reduce((a, r) => a + r.emitido, 0), totalRecebido = rec.real.reduce((a, r) => a + r.recebido, 0);
  return (
    <Page title={`Receita ${ano}`} sub="Previsto = matriculados confirmados × valor da série (menos descontos aprovados). Realizado = títulos emitidos e recebidos importados do ActiveSoft, por competência." actions={<Btn kind="ghost" href="/financeiro">Painel</Btn>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <form className="mb-4 flex flex-wrap items-end gap-2">{!scope && <Field label="Unidade"><Select name="unidade" defaultValue={unitId ?? ""}><option value="">Rede</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>}<Field label="Ano"><Input name="ano" type="number" defaultValue={ano} className="w-28" /></Field><Btn kind="ghost">Ver</Btn></form>
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4"><Stat label="Matriculados confirmados" value={rec.alunos} hint={rec.semPreco ? `${rec.semPreco} sem preço cadastrado` : "todos com preço"} /><Stat label="Receita prevista/mês" value={brl(rec.mensal)} /><Stat label="Receita prevista/ano" value={brl(rec.anual)} hint="após descontos aprovados" /><Stat label="Emitido × recebido (importado)" value={totalEmitido ? `${Math.round(100 * totalRecebido / totalEmitido)}%` : "—"} hint={totalEmitido ? `${brl(totalRecebido)} de ${brl(totalEmitido)}` : "importe os títulos"} /></div>
      <div className="grid gap-4 lg:grid-cols-[1fr_340px] lg:items-start">
        <div className="space-y-4">
          <Card title="Previsto por unidade, modalidade e série"><Table head={["Unidade", "Modalidade", "Série", "Alunos", "Valor", "Desc. médio", "Previsto/mês", "Previsto/ano"]} empty="Nenhum matriculado confirmado neste ano.">{rec.linhas.map((l, i) => <tr key={i}><Td>{l.unidade}</Td><Td className="text-xs">{l.modalidade === "REGULAR" ? "Regular" : "Integral"}</Td><Td>{l.serie ?? "—"}</Td><Td>{l.alunos}</Td><Td className={`tabular-nums ${l.valor === null ? "text-aviso" : ""}`}>{l.valor === null ? "sem preço" : brl(l.valor)}</Td><Td>{l.desconto_pct ? `${l.desconto_pct.toFixed(1)}%` : "—"}</Td><Td className="tabular-nums">{brl(l.mensal)}</Td><Td className="tabular-nums">{brl(l.anual)}</Td></tr>)}</Table></Card>
          <Card title="Realizado por competência (títulos importados)"><Table head={["Competência", "Emitido", "Recebido", "% recebido", "Vencido em aberto"]} empty="Nenhum título importado para este ano.">{rec.real.map(r => <tr key={r.competencia}><Td>{r.competencia.split("-").reverse().join("/")}</Td><Td className="tabular-nums">{brl(r.emitido)}</Td><Td className="tabular-nums">{brl(r.recebido)}</Td><Td>{r.emitido ? `${Math.round(100 * r.recebido / r.emitido)}%` : "—"}</Td><Td className={`tabular-nums ${r.inadimplente ? "text-erro" : ""}`}>{brl(r.inadimplente)}</Td></tr>)}</Table></Card>
          {rec.descontos.length > 0 && <Card title="Descontos aprovados no ano"><Table head={["Tipo", "Quantidade", "% médio"]}>{rec.descontos.map(d => <tr key={d.tipo}><Td>{d.tipo}</Td><Td>{d.n}</Td><Td>{d.pct_medio.toFixed(1)}%</Td></tr>)}</Table></Card>}
        </div>
        <div className="space-y-4">
          <Card title={`Valores de mensalidade ${ano}`}><Table head={["Unidade", "Modalidade", "Série", "Mensal", "Parc."]} empty="Nenhum valor cadastrado.">{precos.map(p => <tr key={p.id}><Td className="text-xs">{p.unidade}</Td><Td className="text-xs">{p.modalidade === "REGULAR" ? "Regular" : "Integral"}</Td><Td className="text-xs">{p.serie ?? "grupo integral"}</Td><Td className="tabular-nums">{brl(p.valor_mensal)}</Td><Td>{p.parcelas}</Td></tr>)}</Table></Card>
          {can.financeiro(s) && <Card title="Cadastrar valor"><form action={salvarPreco} className="space-y-2"><input type="hidden" name="ano" value={ano} /><Field label="Unidade"><Select name="unitId" required><option value="">Escolha</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field><div className="grid grid-cols-2 gap-2"><Field label="Modalidade"><Select name="modalidade" defaultValue="REGULAR"><option value="REGULAR">Regular</option><option value="INTEGRAL">Integral</option></Select></Field><Field label="Série"><Select name="gradeId" defaultValue=""><option value="">— (Integral)</option>{grades.map(g => <option key={g.id} value={g.id}>{g.nome}</option>)}</Select></Field></div><div className="grid grid-cols-2 gap-2"><Field label="Valor mensal (R$)"><Input name="valorMensal" type="number" step="0.01" required /></Field><Field label="Parcelas/ano"><Input name="parcelas" type="number" defaultValue={12} /></Field></div><label className="flex items-center gap-2 text-xs"><input type="checkbox" name="todasSeries" value="1" /> Aplicar a todas as séries desta unidade (Regular)</label><Btn small>Salvar</Btn></form></Card>}
        </div>
      </div>
    </Page>
  );
}
