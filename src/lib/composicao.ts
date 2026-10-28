/**
 * v30 · Composição da equipe (no estilo dos painéis de Workforce Composition): o quadro mês a mês reconstruído pelo histórico
 * funcional (vínculo, unidade, cargo e gestor de cada data), indicadores com minigráfico, movimentações por tipo, ponte do quadro
 * por unidade, titulação do corpo docente e o quadro numa data qualquer. Tudo agregado; nenhuma lista nominal.
 */
import { sql } from "@/db";
import { getSettings, addDays } from "./utils";
import { estadoNaData, maiorTitulacao, TITULACAO_FAIXAS, temLicenciatura, MOV_TIPO } from "./pessoas-v30";
import { FAMILIAS } from "./avaliacao";

type Pessoa = { id: number; unitId: number; positionId: number | null; gestorId: number | null; vinculo: string; regime: string; nivel: string | null; jornadaMinDia: number | null; turno: string | null; companyId: number | null; admissao: string; desligamento: string | null; situacao: string; nascimento: string | null; sexo: string | null };
export const CONTINGENTE = new Set(["ESTAGIARIO", "TEMPORARIO", "PJ"]);
const DIA = 86400000;
const anosEntre = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / (365.25 * DIA);
const fimDoMes = (ym: string) => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const mesesAte = (h: string, n: number) => Array.from({ length: n }, (_, i) => { const d = new Date(Date.UTC(Number(h.slice(0, 4)), Number(h.slice(5, 7)) - 1 - (n - 1 - i), 1)); return d.toISOString().slice(0, 7); });

