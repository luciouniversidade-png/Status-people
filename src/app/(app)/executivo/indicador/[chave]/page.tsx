import { redirect, notFound } from "next/navigation";
import Link from "@/components/Link";
import { sql } from "@/db";
import { requireGestao, scopeUnit } from "@/lib/auth";
import { Page, Card, Flash, Field, Select, Btn, Input, Textarea } from "@/components/ui";
import { PrintButton } from "@/components/PrintButton";
import { Modal } from "@/components/Modal";
import { Linhas, Colunas, Situacao, COR, corSerie } from "@/components/graficos";
import { KPI, garantirKpis, kpisVisiveis, visoes, lerSeries, comentarios, podeEditarMeta, podeComentar, vePainelExecutivo, periodoPadrao, periodoValido, metasDoAno, comparativoUnidades } from "@/lib/kpi";
import { AREAS, SENTIDO_LABEL, AGREGACAO_LABEL, HISTORICO_LABEL, TOM_FAROL, porUnidade, farolKpi, type Ponto } from "@/lib/kpi-catalogo";
import { fmtKpi, fmtEixo, rotuloMes, mesPorExtenso, variacao, MESES_CURTOS } from "@/lib/formato";
import { FAROL_LABEL, somaMeses, ultimosPeriodos } from "@/lib/gestao-calc";
import { hoje, fmtDataHora, getSettings } from "@/lib/utils";
import { linkPainel } from "@/lib/painel-executivo";
import { CartaoKpi, fmtV } from "../../_ui";
import { comentarKpi, removerComentarioKpi, salvarMeta, removerMeta } from "../../actions";

export const dynamic = "force-dynamic";

