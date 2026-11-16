"use server";
// v34 · divisão do PDF da folha por pessoa: prévia (com o dono de cada página), ajuste manual, publicação e descarte.
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, assert } from "@/lib/auth";
import { audit, str, int, getSettings } from "@/lib/utils";
import { comMensagem } from "@/lib/redirecionar";
import { podePreparar } from "@/lib/folha";
import { abrirPdf, textoPorPagina, extrairPaginas } from "@/lib/pdf-v34";
import { TIPOS_DIVISAO, DOC_PESSOAL, anual, fmtCompetencia, pessoasDoPeriodo, identificarPaginas, agrupar, type PaginaDivisao } from "@/lib/folha-dividir";
import { notificar } from "@/lib/comunicacao";
import { usuariosDasFichas } from "@/lib/assinaturas";

const go = (b: string, k: "ok" | "erro", m: string) => comMensagem(b, k, m);
const msgErro = (e: unknown) => (e instanceof Error ? e.message : "Erro inesperado.");
const BASE = "/folha/dividir";

export async function previaDivisao(fd: FormData) {
  const s = await requireSession(); let id = 0; let resumo = "";
  try {
    assert(podePreparar(s), "Só RH e Direção dividem o PDF da folha.");
    const tipo = str(fd, "tipo"); assert(!!TIPOS_DIVISAO[tipo], "Escolha o tipo do documento.");
    const competencia = anual(tipo) ? str(fd, "ano") : str(fd, "competencia");
    assert(anual(tipo) ? /^\d{4}$/.test(competencia) : /^\d{4}-\d{2}$/.test(competencia), anual(tipo) ? "Informe o ano-calendário (ex.: 2026)." : "Informe a competência (mês e ano).");
    const companyId = int(fd, "companyId") || null;
    const cfg = await getSettings(); const arq = fd.get("arquivo");
    if (!arq || typeof arq !== "object" || !("arrayBuffer" in arq) || (arq as File).size === 0) throw new Error("Escolha o PDF.");
    const f = arq as File; assert(f.size <= cfg.plataforma.anexoMaxMb * 1048576, `PDF acima de ${cfg.plataforma.anexoMaxMb} MB: peça ao contador o arquivo em partes (por empresa, por exemplo).`);
    const bytes = new Uint8Array(await f.arrayBuffer()); assert(Buffer.from(bytes.subarray(0, 5)).toString() === "%PDF-", "O arquivo não é um PDF.");
    const doc = await abrirPdf(bytes); const n = doc.getPageCount(); assert(n >= 1 && n <= 800, "PDF com mais de 800 páginas: divida o arquivo em partes.");
    const textos = await textoPorPagina(bytes); const semTexto = textos.filter(t => !t.trim()).length;
    const pessoas = await pessoasDoPeriodo(tipo, competencia, companyId); assert(pessoas.length > 0, "Ninguém na equipe deste período (e desta empresa).");
    const paginas = identificarPaginas(textos, pessoas);
    const [ciclo] = companyId && !anual(tipo) ? await sql<{ id: number }[]>`SELECT id FROM payroll_cycles WHERE competencia=${competencia} AND company_id=${companyId}` : [];
    const nome = f.name.replace(/[^\w.\-() áéíóúâêôãõçÁÉÍÓÚÂÊÔÃÕÇ]/g, "_").slice(0, 120) || "folha.pdf";
    await sql.begin(async tx => {
      const [a] = await tx<{ id: number }[]>`INSERT INTO attachments (entidade, entidade_id, nome, mime, tamanho, dados, descricao, unit_id, user_id, user_nome) VALUES ('pdf_split', 0, ${nome}, 'application/pdf', ${f.size}, ${Buffer.from(bytes)}, ${`PDF para dividir: ${TIPOS_DIVISAO[tipo]} ${fmtCompetencia(competencia)}`}, NULL, ${s.id}, ${s.nome}) RETURNING id`;
      const [r] = await tx<{ id: number }[]>`INSERT INTO pdf_splits (tipo, competencia, cycle_id, nome_arquivo, attachment_id, paginas, resultado, user_id, user_nome) VALUES (${tipo}, ${competencia}, ${ciclo?.id ?? null}, ${nome}, ${a.id}, ${n}, ${JSON.stringify({ companyId, paginas })}::jsonb, ${s.id}, ${s.nome}) RETURNING id`;
      await tx`UPDATE attachments SET entidade_id=${r.id} WHERE id=${a.id}`; id = r.id;
    });
    const ok = paginas.filter(p => p.employeeId).length; resumo = `${n} página(s) lidas: ${ok} com dono${n - ok ? `, ${n - ok} sem dono` : ""}${semTexto ? ` (${semTexto} sem texto — PDF digitalizado?)` : ""}. Confira antes de publicar.`;
    await audit(s, "prévia da divisão do PDF da folha", "pdf_splits", id, null, { tipo, competencia, paginas: n, identificadas: ok });
  } catch (e) { redirect(go(BASE, "erro", msgErro(e))); }
  redirect(go(`${BASE}/${id}`, "ok", resumo));
}

