// v31 · Feedback contínuo: recebidos, enviados, rascunhos, pedidos e — para a gestão — a cultura de feedback em números (sem conteúdo).
import Link from "@/components/Link";
import { requireSession, scopeUnit } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Table, Td, Badge, Flash, Field, Input, Select, Textarea, Btn, Stat } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { Colunas, COR } from "@/components/graficos";
import { getSettings, hoje, fmtData, fmtDataHora, addDays } from "@/lib/utils";
import { colegasConversa, rotuloColega, FORMATO_FB, VISIBILIDADE_FB, STATUS_PEDIDO, TOM_PEDIDO } from "@/lib/conversas";
import { rotuloMes } from "@/lib/formato";
import { excluirRascunho, responderRecebido, pedirFeedback, recusarPedido, cancelarPedido } from "./actions";

export const dynamic = "force-dynamic";
type Fb = { id: number; employee_id: number; para: string; autor_nome: string | null; autor_user_id: number | null; formato: string; assunto: string | null; texto: string | null; situacao: string | null; comportamento: string | null; impacto: string | null; evidencia: string | null; acordo: string | null; valores: string[] | null; course_id: number | null; curso: string | null; visibilidade: string; status: string; data: string; enviado_em: Date | null; ciencia_em: Date | null; agradecido_em: Date | null; comentario_colaborador: string | null; request_id: number | null; recognition_id: number | null };
const TOM_FORMATO: Record<string, string> = { ELOGIO: "APROVADA", LIVRE: "EM_ADMISSAO", SCI: "ATIVO", SUGESTAO: "PENDENTE" };

