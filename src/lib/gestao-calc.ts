/**
 * Cálculos da gestão estratégica e do relacionamento com as famílias — funções puras (sem banco),
 * testadas em scripts/test_gestao.ts. Todas as datas são ISO 'YYYY-MM-DD' e todo cálculo de calendário é feito em UTC.
 * Regras explícitas: ausência de dado nunca vira zero; divisão por zero vira "sem base"; nenhum número é inventado.
 */

// ---------------- Perspectivas do mapa estratégico ----------------
export type Perspectiva = { chave: string; nome: string; descricao: string };
export const PERSPECTIVAS_PADRAO: Perspectiva[] = [
  { chave: "FINANCEIRA", nome: "Financeira", descricao: "Sustentabilidade: receita, inadimplência, custos e investimento" },
  { chave: "FAMILIAS", nome: "Famílias e alunos", descricao: "Valor percebido: aprendizagem, experiência, satisfação e permanência" },
  { chave: "PROCESSOS", nome: "Processos internos", descricao: "Como a escola opera: pedagógico, atendimento, matrículas e operações" },
  { chave: "PESSOAS", nome: "Pessoas e cultura", descricao: "Equipe, liderança, clima e desenvolvimento" },
  { chave: "APRENDIZADO", nome: "Aprendizado e inovação", descricao: "Tecnologia, dados, inovação e melhoria contínua" },
];
/** Perspectiva efetiva do objetivo: a definida nele; senão, a sugerida pelo pilar (configurável); senão, nenhuma. */
export function perspectivaDoObjetivo(perspectiva: string | null, pilar: string | null, mapa: Record<string, string>): string | null {
  if (perspectiva) return perspectiva;
  return pilar ? mapa[pilar] ?? null : null;
}

// ---------------- Indicadores: farol, razões e períodos ----------------
export type Direcao = "MAIOR_MELHOR" | "MENOR_MELHOR" | "FAIXA";
export const DIRECAO_IND: Record<Direcao, string> = { MAIOR_MELHOR: "Quanto maior, melhor", MENOR_MELHOR: "Quanto menor, melhor", FAIXA: "Dentro de uma faixa" };
export type Farol = "VERDE" | "AMARELO" | "VERMELHO" | "SEM_META" | "SEM_DADO";
export const FAROL_LABEL: Record<Farol, string> = { VERDE: "No alvo", AMARELO: "Atenção", VERMELHO: "Fora do alvo", SEM_META: "Sem meta", SEM_DADO: "Sem medição" };
export type ConfigIndicador = { direcao: Direcao; meta: number | null; alerta: number | null; faixaMin: number | null; faixaMax: number | null };

/** Valida a configuração de meta/alerta antes de gravar. Retorna a lista de problemas (vazia = válida). */
export function validarConfigIndicador(c: ConfigIndicador): string[] {
  const e: string[] = [];
  if (c.direcao === "FAIXA") {
    if (c.faixaMin === null || c.faixaMax === null) e.push("Indicador de faixa precisa de mínimo e máximo.");
    else if (c.faixaMin > c.faixaMax) e.push("O mínimo da faixa não pode ser maior que o máximo.");
    if (c.alerta !== null && c.alerta < 0) e.push("A margem de atenção da faixa não pode ser negativa.");
  } else if (c.meta !== null && c.alerta !== null) {
    if (c.direcao === "MAIOR_MELHOR" && c.alerta >= c.meta) e.push("Quanto maior, melhor: o limite de atenção precisa ser menor que a meta.");
    if (c.direcao === "MENOR_MELHOR" && c.alerta <= c.meta) e.push("Quanto menor, melhor: o limite de atenção precisa ser maior que a meta.");
  }
  return e;
}

/**
 * Farol explícito:
 * - Maior é melhor: ≥ meta = no alvo; ≥ limite de atenção = atenção; abaixo = fora do alvo.
 * - Menor é melhor: ≤ meta = no alvo; ≤ limite de atenção = atenção; acima = fora do alvo.
 * - Faixa: dentro de [mín, máx] = no alvo; até a margem de atenção fora da faixa = atenção; além = fora do alvo.
 * Sem limite de atenção, o farol é binário (no alvo / fora do alvo).
 */
