import Link from "@/components/Link";
import { Modal } from "@/components/Modal";
import { requireMatriculas, scopeUnit, can } from "@/lib/auth";
import { db, schema, sql } from "@/db";
import { asc } from "drizzle-orm";
import { Page, Card, Table, Td, Badge, Flash, Field, Input, Select, Textarea, Btn, Stat } from "@/components/ui";
import { fmtData, getSettings, hoje } from "@/lib/utils";
import { radarFamilias, type Familia } from "@/lib/radar-familia";
import { etapasJornada, type EtapaCfg } from "@/lib/gestao-calc";
import { atribuirCarteira, configurarJornada } from "../radar-actions";
import { usuariosAtivos } from "../_shared";
import { FormInteracao, SegBadge } from "../_radar";

export const dynamic = "force-dynamic";
const VISOES: Record<string, string> = { hoje: "Precisa de atenção hoje", todas: "Todas as famílias", risco: "Em risco", atencao: "Em atenção", saudaveis: "Saudáveis", semcontato: "Sem contato recente", jornada: "Jornada atrasada", rematricula: "Sem rematrícula" };

export default async function Radar({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireMatriculas(); const sp = await searchParams; const cfg = await getSettings(); const h = hoje();
  const scope = scopeUnit(s); const unitId = scope ?? (sp.unidade ? Number(sp.unidade) : null);
  const carteira = sp.carteira === "me" ? s.id : sp.carteira === "SEM" ? "SEM" as const : sp.carteira ? Number(sp.carteira) : null;
  const visao = sp.visao && VISOES[sp.visao] ? sp.visao : "hoje";
  const [r, units, users] = await Promise.all([radarFamilias(unitId, { carteira }), scope ? Promise.resolve([]) : db.select().from(schema.units).orderBy(asc(schema.units.nome)), usuariosAtivos()]);
  const etapas = cfg.atendimento.jornada as EtapaCfg[]; const sem = r.semContatoDias;
  const q = (sp.q ?? "").toLowerCase();
  const filtrar = (xs: Familia[]) => xs.filter(f => !q || `${f.nome} ${f.responsavel ?? ""}`.toLowerCase().includes(q));
  const base = visao === "hoje" ? r.atencaoHoje : visao === "risco" ? r.familias.filter(f => f.segmento === "RISCO") : visao === "atencao" ? r.familias.filter(f => f.segmento === "ATENCAO") : visao === "saudaveis" ? r.familias.filter(f => f.segmento === "SAUDAVEL") : visao === "semcontato" ? r.semContato : visao === "jornada" ? r.jornadaAtrasada : visao === "rematricula" ? r.familias.filter(f => !f.rematriculaOk) : r.familias;
  const lista = filtrar(base); const LIM = 300; const mostrar = lista.slice(0, LIM);
  const podeDistribuir = ["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR"].includes(s.role); const atende = ["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR", "COMERCIAL"].includes(s.role);
  const destinos = users.filter(x => scope === null || !["DIRETOR_UNIDADE", "GESTOR"].includes(x.role) || x.unitId === scope);
  const ids = r.familias.map(f => f.studentId);
  const porEtapa = ids.length ? await sql<{ etapa: string; n: number }[]>`SELECT etapa, count(*)::int AS n FROM family_journey WHERE ano=${r.ano} AND student_id = ANY(${ids}) GROUP BY etapa` : [];
  const qs = (extra: Record<string, string>) => { const p = new URLSearchParams(Object.entries({ visao, carteira: sp.carteira ?? "", unidade: sp.unidade ?? "", q: sp.q ?? "", ...extra }).filter(([, v]) => v)); const t = p.toString(); return `/atendimento/radar${t ? `?${t}` : ""}`; };
  const voltar = qs({}); const rs = r.resumo;
  const etapasAno = etapasJornada(etapas, r.ano, new Set(), h, cfg.atendimento.avisoEtapaDias);
  return (
    <Page title="Radar da família" sub="Carteira de famílias por responsável, jornada do ano, interações e próximos passos combinados. Segmento por regras explícitas: risco = pedido de saída ou pontuação alta; atenção = algum sinal, caso vencido ou próximo passo vencido. Jornada atrasada é obrigação da escola e não rebaixa a família." actions={<Btn kind="ghost" href="/api/export/radar">Exportar CSV</Btn>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <Stat label="Famílias ativas" value={rs.ativas} hint={carteira === s.id ? "na sua carteira" : carteira === "SEM" ? "sem responsável" : carteira ? "na carteira filtrada" : unitId ? "na unidade" : "na rede"} href={qs({ visao: "todas" })} />
        <Stat label="Saudáveis" value={<span className="text-ok">{rs.saudaveis}</span>} hint={rs.ativas ? `${Math.round((100 * rs.saudaveis) / rs.ativas)}%` : undefined} href={qs({ visao: "saudaveis" })} />
        <Stat label="Em atenção" value={<span className={rs.atencao ? "text-aviso" : ""}>{rs.atencao}</span>} href={qs({ visao: "atencao" })} />
        <Stat label="Em risco" value={<span className={rs.risco ? "text-erro" : ""}>{rs.risco}</span>} hint={`${rs.saidas} pedido(s) de saída`} href={qs({ visao: "risco" })} />
        <Stat label="Precisa de atenção hoje" value={<span className={r.atencaoHoje.length ? "text-erro" : ""}>{r.atencaoHoje.length}</span>} href={qs({ visao: "hoje" })} />
        <Stat label={`Sem rematrícula ${r.anoLetivo}`} value={<span className={rs.rematriculaPendente ? "text-aviso" : ""}>{rs.rematriculaPendente}</span>} href={qs({ visao: "rematricula" })} />
        <Stat label={`Sem contato há +${sem} dias`} value={rs.semContato} hint="inclui quem nunca teve contato registrado" href={qs({ visao: "semcontato" })} />
        <Stat label={`Jornada ${r.ano} atrasada`} value={r.jornadaAtrasada.length} hint="famílias com etapa vencida não cumprida" href={qs({ visao: "jornada" })} />
        <Stat label="NPS das famílias" value={rs.nps === null ? "—" : <span className={rs.nps >= 50 ? "text-ok" : rs.nps >= 0 ? "text-aviso" : "text-erro"}>{rs.nps}</span>} hint={`${rs.npsRespostas} resposta(s) em 180 dias`} href="/atendimento/pesquisas" />
        <Stat label={`Indicações em ${r.ano}`} value={rs.indicacoesAno} hint="candidatos indicados por famílias" />
      </div>
      <form className="mb-3 grid grid-cols-2 items-end gap-2 sm:flex sm:flex-wrap">
        <Field label="Visão"><Select name="visao" defaultValue={visao}>{Object.entries(VISOES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="Carteira"><Select name="carteira" defaultValue={sp.carteira ?? ""}><option value="">Todas</option><option value="me">Minha carteira</option><option value="SEM">Sem responsável</option>{destinos.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>
        {!scope && <Field label="Unidade"><Select name="unidade" defaultValue={sp.unidade ?? ""}><option value="">Rede</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>}
        <Field label="Buscar"><Input name="q" defaultValue={sp.q ?? ""} placeholder="aluno ou responsável" /></Field>
        <Btn kind="ghost">Filtrar</Btn>
      </form>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="space-y-4">
          {visao === "hoje" ? <Card title={`Precisa de atenção hoje (${lista.length})`}>
            {lista.length === 0 ? <p className="text-sm text-ok">Nenhuma família com pedido de saída, risco alto, caso vencido ou próximo passo vencido.</p> :
              <ul className="divide-y divide-line">{mostrar.map(f => <li key={f.studentId} className="flex flex-wrap items-start justify-between gap-2 py-2.5">
                <div className="min-w-0"><Link className="font-medium text-acao" href={`/matriculas/alunos/${f.studentId}#relacionamento`}>{f.nome}</Link> <SegBadge s={f.segmento} pontos={f.pontos} /><div className="text-xs text-slate-500">{f.unidade ?? "—"}{f.serie ? ` · ${f.serie}` : ""} · {f.responsavel ?? "responsável não informado"}{f.telefone ? ` · ${f.telefone}` : ""} · carteira: {f.carteira ?? "sem responsável"}</div>
                  <ul className="mt-0.5 text-xs text-erro">{f.motivosHoje.map((m, k) => <li key={k}>• {m}</li>)}</ul></div>
                {atende && <Modal label="Registrar interação" title={`Interação — ${f.nome}`}><FormInteracao studentId={f.studentId} voltar={voltar} etapas={etapas} /></Modal>}
              </li>)}</ul>}
          </Card> : <Card title={`${VISOES[visao]} (${lista.length})`}>
            <form action={atribuirCarteira}><input type="hidden" name="voltar" value={voltar} />
              {podeDistribuir && lista.length > 0 && <div className="mb-2 flex flex-wrap items-end gap-2 rounded-md bg-mist p-2"><Field label="Atribuir as marcadas a"><Select name="userId" defaultValue=""><option value="">— retirar da carteira —</option>{destinos.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field><Btn small kind="ghost">Atribuir carteira</Btn></div>}
              <Table head={[...(podeDistribuir ? [""] : []), "Família", "Segmento", "Carteira", "Último contato", "Jornada", `Rematrícula ${r.anoLetivo}`]} empty="Nenhuma família nesta visão.">{mostrar.map(f => <tr key={f.studentId}>
                {podeDistribuir && <Td><input type="checkbox" name="studentIds" value={f.studentId} aria-label={`marcar ${f.nome}`} /></Td>}
                <Td><Link className="font-medium text-acao" href={`/matriculas/alunos/${f.studentId}#relacionamento`}>{f.nome}</Link><div className="text-xs text-slate-500">{f.unidade ?? "—"}{f.serie ? ` · ${f.serie}` : ""} · {f.responsavel ?? "—"}</div></Td>
                <Td><SegBadge s={f.segmento} pontos={f.pontos} />{(f.motivosHoje.length > 0 || f.fatores.length > 0) && <div className="mt-0.5 max-w-[16rem] text-[11px] text-slate-600">{[...f.motivosHoje, ...f.fatores.map(x => x.texto)].slice(0, 3).join(" · ")}</div>}</Td>
                <Td className="text-xs">{f.carteira ?? <span className="text-aviso">sem responsável</span>}</Td>
                <Td className={`whitespace-nowrap text-xs ${f.diasSemContato === null || f.diasSemContato > sem ? "text-aviso" : ""}`}>{f.ultimoContato ? <>{fmtData(f.ultimoContato)}<div className="text-[11px] text-slate-500">há {f.diasSemContato} dia(s)</div></> : "nunca"}{f.passoVencido && <div className="text-[11px] text-erro">passo vencido</div>}</Td>
                <Td className="text-xs">{f.jornadaAtrasadas.length ? <span className="text-aviso">{f.jornadaAtrasadas.map(e => e.nome).join(", ")}</span> : f.jornadaProxima ? <span>próxima: {f.jornadaProxima.nome}{f.jornadaProxima.prazo ? ` até ${fmtData(f.jornadaProxima.prazo)}` : ""}</span> : <span className="text-slate-500">{f.jornadaConcluidas} cumprida(s)</span>}</Td>
                <Td className="text-xs">{f.rematriculaOk ? <Badge v="APROVADA" label="feita" /> : <Badge v="PENDENTE" label="pendente" />}</Td>
              </tr>)}</Table>
              {lista.length > LIM && <p className="mt-2 text-xs text-slate-500">Mostrando {LIM} de {lista.length}. Use os filtros de carteira, unidade ou busca.</p>}
            </form>
          </Card>}
          {r.voz.length > 0 && <Card title="Voz da família (pesquisas identificadas, 180 dias)"><ul className="space-y-1.5 text-sm">{r.voz.map((v, k) => <li key={k}><Link className="text-acao" href={`/matriculas/alunos/${v.student_id}#relacionamento`}>{v.nome}</Link> <span className={`text-xs ${v.nota >= 9 ? "text-ok" : v.nota <= 6 ? "text-erro" : "text-aviso"}`}>{v.tipo} {v.nota}</span> <span className="text-xs text-slate-500">{fmtData(v.data)}</span><div className="text-slate-700">“{v.comentario}”</div></li>)}</ul></Card>}
        </div>
        <div className="space-y-4">
          <Card title="Carteiras"><Table head={["Responsável", "Famílias", "Hoje", "Risco", "Sem contato"]} empty="Nenhuma família ativa.">{r.carteiras.map(c => <tr key={c.id}><Td><Link className="text-acao" href={`/atendimento/radar?visao=todas&carteira=${c.id === 0 ? "SEM" : c.id}${sp.unidade ? `&unidade=${sp.unidade}` : ""}`}>{c.nome}</Link></Td><Td className="tabular-nums">{c.familias}</Td><Td className={`tabular-nums ${c.hoje ? "text-erro" : ""}`}>{c.hoje}</Td><Td className={`tabular-nums ${c.risco ? "text-erro" : ""}`}>{c.risco}</Td><Td className="tabular-nums">{c.semContato}</Td></tr>)}</Table>
            {podeDistribuir && <p className="mt-2 text-xs text-slate-500">Para distribuir: escolha a visão “Todas as famílias” (ou “Sem responsável” na carteira), marque as famílias e atribua.</p>}</Card>
          <Card title={`Jornada da família ${r.ano}`}><ul className="space-y-2 text-sm">{etapasAno.map(e => { const n = porEtapa.find(p => p.etapa === e.chave)?.n ?? 0; const pct = rs.ativas ? Math.round((100 * n) / rs.ativas) : null; return <li key={e.chave}><div className="flex justify-between gap-2 text-xs"><span className="font-medium text-ink">{e.nome}</span><span className={e.status === "ATRASADA" && pct !== null && pct < 100 ? "text-aviso" : "text-slate-500"}>{e.prazo ? `até ${fmtData(e.prazo)}` : "sem prazo"}</span></div><div className="h-1.5 overflow-hidden rounded bg-mist"><div className={`h-1.5 ${e.status === "ATRASADA" && pct !== null && pct < 100 ? "bg-aviso" : "bg-ok"}`} style={{ width: `${pct ?? 0}%` }} /></div><div className="text-[11px] text-slate-500">{n} de {rs.ativas} família(s){pct !== null ? ` · ${pct}%` : ""}</div></li>; })}</ul>
            <p className="mt-2 text-xs text-slate-500">A etapa é cumprida ao registrar uma interação marcando a etapa, ou direto na ficha do aluno.</p></Card>
          {can.configurar(s) && <Card title="Configurar jornada"><form action={configurarJornada} className="space-y-2"><input type="hidden" name="voltar" value="/atendimento/radar" />
            <Field label="Etapas (uma por linha)" hint="Nome | DD/MM — prazo no ano; sem prazo, deixe só o nome."><Textarea name="jornada" defaultValue={etapas.map(e => `${e.nome}${e.ate ? ` | ${e.ate.split("-").reverse().join("/")}` : ""}`).join("\n")} className="min-h-[130px] font-mono text-xs" /></Field>
            <div className="grid grid-cols-2 gap-2"><Field label="Sem contato após (dias)"><Input name="semContatoDias" type="number" min="7" max="365" defaultValue={sem} /></Field><Field label="Avisar etapa (dias antes)"><Input name="avisoEtapaDias" type="number" min="1" max="90" defaultValue={cfg.atendimento.avisoEtapaDias} /></Field></div>
            <Btn small>Salvar jornada</Btn></form></Card>}
        </div>
      </div>
    </Page>
  );
}
