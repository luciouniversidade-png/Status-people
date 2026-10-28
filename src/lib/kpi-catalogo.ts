/**
 * Catálogo de indicadores do ONE (v23 · ONE Insights) — definições puras, sem acesso ao banco.
 * Cada indicador diz o que mede, como é calculado, de onde vem, em que sentido é melhor e como acumula no ano.
 * O cálculo de cada um fica em kpi-calc.ts; a leitura, as metas e o resumo ficam em kpi.ts.
 */
import type { Settings } from "./utils";
import { type UnidadeKpi, fmtKpi, variacao, rotuloMes, mesPorExtenso } from "./formato";
import { farol, somaMeses, type Farol, type Direcao } from "./gestao-calc";

export type AreaKpi = "pessoas" | "matriculas" | "financeiro" | "operacoes" | "estrategia";
export const AREAS: Record<AreaKpi, { nome: string; curto: string; descricao: string }> = {
  pessoas: { nome: "Pessoas", curto: "Pessoas", descricao: "Quadro, movimentação, absenteísmo, clima, desempenho, treinamento e substituições." },
  matriculas: { nome: "Matrículas e famílias", curto: "Matrículas", descricao: "Ocupação, rematrícula, captação, satisfação e permanência das famílias." },
  financeiro: { nome: "Financeiro", curto: "Financeiro", descricao: "Caixa, resultado, recebimento, inadimplência e custo de pessoal." },
  operacoes: { nome: "Operações", curto: "Operações", descricao: "Chamados, prazos, vistorias, custo de manutenção e aprovações." },
  estrategia: { nome: "Estratégia e governança", curto: "Estratégia", descricao: "OKRs, plano de ação, projetos, rituais, não conformidades e LGPD." },
};
export const ORDEM_AREAS: AreaKpi[] = ["pessoas", "matriculas", "financeiro", "operacoes", "estrategia"];

/**
 * SOMA: fluxo do mês (soma as unidades e acumula no ano).
 * ESTOQUE: retrato no fim do mês (soma as unidades; no ano vale o último mês).
 * TAXA: razão numerador ÷ denominador (rede e acumulado recalculados pelas somas, nunca pela média das unidades).
 */
export type Agregacao = "SOMA" | "ESTOQUE" | "TAXA";
/** RECONSTRUIDO: recalculado mês a mês a partir dos registros datados. RETRATO: foto do momento, guardada todo dia (o histórico começa quando a base é ligada). EVENTO: medição pontual (pesquisa, ciclo) — vale a última. */
export type Historico = "RECONSTRUIDO" | "RETRATO" | "EVENTO";
export type Sentido = "SUBIR" | "DESCER" | "NEUTRO";
/** Restrições além da área: SALARIAL (Direção, RH e Financeiro) e PRIVACIDADE (Direção e RH). */
export type Restricao = "SALARIAL" | "PRIVACIDADE";

export type KpiDef = {
  chave: string; nome: string; area: AreaKpi; unidade: UnidadeKpi; sentido: Sentido; agregacao: Agregacao; historico: Historico;
  fator?: number;                 // TAXA: multiplica num ÷ den (100 = percentual)
  formula: string; fonte: string; obs?: string;
  restricao?: Restricao;
  porUnidade?: boolean;           // padrão true: tem quebra por unidade
  zeroFill?: boolean;             // padrão: SOMA e ESTOQUE preenchem com zero os meses sem registro (depois do início dos dados)
  redeDireta?: boolean;           // o valor da rede vem do próprio cálculo (não é a soma das unidades)
  minimoDen?: (c: Settings) => number; // abaixo deste denominador o valor não aparece (anonimato)
  destaque?: number;              // ordem na aba Geral (menor primeiro)
  metaPadrao?: (c: Settings) => number | null;
  metaOrcamento?: "ENTRADA" | "SAIDA" | "RESULTADO"; // sem meta cadastrada, a meta do mês vem do orçamento
  sufixoAno?: boolean;            // nome recebe o ano letivo em matrícula (ex.: "Ocupação das vagas 2027")
  href?: string;                  // onde agir
};

/** Aumente sempre que um cálculo mudar: a base é reconstruída por inteiro na próxima leitura. */
export const CATALOGO_VERSAO = "30.0";

