// v27 · Minha equipe — painel do gestor: o que fazer hoje, quem está fora, banco de horas, férias, avaliações, PDI e datas da equipe direta.
import { redirect } from "next/navigation";
import Link from "@/components/Link";
import { requireSession, scopeUnit, aprovaSoEquipe, can } from "@/lib/auth";
import { SemanaEquipe } from "./_v30";
import { sql } from "@/db";
import { Page, Card, Table, Td, Stat, Field, Select, Btn, Badge } from "@/components/ui";
import { fmtData, fmtMin, hoje, saldosBanco, getSettings } from "@/lib/utils";
import { minhaLideranca, ACOES_LIDERANCA } from "@/lib/lideranca";
import { quemEstaFora, rotuloVisivel } from "@/lib/quem-fora";
import { feriasAVencer } from "@/lib/ferias";
import { prazosContratuais } from "@/lib/contratos-prazo";

export const dynamic = "force-dynamic";
const anos = (d: string, h: string) => Math.floor((Date.parse(h) - Date.parse(d)) / (365.25 * 86400000));

export default async function MinhaEquipe({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const sp = await searchParams; const h = hoje(); const u = scopeUnit(s);
  const amplo = ["RH", "DIRECAO", "DIRETOR_UNIDADE"].includes(s.role);
  // v29: liderança de outra área (financeiro, comercial, operações) também tem a sua equipe direta aqui
  const liderOutraArea = !amplo && s.role !== "GESTOR" && !!s.employeeId && !["COLABORADOR", "LEITURA"].includes(s.role);
  if (!amplo && s.role !== "GESTOR" && !liderOutraArea) redirect("/");
  const gestores = await sql<{ id: number; nome: string; n: number }[]>`SELECT g.id, g.nome, count(e.id)::int AS n FROM employees g JOIN employees e ON e.gestor_id=g.id AND e.situacao IN ('ATIVO','FERIAS','AFASTADO') WHERE g.situacao <> 'DESLIGADO' ${u === null ? sql`` : sql`AND g.unit_id=${u}`} GROUP BY g.id, g.nome ORDER BY g.nome`;
  const pedido = sp.gestor ? Number(sp.gestor) : null;
  const gid = amplo && pedido && gestores.some(g => g.id === pedido) ? pedido : s.employeeId && gestores.some(g => g.id === s.employeeId) ? s.employeeId : amplo ? gestores[0]?.id ?? null : null;
  // sem equipe direta: em vez de voltar ao Início sem explicação, a tela diz o que falta (o gestor direto nas fichas ou o colaborador vinculado ao acesso)
  const eq = gid ? await sql<{ id: number; nome: string; cargo: string | null; unidade: string; admissao: string; nasc: string | null; situacao: string; turno: string | null }[]>`SELECT e.id, e.nome, p.nome AS cargo, un.nome AS unidade, e.admissao::text, e.data_nascimento::text AS nasc, e.situacao, e.turno FROM employees e JOIN units un ON un.id=e.unit_id LEFT JOIN positions p ON p.id=e.position_id WHERE e.gestor_id=${gid} AND e.situacao IN ('ATIVO','FERIAS','AFASTADO') ORDER BY e.nome` : [];
  const ids = eq.map(e => e.id);
  const [banco, fora, ferias, avals, pdi, saidas, prazos] = await Promise.all([
    saldosBanco(ids), quemEstaFora(h.slice(0, 7), null), feriasAVencer(null, 90),
    ids.length ? sql<{ employee_id: number; status: string; ciclo: string; nivel: number | null; nota: number | null }[]>`SELECT DISTINCT ON (r.employee_id) r.employee_id, r.status, c.nome AS ciclo, r.desempenho_nivel AS nivel, r.nota_final::float AS nota FROM perf_reviews r JOIN perf_cycles c ON c.id=r.cycle_id WHERE r.employee_id = ANY(${ids}::int[]) ORDER BY r.employee_id, r.id DESC` : Promise.resolve([]),
    ids.length ? sql<{ employee_id: number; acoes: number; atrasadas: number; concluidas: number }[]>`SELECT p.employee_id, count(a.id)::int AS acoes, count(a.id) FILTER (WHERE a.status NOT IN ('CONCLUIDA','CANCELADA') AND a.prazo < current_date)::int AS atrasadas, count(a.id) FILTER (WHERE a.status='CONCLUIDA')::int AS concluidas FROM pdi_plans p LEFT JOIN pdi_actions a ON a.plan_id=p.id AND a.status <> 'CANCELADA' WHERE p.status='ATIVO' AND p.employee_id = ANY(${ids}::int[]) GROUP BY p.employee_id` : Promise.resolve([]),
    gid ? sql<{ n: number }[]>`SELECT count(*)::int AS n FROM employees WHERE gestor_id=${gid} AND desligamento > current_date - interval '12 months'` : Promise.resolve([{ n: 0 }]),
    gid ? prazosContratuais({ unitId: null, gestorId: gid }) : Promise.resolve([]),
  ]);
  const foraHoje = fora.pessoas.filter(p => ids.includes(p.id)).map(p => ({ p, d: p.dias.get(h) })).filter(x => x.d && !x.d.pendente);
  const feriasEq = ferias.filter(f => ids.includes(f.employeeId));
  const avalPend = avals.filter(a => ["PENDENTE", "AUTOAVALIADA"].includes(a.status)); const pdiAtras = pdi.filter(p => p.atrasadas > 0);
  const debito = eq.filter(e => (banco.get(e.id) ?? 0) < -600);
  const mes = h.slice(5, 7); const niver = eq.filter(e => e.nasc?.slice(5, 7) === mes); const casa = eq.filter(e => e.admissao.slice(5, 7) === mes && anos(e.admissao, h) >= 1);
  const semPdi = eq.filter(e => !pdi.some(p => p.employee_id === e.id));
  const gNome = gestores.find(g => g.id === gid)?.nome;
  // v30 · a liderança na visão da equipe (última pesquisa de liderança encerrada): o próprio gestor, RH/Direção e a direção da unidade
  const cfgL = (await getSettings()).clima.lideranca; const verLid = !!gid && (gid === s.employeeId || amplo);
  const lid = verLid ? await minhaLideranca(gid!, Number(cfgL.minimo), Number(cfgL.atencaoAbaixo)) : null;
  const fazer = [
    { n: avalPend.length, t: "avaliação(ões) de desempenho em aberto na equipe", href: "/desempenho" },
    { n: pdiAtras.length, t: "pessoa(s) com ação de PDI atrasada", href: "/desempenho/lideranca" },
    { n: feriasEq.length, t: "período(s) de férias vencendo em 90 dias", href: "/ferias" },
    { n: debito.length, t: "pessoa(s) com mais de 10 h de débito no banco de horas", href: "/banco-de-horas" },
    { n: prazos.filter(p => ["VENCIDO", "VENCENDO"].includes(p.situacao) && !p.recomendacao).length, t: "contrato(s) de experiência/estágio vencendo — recomende prorrogar, efetivar ou encerrar", href: `/contratos-prazo${amplo ? `?gestor=${gid}` : ""}` },
    { n: semPdi.length, t: "pessoa(s) sem PDI ativo", href: "/desempenho/lideranca" },
  ].filter(x => x.n > 0);
  return (
    <Page title="Minha equipe" sub={gNome ? `Equipe direta de ${gNome} · ${eq.length} pessoa(s)` : "Painel do gestor"} actions={amplo && gestores.length > 0 ? <form className="flex items-end gap-1"><Field label="Gestor"><Select name="gestor" defaultValue={String(gid ?? "")}>{gestores.map(g => <option key={g.id} value={g.id}>{g.nome} ({g.n})</option>)}</Select></Field><Btn small kind="ghost">Ver</Btn></form> : undefined}>
      {!gid ? <Card><p className="text-sm text-slate-500">{amplo ? "Nenhum gestor com equipe cadastrada. Defina o gestor direto na ficha de cada colaborador." : !s.employeeId ? "Seu acesso não está vinculado a uma ficha de colaborador — peça ao RH para vincular (Configurações → Usuários e acessos)." : "Ninguém tem você como gestor direto ainda. Peça ao RH para preencher o Gestor direto na ficha das pessoas da sua equipe."}</p></Card> : <>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Na equipe" value={eq.length} /><Stat label="Fora hoje" value={foraHoje.length} /><Stat label="Coisas a fazer" value={<span className={fazer.length ? "text-aviso" : "text-ok"}>{fazer.reduce((a, b) => a + b.n, 0)}</span>} />
        <Stat label="Saldo do banco (equipe)" value={fmtMin([...banco.values()].reduce((a, b) => a + b, 0))} /><Stat label="Saídas em 12 meses" value={saidas[0]?.n ?? 0} /><Stat label="Com PDI ativo" value={eq.length ? `${Math.round(100 * (eq.length - semPdi.length) / eq.length)}%` : "—"} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="O que fazer">{fazer.length === 0 ? <p className="text-sm text-ok">Tudo em dia na equipe. 👍</p> : <ul className="space-y-1.5 text-sm">{fazer.map(f => <li key={f.t} className="flex items-start gap-2 border-l-2 border-aviso pl-2"><b className="text-aviso">{f.n}</b>{liderOutraArea ? <span>{f.t}</span> : <Link href={f.href} className="text-acao hover:underline">{f.t}</Link>}</li>)}</ul>}{liderOutraArea && <p className="mt-2 text-[11px] text-slate-500">Férias e banco de horas da equipe: Aprovações em lote (quando o seu cargo aprova). O restante, com o RH.</p>}<p className="mt-2 text-[11px] text-slate-500">Solicitações e aprovações que dependem de você ficam em <Link href="/pendencias" className="text-acao">Minhas pendências</Link>.</p></Card>
        <Card title={`Fora hoje (${foraHoje.length})`}>{foraHoje.length === 0 ? <p className="text-sm text-slate-500">Toda a equipe disponível.</p> : <ul className="space-y-1 text-sm">{foraHoje.map(({ p, d }) => <li key={p.id} className="flex justify-between gap-2"><Link className="truncate text-acao" href={`/colaboradores/${p.id}`}>{p.nome}</Link><span className="text-xs text-slate-500">{rotuloVisivel(d!.tipo, amplo)}</span></li>)}</ul>}</Card>
        <Card title="Datas do mês">{niver.length + casa.length === 0 ? <p className="text-sm text-slate-500">Nenhuma data neste mês.</p> : <ul className="space-y-1 text-sm">{niver.map(e => <li key={`n${e.id}`}>🎂 {e.nome} <span className="text-xs text-slate-500">· aniversário {fmtData(e.nasc).slice(0, 5)}</span></li>)}{casa.map(e => <li key={`c${e.id}`}>🏅 {e.nome} <span className="text-xs text-slate-500">· {anos(e.admissao, h)} ano(s) de casa em {fmtData(e.admissao).slice(0, 5)}</span></li>)}</ul>}</Card>
      </div>
      <Card className="mt-4" title="Equipe direta">
        <Table head={["Pessoa", "Cargo", "Tempo de casa", "Banco de horas", "Última avaliação", "PDI", "Situação"]} empty="Ninguém na equipe.">{eq.map(e => { const b = banco.get(e.id) ?? 0; const a = avals.find(x => x.employee_id === e.id); const p = pdi.find(x => x.employee_id === e.id); return <tr key={e.id}>
          <Td><Link className="font-medium text-acao" href={`/colaboradores/${e.id}`}>{e.nome}</Link><div className="text-xs text-slate-500">{e.unidade}{e.turno ? ` · ${e.turno}` : ""}</div></Td><Td className="text-xs">{e.cargo ?? "—"}</Td>
          <Td className="text-xs">{anos(e.admissao, h) >= 1 ? `${anos(e.admissao, h)} ano(s)` : `${Math.max(0, Math.floor((Date.parse(h) - Date.parse(e.admissao)) / (30.4 * 86400000)))} mês(es)`}</Td>
          <Td className={b < -600 ? "font-medium text-erro" : b > 1200 ? "text-aviso" : ""}>{fmtMin(b)}</Td>
          <Td className="text-xs">{a ? <>{a.ciclo} · {["PENDENTE", "AUTOAVALIADA"].includes(a.status) ? <span className="text-aviso">em aberto</span> : a.nota != null ? a.nota.toFixed(1).replace(".", ",") : a.status.toLowerCase()}</> : "—"}</Td>
          <Td className="text-xs">{p ? <>{p.concluidas}/{p.acoes} ações{p.atrasadas ? <span className="text-erro"> · {p.atrasadas} atrasada(s)</span> : ""}</> : <span className="text-slate-400">sem PDI</span>}</Td>
          <Td><Badge v={e.situacao === "ATIVO" ? "APROVADA" : "PENDENTE"} label={e.situacao === "ATIVO" ? "Ativo" : e.situacao === "FERIAS" ? "Férias" : "Afastado"} /></Td></tr>; })}</Table>
        <p className="mt-1 text-[11px] text-slate-500">Banco de horas: vermelho = mais de 10 h devendo; amarelo = mais de 20 h a compensar.</p>
      </Card>
      {gid && eq.length > 0 && <SemanaEquipe eq={eq.map(e => ({ id: e.id, nome: e.nome }))} h={h} sensivel={can.verSensivel(s)} amplo={amplo} semana={sp.semana ?? null} base={pedido ? `/equipe?gestor=${pedido}` : "/equipe"} />}
      {verLid && <Card className="mt-4" title="Liderança na visão da equipe">{!lid ? <p className="text-sm text-slate-500">Ainda não há pesquisa de liderança encerrada com respostas sobre {gid === s.employeeId ? "você" : "este gestor"}. O RH abre em Clima e eNPS → nova pesquisa → tipo Liderança.</p> : !lid.eu.liberado ? <p className="text-sm text-slate-500">“{lid.pesquisa.nome}”: {lid.eu.n} resposta(s) — o resultado aparece com pelo menos {Math.max(3, Number(cfgL.minimo))} (anonimato da equipe).</p> : <>
        <div className="flex flex-wrap items-baseline gap-3"><div className={`text-3xl font-semibold tabular-nums ${lid.eu.indice! >= Number(cfgL.favoravelAlvo) ? "text-ok" : lid.eu.indice! >= Number(cfgL.atencaoAbaixo) ? "text-aviso" : "text-erro"}`}>{lid.eu.indice}%</div><div className="text-xs text-slate-600">índice de efetividade · “{lid.pesquisa.nome}” · {lid.eu.n} respostas{lid.rede !== null ? ` · rede ${lid.rede}%` : ""}{lid.eu.nps !== null ? ` · recomendação ${lid.eu.nps}` : ""}</div></div>
        <div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">{lid.eu.porDimensao.map(d => <div key={d.dimensao} className="flex items-center justify-between gap-2 rounded border border-line px-2 py-1 text-sm"><span>{d.dimensao}</span><b className={`tabular-nums ${(d.favoravel ?? 0) >= Number(cfgL.favoravelAlvo) ? "text-ok" : (d.favoravel ?? 0) >= Number(cfgL.atencaoAbaixo) ? "text-aviso" : "text-erro"}`}>{d.favoravel ?? "—"}%</b></div>)}</div>
        {lid.eu.atencao.length > 0 && <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-sm"><b>Para trabalhar:</b> {lid.eu.atencao.join(", ")}<ul className="mt-1 flex flex-wrap gap-x-3 text-xs">{lid.eu.atencao.flatMap(d => ACOES_LIDERANCA[d] ?? []).map(a => <li key={a.texto}>→ <Link className="text-acao" href={a.href}>{a.texto}</Link></li>)}</ul></div>}
        {lid.eu.comentarios.length > 0 && <p className="mt-2 text-xs text-slate-500">{lid.eu.comentarios.length} comentário(s) da equipe ficam com o RH, que conversa com {gid === s.employeeId ? "você" : "o gestor"} sobre os temas — sem expor quem escreveu.</p>}
        <p className="mt-2 text-[11px] text-slate-500">% de respostas favoráveis (4–5) da equipe direta. Serve para o seu desenvolvimento como líder — não é nota de desempenho.</p></>}</Card>}</>}
    </Page>
  );
}
