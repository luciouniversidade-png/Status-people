import { detectarSeparador, normalizarCabecalho, celula } from "./utils";
import { parseValor } from "./financeiro";

/**
 * Payroll Bridge (T-055…T-057 · Nova Arquitetura, Cap. 25) — regras puras, sem banco.
 * A folha NÃO é calculada no sistema: holerite, INSS/IRRF/FGTS, eSocial e guias seguem com o contador.
 * O ciclo controla os cinco passos — fechar o ponto, enviar o pacote, conferir a prévia, importar o resultado, arquivar —
 * e o resultado aceito vira a única fonte REAL do custo de pessoal (CRQ-FOL-V3-04).
 */

export const ETAPAS_FOLHA = [
  { n: 1, chave: "LOCK", nome: "Fechamento do ponto", curto: "Ponto", regra: "CRQ-TMP-V3-04 · nada sai sem o fechamento de todas as unidades" },
  { n: 2, chave: "PACOTE", nome: "Pacote ao contador", curto: "Pacote", regra: "CRQ-FOL-V3-01 · pendências travam o envio" },
  { n: 3, chave: "CONFERENCIA", nome: "Conferência da prévia (duas pessoas)", curto: "Conferência", regra: "CRQ-FOL-V3-02 · Four-Eyes; variação > 5% explicada" },
  { n: 4, chave: "RESULTADO", nome: "Resultado importado e aceito", curto: "Resultado", regra: "CRQ-FOL-V3-04 · única fonte REAL do custo de pessoal" },
  { n: 5, chave: "ARQUIVO", nome: "Arquivo de holerites e guias", curto: "Arquivo", regra: "CRQ-FOL-V3-03 · consulta restrita e registrada" },
] as const;
export type EstadoEtapa = "COMPLETED" | "CURRENT" | "PENDING";
export const ROTULO_ESTADO: Record<EstadoEtapa, string> = { COMPLETED: "Concluída", CURRENT: "Em andamento", PENDING: "Pendente" };

export const STATUS_CICLO: Record<string, string> = {
  ABERTO: "Aberto", PACOTE_ENVIADO: "Pacote enviado", DEVOLVIDO: "Prévia devolvida ao contador", CONFERIDO: "Prévia conferida",
  RESULTADO_IMPORTADO: "Resultado aguardando aceite", ACEITO: "Resultado aceito (REAL)", ARQUIVADO: "Ciclo completo",
};
export const TIPOS_DOC: Record<string, string> = {
  HOLERITES: "Holerites (lote ou individual)", GUIA_INSS: "Guia do INSS (DCTFWeb/DARF)", GUIA_FGTS: "Guia do FGTS Digital", GUIA_IRRF: "Guia do IRRF (DARF)",
  RESUMO_FOLHA: "Resumo da folha do contador", RECIBO_ESOCIAL: "Recibo do eSocial", OUTRO: "Outro documento",
};
export const MOTIVOS_VARIACAO: Record<string, string> = {
  ADMISSOES: "Admissões no mês", DESLIGAMENTOS: "Desligamentos e rescisões", HORAS_EXTRAS: "Horas extras pagas", REAJUSTE: "Reajuste / dissídio",
  FERIAS: "Férias e 1/3 no mês", DECIMO_TERCEIRO: "13º salário", AFASTAMENTOS: "Afastamentos", BENEFICIOS: "Benefícios", CORRECAO: "Correção de mês anterior", OUTRO: "Outro motivo",
};

/** Índice da etapa corrente (1…5) a partir do status do ciclo; 6 = ciclo completo. */
export function etapaAtual(status: string | null | undefined, lockOk: boolean): number {
  switch (status ?? "ABERTO") {
    case "ARQUIVADO": return 6;
    case "ACEITO": return 5;
    case "RESULTADO_IMPORTADO": case "CONFERIDO": return 4;
    case "PACOTE_ENVIADO": case "DEVOLVIDO": return 3;
    default: return lockOk ? 2 : 1;
  }
}
/** Estado de cada um dos 5 passos (C13): concluídos antes da etapa atual; a atual em andamento; o resto pendente. */
export function estadoEtapas(status: string | null | undefined, lockOk: boolean): EstadoEtapa[] {
  const atual = etapaAtual(status, lockOk);
  return ETAPAS_FOLHA.map(e => e.n < atual ? "COMPLETED" : e.n === atual ? "CURRENT" : "PENDING");
}