const pct = 100;
export const CATALOGO: KpiDef[] = [
  // ------------------------------------------------------------------ Pessoas
  { chave: "pessoas.quadro", nome: "Colaboradores ativos", area: "pessoas", unidade: "n", sentido: "NEUTRO", agregacao: "ESTOQUE", historico: "RECONSTRUIDO", destaque: 6,
    formula: "Pessoas admitidas até o fim do mês e não desligadas até ele (fora quem ainda está em admissão).", fonte: "Pessoas → Colaboradores (data de admissão e de desligamento)", obs: "A unidade é a atual do colaborador: transferências antigas não mudam o histórico.", href: "/colaboradores" },
  { chave: "pessoas.admissoes", nome: "Admissões", area: "pessoas", unidade: "n", sentido: "NEUTRO", agregacao: "SOMA", historico: "RECONSTRUIDO",
    formula: "Colaboradores com data de admissão no mês.", fonte: "Pessoas → Colaboradores", href: "/processos?tipo=ADMISSAO" },
  { chave: "pessoas.desligamentos", nome: "Desligamentos", area: "pessoas", unidade: "n", sentido: "DESCER", agregacao: "SOMA", historico: "RECONSTRUIDO",
    formula: "Colaboradores com data de desligamento no mês.", fonte: "Pessoas → Colaboradores", href: "/processos?tipo=DESLIGAMENTO" },
  { chave: "pessoas.turnover", nome: "Turnover (12 meses)", area: "pessoas", unidade: "%", sentido: "DESCER", agregacao: "TAXA", fator: pct, historico: "RECONSTRUIDO", destaque: 7,
    formula: "Desligamentos nos 12 meses até o fim do mês ÷ colaboradores ativos no fim do mês × 100.", fonte: "Pessoas → Colaboradores", metaPadrao: c => c.analytics.metas.turnoverAnualPct, href: "/analytics" },
  { chave: "pessoas.absenteismo", nome: "Absenteísmo", area: "pessoas", unidade: "%", sentido: "DESCER", agregacao: "TAXA", fator: pct, historico: "RECONSTRUIDO",
    formula: "Faltas ÷ dias com jornada prevista no mês × 100 (atestados abonados ficam fora).", fonte: "Pessoas → Ponto e jornada", obs: "Mês sem folha de ponto importada fica sem medição.", metaPadrao: c => c.analytics.metas.absenteismoPct, href: "/ponto" },
  { chave: "pessoas.horas_extras", nome: "Horas extras aprovadas", area: "pessoas", unidade: "h", sentido: "DESCER", agregacao: "SOMA", historico: "RECONSTRUIDO",
    formula: "Soma das horas extras aprovadas lançadas no mês.", fonte: "Pessoas → Banco de horas", href: "/banco-de-horas" },
  { chave: "pessoas.banco_horas", nome: "Saldo do banco de horas", area: "pessoas", unidade: "h", sentido: "NEUTRO", agregacao: "ESTOQUE", historico: "RECONSTRUIDO",
    formula: "Soma dos saldos aprovados até o fim do mês dos colaboradores ativos (positivo = a escola deve horas; negativo = a equipe deve).", fonte: "Pessoas → Banco de horas", href: "/banco-de-horas" },
  { chave: "pessoas.enps", nome: "eNPS", area: "pessoas", unidade: "pts", sentido: "SUBIR", agregacao: "TAXA", fator: pct, historico: "EVENTO",
    formula: "(promotores − detratores) ÷ respostas × 100, na pesquisa encerrada no mês.", fonte: "Pessoas → Clima e eNPS", obs: "Unidade com menos respostas que o mínimo de anonimato não mostra resultado.", minimoDen: c => c.clima.minimoAnonimato, metaPadrao: c => c.analytics.metas.enps, href: "/clima" },
  { chave: "pessoas.desempenho", nome: "Desempenho médio", area: "pessoas", unidade: "nota", sentido: "SUBIR", agregacao: "TAXA", fator: 1, historico: "EVENTO",
    formula: "Média da nota final das avaliações do ciclo encerrado no mês.", fonte: "Pessoas → Desempenho", obs: "Unidade com menos de 3 avaliações não mostra resultado.", minimoDen: () => 3, metaPadrao: c => c.analytics.metas.desempenho, href: "/desempenho" },
  { chave: "pessoas.treinamento", nome: "Treinamentos obrigatórios em dia", area: "pessoas", unidade: "%", sentido: "SUBIR", agregacao: "TAXA", fator: pct, historico: "RETRATO",
    formula: "Treinamentos obrigatórios concluídos e válidos ÷ treinamentos obrigatórios exigidos da equipe ativa × 100.", fonte: "Pessoas → Academy (matriz de treinamento)", metaPadrao: c => c.analytics.metas.treinamentoPct, href: "/academy" },
  { chave: "pessoas.vagas_abertas", nome: "Vagas abertas", area: "pessoas", unidade: "n", sentido: "DESCER", agregacao: "ESTOQUE", historico: "RECONSTRUIDO",
    formula: "Posições em seleção no fim do mês (abertas e ainda não preenchidas).", fonte: "Pessoas → Recrutamento", obs: "Vaga cancelada sem data de fechamento fica fora do histórico.", href: "/recrutamento" },
  { chave: "pessoas.tempo_contratacao", nome: "Tempo para preencher vaga", area: "pessoas", unidade: "dias", sentido: "DESCER", agregacao: "TAXA", fator: 1, historico: "RECONSTRUIDO",
    formula: "Média de dias entre a abertura e o preenchimento das vagas preenchidas no mês.", fonte: "Pessoas → Recrutamento", href: "/recrutamento" },
  { chave: "pessoas.cobertura_aulas", nome: "Aulas cobertas por professor", area: "pessoas", unidade: "%", sentido: "SUBIR", agregacao: "TAXA", fator: pct, historico: "RECONSTRUIDO",
    formula: "Aulas com ausência que tiveram professor substituto ÷ aulas com ausência no mês × 100.", fonte: "Pessoas → Substituição de professores", href: "/cobertura/historico" },
  { chave: "pessoas.alunos_professor", nome: "Alunos por professor", area: "pessoas", unidade: "x", sentido: "NEUTRO", agregacao: "TAXA", fator: 1, historico: "RETRATO",
    formula: "Alunos atuais ÷ professores ativos (regime docente).", fonte: "Matrículas → Alunos e Pessoas → Colaboradores", href: "/analytics" },
  // v24 · dicionário da Nova Arquitetura (Cap. 34): KPI-16, 18, 21, 22, 25 e 27
  { chave: "pessoas.fte", nome: "FTE (equivalente em jornada plena)", area: "pessoas", unidade: "x", sentido: "NEUTRO", agregacao: "ESTOQUE", historico: "RECONSTRUIDO",
    formula: "Soma das jornadas diárias dos colaboradores ativos no fim do mês ÷ jornada plena (528 min = 44 h semanais em 5 dias).", fonte: "Pessoas → Colaboradores (jornada)", obs: "KPI-16. Quem está sem jornada cadastrada conta como jornada plena — confira em Posições e quadro.", href: "/quadro" },
  { chave: "pessoas.turnover90", nome: "Turnover de 90 dias", area: "pessoas", unidade: "%", sentido: "DESCER", agregacao: "TAXA", fator: pct, historico: "RECONSTRUIDO",
    formula: "Desligados com menos de 90 dias de casa nos 12 meses até o fim do mês ÷ admitidos no mesmo período × 100.", fonte: "Pessoas → Colaboradores", obs: "KPI-18 — qualidade da contratação.", href: "/onboarding" },
  { chave: "pessoas.ferias_vencendo", nome: "Férias a vencer em 60 dias", area: "pessoas", unidade: "n", sentido: "DESCER", agregacao: "ESTOQUE", historico: "RETRATO",
    formula: "Períodos concessivos com saldo que vencem em até 60 dias (ou já vencidos) entre os colaboradores ativos.", fonte: "Pessoas → Férias e afastamentos", obs: "KPI-21 — meta: zero vencidas.", href: "/ferias" },
  { chave: "pessoas.admissoes_prazo", nome: "Admissões concluídas no prazo", area: "pessoas", unidade: "%", sentido: "SUBIR", agregacao: "TAXA", fator: pct, historico: "RECONSTRUIDO", metaPadrao: () => 100,
    formula: "Checklists de admissão concluídos até o prazo ÷ admissões concluídas no mês × 100.", fonte: "Pessoas → Admissões e desligamentos", obs: "KPI-22.", href: "/processos?tipo=ADMISSAO" },
  { chave: "pessoas.ciclo_prazo", nome: "Etapas do ciclo de avaliação no prazo", area: "pessoas", unidade: "%", sentido: "SUBIR", agregacao: "TAXA", fator: pct, historico: "RECONSTRUIDO", porUnidade: false, metaPadrao: () => 100,
    formula: "Etapas do ciclo encerradas até o fim da janela ÷ etapas com janela terminando no mês × 100.", fonte: "Pessoas → Desempenho (etapas do ciclo)", obs: "KPI-25.", href: "/desempenho" },
  { chave: "pessoas.sucessao", nome: "Posições críticas com sucessor", area: "pessoas", unidade: "%", sentido: "SUBIR", agregacao: "TAXA", fator: pct, historico: "RETRATO", restricao: "PRIVACIDADE",
    formula: "Posições críticas com ao menos um sucessor pronto agora ou em 1–2 anos ÷ posições críticas × 100.", fonte: "Pessoas → Sucessão e talentos", obs: "KPI-27. Restrito a Direção e RH.", href: "/sucessao" },
  // v30 · capital humano (no estilo dos painéis de indicadores das plataformas de RH): retorno do custo de pessoal, receita por pessoa, amplitude de controle,
  // mulheres na liderança, qualidade da contratação, horas de treinamento, promoções, aceite de propostas e o índice de liderança
  { chave: "pessoas.hcroi", nome: "HCROI (retorno do custo de pessoal)", area: "pessoas", unidade: "x", sentido: "SUBIR", agregacao: "TAXA", fator: 1, historico: "RECONSTRUIDO", restricao: "SALARIAL",
    formula: "(Receita − despesas operacionais sem pessoal) ÷ custo de pessoal REAL do mês. Ex.: 1,8 = cada R$ 1 investido em pessoas volta como R$ 1,80 de resultado antes do custo de pessoal.", fonte: "Financeiro → Fluxo de caixa (sem transferências internas, financeiras e não-despesas) e Pessoas → Ciclo da folha (resultado aceito)", obs: "Mês sem resultado aceito da folha fica sem valor.", href: "/folha/custo" },
  { chave: "pessoas.receita_colaborador", nome: "Receita por colaborador", area: "pessoas", unidade: "R$", sentido: "SUBIR", agregacao: "TAXA", fator: 1, historico: "RECONSTRUIDO", restricao: "SALARIAL",
    formula: "Receita de caixa do mês (sem transferências internas) ÷ colaboradores ativos no fim do mês.", fonte: "Financeiro → Fluxo de caixa e Pessoas → Colaboradores", href: "/analytics" },
  { chave: "pessoas.amplitude", nome: "Amplitude de controle", area: "pessoas", unidade: "x", sentido: "NEUTRO", agregacao: "TAXA", fator: 1, historico: "RETRATO",
    formula: "Colaboradores ativos com gestor direto ÷ gestores com ao menos um liderado ativo.", fonte: "Pessoas → Colaboradores (gestor direto) e Organograma", obs: "Foto do dia: o histórico começa quando a base é ligada. Muito alta = gestor sobrecarregado; muito baixa = camadas demais.", href: "/organograma" },
  { chave: "pessoas.mulheres_lideranca", nome: "Mulheres na liderança", area: "pessoas", unidade: "%", sentido: "NEUTRO", agregacao: "TAXA", fator: pct, historico: "RETRATO", restricao: "PRIVACIDADE",
    formula: "Mulheres em cargos de liderança (famílias de cargo de liderança, Configurações → Igualdade) ÷ pessoas nesses cargos com sexo informado × 100.", fonte: "Pessoas → Colaboradores (sexo eSocial) e Cargos", obs: "Grupo com menos pessoas que o mínimo não mostra resultado.", minimoDen: c => Number(c.igualdade?.grupoMinimo ?? 3), href: "/analytics/igualdade" },
  { chave: "pessoas.qualidade_contratacao", nome: "Qualidade da contratação", area: "pessoas", unidade: "pts", sentido: "SUBIR", agregacao: "TAXA", fator: 1, historico: "RECONSTRUIDO",
    formula: "Média do índice (0–100) das pessoas contratadas pela seleção, pelo mês de admissão: retenção no prazo configurado, nota do gestor aos 90 dias e 1ª avaliação de desempenho.", fonte: "Pessoas → Recrutamento (contratação aos 90 dias) e Desempenho", obs: "O índice sai com pelo menos dois componentes — meses recentes completam com o tempo.", href: "/recrutamento/indicadores" },
  { chave: "pessoas.horas_treinamento", nome: "Horas de treinamento por colaborador", area: "pessoas", unidade: "h", sentido: "SUBIR", agregacao: "TAXA", fator: 1, historico: "RECONSTRUIDO",
    formula: "Carga horária dos treinamentos concluídos no mês (sem ciência de POP) ÷ colaboradores ativos no fim do mês.", fonte: "Pessoas → Academy", href: "/academy/painel" },
  { chave: "pessoas.promocoes", nome: "Promoções (12 meses)", area: "pessoas", unidade: "%", sentido: "NEUTRO", agregacao: "TAXA", fator: pct, historico: "RECONSTRUIDO",
    formula: "Promoções registradas no histórico funcional nos 12 meses até o fim do mês ÷ colaboradores ativos no fim do mês × 100.", fonte: "Pessoas → Histórico funcional (ficha)", obs: "A unidade é a atual do colaborador.", href: "/analytics/composicao" },
  { chave: "pessoas.aceite_propostas", nome: "Aceite de propostas", area: "pessoas", unidade: "%", sentido: "SUBIR", agregacao: "TAXA", fator: pct, historico: "RECONSTRUIDO",
    formula: "Propostas aceitas ÷ propostas respondidas (aceitas + recusadas) no mês × 100.", fonte: "Pessoas → Recrutamento (etapa Proposta)", href: "/recrutamento/indicadores" },
  { chave: "pessoas.lideranca", nome: "Índice de liderança", area: "pessoas", unidade: "%", sentido: "SUBIR", agregacao: "TAXA", fator: pct, historico: "EVENTO",
    formula: "Média, por respondente, das respostas favoráveis (4–5) na pesquisa de liderança encerrada no mês × 100.", fonte: "Pessoas → Clima (pesquisa de liderança)", obs: "Unidade com menos respostas que o mínimo de anonimato não mostra resultado.", minimoDen: c => c.clima.minimoAnonimato, href: "/clima" },

  // ------------------------------------------------------------------ Matrículas e famílias
  { chave: "matriculas.ocupacao", nome: "Ocupação das vagas", area: "matriculas", unidade: "%", sentido: "SUBIR", agregacao: "TAXA", fator: pct, historico: "RECONSTRUIDO", destaque: 1, sufixoAno: true,
    formula: "(matrículas confirmadas + reservas válidas no fim do mês) ÷ vagas regulares do ano letivo em matrícula × 100.", fonte: "Matrículas → Turmas e reservas", obs: "Vagas = capacidade atual das turmas. Matrícula cancelada sai de todo o histórico (a data do cancelamento não é guardada).", metaPadrao: c => c.commandCenter.metaOcupacaoPct, href: "/matriculas" },
  { chave: "matriculas.rematricula", nome: "Rematrícula", area: "matriculas", unidade: "%", sentido: "SUBIR", agregacao: "TAXA", fator: pct, historico: "RECONSTRUIDO", destaque: 2, sufixoAno: true,
    formula: "Alunos atuais com matrícula confirmada ou reserva válida para o ano letivo em matrícula ÷ alunos atuais × 100.", fonte: "Matrículas → Rematrícula", obs: "Base: alunos atuais de hoje (o histórico mostra o ritmo da campanha).", metaPadrao: c => Number((c.matriculas as { metaRematriculaPct?: number }).metaRematriculaPct ?? 85), href: "/matriculas/metas" },
  { chave: "matriculas.alunos", nome: "Alunos atuais", area: "matriculas", unidade: "n", sentido: "SUBIR", agregacao: "ESTOQUE", historico: "RETRATO",
    formula: "Alunos marcados como alunos atuais da rede.", fonte: "Matrículas → Alunos", href: "/matriculas/alunos" },
  { chave: "matriculas.novas", nome: "Matrículas novas", area: "matriculas", unidade: "n", sentido: "SUBIR", agregacao: "SOMA", historico: "RECONSTRUIDO",
    formula: "Alunos de captação (não rematrícula) com a primeira matrícula confirmada no mês.", fonte: "Matrículas → Reservas e matrículas", href: "/estrategia/marketing" },
  { chave: "matriculas.candidatos", nome: "Candidatos cadastrados", area: "matriculas", unidade: "n", sentido: "SUBIR", agregacao: "SOMA", historico: "RECONSTRUIDO",
    formula: "Candidatos de captação cadastrados no mês (números agregados — não é cadastro de leads).", fonte: "Matrículas → Alunos e candidatos", href: "/estrategia/marketing" },
  { chave: "matriculas.lista_espera", nome: "Lista de espera", area: "matriculas", unidade: "n", sentido: "NEUTRO", agregacao: "ESTOQUE", historico: "RETRATO",
    formula: "Famílias aguardando vaga ou com vaga ofertada.", fonte: "Matrículas → Lista de espera", href: "/matriculas/fila" },
  { chave: "matriculas.cancelamentos", nome: "Matrículas canceladas", area: "matriculas", unidade: "n", sentido: "DESCER", agregacao: "SOMA", historico: "RECONSTRUIDO",
    formula: "Matrículas e reservas canceladas no mês.", fonte: "Matrículas → Reservas", obs: "Usa a data da última alteração do registro cancelado.", href: "/matriculas/reservas" },
  { chave: "familias.nps", nome: "NPS das famílias", area: "matriculas", unidade: "pts", sentido: "SUBIR", agregacao: "TAXA", fator: pct, historico: "RECONSTRUIDO", destaque: 8,
    formula: "(promotores, notas 9–10 − detratores, notas 0–6) ÷ respostas do mês × 100.", fonte: "Atendimento → Pesquisas NPS", href: "/atendimento/pesquisas" },
  { chave: "familias.reclamacoes", nome: "Reclamações registradas", area: "matriculas", unidade: "n", sentido: "DESCER", agregacao: "SOMA", historico: "RECONSTRUIDO",
    formula: "Casos do tipo reclamação abertos no mês.", fonte: "Atendimento → Casos", href: "/atendimento/casos" },
  { chave: "familias.casos_prazo", nome: "Casos resolvidos no prazo", area: "matriculas", unidade: "%", sentido: "SUBIR", agregacao: "TAXA", fator: pct, historico: "RECONSTRUIDO",
    formula: "Casos resolvidos no mês dentro do SLA ÷ casos resolvidos no mês com SLA × 100.", fonte: "Atendimento → Casos", href: "/atendimento" },
  { chave: "familias.retencao", nome: "Retenção nos pedidos de saída", area: "matriculas", unidade: "%", sentido: "SUBIR", agregacao: "TAXA", fator: pct, historico: "RECONSTRUIDO",
    formula: "Famílias retidas ÷ pedidos de saída concluídos no mês (retidas + perdidas) × 100.", fonte: "Atendimento → Casos de saída", href: "/atendimento/risco" },
  { chave: "familias.saidas", nome: "Pedidos de saída", area: "matriculas", unidade: "n", sentido: "DESCER", agregacao: "SOMA", historico: "RECONSTRUIDO",
    formula: "Casos de pedido de saída ou transferência abertos no mês.", fonte: "Atendimento → Casos", href: "/atendimento/risco" },
  { chave: "familias.contato", nome: "Famílias com contato recente", area: "matriculas", unidade: "%", sentido: "SUBIR", agregacao: "TAXA", fator: pct, historico: "RETRATO",
    formula: "Famílias de alunos atuais com contato registrado no período configurado ÷ famílias de alunos atuais × 100.", fonte: "Atendimento → Radar da família", href: "/atendimento/radar" },

  // ------------------------------------------------------------------ Financeiro
  { chave: "financeiro.receita", nome: "Receita (entradas de caixa)", area: "financeiro", unidade: "R$", sentido: "SUBIR", agregacao: "SOMA", historico: "RECONSTRUIDO", destaque: 3, metaOrcamento: "ENTRADA",
    formula: "Soma das entradas de caixa do mês.", fonte: "Financeiro → Fluxo de caixa (importado ou lançado)", obs: "Sem meta cadastrada, compara com o orçamento de receitas do mês.", href: "/financeiro/orcamento" },
  { chave: "financeiro.despesa", nome: "Despesas (saídas de caixa)", area: "financeiro", unidade: "R$", sentido: "DESCER", agregacao: "SOMA", historico: "RECONSTRUIDO", metaOrcamento: "SAIDA",
    formula: "Soma das saídas de caixa do mês.", fonte: "Financeiro → Fluxo de caixa", obs: "Sem meta cadastrada, compara com o orçamento de despesas do mês.", href: "/financeiro/orcamento" },
  { chave: "financeiro.resultado", nome: "Resultado de caixa", area: "financeiro", unidade: "R$", sentido: "SUBIR", agregacao: "SOMA", historico: "RECONSTRUIDO", destaque: 5, metaOrcamento: "RESULTADO",
    formula: "Entradas − saídas de caixa do mês.", fonte: "Financeiro → Fluxo de caixa", href: "/financeiro/orcamento" },
  { chave: "financeiro.margem", nome: "Margem de caixa", area: "financeiro", unidade: "%", sentido: "SUBIR", agregacao: "TAXA", fator: pct, historico: "RECONSTRUIDO",
    formula: "Resultado de caixa ÷ entradas do mês × 100.", fonte: "Financeiro → Fluxo de caixa", href: "/financeiro/orcamento" },
  { chave: "financeiro.emitido", nome: "Títulos emitidos", area: "financeiro", unidade: "R$", sentido: "SUBIR", agregacao: "SOMA", historico: "RECONSTRUIDO",
    formula: "Valor dos títulos (mensalidades, integral, material e taxas) com vencimento no mês, sem os cancelados.", fonte: "Financeiro → Títulos importados", href: "/financeiro/receita" },
  { chave: "financeiro.recebimento", nome: "Recebimento no mês", area: "financeiro", unidade: "%", sentido: "SUBIR", agregacao: "TAXA", fator: pct, historico: "RECONSTRUIDO",
    formula: "Valor pago até o fim do mês dos títulos que venceram no mês ÷ valor dos títulos que venceram no mês × 100.", fonte: "Financeiro → Títulos importados", href: "/financeiro/inadimplencia" },
  { chave: "financeiro.inadimplencia", nome: "Inadimplência (90 dias)", area: "financeiro", unidade: "%", sentido: "DESCER", agregacao: "TAXA", fator: pct, historico: "RECONSTRUIDO", destaque: 4,
    formula: "Valor não pago dos títulos vencidos nos 90 dias até o fim do mês ÷ valor emitido no mesmo período × 100.", fonte: "Financeiro → Inadimplência", obs: "Título renegociado em acordo conta como não pago, como no painel financeiro.", metaPadrao: c => c.commandCenter.inadimplenciaAlertaPct, href: "/financeiro/inadimplencia" },
  { chave: "financeiro.em_atraso", nome: "Valor em atraso", area: "financeiro", unidade: "R$", sentido: "DESCER", agregacao: "ESTOQUE", historico: "RECONSTRUIDO",
    formula: "Soma dos títulos vencidos e não pagos no fim do mês.", fonte: "Financeiro → Inadimplência", href: "/financeiro/inadimplencia" },
  { chave: "financeiro.ticket", nome: "Mensalidade média", area: "financeiro", unidade: "R$", sentido: "NEUTRO", agregacao: "TAXA", fator: 1, historico: "RECONSTRUIDO",
    formula: "Valor médio das mensalidades com vencimento no mês.", fonte: "Financeiro → Títulos importados", href: "/financeiro/receita" },
  { chave: "financeiro.recuperado", nome: "Recuperado em acordos", area: "financeiro", unidade: "R$", sentido: "SUBIR", agregacao: "SOMA", historico: "RECONSTRUIDO",
    formula: "Parcelas de acordos de cobrança pagas no mês.", fonte: "Financeiro → Inadimplência e cobrança", href: "/financeiro/inadimplencia" },
  { chave: "financeiro.caixa", nome: "Saldo de caixa (fim do mês)", area: "financeiro", unidade: "R$", sentido: "SUBIR", agregacao: "ESTOQUE", historico: "RECONSTRUIDO", zeroFill: false,
    formula: "Saldo inicial informado do mês + entradas − saídas.", fonte: "Financeiro → Fluxo de caixa", obs: "Só aparece nos meses com saldo inicial informado; a rede só soma quando todas as unidades informaram.", href: "/financeiro/caixa" },
  { chave: "financeiro.custo_pessoal", nome: "Custo de pessoal estimado", area: "financeiro", unidade: "R$", sentido: "NEUTRO", agregacao: "ESTOQUE", historico: "RECONSTRUIDO", restricao: "SALARIAL",
    formula: "Salários vigentes no fim do mês dos colaboradores ativos × (1 + encargos configurados).", fonte: "Pessoas → Cargos e salários (histórico salarial)", obs: "Estimativa gerencial; colaborador sem salário cadastrado fica fora. Visível só para Direção, RH e Financeiro.", href: "/cargos-salarios" },
  // v24 · dicionário da Nova Arquitetura (Cap. 34): KPI-06, 07, 08, 11, 12, 13, 14 e 15
  { chave: "financeiro.inadimplencia30", nome: "Inadimplência 30+", area: "financeiro", unidade: "%", sentido: "DESCER", agregacao: "TAXA", fator: pct, historico: "RECONSTRUIDO",
    formula: "Valor não pago, no fim do mês, dos títulos vencidos há mais de 30 dias (vencimentos dos últimos 12 meses) ÷ valor faturado nos 12 meses × 100.", fonte: "Financeiro → Títulos importados", obs: "KPI-07. Título renegociado em acordo conta como não pago.", metaPadrao: c => c.commandCenter.inadimplenciaAlertaPct, href: "/financeiro/inadimplencia" },
  { chave: "financeiro.recuperacao_regua", nome: "Recuperação da régua", area: "financeiro", unidade: "%", sentido: "SUBIR", agregacao: "TAXA", fator: pct, historico: "RECONSTRUIDO",
    formula: "Títulos que entraram na régua no mês (primeira ação de cobrança) e foram pagos até o fim do mês ÷ títulos que entraram na régua × 100.", fonte: "Financeiro → Inadimplência e cobrança", obs: "KPI-08.", href: "/financeiro/inadimplencia" },
  { chave: "financeiro.ebitda", nome: "EBITDA gerencial (caixa)", area: "financeiro", unidade: "R$", sentido: "SUBIR", agregacao: "SOMA", historico: "RECONSTRUIDO",
    formula: "Entradas − saídas do mês, sem o resultado financeiro (categorias financeiras: juros e tarifas).", fonte: "Financeiro → Fluxo de caixa", obs: "KPI-12 em regime de caixa; a DRE gerencial mostra a composição.", href: "/financeiro/dre" },
  { chave: "financeiro.folha_receita", nome: "Folha ÷ receita", area: "financeiro", unidade: "%", sentido: "DESCER", agregacao: "TAXA", fator: pct, historico: "RECONSTRUIDO", restricao: "SALARIAL",
    formula: "Custo de pessoal REAL (resultado aceito da folha: proventos, encargos, provisões, benefícios e rescisões) ÷ receita de caixa do mês × 100.", fonte: "Pessoas → Ciclo da folha (Payroll Bridge) e Financeiro → Fluxo de caixa", obs: "KPI-13. Mês sem resultado aceito fica sem valor (nunca vira zero nem estimativa).", href: "/folha/custo" },
  { chave: "financeiro.receita_aluno", nome: "Receita por aluno", area: "financeiro", unidade: "R$", sentido: "SUBIR", agregacao: "TAXA", fator: 1, historico: "RETRATO",
    formula: "Receita de caixa do mês ÷ alunos atuais.", fonte: "Financeiro → Fluxo de caixa e Matrículas → Alunos", obs: "KPI-06 (foto do mês corrente).", href: "/financeiro/cockpit" },
  { chave: "financeiro.custo_aluno", nome: "Custo por aluno", area: "financeiro", unidade: "R$", sentido: "DESCER", agregacao: "TAXA", fator: 1, historico: "RETRATO",
    formula: "Saídas de caixa do mês ÷ alunos atuais.", fonte: "Financeiro → Fluxo de caixa e Matrículas → Alunos", obs: "KPI-14 (foto do mês corrente).", href: "/financeiro/cockpit" },
  { chave: "financeiro.orcamento_executado", nome: "Orçamento executado (despesas)", area: "financeiro", unidade: "%", sentido: "DESCER", agregacao: "TAXA", fator: pct, historico: "RECONSTRUIDO", metaPadrao: () => 100,
    formula: "Despesas realizadas no mês ÷ despesas orçadas no mês × 100.", fonte: "Financeiro → Orçado × realizado", obs: "KPI-15 — banda saudável de 90% a 105% por centro.", href: "/financeiro/orcamento" },
  // v25 · Cobrança & Recebimentos (Cap. 21): KPI-09 e KPI-39
  { chave: "financeiro.conciliado", nome: "Conciliado ÷ recebido", area: "financeiro", unidade: "%", sentido: "SUBIR", agregacao: "TAXA", fator: pct, historico: "RECONSTRUIDO", metaPadrao: c => c.conciliacao.metaConciliadoPct as number,
    formula: "Valor das baixas do mês já casadas com o crédito no banco ou com a venda da Cielo ÷ valor de todas as baixas do mês × 100.", fonte: "Financeiro → Conciliação (extratos, relatório da Cielo e títulos do ActiveSoft)", obs: "KPI-09 — trava o fechamento da competência; meta 100% até o dia 10 do mês seguinte. Começa no primeiro mês com extrato importado.", href: "/financeiro/recebimentos" },
  { chave: "financeiro.divergencias", nome: "Divergências de conciliação abertas", area: "financeiro", unidade: "n", sentido: "DESCER", agregacao: "ESTOQUE", historico: "RECONSTRUIDO", metaPadrao: () => 0,
    formula: "Pendências da conciliação (sem par, valor, taxa, não identificado, sem baixa) abertas no fim do mês.", fonte: "Financeiro → Divergências da conciliação", obs: "KPI-39 — a idade média aparece na tela de divergências; com 15 dias escala ao gestor financeiro, com 30 à Direção.", href: "/financeiro/divergencias" },
  { chave: "financeiro.semana_critica", nome: "Caixa projetado na semana crítica", area: "financeiro", unidade: "R$", sentido: "SUBIR", agregacao: "ESTOQUE", historico: "RETRATO", zeroFill: false, redeDireta: true,
    formula: "Menor saldo projetado nas próximas 13 semanas (cenário central).", fonte: "Financeiro → Caixa projetado", obs: "KPI-11 — meta: nenhuma semana negativa.", href: "/financeiro/projecao" },

  // ------------------------------------------------------------------ Operações
  { chave: "operacoes.chamados", nome: "Chamados abertos", area: "operacoes", unidade: "n", sentido: "NEUTRO", agregacao: "SOMA", historico: "RECONSTRUIDO",
    formula: "Chamados de manutenção, TI, limpeza e segurança abertos no mês.", fonte: "Operações → Chamados", href: "/operacoes/chamados" },
  { chave: "operacoes.sla", nome: "Chamados concluídos no prazo", area: "operacoes", unidade: "%", sentido: "SUBIR", agregacao: "TAXA", fator: pct, historico: "RECONSTRUIDO", destaque: 9,
    formula: "Chamados concluídos no mês dentro do SLA ÷ chamados concluídos no mês × 100.", fonte: "Operações → Chamados", href: "/operacoes/chamados" },
  { chave: "operacoes.tempo_resolucao", nome: "Tempo médio de resolução", area: "operacoes", unidade: "dias", sentido: "DESCER", agregacao: "TAXA", fator: 1, historico: "RECONSTRUIDO",
    formula: "Média de dias entre a abertura e a conclusão dos chamados concluídos no mês.", fonte: "Operações → Chamados", href: "/operacoes/chamados" },
  { chave: "operacoes.backlog", nome: "Chamados em aberto", area: "operacoes", unidade: "n", sentido: "DESCER", agregacao: "ESTOQUE", historico: "RECONSTRUIDO",
    formula: "Chamados abertos até o fim do mês e ainda não concluídos nele (cancelados ficam fora).", fonte: "Operações → Chamados", href: "/operacoes/chamados" },
  { chave: "operacoes.vistorias", nome: "Conformidade das vistorias", area: "operacoes", unidade: "%", sentido: "SUBIR", agregacao: "TAXA", fator: pct, historico: "RECONSTRUIDO",
    formula: "Itens conformes ÷ itens verificados nas vistorias do mês × 100.", fonte: "Operações → Vistorias", href: "/operacoes/vistorias" },
  { chave: "operacoes.custo_manutencao", nome: "Custo de manutenção", area: "operacoes", unidade: "R$", sentido: "NEUTRO", agregacao: "SOMA", historico: "RECONSTRUIDO",
    formula: "Custo real dos chamados concluídos no mês.", fonte: "Operações → Chamados", href: "/operacoes/chamados" },
  { chave: "operacoes.aprovacoes_prazo", nome: "Aprovações no prazo", area: "operacoes", unidade: "%", sentido: "SUBIR", agregacao: "TAXA", fator: pct, historico: "RECONSTRUIDO",
    formula: "Decisões de etapa (aprovar, rejeitar ou devolver) tomadas dentro do prazo do tipo de solicitação ÷ decisões do mês × 100.", fonte: "Solicitações e aprovações", href: "/fluxos" },

  // ------------------------------------------------------------------ Estratégia e governança
  { chave: "estrategia.okrs", nome: "Progresso dos OKRs", area: "estrategia", unidade: "%", sentido: "SUBIR", agregacao: "TAXA", fator: 1, historico: "RECONSTRUIDO", destaque: 10,
    formula: "Média do progresso dos objetivos ativos do ciclo (cada objetivo = média dos seus resultados-chave, pelo último check-in até o fim do mês).", fonte: "Estratégia → OKRs", href: "/estrategia/okrs" },
  { chave: "estrategia.acoes_em_dia", nome: "Ações do plano em dia", area: "estrategia", unidade: "%", sentido: "SUBIR", agregacao: "TAXA", fator: pct, historico: "RECONSTRUIDO",
    formula: "Ações abertas no fim do mês sem prazo vencido e sem bloqueio ÷ ações abertas no fim do mês × 100.", fonte: "Estratégia → Plano de ação", obs: "Bloqueio considerado é o atual.", href: "/estrategia/acoes" },
  { chave: "estrategia.acoes_concluidas", nome: "Ações concluídas", area: "estrategia", unidade: "n", sentido: "SUBIR", agregacao: "SOMA", historico: "RECONSTRUIDO",
    formula: "Ações do plano concluídas no mês.", fonte: "Estratégia → Plano de ação", href: "/estrategia/acoes" },
  { chave: "estrategia.marcos_prazo", nome: "Marcos entregues no prazo", area: "estrategia", unidade: "%", sentido: "SUBIR", agregacao: "TAXA", fator: pct, historico: "RECONSTRUIDO",
    formula: "Marcos de projeto concluídos no mês até a data prevista ÷ marcos concluídos no mês × 100.", fonte: "Estratégia → Projetos", href: "/estrategia/projetos" },
  { chave: "estrategia.reunioes", nome: "Reuniões de gestão realizadas", area: "estrategia", unidade: "n", sentido: "SUBIR", agregacao: "SOMA", historico: "RECONSTRUIDO",
    formula: "Reuniões dos rituais de gestão realizadas no mês.", fonte: "Estratégia → Rituais de gestão", href: "/estrategia/rituais" },
  { chave: "estrategia.okrs_on_track", nome: "KRs no rumo", area: "estrategia", unidade: "%", sentido: "SUBIR", agregacao: "TAXA", fator: pct, historico: "RETRATO", metaPadrao: () => 70,
    formula: "KRs do ciclo com confiança média ou alta no último check-in ÷ KRs com confiança registrada × 100.", fonte: "Estratégia → OKRs", obs: "KPI-34 — meta ≥ 70%.", href: "/estrategia/okrs" },
  { chave: "gestao.saude", nome: "Saúde da operação", area: "estrategia", unidade: "pts", sentido: "SUBIR", agregacao: "ESTOQUE", historico: "RECONSTRUIDO", zeroFill: false, redeDireta: true,
    formula: "Último índice de saúde do Command Center registrado no mês (0 a 100).", fonte: "Command Center", obs: "Registrado quando o Command Center é aberto.", href: "/command-center" },
  { chave: "governanca.nc_abertas", nome: "Não conformidades abertas", area: "estrategia", unidade: "n", sentido: "DESCER", agregacao: "ESTOQUE", historico: "RECONSTRUIDO",
    formula: "Não conformidades registradas até o fim do mês e não encerradas até ele.", fonte: "Governança → Controles e não conformidades", href: "/governanca/controles" },
  { chave: "governanca.nc_prazo", nome: "Não conformidades encerradas no prazo", area: "estrategia", unidade: "%", sentido: "SUBIR", agregacao: "TAXA", fator: pct, historico: "RECONSTRUIDO",
    formula: "Não conformidades encerradas no mês até o prazo ÷ encerradas no mês com prazo × 100.", fonte: "Governança → Controles e não conformidades", href: "/governanca/controles" },
  { chave: "governanca.excecoes", nome: "Exceções aprovadas", area: "estrategia", unidade: "n", sentido: "DESCER", agregacao: "SOMA", historico: "RECONSTRUIDO",
    formula: "Exceções a POPs e regras aprovadas no mês.", fonte: "Governança → Exceções", href: "/governanca/excecoes" },
  { chave: "governanca.processos", nome: "Saúde dos processos", area: "estrategia", unidade: "pts", sentido: "SUBIR", agregacao: "ESTOQUE", historico: "RETRATO", redeDireta: true,
    formula: "Process Health Score da Governança (0 a 100): POPs vigentes, ciência, controles e não conformidades.", fonte: "Governança → Painel", href: "/governanca" },
  { chave: "governanca.lgpd_prazo", nome: "Pedidos LGPD respondidos no prazo", area: "estrategia", unidade: "%", sentido: "SUBIR", agregacao: "TAXA", fator: pct, historico: "RECONSTRUIDO", restricao: "PRIVACIDADE", porUnidade: false,
    formula: "Pedidos de titulares respondidos no mês até o prazo legal ÷ respondidos no mês × 100.", fonte: "Governança → Privacidade (LGPD)", obs: "Só números: nenhum conteúdo de pedido aparece nos painéis.", href: "/governanca/privacidade" },
];