function Corpo({ f }: { f: Fb }) {
  return <div className="space-y-1.5 text-sm">
    {f.formato === "SCI" || (!f.texto && (f.situacao || f.comportamento)) ? <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">{f.situacao && <div><dt className="text-xs font-medium text-slate-500">Situação</dt><dd>{f.situacao}</dd></div>}{f.comportamento && <div><dt className="text-xs font-medium text-slate-500">Comportamento</dt><dd>{f.comportamento}</dd></div>}{f.impacto && <div><dt className="text-xs font-medium text-slate-500">Impacto</dt><dd>{f.impacto}</dd></div>}</dl> : <p className="whitespace-pre-wrap">{f.texto}</p>}
    {(f.evidencia || f.acordo) && <p className="text-xs text-slate-600">{f.evidencia ? `Evidência: ${f.evidencia}. ` : ""}{f.acordo ? `Acordo: ${f.acordo}.` : ""}</p>}
    {((f.valores ?? []).length > 0 || f.curso) && <div className="flex flex-wrap items-center gap-1.5">{(f.valores ?? []).map(v => <span key={v} className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-acao">{v}</span>)}{f.curso && <Link href={`/academy/cursos/${f.course_id}`} className="rounded-full border border-acao px-2 py-0.5 text-[11px] font-medium text-acao">📚 {f.curso}</Link>}</div>}
  </div>;
}

export default async function Feedback({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const sp = await searchParams; const h = hoje(); const cfg = await getSettings(); const u = scopeUnit(s);
  const gestaoAmpla = ["RH", "DIRECAO", "DIRETOR_UNIDADE"].includes(s.role);
  const ABAS: [string, string][] = [["recebidos", "Recebidos"], ["enviados", "Enviados"], ["rascunhos", "Rascunhos"], ["pedidos", "Pedidos"], ...(gestaoAmpla ? [["indicadores", "Indicadores"] as [string, string]] : [])];
  const aba = ABAS.some(a => a[0] === sp.aba) ? sp.aba! : "recebidos";
  const sel = sql`SELECT f.id, f.employee_id, e.nome AS para, f.autor_nome, f.autor_user_id, f.formato, f.assunto, f.texto, f.situacao, f.comportamento, f.impacto, f.evidencia, f.acordo, f.valores, f.course_id, c.titulo AS curso, f.visibilidade, f.status, f.data::text, f.enviado_em, f.ciencia_em, f.agradecido_em, f.comentario_colaborador, f.request_id, f.recognition_id FROM feedbacks f JOIN employees e ON e.id=f.employee_id LEFT JOIN courses c ON c.id=f.course_id`;
  const [recebidos, enviados, rascunhos, paraMim, meus, enviado] = await Promise.all([
    s.employeeId ? sql<Fb[]>`${sel} WHERE f.employee_id=${s.employeeId} AND f.status='ENVIADO' ORDER BY coalesce(f.enviado_em, f.created_at) DESC LIMIT 100` : Promise.resolve([] as Fb[]),
    sql<Fb[]>`${sel} WHERE f.autor_user_id=${s.id} AND f.status='ENVIADO' ORDER BY coalesce(f.enviado_em, f.created_at) DESC LIMIT 100`,
    sql<Fb[]>`${sel} WHERE f.autor_user_id=${s.id} AND f.status='RASCUNHO' ORDER BY f.created_at DESC`,
    sql<{ id: number; solicitante_nome: string | null; assunto: string; mensagem: string | null; prazo: string | null; status: string; created_at: Date }[]>`SELECT id, solicitante_nome, assunto, mensagem, prazo::text, status, created_at FROM feedback_requests WHERE para_user_id=${s.id} AND (status='PENDENTE' OR created_at >= now() - interval '90 days') ORDER BY status<>'PENDENTE', prazo NULLS LAST`,
    sql<{ id: number; para: string; assunto: string; prazo: string | null; status: string; created_at: Date; feedback_id: number | null }[]>`SELECT r.id, coalesce(e.nome, u.nome) AS para, r.assunto, r.prazo::text, r.status, r.created_at, r.feedback_id FROM feedback_requests r JOIN users u ON u.id=r.para_user_id LEFT JOIN employees e ON e.id=r.para_employee_id WHERE r.solicitante_user_id=${s.id} ORDER BY r.created_at DESC LIMIT 60`,
    sp.enviado ? sql<Fb[]>`${sel} WHERE f.id=${Number(sp.enviado)} AND f.autor_user_id=${s.id}` : Promise.resolve([] as Fb[]),
  ]);
  const novos = recebidos.filter(f => !f.ciencia_em).length; const pendentesMim = paraMim.filter(p => p.status === "PENDENTE");
  const colegas = aba === "pedidos" ? (await colegasConversa(s)).filter(c => c.user_id) : [];

  // indicadores (gestão): contagens por mês e por unidade — nenhum conteúdo, nenhum nome
  const ind = aba === "indicadores" && gestaoAmpla ? await (async () => {
    const ini = `${addDays(h, -365).slice(0, 7)}-01`;
    const meses = await sql<{ mes: string; elogios: number; desenvolvimento: number }[]>`SELECT to_char(coalesce(f.enviado_em, f.created_at), 'YYYY-MM') AS mes, count(*) FILTER (WHERE f.formato='ELOGIO' OR f.tipo='RECONHECIMENTO')::int AS elogios, count(*) FILTER (WHERE NOT (f.formato='ELOGIO' OR f.tipo='RECONHECIMENTO'))::int AS desenvolvimento FROM feedbacks f JOIN employees e ON e.id=f.employee_id WHERE f.status='ENVIADO' AND coalesce(f.enviado_em, f.created_at) >= ${ini} ${u === null ? sql`` : sql`AND e.unit_id=${u}`} GROUP BY 1 ORDER BY 1`;
    const un = await sql<{ unidade: string; pessoas: number; receberam: number; deram: number; enviados: number; pedidos: number; respondidos: number }[]>`SELECT un.nome AS unidade, count(DISTINCT e.id)::int AS pessoas,
        count(DISTINCT e.id) FILTER (WHERE EXISTS (SELECT 1 FROM feedbacks f WHERE f.employee_id=e.id AND f.status='ENVIADO' AND coalesce(f.enviado_em, f.created_at) >= ${addDays(h, -90)}))::int AS receberam,
        count(DISTINCT e.id) FILTER (WHERE EXISTS (SELECT 1 FROM feedbacks f JOIN users us ON us.id=f.autor_user_id WHERE us.employee_id=e.id AND f.status='ENVIADO' AND coalesce(f.enviado_em, f.created_at) >= ${addDays(h, -90)}))::int AS deram,
        (SELECT count(*) FROM feedbacks f JOIN employees x ON x.id=f.employee_id WHERE x.unit_id=un.id AND f.status='ENVIADO' AND coalesce(f.enviado_em, f.created_at) >= ${addDays(h, -90)})::int AS enviados,
        (SELECT count(*) FROM feedback_requests r JOIN employees x ON x.id=r.solicitante_employee_id WHERE x.unit_id=un.id AND r.created_at >= ${addDays(h, -90)})::int AS pedidos,
        (SELECT count(*) FROM feedback_requests r JOIN employees x ON x.id=r.solicitante_employee_id WHERE x.unit_id=un.id AND r.created_at >= ${addDays(h, -90)} AND r.status='RESPONDIDO')::int AS respondidos
      FROM employees e JOIN units un ON un.id=e.unit_id WHERE e.situacao IN ('ATIVO','FERIAS','AFASTADO') ${u === null ? sql`` : sql`AND e.unit_id=${u}`} GROUP BY un.id, un.nome ORDER BY un.nome`;
    return { meses, un };
  })() : null;
  const tot = ind ? ind.un.reduce((a, x) => ({ pessoas: a.pessoas + x.pessoas, receberam: a.receberam + x.receberam, deram: a.deram + x.deram, enviados: a.enviados + x.enviados, pedidos: a.pedidos + x.pedidos, respondidos: a.respondidos + x.respondidos }), { pessoas: 0, receberam: 0, deram: 0, enviados: 0, pedidos: 0, respondidos: 0 }) : null;
  const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "—");
  const link = (k: string) => `/feedback?aba=${k}`;
  const e0 = enviado[0];
  return (
    <Page title="Feedback" sub="Feedback contínuo entre colegas e da liderança: elogios no dia a dia, sugestões e conversas difíceis com contexto. Não vira nota."
      actions={<div className="flex flex-wrap gap-2"><Btn href="/feedback/novo">Mandar feedback</Btn><Btn kind="ghost" href="/feedback?aba=pedidos#pedir">Pedir feedback</Btn><Btn kind="ghost" href="/um-a-um">1:1</Btn></div>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      {e0 && <div className="mb-4 rounded-lg border border-emerald-200 bg-white p-4 text-center shadow-sm sm:mx-auto sm:max-w-md">
        <div className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-full bg-navy text-lg text-white" aria-hidden>✓</div>
        <div className="text-lg font-semibold text-navy">Feedback enviado</div>
        <div className="text-sm font-medium text-ink">Para {e0.para}</div>
        {e0.assunto && <div className="text-sm text-slate-600">Assunto: {e0.assunto}</div>}
        <div className="mt-1 text-[11px] text-slate-500">{VISIBILIDADE_FB[e0.visibilidade]}{e0.recognition_id ? " · também no Mural de reconhecimento" : ""}</div>
      </div>}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Recebidos" value={recebidos.length} hint={novos ? `${novos} sem ciência` : "todos com ciência"} href={link("recebidos")} />
        <Stat label="Enviados" value={enviados.length} href={link("enviados")} />
        <Stat label="Rascunhos" value={rascunhos.length} href={link("rascunhos")} />
        <Stat label="Pedidos para você" value={<span className={pendentesMim.length ? "text-aviso" : ""}>{pendentesMim.length}</span>} hint="aguardando a sua resposta" href={link("pedidos")} />
      </div>
      <nav aria-label="Seções" className="mb-3 flex flex-wrap gap-1 border-b border-line">{ABAS.map(([k, v]) => <Link key={k} href={link(k)} aria-current={aba === k ? "page" : undefined} className={`rounded-t px-3 py-2 text-sm ${aba === k ? "border border-b-white border-line bg-white font-medium text-navy" : "text-slate-600 hover:text-navy"}`}>{v}{k === "recebidos" && novos ? ` (${novos})` : k === "pedidos" && pendentesMim.length ? ` (${pendentesMim.length})` : ""}</Link>)}</nav>

      {aba === "recebidos" && <div className="space-y-3">{!s.employeeId ? <Card><p className="text-sm text-slate-500">Seu acesso não está vinculado a uma ficha — feedbacks recebidos aparecem para quem tem ficha.</p></Card> : recebidos.length === 0 ? <Card><p className="text-sm text-slate-500">Nenhum feedback recebido ainda. Que tal <Link className="text-acao" href="/feedback?aba=pedidos#pedir">pedir um</Link>?</p></Card> : recebidos.map(f => <Card key={f.id} title={<span className="flex flex-wrap items-center gap-2"><Badge v={TOM_FORMATO[f.formato] ?? "ATIVO"} label={FORMATO_FB[f.formato]?.rotulo ?? f.formato} />{f.assunto && <b className="text-sm">{f.assunto}</b>}<span className="text-xs font-normal text-slate-500">de {f.autor_nome ?? "—"} · {fmtDataHora(f.enviado_em ?? f.data)}</span>{!f.ciencia_em && <Badge v="PENDENTE" label="novo" />}</span>}>
        <Corpo f={f} />
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2 text-xs">
          <span className="text-slate-500">{VISIBILIDADE_FB[f.visibilidade]}</span>
          {f.ciencia_em ? <span className="text-ok">ciência em {fmtDataHora(f.ciencia_em)}{f.agradecido_em ? " · você agradeceu" : ""}</span> : null}
          {f.comentario_colaborador && <span className="text-slate-600">· seu comentário: “{f.comentario_colaborador}”</span>}
          <span className="ml-auto flex flex-wrap gap-2">
            {!f.agradecido_em && <form action={responderRecebido}><input type="hidden" name="id" value={f.id} /><input type="hidden" name="agradecer" value="1" /><Btn small kind="ghost">🙏 Agradecer</Btn></form>}
            <Modal label={f.ciencia_em ? "Comentar" : "Dar ciência"} kind="ghost" title="Responder ao feedback"><form action={responderRecebido} className="space-y-2"><input type="hidden" name="id" value={f.id} /><Field label="Comentário (opcional) — vai para quem mandou"><Textarea name="comentario" className="min-h-[60px]" maxLength={600} /></Field><label className="flex items-center gap-2 text-xs"><input type="checkbox" name="agradecer" value="1" /> Agradecer também</label><Btn small>Registrar</Btn></form></Modal>
          </span>
        </div>
      </Card>)}</div>}

      {aba === "enviados" && <Card title={`Enviados (${enviados.length})`}><Table head={["Para", "Formato e assunto", "Quando", "Quem vê", "Resposta"]} empty="Você ainda não mandou feedback.">{enviados.map(f => <tr key={f.id}>
        <Td className="font-medium">{f.para}</Td><Td><div className="text-sm">{FORMATO_FB[f.formato]?.rotulo ?? f.formato}</div>{f.assunto && <div className="text-xs text-slate-500">{f.assunto}</div>}{f.request_id ? <div className="text-[11px] text-acao">resposta a um pedido</div> : null}</Td>
        <Td className="whitespace-nowrap text-xs">{fmtDataHora(f.enviado_em ?? f.data)}</Td><Td className="text-xs">{VISIBILIDADE_FB[f.visibilidade]}</Td>
        <Td className="text-xs">{f.agradecido_em ? "🙏 agradeceu" : f.ciencia_em ? "ciência" : <span className="text-slate-400">ainda não leu</span>}{f.comentario_colaborador ? <div className="text-slate-600">“{f.comentario_colaborador}”</div> : null}</Td></tr>)}</Table></Card>}

      {aba === "rascunhos" && <Card title={`Rascunhos (${rascunhos.length})`}><Table head={["Para", "Formato e assunto", "Salvo em", ""]} empty="Nenhum rascunho.">{rascunhos.map(f => <tr key={f.id}><Td className="font-medium">{f.para}</Td><Td><div className="text-sm">{FORMATO_FB[f.formato]?.rotulo}</div>{f.assunto && <div className="text-xs text-slate-500">{f.assunto}</div>}</Td><Td className="whitespace-nowrap text-xs">{fmtData(f.data)}</Td><Td><div className="flex flex-wrap gap-2"><Btn small kind="ghost" href={`/feedback/novo?rascunho=${f.id}`}>Continuar</Btn><form action={excluirRascunho}><input type="hidden" name="id" value={f.id} /><Btn small kind="ghost" danger>Excluir</Btn></form></div></Td></tr>)}</Table><p className="mt-2 text-[11px] text-slate-500">Rascunho só você vê. Revise com calma antes de enviar — principalmente feedback de melhoria.</p></Card>}

      {aba === "pedidos" && <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <div className="space-y-4">
          <Card title={`Pedidos para você (${pendentesMim.length} aguardando)`}><Table head={["Quem pediu", "Sobre", "Prazo", "Situação", ""]} empty="Ninguém pediu feedback a você ainda.">{paraMim.map(p => <tr key={p.id}><Td className="font-medium">{p.solicitante_nome ?? "—"}</Td><Td><div className="text-sm">{p.assunto}</div>{p.mensagem && <div className="text-xs text-slate-500">“{p.mensagem}”</div>}</Td><Td className={`whitespace-nowrap text-xs ${p.status === "PENDENTE" && p.prazo && p.prazo < h ? "text-erro" : ""}`}>{p.prazo ? fmtData(p.prazo) : "—"}</Td><Td><Badge v={TOM_PEDIDO[p.status]} label={STATUS_PEDIDO[p.status]} /></Td>
            <Td>{p.status === "PENDENTE" && <div className="flex flex-wrap gap-2"><Btn small href={`/feedback/novo?pedido=${p.id}`}>Responder</Btn><Modal label="Recusar" kind="link" title="Recusar o pedido"><form action={recusarPedido} className="space-y-2"><input type="hidden" name="id" value={p.id} /><Field label="Motivo (opcional — vai para quem pediu)"><Input name="motivo" maxLength={300} placeholder="Ex.: não acompanhei esse trabalho de perto" /></Field><Btn small kind="ghost">Recusar</Btn></form></Modal></div>}</Td></tr>)}</Table></Card>
          <Card title={`Meus pedidos (${meus.length})`}><Table head={["Para", "Sobre", "Prazo", "Situação", ""]} empty="Você ainda não pediu feedback.">{meus.map(p => <tr key={p.id}><Td className="font-medium">{p.para}</Td><Td className="text-sm">{p.assunto}</Td><Td className="whitespace-nowrap text-xs">{p.prazo ? fmtData(p.prazo) : "—"}</Td><Td><Badge v={TOM_PEDIDO[p.status]} label={STATUS_PEDIDO[p.status]} /></Td><Td>{p.status === "PENDENTE" ? <form action={cancelarPedido}><input type="hidden" name="id" value={p.id} /><Btn small kind="ghost">Cancelar</Btn></form> : p.feedback_id ? <Link className="text-xs text-acao" href="/feedback?aba=recebidos">ver</Link> : null}</Td></tr>)}</Table></Card>
        </div>
        <Card title="Pedir feedback"><div id="pedir" />{!s.employeeId ? <p className="text-sm text-slate-500">Pedir feedback exige o acesso vinculado à sua ficha.</p> : <form action={pedirFeedback} className="space-y-2">
          <Field label={`Para quem (até ${cfg.conversas.pedidoMaxPessoas})`}><select name="para" multiple required className="h-36 w-full rounded-md border border-line px-2 py-1 text-xs">{colegas.map(c => <option key={c.id} value={c.id}>{rotuloColega(c)}</option>)}</select></Field>
          <Field label="Sobre o quê"><Input name="assunto" required minLength={5} maxLength={120} placeholder="Ex.: a condução da reunião de pais do 6º ano" /></Field>
          <Field label="Mensagem (opcional)"><Textarea name="mensagem" className="min-h-[60px]" maxLength={600} placeholder="Ex.: queria saber o que funcionou e o que posso mudar na próxima" /></Field>
          <Field label="Responder até"><Input name="prazo" type="date" min={h} defaultValue={addDays(h, Number(cfg.conversas.pedidoPrazoDias) || 7)} /></Field>
          <Btn small>Pedir</Btn><p className="text-[11px] text-slate-500">Segure Ctrl (ou ⌘) para escolher mais de uma pessoa. Só aparecem colegas com acesso ao ONE. A resposta chega em Recebidos.</p></form>}</Card>
      </div>}

      {aba === "indicadores" && ind && tot && <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Receberam feedback (90 dias)" value={pct(tot.receberam, tot.pessoas)} hint={`${tot.receberam} de ${tot.pessoas} pessoas`} />
          <Stat label="Deram feedback (90 dias)" value={pct(tot.deram, tot.pessoas)} hint={`${tot.deram} pessoas`} />
          <Stat label="Feedbacks enviados (90 dias)" value={tot.enviados} />
          <Stat label="Pedidos respondidos" value={pct(tot.respondidos, tot.pedidos)} hint={`${tot.respondidos} de ${tot.pedidos} pedidos (90 dias)`} />
        </div>
        <Card title="Feedbacks enviados por mês">{ind.meses.length === 0 ? <p className="text-sm text-slate-500">Sem feedbacks no período.</p> : <Colunas categorias={ind.meses.map(m => rotuloMes(m.mes))} series={[{ nome: "Elogios", valores: ind.meses.map(m => m.elogios), cor: COR.ok }, { nome: "Desenvolvimento e sugestões", valores: ind.meses.map(m => m.desenvolvimento), cor: COR.acao }]} empilhado rotulo="Feedbacks enviados por mês" />}</Card>
        <Card title="Por unidade (últimos 90 dias)"><Table head={["Unidade", "Pessoas", "Receberam", "Deram", "Enviados", "Pedidos respondidos"]}>{ind.un.map(x => <tr key={x.unidade}><Td className="font-medium">{x.unidade}</Td><Td className="tabular-nums">{x.pessoas}</Td><Td className="tabular-nums">{pct(x.receberam, x.pessoas)} <span className="text-xs text-slate-500">({x.receberam})</span></Td><Td className="tabular-nums">{pct(x.deram, x.pessoas)} <span className="text-xs text-slate-500">({x.deram})</span></Td><Td className="tabular-nums">{x.enviados}</Td><Td className="tabular-nums">{pct(x.respondidos, x.pedidos)} <span className="text-xs text-slate-500">({x.respondidos}/{x.pedidos})</span></Td></tr>)}</Table>
          <p className="mt-2 text-[11px] text-slate-500">Só contagens: o conteúdo dos feedbacks entre colegas não aparece para a gestão. “Deram” conta quem tem acesso ao ONE vinculado à ficha.</p></Card>
      </div>}
    </Page>
  );
}
