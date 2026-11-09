// v33 · Fornecedores — cadastro, homologação e gestão (SO-ARCH-SUP-001, adaptado ao monólito Next.js + PostgreSQL do STATUS ONE).
// Três níveis: fornecedor mestre (suppliers) → estabelecimentos por CNPJ/CPF (supplier_establishments) → unidades autorizadas
// (supplier_units). Homologação proporcional ao risco (criticidade), com pareceres e decisão segregada; documentos com validade;
// dados bancários em quarentena (conferência por canal conhecido + aprovação independente); avaliação explicável; portal sem
// autoaprovação. Contas a pagar, contratos e chamados consultam a elegibilidade — nada é copiado das transações oficiais.
import { createHmac } from "crypto";
import { sql } from "@/db";
import { can, type Session } from "./auth";
import { getSettings, hoje as hojeLocal, addDays } from "./utils";

// ---------- vocabulário ----------
export const STATUS_FORN: Record<string, string> = { RASCUNHO: "Em cadastro", EM_ANALISE: "Em homologação", HOMOLOGADO: "Homologado", CONDICIONAL: "Homologado com restrição", VENCIDO: "Em revalidação", SUSPENSO: "Suspenso", REJEITADO: "Rejeitado", INATIVO: "Inativo", LEGADO: "Cadastro anterior (revisar)" };
export const TOM_STATUS: Record<string, string> = { HOMOLOGADO: "ATIVO", CONDICIONAL: "VENCE_EM_BREVE", EM_ANALISE: "ABERTO", RASCUNHO: "EM_AQUISICAO", VENCIDO: "VENCIDO", SUSPENSO: "REJEITADO", REJEITADO: "REJEITADO", INATIVO: "CANCELADO", LEGADO: "PENDENTE" };
export const RISCO_ROTULO: Record<string, string> = { BAIXO: "Baixo", MEDIO: "Médio", ALTO: "Alto" };
export const TOM_RISCO: Record<string, string> = { BAIXO: "ATIVO", MEDIO: "PENDENTE", ALTO: "REJEITADO" };
export const CRITICIDADE: Record<string, string> = { BAIXA: "Baixa", MEDIA: "Média", ALTA: "Alta" };
export const TIPOS_FORN: Record<string, string> = { PJ: "Pessoa jurídica (CNPJ)", PF: "Pessoa física (CPF)", EXTERIOR: "Exterior (documento estrangeiro)" };
export const REGIMES: Record<string, string> = { SIMPLES: "Simples Nacional", MEI: "MEI", PRESUMIDO: "Lucro presumido", REAL: "Lucro real", ISENTO: "Isento/imune", PF: "Pessoa física", OUTRO: "Outro" };
export const SITUACOES_CADASTRAIS: Record<string, string> = { NAO_CONSULTADA: "Não consultada", ATIVA: "Ativa", SUSPENSA: "Suspensa", INAPTA: "Inapta", BAIXADA: "Baixada", NULA: "Nula" };
export const FINALIDADES_CONTATO: Record<string, string> = { PRINCIPAL: "Principal", COMERCIAL: "Comercial", FINANCEIRO: "Financeiro (cobrança)", SUPORTE: "Suporte e atendimento", PORTAL: "Portal do fornecedor" };
export const FORMAS_PAGAMENTO: Record<string, string> = { BOLETO: "Boleto", PIX: "Pix", TED: "Transferência (TED)", CARTAO: "Cartão corporativo", DEBITO: "Débito automático" };
export const TIPOS_CONTA: Record<string, string> = { CORRENTE: "Conta corrente", POUPANCA: "Poupança", PAGAMENTO: "Conta de pagamento" };
export const PIX_TIPOS: Record<string, string> = { CNPJ: "CNPJ", CPF: "CPF", EMAIL: "E-mail", TELEFONE: "Telefone", ALEATORIA: "Chave aleatória" };
export const ETAPAS_PARECER: Record<string, string> = { DOCUMENTAL: "Conferência documental", FINANCEIRO: "Parecer financeiro", TECNICO: "Parecer técnico" };
export const RESULTADOS_PARECER: Record<string, string> = { FAVORAVEL: "Favorável", RESSALVA: "Favorável com ressalva", DESFAVORAVEL: "Desfavorável", PENDENCIA: "Pendência a resolver" };
export const NATUREZAS_OCORRENCIA: Record<string, string> = { ATRASO: "Atraso ou não comparecimento", QUALIDADE: "Qualidade do serviço ou produto", ATENDIMENTO: "Atendimento e comunicação", SEGURANCA: "Segurança e saúde", DOCUMENTACAO: "Documentação", COBRANCA: "Cobrança indevida", OUTRA: "Outra" };
export const SEVERIDADES: Record<string, string> = { BAIXA: "Baixa", MEDIA: "Média", ALTA: "Alta" };
export const DIMENSOES: [string, string, string][] = [
  ["qualidade", "Qualidade", "o serviço ou produto atende ao combinado"], ["pontualidade", "Pontualidade", "prazos de entrega e de atendimento"],
  ["atendimento", "Atendimento", "comunicação, resposta e postura"], ["custo", "Custo", "preço líquido e ausência de cobranças indevidas"],
  ["conformidade", "Conformidade", "documentos, segurança e regras da escola"],
];
/** Fatores de criticidade (7.3) — hipótese até a validação no piloto; servem para propor a criticidade, não decidem sozinhos. */
export const FATORES_CRITICIDADE: [string, string][] = [
  ["continuidade", "Para a escola se faltar (continuidade)"], ["saude_seguranca", "Saúde e segurança de alunos e equipe"], ["acesso_fisico", "Acesso físico às unidades"],
  ["dados_pessoais", "Trata dados pessoais de alunos, famílias ou equipe"], ["concentracao", "Concentra parte relevante da despesa"], ["substituibilidade", "Difícil de substituir"],
  ["tecnologia", "Dependência tecnológica"], ["reputacao", "Exposição reputacional"], ["falhas", "Falhas recorrentes no histórico"], ["financeiro", "Relevância contratual e financeira"],
];
export const BANCOS: [string, string][] = [["001", "Banco do Brasil"], ["033", "Santander"], ["104", "Caixa Econômica Federal"], ["237", "Bradesco"], ["341", "Itaú Unibanco"], ["077", "Banco Inter"], ["260", "Nu Pagamentos (Nubank)"], ["336", "C6 Bank"], ["748", "Sicredi"], ["756", "Sicoob"], ["422", "Safra"], ["208", "BTG Pactual"], ["212", "Banco Original"], ["290", "PagBank"], ["323", "Mercado Pago"], ["380", "PicPay"], ["041", "Banrisul"], ["070", "BRB"], ["085", "Ailos"], ["136", "Unicred"]];
export const ORIGENS: Record<string, string> = { INTERNO: "Cadastro interno", CONTAS_A_PAGAR: "Lançamento de conta a pagar", IMPORTACAO: "Importação de planilha", PORTAL: "Portal do fornecedor", LEGADO: "Anterior à v33" };
/** Pareceres exigidos antes da decisão, pela criticidade (homologação proporcional ao risco). */
export function pareceresExigidos(criticidade: string): string[] { return criticidade === "ALTA" ? ["DOCUMENTAL", "FINANCEIRO", "TECNICO"] : criticidade === "MEDIA" ? ["DOCUMENTAL", "FINANCEIRO"] : ["DOCUMENTAL"]; }

