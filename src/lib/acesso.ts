/**
 * v29 · Acesso pelo cargo.
 *
 * Quem a pessoa é no sistema vem do CARGO da ficha dela, não de um perfil escolhido à mão:
 *  - atuação do cargo  → como ela atua dentro das telas (o que pode fazer e o alcance: a unidade dela ou a rede);
 *  - telas do cargo    → o que ela vê no menu e consegue abrir (o auxiliar financeiro não vê o que o gerente vê);
 *  - aprovações        → o que ela aprova (alçadas), cargo a cargo.
 * Promoveu ou mudou o cargo na ficha → o acesso muda na próxima tela. Desligou → o acesso cai.
 * Exceções existem, mas são raras e ficam à vista: exceção individual (com motivo) e substituição temporária (com data de fim).
 * Contas sem ficha (contabilidade externa, consultoria, TI, homologação) têm a atuação definida no próprio acesso.
 */
import { cache } from "react";
import { sql } from "@/db";
import { DEFAULT_SETTINGS } from "@/db/setup";
import type { Role, Session } from "./session";
import { montarMenu, type GrupoMenu, type ItemInferior } from "./menu";

export type Origem = "CARGO" | "SEM_CARGO" | "EXCECAO" | "DIRETO";
/** Acesso definido no cargo (positions.acesso). telas/aprova nulos = tudo o que a atuação permite / padrão da atuação. */
export type DefAcesso = { atuacao: Role; telas: string[] | null; aprova: string[] | null; descontoPct?: number | null; atualizadoEm?: string; atualizadoPor?: string; /** atuação só sugerida (pelo nome do cargo), ainda não confirmada por uma pessoa */ sugerida?: boolean };
/** users.acesso — na conta vinculada a uma ficha é a EXCEÇÃO individual (com motivo); na conta sem ficha, as telas e aprovações dela. */
export type AcessoUsuario = { atuacao?: Role; telas?: string[] | null; aprova?: string[] | null; descontoPct?: number | null; unitId?: number | null; motivo?: string | null; em?: string; por?: string };
/** users.substituicao — por um período a pessoa recebe também o acesso de outro cargo (férias, licença, vaga em aberto). */
export type Substituicao = { positionId: number; ate: string; motivo: string; desde?: string; por?: string };

export const ATUACOES: Role[] = ["DIRECAO", "RH", "DIRETOR_UNIDADE", "GESTOR", "FINANCEIRO", "COMERCIAL", "OPERACOES", "LEITURA", "COLABORADOR"];
export const ATUACAO: Record<Role, { rotulo: string; curto: string; descricao: string; alcance: "REDE" | "UNIDADE" }> = {
  DIRECAO: { rotulo: "Direção da rede", curto: "Direção", descricao: "Vê e decide sobre tudo, nas quatro unidades.", alcance: "REDE" },
  RH: { rotulo: "Gestão de pessoas (RH)", curto: "RH", descricao: "Pessoas, folha, ponto, recrutamento e desempenho da rede; configura o sistema.", alcance: "REDE" },
  DIRETOR_UNIDADE: { rotulo: "Direção da unidade", curto: "Direção da unidade", descricao: "A própria unidade inteira: pessoas, matrículas, financeiro e operações.", alcance: "UNIDADE" },
  GESTOR: { rotulo: "Coordenação e liderança", curto: "Coordenação", descricao: "Equipe e rotina da unidade: pessoas, ponto, matrículas, operações e estratégia.", alcance: "UNIDADE" },
  FINANCEIRO: { rotulo: "Financeiro", curto: "Financeiro", descricao: "Opera o financeiro da rede: recebimentos, conciliação, contas a pagar, orçamento e DRE.", alcance: "REDE" },
  COMERCIAL: { rotulo: "Comercial e atendimento", curto: "Comercial", descricao: "Matrículas, rematrícula, atendimento às famílias, descontos e portaria.", alcance: "REDE" },
  OPERACOES: { rotulo: "Operações e manutenção", curto: "Operações", descricao: "Chamados, ativos, vistorias, fornecedores, espaços e portaria.", alcance: "REDE" },
  LEITURA: { rotulo: "Consulta (somente leitura)", curto: "Consulta", descricao: "Consulta painéis, pessoas, matrículas e relatórios da rede, sem alterar nada.", alcance: "REDE" },
  COLABORADOR: { rotulo: "Autoatendimento", curto: "Autoatendimento", descricao: "Só a própria ficha: férias, holerites, treinamentos, avaliação, pedidos e chamados.", alcance: "UNIDADE" },
};
export const rotuloAtuacao = (r: string | null | undefined) => (r && r in ATUACAO ? ATUACAO[r as Role].rotulo : r ?? "—");
export const rotuloAlcance = (r: Role, unidade?: string | null) => (ATUACAO[r]?.alcance === "UNIDADE" ? (unidade ? `unidade ${unidade}` : "a unidade da pessoa") : "a rede toda");

