import { scopeUnit } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Table, Td, Field, Btn, Input, Select, Stat } from "@/components/ui";
import { hoje, addDays } from "@/lib/utils";
import { historico } from "@/lib/cobertura";
import { requireCobertura, SubNavCobertura } from "../_ui";

export const dynamic = "force-dynamic";
const hm = (m: number) => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;

export default async function HistoricoCobertura({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireCobertura(); const sp = await searchParams; const h = hoje(); const escopo = scopeUnit(s); const unidade = escopo ?? (sp.unidade ? Number(sp.unidade) : null);
  const ini = sp.ini && /^\d{4}-\d{2}-\d{2}$/.test(sp.ini) ? sp.ini : addDays(h, -30); const fim = sp.fim && /^\d{4}-\d{2}-\d{2}$/.test(sp.fim) ? sp.fim : h;
  const [r, units] = await Promise.all([historico(ini, fim, unidade), sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ORDER BY nome`]);
  const tot = r.porUnidade.reduce((a, x) => ({ total: a.total + x.total, cobertas: a.cobertas + x.cobertas, sem: a.sem + x.sem_professor, abertas: a.abertas + x.abertas }), { total: 0, cobertas: 0, sem: 0, abertas: 0 });
  const pct = (a: number, b: number) => (b ? `${Math.round(100 * a / b)}%` : "—");
  return (
    <Page title="Histórico de substituições" sub="Quem mais cobriu (para reconhecer e equilibrar), quem mais faltou (para acompanhar) e a taxa de cobertura por unidade." actions={<Btn kind="ghost" href={`/api/export/coberturas?ini=${ini}&fim=${fim}${unidade ? `&unidade=${unidade}` : ""}`}>Exportar CSV</Btn>}>
      <SubNavCobertura ativo="/cobertura/historico" s={s} />
      <form className="mb-4 grid grid-cols-2 items-end gap-2 rounded-md border border-line bg-white p-3 sm:flex sm:flex-wrap">
        <Field label="De"><Input name="ini" type="date" defaultValue={ini} /></Field><Field label="Até"><Input name="fim" type="date" defaultValue={fim} /></Field>
        {!escopo && <Field label="Unidade"><Select name="unidade" defaultValue={unidade ?? ""}><option value="">Todas</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>}
        <Btn kind="ghost">Ver</Btn>
      </form>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Aulas a cobrir" value={tot.total} /><Stat label="Cobertas por professor" value={<span className="text-ok">{pct(tot.cobertas, tot.total)}</span>} hint={`${tot.cobertas} aula(s)`} /><Stat label="Com solução sem professor" value={pct(tot.sem, tot.total)} hint={`${tot.sem} aula(s)`} /><Stat label="Ficaram sem solução" value={<span className={tot.abertas ? "text-erro" : ""}>{tot.abertas}</span>} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
        <Card title="Quem mais cobriu"><Table head={["Professor(a)", "Aulas", "Tempo", "Realizadas"]} empty="Nenhuma cobertura no período.">{r.cobriram.map(x => <tr key={x.id}><Td>{x.nome}</Td><Td>{x.aulas}</Td><Td>{hm(x.minutos)}</Td><Td>{x.realizadas}</Td></tr>)}</Table></Card>
        <Card title="Ausências"><Table head={["Professor(a)", "Dias", "Aulas", "Sem cobertura"]} empty="Nenhuma ausência no período.">{r.faltaram.map(x => <tr key={x.id}><Td>{x.nome}</Td><Td>{x.dias}</Td><Td>{x.aulas}</Td><Td className={x.descobertas ? "text-aviso" : ""}>{x.descobertas}</Td></tr>)}</Table></Card>
        <Card title="Por unidade" className="lg:col-span-2"><Table head={["Unidade", "Aulas", "Cobertas", "Sem professor", "Sem solução", "Taxa de cobertura"]}>{r.porUnidade.map(x => <tr key={x.unidade}><Td>{x.unidade}</Td><Td>{x.total}</Td><Td>{x.cobertas}</Td><Td>{x.sem_professor}</Td><Td>{x.abertas}</Td><Td>{pct(x.cobertas, x.total)}</Td></tr>)}</Table></Card>
      </div>
    </Page>
  );
}
