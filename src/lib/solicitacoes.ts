import { sql } from "@/db";
import type { Session } from "./auth";
import { ROLE_LABEL } from "./auth";

export const CAMPO_TIPO: Record<string, string> = { TEXTO: "texto", TEXTO_LONGO: "texto longo", NUMERO: "número", VALOR: "valor (R$)", DATA: "data", SELECAO: "seleção", SIM_NAO: "sim/não" };
export const SOL_STATUS: Record<string, string> = { EM_APROVACAO: "Em aprovação", DEVOLVIDA: "Devolvida para ajuste", APROVADA: "Aprovada", REJEITADA: "Rejeitada", CANCELADA: "Cancelada" };
export const SOL_TOM: Record<string, string> = { EM_APROVACAO: "PENDENTE", DEVOLVIDA: "SOLICITADA", APROVADA: "APROVADA", REJEITADA: "REJEITADA", CANCELADA: "CANCELADA" };
export type Campo = { id: string; rotulo: string; tipo: string; obrigatorio: boolean; opcoes?: string[] };
export type Etapa = { nome: string; perfis: string[]; usuarios?: number[]; cargos?: number[]; acimaDe?: number | null }; // v29: cargos = quem tem o cargo na ficha
export type EtapaSnap = { nome: string; aprovadores: number[]; decisao: string | null; por: number | null; porNome: string | null; em: string | null; obs: string | null };

const semAcento = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const ALIAS_PERFIL: Record<string, string> = { direcao: "DIRECAO", diretoria: "DIRECAO", rh: "RH", "diretor de unidade": "DIRETOR_UNIDADE", "diretor(a) da unidade": "DIRETOR_UNIDADE", "diretora da unidade": "DIRETOR_UNIDADE", "diretor da unidade": "DIRETOR_UNIDADE", "direcao da unidade": "DIRETOR_UNIDADE", "direcao da rede": "DIRECAO", "gestao de pessoas (rh)": "RH", coordenacao: "GESTOR", "coordenacao e lideranca": "GESTOR", "comercial e atendimento": "COMERCIAL", "comercial / atendimento": "COMERCIAL", "operacoes e manutencao": "OPERACOES", gestor: "GESTOR", gestao: "GESTOR", financeiro: "FINANCEIRO", operacoes: "OPERACOES", manutencao: "OPERACOES", comercial: "COMERCIAL", secretaria: "COMERCIAL", atendimento: "COMERCIAL" };
export const perfilDe = (t: string) => { const k = semAcento(t); const cod = t.trim().toUpperCase(); return (Object.keys(ROLE_LABEL) as string[]).includes(cod) && !["LEITURA", "COLABORADOR"].includes(cod) ? cod : ALIAS_PERFIL[k] ?? null; };
const slug = (v: string) => semAcento(v).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30) || "campo";

/** Campos do formulário, uma linha por campo: "Rótulo | tipo | obrigatório (sim/não) | opção 1; opção 2". */
export function lerCampos(texto: string): Campo[] {
  const tipos = Object.fromEntries(Object.entries(CAMPO_TIPO).map(([k, v]) => [semAcento(v), k])); const out: Campo[] = []; const ids = new Set<string>();
  for (const [i, l] of texto.split(/\r?\n/).map(x => x.trim()).filter(Boolean).entries()) {
    const [rot, tp = "texto", ob = "sim", op = ""] = l.split("|").map(x => x.trim());
    if (!rot) throw new Error(`Campo ${i + 1}: rótulo vazio.`);
    const tipo = tipos[semAcento(tp)] ?? (CAMPO_TIPO[tp.toUpperCase()] ? tp.toUpperCase() : null); if (!tipo) throw new Error(`Campo “${rot}”: tipo “${tp}” inválido (use: ${Object.values(CAMPO_TIPO).join(", ")}).`);
    const opcoes = tipo === "SELECAO" ? op.split(";").map(x => x.trim()).filter(Boolean) : undefined; if (tipo === "SELECAO" && (!opcoes || opcoes.length < 2)) throw new Error(`Campo “${rot}”: seleção precisa de pelo menos 2 opções separadas por ponto e vírgula.`);
    let id = slug(rot); while (ids.has(id)) id += "_2"; ids.add(id);
    out.push({ id, rotulo: rot, tipo, obrigatorio: !/^(nao|não|n|opcional)$/i.test(ob), ...(opcoes ? { opcoes } : {}) });
  }
  if (!out.length) throw new Error("Inclua ao menos um campo.");
  return out;
}
export const camposTexto = (cs: Campo[]) => cs.map(c => [c.rotulo, CAMPO_TIPO[c.tipo], c.obrigatorio ? "sim" : "não", ...(c.opcoes ? [c.opcoes.join("; ")] : [])].join(" | ")).join("\n");

