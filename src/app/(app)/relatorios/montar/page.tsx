import { redirect } from "next/navigation";
import { AjusteTabela } from "@/components/AjusteTabela";
import Link from "@/components/Link";
import { sql } from "@/db";
import { requireStaff, scopeUnit } from "@/lib/auth";
import { Page, Card, Flash, Field, Input, Select, Btn, Table, Td } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { PrintButton } from "@/components/PrintButton";
import { BarrasH, Legenda, corSerie, COR } from "@/components/graficos";
import { podeRelatoriosRh } from "@/lib/relatorios-rh";
import { fmtMoeda, fmtData } from "@/lib/utils";
import { fontesDe, colunasDe, filtrosDe, lerDefinicao, executar, paraQuery, opcoesDinamicas, FONTE, type TipoCol } from "@/lib/relatorio-montar";
import { salvarRelatorio, excluirRelatorio } from "./actions";

export const dynamic = "force-dynamic";
const num = (v: number, t: TipoCol) => (t === "moeda" ? fmtMoeda(v) : v.toLocaleString("pt-BR", { maximumFractionDigits: 2 }));

/**
 * v30 · Relatório sob medida: fonte → colunas → filtros → agrupar (linhas × colunas) → contar / somar / média → gráfico → salvar e compartilhar.
 * O formulário é GET: o endereço é o relatório (dá para favoritar, mandar o link ou salvar com nome). Cada pessoa vê com o próprio acesso.
 */