/** Aprovações que se marcam cargo a cargo. As 12 alçadas de sempre + baixa manual e comunicação em massa. */
export const ALCADAS = [
  { chave: "ferias", rotulo: "Aprova férias e afastamentos", curto: "Férias", area: "Pessoas" },
  { chave: "banco", rotulo: "Aprova lançamentos do banco de horas", curto: "Banco de horas", area: "Pessoas" },
  { chave: "processos", rotulo: "Conclui admissões e desligamentos", curto: "Admissão/deslig.", area: "Pessoas" },
  { chave: "vagas", rotulo: "Aprova requisição de vaga", curto: "Vagas", area: "Pessoas" },
  { chave: "remuneracao", rotulo: "Altera faixas e salários", curto: "Salários", area: "Pessoas" },
  { chave: "calibracao", rotulo: "Calibra e encerra ciclos de desempenho", curto: "Calibração", area: "Pessoas" },
  { chave: "matricula", rotulo: "Confirma matrícula (contrato + financeiro)", curto: "Matrícula", area: "Matrículas" },
  { chave: "excecaoCapacidade", rotulo: "Autoriza matrícula acima da capacidade", curto: "Acima da capac.", area: "Matrículas" },
  { chave: "financeiro", rotulo: "Importa títulos e caixa; edita orçamento, preços e plano de contas", curto: "Orçamento e plano", area: "Financeiro" },
  { chave: "contasPagar", rotulo: "Aprova conta a pagar acima da alçada ou fora do orçamento", curto: "Contas a pagar", area: "Financeiro" },
  { chave: "baixaManual", rotulo: "Registra baixa manual de conta a pagar (sem extrato)", curto: "Baixa manual", area: "Financeiro" },
  { chave: "excecao", rotulo: "Aprova exceções a POPs e regras", curto: "Exceções", area: "Governança" },
  { chave: "pops", rotulo: "Publica POPs e registra decisões", curto: "POPs e decisões", area: "Governança" },
  { chave: "massa", rotulo: "Aprova comunicação em massa (segundo humano)", curto: "Comunicação em massa", area: "Comunicação" },
] as const;
export type Alcada = (typeof ALCADAS)[number]["chave"];
export const rotuloAlcada = (k: string) => ALCADAS.find(a => a.chave === k)?.rotulo ?? k;
export const ehAlcada = (k: string): k is Alcada => ALCADAS.some(a => a.chave === k);

/** Padrão por atuação de cada aprovação: as alçadas de Configurações, a baixa manual (Contas a pagar) e a aprovação de massa (Comunicação). */
export type PadraoAprovacao = Record<string, string[]>;
export function padraoDeConfig(cfg: { alcadas?: unknown; contasPagar?: unknown; comunicacao?: unknown }): PadraoAprovacao {
  const base = { ...(DEFAULT_SETTINGS.alcadas as Record<string, string[]>), ...((cfg.alcadas ?? {}) as Record<string, string[]>) };
  const cp = { ...(DEFAULT_SETTINGS.contasPagar as Record<string, unknown>), ...((cfg.contasPagar ?? {}) as Record<string, unknown>) };
  const com = { ...(DEFAULT_SETTINGS.comunicacao as Record<string, unknown>), ...((cfg.comunicacao ?? {}) as Record<string, unknown>) };
  return { ...base, contasPagar: (base.contasPagar ?? ["DIRECAO"]) as string[], baixaManual: (cp.baixaManualPerfis ?? ["DIRECAO", "FINANCEIRO"]) as string[], massa: (com.aprovadoresMassa ?? ["DIRECAO", "RH"]) as string[] };
}
let _padraoEstatico: PadraoAprovacao | null = null;
const padraoEstatico = () => (_padraoEstatico ??= padraoDeConfig({}));
export const aprovaPadrao = (role: Role, padrao?: PadraoAprovacao) => ALCADAS.map(a => a.chave).filter(k => ((padrao ?? padraoEstatico())[k] ?? []).includes(role));
/** Aprovações efetivas de uma sessão; sessão montada à mão (rotinas antigas) cai no padrão da atuação. */
export const aprovacoesDa = (s: Session) => s.aprova ?? aprovaPadrao(s.role);
export async function lerPadraoAprovacao(): Promise<PadraoAprovacao> { return (await lerPadroes()).aprova; }
/** Alçada de desconto (%) por atuação — Configurações → Financeiro (descontos e bolsas). */
export type PadraoDesconto = Record<string, number>;
const descontoDeConfig = (fin: unknown): PadraoDesconto => ({ ...((DEFAULT_SETTINGS.financeiro as { alcadaDescontoPct: Record<string, number> }).alcadaDescontoPct), ...(((fin ?? {}) as { alcadaDescontoPct?: Record<string, number> }).alcadaDescontoPct ?? {}) });
export type Padroes = { aprova: PadraoAprovacao; desconto: PadraoDesconto };
export async function lerPadroes(): Promise<Padroes> {
  try {
    const rows = await sql<{ key: string; value: unknown }[]>`SELECT key, value FROM settings WHERE key IN ('alcadas','contasPagar','comunicacao','financeiro')`; const o: Record<string, unknown> = {}; for (const r of rows) o[r.key] = r.value;
    return { aprova: padraoDeConfig(o), desconto: descontoDeConfig(o.financeiro) };
  } catch { return { aprova: padraoEstatico(), desconto: descontoDeConfig(null) }; }
}
export const descontoPadrao = (role: Role, d?: PadraoDesconto) => Number((d ?? descontoDeConfig(null))[role] ?? 0);
/** Até quantos % de desconto a pessoa aprova (cargo, exceção ou padrão da atuação). */
export const alcadaDesconto = (s: Session, d?: PadraoDesconto) => s.descontoPct ?? descontoPadrao(s.role, d);

