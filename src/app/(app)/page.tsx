import { redirect } from "next/navigation";
import Link from "@/components/Link";
import type { ReactNode } from "react";
import { requireSession, scopeUnit, can, type Session } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Stat, Table, Td, Badge, Btn } from "@/components/ui";
import { Rosca, Situacao as Selo, COR } from "@/components/graficos";
import { fmtData, fmtDataHora, fmtMin, hoje, addDays } from "@/lib/utils";
import { feriasAVencer } from "@/lib/ferias";
import { preferencias, atalhosDe, PERFIS_MODULO, type ChaveBloco } from "@/lib/inicio";
import { minhasPendencias, resumoPendencias, situacaoPend, SITUACAO_PEND } from "@/lib/pendencias";
import { garantirKpis, kpisVisiveis, visoes, periodoPadrao, vePainelExecutivo } from "@/lib/kpi";
import { fluxosVisiveis, instancias, resumir, contexto } from "@/lib/fluxos";
import { quemEstaFora, rotuloVisivel, corVisivel } from "@/lib/quem-fora";
import { mural } from "@/lib/reconhecimento";
import { mesPorExtenso } from "@/lib/formato";
import { CartaoKpi, GradeCartoes } from "./executivo/_ui";

export const dynamic = "force-dynamic";

const DIAS_SEMANA = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
function saudacao() { const hora = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "America/Campo_Grande" }).format(new Date())); return hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite"; }

/** Início (v23): página personalizável — pendências, atalhos, indicadores, prazos, equipe, mural e comunicados, na ordem que a pessoa escolher. */
export default async function Inicio() {
  const s = await requireSession(); const prefs = await preferencias(s);
  if (s.role === "COLABORADOR" && prefs.paginaInicial !== "inicio") redirect(s.employeeId ? "/eu" : "/conta");
  if (PERFIS_MODULO[s.role] && prefs.paginaInicial !== "inicio") redirect(PERFIS_MODULO[s.role]);
  const h = hoje(); const u = scopeUnit(s);
  const [unidade] = u ? await sql<{ nome: string }[]>`SELECT nome FROM units WHERE id=${u}` : [{ nome: "Rede — quatro unidades" }];
  const atalhos = atalhosDe(s, prefs.atalhos);
  const dataTxt = `${DIAS_SEMANA[new Date(`${h}T12:00:00Z`).getUTCDay()]}, ${Number(h.slice(8, 10))} de ${mesPorExtenso(h.slice(0, 7))}`;
  const blocos: Record<ChaveBloco, () => Promise<ReactNode>> = {
    pendencias: () => BlocoPendencias({ s }), indicadores: () => BlocoIndicadores({ s, kpis: prefs.kpis }), fluxos: () => BlocoFluxos({ s }), pessoas: () => BlocoPessoas({ s }),
    fora: () => BlocoFora({ s }), datas: () => BlocoDatas({ s }), mural: () => BlocoMural({ s }), comunicados: () => BlocoComunicados({ s }), auditoria: () => BlocoAuditoria(),
  };
  const conteudo = await Promise.all(prefs.blocos.map(async b => { try { return { b, el: await blocos[b]() }; } catch { return { b, el: <Card title="Bloco indisponível"><p className="text-sm text-slate-500">Não foi possível carregar este bloco agora.</p></Card> }; } }));
  const largos = new Set<ChaveBloco>(["pendencias", "indicadores", "pessoas"]);
  return (
    <Page title={`${saudacao()}, ${s.nome.split(" ")[0]}`} sub={`${dataTxt} · ${unidade?.nome ?? ""}`} actions={<Btn kind="ghost" href="/inicio/personalizar">Personalizar o Início</Btn>}>
      {atalhos.length > 0 && <nav aria-label="Atalhos" className="mb-4 flex flex-wrap gap-2">{atalhos.map(a => <Btn key={a.chave} kind="ghost" href={a.href}>{a.rotulo}</Btn>)}</nav>}
      {conteudo.length === 0 ? <Card><p className="py-6 text-center text-sm text-slate-600">Seu Início está vazio. <Link className="text-acao underline" href="/inicio/personalizar">Escolha os blocos</Link>.</p></Card> :
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
          {conteudo.map(({ b, el }) => <div key={b} className={largos.has(b) ? "lg:col-span-2" : ""}>{el}</div>)}
        </div>}
    </Page>
  );
}