export default async function Montar({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const s = await requireStaff(); if (!podeRelatoriosRh(s)) redirect("/relatorios");
  const raw = await searchParams; const sp = new URLSearchParams(); for (const [k, v] of Object.entries(raw)) (Array.isArray(v) ? v : v === undefined ? [] : [v]).forEach(x => sp.append(k, x));
  const fontes = fontesDe(s); const d = lerDefinicao(s, sp);
  if ("erro" in d) return <Page title="Relatório sob medida"><Card><p className="text-sm text-slate-600">{d.erro}</p></Card></Page>;
  const f = FONTE[d.fonte]; const cols = colunasDe(s, f); const fls = filtrosDe(s, f); const escopo = scopeUnit(s);
  const [units, dyn, salvos, r] = await Promise.all([
    escopo === null ? sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ORDER BY nome` : Promise.resolve([]), opcoesDinamicas(),
    sql<{ id: number; nome: string; definicao: { qs: string; fonte: string }; dono_user_id: number; dono: string; compartilhado: boolean; updated_at: string }[]>`SELECT c.id, c.nome, c.definicao, c.dono_user_id, u.nome AS dono, c.compartilhado, c.updated_at::text FROM custom_reports c JOIN users u ON u.id=c.dono_user_id WHERE c.dono_user_id=${s.id} OR c.compartilhado ORDER BY c.dono_user_id=${s.id} DESC, c.updated_at DESC LIMIT 60`,
    executar(s, d, 500),
  ]);
  const qs = paraQuery(d); const salvoAtual = salvos.find(x => x.definicao?.qs === qs && x.dono_user_id === s.id);
  const visiveis = salvos.filter(x => fontes.some(fo => fo.chave === x.definicao?.fonte));
  const agrupaveis = cols.filter(c => c.agrupar); const somaveis = cols.filter(c => c.somar);
  const partesRot = r.serie[0]?.partes?.map(p => p.rotulo) ?? [];
  const maxSerie = r.serie.length ? Math.max(...r.serie.map(x => x.valor)) : 0;
  return (
    <Page title="Relatório sob medida" sub={<>Escolha a fonte, as colunas, os filtros e como agrupar — o resultado respeita o seu acesso (unidade, salário e dados pessoais). <Link className="text-acao" href="/relatorios/biblioteca">Relatórios prontos</Link></>}
      actions={<div className="flex flex-wrap gap-2 print:hidden"><a href={`/api/relatorio-montar?${qs}`} className="inline-flex items-center rounded-md border border-line bg-white px-2.5 py-1 text-xs font-medium text-navy hover:bg-mist">Exportar CSV</a><PrintButton />
        {s.role !== "LEITURA" && <Modal label={salvoAtual ? "Salvo ✓" : "Salvar relatório"} title={salvoAtual ? `Atualizar · ${salvoAtual.nome}` : "Salvar este relatório"}><form action={salvarRelatorio} className="space-y-2"><input type="hidden" name="qs" value={qs} />{salvoAtual && <input type="hidden" name="id" value={salvoAtual.id} />}
          <Field label="Nome"><Input name="nome" required minLength={3} defaultValue={salvoAtual?.nome ?? ""} placeholder="Ex.: Docentes por titulação e unidade" /></Field>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="compartilhado" value="1" defaultChecked={salvoAtual?.compartilhado} /> Compartilhar com quem usa relatórios (cada um vê com o próprio acesso)</label>
          <Btn small>{salvoAtual ? "Atualizar" : "Salvar"}</Btn></form></Modal>}</div>}>
      <Flash ok={typeof raw.ok === "string" ? raw.ok : undefined} erro={typeof raw.erro === "string" ? raw.erro : undefined} />
      <div className="mb-4 flex flex-wrap gap-2 print:hidden">{fontes.map(fo => <Link key={fo.chave} href={`/relatorios/montar?fonte=${fo.chave}`} className={`rounded-full border px-3 py-1 text-xs font-medium ${fo.chave === f.chave ? "border-acao bg-acao text-white" : "border-line bg-white text-navy hover:bg-mist"}`}>{fo.nome}</Link>)}</div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[340px_minmax(0,1fr)] lg:items-start">
        <Card title="Montar" className="print:hidden">
          <p className="mb-2 text-xs text-slate-600">{f.descricao}</p>
          <form className="space-y-3" action="/relatorios/montar"><input type="hidden" name="fonte" value={f.chave} /><input type="hidden" name="gerar" value="1" />
            <fieldset><legend className="mb-1 text-xs font-semibold text-navy">Colunas (sem agrupar)</legend><div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-xs">{cols.map(c => <label key={c.chave} className="flex items-center gap-1"><input type="checkbox" name="c" value={c.chave} defaultChecked={d.colunas.includes(c.chave)} /> {c.rotulo}</label>)}</div></fieldset>
            <fieldset className="space-y-2"><legend className="mb-1 text-xs font-semibold text-navy">Filtros</legend>
              {escopo === null && <Field label="Unidade"><Select name="u" defaultValue={d.unidade ?? ""}><option value="">Rede</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>}
              {fls.map(x => {
                if (x.tipo === "multi") { const ops = typeof x.opcoes === "string" ? dyn[x.opcoes] : x.opcoes ?? {}; const sel = d.filtros[x.chave] ?? [];
                  return Object.keys(ops).length > 12 ? <Field key={x.chave} label={`${x.rotulo} (Ctrl para vários)`}><select name={`f_${x.chave}`} multiple defaultValue={sel} className="h-24 w-full rounded-md border border-line p-1 text-xs">{Object.entries(ops).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                    : <div key={x.chave}><div className="text-xs text-slate-600">{x.rotulo}</div><div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">{Object.entries(ops).map(([k, v]) => <label key={k} className="flex items-center gap-1"><input type="checkbox" name={`f_${x.chave}`} value={k} defaultChecked={sel.includes(k)} /> {v}</label>)}</div></div>; }
                if (x.tipo === "periodo") return <div key={x.chave}><div className="text-xs text-slate-600">{x.rotulo}</div><div className="grid grid-cols-2 gap-1"><Input type="date" name={`f_${x.chave}_de`} defaultValue={d.periodos[x.chave]?.de ?? ""} aria-label={`${x.rotulo} — de`} /><Input type="date" name={`f_${x.chave}_ate`} defaultValue={d.periodos[x.chave]?.ate ?? ""} aria-label={`${x.rotulo} — até`} /></div></div>;
                return <Field key={x.chave} label={x.rotulo}><Input name={`f_${x.chave}`} defaultValue={d.textos[x.chave] ?? ""} /></Field>;
              })}
            </fieldset>
            <fieldset className="space-y-2"><legend className="mb-1 text-xs font-semibold text-navy">Agrupar e medir</legend>
              <div className="grid grid-cols-2 gap-2"><Field label="Agrupar por (linhas)"><Select name="g" defaultValue={d.linhas ?? ""}><option value="">— lista, sem agrupar —</option>{agrupaveis.map(c => <option key={c.chave} value={c.chave}>{c.rotulo}</option>)}</Select></Field>
                <Field label="Quebrar por (colunas)"><Select name="g2" defaultValue={d.colunasPor ?? ""}><option value="">—</option>{agrupaveis.map(c => <option key={c.chave} value={c.chave}>{c.rotulo}</option>)}</Select></Field></div>
              <div className="grid grid-cols-2 gap-2"><Field label="Medida"><Select name="m" defaultValue={d.metrica}><option value="contar">Contar {f.contar.toLowerCase()}</option>{somaveis.map(c => <option key={`s${c.chave}`} value={`somar:${c.chave}`}>Somar {c.rotulo.toLowerCase()}</option>)}{somaveis.map(c => <option key={`m${c.chave}`} value={`media:${c.chave}`}>Média de {c.rotulo.toLowerCase()}</option>)}</Select></Field>
                <Field label="Ordenar"><Select name="o" defaultValue={d.ordem}><option value="valor">pelo valor (maior primeiro)</option><option value="rotulo">pelo nome do grupo</option></Select></Field></div>
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="graf" value="1" defaultChecked={d.grafico} /> Mostrar gráfico</label>
            </fieldset>
            <Btn>Gerar relatório</Btn>
          </form>
        </Card>
        <div className="min-w-0 space-y-4">
          <Card title={`${f.nome}${r.agrupado ? ` — ${r.metricaRotulo.toLowerCase()} por ${r.colunas.map(c => c.rotulo.toLowerCase()).join(" × ")}` : ""}`}>
            <div className="mb-3 flex flex-wrap gap-2"><div className="rounded-md border border-line bg-mist px-3 py-1.5"><div className="text-[11px] text-slate-600">{r.metricaRotulo}</div><div className="font-semibold tabular-nums text-navy">{num(r.total, r.tipoMetrica)}</div></div>
              <div className="min-w-0 flex-1 rounded-md border border-line px-3 py-1.5 text-[11px] text-slate-600"><b>Filtros:</b> {r.descricaoFiltros}{d.unidade ? ` · ${units.find(u => u.id === d.unidade)?.nome ?? "sua unidade"}` : " · Rede"}</div></div>
            {r.agrupado && d.grafico && r.serie.length > 0 && <div className="mb-3">
              <BarrasH rotulo={`${r.metricaRotulo} por ${r.colunas[0].rotulo.toLowerCase()}`} formato={v => num(v, r.tipoMetrica)} max={maxSerie || undefined} largRotulo="11rem" itens={r.serie.map(x => ({ rotulo: x.rotulo, valor: x.valor, cor: COR.acao, segmentos: x.partes?.map((p, i) => ({ valor: p.valor, cor: corSerie(i), rotulo: p.rotulo })) }))} />
              {partesRot.length > 0 && <Legenda itens={partesRot.map((p, i) => ({ rotulo: p, cor: corSerie(i), tipo: "barra" as const }))} />}
              {r.serie.length >= 30 && <p className="mt-1 text-[11px] text-slate-500">O gráfico mostra os 30 primeiros grupos; a tabela e o CSV trazem todos.</p>}
            </div>}
            <AjusteTabela className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-mist text-xs text-slate-600"><tr>{r.tabela.cabecalho.map((c, i) => <th key={i} className={`px-2 py-1.5 font-medium ${i === 0 ? "text-left" : r.agrupado ? "text-right" : "text-left"}`}>{c}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">{r.tabela.linhas.length === 0 ? <tr><td colSpan={r.tabela.cabecalho.length} className="px-2 py-3 text-center text-slate-500">Nada encontrado com estes filtros.</td></tr> : r.tabela.linhas.map((l, i) => <tr key={i}>{l.map((v, j) => { const c = r.agrupado ? null : r.colunas[j]; const t: TipoCol = c ? c.tipo : j === 0 ? "texto" : r.tipoMetrica;
                return <td key={j} className={`px-2 py-1.5 ${j > 0 && r.agrupado ? "text-right tabular-nums" : ""} ${c && (c.tipo === "numero" || c.tipo === "moeda") ? "tabular-nums" : ""}`}>{v === null ? <span className="text-slate-400">—</span> : typeof v === "number" ? num(v, t) : v}</td>; })}</tr>)}</tbody></table></AjusteTabela>
            {r.limitado && <p className="mt-1 text-xs text-slate-500">Mostrando {r.agrupado ? "500 grupos" : "500 linhas"}; o CSV traz tudo.</p>}
            {!r.agrupado && <p className="mt-1 text-[11px] text-slate-500">Dica: escolha “Agrupar por” para transformar a lista em totais (e “Quebrar por” para uma tabela cruzada, ex.: unidade × vínculo).</p>}
          </Card>
          <Card title={`Relatórios salvos (${visiveis.length})`} className="print:hidden">
            <Table head={["Relatório", "Fonte", "De", "Atualizado", ""]} empty="Nenhum relatório salvo ainda — monte um e clique em “Salvar relatório”.">{visiveis.map(x => <tr key={x.id}><Td><Link className="text-acao" href={`/relatorios/montar?${x.definicao.qs}`}>{x.nome}</Link>{x.compartilhado && <span className="ml-1 rounded bg-mist px-1 text-[10px] text-slate-600">compartilhado</span>}</Td><Td className="text-xs">{FONTE[x.definicao.fonte]?.nome ?? x.definicao.fonte}</Td><Td className="text-xs">{x.dono_user_id === s.id ? "você" : x.dono}</Td><Td className="text-xs">{fmtData(x.updated_at.slice(0, 10))}</Td>
              <Td>{(x.dono_user_id === s.id || ["RH", "DIRECAO"].includes(s.role)) && <form action={excluirRelatorio}><input type="hidden" name="id" value={x.id} /><button className="text-xs text-slate-400 underline hover:text-erro">excluir</button></form>}</Td></tr>)}</Table>
          </Card>
        </div>
      </div>
    </Page>
  );
}
