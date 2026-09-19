import { requireFinanceiro, scopeUnit, can } from "@/lib/auth";
import { db, schema } from "@/db";
import { asc } from "drizzle-orm";
import { Page, Card, Table, Td, Flash, Field, Select, Btn, Input, Stat, Textarea } from "@/components/ui";
import { fmtData, getSettings, hoje } from "@/lib/utils";
import { caixaMes, brl } from "@/lib/financeiro";
import { importarCaixa, salvarSaldoInicial, lancarCaixa } from "../actions";

export const dynamic = "force-dynamic";

export default async function Caixa({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireFinanceiro(); const sp = await searchParams; const cfg = await getSettings(); const scope = scopeUnit(s); const unitId = scope ?? (sp.unidade ? Number(sp.unidade) : null); const mes = sp.mes && /^\d{4}-\d{2}$/.test(sp.mes) ? sp.mes : hoje().slice(0, 7);
  const [cx, units] = await Promise.all([caixaMes(mes, unitId), db.select().from(schema.units).orderBy(asc(schema.units.nome))]);
  const gest = can.financeiro(s);
  return (
    <Page title="Fluxo de caixa" sub="As quatro unidades no mesmo painel: entradas por forma, saídas por categoria, transferências internas, saldo inicial e final. Importado dos extratos ou lançado à mão." actions={<><Btn kind="ghost" href={`/api/export/caixa?mes=${mes}`}>Exportar CSV</Btn><Btn kind="ghost" href="/financeiro">Painel</Btn></>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <form className="mb-4 flex flex-wrap items-end gap-2">{!scope && <Field label="Unidade"><Select name="unidade" defaultValue={unitId ?? ""}><option value="">Consolidado</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>}<Field label="Mês"><Input type="month" name="mes" defaultValue={mes} /></Field><Btn kind="ghost">Ver</Btn></form>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5"><Stat label="Saldo inicial" value={cx.saldoInicial === null ? "—" : brl(cx.saldoInicial)} hint={cx.temSaldo ? undefined : "não informado"} /><Stat label="Entradas" value={<span className="text-ok">{brl(cx.tot.entradas)}</span>} /><Stat label="Saídas" value={<span className="text-erro">{brl(cx.tot.saidas)}</span>} /><Stat label="Transferências internas" value={brl(cx.tot.transf)} hint="não entram no resultado" /><Stat label="Saldo final" value={cx.saldoFinal === null ? brl(cx.tot.entradas - cx.tot.saidas) : <span className={cx.saldoFinal < 0 ? "text-erro" : ""}>{brl(cx.saldoFinal)}</span>} hint={cx.saldoFinal === null ? "movimento do mês (sem saldo inicial)" : undefined} /></div>
      <div className="grid gap-4 lg:grid-cols-[1fr_340px] lg:items-start">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Card title="Entradas por categoria"><Table head={["Categoria", "Lanç.", "Valor"]} empty="Sem entradas.">{cx.porCat.filter(c => c.tipo === "ENTRADA").map(c => <tr key={c.categoria}><Td>{c.categoria}</Td><Td>{c.n}</Td><Td className="tabular-nums">{brl(c.valor)}</Td></tr>)}</Table><div className="mt-2 text-xs text-slate-500">Por forma: {cx.porForma.map(f => `${f.forma} ${brl(f.valor)}`).join(" · ") || "—"}</div></Card>
            <Card title="Saídas por categoria"><Table head={["Categoria", "Lanç.", "Valor"]} empty="Sem saídas.">{cx.porCat.filter(c => c.tipo === "SAIDA").map(c => <tr key={c.categoria}><Td>{c.categoria}</Td><Td>{c.n}</Td><Td className="tabular-nums">{brl(c.valor)}</Td></tr>)}</Table></Card>
          </div>
          <Card title="Dia a dia"><Table head={["Data", "Entradas", "Saídas", "Saldo do dia"]} empty="Nenhum lançamento no mês.">{cx.dias.map(d => <tr key={d.data}><Td>{fmtData(d.data)}</Td><Td className="tabular-nums text-ok">{d.entradas ? brl(d.entradas) : "—"}</Td><Td className="tabular-nums text-erro">{d.saidas ? brl(d.saidas) : "—"}</Td><Td className={`tabular-nums ${d.entradas - d.saidas < 0 ? "text-erro" : ""}`}>{brl(d.entradas - d.saidas)}</Td></tr>)}</Table></Card>
        </div>
        {gest && <div className="space-y-4">
          <Card title="Importar extrato / lançamentos (CSV)"><form action={importarCaixa} className="space-y-2"><Field label="Unidade padrão (se o CSV não tiver)"><Select name="unitId" defaultValue=""><option value="">—</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field><Field label="data;tipo;categoria;forma;descricao;valor;unidade" hint="tipo: entrada/saída/transferência (ou valor negativo = saída). Repetidos são ignorados."><Textarea name="csv" className="min-h-[120px] font-mono text-xs" placeholder={"data;tipo;categoria;forma;descricao;valor;unidade\n05/09/2026;entrada;Mensalidades;PIX;PIX recebido;1850,00;Carandá\n06/09/2026;saida;Serviços e terceiros;TRANSFERENCIA;Limpeza;2.300,00;Carandá"} required /></Field><Btn small>Importar</Btn></form></Card>
          <Card title="Lançamento manual"><form action={lancarCaixa} className="space-y-2"><div className="grid grid-cols-2 gap-2"><Field label="Unidade"><Select name="unitId" required><option value="">Escolha</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field><Field label="Data"><Input name="data" type="date" defaultValue={hoje()} required /></Field></div><div className="grid grid-cols-2 gap-2"><Field label="Tipo"><Select name="tipo" defaultValue="SAIDA"><option value="ENTRADA">Entrada</option><option value="SAIDA">Saída</option><option value="TRANSFERENCIA">Transferência interna</option></Select></Field><Field label="Categoria"><Select name="categoria">{[...cfg.financeiro.categoriasEntrada, ...cfg.financeiro.categoriasSaida, "Transferência interna"].map(c => <option key={c}>{c}</option>)}</Select></Field></div><div className="grid grid-cols-2 gap-2"><Field label="Valor (R$)"><Input name="valor" type="number" step="0.01" required /></Field><Field label="Forma"><Select name="forma" defaultValue="PIX"><option>PIX</option><option>CARTAO</option><option>BOLETO</option><option>DINHEIRO</option><option>TRANSFERENCIA</option><option>OUTRO</option></Select></Field></div><Field label="Descrição"><Input name="descricao" /></Field><Btn small kind="ghost">Lançar</Btn></form></Card>
          <Card title="Saldo inicial do mês"><form action={salvarSaldoInicial} className="space-y-2"><input type="hidden" name="mes" value={mes} /><Field label="Unidade"><Select name="unitId" required><option value="">Escolha</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field><Field label={`Saldo em 01/${mes.split("-").reverse().join("/")} (R$)`}><Input name="saldoInicial" type="number" step="0.01" required /></Field><Btn small kind="ghost">Salvar saldo</Btn></form></Card>
        </div>}
      </div>
    </Page>
  );
}
