import { randomBytes, createHash } from "crypto";
import { sql } from "@/db";
import { hoje, addDays, getSettings, fmtData } from "./utils";

export const REM_STATUS: Record<string, string> = { PENDENTE: "Link ativo", CONCLUIDA: "Concluída pelo link", RECUSADA: "Família recusou", CANCELADA: "Link cancelado", EXPIRADA: "Link expirado" };
/** Situação do aluno na rematrícula (do mais avançado para o menos): matrícula confirmada, reserva, link aberto, link enviado, link gerado, recusa, sem ação. */
export const SITUACAO_REM: Record<string, string> = { MATRICULADA: "Matriculado", RESERVADA: "Reserva (aguardando confirmação)", ABERTO: "Abriu o link, não concluiu", ENVIADO: "Link enviado", GERADO: "Link gerado (não enviado)", RECUSOU: "Recusou pelo link", EXPIRADO: "Link expirado (gere outro)", SEM_LINK: "Sem link", CONCLUINTE: "Concluinte (sem próxima série)" };
export const MOTIVOS_RECUSA = ["Mudança de cidade", "Valor da mensalidade", "Escolheu outra escola", "Turno ou horário", "Questões pedagógicas", "Relacionamento com a escola", "Prefiro conversar com a escola", "Outro"];

export const novoToken = () => randomBytes(24).toString("base64url");
export const sha256 = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
export const soDigitos = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");
/** CPF com dígitos verificadores válidos. */
export function cpfValido(v: string) {
  const d = soDigitos(v); if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (n: number) => { let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}
export const cpfMascarado = (v: string | null | undefined) => { const d = soDigitos(v); return d.length === 11 ? `***.***.***-${d.slice(9)}` : "—"; };

const norm = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+anos?$/, "").replace(/\s+/g, " ").trim();
/** O grupo do Integral atende a série? ("2º + 3º ano" atende "3º ano"; "Jardim II + Jardim III" não atende "Jardim I"). */
export function integralAtende(seriesTexto: string | null, serie: string) {
  if (!seriesTexto) return false; const alvo = norm(serie);
  return seriesTexto.split("+").map(norm).includes(alvo);
}

/** Série prevista para o próximo ano: a de menor ordem acima da atual (null = concluinte). */
export async function proximaSerie(serieAtualId: number | null) {
  if (!serieAtualId) return null;
  const [g] = await sql<{ id: number; nome: string }[]>`SELECT g2.id, g2.nome FROM grades g1 JOIN grades g2 ON g2.ordem > g1.ordem WHERE g1.id=${serieAtualId} ORDER BY g2.ordem LIMIT 1`;
  return g ?? null;
}

export async function contratoVigente(ano: number, db: typeof sql = sql) {
  const [c] = await db<{ id: number; titulo: string; versao: number; texto: string; publicado_em: string | null }[]>`SELECT id, titulo, versao, texto, publicado_em::text FROM contract_templates WHERE ano=${ano} AND status='VIGENTE'`;
  return c ?? null;
}