/** Etapas de aprovação, uma por linha: "Nome | atuações, cargos ou e-mails (vírgula) | acima de 1000". v29: “cargo Gerente Financeiro” (ou o nome exato do cargo) aprova pelo cargo. */
export async function lerEtapas(texto: string): Promise<Etapa[]> {
  const out: Etapa[] = []; const cargosRede = await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM positions`.catch(() => [] as { id: number; nome: string }[]);
  const cargoDe = (t: string) => { const k = semAcento(t.replace(/^cargo\s*:?\s*/i, "")); return cargosRede.find(c => semAcento(c.nome) === k)?.id ?? null; };
  for (const [i, l] of texto.split(/\r?\n/).map(x => x.trim()).filter(Boolean).entries()) {
    const [nome, quem = "", acima = ""] = l.split("|").map(x => x.trim()); if (!nome || !quem) throw new Error(`Etapa ${i + 1}: informe nome e quem aprova.`);
    const perfis: string[] = []; const usuarios: number[] = []; const cargos: number[] = [];
    for (const t of quem.split(",").map(x => x.trim()).filter(Boolean)) {
      if (/^cargo\b/i.test(t)) { const c = cargoDe(t); if (!c) throw new Error(`Etapa “${nome}”: cargo “${t.replace(/^cargo\s*:?\s*/i, "")}” não encontrado.`); cargos.push(c); continue; }
      if (t.includes("@")) { const [u] = await sql<{ id: number; role: string }[]>`SELECT id, role FROM users WHERE lower(email)=lower(${t}) AND ativo`; if (!u || ["LEITURA", "COLABORADOR"].includes(u.role)) throw new Error(`Etapa “${nome}”: usuário ${t} não encontrado entre os gestores ativos.`); usuarios.push(u.id); }
      else { const p = perfilDe(t); if (p) { perfis.push(p); continue; } const c = cargoDe(t); if (c) { cargos.push(c); continue; } throw new Error(`Etapa “${nome}”: aprovador “${t}” desconhecido — não é atuação, cargo nem e-mail (atuações: Direção, RH, Direção da unidade, Coordenação, Financeiro, Operações, Comercial/Secretaria; cargo: “cargo Gerente Financeiro”).`); }
    }
    let acimaDe: number | null = null; if (acima) { const n = Number(acima.replace(/acima de/i, "").replace(/[R$\s.]/g, "").replace(",", ".")); if (!Number.isFinite(n) || n < 0) throw new Error(`Etapa “${nome}”: valor “${acima}” inválido.`); acimaDe = n; }
    out.push({ nome, perfis, ...(usuarios.length ? { usuarios } : {}), ...(cargos.length ? { cargos } : {}), acimaDe });
  }
  if (!out.length) throw new Error("Inclua ao menos uma etapa de aprovação.");
  return out;
}
export async function etapasTexto(es: Etapa[]) {
  const ids = es.flatMap(e => e.usuarios ?? []); const us = ids.length ? await sql<{ id: number; email: string }[]>`SELECT id, email FROM users WHERE id = ANY(${ids})` : [];
  const cids = es.flatMap(e => e.cargos ?? []); const cs = cids.length ? await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM positions WHERE id = ANY(${cids})` : [];
  return es.map(e => [e.nome, [...e.perfis.map(p => ROLE_LABEL[p as keyof typeof ROLE_LABEL] ?? p), ...(e.cargos ?? []).map(c => `cargo ${cs.find(x => x.id === c)?.nome ?? `#${c}`}`), ...(e.usuarios ?? []).map(u => us.find(x => x.id === u)?.email ?? `#${u}`)].join(", "), ...(e.acimaDe !== null && e.acimaDe !== undefined ? [`acima de ${e.acimaDe}`] : [])].join(" | ")).join("\n");
}

/** Quem aprova a etapa: perfis (os da unidade, para perfis com unidade) e usuários nomeados; nunca o próprio solicitante. Sem ninguém: Direção, depois RH. */
export async function aprovadoresDa(e: Etapa, unitId: number | null, solicitante: number) {
  const unidade = ["DIRETOR_UNIDADE", "GESTOR"];
  const porPerfil = e.perfis.length ? await sql<{ id: number; role: string; unit_id: number | null }[]>`SELECT id, role, unit_id FROM users WHERE ativo AND role = ANY(${e.perfis})` : [];
  // v29: aprovação por cargo — quem tem o cargo na ficha (ativo); cargo de unidade aprova só na própria unidade
  const porCargo = e.cargos?.length ? await sql<{ id: number; role: string; unit_id: number | null }[]>`SELECT u.id, u.role, u.unit_id FROM users u JOIN employees em ON em.id=u.employee_id WHERE u.ativo AND em.situacao <> 'DESLIGADO' AND em.position_id = ANY(${e.cargos})` : [];
  let ids = [...new Set([...[...porPerfil, ...porCargo].filter(u => !unidade.includes(u.role) || (unitId !== null && u.unit_id === unitId)).map(u => u.id), ...(e.usuarios ?? [])])].filter(i => i !== solicitante);
  if (e.usuarios?.length) { const at = await sql<{ id: number }[]>`SELECT id FROM users WHERE ativo AND id = ANY(${ids})`; ids = at.map(x => x.id); }
  if (!ids.length) ids = (await sql<{ id: number }[]>`SELECT id FROM users WHERE ativo AND role='DIRECAO' AND id <> ${solicitante}`).map(x => x.id);
  if (!ids.length) ids = (await sql<{ id: number }[]>`SELECT id FROM users WHERE ativo AND role='RH' AND id <> ${solicitante}`).map(x => x.id);
  return ids;
}
/** Etapas aplicáveis ao valor (alçada) com os aprovadores resolvidos no momento do envio. */
export async function montarEtapas(es: Etapa[], valor: number | null, unitId: number | null, solicitante: number): Promise<EtapaSnap[]> {
  const out: EtapaSnap[] = [];
  for (const e of es) { if (e.acimaDe !== null && e.acimaDe !== undefined && (valor ?? 0) <= e.acimaDe) continue; out.push({ nome: e.nome, aprovadores: await aprovadoresDa(e, unitId, solicitante), decisao: null, por: null, porNome: null, em: null, obs: null }); }
  if (!out.length) throw new Error("Nenhuma etapa de aprovação se aplica: revise o tipo de solicitação.");
  if (out.some(e => !e.aprovadores.length)) throw new Error("Não há aprovador disponível para uma das etapas. Fale com o RH.");
  return out;
}
export const podeDecidir = (s: Session, r: { status: string; etapa_atual: number; etapas: EtapaSnap[] }) => r.status === "EM_APROVACAO" && !!r.etapas[r.etapa_atual]?.aprovadores.includes(s.id);
/** Quem enxerga todas as solicitações: Direção, RH, Financeiro (rede) e diretor(a) da unidade (da sua unidade). */
export const vePainel = (s: Session) => ["DIRECAO", "RH", "FINANCEIRO", "DIRETOR_UNIDADE"].includes(s.role);
export const fmtValorBr = (v: number | string | null) => v === null || v === "" ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
