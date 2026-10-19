"use server";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, assert, type Session } from "@/lib/auth";
import { audit, str, strOrNull, int, caminhoSeguro, getSettings } from "@/lib/utils";
import { notificar } from "@/lib/comunicacao";
import { DESFECHOS, ISSUE_TIPO, podeOperar, podeTriar } from "@/lib/conciliacao";

const go = (b: string, k: "ok" | "erro", m: string) => `${b}${b.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(m)}`;
const msg = (e: unknown) => e instanceof Error ? e.message : "Erro inesperado.";
const BASE = "/financeiro/divergencias";
/** Tipos que a secretaria (perfil Comercial) trata: identificar pagador e registrar baixa pendente no ActiveSoft. */
const TIPOS_SECRETARIA = ["NAO_IDENTIFICADO", "SEM_BAIXA", "VENDA_SEM_TITULO"];
const DESFECHOS_SECRETARIA = ["IDENTIFICADO", "BAIXA_REGISTRADA", "NAO_PROCEDE"];

async function carregar(s: Session, id: number) {
  const [i] = await sql<{ id: number; tipo: string; status: string; valor: number | null; dono_user_id: number | null; descricao: string }[]>`SELECT id, tipo, status, valor::float, dono_user_id, descricao FROM recon_issues WHERE id=${id}`;
  assert(!!i, "Pendência não encontrada.");
  if (!podeOperar(s)) { const ok = podeTriar(s) && TIPOS_SECRETARIA.includes(i.tipo); if (!ok) { await audit(s, "acesso negado: pendência de conciliação", "recon_issues", id, null, { papel: s.role, tipo: i.tipo }); throw new Error("Seu perfil não trata este tipo de pendência."); } }
  return i;
}

export async function atribuirPendencia(fd: FormData) {
  const voltar = caminhoSeguro(str(fd, "voltar"), BASE);
  try {
    const s = await requireSession(); assert(podeOperar(s), "Só Financeiro e Direção distribuem as pendências."); const id = int(fd, "id") ?? 0; const i = await carregar(s, id); assert(i.status === "ABERTA", "Pendência já resolvida.");
    const dono = int(fd, "donoUserId"); const prazo = strOrNull(fd, "prazo"); assert(!prazo || /^\d{4}-\d{2}-\d{2}$/.test(prazo), "Prazo inválido.");
    if (dono) { const [u] = await sql`SELECT 1 FROM users WHERE id=${dono} AND ativo AND role IN ('FINANCEIRO','DIRECAO','COMERCIAL','DIRETOR_UNIDADE')`; assert(!!u, "Escolha alguém do Financeiro, da Direção, da secretaria ou a direção da unidade."); }
    await sql`UPDATE recon_issues SET dono_user_id=${dono}, prazo=coalesce(${prazo}, prazo), updated_at=now() WHERE id=${id}`;
    await audit(s, "atribuir pendência de conciliação", "recon_issues", id, { dono: i.dono_user_id }, { dono, prazo });
    if (dono && dono !== s.id) await notificar([dono], `Pendência de conciliação #${id} atribuída a você`, `${ISSUE_TIPO[i.tipo] ?? i.tipo}${prazo ? ` · prazo ${prazo.split("-").reverse().join("/")}` : ""}`, `${BASE}#p${id}`, "ACAO", `divdono:${id}:${dono}`);
  } catch (e) { redirect(go(voltar, "erro", msg(e))); }
  redirect(go(voltar, "ok", "Pendência atribuída."));
}