async function BlocoPendencias({ s }: { s: Session }) {
  const h = hoje(); const { itens } = await minhasPendencias(s); const R = resumoPendencias(itens, h);
  return (
    <Card title={`Minhas pendências (${R.total})`} actions={<Link href="/pendencias" className="text-xs text-acao">Ver todas</Link>}>
      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        <span className={`rounded-full px-2.5 py-1 ${R.vencidas ? "bg-red-50 text-erro" : "bg-emerald-50 text-ok"}`}>{R.vencidas} vencida(s)</span>
        <span className={`rounded-full px-2.5 py-1 ${R.hoje ? "bg-amber-50 text-aviso" : "bg-mist text-slate-600"}`}>{R.hoje} para hoje</span>
        <span className="rounded-full bg-mist px-2.5 py-1 text-slate-600">{R.proximas} nos próximos 3 dias</span>
      </div>
      {itens.length === 0 ? <p className="text-sm text-slate-500">Nada pendente com você agora. 🎉</p> :
        <ul className="divide-y divide-line">{itens.slice(0, 6).map(p => { const st = situacaoPend(p.prazo, h); return (
          <li key={p.chave} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <div className="min-w-0 flex-1"><div className="text-[11px] text-slate-500">{p.modulo} · {p.acao}</div><Link href={p.href} className="block truncate text-sm font-medium text-acao hover:underline">{p.titulo}</Link></div>
            <span className="flex items-center gap-2">{p.prazo && <span className="text-xs tabular-nums text-slate-500">{fmtData(p.prazo)}</span>}<Selo tom={SITUACAO_PEND[st].tom} texto={SITUACAO_PEND[st].rotulo} /></span>
          </li>); })}</ul>}
    </Card>
  );
}

async function BlocoIndicadores({ s, kpis }: { s: Session; kpis: string[] | null }) {
  if (!vePainelExecutivo(s)) return null;
  await garantirKpis().catch(() => null);
  const defs = await kpisVisiveis(s); const escolhidos = kpis?.length ? kpis.map(k => defs.find(d => d.chave === k)).filter((d): d is NonNullable<typeof d> => !!d) : defs.filter(d => d.destaque).sort((a, b) => (a.destaque ?? 99) - (b.destaque ?? 99)).slice(0, 4);
  const periodo = periodoPadrao(); const unitId = scopeUnit(s) ?? 0; const vs = await visoes(escolhidos, periodo, unitId);
  return (
    <Card title={`Meus indicadores · ${mesPorExtenso(periodo)}`} actions={<span className="flex gap-3 text-xs"><Link href="/inicio/personalizar#indicadores" className="text-acao">Escolher</Link><Link href="/executivo" className="text-acao">Painel Executivo</Link></span>}>
      {vs.length === 0 ? <p className="text-sm text-slate-500">Nenhum indicador escolhido.</p> : <GradeCartoes>{vs.map(v => <CartaoKpi key={v.def.chave} v={v} href={`/executivo/indicador/${encodeURIComponent(v.def.chave)}?periodo=${periodo}${unitId ? `&unidade=${unitId}` : ""}`} />)}</GradeCartoes>}
    </Card>
  );
}

