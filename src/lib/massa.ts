import { usuariosQueAprovam } from "./acesso";
import { sql } from "@/db";
import { getSettings, auditComo } from "./utils";
import { notificar, usuariosPorPerfil, foneWa, enviarWhatsApp, preencher, linkWa } from "./comunicacao";
import { enviarEmail } from "./notify";

/**
 * CRQ-COM-V3-01 · Comunicação em massa é ação crítica (N0/N1): modelo aprovado, aprovação de um segundo humano
 * (nunca o autor) e disparo só em horário comercial — fora dele, fica agendado para a próxima janela.
 */
type Cfg = Awaited<ReturnType<typeof getSettings>>;
const TZ = "America/Campo_Grande"; const OFFSET = "-04:00"; // Campo Grande sem horário de verão desde 2019
function agoraLocal(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false }).formatToParts(d).map(x => [x.type, x.value]));
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday); return { data: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour === "24" ? "00" : p.hour}:${p.minute}`, dow };
}
export function emHorarioComercial(cfg: Cfg, d = new Date()) {
  const h = cfg.comunicacao.horarioComercial as { inicio: string; fim: string; dias: number[] }; const l = agoraLocal(d);
  return h.dias.includes(l.dow) && l.hm >= h.inicio && l.hm < h.fim;
}
/** Próxima abertura da janela comercial (instante UTC). */
export function proximaJanela(cfg: Cfg, d = new Date()): Date {
  const h = cfg.comunicacao.horarioComercial as { inicio: string; fim: string; dias: number[] };
  for (let k = 0; k <= 8; k++) {
    const dia = new Date(d.getTime() + k * 86400000); const l = agoraLocal(dia); const cand = new Date(`${l.data}T${h.inicio}:00${OFFSET}`);
    if (h.dias.includes(l.dow) && cand > d) return cand;
  }
  return new Date(d.getTime() + 86400000);
}
export const fmtJanela = (d: Date) => d.toLocaleString("pt-BR", { timeZone: TZ, weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Pessoas que um comunicado interno alcança (mesma regra da lista e das notificações). */
export async function alvoComunicado(publico: string, unitId: number | null, role: string | null, positionId: number | null = null) {
  // v29: “unidade” = onde a pessoa trabalha (unidade da ficha), mesmo quando a atuação dela é de rede
  return (await sql<{ id: number }[]>`SELECT u.id FROM users u LEFT JOIN employees e ON e.id=u.employee_id WHERE u.ativo AND u.role <> 'LEITURA' ${publico === "UNIDADE" ? sql`AND (coalesce(e.unit_id, u.unit_id)=${unitId} OR (u.unit_id IS NULL AND u.role IN ('DIRECAO','RH')))` : publico === "PERFIL" ? sql`AND u.role=${role}` : publico === "CARGO" ? sql`AND e.position_id=${positionId ?? 0}` : sql``}`).map(x => x.id);
}
/** v29: quem tem a aprovação de comunicação em massa no cargo (ou no padrão da atuação), nunca o autor. */
export async function aprovadoresMassa(_cfg: Cfg, autorId: number) { return (await usuariosQueAprovam("massa")).filter(id => id !== autorId); }

/** Dispara o comunicado aprovado: fica visível e o público é notificado. */
export async function dispararComunicado(id: number) {
  const [a] = await sql<{ id: number; titulo: string; publico: string; unit_id: number | null; role: string | null; position_id: number | null; requer_ciencia: boolean; status: string }[]>`SELECT id, titulo, publico, unit_id, role, position_id, requer_ciencia, status FROM announcements WHERE id=${id}`;
  if (!a || !["AGENDADO", "APROVADO"].includes(a.status)) return false;
  await sql`UPDATE announcements SET status='PUBLICADO', publicado_em=now(), disparado_em=now() WHERE id=${id}`;
  await notificar(await alvoComunicado(a.publico, a.unit_id, a.role, a.position_id), `Comunicado: ${a.titulo}`, a.requer_ciencia ? "Requer sua ciência." : null, `/comunicacao/comunicados#c${id}`, a.requer_ciencia ? "ACAO" : "INFO");
  return true;
}

