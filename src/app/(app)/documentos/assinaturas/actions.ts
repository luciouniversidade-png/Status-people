"use server";
// v34 · assinatura eletrônica: envio de documentos (RH e Direção), lembrete, cancelamento, contestação e liberação dos espelhos do mês.
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, assert, scopeUnit, type Session } from "@/lib/auth";
import { audit, str, int, getSettings, hoje, addDays, caminhoSeguro } from "@/lib/utils";
import { comMensagem } from "@/lib/redirecionar";
import * as A from "@/lib/assinaturas";
import { notificar } from "@/lib/comunicacao";
import { mesFechado } from "@/lib/folha";

const go = (b: string, k: "ok" | "erro", m: string) => comMensagem(b, k, m);
const msgErro = (e: unknown) => (e instanceof Error ? e.message : "Erro inesperado.");
const BASE = "/documentos/assinaturas";

async function lerPdf(fd: FormData, campo = "arquivo"): Promise<{ bytes: Uint8Array; nome: string }> {
  const cfg = await getSettings(); const arq = fd.get(campo);
  if (!arq || typeof arq !== "object" || !("arrayBuffer" in arq) || (arq as File).size === 0) throw new Error("Escolha o PDF do documento.");
  const f = arq as File; assert(f.size <= cfg.plataforma.anexoMaxMb * 1048576, `PDF acima de ${cfg.plataforma.anexoMaxMb} MB.`);
  const bytes = new Uint8Array(await f.arrayBuffer());
  assert(f.type === "application/pdf" || Buffer.from(bytes.subarray(0, 5)).toString() === "%PDF-", "Envie o documento em PDF (o arquivo que a pessoa vai assinar não pode mudar depois).");
  return { bytes, nome: f.name };
}

/** Destinatários: toda a equipe ativa, uma unidade, um cargo ou pessoas escolhidas (fichas ativas, com ou sem conta). */
async function destinatarios(fd: FormData, s: Session): Promise<number[]> {
  const modo = str(fd, "modo"); const u = scopeUnit(s);
  const base = sql`e.situacao NOT IN ('DESLIGADO') ${u === null ? sql`` : sql`AND e.unit_id=${u}`}`;
  if (modo === "TODOS") return (await sql<{ id: number }[]>`SELECT e.id FROM employees e WHERE ${base}`).map(r => r.id);
  if (modo === "UNIDADE") { const un = int(fd, "unitId"); assert(!!un, "Escolha a unidade."); return (await sql<{ id: number }[]>`SELECT e.id FROM employees e WHERE ${base} AND e.unit_id=${un}`).map(r => r.id); }
  if (modo === "CARGO") { const p = int(fd, "positionId"); assert(!!p, "Escolha o cargo."); return (await sql<{ id: number }[]>`SELECT e.id FROM employees e WHERE ${base} AND e.position_id=${p}`).map(r => r.id); }
  const ids = fd.getAll("pessoas").map(v => Number(v)).filter(n => n > 0); assert(ids.length > 0, "Escolha ao menos uma pessoa.");
  return (await sql<{ id: number }[]>`SELECT e.id FROM employees e WHERE ${base} AND e.id = ANY(${ids})`).map(r => r.id);
}

