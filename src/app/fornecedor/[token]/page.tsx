import type { Metadata } from "next";
import { sql } from "@/db";
import { getSettings, hoje } from "@/lib/utils";
import { textoErro } from "@/lib/aviso";
import * as F from "@/lib/fornecedores";
import { contextoFornecedor, podePortal } from "@/lib/portal-fornecedor";
import { atualizarCadastroPortal, proporContaPortal, enviarDocumentoPortal } from "../actions";
import { Btn } from "@/components/Btn";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Portal do fornecedor · Colégio Status", robots: { index: false, follow: false } };
const inp = "w-full rounded-md border border-line bg-white px-3 py-2.5 text-base text-ink focus:border-acao focus:outline-none focus:ring-1 focus:ring-acao sm:text-sm";
const OK: Record<string, string> = { cadastro: "Recebemos sua atualização. Ela vale depois da revisão da escola.", banco: "Recebemos os dados bancários. Antes de valer, a escola confirma por telefone com um contato que já conhece — e duas pessoas aprovam. Até lá, os pagamentos seguem na conta anterior.", documento: "Documento recebido. A escola confere e, se precisar de outro arquivo, o motivo aparece aqui." };
const SIT: Record<string, [string, string]> = { OK: ["text-ok", "em dia"], VENCENDO: ["text-aviso", "vence em breve — envie o atualizado"], VENCIDO: ["text-erro", "vencido — envie o atualizado"], ENVIADO: ["text-slate-600", "recebido, em conferência"], RECUSADO: ["text-erro", "recusado — envie outro"], FALTANDO: ["text-aviso", "falta enviar"] };

function Rotulo({ t, children }: { t: string; children: React.ReactNode }) { return <label className="block text-sm"><span className="mb-1 block font-medium text-slate-700">{t}</span>{children}</label>; }

