"use server";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, assert, scopeUnit, type Session } from "@/lib/auth";
import { audit, str, strOrNull, int, getSettings, caminhoSeguro, fmtData } from "@/lib/utils";
import { processarAuditoria, ACOES, DIV_TIPO } from "@/lib/auditoria-ponto";
import { salvarDias } from "@/lib/ponto";
import { assertMesAberto } from "@/lib/folha";

const go = (b: string, k: "ok" | "erro", msg: string) => `${b}${b.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(msg)}`;
const PERFIS = ["RH", "DIRECAO", "DIRETOR_UNIDADE"];
const LOTE = ["ATRASO", "SAIDA_ANTECIPADA", "DEFICIT", "HORA_EXTRA"];
async function guarda(s: Session, acao: string) { if (!PERFIS.includes(s.role)) { await audit(s, `acesso negado: ${acao}`, "timesheet_audit", null, null, { papel: s.role }); throw new Error("A auditoria do ponto é do RH, da Direção e do diretor(a) da unidade."); } }
type Div = { id: number; employee_id: number; unit_id: number | null; data: string; tipo: string; minutos: number; status: string; detalhe: string | null };
async function lerDiv(s: Session, id: number) {
  const [d] = await sql<Div[]>`SELECT id, employee_id, unit_id, data::text, tipo, minutos, status, detalhe FROM timesheet_audit WHERE id=${id}`; if (!d) throw new Error("Divergência não encontrada.");
  const u = scopeUnit(s); if (u !== null && d.unit_id !== u) throw new Error("Sem acesso a esta unidade."); return d;
}
/** Aceitar = vira lançamento: o do dia (gerado na importação) ou um novo, PENDENTE de aprovação. */
async function aceitarUma(s: Session, d: Div, obs: string | null) {
  await assertMesAberto(d.employee_id, [d.data]);
  const [dia] = await sql<{ id: number }[]>`SELECT id FROM timesheet_days WHERE employee_id=${d.employee_id} AND data=${d.data}`;
  let he: number | null = null;
  if (["ATRASO", "SAIDA_ANTECIPADA", "DEFICIT", "HORA_EXTRA", "TRABALHO_SEM_ESCALA", "SEM_MARCACAO"].includes(d.tipo)) {
    const [h] = dia ? await sql<{ id: number }[]>`SELECT id FROM hour_entries WHERE timesheet_day_id=${dia.id} ORDER BY id LIMIT 1` : [];
    if (h) he = h.id;
    else if (d.minutos) { const neg = !["HORA_EXTRA", "TRABALHO_SEM_ESCALA"].includes(d.tipo); const [n] = await sql<{ id: number }[]>`INSERT INTO hour_entries (employee_id, data, minutos, tipo, descricao, status, lancado_por, timesheet_day_id, lote) VALUES (${d.employee_id}, ${d.data}, ${neg ? -d.minutos : d.minutos}, ${neg ? "ATRASO" : "EXTRA"}, ${`Auditoria do ponto ${fmtData(d.data)}: ${DIV_TIPO[d.tipo]?.rotulo ?? d.tipo}`}, 'PENDENTE', ${s.id}, ${dia?.id ?? null}, 'AUDITORIA') RETURNING id`; he = n.id; }
  }
  await sql`UPDATE timesheet_audit SET status='ACEITA', decisao_obs=${obs}, decidido_por=${s.id}, decidido_em=now(), hour_entry_id=${he}, updated_at=now() WHERE id=${d.id}`;
  await audit(s, "auditoria do ponto: aceitar divergência", "timesheet_audit", d.id, { status: d.status }, { status: "ACEITA", lancamento: he, obs });
}

