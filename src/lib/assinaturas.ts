/**
 * v34 · Assinatura eletrônica de documentos (política, contrato ou aditivo, termo de EPI, espelho do ponto do mês).
 * Como funciona: o RH envia o PDF; o ONE guarda o arquivo e o hash SHA-256 dele; cada pessoa assina no Meu espaço com a
 * própria senha (e o código da verificação em duas etapas, quando ativa). No ato o ONE confere o hash do arquivo guardado e
 * registra data e hora, IP e dispositivo. O comprovante é o PDF original com uma página de evidências no fim.
 * Recusar ou contestar exige motivo. Nada é apagado: documento cancelado fica no histórico com quem cancelou e por quê.
 */
import { headers } from "next/headers";
import { sql } from "@/db";
import type { Session } from "./auth";
import { scopeUnit } from "./auth";
import { Escritor, abrirPdf, sha256, winAnsi } from "./pdf-v34";
import { montarMes, diffDia, PONTO_LABEL, mesLimites } from "./ponto";
import { fmtData, fmtDataHora, fmtMin, hoje, addDays } from "./utils";
import { cpfMascarado } from "./rematricula";

export const TIPO_ASSINATURA: Record<string, string> = { DOCUMENTO: "Documento", POLITICA: "Política ou regulamento", CONTRATO: "Contrato ou aditivo", ESPELHO: "Espelho do ponto", TERMO_EPI: "Termo de entrega de EPI" };
export const TIPOS_ENVIO = ["DOCUMENTO", "POLITICA", "CONTRATO"] as const;
export const STATUS_ASSINATURA: Record<string, string> = { PENDENTE: "Aguardando", ASSINADO: "Assinado", RECUSADO: "Recusado", CONTESTADO: "Contestado", CANCELADO: "Cancelado" };
export const TOM_ASSINATURA: Record<string, string> = { PENDENTE: "PENDENTE", ASSINADO: "APROVADA", RECUSADO: "REJEITADA", CONTESTADO: "REJEITADA", CANCELADO: "CANCELADA" };
export const DOC_STATUS: Record<string, string> = { ABERTO: "Em assinatura", CONCLUIDO: "Concluído", CANCELADO: "Cancelado" };

/** Quem envia documentos para assinatura e acompanha tudo: RH e Direção. A direção da unidade acompanha a própria unidade. */
export const podeEnviarAssinatura = (s: Session) => ["RH", "DIRECAO"].includes(s.role);
export const veAssinaturas = (s: Session) => ["RH", "DIRECAO", "DIRETOR_UNIDADE"].includes(s.role);

/** Rótulo legível do dispositivo a partir do navegador gravado (a evidência completa continua no comprovante). */
export function dispositivo(ua: string | null | undefined): string {
  if (!ua) return "dispositivo não informado";
  if (/python-requests|curl\/|node-fetch|undici|axios/i.test(ua)) return "programa (sem navegador)";
  const so = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Macintosh|Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "outro sistema";
  const nav = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /FxiOS|Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "navegador";
  return `${so} · ${nav}`;
}