async function carregar() {
  const [ps, moves, pos, units, quals] = await Promise.all([
    sql<{ id: number; unit_id: number; position_id: number | null; gestor_id: number | null; vinculo: string; regime: string; nivel: string | null; jornada_min_dia: number | null; turno: string | null; company_id: number | null; admissao: string; desligamento: string | null; situacao: string; data_nascimento: string | null; sexo: string | null }[]>`
      SELECT id, unit_id, position_id, gestor_id, vinculo, regime, nivel, jornada_min_dia, turno, company_id, admissao::text, desligamento::text, situacao, data_nascimento::text, sexo FROM employees`,
    sql<{ id: number; employee_id: number; data: string; tipo: string; de: Record<string, unknown> | null; para: Record<string, unknown> | null }[]>`SELECT id, employee_id, data::text, tipo, de, para FROM employee_moves ORDER BY data, id`,
    sql<{ id: number; nome: string; familia: string | null }[]>`SELECT id, nome, familia FROM positions`,
    sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ORDER BY nome`,
    sql<{ employee_id: number; tipo: string; status: string; em_andamento: boolean }[]>`SELECT employee_id, tipo, status, em_andamento FROM employee_qualifications`,
  ]);
  const pessoas: Pessoa[] = ps.map(r => ({ id: r.id, unitId: r.unit_id, positionId: r.position_id, gestorId: r.gestor_id, vinculo: r.vinculo, regime: r.regime, nivel: r.nivel, jornadaMinDia: r.jornada_min_dia, turno: r.turno, companyId: r.company_id, admissao: r.admissao, desligamento: r.desligamento, situacao: r.situacao, nascimento: r.data_nascimento, sexo: r.sexo }));
  type Mov = (typeof moves)[number]; const movPor = new Map<number, Mov[]>(); for (const m of moves) movPor.set(m.employee_id, [...(movPor.get(m.employee_id) ?? []), m]);
  return { pessoas, moves, movPor, pos: new Map(pos.map(p => [p.id, p])), units, quals };
}
type Base = Awaited<ReturnType<typeof carregar>>;
/** Ativos numa data com o estado (unidade, cargo, vínculo, gestor) daquela data. */
function ativosEm(b: Base, d: string) {
  return b.pessoas.filter(p => p.admissao <= d && (!p.desligamento || p.desligamento > d) && !(p.situacao === "EM_ADMISSAO" && !p.desligamento))
    .map(p => estadoNaData(p, (b.movPor.get(p.id) ?? []).filter(m => m.tipo !== "ADMISSAO" && m.tipo !== "DESLIGAMENTO"), d));
}

export type Indicador = { chave: string; titulo: string; valor: number | null; formato: "n" | "pct" | "anos" | "x"; serie: (number | null)[]; ajuda: string };

export async function composicao(unitId: number | null, h: string) {
  const cfg = await getSettings(); const b = await carregar(); const lider = cfg.igualdade.familiasLideranca as string[];
  const meses = mesesAte(h, 12); const cortes = meses.map((m, i) => (i === meses.length - 1 ? h : fimDoMes(m)));
  const naUnidade = <T extends { unitId: number | null }>(xs: T[]) => (unitId === null ? xs : xs.filter(x => x.unitId === unitId));
  const fotos = cortes.map(d => ({ d, ativos: ativosEm(b, d) }));
  const medidas = fotos.map(({ d, ativos }) => {
    const todos = ativos; const xs = naUnidade(ativos); const n = xs.length;
    const diretos = new Map<number, number>(); for (const p of todos) if (p.gestorId) diretos.set(p.gestorId, (diretos.get(p.gestorId) ?? 0) + 1);
    const gestoresDaUnidade = xs.filter(p => (diretos.get(p.id) ?? 0) > 0);
    const F = xs.filter(p => p.sexo === "F").length, M = xs.filter(p => p.sexo === "M").length;
    const lideres = xs.filter(p => (diretos.get(p.id) ?? 0) > 0 || (p.positionId && lider.includes(b.pos.get(p.positionId)?.familia ?? "")));
    const lF = lideres.filter(p => p.sexo === "F").length, lM = lideres.filter(p => p.sexo === "M").length;
    const comNasc = xs.filter(p => p.nascimento);
    return {
      quadro: n, contingente: n ? (100 * xs.filter(p => CONTINGENTE.has(String(p.vinculo))).length) / n : null,
      casa: n ? xs.reduce((a, p) => a + anosEntre(p.admissao, d), 0) / n : null, idade: comNasc.length ? comNasc.reduce((a, p) => a + anosEntre(p.nascimento!, d), 0) / comNasc.length : null,
      amplitude: gestoresDaUnidade.length ? gestoresDaUnidade.reduce((a, g) => a + (diretos.get(g.id) ?? 0), 0) / gestoresDaUnidade.length : null,
      mulheres: F + M ? (100 * F) / (F + M) : null, mulheresLideranca: lF + lM ? (100 * lF) / (lF + lM) : null,
      porVinculo: xs.reduce((o, p) => { o[String(p.vinculo)] = (o[String(p.vinculo)] ?? 0) + 1; return o; }, {} as Record<string, number>),
    };
  });
  const atual = medidas[medidas.length - 1];
  // destaques do último ciclo encerrado (ou publicado): nota acima do limiar alto
  const [dest] = await sql<{ total: number; destaques: number; ciclo: string | null }[]>`WITH c AS (SELECT pc.id, pc.nome FROM perf_cycles pc WHERE (pc.status IN ('ENCERRADO','CALIBRACAO') OR pc.fase IN ('FEEDBACK','CONCLUSAO','ARQUIVADO')) AND EXISTS (SELECT 1 FROM perf_reviews r2 WHERE r2.cycle_id=pc.id AND coalesce((r2.calc->>'N')::numeric, r2.nota_final) IS NOT NULL) ORDER BY pc.fim DESC, pc.id DESC LIMIT 1)
    SELECT count(*)::int AS total, count(*) FILTER (WHERE coalesce((r.calc->>'N')::numeric, r.nota_final) >= ${Number(cfg.desempenho.limiarAlto)})::int AS destaques, (SELECT nome FROM c) AS ciclo
    FROM perf_reviews r JOIN employees e ON e.id=r.employee_id WHERE r.cycle_id=(SELECT id FROM c) AND coalesce((r.calc->>'N')::numeric, r.nota_final) IS NOT NULL ${unitId === null ? sql`` : sql`AND e.unit_id=${unitId}`}`.catch(() => [{ total: 0, destaques: 0, ciclo: null }]);
  const indicadores: Indicador[] = [
    { chave: "quadro", titulo: "Quadro ativo", valor: atual.quadro, formato: "n", serie: medidas.map(m => m.quadro), ajuda: "pessoas ativas no fim de cada mês (em admissão não conta)" },
    { chave: "contingente", titulo: "Temporários, estagiários e PJ", valor: atual.contingente, formato: "pct", serie: medidas.map(m => m.contingente), ajuda: "parte do quadro com vínculo de prazo determinado ou PJ" },
    { chave: "destaques", titulo: "Destaques no último ciclo", valor: dest.total ? (100 * dest.destaques) / dest.total : null, formato: "pct", serie: [], ajuda: dest.ciclo ? `${dest.destaques} de ${dest.total} no ciclo “${dest.ciclo}” com nota a partir de ${String(cfg.desempenho.limiarAlto).replace(".", ",")}` : "sem ciclo encerrado" },
    { chave: "casa", titulo: "Tempo médio de casa", valor: atual.casa, formato: "anos", serie: medidas.map(m => m.casa), ajuda: "média dos ativos, em anos" },
    { chave: "idade", titulo: "Idade média", valor: atual.idade, formato: "anos", serie: medidas.map(m => m.idade), ajuda: "média de quem tem a data de nascimento na ficha" },
    { chave: "amplitude", titulo: "Amplitude média de controle", valor: atual.amplitude, formato: "x", serie: medidas.map(m => m.amplitude), ajuda: "liderados diretos por gestor (organograma da ficha)" },
    { chave: "mulheres", titulo: "Mulheres no quadro", valor: atual.mulheres, formato: "pct", serie: medidas.map(m => m.mulheres), ajuda: "entre quem tem o sexo informado na ficha" },
    { chave: "lideranca", titulo: "Mulheres na liderança", valor: atual.mulheresLideranca, formato: "pct", serie: medidas.map(m => m.mulheresLideranca), ajuda: "gestão, coordenação e quem tem equipe direta" },
  ];
  const vinculos = [...new Set(medidas.flatMap(m => Object.keys(m.porVinculo)))].sort((a, b) => (CONTINGENTE.has(a) ? 1 : 0) - (CONTINGENTE.has(b) ? 1 : 0) || a.localeCompare(b));

  // movimentações dos últimos 12 meses
  const ini = addDays(h, -365); const noPeriodo = (d: string | null) => !!d && d > ini && d <= h;
  const daUnidadeNaData = (p: Pessoa, d: string) => unitId === null || estadoNaData(p, (b.movPor.get(p.id) ?? []).filter(m => m.tipo !== "ADMISSAO" && m.tipo !== "DESLIGAMENTO"), d).unitId === unitId;
  const adm = b.pessoas.filter(p => noPeriodo(p.admissao) && daUnidadeNaData(p, p.admissao)); const desl = b.pessoas.filter(p => noPeriodo(p.desligamento) && daUnidadeNaData(p, addDays(p.desligamento!, -1)));
  const movs = b.moves.filter(m => noPeriodo(m.data) && !["ADMISSAO", "DESLIGAMENTO"].includes(m.tipo)).filter(m => { if (unitId === null) return true; const p = b.pessoas.find(x => x.id === m.employee_id); return Number(m.de?.unitId) === unitId || Number(m.para?.unitId) === unitId || (!!p && daUnidadeNaData(p, m.data)); });
  const contaTipo = (t: string) => movs.filter(m => m.tipo === t).length;
  const porTipo = [{ tipo: "ADMISSAO", n: adm.length }, { tipo: "DESLIGAMENTO", n: desl.length }, ...["PROMOCAO", "MUDANCA_CARGO", "MUDANCA_NIVEL", "TRANSFERENCIA", "EFETIVACAO", "MUDANCA_VINCULO", "MUDANCA_GESTOR", "MUDANCA_JORNADA", "READMISSAO"].map(t => ({ tipo: t, n: contaTipo(t) }))].map(x => ({ ...x, rotulo: MOV_TIPO[x.tipo] ?? x.tipo }));
  const quadroMedio = medidas.reduce((a, m) => a + m.quadro, 0) / (medidas.length || 1);
  const taxaPromocao = quadroMedio ? (100 * contaTipo("PROMOCAO")) / quadroMedio : null;
  const mensal = meses.map(m => ({ mes: m, admissoes: adm.filter(p => p.admissao.slice(0, 7) === m).length, desligamentos: desl.filter(p => p.desligamento!.slice(0, 7) === m).length, internas: movs.filter(x => x.data.slice(0, 7) === m && ["PROMOCAO", "MUDANCA_CARGO", "TRANSFERENCIA", "EFETIVACAO"].includes(x.tipo)).length }));

  // ponte do quadro por unidade: início + admissões − desligamentos + transferências recebidas − enviadas = fim
  const d0 = ini; const fotoIni = ativosEm(b, d0), fotoFim = fotos[fotos.length - 1].ativos;
  const ponte = b.units.filter(u => unitId === null || u.id === unitId).map(u => {
    const inicio = fotoIni.filter(p => p.unitId === u.id).length, fim = fotoFim.filter(p => p.unitId === u.id).length;
    const a = b.pessoas.filter(p => noPeriodo(p.admissao) && estadoNaData(p, (b.movPor.get(p.id) ?? []).filter(m => m.tipo !== "ADMISSAO" && m.tipo !== "DESLIGAMENTO"), p.admissao).unitId === u.id && !(p.situacao === "EM_ADMISSAO" && !p.desligamento)).length;
    const dl = b.pessoas.filter(p => noPeriodo(p.desligamento) && estadoNaData(p, (b.movPor.get(p.id) ?? []).filter(m => m.tipo !== "ADMISSAO" && m.tipo !== "DESLIGAMENTO"), addDays(p.desligamento!, -1)).unitId === u.id).length;
    const tIn = b.moves.filter(m => noPeriodo(m.data) && m.de && m.para && "unitId" in m.para && Number(m.para.unitId) === u.id && Number(m.de.unitId) !== u.id).length;
    const tOut = b.moves.filter(m => noPeriodo(m.data) && m.de && m.para && "unitId" in m.de && Number(m.de.unitId) === u.id && Number(m.para.unitId) !== u.id).length;
    return { unidade: u.nome, unitId: u.id, inicio, admissoes: a, desligamentos: dl, entradas: tIn, saidas: tOut, fim, ajuste: fim - (inicio + a - dl + tIn - tOut) };
  });

  // titulação do corpo docente (regime docente ou cargo da família Professores), pela formação validada
  const docentes = naUnidade(fotoFim).filter(p => p.regime === "DOCENTE" || (!!p.positionId && b.pos.get(p.positionId)?.familia === "PROFESSORES"));
  const qualPor = new Map<number, Base["quals"][number][]>(); for (const q of b.quals) qualPor.set(q.employee_id, [...(qualPor.get(q.employee_id) ?? []), q]);
  const titulacao = TITULACAO_FAIXAS.map(f => ({ faixa: f, n: docentes.filter(p => maiorTitulacao(qualPor.get(p.id) ?? []) === f).length }));
  const licenciados = docentes.filter(p => temLicenciatura(qualPor.get(p.id) ?? [])).length;
  const comPos = docentes.filter(p => ["Especialização", "Mestrado", "Doutorado"].includes(maiorTitulacao(qualPor.get(p.id) ?? []))).length;

  // por família de cargos (agora)
  const fam = new Map<string, number>(); for (const p of naUnidade(fotoFim)) { const f = p.positionId ? b.pos.get(p.positionId)?.familia ?? "SEM" : "SEM"; fam.set(f, (fam.get(f) ?? 0) + 1); }
  const porFamilia = [...fam.entries()].map(([f, n]) => ({ familia: f === "SEM" ? "Sem família definida" : FAMILIAS[f] ?? f, n })).sort((a, b) => b.n - a.n);
  // gestores por unidade (onde está a liderança)
  const diretosAgora = new Map<number, number>(); for (const p of fotoFim) if (p.gestorId) diretosAgora.set(p.gestorId, (diretosAgora.get(p.gestorId) ?? 0) + 1);
  const gestoresPorUnidade = b.units.filter(u => unitId === null || u.id === unitId).map(u => { const gs = fotoFim.filter(p => p.unitId === u.id && (diretosAgora.get(p.id) ?? 0) > 0); return { unidade: u.nome, gestores: gs.length, liderados: gs.reduce((a, g) => a + (diretosAgora.get(g.id) ?? 0), 0) }; });

  return { meses, indicadores, vinculos, vinculoMensal: vinculos.map(v => ({ nome: v, valores: medidas.map(m => m.porVinculo[v] ?? 0) })), porTipo, mensal, taxaPromocao, ponte, titulacao, docentes: docentes.length, licenciados, comPos, porFamilia, gestoresPorUnidade, ciclo: dest.ciclo };
}

/** Quadro numa data: quem estava ativo, em que unidade e vínculo (pelo histórico funcional). */
export async function quadroNaData(unitId: number | null, d: string) {
  const b = await carregar(); const xs = ativosEm(b, d).filter(p => unitId === null || p.unitId === unitId);
  const porUnidade = b.units.filter(u => unitId === null || u.id === unitId).map(u => { const us = xs.filter(p => p.unitId === u.id); return { unidade: u.nome, total: us.length, porVinculo: us.reduce((o, p) => { o[String(p.vinculo)] = (o[String(p.vinculo)] ?? 0) + 1; return o; }, {} as Record<string, number>) }; });
  const cargos = new Map<string, number>(); for (const p of xs) { const n = p.positionId ? b.pos.get(p.positionId)?.nome ?? "—" : "Sem cargo"; cargos.set(n, (cargos.get(n) ?? 0) + 1); }
  return { total: xs.length, porUnidade, cargos: [...cargos.entries()].map(([cargo, n]) => ({ cargo, n })).sort((a, b) => b.n - a.n) };
}