export async function processarAuditoriaMes(fd: FormData) {
  const s = await requireSession(); const mes = str(fd, "mes"); const pedida = int(fd, "unitId"); const b = caminhoSeguro(str(fd, "voltar"), `/ponto/auditoria?mes=${mes}`); let msg = "";
  try {
    await guarda(s, "processar auditoria do ponto"); assert(/^\d{4}-(0[1-9]|1[0-2])$/.test(mes), "Mês inválido.");
    const u = scopeUnit(s); const unitId = u ?? pedida ?? null;
    const r = await processarAuditoria(unitId, mes);
    await audit(s, "processar auditoria do ponto", "timesheet_audit", null, null, { mes, unitId, ...r });
    msg = `Auditoria de ${mes.split("-").reverse().join("/")}: ${r.colaboradores} colaborador(es), ${r.novos} divergência(s) nova(s), ${r.atualizados} reavaliada(s), ${r.resolvidos} resolvida(s) na reimportação.`;
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", msg));
}

export async function decidirDivergencia(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const b = caminhoSeguro(str(fd, "voltar"), "/ponto/auditoria"); let msg = "";
  try {
    await guarda(s, "decidir divergência do ponto"); const d = await lerDiv(s, id); assert(d.status === "ABERTA" || d.status === "DEVOLVIDA", "Divergência já decidida.");
    const acao = str(fd, "acao"); assert((ACOES[d.tipo] ?? []).includes(acao as "ACEITAR"), "Ação não se aplica a este tipo.");
    const obs = strOrNull(fd, "obs");
    if (acao === "ACEITAR") {
      if (d.tipo === "CH_DIVERGENTE" || d.tipo === "MARCACAO_IMPAR" || d.tipo === "SEM_MARCACAO") assert(!!obs && obs.length >= 10, "Justifique por que fica como está (mínimo 10 caracteres).");
      await aceitarUma(s, d, obs); msg = ["CH_DIVERGENTE", "MARCACAO_IMPAR"].includes(d.tipo) ? "Mantido como está, com justificativa." : "Aceita: o lançamento do dia segue para aprovação (Aprovações).";
    } else if (acao === "DEVOLVER") {
      assert(!!obs && obs.length >= 5, "Diga o que precisa ser corrigido no relógio.");
      await sql`UPDATE timesheet_audit SET status='DEVOLVIDA', decisao_obs=${obs}, decidido_por=${s.id}, decidido_em=now(), updated_at=now() WHERE id=${d.id}`;
      await audit(s, "auditoria do ponto: devolver ao relógio", "timesheet_audit", d.id, { status: d.status }, { status: "DEVOLVIDA", obs });
      msg = "Devolvida ao relógio: corrija a marcação no Secullum e reimporte — a reimportação resolve a divergência.";
    } else if (acao === "CORRIGIR_CH") {
      await assertMesAberto(d.employee_id, [d.data]);
      const [dia] = await sql<{ esperado_min: number; trabalhado_min: number; status: string; obs: string | null; marcacoes: string | null; origem: string }[]>`SELECT esperado_min, trabalhado_min, status, obs, marcacoes, origem FROM timesheet_days WHERE employee_id=${d.employee_id} AND data=${d.data}`; assert(!!dia, "Dia não encontrado no espelho.");
      const regra = dia.esperado_min - d.minutos; // minutos = relógio − regra
      await salvarDias(s, d.employee_id, [{ data: d.data, esperado: regra, trabalhado: dia.trabalhado_min, status: dia.status, obs: [dia.obs, `CH corrigida pela auditoria (${dia.esperado_min}→${regra} min)`].filter(Boolean).join(" · "), marcacoes: dia.marcacoes, origem: dia.origem }]);
      await sql`UPDATE timesheet_audit SET status='CORRIGIDA', decisao_obs=${obs}, decidido_por=${s.id}, decidido_em=now(), updated_at=now() WHERE id=${d.id}`;
      await audit(s, "auditoria do ponto: corrigir CH do dia", "timesheet_days", d.employee_id, { data: d.data, esperado: dia.esperado_min }, { data: d.data, esperado: regra });
      msg = "CH do dia corrigida para a da jornada/grade; o banco de horas do dia foi refeito.";
    } else throw new Error("Ação inválida.");
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", msg));
}

/** C10 · aceitar em lote só o normal (atraso, saída antecipada, déficit, hora extra); o resto é decisão individual. */
export async function aceitarLoteDivergencias(fd: FormData) {
  const s = await requireSession(); const b = caminhoSeguro(str(fd, "voltar"), "/ponto/auditoria"); let msg = "";
  try {
    await guarda(s, "aceitar divergências em lote"); const ids = [...new Set(fd.getAll("ids").map(Number).filter(n => n > 0))]; assert(ids.length > 0, "Marque as divergências.");
    let ok = 0; const fora: string[] = [];
    for (const id of ids) { try { const d = await lerDiv(s, id); if (d.status !== "ABERTA") continue; if (!LOTE.includes(d.tipo)) { fora.push(`${fmtData(d.data)} (${DIV_TIPO[d.tipo]?.rotulo})`); continue; } await aceitarUma(s, d, "aceita em lote"); ok++; } catch (e) { fora.push(e instanceof Error ? e.message : "erro"); } }
    await audit(s, "auditoria do ponto: aceitar em lote", "timesheet_audit", null, null, { marcadas: ids.length, aceitas: ok, fora: fora.length });
    msg = `${ok} aceita(s) em lote${fora.length ? ` · ${fora.length} ficaram para decisão individual` : ""}.`;
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", msg));
}

/** Atestado: anexa o documento ao dia (só o documento — nunca CID ou diagnóstico) e fecha a divergência. */
export async function anexarAtestado(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const b = caminhoSeguro(str(fd, "voltar"), "/ponto/auditoria");
  try {
    assert(["RH", "DIRECAO"].includes(s.role), "Atestado é anexado pelo RH ou pela Direção (dado sensível).");
    const d = await lerDiv(s, id); assert(d.tipo === "ATESTADO_SEM_DOC", "Só para atestado sem documento.");
    const [dia] = await sql<{ id: number }[]>`SELECT id FROM timesheet_days WHERE employee_id=${d.employee_id} AND data=${d.data}`; assert(!!dia, "Dia não encontrado.");
    const cfg = await getSettings(); const arq = fd.get("arquivo"); assert(!!arq && typeof arq === "object" && "arrayBuffer" in arq && (arq as File).size > 0, "Escolha o arquivo do atestado.");
    const f = arq as File; assert(f.size <= cfg.plataforma.anexoMaxMb * 1048576, `Arquivo acima de ${cfg.plataforma.anexoMaxMb} MB.`); const mime = f.type || "application/octet-stream"; assert((cfg.plataforma.anexoTipos as string[]).includes(mime), `Tipo não permitido (${mime}).`);
    const nome = f.name.replace(/[^\w.\-() áéíóúâêôãõçÁÉÍÓÚÂÊÔÃÕÇ]/g, "_").slice(0, 120);
    const [a] = await sql<{ id: number }[]>`INSERT INTO attachments (entidade, entidade_id, nome, mime, tamanho, dados, descricao, unit_id, user_id, user_nome) VALUES ('timesheet_day', ${dia.id}, ${nome}, ${mime}, ${f.size}, ${Buffer.from(await f.arrayBuffer())}, 'Atestado (sem CID)', ${d.unit_id}, ${s.id}, ${s.nome}) RETURNING id`;
    await sql`UPDATE timesheet_audit SET status='ABONADA', decisao_obs='Atestado anexado', decidido_por=${s.id}, decidido_em=now(), updated_at=now() WHERE id=${d.id}`;
    await audit(s, "auditoria do ponto: anexar atestado", "attachments", a.id, null, { dia: d.data, divergencia: d.id }); // sem nome do arquivo nem conteúdo
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Atestado anexado ao dia."));
}
