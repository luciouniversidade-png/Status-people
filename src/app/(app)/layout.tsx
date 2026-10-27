import Link from "@/components/Link";
import { MenuLinks } from "@/components/MenuLinks";
import { RegistrarSW } from "@/components/RegistrarSW";
import { redirect } from "next/navigation";
import { requireSession, requireActiveUser, destroySession, getSession, can, ROLE_LABEL } from "@/lib/auth";
import { esquecerAparelho } from "@/lib/push";
import { getSettings } from "@/lib/utils";
import { naoLidas } from "@/lib/comunicacao";
import { sql } from "@/db";
import { SCHEMA_VERSION } from "@/lib/versao";
import { atualizarBanco } from "./configuracoes/banco/actions";
import { ehComite } from "@/lib/etica";
import { podePrivacidade } from "@/lib/privacidade";
import { veContratos, veLicencas } from "@/lib/contratos";
import { BuscaGlobal } from "@/components/BuscaGlobal";
import { vePainelExecutivo } from "@/lib/kpi";
import { veFluxos } from "@/lib/fluxos";
import { MenuInferior } from "@/components/MenuInferior";
import { escopoDo } from "@/lib/alertas";

async function sair() { "use server"; const atual = await getSession(); await esquecerAparelho(atual?.id ?? null); await destroySession(); redirect("/login"); }

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession(); const u = await requireActiveUser(s);
  const cfg2 = await getSettings(); const { headers } = await import("next/headers"); const path = (await headers()).get("x-pathname") ?? "";
  if (u.trocarSenha && !path.startsWith("/conta")) redirect("/conta?trocar=1");
  if (cfg2.seguranca.exigir2FA.includes(s.role) && !u.totpAtivo && !path.startsWith("/conta/2fa") && !u.trocarSenha) redirect("/conta/2fa");
  let nNotif = 0; try { nNotif = await naoLidas(s.id); } catch { nNotif = 0; }
  // Banco atrás do código (atualização publicada sem aplicar o esquema): aviso só para quem pode corrigir
  let banco: "ok" | "desatualizado" | "incompleto" = "ok";
  if (["DIRECAO", "RH"].includes(s.role)) { try { const [b] = await sql<{ value: { versao?: string; falhas?: unknown[] } }[]>`SELECT value FROM settings WHERE key='banco'`; banco = !b || b.value?.versao !== SCHEMA_VERSION ? "desatualizado" : (b.value.falhas ?? []).length ? "incompleto" : "ok"; } catch { banco = "desatualizado"; } }
  const Sino = ({ cls }: { cls: string }) => <Link href="/notificacoes" aria-label="Notificações" className={cls}><span aria-hidden>🔔</span>{nNotif > 0 && <span className="rounded-full bg-erro px-1.5 text-[10px] font-semibold text-white">{nNotif > 99 ? "99+" : nNotif}</span>}</Link>;
  const pessoas: [string, string][] = [
    ["/colaboradores", "Colaboradores"], ["/organograma", "Organograma"],
    ["/processos", "Admissões e desligamentos"], ...(["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR", "LEITURA"].includes(s.role) ? [["/contratos-prazo", "Contratos com prazo"] as [string, string]] : []), ["/ferias", "Férias e afastamentos"], ["/ferias/calendario", "Quem está fora"], ["/banco-de-horas", "Banco de horas"], ["/ponto", "Ponto e jornada"], ...(["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR", "LEITURA"].includes(s.role) ? [["/ponto/hoje", "Painel do dia (presenças)"] as [string, string]] : []), ...(["RH", "DIRECAO", "DIRETOR_UNIDADE"].includes(s.role) ? [["/ponto/auditoria", "Auditoria do ponto"] as [string, string]] : []), ["/cobertura", "Substituição de professores"], ["/cobertura/grade", "Grade dos professores (vigências)"], ["/documentos", "Documentos"], ["/relatorios", "Relatório mensal"],
    ...(["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR", "LEITURA"].includes(s.role) ? [["/relatorios/biblioteca", "Relatórios do RH"] as [string, string]] : []),
    ...(["RH", "DIRECAO", "LEITURA"].includes(s.role) ? [["/folha", "Ciclo da folha (Payroll Bridge)"] as [string, string]] : []), ...(["RH", "DIRECAO"].includes(s.role) ? [["/folha/arquivo", "Holerites e guias"] as [string, string]] : []),
    ...(["RH", "DIRECAO", "DIRETOR_UNIDADE", "LEITURA"].includes(s.role) ? [["/quadro", "Posições e FTE"] as [string, string]] : []), ...(["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR", "LEITURA"].includes(s.role) ? [["/onboarding", "Onboarding 30-60-90"] as [string, string]] : []),
    ...(["RH", "DIRECAO"].includes(s.role) ? [["/sst", "Segurança e saúde (SST)"] as [string, string]] : []),
    ["/desempenho", "Desempenho"], ...(["RH", "DIRECAO"].includes(s.role) ? [["/desempenho/modelos", "Modelos de avaliação"] as [string, string], ["/desempenho/expectativas", "Expectativas por cargo"] as [string, string]] : []), ["/desempenho/lideranca", "Liderança e encaminhamentos"], ["/recrutamento", "Recrutamento"], ["/academy", "Academy"], ["/clima", "Clima e eNPS"], ["/sucessao", "Sucessão e talentos"], ...(["RH", "DIRECAO", "DIRETOR_UNIDADE"].includes(s.role) ? [["/analytics", "People Analytics"] as [string, string], ["/analytics/retencao", "Movimentação e retenção"] as [string, string]] : []), ...(can.verSalario(s) ? [["/cargos-salarios", "Cargos e salários"] as [string, string]] : []),
  ];
  const matriculas: [string, string][] = [
    ["/matriculas", "Painel de vagas"], ["/matriculas/turmas", "Turmas 2027"], ["/matriculas/alunos", "Alunos e candidatos"], ["/matriculas/reservas", "Reservas"], ["/matriculas/fila", "Lista de espera"], ["/matriculas/rematricula", "Rematrícula"], ["/matriculas/metas", "Metas e previsão"], ["/matriculas/acao", "Ação requerida"],
  ];
  const atendimento: [string, string][] = [
    ["/atendimento", "Painel de atendimento"], ["/atendimento/radar", "Radar da família"], ["/atendimento/casos", "Casos"], ["/atendimento/risco", "Famílias em risco"], ["/atendimento/pesquisas", "Pesquisas NPS"],
  ];
  // v22: canal de ética só para o comitê (e Direção/RH); privacidade para Direção/RH/encarregado; autorizações de imagem para quem atende famílias
  let membroEtica = false, gestorPriv = false; try { membroEtica = await ehComite(s); gestorPriv = await podePrivacidade(s); } catch { /* banco antigo */ }
  const v22gov: [string, string][] = [...(gestorPriv ? [["/governanca/privacidade", "Privacidade (LGPD)"] as [string, string]] : []), ...(can.reservar(s) || gestorPriv || s.role === "LEITURA" ? [["/governanca/privacidade/consentimentos", "Autorizações de imagem"] as [string, string]] : []), ...(membroEtica || ["DIRECAO", "RH"].includes(s.role) ? [["/governanca/etica", "Canal de ética"] as [string, string]] : [])];
  const governanca: [string, string][] = [
    ["/governanca", "Painel de governança"], ["/governanca/pops", "POPs e processos"], ["/governanca/excecoes", "Exceções"], ["/governanca/controles", "Controles e não conformidades"], ["/governanca/auditorias", "Auditorias e NC/CAPA"], ["/governanca/decisoes", "Decisões"], ["/governanca/agentes", "Agentes de IA"], ...v22gov,
  ];
  const financeiro: [string, string][] = [
    ["/financeiro", "Painel financeiro"], ...(s.role !== "RH" ? [["/financeiro/cockpit", "Cockpit do CFO"] as [string, string]] : []), ["/financeiro/dre", "DRE gerencial"], ["/financeiro/inadimplencia", "Inadimplência e cobrança"], ["/financeiro/recebimentos", "Recebimentos do mês"], ["/financeiro/conciliacao", "Conciliação bancária e cartão"], ["/financeiro/divergencias", "Divergências da conciliação"], ["/financeiro/despesas", "Despesas e aprovações"], ...(["DIRECAO", "FINANCEIRO", "DIRETOR_UNIDADE"].includes(s.role) ? [["/financeiro/contas-a-pagar", "Contas a pagar"] as [string, string]] : []), ["/financeiro/descontos", "Descontos e bolsas"], ["/financeiro/receita", "Receita"], ["/financeiro/caixa", "Fluxo de caixa"], ["/financeiro/orcamento", "Orçado × realizado (FP&A)"], ...(["DIRECAO", "FINANCEIRO", "DIRETOR_UNIDADE"].includes(s.role) ? [["/financeiro/orcamento/historico", "Orçamento pelo histórico"] as [string, string], ["/financeiro/plano-de-contas", "Plano de contas e custos"] as [string, string], ["/financeiro/rateio", "Resultado por unidade (rateio)"] as [string, string]] : []), ["/financeiro/projecao", "Caixa projetado"],
    ...(["DIRECAO", "FINANCEIRO", "RH"].includes(s.role) ? [["/financeiro/obrigacoes", "Obrigações fiscais"] as [string, string], ["/folha/custo", "Custo de folha"] as [string, string]] : []),
    ...(s.role === "FINANCEIRO" ? [["/folha", "Ciclo da folha (conferência)"] as [string, string], ["/folha/arquivo", "Guias da folha"] as [string, string], ["/quadro", "Posições e FTE"] as [string, string]] : []),
  ];
  const operacoes: [string, string][] = [
    ["/operacoes", "Painel de operações"], ["/operacoes/chamados", "Chamados"], ["/operacoes/ativos", "Ativos e patrimônio"], ["/operacoes/vistorias", "Vistorias"], ["/operacoes/fornecedores", "Fornecedores"], ["/operacoes/espacos", "Mapa de salas e reservas"], ["/operacoes/seguranca", "Portaria e segurança"], ...(veContratos(s) ? [["/operacoes/contratos", "Contratos de fornecedores"] as [string, string]] : []), ...(veLicencas(s) ? [["/operacoes/licencas", "Licenças e alvarás"] as [string, string]] : []),
  ];
  const estrategia: [string, string][] = [["/estrategia", "Painel estratégico"], ["/estrategia/identidade", "Identidade"], ["/estrategia/mapa", "Mapa estratégico"], ["/estrategia/indicadores", "Indicadores"], ["/estrategia/okrs", "OKRs"], ["/estrategia/projetos", "Projetos"], ["/estrategia/acoes", "Plano de ação"], ["/estrategia/rituais", "Rituais de gestão"], ["/estrategia/marketing", "Marketing e captação"], ["/estrategia/relatorio", "Relatório executivo"], ["/estrategia/assistente", "Assistente IA"]];
  // v23 · ONE Insights: painel executivo, prazos dos processos, pendências de cada pessoa e mural de reconhecimento
  const insights: [string, string][] = [
    ["/", "Início"],
    ...(vePainelExecutivo(s) ? [["/executivo", "Painel Executivo"] as [string, string]] : []), ...(veFluxos(s) ? [["/fluxos", "Central de fluxos e SLA"] as [string, string]] : []),
    ...(["DIRECAO", "RH", "FINANCEIRO", "DIRETOR_UNIDADE"].includes(s.role) ? [["/executivo/board", "Board do dono"] as [string, string]] : []),
    ["/rede", "Visão da rede"], ["/alertas", "Central de alertas"], ...(s.role !== "LEITURA" ? [["/aprovacoes", "Aprovações em lote"] as [string, string]] : []),
    ["/pendencias", "Minhas pendências"], ...(["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR"].includes(s.role) ? [["/equipe", "Minha equipe"] as [string, string]] : []), ["/reconhecimento", "Mural de reconhecimento"],
  ];
  const comunicacao: [string, string][] = [["/comunicacao/comunicados", "Comunicados"], ["/comunicacao/mensagens", "Mensagens"], ...(["DIRECAO", "RH", "DIRETOR_UNIDADE", "COMERCIAL", "FINANCEIRO"].includes(s.role) ? [["/comunicacao/massa", "Envio em massa (com aprovação)"] as [string, string]] : []), ["/comunicacao/modelos", "Modelos de mensagem"], ["/notificacoes", `Notificações${nNotif ? ` (${nNotif})` : ""}`]];
  const geral: [string, string][] = [
    ...(s.employeeId && s.role !== "COLABORADOR" ? [["/eu", "Meu espaço (colaborador)"] as [string, string]] : []),
    ...(["DIRECAO", "RH", "DIRETOR_UNIDADE"].includes(s.role) ? [["/command-center", "Command Center"] as [string, string], ["/tv", "Modo TV"] as [string, string]] : []),
    ...(can.auditoria(s) ? [["/auditoria", "Auditoria"] as [string, string]] : []),
    ...(can.configurar(s) ? [["/configuracoes", "Configurações"] as [string, string]] : []), ...(["DIRECAO", "RH"].includes(s.role) ? [["/configuracoes/banco", "Banco de dados"] as [string, string]] : []),
    ...(["DIRECAO", "RH", "FINANCEIRO", "DIRETOR_UNIDADE", "LEITURA"].includes(s.role) ? [["/arquitetura", "Nova Arquitetura (rastreabilidade)"] as [string, string]] : []),
    ...(s.role !== "LEITURA" ? [["/solicitacoes", "Solicitações e aprovações"] as [string, string]] : []), ["/conta", "Minha conta"],
  ];
  const grupos: [string, [string, string][]][] =
    s.role === "COLABORADOR" ? [["", [...(s.employeeId ? [["/eu", "Meu espaço"] as [string, string]] : []), [s.employeeId ? `/colaboradores/${s.employeeId}` : "/conta", "Minha ficha"], ...(s.employeeId ? [[`/colaboradores/${s.employeeId}/painel`, "Meu painel"] as [string, string]] : []), ["/desempenho/minha", "Minha avaliação"], ["/academy/minha", "Meus treinamentos"], ["/pendencias", "Minhas pendências"], ["/cobertura/minha", "Minhas substituições"], ["/solicitacoes", "Solicitações"], ["/reconhecimento", "Mural de reconhecimento"], ["/governanca/pops", "POPs e processos"], ["/operacoes/chamados", "Abrir chamado"], ["/operacoes/espacos/reservas", "Reservar espaço"], ["/comunicacao/comunicados", "Comunicados"], ["/notificacoes", `Notificações${nNotif ? ` (${nNotif})` : ""}`], ["/conta", "Minha conta"]]]] :
    s.role === "OPERACOES" ? [["Insights", insights], ["Operações", operacoes], ["Estratégia", estrategia], ["Comunicação", comunicacao], ["Governança", [["/governanca/pops", "POPs e processos"], ["/governanca/excecoes", "Exceções"], ["/governanca/controles", "Controles e não conformidades"], ...v22gov]], ["", [["/solicitacoes", "Solicitações e aprovações"], ["/conta", "Minha conta"]]]] :
    s.role === "COMERCIAL" ? [["Insights", insights], ["Matrículas", matriculas], ["Atendimento", atendimento], ["Financeiro", [["/financeiro/descontos", "Descontos e bolsas"], ["/financeiro/conciliacao?aba=triagem", "Triagem de pagamentos (PIX)"]]], ["Operações", [["/operacoes/chamados", "Abrir chamado"], ["/operacoes/espacos/reservas", "Reservar espaço"], ["/operacoes/seguranca", "Portaria e saídas"]]], ["Estratégia", estrategia], ["Comunicação", comunicacao], ["Governança", [["/governanca/pops", "POPs e processos"], ["/governanca/excecoes", "Exceções"], ["/governanca/controles", "Controles e não conformidades"], ["/governanca/auditorias", "Auditorias e NC/CAPA"], ...v22gov]], ["", [["/solicitacoes", "Solicitações e aprovações"], ["/conta", "Minha conta"]]]] :
    s.role === "FINANCEIRO" ? [["Insights", insights], ["Financeiro", [...financeiro, ["/operacoes/contratos", "Contratos de fornecedores"]]], ["Estratégia", estrategia], ["Comunicação", comunicacao], ["Matrículas", [["/matriculas", "Painel de vagas"], ["/matriculas/alunos", "Alunos e candidatos"], ["/matriculas/rematricula", "Rematrícula"], ["/matriculas/metas", "Metas e previsão"]]], ["Governança", [["/governanca/pops", "POPs e processos"], ["/governanca/excecoes", "Exceções"], ["/governanca/controles", "Controles e não conformidades"], ...v22gov]], ["", [["/command-center", "Command Center"], ["/arquitetura", "Nova Arquitetura (rastreabilidade)"], ["/solicitacoes", "Solicitações e aprovações"], ["/conta", "Minha conta"]]]] :
    s.role === "LEITURA" ? [["Insights", insights], ["Pessoas", pessoas], ["Matrículas", matriculas], ["Atendimento", atendimento], ["Governança", [["/governanca/pops", "POPs e processos"], ...v22gov]], ["", geral]] :
    [["Insights", insights], ["Pessoas", pessoas], ["Matrículas", matriculas], ["Atendimento", atendimento], ["Financeiro", s.role === "GESTOR" ? [] : financeiro], ["Operações", operacoes], ["Estratégia", estrategia], ["Comunicação", comunicacao], ["Governança", governanca], ["", geral]].filter(([, items]) => items.length) as [string, [string, string][]][];
  const nav = grupos.flatMap(([, items]) => items);
  // v24 · menu inferior no celular: os 5 destinos do papel
  const inferior: Record<string, { href: string; rotulo: string; icone: string }[]> = {
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
  let nAlertas = 0; if (s.role !== "COLABORADOR") { try { const [a] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM alerts WHERE status='ABERTO' AND severidade='ALTO' AND dono_user_id=${s.id} AND escopo=${escopoDo(s)}`; /* mesmo recorte da Central (rede ou a unidade do perfil) */ nAlertas = a?.n ?? 0; } catch { nAlertas = 0; } }
  const paginasBusca = [...new Map(grupos.flatMap(([g, items]) => items.map(([href, label]) => [href, { href, titulo: label.replace(/ \(\d+\)$/, ""), grupo: g }] as const))).values()];
  const ATIVO = "bg-white/15 font-medium text-white shadow-[inset_3px_0_0_rgb(125,211,252)]";
  const links = (cls: string, rolar = false) => <MenuLinks grupos={grupos} cls={cls} ativoCls={ATIVO} rolar={rolar} />;
  void nav;
  return (
    <div className="min-h-screen md:grid md:grid-cols-[248px_minmax(0,1fr)]">
      <RegistrarSW />
      <aside className="sticky top-0 z-20 bg-navy text-white md:h-screen md:self-start md:overflow-y-auto md:overflow-x-hidden md:overscroll-contain md:[scrollbar-color:rgba(255,255,255,0.25)_transparent] md:[scrollbar-width:thin]">
        <div className="absolute right-[6.25rem] top-3 z-10 md:hidden"><BuscaGlobal paginas={paginasBusca} variante="icone" atalho={false} /></div>
        {/* Celular: cabeçalho com botão Menu que abre a lista completa */}
        <details id="menu-celular" className="md:hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 [&::-webkit-details-marker]:hidden">
            <span>
              <span className="block text-[11px] text-sky-200">Colégio Status</span>
              <span className="block text-lg font-semibold leading-tight">STATUS ONE</span>
            </span>
            <span className="rounded-md border border-sky-300/50 px-3 py-1.5 text-sm">☰ Menu</span>
          </summary>
          <nav className="flex flex-col gap-0.5 border-t border-white/10 px-2 pb-20 pt-2">
            {links("rounded-md px-3 py-2.5 text-sm text-sky-100 hover:bg-navy-700 hover:text-white")}
            <div className="mt-2 flex items-center justify-between border-t border-white/10 px-3 pt-3 text-xs text-sky-200">
              <span><span className="font-medium text-white">{s.nome}</span> · {ROLE_LABEL[s.role]}</span>
              <span className="flex items-center gap-2"><Sino cls="inline-flex items-center gap-1 rounded border border-sky-300/40 px-2 py-1 text-xs" /><form action={sair}><button className="rounded border border-sky-300/40 px-2 py-1 text-xs">Sair</button></form></span>
            </div>
          </nav>
        </details>
        {/* Computador: barra lateral fixa */}
        <div className="hidden md:block">
          {/* marca e busca ficam fixas no topo enquanto o menu rola */}
          <div className="sticky top-0 z-10 bg-navy pb-3 shadow-[0_6px_8px_-6px_rgba(0,0,0,0.35)]">
            <div className="px-4 py-4">
              <div className="text-[11px] text-sky-200">Colégio Status</div>
              <div className="text-lg font-semibold leading-tight">STATUS ONE</div>
            </div>
            <div className="px-3"><BuscaGlobal paginas={paginasBusca} /></div>
          </div>
          <nav className="flex flex-col gap-1 px-3 pb-3">
            {links("rounded-md px-3 py-2 text-sm leading-snug text-sky-100 hover:bg-navy-700 hover:text-white", true)}
          </nav>
          <div className="border-t border-white/10 px-4 py-4 text-xs text-sky-200">
            <div className="font-medium text-white">{s.nome}</div>
            <div>{ROLE_LABEL[s.role]}</div>
            <div className="mt-3 flex items-center gap-2"><form action={sair}><button className="rounded border border-sky-300/40 px-2 py-1 text-xs hover:bg-navy-700">Sair</button></form><Sino cls="inline-flex items-center gap-1 rounded border border-sky-300/40 px-2 py-1 text-xs hover:bg-navy-700" /></div>
          </div>
        </div>
      </aside>
      <main className="min-w-0 pb-16 md:pb-0">{banco !== "ok" && !path.startsWith("/configuracoes/banco") && <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><span className="min-w-0 flex-1">{banco === "desatualizado" ? `O banco de dados está desatualizado em relação a esta versão do sistema (esquema ${SCHEMA_VERSION}). Algumas telas podem dar erro até a atualização.` : "A última atualização do banco terminou com pendências. Veja o diagnóstico."}</span>{banco === "desatualizado" && <form action={atualizarBanco}><button className="rounded-md bg-navy px-3 py-1.5 text-xs font-medium text-white">Atualizar banco agora</button></form>}<Link className="text-xs font-medium underline" href="/configuracoes/banco">Ver diagnóstico</Link></div>}{children}</main>
      <MenuInferior itens={inferior[s.role] ?? inferior.LEITURA} alertas={nAlertas} />
    </div>
  );
}