/** UX-SUP-11 · Portal do fornecedor: atualiza contatos, endereço, conta bancária e documentos — sempre como proposta revisada pela escola. */
export default async function PortalFornecedor({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { token } = await params; const sp = await searchParams;
  const Shell = ({ children }: { children: React.ReactNode }) => <main className="min-h-screen bg-mist px-3 py-6 sm:px-4 sm:py-8"><div className="mx-auto max-w-2xl rounded-lg border border-line bg-white p-4 shadow-sm sm:p-6"><div className="mb-4 border-b border-line pb-3 text-xs font-semibold uppercase tracking-wide text-navy">Colégio Status · Portal do fornecedor</div>{children}</div></main>;
  let c; try { c = await contextoFornecedor(token); } catch (e) { return <Shell><h1 className="text-xl font-semibold text-navy">Link indisponível</h1><p className="mt-2 text-sm text-slate-600">{e instanceof Error ? e.message : "Link inválido."}</p></Shell>; }
  const cfg = await F.cfgForn(); const g = await getSettings(); const h = hoje();
  const [estab, contatos, docs, emUso, aberta, pedidos] = await Promise.all([
    sql<{ razao_social: string; tipo_doc: string; documento: string; cep: string | null; logradouro: string | null; numero: string | null; complemento: string | null; bairro: string | null; cidade: string | null; uf: string | null }[]>`SELECT razao_social, tipo_doc, documento, cep, logradouro, numero, complemento, bairro, cidade, uf FROM supplier_establishments WHERE supplier_id=${c.supplierId} AND ativo ORDER BY matriz DESC, id LIMIT 1`,
    sql<{ finalidade: string; nome: string; cargo: string | null; email: string | null; telefone: string | null }[]>`SELECT DISTINCT ON (finalidade) finalidade, nome, cargo, email, telefone FROM supplier_contacts WHERE supplier_id=${c.supplierId} AND ativo ORDER BY finalidade, principal DESC, id`,
    sql<F.DocRow[]>`SELECT d.id, d.tipo, d.numero, d.emissao::text, d.validade::text, d.status, d.origem, d.enviado_por_nome, d.conferido_por_nome, d.conferido_em::text, d.motivo_recusa, d.created_at::text, NULL::int AS anexo_id, NULL::text AS obs FROM supplier_documents d WHERE d.supplier_id=${c.supplierId} AND d.status<>'SUBSTITUIDO'`,
    sql<{ banco_nome: string | null; agencia: string | null; conta: string | null; pix_tipo: string | null; pix_chave: string | null }[]>`SELECT banco_nome, agencia, conta, pix_tipo, pix_chave FROM supplier_bank_accounts WHERE supplier_id=${c.supplierId} AND status='EM_USO' LIMIT 1`,
    sql<{ created_at: string; status: string }[]>`SELECT created_at::text, status FROM supplier_bank_changes WHERE supplier_id=${c.supplierId} AND status IN ('AGUARDANDO_CONFERENCIA','AGUARDANDO_APROVACAO') LIMIT 1`,
    sql<{ protocolo: string; status: string; created_at: string; motivo: string | null }[]>`SELECT protocolo, status, created_at::text, motivo FROM supplier_change_requests WHERE supplier_id=${c.supplierId} ORDER BY id DESC LIMIT 5`,
  ]);
  const e = estab[0]; const ck = F.checklist(F.documentosExigidos(cfg, c), docs, h, cfg.alertaDocumentosDias);
  const pend = ck.filter(x => x.exigivel && !["OK", "ENVIADO"].includes(x.situacao)); const ct = (fin: string) => contatos.find(x => x.finalidade === fin);
  const erro = textoErro(sp); const conta = emUso[0];
  return (
    <Shell>
      <h1 className="text-xl font-semibold text-navy">{e?.razao_social ?? c.nome}</h1>
      <p className="mt-1 text-sm text-slate-600">{e ? `${e.tipo_doc === "CPF" ? "CPF" : e.tipo_doc === "CNPJ" ? "CNPJ" : "Documento"} ${F.fmtDocumento(e.tipo_doc, e.documento)} · ` : ""}Link pessoal válido até {F.dataBR(c.expira_em)} — não compartilhe.</p>
      {sp.ok && OK[sp.ok] && <p role="status" className="mt-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-ok">{OK[sp.ok]}{sp.ok === "cadastro" && sp.protocolo && /^FOR-\d{4}-\d{4}$/.test(sp.protocolo) ? ` Protocolo: ${sp.protocolo}.` : ""}</p>}
      {erro && <p role="alert" className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-erro">{erro}</p>}
      <p className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950"><b>Segurança:</b> o Colégio Status nunca pede troca de conta bancária por e-mail, WhatsApp ou telefone. Mudanças só por este portal ou por documento assinado — e sempre confirmadas por nós com um contato que já conhecemos.</p>

      {podePortal(c, "documentos") && <section className="mt-5"><h2 className="text-sm font-semibold text-navy">O que falta</h2>
        {pend.length ? <ul className="mt-2 space-y-1 text-sm">{pend.map(x => <li key={x.tipo} className="flex flex-wrap justify-between gap-2 rounded border border-line px-3 py-2"><span>{x.tipo}</span><span className={`text-xs ${SIT[x.situacao][0]}`}>{SIT[x.situacao][1]}{x.doc?.motivo_recusa ? `: ${x.doc.motivo_recusa}` : ""}</span></li>)}</ul> : <p className="mt-2 text-sm text-ok">Nenhuma pendência de documentos no momento.</p>}
      </section>}

      {podePortal(c, "contatos") && <section className="mt-6"><h2 className="text-sm font-semibold text-navy">Endereço e contatos</h2>
        <p className="mt-1 text-xs text-slate-600">Altere só o que mudou. A escola revisa antes de valer.</p>
        <form action={atualizarCadastroPortal} className="mt-2 space-y-3"><input type="hidden" name="token" value={token} />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-6">
            <div className="sm:col-span-2"><Rotulo t="CEP"><input name="cep" defaultValue={e?.cep ?? ""} inputMode="numeric" className={inp} /></Rotulo></div>
            <div className="sm:col-span-4"><Rotulo t="Logradouro"><input name="logradouro" defaultValue={e?.logradouro ?? ""} className={inp} /></Rotulo></div>
            <div className="sm:col-span-2"><Rotulo t="Número"><input name="numero" defaultValue={e?.numero ?? ""} className={inp} /></Rotulo></div>
            <div className="sm:col-span-4"><Rotulo t="Complemento"><input name="complemento" defaultValue={e?.complemento ?? ""} className={inp} /></Rotulo></div>
            <div className="sm:col-span-3"><Rotulo t="Bairro"><input name="bairro" defaultValue={e?.bairro ?? ""} className={inp} /></Rotulo></div>
            <div className="sm:col-span-2"><Rotulo t="Cidade"><input name="cidade" defaultValue={e?.cidade ?? ""} className={inp} /></Rotulo></div>
            <div><Rotulo t="UF"><input name="uf" defaultValue={e?.uf ?? ""} maxLength={2} className={inp} /></Rotulo></div>
          </div>
          {([["PRINCIPAL", "principal", "Contato principal"], ["FINANCEIRO", "financeiro", "Contato do financeiro (cobrança)"]] as const).map(([fin, pre, rot]) => { const x = ct(fin); return <fieldset key={fin} className="rounded border border-line p-3"><legend className="px-1 text-sm font-medium text-navy">{rot}</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><Rotulo t="Nome"><input name={`${pre}Nome`} defaultValue={x?.nome ?? ""} className={inp} /></Rotulo><Rotulo t="Cargo"><input name={`${pre}Cargo`} defaultValue={x?.cargo ?? ""} className={inp} /></Rotulo><Rotulo t="E-mail"><input name={`${pre}Email`} type="email" defaultValue={x?.email ?? ""} className={inp} /></Rotulo><Rotulo t="Telefone com DDD"><input name={`${pre}Telefone`} defaultValue={x?.telefone ?? ""} inputMode="tel" className={inp} /></Rotulo></div></fieldset>; })}
          <Btn small>Enviar atualização</Btn>
        </form>
        {pedidos.length > 0 && <ul className="mt-3 space-y-1 text-xs text-slate-600">{pedidos.map(p => <li key={p.protocolo}>{p.protocolo} · {F.dataBR(p.created_at)} · {p.status === "PENDENTE" ? "em revisão" : p.status === "RECUSADA" ? `não aplicado${p.motivo ? `: ${p.motivo}` : ""}` : p.status === "PARCIAL" ? "aplicado em parte" : "aplicado"}</li>)}</ul>}
      </section>}

      {podePortal(c, "banco") && <section className="mt-6"><h2 className="text-sm font-semibold text-navy">Dados bancários</h2>
        <p className="mt-1 text-sm">{conta ? <>Conta em uso: {conta.banco_nome ? `${conta.banco_nome} · ag ${conta.agencia} · conta ${F.mascararConta(conta.conta)}` : ""}{conta.pix_chave ? ` · Pix ${F.mascararPix(conta.pix_tipo, conta.pix_chave)}` : ""}</> : "Nenhuma conta cadastrada."}</p>
        {aberta[0] ? <p className="mt-2 rounded border border-sky-200 bg-sky-50 px-3 py-2 text-sm">Alteração enviada em {F.dataBR(aberta[0].created_at)}: {aberta[0].status === "AGUARDANDO_CONFERENCIA" ? "aguardando nossa ligação de confirmação" : "confirmada, aguardando aprovação"}. {conta ? "Até concluir, vale a conta anterior." : "A conta só passa a valer depois disso."}</p> :
          <form action={proporContaPortal} className="mt-2 space-y-2"><input type="hidden" name="token" value={token} />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Rotulo t="Banco"><select name="bancoCodigo" defaultValue="" className={inp}><option value="">— (só Pix)</option>{F.BANCOS.map(([cod, n]) => <option key={cod} value={cod}>{cod} {n}</option>)}</select></Rotulo>
              <Rotulo t="Tipo de conta"><select name="tipoConta" className={inp}>{Object.entries(F.TIPOS_CONTA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Rotulo>
              <Rotulo t="Agência"><input name="agencia" inputMode="numeric" className={inp} /></Rotulo><Rotulo t="Conta com dígito"><input name="conta" className={inp} /></Rotulo>
              <Rotulo t="Titular"><input name="titularNome" defaultValue={e?.razao_social ?? ""} required className={inp} /></Rotulo><Rotulo t="CNPJ/CPF do titular"><input name="titularDoc" defaultValue={e && e.tipo_doc === "CNPJ" ? F.fmtCnpj(e.documento) : ""} required className={inp} /></Rotulo>
              <Rotulo t="Tipo da chave Pix"><select name="pixTipo" defaultValue="" className={inp}><option value="">—</option>{Object.entries(F.PIX_TIPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Rotulo><Rotulo t="Chave Pix"><input name="pixChave" className={inp} /></Rotulo>
            </div>
            <label className="flex items-start gap-2 text-xs"><input type="checkbox" name="terceiro" value="1" className="mt-0.5" /> A conta está em nome de outra pessoa ou empresa (explique abaixo)</label>
            <Rotulo t="Observação (opcional)"><input name="evidencia" maxLength={300} className={inp} placeholder="Ex.: mudamos de banco em novembro" /></Rotulo>
            <Btn small>Enviar dados bancários</Btn>
          </form>}
      </section>}

      {podePortal(c, "documentos") && <section className="mt-6"><h2 className="text-sm font-semibold text-navy">Enviar documento</h2>
        <form action={enviarDocumentoPortal} className="mt-2 space-y-2"><input type="hidden" name="token" value={token} />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Rotulo t="Documento"><select name="tipo" required defaultValue={pend[0]?.tipo ?? ""} className={inp}><option value="">— escolha —</option>{ck.filter(x => x.exigivel).map(x => <option key={x.tipo} value={x.tipo}>{x.tipo}</option>)}<option value="__outro">Outro</option></select></Rotulo>
            <Rotulo t="Se outro, qual"><input name="tipoOutro" className={inp} /></Rotulo>
            <Rotulo t="Número (se houver)"><input name="numero" className={inp} /></Rotulo><Rotulo t="Validade (se houver)"><input type="date" name="validade" min={h} className={inp} /></Rotulo>
          </div>
          <input type="file" name="arquivo" required accept=".pdf,.jpg,.jpeg,.png" className="block w-full text-xs" aria-label="Arquivo" />
          <p className="text-[11px] text-slate-500">PDF, JPG ou PNG, até {g.plataforma.anexoMaxMb} MB. Os arquivos ficam restritos à equipe que cuida de fornecedores.</p>
          <Btn small>Enviar documento</Btn>
        </form>
      </section>}

      <section className="mt-6 rounded border border-line bg-mist p-3 text-xs text-slate-600"><h2 className="font-semibold text-navy">Sobre seus dados</h2>
        <p className="mt-1">Usamos os dados de contato e os documentos só para o cadastro e os pagamentos da relação comercial com o Colégio Status. Dúvidas ou pedidos sobre dados pessoais: fale com seu contato na escola ou use o canal de privacidade do site.</p>
      </section>
    </Shell>
  );
}
