import Link from "@/components/Link";
import { redirect } from "next/navigation";
import { requireSession, scopeUnit } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Flash, Btn, Field, Input, Select, Stat } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { addDays, hoje, getSettings, fmtDataHora } from "@/lib/utils";
import * as E from "@/lib/escalas";
import { salvarTurno, salvarEquipe, salvarGrade, copiarSemana, aplicarPadrao, publicarSemana } from "./actions";

export const dynamic = "force-dynamic";

/** v34 · Escalas das equipes de apoio: a grade da semana com turnos e folgas, alertas trabalhistas, padrões e publicação. */
export default async function Escalas({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); if (!E.veEscalas(s)) redirect("/sem-acesso?t=%2Fponto%2Fescalas"); const sp = await searchParams;
  const cfg = await getSettings(); const u = scopeUnit(s); const aba = ["equipes", "turnos"].includes(sp.aba ?? "") ? sp.aba! : "grade";
  const [turnos, equipes, units, users] = await Promise.all([
    sql<E.Turno[]>`SELECT id, nome, sigla, inicio, fim, intervalo_min, cor, ativo FROM shift_types ORDER BY ativo DESC, inicio`,
    sql<{ id: number; nome: string; unit_id: number; unidade: string; responsavel_user_id: number | null; responsavel: string | null; cobertura: { turnoId: number; minimo: number }[]; cobertura_dias: string; membros: number }[]>`SELECT t.id, t.nome, t.unit_id, un.nome AS unidade, t.responsavel_user_id, us.nome AS responsavel, t.cobertura, t.cobertura_dias, (SELECT count(*) FROM shift_team_members m WHERE m.team_id=t.id)::int AS membros FROM shift_teams t JOIN units un ON un.id=t.unit_id LEFT JOIN users us ON us.id=t.responsavel_user_id WHERE t.ativo ${u === null ? sql`` : sql`AND t.unit_id=${u}`} ORDER BY un.nome, t.nome`,
    sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ${u === null ? sql`` : sql`WHERE id=${u}`} ORDER BY nome`,
    sql<{ id: number; nome: string }[]>`SELECT id, nome FROM users WHERE ativo AND role <> 'COLABORADOR' ORDER BY nome`,
  ]);
  const minhas = equipes.filter(t => E.podeEditarEquipe(s, t) || ["RH", "DIRECAO", "DIRETOR_UNIDADE"].includes(s.role));
  const team = minhas.find(t => t.id === Number(sp.equipe)) ?? minhas[0] ?? null; const seg = E.segunda(sp.semana && /^\d{4}-\d{2}-\d{2}$/.test(sp.semana) ? sp.semana : hoje());
  const dias = E.diasDaSemana(seg); const T = new Map(turnos.map(t => [t.id, t])); const ativos = turnos.filter(t => t.ativo);
  const abas = <div className="mb-3 flex flex-wrap gap-2 text-xs">{[["grade", "Escala da semana"], ["equipes", "Equipes"], ["turnos", "Turnos"]].map(([k, r]) => <Link key={k} href={`/ponto/escalas?aba=${k}${team ? `&equipe=${team.id}` : ""}`} className={`rounded-full border px-2.5 py-1 ${aba === k ? "border-acao bg-sky-50 text-acao" : "border-line text-slate-600"}`}>{r}</Link>)}</div>;
  const FormEquipe = async ({ t }: { t?: typeof equipes[number] }) => {
    const pessoas = await sql<{ id: number; nome: string; cargo: string | null }[]>`SELECT e.id, e.nome, p.nome AS cargo FROM employees e LEFT JOIN positions p ON p.id=e.position_id WHERE e.situacao <> 'DESLIGADO' ${t ? sql`AND e.unit_id=${t.unit_id}` : u === null ? sql`` : sql`AND e.unit_id=${u}`} ORDER BY e.nome`;
    const marcados = t ? new Set((await sql<{ employee_id: number }[]>`SELECT employee_id FROM shift_team_members WHERE team_id=${t.id}`).map(r => r.employee_id)) : new Set<number>();
    return <form action={salvarEquipe} className="space-y-2">{t ? <input type="hidden" name="id" value={t.id} /> : null}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><Field label="Nome"><Input name="nome" defaultValue={t?.nome ?? ""} required placeholder="ex.: Portaria Carandá" /></Field><Field label="Unidade"><Select name="unitId" defaultValue={t ? String(t.unit_id) : ""}>{units.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field></div>
      <Field label="Responsável (monta a escala junto com o RH)"><Select name="responsavelUserId" defaultValue={t?.responsavel_user_id ? String(t.responsavel_user_id) : ""}><option value="">—</option>{users.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field>
      <Field label="Pessoas da equipe"><select name="membros" multiple size={8} defaultValue={[...marcados].map(String)} className="w-full rounded-md border border-line px-2 py-1 text-sm">{pessoas.map(p => <option key={p.id} value={p.id}>{p.nome}{p.cargo ? ` · ${p.cargo}` : ""}</option>)}</select></Field>
      <fieldset className="rounded-md border border-line p-2"><legend className="px-1 text-xs font-medium text-navy">Cobertura mínima por dia (opcional)</legend>
        {[0, 1, 2].map(i => <div key={i} className="mb-1 grid grid-cols-[minmax(0,1fr)_5rem] gap-2"><Select name="cobTurno" defaultValue={t?.cobertura?.[i] ? String(t.cobertura[i].turnoId) : ""} aria-label="Turno"><option value="">—</option>{ativos.map(x => <option key={x.id} value={x.id}>{x.nome} ({E.fmtTurno(x)})</option>)}</Select><Input name="cobMin" type="number" min={0} max={20} defaultValue={t?.cobertura?.[i]?.minimo ?? ""} aria-label="Mínimo de pessoas" /></div>)}
        <Field label="Vale em"><Select name="coberturaDias" defaultValue={t?.cobertura_dias ?? "TODOS"}>{Object.entries(E.DIAS_COBERTURA).map(([k, r]) => <option key={k} value={k}>{r}</option>)}</Select></Field>
      </fieldset>
      <Btn small>Salvar equipe</Btn></form>;
  };
  if (aba === "turnos") return (
    <Page title="Escalas · turnos" sub="Os turnos valem para todas as equipes. Turno que vira a noite (ex.: 19:00–07:00) atravessa a meia-noite."><Flash ok={sp.ok} erro={sp.erro} />{abas}
      {E.podeTurnos(s) ? <Card title="Novo turno" className="mb-4"><form action={salvarTurno} className="grid grid-cols-2 gap-2 sm:grid-cols-6 sm:items-end"><Field label="Nome"><Input name="nome" required placeholder="Diurno" /></Field><Field label="Sigla"><Input name="sigla" maxLength={4} placeholder="D" /></Field><Field label="Início"><Input name="inicio" type="time" required /></Field><Field label="Fim"><Input name="fim" type="time" required /></Field><Field label="Intervalo (min)"><Input name="intervalo" type="number" defaultValue={60} /></Field><Field label="Cor"><Select name="cor">{Object.keys(E.CORES).map(c => <option key={c}>{c}</option>)}</Select></Field><Btn small>Criar</Btn></form></Card> : null}
      <Card title={`Turnos (${turnos.length})`}><ul className="divide-y divide-line text-sm">{turnos.map(t => <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5"><span><span className={`mr-2 inline-block rounded border px-1.5 text-xs ${E.CORES[t.cor] ?? E.CORES.sky}`}>{t.sigla ?? t.nome.slice(0, 2)}</span>{t.nome} · {E.fmtTurno(t)} · intervalo {t.intervalo_min} min · <b>{(E.duracao(t) / 60).toFixed(2).replace(".", ",")} h</b>{t.ativo ? "" : " · inativo"}</span>
        {E.podeTurnos(s) ? <Modal label="editar" kind="link" title={`Editar ${t.nome}`}><form action={salvarTurno} className="space-y-2"><input type="hidden" name="id" value={t.id} /><Field label="Nome"><Input name="nome" defaultValue={t.nome} /></Field><div className="grid grid-cols-2 gap-2"><Field label="Sigla"><Input name="sigla" defaultValue={t.sigla ?? ""} /></Field><Field label="Cor"><Select name="cor" defaultValue={t.cor}>{Object.keys(E.CORES).map(c => <option key={c}>{c}</option>)}</Select></Field><Field label="Início"><Input name="inicio" type="time" defaultValue={t.inicio} /></Field><Field label="Fim"><Input name="fim" type="time" defaultValue={t.fim} /></Field><Field label="Intervalo (min)"><Input name="intervalo" type="number" defaultValue={t.intervalo_min} /></Field><Field label="Situação"><Select name="ativo" defaultValue={t.ativo ? "1" : "0"}><option value="1">ativo</option><option value="0">inativo</option></Select></Field></div><Btn small>Salvar</Btn></form></Modal> : null}</li>)}</ul></Card>
    </Page>);
  if (aba === "equipes") return (
    <Page title="Escalas · equipes" sub="Uma equipe por unidade e função (portaria, limpeza, cozinha). Quem monta: RH, Direção, Operações, a direção da unidade e o(a) responsável pela equipe." actions={<Modal label="Nova equipe" title="Nova equipe" kind="primary" small={false}><FormEquipe /></Modal>}><Flash ok={sp.ok} erro={sp.erro} />{abas}
      <Card title={`Equipes (${equipes.length})`}>{equipes.length === 0 ? <p className="text-sm text-slate-500">Nenhuma equipe. Crie a primeira (ex.: Portaria Carandá).</p> : <ul className="divide-y divide-line text-sm">{equipes.map(t => <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5"><span><Link className="font-medium text-acao" href={`/ponto/escalas?equipe=${t.id}`}>{t.nome}</Link> <span className="text-xs text-slate-500">· {t.unidade} · {t.membros} pessoa(s){t.responsavel ? ` · responsável: ${t.responsavel}` : ""}{t.cobertura?.length ? ` · cobertura: ${t.cobertura.map(c => `${T.get(c.turnoId)?.sigla ?? T.get(c.turnoId)?.nome ?? "?"} ≥ ${c.minimo}`).join(", ")} (${E.DIAS_COBERTURA[t.cobertura_dias] ?? "todos os dias"})` : ""}</span></span>{E.podeEditarEquipe(s, t) ? <Modal label="editar" kind="link" title={`Editar ${t.nome}`}><FormEquipe t={t} /></Modal> : null}</li>)}</ul>}</Card>
    </Page>);
  // ------------------------------------------------------------------ grade da semana
  if (!team) return <Page title="Escalas de trabalho" sub="Portaria, limpeza, cozinha e apoio: quem trabalha em cada dia e turno."><Flash ok={sp.ok} erro={sp.erro} />{abas}<Card><p className="text-sm text-slate-600">{ativos.length ? "Crie uma equipe para montar a escala." : "Comece pelos turnos (ex.: Diurno 07:00–15:20, Noturno 19:00–07:00) e depois crie a equipe."} <Link className="text-acao underline" href={`/ponto/escalas?aba=${ativos.length ? "equipes" : "turnos"}`}>{ativos.length ? "Equipes" : "Turnos"}</Link></p></Card></Page>;
  const [membros, cel, [pub], alertas, mudancas, afast] = await Promise.all([
    sql<{ id: number; nome: string; cargo: string | null }[]>`SELECT e.id, e.nome, p.nome AS cargo FROM shift_team_members m JOIN employees e ON e.id=m.employee_id LEFT JOIN positions p ON p.id=e.position_id WHERE m.team_id=${team.id} ORDER BY e.nome`,
    sql<{ employee_id: number; data: string; shift_type_id: number | null; folga: boolean }[]>`SELECT employee_id, data::text, shift_type_id, folga FROM shift_assignments WHERE team_id=${team.id} AND data BETWEEN ${seg} AND ${dias[6]}`,
    sql<{ publicado_em: string; publicado_nome: string | null }[]>`SELECT publicado_em::text, publicado_nome FROM shift_publications WHERE team_id=${team.id} AND semana=${seg}`,
    E.alertasSemana(team.id, seg, { interjornadaHoras: Number(cfg.escalas.interjornadaHoras), jornadaMaxHoras: Number(cfg.escalas.jornadaMaxHoras), exigirFolgaSemanal: cfg.escalas.exigirFolgaSemanal !== false }),
    sql<{ employee_id: number; data: string; antes: string | null; depois: string | null; user_nome: string | null; at: string; nome: string }[]>`SELECT c.employee_id, c.data::text, c.antes, c.depois, c.user_nome, c.at::text, e.nome FROM shift_changes c JOIN employees e ON e.id=c.employee_id WHERE c.team_id=${team.id} AND c.data BETWEEN ${seg} AND ${dias[6]} ORDER BY c.at DESC LIMIT 20`,
    sql<{ employee_id: number; inicio: string; fim: string }[]>`SELECT employee_id, inicio::text, fim::text FROM leave_requests WHERE status='APROVADA' AND inicio <= ${dias[6]} AND fim >= ${seg}`,
  ]);
  const edita = E.podeEditarEquipe(s, team); const c = (e: number, d: string) => cel.find(x => x.employee_id === e && x.data === d);
  const horas = (e: number) => dias.reduce((a, d) => { const x = c(e, d); const t = x?.shift_type_id ? T.get(x.shift_type_id) : undefined; return a + (t ? E.duracao(t) : 0); }, 0);
  const porDia = (d: string) => cel.filter(x => x.data === d && x.shift_type_id).length;
  const nomeTurno = (k: string) => { const m = /turno (\d+)/.exec(k ?? ""); return m ? (T.get(Number(m[1]))?.sigla ?? T.get(Number(m[1]))?.nome ?? k) : k; };
  return (
    <Page title={`Escala · ${team.nome}`} sub={`${team.unidade} · semana de ${seg.slice(8)}/${seg.slice(5, 7)} a ${dias[6].slice(8)}/${dias[6].slice(5, 7)}${pub ? ` · publicada por ${pub.publicado_nome ?? "—"} em ${fmtDataHora(pub.publicado_em)}` : " · rascunho (a equipe ainda não vê)"}`}
      actions={<span className="flex flex-wrap gap-2"><Btn kind="ghost" href={`/ponto/escalas?equipe=${team.id}&semana=${addDays(seg, -7)}`}>← semana</Btn><Btn kind="ghost" href={`/ponto/escalas?equipe=${team.id}&semana=${addDays(seg, 7)}`}>semana →</Btn>{edita && !pub ? <form action={publicarSemana}><input type="hidden" name="teamId" value={team.id} /><input type="hidden" name="semana" value={seg} /><Btn>Publicar e avisar a equipe</Btn></form> : null}</span>}>
      <Flash ok={sp.ok} erro={sp.erro} />{abas}
      {minhas.length > 1 ? <div className="mb-3 flex flex-wrap gap-1.5 text-xs">{minhas.map(t => <Link key={t.id} href={`/ponto/escalas?equipe=${t.id}&semana=${seg}`} className={`rounded-full border px-2.5 py-1 ${t.id === team.id ? "border-acao bg-sky-50 text-acao" : "border-line text-slate-600"}`}>{t.nome}</Link>)}</div> : null}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Pessoas" value={membros.length} /><Stat label="Turnos na semana" value={cel.filter(x => x.shift_type_id).length} />
        <Stat label="Alertas" value={<span className={alertas.length ? "text-erro" : "text-ok"}>{alertas.length}</span>} hint="descanso, folga, cobertura" />
        <Stat label="Situação" value={<span className="text-sm">{pub ? "publicada" : "rascunho"}</span>} />
      </div>
      {alertas.length ? <Card title={`Alertas (${alertas.length})`} className="mb-4"><ul className="space-y-1 text-sm">{alertas.map((a, i) => <li key={i} className="rounded bg-amber-50 px-2 py-1 text-amber-950">{a.texto}</li>)}</ul></Card> : null}
      <Card title="Grade da semana" actions={edita ? <span className="flex flex-wrap gap-1.5">
        <form action={copiarSemana}><input type="hidden" name="teamId" value={team.id} /><input type="hidden" name="semana" value={seg} /><Btn small kind="ghost">Copiar semana anterior</Btn></form>
        <Modal label="Aplicar padrão" title="Aplicar um padrão na semana"><form action={aplicarPadrao} className="space-y-2"><input type="hidden" name="teamId" value={team.id} /><input type="hidden" name="semana" value={seg} />
          <div className="grid grid-cols-2 gap-2"><Field label="Padrão"><Select name="padrao"><option value="5x2">5x2 (seg a sex)</option><option value="6x1">6x1 (uma folga)</option><option value="12x36">12x36 (dia sim, dia não)</option></Select></Field><Field label="Turno"><Select name="turnoId">{ativos.map(t => <option key={t.id} value={t.id}>{t.nome} ({E.fmtTurno(t)})</option>)}</Select></Field>
            <Field label="Quem"><Select name="employeeId"><option value="">toda a equipe</option>{membros.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}</Select></Field><Field label="Folga (6x1)"><Select name="folgaDow" defaultValue="0">{E.DIAS_SEM.map((d, i) => <option key={i} value={i}>{d}</option>)}</Select></Field>
            <Field label="12x36 começa"><Select name="comeca"><option value="1">trabalhando na segunda</option><option value="0">de folga na segunda</option></Select></Field></div>
          <p className="text-[11px] text-slate-500">Substitui a semana de quem foi escolhido. 12x36 depende de acordo ou convenção coletiva.</p><Btn small>Aplicar</Btn></form></Modal></span> : null}>
        {membros.length === 0 ? <p className="text-sm text-slate-500">Equipe sem pessoas. <Link className="text-acao underline" href="/ponto/escalas?aba=equipes">Adicione na equipe</Link>.</p> :
          <form action={salvarGrade}><input type="hidden" name="teamId" value={team.id} /><input type="hidden" name="semana" value={seg} />
            <div className="overflow-x-auto"><table className="w-full min-w-[46rem] text-sm"><thead><tr className="text-left text-xs text-slate-500"><th className="sticky left-0 z-[1] bg-white py-1 pr-2">Pessoa</th>{dias.map(d => <th key={d} className={`px-1 py-1 text-center ${d === hoje() ? "text-acao" : ""}`}>{E.DIAS_SEM[new Date(`${d}T12:00:00Z`).getUTCDay()]} {d.slice(8)}<span className="block text-[10px] font-normal">{porDia(d)} no turno</span></th>)}<th className="px-1 py-1 text-right">Horas</th></tr></thead>
              <tbody>{membros.map(m => <tr key={m.id} className="border-t border-line"><td className="sticky left-0 z-[1] bg-white py-1 pr-2"><span className="block max-w-[11rem] truncate font-medium" title={m.nome}>{m.nome}</span><span className="block max-w-[11rem] truncate text-[11px] text-slate-500">{m.cargo ?? ""}</span></td>
                {dias.map(d => { const x = c(m.id, d); const t = x?.shift_type_id ? T.get(x.shift_type_id) : undefined; const fora = afast.some(a => a.employee_id === m.id && a.inicio <= d && a.fim >= d); const alerta = alertas.some(a => a.employeeId === m.id && (a.data === d || a.datas?.includes(d)));
                  return <td key={d} className={`px-1 py-1 text-center ${fora ? "bg-slate-50" : ""}`}>{edita ? <select name={`c_${m.id}_${d}`} defaultValue={x?.folga ? "F" : x?.shift_type_id ? String(x.shift_type_id) : ""} aria-label={`${m.nome} ${d}`} className={`w-full min-w-[4.2rem] rounded border px-1 py-1 text-xs ${alerta ? "border-red-400" : t ? (E.CORES[t.cor] ?? E.CORES.sky) : x?.folga ? "border-line bg-slate-100 text-slate-500" : "border-line"}`}><option value="">—</option><option value="F">folga</option>{ativos.map(o => <option key={o.id} value={o.id}>{o.sigla ?? o.nome}</option>)}</select>
                    : <span className={`inline-block rounded border px-1.5 py-0.5 text-xs ${t ? (E.CORES[t.cor] ?? E.CORES.sky) : "border-line text-slate-400"}`}>{t ? (t.sigla ?? t.nome) : x?.folga ? "folga" : "—"}</span>}{fora ? <span className="block text-[10px] text-slate-500">afastado</span> : null}</td>; })}
                <td className="px-1 py-1 text-right tabular-nums text-xs">{(horas(m.id) / 60).toFixed(1).replace(".", ",")} h</td></tr>)}</tbody></table></div>
            {edita ? <div className="mt-3 flex flex-wrap items-end gap-2">{pub ? <Field label="Motivo da mudança (a pessoa é avisada)" className="min-w-[16rem] flex-1"><Input name="motivo" maxLength={300} placeholder="ex.: troca de folga a pedido" /></Field> : null}<Btn>Salvar escala</Btn></div> : null}
          </form>}
        <p className="mt-2 text-[11px] text-slate-500">Legenda: {ativos.map(t => `${t.sigla ?? t.nome} = ${t.nome} ${E.fmtTurno(t)}`).join(" · ")}. Publicada, a escala vira a jornada esperada no espelho do ponto de cada pessoa.</p>
      </Card>
      {mudancas.length ? <Card title="Mudanças depois de publicada" className="mt-4"><ul className="space-y-1 text-xs">{mudancas.map((m, i) => <li key={i}>{fmtDataHora(m.at)} · {m.user_nome}: {m.nome} em {m.data.slice(8)}/{m.data.slice(5, 7)} — {nomeTurno(m.antes ?? "—")} → {nomeTurno(m.depois ?? "—")}</li>)}</ul></Card> : null}
    </Page>
  );
}