/** Resolver exige desfecho tipificado e evidência (arquivo ou texto, conforme o desfecho); perda assumida acima da alçada só com a Direção. */
export async function resolverPendencia(fd: FormData) {
  const voltar = caminhoSeguro(str(fd, "voltar"), BASE);
  try {
    const s = await requireSession(); const id = int(fd, "id") ?? 0; const i = await carregar(s, id); assert(i.status === "ABERTA", "Pendência já resolvida.");
    const desfecho = str(fd, "desfecho"); const d = DESFECHOS[desfecho]; assert(!!d && desfecho !== "CONCILIADO_AUTO", "Escolha o desfecho.");
    if (!podeOperar(s)) assert(DESFECHOS_SECRETARIA.includes(desfecho), "A secretaria encerra com: pagador identificado, baixa registrada ou não procede.");
    const obs = str(fd, "obs"); assert(obs.length >= 10, "Descreva o que foi feito (no mínimo uma frase) — é o aprendizado da conciliação.");
    const cfg = await getSettings(); const alcada = cfg.conciliacao.perdaAlcadaFinanceiro as number;
    if (desfecho === "PERDA_ASSUMIDA" && Math.abs(i.valor ?? 0) > alcada && s.role !== "DIRECAO") throw new Error(`Perda acima de ${alcada.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} só com a Direção (alçada).`);
    // evidência: arquivo anexado agora ou antes
    const arq = fd.get("arquivo"); let anexou = false;
    if (arq && typeof arq === "object" && "arrayBuffer" in arq && (arq as File).size > 0) {
      const f = arq as File; assert(f.size <= cfg.plataforma.anexoMaxMb * 1048576, `Arquivo acima de ${cfg.plataforma.anexoMaxMb} MB.`); const mime = f.type || "application/octet-stream"; assert((cfg.plataforma.anexoTipos as string[]).includes(mime), `Tipo não permitido (${mime}).`);
      const nome = f.name.replace(/[^\w.\-() áéíóúâêôãõçÁÉÍÓÚÂÊÔÃÕÇ]/g, "_").slice(0, 120); const dados = Buffer.from(await f.arrayBuffer());
      const [a] = await sql<{ id: number }[]>`INSERT INTO attachments (entidade, entidade_id, nome, mime, tamanho, dados, descricao, user_id, user_nome) VALUES ('recon_issue', ${id}, ${nome}, ${mime}, ${f.size}, ${dados}, ${`Evidência · ${d.rotulo}`}, ${s.id}, ${s.nome}) RETURNING id`;
      await audit(s, "anexar arquivo", "attachments", a.id, null, { entidade: "recon_issue", id, nome }); anexou = true;
    }
    if (d.evidencia === "ARQUIVO" && !anexou) { const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM attachments WHERE entidade='recon_issue' AND entidade_id=${id}`; assert(n > 0, `“${d.rotulo}” exige evidência anexada (comprovante, carta da operadora, aprovação).`); }
    await sql`UPDATE recon_issues SET status='RESOLVIDA', desfecho=${desfecho}, desfecho_obs=${obs}, resolvido_em=now(), resolvido_por=${s.id}, updated_at=now() WHERE id=${id}`;
    await audit(s, "resolver pendência de conciliação", "recon_issues", id, { status: "ABERTA" }, { status: "RESOLVIDA", desfecho, valor: i.valor });
  } catch (e) { redirect(go(voltar, "erro", msg(e))); }
  redirect(go(voltar, "ok", "Pendência resolvida com desfecho registrado."));
}

export async function reabrirPendencia(fd: FormData) {
  const voltar = caminhoSeguro(str(fd, "voltar"), BASE);
  try {
    const s = await requireSession(); assert(podeOperar(s), "Só Financeiro e Direção reabrem pendências."); const id = int(fd, "id") ?? 0; const i = await carregar(s, id); assert(i.status === "RESOLVIDA", "A pendência não está resolvida.");
    const motivo = str(fd, "motivo"); assert(motivo.length >= 5, "Explique por que reabrir.");
    await sql`UPDATE recon_issues SET status='ABERTA', desfecho=NULL, desfecho_obs=${`Reaberta: ${motivo}`}, resolvido_em=NULL, resolvido_por=NULL, updated_at=now() WHERE id=${id}`;
    await audit(s, "reabrir pendência de conciliação", "recon_issues", id, { status: "RESOLVIDA" }, { status: "ABERTA", motivo });
  } catch (e) { redirect(go(voltar, "erro", msg(e))); }
  redirect(go(voltar, "ok", "Pendência reaberta."));
}
