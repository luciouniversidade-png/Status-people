import { notFound } from "next/navigation";
import Link from "@/components/Link";
import { scopeUnit } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Table, Td, Badge, Flash, Field, Btn, Input, Select, Textarea, Stat } from "@/components/ui";
import { PrintButton } from "@/components/PrintButton";
import { fmtDataHora, hoje } from "@/lib/utils";
import { CHECK_STATUS, GRAVIDADE, fmtDuracao, autorizacoes, podePortaria } from "@/lib/seguranca";
import { registrarChamada, adicionarGrupo, registrarFalha, encerrarEmergencia } from "../../actions";
import { requireSeguranca, SubNavSeg, Retirada, BadgeRetirada } from "../../_ui";

export const dynamic = "force-dynamic";

export default async function Evento({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSeguranca(); const { id } = await params; const sp = await searchParams;
  const [ev] = await sql<{ id: number; unit_id: number; unidade: string; tipo: string; cenario: string; status: string; inicio: string; evacuacao_em: string | null; encerrado_em: string | null; tempo_evacuacao_seg: number | null; meta_seg: number | null; pontos_encontro: string | null; observacoes: string | null; coordenador: string | null; segundos: number }[]>`SELECT e.id, e.unit_id, u.nome AS unidade, e.tipo, e.cenario, e.status, e.inicio::text, e.evacuacao_em::text, e.encerrado_em::text, e.tempo_evacuacao_seg, e.meta_seg, e.pontos_encontro, e.observacoes, us.nome AS coordenador, extract(epoch FROM coalesce(e.encerrado_em, now()) - e.inicio)::int AS segundos FROM emergency_events e JOIN units u ON u.id=e.unit_id LEFT JOIN users us ON us.id=e.coordenador_user_id WHERE e.id=${Number(id)}`;
  if (!ev) notFound(); const escopo = scopeUnit(s); if (escopo !== null && escopo !== ev.unit_id) notFound();
  const aberto = ev.status === "EM_ANDAMENTO"; const age = aberto && s.role !== "LEITURA"; const opera = await podePortaria(s);
  const [grupos, falhas, entregas, users] = await Promise.all([
    sql<{ id: number; grupo: string; esperado: number | null; presentes: number | null; feridos: number; nao_localizados: number; status: string; responsavel: string | null; checado_em: string | null; checado_por: string | null; obs: string | null }[]>`SELECT id, grupo, esperado, presentes, feridos, nao_localizados, status, responsavel, checado_em::text, checado_por, obs FROM emergency_checks WHERE event_id=${ev.id} ORDER BY (status='PENDENTE') DESC, ordem`,
    sql<{ id: number; descricao: string; gravidade: string; action_plan_id: number | null; acao_status: string | null }[]>`SELECT f.id, f.descricao, f.gravidade, f.action_plan_id, a.status AS acao_status FROM emergency_failures f LEFT JOIN action_plans a ON a.id=f.action_plan_id WHERE f.event_id=${ev.id} ORDER BY f.id`,
    sql<{ id: number; aluno: string; hora: string; retirado_por: string; status: string; excecao_justificativa: string | null }[]>`SELECT d.id, st.nome AS aluno, d.hora, d.retirado_por, d.status, d.excecao_justificativa FROM early_departures d JOIN students st ON st.id=d.student_id WHERE d.emergency_event_id=${ev.id} ORDER BY d.created_at DESC`,
    sql<{ id: number; nome: string }[]>`SELECT id, nome FROM users WHERE ativo AND role NOT IN ('LEITURA','COLABORADOR') AND (unit_id IS NULL OR unit_id=${ev.unit_id}) ORDER BY nome`]);
  const tot = grupos.reduce((a, g) => ({ esp: a.esp + (g.esperado ?? 0), pres: a.pres + (g.presentes ?? 0), fer: a.fer + g.feridos, nao: a.nao + g.nao_localizados }), { esp: 0, pres: 0, fer: 0, nao: 0 });
  const pend = grupos.filter(g => g.status === "PENDENTE").length; const q = (sp.q ?? "").trim();
  const achados = q.length >= 2 && aberto ? await sql<{ id: number; nome: string; serie: string | null }[]>`SELECT st.id, st.nome, g.nome AS serie FROM students st LEFT JOIN grades g ON g.id=st.serie_atual_id WHERE st.aluno_atual AND st.unit_atual_id=${ev.unit_id} AND st.nome ILIKE ${"%" + q + "%"} ORDER BY st.nome LIMIT 10` : [];
  const sel = sp.studentId && aberto ? (await sql<{ id: number; nome: string; serie: string | null; unit: number | null }[]>`SELECT st.id, st.nome, g.nome AS serie, st.unit_atual_id AS unit FROM students st LEFT JOIN grades g ON g.id=st.serie_atual_id WHERE st.id=${Number(sp.studentId)} AND st.aluno_atual`)[0] : undefined;
  const selOk = sel && sel.unit === ev.unit_id ? sel : undefined; const lista = selOk ? await autorizacoes(selOk.id) : [];
  const b = `/operacoes/seguranca/emergencias/${ev.id}`;
  return (
    <Page title={`${ev.tipo === "REAL" ? "Emergência" : "Simulado"}: ${ev.cenario}`} sub={<>{ev.unidade} · início {fmtDataHora(ev.inicio)}{ev.coordenador ? ` · coordenação: ${ev.coordenador}` : ""}{ev.pontos_encontro ? ` · ponto de encontro: ${ev.pontos_encontro}` : ""}</>} actions={<PrintButton />}>
      <SubNavSeg ativo="/operacoes/seguranca/emergencias" />
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label={aberto ? "Tempo desde o início" : "Duração"} value={fmtDuracao(ev.segundos)} />
        <Stat label="Evacuação (último grupo)" value={ev.tempo_evacuacao_seg !== null ? <span className={ev.meta_seg && ev.tempo_evacuacao_seg > ev.meta_seg ? "text-erro" : "text-ok"}>{fmtDuracao(ev.tempo_evacuacao_seg)}</span> : `${pend} grupo(s) faltando`} hint={ev.meta_seg ? `meta ${Math.round(ev.meta_seg / 60)} min` : undefined} />
        <Stat label="Presentes / esperados" value={`${tot.pres}/${tot.esp}`} />
        <Stat label="Feridos" value={<span className={tot.fer ? "text-erro" : ""}>{tot.fer}</span>} />
        <Stat label="Não localizados" value={<span className={tot.nao ? "text-erro" : ""}>{tot.nao}</span>} />
      </div>
      {!aberto && <p className="mb-3 text-sm text-slate-600">Encerrado em {fmtDataHora(ev.encerrado_em)}.{ev.observacoes ? ` ${ev.observacoes}` : ""}</p>}
      <Card title={<span id="grupos">Chamada por grupo no ponto de encontro</span>} className="mb-4">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">{grupos.map(g => <div key={g.id} className={`rounded-md border p-3 ${g.status === "PENDENTE" ? "border-amber-300 bg-amber-50/40" : g.status === "OCORRENCIA" ? "border-erro bg-red-50/40" : "border-emerald-200 bg-emerald-50/40"}`}>
          <div className="flex items-center justify-between gap-2"><b className="text-navy">{g.grupo}</b><Badge v={g.status === "SEGURO" ? "APROVADA" : g.status === "OCORRENCIA" ? "REJEITADA" : "PENDENTE"} label={CHECK_STATUS[g.status]} /></div>
          <div className="text-xs text-slate-600">esperados: {g.esperado ?? "—"}{g.checado_em ? ` · ${g.presentes} presentes${g.feridos ? ` · ${g.feridos} ferido(s)` : ""}${g.nao_localizados ? ` · ${g.nao_localizados} não localizado(s)` : ""} · ${fmtDataHora(g.checado_em).slice(-5)} ${g.checado_por ?? ""}` : ""}</div>{g.obs && <div className="text-xs text-slate-500">{g.obs}</div>}
          {age && <div className="mt-2 space-y-2">
            {g.status === "PENDENTE" && <form action={registrarChamada}><input type="hidden" name="id" value={g.id} /><input type="hidden" name="todos" value="1" /><Btn small>Todos presentes e seguros</Btn></form>}
            <details><summary className="cursor-pointer text-xs text-acao">Registrar contagem</summary>
              <form action={registrarChamada} className="mt-2 space-y-2"><input type="hidden" name="id" value={g.id} />
                <div className="grid grid-cols-3 gap-2"><Field label="Presentes"><Input name="presentes" type="number" min={0} inputMode="numeric" defaultValue={g.presentes ?? ""} /></Field><Field label="Feridos"><Input name="feridos" type="number" min={0} defaultValue={g.feridos || ""} /></Field><Field label="Não localiz."><Input name="naoLocalizados" type="number" min={0} defaultValue={g.nao_localizados || ""} /></Field></div>
                <div className="grid grid-cols-2 gap-2"><Field label="Responsável pelo grupo"><Input name="responsavel" defaultValue={g.responsavel ?? ""} /></Field><Field label="Observação"><Input name="obs" defaultValue={g.obs ?? ""} /></Field></div><Btn small kind="ghost">Salvar contagem</Btn></form></details>
          </div>}
        </div>)}</div>
        {age && <form action={adicionarGrupo} className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3"><input type="hidden" name="eventId" value={ev.id} /><Field label="Outro grupo (turma, equipe, evento)"><Input name="grupo" /></Field><Field label="Esperados"><Input name="esperado" type="number" min={0} className="w-24" /></Field><Btn small kind="ghost">Incluir na chamada</Btn></form>}
      </Card>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
        <Card title={`Entrega às famílias (${entregas.filter(x => x.status === "LIBERADA").length})`}>
          {aberto && opera && <><form className="mb-3 flex flex-wrap items-end gap-2"><Field label="Aluno" className="min-w-0 flex-1"><Input name="q" defaultValue={q} placeholder="Parte do nome" /></Field><Btn kind="ghost">Buscar</Btn></form>
            {q && !selOk && <ul className="mb-3 divide-y divide-line text-sm">{achados.map(a => <li key={a.id} className="py-1.5"><Link className="text-acao" href={`${b}?studentId=${a.id}`}>{a.nome}</Link><span className="text-xs text-slate-500"> · {a.serie ?? "sem série"}</span></li>)}{achados.length === 0 && <li className="py-1.5 text-slate-500">Nenhum aluno encontrado.</li>}</ul>}
            {selOk && <div className="mb-3 rounded-md border border-line p-2"><Retirada s={s} aluno={selOk} lista={lista} voltar={b} eventId={ev.id} /></div>}</>}
          <Table head={["Hora", "Aluno", "Com", ""]} empty="Nenhuma entrega registrada.">{entregas.map(x => <tr key={x.id}><Td>{x.hora}</Td><Td>{x.aluno}</Td><Td>{x.retirado_por}</Td><Td><BadgeRetirada status={x.status} excecao={x.excecao_justificativa} /></Td></tr>)}</Table>
        </Card>
        <Card title={<span id="falhas">Falhas observadas e ações ({falhas.length})</span>}>
          {falhas.length === 0 ? <p className="mb-2 text-sm text-slate-500">Nenhuma falha registrada.</p> : <ul className="mb-3 space-y-1 text-sm">{falhas.map(f => <li key={f.id}><Badge v={f.gravidade === "ALTA" ? "REJEITADA" : f.gravidade === "MEDIA" ? "PENDENTE" : "NEUTRO"} label={GRAVIDADE[f.gravidade]} /> {f.descricao}{f.action_plan_id ? <> — <Link className="text-acao" href={`/estrategia/acoes/${f.action_plan_id}`}>ação #{f.action_plan_id}</Link> <span className="text-xs text-slate-500">({f.acao_status?.toLowerCase().replace("_", " ")})</span></> : null}</li>)}</ul>}
          {s.role !== "LEITURA" && <form action={registrarFalha} className="space-y-2 border-t border-line pt-3"><input type="hidden" name="eventId" value={ev.id} />
            <Field label="Falha observada"><Input name="descricao" required placeholder="Ex.: alarme não foi ouvido no bloco B" /></Field>
            <div className="grid grid-cols-2 gap-2"><Field label="Gravidade"><Select name="gravidade" defaultValue="MEDIA">{Object.entries(GRAVIDADE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field><Field label="Criar ação corretiva"><Select name="criarAcao" defaultValue="1"><option value="1">Sim (plano de ação)</option><option value="0">Não</option></Select></Field>
              <Field label="Responsável"><Select name="responsavelUserId"><option value="">—</option>{users.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field><Field label="Prazo"><Input name="prazo" type="date" min={hoje()} /></Field></div>
            <Btn small kind="ghost">Registrar falha</Btn></form>}
        </Card>
      </div>
      {age && <Card className="mt-4" title="Encerrar">
        <form action={encerrarEmergencia} className="space-y-2"><input type="hidden" name="eventId" value={ev.id} />
          <Field label="Observações finais"><Textarea name="observacoes" className="min-h-[50px]" /></Field>
          {(pend > 0 || tot.nao > 0) && <Field label="Justificativa (grupos sem chamada ou pessoas não localizadas)"><Input name="justificativa" /></Field>}
          <Btn small danger>Encerrar {ev.tipo === "REAL" ? "emergência" : "simulado"}</Btn></form></Card>}
    </Page>
  );
}