export const KPI: Record<string, KpiDef> = Object.fromEntries(CATALOGO.map(k => [k.chave, k]));
export const porUnidade = (k: KpiDef) => k.porUnidade !== false;
export const preenche = (k: KpiDef) => k.zeroFill ?? (k.agregacao !== "TAXA" && k.historico !== "RETRATO");

export function nomeKpi(k: KpiDef, anoLetivo: number) { return k.sufixoAno ? `${k.nome} ${anoLetivo}` : k.nome; }

// ------------------------------------------------------------------ farol e metas
export const DIRECAO_DO_SENTIDO: Record<Sentido, Direcao | null> = { SUBIR: "MAIOR_MELHOR", DESCER: "MENOR_MELHOR", NEUTRO: null };
export const SENTIDO_LABEL: Record<Sentido, string> = { SUBIR: "Quanto maior, melhor", DESCER: "Quanto menor, melhor", NEUTRO: "Acompanhamento (sem melhor ou pior)" };
export const AGREGACAO_LABEL: Record<Agregacao, string> = { SOMA: "Soma do mês (acumula no ano)", ESTOQUE: "Retrato no fim do mês", TAXA: "Razão (recalculada pelas somas)" };
export const HISTORICO_LABEL: Record<Historico, string> = { RECONSTRUIDO: "Reconstruído dos registros (24 meses)", RETRATO: "Foto diária (histórico começa na ativação)", EVENTO: "Medição pontual (vale a última)" };

