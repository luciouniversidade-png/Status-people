import Link from "next/link";
import { requireStaff, scopeUnit, can } from "@/lib/auth";
import { db, schema, sql } from "@/db";
import { asc } from "drizzle-orm";
import { Page, Card, Table, Td, Badge, Flash, Field, Input, Select, Textarea, Btn, Stat } from "@/components/ui";
import { fmtData, getSettings } from "@/lib/utils";
import { COURSE_TIPO, COURSE_FORMATO, NEED_ORIGEM, matrizTreinamento } from "@/lib/clima-academy";
import { salvarCurso, salvarNecessidade } from "../clima-academy/actions";

export const dynamic = "force-dynamic";

export default async function Academy({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaff(); const sp = await searchParams; const cfg = await getSettings(); const u = scopeUnit(s);
  const [cursos, m, necessidades, positions, pops, emps, [horas]] = await Promise.all([
    sql<{ id: number; codigo: string; titulo: string; area: string | null; tipo: string; formato: string; carga_horas: number | null; ativo: boolean; concluidos: number; pendentes: number; proxima: string | null }[]>`SELECT c.id, c.codigo, c.titulo, c.area, c.tipo, c.formato, c.carga_horas::float, c.ativo, (SELECT count(*) FROM training_progress p WHERE p.course_id=c.id AND p.status='CONCLUIDO')::int AS concluidos, (SELECT count(*) FROM training_progress p WHERE p.course_id=c.id AND p.status<>'CONCLUIDO')::int AS pendentes, (SELECT min(data)::text FROM training_sessions t WHERE t.course_id=c.id AND t.data >= CURRENT_DATE) AS proxima FROM courses c ORDER BY c.ativo DESC, c.codigo`,
    matrizTreinamento(u),
    sql<{ id: number; descricao: string; origem: string; prioridade: string; status: string; colaborador: string | null; unidade: string | null; curso: string | null }[]>`SELECT n.id, n.descricao, n.origem, n.prioridade, n.status, e.nome AS colaborador, un.nome AS unidade, c.titulo AS curso FROM training_needs n LEFT JOIN employees e ON e.id=n.employee_id LEFT JOIN units un ON un.id=n.unit_id LEFT JOIN courses c ON c.id=n.course_id WHERE n.status <> 'ATENDIDA' ${u === null ? sql`` : sql`AND (n.unit_id IS NULL OR n.unit_id=${u})`} ORDER BY n.prioridade='ALTA' DESC, n.created_at DESC LIMIT 50`,
    db.select().from(schema.positions).orderBy(asc(schema.positions.ordem)), sql<{ id: number; codigo: string; titulo: string }[]>`SELECT id, codigo, titulo FROM procedures WHERE status <> 'OBSOLETO' ORDER BY codigo`,
    sql<{ id: number; nome: string }[]>`SELECT id, nome FROM employees WHERE situacao='ATIVO' ${u === null ? sql`` : sql`AND unit_id=${u}`} ORDER BY nome`,
    sql<{ h: number }[]>`SELECT coalesce(sum(c.carga_horas),0)::float AS h FROM training_progress p JOIN courses c ON c.id=p.course_id JOIN employees e ON e.id=p.employee_id WHERE p.status='CONCLUIDO' AND p.concluido_em >= date_trunc('year', CURRENT_DATE) ${u === null ? sql`` : sql`AND e.unit_id=${u}`}`,
  ]);
  const gestao = ["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR"].includes(s.role);
  return (
    <Page title="STATUS Academy" sub="Treinamentos obrigatórios e trilhas por cargo, turmas presenciais, matriz de conformidade e necessidades levantadas." actions={<><Btn kind="ghost" href="/academy/matriz">Matriz de treinamento</Btn><Btn kind="ghost" href="/api/export/treinamentos">Exportar CSV</Btn></>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <Stat label="Conformidade" value={m.conformidade === null ? "—" : <span className={m.conformidade >= 90 ? "text-ok" : m.conformidade >= 70 ? "text-aviso" : "text-erro"}>{m.conformidade}%</span>} hint="obrigatórios concluídos e válidos" href="/academy/matriz" />
        <Stat label="Pendências obrigatórias" value={<span className={m.pendentes ? "text-aviso" : ""}>{m.pendentes}</span>} href="/academy/matriz" />
        <Stat label="Vencendo em 60 dias" value={m.vencendo} hint={`${m.vencidos} vencido(s)`} />
        <Stat label="Horas no ano" value={horas.h.toFixed(0)} hint="treinamentos concluídos" />
        <Stat label="Necessidades abertas" value={necessidades.length} href="/academy#lnt" />
      </div>
      <div className={`grid gap-4 ${gestao ? "lg:grid-cols-[1fr_360px]" : ""} lg:items-start`}>
        <div className="space-y-4">
          <Table head={["Código", "Treinamento", "Área", "Tipo", "Formato", "Horas", "Concluídos", "Pendentes", "Próxima turma"]} empty="Nenhum treinamento cadastrado.">
            {cursos.map(c => <tr key={c.id} className={!c.ativo ? "opacity-50" : ""}><Td className="font-medium">{c.codigo}</Td><Td><Link className="text-acao" href={`/academy/cursos/${c.id}`}>{c.titulo}</Link></Td><Td className="text-xs">{c.area ?? "—"}</Td><Td><Badge v={c.tipo === "OBRIGATORIO" ? "REJEITADA" : c.tipo === "TRILHA_CARGO" ? "PENDENTE" : "EM_AQUISICAO"} label={COURSE_TIPO[c.tipo]} /></Td><Td className="text-xs">{COURSE_FORMATO[c.formato]}</Td><Td>{c.carga_horas ?? "—"}</Td><Td className="text-ok">{c.concluidos}</Td><Td>{c.pendentes || "—"}</Td><Td className="text-xs">{fmtData(c.proxima)}</Td></tr>)}
          </Table>
          <Card title="Levantamento de necessidades (LNT)"><div id="lnt" />
            <Table head={["Necessidade", "Origem", "Colaborador", "Unidade", "Prioridade", "Treinamento"]} empty="Nenhuma necessidade aberta.">{necessidades.map(n => <tr key={n.id}><Td>{n.descricao}</Td><Td className="text-xs">{NEED_ORIGEM[n.origem]}</Td><Td className="text-xs">{n.colaborador ?? "equipe"}</Td><Td className="text-xs">{n.unidade ?? "rede"}</Td><Td><Badge v={n.prioridade === "ALTA" ? "REJEITADA" : "EM_AQUISICAO"} label={n.prioridade} /></Td><Td className="text-xs">{n.curso ?? "—"}</Td></tr>)}</Table>
            {gestao && <form action={salvarNecessidade} className="mt-3 grid gap-2 border-t border-line pt-3 sm:grid-cols-4"><input type="hidden" name="voltar" value="/academy#lnt" /><Field label="Necessidade" className="sm:col-span-2"><Input name="descricao" required /></Field><Field label="Origem"><Select name="origem" defaultValue="GESTOR">{Object.entries(NEED_ORIGEM).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field><Field label="Prioridade"><Select name="prioridade" defaultValue="NORMAL"><option value="NORMAL">Normal</option><option value="ALTA">Alta</option></Select></Field><Field label="Colaborador (opcional)"><Select name="employeeId" defaultValue=""><option value="">equipe</option>{emps.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}</Select></Field><Field label="Treinamento (se já existe)"><Select name="courseId" defaultValue=""><option value="">—</option>{cursos.map(c => <option key={c.id} value={c.id}>{c.codigo}</option>)}</Select></Field><div className="flex items-end sm:col-span-2"><Btn small kind="ghost">Registrar necessidade</Btn></div></form>}
          </Card>
        </div>
        {gestao && <Card title="Novo treinamento"><form action={salvarCurso} className="space-y-2">
          <div className="grid grid-cols-[100px_1fr] gap-2"><Field label="Código"><Input name="codigo" required placeholder="TR-001" /></Field><Field label="Título"><Input name="titulo" required /></Field></div>
          <div className="grid grid-cols-2 gap-2"><Field label="Área"><Select name="area" defaultValue={cfg.academy.areas[0]}>{cfg.academy.areas.map(a => <option key={a}>{a}</option>)}</Select></Field><Field label="Tipo"><Select name="tipo" defaultValue="OBRIGATORIO">{Object.entries(COURSE_TIPO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field></div>
          <div className="grid grid-cols-2 gap-2"><Field label="Formato"><Select name="formato" defaultValue="ONLINE">{Object.entries(COURSE_FORMATO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field><Field label="Carga (h)"><Input name="cargaHoras" type="number" step="0.5" /></Field></div>
          <Field label="POP vinculado (formato Ciência de POP)"><Select name="procedureId" defaultValue=""><option value="">—</option>{pops.map(p => <option key={p.id} value={p.id}>{p.codigo} {p.titulo}</option>)}</Select></Field>
          <Field label="Link do material"><Input name="link" /></Field><Field label="Validade (meses, se recertificação)"><Input name="validadeMeses" type="number" min={1} /></Field>
          <div className="text-xs font-medium text-slate-600">Obrigatório para</div><label className="flex items-center gap-2 text-xs"><input type="checkbox" name="paraTodos" value="1" /> Todos os colaboradores</label>
          <Field label="Regime"><Select name="paraRegime" defaultValue=""><option value="">—</option><option value="DOCENTE">Docentes</option><option value="ADMINISTRATIVO">Administrativos</option></Select></Field>
          <Field label="Cargos (segure Ctrl para vários)"><select name="paraCargos" multiple className="h-28 w-full rounded-md border border-line px-2 py-1 text-xs">{positions.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></Field>
          <Field label="Descrição"><Textarea name="descricao" className="min-h-[50px]" /></Field>
          <Btn small>Criar treinamento</Btn></form></Card>}
      </div>
    </Page>
  );
}
