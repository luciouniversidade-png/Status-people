import Link from "next/link";
import { NavLink } from "@/components/NavLink";
import { redirect } from "next/navigation";
import { requireSession, requireActiveUser, destroySession, can, ROLE_LABEL } from "@/lib/auth";
import { getSettings } from "@/lib/utils";

async function sair() { "use server"; await destroySession(); redirect("/login"); }

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession(); const u = await requireActiveUser(s);
  const cfg2 = await getSettings(); const { headers } = await import("next/headers"); const path = (await headers()).get("x-pathname") ?? "";
  if (u.trocarSenha && !path.startsWith("/conta")) redirect("/conta?trocar=1");
  if (cfg2.seguranca.exigir2FA.includes(s.role) && !u.totpAtivo && !path.startsWith("/conta/2fa") && !u.trocarSenha) redirect("/conta/2fa");
  const pessoas: [string, string][] = [
    ["/", "Início"], ["/colaboradores", "Colaboradores"], ["/organograma", "Organograma"],
    ["/processos", "Admissões e desligamentos"], ["/ferias", "Férias e afastamentos"], ["/banco-de-horas", "Banco de horas"], ["/ponto", "Ponto e jornada"], ["/documentos", "Documentos"], ["/relatorios", "Relatório mensal"],
    ["/desempenho", "Desempenho"], ["/recrutamento", "Recrutamento"], ["/academy", "Academy"], ["/clima", "Clima e eNPS"], ["/sucessao", "Sucessão e talentos"], ...(["RH", "DIRECAO", "DIRETOR_UNIDADE"].includes(s.role) ? [["/analytics", "People Analytics"] as [string, string]] : []), ...(can.verSalario(s) ? [["/cargos-salarios", "Cargos e salários"] as [string, string]] : []),
  ];
  const matriculas: [string, string][] = [
    ["/matriculas", "Painel de vagas"], ["/matriculas/turmas", "Turmas 2027"], ["/matriculas/alunos", "Alunos e candidatos"], ["/matriculas/reservas", "Reservas"], ["/matriculas/fila", "Lista de espera"],
  ];
  const atendimento: [string, string][] = [
    ["/atendimento", "Painel de atendimento"], ["/atendimento/casos", "Casos"], ["/atendimento/risco", "Famílias em risco"], ["/atendimento/pesquisas", "Pesquisas NPS"],
  ];
  const governanca: [string, string][] = [
    ["/governanca", "Painel de governança"], ["/governanca/pops", "POPs e processos"], ["/governanca/excecoes", "Exceções"], ["/governanca/controles", "Controles e não conformidades"], ["/governanca/decisoes", "Decisões"],
  ];
  const financeiro: [string, string][] = [
    ["/financeiro", "Painel financeiro"], ["/financeiro/inadimplencia", "Inadimplência e cobrança"], ["/financeiro/descontos", "Descontos e bolsas"], ["/financeiro/receita", "Receita"], ["/financeiro/caixa", "Fluxo de caixa"], ["/financeiro/orcamento", "Orçamento e DRE"],
  ];
  const operacoes: [string, string][] = [
    ["/operacoes", "Painel de operações"], ["/operacoes/chamados", "Chamados"], ["/operacoes/ativos", "Ativos e patrimônio"], ["/operacoes/vistorias", "Vistorias"], ["/operacoes/fornecedores", "Fornecedores"],
  ];
  const estrategia: [string, string][] = [["/estrategia", "Painel estratégico"], ["/estrategia/okrs", "OKRs"], ["/estrategia/projetos", "Projetos"]];
  const geral: [string, string][] = [
    ...(["DIRECAO", "RH", "DIRETOR_UNIDADE"].includes(s.role) ? [["/command-center", "Command Center"] as [string, string]] : []),
    ...(can.auditoria(s) ? [["/auditoria", "Auditoria"] as [string, string]] : []),
    ...(can.configurar(s) ? [["/configuracoes", "Configurações"] as [string, string]] : []),
    ["/conta", "Minha conta"],
  ];
  const grupos: [string, [string, string][]][] =
    s.role === "COLABORADOR" ? [["", [[s.employeeId ? `/colaboradores/${s.employeeId}` : "/conta", "Minha ficha"], ["/desempenho/minha", "Minha avaliação"], ["/academy/minha", "Meus treinamentos"], ["/governanca/pops", "POPs e processos"], ["/operacoes/chamados", "Abrir chamado"], ["/conta", "Minha conta"]]]] :
    s.role === "OPERACOES" ? [["Operações", operacoes], ["Estratégia", estrategia], ["Governança", [["/governanca/pops", "POPs e processos"], ["/governanca/excecoes", "Exceções"], ["/governanca/controles", "Controles e não conformidades"]]], ["", [["/conta", "Minha conta"]]]] :
    s.role === "COMERCIAL" ? [["Matrículas", matriculas], ["Atendimento", atendimento], ["Financeiro", [["/financeiro/descontos", "Descontos e bolsas"]]], ["Operações", [["/operacoes/chamados", "Abrir chamado"]]], ["Estratégia", estrategia], ["Governança", [["/governanca/pops", "POPs e processos"], ["/governanca/excecoes", "Exceções"], ["/governanca/controles", "Controles e não conformidades"]]], ["", [["/conta", "Minha conta"]]]] :
    s.role === "FINANCEIRO" ? [["Financeiro", financeiro], ["Estratégia", estrategia], ["Matrículas", [["/matriculas", "Painel de vagas"], ["/matriculas/alunos", "Alunos e candidatos"]]], ["Governança", [["/governanca/pops", "POPs e processos"], ["/governanca/excecoes", "Exceções"], ["/governanca/controles", "Controles e não conformidades"]]], ["", [["/command-center", "Command Center"], ["/conta", "Minha conta"]]]] :
    s.role === "LEITURA" ? [["Pessoas", pessoas], ["Matrículas", matriculas], ["Atendimento", atendimento], ["Governança", [["/governanca/pops", "POPs e processos"]]], ["", geral]] :
    [["Pessoas", pessoas], ["Matrículas", matriculas], ["Atendimento", atendimento], ["Financeiro", s.role === "GESTOR" ? [] : financeiro], ["Operações", operacoes], ["Estratégia", estrategia], ["Governança", governanca], ["", geral]].filter(([, items]) => items.length) as [string, [string, string][]][];
  const nav = grupos.flatMap(([, items]) => items);
  const links = (cls: string) => grupos.flatMap(([titulo, items]) => [
    titulo ? <div key={"t" + titulo} className="mt-2 px-3 pb-1 text-[10px] uppercase tracking-widest text-sky-300/80">{titulo}</div> : null,
    ...items.map(([href, label]) => <NavLink key={href} href={href} className={cls}>{label}</NavLink>),
  ]);
  void nav;
  return (
    <div className="min-h-screen md:grid md:grid-cols-[230px_1fr]">
      <aside className="sticky top-0 z-20 bg-navy text-white md:static md:min-h-screen">
        {/* Celular: cabeçalho com botão Menu que abre a lista completa */}
        <details className="md:hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 [&::-webkit-details-marker]:hidden">
            <span>
              <span className="block text-[11px] text-sky-200">Colégio Status</span>
              <span className="block text-lg font-semibold leading-tight">STATUS People</span>
            </span>
            <span className="rounded-md border border-sky-300/50 px-3 py-1.5 text-sm">☰ Menu</span>
          </summary>
          <nav className="flex flex-col gap-0.5 border-t border-white/10 px-2 py-2">
            {links("rounded-md px-3 py-2.5 text-sm text-sky-100 hover:bg-navy-700 hover:text-white")}
            <div className="mt-2 flex items-center justify-between border-t border-white/10 px-3 pt-3 text-xs text-sky-200">
              <span><span className="font-medium text-white">{s.nome}</span> · {ROLE_LABEL[s.role]}</span>
              <form action={sair}><button className="rounded border border-sky-300/40 px-2 py-1 text-xs">Sair</button></form>
            </div>
          </nav>
        </details>
        {/* Computador: barra lateral fixa */}
        <div className="hidden md:block">
          <div className="px-4 py-4">
            <div className="text-[11px] text-sky-200">Colégio Status</div>
            <div className="text-lg font-semibold leading-tight">STATUS People</div>
          </div>
          <nav className="flex flex-col gap-1 px-3 pb-3">
            {links("whitespace-nowrap rounded-md px-3 py-2 text-sm text-sky-100 hover:bg-navy-700 hover:text-white")}
          </nav>
          <div className="border-t border-white/10 px-4 py-4 text-xs text-sky-200">
            <div className="font-medium text-white">{s.nome}</div>
            <div>{ROLE_LABEL[s.role]}</div>
            <form action={sair} className="mt-3"><button className="rounded border border-sky-300/40 px-2 py-1 text-xs hover:bg-navy-700">Sair</button></form>
          </div>
        </div>
      </aside>
      <main className="min-w-0">{children}</main>
    </div>
  );
}