/** Limite de atenção quando a meta não traz um: tolerância percentual da meta, no sentido ruim. */
export function alertaPadrao(meta: number, sentido: Sentido, tolPct: number): number | null {
  if (sentido === "NEUTRO") return null;
  const d = Math.abs(meta) * tolPct / 100 || tolPct / 100;
  return sentido === "SUBIR" ? meta - d : meta + d;
}
export function farolKpi(valor: number | null | undefined, meta: number | null, alerta: number | null, sentido: Sentido, tolPct: number): Farol {
  const dir = DIRECAO_DO_SENTIDO[sentido];
  if (valor === null || valor === undefined || Number.isNaN(valor)) return "SEM_DADO";
  if (!dir || meta === null) return "SEM_META";
  return farol(valor, { direcao: dir, meta, alerta: alerta ?? alertaPadrao(meta, sentido, tolPct), faixaMin: null, faixaMax: null });
}
export const TOM_FAROL: Record<Farol, "bom" | "atencao" | "ruim" | "neutro"> = { VERDE: "bom", AMARELO: "atencao", VERMELHO: "ruim", SEM_META: "neutro", SEM_DADO: "neutro" };

// ------------------------------------------------------------------ séries: rede e acumulado
export type Ponto = { valor: number | null; num: number | null; den: number | null };
export const razaoPonto = (num: number | null, den: number | null, fator = 1) => num === null || den === null || den === 0 ? null : (num / den) * fator;

