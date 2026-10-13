import Link from "@/components/Link";
import { scopeUnit } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Stat, Table, Td, Badge, Flash, Field, Btn, Input, Select, Textarea } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { PrintButton } from "@/components/PrintButton";
import { fmtData, fmtDataHora, hoje, addDays } from "@/lib/utils";
import { linkWa, foneWa } from "@/lib/comunicacao";
import { aulas, sugestoes, sincronizarAfastamentos, diaNaoLetivo, diaSemana, DIAS, MOTIVO_AUS, COB_STATUS, COB_TOM, SOLUCOES } from "@/lib/cobertura";
import { registrarAusencia, cancelarAusencia, convidarCobertura, semProfessor, reabrirCobertura, marcarRealizada } from "./actions";
import { requireCobertura, SubNavCobertura, professoresDoEscopo, COORDENA } from "./_ui";

export const dynamic = "force-dynamic";

export default async function QuadroCobertura({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireCobertura(); const sp = await searchParams; const h = hoje();
  const data = sp.data && /^\d{4}-\d{2}-\d{2}$/.test(sp.data) ? sp.data : h; const escopo = scopeUnit(s); const unidade = escopo ?? (sp.unidade ? Number(sp.unidade) : null);
  const pode = COORDENA.includes(s.role);
  // afastamentos aprovados viram aulas a cobrir — só de hoje em diante (o passado é histórico) e só quando quem olha coordena
  if (pode && data >= h) await sincronizarAfastamentos(data, data);
  const [lista, ausencias, units, profs, naoLetivo] = await Promise.all([
    aulas(data, data, unidade),
    sql<{ id: number; employee_id: number; nome: string; motivo: string; origem: string; inicio: string | null; fim: string | null; obs: string | null; aulas: number; registrado: string | null }[]>`SELECT ab.id, ab.employee_id, e.nome, ab.motivo, ab.origem, ab.inicio, ab.fim, ab.obs, (SELECT count(*) FROM cover_assignments ca WHERE ca.absence_id=ab.id AND ca.status <> 'CANCELADA' ${unidade === null ? sql`` : sql`AND ca.unit_id=${unidade}`})::int AS aulas, u.nome AS registrado
      FROM cover_absences ab JOIN employees e ON e.id=ab.employee_id LEFT JOIN users u ON u.id=ab.registrado_por WHERE ab.data=${data} AND ab.status='ATIVA'
      ${unidade === null ? sql`` : sql`AND (e.unit_id=${unidade} OR EXISTS (SELECT 1 FROM cover_assignments ca WHERE ca.absence_id=ab.id AND ca.unit_id=${unidade}))`} ORDER BY e.nome`,
    sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ORDER BY nome`, pode ? professoresDoEscopo(s) : Promise.resolve([]), diaNaoLetivo(data, unidade)]);
  const sel = sp.aula ? lista.find(a => a.id === Number(sp.aula)) : undefined;
  const sug = sel && ["ABERTA", "CONVIDADO"].includes(sel.status) && pode ? await sugestoes(sel) : [];
  const n = (st: string[]) => lista.filter(a => st.includes(a.status)).length;
  const q = (extra: Record<string, string>) => `/cobertura?${new URLSearchParams({ data, ...(unidade && !escopo ? { unidade: String(unidade) } : {}), ...extra }).toString()}`;
  const voltar = q({});
  return (
    <Page title="Substituição de professores" sub={`${DIAS[diaSemana(data)]}, ${fmtData(data)} · quem falta, quais aulas ficam descobertas e quem cobre — com aceite do professor e crédito no banco de horas`}
      actions={<><PrintButton />{pode && <Modal label="Registrar ausência" kind="primary" small={false} title="Registrar ausência de professor">
        <form action={registrarAusencia} className="space-y-2"><input type="hidden" name="voltar" value={voltar} />
          <Field label="Professor(a)"><Select name="employeeId" required><option value="">Escolha</option>{profs.map(p => <option key={p.id} value={p.id}>{p.nome} · {p.unidade}</option>)}</Select></Field>
          <div className="grid grid-cols-2 gap-2"><Field label="De"><Input name="de" type="date" required defaultValue={data} /></Field><Field label="Até (opcional)"><Input name="ate" type="date" /></Field>
            <Field label="Só a partir de (HH:MM)" hint="Vazio = dia todo"><Input name="inicio" placeholder="09:30" /></Field><Field label="Até (HH:MM)"><Input name="fim" placeholder="12:00" /></Field></div>
          <Field label="Motivo"><Select name="motivo" required>{Object.entries(MOTIVO_AUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field label="Observação"><Input name="obs" /></Field><Btn small>Registrar e listar aulas a cobrir</Btn>
          <p className="text-xs text-slate-500">Férias, licenças e afastamentos aprovados entram sozinhos. Domingos e dias não letivos são ignorados.</p></form></Modal>}</>}>
      <SubNavCobertura ativo="/cobertura" s={s} />
      <Flash ok={sp.ok} erro={sp.erro} />
      <form className="mb-4 grid grid-cols-2 items-end gap-2 rounded-md border border-line bg-white p-3 print:hidden sm:flex sm:flex-wrap">
        <Field label="Dia"><Input name="data" type="date" defaultValue={data} /></Field>
        {!escopo && <Field label="Unidade"><Select name="unidade" defaultValue={unidade ?? ""}><option value="">Todas</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>}
        <Btn kind="ghost">Ver</Btn>
        <span className="flex gap-2 text-xs"><Link className="text-acao" href={`/cobertura?data=${addDays(data, -1)}`}>← dia anterior</Link><Link className="text-acao" href={`/cobertura?data=${h}`}>hoje</Link><Link className="text-acao" href={`/cobertura?data=${addDays(data, 1)}`}>próximo dia →</Link></span>
      </form>
      {naoLetivo && <Card className="mb-4 border-sky-200"><p className="text-sm">Dia sem aula para docentes: <b>{naoLetivo}</b>.</p></Card>}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Aulas a cobrir" value={lista.length} />
        <Stat label="Sem solução" value={<span className={n(["ABERTA"]) ? "text-erro" : ""}>{n(["ABERTA"])}</span>} />
        <Stat label="Convites pendentes" value={<span className="text-aviso">{n(["CONVIDADO"])}</span>} />
        <Stat label="Cobertas" value={<span className="text-ok">{n(["CONFIRMADA", "REALIZADA"])}</span>} />
        <Stat label="Sem professor (solução)" value={n(["SEM_PROFESSOR"])} />
      </div>
      {sel && <Card className="mb-4 border-acao/40 print:hidden" title={<span id="sugestoes">Quem pode cobrir: {sel.turma}{sel.disciplina ? ` · ${sel.disciplina}` : ""} · {sel.inicio}–{sel.fim} <span className="font-normal text-slate-500">(no lugar de {sel.ausente})</span></span>} actions={<Link className="text-xs text-acao" href={voltar}>fechar</Link>}>
        {!["ABERTA", "CONVIDADO"].includes(sel.status) ? <p className="text-sm text-slate-600">Esta aula já está resolvida ({COB_STATUS[sel.status]}).</p> : sug.length === 0 ? <p className="text-sm text-aviso">Ninguém livre neste horário pela grade. Registre a solução sem professor (atividade orientada, junção ou dispensa).</p> :
          <ul className="divide-y divide-line">{sug.map((x, k) => <li key={x.employeeId} className="flex flex-wrap items-center gap-2 py-2">
            <span className="min-w-0 flex-1"><span className="font-medium">{k === 0 && <span className="mr-1 rounded bg-emerald-50 px-1 text-[10px] text-ok">melhor opção</span>}{x.nome}</span><span className="block text-xs text-slate-600">{x.motivos.join(" · ")}</span></span>
            {x.userId && <form action={convidarCobertura}><input type="hidden" name="id" value={sel.id} /><input type="hidden" name="employeeId" value={x.employeeId} /><input type="hidden" name="modo" value="CONVITE" /><input type="hidden" name="voltar" value={voltar} /><Btn small>Convidar</Btn></form>}
            <form action={convidarCobertura}><input type="hidden" name="id" value={sel.id} /><input type="hidden" name="employeeId" value={x.employeeId} /><input type="hidden" name="modo" value="DESIGNAR" /><input type="hidden" name="voltar" value={voltar} /><Btn small kind="ghost">Designar</Btn></form>
            {foneWa(x.telefone) && <a className="text-xs text-acao" target="_blank" rel="noreferrer" href={linkWa(foneWa(x.telefone), `Oi, ${x.nome.split(" ")[0]}! Você pode cobrir ${sel.turma}${sel.disciplina ? ` (${sel.disciplina})` : ""} em ${fmtData(sel.data)}, das ${sel.inicio} às ${sel.fim}?`)!}>WhatsApp</a>}
          </li>)}</ul>}
        {["ABERTA", "CONVIDADO"].includes(sel.status) && <form action={semProfessor} className="mt-3 grid grid-cols-1 gap-2 border-t border-line pt-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"><input type="hidden" name="id" value={sel.id} /><input type="hidden" name="voltar" value={voltar} />
          <Field label="Sem professor substituto"><Select name="solucao" required><option value="">Solução adotada</option>{Object.entries(SOLUCOES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field><Field label="Detalhe"><Input name="obs" /></Field><Btn small kind="ghost">Registrar solução</Btn></form>}
      </Card>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
        <Card title={`Quem cobre o quê — ${fmtData(data)}`}>
          <Table head={["Horário", "Turma", "Falta", "Situação", "Cobertura", ""]} empty={naoLetivo ? "Dia não letivo." : "Nenhuma aula a cobrir neste dia."}>
            {lista.map(a => <tr key={a.id}>
              <Td className="whitespace-nowrap font-medium">{a.inicio}–{a.fim}<div className="text-[11px] font-normal text-slate-500">{a.turno}{!escopo ? ` · ${a.unidade}` : ""}</div></Td>
              <Td>{a.turma}<div className="text-[11px] text-slate-500">{a.disciplina ?? ""}{a.sala ? ` · ${a.sala}` : ""}</div></Td>
              <Td>{a.ausente}<div className="text-[11px] text-slate-500">{MOTIVO_AUS[a.motivo]}</div></Td>
              <Td><Badge v={COB_TOM[a.status]} label={COB_STATUS[a.status]} />{a.status === "SEM_PROFESSOR" && <div className="text-[11px] text-slate-600">{SOLUCOES[a.solucao ?? ""] ?? a.solucao}{a.obs ? ` · ${a.obs}` : ""}</div>}{(a.recusas ?? []).length > 0 && <div className="text-[11px] text-aviso">recusou: {(a.recusas ?? []).map(r => r.nome).join(", ")}</div>}</Td>
              <Td>{a.cobertura ?? "—"}{a.status === "CONVIDADO" && <div className="text-[11px] text-slate-500">convite {fmtDataHora(a.convidado_em)}</div>}{a.status === "REALIZADA" && a.hour_entry_id && <div className="text-[11px] text-ok">{a.minutos} min no banco</div>}</Td>
              <Td className="print:hidden">{pode && <div className="flex flex-wrap gap-1">
                {["ABERTA", "CONVIDADO"].includes(a.status) && <Btn small kind={a.status === "ABERTA" ? "primary" : "ghost"} href={q({ aula: String(a.id) }) + "#sugestoes"}>{a.status === "ABERTA" ? "Quem pode cobrir" : "Trocar"}</Btn>}
                {a.status === "CONFIRMADA" && a.data <= h && <form action={marcarRealizada}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="voltar" value={voltar} /><Btn small>Realizada</Btn></form>}
                {["CONVIDADO", "CONFIRMADA", "SEM_PROFESSOR"].includes(a.status) && <form action={reabrirCobertura}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="voltar" value={voltar} /><Btn small kind="ghost">Reabrir</Btn></form>}
              </div>}</Td>
            </tr>)}
          </Table>
        </Card>
        <Card title={`Ausências (${ausencias.length})`}>
          {ausencias.length === 0 ? <p className="text-sm text-slate-500">Nenhuma ausência registrada.</p> : <ul className="space-y-2 text-sm">{ausencias.map(x => <li key={x.id} className="rounded-md border border-line p-2">
            <div className="font-medium">{x.nome}</div><div className="text-xs text-slate-600">{MOTIVO_AUS[x.motivo]}{x.inicio ? ` · ${x.inicio}–${x.fim}` : " · dia todo"} · {x.aulas} aula(s){x.origem === "PROFESSOR" ? " · avisou pelo sistema" : x.origem === "AFASTAMENTO" ? " · afastamento aprovado" : x.registrado ? ` · por ${x.registrado}` : ""}</div>{x.obs && <div className="text-xs text-slate-500">{x.obs}</div>}
            {pode && x.origem !== "AFASTAMENTO" && <Modal label="Cancelar" kind="link" title={`Cancelar ausência de ${x.nome}`}><form action={cancelarAusencia} className="space-y-2"><input type="hidden" name="id" value={x.id} /><input type="hidden" name="voltar" value={voltar} /><Field label="Motivo"><Textarea name="motivo" className="min-h-[50px]" /></Field><Btn small danger>Cancelar ausência</Btn><p className="text-xs text-slate-500">As aulas a cobrir saem do quadro e quem ia cobrir é avisado.</p></form></Modal>}
          </li>)}</ul>}
        </Card>
      </div>
    </Page>
  );
}