export type LinhaResultado = { unidade: string | null; unit_id: number | null; area: string | null; headcount: number | null; salarios: number; inss: number; fgts: number; irrf: number; provisao_13: number; provisao_ferias: number; beneficios: number; rescisoes: number; outros: number };
/** Custo de pessoal de uma linha do resultado: proventos + encargos patronais + provisões + benefícios + rescisões. O IRRF é retido do colaborador: não é custo da escola. */
export const custoLinha = (r: Pick<LinhaResultado, "salarios" | "inss" | "fgts" | "provisao_13" | "provisao_ferias" | "beneficios" | "rescisoes" | "outros">) =>
  r.salarios + r.inss + r.fgts + r.provisao_13 + r.provisao_ferias + r.beneficios + r.rescisoes + r.outros;
export const encargosLinha = (r: Pick<LinhaResultado, "inss" | "fgts">) => r.inss + r.fgts;
export const provisoesLinha = (r: Pick<LinhaResultado, "provisao_13" | "provisao_ferias">) => r.provisao_13 + r.provisao_ferias;

/** Variação percentual do total sobre o mês anterior (null sem base). */
export function variacaoPct(total: number | null, anterior: number | null): number | null {
  if (total === null || anterior === null || anterior === 0) return null;
  return Math.round(((total - anterior) / Math.abs(anterior)) * 10000) / 100;
}
/** Acima do limite (em módulo), o aceite exige explicação (CRQ-FOL-V3-02). */
export const exigeExplicacao = (variacao: number | null, limitePct: number) => variacao !== null && Math.abs(variacao) > limitePct;

/** Decomposição da variação: quanto as explicações cobrem do delta e o que sobra "não explicado". */
export function decomporVariacao(total: number | null, anterior: number | null, explicacoes: { motivo: string; valor: number | null }[]) {
  if (total === null || anterior === null) return null;
  const delta = total - anterior; const itens = explicacoes.filter(e => e.valor !== null).map(e => ({ motivo: e.motivo, valor: e.valor as number }));
  const explicado = itens.reduce((a, e) => a + e.valor, 0);
  return { delta, explicado, naoExplicado: delta - explicado, itens, cobertura: delta !== 0 ? Math.round((100 * explicado) / delta) : null };
}

/**
 * Amostra reproduzível de holerites para a conferência: o mesmo ciclo sorteia sempre as mesmas pessoas
 * (semente = competência + entidade), e a lista fica registrada — a conferência é auditável.
 */
export function sortearAmostra<T extends { id: number }>(pessoas: T[], n: number, semente: string): T[] {
  let h = 2166136261; for (const ch of semente) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  const rnd = () => { h = (Math.imul(h ^ (h >>> 15), 2246822507) + 0x9e3779b9) >>> 0; h ^= h >>> 13; return (h >>> 0) / 4294967296; };
  const pool = [...pessoas].sort((a, b) => a.id - b.id); const out: T[] = [];
  while (pool.length && out.length < n) out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  return out.sort((a, b) => a.id - b.id);
}

/** Fração do mês em que a pessoa esteve no quadro (admissão/desligamento no meio do mês, base de 30 dias como na folha). */
export function fracaoMes(mes: string, admissao: string, desligamento: string | null): number {
  const [a, m] = mes.split("-").map(Number); const ini = `${mes}-01`; const fim = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
  if (admissao > fim || (desligamento && desligamento < ini)) return 0;
  const dIni = admissao > ini ? Number(admissao.slice(8, 10)) : 1;
  const dFim = desligamento && desligamento < fim ? Number(desligamento.slice(8, 10)) : 30;
  return Math.max(0, Math.min(30, Math.min(30, dFim) - dIni + 1)) / 30;
}

/**
 * Folha esperada pelo cadastro (estimativa para a conferência — nunca REAL): salário vigente × fração do mês + estimativa
 * de encargos. Pessoas sem salário cadastrado ficam fora e são contadas à parte.
 */
export function folhaEsperada(pessoas: { salario: number | null; admissao: string; desligamento: string | null }[], mes: string, encargosPct: number) {
  let base = 0, comSalario = 0, semSalario = 0, headcountFim = 0; const [a, m] = mes.split("-").map(Number); const fim = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
  for (const p of pessoas) {
    const f = fracaoMes(mes, p.admissao, p.desligamento); if (f <= 0) continue;
    if (!p.desligamento || p.desligamento >= fim) headcountFim++;
    if (p.salario === null) { semSalario++; continue; }
    comSalario++; base += p.salario * f;
  }
  const encargos = base * (encargosPct / 100);
  return { proventos: Math.round(base * 100) / 100, encargos: Math.round(encargos * 100) / 100, total: Math.round((base + encargos) * 100) / 100, comSalario, semSalario, headcountFim };
}

