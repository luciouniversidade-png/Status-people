/**
 * v28 · Plano de contas gerencial padrão de uma rede escolar (catálogo "Plano de contas, centros de custo e orçamento"):
 * 9 macrogrupos de saída — Pessoal, Pedagógico, Ocupação, Administrativo, Comercial, Financeiro, Tributário, Investimentos e
 * Não despesa — mais as receitas. Grupo (1) → subgrupo (1.1) → conta analítica (1.1.01); subcontas (1.1.01.001) são criadas na tela.
 * Cada conta analítica aponta para uma categoria do caixa/DRE/orçamento ("categoria-ponte"), para que tudo o que já existe siga
 * funcionando, e traz os atributos padrão do lançamento: tipo econômico, comportamento, recorrência, controlável, custo direto ou
 * indireto, índice de reajuste, direcionador de volume, centro de custo padrão e palavras que ajudam a sugerir a conta.
 * Só é inserido o que ainda não existe (pelo código): edições feitas na tela nunca são sobrescritas.
 */
export type TipoEconomico = "OPEX" | "CAPEX" | "DIVIDA" | "TRANSFERENCIA" | "ADIANTAMENTO" | "RECEITA";
export type Comportamento = "FIXO" | "VARIAVEL";
export type Recorrencia = "RECORRENTE" | "EVENTUAL";
export type Custo = "DIRETO" | "INDIRETO";
export type Indice = "IPCA" | "DISSIDIO" | "MENSALIDADE" | "NENHUM";
export type Driver = "ALUNOS" | "RECEITA" | "NENHUM";
export type CentroPadrao = "UNIDADE" | "CORPORATIVO";

export type ContaSeed = {
  codigo: string; nome: string; tipo: "SAIDA" | "ENTRADA"; categoria?: string; economico?: TipoEconomico; comportamento?: Comportamento; recorrencia?: Recorrencia;
  controlavel?: boolean; custo?: Custo; indice?: Indice; driver?: Driver; centro?: CentroPadrao; generica?: boolean; palavras?: string; descricao?: string;
};

const S = "SAIDA" as const, E = "ENTRADA" as const;
// Grupos e subgrupos (sintéticos): só organizam
const G = (codigo: string, nome: string, tipo: "SAIDA" | "ENTRADA" = S, descricao?: string): ContaSeed => ({ codigo, nome, tipo, descricao });

