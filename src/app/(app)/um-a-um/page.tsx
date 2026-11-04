// v31 · 1:1 — conversas individuais: com quem conversar (última e próxima), a agenda, marcar com temas e a cadência por líder.
import Link from "@/components/Link";
import { requireSession, scopeUnit } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Table, Td, Badge, Flash, Field, Input, Select, Textarea, Btn, Stat } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { BarrasH, COR } from "@/components/graficos";
import { getSettings, hoje, fmtData, addDays } from "@/lib/utils";
import { colegasConversa, rotuloColega, cadencia, diasDesde, STATUS_1A1, TOM_1A1, RECORRENCIA, umAUm } from "@/lib/conversas";
import { FormMarcar } from "./_form";

export const dynamic = "force-dynamic";
const ABAS: [string, string][] = [["colegas", "Colegas"], ["agenda", "Agenda"], ["indicadores", "Indicadores"]];

export default async function UmAUm({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const sp = await searchParams; const h = hoje(); const cfg = await getSettings();
  const aba = ABAS.some(a => a[0] === sp.aba) ? sp.aba! : "colegas"; const amplo = ["RH", "DIRECAO", "DIRETOR_UNIDADE"].includes(s.role); const u = scopeUnit(s);
  const verIndicadores = amplo || s.role === "GESTOR"; const marcada = sp.marcada ? await umAUm(Number(sp.marcada)) : null;
  const minhas = await sql<{ id: number; employee_id: number; nome: string; organizador_user_id: number; organizador_nome: string | null; data: string; inicio: string; fim: string; titulo: string; temas: string[]; status: string; pauta_n: number; sou_org: boolean }[]>`
    SELECT o.id, o.employee_id, e.nome, o.organizador_user_id, o.organizador_nome, o.data::text, o.inicio, o.fim, o.titulo, o.temas, o.status, jsonb_array_length(o.pauta)::int AS pauta_n, (o.organizador_user_id=${s.id}) AS sou_org
    FROM one_on_ones o JOIN employees e ON e.id=o.employee_id WHERE (o.organizador_user_id=${s.id} OR o.employee_id=${s.employeeId ?? -1}) AND o.data >= ${addDays(h, -120)} ORDER BY o.data DESC, o.inicio DESC LIMIT 200`;
  const proximas = minhas.filter(m => m.status === "MARCADA" && m.data >= h).sort((a, b) => (a.data + a.inicio).localeCompare(b.data + b.inicio));
  const semRegistro = minhas.filter(m => m.status === "MARCADA" && m.data < h);
  const colegas = await colegasConversa(s);
  const comQuem = new Set(minhas.map(m => (m.sou_org ? m.employee_id : -1)));
  const lista = colegas.filter(c => c.relacao !== "COLEGA" || comQuem.has(c.id));
  const cad = await cadencia(lista.map(c => c.id));
  const fam = lista.length ? await sql<{ id: number; familia: string | null }[]>`SELECT e.id, p.familia FROM employees e LEFT JOIN positions p ON p.id=e.position_id WHERE e.id = ANY(${lista.map(c => c.id)}::int[])` : [];
  const alvo = (id: number) => { const f = fam.find(x => x.id === id)?.familia ?? "PADRAO"; const t = cfg.desempenho.checkinDias as Record<string, number>; return t[f] ?? t.PADRAO ?? 45; };
  const outro = (m: (typeof minhas)[number]) => (m.sou_org ? m.nome : m.organizador_nome ?? "—");

  // indicadores por líder (cadência): só contagens e datas — o conteúdo das conversas fica entre as duas pessoas
  const lideres = verIndicadores && aba === "indicadores" ? await sql<{ id: number; nome: string; unidade: string; liderados: number; em_dia: number; marcadas: number; realizadas: number; canceladas: number; sem_registro: number }[]>`
    WITH eq AS (SELECT g.id AS gid, e.id AS eid, coalesce((SELECT (${JSON.stringify(cfg.desempenho.checkinDias)}::jsonb ->> coalesce(p.familia,'PADRAO'))::int), (${JSON.stringify(cfg.desempenho.checkinDias)}::jsonb ->> 'PADRAO')::int, 45) AS alvo
      FROM employees g JOIN employees e ON e.gestor_id=g.id AND e.situacao IN ('ATIVO','FERIAS','AFASTADO') LEFT JOIN positions p ON p.id=e.position_id WHERE g.situacao <> 'DESLIGADO' ${u === null ? sql`` : sql`AND g.unit_id=${u}`} ${s.role === "GESTOR" ? sql`AND g.id=${s.employeeId ?? -1}` : sql``})
    SELECT g.id, g.nome, un.nome AS unidade, count(*)::int AS liderados,
      count(*) FILTER (WHERE greatest((SELECT max(o.data) FROM one_on_ones o WHERE o.employee_id=eq.eid AND o.status='REALIZADA'), (SELECT max(c.data) FROM perf_checkins c WHERE c.employee_id=eq.eid AND c.tipo='REUNIAO')) >= ${h}::date - eq.alvo)::int AS em_dia,
      (SELECT count(*) FROM one_on_ones o JOIN employees x ON x.id=o.employee_id WHERE x.gestor_id=g.id AND o.status='MARCADA' AND o.data BETWEEN ${h} AND ${addDays(h, 30)})::int AS marcadas,
      (SELECT count(*) FROM one_on_ones o JOIN employees x ON x.id=o.employee_id WHERE x.gestor_id=g.id AND o.status='REALIZADA' AND o.data >= ${addDays(h, -90)})::int AS realizadas,
      (SELECT count(*) FROM one_on_ones o JOIN employees x ON x.id=o.employee_id WHERE x.gestor_id=g.id AND o.status='CANCELADA' AND o.data >= ${addDays(h, -90)})::int AS canceladas,
      (SELECT count(*) FROM one_on_ones o JOIN employees x ON x.id=o.employee_id WHERE x.gestor_id=g.id AND o.status='MARCADA' AND o.data < ${h})::int AS sem_registro
    FROM eq JOIN employees g ON g.id=eq.gid JOIN units un ON un.id=g.unit_id GROUP BY g.id, g.nome, un.nome ORDER BY un.nome, g.nome` : [];
  const totLid = lideres.reduce((a, l) => a + l.liderados, 0); const totDia = lideres.reduce((a, l) => a + l.em_dia, 0);
  const link = (k: string) => `/um-a-um?aba=${k}`;
  return (
    <Page title="1:1 — conversas individuais" sub="Marque a conversa com data, horário e temas; os dois montam a pauta; depois de conversar, os combinados entram no acompanhamento do painel. O que se fala na 1:1 fica entre as duas pessoas."
      actions={<div className="flex flex-wrap gap-2"><Modal label="Marcar 1:1" kind="primary" small={false} title="Marcar 1:1" aberto={!!sp.marcar}><FormMarcar convidado={sp.marcar ? Number(sp.marcar) : null} voltar="/um-a-um" /></Modal><Btn kind="ghost" href="/feedback">Feedback</Btn></div>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      {marcada && <div className="mb-4 rounded-lg border border-emerald-200 bg-white p-4 text-center shadow-sm sm:mx-auto sm:max-w-md">
        <div className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-full bg-navy text-lg text-white" aria-hidden>✓</div>
        <div className="text-lg font-semibold text-navy">1:1 marcada</div>
        <div className="text-sm font-medium text-ink">{marcada.organizador_user_id === s.id ? marcada.nome : marcada.organizador_nome}</div>
        <div className="text-sm text-slate-600">{fmtData(marcada.data)} · {marcada.inicio} às {marcada.fim}</div>
        {marcada.temas.length > 0 && <div className="mt-2 flex flex-wrap justify-center gap-1">{marcada.temas.map(t => <span key={t} className="rounded-full border border-acao px-2 py-0.5 text-xs font-medium text-acao">{t}</span>)}</div>}
        <div className="mt-3 flex flex-wrap justify-center gap-2"><Btn small href={`/um-a-um/${marcada.id}`}>Abrir a pauta</Btn><a className="inline-flex items-center rounded-md border border-line bg-white px-2.5 py-1 text-xs font-medium text-navy hover:bg-mist" href={`/api/um-a-um/${marcada.id}/ics`}>Adicionar à agenda (.ics)</a></div>
      </div>}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Próximas 1:1" value={proximas.length} hint={proximas[0] ? `a próxima: ${fmtData(proximas[0].data).slice(0, 5)} às ${proximas[0].inicio}` : "nenhuma marcada"} />
        <Stat label="Hoje" value={proximas.filter(p => p.data === h).length} />
        <Stat label="Para registrar" value={<span className={semRegistro.length ? "text-aviso" : ""}>{semRegistro.length}</span>} hint="já aconteceram e falta o registro" />
        <Stat label="Realizadas (120 dias)" value={minhas.filter(m => m.status === "REALIZADA").length} />
      </div>
      <nav aria-label="Seções" className="mb-3 flex flex-wrap gap-1 border-b border-line">{ABAS.filter(([k]) => k !== "indicadores" || verIndicadores).map(([k, v]) => <Link key={k} href={link(k)} aria-current={aba === k ? "page" : undefined} className={`rounded-t px-3 py-2 text-sm ${aba === k ? "border border-b-white border-line bg-white font-medium text-navy" : "text-slate-600 hover:text-navy"}`}>{v}</Link>)}</nav>

      {aba === "colegas" && <Card title={`Colegas (${lista.length})`}>
        <Table head={["Colega", "Última 1:1", "Próxima 1:1", "Cadência", ""]} empty="Ninguém na sua equipe direta ainda — marque uma 1:1 com qualquer colega pelo botão acima.">{lista.map(c => { const x = cad.get(c.id); const d = diasDesde(x?.ultima ?? null, h); const a = alvo(c.id); return <tr key={c.id}>
          <Td><div className="font-medium text-ink">{c.nome}</div><div className="text-xs text-slate-500">{c.relacao === "EQUIPE" ? "sua equipe" : c.relacao === "GESTOR" ? "seu gestor(a)" : "colega"} · {c.cargo ?? "—"} · {c.unidade}{c.user_id ? "" : " · sem acesso ao ONE"}</div></Td>
          <Td className="whitespace-nowrap text-xs">{x?.ultima ? `${fmtData(x.ultima)} · ${d === 0 ? "hoje" : d === 1 ? "ontem" : `há ${d} dias`}` : "—"}</Td>
          <Td className="whitespace-nowrap text-xs">{x?.proxima ? <Link className="text-acao" href={`/um-a-um/${x.proximaId}`}>{fmtData(x.proxima)} · {x.proximaHora}</Link> : "—"}</Td>
          <Td className="text-xs">{c.relacao !== "EQUIPE" ? <span className="text-slate-400">—</span> : x?.proxima ? <Badge v="APROVADA" label="marcada" /> : d === null ? <Badge v="PENDENTE" label="nunca conversaram" /> : d > a ? <Badge v="REJEITADA" label={`atrasada (alvo ${a} dias)`} /> : <Badge v="APROVADA" label={`em dia (alvo ${a} dias)`} />}</Td>
          <Td>{!x?.proxima && <Btn small kind="ghost" href={`/um-a-um?marcar=${c.id}`}>Marcar</Btn>}</Td></tr>; })}</Table>
        <p className="mt-2 text-[11px] text-slate-500">Cadência = dias desde a última 1:1 realizada (ou o último acompanhamento registrado no painel) × o alvo da família do cargo (Configurações → Desempenho). Colegas fora da equipe aparecem quando você já marcou uma 1:1 com eles.</p>
      </Card>}

      {aba === "agenda" && <div className="space-y-4">
        {semRegistro.length > 0 && <Card title={`Para registrar (${semRegistro.length})`}><ul className="space-y-1 text-sm">{semRegistro.map(m => <li key={m.id} className="flex flex-wrap items-center gap-2 border-l-2 border-aviso pl-2"><Link className="font-medium text-acao" href={`/um-a-um/${m.id}`}>{m.titulo}</Link><span className="text-xs text-slate-600">com {outro(m)} · {fmtData(m.data)} {m.inicio}</span><span className="text-[11px] text-aviso">registre os combinados ou cancele</span></li>)}</ul></Card>}
        <Card title={`Agenda (${minhas.length})`}><Table head={["Quando", "Com quem", "Título e temas", "Pauta", "Situação"]} empty="Nenhuma 1:1 nos últimos 120 dias.">{[...proximas, ...minhas.filter(m => !(m.status === "MARCADA" && m.data >= h))].map(m => <tr key={m.id}>
          <Td className="whitespace-nowrap text-xs"><Link className="font-medium text-acao" href={`/um-a-um/${m.id}`}>{fmtData(m.data)}</Link><div>{m.inicio} às {m.fim}</div></Td>
          <Td className="text-sm">{outro(m)}<div className="text-[11px] text-slate-500">{m.sou_org ? "você marcou" : "convite para você"}</div></Td>
          <Td><div className="text-sm">{m.titulo}</div>{m.temas.length > 0 && <div className="mt-0.5 flex flex-wrap gap-1">{m.temas.map(t => <span key={t} className="rounded-full bg-mist px-1.5 py-0.5 text-[10px] text-slate-700">{t}</span>)}</div>}</Td>
          <Td className="text-xs tabular-nums">{m.pauta_n || "—"}</Td>
          <Td><Badge v={m.status === "MARCADA" && m.data < h ? "PENDENTE" : TOM_1A1[m.status]} label={m.status === "MARCADA" && m.data < h ? "falta registrar" : STATUS_1A1[m.status]} /></Td></tr>)}</Table></Card>
      </div>}

      {aba === "indicadores" && verIndicadores && <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Stat label="Líderes" value={lideres.length} /><Stat label="Liderados com conversa em dia" value={totLid ? `${Math.round((100 * totDia) / totLid)}%` : "—"} hint={`${totDia} de ${totLid}`} /><Stat label="1:1 marcadas (30 dias)" value={lideres.reduce((a, l) => a + l.marcadas, 0)} /><Stat label="Sem registro" value={lideres.reduce((a, l) => a + l.sem_registro, 0)} hint="aconteceram e falta registrar" /></div>
        <Card title="Conversa em dia por líder">{lideres.length === 0 ? <p className="text-sm text-slate-500">Nenhum líder com equipe no seu escopo.</p> : <BarrasH itens={lideres.map(l => { const p = l.liderados ? (100 * l.em_dia) / l.liderados : 0; return { rotulo: l.nome, valor: p, texto: `${l.em_dia}/${l.liderados}`, cor: p >= 80 ? COR.ok : p >= 50 ? COR.aviso : COR.erro }; })} max={100} formato={x => `${Math.round(x)}%`} rotulo="Liderados com 1:1 ou acompanhamento dentro do alvo" largRotulo="12rem" />}</Card>
        <Card title="Detalhe por líder"><Table head={["Líder", "Unidade", "Liderados", "Em dia", "Marcadas (30 dias)", "Realizadas (90 dias)", "Canceladas (90 dias)", "Sem registro"]} empty="—">{lideres.map(l => <tr key={l.id}><Td className="font-medium">{l.nome}</Td><Td className="text-xs">{l.unidade}</Td><Td className="tabular-nums">{l.liderados}</Td><Td className="tabular-nums">{l.em_dia} <span className="text-xs text-slate-500">({l.liderados ? Math.round((100 * l.em_dia) / l.liderados) : 0}%)</span></Td><Td className="tabular-nums">{l.marcadas}</Td><Td className="tabular-nums">{l.realizadas}</Td><Td className="tabular-nums">{l.canceladas}</Td><Td className={`tabular-nums ${l.sem_registro ? "text-aviso" : ""}`}>{l.sem_registro}</Td></tr>)}</Table>
          <p className="mt-2 text-[11px] text-slate-500">Só contagens e datas: a pauta e os combinados ficam com as duas pessoas (e os combinados, no acompanhamento do painel). Conversa em dia = 1:1 realizada ou acompanhamento registrado dentro do alvo da família do cargo.</p></Card>
      </div>}
      <p className="mt-3 text-[11px] text-slate-500"><Link className="text-acao" href="/feedback">Feedback</Link> · <Link className="text-acao" href="/desempenho/lideranca">Liderança e encaminhamentos</Link> · Dica: no fim da 1:1, use “Registrar como realizada” e, se for recorrente, já marque a próxima.</p>
    </Page>
  );
}