// ------------------------------------------------------------------ atuação sugerida para cargos novos e para a migração
const SUGESTAO: Record<string, Role> = {
  "diretor geral (sócio)": "DIRECAO", "diretor pedagógico": "DIRECAO", "diretora de gente e gestão": "DIRECAO",
  "gerente de experiência e crescimento": "COMERCIAL", "gerente financeiro": "FINANCEIRO", "coordenador pedagógico": "GESTOR", "coordenadora de rh": "RH",
  "coordenador de infraestrutura e manutenção": "OPERACOES", "coordenadora de eventos e desenvolvimento científico": "GESTOR",
  "analista de atendimento": "COMERCIAL", "analista de marketing": "COMERCIAL", "auxiliar de atendimento": "COMERCIAL", "secretária": "COMERCIAL",
  "tesoureiro": "FINANCEIRO", "técnico de manutenção": "OPERACOES",
};
/** Ponto de partida para a atuação de um cargo, pelo nome (o RH confirma no editor). Na dúvida: autoatendimento (o menor acesso). */
export function atuacaoSugerida(nome: string, familia?: string | null): Role {
  const n = nome.trim().toLowerCase(); if (SUGESTAO[n]) return SUGESTAO[n];
  if (/s[óo]cio|diretor[a]? geral|presidente|superintend/.test(n)) return "DIRECAO";
  if (/diretor[a]? (da |de )?unidade/.test(n)) return "DIRETOR_UNIDADE";
  if (/\brh\b|recursos humanos|departamento pessoal|\bdp\b|gente e gest/.test(n)) return "RH";
  if (/financ|tesour|contab|cobran[çc]|faturamento|contas a pagar|controlador/.test(n)) return "FINANCEIRO";
  if (/comercial|atendimento|secret[áa]ri|marketing|matr[íi]cula|capta[çc][ãa]o|relacionamento|recep[çc]/.test(n)) return "COMERCIAL";
  if (/t[ée]cnico de manuten|manuten[çc][ãa]o predial|infraestrutura|facilities/.test(n)) return "OPERACOES";
  if (/diretor/.test(n)) return "DIRECAO";
  if (/coordena|supervis|gerente|l[íi]der|chefe/.test(n) || familia === "COORDENACAO" || familia === "GESTAO") return "GESTOR";
  return "COLABORADOR";
}
/** Acesso de um cargo: o que está gravado nele ou, cargo ainda não revisado, a sugestão pelo nome com todas as telas e aprovações da atuação. */
export function defDoCargo(p: { nome: string; acesso: unknown; familia?: string | null } | null | undefined): DefAcesso {
  const a = (p?.acesso ?? null) as Partial<DefAcesso> | null;
  if (a && a.atuacao && a.atuacao in ATUACAO) return { atuacao: a.atuacao, telas: Array.isArray(a.telas) ? a.telas : null, aprova: Array.isArray(a.aprova) ? a.aprova : null, descontoPct: typeof a.descontoPct === "number" ? a.descontoPct : null, atualizadoEm: a.atualizadoEm, atualizadoPor: a.atualizadoPor, sugerida: !!(a.sugerida ?? /sugest/i.test(a.atualizadoPor ?? "")) };
  return { atuacao: p ? atuacaoSugerida(p.nome, p.familia) : "COLABORADOR", telas: null, aprova: null, sugerida: true };
}
/** Cargo cuja atuação ainda não foi confirmada por uma pessoa (sem acesso salvo, ou só sugerida pelo nome — na criação ou na atualização para a v29). */
export const naoRevisado = (acesso: unknown) => { const a = (acesso ?? null) as Partial<DefAcesso> | null; return !a?.atuacao || !!(a.sugerida ?? /sugest/i.test(a.atualizadoPor ?? "")); };

// ------------------------------------------------------------------ telas (o catálogo é o próprio menu de cada atuação)
export type Tela = { grupo: string; chave: string; rotulo: string; fixa: boolean };
/** Telas que sempre ficam (pessoais): não dá para tirar de ninguém. */
export const TELAS_FIXAS = new Set(["/", "/conta", "/notificacoes", "/eu", "/colaboradores/:eu", "/pendencias"]);
/** Telas fora do menu que pertencem a outra tela (o prefixo do endereço não diria). */
const DONO_DA_ROTA: [string, string][] = [["/financeiro/lancamentos", "/financeiro/caixa"], ["/estrategia/cronograma", "/estrategia/projetos"], ["/estrategia/reunioes", "/estrategia/rituais"], ["/estrategia/alinhamento", "/estrategia/okrs"], ["/matriculas/importar", "/matriculas/alunos"]];
/** Endereços pessoais: valem para todos, independentemente do cargo. */
const PESSOAIS = ["/conta", "/notificacoes", "/eu", "/meu-painel", "/pendencias", "/desempenho/minha", "/academy/minha", "/cobertura/minha", "/sem-acesso", "/inicio/personalizar",
  // v30 · convites pessoais (a página confere se o convite é da pessoa): notas de avaliador de candidato, a contratação aos 90 dias e o certificado de um treinamento
  "/recrutamento/avaliar", "/recrutamento/contratacao", "/academy/certificado", "/academy/aprovar"];
