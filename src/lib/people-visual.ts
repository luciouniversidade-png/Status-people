import { sql } from "@/db";
import { hoje } from "./utils";
import { garantirKpis, lerSeries } from "./kpi";
import { ultimosPeriodos } from "./gestao-calc";

/**
 * People Analytics visual (v23): séries de 24 meses da base de indicadores e distribuições do quadro ativo.
 * Tudo agregado: nenhuma faixa com menos de 3 pessoas mostra salário (anonimato), e salários só para quem já os vê.
 */
export async function peopleVisual(unitId: number | null, verSalario: boolean) {
  await garantirKpis().catch(() => null);
  const h = hoje(); const meses = ultimosPeriodos(h.slice(0, 7), 24); const u = unitId ?? 0;
  const chaves = ["pessoas.quadro", "pessoas.admissoes", "pessoas.desligamentos", "pessoas.turnover", "pessoas.absenteismo", "pessoas.horas_extras", "pessoas.cobertura_aulas"];
  const series = await lerSeries(chaves, [u], meses[0], meses[meses.length - 1]);
  const serie = (k: string) => meses.map(p => series.get(`${k}|${u}`)?.get(p)?.valor ?? null);
  const uf = unitId === null ? sql`` : sql`AND e.unit_id=${unitId}`;
  const [semana, porUnidadeAbs, tempoCasa, idade, vinculo, regime, porUnidade, cargos, salarios, alunosProf] = await Promise.all([
    sql<{ dia: number; faltas: number; esperados: number }[]>`SELECT extract(isodow FROM t.data)::int AS dia, count(*) FILTER (WHERE t.status='FALTA')::int AS faltas, count(*) FILTER (WHERE t.esperado_min > 0)::int AS esperados FROM timesheet_days t JOIN employees e ON e.id=t.employee_id WHERE t.data >= ${h}::date - 90 AND t.data <= ${h}::date ${uf} GROUP BY 1 ORDER BY 1`,
    unitId === null ? sql<{ nome: string; faltas: number; esperados: number }[]>`SELECT un.nome, count(*) FILTER (WHERE t.status='FALTA')::int AS faltas, count(*) FILTER (WHERE t.esperado_min > 0)::int AS esperados FROM timesheet_days t JOIN employees e ON e.id=t.employee_id JOIN units un ON un.id=e.unit_id WHERE t.data >= ${h}::date - 90 GROUP BY un.nome ORDER BY un.nome` : Promise.resolve([]),
    sql<{ faixa: string; n: number }[]>`SELECT CASE WHEN age(${h}::date, e.admissao) < interval '1 year' THEN '1' WHEN age(${h}::date, e.admissao) < interval '3 years' THEN '2' WHEN age(${h}::date, e.admissao) < interval '5 years' THEN '3' WHEN age(${h}::date, e.admissao) < interval '10 years' THEN '4' ELSE '5' END AS faixa, count(*)::int AS n FROM employees e WHERE e.situacao='ATIVO' ${uf} GROUP BY 1 ORDER BY 1`,
    sql<{ faixa: string; n: number }[]>`SELECT CASE WHEN e.data_nascimento IS NULL THEN '0' WHEN age(${h}::date, e.data_nascimento) < interval '25 years' THEN '1' WHEN age(${h}::date, e.data_nascimento) < interval '35 years' THEN '2' WHEN age(${h}::date, e.data_nascimento) < interval '45 years' THEN '3' WHEN age(${h}::date, e.data_nascimento) < interval '55 years' THEN '4' ELSE '5' END AS faixa, count(*)::int AS n FROM employees e WHERE e.situacao='ATIVO' ${uf} GROUP BY 1 ORDER BY 1`,
    sql<{ v: string; n: number }[]>`SELECT e.vinculo AS v, count(*)::int AS n FROM employees e WHERE e.situacao='ATIVO' ${uf} GROUP BY 1 ORDER BY 2 DESC`,
    sql<{ v: string; n: number }[]>`SELECT e.regime AS v, count(*)::int AS n FROM employees e WHERE e.situacao='ATIVO' ${uf} GROUP BY 1 ORDER BY 2 DESC`,
    unitId === null ? sql<{ id: number; nome: string; n: number }[]>`SELECT un.id, un.nome, count(e.id)::int AS n FROM units un LEFT JOIN employees e ON e.unit_id=un.id AND e.situacao='ATIVO' GROUP BY un.id, un.nome ORDER BY un.nome` : Promise.resolve([]),
    sql<{ cargo: string; n: number }[]>`SELECT coalesce(p.nome, '(sem cargo)') AS cargo, count(*)::int AS n FROM employees e LEFT JOIN positions p ON p.id=e.position_id WHERE e.situacao='ATIVO' ${uf} GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
    verSalario ? sql<{ faixa: string; n: number }[]>`SELECT CASE WHEN e.salario < 2500 THEN '1' WHEN e.salario < 4000 THEN '2' WHEN e.salario < 6000 THEN '3' WHEN e.salario < 8000 THEN '4' ELSE '5' END AS faixa, count(*)::int AS n FROM employees e WHERE e.situacao='ATIVO' AND e.salario IS NOT NULL ${uf} GROUP BY 1 ORDER BY 1` : Promise.resolve([]),
    sql<{ nome: string; alunos: number; professores: number }[]>`SELECT un.nome, (SELECT count(*) FROM students st WHERE st.aluno_atual AND st.unit_atual_id=un.id)::int AS alunos, (SELECT count(*) FROM employees e WHERE e.situacao='ATIVO' AND e.regime='DOCENTE' AND e.unit_id=un.id)::int AS professores FROM units un ${unitId === null ? sql`` : sql`WHERE un.id=${unitId}`} ORDER BY un.nome`,
  ]);
  const faixas = (rotulos: string[], rows: { faixa: string; n: number }[]) => rotulos.map((r, i) => ({ rotulo: r, n: rows.find(x => x.faixa === String(i + 1))?.n ?? 0 }));
  return {
    meses, quadro: serie("pessoas.quadro"), admissoes: serie("pessoas.admissoes"), desligamentos: serie("pessoas.desligamentos"), turnover: serie("pessoas.turnover"), absenteismo: serie("pessoas.absenteismo"), horasExtras: serie("pessoas.horas_extras"), cobertura: serie("pessoas.cobertura_aulas"),
    semana: [1, 2, 3, 4, 5].map(d => { const x = semana.find(s => s.dia === d); return { dia: ["seg", "ter", "qua", "qui", "sex"][d - 1], pct: x && x.esperados ? (100 * x.faltas) / x.esperados : null, faltas: x?.faltas ?? 0 }; }),
    porUnidadeAbs: porUnidadeAbs.map(x => ({ nome: x.nome, pct: x.esperados ? (100 * x.faltas) / x.esperados : null })),
    tempoCasa: faixas(["< 1 ano", "1 a 3", "3 a 5", "5 a 10", "10+ anos"], tempoCasa),
    idade: faixas(["até 24", "25 a 34", "35 a 44", "45 a 54", "55+"], idade), semNascimento: idade.find(x => x.faixa === "0")?.n ?? 0,
    vinculo, regime, porUnidade, cargos,
    // faixa salarial com menos de 3 pessoas não aparece (evita identificar o salário de alguém)
    salarios: verSalario ? faixas(["até R$ 2,5 mil", "2,5 a 4 mil", "4 a 6 mil", "6 a 8 mil", "8 mil+"], salarios).map(f => ({ ...f, n: f.n > 0 && f.n < 3 ? null : f.n })) : null,
    alunosProf: alunosProf.map(x => ({ ...x, razao: x.professores ? x.alunos / x.professores : null })),
  };
}
