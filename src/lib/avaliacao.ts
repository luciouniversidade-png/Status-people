/** Motor de avaliação por critérios — único, testável, reutilizado por telas, relatórios e exportações. Sem arredondar internamente. */
export type Eixo = "RESULTADOS" | "ATITUDES" | "TECNICA";
export type Criterio = { id: string; eixo: Eixo; titulo: string; descricao?: string | null; peso: number; niveis?: Record<string, string>; evidencia?: string | null; naPermitido?: boolean };
export type NotaCriterio = { nota?: number | null; na?: boolean; naJustificativa?: string | null; naAprovado?: boolean; naoObservado?: boolean; evidencia?: string | null };
export type Notas = Record<string, NotaCriterio>;
export type Situacao = "OK" | "PENDENTE" | "NAO_OBSERVADO" | "NA_APROVADO" | "NA_AGUARDANDO" | "INVALIDO";
export type Cobertura = { validos: number; total: number; pesoValido: number; pesoTotal: number; pesoAplicavel: number; pct: number | null };
export type Memoria = {
  R: number | null; A: number | null; N: number | null; composta: boolean; provisoria: boolean; publicavel: boolean; baseInsuficiente: boolean; coberturaMinima: number;
  coberturaR: Cobertura; coberturaA: Cobertura; pendentes: string[]; naoObservados: string[]; naAguardando: string[]; naAprovados: string[]; invalidos: string[]; contestados: string[];
  motivos: string[]; limitacoes: string[]; pesos: { resultados: number; atitudes: number }; itens: { id: string; eixo: Eixo; titulo: string; peso: number; nota: number | null; situacao: Situacao; contestada?: boolean }[];
};
export type OpcoesCalculo = { composta?: boolean; coberturaMinima?: number; contestados?: string[] };
export const SITUACAO_LABEL: Record<Situacao, string> = { OK: "Avaliado", PENDENTE: "Pendente", NAO_OBSERVADO: "Não observado", NA_APROVADO: "Não aplicável aprovado", NA_AGUARDANDO: "N/A aguardando aprovação", INVALIDO: "Nota inválida" };
export const ESCALA: Record<number, string> = { 1: "Muito abaixo do esperado", 2: "Abaixo do esperado", 3: "Atende ao esperado", 4: "Supera o esperado", 5: "Supera de forma consistente, com evidências" };
export const FAMILIAS: Record<string, string> = { PROFESSORES: "Professores", COORDENACAO: "Coordenação", SECRETARIA: "Secretaria", ATENDIMENTO_COMERCIAL: "Atendimento e comercial", APOIO_OPERACIONAL: "Apoio operacional", GESTAO: "Gestão" };
export const EIXO_LABEL: Record<Eixo, string> = { RESULTADOS: "Resultados", ATITUDES: "Atitudes", TECNICA: "Competência técnica" };
export const ESTADO_AV: Record<string, string> = { RASCUNHO: "Rascunho", ENVIADA: "Enviada", EM_CALIBRACAO: "Em calibração", PUBLICADA: "Publicada", CONTESTADA: "Contestada", INCONCLUSIVA: "Inconclusiva (evidências insuficientes)" };
export const FASE_CICLO: Record<string, string> = { PLANEJAMENTO: "Planejamento", ACOMPANHAMENTO: "Acompanhamento", AVALIACAO: "Avaliação", CALIBRACAO: "Calibração", FEEDBACK: "Feedback", CONCLUSAO: "Conclusão", ARQUIVADO: "Arquivado" };
export const FASES_ORDEM = ["PLANEJAMENTO", "ACOMPANHAMENTO", "AVALIACAO", "CALIBRACAO", "FEEDBACK", "CONCLUSAO", "ARQUIVADO"];
export const PDI_ACAO_STATUS: Record<string, string> = { NAO_INICIADA: "Não iniciada", EM_ANDAMENTO: "Em andamento", AGUARDANDO_APOIO: "Aguardando apoio institucional", AGUARDANDO_OPORTUNIDADE: "Aguardando oportunidade de aplicação", AGUARDANDO_OBSERVACAO: "Aguardando observação", AGUARDANDO_VALIDACAO: "Aguardando validação", CONCLUIDA: "Concluída", CANCELADA: "Cancelada" };
export const PDI_ACAO_TIPO: Record<string, string> = { CURSO: "Curso", LEITURA: "Leitura orientada", MENTORIA: "Mentoria", OBSERVACAO: "Observação de prática", PROJETO: "Projeto aplicado", TREINAMENTO_INTERNO: "Treinamento interno" };
export const FEEDBACK_TIPO: Record<string, string> = { RECONHECIMENTO: "Reconhecimento", DESENVOLVIMENTO: "Desenvolvimento", DEVOLUTIVA: "Devolutiva do ciclo" };
export const NATUREZA_EVID: Record<string, string> = { REGISTRO: "Registro verificável de entrega", OBSERVACAO: "Observação direta", RELATO: "Relato de terceiro", AUTO: "Autoavaliação", INTERPRETACAO: "Interpretação do avaliador" };
export const VALIDACAO_EVID: Record<string, string> = { NAO_VALIDADA: "Não validada", VALIDADA: "Validada", CONTESTADA: "Contestada" };
export const HIPOTESE: Record<string, string> = { INDIVIDUAL: "Necessidade de desenvolvimento individual", PROCESSO: "Problema de processo", ORIENTACAO: "Orientação insuficiente", RECURSO: "Recurso indisponível", DEPENDENCIA: "Dependência de outra área", CONTEXTO: "Contexto ainda não esclarecido" };
export const ENCAMINHAMENTO: Record<string, string> = { PDI: "PDI individual", PROCESSO: "Melhoria de processo (Governança)", FORMACAO_COLETIVA: "Formação coletiva (Academy)", APOIO_LIDERANCA: "Apoio da liderança", INFRAESTRUTURA: "Correção de infraestrutura (Operações)" };
export const TIPO_META: Record<string, string> = { OPERACIONAL: "Operacional", MELHORIA: "Melhoria", APRENDIZAGEM: "Aprendizagem", EXPLORATORIA: "Exploratória / inovação", COLETIVA: "Coletiva" };
export const DIRECAO_META: Record<string, string> = { MAIOR_MELHOR: "Maior é melhor", MENOR_MELHOR: "Menor é melhor", FAIXA: "Faixa desejável", BINARIO: "Binário (sim/não)", MARCOS: "Por marcos" };
export const APLICACAO_STATUS: Record<string, string> = { PENDENTE: "Aplicação pendente", APLICANDO: "Aplicando no trabalho", APLICADA: "Prática aplicada", NAO_APLICADA: "Não aplicada" };
export const RESULTADO_STATUS: Record<string, string> = { NAO_VERIFICADO: "Resultado não verificado", MELHORA_OBSERVADA: "Melhora observada", SEM_MUDANCA: "Sem mudança observada", INCONCLUSIVO: "Inconclusivo" };
export const OBS_STATUS: Record<string, string> = { PLANEJADA: "Observação planejada", OBSERVADA: "Observada", DEVOLUTIVA: "Devolutiva feita", FOCO: "Foco de desenvolvimento escolhido", APLICACAO: "Em aplicação", REOBSERVADA: "Nova observação feita" };
export const NIVEL_OBS: Record<number, string> = { 1: "Ainda não evidente", 2: "Em desenvolvimento", 3: "Consistente", 4: "Referência para a equipe" };

