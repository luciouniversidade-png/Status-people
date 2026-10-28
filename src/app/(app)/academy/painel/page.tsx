import Link from "@/components/Link";
import { requireStaff, scopeUnit } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Table, Td, Select, Btn } from "@/components/ui";
import { KpiCard, Colunas, BarrasH, COR, corSerie } from "@/components/graficos";
import { hoje, addMonths, getSettings, fmtMoeda } from "@/lib/utils";
import { rotuloMes } from "@/lib/formato";
import { matrizTreinamento, COURSE_FORMATO } from "@/lib/clima-academy";

export const dynamic = "force-dynamic";
const n1 = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(1).replace(".", ","));
const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/**
 * v30 · Painel de aprendizagem (no estilo dos painéis de LMS): obrigatórios atribuídos × concluídos × vencidos, horas por pessoa e por unidade,
 * investimento (turmas + custo por participante), os treinamentos mais concluídos e os mais bem avaliados (com o mínimo de avaliações)
 * e o tempo entre início e conclusão. A aprovação de inscrições fica em /academy/aprovar.
 */
export default async function PainelAcademy({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaff(); const sp = await searchParams; const cfg = await getSettings(); const h = hoje(); const escopo = scopeUnit(s);
  const units = await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ORDER BY nome`;
  const u = escopo ?? (sp.u ? Number(sp.u) : null); const meses = [3, 6, 12, 24].includes(Number(sp.meses)) ? Number(sp.meses) : 12;
  const de = addMonths(h.slice(0, 7) + "-01", -(meses - 1)); const minimo = Math.max(1, Number(cfg.academy.reacaoMinima) || 3);
  const fU = u === null ? sql`` : sql`AND e.unit_id=${u}`;
  const [m, concl, mensal, porUnidade, ativos, turmas, reacao, comentarios, insc, tempo] = await Promise.all([
    matrizTreinamento(u),
    sql<{ id: number; codigo: string; titulo: string; formato: string; n: number; horas: number; custo: number | null }[]>`SELECT c.id, c.codigo, c.titulo, c.formato, count(*)::int AS n, (count(*) * coalesce(c.carga_horas,0))::float AS horas, c.custo::float AS custo
      FROM training_progress p JOIN courses c ON c.id=p.course_id JOIN employees e ON e.id=p.employee_id WHERE p.status='CONCLUIDO' AND p.concluido_em >= ${de}::date AND c.formato <> 'POP' ${fU} GROUP BY c.id ORDER BY n DESC, c.codigo`,
    sql<{ mes: string; horas: number; n: number }[]>`SELECT to_char(p.concluido_em, 'YYYY-MM') AS mes, sum(coalesce(c.carga_horas,0))::float AS horas, count(*)::int AS n FROM training_progress p JOIN courses c ON c.id=p.course_id JOIN employees e ON e.id=p.employee_id
      WHERE p.status='CONCLUIDO' AND p.concluido_em >= ${de}::date AND c.formato <> 'POP' ${fU} GROUP BY 1 ORDER BY 1`,
    sql<{ unidade: string; horas: number; pessoas: number; ativos: number }[]>`SELECT un.nome AS unidade, coalesce(sum(c.carga_horas) FILTER (WHERE p.id IS NOT NULL),0)::float AS horas, count(DISTINCT p.employee_id)::int AS pessoas, (SELECT count(*) FROM employees x WHERE x.unit_id=un.id AND x.situacao='ATIVO')::int AS ativos
      FROM units un LEFT JOIN employees e ON e.unit_id=un.id LEFT JOIN training_progress p ON p.employee_id=e.id AND p.status='CONCLUIDO' AND p.concluido_em >= ${de}::date LEFT JOIN courses c ON c.id=p.course_id AND c.formato <> 'POP'
      WHERE true ${u === null ? sql`` : sql`AND un.id=${u}`} GROUP BY un.id ORDER BY un.nome`,
    sql<{ id: number; horas: number }[]>`SELECT e.id, coalesce((SELECT sum(c.carga_horas) FROM training_progress p JOIN courses c ON c.id=p.course_id WHERE p.employee_id=e.id AND p.status='CONCLUIDO' AND p.concluido_em >= ${de}::date AND c.formato <> 'POP'),0)::float AS horas FROM employees e WHERE e.situacao='ATIVO' ${fU}`,
    sql<{ course_id: number; custo: number; n: number }[]>`SELECT t.course_id, sum(coalesce(t.custo,0))::float AS custo, count(*)::int AS n FROM training_sessions t WHERE t.data >= ${de}::date AND t.data <= ${h}::date ${u === null ? sql`` : sql`AND (t.unit_id IS NULL OR t.unit_id=${u})`} GROUP BY t.course_id`,
    sql<{ course_id: number; codigo: string; titulo: string; n: number; nota: number; aplicavel: number | null }[]>`SELECT f.course_id, c.codigo, c.titulo, count(*)::int AS n, avg(f.nota)::float AS nota, avg(f.aplicavel)::float AS aplicavel FROM training_feedback f JOIN courses c ON c.id=f.course_id JOIN employees e ON e.id=f.employee_id
      WHERE f.created_at >= ${de}::date ${fU} GROUP BY f.course_id, c.codigo, c.titulo ORDER BY avg(f.nota) DESC, count(*) DESC`,
    sql<{ course_id: number; comentario: string }[]>`SELECT f.course_id, f.comentario FROM training_feedback f JOIN employees e ON e.id=f.employee_id WHERE f.created_at >= ${de}::date AND length(coalesce(f.comentario,'')) > 3 ${fU} ORDER BY f.created_at DESC LIMIT 40`,
    sql<{ status: string; n: number }[]>`SELECT t.status, count(*)::int AS n FROM training_enrollments t JOIN employees e ON e.id=t.employee_id WHERE t.created_at >= ${de}::date ${fU} GROUP BY t.status`,
    sql<{ codigo: string; titulo: string; n: number; dias: number }[]>`SELECT c.codigo, c.titulo, count(*)::int AS n, avg(p.concluido_em - p.inicio_em)::float AS dias FROM training_progress p JOIN courses c ON c.id=p.course_id JOIN employees e ON e.id=p.employee_id
      WHERE p.status='CONCLUIDO' AND p.inicio_em IS NOT NULL AND p.concluido_em >= p.inicio_em AND p.concluido_em >= ${de}::date ${fU} GROUP BY c.id ORDER BY dias DESC LIMIT 10`,
  ]);
  const horasTot = concl.reduce((a, c) => a + c.horas, 0); const conclTot = concl.reduce((a, c) => a + c.n, 0);
  const porTurma = new Map(turmas.map(t => [t.course_id, t]));
  const invest = concl.map(c => ({ ...c, turmas: porTurma.get(c.id)?.custo ?? 0, participante: (c.custo ?? 0) * c.n })).map(c => ({ ...c, total: c.turmas + c.participante }));
  // turmas com custo de treinamentos sem conclusão no período também contam
  const semConcl = turmas.filter(t => !concl.some(c => c.id === t.course_id) && t.custo > 0); const investTot = invest.reduce((a, c) => a + c.total, 0) + semConcl.reduce((a, t) => a + t.custo, 0);
  const atribuidos = m.linhas.reduce((a, l) => a + l.total, 0), concluidosObrig = m.linhas.reduce((a, l) => a + l.ok, 0);
  const cats: string[] = []; for (let i = meses - 1; i >= 0; i--) cats.push(addMonths(h.slice(0, 7) + "-01", -i).slice(0, 7));
  const serieH = cats.map(c => mensal.find(x => x.mes === c)?.horas ?? 0);
  const faixas = [["sem treinamento", (x: number) => x === 0], ["até 4 h", (x: number) => x > 0 && x <= 4], ["4 a 8 h", (x: number) => x > 4 && x <= 8], ["8 a 20 h", (x: number) => x > 8 && x <= 20], ["mais de 20 h", (x: number) => x > 20]] as const;
  const avaliados = reacao.filter(r => r.n >= minimo); const notaGeral = reacao.length ? reacao.reduce((a, r) => a + r.nota * r.n, 0) / reacao.reduce((a, r) => a + r.n, 0) : null; const nReacao = reacao.reduce((a, r) => a + r.n, 0);
  const insc_ = (k: string) => insc.find(i => i.status === k)?.n ?? 0;
  const unidadeNome = u === null ? "Rede" : units.find(x => x.id === u)?.nome ?? "Unidade";
  return (
    <Page title="Painel de aprendizagem" sub={<>{unidadeNome} · últimos {meses} meses. Horas e investimento contam treinamentos concluídos (ciência de POP fica na matriz). <Link className="text-acao" href="/academy">Academy</Link> · <Link className="text-acao" href="/academy/matriz">Matriz</Link> · <Link className="text-acao" href="/academy/aprovar">Aprovar inscrições</Link></>}>
      <form className="mb-4 flex flex-wrap items-end gap-2">
        {escopo === null && <Select name="u" defaultValue={u ?? ""} aria-label="Unidade" className="w-auto"><option value="">Rede</option>{units.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select>}
        <Select name="meses" defaultValue={String(meses)} aria-label="Período" className="w-auto">{[3, 6, 12, 24].map(n => <option key={n} value={n}>últimos {n} meses</option>)}</Select>
        <Btn kind="ghost" small>Aplicar</Btn>
      </form>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard titulo="Obrigatórios em dia" valor={m.conformidade === null ? "—" : `${m.conformidade}%`} sub={`${concluidosObrig} de ${atribuidos} atribuídos`} tom={m.conformidade === null ? "neutro" : m.conformidade >= 90 ? "bom" : m.conformidade >= 70 ? "atencao" : "ruim"} href="/academy/matriz" />
        <KpiCard titulo="Vencidos" valor={String(m.vencidos)} sub={`${m.vencendo} vencendo em ${cfg.academy.alertaVencimentoDias} dias`} tom={m.vencidos ? "ruim" : "bom"} href="/academy/matriz" />
        <KpiCard titulo="Horas de treinamento" valor={Math.round(horasTot).toLocaleString("pt-BR")} sub={`${conclTot} conclusão(ões)`} serie={serieH} />
        <KpiCard titulo="Horas por colaborador" valor={ativos.length ? n1(horasTot / ativos.length) : "—"} sub={`${ativos.length} ativos · ${ativos.filter(a => a.horas === 0).length} sem treinamento`} />
        <KpiCard titulo="Investimento" valor={reais(investTot)} sub={horasTot ? `${reais(investTot / horasTot)} por hora · ${ativos.length ? reais(investTot / ativos.length) : "—"} por pessoa` : "turmas + custo por participante"} />
        <KpiCard titulo="Avaliação de reação" valor={notaGeral === null ? "—" : `${n1(notaGeral)}/5`} sub={`${nReacao} avaliação(ões)`} tom={notaGeral === null ? "neutro" : notaGeral >= 4 ? "bom" : notaGeral >= 3 ? "atencao" : "ruim"} />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Horas de treinamento por mês"><Colunas rotulo="Horas concluídas por mês" categorias={cats.map(c => rotuloMes(c))} series={[{ nome: "Horas", valores: serieH, cor: COR.acao }]} formato={v => `${Math.round(v)} h`} legenda={false} /></Card>
        <Card title="Horas por colaborador ativo — por unidade"><BarrasH rotulo="Horas médias por colaborador ativo" formato={v => `${n1(v)} h`} itens={porUnidade.map(x => ({ rotulo: x.unidade, valor: x.ativos ? x.horas / x.ativos : null, sub: `${Math.round(x.horas)} h · ${x.pessoas}/${x.ativos} treinadas` }))} /></Card>
        <Card title="Quantas horas cada pessoa fez"><BarrasH rotulo="Distribuição de horas por colaborador" formato={v => `${v} pessoa(s)`} itens={faixas.map(([r, f], i) => ({ rotulo: r, valor: ativos.filter(a => f(a.horas)).length, cor: i === 0 ? COR.aviso : corSerie(1) }))} />
          <p className="mt-1 text-[11px] text-slate-500">Quem não fez nenhum treinamento no período aparece em laranja — vale cruzar com a matriz e com o PDI.</p></Card>
        <Card title="Mais concluídos"><BarrasH rotulo="Treinamentos mais concluídos" formato={v => `${v}`} itens={concl.slice(0, 10).map(c => ({ rotulo: `${c.codigo} ${c.titulo}`, valor: c.n, href: `/academy/cursos/${c.id}`, sub: `${COURSE_FORMATO[c.formato] ?? c.formato} · ${Math.round(c.horas)} h` }))} largRotulo="12rem" /></Card>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title={`Mais bem avaliados (com ${minimo}+ avaliações)`}>
          <Table head={["Treinamento", "Avaliações", "Nota", "Vou usar no trabalho"]} empty={`Nenhum treinamento com ${minimo} avaliações ou mais no período.`}>{avaliados.slice(0, 10).map(r => <tr key={r.course_id}><Td><Link className="text-acao" href={`/academy/cursos/${r.course_id}`}>{r.codigo} {r.titulo}</Link></Td><Td className="tabular-nums">{r.n}</Td><Td className={`font-semibold tabular-nums ${r.nota >= 4 ? "text-ok" : r.nota >= 3 ? "text-aviso" : "text-erro"}`}>{n1(r.nota)}</Td><Td className="tabular-nums">{r.aplicavel === null ? "—" : `${n1(r.aplicavel)}/5`}</Td></tr>)}</Table>
          {reacao.length > avaliados.length && <p className="mt-1 text-[11px] text-slate-500">{reacao.length - avaliados.length} treinamento(s) com menos de {minimo} avaliações ficam fora do ranking (Configurações → Pessoas v30).</p>}
          {avaliados.length > 0 && comentarios.filter(c => avaliados.some(a => a.course_id === c.course_id)).length > 0 && <details className="mt-2 text-xs"><summary className="cursor-pointer text-acao">Comentários recentes (sem nome)</summary><ul className="mt-1 space-y-1 text-slate-600">{comentarios.filter(c => avaliados.some(a => a.course_id === c.course_id)).slice(0, 12).map((c, i) => <li key={i}>“{c.comentario}” <span className="text-slate-400">· {avaliados.find(a => a.course_id === c.course_id)?.codigo}</span></li>)}</ul></details>}
        </Card>
        <Card title="Investimento por treinamento">
          <Table head={["Treinamento", "Conclusões", "Turmas", "Por participante", "Total", "Por pessoa"]} empty="Nenhum custo registrado no período — informe o custo da turma e/ou o custo por participante no treinamento.">{invest.filter(c => c.total > 0).sort((a, b) => b.total - a.total).slice(0, 12).map(c => <tr key={c.id}><Td><Link className="text-acao" href={`/academy/cursos/${c.id}`}>{c.codigo} {c.titulo}</Link></Td><Td className="tabular-nums">{c.n}</Td><Td className="text-xs">{c.turmas ? fmtMoeda(c.turmas) : "—"}</Td><Td className="text-xs">{c.participante ? fmtMoeda(c.participante) : "—"}</Td><Td className="text-xs font-semibold">{fmtMoeda(c.total)}</Td><Td className="text-xs">{c.n ? fmtMoeda(c.total / c.n) : "—"}</Td></tr>)}</Table>
          {semConcl.length > 0 && <p className="mt-1 text-[11px] text-slate-500">Inclui {fmtMoeda(semConcl.reduce((a, t) => a + t.custo, 0))} de turmas sem conclusão registrada ainda.</p>}
        </Card>
        <Card title="Tempo entre início e conclusão">
          <Table head={["Treinamento", "Conclusões", "Dias em média"]} empty="Sem datas de início registradas.">{tempo.map(t => <tr key={t.codigo}><Td>{t.codigo} {t.titulo}</Td><Td className="tabular-nums">{t.n}</Td><Td className="tabular-nums">{Math.round(t.dias)}</Td></tr>)}</Table>
        </Card>
        <Card title="Inscrições no período">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-center">{([["Aguardando o gestor", "AGUARDANDO_APROVACAO", "text-aviso"], ["Aprovadas", "INSCRITO", "text-ok"], ["Não aprovadas", "RECUSADA", "text-erro"], ["Desistências", "DESISTIU", "text-slate-600"]] as const).map(([r, k, c]) => <div key={k} className="rounded-md border border-line p-2"><div className={`text-2xl font-semibold tabular-nums ${c}`}>{insc_(k)}</div><div className="text-[11px] text-slate-500">{r}</div></div>)}</div>
          <p className="mt-2 text-xs"><Link className="text-acao" href="/academy/aprovar">Abrir as inscrições para decidir</Link> · o colaborador se inscreve em Meus treinamentos → Inscrições abertas.</p>
        </Card>
      </div>
    </Page>
  );
}