export async function enviarParaAssinatura(fd: FormData) {
  const s = await requireSession(); let id = 0; let n = 0;
  try {
    assert(A.podeEnviarAssinatura(s), "Só RH e Direção enviam documentos para assinatura.");
    const titulo = str(fd, "titulo").slice(0, 160); assert(titulo.length >= 3, "Dê um título ao documento.");
    const tipo = str(fd, "tipo"); assert((A.TIPOS_ENVIO as readonly string[]).includes(tipo), "Escolha o tipo do documento.");
    const cfg = await getSettings(); const prazo = str(fd, "prazo") || addDays(hoje(), Number(cfg.assinaturas.prazoDias)); assert(/^\d{4}-\d{2}-\d{2}$/.test(prazo) && prazo >= hoje(), "O prazo precisa ser hoje ou depois.");
    const pdf = await lerPdf(fd); const pessoas = await destinatarios(fd, s);
    assert(pessoas.length > 0, "Nenhuma pessoa ativa no grupo escolhido."); assert(pessoas.length <= 600, "No máximo 600 pessoas por envio.");
    const unitId = str(fd, "modo") === "UNIDADE" ? int(fd, "unitId") : scopeUnit(s);
    await sql.begin(async tx => { const r = await A.criarDocumentoAssinatura({ titulo, tipo, descricao: str(fd, "descricao").slice(0, 600) || null, pdf: pdf.bytes, nomeArquivo: pdf.nome, unitId, prazo, criadoPor: s.id, criadoNome: s.nome }, pessoas, tx as unknown as typeof sql); id = r.id; n = r.pedidos.length; });
    const users = await A.usuariosDasFichas(pessoas);
    await notificar(users, "Documento para assinar", `Você tem um documento para ler e assinar no Meu espaço (prazo ${prazo.split("-").reverse().join("/")}).`, "/eu/assinaturas", "ACAO", `assinar:${id}`);
    await audit(s, "enviar documento para assinatura", "sign_documents", id, null, { titulo, tipo, pessoas: n, prazo });
  } catch (e) { redirect(go(BASE, "erro", msgErro(e))); }
  redirect(go(`${BASE}/${id}`, "ok", `Documento enviado para ${n} pessoa(s). Quem tem conta no ONE foi avisado; quem não tem precisa de uma conta para assinar.`));
}

async function docDoRh(s: Session, id: number) {
  const [d] = await sql<{ id: number; status: string; tipo: string; unit_id: number | null; titulo: string; competencia: string | null }[]>`SELECT id, status, tipo, unit_id, titulo, competencia FROM sign_documents WHERE id=${id}`;
  assert(!!d, "Documento não encontrado."); const u = scopeUnit(s);
  assert(A.podeEnviarAssinatura(s) || (s.role === "DIRETOR_UNIDADE" && d!.unit_id !== null && d!.unit_id === u), "Sem acesso a este documento.");
  return d!;
}

export async function lembrarPendentes(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; let n = 0;
  try {
    const d = await docDoRh(s, id); assert(d.status === "ABERTO", "Documento encerrado.");
    const pend = await sql<{ employee_id: number }[]>`UPDATE sign_requests SET lembrado_em=now() WHERE document_id=${id} AND status='PENDENTE' RETURNING employee_id`;
    const users = await A.usuariosDasFichas(pend.map(p => p.employee_id)); n = users.length;
    await notificar(users, "Lembrete: documento para assinar", "Há um documento esperando a sua leitura e assinatura no Meu espaço.", "/eu/assinaturas", "ACAO");
    await audit(s, "lembrar assinaturas pendentes", "sign_documents", id, null, { pessoas: pend.length });
  } catch (e) { redirect(go(`${BASE}/${id}`, "erro", msgErro(e))); }
  redirect(go(`${BASE}/${id}`, "ok", `Lembrete enviado para ${n} pessoa(s) com conta no ONE.`));
}

export async function cancelarDocumento(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0;
  try {
    assert(A.podeEnviarAssinatura(s), "Só RH e Direção cancelam."); const d = await docDoRh(s, id); assert(d.status === "ABERTO", "Documento já encerrado.");
    const motivo = str(fd, "motivo"); assert(motivo.length >= 10, "Escreva o motivo do cancelamento (mínimo 10 caracteres).");
    await sql.begin(async tx => { await tx`UPDATE sign_documents SET status='CANCELADO', cancelado_em=now(), cancelado_nome=${s.nome}, motivo_cancelamento=${motivo} WHERE id=${id}`; await tx`UPDATE sign_requests SET status='CANCELADO' WHERE document_id=${id} AND status='PENDENTE'`; });
    if (d.tipo === "TERMO_EPI") await sql`UPDATE epi_deliveries SET sign_request_id=NULL WHERE sign_request_id IN (SELECT id FROM sign_requests WHERE document_id=${id} AND status='CANCELADO')`;
    await audit(s, "cancelar documento para assinatura", "sign_documents", id, { status: "ABERTO" }, { status: "CANCELADO", motivo });
  } catch (e) { redirect(go(`${BASE}/${id}`, "erro", msgErro(e))); }
  redirect(go(`${BASE}/${id}`, "ok", "Documento cancelado. As assinaturas já feitas continuam no comprovante, com o motivo do cancelamento."));
}