export type OpcaoTurma = { id: number; nome: string; turno: string; unidade: string; unit_id: number; livres: number; series_texto: string | null };
/** Turmas da série prevista com vagas (mesma unidade quando ela oferece a série; senão, as unidades que oferecem) e grupos do Integral compatíveis. */
export async function opcoesTurmas(link: { ano: number; grade_id: number | null; unit_id: number | null }) {
  const h = hoje(); if (!link.grade_id) return { regulares: [] as OpcaoTurma[], integrais: [] as OpcaoTurma[], outraUnidade: false };
  const livres = sql`(c.vagas - (SELECT count(*) FROM enrollments e WHERE e.class_id=c.id AND (e.status='CONFIRMADA' OR (e.status='RESERVADA' AND e.reserva_ate >= ${h}))))::int`;
  const todas = await sql<OpcaoTurma[]>`SELECT c.id, c.nome, c.turno, u.nome AS unidade, c.unit_id, ${livres} AS livres, c.series_texto FROM classes c JOIN units u ON u.id=c.unit_id WHERE c.ano=${link.ano} AND c.modalidade='REGULAR' AND c.status='ABERTA' AND c.grade_id=${link.grade_id} ORDER BY u.nome, c.turno, c.nome`;
  const mesma = todas.filter(t => t.unit_id === link.unit_id); const regulares = mesma.length ? mesma : todas;
  const [g] = await sql<{ nome: string }[]>`SELECT nome FROM grades WHERE id=${link.grade_id}`;
  const units = [...new Set(regulares.map(t => t.unit_id))];
  const integ = units.length ? await sql<OpcaoTurma[]>`SELECT c.id, c.nome, c.turno, u.nome AS unidade, c.unit_id, ${livres} AS livres, c.series_texto FROM classes c JOIN units u ON u.id=c.unit_id WHERE c.ano=${link.ano} AND c.modalidade='INTEGRAL' AND c.status='ABERTA' AND c.unit_id = ANY(${units}) ORDER BY u.nome, c.turno, c.nome` : [];
  return { regulares, integrais: integ.filter(t => g && integralAtende(t.series_texto, g.nome)), outraUnidade: !mesma.length && todas.length > 0 };
}

/** Texto do contrato com as variáveis da família e da turma escolhida (o mesmo texto é exibido, aceito e guardado com o hash). */
export function textoContrato(modelo: string, v: { aluno: string; responsavel: string; serie: string; turma: string; turno: string; unidade: string; ano: number; integral: string | null }) {
  const vars: Record<string, string> = { aluno: v.aluno, responsavel: v.responsavel, serie: v.serie, turma: v.turma, turno: v.turno, unidade: v.unidade, ano: String(v.ano), integral: v.integral ? `, com Integral (${v.integral})` : "", data: fmtData(hoje()), cpf_responsavel: "(CPF informado no aceite eletrônico)" };
  return modelo.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m));
}

/** "Integral Jardim II + Jardim III · Vespertino" → "Jardim II + Jardim III · Vespertino" (o nome do grupo já diz o turno). */
export const semPrefixoIntegral = (nome: string) => nome.replace(/^Integral\s+/i, "");
export type Rascunho = { classId: number; integralClassId: number | null; responsavel: string; telefone: string; email: string | null };
/** Monta o texto do contrato exatamente como é exibido na etapa 2 (mesma função na página e no aceite). Dentro de transação, passe a conexão dela (`db`). */
export async function contratoDoLink(l: { ano: number; student_id: number; rascunho: Rascunho | null }, db: typeof sql = sql) {
  const c = await contratoVigente(l.ano, db); if (!c || !l.rascunho) return null;
  const [st] = await db<{ nome: string }[]>`SELECT nome FROM students WHERE id=${l.student_id}`;
  const [t] = await db<{ nome: string; turno: string; unidade: string; serie: string | null }[]>`SELECT c.nome, c.turno, u.nome AS unidade, g.nome AS serie FROM classes c JOIN units u ON u.id=c.unit_id LEFT JOIN grades g ON g.id=c.grade_id WHERE c.id=${l.rascunho.classId}`;
  const [i] = l.rascunho.integralClassId ? await db<{ nome: string; turno: string }[]>`SELECT nome, turno FROM classes WHERE id=${l.rascunho.integralClassId}` : [];
  if (!st || !t) return null;
  const texto = textoContrato(c.texto, { aluno: st.nome, responsavel: l.rascunho.responsavel, serie: t.serie ?? "", turma: t.nome, turno: t.turno, unidade: t.unidade, ano: l.ano, integral: i ? semPrefixoIntegral(i.nome) : null });
  return { contrato: c, texto, hash: sha256(texto), turma: t, integral: i ?? null };
}

