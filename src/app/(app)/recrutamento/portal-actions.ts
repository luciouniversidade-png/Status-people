"use server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { sql } from "@/db";
import { requireSession, assert, scopeUnit, type Session } from "@/lib/auth";
import { audit, str, strOrNull, int, caminhoSeguro } from "@/lib/utils";
import { gerarLinkPortal, registrar } from "@/lib/portal-candidato";

const go = (b: string, k: "ok" | "erro", msg: string) => `${b}${b.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(msg)}#portal`;
const PERFIS = ["RH", "DIRECAO", "DIRETOR_UNIDADE"];
/** Candidatura no escopo de quem conduz (RH/Direção; diretor(a) só da própria unidade). */
async function candidatura(s: Session, applicationId: number) {
  assert(PERFIS.includes(s.role), "O portal do candidato é conduzido pelo RH, pela Direção ou pelo diretor(a) da unidade.");
  const [a] = await sql<{ id: number; candidate_id: number; unit_id: number; etapa: string; retirada: boolean }[]>`SELECT a.id, a.candidate_id, r.unit_id, a.etapa, (a.retirada_em IS NOT NULL) AS retirada FROM applications a JOIN requisitions r ON r.id=a.requisition_id WHERE a.id=${applicationId}`;
  assert(!!a, "Candidatura não encontrada."); const u = scopeUnit(s); if (u !== null && a!.unit_id !== u) { await audit(s, "acesso negado: portal do candidato de outra unidade", "applications", applicationId, null, { papel: s.role }); throw new Error("Sem acesso a esta unidade."); }
  return a!;
}
const voltarDe = (fd: FormData, a: { candidate_id: number }) => caminhoSeguro(str(fd, "voltar"), `/recrutamento/candidatos/${a.candidate_id}`);