const EU = -424242; // ficha fictícia para montar o catálogo (os itens “meus” entram como /colaboradores/:eu)

export function chaveTela(href: string, employeeId: number | null | undefined = null): string {
  let p = href.split("#")[0].split("?")[0]; if (p.length > 1) p = p.replace(/\/+$/, "");
  const id = employeeId ?? EU; const m = /^\/colaboradores\/(-?\d+)(\/.*)?$/.exec(p);
  if (m && Number(m[1]) === id) return `/colaboradores/:eu${m[2] ?? ""}`;
  return p || "/";
}
const _telas = new Map<Role, Tela[]>();
/** Telas que a atuação pode ver, na ordem e nos grupos do menu. Base do editor do cargo e do bloqueio por endereço. */
export function telasDaAtuacao(role: Role): Tela[] {
  const c = _telas.get(role); if (c) return c;
  const s = { id: 0, nome: "", email: "", role, unitId: 1, employeeId: EU } as Session;
  const { grupos } = montarMenu(s, { nNotif: 0, membroEtica: true, gestorPriv: true, temEquipe: true });
  const vistas = new Set<string>(); const out: Tela[] = [];
  for (const [g, itens] of grupos) for (const [h, r] of itens) { const chave = chaveTela(h, EU); if (vistas.has(chave)) continue; vistas.add(chave); out.push({ grupo: g || "Geral", chave, rotulo: r.replace(/ \(\d+\)$/, ""), fixa: TELAS_FIXAS.has(chave) }); }
  _telas.set(role, out); return out;
}
/** Tela do catálogo da atuação que governa um endereço (a mais específica); null = endereço fora do catálogo (vale a regra da própria página). */
export function telaDoCaminho(path: string, role: Role, employeeId: number | null | undefined): string | null {
  let p = path.split("#")[0].split("?")[0] || "/"; if (p.length > 1) p = p.replace(/\/+$/, "");
  if (employeeId && (p === `/colaboradores/${employeeId}` || p.startsWith(`/colaboradores/${employeeId}/`) || p === `/ponto/${employeeId}`)) return "/colaboradores/:eu";
  if (PESSOAIS.some(x => p === x || p.startsWith(`${x}/`))) return null;
  if (p === "/") return "/";
  const dono = DONO_DA_ROTA.find(([r]) => p === r || p.startsWith(`${r}/`)); if (dono) p = dono[1];
  let melhor: string | null = null;
  for (const t of telasDaAtuacao(role)) { const k = t.chave; if (k === "/" || k.includes(":eu")) continue; if ((p === k || p.startsWith(`${k}/`)) && (!melhor || k.length > melhor.length)) melhor = k; }
  return melhor;
}
/** A pessoa vê esta tela (endereço ou href do menu)? */
export function veTela(s: Session, hrefOuCaminho: string): boolean {
  if (!s.telas) return true;
  const k = hrefOuCaminho.includes(":eu") ? hrefOuCaminho : telaDoCaminho(hrefOuCaminho, s.role, s.employeeId);
  return k === null || TELAS_FIXAS.has(k) || s.telas.includes(k);
}
/** Chave da tela bloqueada para a pessoa neste endereço (null = pode abrir). */
export function telaBloqueada(s: Session, path: string): string | null {
  if (!s.telas || !path) return null;
  const k = telaDoCaminho(path, s.role, s.employeeId);
  return k === null || TELAS_FIXAS.has(k) || s.telas.includes(k) ? null : k;
}
export function rotuloTela(chave: string): string {
  for (const r of ATUACOES) { const t = telasDaAtuacao(r).find(x => x.chave === chave); if (t) return t.rotulo; }
  return chave;
}
/** Menu da pessoa: o da atuação, sem as telas que o cargo não marcou. */
export function filtrarMenu(grupos: GrupoMenu[], inferior: ItemInferior[], s: Session): { grupos: GrupoMenu[]; inferior: ItemInferior[] } {
  if (!s.telas) return { grupos, inferior };
  const ve = (h: string) => { const k = chaveTela(h, s.employeeId); return TELAS_FIXAS.has(k) || veTela(s, k); };
  return { grupos: grupos.map(([g, xs]) => [g, xs.filter(([h]) => ve(h))] as GrupoMenu).filter(([, xs]) => xs.length > 0), inferior: inferior.filter(i => ve(i.href)) };
}
/** Telas efetivas (lista explícita) a partir da definição: nulo vira todas as da atuação. */
const expandir = (role: Role, telas: string[] | null) => (telas ?? telasDaAtuacao(role).map(t => t.chave));
/** Só o que a atuação tem no catálogo (tela de outra atuação não entra) + as fixas. */
export function normalizarTelas(role: Role, telas: string[] | null): string[] | null {
  if (telas === null) return null; const disp = new Set(telasDaAtuacao(role).map(t => t.chave)); const set = new Set(telas.filter(k => disp.has(k)));
  for (const t of telasDaAtuacao(role)) if (t.fixa) set.add(t.chave);
  return disp.size === set.size ? null : telasDaAtuacao(role).map(t => t.chave).filter(k => set.has(k));
}