async function BlocoFluxos({ s }: { s: Session }) {
  const ctx = await contexto(s); const vis = await fluxosVisiveis(s); if (!vis.length) return null;
  const insts = await instancias(vis, ctx.escopo, addDays(ctx.hoje, -30)); const R = resumir(insts, Date.now(), ctx.riscoPct); const T = R.total;
  const pct = T.concluidosComPrazo ? Math.round((100 * T.concluidosNoPrazo) / T.concluidosComPrazo) : null;
  return (
    <Card title="Prazos dos processos" actions={<Link href="/fluxos" className="text-xs text-acao">Central de fluxos</Link>}>
      <Rosca rotulo="Itens em andamento por situação" fatias={[{ rotulo: "No prazo", valor: T.noPrazo, cor: COR.ok }, { rotulo: "Em risco", valor: T.emRisco, cor: COR.aviso, href: "/fluxos?aba=lista&sit=EM_RISCO" }, { rotulo: "Vencidos", valor: T.vencidos, cor: COR.erro, href: "/fluxos?aba=lista&sit=VENCIDO" }, { rotulo: "Sem prazo", valor: T.semPrazo, cor: "#cbd5e1" }]} centro={{ valor: String(T.abertos), rotulo: "em andamento" }} tamanho={120} />
      <p className="mt-2 text-xs text-slate-600">Concluídos no prazo nos últimos 30 dias: <b className={pct === null ? "" : pct >= 90 ? "text-ok" : pct >= 75 ? "text-aviso" : "text-erro"}>{pct === null ? "—" : `${pct}%`}</b> ({T.concluidosNoPrazo} de {T.concluidosComPrazo}).</p>
    </Card>
  );
}

async function BlocoPessoas({ s }: { s: Session }) {
  const u = scopeUnit(s); const h = hoje(), em30 = addDays(h, 30); const uf = u === null ? sql`` : sql`AND e.unit_id = ${u}`;
  const [porUnidade, [tot], adm, desl, ferias, banco, docs] = await Promise.all([
    sql<{ nome: string; ativos: number; em_admissao: number }[]>`SELECT u.nome, count(*) FILTER (WHERE e.situacao='ATIVO')::int AS ativos, count(*) FILTER (WHERE e.situacao='EM_ADMISSAO')::int AS em_admissao
      FROM units u LEFT JOIN employees e ON e.unit_id=u.id ${u === null ? sql`` : sql`WHERE u.id = ${u}`} GROUP BY u.id, u.nome ORDER BY u.nome`,
    sql<{ ativos: number; ferias: number; afastados: number }[]>`SELECT count(*) FILTER (WHERE e.situacao='ATIVO')::int AS ativos,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM leave_requests l WHERE l.employee_id=e.id AND l.status='APROVADA' AND l.tipo='FERIAS' AND l.inicio<=${h} AND l.fim>=${h}))::int AS ferias,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM leave_requests l WHERE l.employee_id=e.id AND l.status='APROVADA' AND l.tipo IN ('AFASTAMENTO_SAUDE','LICENCA') AND l.inicio<=${h} AND l.fim>=${h}))::int AS afastados
      FROM employees e WHERE e.situacao <> 'DESLIGADO' ${uf}`,
    sql<{ n: number }[]>`SELECT count(*)::int AS n FROM processes p JOIN employees e ON e.id=p.employee_id WHERE p.tipo='ADMISSAO' AND p.status='ABERTO' ${uf}`,
    sql<{ n: number }[]>`SELECT count(*)::int AS n FROM processes p JOIN employees e ON e.id=p.employee_id WHERE p.tipo='DESLIGAMENTO' AND p.status='ABERTO' ${uf}`,
    sql<{ id: number; nome: string; tipo: string; inicio: string; fim: string; dias: number }[]>`SELECT l.id, e.nome, l.tipo, l.inicio::text, l.fim::text, l.dias FROM leave_requests l JOIN employees e ON e.id=l.employee_id WHERE l.status='SOLICITADA' ${uf} ORDER BY l.inicio LIMIT 8`,
    sql<{ id: number; nome: string; saldo: number }[]>`SELECT e.id, e.nome, coalesce(sum(h.minutos),0)::int AS saldo FROM employees e JOIN hour_entries h ON h.employee_id=e.id AND h.status='APROVADO' WHERE e.situacao='ATIVO' ${uf} GROUP BY e.id, e.nome ORDER BY saldo ASC LIMIT 6`,
    sql<{ n: number }[]>`SELECT count(*)::int AS n FROM documents d JOIN employees e ON e.id=d.employee_id WHERE e.situacao<>'DESLIGADO' AND d.validade IS NOT NULL AND d.validade <= ${em30} ${uf}`,
  ]);
  const alertasFerias = await feriasAVencer(u, 90);
  return (
    <section aria-label="Pessoas" className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Colaboradores ativos" value={tot.ativos} hint={`${tot.ferias} em férias · ${tot.afastados} afastados`} href="/colaboradores" />
        <Stat label="Admissões em andamento" value={adm[0].n} href="/processos?tipo=ADMISSAO" />
        <Stat label="Desligamentos em andamento" value={desl[0].n} href="/processos?tipo=DESLIGAMENTO" />
        <Stat label="Férias a vencer (90 dias)" value={<span className={alertasFerias.length ? "text-aviso" : ""}>{alertasFerias.length}</span>} hint="risco de férias em dobro" href="/ferias#vencendo" />
        <Stat label="Documentos vencendo em 30 dias" value={docs[0].n} href="/documentos" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-start">
        <Card title="Por unidade">
          <Table head={["Unidade", "Ativos", "Em admissão"]}>
            {porUnidade.map(r => <tr key={r.nome}><Td>{r.nome}</Td><Td>{r.ativos}</Td><Td>{r.em_admissao}</Td></tr>)}
          </Table>
        </Card>
        <Card title="Aguardando aprovação" actions={<Link href="/ferias" className="text-xs text-acao">Ver todas</Link>}>
          {ferias.length === 0 ? <p className="text-sm text-slate-500">Nenhuma solicitação pendente.</p> : (
            <ul className="-my-1 divide-y divide-line">
              {ferias.map(l => <li key={l.id} className="flex items-start justify-between gap-2 py-2 text-sm">
                <span className="min-w-0"><span className="block truncate font-medium text-ink">{l.nome}</span><span className="block text-xs tabular-nums text-slate-500">{fmtData(l.inicio)} – {fmtData(l.fim)} · {l.dias} {l.dias === 1 ? "dia" : "dias"}</span></span>
                <Badge v={l.tipo} label={l.tipo === "FERIAS" ? "Férias" : l.tipo === "AFASTAMENTO_SAUDE" ? "Afastamento" : l.tipo === "FOLGA_BANCO" ? "Folga" : "Licença/outro"} />
              </li>)}
            </ul>)}
        </Card>
        <Card title="Banco de horas — maiores débitos" actions={<Link href="/banco-de-horas" className="text-xs text-acao">Ver banco</Link>}>
          <Table head={["Colaborador", "Saldo"]} empty="Sem lançamentos aprovados.">
            {banco.map(b => <tr key={b.id}><Td><Link className="text-acao" href={`/colaboradores/${b.id}`}>{b.nome}</Link></Td><Td className={b.saldo < 0 ? "text-erro" : "text-ok"}>{fmtMin(b.saldo)}</Td></tr>)}
          </Table>
        </Card>
      </div>
    </section>
  );
}