/** Junta as linhas das unidades num valor de rede. TAXA usa as somas de numerador e denominador; SOMA e ESTOQUE somam os valores. */
export function agregar(k: KpiDef, pontos: Ponto[], exigeTodas = false): Ponto {
  const comValor = pontos.filter(p => k.agregacao === "TAXA" ? p.den !== null : p.valor !== null);
  if (!comValor.length || (exigeTodas && comValor.length < pontos.length)) return { valor: null, num: null, den: null };
  if (k.agregacao === "TAXA") {
    const num = comValor.reduce((a, p) => a + (p.num ?? 0), 0), den = comValor.reduce((a, p) => a + (p.den ?? 0), 0);
    return { num, den, valor: razaoPonto(num, den, k.fator ?? 1) };
  }
  const v = comValor.reduce((a, p) => a + (p.valor ?? 0), 0);
  return { valor: v, num: null, den: null };
}

/** Acumulado do ano até o período: SOMA soma os meses; TAXA recalcula pelas somas; ESTOQUE vale o próprio mês. */
export function acumulado(k: KpiDef, serie: Map<string, Ponto>, periodo: string): number | null {
  if (k.agregacao === "ESTOQUE" || k.historico === "EVENTO") return null;
  const ano = periodo.slice(0, 4); const meses: Ponto[] = [];
  for (let p = `${ano}-01`; p <= periodo; p = somaMeses(p, 1)) { const x = serie.get(p); if (x) meses.push(x); }
  if (k.agregacao === "SOMA") { const vs = meses.filter(m => m.valor !== null); return vs.length ? vs.reduce((a, m) => a + (m.valor ?? 0), 0) : null; }
  const com = meses.filter(m => m.den !== null && m.num !== null); if (!com.length) return null;
  return razaoPonto(com.reduce((a, m) => a + (m.num ?? 0), 0), com.reduce((a, m) => a + (m.den ?? 0), 0), k.fator ?? 1);
}