export const AUTORES_MASSA_LISTA = ["DIRECAO", "RH", "DIRETOR_UNIDADE", "COMERCIAL", "FINANCEIRO"];
export const CAMPANHA_STATUS: Record<string, [string, string]> = { AGUARDANDO_APROVACAO: ["PENDENTE", "aguardando aprovação"], APROVADA: ["APROVADA", "aprovada"], AGENDADA: ["EM_ADMISSAO", "agendada"], DISPARANDO: ["EM_ADMISSAO", "disparando"], DISPARADA: ["APROVADA", "disparada"], REJEITADA: ["REJEITADA", "rejeitada"], CANCELADA: ["CANCELADA", "cancelada"] };
export const PUBLICO_CAMPANHA: Record<string, string> = { FAMILIAS: "Responsáveis de alunos ativos", COLABORADORES: "Colaboradores ativos" };
export type FiltroCampanha = { unitId?: number | null; gradeId?: number | null; classId?: number | null; inadimplentes?: boolean };
export type Destinatario = { nome: string; contato: string | null; studentId: number | null; employeeId: number | null; unitId: number | null; vars: Record<string, string | null> };
/** Lista de destinatários da campanha (com contato válido para o canal). */
export async function destinatariosCampanha(publico: string, canal: string, f: FiltroCampanha): Promise<{ validos: Destinatario[]; semContato: number }> {
  let todos: Destinatario[] = [];
  if (publico === "FAMILIAS") {
    const r = await sql<{ id: number; nome: string; responsavel: string | null; telefone: string | null; email: string | null; unit_atual_id: number | null; unidade: string | null; serie: string | null; turma: string | null }[]>`SELECT s.id, s.nome, s.responsavel, s.telefone, s.email, s.unit_atual_id, u.nome AS unidade, g.nome AS serie,
        (SELECT c.nome FROM enrollments e JOIN classes c ON c.id=e.class_id WHERE e.student_id=s.id AND e.status <> 'CANCELADA' ORDER BY e.ano DESC, e.id DESC LIMIT 1) AS turma
      FROM students s LEFT JOIN units u ON u.id=s.unit_atual_id LEFT JOIN grades g ON g.id=s.serie_atual_id WHERE s.aluno_atual
      ${f.unitId ? sql`AND s.unit_atual_id=${f.unitId}` : sql``} ${f.gradeId ? sql`AND s.serie_atual_id=${f.gradeId}` : sql``} ${f.classId ? sql`AND EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id=s.id AND e.class_id=${f.classId} AND e.status <> 'CANCELADA')` : sql``} ${f.inadimplentes ? sql`AND s.inadimplente` : sql``} ORDER BY s.nome`;
    todos = r.map(x => ({ nome: x.responsavel || x.nome, contato: canal === "EMAIL" ? x.email : x.telefone, studentId: x.id, employeeId: null, unitId: x.unit_atual_id, vars: { aluno: x.nome, responsavel: x.responsavel, unidade: x.unidade, serie: x.serie, turma: x.turma } }));
  } else {
    const r = await sql<{ id: number; nome: string; telefone: string | null; email: string | null; unit_id: number; unidade: string }[]>`SELECT e.id, e.nome, e.telefone, e.email, e.unit_id, u.nome AS unidade FROM employees e JOIN units u ON u.id=e.unit_id WHERE e.situacao IN ('ATIVO','FERIAS') ${f.unitId ? sql`AND e.unit_id=${f.unitId}` : sql``} ORDER BY e.nome`;
    todos = r.map(x => ({ nome: x.nome, contato: canal === "EMAIL" ? x.email : x.telefone, studentId: null, employeeId: x.id, unitId: x.unit_id, vars: { colaborador: x.nome, unidade: x.unidade } }));
  }
  const ok = (d: Destinatario) => canal === "EMAIL" ? !!d.contato && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.contato) : !!foneWa(d.contato);
  // um envio por contato (irmãos com o mesmo responsável recebem uma vez)
  const vistos = new Set<string>(); const validos: Destinatario[] = [];
  for (const d of todos.filter(ok)) { const k = (canal === "EMAIL" ? d.contato!.toLowerCase() : foneWa(d.contato)!); if (vistos.has(k)) continue; vistos.add(k); validos.push(d); }
  return { validos, semContato: todos.length - todos.filter(ok).length };
}