// ---------- documentos de identificação ----------
export const soDigitos = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");
export function cnpjValido(v: string): boolean {
  const d = soDigitos(v); if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (base: string) => { const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; const s = base.split("").reduce((a, c, i) => a + Number(c) * pesos[i], 0); const r = s % 11; return r < 2 ? 0 : 11 - r; };
  return calc(d.slice(0, 12)) === Number(d[12]) && calc(d.slice(0, 13)) === Number(d[13]);
}
export function cpfValido(v: string): boolean {
  const d = soDigitos(v); if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (n: number) => { let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}
export const fmtCnpj = (d: string) => d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : d;
/** CPF é dado pessoal: em listas, telas e exportações aparece mascarado; inteiro só no cadastro, para Financeiro e Direção. */
export const fmtCpfMascarado = (d: string) => d.length === 11 ? `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**` : "***";
export const fmtCpf = (d: string) => d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : d;
export function fmtDocumento(tipo: string, doc: string, inteiro = false) { return tipo === "CNPJ" ? fmtCnpj(doc) : tipo === "CPF" ? (inteiro ? fmtCpf(doc) : fmtCpfMascarado(doc)) : doc; }
/** Valida e normaliza o documento do estabelecimento. Devolve [documento normalizado, erro]. */
export function normalizarDocumento(tipoDoc: string, v: string): [string, string | null] {
  if (tipoDoc === "CNPJ") { const d = soDigitos(v); return [d, cnpjValido(d) ? null : "CNPJ inválido: confira os 14 dígitos (o dígito verificador não confere)."]; }
  if (tipoDoc === "CPF") { const d = soDigitos(v); return [d, cpfValido(d) ? null : "CPF inválido: confira os 11 dígitos (o dígito verificador não confere)."]; }
  const t = v.trim().toUpperCase().replace(/\s+/g, " "); return [t, t.length >= 4 && t.length <= 40 ? null : "Documento estrangeiro: informe de 4 a 40 caracteres."];
}
export const mascararConta = (c: string | null | undefined) => { const t = (c ?? "").replace(/\s/g, ""); return t ? `•••${t.slice(-3)}` : "—"; };
export function mascararPix(tipo: string | null, chave: string | null) {
  if (!chave) return "—"; if (tipo === "EMAIL") { const [u, dom] = chave.split("@"); return `${u.slice(0, 2)}•••@${dom ?? ""}`; }
  if (tipo === "CPF") return fmtCpfMascarado(soDigitos(chave)); if (tipo === "CNPJ") return fmtCnpj(soDigitos(chave));
  return `${chave.slice(0, 3)}•••${chave.slice(-2)}`;
}
export function validarPix(tipo: string, chave: string): string | null {
  const c = chave.trim(); if (!c) return null;
  if (tipo === "CNPJ") return cnpjValido(c) ? null : "Chave Pix (CNPJ) inválida.";
  if (tipo === "CPF") return cpfValido(c) ? null : "Chave Pix (CPF) inválida.";
  if (tipo === "EMAIL") return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c) ? null : "Chave Pix (e-mail) inválida.";
  if (tipo === "TELEFONE") return /^\+?\d{10,13}$/.test(c.replace(/[\s()-]/g, "")) ? null : "Chave Pix (telefone) inválida: use DDD e número.";
  if (tipo === "ALEATORIA") return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c) ? null : "Chave aleatória inválida (formato 8-4-4-4-12).";
  return "Escolha o tipo da chave Pix.";
}
/** Nome normalizado para achar possíveis duplicidades (sem acento, sem sufixo societário). */
export function nomeNormalizado(v: string) {
  return v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\b(ltda|me|epp|eireli|s\/?a|sa|mei|cia|comercio|servicos|e)\b/g, " ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}
/** Semelhança de nomes por bigramas (0 a 1). Só sugere — quem decide se é o mesmo fornecedor é uma pessoa. */
export function semelhanca(a: string, b: string) {
  const bi = (t: string) => { const s = new Map<string, number>(); for (let i = 0; i < t.length - 1; i++) { const k = t.slice(i, i + 2); s.set(k, (s.get(k) ?? 0) + 1); } return s; };
  const x = bi(nomeNormalizado(a)), y = bi(nomeNormalizado(b)); let inter = 0, tot = 0;
  for (const [k, n] of x) { inter += Math.min(n, y.get(k) ?? 0); tot += n; } for (const n of y.values()) tot += n;
  return tot ? (2 * inter) / tot : 0;
}

// ---------- configuração ----------
export type CfgForn = { categorias: [string, string][]; documentos: Record<string, string[]>; extras: [string, string][]; revalidacaoMeses: Record<string, number>; alertaDocumentosDias: number; pesos: Record<string, number>; conviteDias: number; concentracaoAlertaPct: number; vencidoBloqueiaAlta: boolean; legadoAte: string; excecaoExigeAprovacao?: boolean };
export async function cfgForn(): Promise<CfgForn> { const cfg = await getSettings(); return cfg.fornecedores as unknown as CfgForn; }
export const criticidadeDaCategoria = (cfg: CfgForn, categoria: string | null) => cfg.categorias.find(([n]) => n === categoria)?.[1] ?? "BAIXA";
/** Criticidade proposta: o maior entre a da categoria e a dos fatores marcados (saúde/segurança, dados pessoais ou continuidade → alta). */
export function criticidadeProposta(cfg: CfgForn, categoria: string | null, fatores: string[]) {
  const ordem = ["BAIXA", "MEDIA", "ALTA"]; const cat = criticidadeDaCategoria(cfg, categoria);
  const porFator = fatores.some(f => ["saude_seguranca", "dados_pessoais", "continuidade"].includes(f)) || fatores.length >= 3 ? "ALTA" : fatores.length >= 1 ? "MEDIA" : "BAIXA";
  return ordem[Math.max(ordem.indexOf(cat), ordem.indexOf(porFator))];
}
/** Checklist dinâmico (SUP-RN-006): pela criticidade e pelo tipo de pessoa, mais os documentos da categoria. */
export function documentosExigidos(cfg: CfgForn, f: { tipo: string; criticidade: string; categoria: string | null }) {
  const base = f.tipo === "PF" ? cfg.documentos.PF ?? [] : f.tipo === "EXTERIOR" ? ["Documento de registro no país de origem"] : cfg.documentos[f.criticidade] ?? cfg.documentos.BAIXA ?? [];
  const extras = f.criticidade === "BAIXA" ? [] : cfg.extras.filter(([c]) => c === f.categoria).map(([, d]) => d);
  return [...new Set([...base, ...extras])];
}
export type DocRow = { id: number; tipo: string; numero: string | null; emissao: string | null; validade: string | null; status: string; origem: string; enviado_por_nome: string | null; conferido_por_nome: string | null; conferido_em: string | null; motivo_recusa: string | null; created_at: string; anexo_id: number | null; obs: string | null };
export type SituacaoDoc = "OK" | "VENCENDO" | "VENCIDO" | "ENVIADO" | "RECUSADO" | "FALTANDO";
export type LinhaChecklist = { tipo: string; exigivel: boolean; situacao: SituacaoDoc; doc: DocRow | null };
/** Situação de cada documento exigível: o melhor documento vigente de cada tipo decide. */
export function checklist(exigidos: string[], docs: DocRow[], h: string, alertaDias: number): LinhaChecklist[] {
  const lim = addDays(h, alertaDias); const out: LinhaChecklist[] = [];
  const sit = (d: DocRow): SituacaoDoc => d.status === "RECUSADO" ? "RECUSADO" : (d.validade && d.validade < h) || d.status === "VENCIDO" ? "VENCIDO" : d.status === "ENVIADO" ? "ENVIADO" : d.validade && d.validade <= lim ? "VENCENDO" : "OK";
  const rank: Record<SituacaoDoc, number> = { OK: 6, VENCENDO: 5, ENVIADO: 4, VENCIDO: 2, RECUSADO: 1, FALTANDO: 0 };
  const melhor = (tipo: string) => docs.filter(d => d.tipo === tipo && d.status !== "SUBSTITUIDO").sort((a, b) => rank[sit(b)] - rank[sit(a)] || (b.validade ?? "").localeCompare(a.validade ?? ""))[0] ?? null;
  for (const t of exigidos) { const d = melhor(t); out.push({ tipo: t, exigivel: true, situacao: d ? sit(d) : "FALTANDO", doc: d }); }
  for (const t of [...new Set(docs.map(d => d.tipo))].filter(t => !exigidos.includes(t))) { const d = melhor(t); if (d) out.push({ tipo: t, exigivel: false, situacao: sit(d), doc: d }); }
  return out;
}

// ---------- elegibilidade (consultada por contas a pagar, contratos e chamados) ----------
export type Elegibilidade = { nivel: "OK" | "EXCECAO" | "BLOQUEADO"; texto: string };
export function elegibilidade(f: { status: string; abrangencia: string; restricao_ate: string | null; restricoes?: string | null }, unidades: number[], unitId: number | null, cfg: CfgForn, h = hojeLocal()): Elegibilidade {
  if (["SUSPENSO", "REJEITADO", "INATIVO"].includes(f.status)) return { nivel: "BLOQUEADO", texto: `Fornecedor ${STATUS_FORN[f.status].toLowerCase()}: novas contratações e lançamentos bloqueados (o que já foi lançado continua).` };
  const fora = f.abrangencia === "UNIDADES" && (unitId === null || !unidades.includes(unitId));
  if (f.status === "HOMOLOGADO" || (f.status === "CONDICIONAL" && (!f.restricao_ate || f.restricao_ate >= h))) {
    if (fora) return { nivel: "EXCECAO", texto: unitId === null ? "Homologado só para algumas unidades — lançamento da rede é exceção." : "Fora do escopo homologado: esta unidade não está entre as autorizadas." };
    return { nivel: "OK", texto: f.status === "CONDICIONAL" ? `Homologado com restrição: ${f.restricoes ?? "veja a ficha"}` : "Homologado." };
  }
  if (f.status === "LEGADO") return !cfg.legadoAte || cfg.legadoAte >= h ? { nivel: "OK", texto: `Cadastro anterior à v33: vale até ${cfg.legadoAte ? cfg.legadoAte.split("-").reverse().join("/") : "a revisão"} — revise e homologue.` } : { nivel: "EXCECAO", texto: "Cadastro anterior à v33 fora do prazo de transição: homologue ou registre a exceção." };
  return { nivel: "EXCECAO", texto: f.status === "CONDICIONAL" ? "Restrição vencida: o fornecedor precisa de nova decisão." : `Fornecedor ${STATUS_FORN[f.status]?.toLowerCase() ?? "não homologado"}: só com exceção registrada (motivo).` };
}
export async function elegibilidadeFornecedor(supplierId: number, unitId: number | null, cfg?: CfgForn): Promise<Elegibilidade & { nome: string }> {
  const [f] = await sql<{ nome: string; status: string; abrangencia: string; restricao_ate: string | null; restricoes: string | null }[]>`SELECT nome, status, abrangencia, restricao_ate::text, restricoes FROM suppliers WHERE id=${supplierId}`;
  if (!f) return { nivel: "BLOQUEADO", texto: "Fornecedor não encontrado.", nome: "" };
  const us = (await sql<{ unit_id: number }[]>`SELECT unit_id FROM supplier_units WHERE supplier_id=${supplierId} AND status='AUTORIZADA'`).map(x => x.unit_id);
  return { ...elegibilidade(f, us, unitId, cfg ?? await cfgForn()), nome: f.nome };
}
/** Exceção formal (SUP-RN-009): motivo de 10+ caracteres; volta o texto que vai para o registro. */
export function exigirExcecao(e: Elegibilidade, motivo: string, quem: string): string {
  if (e.nivel === "BLOQUEADO") throw new Error(e.texto);
  if (e.nivel === "OK") return "";
  if (motivo.trim().length < 10) throw new Error(`${e.texto} Para lançar assim, marque a exceção e escreva o motivo (mínimo 10 caracteres).`);
  return `${e.texto} · exceção registrada por ${quem}: ${motivo.trim().slice(0, 300)}`;
}

// ---------- risco, completude e nota ----------
export type FatorRisco = { texto: string; pontos: number };
export type EntradaRisco = { criticidade: string; contingencia: string | null; situacao: string; situacaoEm: string | null; checklist: LinhaChecklist[]; bancoAberto: boolean; terceiroEmUso: boolean; concentracaoPct: number; ocorrenciasAlta: number; ocorrenciasMedia: number; ultimaNota: number | null; contratoVencidoComPagamento: boolean };
export function calcularRisco(e: EntradaRisco, cfg: CfgForn, h = hojeLocal()): { nivel: "BAIXO" | "MEDIO" | "ALTO"; pontos: number; fatores: FatorRisco[] } {
  const f: FatorRisco[] = []; const add = (texto: string, pontos: number) => { if (pontos > 0) f.push({ texto, pontos }); };
  const venc = e.checklist.filter(c => c.exigivel && c.situacao === "VENCIDO").length; add(`${venc} documento(s) exigível(is) vencido(s)`, Math.min(6, venc * 3));
  const falt = e.checklist.filter(c => c.exigivel && (c.situacao === "FALTANDO" || c.situacao === "RECUSADO")).length; add(`${falt} documento(s) exigível(is) faltando`, Math.min(3, falt));
  if (e.checklist.some(c => c.exigivel && c.situacao === "VENCENDO")) add("Documento exigível vencendo", 1);
  if (e.bancoAberto) add("Alteração bancária em aberto (quarentena)", 2);
  if (e.terceiroEmUso) add("Conta bancária em nome de terceiro em uso", 2);
  if (["SUSPENSA", "INAPTA", "BAIXADA", "NULA"].includes(e.situacao)) add(`Situação cadastral ${SITUACOES_CADASTRAIS[e.situacao].toLowerCase()}`, 4);
  else if (e.situacao === "NAO_CONSULTADA" || !e.situacaoEm || e.situacaoEm < addDays(h, -365)) add("Situação cadastral sem consulta no último ano", 1);
  if (e.concentracaoPct > cfg.concentracaoAlertaPct) add(`Concentra ${e.concentracaoPct.toFixed(1).replace(".", ",")}% da despesa líquida de 12 meses`, 2);
  add(`${e.ocorrenciasAlta} ocorrência(s) grave(s) em aberto`, Math.min(6, e.ocorrenciasAlta * 3)); add(`${e.ocorrenciasMedia} ocorrência(s) média(s) em aberto`, Math.min(2, e.ocorrenciasMedia));
  if (e.ultimaNota !== null && e.ultimaNota < 4) add(`Última avaliação ${e.ultimaNota.toFixed(1).replace(".", ",")} (abaixo de 4)`, 3); else if (e.ultimaNota !== null && e.ultimaNota < 6) add(`Última avaliação ${e.ultimaNota.toFixed(1).replace(".", ",")} (abaixo de 6)`, 2);
  if (e.criticidade === "ALTA" && !(e.contingencia ?? "").trim()) add("Criticidade alta sem plano de contingência", 2);
  if (e.contratoVencidoComPagamento) add("Contrato vencido com pagamentos nos últimos 90 dias", 1);
  const pontos = f.reduce((a, x) => a + x.pontos, 0); return { nivel: pontos >= 6 ? "ALTO" : pontos >= 3 ? "MEDIO" : "BAIXO", pontos, fatores: f };
}
export type EntradaCompletude = { tipo: string; documentoOk: boolean; razaoSocial: boolean; categoria: boolean; endereco: boolean; contato: boolean; abrangencia: boolean; responsavel: boolean; situacaoConsultada: boolean; pagamento: boolean; precisaConta: boolean; contaEmUso: boolean; checklist: LinhaChecklist[]; criticidade: string; contingencia: boolean };
export function completude(e: EntradaCompletude): { pct: number; faltando: string[] } {
  const itens: [boolean, string][] = [[e.documentoOk, "Documento (CNPJ/CPF) válido"], [e.razaoSocial, "Razão social"], [e.categoria, "Categoria"], [e.endereco, "Endereço (cidade e UF)"], [e.contato, "Contato principal com e-mail ou telefone"], [e.abrangencia, "Unidades atendidas"], [e.responsavel, "Responsável interno"], [e.situacaoConsultada, "Situação cadastral consultada (fonte e data)"], [e.pagamento, "Condição de pagamento (forma e prazo)"]];
  if (e.precisaConta) itens.push([e.contaEmUso, "Conta bancária conferida e em uso"]);
  const exig = e.checklist.filter(c => c.exigivel); itens.push([exig.length > 0 && exig.every(c => c.situacao === "OK" || c.situacao === "VENCENDO"), "Documentos exigíveis válidos"]);
  if (e.criticidade === "ALTA") itens.push([e.contingencia, "Plano de contingência (criticidade alta)"]);
  const ok = itens.filter(([b]) => b).length; return { pct: Math.round((ok / itens.length) * 100), faltando: itens.filter(([b]) => !b).map(([, t]) => t) };
}
/** Nota 0–10 do scorecard: média ponderada das dimensões (1 a 5 → 0 a 10). Fórmula, pesos e amostra ficam à vista (TC-SUP-010). */
export function notaAvaliacao(notas: Record<string, number>, pesos: Record<string, number>) {
  let s = 0, p = 0; for (const [k] of DIMENSOES) { const n = notas[k]; const w = pesos[k] ?? 0; if (!n || !w) continue; s += w * ((n - 1) / 4) * 10; p += w; }
  return p ? Math.round((s / p) * 10) / 10 : 0;
}
export function revalidacaoAte(cfg: CfgForn, criticidade: string, base = hojeLocal()) { const m = cfg.revalidacaoMeses[criticidade] ?? 12; const d = new Date(base + "T12:00:00"); d.setMonth(d.getMonth() + m); return d.toISOString().slice(0, 10); }

// ---------- permissões (RBAC + atributos; o servidor confere em toda ação) ----------
/** Quem abre a área de fornecedores (lista, ficha, busca, CSV e arquivos): quem compra, paga, opera ou responde por unidade — o RH só consulta. */
export const veFornecedores = (s: Session) => ["DIRECAO", "FINANCEIRO", "OPERACOES", "DIRETOR_UNIDADE", "GESTOR", "RH"].includes(s.role);
export const podeCadastrar = (s: Session) => ["DIRECAO", "FINANCEIRO", "OPERACOES", "DIRETOR_UNIDADE"].includes(s.role);
export function podeParecer(s: Session, etapa: string) { return (etapa === "DOCUMENTAL" ? ["DIRECAO", "FINANCEIRO", "OPERACOES"] : etapa === "TECNICO" ? ["DIRECAO", "OPERACOES", "DIRETOR_UNIDADE", "GESTOR"] : ["DIRECAO", "FINANCEIRO"]).includes(s.role); }
/** Homologar, suspender e aprovar a troca de conta: Direção, ou o financeiro com a aprovação de contas a pagar marcada no cargo. */
export const podeHomologar = (s: Session) => s.role === "DIRECAO" || (s.role === "FINANCEIRO" && can.aprovar(s, "contasPagar"));
export const podeConferirBanco = (s: Session) => ["DIRECAO", "FINANCEIRO"].includes(s.role);
export const podeAprovarBanco = podeHomologar;
export const podeAvaliar = (s: Session) => ["DIRECAO", "FINANCEIRO", "OPERACOES", "DIRETOR_UNIDADE", "GESTOR"].includes(s.role);
export const podeVerFinanceiro = (s: Session) => ["DIRECAO", "FINANCEIRO", "DIRETOR_UNIDADE"].includes(s.role);
export const podeVerBancoCompleto = (s: Session) => ["DIRECAO", "FINANCEIRO"].includes(s.role);

/** Link curto (5 minutos) para mostrar a conta completa — cada visualização fica na trilha. */
const assinatura = (t: string) => createHmac("sha256", process.env.AUTH_SECRET || "status-one").update("forn-banco:" + t).digest("base64url").slice(0, 22);
export const assinarRevelar = (userId: number, supplierId: number) => { const exp = Date.now() + 5 * 60_000; return `${exp}.${assinatura(`${userId}:${supplierId}:${exp}`)}`; };
export function revelarValido(token: string | undefined, userId: number, supplierId: number) { if (!token) return false; const [exp, sig] = token.split("."); return Number(exp) > Date.now() && sig === assinatura(`${userId}:${supplierId}:${exp}`); }

// ---------- transição de status (controle otimista: duas decisões ao mesmo tempo não se sobrepõem) ----------
type Tx = typeof sql;
export async function mudarStatus(tx: Tx, supplierId: number, novo: string, quem: string, motivo: string | null, versao?: number) {
  const ativo = !["SUSPENSO", "REJEITADO", "INATIVO"].includes(novo);
  const r = versao === undefined
    ? await tx`UPDATE suppliers SET status=${novo}, ativo=${ativo}, status_motivo=${motivo}, status_em=now(), status_por=${quem}, versao=versao+1, updated_at=now() WHERE id=${supplierId}`
    : await tx`UPDATE suppliers SET status=${novo}, ativo=${ativo}, status_motivo=${motivo}, status_em=now(), status_por=${quem}, versao=versao+1, updated_at=now() WHERE id=${supplierId} AND versao=${versao}`;
  if (!r.count) throw new Error("Outra pessoa alterou este fornecedor agora há pouco: recarregue a ficha e confira antes de decidir.");
}

// ---------- leitura em lote (lista, painel, pendências) ----------
/**
 * Dados bancários propostos (cadastro interno ou portal do fornecedor): banco da lista, agência e conta numéricas, Pix válido, titular com
 * documento válido. Conta fora do CNPJ/CPF do fornecedor = conta de terceiro: só com a confirmação marcada (e pesa no risco).
 */
export async function validarConta(fd: FormData, supplierId: number, evidenciaFixa?: string) {
  const g = (k: string) => String(fd.get(k) ?? "").trim(); const t = (k: string, max: number) => g(k).replace(/\s+/g, " ").slice(0, max);
  const ok = (c: boolean, m: string) => { if (!c) throw new Error(m); };
  const banco = g("bancoCodigo"); const ag = g("agencia").replace(/\s/g, ""); const cc = g("conta").replace(/\s/g, ""); const pixTipo = g("pixTipo"); const pix = g("pixChave");
  const temConta = !!(banco || ag || cc); if (temConta) { ok(BANCOS.some(([c]) => c === banco), "Escolha o banco."); ok(/^\d{3,5}(-[\dxX])?$/.test(ag), "Agência: só números (com o dígito, se houver)."); ok(/^\d{3,13}-?[\dxX]?$/.test(cc), "Conta: números com o dígito."); }
  ok(temConta || !!pix, "Informe a conta (banco, agência e conta) ou a chave Pix.");
  if (pix) { const e = validarPix(pixTipo, pix); if (e) throw new Error(e); }
  const [doc, err] = normalizarDocumento(soDigitos(g("titularDoc")).length === 11 ? "CPF" : "CNPJ", g("titularDoc")); if (err) throw new Error(`Titular: ${err}`);
  const titular = t("titularNome", 160); ok(titular.length >= 3, "Informe o nome do titular da conta.");
  const docs = (await sql<{ documento: string }[]>`SELECT documento FROM supplier_establishments WHERE supplier_id=${supplierId} AND ativo`).map(x => x.documento);
  const terceiro = !docs.includes(doc); if (terceiro) ok(g("terceiro") === "1", "A conta não está no CNPJ/CPF do fornecedor. Conta de terceiro só com a confirmação marcada e o motivo na evidência — e ela pesa no risco.");
  if (pix && ["CNPJ", "CPF"].includes(pixTipo)) ok(soDigitos(pix) === doc, "A chave Pix (CNPJ/CPF) é de outro titular: confira.");
  const evid = evidenciaFixa ? `${evidenciaFixa}${t("evidencia", 300) ? ` — ${t("evidencia", 300)}` : ""}` : t("evidencia", 500);
  ok(evid.length >= 10, "Descreva a evidência: como os dados chegaram (documento, e-mail do contato conhecido…) — mínimo 10 caracteres.");
  return { banco_codigo: banco || null, banco_nome: BANCOS.find(([c]) => c === banco)?.[1] ?? null, agencia: ag || null, conta: cc || null, tipo_conta: (g("tipoConta") in TIPOS_CONTA ? g("tipoConta") : "CORRENTE"), titular_nome: titular, titular_doc: doc, pix_tipo: pix ? pixTipo : null, pix_chave: pix || null, terceiro, evid };
}
export type LinhaForn = {
  id: number; nome: string; tipo: string; categoria: string | null; criticidade: string; status: string; abrangencia: string; responsavel: string | null; responsavel_user_id: number | null; contingencia: string | null;
  restricoes: string | null; restricao_ate: string | null; revalidar_em: string | null; risco_revisado: string | null; criado_por: number | null; created_at: string; origem: string; forma_pagamento: string | null; prazo_dias: number | null;
  documento: string | null; tipo_doc: string | null; razao_social: string | null; situacao: string; situacao_em: string | null; cidade: string | null; uf: string | null;
  contato: boolean; unidades: number[]; checklist: LinhaChecklist[]; bancoAberto: boolean; contaEmUso: boolean; terceiroEmUso: boolean;
  gasto12m: number; concentracaoPct: number; ultimaNota: number | null; avaliadoEm: string | null; ocorrenciasAbertas: number; ocorrenciasAlta: number; contratosVigentes: number;
  risco: ReturnType<typeof calcularRisco>; completude: ReturnType<typeof completude>; homologacaoAberta: { id: number; fase: string; submetido_em: string; submetido_por: number | null } | null;
};
export async function carregarLista(cfg: CfgForn, filtroIds?: number[]): Promise<LinhaForn[]> {
  const h = hojeLocal(); const ids = filtroIds && filtroIds.length ? filtroIds : null;
  const [sups, estabs, units, contatos, docs, bancos, gastos, evals, occs, contratos, homs] = await Promise.all([
    sql<Omit<LinhaForn, "documento" | "tipo_doc" | "razao_social" | "situacao" | "situacao_em" | "cidade" | "uf" | "contato" | "unidades" | "checklist" | "bancoAberto" | "contaEmUso" | "terceiroEmUso" | "gasto12m" | "concentracaoPct" | "ultimaNota" | "avaliadoEm" | "ocorrenciasAbertas" | "ocorrenciasAlta" | "contratosVigentes" | "risco" | "completude" | "homologacaoAberta">[]>`
      SELECT s.id, s.nome, s.tipo, s.categoria, s.criticidade, s.status, s.abrangencia, u.nome AS responsavel, s.responsavel_user_id, s.contingencia, s.restricoes, s.restricao_ate::text, s.revalidar_em::text, s.risco_revisado, s.criado_por, s.created_at::text, s.origem, s.forma_pagamento, s.prazo_dias
      FROM suppliers s LEFT JOIN users u ON u.id=s.responsavel_user_id ${ids ? sql`WHERE s.id IN ${sql(ids)}` : sql``} ORDER BY s.nome`,
    sql<{ supplier_id: number; documento: string; tipo_doc: string; razao_social: string; situacao_cadastral: string; situacao_em: string | null; cidade: string | null; uf: string | null }[]>`SELECT DISTINCT ON (supplier_id) supplier_id, documento, tipo_doc, razao_social, situacao_cadastral, situacao_em::text, cidade, uf FROM supplier_establishments WHERE ativo ORDER BY supplier_id, matriz DESC, id`,
    sql<{ supplier_id: number; unit_id: number }[]>`SELECT supplier_id, unit_id FROM supplier_units WHERE status='AUTORIZADA'`,
    sql<{ supplier_id: number }[]>`SELECT DISTINCT supplier_id FROM supplier_contacts WHERE ativo AND (coalesce(email,'')<>'' OR coalesce(telefone,'')<>'')`,
    sql<(DocRow & { supplier_id: number })[]>`SELECT d.id, d.supplier_id, d.tipo, d.numero, d.emissao::text, d.validade::text, d.status, d.origem, d.enviado_por_nome, d.conferido_por_nome, d.conferido_em::text, d.motivo_recusa, d.created_at::text, NULL::int AS anexo_id, d.obs FROM supplier_documents d WHERE d.status<>'SUBSTITUIDO'`,
    sql<{ supplier_id: number; aberto: boolean; em_uso: boolean; terceiro: boolean }[]>`SELECT s.id AS supplier_id, EXISTS (SELECT 1 FROM supplier_bank_changes c WHERE c.supplier_id=s.id AND c.status IN ('AGUARDANDO_CONFERENCIA','AGUARDANDO_APROVACAO')) AS aberto, EXISTS (SELECT 1 FROM supplier_bank_accounts a WHERE a.supplier_id=s.id AND a.status='EM_USO') AS em_uso, EXISTS (SELECT 1 FROM supplier_bank_accounts a WHERE a.supplier_id=s.id AND a.status='EM_USO' AND a.terceiro) AS terceiro FROM suppliers s`,
    sql<{ supplier_id: number; v: number }[]>`SELECT p.supplier_id, coalesce(sum(i.valor_pago), 0)::float AS v FROM payable_installments i JOIN payables p ON p.id=i.payable_id WHERE i.status='PAGA' AND i.pago_em >= ${addDays(h, -365)} AND p.supplier_id IS NOT NULL GROUP BY p.supplier_id`,
    sql<{ supplier_id: number; nota: number; at: string }[]>`SELECT DISTINCT ON (supplier_id) supplier_id, nota::float, created_at::text AS at FROM supplier_evaluations ORDER BY supplier_id, created_at DESC`,
    sql<{ supplier_id: number; abertas: number; alta: number; media: number }[]>`SELECT supplier_id, count(*)::int AS abertas, count(*) FILTER (WHERE severidade='ALTA')::int AS alta, count(*) FILTER (WHERE severidade='MEDIA')::int AS media FROM supplier_occurrences WHERE status<>'FECHADA' GROUP BY supplier_id`,
    sql<{ supplier_id: number; vigentes: number; vencido_pago: boolean }[]>`SELECT c.supplier_id, count(*) FILTER (WHERE c.status='VIGENTE' AND (c.fim IS NULL OR c.fim >= ${h}))::int AS vigentes,
      bool_or(c.status='VIGENTE' AND c.fim < ${h} AND EXISTS (SELECT 1 FROM payables p JOIN payable_installments i ON i.payable_id=p.id WHERE p.contract_id=c.id AND i.status='PAGA' AND i.pago_em >= ${addDays(h, -90)})) AS vencido_pago FROM contracts c GROUP BY c.supplier_id`,
    sql<{ id: number; supplier_id: number; fase: string; submetido_em: string; submetido_por: number | null }[]>`SELECT id, supplier_id, fase, submetido_em::text, submetido_por FROM supplier_homologations WHERE fase IN ('ANALISE','APROVACAO')`,
  ]);
  const total = gastos.reduce((a, g) => a + g.v, 0);
  const by = <T extends { supplier_id: number }>(xs: T[]) => { const m = new Map<number, T[]>(); for (const x of xs) { const l = m.get(x.supplier_id) ?? []; l.push(x); m.set(x.supplier_id, l); } return m; };
  const mE = new Map(estabs.map(e => [e.supplier_id, e])); const mU = by(units); const mC = new Set(contatos.map(c => c.supplier_id)); const mD = by(docs); const mB = new Map(bancos.map(b => [b.supplier_id, b]));
  const mG = new Map(gastos.map(g => [g.supplier_id, g.v])); const mV = new Map(evals.map(e => [e.supplier_id, e])); const mO = new Map(occs.map(o => [o.supplier_id, o])); const mK = new Map(contratos.map(c => [c.supplier_id, c])); const mH = new Map(homs.map(x => [x.supplier_id, x]));
  return sups.map(s => {
    const e = mE.get(s.id); const ex = documentosExigidos(cfg, s); const ck = checklist(ex, (mD.get(s.id) ?? []) as DocRow[], h, cfg.alertaDocumentosDias); const b = mB.get(s.id); const g = mG.get(s.id) ?? 0; const v = mV.get(s.id); const o = mO.get(s.id); const k = mK.get(s.id);
    const unidades = (mU.get(s.id) ?? []).map(x => x.unit_id); const conc = total > 0 ? (g / total) * 100 : 0;
    const risco = calcularRisco({ criticidade: s.criticidade, contingencia: s.contingencia, situacao: e?.situacao_cadastral ?? "NAO_CONSULTADA", situacaoEm: e?.situacao_em ?? null, checklist: ck, bancoAberto: !!b?.aberto, terceiroEmUso: !!b?.terceiro, concentracaoPct: conc, ocorrenciasAlta: o?.alta ?? 0, ocorrenciasMedia: o?.media ?? 0, ultimaNota: v?.nota ?? null, contratoVencidoComPagamento: !!k?.vencido_pago }, cfg, h);
    const comp = completude({ tipo: s.tipo, documentoOk: !!e, razaoSocial: !!e?.razao_social, categoria: !!s.categoria, endereco: !!(e?.cidade && e?.uf), contato: mC.has(s.id), abrangencia: s.abrangencia === "REDE" || unidades.length > 0, responsavel: !!s.responsavel_user_id, situacaoConsultada: !!e && e.situacao_cadastral !== "NAO_CONSULTADA" && !!e.situacao_em, pagamento: !!s.forma_pagamento && s.prazo_dias !== null, precisaConta: ["PIX", "TED"].includes(s.forma_pagamento ?? ""), contaEmUso: !!b?.em_uso, checklist: ck, criticidade: s.criticidade, contingencia: !!(s.contingencia ?? "").trim() });
    return { ...s, documento: e?.documento ?? null, tipo_doc: e?.tipo_doc ?? null, razao_social: e?.razao_social ?? null, situacao: e?.situacao_cadastral ?? "NAO_CONSULTADA", situacao_em: e?.situacao_em ?? null, cidade: e?.cidade ?? null, uf: e?.uf ?? null,
      contato: mC.has(s.id), unidades, checklist: ck, bancoAberto: !!b?.aberto, contaEmUso: !!b?.em_uso, terceiroEmUso: !!b?.terceiro, gasto12m: g, concentracaoPct: conc, ultimaNota: v?.nota ?? null, avaliadoEm: v?.at ?? null,
      ocorrenciasAbertas: o?.abertas ?? 0, ocorrenciasAlta: o?.alta ?? 0, contratosVigentes: k?.vigentes ?? 0, risco, completude: comp, homologacaoAberta: mH.get(s.id) ?? null };
  });
}
/** Nível de risco exibido: o revisado na decisão (com motivo) prevalece sobre o calculado. */
export const riscoExibido = (l: { risco: { nivel: string }; risco_revisado: string | null }) => l.risco_revisado ?? l.risco.nivel;
export const moeda = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
export const dataBR = (d: string | null | undefined) => d ? d.slice(0, 10).split("-").reverse().join("/") : "—";
