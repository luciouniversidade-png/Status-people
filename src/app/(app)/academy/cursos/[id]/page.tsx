import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, asc } from "drizzle-orm";
import { db, schema, sql } from "@/db";
import { requireStaff, scopeUnit, can } from "@/lib/auth";
import { Page, Card, Table, Td, Badge, Flash, Field, Input, Select, Textarea, Btn, Stat } from "@/components/ui";
import { fmtData, getSettings, hoje } from "@/lib/utils";
import { COURSE_TIPO, COURSE_FORMATO, PROG_STATUS } from "@/lib/clima-academy";
import { salvarCurso, registrarConclusao, salvarSessao, registrarPresenca } from "../../../clima-academy/actions";

export const dynamic = "force-dynamic";

export default async function Curso({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaff(); const { id } = await params; const sp = await searchParams; const cid = Number(id); const cfg = await getSettings(); const u = scopeUnit(s);
  const [c] = await db.select().from(schema.courses).where(eq(schema.courses.id, cid)); if (!c) notFound();
  const [prog, sessoes, emps, positions, pops, units] = await Promise.all([
    sql<{ id: number; nome: string; employee_id: number; unidade: string; status: string; concluido_em: string | null; valido_ate: string | null; nota: number | null; evidencia: string | null }[]>`SELECT p.id, e.nome, e.id AS employee_id, un.nome AS unidade, p.status, p.concluido_em::text, p.valido_ate::text, p.nota::float, p.evidencia FROM training_progress p JOIN employees e ON e.id=p.employee_id JOIN units un ON un.id=e.unit_id WHERE p.course_id=${cid} ${u === null ? sql`` : sql`AND e.unit_id=${u}`} ORDER BY p.status, e.nome`,
    sql<{ id: number; data: string; horario: string | null; local: string | null; instrutor: string | null; unidade: string | null; vagas: number | null; presentes: number }[]>`SELECT t.id, t.data::text, t.horario, t.local, t.instrutor, un.nome AS unidade, t.vagas, (SELECT count(*) FROM session_attendance a WHERE a.session_id=t.id AND a.presente)::int AS presentes FROM training_sessions t LEFT JOIN units un ON un.id=t.unit_id WHERE t.course_id=${cid} ORDER BY t.data DESC`,
    sql<{ id: number; nome: string; unidade: string }[]>`SELECT e.id, e.nome, un.nome AS unidade FROM employees e JOIN units un ON un.id=e.unit_id WHERE e.situacao='ATIVO' ${u === null ? sql`` : sql`AND e.unit_id=${u}`} ORDER BY e.nome`,
    db.select().from(schema.positions).orderBy(asc(schema.positions.ordem)), sql<{ id: number; codigo: string; titulo: string }[]>`SELECT id, codigo, titulo FROM procedures WHERE status <> 'OBSOLETO' ORDER BY codigo`, db.select().from(schema.units).orderBy(asc(schema.units.nome)),
  ]);
  const gestao = ["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR"].includes(s.role); const h = hoje(); const cargos = (c.paraCargos as number[] | null) ?? [];
  return (
    <Page title={`${c.codigo} — ${c.titulo}`} sub={<span className="flex flex-wrap items-center gap-2"><Badge v={c.tipo === "OBRIGATORIO" ? "REJEITADA" : c.tipo === "TRILHA_CARGO" ? "PENDENTE" : "EM_AQUISICAO"} label={COURSE_TIPO[c.tipo]} /> {COURSE_FORMATO[c.formato]}{c.cargaHoras ? ` · ${c.cargaHoras} h` : ""}{c.validadeMeses ? ` · validade ${c.validadeMeses} meses` : ""}{c.paraTodos ? " · obrigatório para todos" : cargos.length ? ` · cargos: ${cargos.map(x => positions.find(p => p.id === x)?.nome).filter(Boolean).join(", ")}` : c.paraRegime ? ` · ${c.paraRegime.toLowerCase()}s` : ""} · <Link className="text-acao" href="/academy">Academy</Link></span>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4"><Stat label="Concluídos" value={prog.filter(p => p.status === "CONCLUIDO").length} /><Stat label="Em andamento / pendentes" value={prog.filter(p => p.status !== "CONCLUIDO").length} /><Stat label="Turmas" value={sessoes.length} /><Stat label="Vencidos" value={prog.filter(p => p.valido_ate && p.valido_ate < h).length} /></div>
      {c.descricao && <Card className="mb-4"><p className="text-sm">{c.descricao}</p>{c.link && <p className="mt-1 text-sm"><a className="text-acao" href={c.link} target="_blank" rel="noreferrer">Material do treinamento</a></p>}</Card>}
      <div className="grid gap-4 lg:grid-cols-[1fr_360px] lg:items-start">
        <div className="space-y-4">
          <Card title="Participantes">
            {c.formato === "POP" ? <p className="text-sm text-slate-600">Concluído automaticamente quando o colaborador dá ciência do POP vigente. Veja a <Link className="text-acao" href="/academy/matriz">matriz</Link>.</p> :
              <Table head={["Colaborador", "Unidade", "Situação", "Concluído em", "Válido até", "Nota", "Evidência"]} empty="Ninguém registrado ainda.">{prog.map(p => <tr key={p.id}><Td><Link className="text-acao" href={`/colaboradores/${p.employee_id}`}>{p.nome}</Link></Td><Td>{p.unidade}</Td><Td><Badge v={p.status === "CONCLUIDO" ? (p.valido_ate && p.valido_ate < h ? "VENCIDO" : "APROVADA") : p.status === "EM_ANDAMENTO" ? "EM_ADMISSAO" : "PENDENTE"} label={p.status === "CONCLUIDO" && p.valido_ate && p.valido_ate < h ? "Vencido" : PROG_STATUS[p.status]} /></Td><Td className="text-xs">{fmtData(p.concluido_em)}</Td><Td className="text-xs">{fmtData(p.valido_ate)}</Td><Td>{p.nota ?? "—"}</Td><Td className="text-xs">{p.evidencia ?? "—"}</Td></tr>)}</Table>}
          </Card>
          <Card title="Turmas presenciais"><div id="turmas" />
            <Table head={["Data", "Horário", "Local", "Instrutor", "Unidade", "Presentes", ""]} empty="Nenhuma turma agendada.">{sessoes.map(t => <tr key={t.id}><Td>{fmtData(t.data)}</Td><Td className="text-xs">{t.horario ?? "—"}</Td><Td className="text-xs">{t.local ?? "—"}</Td><Td className="text-xs">{t.instrutor ?? "—"}</Td><Td className="text-xs">{t.unidade ?? "rede"}</Td><Td>{t.presentes}{t.vagas ? `/${t.vagas}` : ""}</Td>
              <Td>{gestao && <details className="relative"><summary className="cursor-pointer rounded-md border border-line bg-white px-2.5 py-1 text-xs">Presença</summary><form action={registrarPresenca} className="mt-1 max-h-80 w-72 max-w-[85vw] space-y-1 overflow-auto rounded-md border border-line bg-white p-3 text-xs shadow-lg"><input type="hidden" name="sessionId" value={t.id} />{emps.map(e => <label key={e.id} className="flex items-center gap-2"><input type="checkbox" name="employeeId" value={e.id} /> {e.nome} <span className="text-slate-400">· {e.unidade}</span></label>)}<Btn small>Registrar presentes</Btn></form></details>}</Td></tr>)}</Table>
            {gestao && <form action={salvarSessao} className="mt-3 grid gap-2 border-t border-line pt-3 sm:grid-cols-3"><input type="hidden" name="courseId" value={cid} /><Field label="Data"><Input name="data" type="date" required /></Field><Field label="Horário"><Input name="horario" placeholder="14:00–17:00" /></Field><Field label="Local"><Input name="local" /></Field><Field label="Instrutor"><Input name="instrutor" /></Field><Field label="Unidade"><Select name="unitId" defaultValue={u ?? ""}><option value="">Rede</option>{units.filter(x => u === null || x.id === u).map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field><Field label="Vagas"><Input name="vagas" type="number" min={1} /></Field><div className="sm:col-span-3"><Btn small kind="ghost">Agendar turma</Btn></div></form>}
          </Card>
        </div>
        {gestao && <div className="space-y-4">
          {c.formato !== "POP" && <Card title="Registrar conclusão / andamento"><form action={registrarConclusao} className="space-y-2"><input type="hidden" name="courseId" value={cid} />
            <Field label="Colaboradores"><select name="employeeId" multiple className="h-40 w-full rounded-md border border-line px-2 py-1 text-xs">{emps.map(e => <option key={e.id} value={e.id}>{e.nome} · {e.unidade}</option>)}</select></Field>
            <div className="grid grid-cols-2 gap-2"><Field label="Situação"><Select name="status" defaultValue="CONCLUIDO"><option value="CONCLUIDO">Concluído</option><option value="EM_ANDAMENTO">Em andamento</option><option value="PENDENTE">Pendente (atribuir)</option></Select></Field><Field label="Data"><Input name="concluidoEm" type="date" defaultValue={h} /></Field></div>
            <div className="grid grid-cols-2 gap-2"><Field label="Nota (opcional)"><Input name="nota" type="number" step="0.1" /></Field><Field label="Evidência"><Input name="evidencia" placeholder="certificado, lista, link" /></Field></div>
            <Btn small>Registrar</Btn></form></Card>}
          {(can.editar(s) || s.role === "DIRETOR_UNIDADE") && <Card title="Editar treinamento"><form action={salvarCurso} className="space-y-2"><input type="hidden" name="id" value={cid} />
            <div className="grid grid-cols-[100px_1fr] gap-2"><Field label="Código"><Input name="codigo" defaultValue={c.codigo} required /></Field><Field label="Título"><Input name="titulo" defaultValue={c.titulo} required /></Field></div>
            <div className="grid grid-cols-2 gap-2"><Field label="Área"><Select name="area" defaultValue={c.area ?? ""}>{cfg.academy.areas.map(a => <option key={a}>{a}</option>)}</Select></Field><Field label="Tipo"><Select name="tipo" defaultValue={c.tipo}>{Object.entries(COURSE_TIPO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field></div>
            <div className="grid grid-cols-2 gap-2"><Field label="Formato"><Select name="formato" defaultValue={c.formato}>{Object.entries(COURSE_FORMATO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field><Field label="Carga (h)"><Input name="cargaHoras" type="number" step="0.5" defaultValue={c.cargaHoras ?? ""} /></Field></div>
            <Field label="POP vinculado"><Select name="procedureId" defaultValue={c.procedureId ?? ""}><option value="">—</option>{pops.map(p => <option key={p.id} value={p.id}>{p.codigo} {p.titulo}</option>)}</Select></Field>
            <Field label="Link"><Input name="link" defaultValue={c.link ?? ""} /></Field><Field label="Validade (meses)"><Input name="validadeMeses" type="number" defaultValue={c.validadeMeses ?? ""} /></Field>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="paraTodos" value="1" defaultChecked={c.paraTodos} /> Obrigatório para todos</label>
            <Field label="Regime"><Select name="paraRegime" defaultValue={c.paraRegime ?? ""}><option value="">—</option><option value="DOCENTE">Docentes</option><option value="ADMINISTRATIVO">Administrativos</option></Select></Field>
            <Field label="Cargos"><select name="paraCargos" multiple className="h-28 w-full rounded-md border border-line px-2 py-1 text-xs" defaultValue={cargos.map(String)}>{positions.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></Field>
            <Field label="Descrição"><Textarea name="descricao" className="min-h-[50px]" defaultValue={c.descricao ?? ""} /></Field>
            <Field label="Situação"><Select name="ativo" defaultValue={c.ativo ? "1" : "0"}><option value="1">Ativo</option><option value="0">Inativo</option></Select></Field>
            <Btn small>Salvar</Btn></form></Card>}
        </div>}
      </div>
    </Page>
  );
}