/** IP e navegador de quem assinou (a hospedagem preenche primeiro o cabeçalho próprio; depois o x-forwarded-for). */
export async function origemAssinatura() {
  const h = await headers();
  const ip = h.get("x-vercel-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || "local";
  return { ip: ip.slice(0, 64), userAgent: (h.get("user-agent") ?? "").slice(0, 300) || null };
}

type Tx = typeof sql;
/** Grava o PDF (anexo restrito) e o documento com o hash; cria um pedido de assinatura por pessoa. */
export async function criarDocumentoAssinatura(o: { titulo: string; tipo: string; descricao?: string | null; pdf: Uint8Array; nomeArquivo: string; unitId?: number | null; competencia?: string | null; referencia?: string | null; prazo?: string | null; criadoPor?: number | null; criadoNome: string; userNome?: string },
  pessoas: number[], tx: Tx = sql): Promise<{ id: number; pedidos: { id: number; employee_id: number }[] }> {
  const doc = await abrirPdf(o.pdf); const paginas = doc.getPageCount(); const hash = sha256(o.pdf);
  const nome = o.nomeArquivo.replace(/[^\w.\-() áéíóúâêôãõçÁÉÍÓÚÂÊÔÃÕÇ]/g, "_").slice(0, 120) || "documento.pdf";
  const [a] = await tx<{ id: number }[]>`INSERT INTO attachments (entidade, entidade_id, nome, mime, tamanho, dados, descricao, unit_id, user_id, user_nome) VALUES ('sign_document', 0, ${nome}, 'application/pdf', ${o.pdf.length}, ${Buffer.from(o.pdf)}, ${`Para assinatura: ${o.titulo}`.slice(0, 200)}, ${o.unitId ?? null}, ${o.criadoPor ?? null}, ${o.userNome ?? o.criadoNome}) RETURNING id`;
  const [d] = await tx<{ id: number }[]>`INSERT INTO sign_documents (titulo, tipo, descricao, attachment_id, hash, paginas, unit_id, competencia, referencia, prazo, criado_por, criado_nome) VALUES (${o.titulo}, ${o.tipo}, ${o.descricao ?? null}, ${a.id}, ${hash}, ${paginas}, ${o.unitId ?? null}, ${o.competencia ?? null}, ${o.referencia ?? null}, ${o.prazo ?? null}, ${o.criadoPor ?? null}, ${o.criadoNome}) RETURNING id`;
  await tx`UPDATE attachments SET entidade_id=${d.id} WHERE id=${a.id}`;
  const pedidos: { id: number; employee_id: number }[] = [];
  for (const e of [...new Set(pessoas)]) { const r = await tx<{ id: number; employee_id: number }[]>`INSERT INTO sign_requests (document_id, employee_id) VALUES (${d.id}, ${e}) ON CONFLICT (document_id, employee_id) DO NOTHING RETURNING id, employee_id`; pedidos.push(...r); }
  return { id: d.id, pedidos };
}

/** Usuários (contas ativas) das fichas — para avisar quem tem documento para assinar. */
export async function usuariosDasFichas(ids: number[]) {
  if (!ids.length) return [] as number[];
  return (await sql<{ id: number }[]>`SELECT id FROM users WHERE ativo AND employee_id = ANY(${ids})`).map(r => r.id);
}

// ------------------------------------------------------------------ espelho do ponto (conferência mensal)
export const mesTxt = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
export function totaisDoMes(dias: { esperado: number; trabalhado: number; status: string; salvo?: boolean }[]) {
  let esperado = 0, trabalhado = 0, saldo = 0, extras = 0, atrasos = 0, faltas = 0, atestados = 0, diasFalta = 0;
  for (const d of dias) {
    if (d.salvo === false) continue; const df = diffDia(d); esperado += d.esperado; trabalhado += d.trabalhado; saldo += df;
    if (d.status === "FALTA") { faltas += d.esperado; diasFalta++; } else if (df > 0) extras += df; else if (df < 0) atrasos += -df;
    if (d.status === "ATESTADO") atestados++;
  }
  return { esperado, trabalhado, saldo, extras, atrasos, faltas, diasFalta, atestados };
}

/** Espelho do mês em PDF, a partir do ponto importado do relógio (documento de conferência, não substitui o espelho do relógio). */
export async function gerarEspelhoPdf(employeeId: number, mes: string): Promise<{ pdf: Uint8Array; nome: string; unitId: number; dias: number }> {
  const [e] = await sql<{ nome: string; cargo: string | null; unidade: string; unit_id: number; empresa: string | null; cpf: string | null; admissao: string }[]>`SELECT e.nome, p.nome AS cargo, u.nome AS unidade, e.unit_id, c.nome AS empresa, e.cpf, e.admissao::text FROM employees e JOIN units u ON u.id=e.unit_id LEFT JOIN positions p ON p.id=e.position_id LEFT JOIN companies c ON c.id=e.company_id WHERE e.id=${employeeId}`;
  if (!e) throw new Error("Colaborador não encontrado.");
  const { dias } = await montarMes(employeeId, mes); const salvos = dias.filter(d => d.salvo);
  const t = totaisDoMes(salvos);
  const w = await Escritor.criar(`STATUS ONE · Espelho do ponto de ${mesTxt(mes)} · ${e.nome} · gerado em ${fmtDataHora(new Date())}`);
  w.texto("ESPELHO DO PONTO — CONFERÊNCIA MENSAL", { size: 13, bold: true });
  w.texto(`${e.empresa ?? "Colégio Status"} · unidade ${e.unidade}`, { size: 9, cor: [0.35, 0.38, 0.45] });
  w.regua(4);
  w.texto(`Colaborador(a): ${e.nome}   ·   CPF: ${cpfMascarado(e.cpf)}   ·   Cargo: ${e.cargo ?? "—"}   ·   Admissão: ${fmtData(e.admissao)}`, { size: 9 });
  w.texto(`Mês de referência: ${mesTxt(mes)}`, { size: 9, bold: true, depois: 6 });
  const linhas: string[][] = [["Dia", "Situação", "Marcações", "Esperado", "Trabalhado", "Saldo"]];
  for (const d of salvos) linhas.push([`${d.data.slice(8, 10)}/${d.data.slice(5, 7)} ${DIAS[d.dow]}`, PONTO_LABEL[d.status] ?? d.status, d.marcacoes ?? "—", fmtMin(d.esperado).replace("+", ""), fmtMin(d.trabalhado).replace("+", ""), fmtMin(diffDia(d))]);
  if (salvos.length === 0) linhas.push(["—", "Ponto do mês ainda não importado", "", "", "", ""]);
  w.tabela([62, 120, 150, 58, 62, 63], linhas);
  w.texto(`Totais do mês — esperado ${fmtMin(t.esperado).replace("+", "")} · trabalhado ${fmtMin(t.trabalhado).replace("+", "")} · saldo ${fmtMin(t.saldo)} · horas a mais ${fmtMin(t.extras).replace("+", "")} · atrasos e saídas antecipadas ${fmtMin(t.atrasos).replace("+", "")} · faltas ${t.diasFalta} dia(s) · atestados ${t.atestados} dia(s)`, { size: 9, bold: true, antes: 4, depois: 8 });
  w.texto("Este documento reproduz, para conferência, as marcações e os totais importados do relógio de ponto. Ao assinar, o(a) colaborador(a) declara que conferiu o espelho. Se algo não confere, use “Contestar” no Meu espaço e escreva o que está diferente: o RH analisa e corrige no relógio.", { size: 8.5, cor: [0.3, 0.33, 0.4] });
  return { pdf: await w.salvar(), nome: `espelho-${mes}-${employeeId}.pdf`, unitId: e.unit_id, dias: salvos.length };
}

/** Libera para assinatura o espelho do mês de cada pessoa da unidade (mês fechado). Quem já tem o espelho do mês liberado fica de fora. */
export async function liberarEspelhos(unitId: number, mes: string, s: Session, prazoDias: number): Promise<{ criados: number; semPonto: number; jaLiberados: number; avisados: number }> {
  const { ini, fim } = mesLimites(mes);
  const pessoas = await sql<{ id: number }[]>`SELECT e.id FROM employees e WHERE e.unit_id=${unitId} AND e.situacao <> 'EM_ADMISSAO' AND e.admissao <= ${fim} AND (e.desligamento IS NULL OR e.desligamento >= ${ini})
    AND EXISTS (SELECT 1 FROM timesheet_days t WHERE t.employee_id=e.id AND t.data BETWEEN ${ini} AND ${fim}) ORDER BY e.nome`;
  const [{ total }] = await sql<{ total: number }[]>`SELECT count(*)::int AS total FROM employees e WHERE e.unit_id=${unitId} AND e.situacao NOT IN ('EM_ADMISSAO','DESLIGADO')`;
  const ja = new Set((await sql<{ employee_id: number }[]>`SELECT r.employee_id FROM sign_requests r JOIN sign_documents d ON d.id=r.document_id WHERE d.tipo='ESPELHO' AND d.competencia=${mes} AND d.status <> 'CANCELADO' AND r.status <> 'CANCELADO'`).map(r => r.employee_id));
  let criados = 0; const novos: number[] = []; const prazo = addDays(hoje(), prazoDias);
  for (const p of pessoas) {
    if (ja.has(p.id)) continue;
    const g = await gerarEspelhoPdf(p.id, mes);
    await sql.begin(async tx => { await criarDocumentoAssinatura({ titulo: `Espelho do ponto — ${mesTxt(mes)}`, tipo: "ESPELHO", pdf: g.pdf, nomeArquivo: g.nome, unitId, competencia: mes, prazo, criadoPor: s.id, criadoNome: s.nome }, [p.id], tx as unknown as Tx); });
    criados++; novos.push(p.id);
  }
  const users = await usuariosDasFichas(novos);
  if (users.length) { const { notificar } = await import("./comunicacao"); await notificar(users, "Espelho do ponto para conferir", "Confira e assine (ou conteste) o espelho do mês no Meu espaço.", "/eu/assinaturas", "ACAO", `espelho:${mes}`); }
  return { criados, semPonto: Math.max(0, total - pessoas.length), jaLiberados: ja.size, avisados: users.length };
}

// ------------------------------------------------------------------ termo de entrega de EPI
export async function gerarTermoEpiPdf(deliveryId: number): Promise<{ pdf: Uint8Array; nome: string; employeeId: number; unitId: number; titulo: string }> {
  const [d] = await sql<{ employee_id: number; nome: string; cpf: string | null; cargo: string | null; unidade: string; unit_id: number; epi: string; ca: string | null; data: string; quantidade: number; proxima_troca: string | null }[]>`
    SELECT d.employee_id, e.nome, e.cpf, p.nome AS cargo, u.nome AS unidade, e.unit_id, i.nome AS epi, i.ca, d.data::text, d.quantidade, d.proxima_troca::text FROM epi_deliveries d JOIN employees e ON e.id=d.employee_id JOIN units u ON u.id=e.unit_id LEFT JOIN positions p ON p.id=e.position_id JOIN epi_items i ON i.id=d.epi_id WHERE d.id=${deliveryId}`;
  if (!d) throw new Error("Entrega de EPI não encontrada.");
  const w = await Escritor.criar(`STATUS ONE · Termo de entrega de EPI nº ${deliveryId} · ${d.nome}`);
  w.texto("TERMO DE ENTREGA E RESPONSABILIDADE — EQUIPAMENTO DE PROTEÇÃO INDIVIDUAL (EPI)", { size: 12, bold: true, depois: 6 });
  w.texto(`Colaborador(a): ${d.nome}   ·   CPF: ${cpfMascarado(d.cpf)}   ·   Cargo: ${d.cargo ?? "—"}   ·   Unidade: ${d.unidade}`, { size: 9, depois: 6 });
  w.tabela([230, 90, 70, 125], [["EPI", "CA", "Quantidade", "Entrega / próxima troca"], [d.epi, d.ca ?? "—", String(d.quantidade), `${fmtData(d.data)}${d.proxima_troca ? ` / ${fmtData(d.proxima_troca)}` : ""}`]]);
  w.texto("Declaro que recebi gratuitamente o(s) equipamento(s) acima, que fui orientado(a) sobre o uso correto, a guarda e a conservação, e que me comprometo a usá-lo(s) apenas para a finalidade a que se destina(m), a comunicar qualquer alteração que o(s) torne impróprio(s) para uso e a devolvê-lo(s) quando solicitado.", { size: 9.5, antes: 6 });
  return { pdf: await w.salvar(), nome: `termo-epi-${deliveryId}.pdf`, employeeId: d.employee_id, unitId: d.unit_id, titulo: `Termo de entrega de EPI — ${d.epi}` };
}

// ------------------------------------------------------------------ comprovante (PDF original + página de evidências)
export async function comprovantePdf(docId: number, soPedido: number | null = null): Promise<{ pdf: Uint8Array; nome: string }> {
  const [d] = await sql<{ titulo: string; tipo: string; hash: string; paginas: number | null; criado_nome: string; created_at: string; status: string; nome: string; dados: Buffer }[]>`
    SELECT d.titulo, d.tipo, d.hash, d.paginas, d.criado_nome, d.created_at::text, d.status, a.nome, a.dados FROM sign_documents d JOIN attachments a ON a.id=d.attachment_id WHERE d.id=${docId}`;
  if (!d) throw new Error("Documento não encontrado.");
  const rs = await sql<{ id: number; nome: string; cpf: string | null; status: string; assinado_em: string | null; recusado_em: string | null; motivo: string | null; metodo: string | null; ip: string | null; user_agent: string | null; hash_conferido: string | null }[]>`
    SELECT r.id, e.nome, e.cpf, r.status, r.assinado_em::text, r.recusado_em::text, r.motivo, r.metodo, r.ip, r.user_agent, r.hash_conferido FROM sign_requests r JOIN employees e ON e.id=r.employee_id WHERE r.document_id=${docId} ${soPedido ? sql`AND r.id=${soPedido}` : sql``} ORDER BY e.nome`;
  const doc = await abrirPdf(new Uint8Array(d.dados));
  const w = await Escritor.sobre(doc, `STATUS ONE · Comprovante de assinaturas · documento nº ${docId}`);
  w.texto("COMPROVANTE DE ASSINATURAS ELETRÔNICAS", { size: 13, bold: true });
  w.texto(`Documento: ${d.titulo} (${TIPO_ASSINATURA[d.tipo] ?? d.tipo}) · arquivo ${d.nome} · ${d.paginas ?? "?"} página(s) antes desta`, { size: 9 });
  w.texto(`Enviado por ${d.criado_nome} em ${fmtDataHora(d.created_at)} · situação: ${DOC_STATUS[d.status] ?? d.status}`, { size: 9 });
  w.texto(`Hash SHA-256 do arquivo original: ${d.hash}`, { size: 8.5, depois: 6 });
  const linhas: string[][] = [["Pessoa", "Situação", "Quando", "Como e de onde", "Hash conferido"]];
  for (const r of rs) linhas.push([`${r.nome}\nCPF ${cpfMascarado(r.cpf)}`, (STATUS_ASSINATURA[r.status] ?? r.status) + (r.motivo ? `\nmotivo: ${r.motivo}` : ""), r.assinado_em ? fmtDataHora(r.assinado_em) : r.recusado_em ? fmtDataHora(r.recusado_em) : "—",
    r.metodo ? `${r.metodo === "SENHA+2FA" ? "login + senha + código 2FA" : "login + senha"}\nIP ${r.ip ?? "—"} · ${dispositivo(r.user_agent)}\n${(r.user_agent ?? "").slice(0, 90)}` : "—", r.hash_conferido ? (r.hash_conferido === d.hash ? "confere" : "DIFERENTE") : "—"]);
  w.tabela([125, 95, 75, 160, 60], linhas, 7.5);
  w.texto("Assinatura eletrônica registrada no STATUS ONE: cada pessoa entrou com o próprio usuário, confirmou a senha (e o código da verificação em duas etapas, quando ativa) no momento de assinar e declarou ter lido o documento. No ato, o sistema recalculou o hash SHA-256 do arquivo guardado e conferiu com o hash registrado no envio. Para verificar este comprovante, calcule o SHA-256 das páginas originais do arquivo (sem esta página) no RH.", { size: 8, cor: [0.3, 0.33, 0.4], antes: 4 });
  return { pdf: await w.salvar(), nome: winAnsi(`comprovante-${docId}${soPedido ? `-${soPedido}` : ""}.pdf`) };
}

/** Quem pode abrir o documento (arquivo e comprovante): RH e Direção; direção da unidade (a própria); a própria pessoa (o seu pedido). */
export async function acessoDocumento(s: Session, docId: number): Promise<{ ok: boolean; pedido: number | null }> {
  const [d] = await sql<{ unit_id: number | null }[]>`SELECT unit_id FROM sign_documents WHERE id=${docId}`; if (!d) return { ok: false, pedido: null };
  if (["RH", "DIRECAO"].includes(s.role)) return { ok: true, pedido: null };
  if (s.employeeId) { const [r] = await sql<{ id: number }[]>`SELECT id FROM sign_requests WHERE document_id=${docId} AND employee_id=${s.employeeId}`; if (r) return { ok: true, pedido: r.id }; }
  if (s.role === "DIRETOR_UNIDADE" && d.unit_id !== null && d.unit_id === scopeUnit(s)) return { ok: true, pedido: null };
  return { ok: false, pedido: null };
}

export type PedidoMeu = { id: number; document_id: number; titulo: string; tipo: string; status: string; prazo: string | null; created_at: string; assinado_em: string | null; competencia: string | null; motivo: string | null };
export async function pedidosDoColaborador(employeeId: number, todos = false): Promise<PedidoMeu[]> {
  return sql<PedidoMeu[]>`SELECT r.id, r.document_id, d.titulo, d.tipo, r.status, d.prazo::text, r.created_at::text, r.assinado_em::text, d.competencia, r.motivo FROM sign_requests r JOIN sign_documents d ON d.id=r.document_id
    WHERE r.employee_id=${employeeId} ${todos ? sql`` : sql`AND r.status='PENDENTE' AND d.status='ABERTO'`} ORDER BY (r.status='PENDENTE') DESC, d.prazo NULLS LAST, r.id DESC LIMIT 200`;
}