export function farol(v: number | null | undefined, c: ConfigIndicador): Farol {
  if (v === null || v === undefined || Number.isNaN(v)) return "SEM_DADO";
  if (c.direcao === "FAIXA") {
    if (c.faixaMin === null || c.faixaMax === null) return "SEM_META";
    if (v >= c.faixaMin && v <= c.faixaMax) return "VERDE";
    const dist = v < c.faixaMin ? c.faixaMin - v : v - c.faixaMax;
    return c.alerta !== null && dist <= c.alerta ? "AMARELO" : "VERMELHO";
  }
  if (c.meta === null) return "SEM_META";
  if (c.direcao === "MAIOR_MELHOR") return v >= c.meta ? "VERDE" : c.alerta !== null && v >= c.alerta ? "AMARELO" : "VERMELHO";
  return v <= c.meta ? "VERDE" : c.alerta !== null && v <= c.alerta ? "AMARELO" : "VERMELHO";
}

/** Razão entre duas medições (ex.: custo por lead). Nunca divide por zero nem inventa valor. */
export function razao(num: number | null | undefined, den: number | null | undefined, fator = 1): { valor: number | null; motivo: string | null } {
  if (num === null || num === undefined || Number.isNaN(num)) return { valor: null, motivo: "numerador sem medição" };
  if (den === null || den === undefined || Number.isNaN(den)) return { valor: null, motivo: "denominador sem medição" };
  if (den === 0) return { valor: null, motivo: "denominador zero — sem base para calcular" };
  return { valor: (num / den) * fator, motivo: null };
}

export const FREQ_MESES: Record<string, number> = { MENSAL: 1, BIMESTRAL: 2, TRIMESTRAL: 3, SEMESTRAL: 6, ANUAL: 12 };
export const FREQ_LABEL: Record<string, string> = { MENSAL: "Mensal", BIMESTRAL: "Bimestral", TRIMESTRAL: "Trimestral", SEMESTRAL: "Semestral", ANUAL: "Anual" };
export const periodoDe = (iso: string) => iso.slice(0, 7);
/** Soma n meses a um período 'YYYY-MM' (n pode ser negativo). */
export function somaMeses(periodo: string, n: number): string {
  const [y, m] = periodo.split("-").map(Number); const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}
export const validoPeriodo = (p: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(p);
/** Lista os últimos n períodos até `ate` (inclusive), do mais antigo ao mais recente. */
export const ultimosPeriodos = (ate: string, n: number) => Array.from({ length: n }, (_, i) => somaMeses(ate, i - n + 1));
export const nomePeriodo = (p: string) => { const [y, m] = p.split("-"); return `${["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"][Number(m) - 1]}/${y.slice(2)}`; };
/**
 * Medição em dia: a última medição precisa cobrir o período fechado mais recente da frequência.
 * Mensal: ter o mês anterior (ou o atual). Trimestral: ter um dos últimos 3 meses. Etc.
 */
export function medicaoEmDia(ultimoPeriodo: string | null, frequencia: string, hojeIso: string): boolean {
  if (!ultimoPeriodo) return false;
  return ultimoPeriodo >= somaMeses(periodoDe(hojeIso), -(FREQ_MESES[frequencia] ?? 1));
}

// ---------------- Datas e rituais ----------------
const toUtc = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const fromUtc = (t: number) => new Date(t).toISOString().slice(0, 10);
export const somaDias = (iso: string, n: number) => fromUtc(toUtc(iso) + n * 86400000);
export const diasEntre = (a: string, b: string) => Math.round((toUtc(b) - toUtc(a)) / 86400000);
/** Soma meses mantendo o dia (31/01 + 1 mês = 28 ou 29/02, último dia do mês). */
export function somaMesesData(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number); const t = y * 12 + (m - 1) + n; const ny = Math.floor(t / 12), nm = t % 12;
  const ultimo = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return fromUtc(Date.UTC(ny, nm, Math.min(d, ultimo)));
}
export const diaSemana = (iso: string) => new Date(toUtc(iso)).getUTCDay();

