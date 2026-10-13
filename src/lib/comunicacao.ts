import { after } from "next/server";
import { sql } from "@/db";
import { enviarEmail } from "./notify";

export const CANAL: Record<string, string> = { WHATSAPP: "WhatsApp", EMAIL: "E-mail", TELEFONE: "Telefone", PRESENCIAL: "Presencial" };
export const MSG_STATUS: Record<string, string> = { REGISTRADA: "Registrada", ENVIADA: "Enviada", ENTREGUE: "Entregue", FALHOU: "Falhou", AGENDADA: "Agendada" };
export const PUBLICO: Record<string, string> = { TODOS: "Toda a equipe", UNIDADE: "Uma unidade", PERFIL: "Um perfil" };

/** Telefone BR → formato internacional para wa.me (55 + DDD + número). */
export function foneWa(v: string | null | undefined) { if (!v) return null; let d = v.replace(/\D/g, ""); if (!d) return null; if (d.startsWith("0")) d = d.slice(1); if (d.length === 10 || d.length === 11) d = "55" + d; return d.length >= 12 ? d : null; }
export const linkWa = (fone: string | null, texto: string) => fone ? `https://wa.me/${fone}?text=${encodeURIComponent(texto)}` : null;

/** Substitui {variaveis} no modelo. */
export function preencher(modelo: string, vars: Record<string, string | number | null | undefined>) { return modelo.replace(/\{(\w+)\}/g, (_, k) => { const v = vars[k]; return v === null || v === undefined || v === "" ? `{${k}}` : String(v); }); }

/** Envio por WhatsApp Cloud API (Meta) quando configurado; senão, o link wa.me faz o envio pelo celular. */
export async function enviarWhatsApp(fone: string, texto: string): Promise<{ ok: boolean; id?: string; erro?: string; via: "api" | "link" }> {
  const token = process.env.WHATSAPP_TOKEN, phoneId = process.env.WHATSAPP_PHONE_ID;
  if (!token || !phoneId) return { ok: false, via: "link", erro: "API do WhatsApp não configurada (WHATSAPP_TOKEN e WHATSAPP_PHONE_ID) — use o link para enviar pelo celular." };
  try {
    const r = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", to: fone, type: "text", text: { body: texto } }) });
    const j = await r.json() as { messages?: { id: string }[]; error?: { message: string } };
    if (!r.ok) return { ok: false, via: "api", erro: j.error?.message ?? `HTTP ${r.status}` };
    return { ok: true, via: "api", id: j.messages?.[0]?.id };
  } catch (e) { return { ok: false, via: "api", erro: e instanceof Error ? e.message : "falha de rede" }; }
}