async function BlocoFora({ s }: { s: Session }) {
  const h = hoje(); const u = scopeUnit(s); const sensivel = ["DIRECAO", "RH", "DIRETOR_UNIDADE"].includes(s.role);
  const q = await quemEstaFora(h.slice(0, 7), u); const fimSemana = addDays(h, 6);
  const q2 = fimSemana.slice(0, 7) !== h.slice(0, 7) ? await quemEstaFora(fimSemana.slice(0, 7), u) : null;
  const hojeFora = q.pessoas.map(p => ({ p, d: p.dias.get(h) })).filter(x => x.d && !x.d.pendente);
  const semana = new Map<number, { nome: string; dias: number }>();
  for (const src of [q, q2]) if (src) for (const p of src.pessoas) for (const [d, x] of p.dias) if (d > h && d <= fimSemana && !x.pendente) { const e = semana.get(p.id) ?? { nome: p.nome, dias: 0 }; e.dias++; semana.set(p.id, e); }
  return (
    <Card title={`Quem está fora hoje (${hojeFora.length})`} actions={<Link href="/ferias/calendario" className="text-xs text-acao">Calendário</Link>}>
      {hojeFora.length === 0 ? <p className="text-sm text-slate-500">Ninguém fora hoje.</p> :
        <ul className="space-y-1 text-sm">{hojeFora.slice(0, 10).map(({ p, d }) => <li key={p.id} className="flex items-center justify-between gap-2"><span className="min-w-0 truncate"><Link href={`/colaboradores/${p.id}`} className="text-acao hover:underline">{p.nome}</Link>{u === null ? <span className="text-xs text-slate-500"> · {p.unidade}</span> : null}</span><span className="flex shrink-0 items-center gap-1.5 text-xs text-slate-600"><span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: corVisivel(d!.tipo, sensivel) }} />{rotuloVisivel(d!.tipo, sensivel)}</span></li>)}</ul>}
      {hojeFora.length > 10 && <p className="mt-1 text-xs text-slate-500">e mais {hojeFora.length - 10}.</p>}
      <p className="mt-3 border-t border-line pt-2 text-xs text-slate-600">Próximos 6 dias: {semana.size ? `${semana.size} pessoa(s) com ausência prevista` : "nenhuma ausência prevista"}.</p>
    </Card>
  );
}