export default async function Indicador({ params, searchParams }: { params: Promise<{ chave: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireGestao(); if (!vePainelExecutivo(s)) redirect("/");
  const { chave } = await params; const sp = await searchParams; const k = KPI[decodeURIComponent(chave)];
  const defs = await kpisVisiveis(s); if (!k || !defs.some(d => d.chave === k.chave)) notFound();
  await garantirKpis().catch(() => null);
  const h = hoje(); const periodo = periodoValido(sp.periodo, h) ? sp.periodo! : periodoPadrao(h);
  const escopo = scopeUnit(s); const units = await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ORDER BY nome`;
  const pedido = sp.unidade ? Number(sp.unidade) : 0; const unitId = escopo ?? (units.some(u => u.id === pedido) && porUnidade(k) ? pedido : 0);
  const unidadeNome = unitId === 0 ? "Rede" : units.find(u => u.id === unitId)?.nome ?? "Unidade";
  const cfg = await getSettings(); const tol = Number(cfg.insights?.toleranciaPct ?? 10);
  const [[v], coms, comp, metas] = await Promise.all([visoes([k], periodo, unitId), comentarios(k.chave, unitId, escopo === null && unitId === 0), escopo === null && porUnidade(k) ? comparativoUnidades([k], periodo) : Promise.resolve(null), metasDoAno(Number(periodo.slice(0, 4)))]);
  const de = somaMeses(periodo, -23); const ids = escopo === null && porUnidade(k) ? units.map(u => u.id) : [];
  const serUn = ids.length ? await lerSeries([k.chave], ids, de, periodo) : new Map<string, Map<string, Ponto>>();
  const meses = ultimosPeriodos(periodo, 24); const dica = (x: number) => fmtKpi(x, k.unidade); const eixo = fmtEixo(k.unidade);
  const voltar = linkPainel(`/executivo/indicador/${encodeURIComponent(k.chave)}`, { periodo, unitId });
  const notas = coms.filter(c => meses.includes(c.periodo) && (c.unit_id === unitId || c.unit_id === 0)).map(c => ({ indice: meses.indexOf(c.periodo), texto: `${c.user_nome ?? ""}: ${c.texto}` }));
  const metaFixa = v.meta !== null && v.periodicidade === "MENSAL" && v.metaFonte !== "ORCAMENTO" ? v.meta : null;
  // ano contra ano (jan–dez): fluxos acumulam; razões e retratos mês a mês
  const ano = Number(periodo.slice(0, 4)); const serieMapa = new Map(v.serie.map(p => [p.periodo, p.valor]));
  const curva = (a: number) => { let acc: number | null = null; return MESES_CURTOS.map((_, i) => { const p = `${a}-${String(i + 1).padStart(2, "0")}`; if (p > periodo) return null; const x = serieMapa.get(p) ?? null; if (k.agregacao !== "SOMA") return x; if (x === null) return acc; acc = (acc ?? 0) + x; return acc; }); };
  const anoAtual = curva(ano), anoAnt = curva(ano - 1);
  const editaMeta = podeEditarMeta(s, k) && escopo === null && k.sentido !== "NEUTRO";
  const metaUnid = metas.get(`${k.chave}|${unitId}`);
  return (
    <Page title={v.nome} sub={<>{AREAS[k.area].nome} · {unidadeNome} · {mesPorExtenso(periodo)}{periodo === h.slice(0, 7) ? " (mês em andamento)" : ""}</>}
      actions={<div className="flex flex-wrap gap-2 print:hidden"><Btn kind="ghost" href={linkPainel("/executivo", { periodo, unitId }, { aba: k.area })}>Voltar ao painel</Btn><Btn kind="ghost" href={`/api/export/indicador?chave=${encodeURIComponent(k.chave)}${unitId ? `&unidade=${unitId}` : ""}`}>Exportar série (CSV)</Btn><PrintButton />{k.href && <Btn kind="ghost" href={k.href}>Abrir o módulo</Btn>}</div>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <form className="mb-4 flex flex-wrap items-end gap-2 print:hidden">
        <Field label="Mês"><Select name="periodo" defaultValue={periodo}>{ultimosPeriodos(h.slice(0, 7), 24).reverse().map(p => <option key={p} value={p}>{rotuloMes(p)}{p === h.slice(0, 7) ? " (parcial)" : ""}</option>)}</Select></Field>
        {escopo === null && porUnidade(k) && <Field label="Unidade"><Select name="unidade" defaultValue={unitId || ""}><option value="">Rede</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>}
        <Btn kind="ghost">Ver</Btn>
      </form>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <CartaoKpi v={v} href={voltar} />
        <Card title="Como é calculado">
          <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[9rem_minmax(0,1fr)]">
            <dt className="text-slate-500">Fórmula</dt><dd>{k.formula}</dd>
            <dt className="text-slate-500">Fonte</dt><dd>{k.fonte}</dd>
            <dt className="text-slate-500">Leitura</dt><dd>{SENTIDO_LABEL[k.sentido]} · {AGREGACAO_LABEL[k.agregacao]}</dd>
            <dt className="text-slate-500">Histórico</dt><dd>{HISTORICO_LABEL[k.historico]}</dd>
            <dt className="text-slate-500">Meta</dt><dd>{v.meta === null ? "sem meta" : `${v.periodicidade === "ANUAL" ? "anual " : ""}${fmtV(v, v.meta, false)} — ${v.metaFonte === "CADASTRADA" ? `definida pela gestão${metaUnid ? "" : unitId ? " (meta da rede)" : ""}` : v.metaFonte === "ORCAMENTO" ? "orçamento do mês" : "padrão das configurações"}`}{v.alerta !== null ? ` · atenção a partir de ${fmtV(v, v.alerta, false)}` : v.meta !== null && k.sentido !== "NEUTRO" ? ` · atenção até ${cfg.insights?.toleranciaPct ?? 10}% da meta` : ""}</dd>
            {k.obs && <><dt className="text-slate-500">Observação</dt><dd>{k.obs}</dd></>}
          </dl>
        </Card>
      </div>

      <Card title={`Últimos 24 meses — ${unidadeNome}`} className="mt-4">
        {k.agregacao === "SOMA"
          ? <Colunas categorias={meses.map(p => rotuloMes(p))} series={[{ nome: v.nome, valores: v.serie.map(p => p.valor), cor: COR.acao }]} marcadores={metaFixa !== null ? { nome: "Meta", valores: meses.map(() => metaFixa), cor: COR.meta } : null} formato={eixo} formatoDica={dica} tamanho="inteiro" rotulo={`${v.nome}: 24 meses`} />
          : <Linhas categorias={meses.map(p => rotuloMes(p))} series={[{ nome: v.nome, valores: v.serie.map(p => p.valor), cor: COR.acao, area: k.agregacao === "ESTOQUE" }]} meta={metaFixa !== null ? { valor: metaFixa } : null} notas={notas} formato={eixo} formatoDica={dica} tamanho="inteiro" rotulo={`${v.nome}: 24 meses`} />}
        {notas.length > 0 && <p className="mt-1 text-[11px] text-slate-500">Os marcadores “i” no topo mostram os meses comentados pela gestão (passe o mouse para ler).</p>}
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title={k.agregacao === "SOMA" ? `Acumulado no ano: ${ano} × ${ano - 1}` : `${ano} × ${ano - 1}, mês a mês`}>
          <Linhas categorias={MESES_CURTOS} series={[{ nome: String(ano), valores: anoAtual, cor: COR.acao }, { nome: String(ano - 1), valores: anoAnt, cor: COR.neutro, tracejada: true }]} formato={eixo} formatoDica={dica} rotulo={`Comparação entre ${ano} e ${ano - 1}`} zero={k.agregacao === "SOMA"} />
        </Card>
        {ids.length > 0 && <Card title="Por unidade (24 meses)">
          <Linhas categorias={meses.map(p => rotuloMes(p))} series={units.map((u, i) => ({ nome: u.nome, valores: meses.map(p => serUn.get(`${k.chave}|${u.id}`)?.get(p)?.valor ?? null), cor: corSerie(i) }))} formato={eixo} formatoDica={dica} rotulo={`${v.nome} por unidade`} rotuloUltimo={false} />
        </Card>}
      </div>

      {comp && <Card title={`Unidades em ${rotuloMes(periodo)}`} className="mt-4">
        <div className="overflow-x-auto"><table className="w-full text-left text-xs sm:text-sm"><thead className="bg-mist text-xs text-slate-600"><tr>{["Unidade", "Valor", "Meta", "Situação"].map(c => <th key={c} className="px-3 py-2 font-medium">{c}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">{[...comp.unidades.map(u => ({ id: u.id, nome: u.nome })), { id: 0, nome: "Rede" }].map(u => { const c = comp.celulas.get(`${k.chave}|${u.id}`); return (
            <tr key={u.id} className={u.id === 0 ? "bg-mist font-medium" : ""}><td className="px-3 py-2"><Link className="text-acao hover:underline" href={linkPainel(`/executivo/indicador/${encodeURIComponent(k.chave)}`, { periodo, unitId: u.id })}>{u.nome}</Link></td><td className="px-3 py-2 tabular-nums">{fmtKpi(c?.valor ?? null, k.unidade)}{c?.medidoEm && c.medidoEm !== periodo ? <span className="text-[11px] text-slate-500"> ({rotuloMes(c.medidoEm)})</span> : null}</td><td className="px-3 py-2 tabular-nums">{c?.meta === null || c?.meta === undefined ? "—" : fmtKpi(c.meta, k.unidade)}</td><td className="px-3 py-2">{c ? <Situacao tom={TOM_FAROL[c.farol]} texto={FAROL_LABEL[c.farol]} /> : "—"}</td></tr>); })}</tbody></table></div>
      </Card>}

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
        <Card title="Mês a mês">
          <div className="overflow-x-auto"><table className="w-full text-left text-xs sm:text-sm"><thead className="bg-mist text-xs text-slate-600"><tr>{["Mês", "Valor", "vs. mês anterior", "vs. ano anterior", "Situação"].map(c => <th key={c} className="whitespace-nowrap px-3 py-2 font-medium">{c}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">{[...v.serie].reverse().map((p, i, arr) => { const ant = arr[i + 1]?.valor ?? null; const aa = v.serie.find(x => x.periodo === somaMeses(p.periodo, -12))?.valor ?? null; const dm = variacao(p.valor, ant, k.unidade), da = variacao(p.valor, aa, k.unidade); const f = metaFixa !== null ? farolKpi(p.valor, metaFixa, v.alerta, k.sentido, tol) : null; const nc = coms.filter(c => c.periodo === p.periodo).length; return (
              <tr key={p.periodo}><td className="whitespace-nowrap px-3 py-1.5">{rotuloMes(p.periodo)}{nc ? <span className="ml-1 rounded-full bg-amber-100 px-1.5 text-[10px] text-aviso" title={`${nc} comentário(s)`}>{nc}</span> : null}</td><td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{fmtKpi(p.valor, k.unidade)}</td><td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-slate-600">{dm?.texto ?? "—"}</td><td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-slate-600">{da?.texto ?? "—"}</td><td className="px-3 py-1.5">{f ? <Situacao tom={TOM_FAROL[f]} texto={FAROL_LABEL[f]} /> : <span className="text-xs text-slate-400">—</span>}</td></tr>); })}</tbody></table></div>
        </Card>
        <div className="space-y-4">
          <Card title={`Comentários da gestão (${coms.length})`}>
            {podeComentar(s) && <form action={comentarKpi} className="mb-3 space-y-2 print:hidden"><input type="hidden" name="chave" value={k.chave} /><input type="hidden" name="unidade" value={unitId} /><input type="hidden" name="voltar" value={voltar} />
              <Field label="Mês"><Select name="periodo" defaultValue={periodo}>{[...meses].reverse().map(p => <option key={p} value={p}>{rotuloMes(p)}</option>)}</Select></Field>
              <Field label={`Comentário (${unidadeNome})`}><Textarea name="texto" required maxLength={1000} placeholder="O que explica o número, o que foi decidido, o que esperar no próximo mês." /></Field>
              <Btn small>Registrar comentário</Btn></form>}
            {coms.length === 0 ? <p className="text-sm text-slate-500">Nenhum comentário ainda.</p> : <ul className="space-y-3">{coms.map(c => <li key={c.id} className="border-l-2 border-amber-300 pl-3 text-sm"><div className="text-[11px] text-slate-500">{rotuloMes(c.periodo)} · {c.unit_id === 0 ? "Rede" : c.unidade} · {c.user_nome} · {fmtDataHora(c.created_at)}</div><div className="whitespace-pre-line">{c.texto}</div>{(c.user_id === s.id || s.role === "DIRECAO") && <form action={removerComentarioKpi} className="print:hidden"><input type="hidden" name="id" value={c.id} /><input type="hidden" name="voltar" value={voltar} /><button className="text-[11px] text-erro hover:underline">remover</button></form>}</li>)}</ul>}
          </Card>
          {editaMeta && <Card title={`Meta ${ano} — ${unidadeNome}`}>
            <form action={salvarMeta} className="space-y-2"><input type="hidden" name="chave" value={k.chave} /><input type="hidden" name="ano" value={ano} /><input type="hidden" name="unidade" value={unitId} /><input type="hidden" name="voltar" value={voltar} />
              <div className="grid grid-cols-2 gap-2"><Field label={k.sentido === "DESCER" ? "Meta (no máximo)" : "Meta (no mínimo)"}><Input name="meta" required inputMode="decimal" defaultValue={metaUnid ? String(metaUnid.meta).replace(".", ",") : ""} /></Field><Field label="Atenção a partir de" hint="opcional"><Input name="alerta" inputMode="decimal" defaultValue={metaUnid?.alerta !== null && metaUnid?.alerta !== undefined ? String(metaUnid.alerta).replace(".", ",") : ""} /></Field></div>
              {k.agregacao === "SOMA" && <Field label="A meta vale"><Select name="periodicidade" defaultValue={metaUnid?.periodicidade ?? "MENSAL"}><option value="MENSAL">por mês</option><option value="ANUAL">no ano (proporcional ao mês)</option></Select></Field>}
              <Field label="Observação" hint="opcional"><Input name="obs" defaultValue={metaUnid?.obs ?? ""} /></Field>
              <Btn small>Salvar meta</Btn>
            </form>
            {metaUnid && <div className="mt-2"><Modal label="Remover meta" kind="danger" title="Remover a meta?"><form action={removerMeta} className="space-y-2"><input type="hidden" name="chave" value={k.chave} /><input type="hidden" name="ano" value={ano} /><input type="hidden" name="unidade" value={unitId} /><input type="hidden" name="voltar" value={voltar} /><p className="text-sm">Sem meta cadastrada, vale a meta padrão das configurações (quando existe).</p><Btn small danger>Remover</Btn></form></Modal></div>}
          </Card>}
        </div>
      </div>
    </Page>
  );
}