/** Dispara a campanha aprovada: uma mensagem por destinatário no histórico (enviada pela API quando configurada; senão, link para envio). */
export async function dispararCampanha(id: number) {
  const cfg = await getSettings();
  const [c] = await sql<{ id: number; canal: string; template_id: number; publico: string; filtro: FiltroCampanha; assunto: string | null; status: string; autor_user_id: number; autor_nome: string | null; titulo: string }[]>`SELECT id, canal, template_id, publico, filtro, assunto, status, autor_user_id, autor_nome, titulo FROM message_campaigns WHERE id=${id}`;
  if (!c || !["AGENDADA", "APROVADA"].includes(c.status)) return null;
  const [t] = await sql<{ texto: string; ativo: boolean }[]>`SELECT texto, ativo FROM message_templates WHERE id=${c.template_id}`; if (!t?.ativo) { await sql`UPDATE message_campaigns SET status='CANCELADA', motivo_rejeicao='Modelo desativado antes do disparo' WHERE id=${id}`; return null; }
  await sql`UPDATE message_campaigns SET status='DISPARANDO' WHERE id=${id}`;
  const { validos } = await destinatariosCampanha(c.publico, c.canal, c.filtro ?? {});
  let enviadas = 0, registradas = 0, falhas = 0;
  for (const d of validos) {
    const texto = preencher(t.texto, { ...d.vars, nome: d.nome, assinatura: cfg.comunicacao.assinatura as string });
    let status = "REGISTRADA", erro: string | null = null, provedor: string | null = null;
    if (c.canal === "WHATSAPP") { const r = await enviarWhatsApp(foneWa(d.contato)!, texto); if (r.ok) { status = "ENVIADA"; provedor = r.id ?? null; } else if (r.via === "api") { status = "FALHOU"; erro = r.erro ?? "falha"; } }
    else { const ok = await enviarEmail([d.contato!], c.assunto || "Colégio Status", texto); status = ok ? "ENVIADA" : "REGISTRADA"; if (!ok) erro = "E-mail não configurado ou recusado — envie pelo histórico."; }
    await sql`INSERT INTO messages (canal, destinatario_nome, destinatario_contato, student_id, employee_id, entidade, entidade_id, template_id, texto, status, enviada_em, provedor_id, erro, user_id, user_nome, unit_id, campaign_id)
      VALUES (${c.canal}, ${d.nome}, ${d.contato}, ${d.studentId}, ${d.employeeId}, 'campaign', ${c.id}, ${c.template_id}, ${texto}, ${status}, ${status === "ENVIADA" ? sql`now()` : null}, ${provedor}, ${erro}, ${c.autor_user_id}, ${c.autor_nome}, ${d.unitId}, ${c.id})`;
    if (status === "ENVIADA") enviadas++; else if (status === "FALHOU") falhas++; else registradas++;
  }
  await sql`UPDATE message_campaigns SET status='DISPARADA', disparado_em=now(), total=${validos.length}, enviadas=${enviadas}, registradas=${registradas}, falhas=${falhas} WHERE id=${id}`;
  await auditComo("Rotina de comunicação", "disparar campanha", "message_campaigns", id, null, { total: validos.length, enviadas, registradas, falhas });
  await notificar([c.autor_user_id], `Campanha disparada: ${c.titulo}`, `${validos.length} destinatário(s): ${enviadas} enviada(s), ${registradas} para envio pelo histórico, ${falhas} falha(s).`, `/comunicacao/massa/${id}`, "INFO");
  return { total: validos.length, enviadas, registradas, falhas };
}
export { linkWa };

/** Rotina: dispara comunicados e campanhas agendados cuja janela comercial chegou. */
export async function rotinaMassa() {
  const cfg = await getSettings(); if (!emHorarioComercial(cfg)) return { comunicados: 0, campanhas: 0 };
  const as = await sql<{ id: number }[]>`SELECT id FROM announcements WHERE status='AGENDADO' AND disparo_em <= now()`;
  let n = 0; for (const a of as) if (await dispararComunicado(a.id)) n++;
  const cs = await sql<{ id: number }[]>`SELECT id FROM message_campaigns WHERE status='AGENDADA' AND disparo_em <= now()`;
  let m = 0; for (const c of cs) if (await dispararCampanha(c.id)) m++;
  return { comunicados: n, campanhas: m };
}