/** Recusa ou contestação: o RH responde. No espelho, pode reenviar um espelho novo (depois de corrigir no relógio e reimportar). */
export async function resolverContestacao(fd: FormData) {
  const s = await requireSession(); const rid = int(fd, "requestId") ?? 0; let volta = BASE; let msg = "Resposta registrada.";
  try {
    const [r] = await sql<{ id: number; document_id: number; employee_id: number; status: string; resolvido_em: string | null }[]>`SELECT id, document_id, employee_id, status, resolvido_em::text FROM sign_requests WHERE id=${rid}`;
    assert(!!r, "Pedido não encontrado."); volta = `${BASE}/${r!.document_id}`; const d = await docDoRh(s, r!.document_id);
    assert(["RECUSADO", "CONTESTADO"].includes(r!.status) && !r!.resolvido_em, "Só recusas e contestações em aberto.");
    const resolucao = str(fd, "resolucao"); assert(resolucao.length >= 10, "Escreva a resposta (mínimo 10 caracteres): o que foi verificado e o que muda.");
    await sql`UPDATE sign_requests SET resolvido_em=now(), resolvido_nome=${s.nome}, resolucao=${resolucao} WHERE id=${rid}`;
    if (str(fd, "acao") === "REENVIAR") {
      if (d.tipo === "ESPELHO" && d.competencia) {
        const g = await A.gerarEspelhoPdf(r!.employee_id, d.competencia); const cfg = await getSettings();
        let novo = 0; await sql.begin(async tx => { const x = await A.criarDocumentoAssinatura({ titulo: `${d.titulo} (revisado)`, tipo: "ESPELHO", pdf: g.pdf, nomeArquivo: g.nome, unitId: g.unitId, competencia: d.competencia, prazo: addDays(hoje(), Number(cfg.assinaturas.espelhoPrazoDias)), criadoPor: s.id, criadoNome: s.nome }, [r!.employee_id], tx as unknown as typeof sql); novo = x.id; });
        msg = "Resposta registrada e espelho revisado enviado para assinatura."; await audit(s, "reenviar espelho revisado", "sign_documents", novo, null, { anterior: d.id });
      } else msg = "Resposta registrada. Para outro documento, envie a versão corrigida como um novo documento.";
    }
    const users = await A.usuariosDasFichas([r!.employee_id]);
    await notificar(users, "O RH respondeu sobre um documento", "Veja a resposta no Meu espaço → Documentos para assinar.", "/eu/assinaturas", "INFO");
    await audit(s, "responder recusa ou contestação", "sign_requests", rid, { status: r!.status }, { resolucao: resolucao.slice(0, 200), acao: str(fd, "acao") || "MANTER" });
  } catch (e) { redirect(go(volta, "erro", msgErro(e))); }
  redirect(go(volta, "ok", msg));
}

/** Libera o espelho do mês para assinatura de cada pessoa da unidade (o ponto do mês precisa estar fechado). */
export async function liberarEspelhosAction(fd: FormData) {
  const s = await requireSession(); const unitId = int(fd, "unitId") ?? 0; const mes = str(fd, "mes"); const voltar = caminhoSeguro(str(fd, "voltar"), `/ponto?mes=${mes}`); let msg = "";
  try {
    assert(["RH", "DIRECAO"].includes(s.role) || (s.role === "DIRETOR_UNIDADE" && scopeUnit(s) === unitId), "Liberam: RH, Direção ou a direção da própria unidade.");
    assert(/^\d{4}-\d{2}$/.test(mes), "Mês inválido."); assert(await mesFechado(unitId, `${mes}-01`), "Feche o ponto do mês da unidade antes de liberar os espelhos.");
    const cfg = await getSettings(); const r = await A.liberarEspelhos(unitId, mes, s, Number(cfg.assinaturas.espelhoPrazoDias));
    await audit(s, "liberar espelhos para assinatura", "units", unitId, null, { mes, ...r });
    msg = r.criados ? `${r.criados} espelho(s) liberado(s) para assinatura; ${r.avisados} pessoa(s) avisada(s) no ONE.${r.semPonto ? ` ${r.semPonto} pessoa(s) sem ponto importado no mês ficaram de fora.` : ""}` : "Nenhum espelho novo: todos já liberados ou sem ponto importado no mês.";
  } catch (e) { redirect(go(voltar, "erro", msgErro(e))); }
  redirect(go(voltar, "ok", msg));
}