// ------------------------------------------------------------------ acesso efetivo
const PRECEDENCIA: Role[] = ["DIRECAO", "RH", "DIRETOR_UNIDADE", "FINANCEIRO", "GESTOR", "COMERCIAL", "OPERACOES", "LEITURA", "COLABORADOR"];
const acima = (a: Role, b: Role) => PRECEDENCIA.indexOf(a) <= PRECEDENCIA.indexOf(b);
export type LinhaAcesso = {
  id: number; nome: string; email: string; role: string; unit_id: number | null; employee_id: number | null; ativo: boolean; acesso: unknown; substituicao: unknown;
  e_unit: number | null; e_sit: string | null; e_pos: number | null; p_nome: string | null; p_acesso: unknown; p_familia: string | null;
  s_nome: string | null; s_acesso: unknown; s_familia: string | null; s_pos: number | null;
};
export type Efetivo = {
  role: Role; unitId: number | null; telas: string[] | null; aprova: string[]; origem: Origem; cargo: string | null; positionId: number | null;
  substituicao: { cargo: string; ate: string; motivo: string } | null; excecaoMotivo: string | null; bloqueio: null | "DESLIGADO"; descontoPct: number;
};
const hojeLocal = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Campo_Grande" });

export function calcularAcesso(u: LinhaAcesso, padrao: PadraoAprovacao, hoje = hojeLocal(), desconto?: PadraoDesconto): Efetivo {
  const ua = (u.acesso ?? null) as AcessoUsuario | null;
  let base: DefAcesso; let origem: Origem; let unitId: number | null; let excecaoMotivo: string | null = null;
  const vinculado = !!u.employee_id && u.e_sit !== null;
  if (vinculado && ua?.atuacao && ua.atuacao in ATUACAO) {
    base = { atuacao: ua.atuacao, telas: Array.isArray(ua.telas) ? ua.telas : null, aprova: Array.isArray(ua.aprova) ? ua.aprova : null, descontoPct: typeof ua.descontoPct === "number" ? ua.descontoPct : null }; origem = "EXCECAO"; excecaoMotivo = ua.motivo ?? null;
    unitId = ua.unitId !== undefined ? ua.unitId : u.e_unit;
  } else if (vinculado) {
    base = u.e_pos ? defDoCargo({ nome: u.p_nome ?? "", acesso: u.p_acesso, familia: u.p_familia }) : { atuacao: "COLABORADOR", telas: null, aprova: null };
    origem = u.e_pos ? "CARGO" : "SEM_CARGO"; unitId = u.e_unit;
  } else {
    const r = (u.role in ATUACAO ? u.role : "LEITURA") as Role;
    base = { atuacao: r, telas: ua && Array.isArray(ua.telas) ? ua.telas : null, aprova: ua && Array.isArray(ua.aprova) ? ua.aprova : null, descontoPct: ua && typeof ua.descontoPct === "number" ? ua.descontoPct : null }; origem = "DIRETO"; unitId = u.unit_id;
  }
  let role = base.atuacao; let telas = base.telas ? normalizarTelas(role, base.telas) : null; let aprova = base.aprova ?? aprovaPadrao(role, padrao);
  let descontoPct = typeof base.descontoPct === "number" ? base.descontoPct : descontoPadrao(role, desconto);
  // substituição temporária: assume o acesso do cargo substituído (se for maior) e soma telas e aprovações
  const sub = (u.substituicao ?? null) as Substituicao | null; let substituicao: Efetivo["substituicao"] = null;
  if (sub && sub.positionId && u.s_pos && sub.ate >= hoje) {
    const d = defDoCargo({ nome: u.s_nome ?? "", acesso: u.s_acesso, familia: u.s_familia });
    const novo = acima(d.atuacao, role) ? d.atuacao : role;
    const uniao = new Set([...expandir(role, telas), ...expandir(d.atuacao, d.telas ? normalizarTelas(d.atuacao, d.telas) : null)]);
    telas = normalizarTelas(novo, [...uniao]); role = novo;
    aprova = [...new Set([...aprova, ...(d.aprova ?? aprovaPadrao(d.atuacao, padrao))])];
    descontoPct = Math.max(descontoPct, typeof d.descontoPct === "number" ? d.descontoPct : descontoPadrao(d.atuacao, desconto));
    substituicao = { cargo: u.s_nome ?? "", ate: sub.ate, motivo: sub.motivo };
  }
  const ordem = ALCADAS.map(a => a.chave); aprova = ordem.filter(k => aprova.includes(k));
  // alcance: atuação de unidade fica presa à unidade da ficha; atuação de rede não tem unidade (como as contas de rede sempre foram)
  if (origem !== "DIRETO") unitId = ATUACAO[role].alcance === "UNIDADE" ? unitId : null;
  return { role, unitId, telas, aprova, origem, cargo: vinculado ? u.p_nome : null, positionId: vinculado ? u.e_pos : null, substituicao, excecaoMotivo, bloqueio: vinculado && u.e_sit === "DESLIGADO" ? "DESLIGADO" : null, descontoPct };
}