async function BlocoDatas({ s }: { s: Session }) {
  const h = hoje(); const u = scopeUnit(s); const uf = u === null ? sql`` : sql`AND e.unit_id = ${u}`; const mesAtual = Number(h.slice(5, 7));
  const [aniversariantes, tempoCasa] = await Promise.all([
    sql<{ id: number; nome: string; unidade: string; dia: number }[]>`SELECT e.id, e.nome, u.nome AS unidade, extract(day FROM e.data_nascimento)::int AS dia FROM employees e JOIN units u ON u.id=e.unit_id WHERE e.situacao='ATIVO' AND e.data_nascimento IS NOT NULL AND extract(month FROM e.data_nascimento)=${mesAtual} ${uf} ORDER BY dia, e.nome`,
    sql<{ id: number; nome: string; unidade: string; dia: number; anos: number }[]>`SELECT e.id, e.nome, u.nome AS unidade, extract(day FROM e.admissao)::int AS dia, (extract(year FROM ${h}::date) - extract(year FROM e.admissao))::int AS anos FROM employees e JOIN units u ON u.id=e.unit_id WHERE e.situacao='ATIVO' AND extract(month FROM e.admissao)=${mesAtual} AND extract(year FROM e.admissao) < extract(year FROM ${h}::date) ${uf} ORDER BY dia, e.nome`,
  ]);
  return (
    <Card title="Datas do mês">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <div className="mb-1 text-xs font-medium text-slate-600">Aniversariantes</div>
          {aniversariantes.length === 0 ? <div className="text-sm text-slate-500">Nenhum aniversário cadastrado neste mês.</div> : <ul className="space-y-0.5 text-sm">{aniversariantes.map(a => <li key={a.id}><span className="inline-block w-7 tabular-nums text-slate-500">{String(a.dia).padStart(2, "0")}</span><Link className="text-acao" href={`/colaboradores/${a.id}`}>{a.nome}</Link> <span className="text-xs text-slate-500">· {a.unidade}</span></li>)}</ul>}
        </div>
        <div>
          <div className="mb-1 text-xs font-medium text-slate-600">Tempo de casa</div>
          {tempoCasa.length === 0 ? <div className="text-sm text-slate-500">Nenhum aniversário de admissão neste mês.</div> : <ul className="space-y-0.5 text-sm">{tempoCasa.map(a => <li key={a.id}><span className="inline-block w-7 tabular-nums text-slate-500">{String(a.dia).padStart(2, "0")}</span><Link className="text-acao" href={`/colaboradores/${a.id}`}>{a.nome}</Link> <span className="text-xs text-slate-500">· {a.anos} {a.anos === 1 ? "ano" : "anos"}</span></li>)}</ul>}
        </div>
      </div>
    </Card>
  );
}

