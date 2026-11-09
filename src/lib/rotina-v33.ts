// v33 · rotina diária de fornecedores (TC-SUP-005): aplica SÓ a restrição prevista na regra vigente e avisa com quantidades (sem nomes).
//  • homologação vencida (revalidar_em no passado) ou restrição vencida → "em revalidação" (VENCIDO);
//  • documento exigível vencido em fornecedor de criticidade alta (com a política ligada) → "em revalidação";
//  • média e baixa criticidade: só pendência e aviso (o risco sobe sozinho pelo documento vencido);
//  • convite do portal vencido → expirado. Cada mudança vai para a trilha como "sistema".
import { sql } from "@/db";
import { notificar, usuariosPorPerfil } from "./comunicacao";
import { hoje, addDays } from "./utils";
import * as F from "./fornecedores";

export async function rotinaV33(h = hoje()) {
  const r = { revalidacao: 0, documentosAlta: 0, convitesExpirados: 0, documentosVencendo: 0, falhas: [] as string[] };
  const marcar = async (id: number, de: string, motivo: string) => {
    const up = await sql`UPDATE suppliers SET status='VENCIDO', ativo=true, status_motivo=${motivo}, status_em=now(), status_por='Rotina diária', versao=versao+1, updated_at=now() WHERE id=${id} AND status=${de}`;
    if (up.count) await sql`INSERT INTO audit_log (user_id, user_nome, acao, entidade, entidade_id, antes, depois) VALUES (NULL, 'sistema', 'fornecedor em revalidação (rotina)', 'suppliers', ${id}, ${JSON.stringify({ status: de })}::jsonb, ${JSON.stringify({ status: "VENCIDO", motivo })}::jsonb)`;
    return up.count;
  };
  try {
    const vencidos = await sql<{ id: number; status: string; revalidar_em: string | null; restricao_ate: string | null }[]>`SELECT id, status, revalidar_em::text, restricao_ate::text FROM suppliers WHERE status IN ('HOMOLOGADO','CONDICIONAL') AND ((revalidar_em IS NOT NULL AND revalidar_em < ${h}) OR (status='CONDICIONAL' AND restricao_ate IS NOT NULL AND restricao_ate < ${h}))`;
    for (const v of vencidos) r.revalidacao += await marcar(v.id, v.status, v.revalidar_em && v.revalidar_em < h ? `Homologação venceu em ${F.dataBR(v.revalidar_em)}: revalide (documentos, desempenho e nova decisão).` : `Restrição venceu em ${F.dataBR(v.restricao_ate)}: precisa de nova decisão.`);
  } catch (e) { r.falhas.push(`revalidação: ${e instanceof Error ? e.message : String(e)}`); }
  try {
    const cfg = await F.cfgForn();
    if (cfg.vencidoBloqueiaAlta) {
      const lista = await F.carregarLista(cfg);
      for (const l of lista.filter(x => x.criticidade === "ALTA" && ["HOMOLOGADO", "CONDICIONAL"].includes(x.status))) {
        const venc = l.checklist.filter(c => c.exigivel && c.situacao === "VENCIDO");
        if (venc.length) r.documentosAlta += await marcar(l.id, l.status, `Documento exigível vencido (criticidade alta): ${venc.map(c => c.tipo).join("; ")}. Envie o atualizado e revalide.`);
      }
    }
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM supplier_documents d JOIN suppliers s ON s.id=d.supplier_id WHERE d.status IN ('ENVIADO','CONFERIDO') AND d.validade BETWEEN ${h} AND ${addDays(h, cfg.alertaDocumentosDias)} AND s.status NOT IN ('INATIVO','REJEITADO')`;
    r.documentosVencendo = n;
  } catch (e) { r.falhas.push(`documentos: ${e instanceof Error ? e.message : String(e)}`); }
  try { r.convitesExpirados = (await sql`UPDATE supplier_invitations SET estado='EXPIRADO' WHERE estado='ATIVO' AND expira_em < ${h}`).count; } catch (e) { r.falhas.push(`convites: ${e instanceof Error ? e.message : String(e)}`); }
  try {
    const em = r.revalidacao + r.documentosAlta;
    if (em) await notificar(await usuariosPorPerfil(["DIRECAO", "FINANCEIRO", "OPERACOES"]), `${em} fornecedor(es) entraram em revalidação hoje`, "Homologação ou documento exigível vencido: novos lançamentos só com exceção até a revalidação.", "/operacoes/fornecedores?aba=homologacao", "ACAO", `forn-revalida:${h}`);
    if (r.documentosVencendo && new Date(h + "T12:00:00").getDay() === 1) await notificar(await usuariosPorPerfil(["FINANCEIRO", "OPERACOES"]), `${r.documentosVencendo} documento(s) de fornecedores vencem nos próximos dias`, "Peça a versão atualizada pelo portal do fornecedor.", "/operacoes/fornecedores?aba=documentos", "INFO", `forn-docs-semana:${h}`);
  } catch (e) { r.falhas.push(`avisos: ${e instanceof Error ? e.message : String(e)}`); }
  return r;
}