const notaValida = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 5;

function eixo(criterios: Criterio[], notas: Notas, ex: Eixo, mem: Memoria) {
  const cs = criterios.filter(c => c.eixo === ex); let soma = 0, pesoValido = 0, validos = 0;
  const pesoTotal = cs.reduce((a, c) => a + c.peso, 0); const pesoAplicavel = cs.filter(c => !(notas[c.id]?.na && notas[c.id]?.naAprovado)).reduce((a, c) => a + c.peso, 0);
  for (const c of cs) {
    const n = notas[c.id]; const push = (situacao: Situacao, nota: number | null = null) => mem.itens.push({ id: c.id, eixo: ex, titulo: c.titulo, peso: c.peso, nota, situacao, contestada: mem.contestados.includes(c.id) });
    if (n?.na) { if (n.naAprovado) { mem.naAprovados.push(c.id); push("NA_APROVADO"); } else { mem.naAguardando.push(c.id); push("NA_AGUARDANDO"); } continue; }
    if (n?.naoObservado) { mem.naoObservados.push(c.id); push("NAO_OBSERVADO"); continue; } // não observado ≠ não aplicável: continua no peso aplicável e reduz a cobertura
    if (n?.nota === undefined || n.nota === null) { mem.pendentes.push(c.id); push("PENDENTE"); continue; }
    if (!notaValida(n.nota)) { mem.invalidos.push(c.id); push("INVALIDO", n.nota); continue; } // zero ou fora da escala nunca vira nota
    soma += n.nota * c.peso; pesoValido += c.peso; validos++; push("OK", n.nota);
  }
  return { media: pesoValido > 0 ? soma / pesoValido : null, cobertura: { validos, total: cs.length, pesoValido, pesoTotal, pesoAplicavel, pct: pesoAplicavel > 0 ? 100 * pesoValido / pesoAplicavel : null } };
}