export const PLANO_PADRAO: ContaSeed[] = [
  G("1", "Pessoal", S, "Salários, encargos, benefícios e terceiros de ensino"),
  G("1.1", "Folha docente"),
  { codigo: "1.1.01", nome: "Salários de professores", tipo: S, categoria: "Pessoal", comportamento: "FIXO", controlavel: false, custo: "DIRETO", indice: "DISSIDIO", palavras: "professor, professora, docente, folha docente" },
  { codigo: "1.1.02", nome: "Substituições e horas extras docentes", tipo: S, categoria: "Pessoal", comportamento: "VARIAVEL", recorrencia: "EVENTUAL", custo: "DIRETO", indice: "DISSIDIO", palavras: "substituicao, substituta, hora extra, horas extras" },
  { codigo: "1.1.03", nome: "Terceiros de ensino (oficinas e extracurriculares)", tipo: S, categoria: "Serviços e terceiros", comportamento: "VARIAVEL", custo: "DIRETO", driver: "ALUNOS", palavras: "oficina, ballet, judo, robotica, extracurricular, instrutor, xadrez, musicalizacao" },
  G("1.2", "Folha administrativa e de apoio"),
  { codigo: "1.2.01", nome: "Salários administrativos e de apoio", tipo: S, categoria: "Pessoal", comportamento: "FIXO", controlavel: false, indice: "DISSIDIO", palavras: "secretaria, auxiliar, apoio, administrativo, folha administrativa, zeladoria" },
  { codigo: "1.2.02", nome: "Coordenação e direção da unidade", tipo: S, categoria: "Pessoal", comportamento: "FIXO", controlavel: false, indice: "DISSIDIO", palavras: "coordenacao, coordenadora, coordenador, direcao da unidade" },
  { codigo: "1.2.03", nome: "Direção geral e equipe corporativa", tipo: S, categoria: "Pessoal", comportamento: "FIXO", controlavel: false, indice: "DISSIDIO", centro: "CORPORATIVO", palavras: "direcao geral, corporativo, mantenedora, pro labore" },
  G("1.3", "Encargos e benefícios"),
  { codigo: "1.3.01", nome: "Encargos sociais (INSS e FGTS)", tipo: S, categoria: "Encargos e benefícios", comportamento: "FIXO", controlavel: false, indice: "DISSIDIO", palavras: "inss, fgts, gps, darf previdenciario, encargos, esocial, previdencia" },
  { codigo: "1.3.02", nome: "Benefícios (transporte, alimentação e saúde)", tipo: S, categoria: "Encargos e benefícios", comportamento: "FIXO", controlavel: false, palavras: "vale transporte, vale alimentacao, vale refeicao, plano de saude, odontologico, beneficio, cesta basica" },
  { codigo: "1.3.03", nome: "Rescisões e indenizações", tipo: S, categoria: "Encargos e benefícios", comportamento: "VARIAVEL", recorrencia: "EVENTUAL", controlavel: false, indice: "NENHUM", palavras: "rescisao, indenizacao, aviso previo, multa do fgts, verbas rescisorias" },
  G("1.4", "Desenvolvimento de pessoas"),
  { codigo: "1.4.01", nome: "Formação e treinamento", tipo: S, categoria: "Serviços e terceiros", comportamento: "VARIAVEL", recorrencia: "EVENTUAL", palavras: "curso, treinamento, formacao, capacitacao, congresso, palestra" },

  G("2", "Pedagógico", S, "Material didático, laboratórios, eventos e projetos"),
  G("2.1", "Material e recursos didáticos"),
  { codigo: "2.1.01", nome: "Material didático e sistema de ensino", tipo: S, categoria: "Materiais e insumos", comportamento: "VARIAVEL", controlavel: false, custo: "DIRETO", driver: "ALUNOS", palavras: "apostila, livro didatico, sistema de ensino, material didatico, editora" },
  { codigo: "2.1.02", nome: "Material de consumo pedagógico", tipo: S, categoria: "Materiais e insumos", comportamento: "VARIAVEL", custo: "DIRETO", driver: "ALUNOS", palavras: "material escolar, eva, tinta guache, cartolina, consumo pedagogico, massinha" },
  { codigo: "2.1.03", nome: "Laboratórios e recursos tecnológicos pedagógicos", tipo: S, categoria: "Materiais e insumos", comportamento: "VARIAVEL", recorrencia: "EVENTUAL", custo: "DIRETO", driver: "ALUNOS", palavras: "laboratorio, reagente, kit de robotica, maker, microscopio" },
  G("2.2", "Projetos e eventos pedagógicos"),
  { codigo: "2.2.01", nome: "Eventos e projetos pedagógicos", tipo: S, categoria: "Outras despesas", comportamento: "VARIAVEL", recorrencia: "EVENTUAL", custo: "DIRETO", driver: "ALUNOS", palavras: "feira de ciencias, festa junina, formatura, projeto pedagogico, evento pedagogico, mostra cultural" },
  { codigo: "2.2.02", nome: "Saídas pedagógicas e transporte de alunos", tipo: S, categoria: "Serviços e terceiros", comportamento: "VARIAVEL", recorrencia: "EVENTUAL", custo: "DIRETO", driver: "ALUNOS", palavras: "excursao, passeio, saida pedagogica, onibus, fretamento, transporte escolar" },
  G("2.3", "Plataformas pedagógicas"),
  { codigo: "2.3.01", nome: "Plataformas e licenças pedagógicas", tipo: S, categoria: "Serviços e terceiros", comportamento: "VARIAVEL", controlavel: false, custo: "DIRETO", driver: "ALUNOS", palavras: "plataforma, licenca educacional, aplicativo educacional, bilingue, programa de ingles" },

  G("3", "Ocupação", S, "Aluguel, condomínio, energia, água e manutenção"),
  G("3.1", "Imóveis"),
  { codigo: "3.1.01", nome: "Aluguel", tipo: S, categoria: "Aluguel e condomínio", comportamento: "FIXO", controlavel: false, palavras: "aluguel, locacao, imobiliaria" },
  { codigo: "3.1.02", nome: "Condomínio e IPTU", tipo: S, categoria: "Aluguel e condomínio", comportamento: "FIXO", controlavel: false, palavras: "condominio, iptu" },
  G("3.2", "Utilidades"),
  { codigo: "3.2.01", nome: "Energia elétrica", tipo: S, categoria: "Serviços e terceiros", comportamento: "VARIAVEL", palavras: "energia, energisa, luz, eletrica, fatura de energia" },
  { codigo: "3.2.02", nome: "Água e esgoto", tipo: S, categoria: "Serviços e terceiros", comportamento: "VARIAVEL", palavras: "agua, esgoto, saneamento, aguas guariroba" },
  { codigo: "3.2.03", nome: "Internet e telefonia", tipo: S, categoria: "Serviços e terceiros", comportamento: "FIXO", palavras: "internet, telefone, telefonia, fibra, banda larga, celular corporativo" },
  G("3.3", "Manutenção e conservação"),
  { codigo: "3.3.01", nome: "Manutenção predial", tipo: S, categoria: "Manutenção", comportamento: "VARIAVEL", recorrencia: "EVENTUAL", palavras: "manutencao predial, eletricista, encanador, pintura, reparo, serralheria, vidraceiro, portao" },
  { codigo: "3.3.02", nome: "Manutenção de equipamentos e ar-condicionado", tipo: S, categoria: "Manutenção", comportamento: "VARIAVEL", palavras: "ar condicionado, refrigeracao, manutencao de equipamento, assistencia tecnica, preventiva" },
  { codigo: "3.3.03", nome: "Limpeza e conservação", tipo: S, categoria: "Serviços e terceiros", comportamento: "FIXO", palavras: "limpeza, conservacao, higienizacao, produtos de limpeza" },
  { codigo: "3.3.04", nome: "Segurança e portaria", tipo: S, categoria: "Serviços e terceiros", comportamento: "FIXO", palavras: "seguranca, vigilancia, portaria, monitoramento, alarme, cameras" },

  G("4", "Administrativo", S, "Contabilidade, jurídico, TI, escritório e serviços"),
  G("4.1", "Serviços administrativos"),
  { codigo: "4.1.01", nome: "Contabilidade", tipo: S, categoria: "Serviços e terceiros", comportamento: "FIXO", controlavel: false, centro: "CORPORATIVO", palavras: "contabilidade, contador, contabil, escritorio contabil" },
  { codigo: "4.1.02", nome: "Jurídico", tipo: S, categoria: "Serviços e terceiros", comportamento: "VARIAVEL", recorrencia: "EVENTUAL", centro: "CORPORATIVO", palavras: "advogado, advocacia, juridico, honorarios advocaticios, cobranca extrajudicial" },
  { codigo: "4.1.03", nome: "Sistemas de gestão e TI", tipo: S, categoria: "Serviços e terceiros", comportamento: "FIXO", centro: "CORPORATIVO", palavras: "sistema de gestao, software, activesoft, informatica, hospedagem, nuvem, suporte de ti" },
  { codigo: "4.1.04", nome: "Consultorias e assessorias", tipo: S, categoria: "Serviços e terceiros", comportamento: "VARIAVEL", recorrencia: "EVENTUAL", centro: "CORPORATIVO", palavras: "consultoria, assessoria, auditoria externa" },
  G("4.2", "Escritório e expediente"),
  { codigo: "4.2.01", nome: "Material de escritório e expediente", tipo: S, categoria: "Materiais e insumos", comportamento: "VARIAVEL", palavras: "papelaria, material de escritorio, toner, papel a4, expediente, cartucho" },
  { codigo: "4.2.02", nome: "Correios, cartório e despesas gerais", tipo: S, categoria: "Outras despesas", comportamento: "VARIAVEL", recorrencia: "EVENTUAL", palavras: "correios, cartorio, autenticacao, reconhecimento de firma, motoboy, frete" },
  G("4.3", "Outras administrativas"),
  { codigo: "4.3.01", nome: "Outras despesas administrativas", tipo: S, categoria: "Outras despesas", comportamento: "VARIAVEL", recorrencia: "EVENTUAL", generica: true, descricao: "Conta genérica: use pouco (meta de até 5% das saídas) — prefira a conta específica." },

  G("5", "Comercial", S, "Marketing, captação e eventos comerciais (bolsas e descontos ficam na receita)"),
  G("5.1", "Marketing e captação"),
  { codigo: "5.1.01", nome: "Mídia e anúncios", tipo: S, categoria: "Marketing", comportamento: "VARIAVEL", centro: "CORPORATIVO", palavras: "anuncio, meta ads, google ads, facebook, instagram, midia, impulsionamento, outdoor, radio" },
  { codigo: "5.1.02", nome: "Material gráfico e brindes", tipo: S, categoria: "Marketing", comportamento: "VARIAVEL", recorrencia: "EVENTUAL", centro: "CORPORATIVO", palavras: "grafica, impressao, banner, folder, brinde, panfleto, material impresso" },
  { codigo: "5.1.03", nome: "Eventos comerciais e visitas", tipo: S, categoria: "Marketing", comportamento: "VARIAVEL", recorrencia: "EVENTUAL", palavras: "open school, evento comercial, visita guiada, feira de matriculas" },
  G("5.2", "Relacionamento"),
  { codigo: "5.2.01", nome: "Comissões e parcerias", tipo: S, categoria: "Marketing", comportamento: "VARIAVEL", recorrencia: "EVENTUAL", indice: "NENHUM", centro: "CORPORATIVO", palavras: "comissao, parceria, indicacao premiada" },

  G("6", "Financeiro", S, "Tarifas, juros, multas e despesas bancárias"),
  G("6.1", "Despesas bancárias"),
  { codigo: "6.1.01", nome: "Tarifas bancárias", tipo: S, categoria: "Financeiras", comportamento: "FIXO", palavras: "tarifa, pacote de servicos, cesta de servicos, manutencao de conta, tarifa ted" },
  { codigo: "6.1.02", nome: "Taxas de cartão e de cobrança", tipo: S, categoria: "Financeiras", comportamento: "VARIAVEL", controlavel: false, indice: "NENHUM", driver: "RECEITA", palavras: "cielo, taxa de cartao, mdr, antecipacao de recebiveis, tarifa de boleto, registro de boleto" },
  G("6.2", "Juros e encargos"),
  { codigo: "6.2.01", nome: "Juros e multas por atraso", tipo: S, categoria: "Financeiras", comportamento: "VARIAVEL", recorrencia: "EVENTUAL", indice: "NENHUM", palavras: "juros de mora, multa por atraso, encargos por atraso" },
  { codigo: "6.2.02", nome: "Juros de empréstimos e financiamentos", tipo: S, categoria: "Financeiras", economico: "DIVIDA", comportamento: "FIXO", controlavel: false, indice: "NENHUM", centro: "CORPORATIVO", palavras: "juros de emprestimo, financiamento, capital de giro, pronampe" },

  G("7", "Tributário", S, "Tributos próprios — retenções têm tratamento separado e não são despesa"),
  G("7.1", "Tributos sobre a receita"),
  { codigo: "7.1.01", nome: "ISS", tipo: S, categoria: "Impostos e taxas", comportamento: "VARIAVEL", controlavel: false, indice: "NENHUM", driver: "RECEITA", palavras: "iss, issqn, imposto sobre servicos" },
  { codigo: "7.1.02", nome: "PIS e COFINS", tipo: S, categoria: "Impostos e taxas", comportamento: "VARIAVEL", controlavel: false, indice: "NENHUM", driver: "RECEITA", palavras: "pis, cofins" },
  { codigo: "7.1.03", nome: "Simples Nacional (DAS)", tipo: S, categoria: "Impostos e taxas", comportamento: "VARIAVEL", controlavel: false, indice: "NENHUM", driver: "RECEITA", palavras: "simples nacional, das simples, guia das" },
  { codigo: "7.1.04", nome: "IRPJ e CSLL", tipo: S, categoria: "Impostos e taxas", comportamento: "VARIAVEL", controlavel: false, indice: "NENHUM", driver: "RECEITA", palavras: "irpj, csll" },
  G("7.2", "Taxas e outros tributos"),
  { codigo: "7.2.01", nome: "Taxas, alvarás e licenças", tipo: S, categoria: "Impostos e taxas", comportamento: "FIXO", recorrencia: "EVENTUAL", controlavel: false, palavras: "alvara, licenca de funcionamento, bombeiros, vigilancia sanitaria, taxa municipal" },

  G("8", "Investimentos", S, "Móveis, equipamentos, obras e ativos capitalizáveis (CAPEX)"),
  G("8.1", "Obras e reformas"),
  { codigo: "8.1.01", nome: "Obras, reformas e ampliações", tipo: S, categoria: "Manutenção", economico: "CAPEX", comportamento: "VARIAVEL", recorrencia: "EVENTUAL", palavras: "obra, reforma, ampliacao, construcao, telhado, construtora" },
  G("8.2", "Equipamentos e mobiliário"),
  { codigo: "8.2.01", nome: "Móveis e equipamentos", tipo: S, categoria: "Materiais e insumos", economico: "CAPEX", comportamento: "VARIAVEL", recorrencia: "EVENTUAL", palavras: "moveis, carteiras, mobiliario, eletrodomestico, bebedouro" },
  { codigo: "8.2.02", nome: "Tecnologia (computadores, projetores e lousas)", tipo: S, categoria: "Materiais e insumos", economico: "CAPEX", comportamento: "VARIAVEL", recorrencia: "EVENTUAL", custo: "DIRETO", palavras: "computador, notebook, projetor, projetores, lousa digital, tablet, chromebook" },

  G("9", "Não despesa", S, "Transferências, principal de dívida e adiantamentos — saem do caixa, não da DRE"),
  G("9.1", "Transferências"),
  { codigo: "9.1.01", nome: "Transferência entre unidades", tipo: S, categoria: "Transferência entre unidades", economico: "TRANSFERENCIA", recorrencia: "EVENTUAL", controlavel: false, indice: "NENHUM", palavras: "transferencia entre unidades" },
  { codigo: "9.1.02", nome: "Transferências internas (entre contas)", tipo: S, categoria: "Transferências internas", economico: "TRANSFERENCIA", recorrencia: "EVENTUAL", controlavel: false, indice: "NENHUM", palavras: "mesma titularidade, transferencia entre contas, aplicacao, resgate" },
  G("9.2", "Dívida"),
  { codigo: "9.2.01", nome: "Amortização de empréstimos (principal)", tipo: S, categoria: "Amortização de dívida", economico: "DIVIDA", controlavel: false, indice: "NENHUM", centro: "CORPORATIVO", palavras: "amortizacao, parcela de emprestimo, principal da divida" },
  G("9.3", "Adiantamentos"),
  { codigo: "9.3.01", nome: "Adiantamentos a fornecedores e colaboradores", tipo: S, categoria: "Adiantamentos", economico: "ADIANTAMENTO", recorrencia: "EVENTUAL", indice: "NENHUM", palavras: "adiantamento, sinal de pagamento, antecipacao a fornecedor, adiantamento salarial" },

  G("R", "Receitas", E, "Ensino, material e outras receitas — bolsas e descontos reduzem a receita, não viram despesa"),
  G("R.1", "Ensino", E),
  { codigo: "R.1.01", nome: "Mensalidades", tipo: E, categoria: "Mensalidades", economico: "RECEITA", comportamento: "VARIAVEL", controlavel: false, custo: "DIRETO", indice: "MENSALIDADE", driver: "ALUNOS", palavras: "mensalidade, parcela escolar, anuidade" },
  { codigo: "R.1.02", nome: "Integral", tipo: E, categoria: "Integral", economico: "RECEITA", comportamento: "VARIAVEL", controlavel: false, custo: "DIRETO", indice: "MENSALIDADE", driver: "ALUNOS", palavras: "integral, periodo integral, contraturno" },
  G("R.2", "Material e taxas", E),
  { codigo: "R.2.01", nome: "Material e taxas", tipo: E, categoria: "Material e taxas", economico: "RECEITA", comportamento: "VARIAVEL", controlavel: false, custo: "DIRETO", driver: "ALUNOS", palavras: "material, taxa de matricula, uniforme, apostila" },
  G("R.3", "Outras receitas", E),
  { codigo: "R.3.01", nome: "Eventos", tipo: E, categoria: "Eventos", economico: "RECEITA", comportamento: "VARIAVEL", recorrencia: "EVENTUAL", custo: "DIRETO", driver: "ALUNOS", palavras: "evento, festa, ingresso, formatura" },
  { codigo: "R.3.02", nome: "Outras receitas", tipo: E, categoria: "Outras receitas", economico: "RECEITA", comportamento: "VARIAVEL", recorrencia: "EVENTUAL", generica: true, palavras: "cantina, aluguel de espaco, repasse" },
];