async function divisao(id: number) {
  const [d] = await sql<{ id: number; tipo: string; competencia: string; cycle_id: number | null; attachment_id: number | null; status: string; resultado: { companyId: number | null; paginas: PaginaDivisao[] } }[]>`SELECT id, tipo, competencia, cycle_id, attachment_id, status, resultado FROM pdf_splits WHERE id=${id}`;
  assert(!!d, "Divisão não encontrada."); return d!;
}

/** Ajuste manual: o dono de uma página (ou deixar a página de fora). */
export async function ajustarPagina(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const volta = `${BASE}/${id}`;
  try {
    assert(podePreparar(s), "Só RH e Direção."); const d = await divisao(id); assert(d.status === "PREVIA", "A divisão já foi publicada ou descartada.");
    const pagina = int(fd, "pagina") ?? 0; const emp = int(fd, "employeeId") || null;
    const p = d.resultado.paginas.find(x => x.pagina === pagina); assert(!!p, "Página inválida.");
    let nome: string | null = null;
    if (emp) { const pessoas = await pessoasDoPeriodo(d.tipo, d.competencia, d.resultado.companyId); const pe = pessoas.find(x => x.id === emp); assert(!!pe, "A pessoa não está na equipe do período."); nome = pe!.nome; }
    const paginas = d.resultado.paginas.map(x => x.pagina === pagina ? { ...x, employeeId: emp, nome, por: emp ? "MANUAL" as const : null, alerta: emp ? null : "Deixada de fora pelo RH." } : x);
    await sql`UPDATE pdf_splits SET resultado=${JSON.stringify({ ...d.resultado, paginas })}::jsonb WHERE id=${id}`;
  } catch (e) { redirect(go(volta, "erro", msgErro(e))); }
  redirect(go(volta, "ok", "Página ajustada."));
}