/** Motor oficial. R e A = média ponderada dos critérios válidos do eixo. N só existe se o modelo aprovado habilitar nota composta (N = pR×R + pA×A).
 *  Ausência, “não observado” e N/A nunca viram zero. Publicação exige: nada pendente, N/A aprovados, os dois eixos com base e cobertura ≥ mínimo configurado. */
export function calcular(criterios: Criterio[], notas: Notas, pesoResultados = 60, pesoAtitudes = 40, op: OpcoesCalculo = {}): Memoria {
  const composta = op.composta ?? false; const minimo = op.coberturaMinima ?? 50; const cob0: Cobertura = { validos: 0, total: 0, pesoValido: 0, pesoTotal: 0, pesoAplicavel: 0, pct: null };
  const mem: Memoria = { R: null, A: null, N: null, composta, provisoria: false, publicavel: false, baseInsuficiente: false, coberturaMinima: minimo, coberturaR: cob0, coberturaA: cob0, pendentes: [], naoObservados: [], naAguardando: [], naAprovados: [], invalidos: [], contestados: op.contestados ?? [], motivos: [], limitacoes: [], pesos: { resultados: pesoResultados, atitudes: pesoAtitudes }, itens: [] };
  if (composta && pesoResultados + pesoAtitudes !== 100) { mem.motivos.push("Pesos dos eixos precisam somar 100%."); return mem; }
  const r = eixo(criterios, notas, "RESULTADOS", mem); const a = eixo(criterios, notas, "ATITUDES", mem);
  criterios.filter(c => c.eixo === "TECNICA").forEach(c => { const n = notas[c.id]; mem.itens.push({ id: c.id, eixo: "TECNICA", titulo: c.titulo, peso: c.peso, nota: notaValida(n?.nota) ? n!.nota! : null, situacao: notaValida(n?.nota) ? "OK" : n?.na ? (n.naAprovado ? "NA_APROVADO" : "NA_AGUARDANDO") : n?.naoObservado ? "NAO_OBSERVADO" : "PENDENTE", contestada: mem.contestados.includes(c.id) }); });
  mem.R = r.media; mem.A = a.media; mem.coberturaR = r.cobertura; mem.coberturaA = a.cobertura;
  if (r.cobertura.total === 0) mem.motivos.push("Modelo sem critérios de Resultados."); if (a.cobertura.total === 0) mem.motivos.push("Modelo sem critérios de Atitudes.");
  if (mem.R === null && r.cobertura.total > 0) mem.motivos.push("Sem base para calcular Resultados (nenhum critério válido)."); if (mem.A === null && a.cobertura.total > 0) mem.motivos.push("Sem base para calcular Atitudes (nenhum critério válido).");
  for (const [nome, c] of [["Resultados", r.cobertura], ["Atitudes", a.cobertura]] as const) if (c.total > 0 && (c.pct === null || c.pct < minimo)) { mem.baseInsuficiente = true; mem.motivos.push(`Base insuficiente em ${nome}: ${c.pct === null ? 0 : Math.round(c.pct)}% do peso aplicável avaliado (mínimo configurado: ${minimo}%).`); }
  if (mem.invalidos.length) mem.motivos.push(`Nota fora da escala 1–5 em: ${mem.invalidos.join(", ")}.`);
  if (composta && mem.R !== null && mem.A !== null) mem.N = (pesoResultados / 100) * mem.R + (pesoAtitudes / 100) * mem.A;
  const completa = mem.pendentes.length === 0 && mem.naAguardando.length === 0 && mem.invalidos.length === 0;
  mem.publicavel = completa && mem.R !== null && mem.A !== null && !mem.baseInsuficiente; mem.provisoria = !mem.publicavel && (mem.R !== null || mem.A !== null);
  if (!completa) mem.motivos.push(`${mem.pendentes.length} critério(s) pendente(s)${mem.naAguardando.length ? `, ${mem.naAguardando.length} “não aplicável” aguardando aprovação` : ""}.`);
  if (mem.naoObservados.length) mem.limitacoes.push(`${mem.naoObservados.length} critério(s) não observado(s): fora do cálculo, reduzem a cobertura; não significam falha do colaborador.`);
  if (mem.naAprovados.length) mem.limitacoes.push(`${mem.naAprovados.length} critério(s) não aplicável(is) aprovado(s): peso redistribuído entre os demais do eixo.`);
  if (mem.contestados.length) mem.limitacoes.push(`Evidência contestada em ${mem.contestados.length} critério(s).`);
  if (!composta) mem.limitacoes.push("Modelo sem nota composta: o resultado é o perfil por eixo e por critério.");
  return mem;
}