/** Última medição até o período (indicadores de evento: pesquisa de clima, ciclo de desempenho). */
export function ultimaMedicao(serie: Map<string, Ponto>, periodo: string, limiteMeses = 24): { periodo: string; valor: number } | null {
  for (let i = 0, p = periodo; i < limiteMeses; i++, p = somaMeses(p, -1)) { const x = serie.get(p); if (x && x.valor !== null) return { periodo: p, valor: x.valor }; }
  return null;
}

// ------------------------------------------------------------------ leitura automática do mês
export type VisaoKpi = {
  def: KpiDef; nome: string; periodo: string; valor: number | null; medidoEm: string | null; den: number | null;
  anterior: number | null; anoAnterior: number | null; acumulado: number | null; acumuladoAnoAnterior: number | null;
  meta: number | null; alerta: number | null; metaFonte: "CADASTRADA" | "PADRAO" | "ORCAMENTO" | null; periodicidade: "MENSAL" | "ANUAL";
  farol: Farol; serie: { periodo: string; valor: number | null }[];
};
export type Frase = { tom: "bom" | "atencao" | "ruim" | "neutro"; texto: string; chave: string; peso: number };

const fmt = (v: VisaoKpi, x: number | null) => fmtKpi(x, v.def.unidade, true);
const melhorou = (k: KpiDef, delta: number) => k.sentido === "SUBIR" ? delta > 0 : k.sentido === "DESCER" ? delta < 0 : null;
function desvioMudancas(serie: { valor: number | null }[]) {
  const ds: number[] = []; for (let i = 1; i < serie.length; i++) { const a = serie[i - 1].valor, b = serie[i].valor; if (a !== null && b !== null) ds.push(b - a); }
  if (ds.length < 4) return null; const m = ds.reduce((x, y) => x + y, 0) / ds.length; const sd = Math.sqrt(ds.reduce((x, y) => x + (y - m) ** 2, 0) / ds.length);
  return sd || null;
}