/** Publica: um PDF por pessoa no Meu espaço (substitui o mesmo documento publicado antes por outra divisão) e avisa cada pessoa. */
export async function publicarDivisao(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const volta = `${BASE}/${id}`; let msg = "";
  try {
    assert(podePreparar(s), "Só RH e Direção publicam."); const d = await divisao(id); assert(d.status === "PREVIA", "A divisão já foi publicada ou descartada.");
    const conferir = d.resultado.paginas.filter(p => p.por === "CONTINUACAO" || (p.por === "NOME" && p.alerta)).length;
    if (conferir) assert(str(fd, "conferi") === "1", `Marque que conferiu as ${conferir} página(s) destacadas antes de publicar.`);
    const grupos = agrupar(d.resultado.paginas); assert(grupos.length > 0, "Nenhuma página com dono: nada a publicar.");
    const [a] = await sql<{ dados: Buffer }[]>`SELECT dados FROM attachments WHERE id=${d.attachment_id}`; assert(!!a, "O PDF original não está mais guardado.");
    const origem = await abrirPdf(new Uint8Array(a!.dados)); const rot = DOC_PESSOAL[d.tipo] ?? "Documento"; let substituidos = 0;
    for (const g of grupos) {
      const pdf = await extrairPaginas(origem, g.paginas); const nome = `${rot.toLowerCase().replace(/[^a-z0-9º]+/gi, "-")}-${d.competencia}-${g.employeeId}.pdf`;
      await sql.begin(async tx => {
        const antigos = await tx<{ id: number; attachment_id: number }[]>`SELECT id, attachment_id FROM payroll_docs WHERE employee_id=${g.employeeId} AND tipo=${d.tipo} AND competencia=${d.competencia} AND split_id IS NOT NULL`;
        for (const x of antigos) { await tx`DELETE FROM payroll_doc_views WHERE doc_id=${x.id}`; await tx`DELETE FROM payroll_docs WHERE id=${x.id}`; await tx`DELETE FROM attachments WHERE id=${x.attachment_id}`; substituidos++; }
        const [at] = await tx<{ id: number }[]>`INSERT INTO attachments (entidade, entidade_id, nome, mime, tamanho, dados, descricao, unit_id, user_id, user_nome) VALUES ('payroll_doc', ${id}, ${nome}, 'application/pdf', ${pdf.length}, ${Buffer.from(pdf)}, ${`${rot} ${fmtCompetencia(d.competencia)}`}, NULL, ${s.id}, ${s.nome}) RETURNING id`;
        await tx`INSERT INTO payroll_docs (cycle_id, tipo, employee_id, attachment_id, user_id, competencia, split_id) VALUES (${d.cycle_id}, ${d.tipo}, ${g.employeeId}, ${at.id}, ${s.id}, ${d.competencia}, ${id})`;
      });
    }
    await sql`UPDATE pdf_splits SET status='PUBLICADO', confirmado_em=now(), publicados=${grupos.length} WHERE id=${id}`;
    const users = await usuariosDasFichas(grupos.map(g => g.employeeId));
    await notificar(users, `${rot} disponível`, `Seu documento de ${fmtCompetencia(d.competencia)} está no Meu espaço → Meus documentos.`, "/eu/documentos", "INFO", `doc:${d.tipo}:${d.competencia}`);
    const fora = d.resultado.paginas.filter(p => !p.employeeId).length;
    await audit(s, "publicar documentos da folha por pessoa", "pdf_splits", id, null, { tipo: d.tipo, competencia: d.competencia, pessoas: grupos.length, paginasFora: fora, substituidos });
    msg = `${grupos.length} documento(s) publicados no Meu espaço; ${users.length} pessoa(s) avisada(s) no ONE.${substituidos ? ` ${substituidos} documento(s) da divisão anterior substituído(s).` : ""}${fora ? ` ${fora} página(s) ficaram de fora.` : ""}`;
  } catch (e) { redirect(go(volta, "erro", msgErro(e))); }
  redirect(go(volta, "ok", msg));
}

/** Descarta a prévia e apaga o PDF original (que tem os dados de todos). */
export async function descartarDivisao(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0;
  try {
    assert(podePreparar(s), "Só RH e Direção."); const d = await divisao(id); assert(d.status === "PREVIA", "Só a prévia pode ser descartada.");
    await sql.begin(async tx => { await tx`UPDATE pdf_splits SET status='DESCARTADO', attachment_id=NULL WHERE id=${id}`; if (d.attachment_id) await tx`DELETE FROM attachments WHERE id=${d.attachment_id}`; });
    await audit(s, "descartar divisão do PDF da folha", "pdf_splits", id, null, { tipo: d.tipo, competencia: d.competencia });
  } catch (e) { redirect(go(`${BASE}/${id}`, "erro", msgErro(e))); }
  redirect(go(BASE, "ok", "Prévia descartada e PDF original apagado."));
}