export const arred = (v: number | null | undefined, casas = 1) => v === null || v === undefined ? null : Math.round(v * 10 ** casas) / 10 ** casas;
export const fmtNota = (v: number | null | undefined) => v === null || v === undefined ? "—" : (Math.round(v * 10) / 10).toFixed(1).replace(".", ",");

/** Faixas configuradas e versionadas no modelo (congeladas no ciclo). Padrão inicial: matriz 2/3/4; final 3/4. */
export type Faixas = { matriz: number[]; final: number[] };
export const FAIXAS_PADRAO: Faixas = { matriz: [2, 3, 4], final: [3, 4] };
export function validarFaixas(f: Faixas) { const ok = (l: number[], n: number) => l.length === n && l.every((v, i) => v > 1 && v <= 5 && (i === 0 || v > l[i - 1])); if (!ok(f.matriz, 3) || !ok(f.final, 2)) throw new Error("Faixas inválidas: limites crescentes entre 1 e 5 (matriz: 3 limites; nota final: 2 limites)."); return f; }
export function faixa(v: number, lim: number[] = FAIXAS_PADRAO.matriz): 1 | 2 | 3 | 4 { return v < lim[0] ? 1 : v < lim[1] ? 2 : v < lim[2] ? 3 : 4; }
export const FAIXA_LABEL: Record<number, string> = { 1: "Prioridade de desenvolvimento", 2: "Em desenvolvimento", 3: "Desempenho consistente", 4: "Desempenho elevado" };
/** Descrição do quadrante — descreve evidências do período, nunca a identidade da pessoa. */
export function descricaoQuadrante(A: number, R: number, lim: number[] = FAIXAS_PADRAO.matriz) {
  const fa = faixa(A, lim), fr = faixa(R, lim);
  if (fr === 4 && fa === 4) return "Resultados e atitudes elevados"; if (fr === 3 && fa === 3) return "Resultados e atitudes consistentes";
  if (fr > fa) return fr >= 3 ? "Resultados elevados; desenvolver colaboração e atitudes" : "Resultados à frente das atitudes; desenvolver ambos"; if (fa > fr) return fa >= 3 ? "Atitudes consistentes; desenvolver entregas" : "Atitudes à frente dos resultados; desenvolver ambos";
  return fr <= 2 ? "Resultados e atitudes em desenvolvimento" : "Resultados e atitudes consistentes";
}
export function faixaFinal(N: number, lim: number[] = FAIXAS_PADRAO.final): "DESTAQUE" | "CONSISTENTE" | "PRIORITARIO" { return N >= lim[1] ? "DESTAQUE" : N >= lim[0] ? "CONSISTENTE" : "PRIORITARIO"; }
export const FAIXA_FINAL_LABEL: Record<string, string> = { DESTAQUE: "Destaque no ciclo", CONSISTENTE: "Desempenho consistente", PRIORITARIO: "Desenvolvimento prioritário" };
/** Distribuição real em 3 faixas — somente sobre resultados finais válidos. Nenhuma cota é aplicada. */
export function distribuicao(notas: number[], lim: number[] = FAIXAS_PADRAO.final) { const d = { DESTAQUE: 0, CONSISTENTE: 0, PRIORITARIO: 0 }; notas.forEach(n => d[faixaFinal(n, lim)]++); const t = notas.length; return { ...d, total: t, pct: { DESTAQUE: t ? Math.round(100 * d.DESTAQUE / t) : null, CONSISTENTE: t ? Math.round(100 * d.CONSISTENTE / t) : null, PRIORITARIO: t ? Math.round(100 * d.PRIORITARIO / t) : null } }; }