export type ChecagemConferencia = { headcountOk: boolean | null; variacaoExplicada: boolean; amostraCompleta: boolean; divergenciasAbertas: number; quatroOlhos: boolean };
/** A conferência só é registrada como aprovada com todos os itens; divergência aberta devolve a prévia ao contador. */
export function resultadoConferencia(c: ChecagemConferencia): { aprovada: boolean; devolvida: boolean; faltando: string[] } {
  const faltando: string[] = [];
  if (!c.quatroOlhos) faltando.push("a conferência precisa ser feita por outra pessoa (não por quem gerou o pacote)");
  if (c.headcountOk === null) faltando.push("confira o headcount da prévia com o cadastro");
  if (!c.amostraCompleta) faltando.push("marque cada holerite da amostra como conferido ou divergente");
  if (!c.variacaoExplicada) faltando.push("explique a variação acima do limite antes de aprovar");
  const devolvida = c.divergenciasAbertas > 0 || c.headcountOk === false;
  return { aprovada: faltando.length === 0 && !devolvida, devolvida: faltando.length === 0 && devolvida, faltando };
}

/** Documentos obrigatórios faltando para arquivar o ciclo. */
export const docsFaltando = (obrigatorios: string[], presentes: string[]) => obrigatorios.filter(t => !presentes.includes(t));

/** Competência anterior ("2026-01" → "2025-12"). */
export function competenciaAnterior(c: string) { const [a, m] = c.split("-").map(Number); return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`; }
export function competenciaSeguinte(c: string) { const [a, m] = c.split("-").map(Number); return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, "0")}`; }

/** Colunas aceitas na importação do resultado (cabeçalho normalizado → campo). */
export const COLUNAS_RESULTADO: Record<string, keyof LinhaResultado> = {
  unidade: "unidade", unit: "unidade", escola: "unidade", area: "area", centro_de_custo: "area", centro_custo: "area", departamento: "area", setor: "area",
  headcount: "headcount", funcionarios: "headcount", colaboradores: "headcount", qtde: "headcount",
  salarios: "salarios", proventos: "salarios", salario: "salarios", total_proventos: "salarios", bruto: "salarios",
  inss: "inss", inss_patronal: "inss", cpp: "inss", inss_empresa: "inss", fgts: "fgts", irrf: "irrf", ir: "irrf",
  provisao_13: "provisao_13", provisao_13o: "provisao_13", "13": "provisao_13", decimo_terceiro: "provisao_13", provisao_ferias: "provisao_ferias", ferias: "provisao_ferias", ferias_13: "provisao_ferias",
  beneficios: "beneficios", vt_va: "beneficios", rescisoes: "rescisoes", rescisao: "rescisoes", outros: "outros",
};

/** Lê o resultado do contador (colunas: unidade, área, headcount, salários, INSS patronal, FGTS, IRRF, provisões, benefícios, rescisões, outros). */
export function lerResultadoTexto(texto: string, units: { id: number; nome: string; codigo: string }[]) {
  const linhas = texto.split(/\r?\n/).filter(l => l.trim()); if (linhas.length < 2) throw new Error("Cole o cabeçalho e ao menos uma linha.");
  const sep = detectarSeparador(linhas[0]); const cab = linhas[0].split(sep).map(h => COLUNAS_RESULTADO[normalizarCabecalho(h)] ?? null);
  if (!cab.includes("salarios")) throw new Error("O arquivo precisa da coluna de salários/proventos.");
  const norm = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const rows: LinhaResultado[] = []; const erros: string[] = [];
  linhas.slice(1).forEach((l, i) => {
    const cel = l.split(sep).map(celula); const r: LinhaResultado = { unidade: null, unit_id: null, area: null, headcount: null, salarios: 0, inss: 0, fgts: 0, irrf: 0, provisao_13: 0, provisao_ferias: 0, beneficios: 0, rescisoes: 0, outros: 0 };
    cab.forEach((k, j) => {
      if (!k) return; const v = cel[j] ?? "";
      if (k === "unidade") r.unidade = v || null; else if (k === "area") r.area = v || null;
      else if (k === "headcount") r.headcount = v ? Math.round(Number(v.replace(",", "."))) : null;
      else { const n = v ? parseValor(v) : 0; if (!Number.isFinite(n)) erros.push(`linha ${i + 2}: valor inválido em ${k}`); (r as Record<string, unknown>)[k] = Number.isFinite(n) ? n : 0; }
    });
    if (/^total/i.test(r.unidade ?? "") || /^total/i.test(r.area ?? "")) return; // linha de total do relatório do contador não entra (evita contar em dobro)
    if (r.unidade) { const u = units.find(x => norm(x.nome) === norm(r.unidade!) || norm(x.codigo) === norm(r.unidade!)); if (!u) erros.push(`linha ${i + 2}: unidade "${r.unidade}" não encontrada`); else r.unit_id = u.id; }
    if (custoLinha(r) === 0 && !r.headcount) return;
    rows.push(r);
  });
  return { rows, erros };
}
