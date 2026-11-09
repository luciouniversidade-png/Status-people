// v33 · pendências de fornecedores: decidir homologação, dar parecer, conferir e aprovar troca de conta (sem quem pediu/conferiu),
// revisar o que chegou pelo portal, conferir documentos, renovar vencidos, revalidar e revisar os cadastros anteriores à v33.
import { sql } from "@/db";
import type { Session } from "./auth";
import { hoje, addDays } from "./utils";
import * as F from "./fornecedores";
import type { Pendencia } from "./pendencias";

const BASE = "/operacoes/fornecedores";
export async function pendenciasV33(s: Session): Promise<{ itens: Pendencia[]; falhas: string[] }> {
  const itens: Pendencia[] = []; const falhas: string[] = [];
  const cad = F.podeCadastrar(s); const homol = F.podeHomologar(s); const confBanco = F.podeConferirBanco(s); const etapas = Object.keys(F.ETAPAS_PARECER).filter(e => F.podeParecer(s, e));
  if (!cad && !homol && !confBanco && !etapas.length) return { itens, falhas };
  const h = hoje();
  try {
    if (homol) {
      const cs = await sql<{ id: number; nome: string; tipo: string; desde: string }[]>`SELECT s.id, s.nome, h.tipo, h.submetido_em::date::text AS desde FROM supplier_homologations h JOIN suppliers s ON s.id=h.supplier_id
        WHERE h.fase='APROVACAO' AND coalesce(h.submetido_por, 0)<>${s.id} AND coalesce(s.criado_por, 0)<>${s.id} ORDER BY h.submetido_em LIMIT 30`;
      for (const c of cs) itens.push({ chave: `forn-decidir${c.id}`, grupo: "APROVAR", modulo: "Fornecedores", acao: "Decidir homologação", titulo: c.nome, sub: `${c.tipo === "INICIAL" ? "homologação inicial" : c.tipo === "REVALIDACAO" ? "revalidação" : "reativação"} · pareceres completos`, href: `${BASE}/${c.id}?aba=homologacao`, prazo: addDays(c.desde, 3) });
    }
    if (etapas.length) {
      const cs = await sql<{ id: number; criticidade: string; feitas: string[] }[]>`SELECT h.supplier_id AS id, h.criticidade, coalesce(array_agg(r.etapa) FILTER (WHERE r.id IS NOT NULL), '{}') AS feitas FROM supplier_homologations h LEFT JOIN supplier_reviews r ON r.homologation_id=h.id
        WHERE h.fase='ANALISE' AND coalesce(h.submetido_por, 0)<>${s.id} GROUP BY h.id`;
      const n = cs.filter(c => F.pareceresExigidos(c.criticidade).some(e => etapas.includes(e) && !c.feitas.includes(e))).length;
      if (n) itens.push({ chave: "forn-parecer", grupo: "ATENDER", modulo: "Fornecedores", acao: "Dar parecer", titulo: `${n} homologação(ões) aguardando o seu parecer`, sub: etapas.map(e => F.ETAPAS_PARECER[e].toLowerCase()).join(", "), href: `${BASE}?aba=homologacao`, prazo: null, quantidade: n });
    }
    if (confBanco || homol) {
      const ms = await sql<{ status: string; solicitante_user_id: number | null; conferencia_user_id: number | null; created_at: string }[]>`SELECT status, solicitante_user_id, conferencia_user_id, created_at::date::text AS created_at FROM supplier_bank_changes WHERE status IN ('AGUARDANDO_CONFERENCIA','AGUARDANDO_APROVACAO')`;
      const conf = confBanco ? ms.filter(m => m.status === "AGUARDANDO_CONFERENCIA" && m.solicitante_user_id !== s.id) : [];
      const apr = homol ? ms.filter(m => m.status === "AGUARDANDO_APROVACAO" && m.solicitante_user_id !== s.id && m.conferencia_user_id !== s.id) : [];
      if (conf.length) itens.push({ chave: "forn-banco-conf", grupo: "APROVAR", modulo: "Fornecedores", acao: "Conferir por canal conhecido", titulo: `${conf.length} alteração(ões) bancária(s) em quarentena`, sub: "ligue para um telefone que já estava no cadastro antes de confirmar", href: `${BASE}?aba=bancos`, prazo: conf.map(m => addDays(m.created_at, 2)).sort()[0], quantidade: conf.length });
      if (apr.length) itens.push({ chave: "forn-banco-aprov", grupo: "APROVAR", modulo: "Fornecedores", acao: "Aprovar troca de conta", titulo: `${apr.length} alteração(ões) bancária(s) conferida(s)`, sub: "terceira pessoa: nem quem pediu, nem quem conferiu", href: `${BASE}?aba=bancos`, prazo: apr.map(m => addDays(m.created_at, 3)).sort()[0], quantidade: apr.length });
    }
    if (cad) {
      const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM supplier_change_requests WHERE status='PENDENTE'`;
      if (n) itens.push({ chave: "forn-portal", grupo: "ATENDER", modulo: "Fornecedores", acao: "Revisar", titulo: `${n} atualização(ões) enviada(s) pelo portal do fornecedor`, sub: "nada vale antes da revisão campo a campo", href: `${BASE}?aba=portal`, prazo: null, quantidade: n });
    }
    if (etapas.includes("DOCUMENTAL")) {
      const [{ n, desde }] = await sql<{ n: number; desde: string | null }[]>`SELECT count(*)::int AS n, min(created_at)::date::text AS desde FROM supplier_documents WHERE status='ENVIADO'`;
      if (n) itens.push({ chave: "forn-docs-conferir", grupo: "ATENDER", modulo: "Fornecedores", acao: "Conferir documentos", titulo: `${n} documento(s) de fornecedor para conferir`, sub: "conferido ou recusado (com motivo, que o fornecedor vê no portal)", href: `${BASE}?aba=documentos`, prazo: desde ? addDays(desde, 3) : null, quantidade: n });
    }
    if (cad) {
      const cfg = await F.cfgForn(); const lista = (await F.carregarLista(cfg)).filter(l => !["INATIVO", "REJEITADO"].includes(l.status));
      const venc = lista.filter(l => l.checklist.some(c => c.exigivel && ["VENCIDO", "VENCENDO", "RECUSADO"].includes(c.situacao)));
      if (venc.length) { const datas = venc.flatMap(l => l.checklist.filter(c => c.exigivel && c.doc?.validade).map(c => c.doc!.validade!)).sort();
        itens.push({ chave: "forn-docs-renovar", grupo: "GESTAO", modulo: "Fornecedores", acao: "Pedir documento atualizado", titulo: `${venc.length} fornecedor(es) com documento vencido, vencendo ou recusado`, sub: "use o portal do fornecedor para receber a versão nova", href: `${BASE}?aba=documentos`, prazo: datas.find(d => d >= h) ?? datas[0] ?? null, quantidade: venc.length }); }
      const reval = lista.filter(l => l.status === "VENCIDO" || (["HOMOLOGADO", "CONDICIONAL"].includes(l.status) && l.revalidar_em && l.revalidar_em <= addDays(h, 30)));
      if (reval.length) itens.push({ chave: "forn-revalidar", grupo: "GESTAO", modulo: "Fornecedores", acao: "Revalidar", titulo: `${reval.length} fornecedor(es) para revalidar`, sub: "homologação vencida ou vencendo em 30 dias", href: `${BASE}?aba=homologacao`, prazo: reval.map(l => l.revalidar_em ?? h).sort()[0], quantidade: reval.length });
      const ocorr = await sql<{ n: number; prazo: string | null }[]>`SELECT count(*)::int AS n, min(prazo)::text AS prazo FROM supplier_occurrences WHERE status<>'FECHADA' AND prazo IS NOT NULL AND prazo <= ${addDays(h, 7)}`;
      if (ocorr[0]?.n) itens.push({ chave: "forn-ocorrencias", grupo: "GESTAO", modulo: "Fornecedores", acao: "Acompanhar plano de ação", titulo: `${ocorr[0].n} ocorrência(s) de fornecedor com prazo vencido ou na semana`, sub: "feche com o que foi feito, ou registre nova ocorrência", href: `${BASE}?aba=desempenho`, prazo: ocorr[0].prazo, quantidade: ocorr[0].n });
      const leg = lista.filter(l => l.status === "LEGADO").length;
      if (leg) itens.push({ chave: "forn-legados", grupo: "GESTAO", modulo: "Fornecedores", acao: "Revisar e homologar", titulo: `${leg} cadastro(s) anterior(es) à v33 para revisar`, sub: cfg.legadoAte ? `valem para novos lançamentos até ${F.dataBR(cfg.legadoAte)}` : "complete e envie para homologação", href: `${BASE}?aba=lista&status=LEGADO`, prazo: cfg.legadoAte || null, quantidade: leg });
    }
  } catch (e) { falhas.push(`fornecedores: ${e instanceof Error ? e.message : String(e)}`); }
  return { itens, falhas };
}