/** Progresso de EXECUÇÃO do PDI: canceladas saem do denominador; sem ações válidas → null (nunca 100%). Aplicação e resultado são acompanhados à parte. */
export function progressoPdi(acoes: { status: string }[]) { const validas = acoes.filter(a => a.status !== "CANCELADA"); if (!validas.length) return null; return Math.round(100 * validas.filter(a => a.status === "CONCLUIDA").length / validas.length); }
/** Atraso só para ações em execução pelo colaborador; bloqueio institucional, espera por oportunidade/observação/validação não contam como atraso dele. */
export function acaoAtrasada(a: { status: string; prazo: string | null }, hoje: string) { return !!a.prazo && a.prazo < hoje && ["NAO_INICIADA", "EM_ANDAMENTO"].includes(a.status); }

/** eNPS = 100 × (promotores − detratores) ÷ respostas válidas; neutros no denominador; sem respostas → null. */
export function enps(respostas: number[]) { const v = respostas.filter(n => Number.isInteger(n) && n >= 0 && n <= 10); if (!v.length) return null; const p = v.filter(n => n >= 9).length, d = v.filter(n => n <= 6).length; return Math.round(100 * (p - d) / v.length); }

/** Interpretação de meta pela regra declarada — nunca “resultado ÷ meta” automático. Nota só com conversão aprovada antes do ciclo; exploratória, aprendizagem e coletiva não viram nota individual. */
export type MetaEntrada = { tipo: string; direcao: string; linhaBase: number | null; esperado: number | null; faixaMin: number | null; faixaMax: number | null; valorAtual: number | null; marcos: { titulo: string; feito: boolean }[] | null; conversao: { ate: number; nota: number }[] | null; conversaoAprovada: boolean };
export function interpretarMeta(m: MetaEntrada): { situacao: string; progresso: number | null; nota: number | null; alerta: string | null } {
  const v = m.valorAtual; let progresso: number | null = null; let situacao = "Sem dado atual"; let alerta: string | null = null;
  const alcancou = (x: number) => m.direcao === "MAIOR_MELHOR" ? x >= m.esperado! : x <= m.esperado!;
  switch (m.direcao) {
    case "BINARIO": if (v !== null) { progresso = v >= 1 ? 100 : 0; situacao = v >= 1 ? "Atingida" : "Não atingida"; } break;
    case "MARCOS": { const ms = m.marcos ?? []; if (!ms.length) { alerta = "Meta por marcos sem marcos cadastrados."; break; } const f = ms.filter(x => x.feito).length; progresso = 100 * f / ms.length; situacao = `${f} de ${ms.length} marco(s)`; break; }
    case "FAIXA": { if (m.faixaMin === null || m.faixaMax === null || m.faixaMin > m.faixaMax) { alerta = "Faixa desejável inválida ou incompleta."; break; } if (v === null) break; const dentro = v >= m.faixaMin && v <= m.faixaMax; situacao = dentro ? "Dentro da faixa desejável" : v < m.faixaMin ? "Abaixo da faixa desejável" : "Acima da faixa desejável"; progresso = dentro ? 100 : null; break; }
    case "MAIOR_MELHOR": case "MENOR_MELHOR": {
      if (m.esperado === null) { alerta = "Resultado esperado não definido."; break; }
      if (m.linhaBase === null) { alerta = "Sem situação inicial: não há denominador para medir avanço."; if (v !== null) situacao = alcancou(v) ? "Esperado alcançado" : "Esperado não alcançado"; break; }
      const den = m.direcao === "MAIOR_MELHOR" ? m.esperado - m.linhaBase : m.linhaBase - m.esperado;
      if (den <= 0) { alerta = den === 0 ? "Esperado igual à situação inicial: sem denominador válido." : "Esperado está na direção oposta à melhoria definida — revise a meta."; if (v !== null) situacao = alcancou(v) ? "Esperado alcançado" : "Esperado não alcançado"; break; }
      if (v === null) break; const num = m.direcao === "MAIOR_MELHOR" ? v - m.linhaBase : m.linhaBase - v; progresso = 100 * num / den;
      situacao = progresso >= 100 ? "Esperado alcançado" : progresso <= 0 ? "Sem avanço sobre a situação inicial" : "Em avanço"; break; }
    default: alerta = "Regra de interpretação não definida.";
  }
  let nota: number | null = null;
  if (["EXPLORATORIA", "APRENDIZAGEM"].includes(m.tipo)) { if (progresso !== null) alerta = alerta ?? "Objetivo exploratório/de aprendizagem: o percentual não vira nota; interprete pelo que foi aprendido e registrado."; }
  else if (m.tipo === "COLETIVA") { if (progresso !== null) alerta = alerta ?? "Meta coletiva: o resultado da equipe não vira nota individual; considere a contribuição registrada."; }
  else if (progresso !== null && m.conversaoAprovada && m.conversao?.length) { const tab = [...m.conversao].sort((x, y) => x.ate - y.ate); nota = (tab.find(t => progresso! <= t.ate) ?? tab[tab.length - 1]).nota; }
  return { situacao, progresso: progresso === null ? null : Math.round(progresso * 10) / 10, nota, alerta };
}
export function validarConversao(c: { ate: number; nota: number }[]) { if (!c.length) throw new Error("Tabela de conversão vazia."); c.forEach((t, i) => { if (!Number.isFinite(t.ate) || !Number.isInteger(t.nota) || t.nota < 1 || t.nota > 5) throw new Error("Cada faixa precisa de limite numérico e nota inteira de 1 a 5."); if (i && t.ate <= c[i - 1].ate) throw new Error("Limites da conversão precisam ser crescentes."); }); return c; }

