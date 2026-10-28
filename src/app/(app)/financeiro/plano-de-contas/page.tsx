import { redirect } from "next/navigation";
import Link from "@/components/Link";
import { requireSession } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Flash, Stat, Table, Td, Field, Select, Input, Textarea, Btn, Badge } from "@/components/ui";
import { BarraContexto } from "@/components/BarraContexto";
import { BarrasH, COR } from "@/components/graficos";
import { lerContexto } from "@/lib/contexto";
import { audit, getSettings, hoje, addDays, fmtData } from "@/lib/utils";
import { fmtCompacto } from "@/lib/formato";
import { listarContas, listarCentros, qualidadeClassificacao, usoDasContas, filaClassificacao, opcoesConta, vePlano, editaPlano } from "@/lib/plano-contas";
import { ehAnalitica, macrogrupo, ROTULO_ECONOMICO, ROTULO_COMPORTAMENTO, ROTULO_RECORRENCIA, ROTULO_CUSTO, ROTULO_INDICE, ROTULO_DRIVER, ROTULO_CENTRO_PADRAO, ROTULO_TIPO_CENTRO, type Conta } from "@/lib/plano-contas-calc";
import { salvarConta, salvarCentro, classificarSelecionados, aplicarAltaConfianca, salvarRegra, desativarRegra, aplicarRegras } from "./actions";

