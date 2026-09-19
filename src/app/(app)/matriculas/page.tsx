import Link from "next/link";
import { requireMatriculas, scopeUnit, can } from "@/lib/auth";
import { db, schema, sql } from "@/db";
import { asc } from "drizzle-orm";
import { Page, Card, Stat, Table, Td, Badge, Flash, Select, Field, Btn } from "@/components/ui";
import { fmtData, hoje, addDays, getSettings } from "@/lib/utils";
import { ocupacao, processarVencimentos } from "@/lib/matriculas";

export const dynamic = "force-dynamic";

export default async function Painel({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireMatriculas(); const sp = await searchParams; const cfg = await getSettings();
  await processarVencimentos();
  const scope = scopeUnit(s); const unitId = scope ?? (sp.unidade ? Number(sp.unidade) : null); const mod = sp.modalidade ?? "REGULAR"; const ano = cfg.matriculas.anoLetivo;
  const rows = await ocupacao(ano, unitId, mod === "TODAS" ? undefined : mod);
  const units = scope ? [] : await db.select().from(schema.units).orderBy(asc(schema.units.nome));
  const h = hoje(), am = addDays(h, 1);
  const uf = unitId === null ? sql`` : sql`AND c.unit_id=${unitId}`;
  const [vencendo, [fila]] = await Promise.all([
    sql<{ id: number; aluno: string; turma: string; unidade: string; reserva_ate: string }[]>`SELECT e.id, st.nome AS aluno, c.nome AS turma, u.nome AS unidade, e.reserva_ate::text FROM enrollments e JOIN students st ON st.id=e.student_id JOIN classes c ON c.id=e.class_id JOIN units u ON u.id=c.unit_id WHERE e.status='RESERVADA' AND e.reserva_ate <= ${am} AND c.ano=${ano} ${uf} ORDER BY e.reserva_ate, st.nome LIMIT 20`,
    sql<{ n: number }[]>`SELECT count(*)::int AS n FROM waitlist w JOIN units u ON u.id=w.unit_id WHERE w.ano=${ano} AND w.status IN ('AGUARDANDO','OFERTADA') ${unitId === null ? sql`` : sql`AND w.unit_id=${unitId}`}`,
  ]);
  const tot = rows.reduce((a, r) => ({ vagas: a.vagas + r.vagas, conf: a.conf + r.confirmadas, res: a.res + r.reservadas, livres: a.livres + Math.max(r.livres, 0) }), { vagas: 0, conf: 0, res: 0, livres: 0 });
  const comFilaEVaga = rows.filter(r => r.fila > 0 && r.livres > 0);
  // agrupar por unidade → série
  const grupos = new Map<string, typeof rows>();
  for (const r of rows) { const k = `${r.unidade}|||${r.serie ?? r.series_texto ?? "Integral"}`; grupos.set(k, [...(grupos.get(k) ?? []), r]); }
  const pct = (a: number, b: number) => (b ? Math.round(100 * a / b) : 0);

  return (
    <Page title={`Painel de vagas ${ano}`} sub={`${rows.length} turmas · ocupação = matriculados + reservas ativas`}
      actions={<><Btn kind="ghost" href={`/api/export/ocupacao?ano=${ano}`}>Exportar CSV</Btn>{can.reservar(s) && <Btn href="/matriculas/alunos/novo">Novo aluno / candidato</Btn>}</>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <form className="mb-4 flex flex-wrap items-end gap-2 rounded-md border border-line bg-white p-3">
        {!scope && <Field label="Unidade"><Select name="unidade" defaultValue={unitId ?? ""}><option value="">Todas</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>}
        <Field label="Modalidade"><Select name="modalidade" defaultValue={mod}><option value="REGULAR">Regular</option><option value="INTEGRAL">Integral</option><option value="TODAS">Todas</option></Select></Field>
        <Btn kind="ghost">Filtrar</Btn>
      </form>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <Stat label="Vagas ofertadas" value={tot.vagas} />
        <Stat label="Matriculados" value={<span className="text-ok">{tot.conf}</span>} hint={`${pct(tot.conf, tot.vagas)}% das vagas`} />
        <Stat label="Reservas ativas" value={<span className="text-aviso">{tot.res}</span>} href="/matriculas/reservas" />
        <Stat label="Vagas livres" value={tot.livres} />
        <Stat label="Lista de espera" value={fila.n} href="/matriculas/fila" />
      </div>
      {(vencendo.length > 0 || comFilaEVaga.length > 0) && (
        <div className="mb-4 grid gap-4 lg:grid-cols-2">
          {vencendo.length > 0 && <Card title="Reservas vencendo hoje ou amanhã" className="border-amber-200">
            <Table head={["Aluno", "Turma", "Unidade", "Vence em"]}>{vencendo.map(v => <tr key={v.id}><Td><Link className="text-acao" href="/matriculas/reservas">{v.aluno}</Link></Td><Td>{v.turma}</Td><Td>{v.unidade}</Td><Td className={v.reserva_ate <= h ? "font-medium text-erro" : "text-aviso"}>{fmtData(v.reserva_ate)}</Td></tr>)}</Table>
          </Card>}
          {comFilaEVaga.length > 0 && <Card title="Fila com vaga disponível — ofertar" className="border-sky-200">
            <Table head={["Turma", "Unidade", "Livres", "Na fila"]}>{comFilaEVaga.map(r => <tr key={r.class_id}><Td><Link className="text-acao" href={`/matriculas/fila?unidade=${r.unit_id}&serie=${r.grade_id ?? ""}`}>{r.nome}</Link></Td><Td>{r.unidade}</Td><Td>{r.livres}</Td><Td>{r.fila}</Td></tr>)}</Table>
          </Card>}
        </div>
      )}
      {[...grupos.entries()].length === 0 ? <Card><p className="text-sm text-slate-600">Nenhuma turma cadastrada para {ano}. Cadastre em <Link className="text-acao" href="/matriculas/turmas">Turmas</Link>.</p></Card> :
        [...grupos.entries()].map(([k, turmas]) => {
          const [unidade, serie] = k.split("|||"); const tv = turmas.reduce((a, t) => a + t.vagas, 0), tc = turmas.reduce((a, t) => a + t.confirmadas, 0), tr = turmas.reduce((a, t) => a + t.reservadas, 0);
          return (
            <Card key={k} title={<span>{unidade} · {serie} <span className="ml-2 font-normal text-slate-500">{tc + tr}/{tv} · {pct(tc + tr, tv)}%</span></span>} className="mb-3">
              <Table head={["Turma", "Turno", "Vagas", "Matriculados", "Reservas", "Livres", "Fila", "Ocupação", ""]}>
                {turmas.map(t => <tr key={t.class_id} className={t.status === "FECHADA" ? "opacity-60" : ""}>
                  <Td><Link className="font-medium text-acao" href={`/matriculas/turmas/${t.class_id}`}>{t.nome}</Link>{t.status === "FECHADA" && <Badge v="DESLIGADO" label="fechada" />}</Td><Td>{t.turno}</Td><Td>{t.vagas}</Td><Td className="text-ok">{t.confirmadas}</Td><Td className="text-aviso">{t.reservadas}</Td>
                  <Td className={t.livres <= 0 ? "font-medium text-erro" : "font-medium"}>{t.livres <= 0 ? "lotada" : t.livres}</Td><Td>{t.fila || "—"}</Td>
                  <Td><div className="h-2 w-28 overflow-hidden rounded bg-mist"><div className="flex h-2"><div className="bg-ok" style={{ width: `${pct(t.confirmadas, t.vagas)}%` }} /><div className="bg-aviso" style={{ width: `${pct(t.reservadas, t.vagas)}%` }} /></div></div></Td>
                  <Td>{can.reservar(s) && t.status === "ABERTA" && <Link className="text-xs text-acao" href={`/matriculas/turmas/${t.class_id}#reservar`}>reservar</Link>}</Td>
                </tr>)}
              </Table>
            </Card>
          );
        })}
    </Page>
  );
}