/** Múltiplas fontes: 1) média dentro de cada grupo (só quem observou); 2) grupo só entra com o mínimo de respondentes; 3) entre grupos, pesos do grupo — nunca pelo número de respostas. */
export type RespostaFonte = Record<string, { nota?: number | null; naoObservado?: boolean }>;
export function agregarFontes(criterios: Criterio[], porGrupo: Record<string, RespostaFonte[]>, config: Record<string, { peso: number; minimo: number }>) {
  const grupos: Record<string, { respondentes: number; valido: boolean; medias: Record<string, number | null> }> = {};
  for (const [g, rs] of Object.entries(porGrupo)) { const cf = config[g]; const medias: Record<string, number | null> = {}; for (const c of criterios) { const ns = rs.map(r => r[c.id]).filter(x => x && !x.naoObservado && notaValida(x.nota)).map(x => x!.nota as number); medias[c.id] = ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : null; } grupos[g] = { respondentes: rs.length, valido: !!cf && rs.length >= cf.minimo, medias }; }
  const composto: Record<string, number | null> = {};
  for (const c of criterios) { let soma = 0, peso = 0; for (const [g, d] of Object.entries(grupos)) { const m = d.medias[c.id]; if (!d.valido || m === null) continue; soma += m * config[g].peso; peso += config[g].peso; } composto[c.id] = peso > 0 ? soma / peso : null; }
  return { grupos, composto };
}

/** Sinaliza (não corrige) textos genéricos ou repetidos — padrão que merece revisão humana. */
const GENERICOS = /^(ok|bom|boa|ótimo|otimo|regular|atende|atende bem|precisa melhorar|nada a declarar|sem comentários?|n\/?a|-+)\.?$/i;
export function textoGenerico(t: string | null | undefined) { const x = (t ?? "").trim(); return x.length > 0 && (x.length < 15 || GENERICOS.test(x)); }