/** Grava o acesso efetivo nas colunas que as consultas usam (users.role, unit_id, aprova, origem_acesso) e encerra quem foi desligado. */
async function materializar(u: LinhaAcesso & { aprova_atual?: string[] | null; origem_atual?: string | null; desconto_atual?: number | null }, ef: Efetivo) {
  const mudou = u.role !== ef.role || (u.unit_id ?? null) !== (ef.unitId ?? null) || JSON.stringify(u.aprova_atual ?? null) !== JSON.stringify(ef.aprova) || (u.origem_atual ?? null) !== ef.origem || Number(u.desconto_atual ?? -1) !== ef.descontoPct;
  if (mudou) await sql`UPDATE users SET role=${ef.role}, unit_id=${ef.unitId}, aprova=${ef.aprova}, origem_acesso=${ef.origem}, desconto_pct=${ef.descontoPct} WHERE id=${u.id}`;
  if (ef.bloqueio === "DESLIGADO" && u.ativo) {
    await sql`UPDATE users SET ativo=false WHERE id=${u.id}`;
    await sql`INSERT INTO audit_log (user_id, user_nome, acao, entidade, entidade_id, antes, depois) VALUES (NULL, 'sistema', 'acesso encerrado: ficha desligada', 'users', ${u.id}, NULL, NULL)`;
  }
  return mudou;
}

export type CargaSessao = { s: Session; ef: Efetivo } | { s: null; motivo: "inativo" | "desligado" | null };
/** Sessão completa a partir do banco (o cookie só identifica a pessoa). Uma consulta por requisição. */
async function carregar(userId: number): Promise<CargaSessao> {
  let u: (LinhaAcesso & { aprova_atual: string[] | null; origem_atual: string | null; desconto_atual: number | null }) | undefined;
  try {
    [u] = await sql<(LinhaAcesso & { aprova_atual: string[] | null; origem_atual: string | null; desconto_atual: number | null })[]>`
      SELECT u.id, u.nome, u.email, u.role, u.unit_id, u.employee_id, u.ativo, u.acesso, u.substituicao, u.aprova AS aprova_atual, u.origem_acesso AS origem_atual, u.desconto_pct::float AS desconto_atual,
             e.unit_id AS e_unit, e.situacao AS e_sit, e.position_id AS e_pos, p.nome AS p_nome, p.acesso AS p_acesso, p.familia AS p_familia,
             ps.id AS s_pos, ps.nome AS s_nome, ps.acesso AS s_acesso, ps.familia AS s_familia
      FROM users u LEFT JOIN employees e ON e.id = u.employee_id LEFT JOIN positions p ON p.id = e.position_id
      LEFT JOIN positions ps ON ps.id = CASE WHEN jsonb_typeof(u.substituicao->'positionId') = 'number' THEN (u.substituicao->>'positionId')::int END
      WHERE u.id = ${userId}`;
  } catch {
    // banco ainda sem as colunas da v29 (atualização pendente): sessão como antes, pelo perfil gravado
    const [v] = await sql<{ id: number; nome: string; email: string; role: Role; unit_id: number | null; employee_id: number | null; ativo: boolean }[]>`SELECT id, nome, email, role, unit_id, employee_id, ativo FROM users WHERE id=${userId}`;
    if (!v) return { s: null, motivo: null }; if (!v.ativo) return { s: null, motivo: "inativo" };
    const s: Session = { id: v.id, nome: v.nome, email: v.email, role: v.role, unitId: v.unit_id, employeeId: v.employee_id, telas: null, aprova: aprovaPadrao(v.role), cargo: null, origem: "DIRETO", descontoPct: descontoPadrao(v.role) };
    return { s, ef: { role: v.role, unitId: v.unit_id, telas: null, aprova: s.aprova!, origem: "DIRETO", cargo: null, positionId: null, substituicao: null, excecaoMotivo: null, bloqueio: null, descontoPct: s.descontoPct! } };
  }
  if (!u) return { s: null, motivo: null };
  const pd = await lerPadroes(); const ef = calcularAcesso(u, pd.aprova, undefined, pd.desconto);
  try { await materializar(u, ef); } catch { /* conferência de consistência: nunca derruba a tela */ }
  if (ef.bloqueio === "DESLIGADO") return { s: null, motivo: "desligado" };
  if (!u.ativo) return { s: null, motivo: "inativo" };
  const s: Session = { id: u.id, nome: u.nome, email: u.email, role: ef.role, unitId: ef.unitId, employeeId: u.employee_id, telas: ef.telas, aprova: ef.aprova, cargo: ef.cargo, positionId: ef.positionId, origem: ef.origem, substituicao: ef.substituicao, descontoPct: ef.descontoPct };
  return { s, ef };
}
export const carregarSessao = cache(carregar);
/** Sessão de um usuário fora de uma requisição (rotinas, avisos): mesma regra, sem cache. */
export async function sessaoDoUsuario(userId: number): Promise<Session | null> { const r = await carregar(userId); return r.s; }

