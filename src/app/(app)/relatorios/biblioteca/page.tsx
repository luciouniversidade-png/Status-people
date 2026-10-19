import Link from "@/components/Link";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireStaff, scopeUnit } from "@/lib/auth";
import { Page, Card, Flash, Field, Input, Select, Textarea, Btn } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { PrintButton } from "@/components/PrintButton";
import { RELATORIOS, REL, podeRelatoriosRh } from "@/lib/relatorios-rh";
import { hoje } from "@/lib/utils";
import { somaMeses } from "@/lib/gestao-calc";
import { favoritarRelatorio, agendarRelatorio, pedirRelatorio } from "./actions";

export const dynamic = "force-dynamic";

/** T-045 · Biblioteca de relatórios do RH: busca, favoritos, parâmetros (mês e unidade), export CSV, agendamento mensal e pedido de relatório novo. */
export default async function Biblioteca({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaff(); if (!podeRelatoriosRh(s)) redirect("/relatorios"); const sp = await searchParams; const escopo = scopeUnit(s);
  const units = escopo === null ? await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ORDER BY nome` : [];
  const [pref] = await sql<{ favoritos: string[] | null }[]>`SELECT favoritos FROM user_prefs WHERE user_id=${s.id}`; const favs = new Set((Array.isArray(pref?.favoritos) ? pref!.favoritos : []).filter(x => x.startsWith("rel:")).map(x => x.slice(4)));
  const agend = await sql<{ relatorio: string; dia: number; ativo: boolean; ultimo_envio: string | null }[]>`SELECT relatorio, dia, ativo, ultimo_envio::text FROM report_schedules WHERE user_id=${s.id}`;
  const q = (sp.q ?? "").trim().toLowerCase(); const lista = RELATORIOS.filter(r => !q || `${r.nome} ${r.descricao} ${r.area}`.toLowerCase().includes(q)).sort((a, b) => Number(favs.has(b.chave)) - Number(favs.has(a.chave)));
  const sel = sp.r ? REL[sp.r] ?? null : null; const mes = /^\d{4}-\d{2}$/.test(sp.mes ?? "") ? sp.mes! : somaMeses(hoje().slice(0, 7), 0); const unitId = escopo ?? (Number(sp.unidade) || null);
  const tab = sel ? await sel.gerar(s, { mes, unitId }) : null; const ag = sel ? agend.find(a => a.relatorio === sel.chave && a.ativo) : null;
  const voltar = `/relatorios/biblioteca?${new URLSearchParams({ ...(sel ? { r: sel.chave, mes } : {}), ...(unitId && escopo === null ? { unidade: String(unitId) } : {}), ...(q ? { q } : {}) })}`;
  const areas = [...new Set(lista.map(r => r.area))];
  return (
    <Page title="Relatórios do RH" sub="O fim do “me manda uma planilha”: relatórios nomeados, um clique, export. Cada um usa a mesma regra da tela correspondente — diferença entre relatório e tela é defeito."
      actions={<div className="flex flex-wrap gap-2 print:hidden"><Btn kind="ghost" href="/relatorios">Relatório mensal (DP)</Btn><Modal label="Pedir relatório novo" small={false} title="Pedir relatório novo"><form action={pedirRelatorio} className="space-y-2"><input type="hidden" name="voltar" value={voltar} /><Field label="Nome do relatório"><Input name="titulo" required /></Field><Field label="Para que serve e quais colunas"><Textarea name="descricao" required minLength={10} /></Field><p className="text-xs text-slate-500">Vira item de produto na fila de decisões da Direção (não uma planilha paralela).</p><Btn small>Enviar pedido</Btn></form></Modal></div>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start">
        <Card title={`Biblioteca (${lista.length})`}>
          <form className="mb-2 print:hidden" action="/relatorios/biblioteca">{sel && <input type="hidden" name="r" value={sel.chave} />}<label className="sr-only" htmlFor="q">Buscar relatório</label><Input id="q" name="q" defaultValue={sp.q ?? ""} placeholder="Buscar: headcount, férias, ausência…" /></form>
          {areas.map(a => <div key={a} className="mb-2"><h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{a}</h3><ul>{lista.filter(r => r.area === a).map(r => <li key={r.chave} className="flex items-center justify-between gap-1"><Link href={`/relatorios/biblioteca?r=${r.chave}&mes=${mes}${unitId && escopo === null ? `&unidade=${unitId}` : ""}`} className={`min-w-0 flex-1 truncate rounded px-1.5 py-1 text-sm ${sel?.chave === r.chave ? "bg-acao text-white" : "text-ink hover:bg-mist"}`}>{r.nome}</Link><form action={favoritarRelatorio} className="print:hidden"><input type="hidden" name="chave" value={r.chave} /><input type="hidden" name="voltar" value={voltar} /><button aria-label={favs.has(r.chave) ? `Tirar ${r.nome} dos favoritos` : `Favoritar ${r.nome}`} title={favs.has(r.chave) ? "Tirar dos favoritos" : "Favoritar"} className={`px-1 text-base leading-none ${favs.has(r.chave) ? "text-amber-500" : "text-slate-300 hover:text-amber-400"}`}>★</button></form></li>)}</ul></div>)}
        </Card>
        {!sel || !tab ? <Card title="Escolha um relatório"><p className="text-sm text-slate-600">Cada relatório tem descrição, parâmetros (mês e unidade) e export CSV (abre direto no Excel). Favoritos sobem para o topo; o agendamento manda o relatório do mês anterior todo mês.</p></Card> :
          <Card title={sel.nome} actions={<div className="flex flex-wrap gap-2 print:hidden"><a href={`/api/relatorios/${sel.chave}?mes=${mes}${unitId ? `&unidade=${unitId}` : ""}`} className="inline-flex items-center rounded-md border border-line bg-white px-2.5 py-1 text-xs font-medium text-navy hover:bg-mist">Exportar CSV</a><PrintButton />{s.role !== "LEITURA" && <Modal label={ag ? `Agendado · dia ${ag.dia}` : "Agendar"} title={`Agendar · ${sel.nome}`}><form action={agendarRelatorio} className="space-y-2"><input type="hidden" name="chave" value={sel.chave} /><input type="hidden" name="voltar" value={voltar} /><input type="hidden" name="unitId" value={unitId ?? ""} /><Field label="Todo dia (1 a 28)"><Input name="dia" type="number" min={1} max={28} defaultValue={ag?.dia ?? 5} /></Field><p className="text-xs text-slate-500">No dia, o relatório do mês anterior chega como notificação (e por e-mail, quando o envio estiver configurado). Ex.: mensal ao conselho.</p><div className="flex gap-2"><Btn small>Agendar</Btn>{ag && <Btn small kind="ghost" name="acao" value="cancelar">Cancelar agendamento</Btn>}</div></form></Modal>}</div>}>
            <p className="text-sm text-slate-600">{sel.descricao}</p>
            <form className="my-3 flex flex-wrap items-end gap-2 print:hidden" action="/relatorios/biblioteca"><input type="hidden" name="r" value={sel.chave} /><Field label="Mês"><Input type="month" name="mes" defaultValue={mes} /></Field>{escopo === null && <Field label="Unidade"><Select name="unidade" defaultValue={unitId ?? ""}><option value="">Rede</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>}<Btn small kind="ghost">Gerar</Btn></form>
            <p className="mb-2 hidden text-xs print:block">{units.find(u => u.id === unitId)?.nome ?? (escopo ? "Sua unidade" : "Rede")} · {mes.split("-").reverse().join("/")}</p>
            <div className="mb-3 flex flex-wrap gap-2">{tab.resumo.map(r => <div key={r.rotulo} className="rounded-md border border-line bg-mist px-3 py-1.5"><div className="text-[11px] text-slate-600">{r.rotulo}</div><div className="font-semibold tabular-nums text-navy">{r.valor}</div></div>)}</div>
            <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-sm"><thead className="bg-mist text-xs text-slate-600"><tr>{tab.colunas.map(c => <th key={c} className="px-2 py-1.5 text-left font-medium">{c}</th>)}</tr></thead><tbody className="divide-y divide-line">{tab.linhas.length === 0 ? <tr><td colSpan={tab.colunas.length} className="px-2 py-3 text-center text-slate-500">Nada neste recorte.</td></tr> : tab.linhas.slice(0, 500).map((l, i) => <tr key={i}>{l.map((c, j) => <td key={j} className="px-2 py-1.5">{c ?? "—"}</td>)}</tr>)}</tbody></table></div>
            {tab.linhas.length > 500 && <p className="mt-1 text-xs text-slate-500">Mostrando 500 de {tab.linhas.length} linhas; o CSV traz todas.</p>}
            {tab.nota && <p className="mt-2 text-[11px] text-slate-500">{tab.nota}</p>}
          </Card>}
      </div>
    </Page>
  );
}
