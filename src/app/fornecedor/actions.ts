"use server";
// v33 · Ações do portal do fornecedor (sem login, pelo link do convite). Tudo o que chega daqui é PROPOSTA: revisão interna,
// quarentena bancária ou conferência documental. Limites simples contra abuso; mensagens de erro assinadas (aviso.ts).
import { redirect } from "next/navigation";
import { createHash } from "crypto";
import { sql } from "@/db";
import { str, hoje, getSettings, auditComo } from "@/lib/utils";
import { erroAssinado } from "@/lib/aviso";
import * as F from "@/lib/fornecedores";
import { contextoFornecedor, podePortal, novoProtocoloFornecedor, avisarCompras, QUEM_PORTAL } from "@/lib/portal-fornecedor";

const volta = (token: string, q: string) => `/fornecedor/${encodeURIComponent(token)}${q}`;
const erroQ = (e: unknown) => {
  const m = e instanceof Error ? e.message : "";
  const amigavel = /duplicate key|unique/i.test(m) ? (m.includes("supplier_bank_change_aberta_uq") ? "Já há uma alteração de conta em conferência. Aguarde o contato da escola." : "Pedido repetido: confira o que já foi enviado.") : (m || "Não foi possível concluir. Tente de novo.");
  return `?${erroAssinado(amigavel)}`;
};
const ehRedirect = (e: unknown) => e instanceof Error && (e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT");
const limpo = (fd: FormData, k: string, max: number) => str(fd, k).replace(/\s+/g, " ").slice(0, max);
const ok = (c: boolean, m: string) => { if (!c) throw new Error(m); };

type Campo = { campo: string; rotulo: string; antes: string | null; depois: string | null; alvo: string };

/** Endereço e contatos: vira um pedido com protocolo, revisado campo a campo antes de valer. */
export async function atualizarCadastroPortal(fd: FormData) {
  const token = str(fd, "token"); let protocolo = "";
  try {
    const c = await contextoFornecedor(token, false); ok(podePortal(c, "contatos"), "Este convite não inclui contatos e endereço.");
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM supplier_change_requests WHERE supplier_id=${c.supplierId} AND status='PENDENTE'`; ok(n < 3, "Já há pedidos aguardando revisão da escola. Aguarde a análise antes de enviar outro.");
    const [e] = await sql<Record<string, string | null>[]>`SELECT cep, logradouro, numero, complemento, bairro, cidade, uf FROM supplier_establishments WHERE supplier_id=${c.supplierId} AND ativo ORDER BY matriz DESC, id LIMIT 1`;
    const contatos = await sql<{ finalidade: string; nome: string; email: string | null; telefone: string | null; cargo: string | null }[]>`SELECT DISTINCT ON (finalidade) finalidade, nome, email, telefone, cargo FROM supplier_contacts WHERE supplier_id=${c.supplierId} AND ativo ORDER BY finalidade, principal DESC, id`;
    const campos: Campo[] = [];
    const END: [string, string, number][] = [["cep", "CEP", 9], ["logradouro", "Logradouro", 160], ["numero", "Número", 20], ["complemento", "Complemento", 80], ["bairro", "Bairro", 80], ["cidade", "Cidade", 80], ["uf", "UF", 2]];
    for (const [k, r, max] of END) { let v = limpo(fd, k, max); if (k === "uf") v = v.toUpperCase(); if (k === "cep") { v = F.soDigitos(v); if (v) ok(v.length === 8, "CEP: 8 números."); v = v ? `${v.slice(0, 5)}-${v.slice(5)}` : ""; }
      const antes = e?.[k] ?? null; if (v && v !== (antes ?? "")) campos.push({ campo: k, rotulo: r, antes, depois: v, alvo: "estab" }); }
    for (const [fin, rot] of [["PRINCIPAL", "Contato principal"], ["FINANCEIRO", "Contato do financeiro (cobrança)"]] as const) {
      const atual = contatos.find(x => x.finalidade === fin); const pre = fin.toLowerCase();
      const v = { nome: limpo(fd, `${pre}Nome`, 120), cargo: limpo(fd, `${pre}Cargo`, 80), email: limpo(fd, `${pre}Email`, 160).toLowerCase(), telefone: limpo(fd, `${pre}Telefone`, 30) };
      if (v.email) ok(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email), `${rot}: e-mail inválido.`);
      if (v.telefone) ok(F.soDigitos(v.telefone).length >= 10 && F.soDigitos(v.telefone).length <= 13, `${rot}: telefone com DDD.`);
      for (const k of ["nome", "cargo", "email", "telefone"] as const) { const antes = atual?.[k] ?? null; if (v[k] && v[k] !== (antes ?? "")) campos.push({ campo: k, rotulo: `${rot} · ${k === "nome" ? "nome" : k === "cargo" ? "cargo" : k === "email" ? "e-mail" : "telefone"}`, antes, depois: v[k], alvo: `contato:${fin}` }); }
    }
    ok(campos.length > 0, "Nada mudou em relação ao cadastro atual.");
    // nome do contato antes dos demais campos do mesmo contato (a revisão cria o contato pelo nome)
    campos.sort((a, b) => (a.alvo === b.alvo ? (a.campo === "nome" ? -1 : b.campo === "nome" ? 1 : 0) : 0));
    for (let i = 0; i < 3; i++) {
      protocolo = await novoProtocoloFornecedor();
      try { await sql`INSERT INTO supplier_change_requests (supplier_id, invitation_id, origem, protocolo, campos) VALUES (${c.supplierId}, ${c.conviteId}, 'PORTAL', ${protocolo}, ${JSON.stringify(campos)}::jsonb)`; break; }
      catch (x) { if (i === 2 || !(x instanceof Error && /unique|duplicate/i.test(x.message))) throw x; }
    }
    await sql`UPDATE supplier_invitations SET envios=envios+1 WHERE id=${c.conviteId}`;
    await auditComo(QUEM_PORTAL, "alteração cadastral enviada pelo portal", "suppliers", c.supplierId, null, { protocolo, campos: campos.map(x => x.rotulo) });
    await avisarCompras("Atualização cadastral de fornecedor recebida pelo portal", "/operacoes/fornecedores?aba=portal", `forn-portal-alt:${protocolo}`);
  } catch (e) { if (ehRedirect(e)) throw e; redirect(volta(token, erroQ(e))); }
  redirect(volta(token, `?ok=cadastro&protocolo=${protocolo}`));
}

/** Conta bancária: entra em quarentena. Só passa a valer após conferência por telefone já cadastrado e aprovação interna. */
export async function proporContaPortal(fd: FormData) {
  const token = str(fd, "token");
  try {
    const c = await contextoFornecedor(token, false); ok(podePortal(c, "banco"), "Este convite não inclui dados bancários.");
    const conta = await F.validarConta(fd, c.supplierId, `Enviado pelo próprio fornecedor no portal (convite de ${c.criado_por_nome ?? "—"}${c.email ? `, para ${c.email}` : ""})`);
    const { evid, ...dados } = conta;
    const [emUso] = await sql`SELECT 1 FROM supplier_bank_accounts WHERE supplier_id=${c.supplierId} AND status='EM_USO'`;
    await sql.begin(async tx => {
      const [a] = await tx<{ id: number }[]>`INSERT INTO supplier_bank_accounts ${tx({ supplier_id: c.supplierId, ...dados, status: "PROPOSTA", criado_por_nome: QUEM_PORTAL })} RETURNING id`;
      await tx`INSERT INTO supplier_bank_changes ${tx({ supplier_id: c.supplierId, account_id: a.id, origem: "PORTAL", solicitante_user_id: null, solicitante_nome: QUEM_PORTAL, evidencia: evid, status: "AGUARDANDO_CONFERENCIA" })}`;
      await tx`UPDATE supplier_invitations SET envios=envios+1 WHERE id=${c.conviteId}`;
    });
    await auditComo(QUEM_PORTAL, "alteração bancária solicitada pelo portal", "suppliers", c.supplierId, null, { banco: dados.banco_nome, agencia: dados.agencia, conta: F.mascararConta(dados.conta), pix: F.mascararPix(dados.pix_tipo, dados.pix_chave), terceiro: dados.terceiro, conta_anterior: !!emUso });
    await avisarCompras("Alteração bancária de fornecedor (portal) aguardando conferência", "/operacoes/fornecedores?aba=bancos", `forn-portal-banco:${c.supplierId}:${hoje()}`);
  } catch (e) { if (ehRedirect(e)) throw e; redirect(volta(token, erroQ(e))); }
  redirect(volta(token, "?ok=banco"));
}

/** Documento de habilitação: chega para conferência (o mesmo arquivo não entra duas vezes). */
export async function enviarDocumentoPortal(fd: FormData) {
  const token = str(fd, "token");
  try {
    const c = await contextoFornecedor(token, false); ok(podePortal(c, "documentos"), "Este convite não inclui documentos.");
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM supplier_documents WHERE supplier_id=${c.supplierId} AND origem='PORTAL' AND created_at > now() - interval '1 day'`; ok(n < 20, "Limite de envios do dia atingido. Tente amanhã ou fale com seu contato na escola.");
    const cfg = await F.cfgForn(); const exigidos = F.documentosExigidos(cfg, c);
    const tipoSel = str(fd, "tipo"); const tipo = tipoSel === "__outro" ? limpo(fd, "tipoOutro", 120) : tipoSel; ok(tipo.length >= 3, "Escolha o tipo do documento."); ok(tipoSel === "__outro" || exigidos.includes(tipo), "Tipo de documento inválido.");
    const validade = str(fd, "validade") || null; if (validade) { ok(/^\d{4}-\d{2}-\d{2}$/.test(validade), "Data de validade inválida."); ok(validade >= hoje(), "Documento vencido: envie a versão atualizada."); }
    const emissao = str(fd, "emissao") || null; if (emissao) { ok(/^\d{4}-\d{2}-\d{2}$/.test(emissao), "Data de emissão inválida."); ok(emissao <= hoje(), "Emissão no futuro."); }
    const g = await getSettings(); const arq = fd.get("arquivo"); ok(!!arq && typeof arq === "object" && "arrayBuffer" in arq && (arq as File).size > 0, "Escolha o arquivo (PDF, JPG ou PNG).");
    const a = arq as File; ok(a.size <= g.plataforma.anexoMaxMb * 1048576, `Arquivo acima de ${g.plataforma.anexoMaxMb} MB.`); const mime = a.type || "application/octet-stream"; ok(["application/pdf", "image/jpeg", "image/png"].includes(mime), "Envie PDF, JPG ou PNG.");
    const buf = Buffer.from(await a.arrayBuffer()); const hash = createHash("sha256").update(buf).digest("hex"); const nome = a.name.replace(/[^\w.\-() áéíóúâêôãõçÁÉÍÓÚÂÊÔÃÕÇ]/g, "_").slice(0, 120);
    const [rep] = await sql`SELECT 1 FROM supplier_documents WHERE supplier_id=${c.supplierId} AND hash=${hash} AND status<>'RECUSADO'`; ok(!rep, "Este mesmo arquivo já foi enviado.");
    const docId = await sql.begin(async tx => {
      const [d] = await tx<{ id: number }[]>`INSERT INTO supplier_documents (supplier_id, tipo, numero, emissao, validade, status, origem, hash, enviado_por_user_id, enviado_por_nome) VALUES (${c.supplierId}, ${tipo}, ${limpo(fd, "numero", 60) || null}, ${emissao}, ${validade}, 'ENVIADO', 'PORTAL', ${hash}, NULL, ${QUEM_PORTAL}) RETURNING id`;
      await tx`INSERT INTO attachments (entidade, entidade_id, nome, mime, tamanho, dados, descricao, unit_id, user_id, user_nome) VALUES ('supplier_document', ${d.id}, ${nome}, ${mime}, ${a.size}, ${buf}, ${tipo}, NULL, NULL, ${QUEM_PORTAL})`;
      await tx`UPDATE supplier_invitations SET envios=envios+1 WHERE id=${c.conviteId}`;
      return d.id;
    });
    await auditComo(QUEM_PORTAL, "documento enviado pelo portal", "suppliers", c.supplierId, null, { documento: docId, tipo, validade, hash: hash.slice(0, 12) });
    await avisarCompras("Documento de fornecedor recebido pelo portal para conferir", "/operacoes/fornecedores?aba=documentos", `forn-portal-doc:${c.supplierId}:${hoje()}`);
  } catch (e) { if (ehRedirect(e)) throw e; redirect(volta(token, erroQ(e))); }
  redirect(volta(token, "?ok=documento"));
}