/** Modelos iniciais por família (rascunhos — o RH homologa). */
export function modeloInicial(familia: string): Omit<Criterio, "id">[] {
  const at: Omit<Criterio, "id">[] = [
    { eixo: "ATITUDES", titulo: "Colaboração com a equipe", peso: 1, descricao: "Compartilha informações, ajuda colegas e participa das rotinas coletivas.", niveis: { 1: "Recusa-se a colaborar ou gera atritos frequentes", 3: "Colabora quando solicitado", 5: "Apoia a equipe de forma espontânea e documentada" }, evidencia: "Registros de reuniões, projetos conjuntos, relatos de colegas" },
    { eixo: "ATITUDES", titulo: "Responsabilidade e cumprimento de procedimentos", peso: 1, descricao: "Cumpre prazos, POPs e combinados; comunica impedimentos.", niveis: { 1: "Descumpre prazos e procedimentos com frequência", 3: "Cumpre o esperado com lembretes ocasionais", 5: "Cumpre e ajuda a melhorar os procedimentos" }, evidencia: "Ciência de POPs, prazos atendidos, ocorrências" },
    { eixo: "ATITUDES", titulo: "Comunicação respeitosa", peso: 1, descricao: "Com alunos, famílias e colegas — escuta, clareza e cordialidade.", niveis: { 1: "Comunicação gera reclamações recorrentes", 3: "Comunicação adequada", 5: "Referência de comunicação para a equipe" }, evidencia: "Casos de atendimento, elogios, registros" },
    { eixo: "ATITUDES", titulo: "Prática dos valores institucionais (Verdade, Afetividade, Motivação, Criatividade, Segurança, Aprendizagem, Confiança)", peso: 1, descricao: "Avaliar práticas observáveis — nunca crenças, afinidade pessoal ou demonstrações de entusiasmo.", niveis: { 3: "Práticas coerentes com os valores no dia a dia", 5: "Práticas exemplares, com situações registradas" }, evidencia: "Situações concretas registradas no período" },
  ];
  const por: Record<string, Omit<Criterio, "id">[]> = {
    PROFESSORES: [
      { eixo: "RESULTADOS", titulo: "Planejamento das aulas", peso: 1, descricao: "Planos entregues no prazo, alinhados ao currículo e ao projeto pedagógico.", niveis: { 1: "Planos ausentes ou desalinhados", 3: "Planos completos e no prazo", 5: "Planos exemplares, reutilizados pela equipe" }, evidencia: "Planos no sistema/Drive, checagem da coordenação" },
      { eixo: "RESULTADOS", titulo: "Qualidade das devolutivas aos alunos", peso: 1, descricao: "Correções e comentários que orientam a aprendizagem.", niveis: { 1: "Devolutivas ausentes ou genéricas", 3: "Devolutivas regulares e claras", 5: "Devolutivas personalizadas com evidência de avanço" }, evidencia: "Amostras de correção, observação de aula" },
      { eixo: "RESULTADOS", titulo: "Acompanhamento da aprendizagem", peso: 1, descricao: "Identifica dificuldades, propõe intervenções e registra. Não usar nota bruta dos alunos como medida exclusiva.", niveis: { 3: "Acompanha e intervém quando necessário", 5: "Acompanhamento sistemático com plano por aluno" }, evidencia: "Registros de intervenção, conselhos de classe" },
      { eixo: "RESULTADOS", titulo: "Cumprimento de registros pedagógicos", peso: 1, descricao: "Diários, frequência e notas lançados no prazo.", niveis: { 1: "Registros atrasados com frequência", 3: "Registros em dia", 5: "Registros em dia e completos, sem retrabalho" }, evidencia: "Relatórios do sistema acadêmico" },
      ...at,
      { eixo: "TECNICA", titulo: "Domínio do conteúdo e metodologias", peso: 1, descricao: "Competência técnica — orienta o PDI, não entra no cálculo dos eixos.", niveis: {}, evidencia: "Formações, observação de aula" }],
    COORDENACAO: [
      { eixo: "RESULTADOS", titulo: "Acompanhamento dos professores", peso: 1, descricao: "Observações de aula, devolutivas e planos de melhoria.", niveis: { 3: "Acompanhamento regular", 5: "Acompanhamento com evolução documentada" }, evidencia: "Registros de observação, 1:1" },
      { eixo: "RESULTADOS", titulo: "Resultados de aprendizagem da unidade", peso: 1, descricao: "Metas pactuadas de aprendizagem e intervenções, considerando o contexto.", niveis: { 3: "Metas acompanhadas e intervenções feitas", 5: "Metas superadas com plano documentado" }, evidencia: "Conselhos de classe, relatórios" },
      { eixo: "RESULTADOS", titulo: "Relação com as famílias", peso: 1, descricao: "Casos tratados no prazo, retenção, NPS.", niveis: { 3: "SLA cumprido na maioria", 5: "Casos resolvidos com causa raiz e famílias retidas" }, evidencia: "Módulo de atendimento" },
      ...at, { eixo: "TECNICA", titulo: "Liderança pedagógica", peso: 1, descricao: "Orienta o PDI.", niveis: {}, evidencia: "Feedbacks da equipe" }],
    SECRETARIA: [
      { eixo: "RESULTADOS", titulo: "Documentação escolar em dia", peso: 1, descricao: "Matrículas, transferências, históricos e declarações no prazo e sem erro.", niveis: { 3: "Documentação em dia", 5: "Zero pendências e zero retrabalho no período" }, evidencia: "Pendências no sistema, auditorias" },
      { eixo: "RESULTADOS", titulo: "Atendimento a famílias e alunos", peso: 1, descricao: "Prazo e qualidade das respostas.", niveis: { 3: "Atende dentro do prazo", 5: "Atendimento elogiado, sem reclamações" }, evidencia: "Casos, CSAT" },
      { eixo: "RESULTADOS", titulo: "Cumprimento dos POPs da secretaria", peso: 1, descricao: "Processos executados conforme o procedimento.", niveis: { 3: "Cumpre", 5: "Cumpre e propõe melhorias" }, evidencia: "Controles e exceções" },
      ...at, { eixo: "TECNICA", titulo: "Domínio dos sistemas (ActiveSoft, STATUS ONE)", peso: 1, descricao: "Orienta o PDI.", niveis: {}, evidencia: "Treinamentos" }],
    ATENDIMENTO_COMERCIAL: [
      { eixo: "RESULTADOS", titulo: "Conversão de visitas em matrículas", peso: 1, descricao: "Meta pactuada considerando sazonalidade e unidade.", niveis: { 3: "Meta atingida", 5: "Meta superada com qualidade" }, evidencia: "Funil de matrículas" },
      { eixo: "RESULTADOS", titulo: "Rematrícula e retenção", peso: 1, descricao: "Famílias retidas nos pedidos de saída.", niveis: { 3: "Retenção na meta", 5: "Retenção acima da meta com registro" }, evidencia: "Módulo de atendimento" },
      { eixo: "RESULTADOS", titulo: "Registro e follow-up", peso: 1, descricao: "Casos e contatos registrados no prazo.", niveis: { 3: "Registros em dia", 5: "Registros completos e follow-up proativo" }, evidencia: "Casos, mensagens" },
      ...at, { eixo: "TECNICA", titulo: "Técnica de atendimento e negociação", peso: 1, descricao: "Orienta o PDI.", niveis: {}, evidencia: "Observação, treinamentos" }],
    APOIO_OPERACIONAL: [
      { eixo: "RESULTADOS", titulo: "Qualidade e prazo das tarefas", peso: 1, descricao: "Rotinas de limpeza, manutenção, inspeção, cozinha conforme padrão.", niveis: { 3: "Padrão atendido", 5: "Padrão superado, sem retrabalho" }, evidencia: "Vistorias, chamados" },
      { eixo: "RESULTADOS", titulo: "Segurança e cuidado com alunos", peso: 1, descricao: "Procedimentos de segurança cumpridos.", niveis: { 3: "Cumpre", 5: "Antecipa riscos e registra" }, evidencia: "Ocorrências, vistorias" },
      { eixo: "RESULTADOS", titulo: "Uso correto de materiais e equipamentos", peso: 1, descricao: "Sem desperdício ou dano por mau uso.", niveis: { 3: "Adequado", 5: "Exemplar" }, evidencia: "Ativos, chamados" },
      ...at, { eixo: "TECNICA", titulo: "Conhecimento dos procedimentos operacionais", peso: 1, descricao: "Orienta o PDI.", niveis: {}, evidencia: "Treinamentos, ciência de POPs" }],
    GESTAO: [
      { eixo: "RESULTADOS", titulo: "Metas da área (OKRs pactuados)", peso: 1, descricao: "Resultados-chave sob responsabilidade.", niveis: { 3: "Metas atingidas", 5: "Metas superadas" }, evidencia: "Módulo de estratégia" },
      { eixo: "RESULTADOS", titulo: "Desenvolvimento da equipe", peso: 1, descricao: "1:1, avaliações e PDIs em dia.", niveis: { 3: "Rotinas em dia", 5: "Equipe com evolução documentada" }, evidencia: "Desempenho, PDIs" },
      { eixo: "RESULTADOS", titulo: "Processos e conformidade", peso: 1, descricao: "POPs vigentes, controles executados, exceções controladas.", niveis: { 3: "Conforme", 5: "Referência de processo" }, evidencia: "Governança" },
      ...at, { eixo: "TECNICA", titulo: "Gestão e liderança", peso: 1, descricao: "Orienta o PDI.", niveis: {}, evidencia: "Feedbacks, resultados" }],
  };
  return por[familia] ?? por.APOIO_OPERACIONAL;
}