/** Acesso efetivo de um usuário para conferência (“o que esta pessoa vê”), sem gravar nada — vale também para conta inativa. */
export async function efetivoDoUsuario(userId: number): Promise<{ linha: LinhaAcesso; ef: Efetivo; sessao: Session } | null> {
  const [u] = await sql<LinhaAcesso[]>`
    SELECT u.id, u.nome, u.email, u.role, u.unit_id, u.employee_id, u.ativo, u.acesso, u.substituicao,
           e.unit_id AS e_unit, e.situacao AS e_sit, e.position_id AS e_pos, p.nome AS p_nome, p.acesso AS p_acesso, p.familia AS p_familia,
           ps.id AS s_pos, ps.nome AS s_nome, ps.acesso AS s_acesso, ps.familia AS s_familia
    FROM users u LEFT JOIN employees e ON e.id = u.employee_id LEFT JOIN positions p ON p.id = e.position_id
    LEFT JOIN positions ps ON ps.id = CASE WHEN jsonb_typeof(u.substituicao->'positionId') = 'number' THEN (u.substituicao->>'positionId')::int END
    WHERE u.id = ${userId}`;
  if (!u) return null; const pd = await lerPadroes(); const ef = calcularAcesso(u, pd.aprova, undefined, pd.desconto);
  return { linha: u, ef, sessao: { id: u.id, nome: u.nome, email: u.email, role: ef.role, unitId: ef.unitId, employeeId: u.employee_id, telas: ef.telas, aprova: ef.aprova, cargo: ef.cargo, positionId: ef.positionId, origem: ef.origem, substituicao: ef.substituicao, descontoPct: ef.descontoPct } };
}

/** Recalcula o acesso de todos (ou de alguns): depois de mudar o cargo, a ficha, a importação ou a rotina diária. Devolve quantos mudaram. */
export async function sincronizarAcessos(ids?: number[]): Promise<{ mudaram: number; encerrados: number }> {
  let rows: (LinhaAcesso & { aprova_atual: string[] | null; origem_atual: string | null; desconto_atual: number | null })[];
  try {
    rows = await sql<(LinhaAcesso & { aprova_atual: string[] | null; origem_atual: string | null; desconto_atual: number | null })[]>`
      SELECT u.id, u.nome, u.email, u.role, u.unit_id, u.employee_id, u.ativo, u.acesso, u.substituicao, u.aprova AS aprova_atual, u.origem_acesso AS origem_atual, u.desconto_pct::float AS desconto_atual,
             e.unit_id AS e_unit, e.situacao AS e_sit, e.position_id AS e_pos, p.nome AS p_nome, p.acesso AS p_acesso, p.familia AS p_familia,
             ps.id AS s_pos, ps.nome AS s_nome, ps.acesso AS s_acesso, ps.familia AS s_familia
      FROM users u LEFT JOIN employees e ON e.id = u.employee_id LEFT JOIN positions p ON p.id = e.position_id
      LEFT JOIN positions ps ON ps.id = CASE WHEN jsonb_typeof(u.substituicao->'positionId') = 'number' THEN (u.substituicao->>'positionId')::int END
      WHERE ${ids && ids.length ? sql`u.id = ANY(${ids})` : sql`true`}`;
  } catch { return { mudaram: 0, encerrados: 0 }; }
  const pd = await lerPadroes(); let mudaram = 0, encerrados = 0;
  for (const u of rows) { const ef = calcularAcesso(u, pd.aprova, undefined, pd.desconto); if (await materializar(u, ef)) mudaram++; if (ef.bloqueio === "DESLIGADO" && u.ativo) encerrados++; }
  return { mudaram, encerrados };
}
/** Acessos ligados a fichas (para sincronizar depois de mexer em colaboradores ou cargos). */
export async function sincronizarPorFichas(employeeIds: number[]) {
  if (!employeeIds.length) return; const us = await sql<{ id: number }[]>`SELECT id FROM users WHERE employee_id = ANY(${employeeIds})`.catch(() => [] as { id: number }[]);
  if (us.length) await sincronizarAcessos(us.map(x => x.id));
}
export async function sincronizarPorCargo(positionId: number) {
  const us = await sql<{ id: number }[]>`SELECT u.id FROM users u JOIN employees e ON e.id=u.employee_id WHERE e.position_id=${positionId} UNION SELECT id FROM users WHERE (substituicao->>'positionId') = ${String(positionId)}`.catch(() => [] as { id: number }[]);
  if (us.length) await sincronizarAcessos(us.map(x => x.id));
}