export type LinhaRem = { student_id: number; nome: string; responsavel: string | null; telefone: string | null; unidade: string | null; unit_id: number | null; serie_atual: string | null; carteira: string | null; carteira_user_id: number | null;
  link_id: number | null; link_status: string | null; token: string | null; expira_em: string | null; enviado_em: string | null; aberto_em: string | null; concluido_em: string | null; serie_prevista: string | null; grade_prevista_id: number | null; recusa_motivo: string | null; case_id: number | null;
  mat_status: string | null; mat_turma: string | null; contrato: boolean | null; financeiro: boolean | null; reserva_ate: string | null; situacao: string };

/** Painel da rematrícula: todos os alunos atuais (escopo da unidade), com o link mais recente do ano e a reserva/matrícula do ano. */
export async function painelRematricula(ano: number, unitId: number | null): Promise<LinhaRem[]> {
  const h = hoje();
  const rows = await sql<Omit<LinhaRem, "situacao">[]>`
    SELECT st.id AS student_id, st.nome, st.responsavel, st.telefone, u.nome AS unidade, st.unit_atual_id AS unit_id, ga.nome AS serie_atual, cu.nome AS carteira, st.carteira_user_id,
      l.id AS link_id, l.status AS link_status, l.token, l.expira_em::text, l.enviado_em::text, l.aberto_em::text, l.concluido_em::text, coalesce(gl.nome, gp.nome) AS serie_prevista, coalesce(l.grade_id, gp.id) AS grade_prevista_id, l.recusa_motivo, l.case_id,
      e.status AS mat_status, c.nome AS mat_turma, e.contrato_assinado AS contrato, e.financeiro_ok AS financeiro, e.reserva_ate::text
    FROM students st LEFT JOIN units u ON u.id=st.unit_atual_id LEFT JOIN grades ga ON ga.id=st.serie_atual_id LEFT JOIN users cu ON cu.id=st.carteira_user_id
      LEFT JOIN LATERAL (SELECT g2.id, g2.nome FROM grades g2 WHERE ga.id IS NOT NULL AND g2.ordem > ga.ordem ORDER BY g2.ordem LIMIT 1) gp ON true
      LEFT JOIN LATERAL (SELECT * FROM rematricula_links x WHERE x.student_id=st.id AND x.ano=${ano} ORDER BY (x.status='PENDENTE') DESC, x.id DESC LIMIT 1) l ON true
      LEFT JOIN grades gl ON gl.id=l.grade_id
      LEFT JOIN LATERAL (SELECT * FROM enrollments e WHERE e.student_id=st.id AND e.ano=${ano} AND e.modalidade='REGULAR' AND (e.status='CONFIRMADA' OR (e.status='RESERVADA' AND e.reserva_ate >= ${h})) ORDER BY (e.status='CONFIRMADA') DESC, e.id DESC LIMIT 1) e ON true
      LEFT JOIN classes c ON c.id=e.class_id
    WHERE st.aluno_atual ${unitId === null ? sql`` : sql`AND st.unit_atual_id=${unitId}`}
    ORDER BY u.nome NULLS LAST, ga.ordem NULLS LAST, st.nome`;
  return rows.map(r => ({ ...r, situacao: r.mat_status === "CONFIRMADA" ? "MATRICULADA" : r.mat_status === "RESERVADA" ? "RESERVADA" : r.link_status === "PENDENTE" && (r.expira_em ?? "") >= h ? (r.aberto_em ? "ABERTO" : r.enviado_em ? "ENVIADO" : "GERADO") : r.link_status === "RECUSADA" ? "RECUSOU" : r.link_status === "PENDENTE" || r.link_status === "EXPIRADA" ? "EXPIRADO" : !r.grade_prevista_id && r.serie_atual ? "CONCLUINTE" : "SEM_LINK" }));
}