/**
 * Leitura do mês: frases curtas, ordenadas pelo que mais pede atenção — fora do alvo, maiores movimentos (em relação à variação normal
 * do próprio indicador), sequências de 3 meses, recordes de 24 meses, comparação com o ano anterior e lacunas de dados.
 * Determinística (sem IA): mesma base, mesmo texto.
 */
export function leituraDoMes(visoes: VisaoKpi[], max = 7): Frase[] {
  const out: Frase[] = [];
  for (const v of visoes) {
    const k = v.def; const nome = v.nome; const val = v.valor;
    if (val === null) {
      if (k.historico === "RECONSTRUIDO" && v.serie.slice(-4, -1).some(p => p.valor !== null) && v.serie[v.serie.length - 1]?.valor === null) out.push({ tom: "neutro", chave: k.chave, peso: 1, texto: `${nome}: sem medição em ${mesPorExtenso(v.periodo)}, embora houvesse nos meses anteriores — confira se os registros do mês foram lançados.` });
      continue;
    }
    if (v.farol === "VERMELHO" && v.meta !== null) out.push({ tom: "ruim", chave: k.chave, peso: 9, texto: `${nome}: fora do alvo — ${fmt(v, k.agregacao === "SOMA" && v.periodicidade === "ANUAL" ? v.acumulado : val)} (meta ${k.sentido === "DESCER" ? "até" : "de pelo menos"} ${fmt(v, v.meta)}${v.periodicidade === "ANUAL" ? " no ano, proporcional ao mês" : ""}).` });
    else if (v.farol === "AMARELO" && v.meta !== null) out.push({ tom: "atencao", chave: k.chave, peso: 4, texto: `${nome}: em atenção — ${fmt(v, val)}, perto do limite da meta (${k.sentido === "DESCER" ? "até" : "de pelo menos"} ${fmt(v, v.meta)}).` });
    // razões com base pequena (poucos casos no mês) não geram frase de movimento: o número oscila por acaso
    const baseOk = k.agregacao !== "TAXA" || v.den === null || v.den >= 8;
    const dv = v.anterior !== null ? variacao(val, v.anterior, k.unidade) : null; const sd = desvioMudancas(v.serie);
    if (baseOk && dv && dv.sentido !== 0 && k.historico !== "EVENTO") {
      const z = sd ? Math.abs(dv.abs) / sd : 0; const bom = melhorou(k, dv.abs); const mesAnt = rotuloMes(somaMeses(v.periodo, -1));
      const recorde = (() => { const vals = v.serie.slice(0, -1).map(p => p.valor).filter((x): x is number => x !== null); if (vals.length < 6) return null; if (val > Math.max(...vals)) return "maior"; if (val < Math.min(...vals)) return "menor"; return null; })();
      if (recorde) out.push({ tom: bom === null ? "neutro" : bom ? "bom" : "ruim", chave: k.chave, peso: bom === null ? 2 : 6, texto: `${nome}: ${fmt(v, val)}, o ${recorde} valor dos últimos ${v.serie.filter(p => p.valor !== null).length} meses (${dv.texto} sobre ${mesAnt}).` });
      else if (z >= 1.5) out.push({ tom: bom === null ? "neutro" : bom ? "bom" : "atencao", chave: k.chave, peso: bom === null ? 2 : bom ? 5 : 7, texto: `${nome}: ${dv.sentido > 0 ? "alta" : "queda"} de ${dv.texto.replace(/^[+−]/, "")} sobre ${mesAnt}, para ${fmt(v, val)} — movimento acima do normal para este indicador.` });
    }
    // sequência de 3 meses no mesmo sentido (só indicadores com sentido)
    if (baseOk && k.sentido !== "NEUTRO" && k.historico !== "EVENTO") {
      const ult = v.serie.slice(-4).map(p => p.valor); if (ult.length === 4 && ult.every(x => x !== null)) {
        const d = [ult[1]! - ult[0]!, ult[2]! - ult[1]!, ult[3]! - ult[2]!];
        if (d.every(x => x > 0) || d.every(x => x < 0)) { const bom = melhorou(k, d[0]); out.push({ tom: bom ? "bom" : "atencao", chave: k.chave, peso: bom ? 3 : 6, texto: `${nome}: 3 meses seguidos de ${bom ? "melhora" : "piora"} (${fmt(v, ult[0])} → ${fmt(v, ult[3])}).` }); }
      }
    }
    // ano contra ano: acumulado para fluxos, mês para retratos e razões
    if (k.sentido !== "NEUTRO") {
      const a = k.agregacao === "SOMA" ? v.acumulado : val; const b = k.agregacao === "SOMA" ? v.acumuladoAnoAnterior : v.anoAnterior;
      const dy = a !== null && b !== null ? variacao(a, b, k.unidade) : null;
      if (baseOk && dy && dy.sentido !== 0 && (dy.rel === null || Math.abs(dy.rel) >= 0.1 || ["%", "pts"].includes(k.unidade) && Math.abs(dy.abs) >= 3)) {
        const bom = melhorou(k, dy.abs); const ano = Number(v.periodo.slice(0, 4)) - 1;
        out.push({ tom: bom ? "bom" : "atencao", chave: k.chave, peso: bom ? 2 : 4, texto: k.agregacao === "SOMA" ? `${nome} no acumulado do ano: ${fmt(v, a)}, ${dy.texto} sobre o mesmo período de ${ano}.` : `${nome}: ${fmt(v, a)}, ${dy.texto} sobre ${rotuloMes(`${ano}-${v.periodo.slice(5)}`)}.` });
      }
    }
  }
  // uma frase por indicador (a mais pesada) e no máximo `max` frases
  const melhor = new Map<string, Frase>(); for (const f of out) { const x = melhor.get(f.chave); if (!x || f.peso > x.peso) melhor.set(f.chave, f); }
  return [...melhor.values()].sort((a, b) => b.peso - a.peso).slice(0, max);
}