// ------------------------------------------------------------------ quem aprova (consultas sobre o acesso já gravado)
/** Quem aprova um desconto deste percentual (alçada de desconto do cargo ≥ pct). */
export async function usuariosComDescontoAte(pct: number, unitId?: number | null): Promise<number[]> {
  const rows = await sql<{ id: number }[]>`SELECT id FROM users WHERE ativo AND coalesce(desconto_pct, 0) >= ${pct} AND (${unitId ?? null}::int IS NULL OR unit_id IS NULL OR unit_id = ${unitId ?? null}::int OR role NOT IN ('DIRETOR_UNIDADE','GESTOR','COLABORADOR')) ORDER BY id`.catch(() => [] as { id: number }[]);
  return rows.map(r => r.id);
}
/** Como uma pessoa aparece nas listas de “quem aprova”: pelo cargo (e “em substituição”, enquanto durar); conta sem ficha, pela atuação. */
type LinhaQuem = { cargo: string | null; role: string; ficha: boolean; sub: boolean };
const rotuloQuem = (r: LinhaQuem) => r.ficha ? `${r.cargo ?? "ficha sem cargo"}${r.sub ? " em substituição" : ""}` : `${ATUACAO[r.role as Role]?.curto ?? r.role} · conta sem ficha`;
const ordemQuem = (a: string, b: string) => Number(a.includes("conta sem ficha")) - Number(b.includes("conta sem ficha")) || a.localeCompare(b, "pt-BR");
/** “Gerente Financeiro (40%), Direção · conta sem ficha (100%)” — quem aprova acima de um percentual, do menor para o maior. */
export async function quemAprovaDescontoTexto(acimaDe: number): Promise<string> {
  const rows = await sql<(LinhaQuem & { pct: number })[]>`SELECT p.nome AS cargo, u.role, (u.employee_id IS NOT NULL) AS ficha,
      coalesce(u.substituicao->>'ate', '') >= ${hojeLocal()} AS sub, coalesce(u.desconto_pct, 0)::float AS pct
    FROM users u LEFT JOIN employees e ON e.id=u.employee_id LEFT JOIN positions p ON p.id=e.position_id
    WHERE u.ativo AND coalesce(u.desconto_pct, 0) > ${acimaDe}`.catch(() => [] as (LinhaQuem & { pct: number })[]);
  const m = new Map<string, number>(); for (const r of rows) { const k = rotuloQuem(r); m.set(k, Math.max(m.get(k) ?? 0, r.pct)); }
  const xs = [...m.entries()].sort((a, b) => a[1] - b[1] || ordemQuem(a[0], b[0]));
  return xs.length ? xs.map(([k, v]) => `${k} (${String(v).replace(".", ",")}%)`).join(", ") : "ninguém acima — ajuste em Acesso por cargo";
}
/**
 * Usuários ativos com esta aprovação (opcionalmente: com alcance na unidade). Férias e banco de horas de uma pessoa (`equipeDe` = ficha dela):
 * quem é de outra área só entra se for o gestor direto (liderança fora da área de pessoas aprova só a própria equipe).
 */
export async function usuariosQueAprovam(chave: string, unitId?: number | null, equipeDe?: number | null): Promise<number[]> {
  try {
    const soEquipe = (chave === "ferias" || chave === "banco");
    const rows = await sql<{ id: number }[]>`SELECT id FROM users WHERE ativo AND ${chave} = ANY(coalesce(aprova, '{}'::text[])) AND (${unitId ?? null}::int IS NULL OR unit_id IS NULL OR unit_id = ${unitId ?? null}::int OR role NOT IN ('DIRETOR_UNIDADE','GESTOR','COLABORADOR'))
      AND (${!soEquipe} OR role IN ('RH','DIRECAO','DIRETOR_UNIDADE','GESTOR') OR (employee_id IS NOT NULL AND employee_id = (SELECT gestor_id FROM employees WHERE id = ${equipeDe ?? 0}::int))) ORDER BY id`;
    return rows.map(r => r.id);
  } catch { const p = await lerPadraoAprovacao(); const rows = await sql<{ id: number }[]>`SELECT id FROM users WHERE ativo AND role = ANY(${p[chave] ?? []}) ORDER BY id`; return rows.map(r => r.id); }
}
export async function emailsQueAprovam(chave: string, unitId?: number | null, equipeDe?: number | null): Promise<string[]> {
  const ids = await usuariosQueAprovam(chave, unitId, equipeDe); if (!ids.length) return [];
  const rows = await sql<{ email: string }[]>`SELECT email FROM users WHERE id = ANY(${ids})`; return rows.map(r => r.email).filter(e => e.includes("@"));
}
/** Texto para a tela: “Aprovam: Diretor Geral (Sócio), Gerente Financeiro” — cargos (e contas sem ficha) que têm a aprovação hoje. */
export async function quemAprovaTexto(chave: string): Promise<string> {
  try {
    const rows = await sql<LinhaQuem[]>`
      SELECT p.nome AS cargo, u.role, (u.employee_id IS NOT NULL) AS ficha, coalesce(u.substituicao->>'ate', '') >= ${hojeLocal()} AS sub
      FROM users u LEFT JOIN employees e ON e.id = u.employee_id LEFT JOIN positions p ON p.id = e.position_id
      WHERE u.ativo AND ${chave} = ANY(coalesce(u.aprova, '{}'::text[]))`;
    const nomes = [...new Set(rows.map(rotuloQuem))].sort(ordemQuem);
    return nomes.length ? nomes.join(", ") : "ninguém com acesso ativo — marque em Configurações → Acesso por cargo";
  } catch { const p = await lerPadraoAprovacao(); return (p[chave] ?? []).map(r => rotuloAtuacao(r)).join(", "); }
}