/** Aviso no sistema (sino) e, para quem ativou no celular, notificação push — só para avisos novos (a chave evita repetir). */
export async function notificar(userIds: number[], titulo: string, texto: string | null, link: string | null, tipo: "INFO" | "ACAO" | "ALERTA" = "INFO", chave: string | null = null) {
  const novos: number[] = [];
  for (const uid of new Set(userIds.filter(Boolean))) {
    const r = chave ? await sql`INSERT INTO notifications (user_id, tipo, titulo, texto, link, chave) VALUES (${uid}, ${tipo}, ${titulo}, ${texto}, ${link}, ${chave}) ON CONFLICT (user_id, chave) WHERE chave IS NOT NULL DO NOTHING RETURNING id`
      : await sql`INSERT INTO notifications (user_id, tipo, titulo, texto, link) VALUES (${uid}, ${tipo}, ${titulo}, ${texto}, ${link}) RETURNING id`;
    if (r.length) novos.push(uid);
  }
  if (novos.length) dispararPush(novos, { titulo, texto, link, tipo, tag: chave ?? undefined });
}
/** Push depois da resposta (não atrasa quem clicou); fora de uma requisição, envia na hora. Falha de push nunca afeta o aviso no sistema. */
function dispararPush(ids: number[], p: { titulo: string; texto: string | null; link: string | null; tipo: string; tag?: string }) {
  const job = async () => { try { const { enviarPush } = await import("./push"); await enviarPush(ids, p); } catch { /* complemento */ } };
  try { after(job); } catch { void job(); }
}
export async function usuariosPorPerfil(roles: string[], unitId: number | null = null) { const r = await sql<{ id: number }[]>`SELECT id FROM users WHERE ativo AND role = ANY(${roles}) ${unitId === null ? sql`` : sql`AND (unit_id IS NULL OR unit_id=${unitId})`}`; return r.map(x => x.id); }
export async function naoLidas(userId: number) { const [r] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM notifications WHERE user_id=${userId} AND lida_em IS NULL`; return r.n; }

/** Rotina diária (chamada por /api/tarefas): gera alertas de prazo para quem precisa agir e manda o resumo por e-mail se configurado. */
export async function rotinaDiaria() {
  const gestores = await usuariosPorPerfil(["DIRECAO", "RH"]); let n = 0;
  const sla = await sql<{ id: number; assunto: string; unit_id: number; responsavel_user_id: number | null }[]>`SELECT id, assunto, unit_id, responsavel_user_id FROM cases WHERE status IN ('ABERTO','EM_ATENDIMENTO','AGUARDANDO_FAMILIA','REABERTO') AND sla_ate < now()`;
  for (const c of sla) { await notificar([c.responsavel_user_id ?? 0, ...await usuariosPorPerfil(["DIRETOR_UNIDADE"], c.unit_id)], `Atendimento #${c.id} com SLA vencido`, c.assunto, `/atendimento/casos/${c.id}`, "ALERTA", `sla:${c.id}:${new Date().toISOString().slice(0, 10)}`); n++; }
  const os = await sql<{ id: number; titulo: string; responsavel_user_id: number | null; unit_id: number }[]>`SELECT id, titulo, responsavel_user_id, unit_id FROM work_orders WHERE status IN ('ABERTO','EM_EXECUCAO','AGUARDANDO') AND sla_ate < now()`;
  for (const w of os) { await notificar([w.responsavel_user_id ?? 0, ...await usuariosPorPerfil(["OPERACOES"]), ...await usuariosPorPerfil(["DIRETOR_UNIDADE"], w.unit_id)], `Chamado #${w.id} fora do prazo`, w.titulo, `/operacoes/chamados/${w.id}`, "ALERTA", `os:${w.id}:${new Date().toISOString().slice(0, 10)}`); n++; }
  const [pend] = await sql<{ ferias: number; exc: number; desc: number; vagas: number }[]>`SELECT (SELECT count(*) FROM leave_requests WHERE status='SOLICITADA')::int AS ferias, (SELECT count(*) FROM exceptions WHERE status='SOLICITADA')::int AS exc, (SELECT count(*) FROM discounts WHERE status='SOLICITADO')::int AS desc, (SELECT count(*) FROM requisitions WHERE status='SOLICITADA')::int AS vagas`;
  const dia = new Date().toISOString().slice(0, 10);
  if (pend.ferias) { await notificar(gestores, `${pend.ferias} pedido(s) de férias/afastamento aguardando`, null, "/ferias?status=SOLICITADA", "ACAO", `ferias:${dia}`); n++; }
  if (pend.exc) { await notificar(gestores, `${pend.exc} exceção(ões) aguardando decisão`, null, "/governanca/excecoes", "ACAO", `exc:${dia}`); n++; }
  if (pend.desc) { await notificar([...gestores, ...await usuariosPorPerfil(["FINANCEIRO"])], `${pend.desc} desconto(s) aguardando aprovação`, null, "/financeiro/descontos", "ACAO", `desc:${dia}`); n++; }
  if (pend.vagas) { await notificar(gestores, `${pend.vagas} requisição(ões) de vaga aguardando`, null, "/recrutamento", "ACAO", `vagas:${dia}`); n++; }
  const venc = await sql<{ id: number; nome: string; unit_id: number; n: number }[]>`SELECT e.id, e.nome, e.unit_id, count(*)::int AS n FROM documents d JOIN employees e ON e.id=d.employee_id WHERE d.validade IS NOT NULL AND d.validade BETWEEN CURRENT_DATE AND CURRENT_DATE + 30 GROUP BY e.id, e.nome, e.unit_id`;
  for (const v of venc) { await notificar(gestores, `Documento(s) de ${v.nome} vencendo em 30 dias`, `${v.n} documento(s)`, `/colaboradores/${v.id}#documentos`, "ALERTA", `doc:${v.id}:${dia.slice(0, 7)}`); n++; }
  // resumo por e-mail (opcional)
  let emails = 0;
  if (process.env.RESEND_API_KEY) {
    const users = await sql<{ id: number; email: string; nome: string }[]>`SELECT id, email, nome FROM users WHERE ativo AND email LIKE '%@%.%'`;
    for (const u of users) { const itens = await sql<{ titulo: string; link: string | null }[]>`SELECT titulo, link FROM notifications WHERE user_id=${u.id} AND lida_em IS NULL AND created_at > now() - interval '1 day' ORDER BY created_at DESC LIMIT 15`; if (!itens.length) continue;
      const ok = await enviarEmail([u.email], `STATUS ONE — ${itens.length} aviso(s) para hoje`, `Olá, ${u.nome}.\n\n${itens.map(i => `• ${i.titulo}${i.link ? ` — ${process.env.APP_URL ?? ""}${i.link}` : ""}`).join("\n")}\n\nAcesse o sistema para tratar.`); if (ok) emails++; }
  }
  return { alertas: n, emails };
}