export async function gerarLinkCandidato(fd: FormData) {
  const s = await requireSession(); let b = "/recrutamento";
  try {
    const a = await candidatura(s, int(fd, "applicationId") ?? 0); b = voltarDe(fd, a); assert(!a.retirada && !["REPROVADO", "DESISTIU"].includes(a.etapa), "Candidatura encerrada: não recebe link.");
    const { token, validade } = await gerarLinkPortal(a.id, s.id, int(fd, "dias") ?? undefined);
    (await cookies()).set("portal_cand", `${a.id}|${token}`, { httpOnly: true, sameSite: "strict", path: "/recrutamento", maxAge: 600 });
    await audit(s, "gerar link do portal do candidato", "candidate_portal_links", a.id, null, { validadeDias: validade }); // o token nunca vai para a trilha
    await registrar(a.id, `Link do portal gerado (válido por ${validade} dias)`, "RH", s.nome);
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Link gerado: copie e envie ao candidato (ele aparece só agora; para outro, gere de novo — o anterior deixa de valer)."));
}
export async function revogarLinkCandidato(fd: FormData) {
  const s = await requireSession(); let b = "/recrutamento";
  try { const a = await candidatura(s, int(fd, "applicationId") ?? 0); b = voltarDe(fd, a); await sql`UPDATE candidate_portal_links SET status='REVOGADO', encerrado_em=now() WHERE application_id=${a.id} AND status='ATIVO'`; await audit(s, "revogar link do portal do candidato", "candidate_portal_links", a.id, { status: "ATIVO" }, { status: "REVOGADO" }); }
  catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Link revogado."));
}
export async function pedirDocumentosCandidato(fd: FormData) {
  const s = await requireSession(); let b = "/recrutamento"; let n = 0;
  try {
    const a = await candidatura(s, int(fd, "applicationId") ?? 0); b = voltarDe(fd, a);
    const tipos = [...new Set([...fd.getAll("tipos").map(String), ...(strOrNull(fd, "outro") ? [str(fd, "outro").slice(0, 120)] : [])].map(t => t.trim()).filter(Boolean))]; assert(tipos.length > 0, "Marque ao menos um documento.");
    const ja = new Set((await sql<{ tipo: string }[]>`SELECT tipo FROM candidate_doc_requests WHERE application_id=${a.id} AND status <> 'RECUSADO'`).map(x => x.tipo));
    for (const t of tipos.filter(t => !ja.has(t))) { await sql`INSERT INTO candidate_doc_requests (application_id, tipo, criado_por) VALUES (${a.id}, ${t}, ${s.id})`; n++; }
    await audit(s, "pedir documentos ao candidato", "candidate_doc_requests", a.id, null, { tipos }); if (n) await registrar(a.id, `RH pediu ${n} documento(s) pelo portal`, "RH", s.nome);
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", n ? `${n} documento(s) pedido(s): o candidato vê no portal.` : "Esses documentos já estavam pedidos."));
}
export async function conferirDocumentoCandidato(fd: FormData) {
  const s = await requireSession(); let b = "/recrutamento";
  try {
    const id = int(fd, "docId") ?? 0; const [d] = await sql<{ application_id: number; tipo: string; status: string }[]>`SELECT application_id, tipo, status FROM candidate_doc_requests WHERE id=${id}`; assert(!!d, "Documento não encontrado.");
    const a = await candidatura(s, d.application_id); b = voltarDe(fd, a); assert(d.status === "ENVIADO", "Só documento enviado é conferido.");
    const decisao = str(fd, "decisao"); assert(["ACEITO", "RECUSADO"].includes(decisao), "Decisão inválida."); const motivo = strOrNull(fd, "motivo");
    if (decisao === "RECUSADO") assert(!!motivo && motivo.length >= 5, "Diga ao candidato o que precisa mudar no arquivo.");
    await sql`UPDATE candidate_doc_requests SET status=${decisao}, conferido_por=${s.id}, conferido_em=now(), motivo_recusa=${decisao === "RECUSADO" ? motivo : null} WHERE id=${id}`;
    await audit(s, "conferir documento do candidato", "candidate_doc_requests", id, { status: d.status }, { status: decisao });
    await registrar(a.id, decisao === "ACEITO" ? `Documento conferido: ${d.tipo}` : `Mensagem do RH: o documento “${d.tipo}” precisa ser reenviado — ${motivo}`, decisao === "ACEITO" ? "RH" : "RH_PARA_CANDIDATO", s.nome);
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Documento conferido."));
}
export async function oferecerHorarios(fd: FormData) {
  const s = await requireSession(); let b = "/recrutamento"; let n = 0;
  try {
    const a = await candidatura(s, int(fd, "applicationId") ?? 0); b = voltarDe(fd, a); assert(!a.retirada && !["REPROVADO", "DESISTIU", "CONTRATADO"].includes(a.etapa), "Candidatura encerrada.");
    const dur = Math.max(15, Math.min(240, int(fd, "duracao") ?? 45)); const local = strOrNull(fd, "local")?.slice(0, 200) ?? null;
    const horarios = fd.getAll("inicio").map(String).filter(x => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(x)); assert(horarios.length > 0, "Informe ao menos um horário.");
    for (const h of horarios) { const [{ futuro }] = await sql<{ futuro: boolean }[]>`SELECT (${h}::timestamp AT TIME ZONE 'America/Campo_Grande') > now() AS futuro`; assert(futuro, `O horário ${h.replace("T", " ")} já passou.`); }
    for (const h of horarios) { await sql`INSERT INTO interview_slots (application_id, etapa, inicio, duracao_min, local, criado_por) VALUES (${a.id}, ${a.etapa}, ${h}::timestamp, ${dur}, ${local}, ${s.id})`; n++; }
    await audit(s, "oferecer horários de entrevista", "interview_slots", a.id, null, { horarios, duracao: dur, local });
    await registrar(a.id, `Mensagem do RH: ${n} horário(s) de entrevista oferecido(s) — escolha um no portal.`, "RH_PARA_CANDIDATO", s.nome);
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", `${n} horário(s) oferecido(s).`));
}
export async function cancelarHorario(fd: FormData) {
  const s = await requireSession(); let b = "/recrutamento";
  try { const id = int(fd, "slotId") ?? 0; const [x] = await sql<{ application_id: number; status: string }[]>`SELECT application_id, status FROM interview_slots WHERE id=${id}`; assert(!!x, "Horário não encontrado."); const a = await candidatura(s, x.application_id); b = voltarDe(fd, a);
    await sql`UPDATE interview_slots SET status='CANCELADO' WHERE id=${id}`; await audit(s, "cancelar horário de entrevista", "interview_slots", id, { status: x.status }, { status: "CANCELADO" });
    await registrar(a.id, "Mensagem do RH: um horário de entrevista foi cancelado. Novos horários aparecem aqui.", "RH_PARA_CANDIDATO", s.nome); }
  catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Horário cancelado."));
}
export async function responderCandidato(fd: FormData) {
  const s = await requireSession(); let b = "/recrutamento";
  try { const a = await candidatura(s, int(fd, "applicationId") ?? 0); b = voltarDe(fd, a); const texto = str(fd, "texto"); assert(texto.length >= 5 && texto.length <= 1000, "Mensagem entre 5 e 1.000 caracteres.");
    await registrar(a.id, `Mensagem do RH: ${texto}`, "RH_PARA_CANDIDATO", s.nome); await audit(s, "mensagem ao candidato (portal)", "applications", a.id, null, { caracteres: texto.length }); }
  catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Mensagem enviada: o candidato vê no portal."));
}