export type TipoRitual = "DIARIO" | "SEMANAL" | "QUINZENAL" | "MENSAL" | "BIMESTRAL" | "TRIMESTRAL" | "SEMESTRAL" | "ANUAL";
export const RITUAL_TIPO: Record<TipoRitual, string> = { DIARIO: "Diário (dias úteis)", SEMANAL: "Semanal", QUINZENAL: "Quinzenal", MENSAL: "Mensal", BIMESTRAL: "Bimestral", TRIMESTRAL: "Trimestral", SEMESTRAL: "Semestral", ANUAL: "Anual" };
const CAD: Record<TipoRitual, { dias?: number; meses?: number; aprox: number }> = { DIARIO: { dias: 1, aprox: 1 }, SEMANAL: { dias: 7, aprox: 7 }, QUINZENAL: { dias: 14, aprox: 14 }, MENSAL: { meses: 1, aprox: 30 }, BIMESTRAL: { meses: 2, aprox: 61 }, TRIMESTRAL: { meses: 3, aprox: 91 }, SEMESTRAL: { meses: 6, aprox: 182 }, ANUAL: { meses: 12, aprox: 365 } };
export const cadenciaDias = (t: TipoRitual) => CAD[t]?.aprox ?? 30;
/** Próxima data do ritual a partir de uma reunião. Diário pula fim de semana. */
export function proximaData(iso: string, t: TipoRitual): string {
  const c = CAD[t] ?? CAD.MENSAL; let r = c.meses ? somaMesesData(iso, c.meses) : somaDias(iso, c.dias ?? 30);
  if (t === "DIARIO") { while (diaSemana(r) === 0 || diaSemana(r) === 6) r = somaDias(r, 1); }
  return r;
}
/** Ritual em dia: a próxima reunião prevista não passou da tolerância. */
export function situacaoRitual(proxima: string | null, hojeIso: string, toleranciaDias: number): "EM_DIA" | "ATRASADO" | "SEM_DATA" {
  if (!proxima) return "SEM_DATA";
  return diasEntre(proxima, hojeIso) > toleranciaDias ? "ATRASADO" : "EM_DIA";
}
/**
 * Aderência = reuniões realizadas na janela ÷ reuniões esperadas na janela.
 * Janela = max(90 dias, 1 ciclo). Ritual criado há menos tempo: só conta o período desde a criação.
 * Sem reunião esperada ainda → sem base (null), nunca 0% nem 100% artificial.
 */
export function aderenciaRitual(realizadas: number, t: TipoRitual, diasDesdeCriacao: number): { pct: number | null; esperadas: number } {
  const cad = cadenciaDias(t); const janela = Math.max(90, cad); const base = Math.min(janela, Math.max(0, diasDesdeCriacao));
  let esperadas = Math.floor(base / cad);
  if (t === "DIARIO") esperadas = Math.floor(base * 5 / 7);
  if (esperadas <= 0) return { pct: null, esperadas: 0 };
  return { pct: Math.min(100, Math.round((100 * realizadas) / esperadas)), esperadas };
}

// ---------------- Saúde estratégica ----------------
export type Componente = { chave: string; nome: string; peso: number; valor: number | null; num?: number; den?: number; detalhe: string };
export type Saude = { score: number | null; faixa: "BOA" | "ATENCAO" | "CRITICA" | null; usados: Componente[]; semBase: Componente[]; pesoUsado: number };
export const FAIXA_SAUDE: Record<string, string> = { BOA: "Boa", ATENCAO: "Atenção", CRITICA: "Crítica" };
/** Percentual de uma contagem; sem denominador → sem base. */
export const pctDe = (num: number, den: number): number | null => den > 0 ? (100 * num) / den : null;
/**
 * Saúde estratégica = média ponderada dos componentes que têm base de cálculo.
 * Componentes sem base saem do cálculo e o peso é redistribuído entre os demais (mostrado na tela).
 * Nenhum componente com base → sem dados (null), nunca 0.
 */
export function saudeEstrategicaCalc(comps: Componente[], faixas: [number, number] = [50, 75]): Saude {
  const usados = comps.filter(c => c.valor !== null && c.peso > 0); const semBase = comps.filter(c => c.valor === null || c.peso <= 0);
  const pesoUsado = usados.reduce((a, c) => a + c.peso, 0);
  if (!usados.length || pesoUsado <= 0) return { score: null, faixa: null, usados, semBase, pesoUsado: 0 };
  const score = usados.reduce((a, c) => a + c.peso * (c.valor as number), 0) / pesoUsado;
  return { score, faixa: score >= faixas[1] ? "BOA" : score >= faixas[0] ? "ATENCAO" : "CRITICA", usados, semBase, pesoUsado };
}

