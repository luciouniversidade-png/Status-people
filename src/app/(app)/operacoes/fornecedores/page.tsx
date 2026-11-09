import Link from "@/components/Link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Table, Td, Badge, Flash, Field, Btn, Input, Select, Textarea, Stat } from "@/components/ui";
import { hoje, addDays, fmtDataHora, audit } from "@/lib/utils";
import * as F from "@/lib/fornecedores";
import { conferirDocumento, conferirConta, aprovarConta, previaImportacao, confirmarImportacao } from "./actions";

export const dynamic = "force-dynamic";
const ABAS: [string, string][] = [["painel", "Painel"], ["lista", "Lista"], ["homologacao", "Homologação"], ["documentos", "Documentos"], ["bancos", "Dados bancários"], ["portal", "Portal"], ["desempenho", "Desempenho"], ["importar", "Importar"]];
const pct = (v: number) => `${v.toFixed(1).replace(".", ",")}%`;
const mediana = (xs: number[]) => { if (!xs.length) return null; const a = [...xs].sort((x, y) => x - y); const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const dias = (de: string) => Math.max(0, Math.round((Date.now() - new Date(de).getTime()) / 86400000));

/** v33 · Fornecedores: painel (UX-SUP-01) com a fila de trabalho, lista (UX-SUP-02), filas de homologação, documentos, bancos e portal, desempenho e importação. */
export default async function Fornecedores({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); if (!F.veFornecedores(s)) { await audit(s, "acesso negado: fornecedores", "suppliers", null, null, { papel: s.role }); redirect("/sem-acesso?t=%2Foperacoes%2Ffornecedores"); } const sp = await searchParams; const aba = ABAS.some(([k]) => k === sp.aba) ? sp.aba! : "painel";
  const cfg = await F.cfgForn(); const h = hoje(); const todos = await F.carregarLista(cfg); const fin = F.podeVerFinanceiro(s); const cad = F.podeCadastrar(s);
  const [units, casos, docsEnviados, mudancas, convites, alteracoes, decisoes, reviews, chamados] = await Promise.all([
    sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ORDER BY nome`,
    sql<{ id: number; supplier_id: number; tipo: string; fase: string; criticidade: string; submetido_nome: string | null; submetido_em: string }[]>`SELECT id, supplier_id, tipo, fase, criticidade, submetido_nome, submetido_em::text FROM supplier_homologations WHERE fase IN ('ANALISE','APROVACAO') ORDER BY submetido_em`,
    sql<{ id: number; supplier_id: number; tipo: string; validade: string | null; enviado_por_nome: string | null; origem: string; created_at: string; anexo: number | null }[]>`SELECT d.id, d.supplier_id, d.tipo, d.validade::text, d.enviado_por_nome, d.origem, d.created_at::text, (SELECT a.id FROM attachments a WHERE a.entidade='supplier_document' AND a.entidade_id=d.id ORDER BY a.id DESC LIMIT 1) AS anexo FROM supplier_documents d WHERE d.status='ENVIADO' ORDER BY d.created_at`,
    sql<{ id: number; supplier_id: number; status: string; origem: string; solicitante_nome: string; solicitante_user_id: number | null; conferencia_user_id: number | null; conferencia_nome: string | null; conferencia_canal: string | null; created_at: string; banco_nome: string | null; agencia: string | null; conta: string | null; pix_tipo: string | null; pix_chave: string | null; titular_nome: string | null; terceiro: boolean; motivo: string | null; aprovacao_nome: string | null }[]>`
      SELECT c.id, c.supplier_id, c.status, c.origem, c.solicitante_nome, c.solicitante_user_id, c.conferencia_user_id, c.conferencia_nome, c.conferencia_canal, c.created_at::text, a.banco_nome, a.agencia, a.conta, a.pix_tipo, a.pix_chave, a.titular_nome, a.terceiro, c.motivo, c.aprovacao_nome
      FROM supplier_bank_changes c JOIN supplier_bank_accounts a ON a.id=c.account_id WHERE c.status IN ('AGUARDANDO_CONFERENCIA','AGUARDANDO_APROVACAO') OR c.created_at >= ${addDays(h, -365)} ORDER BY (c.status IN ('AGUARDANDO_CONFERENCIA','AGUARDANDO_APROVACAO')) DESC, c.created_at DESC LIMIT 60`,
    sql<{ supplier_id: number; email: string | null; expira_em: string; envios: number; aberto_em: string | null; criado_por_nome: string | null }[]>`SELECT supplier_id, email, expira_em::text, envios, aberto_em::text, criado_por_nome FROM supplier_invitations WHERE estado='ATIVO' ORDER BY expira_em`,
    sql<{ id: number; supplier_id: number; protocolo: string; created_at: string; campos: unknown[] }[]>`SELECT id, supplier_id, protocolo, created_at::text, campos FROM supplier_change_requests WHERE status='PENDENTE' ORDER BY created_at`,
    sql<{ supplier_id: number; decisao: string; decidido_nome: string | null; decidido_em: string; submetido_em: string; tipo: string }[]>`SELECT supplier_id, decisao, decidido_nome, decidido_em::text, submetido_em::text, tipo FROM supplier_homologations WHERE fase='DECIDIDO' ORDER BY decidido_em DESC LIMIT 40`,
    sql<{ homologation_id: number; etapa: string; resultado: string }[]>`SELECT DISTINCT ON (homologation_id, etapa) homologation_id, etapa, resultado FROM supplier_reviews ORDER BY homologation_id, etapa, created_at DESC, id DESC`,
    sql<{ supplier_id: number; n: number; media: number | null; custo: number }[]>`SELECT supplier_id, count(*)::int AS n, round(avg(avaliacao)::numeric, 1)::float AS media, coalesce(sum(custo_real), 0)::float AS custo FROM work_orders WHERE supplier_id IS NOT NULL AND created_at >= ${addDays(h, -365)} GROUP BY supplier_id`,
  ]);
  const porId = new Map(todos.map(f => [f.id, f])); const nome = (id: number) => porId.get(id)?.nome ?? `nº ${id}`;
  const ativos = todos.filter(f => !["INATIVO", "REJEITADO"].includes(f.status)); const homologados = todos.filter(f => ["HOMOLOGADO", "CONDICIONAL"].includes(f.status));
  const vencidos = ativos.flatMap(f => f.checklist.filter(c => c.exigivel && c.situacao === "VENCIDO").map(c => ({ f, c }))); const vencendo = ativos.flatMap(f => f.checklist.filter(c => c.exigivel && c.situacao === "VENCENDO").map(c => ({ f, c })));
  const exigiveis = ativos.reduce((a, f) => a + f.checklist.filter(c => c.exigivel && c.situacao !== "FALTANDO").length, 0);
  const tempos = decisoes.filter(d => d.decidido_em >= addDays(h, -180)).map(d => (new Date(d.decidido_em).getTime() - new Date(d.submetido_em).getTime()) / 86400000);
  const total12 = todos.reduce((a, f) => a + f.gasto12m, 0); const top5 = [...todos].sort((a, b) => b.gasto12m - a.gasto12m).filter(f => f.gasto12m > 0).slice(0, 5); const conc5 = total12 ? (top5.reduce((a, f) => a + f.gasto12m, 0) / total12) * 100 : 0;
  const alto = ativos.filter(f => F.riscoExibido(f) === "ALTO"); const legados = todos.filter(f => f.status === "LEGADO"); const semCont = ativos.filter(f => f.criticidade === "ALTA" && !(f.contingencia ?? "").trim());
  const abertasBanco = mudancas.filter(m => ["AGUARDANDO_CONFERENCIA", "AGUARDANDO_APROVACAO"].includes(m.status)); const contestadas = mudancas.filter(m => m.status === "RECUSADA").length; const concluidas = mudancas.filter(m => ["APROVADA", "RECUSADA"].includes(m.status)).length;
  const revalidar = homologados.filter(f => f.revalidar_em && f.revalidar_em <= addDays(h, 30));
  const compMedia = ativos.length ? Math.round(ativos.reduce((a, f) => a + f.completude.pct, 0) / ativos.length) : 0;
  // possíveis duplicidades (sugestão — quem decide é uma pessoa): mesmo CNPJ raiz em mestres diferentes ou nomes muito parecidos
  const dup: [F.LinhaForn, F.LinhaForn, string][] = []; const lim = ativos.slice(0, 600);
  for (let i = 0; i < lim.length; i++) for (let j = i + 1; j < lim.length; j++) { const a = lim[i], b = lim[j];
    if (a.tipo_doc === "CNPJ" && b.tipo_doc === "CNPJ" && a.documento && b.documento && a.documento.slice(0, 8) === b.documento.slice(0, 8)) dup.push([a, b, "mesmo CNPJ raiz"]);
    else if (F.semelhanca(a.razao_social ?? a.nome, b.razao_social ?? b.nome) >= 0.82) dup.push([a, b, "nomes muito parecidos"]); }

  // filtros da lista
  const q = (sp.q ?? "").trim(); const qd = F.soDigitos(q); const fCat = sp.categoria ?? ""; const fSt = sp.status ?? ""; const fRisco = sp.risco ?? ""; const fUn = Number(sp.unidade) || 0;
  const lista = todos.filter(f => (!q || F.nomeNormalizado(`${f.nome} ${f.razao_social ?? ""}`).includes(F.nomeNormalizado(q)) || (qd.length >= 4 && (f.documento ?? "").includes(qd)))
    && (!fCat || f.categoria === fCat) && (!fSt || f.status === fSt) && (!fRisco || F.riscoExibido(f) === fRisco) && (!fUn || f.abrangencia === "REDE" || f.unidades.includes(fUn)));
  const [imp] = aba === "importar" ? await sql<{ value: { em: string; linhas: { n: number; tipoDoc: string; documento: string; razao: string; categoria: string; situacao: string; erro: string }[] } }[]>`SELECT value FROM settings WHERE key=${`forn_import_${s.id}`}` : [];
  const doc = (f: F.LinhaForn) => f.documento && f.tipo_doc ? F.fmtDocumento(f.tipo_doc, f.documento) : "sem documento";
  const nomeLink = (f: F.LinhaForn) => <Link href={`/operacoes/fornecedores/${f.id}`} className="font-medium text-acao hover:underline">{f.nome}</Link>;

  return (
    <Page title="Fornecedores" sub="Cadastro, homologação e gestão: quem pode fornecer para cada unidade, com documentos em dia, dados bancários conferidos por duas pessoas e desempenho medido. Cadastro não é homologação — e nada aqui altera um título ou um pagamento."
      actions={<div className="flex flex-wrap gap-2">{cad && <Btn href="/operacoes/fornecedores/novo">Novo fornecedor</Btn>}<Btn kind="ghost" href="/api/export/fornecedores">Exportar (CSV)</Btn></div>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <nav className="mb-4 flex flex-wrap gap-2 text-sm">{ABAS.map(([k, r]) => <Link key={k} href={`/operacoes/fornecedores?aba=${k}`} className={`rounded-md border px-3 py-1.5 ${aba === k ? "border-acao bg-sky-50 font-medium text-navy" : "border-line bg-white text-slate-700 hover:bg-mist"}`}>{r}{k === "homologacao" && casos.length ? ` (${casos.length})` : k === "bancos" && abertasBanco.length ? ` (${abertasBanco.length})` : k === "documentos" && docsEnviados.length ? ` (${docsEnviados.length})` : k === "portal" && alteracoes.length ? ` (${alteracoes.length})` : ""}</Link>)}</nav>

      {aba === "painel" && <>
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Homologados" value={`${homologados.length} de ${ativos.length}`} hint={`${todos.filter(f => f.status === "CONDICIONAL").length} com restrição · ${todos.filter(f => f.status === "SUSPENSO").length} suspenso(s)`} href="/operacoes/fornecedores?aba=lista&status=HOMOLOGADO" />
          <Stat label="Em homologação" value={casos.length} hint={tempos.length ? `mediana de ${String(Math.round((mediana(tempos) ?? 0) * 10) / 10).replace(".", ",")} dia(s) do envio à decisão` : "sem decisões nos últimos 6 meses"} href="/operacoes/fornecedores?aba=homologacao" />
          <Stat label="Documentos exigíveis" value={<span className={vencidos.length ? "text-erro" : "text-ok"}>{vencidos.length} vencido(s)</span>} hint={`${vencendo.length} vencem em ${cfg.alertaDocumentosDias} dias · ${exigiveis ? pct((vencidos.length / exigiveis) * 100) : "0%"} dos ativos`} href="/operacoes/fornecedores?aba=documentos" />
          <Stat label="Dados bancários" value={abertasBanco.length} hint={`em quarentena · ${contestadas} de ${concluidas} recusada(s) em 12 meses`} href="/operacoes/fornecedores?aba=bancos" />
          <Stat label="Risco alto" value={<span className={alto.length ? "text-erro" : "text-ok"}>{alto.length}</span>} hint={`${semCont.length} crítico(s) sem contingência`} href="/operacoes/fornecedores?aba=lista&risco=ALTO" />
          <Stat label="Completude média" value={`${compMedia}%`} hint="campos exigidos pela política vigente" href="/operacoes/fornecedores?aba=lista" />
          <Stat label="Concentração" value={fin ? pct(conc5) : "—"} hint={fin ? "5 maiores sobre a despesa líquida de 12 meses" : "restrito ao financeiro"} />
          <Stat label="Cadastros anteriores" value={legados.length} hint={legados.length ? `revisar até ${F.dataBR(cfg.legadoAte)}` : "nenhum a revisar"} href="/operacoes/fornecedores?aba=lista&status=LEGADO" />
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title="Fila de trabalho">
            <ul className="divide-y divide-line text-sm">
              {[[casos.filter(c => c.fase === "APROVACAO").length, "homologação(ões) prontas para a decisão", "/operacoes/fornecedores?aba=homologacao"], [casos.filter(c => c.fase === "ANALISE").length, "homologação(ões) aguardando pareceres", "/operacoes/fornecedores?aba=homologacao"],
                [abertasBanco.filter(m => m.status === "AGUARDANDO_CONFERENCIA").length, "conta(s) aguardando conferência por canal conhecido", "/operacoes/fornecedores?aba=bancos"], [abertasBanco.filter(m => m.status === "AGUARDANDO_APROVACAO").length, "conta(s) aguardando aprovação", "/operacoes/fornecedores?aba=bancos"],
                [docsEnviados.length, "documento(s) a conferir", "/operacoes/fornecedores?aba=documentos"], [vencidos.length + vencendo.length, "documento(s) vencido(s) ou vencendo", "/operacoes/fornecedores?aba=documentos"],
                [alteracoes.length, "alteração(ões) recebida(s) pelo portal", "/operacoes/fornecedores?aba=portal"], [revalidar.length, "homologação(ões) a revalidar em 30 dias", "/operacoes/fornecedores?aba=lista&status=HOMOLOGADO"],
                [ativos.reduce((a, f) => a + f.ocorrenciasAbertas, 0), "ocorrência(s) em aberto", "/operacoes/fornecedores?aba=desempenho"], [legados.length, "cadastro(s) anterior(es) à v33 a revisar", "/operacoes/fornecedores?aba=lista&status=LEGADO"]]
                .map(([n, t, href]) => <li key={String(t)} className="flex items-center justify-between gap-2 py-1.5"><span><b className={Number(n) ? "text-navy" : "text-slate-400"}>{n}</b> <span className={Number(n) ? "" : "text-slate-400"}>{t}</span></span>{Number(n) ? <Link href={String(href)} className="shrink-0 text-xs text-acao hover:underline">abrir</Link> : null}</li>)}
            </ul>
          </Card>
          <div className="space-y-4">
            {fin && <Card title="Maiores fornecedores — despesa líquida de 12 meses">{top5.length ? <ul className="space-y-1.5 text-sm">{top5.map(f => <li key={f.id}><div className="flex justify-between gap-2"><span className="min-w-0 truncate">{nomeLink(f)}</span><span className="shrink-0 tabular-nums">{F.moeda(f.gasto12m)} · {pct(f.concentracaoPct)}</span></div><div className="mt-0.5 h-1.5 rounded bg-mist"><div className={`h-1.5 rounded ${f.concentracaoPct > cfg.concentracaoAlertaPct ? "bg-erro" : "bg-acao"}`} style={{ width: `${Math.min(100, f.concentracaoPct)}%` }} /></div></li>)}</ul> : <p className="text-sm text-slate-500">Sem pagamentos baixados a fornecedores do cadastro nos últimos 12 meses.</p>}<p className="mt-2 text-[11px] text-slate-500">Valor líquido efetivamente pago (com descontos), pelas baixas de contas a pagar. Acima de {cfg.concentracaoAlertaPct}% pesa no risco.</p></Card>}
            <Card title={`Possíveis duplicidades (${dup.length})`}>{dup.length ? <ul className="space-y-1 text-sm">{dup.slice(0, 8).map(([a, b, m], i) => <li key={i}>{nomeLink(a)} × {nomeLink(b)} <span className="text-xs text-slate-500">— {m}</span></li>)}</ul> : <p className="text-sm text-slate-500">Nenhuma suspeita: mesmo CNPJ raiz em fornecedores diferentes ou nomes muito parecidos aparecem aqui.</p>}<p className="mt-2 text-[11px] text-slate-500">É sugestão: o sistema nunca junta cadastros sozinho. Se for a mesma empresa, inclua a filial como estabelecimento do fornecedor certo e inative o outro.</p></Card>
          </div>
        </div>
      </>}

      {aba === "lista" && <Card title={`Fornecedores (${lista.length} de ${todos.length})`}>
        <form className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6 lg:items-end"><input type="hidden" name="aba" value="lista" />
          <Field label="Nome ou CNPJ" className="col-span-2"><Input name="q" defaultValue={q} placeholder="nome, razão social ou documento" /></Field>
          <Field label="Categoria"><Select name="categoria" defaultValue={fCat}><option value="">Todas</option>{cfg.categorias.map(([c]) => <option key={c} value={c}>{c}</option>)}</Select></Field>
          <Field label="Situação"><Select name="status" defaultValue={fSt}><option value="">Todas</option>{Object.entries(F.STATUS_FORN).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field label="Risco"><Select name="risco" defaultValue={fRisco}><option value="">Todos</option>{Object.entries(F.RISCO_ROTULO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field label="Unidade"><Select name="unidade" defaultValue={sp.unidade ?? ""}><option value="">Todas</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>
          <div className="col-span-2 sm:col-span-3 lg:col-span-6"><Btn small kind="ghost">Filtrar</Btn></div>
        </form>
        <Table head={["Fornecedor", "Categoria · criticidade", "Situação", "Risco", "Completude", "Documentos", ...(fin ? ["Despesa 12m"] : []), "Avaliação", "Responsável"]} empty="Nenhum fornecedor com esses filtros.">
          {lista.map(f => { const v = f.checklist.filter(c => c.exigivel && c.situacao === "VENCIDO").length; const vc = f.checklist.filter(c => c.exigivel && c.situacao === "VENCENDO").length; const fa = f.checklist.filter(c => c.exigivel && ["FALTANDO", "RECUSADO"].includes(c.situacao)).length;
            return <tr key={f.id} className={["INATIVO", "REJEITADO"].includes(f.status) ? "opacity-60" : ""}>
              <Td>{nomeLink(f)}<div className="text-[11px] text-slate-500">{f.razao_social && f.razao_social !== f.nome ? `${f.razao_social} · ` : ""}{doc(f)}{f.cidade ? ` · ${f.cidade}/${f.uf}` : ""}</div></Td>
              <Td className="text-xs">{f.categoria ?? "—"}<div className="text-slate-500">criticidade {F.CRITICIDADE[f.criticidade].toLowerCase()}</div></Td>
              <Td><Badge v={F.TOM_STATUS[f.status]} label={F.STATUS_FORN[f.status]} />{f.homologacaoAberta && <div className="mt-0.5 text-[11px] text-slate-500">{f.homologacaoAberta.fase === "APROVACAO" ? "pronta para decidir" : "em análise"}</div>}</Td>
              <Td><Badge v={F.TOM_RISCO[F.riscoExibido(f)]} label={F.RISCO_ROTULO[F.riscoExibido(f)]} /><div className="text-[11px] text-slate-500">{f.risco.pontos} ponto(s){f.risco_revisado ? " · revisado" : ""}</div></Td>
              <Td className="tabular-nums">{f.completude.pct}%</Td>
              <Td className="text-xs">{v ? <span className="text-erro">{v} vencido(s)</span> : null}{v && (vc || fa) ? <br /> : null}{vc ? <span className="text-aviso">{vc} vencendo</span> : null}{vc && fa ? <br /> : null}{fa ? <span className="text-slate-600">{fa} faltando</span> : null}{!v && !vc && !fa ? <span className="text-ok">em dia</span> : null}</Td>
              {fin && <Td className="tabular-nums text-xs">{f.gasto12m ? F.moeda(f.gasto12m) : "—"}</Td>}
              <Td className="tabular-nums text-xs">{f.ultimaNota !== null ? String(f.ultimaNota).replace(".", ",") : "—"}{f.ocorrenciasAbertas ? <div className="text-erro">{f.ocorrenciasAbertas} ocorrência(s)</div> : null}</Td>
              <Td className="text-xs">{f.responsavel ?? "—"}</Td>
            </tr>; })}
        </Table>
      </Card>}

      {aba === "homologacao" && <div className="space-y-4">
        <Card title={`Em andamento (${casos.length})`}>
          <Table head={["Fornecedor", "Tipo", "Criticidade", "Pareceres", "Fase", "Enviado"]} empty="Nenhuma homologação em andamento.">
            {casos.map(c => { const ex = F.pareceresExigidos(c.criticidade); const rv = reviews.filter(r => r.homologation_id === c.id); return <tr key={c.id}>
              <Td><Link href={`/operacoes/fornecedores/${c.supplier_id}?aba=homologacao`} className="font-medium text-acao hover:underline">{nome(c.supplier_id)}</Link></Td>
              <Td className="text-xs">{c.tipo === "INICIAL" ? "Inicial" : c.tipo === "REVALIDACAO" ? "Revalidação" : "Reativação"}</Td><Td className="text-xs">{F.CRITICIDADE[c.criticidade]}</Td>
              <Td className="text-xs">{ex.map(e => { const r = rv.find(x => x.etapa === e); return <div key={e}>{r ? (r.resultado === "DESFAVORAVEL" ? <span className="text-erro">✕</span> : r.resultado === "PENDENCIA" ? <span className="text-aviso">!</span> : <span className="text-ok">✓</span>) : <span className="text-slate-400">○</span>} {F.ETAPAS_PARECER[e]}</div>; })}</Td>
              <Td>{c.fase === "APROVACAO" ? <Badge v="VENCE_EM_BREVE" label="pronta para decidir" /> : <Badge v="ABERTO" label="em análise" />}</Td>
              <Td className="text-xs">{F.dataBR(c.submetido_em)} · {c.submetido_nome ?? "—"}<div className={dias(c.submetido_em) > 10 ? "text-erro" : "text-slate-500"}>há {dias(c.submetido_em)} dia(s)</div></Td>
            </tr>; })}
          </Table>
          <p className="mt-2 text-[11px] text-slate-500">Pareceres pela criticidade: baixa — documental; média — documental e financeiro; alta — documental, financeiro e técnico. Quem cadastrou ou enviou não dá parecer nem decide.</p>
        </Card>
        <Card title="Decisões recentes">
          <Table head={["Fornecedor", "Tipo", "Decisão", "Quem decidiu", "Do envio à decisão"]} empty="Nenhuma decisão ainda.">
            {decisoes.slice(0, 20).map((d, i) => <tr key={i}><Td><Link href={`/operacoes/fornecedores/${d.supplier_id}?aba=homologacao`} className="text-acao hover:underline">{nome(d.supplier_id)}</Link></Td><Td className="text-xs">{d.tipo === "INICIAL" ? "Inicial" : d.tipo === "REVALIDACAO" ? "Revalidação" : "Reativação"}</Td><Td><Badge v={F.TOM_STATUS[d.decisao]} label={F.STATUS_FORN[d.decisao]} /></Td><Td className="text-xs">{d.decidido_nome} · {fmtDataHora(d.decidido_em)}</Td><Td className="tabular-nums text-xs">{String(Math.round(((new Date(d.decidido_em).getTime() - new Date(d.submetido_em).getTime()) / 86400000) * 10) / 10).replace(".", ",")} dia(s)</Td></tr>)}
          </Table>
        </Card>
      </div>}

      {aba === "documentos" && <div className="space-y-4">
        <Card title={`A conferir (${docsEnviados.length})`}>
          <Table head={["Fornecedor", "Documento", "Validade", "Enviado", "Conferência"]} empty="Nada a conferir.">
            {docsEnviados.map(d => <tr key={d.id}>
              <Td><Link href={`/operacoes/fornecedores/${d.supplier_id}?aba=documentos`} className="font-medium text-acao hover:underline">{nome(d.supplier_id)}</Link></Td>
              <Td className="text-xs">{d.tipo}{d.anexo ? <> · <a href={`/api/anexos/${d.anexo}`} className="text-acao underline" target="_blank" rel="noreferrer">abrir</a></> : null}</Td>
              <Td className="text-xs">{F.dataBR(d.validade)}</Td><Td className="text-xs">{F.dataBR(d.created_at)} · {d.origem === "PORTAL" ? "portal do fornecedor" : d.enviado_por_nome}</Td>
              <Td>{F.podeParecer(s, "DOCUMENTAL") ? <form action={conferirDocumento} className="flex flex-wrap items-center gap-1.5"><input type="hidden" name="id" value={d.supplier_id} /><input type="hidden" name="docId" value={d.id} /><input type="hidden" name="voltar" value="lista" /><Select name="resultado" className="w-auto py-1 text-xs"><option value="CONFERIR">Conferido</option><option value="RECUSAR">Recusar</option></Select><Input name="motivo" placeholder="motivo (se recusar)" className="w-40 py-1 text-xs" /><Btn small kind="ghost">Registrar</Btn></form> : <span className="text-xs text-slate-500">Financeiro, Operações ou Direção</span>}</Td>
            </tr>)}
          </Table>
        </Card>
        <Card title={`Vencidos e vencendo em ${cfg.alertaDocumentosDias} dias (${vencidos.length + vencendo.length})`}>
          <Table head={["Fornecedor", "Documento exigível", "Validade", "Situação"]} empty="Todos os documentos exigíveis em dia.">
            {[...vencidos, ...vencendo].sort((a, b) => (a.c.doc?.validade ?? "").localeCompare(b.c.doc?.validade ?? "")).map(({ f, c }, i) => <tr key={i}><Td>{nomeLink(f)}<div className="text-[11px] text-slate-500">criticidade {F.CRITICIDADE[f.criticidade].toLowerCase()}</div></Td><Td className="text-xs">{c.tipo}</Td><Td className="text-xs">{F.dataBR(c.doc?.validade)}</Td><Td>{c.situacao === "VENCIDO" ? <Badge v="VENCIDO" label="vencido" /> : <Badge v="VENCE_EM_BREVE" label="vencendo" />}</Td></tr>)}
          </Table>
          <p className="mt-2 text-[11px] text-slate-500">Documento exigível vencido entra no risco; para criticidade alta, a rotina diária leva o fornecedor a “em revalidação” (novos lançamentos só com exceção). Peça o documento novo pelo portal do fornecedor.</p>
        </Card>
      </div>}

      {aba === "bancos" && <div className="space-y-4">
        <Card title={`Em quarentena (${abertasBanco.length})`}>
          <Table head={["Fornecedor", "Dados propostos", "Pedido", "Etapa"]} empty="Nenhuma alteração bancária em andamento.">
            {abertasBanco.map(m => { const proprio = m.solicitante_user_id === s.id; const conferiu = m.conferencia_user_id === s.id; return <tr key={m.id}>
              <Td><Link href={`/operacoes/fornecedores/${m.supplier_id}?aba=financeiro`} className="font-medium text-acao hover:underline">{nome(m.supplier_id)}</Link>{m.terceiro && <div><Badge v="REJEITADO" label="conta de terceiro" /></div>}</Td>
              <Td className="text-xs">{m.banco_nome ? `${m.banco_nome} · ag ${m.agencia} · cc ${F.mascararConta(m.conta)}` : "—"}{m.pix_chave ? <div>Pix {F.PIX_TIPOS[m.pix_tipo ?? ""] ?? ""}: {F.mascararPix(m.pix_tipo, m.pix_chave)}</div> : null}<div className="text-slate-500">titular: {m.titular_nome}</div></Td>
              <Td className="text-xs">{m.origem === "PORTAL" ? "portal do fornecedor" : m.solicitante_nome} · {F.dataBR(m.created_at)}{m.conferencia_nome && <div className="text-slate-600">conferida por {m.conferencia_nome}: {m.conferencia_canal}</div>}</Td>
              <Td>{m.status === "AGUARDANDO_CONFERENCIA"
                ? (F.podeConferirBanco(s) && !proprio ? <form action={conferirConta} className="space-y-1"><input type="hidden" name="id" value={m.supplier_id} /><input type="hidden" name="mudancaId" value={m.id} /><input type="hidden" name="voltar" value="lista" /><Input name="canal" placeholder="Como confirmou (telefone do cadastro, com quem falou)" className="py-1 text-xs" /><div className="flex gap-1.5"><Select name="resultado" className="w-auto py-1 text-xs"><option value="CONFIRMADA">Confirmada</option><option value="NAO_CONFIRMADA">Não confirmada</option></Select><Btn small kind="ghost">Conferir</Btn></div></form> : <span className="text-xs text-slate-500">aguardando conferência {proprio ? "de outra pessoa" : "do Financeiro ou da Direção"}</span>)
                : (F.podeAprovarBanco(s) && !proprio && !conferiu ? <form action={aprovarConta}><input type="hidden" name="id" value={m.supplier_id} /><input type="hidden" name="mudancaId" value={m.id} /><input type="hidden" name="voltar" value="lista" /><Btn small>Aprovar e colocar em uso</Btn></form> : <span className="text-xs text-slate-500">aguardando aprovação {proprio || conferiu ? "de uma terceira pessoa" : "da Direção ou de quem aprova contas a pagar"}</span>)}</Td>
            </tr>; })}
          </Table>
          <p className="mt-2 text-[11px] text-slate-500">Quarentena: a conta nova só entra em uso depois da conferência por um canal já conhecido (nunca o telefone ou e-mail que veio junto com o pedido) e da aprovação de uma terceira pessoa. A conta anterior continua valendo até lá; pagamentos já programados não mudam sozinhos.</p>
        </Card>
        <Card title="Concluídas nos últimos 12 meses">
          <Table head={["Fornecedor", "Resultado", "Pedido", "Conferência", "Aprovação ou motivo"]} empty="Nenhuma ainda.">
            {mudancas.filter(m => !["AGUARDANDO_CONFERENCIA", "AGUARDANDO_APROVACAO"].includes(m.status)).slice(0, 20).map(m => <tr key={m.id}><Td><Link href={`/operacoes/fornecedores/${m.supplier_id}?aba=financeiro`} className="text-acao hover:underline">{nome(m.supplier_id)}</Link></Td><Td><Badge v={m.status === "APROVADA" ? "ATIVO" : m.status === "RECUSADA" ? "REJEITADO" : "CANCELADO"} label={m.status.toLowerCase()} /></Td><Td className="text-xs">{m.origem === "PORTAL" ? "portal" : m.solicitante_nome} · {F.dataBR(m.created_at)}</Td><Td className="text-xs">{m.conferencia_nome ?? "—"}</Td><Td className="text-xs">{m.status === "APROVADA" ? m.aprovacao_nome : m.motivo}</Td></tr>)}
          </Table>
        </Card>
      </div>}

      {aba === "portal" && <div className="space-y-4">
        <Card title={`Alterações recebidas pelo portal (${alteracoes.length})`}>
          <Table head={["Fornecedor", "Protocolo", "Recebida", "Campos", ""]} empty="Nada aguardando revisão.">
            {alteracoes.map(a => <tr key={a.id}><Td>{nome(a.supplier_id)}</Td><Td className="text-xs">{a.protocolo}</Td><Td className="text-xs">{fmtDataHora(a.created_at)}</Td><Td className="text-xs">{a.campos.length}</Td><Td><Link href={`/operacoes/fornecedores/${a.supplier_id}?aba=portal`} className="text-xs text-acao hover:underline">revisar</Link></Td></tr>)}
          </Table>
          <p className="mt-2 text-[11px] text-slate-500">O fornecedor nunca se aprova: contatos e endereço só mudam quando alguém daqui aplica; conta bancária vai para a quarentena; documentos chegam para conferência.</p>
        </Card>
        <Card title={`Convites ativos (${convites.length})`}>
          <Table head={["Fornecedor", "Enviado para", "Vale até", "Envios", "Gerado por"]} empty="Nenhum convite ativo.">
            {convites.map((c, i) => <tr key={i}><Td><Link href={`/operacoes/fornecedores/${c.supplier_id}?aba=portal`} className="text-acao hover:underline">{nome(c.supplier_id)}</Link></Td><Td className="text-xs">{c.email ?? "—"}{c.aberto_em ? <div className="text-slate-500">aberto em {F.dataBR(c.aberto_em)}</div> : <div className="text-slate-500">ainda não aberto</div>}</Td><Td className="text-xs">{F.dataBR(c.expira_em)}</Td><Td className="tabular-nums text-xs">{c.envios}</Td><Td className="text-xs">{c.criado_por_nome}</Td></tr>)}
          </Table>
        </Card>
      </div>}

      {aba === "desempenho" && <Card title="Desempenho — última avaliação, ocorrências e chamados (12 meses)">
        <Table head={["Fornecedor", "Última nota", "Ocorrências abertas", "Chamados", "Avaliação dos chamados", ...(fin ? ["Custo dos chamados"] : []), "Risco"]} empty="Sem dados de desempenho.">
          {ativos.filter(f => f.ultimaNota !== null || f.ocorrenciasAbertas || chamados.some(c => c.supplier_id === f.id)).sort((a, b) => (a.ultimaNota ?? 11) - (b.ultimaNota ?? 11)).map(f => { const c = chamados.find(x => x.supplier_id === f.id); return <tr key={f.id}>
            <Td>{nomeLink(f)}<div className="text-[11px] text-slate-500">{f.categoria}</div></Td>
            <Td className="tabular-nums">{f.ultimaNota !== null ? <span className={f.ultimaNota < 6 ? "text-erro" : ""}>{String(f.ultimaNota).replace(".", ",")}</span> : "—"}{f.avaliadoEm && <div className="text-[11px] text-slate-500">{F.dataBR(f.avaliadoEm)}</div>}</Td>
            <Td className="tabular-nums">{f.ocorrenciasAbertas ? <span className="text-erro">{f.ocorrenciasAbertas}{f.ocorrenciasAlta ? ` (${f.ocorrenciasAlta} grave)` : ""}</span> : "0"}</Td>
            <Td className="tabular-nums">{c?.n ?? 0}</Td><Td className="tabular-nums">{c?.media !== null && c?.media !== undefined ? `${String(c.media).replace(".", ",")} / 5` : "—"}</Td>
            {fin && <Td className="tabular-nums text-xs">{c?.custo ? c.custo.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—"}</Td>}
            <Td><Badge v={F.TOM_RISCO[F.riscoExibido(f)]} label={F.RISCO_ROTULO[F.riscoExibido(f)]} /></Td></tr>; })}
        </Table>
        <p className="mt-2 text-[11px] text-slate-500">A nota (0 a 10) pondera qualidade {cfg.pesos.qualidade}%, pontualidade {cfg.pesos.pontualidade}%, atendimento {cfg.pesos.atendimento}%, custo {cfg.pesos.custo}% e conformidade {cfg.pesos.conformidade}%. Com menos de 3 eventos no período, a ficha avisa que a amostra é pequena — o menor preço não vence sozinho.</p>
      </Card>}

      {aba === "importar" && <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
        <Card title="Importar planilha de fornecedores (com prévia)">
          {cad ? <form action={previaImportacao} className="space-y-2">
            <Field label="Cole as linhas (com o cabeçalho), separadas por ; ou tabulação" hint="Colunas: documento (CNPJ ou CPF), razao_social, nome_fantasia, categoria, email, telefone, cidade, uf. Até 1.000 linhas por vez."><Textarea name="texto" className="min-h-[220px] font-mono text-xs" placeholder={"documento;razao_social;nome_fantasia;categoria;email;telefone;cidade;uf\n90.123.456/0001-31;Exemplo Serviços Ltda;Exemplo;Limpeza e conservação;contato@exemplo.com;(67) 3333-0000;Campo Grande;MS"} /></Field>
            <Btn small>Gerar prévia</Btn>
          </form> : <p className="text-sm text-slate-500">Importam: Direção, Financeiro, Operações e direção da unidade.</p>}
          <p className="mt-2 text-[11px] text-slate-500">Cada linha é conferida (dígito verificador, repetição no cadastro e na própria planilha). O que entra vira rascunho — não autoriza compras até a homologação. Documentos e dados bancários não vêm pela planilha: têm fluxo próprio.</p>
        </Card>
        {imp && <Card title={`Prévia de ${fmtDataHora(imp.value.em)}`} actions={<form action={confirmarImportacao}><Btn small>Confirmar e importar {imp.value.linhas.filter(l => l.situacao === "OK").length}</Btn></form>}>
          <Table denso head={["Linha", "Documento", "Razão social", "Categoria", "Situação"]}>
            {imp.value.linhas.slice(0, 300).map(l => <tr key={l.n}><Td className="tabular-nums text-xs">{l.n}</Td><Td className="text-xs">{l.situacao === "ERRO" ? (F.soDigitos(l.documento).length === 11 ? F.fmtCpfMascarado(F.soDigitos(l.documento)) : l.documento || "—") : F.fmtDocumento(l.tipoDoc, l.documento)}</Td><Td className="text-xs">{l.razao}</Td><Td className="text-xs">{l.categoria}</Td><Td className="text-xs">{l.situacao === "OK" ? <span className="text-ok">entra</span> : <span className="text-erro">{l.erro}</span>}</Td></tr>)}
          </Table>
        </Card>}
      </div>}
    </Page>
  );
}
