import { sql } from "@/db";
import type { Session } from "./auth";
import { can } from "./auth";
import { vePainelExecutivo } from "./kpi";
import { veFluxos } from "./fluxos";
import { veContratos } from "./contratos";
import { veTela } from "./acesso";

/**
 * Início personalizável (v23): cada pessoa escolhe os blocos (e a ordem), os atalhos e os indicadores da sua página inicial.
 * Perfis que entram direto no seu módulo (Comercial, Financeiro, Operações e autoatendimento) podem optar pelo Início.
 * As escolhas ficam em user_prefs; sem escolha, valem os padrões do perfil.
 */
export type ChaveBloco = "pendencias" | "indicadores" | "fluxos" | "pessoas" | "fora" | "datas" | "mural" | "comunicados" | "auditoria";
type Bloco = { chave: ChaveBloco; nome: string; descricao: string; pode: (s: Session) => boolean; padrao: (s: Session) => boolean };
const STAFF = ["DIRECAO", "RH", "DIRETOR_UNIDADE", "GESTOR", "LEITURA"];
export const BLOCOS: Bloco[] = [
  { chave: "pendencias", nome: "Minhas pendências", descricao: "O que espera por você: vencidas, de hoje e próximas.", pode: () => true, padrao: () => true },
  { chave: "indicadores", nome: "Meus indicadores", descricao: "Cartões dos indicadores que você escolher, no último mês fechado.", pode: vePainelExecutivo, padrao: s => ["DIRECAO", "RH", "DIRETOR_UNIDADE", "FINANCEIRO", "COMERCIAL"].includes(s.role) },
  { chave: "fluxos", nome: "Prazos dos processos (SLA)", descricao: "Itens em andamento, em risco e vencidos na Central de fluxos.", pode: veFluxos, padrao: s => ["DIRECAO", "RH", "DIRETOR_UNIDADE", "GESTOR", "OPERACOES"].includes(s.role) },
  { chave: "fora", nome: "Quem está fora", descricao: "Férias, folgas, afastamentos e ausências de hoje e da semana.", pode: s => STAFF.includes(s.role), padrao: s => STAFF.includes(s.role) },
  { chave: "pessoas", nome: "Pessoas", descricao: "Quadro, admissões, desligamentos, férias a vencer, documentos e aprovações de férias.", pode: s => STAFF.includes(s.role), padrao: s => STAFF.includes(s.role) },
  { chave: "datas", nome: "Datas do mês", descricao: "Aniversariantes e tempo de casa.", pode: s => STAFF.includes(s.role), padrao: s => STAFF.includes(s.role) },
  { chave: "mural", nome: "Mural de reconhecimento", descricao: "Os reconhecimentos mais recentes entre colegas.", pode: () => true, padrao: () => true },
  { chave: "comunicados", nome: "Comunicados", descricao: "Comunicados recentes e os que pedem a sua ciência.", pode: () => true, padrao: () => true },
  { chave: "auditoria", nome: "Últimas ações registradas", descricao: "Trilha de auditoria (só Direção e RH).", pode: s => can.auditoria(s), padrao: s => can.auditoria(s) },
];