/** Gera (ou devolve o já ativo) link de rematrícula de um aluno. Não gera para quem já tem reserva/matrícula no ano. */
export async function gerarLink(studentId: number, ano: number, criadoPor: number, gradeId?: number | null) {
  const cfg = await getSettings(); const h = hoje();
  const [st] = await sql<{ id: number; nome: string; aluno_atual: boolean; unit_atual_id: number | null; serie_atual_id: number | null }[]>`SELECT id, nome, aluno_atual, unit_atual_id, serie_atual_id FROM students WHERE id=${studentId}`;
  if (!st) throw new Error("Aluno não encontrado.");
  if (!st.aluno_atual) throw new Error(`${st.nome} não é aluno atual da rede — use a reserva de vaga de captação.`);
  const [ativa] = await sql<{ id: number }[]>`SELECT id FROM enrollments WHERE student_id=${studentId} AND ano=${ano} AND modalidade='REGULAR' AND (status='CONFIRMADA' OR (status='RESERVADA' AND reserva_ate >= ${h}))`;
  if (ativa) throw new Error(`${st.nome} já tem reserva ou matrícula para ${ano}.`);
  // link vencido que a rotina ainda não marcou: expira agora, para gerar um novo (nunca reenviar um link que a família não consegue usar)
  await sql`UPDATE rematricula_links SET status='EXPIRADA', updated_at=now() WHERE student_id=${studentId} AND ano=${ano} AND status='PENDENTE' AND expira_em < ${h}`;
  const [pend] = await sql<{ id: number; token: string }[]>`SELECT id, token FROM rematricula_links WHERE student_id=${studentId} AND ano=${ano} AND status='PENDENTE'`;
  if (pend) return { id: pend.id, token: pend.token, novo: false };
  const grade = gradeId ?? (await proximaSerie(st.serie_atual_id))?.id ?? null;
  if (!grade) throw new Error(st.serie_atual_id ? `${st.nome} está na última série — não há rematrícula para ${ano}.` : `Informe a série atual de ${st.nome} na ficha (ou escolha a série prevista) antes de gerar o link.`);
  const [g] = await sql<{ id: number }[]>`SELECT id FROM grades WHERE id=${grade}`; if (!g) throw new Error("Série prevista inválida.");
  const token = novoToken();
  const [l] = await sql<{ id: number }[]>`INSERT INTO rematricula_links (student_id, ano, unit_id, grade_id, token, expira_em, criado_por) VALUES (${studentId}, ${ano}, ${st.unit_atual_id}, ${grade}, ${token}, ${addDays(h, cfg.rematricula.validadeLinkDias as number)}, ${criadoPor}) ON CONFLICT (student_id, ano) WHERE status='PENDENTE' DO NOTHING RETURNING id`;
  if (!l) { const [x] = await sql<{ id: number; token: string }[]>`SELECT id, token FROM rematricula_links WHERE student_id=${studentId} AND ano=${ano} AND status='PENDENTE'`; return { id: x.id, token: x.token, novo: false }; }
  return { id: l.id, token, novo: true };
}

/** Rotina: links vencidos passam a EXPIRADA (o histórico fica). */
export async function expirarLinks(h = hoje()) {
  const r = await sql`UPDATE rematricula_links SET status='EXPIRADA', updated_at=now() WHERE status='PENDENTE' AND expira_em < ${h} RETURNING id`;
  return r.length;
}

/** Resumo para painéis (Command Center, painel de matrículas): base de alunos atuais e situação da rematrícula. */
export async function resumoRematricula(ano: number, unitId: number | null) {
  const rows = await painelRematricula(ano, unitId);
  const n = (k: string) => rows.filter(r => r.situacao === k).length; const base = rows.filter(r => r.situacao !== "CONCLUINTE").length;
  const feitas = n("MATRICULADA") + n("RESERVADA");
  return { base, matriculadas: n("MATRICULADA"), reservadas: n("RESERVADA"), abertas: n("ABERTO"), enviadas: n("ENVIADO"), geradas: n("GERADO"), recusas: n("RECUSOU"), semLink: n("SEM_LINK") + n("EXPIRADO"), concluintes: n("CONCLUINTE"), pct: base ? Math.round(1000 * feitas / base) / 10 : null };
}
