import Link from "@/components/Link";
import { notFound } from "next/navigation";
import { eq, asc } from "drizzle-orm";
import { headers } from "next/headers";
import { db, schema, sql } from "@/db";
import { requireStaff, scopeUnit, can } from "@/lib/auth";
import { Page, Card, Table, Td, Badge, Flash, Field, Input, Select, Btn, Stat } from "@/components/ui";
import { fmtData } from "@/lib/utils";
import { SURVEY_TIPO, SURVEY_STATUS, ACTION_STATUS, resultadosPesquisa, type Pergunta } from "@/lib/clima-academy";
import { statusPesquisa, salvarAcaoClima } from "../../clima-academy/actions";

export const dynamic = "force-dynamic";

export default async function Pesquisa({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaff(); const { id } = await params; const sp = await searchParams; const sid = Number(id);
  const [sv] = await db.select().from(schema.climateSurveys).where(eq(schema.climateSurveys.id, sid)); if (!sv) notFound();
  const u = scopeUnit(s); if (u !== null && sv.unitId !== null && sv.unitId !== u) notFound();
  const perguntas = sv.perguntas as Pergunta[]; const res = await resultadosPesquisa(sid, sv.minimoAnonimato, perguntas);
  const [acoes, users, units, [ativos]] = await Promise.all([
    sql<{ id: number; dimensao: string | null; acao: string; responsavel: string | null; prazo: string | null; status: string; unidade: string | null; unit_id: number | null; responsavel_user_id: number | null }[]>`SELECT a.id, a.dimensao, a.acao, us.nome AS responsavel, a.prazo::text, a.status, un.nome AS unidade, a.unit_id, a.responsavel_user_id FROM climate_actions a LEFT JOIN users us ON us.id=a.responsavel_user_id LEFT JOIN units un ON un.id=a.unit_id WHERE a.survey_id=${sid} ORDER BY a.status, a.prazo NULLS LAST`,
    sql<{ id: number; nome: string }[]>`SELECT id, nome FROM users WHERE ativo AND role IN ('RH','DIRECAO','DIRETOR_UNIDADE','GESTOR') ORDER BY nome`, db.select().from(schema.units).orderBy(asc(schema.units.nome)),
    sql<{ n: number }[]>`SELECT count(*)::int AS n FROM employees WHERE situacao='ATIVO' ${sv.unitId ? sql`AND unit_id=${sv.unitId}` : sql``}`,
  ]);
  // v27 · comparação com a pesquisa anterior do mesmo tipo (e mesmo recorte de unidade)
  const [ant] = await sql<{ id: number; nome: string; perguntas: Pergunta[]; minimo_anonimato: number }[]>`SELECT id, nome, perguntas, minimo_anonimato FROM climate_surveys WHERE id<>${sid} AND tipo=${sv.tipo} AND status='ENCERRADA' AND fim < ${sv.inicio} AND ${sv.unitId === null ? sql`unit_id IS NULL` : sql`unit_id=${sv.unitId}`} ORDER BY fim DESC LIMIT 1`;
  const resAnt = ant ? await resultadosPesquisa(ant.id, ant.minimo_anonimato, ant.perguntas) : null;
  const h = await headers(); const host = h.get("x-forwarded-host") ?? h.get("host") ?? ""; const proto = h.get("x-forwarded-proto") ?? "https"; const link = `${proto}://${host}/pesquisa/${sv.token}`;
  const heatVisivel = u === null ? res.heat : res.heat.filter(x => units.find(un => un.nome === x.unidade)?.id === u);
  return (
    <Page title={sv.nome} sub={<span className="flex flex-wrap items-center gap-2"><Badge v={sv.status === "ABERTA" ? "EM_ADMISSAO" : sv.status === "ENCERRADA" ? "APROVADA" : "EM_AQUISICAO"} label={SURVEY_STATUS[sv.status]} /> {SURVEY_TIPO[sv.tipo]} · {fmtData(sv.inicio)} – {fmtData(sv.fim)} · anonimato: mínimo {sv.minimoAnonimato} respostas por recorte · <Link className="text-acao" href="/clima">pesquisas</Link></span>}
      actions={can.editar(s) ? <form action={statusPesquisa} className="flex gap-1"><input type="hidden" name="id" value={sid} />{sv.status !== "ABERTA" && <Btn name="status" value="ABERTA">Abrir</Btn>}{sv.status === "ABERTA" && <Btn kind="ghost" name="status" value="ENCERRADA">Encerrar</Btn>}</form> : undefined}>
      <Flash ok={sp.ok} erro={sp.erro} />
      {sv.status === "ABERTA" && can.editar(s) && <Card className="mb-4 border-sky-200"><p className="text-sm"><b>Link anônimo para a equipe:</b> <code className="rounded bg-mist px-2 py-0.5 text-xs">{link}</code></p><p className="mt-1 text-xs text-slate-500">Envie por WhatsApp ou e-mail. Não exige login; cada navegador responde uma vez. As respostas não guardam nome nem usuário.</p></Card>}
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="Respostas" value={res.total} hint={ativos.n ? `${Math.round(100 * res.total / ativos.n)}% dos ${ativos.n} ativos` : undefined} />
        <Stat label="eNPS" value={res.enps === null ? "—" : <span className={res.enps >= 50 ? "text-ok" : res.enps >= 0 ? "text-aviso" : "text-erro"}>{res.enps}</span>} hint={res.enps === null ? `mínimo ${sv.minimoAnonimato} respostas` : `${res.enpsN} respostas · promotores 9–10, detratores 0–6`} />
        <Stat label="Favorabilidade média" value={(() => { const v = res.geral.map(g => g.favoravel).filter((x): x is number => x !== null); return v.length ? `${Math.round(v.reduce((a, b) => a + b, 0) / v.length)}%` : "—"; })()} hint="respostas 4 ou 5 na escala" />
        <Stat label="Comentários" value={res.comentarios.length} hint={res.comentariosOcultos ? `${res.comentariosOcultos} ocultos até o mínimo` : undefined} />
      </div>
      {res.porDimensao.length > 0 && <Card className="mb-4" title={`Favorável · neutro · desfavorável por dimensão${ant ? ` — comparado a “${ant.nome}”` : ""}`}>
        <div className="space-y-2">{res.porDimensao.map(d => { const a = resAnt?.porDimensao.find(x => x.dimensao === d.dimensao); const dif = a?.favoravel != null && d.favoravel != null ? d.favoravel - a.favoravel : null; return <div key={d.dimensao} className="grid grid-cols-[minmax(0,9rem)_1fr_4.5rem] items-center gap-2 text-sm sm:grid-cols-[12rem_1fr_5rem]">
          <span className="truncate font-medium text-navy" title={d.dimensao}>{d.dimensao}</span>
          {d.favoravel === null ? <span className="text-xs text-slate-400">abaixo do mínimo de anonimato</span> : <div className="flex h-5 overflow-hidden rounded text-[10px] font-semibold text-white"><div className="flex items-center justify-center bg-ok" style={{ width: `${d.favoravel}%` }}>{d.favoravel >= 8 ? `${d.favoravel}%` : ""}</div><div className="flex items-center justify-center bg-slate-300 text-slate-700" style={{ width: `${d.neutro}%` }}>{(d.neutro ?? 0) >= 8 ? `${d.neutro}` : ""}</div><div className="flex items-center justify-center bg-erro" style={{ width: `${d.desfavoravel}%` }}>{(d.desfavoravel ?? 0) >= 8 ? `${d.desfavoravel}` : ""}</div></div>}
          <span className={`text-right text-xs tabular-nums ${dif == null ? "text-slate-400" : dif > 0 ? "text-ok" : dif < 0 ? "text-erro" : "text-slate-500"}`}>{dif == null ? (ant ? "sem comparação" : "—") : `${dif > 0 ? "+" : ""}${dif} p.p.`}</span></div>; })}</div>
        <p className="mt-2 text-[11px] text-slate-500"><span className="text-ok">■</span> favorável (4–5) · <span className="text-slate-400">■</span> neutro (3) · <span className="text-erro">■</span> desfavorável (1–2). A última coluna compara a favorabilidade com a pesquisa anterior do mesmo tipo.</p>
      </Card>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
        <Card title="Resultado por dimensão"><Table head={["Dimensão", "Pergunta", "n", "Média (1–5)", "Fav. · neutro · desf."]} empty="Sem respostas ainda.">{res.geral.map(g => <tr key={g.q.id}><Td className="font-medium">{g.q.dimensao}</Td><Td className="text-xs text-slate-600">{g.q.texto}</Td><Td>{g.n}</Td><Td className={`tabular-nums font-medium ${g.media === null ? "text-slate-400" : g.media >= 4 ? "text-ok" : g.media >= 3 ? "text-aviso" : "text-erro"}`}>{g.media === null ? "—" : g.media.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}</Td><Td className="whitespace-nowrap text-xs">{g.favoravel === null ? "—" : <><b className="text-ok">{g.favoravel}%</b> · {g.neutro}% · <span className="text-erro">{g.desfavoravel}%</span></>}</Td></tr>)}</Table></Card>
        <Card title="Mapa de calor por unidade">
          {heatVisivel.length === 0 ? <p className="text-sm text-slate-500">Sem respostas com unidade informada.</p> : <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr><th className="px-2 py-1 text-left">Unidade</th><th className="px-2 py-1">n</th>{res.geral.map(g => <th key={g.q.id} className="px-1 py-1 text-center">{g.q.dimensao.split(" ")[0]}</th>)}<th className="px-2 py-1">eNPS</th></tr></thead><tbody>{heatVisivel.map(hh => <tr key={hh.unidade}><td className="px-2 py-1 font-medium">{hh.unidade}</td><td className="px-2 py-1 text-center">{hh.n}</td>{hh.celulas.map((c, i) => <td key={i} className={`px-1 py-1 text-center font-medium ${c === null ? "text-slate-400" : c >= 4 ? "bg-emerald-50 text-ok" : c >= 3 ? "bg-amber-50 text-aviso" : "bg-red-50 text-erro"}`}>{c === null ? "—" : c.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}</td>)}<td className={`px-2 py-1 text-center font-medium ${hh.enps === null ? "text-slate-400" : hh.enps >= 50 ? "text-ok" : hh.enps >= 0 ? "text-aviso" : "text-erro"}`}>{hh.enps ?? "—"}</td></tr>)}</tbody></table></div>}
          <p className="mt-2 text-xs text-slate-500">"—" = menos de {sv.minimoAnonimato} respostas no recorte (protegido). {res.semUnidade ? `${res.semUnidade} resposta(s) sem unidade informada.` : ""}</p>
        </Card>
        <Card title="Comentários (anônimos)">{res.comentarios.length === 0 ? <p className="text-sm text-slate-500">{res.comentariosOcultos ? `Comentários ficam ocultos até haver ${sv.minimoAnonimato} respostas.` : "Nenhum comentário."}</p> : <ul className="space-y-2 text-sm">{res.comentarios.map((c, i) => <li key={i} className="rounded bg-mist px-3 py-2 whitespace-pre-wrap">{c}</li>)}</ul>}</Card>
        <Card title="Plano de ação"><div id="acoes" />
          <Table head={["Dimensão", "Ação", "Responsável", "Prazo", "Unidade", "Situação"]} empty="Nenhuma ação ainda.">{acoes.map(a => <tr key={a.id}><Td className="text-xs">{a.dimensao ?? "—"}</Td><Td>{a.acao}</Td><Td className="text-xs">{a.responsavel ?? "—"}</Td><Td className="text-xs">{fmtData(a.prazo)}</Td><Td className="text-xs">{a.unidade ?? "rede"}</Td><Td>{/* v24.1: a situação de cada ação é atualizada aqui mesmo (planejada → em andamento → concluída) */}{["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR"].includes(s.role) && (u === null || a.unit_id === null || a.unit_id === u) ? <form action={salvarAcaoClima} className="flex items-center gap-1 print:hidden"><input type="hidden" name="surveyId" value={sid} /><input type="hidden" name="id" value={a.id} /><input type="hidden" name="acao" value={a.acao} /><input type="hidden" name="dimensao" value={a.dimensao ?? ""} /><input type="hidden" name="unitId" value={a.unit_id ?? ""} /><input type="hidden" name="responsavelUserId" value={a.responsavel_user_id ?? ""} /><input type="hidden" name="prazo" value={a.prazo ?? ""} /><Select name="status" defaultValue={a.status} aria-label="Situação da ação" className="min-w-[8.5rem] py-1 text-xs">{Object.entries(ACTION_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select><Btn small kind="ghost">ok</Btn></form> : <Badge v={a.status === "CONCLUIDA" ? "APROVADA" : a.status === "EM_ANDAMENTO" ? "EM_ADMISSAO" : "PENDENTE"} label={ACTION_STATUS[a.status]} />}</Td></tr>)}</Table>
          {["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR"].includes(s.role) && <form action={salvarAcaoClima} className="mt-3 grid grid-cols-1 gap-2 border-t border-line pt-3 sm:grid-cols-2"><input type="hidden" name="surveyId" value={sid} />
            <Field label="Dimensão"><Select name="dimensao" defaultValue=""><option value="">—</option>{[...new Set(perguntas.map(p => p.dimensao))].map(d => <option key={d}>{d}</option>)}</Select></Field><Field label="Unidade"><Select name="unitId" defaultValue={u ?? ""}><option value="">Rede</option>{units.filter(x => u === null || x.id === u).map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field>
            <Field label="Ação" className="sm:col-span-2"><Input name="acao" required /></Field><Field label="Responsável"><Select name="responsavelUserId" defaultValue={s.id}>{users.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field><Field label="Prazo"><Input name="prazo" type="date" /></Field><div className="sm:col-span-2"><Btn small>Adicionar ação</Btn></div></form>}
        </Card>
      </div>
    </Page>
  );
}
