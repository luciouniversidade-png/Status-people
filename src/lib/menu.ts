import type { Session } from "./session";
import { can } from "./auth";
import { veContratos, veLicencas } from "./contratos";
import { vePainelExecutivo } from "./kpi";
import { veFluxos } from "./fluxos";

export type ItemMenu = [href: string, rotulo: string];
export type GrupoMenu = [titulo: string, itens: ItemMenu[]];
export type ItemInferior = { href: string; rotulo: string; icone: string };
/** O que o menu precisa saber além da sessão (vem do banco no layout; no editor de acesso do cargo, tudo ligado). */
export type ContextoMenu = { nNotif: number; membroEtica: boolean; gestorPriv: boolean; temEquipe?: boolean };

/**
 * Menu do ONE pela atuação da pessoa (v29: antes, pelo perfil). Mesma montagem de sempre, agora fora do layout para servir também
 * ao editor de acesso do cargo (as telas que cada atuação pode ver) e à conferência “o que esta pessoa vê”.
 * As telas que o cargo não marcou saem depois, em `filtrarMenu` (lib/acesso).
 */
export function montarMenu(s: Session, ctx: ContextoMenu): { grupos: GrupoMenu[]; inferior: ItemInferior[] } {
  const { nNotif, membroEtica, gestorPriv } = ctx;
  const pessoas: ItemMenu[] = [
    ["/colaboradores", "Colaboradores"], ["/organograma", "Organograma e quem é quem"],
    ["/processos", "Admissões e desligamentos"], ...(["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR", "LEITURA"].includes(s.role) ? [["/contratos-prazo", "Contratos com prazo"] as ItemMenu] : []), ["/ferias", "Férias e afastamentos"], ["/ferias/calendario", "Quem está fora"], ["/banco-de-horas", "Banco de horas"], ["/ponto", "Ponto e jornada"], ...(["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR", "LEITURA"].includes(s.role) ? [["/ponto/hoje", "Painel do dia (presenças)"] as ItemMenu] : []), ...(["RH", "DIRECAO", "DIRETOR_UNIDADE"].includes(s.role) ? [["/ponto/auditoria", "Auditoria do ponto"] as ItemMenu] : []), ["/cobertura", "Substituição de professores"], ["/cobertura/grade", "Grade dos professores (vigências)"], ["/documentos", "Documentos"], ["/relatorios", "Relatório mensal"],
    ...(["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR", "LEITURA"].includes(s.role) ? [["/relatorios/biblioteca", "Relatórios do RH"] as ItemMenu, ["/relatorios/montar", "Relatório sob medida"] as ItemMenu] : []),
    ...(["RH", "DIRECAO", "LEITURA"].includes(s.role) ? [["/folha", "Ciclo da folha (Payroll Bridge)"] as ItemMenu] : []), ...(["RH", "DIRECAO"].includes(s.role) ? [["/folha/arquivo", "Holerites e guias"] as ItemMenu, ["/beneficios", "Benefícios"] as ItemMenu] : []),
    ...(["RH", "DIRECAO", "DIRETOR_UNIDADE", "LEITURA"].includes(s.role) ? [["/quadro", "Posições e FTE"] as ItemMenu] : []), ...(["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR", "LEITURA"].includes(s.role) ? [["/onboarding", "Onboarding 30-60-90"] as ItemMenu] : []),
    ...(["RH", "DIRECAO"].includes(s.role) ? [["/sst", "Segurança e saúde (SST)"] as ItemMenu] : []),
    ["/desempenho", "Desempenho"], ...(["RH", "DIRECAO"].includes(s.role) ? [["/desempenho/modelos", "Modelos de avaliação"] as ItemMenu, ["/desempenho/expectativas", "Expectativas por cargo"] as ItemMenu] : []), ["/desempenho/lideranca", "Liderança e encaminhamentos"], ["/recrutamento", "Recrutamento"], ["/academy", "Academy"], ["/clima", "Clima e eNPS"], ["/sucessao", "Sucessão e talentos"], ...(["RH", "DIRECAO", "DIRETOR_UNIDADE"].includes(s.role) ? [["/analytics", "People Analytics"] as ItemMenu, ["/analytics/retencao", "Movimentação e retenção"] as ItemMenu, ["/analytics/composicao", "Composição da equipe"] as ItemMenu] : []), ...(can.verSalario(s) ? [["/analytics/igualdade", "Igualdade salarial e diversidade"] as ItemMenu, ["/cargos-salarios", "Cargos e salários"] as ItemMenu] : []),
  ];
  const matriculas: ItemMenu[] = [
    ["/matriculas", "Painel de vagas"], ["/matriculas/turmas", "Turmas 2027"], ["/matriculas/alunos", "Alunos e candidatos"], ["/matriculas/reservas", "Reservas"], ["/matriculas/fila", "Lista de espera"], ["/matriculas/rematricula", "Rematrícula"], ["/matriculas/metas", "Metas e previsão"], ["/matriculas/acao", "Ação requerida"],
  ];
  const atendimento: ItemMenu[] = [
    ["/atendimento", "Painel de atendimento"], ["/atendimento/radar", "Radar da família"], ["/atendimento/casos", "Casos"], ["/atendimento/risco", "Famílias em risco"], ["/atendimento/pesquisas", "Pesquisas NPS"],
  ];
  // v22: canal de ética só para o comitê (e Direção/RH); privacidade para Direção/RH/encarregado; autorizações de imagem para quem atende famílias
  const v22gov: ItemMenu[] = [...(gestorPriv ? [["/governanca/privacidade", "Privacidade (LGPD)"] as ItemMenu] : []), ...(can.reservar(s) || gestorPriv || s.role === "LEITURA" ? [["/governanca/privacidade/consentimentos", "Autorizações de imagem"] as ItemMenu] : []), ...(membroEtica || ["DIRECAO", "RH"].includes(s.role) ? [["/governanca/etica", "Canal de ética"] as ItemMenu] : [])];
  const governanca: ItemMenu[] = [
    ["/governanca", "Painel de governança"], ["/governanca/pops", "POPs e processos"], ["/governanca/excecoes", "Exceções"], ["/governanca/controles", "Controles e não conformidades"], ["/governanca/auditorias", "Auditorias e NC/CAPA"], ["/governanca/decisoes", "Decisões"], ["/governanca/agentes", "Agentes de IA"], ...v22gov,
  ];
  const financeiro: ItemMenu[] = [
    ["/financeiro", "Painel financeiro"], ...(s.role !== "RH" ? [["/financeiro/cockpit", "Cockpit do CFO"] as ItemMenu] : []), ["/financeiro/dre", "DRE gerencial"], ["/financeiro/inadimplencia", "Inadimplência e cobrança"], ["/financeiro/recebimentos", "Recebimentos do mês"], ["/financeiro/conciliacao", "Conciliação bancária e cartão"], ["/financeiro/divergencias", "Divergências da conciliação"], ["/financeiro/despesas", "Despesas e aprovações"], ...(["DIRECAO", "FINANCEIRO", "DIRETOR_UNIDADE"].includes(s.role) ? [["/financeiro/contas-a-pagar", "Contas a pagar"] as ItemMenu] : []), ["/financeiro/descontos", "Descontos e bolsas"], ["/financeiro/receita", "Receita"], ["/financeiro/caixa", "Fluxo de caixa"], ["/financeiro/orcamento", "Orçado × realizado (FP&A)"], ...(["DIRECAO", "FINANCEIRO", "DIRETOR_UNIDADE"].includes(s.role) ? [["/financeiro/orcamento/historico", "Orçamento pelo histórico"] as ItemMenu, ["/financeiro/plano-de-contas", "Plano de contas e custos"] as ItemMenu, ["/financeiro/rateio", "Resultado por unidade (rateio)"] as ItemMenu] : []), ["/financeiro/projecao", "Caixa projetado"],
    ...(["DIRECAO", "FINANCEIRO", "RH"].includes(s.role) ? [["/financeiro/obrigacoes", "Obrigações fiscais"] as ItemMenu, ["/folha/custo", "Custo de folha"] as ItemMenu] : []),
    ...(s.role === "FINANCEIRO" ? [["/folha", "Ciclo da folha (conferência)"] as ItemMenu, ["/folha/arquivo", "Guias da folha"] as ItemMenu, ["/quadro", "Posições e FTE"] as ItemMenu] : []),
  ];
  const operacoes: ItemMenu[] = [
    ["/operacoes", "Painel de operações"], ["/operacoes/chamados", "Chamados"], ["/operacoes/ativos", "Ativos e patrimônio"], ["/operacoes/itens", "Itens com colaboradores"], ["/operacoes/vistorias", "Vistorias"], ["/operacoes/fornecedores", "Fornecedores"], ["/operacoes/espacos", "Mapa de salas e reservas"], ["/operacoes/seguranca", "Portaria e segurança"], ...(veContratos(s) ? [["/operacoes/contratos", "Contratos de fornecedores"] as ItemMenu] : []), ...(veLicencas(s) ? [["/operacoes/licencas", "Licenças e alvarás"] as ItemMenu] : []),
  ];
  const estrategia: ItemMenu[] = [["/estrategia", "Painel estratégico"], ["/estrategia/identidade", "Identidade"], ["/estrategia/mapa", "Mapa estratégico"], ["/estrategia/indicadores", "Indicadores"], ["/estrategia/okrs", "OKRs"], ["/estrategia/projetos", "Projetos"], ["/estrategia/acoes", "Plano de ação"], ["/estrategia/rituais", "Rituais de gestão"], ["/estrategia/marketing", "Marketing e captação"], ["/estrategia/relatorio", "Relatório executivo"], ["/estrategia/assistente", "Assistente IA"]];
  // v23 · ONE Insights: painel executivo, prazos dos processos, pendências de cada pessoa e mural de reconhecimento
  const insights: ItemMenu[] = [
    ["/", "Início"],
    ...(vePainelExecutivo(s) ? [["/executivo", "Painel Executivo"] as ItemMenu] : []), ...(veFluxos(s) ? [["/fluxos", "Central de fluxos e SLA"] as ItemMenu] : []),
    ...(["DIRECAO", "RH", "FINANCEIRO", "DIRETOR_UNIDADE"].includes(s.role) ? [["/executivo/board", "Board do dono"] as ItemMenu] : []),
    ["/rede", "Visão da rede"], ["/alertas", "Central de alertas"], ...(s.role !== "LEITURA" ? [["/aprovacoes", "Aprovações em lote"] as ItemMenu] : []),
    ["/pendencias", "Minhas pendências"], ...(["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR"].includes(s.role) || (ctx.temEquipe && !["COLABORADOR", "LEITURA"].includes(s.role)) ? [["/equipe", "Minha equipe"] as ItemMenu] : []), ["/reconhecimento", "Mural de reconhecimento"],
  ];
  const comunicacao: ItemMenu[] = [["/comunicacao/comunicados", "Comunicados"], ["/comunicacao/mensagens", "Mensagens"], ...(["DIRECAO", "RH", "DIRETOR_UNIDADE", "COMERCIAL", "FINANCEIRO"].includes(s.role) ? [["/comunicacao/massa", "Envio em massa (com aprovação)"] as ItemMenu] : []), ["/comunicacao/modelos", "Modelos de mensagem"], ["/notificacoes", `Notificações${nNotif ? ` (${nNotif})` : ""}`]];
  const geral: ItemMenu[] = [
    ...(s.employeeId && s.role !== "COLABORADOR" ? [["/eu", "Meu espaço (colaborador)"] as ItemMenu] : []),
    ...(["DIRECAO", "RH", "DIRETOR_UNIDADE"].includes(s.role) ? [["/command-center", "Command Center"] as ItemMenu, ["/tv", "Modo TV"] as ItemMenu] : []),
    ...(can.auditoria(s) ? [["/auditoria", "Auditoria"] as ItemMenu] : []),
    ...(can.configurar(s) ? [["/configuracoes", "Configurações"] as ItemMenu, ["/configuracoes/acessos", "Acesso por cargo"] as ItemMenu] : []), ...(["DIRECAO", "RH"].includes(s.role) ? [["/configuracoes/banco", "Banco de dados"] as ItemMenu] : []),
    ...(["DIRECAO", "RH", "FINANCEIRO", "DIRETOR_UNIDADE", "LEITURA"].includes(s.role) ? [["/arquitetura", "Nova Arquitetura (rastreabilidade)"] as ItemMenu] : []),
    ...(s.role !== "LEITURA" ? [["/solicitacoes", "Solicitações e aprovações"] as ItemMenu] : []), ["/conta", "Minha conta"],
  ];
  const grupos: GrupoMenu[] =
    s.role === "COLABORADOR" ? [["", [...(s.employeeId ? [["/eu", "Meu espaço"] as ItemMenu] : []), [s.employeeId ? `/colaboradores/${s.employeeId}` : "/conta", "Minha ficha"], ...(s.employeeId ? [[`/colaboradores/${s.employeeId}/painel`, "Meu painel"] as ItemMenu] : []), ["/desempenho/minha", "Minha avaliação"], ["/academy/minha", "Meus treinamentos"], ["/pendencias", "Minhas pendências"], ["/cobertura/minha", "Minhas substituições"], ["/organograma", "Quem é quem"], ["/solicitacoes", "Solicitações"], ["/reconhecimento", "Mural de reconhecimento"], ["/governanca/pops", "POPs e processos"], ["/operacoes/chamados", "Abrir chamado"], ["/operacoes/espacos/reservas", "Reservar espaço"], ["/comunicacao/comunicados", "Comunicados"], ["/notificacoes", `Notificações${nNotif ? ` (${nNotif})` : ""}`], ["/conta", "Minha conta"]]]] :
    s.role === "OPERACOES" ? [["Insights", insights], ["Operações", operacoes], ["Estratégia", estrategia], ["Comunicação", comunicacao], ["Governança", [["/governanca/pops", "POPs e processos"], ["/governanca/excecoes", "Exceções"], ["/governanca/controles", "Controles e não conformidades"], ...v22gov]], ["", [...(s.employeeId ? [["/eu", "Meu espaço (colaborador)"] as ItemMenu] : []), ["/organograma", "Quem é quem"], ["/solicitacoes", "Solicitações e aprovações"], ["/conta", "Minha conta"]]]] :
    s.role === "COMERCIAL" ? [["Insights", insights], ["Matrículas", matriculas], ["Atendimento", atendimento], ["Financeiro", [["/financeiro/descontos", "Descontos e bolsas"], ["/financeiro/conciliacao?aba=triagem", "Triagem de pagamentos (PIX)"]]], ["Operações", [["/operacoes/chamados", "Abrir chamado"], ["/operacoes/espacos/reservas", "Reservar espaço"], ["/operacoes/seguranca", "Portaria e saídas"]]], ["Estratégia", estrategia], ["Comunicação", comunicacao], ["Governança", [["/governanca/pops", "POPs e processos"], ["/governanca/excecoes", "Exceções"], ["/governanca/controles", "Controles e não conformidades"], ["/governanca/auditorias", "Auditorias e NC/CAPA"], ...v22gov]], ["", [...(s.employeeId ? [["/eu", "Meu espaço (colaborador)"] as ItemMenu] : []), ["/organograma", "Quem é quem"], ["/solicitacoes", "Solicitações e aprovações"], ["/conta", "Minha conta"]]]] :
    s.role === "FINANCEIRO" ? [["Insights", insights], ["Financeiro", [...financeiro, ["/operacoes/contratos", "Contratos de fornecedores"]]], ["Estratégia", estrategia], ["Comunicação", comunicacao], ["Matrículas", [["/matriculas", "Painel de vagas"], ["/matriculas/alunos", "Alunos e candidatos"], ["/matriculas/rematricula", "Rematrícula"], ["/matriculas/metas", "Metas e previsão"]]], ["Governança", [["/governanca/pops", "POPs e processos"], ["/governanca/excecoes", "Exceções"], ["/governanca/controles", "Controles e não conformidades"], ...v22gov]], ["", [...(s.employeeId ? [["/eu", "Meu espaço (colaborador)"] as ItemMenu] : []), ["/organograma", "Quem é quem"], ["/command-center", "Command Center"], ["/arquitetura", "Nova Arquitetura (rastreabilidade)"], ["/solicitacoes", "Solicitações e aprovações"], ["/conta", "Minha conta"]]]] :
    s.role === "LEITURA" ? [["Insights", insights], ["Pessoas", pessoas], ["Matrículas", matriculas], ["Atendimento", atendimento], ["Governança", [["/governanca/pops", "POPs e processos"], ...v22gov]], ["", geral]] :
    ([["Insights", insights], ["Pessoas", pessoas], ["Matrículas", matriculas], ["Atendimento", atendimento], ["Financeiro", s.role === "GESTOR" ? [] : financeiro], ["Operações", operacoes], ["Estratégia", estrategia], ["Comunicação", comunicacao], ["Governança", governanca], ["", geral]] as GrupoMenu[]).filter(([, items]) => items.length);
  // v24 · menu inferior no celular: os 5 destinos da atuação
  const INFERIOR: Record<string, ItemInferior[]> = {
    DIRECAO: [{ href: "/", rotulo: "Início", icone: "🏠" }, { href: "/executivo/board", rotulo: "Board", icone: "📊" }, { href: "/alertas", rotulo: "Alertas", icone: "🚨" }, { href: "/aprovacoes", rotulo: "Aprovar", icone: "✅" }, { href: "/rede", rotulo: "Rede", icone: "🏫" }],
    RH: [{ href: "/", rotulo: "Início", icone: "🏠" }, { href: "/colaboradores", rotulo: "Pessoas", icone: "👥" }, { href: "/ponto/hoje", rotulo: "Hoje", icone: "🕒" }, { href: "/aprovacoes", rotulo: "Aprovar", icone: "✅" }, { href: "/alertas", rotulo: "Alertas", icone: "🚨" }],
    FINANCEIRO: [{ href: "/", rotulo: "Início", icone: "🏠" }, { href: "/financeiro/cockpit", rotulo: "Cockpit", icone: "📈" }, { href: "/financeiro/dre", rotulo: "DRE", icone: "🧾" }, { href: "/financeiro/obrigacoes", rotulo: "Obrigações", icone: "📅" }, { href: "/alertas", rotulo: "Alertas", icone: "🚨" }],
    DIRETOR_UNIDADE: [{ href: "/", rotulo: "Início", icone: "🏠" }, { href: "/executivo/board", rotulo: "Board", icone: "📊" }, { href: "/ponto/hoje", rotulo: "Hoje", icone: "🕒" }, { href: "/aprovacoes", rotulo: "Aprovar", icone: "✅" }, { href: "/alertas", rotulo: "Alertas", icone: "🚨" }],
    GESTOR: [{ href: "/", rotulo: "Início", icone: "🏠" }, { href: "/pendencias", rotulo: "Pendências", icone: "📌" }, { href: "/ponto/hoje", rotulo: "Hoje", icone: "🕒" }, { href: "/aprovacoes", rotulo: "Aprovar", icone: "✅" }, { href: "/alertas", rotulo: "Alertas", icone: "🚨" }],
    COMERCIAL: [{ href: "/", rotulo: "Início", icone: "🏠" }, { href: "/matriculas", rotulo: "Vagas", icone: "🎒" }, { href: "/matriculas/acao", rotulo: "Ação", icone: "🛠️" }, { href: "/atendimento", rotulo: "Famílias", icone: "💬" }, { href: "/pendencias", rotulo: "Pendências", icone: "📌" }],
    OPERACOES: [{ href: "/", rotulo: "Início", icone: "🏠" }, { href: "/operacoes/chamados", rotulo: "Chamados", icone: "🔧" }, { href: "/operacoes/espacos", rotulo: "Espaços", icone: "🗺️" }, { href: "/pendencias", rotulo: "Pendências", icone: "📌" }, { href: "/alertas", rotulo: "Alertas", icone: "🚨" }],
    LEITURA: [{ href: "/", rotulo: "Início", icone: "🏠" }, { href: "/executivo", rotulo: "Painel", icone: "📊" }, { href: "/rede", rotulo: "Rede", icone: "🏫" }, { href: "/relatorios/biblioteca", rotulo: "Relatórios", icone: "🗂️" }, { href: "/alertas", rotulo: "Alertas", icone: "🚨" }],
    COLABORADOR: [{ href: s.employeeId ? "/eu" : "/conta", rotulo: "Meu espaço", icone: "🏠" }, { href: "/pendencias", rotulo: "Pendências", icone: "📌" }, { href: "/solicitacoes", rotulo: "Pedidos", icone: "📝" }, { href: "/academy/minha", rotulo: "Cursos", icone: "🎓" }, { href: "/conta", rotulo: "Conta", icone: "👤" }],
  };
  return { grupos, inferior: INFERIOR[s.role] ?? INFERIOR.LEITURA };
}