const q = (v: string | null | undefined) => v === null || v === undefined ? "NULL" : `'${v.replace(/'/g, "''")}'`;
const nivelDe = (codigo: string) => codigo.split(".").length;

/** Instruções idempotentes do seed (uma por conta, na ordem: o pai sempre antes do filho). */
export function sqlSeedPlano(): string {
  return PLANO_PADRAO.map((c, i) => {
    const nivel = nivelDe(c.codigo); const pai = nivel > 1 ? c.codigo.split(".").slice(0, -1).join(".") : null;
    const analitica = nivel === 3;
    const eco = c.economico ?? (c.tipo === "ENTRADA" ? "RECEITA" : "OPEX");
    return `INSERT INTO chart_accounts (codigo, nome, nivel, pai_id, tipo, categoria, tipo_economico, comportamento, recorrencia, controlavel, custo, indice, driver, centro_padrao, generica, palavras, descricao, ordem)
SELECT ${q(c.codigo)}, ${q(c.nome)}, ${nivel}, ${pai ? `(SELECT id FROM chart_accounts WHERE codigo=${q(pai)})` : "NULL"}, ${q(c.tipo)}, ${analitica ? q(c.categoria ?? null) : "NULL"}, ${q(eco)}, ${q(c.comportamento ?? "FIXO")}, ${q(c.recorrencia ?? "RECORRENTE")}, ${c.controlavel === false ? "false" : "true"}, ${q(c.custo ?? "INDIRETO")}, ${q(c.indice ?? "IPCA")}, ${q(c.driver ?? "NENHUM")}, ${q(c.centro ?? "UNIDADE")}, ${c.generica ? "true" : "false"}, ${q(c.palavras ?? null)}, ${q(c.descricao ?? null)}, ${i}
WHERE NOT EXISTS (SELECT 1 FROM chart_accounts WHERE codigo=${q(c.codigo)});`;
  }).join("\n");
}