async function BlocoMural({ s }: { s: Session }) {
  const rs = await mural(s, { limite: 4 });
  return (
    <Card title="Mural de reconhecimento" actions={<Link href="/reconhecimento" className="text-xs text-acao">{s.role === "LEITURA" ? "Ver o mural" : "Reconhecer alguém"}</Link>}>
      {rs.length === 0 ? <p className="text-sm text-slate-500">Nenhum reconhecimento ainda — seja o primeiro.</p> :
        <ul className="space-y-3">{rs.filter(r => r.status === "PUBLICADO").map(r => <li key={r.id} className="border-l-2 border-sky-300 pl-3 text-sm"><div><b className="text-navy">{r.para_nome}</b>{r.valor && <span className="ml-1 rounded-full bg-sky-50 px-1.5 text-[11px] text-acao">{r.valor}</span>}</div><p className="line-clamp-2 text-slate-700">{r.mensagem}</p><div className="text-[11px] text-slate-500">por {r.de_nome} · {fmtData(String(r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at).slice(0, 10))}{r.palmas ? ` · 👏 ${r.palmas}` : ""}</div></li>)}</ul>}
    </Card>
  );
}

async function BlocoComunicados({ s }: { s: Session }) {
  const h = hoje(); const u = scopeUnit(s);
  const rows = await sql<{ id: number; titulo: string; publicado_em: Date; requer_ciencia: boolean; li: boolean; prazo: string | null }[]>`SELECT a.id, a.titulo, a.publicado_em, a.requer_ciencia, a.prazo_ciencia::text AS prazo, EXISTS (SELECT 1 FROM announcement_acks k WHERE k.announcement_id=a.id AND k.user_id=${s.id}) AS li
    FROM announcements a WHERE (a.expira_em IS NULL OR a.expira_em >= ${h}) AND (a.publico='TODOS' OR (a.publico='UNIDADE' AND (${u === null} OR a.unit_id=${u ?? 0})) OR (a.publico='PERFIL' AND a.role=${s.role}) OR (a.publico='CARGO' AND a.position_id=${s.positionId ?? 0}) OR ${can.editar(s)})
    ORDER BY (a.requer_ciencia AND NOT EXISTS (SELECT 1 FROM announcement_acks k WHERE k.announcement_id=a.id AND k.user_id=${s.id})) DESC, a.fixado DESC, a.publicado_em DESC LIMIT 5`;
  return (
    <Card title="Comunicados" actions={<Link href="/comunicacao/comunicados" className="text-xs text-acao">Todos</Link>}>
      {rows.length === 0 ? <p className="text-sm text-slate-500">Nenhum comunicado vigente.</p> :
        <ul className="divide-y divide-line">{rows.map(r => <li key={r.id} className="flex items-center justify-between gap-2 py-2 text-sm"><Link href="/comunicacao/comunicados" className="min-w-0 truncate text-acao hover:underline">{r.titulo}</Link>{r.requer_ciencia && !r.li ? <Badge v="PENDENTE" label={r.prazo ? `ciência até ${fmtData(r.prazo)}` : "pede ciência"} /> : <span className="shrink-0 text-xs text-slate-500">{fmtData(r.publicado_em.toISOString().slice(0, 10))}</span>}</li>)}</ul>}
    </Card>
  );
}

async function BlocoAuditoria() {
  const ult = await sql<{ at: Date; user_nome: string; acao: string; entidade: string; entidade_id: number }[]>`SELECT at, user_nome, acao, entidade, entidade_id FROM audit_log ORDER BY at DESC LIMIT 8`;
  return (
    <Card title="Últimas ações registradas" actions={<Link href="/auditoria" className="text-xs text-acao">Auditoria</Link>}>
      <Table head={["Quando", "Quem", "Ação"]} empty="A trilha de auditoria começa com o primeiro registro.">
        {ult.map((a, i) => <tr key={i}><Td className="whitespace-nowrap text-slate-500">{fmtDataHora(a.at)}</Td><Td>{a.user_nome}</Td><Td>{a.acao} <span className="text-slate-500">{a.entidade}{a.entidade_id ? ` #${a.entidade_id}` : ""}</span></Td></tr>)}
      </Table>
    </Card>
  );
}