export const dynamic = "force-dynamic";
const brl = (v: number | null | undefined) => (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (v: number | null) => v === null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const ABAS: Record<string, string> = { plano: "Plano de contas", centros: "Centros de custo", classificacao: "Classificação", regras: "Regras" };
const TOM_CONF: Record<string, string> = { ALTA: "ATIVO", MEDIA: "ABERTO", BAIXA: "PENDENTE" };
const FONTE: Record<string, string> = { REGRA: "regra", HISTORICO: "histórico", PALAVRA: "palavra-chave", CATEGORIA: "categoria" };

/** v28 · Plano de contas gerencial, centros de custo e classificação dos lançamentos (catálogo de plano de contas, custos e orçamento). */
export default async function PlanoDeContas({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const sp = await searchParams;
  if (!vePlano(s)) { await audit(s, "acesso negado: plano de contas", "chart_accounts", null, null, { papel: s.role }); redirect("/financeiro"); }
  const cfg = await getSettings(); const edita = editaPlano(cfg, s); const ctx = await lerContexto(s, sp); const h = hoje();
  const aba = sp.aba && sp.aba in ABAS ? sp.aba : "plano"; const unitIds = ctx.unitIds;
  const [contas, centros, q, uso, regras, usuarios] = await Promise.all([listarContas(), listarCentros(), qualidadeClassificacao(unitIds, addDays(h, -365), h), usoDasContas(unitIds),
    sql<{ id: number; padrao: string; conta_id: number; cost_center_id: number | null; unit_id: number | null; usos: number; created_at: string; criador: string | null; unidade: string | null }[]>`SELECT r.id, r.padrao, r.conta_id, r.cost_center_id, r.unit_id, r.usos, r.created_at::text, u.nome AS criador, un.nome AS unidade FROM classification_rules r LEFT JOIN users u ON u.id=r.created_by LEFT JOIN units un ON un.id=r.unit_id WHERE r.ativo ORDER BY lower(r.padrao)`,
    sql<{ id: number; nome: string }[]>`SELECT id, nome FROM users WHERE ativo AND role IN ('DIRECAO','FINANCEIRO','DIRETOR_UNIDADE','RH','GESTOR') ORDER BY nome`]);
  const porId = new Map(contas.map(c => [c.id, c])); const cc = new Map(centros.map(c => [c.id, c]));
  const nAnaliticas = contas.filter(c => c.ativo && ehAnalitica(c, contas)).length;
  const qs = (o: Record<string, string | null | undefined>) => { const u = new URLSearchParams(); for (const [a, b] of Object.entries({ aba, ...o })) if (b) u.set(a, b); return `/financeiro/plano-de-contas?${u.toString()}`; };
  // uso somado subindo a árvore (grupos mostram o total do que está debaixo)
  const usoV = new Map<number, number>(); const usoN = new Map<number, number>();
  for (const [id, x] of uso.caixa) { let c = porId.get(id); let g = 0; while (c && g++ < 6) { usoV.set(c.id, (usoV.get(c.id) ?? 0) + x.v); usoN.set(c.id, (usoN.get(c.id) ?? 0) + x.n); c = c.pai_id !== null ? porId.get(c.pai_id) : undefined; } }
  const opSaida = opcoesConta(contas, "SAIDA"), opEntrada = opcoesConta(contas, "ENTRADA");
  const categorias = [...(cfg.financeiro.categoriasSaida as string[]), ...(cfg.financeiro.categoriasEntrada as string[]), ...(cfg.dre.internas as string[]), ...((cfg.dre.naoDespesa ?? []) as string[])];
  const centrosAtivos = centros.filter(c => c.ativo && (ctx.unitIds === null || c.unit_id === null || ctx.unitIds.includes(c.unit_id)));
  const SelConta = ({ name, def, tipo = "SAIDA", vazio }: { name: string; def?: number | null; tipo?: "SAIDA" | "ENTRADA" | "TODAS"; vazio?: string }) => <Select name={name} defaultValue={def ?? ""}>{vazio !== undefined && <option value="">{vazio}</option>}{(tipo === "ENTRADA" ? opEntrada : tipo === "SAIDA" ? opSaida : [...opSaida, ...opEntrada]).map(g => <optgroup key={g.grupo} label={g.grupo}>{g.contas.map(c => <option key={c.id} value={c.id}>{c.codigo} {c.nome}</option>)}</optgroup>)}</Select>;
  const SelCentro = ({ name, def, vazio = "— a unidade que paga —" }: { name: string; def?: number | null; vazio?: string }) => <Select name={name} defaultValue={def ?? ""}><option value="">{vazio}</option>{centrosAtivos.map(c => <option key={c.id} value={c.id}>{c.codigo} · {c.nome}</option>)}</Select>;

  // ---------------------------------------------------------------- dados das abas
  const editar = sp.editar ? porId.get(Number(sp.editar)) : undefined; const novaPai = sp.nova ? porId.get(Number(sp.nova)) : undefined;
  const fila = aba === "classificacao" ? await filaClassificacao({ unitIds, de: /^\d{4}-\d{2}-\d{2}$/.test(sp.de ?? "") ? sp.de! : addDays(h, -Number(cfg.planoContas?.janelaClassificacaoDias ?? 120)), ate: /^\d{4}-\d{2}-\d{2}$/.test(sp.ate ?? "") ? sp.ate! : h, tipo: ["SAIDA", "ENTRADA", "TRANSFERENCIA"].includes(sp.tipo ?? "") ? sp.tipo! : null, categoria: sp.cat || null, q: sp.q?.trim().slice(0, 80) || null, generica: sp.generica === "1" }) : null;
  const realCentro = aba === "centros" ? await sql<{ cost_center_id: number; v: number; n: number; v12: number }[]>`SELECT cost_center_id, sum(valor)::float AS v, count(*)::int AS n, sum(valor) FILTER (WHERE data > ${addDays(h, -365)}::date)::float AS v12 FROM cash_entries WHERE cost_center_id IS NOT NULL AND tipo='SAIDA' GROUP BY 1` : [];
  const centroSel = sp.centro ? cc.get(Number(sp.centro)) : undefined;
  const conf = fila ? { ALTA: fila.itens.filter(i => i.sugestao?.confianca === "ALTA").length, MEDIA: fila.itens.filter(i => i.sugestao?.confianca === "MEDIA").length, BAIXA: fila.itens.filter(i => i.sugestao?.confianca === "BAIXA").length, SEM: fila.itens.filter(i => !i.sugestao).length } : null;
  const voltarFila = qs({ de: sp.de, ate: sp.ate, tipo: sp.tipo, cat: sp.cat, q: sp.q, generica: sp.generica === "1" ? "1" : undefined });

  const FormConta = ({ c, pai }: { c?: Conta; pai?: Conta }) => {
    const base = c ?? pai!; const analitica = c ? ehAnalitica(c, contas) : (pai!.nivel + 1 >= 3); const tipoNivel = c ? c.nivel : pai!.nivel + 1;
    return <form action={salvarConta} className="space-y-3">{c ? <input type="hidden" name="id" value={c.id} /> : <input type="hidden" name="paiId" value={pai!.id} />}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3"><Field label={c ? `Nome · ${c.codigo}` : `Nome da nova ${tipoNivel === 2 ? "subgrupo" : tipoNivel === 3 ? "conta" : "subconta"}`} className="sm:col-span-2"><Input name="nome" defaultValue={c?.nome ?? ""} required maxLength={120} /></Field>
        {analitica ? <Field label="Categoria-ponte" hint="Caixa, DRE e orçamento por categoria"><Select name="categoria" defaultValue={c?.categoria ?? pai?.categoria ?? ""}><option value="">— escolha —</option>{categorias.map(x => <option key={x} value={x}>{x}</option>)}</Select></Field> : <p className="self-end pb-2 text-xs text-slate-500">Grupo: só organiza (não recebe lançamento).</p>}</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Field label="Tipo econômico"><Select name="economico" defaultValue={base.tipo_economico}>{Object.entries(ROTULO_ECONOMICO).filter(([k]) => base.tipo === "ENTRADA" ? k === "RECEITA" : k !== "RECEITA").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="Comportamento"><Select name="comportamento" defaultValue={base.comportamento}>{Object.entries(ROTULO_COMPORTAMENTO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="Recorrência"><Select name="recorrencia" defaultValue={base.recorrencia}>{Object.entries(ROTULO_RECORRENCIA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="Custo"><Select name="custo" defaultValue={base.custo}>{Object.entries(ROTULO_CUSTO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="Índice de reajuste"><Select name="indice" defaultValue={base.indice}>{Object.entries(ROTULO_INDICE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="Varia com"><Select name="driver" defaultValue={base.driver}>{Object.entries(ROTULO_DRIVER).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="Centro padrão"><Select name="centro" defaultValue={base.centro_padrao}>{Object.entries(ROTULO_CENTRO_PADRAO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <div className="space-y-1 self-end pb-1 text-xs"><label className="flex items-center gap-1.5"><input type="checkbox" name="controlavel" value="1" defaultChecked={base.controlavel} /> Controlável no mês</label><label className="flex items-center gap-1.5"><input type="checkbox" name="generica" value="1" defaultChecked={c?.generica ?? false} /> Conta genérica (“outras”)</label>
          {c && <label className="flex items-center gap-1.5"><input type="checkbox" name="ativo" value="1" defaultChecked={c.ativo} /> Ativa</label>}</div>
      </div>
      <Field label="Palavras que sugerem esta conta (separadas por vírgula)" hint="Comparadas sem acento com a contraparte e a descrição do extrato. Ex.: energisa, energia, luz"><Input name="palavras" defaultValue={c?.palavras ?? ""} maxLength={600} /></Field>
      <Field label="Orientação (opcional)"><Textarea name="descricao" defaultValue={c?.descricao ?? ""} className="min-h-[50px]" maxLength={300} /></Field>
      <div className="flex flex-wrap items-center gap-2"><Btn small>{c ? "Salvar conta" : "Criar"}</Btn><Btn small kind="ghost" href={qs({})}>Fechar</Btn>{c && <span className="text-[11px] text-slate-500">Código, nível e tipo não mudam. Com lançamentos, a categoria-ponte também não (crie outra conta e inative esta).</span>}</div>
    </form>;
  };

  return (
    <Page title="Plano de contas e centros de custo" sub={`Natureza (conta), centro de custo, comportamento e tipo econômico em campos distintos — a categoria do caixa, da DRE e do orçamento acompanha a conta. ${ctx.carimbo}.`}
      actions={<><Btn kind="ghost" href="/financeiro/rateio">Resultado por unidade</Btn><Btn kind="ghost" href="/financeiro/orcamento/historico">Orçamento pelo histórico</Btn><Btn kind="ghost" href={`/api/export/plano-de-contas${ctx.unitId ? `?unidade=${ctx.unitId}` : ""}`}>Exportar CSV</Btn><Btn kind="ghost" href={`/api/export/lancamentos-classificados${ctx.unitId ? `?unidade=${ctx.unitId}` : ""}`}>Lançamentos classificados (CSV)</Btn></>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <BarraContexto ctx={ctx} voltar={`/financeiro/plano-de-contas?aba=${aba}`} periodo={false} />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <Stat label="Saídas com conta (12 meses)" value={<span className={q.pctSemConta === null ? "" : q.pctSemConta <= 5 ? "text-ok" : q.pctSemConta <= 30 ? "text-aviso" : "text-erro"}>{q.pctSemConta === null ? "—" : pct(100 - q.pctSemConta)}</span>} hint={q.nSemConta ? `${brl(q.semConta)} sem conta em ${q.nSemConta} lançamento(s)` : "tudo classificado"} href={qs({ aba: "classificacao" })} />
        <Stat label="Em conta genérica" value={<span className={q.pctGenerica === null ? "" : q.pctGenerica <= q.meta ? "text-ok" : "text-erro"}>{pct(q.pctGenerica)}</span>} hint={`meta: até ${q.meta}% · ${brl(q.generica)}`} />
        <Stat label="Com centro de custo" value={q.pctSemCentro === null ? "—" : pct(100 - q.pctSemCentro)} hint="sem centro: vale a unidade que pagou" />
        <Stat label="Contas analíticas ativas" value={nAnaliticas} hint={`${contas.filter(c => c.nivel === 1).length} grupos · ${contas.filter(c => !c.ativo).length} inativa(s)`} />
        <Stat label="Regras de classificação" value={regras.length} hint="contraparte → conta e centro" href={qs({ aba: "regras" })} />
      </div>
      <nav className="mb-3 flex flex-wrap gap-x-4 gap-y-1 border-b border-line pb-2 text-sm">{Object.entries(ABAS).map(([k, v]) => <Link key={k} href={qs({ aba: k })} className={aba === k ? "font-semibold text-navy underline underline-offset-4" : "text-acao"}>{v}{k === "classificacao" && q.nSemConta ? ` (${q.nSemConta})` : k === "regras" ? ` (${regras.length})` : ""}</Link>)}</nav>

      {aba === "plano" && <>
        {edita && (editar || novaPai) && <div id="editar"><Card title={editar ? `Editar ${editar.codigo} · ${editar.nome}` : `Nova conta em ${novaPai!.codigo} · ${novaPai!.nome}`} className="mb-4 border-sky-200"><FormConta c={editar} pai={novaPai} /></Card></div>}
        <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title="Saídas por macrogrupo — últimos 12 meses">{q.porMacrogrupo.length === 0 ? <p className="text-sm text-slate-500">Nenhuma saída classificada ainda. Comece pela aba Classificação.</p> : <BarrasH rotulo="Saídas por macrogrupo" itens={q.porMacrogrupo.map(m => ({ rotulo: `${m.codigo} ${m.nome}`, valor: m.valor, sub: `${m.n} lançamento(s)` }))} formato={v => `R$ ${fmtCompacto(v)}`} />}
            {q.nSemConta > 0 && <p className="mt-2 text-[11px] text-aviso">Fora do gráfico: {brl(q.semConta)} ainda sem conta.</p>}</Card>
          <Card title="Maiores contrapartes sem conta">{q.contrapartes.length === 0 ? <p className="text-sm text-ok">Nada sem conta nos últimos 12 meses. 👍</p> : <ul className="divide-y divide-line text-sm">{q.contrapartes.map(c => <li key={c.contraparte} className="flex items-center justify-between gap-2 py-1.5"><Link className="min-w-0 truncate text-acao" href={qs({ aba: "classificacao", q: c.contraparte.slice(0, 60), de: addDays(h, -365) })}>{c.contraparte}</Link><span className="shrink-0 text-xs tabular-nums text-slate-600">{c.n} · {brl(c.valor)}</span></li>)}</ul>}
            <p className="mt-2 text-[11px] text-slate-500">Classifique a primeira de cada contraparte e marque “lembrar”: as próximas vêm sugeridas com confiança alta.</p></Card>
        </div>
        <Card title={`Plano de contas gerencial (${contas.length} contas)`} actions={<span className="text-[11px] text-slate-500">grupo → subgrupo → conta → subconta</span>}>
          <Table head={["Conta", { label: "Atributos", className: "hidden md:table-cell" }, { label: "Categoria-ponte", className: "hidden sm:table-cell" }, "Uso 12 meses", ""]}>
            {contas.map(c => { const an = ehAnalitica(c, contas); const v = usoV.get(c.id) ?? 0; const n = usoN.get(c.id) ?? 0;
              return <tr key={c.id} className={`${c.nivel === 1 ? "bg-mist/60" : ""} ${c.ativo ? "" : "text-slate-400"}`}>
                <Td><div className={`flex items-baseline gap-1.5 ${c.nivel === 1 ? "font-semibold text-navy" : c.nivel === 2 ? "font-medium" : ""}`} style={{ paddingLeft: `${(c.nivel - 1) * 0.9}rem` }}><span className="shrink-0 font-mono text-[11px] text-slate-500">{c.codigo}</span><span className="min-w-0">{c.nome}</span></div>
                  <div className="flex flex-wrap gap-1 text-[10px]" style={{ paddingLeft: `${(c.nivel - 1) * 0.9}rem` }}>{!c.ativo && <Badge v="CANCELADO" label="inativa" />}{c.generica && <Badge v="PENDENTE" label="genérica" />}{an && c.tipo_economico !== "OPEX" && c.tipo_economico !== "RECEITA" && <Badge v="ABERTO" label={ROTULO_ECONOMICO[c.tipo_economico]} />}{an && c.centro_padrao === "CORPORATIVO" && <Badge v="EM_AQUISICAO" label="corporativo" />}{(uso.regras.get(c.id) ?? 0) > 0 && <span className="text-slate-500">{uso.regras.get(c.id)} regra(s)</span>}</div></Td>
                <Td className="hidden text-[11px] text-slate-600 md:table-cell">{an ? <>{ROTULO_COMPORTAMENTO[c.comportamento]} · {ROTULO_RECORRENCIA[c.recorrencia].toLowerCase()} · {c.custo === "DIRETO" ? "direto" : "indireto"}{c.controlavel ? "" : " · não controlável"}<div>{ROTULO_INDICE[c.indice]}{c.driver !== "NENHUM" ? ` · varia com ${ROTULO_DRIVER[c.driver].toLowerCase()}` : ""}</div></> : c.descricao ? <span className="line-clamp-2">{c.descricao}</span> : null}</Td>
                <Td className="hidden text-xs sm:table-cell">{an ? c.categoria : ""}</Td>
                <Td className="whitespace-nowrap text-xs tabular-nums">{n ? <>{brl(v)}<div className="text-[11px] text-slate-500">{n} lanç.{uso.cp.get(c.id) ? ` · ${uso.cp.get(c.id)} título(s)` : ""}</div></> : uso.cp.get(c.id) ? <span className="text-[11px] text-slate-500">{uso.cp.get(c.id)} título(s)</span> : <span className="text-slate-300">—</span>}</Td>
                <Td className="whitespace-nowrap text-right">{edita && <span className="inline-flex gap-1"><Btn small kind="ghost" href={`${qs({ editar: String(c.id) })}#editar`}>Editar</Btn>{c.nivel <= 3 && c.ativo && <Btn small kind="ghost" href={`${qs({ nova: String(c.id) })}#editar`}>+ {c.nivel === 1 ? "subgrupo" : c.nivel === 2 ? "conta" : "subconta"}</Btn>}</span>}</Td></tr>; })}
          </Table>
          <p className="mt-2 text-[11px] text-slate-500">Só a conta analítica (sem contas abaixo) recebe lançamento. Tipo econômico separa despesa operacional, investimento, serviço da dívida, transferência e adiantamento — transferência, principal de dívida e adiantamento saem do caixa mas ficam fora da DRE e do orçado × realizado. Custo direto é o que se atribui à turma ou ao segmento; indireto é compartilhado. Índice e “varia com” alimentam o orçamento pelo histórico.</p>
        </Card>
      </>}

      {aba === "centros" && <>
        {edita && <div id="editar" className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {centroSel && <Card title={`Editar ${centroSel.codigo}`} className="border-sky-200"><form action={salvarCentro} className="space-y-2"><input type="hidden" name="id" value={centroSel.id} />
            <Field label="Nome"><Input name="nome" defaultValue={centroSel.nome} required /></Field>
            <Field label="Dono do orçamento (responsável)"><Select name="responsavelId" defaultValue={centroSel.responsavel_user_id ?? ""}><option value="">— sem dono —</option>{usuarios.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>
            {centroSel.tipo === "PROJETO" && <div className="grid grid-cols-3 gap-2"><Field label="Início"><Input name="inicio" type="date" defaultValue={centroSel.inicio ?? ""} /></Field><Field label="Fim"><Input name="fim" type="date" defaultValue={centroSel.fim ?? ""} /></Field><Field label="Orçamento (R$)"><Input name="orcamento" inputMode="decimal" defaultValue={centroSel.orcamento ?? ""} /></Field></div>}
            <Field label="Observação"><Input name="obs" defaultValue={centroSel.obs ?? ""} maxLength={500} /></Field>
            {centroSel.tipo !== "CORPORATIVO" && centroSel.tipo !== "UNIDADE" ? <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" name="ativo" value="1" defaultChecked={centroSel.ativo} /> Ativo</label> : <input type="hidden" name="ativo" value="1" />}
            <div className="flex gap-2"><Btn small>Salvar centro</Btn><Btn small kind="ghost" href={qs({})}>Fechar</Btn></div></form></Card>}
          <Card title="Novo centro de custo"><form action={salvarCentro} className="space-y-2">
            <div className="grid grid-cols-2 gap-2"><Field label="Tipo"><Select name="tipo" defaultValue="PROJETO"><option value="PROJETO">Projeto</option><option value="AREA">Área</option><option value="SEGMENTO">Segmento</option></Select></Field>
              <Field label="Unidade"><Select name="unitId" defaultValue={ctx.unitId ?? ""}>{ctx.unitId === null && <option value="">Rede (todas)</option>}{ctx.units.filter(u => ctx.unitIds === null || ctx.unitIds.includes(u.id)).map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field></div>
            <Field label="Nome"><Input name="nome" required placeholder="Ex.: Feira de Ciências 2027 · Área pedagógica" maxLength={120} /></Field>
            <div className="grid grid-cols-2 gap-2"><Field label="Dono do orçamento"><Select name="responsavelId" defaultValue=""><option value="">— sem dono —</option>{usuarios.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field><Field label="Segmento (se for segmento)"><Input name="segmento" placeholder="Ex.: Ensino Médio" /></Field></div>
            <div className="grid grid-cols-3 gap-2"><Field label="Início (projeto)"><Input name="inicio" type="date" /></Field><Field label="Fim (projeto)"><Input name="fim" type="date" /></Field><Field label="Orçamento (R$)"><Input name="orcamento" inputMode="decimal" placeholder="0,00" /></Field></div>
            <Btn small>Criar centro</Btn></form></Card>
        </div>}
        <Card title={`Centros de custo (${centros.length})`}>
          <Table head={["Centro", { label: "Unidade", className: "hidden sm:table-cell" }, { label: "Dono do orçamento", className: "hidden md:table-cell" }, "Realizado 12 meses", ""]}>
            {centros.filter(c => ctx.unitIds === null || c.unit_id === null || ctx.unitIds.includes(c.unit_id)).map(c => { const r = realCentro.find(x => x.cost_center_id === c.id); const exec = c.orcamento ? (100 * (r?.v ?? 0)) / c.orcamento : null;
              return <tr key={c.id} className={c.ativo ? "" : "text-slate-400"}><Td><span className="font-mono text-[11px] text-slate-500">{c.codigo}</span> <span className="font-medium">{c.nome}</span><div className="flex flex-wrap gap-1 text-[10px]"><Badge v={c.tipo === "CORPORATIVO" ? "EM_AQUISICAO" : c.tipo === "PROJETO" ? "ABERTO" : "ATIVO"} label={ROTULO_TIPO_CENTRO[c.tipo] ?? c.tipo} />{!c.ativo && <Badge v="CANCELADO" label="inativo" />}{c.tipo === "PROJETO" && (c.inicio || c.fim) && <span className="text-slate-500">{fmtData(c.inicio)} a {fmtData(c.fim)}</span>}</div></Td>
                <Td className="hidden text-xs sm:table-cell">{c.unidade ?? "Rede"}{c.segmento ? ` · ${c.segmento}` : ""}</Td><Td className="hidden text-xs md:table-cell">{c.responsavel ?? <span className="text-slate-400">—</span>}</Td>
                <Td className="whitespace-nowrap text-xs tabular-nums">{r ? brl(r.v12) : <span className="text-slate-300">—</span>}{c.orcamento ? <div className={`text-[11px] ${exec !== null && exec > 100 ? "text-erro" : "text-slate-500"}`}>{brl(r?.v ?? 0)} de {brl(c.orcamento)} ({pct(exec)})</div> : null}</Td>
                <Td className="text-right">{edita && <Btn small kind="ghost" href={`${qs({ centro: String(c.id) })}#editar`}>Editar</Btn>}</Td></tr>; })}
          </Table>
          <p className="mt-2 text-[11px] text-slate-500">Centro = quem consome ou responde pelo gasto. Corporativo vai para o rateio entre as unidades; sem centro, a despesa fica na unidade que pagou; centro de outra unidade leva a despesa para a unidade beneficiária. Projetos comparam o realizado com o orçamento do projeto.</p>
        </Card>
      </>}

      {aba === "classificacao" && fila && conf && <>
        <form className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6 lg:items-end"><input type="hidden" name="aba" value="classificacao" />
          <Field label="De"><Input name="de" type="date" defaultValue={sp.de ?? addDays(h, -Number(cfg.planoContas?.janelaClassificacaoDias ?? 120))} /></Field><Field label="Até"><Input name="ate" type="date" defaultValue={sp.ate ?? h} /></Field>
          <Field label="Tipo"><Select name="tipo" defaultValue={sp.tipo ?? ""}><option value="">Todos</option><option value="SAIDA">Saídas</option><option value="ENTRADA">Entradas</option><option value="TRANSFERENCIA">Transferências</option></Select></Field>
          <Field label="Categoria"><Select name="cat" defaultValue={sp.cat ?? ""}><option value="">Todas</option>{categorias.map(c => <option key={c} value={c}>{c}</option>)}</Select></Field>
          <Field label="Busca"><Input name="q" defaultValue={sp.q ?? ""} placeholder="Contraparte ou descrição" /></Field><div className="flex flex-wrap items-center gap-2"><label className="flex items-center gap-1.5 text-xs"><input type="checkbox" name="generica" value="1" defaultChecked={sp.generica === "1"} /> incluir conta genérica</label><Btn small kind="ghost">Filtrar</Btn></div></form>
        <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label={sp.generica === "1" ? "Sem conta ou em genérica" : "Sem conta no filtro"} value={fila.total} hint={brl(fila.valor)} />
          <Stat label="Sugestão: confiança alta" value={<span className="text-ok">{conf.ALTA}</span>} hint="regra ou histórico" />
          <Stat label="Confiança média" value={conf.MEDIA} hint="palavra ou categoria única" />
          <Stat label="Confiança baixa" value={<span className={conf.BAIXA ? "text-aviso" : ""}>{conf.BAIXA}</span>} hint="confira antes" />
          <Stat label="Sem sugestão" value={conf.SEM} hint="escolha a conta" />
        </div>
        {edita && conf.ALTA > 0 && <form action={aplicarAltaConfianca} className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50/50 p-2"><input type="hidden" name="voltar" value={voltarFila} />{(["de", "ate", "tipo", "q"] as const).map(k => sp[k] ? <input key={k} type="hidden" name={k} value={sp[k]} /> : null)}{sp.cat && <input type="hidden" name="categoria" value={sp.cat} />}{sp.generica === "1" && <input type="hidden" name="generica" value="1" />}{ctx.unitId && <input type="hidden" name="unitId" value={ctx.unitId} />}
          <Btn small pendingText="Classificando…">Aplicar as {conf.ALTA} sugestões de confiança alta</Btn><span className="text-xs text-slate-600">Regra cadastrada ou o que já foi usado para a mesma contraparte. As demais você confere abaixo.</span></form>}
        <form action={classificarSelecionados}><input type="hidden" name="voltar" value={voltarFila} />
          <Table head={[edita ? "" : "", "Lançamento", { label: "Categoria atual", className: "hidden md:table-cell" }, "Valor", "Sugestão"]} empty="Nada sem conta neste filtro. 👍">
            {fila.itens.map(i => { const sg = i.sugestao; const c = sg ? porId.get(sg.contaId) : undefined; const centro = sg?.centroId ? cc.get(sg.centroId) : undefined;
              return <tr key={i.id}><Td>{edita && <input type="checkbox" name="ids" value={i.id} defaultChecked={sg?.confianca === "ALTA" || sg?.confianca === "MEDIA"} aria-label={`Marcar lançamento ${i.id}`} />}</Td>
                <Td><Link className="font-medium text-acao" href={`/financeiro/lancamentos/${i.id}`}>{i.contraparte || i.descricao || `Lançamento #${i.id}`}</Link><div className="text-[11px] text-slate-500">{fmtData(i.data)} · {i.unidade}{i.contraparte && i.descricao ? ` · ${i.descricao}` : ""}{i.tipo !== "SAIDA" ? ` · ${i.tipo === "ENTRADA" ? "entrada" : "transferência"}` : ""}</div><div className="text-[11px] text-slate-500 md:hidden">{i.categoria}</div></Td>
                <Td className="hidden text-xs md:table-cell">{i.categoria}{i.conta_id && porId.get(i.conta_id) ? <div className="text-[11px] text-aviso">hoje em {porId.get(i.conta_id)!.codigo} {porId.get(i.conta_id)!.nome}</div> : null}</Td><Td className="whitespace-nowrap tabular-nums">{brl(i.valor)}</Td>
                <Td className="text-xs">{sg && c ? <><span className="font-mono text-[11px] text-slate-500">{c.codigo}</span> {c.nome}{centro && <span className="text-slate-500"> · {centro.codigo}</span>}<div className="mt-0.5 flex flex-wrap items-center gap-1"><Badge v={TOM_CONF[sg.confianca]} label={`${sg.confianca === "ALTA" ? "alta" : sg.confianca === "MEDIA" ? "média" : "baixa"} · ${FONTE[sg.fonte]}`} /><span className={`text-[11px] ${sg.mudaCategoria ? "text-aviso" : "text-slate-500"}`}>{sg.motivo}</span></div></> : <span className="text-slate-400">sem sugestão</span>}</Td></tr>; })}
          </Table>
          {fila.total > fila.itens.length && <p className="mt-1 text-[11px] text-slate-500">Mostrando os {fila.itens.length} maiores de {fila.total}. Filtre por período, categoria ou contraparte.</p>}
          {edita && fila.itens.length > 0 && <div className="mt-3 space-y-2 rounded-md border border-line bg-mist p-2">
            <div className="flex flex-wrap items-center gap-2"><Btn small name="modo" value="SUGESTAO" pendingText="Classificando…">Aplicar a sugestão de cada marcada</Btn><span className="text-[11px] text-slate-500">Cada linha recebe a própria sugestão (conta e centro).</span></div>
            <div className="flex flex-wrap items-end gap-2"><Field label="Ou todas as marcadas nesta conta" className="min-w-[16rem] flex-1"><SelConta name="contaId" tipo="TODAS" vazio="— escolha a conta —" /></Field><Field label="Centro de custo" className="min-w-[12rem]"><SelCentro name="centroId" /></Field>
              <label className="flex items-center gap-1.5 pb-2 text-xs"><input type="checkbox" name="lembrar" value="1" defaultChecked /> lembrar para estas contrapartes (cria regra)</label><Btn small name="modo" value="CONTA" kind="ghost" pendingText="Classificando…">Classificar as marcadas</Btn></div>
            <p className="text-[11px] text-slate-500">Mudar de categoria em competência fechada é bloqueado; detalhar a conta dentro da mesma categoria, ou o centro, é permitido. Tudo vai para a auditoria.</p></div>}
        </form>
      </>}

      {aba === "regras" && <>
        {edita && <Card title="Nova regra" className="mb-4"><form action={salvarRegra} className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
          <Field label="Contraparte ou descrição contém"><Input name="padrao" required minLength={3} placeholder="Ex.: ENERGISA" maxLength={120} /></Field>
          <Field label="Conta" className="lg:col-span-2"><SelConta name="contaId" tipo="TODAS" vazio="— escolha a conta —" /></Field>
          <Field label="Centro de custo"><SelCentro name="centroId" vazio="— o padrão da conta —" /></Field>
          <Field label="Só na unidade"><Select name="unitId" defaultValue={ctx.unitId ?? ""}>{ctx.unitId === null && <option value="">Todas</option>}{ctx.units.filter(u => ctx.unitIds === null || ctx.unitIds.includes(u.id)).map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>
          <div className="lg:col-span-5"><Btn small>Criar regra</Btn></div></form></Card>}
        <Card title={`Regras ativas (${regras.length})`} actions={edita ? <form action={aplicarRegras}><input type="hidden" name="dias" value="365" /><Btn small kind="ghost" pendingText="Aplicando…">Aplicar aos lançamentos sem conta (12 meses)</Btn></form> : null}>
          <Table head={["Contém", "Conta", { label: "Centro", className: "hidden sm:table-cell" }, { label: "Unidade", className: "hidden md:table-cell" }, "Usos", ""]} empty="Nenhuma regra ainda: crie aqui ou marque “lembrar” ao classificar.">
            {regras.map(r => { const c = porId.get(r.conta_id); const centro = r.cost_center_id ? cc.get(r.cost_center_id) : undefined; return <tr key={r.id}><Td className="font-medium">“{r.padrao}”<div className="text-[11px] text-slate-500">{r.criador ?? "—"} · {fmtData(r.created_at.slice(0, 10))}</div></Td>
              <Td className="text-xs">{c ? <><span className="font-mono text-[11px] text-slate-500">{c.codigo}</span> {c.nome}<div className="text-[11px] text-slate-500">{macrogrupo(c, porId).nome} · {c.categoria}</div></> : "—"}</Td><Td className="hidden text-xs sm:table-cell">{centro ? `${centro.codigo} · ${centro.nome}` : <span className="text-slate-400">padrão da conta</span>}</Td><Td className="hidden text-xs md:table-cell">{r.unidade ?? "Todas"}</Td><Td className="tabular-nums">{r.usos}</Td>
              <Td className="text-right">{edita && <form action={desativarRegra}><input type="hidden" name="id" value={r.id} /><Btn small kind="ghost">Desativar</Btn></form>}</Td></tr>; })}
          </Table>
          <p className="mt-2 text-[11px] text-slate-500">A regra mais específica vence (padrão mais longo; regra da unidade antes da regra da rede). Sem regra, a sugestão usa o histórico da contraparte, as palavras de cada conta e, por último, a categoria.</p>
        </Card>
      </>}
    </Page>
  );
}