// ---------------- Maturidade de processos ----------------
export type PopMat = { vigente: boolean; temDono: boolean; cienciaCompleta: boolean; temIndicador: boolean; controleEmDia: boolean; revisaoEmDia: boolean };
export const NIVEL_MAT: Record<number, string> = { 1: "Inicial (em rascunho)", 2: "Documentado (vigente)", 3: "Gerenciado (dono e equipe ciente)", 4: "Medido (indicador definido)", 5: "Controlado (controle e revisão em dia)" };
/** Nível cumulativo: cada nível exige os anteriores. */
export function nivelMaturidade(p: PopMat): number {
  if (!p.vigente) return 1;
  if (!(p.temDono && p.cienciaCompleta)) return 2;
  if (!p.temIndicador) return 3;
  if (!(p.controleEmDia && p.revisaoEmDia)) return 4;
  return 5;
}
/** Percentual de critérios atendidos (6 critérios, mesmo peso). */
export function pctMaturidade(p: PopMat): number {
  const c = [p.vigente, p.temDono, p.cienciaCompleta, p.temIndicador, p.controleEmDia, p.revisaoEmDia];
  return (100 * c.filter(Boolean).length) / c.length;
}

// ---------------- Marketing (números agregados, sem lead individual) ----------------
export type Funil = { investimento: number | null; candidatos: number | null; reservas: number | null; matriculas: number | null };
export function indicadoresFunil(f: Funil) {
  return {
    cpl: razao(f.investimento, f.candidatos),
    cac: razao(f.investimento, f.matriculas),
    conversao: razao(f.matriculas, f.candidatos, 100),
    reservaParaMatricula: razao(f.matriculas, f.reservas, 100),
  };
}

// ---------------- Família: jornada e segmento ----------------
export type EtapaCfg = { chave: string; nome: string; ate: string | null }; // ate = 'MM-DD' (prazo no ano) ou null
export type EtapaStatus = "CONCLUIDA" | "ATRASADA" | "PROXIMA" | "FUTURA" | "SEM_PRAZO";
export function etapasJornada(cfg: EtapaCfg[], ano: number, concluidas: Set<string>, hojeIso: string, janelaProxima = 15) {
  return cfg.map(e => {
    const prazo = e.ate ? `${ano}-${e.ate}` : null; let status: EtapaStatus;
    if (concluidas.has(e.chave)) status = "CONCLUIDA";
    else if (!prazo) status = "SEM_PRAZO";
    else if (prazo < hojeIso) status = "ATRASADA";
    else status = diasEntre(hojeIso, prazo) <= janelaProxima ? "PROXIMA" : "FUTURA";
    return { ...e, prazo, status };
  });
}
/** Lê "Nome | DD/MM" (uma etapa por linha). Prazo opcional. Gera a chave a partir do nome. */
export function lerJornada(texto: string): EtapaCfg[] {
  const out: EtapaCfg[] = []; const vistos = new Set<string>();
  for (const linha of texto.split(/\r?\n/).map(l => l.trim()).filter(Boolean)) {
    const [nomeBruto, prazoBruto] = linha.split("|").map(x => x.trim()); if (!nomeBruto) continue;
    let ate: string | null = null;
    if (prazoBruto) { const m = prazoBruto.match(/^(\d{1,2})\/(\d{1,2})$/); if (!m) throw new Error(`Prazo inválido em “${linha}”. Use DD/MM.`); const d = Number(m[1]), mm = Number(m[2]); if (mm < 1 || mm > 12 || d < 1 || d > new Date(Date.UTC(2024, mm, 0)).getUTCDate()) throw new Error(`Data inexistente em “${linha}”.`); ate = `${String(mm).padStart(2, "0")}-${String(d).padStart(2, "0")}`; }
    let chave = nomeBruto.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "ETAPA";
    let k = chave, i = 2; while (vistos.has(k)) k = `${chave}_${i++}`; vistos.add(k);
    out.push({ chave: k, nome: nomeBruto, ate });
  }
  return out;
}
export type Segmento = "RISCO" | "ATENCAO" | "SAUDAVEL";
export const SEGMENTO_LABEL: Record<Segmento, string> = { RISCO: "Risco", ATENCAO: "Atenção", SAUDAVEL: "Saudável" };
/**
 * Segmento do relacionamento (regras explícitas):
 * - Risco: pedido de saída aberto ou pontuação de risco alta.
 * - Atenção: algum sinal de risco, caso com prazo vencido ou próximo passo combinado com a família vencido.
 * - Saudável: nenhum desses sinais.
 * Jornada atrasada é obrigação da escola: aparece para quem cuida da carteira, mas não rebaixa a família.
 */
export function segmentoFamilia(x: { nivelRisco: "ALTO" | "MEDIO" | "BAIXO" | null; saidaAberta: boolean; slaVencido: boolean; passoVencido: boolean }): Segmento {
  if (x.saidaAberta || x.nivelRisco === "ALTO") return "RISCO";
  if (x.nivelRisco || x.slaVencido || x.passoVencido) return "ATENCAO";
  return "SAUDAVEL";
}
