"use server";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, assert, type Session } from "@/lib/auth";
import { audit, str, strOrNull, int, getSettings, caminhoSeguro, hoje } from "@/lib/utils";
import { notificar } from "@/lib/comunicacao";
import { gerarAgenda as gerarAgendaLib, TIPOS_MOVIMENTO } from "@/lib/obrigacoes";
import { comMensagem } from "@/lib/redirecionar";

const go = (b: string, k: "ok" | "erro", m: string) => comMensagem(b, k, m);
const msg = (e: unknown) => e instanceof Error ? e.message : "Erro inesperado.";
const BASE = "/financeiro/obrigacoes";
async function operador() { const s = await requireSession(); assert(["FINANCEIRO", "DIRECAO"].includes(s.role), "Só Financeiro e Direção operam a agenda fiscal."); return s; }
function reais(v: string): number | null { let t = v.replace(/[R$\s]/g, ""); if (!t) return null; if (t.includes(",")) t = t.replace(/\./g, "").replace(",", "."); const n = Number(t); if (!Number.isFinite(n) || n < 0) throw new Error(`Valor inválido: "${v}".`); return Math.round(n * 100) / 100; }
const dataOk = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);
const compOk = (c: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(c);

/** Anexa o arquivo enviado no campo "comprovante" (ou "arquivo") ao registro; devolve o id do anexo ou null se não veio arquivo. */
async function anexar(s: Session, fd: FormData, campo: string, entidade: "obligation" | "fiscal_case", id: number, descricao: string): Promise<number | null> {
  const arq = fd.get(campo); if (!arq || typeof arq !== "object" || !("arrayBuffer" in arq) || (arq as File).size === 0) return null;
  const cfg = await getSettings(); const f = arq as File; assert(f.size <= cfg.plataforma.anexoMaxMb * 1048576, `Arquivo acima de ${cfg.plataforma.anexoMaxMb} MB.`);
  const mime = f.type || "application/octet-stream"; assert((cfg.plataforma.anexoTipos as string[]).includes(mime), `Tipo não permitido (${mime}). Use PDF ou imagem.`);
  const nome = f.name.replace(/[^\w.\-() áéíóúâêôãõçÁÉÍÓÚÂÊÔÃÕÇ]/g, "_").slice(0, 120); const dados = Buffer.from(await f.arrayBuffer());
  const [a] = await sql<{ id: number }[]>`INSERT INTO attachments (entidade, entidade_id, nome, mime, tamanho, dados, descricao, unit_id, user_id, user_nome) VALUES (${entidade}, ${id}, ${nome}, ${mime}, ${f.size}, ${dados}, ${descricao}, NULL, ${s.id}, ${s.nome}) RETURNING id`;
  await audit(s, "anexar arquivo", "attachments", a.id, null, { entidade, id, nome, tamanho: f.size }); return a.id;
}

export async function gerarAgenda(fd: FormData) {
  const voltar = caminhoSeguro(str(fd, "voltar"), BASE); let r = { criadas: 0, semDia: [] as string[], entidades: 0 };
  try { const s = await operador(); const comp = str(fd, "competencia"); assert(compOk(comp), "Competência no formato AAAA-MM."); r = await gerarAgendaLib(comp, s); await audit(s, "gerar agenda fiscal", "obligations", null, null, { competencia: comp, ...r }); }
  catch (e) { redirect(go(voltar, "erro", msg(e))); }
  redirect(go(voltar, "ok", `${r.criadas} obrigação(ões) criada(s) para ${r.entidades} entidade(s).${r.semDia.length ? ` Sem dia-modelo (cadastre manualmente ou defina em Configurações): ${r.semDia.join(", ")}.` : ""}`));
}

export async function salvarObrigacao(fd: FormData) {
  const voltar = caminhoSeguro(str(fd, "voltar"), BASE); const id = int(fd, "id");
  try {
    const s = await operador(); const tipo = str(fd, "tipo"); assert(tipo.length >= 2 && tipo.length <= 80, "Informe o tipo (ex.: ISS, INSS).");
    const venc = str(fd, "vencimento"); assert(dataOk(venc), "Informe o vencimento."); const comp = str(fd, "competencia"); assert(!comp || compOk(comp), "Competência no formato AAAA-MM.");
    const companyId = int(fd, "companyId"); if (companyId) { const [c] = await sql`SELECT 1 FROM companies WHERE id=${companyId}`; assert(!!c, "Entidade inválida."); }
    const resp = int(fd, "responsavelUserId"); const valor = reais(str(fd, "valor"));
    if (id) { const [o] = await sql<{ status: string }[]>`SELECT status FROM obligations WHERE id=${id}`; assert(!!o, "Obrigação não encontrada."); assert(o.status !== "PAGA", "Obrigação paga e comprovada não se edita (reabra antes, com motivo).");
      await sql`UPDATE obligations SET tipo=${tipo}, descricao=${strOrNull(fd, "descricao")}, competencia=${comp || null}, vencimento=${venc}, valor=${valor}, company_id=${companyId}, responsavel_user_id=${resp}, obs=${strOrNull(fd, "obs")}, updated_at=now() WHERE id=${id}`; await audit(s, "editar obrigação fiscal", "obligations", id, null, { tipo, venc }); }
    else { const [r] = await sql<{ id: number }[]>`INSERT INTO obligations (company_id, tipo, descricao, competencia, vencimento, valor, responsavel_user_id, origem, obs, created_by) VALUES (${companyId}, ${tipo}, ${strOrNull(fd, "descricao")}, ${comp || null}, ${venc}, ${valor}, ${resp}, 'MANUAL', ${strOrNull(fd, "obs")}, ${s.id}) RETURNING id`; await audit(s, "cadastrar obrigação fiscal", "obligations", r.id, null, { tipo, venc }); }
  } catch (e) { redirect(go(voltar, "erro", msg(e))); }
  redirect(go(voltar, "ok", "Obrigação salva."));
}

/** Dar baixa: com comprovante → PAGA; sem comprovante → AGUARDA_COMPROVANTE e a pendência vai para o responsável (aceite T-031). */
export async function darBaixa(fd: FormData) {
  const voltar = caminhoSeguro(str(fd, "voltar"), BASE); const id = int(fd, "id") ?? 0; let comprovado = false;
  try {
    const s = await operador(); const [o] = await sql<{ status: string; tipo: string; responsavel_user_id: number | null }[]>`SELECT status, tipo, responsavel_user_id FROM obligations WHERE id=${id}`; assert(!!o, "Obrigação não encontrada.");
    assert(o.status === "PENDENTE" || o.status === "AGUARDA_COMPROVANTE", "Esta obrigação já foi baixada ou dispensada.");
    const pago = str(fd, "pagoEm") || hoje(); assert(dataOk(pago) && pago <= hoje(), "Data de pagamento inválida (não pode ser futura).");
    const valor = reais(str(fd, "valor")); const anexo = await anexar(s, fd, "comprovante", "obligation", id, `Comprovante de pagamento · ${o.tipo}`);
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM attachments WHERE entidade='obligation' AND entidade_id=${id}`; comprovado = n > 0;
    await sql`UPDATE obligations SET status=${comprovado ? "PAGA" : "AGUARDA_COMPROVANTE"}, pago_em=${pago}, valor=coalesce(${valor}, valor), baixado_por=${s.id}, updated_at=now() WHERE id=${id}`;
    if (!comprovado && o.responsavel_user_id) await notificar([o.responsavel_user_id], `Falta o comprovante: ${o.tipo}`, "A obrigação foi marcada como paga, mas só baixa com o comprovante anexado.", BASE, "ACAO", `obrcomp:${id}`);
    await audit(s, comprovado ? "baixar obrigação com comprovante" : "marcar obrigação paga sem comprovante", "obligations", id, null, { pago, anexo });
  } catch (e) { redirect(go(voltar, "erro", msg(e))); }
  redirect(go(voltar, comprovado ? "ok" : "erro", comprovado ? "Baixa registrada com comprovante." : "Marcada como paga, mas segue PENDENTE DE COMPROVAÇÃO: anexe o comprovante para baixar."));
}

export async function anexarComprovante(fd: FormData) {
  const voltar = caminhoSeguro(str(fd, "voltar"), BASE); const id = int(fd, "id") ?? 0;
  try {
    const s = await operador(); const [o] = await sql<{ status: string; tipo: string }[]>`SELECT status, tipo FROM obligations WHERE id=${id}`; assert(!!o, "Obrigação não encontrada.");
    const a = await anexar(s, fd, "comprovante", "obligation", id, `Comprovante de pagamento · ${o.tipo}`); assert(!!a, "Escolha o arquivo do comprovante.");
    if (o.status === "AGUARDA_COMPROVANTE") { await sql`UPDATE obligations SET status='PAGA', updated_at=now() WHERE id=${id}`; await audit(s, "comprovar baixa de obrigação", "obligations", id, null, { anexo: a }); }
  } catch (e) { redirect(go(voltar, "erro", msg(e))); }
  redirect(go(voltar, "ok", "Comprovante anexado."));
}

export async function delegarObrigacao(fd: FormData) {
  const voltar = caminhoSeguro(str(fd, "voltar"), BASE); const id = int(fd, "id") ?? 0;
  try {
    const s = await operador(); const uid = int(fd, "responsavelUserId") ?? 0; const [u] = await sql<{ id: number }[]>`SELECT id FROM users WHERE id=${uid} AND ativo AND role IN ('FINANCEIRO','DIRECAO','RH')`; assert(!!u, "Escolha um responsável do Financeiro, RH ou Direção.");
    const [o] = await sql<{ tipo: string; vencimento: string }[]>`UPDATE obligations SET responsavel_user_id=${uid}, updated_at=now() WHERE id=${id} RETURNING tipo, vencimento::text`; assert(!!o, "Obrigação não encontrada.");
    await notificar([uid], `Obrigação delegada a você: ${o.tipo}`, `vence em ${o.vencimento.split("-").reverse().join("/")}`, BASE, "ACAO", `obrdel:${id}:${uid}`);
    await audit(s, "delegar obrigação fiscal", "obligations", id, null, { para: uid });
  } catch (e) { redirect(go(voltar, "erro", msg(e))); }
  redirect(go(voltar, "ok", "Obrigação delegada."));
}

export async function dispensarObrigacao(fd: FormData) {
  const voltar = caminhoSeguro(str(fd, "voltar"), BASE); const id = int(fd, "id") ?? 0;
  try {
    const s = await operador(); const motivo = str(fd, "motivo"); assert(motivo.length >= 10, "Explique por que não se aplica no mês (mín. 10 caracteres).");
    const [o] = await sql`UPDATE obligations SET status='DISPENSADA', obs=${motivo}, baixado_por=${s.id}, updated_at=now() WHERE id=${id} AND status IN ('PENDENTE','AGUARDA_COMPROVANTE') RETURNING id`; assert(!!o, "Só obrigação pendente pode ser dispensada.");
    await audit(s, "dispensar obrigação fiscal", "obligations", id, null, { motivo });
  } catch (e) { redirect(go(voltar, "erro", msg(e))); }
  redirect(go(voltar, "ok", "Obrigação dispensada no mês (com motivo registrado)."));
}

export async function reabrirObrigacao(fd: FormData) {
  const voltar = caminhoSeguro(str(fd, "voltar"), BASE); const id = int(fd, "id") ?? 0;
  try {
    const s = await requireSession(); assert(s.role === "DIRECAO", "Só a Direção reabre uma obrigação baixada."); const motivo = str(fd, "motivo"); assert(motivo.length >= 10, "Explique o motivo (mín. 10 caracteres).");
    const [o] = await sql`UPDATE obligations SET status='PENDENTE', pago_em=NULL, updated_at=now() WHERE id=${id} AND status IN ('PAGA','DISPENSADA') RETURNING id`; assert(!!o, "Só obrigação paga ou dispensada pode ser reaberta.");
    await audit(s, "reabrir obrigação fiscal", "obligations", id, null, { motivo });
  } catch (e) { redirect(go(voltar, "erro", msg(e))); }
  redirect(go(voltar, "ok", "Obrigação reaberta."));
}

// ------------------------------------------------------------------ fiscalizações (dossiê)
export async function salvarFiscalizacao(fd: FormData) {
  const voltar = caminhoSeguro(str(fd, "voltar"), BASE); const id = int(fd, "id"); let novo = 0;
  try {
    const s = await operador(); const titulo = str(fd, "titulo"); assert(titulo.length >= 4 && titulo.length <= 160, "Dê um título (ex.: Monitoramento ISS 2026).");
    const ents = fd.getAll("companyIds").map(Number).filter(Boolean); const abertura = str(fd, "abertura"); const prazo = str(fd, "prazo");
    assert(!abertura || dataOk(abertura), "Data de abertura inválida."); assert(!prazo || dataOk(prazo), "Prazo inválido.");
    if (id) { await sql`UPDATE fiscal_cases SET titulo=${titulo}, orgao=${strOrNull(fd, "orgao")}, tipo=${strOrNull(fd, "tipo")}, company_ids=${JSON.stringify(ents)}::jsonb, abertura=${abertura || null}, prazo=${prazo || null}, responsavel_user_id=${int(fd, "responsavelUserId")}, descricao=${strOrNull(fd, "descricao")}, updated_at=now() WHERE id=${id}`; await audit(s, "editar fiscalização", "fiscal_cases", id, null, { titulo }); }
    else { const [r] = await sql<{ id: number }[]>`INSERT INTO fiscal_cases (titulo, orgao, tipo, company_ids, abertura, prazo, responsavel_user_id, descricao, created_by) VALUES (${titulo}, ${strOrNull(fd, "orgao")}, ${strOrNull(fd, "tipo")}, ${JSON.stringify(ents)}::jsonb, ${abertura || null}, ${prazo || null}, ${int(fd, "responsavelUserId")}, ${strOrNull(fd, "descricao")}, ${s.id}) RETURNING id`; novo = r.id; await audit(s, "abrir fiscalização", "fiscal_cases", r.id, null, { titulo }); }
  } catch (e) { redirect(go(voltar, "erro", msg(e))); }
  redirect(go(novo ? `${BASE}?caso=${novo}#fiscalizacoes` : voltar, "ok", "Fiscalização salva."));
}

export async function registrarMovimento(fd: FormData) {
  const caseId = int(fd, "caseId") ?? 0; const voltar = caminhoSeguro(str(fd, "voltar"), `${BASE}?caso=${caseId}#fiscalizacoes`);
  try {
    const s = await operador(); const [c] = await sql<{ status: string; titulo: string; responsavel_user_id: number | null }[]>`SELECT status, titulo, responsavel_user_id FROM fiscal_cases WHERE id=${caseId}`; assert(!!c, "Fiscalização não encontrada."); assert(c.status !== "ENCERRADO", "Fiscalização encerrada.");
    const tipo = str(fd, "tipo"); assert(!!TIPOS_MOVIMENTO[tipo], "Escolha o tipo do movimento."); const texto = str(fd, "texto"); assert(texto.length >= 5 && texto.length <= 2000, "Descreva o movimento (5 a 2.000 caracteres).");
    const data = str(fd, "data") || hoje(); assert(dataOk(data), "Data inválida."); const prazo = str(fd, "prazo"); assert(!prazo || dataOk(prazo), "Prazo inválido.");
    const [e] = await sql<{ id: number }[]>`INSERT INTO fiscal_case_events (case_id, data, tipo, texto, prazo, user_id, user_nome) VALUES (${caseId}, ${data}, ${tipo}, ${texto}, ${prazo || null}, ${s.id}, ${s.nome}) RETURNING id`;
    await anexar(s, fd, "arquivo", "fiscal_case", caseId, `${TIPOS_MOVIMENTO[tipo]} · ${data.split("-").reverse().join("/")}`);
    await sql`UPDATE fiscal_cases SET updated_at=now() WHERE id=${caseId}`;
    if (prazo && c.responsavel_user_id && c.responsavel_user_id !== s.id) await notificar([c.responsavel_user_id], `Novo prazo na fiscalização: ${c.titulo}`, `${TIPOS_MOVIMENTO[tipo]} · prazo ${prazo.split("-").reverse().join("/")}`, `${BASE}?caso=${caseId}#fiscalizacoes`, "ACAO", `fisc:${e.id}`);
    await audit(s, "registrar movimento de fiscalização", "fiscal_case_events", e.id, null, { caseId, tipo, prazo: prazo || null });
  } catch (err) { redirect(go(voltar, "erro", msg(err))); }
  redirect(go(voltar, "ok", "Movimento registrado no dossiê."));
}

export async function cumprirPrazo(fd: FormData) {
  const caseId = int(fd, "caseId") ?? 0; const voltar = caminhoSeguro(str(fd, "voltar"), `${BASE}?caso=${caseId}#fiscalizacoes`);
  try { const s = await operador(); const id = int(fd, "id") ?? 0; const [e] = await sql`UPDATE fiscal_case_events SET cumprido_em=${hoje()} WHERE id=${id} AND case_id=${caseId} AND prazo IS NOT NULL AND cumprido_em IS NULL RETURNING id`; assert(!!e, "Prazo não encontrado ou já cumprido."); await audit(s, "cumprir prazo de fiscalização", "fiscal_case_events", id, null, { caseId }); }
  catch (err) { redirect(go(voltar, "erro", msg(err))); }
  redirect(go(voltar, "ok", "Prazo marcado como cumprido."));
}

export async function encerrarFiscalizacao(fd: FormData) {
  const caseId = int(fd, "caseId") ?? 0; const voltar = caminhoSeguro(str(fd, "voltar"), `${BASE}#fiscalizacoes`);
  try {
    const s = await operador(); const desfecho = str(fd, "desfecho"); assert(desfecho.length >= 10, "Registre o desfecho (mín. 10 caracteres).");
    const [p] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM fiscal_case_events WHERE case_id=${caseId} AND prazo IS NOT NULL AND cumprido_em IS NULL`; assert(p.n === 0, "Há prazos em aberto no dossiê: marque-os como cumpridos antes de encerrar.");
    await sql`INSERT INTO fiscal_case_events (case_id, data, tipo, texto, user_id, user_nome) VALUES (${caseId}, ${hoje()}, 'DECISAO', ${`Encerramento: ${desfecho}`}, ${s.id}, ${s.nome})`;
    const [c] = await sql`UPDATE fiscal_cases SET status='ENCERRADO', updated_at=now() WHERE id=${caseId} AND status <> 'ENCERRADO' RETURNING id`; assert(!!c, "Fiscalização não encontrada ou já encerrada.");
    await audit(s, "encerrar fiscalização", "fiscal_cases", caseId, null, null);
  } catch (err) { redirect(go(voltar, "erro", msg(err))); }
  redirect(go(voltar, "ok", "Fiscalização encerrada."));
}
