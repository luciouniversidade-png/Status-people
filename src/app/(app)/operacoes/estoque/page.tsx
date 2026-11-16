import Link from "@/components/Link";
import { redirect } from "next/navigation";
import { requireSession, scopeUnit } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Flash, Btn, Field, Input, Select, Stat, Table, Td } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { fmtData, fmtDataHora, hoje, addDays, getSettings } from "@/lib/utils";
import * as K from "@/lib/estoque";
import { salvarLocal, salvarItem, salvarMinimo, movimentarEstoque, registrarInventario } from "./actions";

export const dynamic = "force-dynamic";
const ABAS: [string, string][] = [["painel", "Painel"], ["saldos", "Saldos"], ["movimentar", "Movimentar"], ["inventario", "Inventário"], ["historico", "Histórico"], ["itens", "Itens e locais"]];
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const q2 = (v: number) => (Math.round(v * 100) / 100).toLocaleString("pt-BR");

/** v34 · Estoque de materiais e EPIs: saldo por local, mínimo, validade dos lotes, CA dos EPIs, movimentações e inventário. */
export default async function Estoque({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); if (!K.veEstoque(s)) redirect("/sem-acesso?t=%2Foperacoes%2Festoque"); const sp = await searchParams;
  const cfg = await getSettings(); const u = scopeUnit(s); const aba = ABAS.some(a => a[0] === sp.aba) ? sp.aba! : "painel"; const pode = K.podeEstoque(s);
  const [locais, itens, epis, linhas, units] = await Promise.all([
    sql<{ id: number; nome: string; unidade: string; unit_id: number }[]>`SELECT l.id, l.nome, u.nome AS unidade, l.unit_id FROM stock_locations l JOIN units u ON u.id=l.unit_id WHERE l.ativo AND ${K.filtroLocais(s)} ORDER BY u.nome, l.nome`,
    sql<{ id: number; nome: string; categoria: string; unidade_medida: string; minimo_padrao: number; controla_validade: boolean; epi_id: number | null; custo_medio: number; ativo: boolean }[]>`SELECT id, nome, categoria, unidade_medida, minimo_padrao::float, controla_validade, epi_id, custo_medio::float, ativo FROM stock_items ORDER BY ativo DESC, categoria, nome`,
    sql<{ id: number; nome: string; ca: string | null; ca_validade: string | null }[]>`SELECT id, nome, ca, ca_validade::text FROM epi_items ORDER BY nome`,
    K.saldos(s, { locationId: sp.local ? Number(sp.local) : null, categoria: sp.cat ?? null, q: sp.q ?? null }),
    sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ${u === null ? sql`` : sql`WHERE id=${u}`} ORDER BY nome`,
  ]);
  const todas = sp.local || sp.cat || sp.q ? await K.saldos(s) : linhas;
  const baixo = todas.filter(l => l.minimo > 0 && l.saldo < l.minimo); const zerado = todas.filter(l => l.saldo === 0 && l.minimo > 0);
  const limVal = addDays(hoje(), Number(cfg.estoque.alertaValidadeDias)); const limCa = addDays(hoje(), Number(cfg.estoque.alertaCaDias));
  const lotes = await sql<{ id: number; item: string; local: string; unidade: string; lote: string | null; validade: string; saldo: number; um: string }[]>`SELECT t.id, i.nome AS item, l.nome AS local, u.nome AS unidade, t.lote, t.validade::text, t.saldo::float, i.unidade_medida AS um FROM stock_lots t JOIN stock_items i ON i.id=t.item_id JOIN stock_locations l ON l.id=t.location_id JOIN units u ON u.id=l.unit_id WHERE t.saldo > 0 AND t.validade IS NOT NULL AND t.validade <= ${limVal} AND ${K.filtroLocais(s)} ORDER BY t.validade`;
  const caVence = epis.filter(e => e.ca_validade && e.ca_validade <= limCa);
  const valor = todas.reduce((a, l) => a + l.saldo * l.custo_medio, 0);
  const abas = <div className="mb-3 flex flex-wrap gap-2 text-xs">{ABAS.map(([k, r]) => <Link key={k} href={`/operacoes/estoque?aba=${k}`} className={`rounded-full border px-2.5 py-1 ${aba === k ? "border-acao bg-sky-50 text-acao" : "border-line text-slate-600"}`}>{r}</Link>)}</div>;
  const optItens = itens.filter(i => i.ativo).map(i => <option key={i.id} value={i.id}>{i.nome} ({i.unidade_medida}){i.controla_validade ? " · validade" : ""}</option>);
  const optLocais = locais.map(l => <option key={l.id} value={l.id}>{l.unidade} · {l.nome}</option>);
  return (
    <Page title="Estoque" sub="Materiais de limpeza, cozinha, expediente, pedagógico, manutenção e EPIs por unidade e local. O que vence primeiro sai primeiro; a entrega de EPI dá baixa sozinha.">
      <Flash ok={sp.ok} erro={sp.erro} />{abas}
      {aba === "painel" ? <>
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat label="Abaixo do mínimo" value={<span className={baixo.length ? "text-erro" : "text-ok"}>{baixo.length}</span>} hint={zerado.length ? `${zerado.length} zerado(s)` : "item × local"} href="/operacoes/estoque?aba=saldos&baixo=1" />
          <Stat label="Lotes vencendo" value={<span className={lotes.length ? "text-aviso" : ""}>{lotes.length}</span>} hint={`em até ${cfg.estoque.alertaValidadeDias} dias`} />
          <Stat label="CA de EPI vencendo" value={<span className={caVence.length ? "text-aviso" : ""}>{caVence.length}</span>} hint={`em até ${cfg.estoque.alertaCaDias} dias`} />
          <Stat label="Itens × locais" value={todas.length} />
          <Stat label="Valor em estoque" value={<span className="text-base">{brl(valor)}</span>} hint="custo médio" />
        </div>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card title={`Comprar ou repor (${baixo.length})`}>{baixo.length === 0 ? <p className="text-sm text-ok">Tudo acima do mínimo.</p> : <ul className="divide-y divide-line text-sm">{baixo.map(l => <li key={`${l.item_id}-${l.location_id}`} className="flex flex-wrap justify-between gap-2 py-1.5"><span className="min-w-0">{l.nome}<span className="block text-[11px] text-slate-500">{l.unidade} · {l.local}</span></span><span className="text-xs"><b className={l.saldo === 0 ? "text-erro" : "text-aviso"}>{q2(l.saldo)}</b> / mín. {q2(l.minimo)} {l.unidade_medida}</span></li>)}</ul>}</Card>
          <Card title={`Validade (${lotes.length + caVence.length})`}>{lotes.length + caVence.length === 0 ? <p className="text-sm text-ok">Nada vencendo.</p> : <ul className="divide-y divide-line text-sm">
            {lotes.map(l => <li key={l.id} className="flex flex-wrap justify-between gap-2 py-1.5"><span className="min-w-0">{l.item}{l.lote ? ` · lote ${l.lote}` : ""}<span className="block text-[11px] text-slate-500">{l.unidade} · {l.local} · {q2(l.saldo)} {l.um}</span></span><span className={`text-xs ${l.validade < hoje() ? "font-semibold text-erro" : "text-aviso"}`}>{l.validade < hoje() ? "vencido em" : "vence"} {fmtData(l.validade)}</span></li>)}
            {caVence.map(e => <li key={`ca${e.id}`} className="flex flex-wrap justify-between gap-2 py-1.5"><span>EPI {e.nome} · CA {e.ca ?? "—"}</span><span className={`text-xs ${e.ca_validade! < hoje() ? "font-semibold text-erro" : "text-aviso"}`}>CA {e.ca_validade! < hoje() ? "vencido em" : "vence"} {fmtData(e.ca_validade!)}</span></li>)}</ul>}</Card>
        </div></> : null}
      {aba === "saldos" ? <Card title={`Saldos (${linhas.length})`} actions={<form className="flex flex-wrap items-end gap-1.5"><input type="hidden" name="aba" value="saldos" /><Select name="local" defaultValue={sp.local ?? ""} aria-label="Local" className="!w-48 !py-1 !text-xs"><option value="">todos os locais</option>{optLocais}</Select><Select name="cat" defaultValue={sp.cat ?? ""} aria-label="Categoria" className="!w-40 !py-1 !text-xs"><option value="">todas as categorias</option>{(cfg.estoque.categorias as string[]).map(c => <option key={c}>{c}</option>)}</Select><Input name="q" defaultValue={sp.q ?? ""} placeholder="item" aria-label="Buscar item" className="!w-32 !py-1 !text-xs" /><Btn small kind="ghost">Filtrar</Btn><a className="text-xs text-acao underline" href="/api/export/estoque">CSV</a></form>}>
        <Table head={["Item", "Local", "Saldo", "Mínimo", "Validade", "Valor"]} empty="Nenhum item neste filtro." denso>
          {(sp.baixo ? linhas.filter(l => l.minimo > 0 && l.saldo < l.minimo) : linhas).map(l => <tr key={`${l.item_id}-${l.location_id}`}>
            <Td><span className="font-medium">{l.nome}</span><span className="block text-[11px] text-slate-500">{l.categoria}{l.epi ? ` · EPI ${l.epi}` : ""}</span></Td><Td className="text-xs">{l.unidade} · {l.local}</Td>
            <Td className={`tabular-nums ${l.minimo > 0 && l.saldo < l.minimo ? "font-semibold text-erro" : ""}`}>{q2(l.saldo)} {l.unidade_medida}</Td>
            <Td>{pode ? <form action={salvarMinimo} className="flex items-center gap-1"><input type="hidden" name="itemId" value={l.item_id} /><input type="hidden" name="locationId" value={l.location_id} /><Input name="minimo" defaultValue={String(l.minimo)} aria-label="Mínimo" className="!w-16 !py-0.5 !text-xs" /><Btn small kind="ghost">ok</Btn></form> : q2(l.minimo)}</Td>
            <Td className={`text-xs ${l.vence && l.vence <= limVal ? "text-aviso" : ""}`}>{l.vence ? fmtData(l.vence) : "—"}</Td><Td className="text-xs tabular-nums">{brl(l.saldo * l.custo_medio)}</Td></tr>)}
        </Table></Card> : null}
      {aba === "movimentar" ? (pode ? <Card title="Registrar movimentação">{itens.length && locais.length ? <form action={movimentarEstoque} className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4"><input type="hidden" name="voltar" value="/operacoes/estoque?aba=movimentar" />
          <Field label="Tipo"><Select name="tipo"><option value="ENTRADA">{K.TIPO_MOV.ENTRADA}</option><option value="SAIDA">{K.TIPO_MOV.SAIDA}</option><option value="TRANSFERENCIA">{K.TIPO_MOV.TRANSFERENCIA}</option><option value="PERDA">{K.TIPO_MOV.PERDA}</option></Select></Field>
          <Field label="Item"><Select name="itemId">{optItens}</Select></Field><Field label="Local"><Select name="locationId">{optLocais}</Select></Field><Field label="Quantidade"><Input name="quantidade" inputMode="decimal" required /></Field>
          <Field label="Custo unitário (entrada, R$)"><Input name="custo" inputMode="decimal" /></Field><Field label="Lote (opcional)"><Input name="lote" maxLength={40} /></Field><Field label="Validade (item com validade)"><Input type="date" name="validade" /></Field>
          <Field label="Destino (transferência)"><Select name="destinoId" defaultValue=""><option value="">—</option>{optLocais}</Select></Field>
          <Field label="Motivo / observação" className="sm:col-span-2 lg:col-span-3"><Input name="motivo" maxLength={300} placeholder="ex.: requisição da cozinha, nota fiscal 1234, vencido" /></Field>
          <div className="flex items-end"><Btn>Registrar</Btn></div></form> : <p className="text-sm text-slate-600">Cadastre um local e um item primeiro em <Link className="text-acao underline" href="/operacoes/estoque?aba=itens">Itens e locais</Link>.</p>}
          <p className="mt-2 text-[11px] text-slate-500">Saída e perda tiram primeiro do lote que vence antes. Entrega de EPI: registre em Treinamentos NR, brigada e EPI — a baixa no estoque sai junto.</p></Card> : <Card><p className="text-sm text-slate-600">Você consulta o estoque; quem movimenta é Operações, a direção da unidade, RH ou Direção.</p></Card>) : null}
      {aba === "inventario" ? <InventarioAba s={s} locais={locais} localId={sp.local ? Number(sp.local) : locais[0]?.id ?? null} pode={pode} /> : null}
      {aba === "historico" ? <HistoricoAba s={s} /> : null}
      {aba === "itens" ? <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] xl:items-start">
        <Card title={`Itens (${itens.length})`} actions={pode ? <Modal label="Novo item" title="Novo item de estoque" kind="primary"><FormItem cats={cfg.estoque.categorias as string[]} epis={epis} locais={locais} /></Modal> : null}>
          <ul className="divide-y divide-line text-sm">{itens.map(i => <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5"><span className={`min-w-0 ${i.ativo ? "" : "text-slate-400"}`}>{i.nome}<span className="block text-[11px] text-slate-500">{i.categoria} · {i.unidade_medida} · mín. padrão {q2(i.minimo_padrao)}{i.controla_validade ? " · controla validade" : ""}{i.epi_id ? ` · EPI ${epis.find(e => e.id === i.epi_id)?.nome ?? ""}` : ""} · custo médio {brl(i.custo_medio)}{i.ativo ? "" : " · inativo"}</span></span>{pode ? <Modal label="editar" kind="link" title={`Editar ${i.nome}`}><FormItem cats={cfg.estoque.categorias as string[]} epis={epis} locais={locais} item={i} /></Modal> : null}</li>)}</ul>
        </Card>
        <Card title={`Locais (${locais.length})`} actions={pode ? <Modal label="Novo local" title="Novo local de estoque"><form action={salvarLocal} className="space-y-2"><Field label="Unidade"><Select name="unitId">{units.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field><Field label="Nome"><Input name="nome" required placeholder="ex.: Almoxarifado, Cozinha, Limpeza" /></Field><Btn small>Criar</Btn></form></Modal> : null}>
          {locais.length === 0 ? <p className="text-sm text-slate-500">Nenhum local. Crie o primeiro (ex.: Almoxarifado da unidade).</p> : <ul className="divide-y divide-line text-sm">{locais.map(l => <li key={l.id} className="py-1.5">{l.unidade} · {l.nome}</li>)}</ul>}
        </Card></div> : null}
    </Page>
  );
}

function FormItem({ cats, epis, locais, item }: { cats: string[]; epis: { id: number; nome: string }[]; locais: { id: number; nome: string; unidade: string }[]; item?: { id: number; nome: string; categoria: string; unidade_medida: string; minimo_padrao: number; controla_validade: boolean; epi_id: number | null; ativo: boolean } }) {
  return <form action={salvarItem} className="space-y-2">{item ? <input type="hidden" name="id" value={item.id} /> : null}
    <Field label="Item"><Input name="nome" defaultValue={item?.nome ?? ""} required placeholder="ex.: Detergente neutro 5 L" /></Field>
    <div className="grid grid-cols-2 gap-2"><Field label="Categoria"><Select name="categoria" defaultValue={item?.categoria ?? cats[0]}>{cats.map(c => <option key={c}>{c}</option>)}</Select></Field><Field label="Unidade de medida"><Select name="um" defaultValue={item?.unidade_medida ?? "un"}>{K.UNIDADES_MEDIDA.map(x => <option key={x}>{x}</option>)}</Select></Field>
      <Field label="Mínimo padrão (por local)"><Input name="minimo" inputMode="decimal" defaultValue={item ? String(item.minimo_padrao) : "0"} /></Field><Field label="É EPI?"><Select name="epiId" defaultValue={item?.epi_id ? String(item.epi_id) : ""}><option value="">não</option>{epis.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}</Select></Field></div>
    <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" name="validade" value="1" defaultChecked={item?.controla_validade} /> controla validade por lote (alimentos, produtos químicos, kits de primeiros socorros)</label>
    <Field label="Guardado em (locais)"><select name="locais" multiple size={5} className="w-full rounded-md border border-line px-2 py-1 text-sm">{locais.map(l => <option key={l.id} value={l.id}>{l.unidade} · {l.nome}</option>)}</select></Field>
    {item ? <Field label="Situação"><Select name="ativo" defaultValue={item.ativo ? "1" : "0"}><option value="1">ativo</option><option value="0">inativo</option></Select></Field> : null}
    <Btn small>Salvar item</Btn></form>;
}

async function InventarioAba({ s, locais, localId, pode }: { s: Awaited<ReturnType<typeof requireSession>>; locais: { id: number; nome: string; unidade: string }[]; localId: number | null; pode: boolean }) {
  if (!localId) return <Card><p className="text-sm text-slate-500">Nenhum local cadastrado.</p></Card>;
  const itens = await K.saldos(s, { locationId: localId });
  return <Card title="Inventário (contagem física)" actions={<span className="flex flex-wrap gap-1">{locais.map(l => <Link key={l.id} href={`/operacoes/estoque?aba=inventario&local=${l.id}`} className={`rounded-full border px-2 py-0.5 text-xs ${l.id === localId ? "border-acao bg-sky-50 text-acao" : "border-line text-slate-600"}`}>{l.unidade} · {l.nome}</Link>)}</span>}>
    {itens.length === 0 ? <p className="text-sm text-slate-500">Nenhum item guardado neste local.</p> : <form action={registrarInventario} className="space-y-2"><input type="hidden" name="locationId" value={localId} />
      <Table head={["Item", "No sistema", "Contado"]} denso>{itens.map(i => <tr key={i.item_id}><Td>{i.nome}<span className="block text-[11px] text-slate-500">{i.categoria}</span></Td><Td className="tabular-nums">{q2(i.saldo)} {i.unidade_medida}</Td><Td>{pode ? <Input name={`q_${i.item_id}`} inputMode="decimal" aria-label={`Contado: ${i.nome}`} className="!w-24 !py-1" /> : "—"}</Td></tr>)}</Table>
      {pode ? <div className="flex flex-wrap items-end gap-2"><Field label="Motivo" className="min-w-[14rem] flex-1"><Input name="motivo" defaultValue={`Inventário de ${fmtData(hoje())}`} /></Field><Btn>Registrar contagem</Btn></div> : null}
      <p className="text-[11px] text-slate-500">Deixe em branco o que não contou. Cada diferença vira um ajuste no histórico, com o seu nome e o motivo.</p></form>}
  </Card>;
}

async function HistoricoAba({ s }: { s: Awaited<ReturnType<typeof requireSession>> }) {
  const movs = await sql<{ id: number; at: string; tipo: string; item: string; local: string; quantidade: number; sinal: number; saldo_apos: number | null; um: string; motivo: string | null; user_nome: string | null; pessoa: string | null }[]>`
    SELECT m.id, m.at::text, m.tipo, i.nome AS item, l.nome AS local, m.quantidade::float, m.sinal, m.saldo_apos::float, i.unidade_medida AS um, m.motivo, m.user_nome, e.nome AS pessoa
    FROM stock_moves m JOIN stock_items i ON i.id=m.item_id JOIN stock_locations l ON l.id=m.location_id LEFT JOIN employees e ON e.id=m.employee_id WHERE ${K.filtroLocais(s)} ORDER BY m.at DESC, m.id DESC LIMIT 200`;
  return <Card title="Últimas movimentações"><Table head={["Quando", "Movimento", "Item", "Qtd.", "Saldo depois", "Quem"]} empty="Nenhuma movimentação." denso>
    {movs.map(m => <tr key={m.id}><Td className="whitespace-nowrap text-xs">{fmtDataHora(m.at)}</Td><Td className="text-xs">{K.TIPO_MOV[m.tipo] ?? m.tipo}{m.motivo ? <span className="block text-[11px] text-slate-500 [overflow-wrap:anywhere]">{m.motivo}</span> : null}{m.pessoa ? <span className="block text-[11px] text-slate-500">para {m.pessoa}</span> : null}</Td><Td className="text-xs">{m.item}<span className="block text-[11px] text-slate-500">{m.local}</span></Td><Td className={`tabular-nums text-xs ${m.sinal > 0 ? "text-ok" : "text-erro"}`}>{m.sinal > 0 ? "+" : "−"}{q2(m.quantidade)} {m.um}</Td><Td className="tabular-nums text-xs">{m.saldo_apos !== null ? q2(m.saldo_apos) : "—"}</Td><Td className="text-xs">{m.user_nome ?? "—"}</Td></tr>)}
  </Table></Card>;
}
