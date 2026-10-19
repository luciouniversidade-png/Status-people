import { redirect } from "next/navigation";
import Link from "@/components/Link";
import { sql } from "@/db";
import { requireGestao, scopeUnit } from "@/lib/auth";
import { Page, Card, Flash, Field, Select, Btn, Input } from "@/components/ui";
import { kpisVisiveis, metasDoAno, podeEditarMeta, vePainelExecutivo } from "@/lib/kpi";
import { AREAS, ORDEM_AREAS, nomeKpi, porUnidade, type KpiDef } from "@/lib/kpi-catalogo";
import { fmtKpi } from "@/lib/formato";
import { getSettings, hoje } from "@/lib/utils";
import { salvarMeta } from "../actions";

export const dynamic = "force-dynamic";

/** Metas do ano por indicador e unidade (0 = rede). Indicadores de acompanhamento (sem melhor ou pior) não recebem meta. */
export default async function Metas({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireGestao(); if (!vePainelExecutivo(s)) redirect("/");
  const sp = await searchParams; const anoAtual = Number(hoje().slice(0, 4)); const ano = Number(sp.ano) >= 2020 && Number(sp.ano) <= anoAtual + 1 ? Number(sp.ano) : anoAtual;
  const escopo = scopeUnit(s); const cfg = await getSettings();
  const [defs, metas, units] = await Promise.all([kpisVisiveis(s), metasDoAno(ano), sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ORDER BY nome`]);
  const comMeta = defs.filter(k => k.sentido !== "NEUTRO");
  const cols = escopo === null ? [{ id: 0, nome: "Rede" }, ...units] : units.filter(u => u.id === escopo);
  const voltar = `/executivo/metas?ano=${ano}`;
  const ed = sp.editar ? comMeta.find(k => k.chave === sp.editar && podeEditarMeta(s, k)) : undefined; const edU = ed && escopo === null ? cols.find(u => u.id === Number(sp.unidade ?? -1) && (u.id === 0 || porUnidade(ed))) : undefined; const edM = ed && edU ? metas.get(`${ed.chave}|${edU.id}`) : undefined;
  const celula = (k: KpiDef, u: { id: number; nome: string }) => {
    if (u.id !== 0 && !porUnidade(k)) return <span className="text-xs text-slate-400">—</span>;
    const m = metas.get(`${k.chave}|${u.id}`); const herdada = !m && u.id !== 0 && k.agregacao === "TAXA" ? metas.get(`${k.chave}|0`) : undefined;
    const padrao = !m && !herdada && k.agregacao === "TAXA" ? k.metaPadrao?.(cfg) ?? null : null;
    const texto = m ? `${m.periodicidade === "ANUAL" ? "ano: " : ""}${fmtKpi(m.meta, k.unidade, true)}` : herdada ? `${fmtKpi(herdada.meta, k.unidade, true)}` : padrao !== null ? fmtKpi(padrao, k.unidade, true) : k.metaOrcamento ? "orçamento" : "—";
    const tipo = m ? "" : herdada ? "da rede" : padrao !== null ? "padrão" : k.metaOrcamento ? "" : "";
    const conteudo = <span className={`tabular-nums ${m ? "font-medium text-ink" : "text-slate-500"}`}>{texto}{tipo && <span className="block text-[10px] text-slate-400">{tipo}</span>}{m?.alerta !== null && m?.alerta !== undefined && <span className="block text-[10px] text-aviso">atenção {fmtKpi(m.alerta, k.unidade, true)}</span>}</span>;
    if (!podeEditarMeta(s, k) || escopo !== null) return conteudo;
    return <Link href={`/executivo/metas?ano=${ano}&editar=${encodeURIComponent(k.chave)}&unidade=${u.id}#editar`} className="block rounded px-1 hover:bg-sky-50" title="Definir a meta">{conteudo}</Link>;
  };
  return (
    <Page title={`Metas ${ano}`} sub="Uma meta por indicador e unidade. Razões (%, pontos, médias) sem meta própria usam a da rede; sem meta cadastrada, valem as metas padrão das configurações ou o orçamento." actions={<><Btn kind="ghost" href="/executivo">Painel Executivo</Btn><Btn kind="ghost" href="/executivo/dicionario">Dicionário</Btn></>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <form className="mb-4 flex items-end gap-2"><Field label="Ano"><Select name="ano" defaultValue={ano}>{[anoAtual + 1, anoAtual, anoAtual - 1, anoAtual - 2].map(a => <option key={a} value={a}>{a}</option>)}</Select></Field><Btn kind="ghost">Ver</Btn></form>
      {ed && edU && <Card title={`Meta ${ano} · ${nomeKpi(ed, cfg.matriculas.anoLetivo as number)} · ${edU.nome}`} className="mb-4 scroll-mt-4 border-acao">
        <div id="editar" />
        <form action={salvarMeta} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)_auto] lg:items-end"><input type="hidden" name="chave" value={ed.chave} /><input type="hidden" name="ano" value={ano} /><input type="hidden" name="unidade" value={edU.id} /><input type="hidden" name="voltar" value={voltar} />
          <Field label={ed.sentido === "DESCER" ? "Meta (no máximo)" : "Meta (no mínimo)"}><Input name="meta" required inputMode="decimal" autoFocus defaultValue={edM ? String(edM.meta).replace(".", ",") : ""} /></Field>
          <Field label="Atenção a partir de" hint="opcional"><Input name="alerta" inputMode="decimal" defaultValue={edM?.alerta !== null && edM?.alerta !== undefined ? String(edM.alerta).replace(".", ",") : ""} /></Field>
          {ed.agregacao === "SOMA" ? <Field label="A meta vale"><Select name="periodicidade" defaultValue={edM?.periodicidade ?? "MENSAL"}><option value="MENSAL">por mês</option><option value="ANUAL">no ano (proporcional ao mês)</option></Select></Field> : <div className="hidden lg:block" />}
          <Field label="Observação" hint="opcional"><Input name="obs" defaultValue={edM?.obs ?? ""} /></Field>
          <div className="flex gap-2"><Btn>Salvar meta</Btn><Btn kind="ghost" href={voltar}>Cancelar</Btn></div>
        </form>
        <p className="mt-2 text-xs text-slate-500">{ed.formula} Em branco no limite de atenção: atenção até {cfg.insights?.toleranciaPct ?? 10}% da meta.</p>
      </Card>}
      {ORDEM_AREAS.filter(a => comMeta.some(k => k.area === a)).map(a => (
        <Card key={a} title={AREAS[a].nome} className="mb-4">
          <div className="overflow-x-auto [-webkit-overflow-scrolling:touch]"><table className="w-full text-left text-xs sm:text-sm">
            <thead className="bg-mist text-xs text-slate-600"><tr><th className="sticky left-0 z-[1] bg-mist px-3 py-2 font-medium">Indicador</th>{cols.map(u => <th key={u.id} className="whitespace-nowrap px-3 py-2 text-center font-medium">{u.nome}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">{comMeta.filter(k => k.area === a).map(k => <tr key={k.chave}><th scope="row" className="sticky left-0 z-[1] bg-white px-3 py-2 text-left font-medium"><Link className="text-acao hover:underline" href={`/executivo/indicador/${encodeURIComponent(k.chave)}`}>{nomeKpi(k, cfg.matriculas.anoLetivo as number)}</Link><span className="block text-[10px] font-normal text-slate-500">{k.sentido === "DESCER" ? "quanto menor, melhor" : "quanto maior, melhor"}</span></th>{cols.map(u => <td key={u.id} className="px-3 py-2 text-center">{celula(k, u)}</td>)}</tr>)}</tbody>
          </table></div>
        </Card>
      ))}
      {defs.some(k => k.sentido === "NEUTRO") && <p className="text-xs text-slate-500">Indicadores de acompanhamento, sem meta: {defs.filter(k => k.sentido === "NEUTRO").map(k => nomeKpi(k, cfg.matriculas.anoLetivo as number)).join(", ")}.</p>}
    </Page>
  );
}