export type Atalho = { chave: string; rotulo: string; href: string; pode: (s: Session) => boolean };
export const ATALHOS: Atalho[] = [
  { chave: "pendencias", rotulo: "Minhas pendências", href: "/pendencias", pode: () => true },
  { chave: "solicitacao", rotulo: "Nova solicitação", href: "/solicitacoes/nova", pode: s => s.role !== "LEITURA" },
  { chave: "chamado", rotulo: "Abrir chamado", href: "/operacoes/chamados", pode: s => s.role !== "LEITURA" },
  { chave: "espaco", rotulo: "Reservar espaço", href: "/operacoes/espacos/reservas", pode: s => s.role !== "LEITURA" },
  { chave: "ausencia", rotulo: "Avisar ausência (substituição)", href: "/cobertura/minha", pode: s => !!s.employeeId },
  { chave: "cobertura", rotulo: "Quadro de substituições", href: "/cobertura", pode: s => ["DIRECAO", "RH", "DIRETOR_UNIDADE", "GESTOR"].includes(s.role) },
  { chave: "reconhecer", rotulo: "Reconhecer um colega", href: "/reconhecimento", pode: s => s.role !== "LEITURA" },
  { chave: "executivo", rotulo: "Painel Executivo", href: "/executivo", pode: vePainelExecutivo },
  { chave: "apresentar", rotulo: "Apresentar ao conselho", href: "/apresentacao", pode: vePainelExecutivo },
  { chave: "fluxos", rotulo: "Central de fluxos e SLA", href: "/fluxos", pode: veFluxos },
  { chave: "colaborador", rotulo: "Novo colaborador", href: "/colaboradores/novo", pode: s => can.editar(s) },
  { chave: "ferias", rotulo: "Férias e afastamentos", href: "/ferias", pode: s => STAFF.includes(s.role) },
  { chave: "quemfora", rotulo: "Quem está fora", href: "/ferias/calendario", pode: s => STAFF.includes(s.role) },
  { chave: "ponto", rotulo: "Ponto e jornada", href: "/ponto", pode: s => STAFF.includes(s.role) },
  { chave: "rematricula", rotulo: "Rematrícula", href: "/matriculas/rematricula", pode: s => !["COLABORADOR", "OPERACOES"].includes(s.role) },
  { chave: "vagas", rotulo: "Painel de vagas", href: "/matriculas", pode: s => !["COLABORADOR", "OPERACOES"].includes(s.role) },
  { chave: "caso", rotulo: "Casos das famílias", href: "/atendimento/casos", pode: s => ["DIRECAO", "RH", "DIRETOR_UNIDADE", "GESTOR", "COMERCIAL", "LEITURA"].includes(s.role) },
  { chave: "orcamento", rotulo: "Orçado × realizado", href: "/financeiro/orcamento", pode: s => ["DIRECAO", "FINANCEIRO", "DIRETOR_UNIDADE", "RH"].includes(s.role) },
  { chave: "caixa", rotulo: "Caixa projetado", href: "/financeiro/projecao", pode: s => ["DIRECAO", "FINANCEIRO", "DIRETOR_UNIDADE", "RH"].includes(s.role) },
  { chave: "inadimplencia", rotulo: "Inadimplência", href: "/financeiro/inadimplencia", pode: s => ["DIRECAO", "FINANCEIRO", "DIRETOR_UNIDADE", "RH"].includes(s.role) },
  { chave: "acoes", rotulo: "Plano de ação", href: "/estrategia/acoes", pode: s => s.role !== "COLABORADOR" },
  { chave: "contratos", rotulo: "Contratos", href: "/operacoes/contratos", pode: veContratos },
  { chave: "comunicados", rotulo: "Comunicados", href: "/comunicacao/comunicados", pode: () => true },
  { chave: "command", rotulo: "Command Center", href: "/command-center", pode: s => ["DIRECAO", "RH", "DIRETOR_UNIDADE"].includes(s.role) },
];
const ATALHOS_PADRAO: Record<string, string[]> = {
  DIRECAO: ["pendencias", "executivo", "fluxos", "apresentar", "orcamento", "reconhecer"],
  RH: ["pendencias", "colaborador", "ferias", "quemfora", "ponto", "reconhecer"],
  DIRETOR_UNIDADE: ["pendencias", "cobertura", "quemfora", "rematricula", "fluxos", "reconhecer"],
  GESTOR: ["pendencias", "cobertura", "quemfora", "caso", "acoes", "reconhecer"],
  FINANCEIRO: ["pendencias", "orcamento", "caixa", "inadimplencia", "executivo", "solicitacao"],
  OPERACOES: ["pendencias", "chamado", "espaco", "fluxos", "contratos", "solicitacao"],
  COMERCIAL: ["pendencias", "vagas", "rematricula", "caso", "solicitacao", "reconhecer"],
  LEITURA: ["executivo", "fluxos", "quemfora", "comunicados"],
  COLABORADOR: ["pendencias", "ausencia", "solicitacao", "chamado", "espaco", "reconhecer"],
};
export const MAX_ATALHOS = 8, MAX_KPIS_INICIO = 8;
/** v29: bloco e atalho só aparecem para quem vê a tela de onde eles vêm (acesso do cargo). */
const TELA_DO_BLOCO: Partial<Record<ChaveBloco, string>> = { indicadores: "/executivo", fluxos: "/fluxos", fora: "/ferias/calendario", pessoas: "/colaboradores", auditoria: "/auditoria", mural: "/reconhecimento", comunicados: "/comunicacao/comunicados" };
const podeBloco = (b: Bloco, s: Session) => b.pode(s) && (!TELA_DO_BLOCO[b.chave] || veTela(s, TELA_DO_BLOCO[b.chave]!));
const podeAtalho = (a: Atalho, s: Session) => a.pode(s) && veTela(s, a.href);
/** Perfis que, por padrão, entram direto no seu módulo (e podem escolher o Início). */
export const PERFIS_MODULO: Record<string, string> = { COMERCIAL: "/matriculas", FINANCEIRO: "/financeiro", OPERACOES: "/operacoes" };

export type Preferencias = { blocos: ChaveBloco[]; atalhos: string[]; kpis: string[] | null; paginaInicial: "inicio" | "modulo"; personalizado: boolean };
export function padroes(s: Session): Preferencias {
  return { blocos: BLOCOS.filter(b => podeBloco(b, s) && b.padrao(s)).map(b => b.chave), atalhos: (ATALHOS_PADRAO[s.role] ?? []).filter(a => { const x = ATALHOS.find(y => y.chave === a); return !!x && podeAtalho(x, s); }), kpis: null, paginaInicial: "modulo", personalizado: false };
}
/** Preferências gravadas, sempre filtradas pelo que o perfil pode ver hoje (um bloco removido do perfil some sozinho). */
export async function preferencias(s: Session): Promise<Preferencias> {
  const base = padroes(s);
  const [r] = await sql<{ inicio: { blocos?: string[]; kpis?: string[]; paginaInicial?: string } | null; atalhos: string[] | null }[]>`SELECT inicio, atalhos FROM user_prefs WHERE user_id=${s.id}`.catch(() => [] as never[]);
  if (!r) return base;
  const blocos = Array.isArray(r.inicio?.blocos) ? r.inicio!.blocos.filter((b): b is ChaveBloco => !!BLOCOS.find(x => x.chave === b && podeBloco(x, s))) : base.blocos;
  const atalhos = Array.isArray(r.atalhos) ? r.atalhos.filter(a => !!ATALHOS.find(x => x.chave === a && podeAtalho(x, s))).slice(0, MAX_ATALHOS) : base.atalhos;
  const kpis = Array.isArray(r.inicio?.kpis) ? r.inicio!.kpis.slice(0, MAX_KPIS_INICIO).map(String) : null;
  return { blocos, atalhos, kpis, paginaInicial: r.inicio?.paginaInicial === "inicio" ? "inicio" : "modulo", personalizado: true };
}
export const atalhosDe = (s: Session, chaves: string[]) => chaves.map(c => ATALHOS.find(a => a.chave === c)).filter((a): a is Atalho => !!a && podeAtalho(a, s));
export const blocosPossiveis = (s: Session) => BLOCOS.filter(b => podeBloco(b, s));
export const atalhosPossiveis = (s: Session) => ATALHOS.filter(a => podeAtalho(a, s));