// ------------------------------------------------------------------ previsões (puras)
/**
 * Projeção de fim de campanha (matrículas): ritmo médio das últimas semanas estendido até a data final, limitado à capacidade.
 * Faixa provável = ritmo mínimo e máximo observados nas mesmas semanas. Sem ritmo suficiente (menos de 3 semanas), não projeta.
 */
export function projetarCampanha(acumuladoSemanal: number[], semanasRestantes: number, capacidade: number | null) {
  const n = acumuladoSemanal.length; if (n < 4 || semanasRestantes <= 0) return null;
  const ritmos: number[] = []; for (let i = Math.max(1, n - 8); i < n; i++) ritmos.push(Math.max(0, acumuladoSemanal[i] - acumuladoSemanal[i - 1]));
  if (ritmos.length < 3) return null;
  const media = ritmos.reduce((a, b) => a + b, 0) / ritmos.length; const min = Math.min(...ritmos), max = Math.max(...ritmos); const atual = acumuladoSemanal[n - 1];
  const cap = (v: number) => capacidade !== null ? Math.min(capacidade, v) : v;
  const proj = Array.from({ length: semanasRestantes }, (_, i) => ({ provavel: cap(atual + media * (i + 1)), min: cap(atual + min * (i + 1)), max: cap(atual + max * (i + 1)) }));
  return { media, min, max, final: proj[proj.length - 1], proj };
}
