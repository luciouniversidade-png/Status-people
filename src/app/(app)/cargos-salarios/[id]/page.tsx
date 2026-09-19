import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq, asc } from "drizzle-orm";
import { db, schema, sql } from "@/db";
import { requireStaff, can, scopeUnit } from "@/lib/auth";
import { Page, Card, Table, Td, Badge, Flash, Field, Input, Select, Textarea, Btn } from "@/components/ui";
import { getSettings, fmtData } from "@/lib/utils";
import { fmtBRL, gradeSugerida, MOTIVO_SAL } from "@/lib/talento";
import { avaliarCargo, reajustarSalario } from "../../talento/actions";

export const dynamic = "force-dynamic";

export default async function Cargo({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaff(); if (!can.verSalario(s)) redirect("/"); const { id } = await params; const sp = await searchParams; const pid = Number(id); const cfg = await getSettings();
  const [p] = await db.select().from(schema.positions).where(eq(schema.positions.id, pid)); if (!p) notFound();
  const [grades, ocupantes, historico] = await Promise.all([
    db.select().from(schema.salaryGrades).orderBy(asc(schema.salaryGrades.ordem)),
    sql<{ id: number; nome: string; unidade: string; nivel: string | null; salario: number | null; admissao: string; vinculo: string }[]>`SELECT e.id, e.nome, u.nome AS unidade, e.nivel, e.salario::float, e.admissao::text, e.vinculo FROM employees e JOIN units u ON u.id=e.unit_id WHERE e.position_id=${pid} AND e.situacao <> 'DESLIGADO' ${scopeUnit(s) === null ? sql`` : sql`AND e.unit_id=${scopeUnit(s)}`} ORDER BY e.nivel, e.salario DESC NULLS LAST`,
    sql<{ nome: string; data: string; salario_anterior: number | null; salario: number; motivo: string; obs: string | null }[]>`SELECT e.nome, h.data::text, h.salario_anterior::float, h.salario::float, h.motivo, h.obs FROM salary_history h JOIN employees e ON e.id=h.employee_id WHERE e.position_id=${pid} ORDER BY h.data DESC, h.id DESC LIMIT 20`,
  ]);
  const grade = grades.find(g => g.id === p.gradeId); const sug = gradeSugerida(p.pontos, grades); const aval = (p.avaliacao as Record<string, number> | null) ?? {};
  const podeRem = can.aprovar(s, cfg.alcadas.remuneracao);
  const posicao = (sal: number | null) => !grade || sal === null ? null : sal < Number(grade.minimo) ? "abaixo" : sal > Number(grade.maximo) ? "acima" : Math.round(100 * sal / Number(grade.medio));
  return (
    <Page title={p.nome} sub={<span>{p.area}{p.regulamentado ? " · regulamentado" : ""} · {grade ? `faixa ${grade.codigo} (${fmtBRL(grade.minimo)} – ${fmtBRL(grade.maximo)})` : "sem faixa"}{p.pontos ? ` · ${p.pontos} pontos` : ""} · <Link className="text-acao" href="/cargos-salarios">tabela</Link></span>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="grid gap-4 lg:grid-cols-[1fr_360px] lg:items-start">
        <div className="space-y-4">
          <Card title={`Ocupantes (${ocupantes.length})`}>
            <Table head={["Colaborador", "Unidade", "Nível", "Admissão", "Salário", "Posição na faixa", ""]} empty="Nenhum ocupante ativo.">
              {ocupantes.map(o => { const pos = posicao(o.salario); return <tr key={o.id}><Td><Link className="text-acao" href={`/colaboradores/${o.id}`}>{o.nome}</Link></Td><Td>{o.unidade}</Td><Td>{o.nivel ?? <span className="text-aviso">—</span>}</Td><Td>{fmtData(o.admissao)}</Td><Td className="tabular-nums">{fmtBRL(o.salario)}</Td>
                <Td>{pos === null ? "—" : typeof pos === "string" ? <Badge v="REJEITADA" label={pos === "abaixo" ? "abaixo do mínimo" : "acima do máximo"} /> : <span className={pos < 90 ? "text-aviso" : pos > 110 ? "text-erro" : "text-ok"}>{pos}% do médio</span>}</Td>
                <Td>{podeRem && <details className="relative"><summary className="cursor-pointer rounded-md border border-line bg-white px-2.5 py-1 text-xs">Reajustar</summary><form action={reajustarSalario} className="mt-1 w-72 max-w-[85vw] space-y-2 rounded-md border border-line bg-white p-3 text-xs shadow-lg"><input type="hidden" name="employeeId" value={o.id} /><input type="hidden" name="voltar" value={`/cargos-salarios/${pid}`} />
                  <Field label="Novo salário (R$)"><Input name="salario" type="number" step="0.01" min={0} defaultValue={o.salario ?? ""} required /></Field><Field label="Motivo"><Select name="motivo" defaultValue="MERITO">{Object.entries(MOTIVO_SAL).filter(([k]) => k !== "ADMISSAO").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field><Field label="Nível"><Select name="nivel" defaultValue={o.nivel ?? ""}><option value="">—</option><option>Júnior</option><option>Pleno</option><option>Sênior</option></Select></Field><Field label="Data"><Input name="data" type="date" /></Field><Field label="Justificativa"><Input name="obs" /></Field><Btn small>Registrar</Btn></form></details>}</Td></tr>; })}
            </Table>
          </Card>
          <Card title="Histórico salarial dos ocupantes (últimos 20)"><Table head={["Colaborador", "Data", "De", "Para", "Motivo", "Justificativa"]} empty="Sem histórico.">{historico.map((h, i) => <tr key={i}><Td>{h.nome}</Td><Td>{fmtData(h.data)}</Td><Td className="tabular-nums">{fmtBRL(h.salario_anterior)}</Td><Td className="tabular-nums">{fmtBRL(h.salario)}</Td><Td className="text-xs">{MOTIVO_SAL[h.motivo] ?? h.motivo}</Td><Td className="text-xs text-slate-600">{h.obs ?? "—"}</Td></tr>)}</Table></Card>
        </div>
        <Card title="Avaliação do cargo e faixa">
          {podeRem ? <form action={avaliarCargo} className="space-y-2"><input type="hidden" name="id" value={pid} />
            <p className="text-xs text-slate-600">Dê uma nota de 1 a {cfg.remuneracao.escalaFator} a cada fator. A soma sugere a faixa pelos pontos configurados.</p>
            {cfg.remuneracao.fatores.map((f, i) => <Field key={f} label={f}><Select name={`f_${i}`} defaultValue={aval[f] ?? ""}><option value="">—</option>{Array.from({ length: cfg.remuneracao.escalaFator }, (_, k) => k + 1).map(n => <option key={n} value={n}>{n}</option>)}</Select></Field>)}
            <p className="text-sm">Pontos atuais: <b>{p.pontos ?? "—"}</b>{sug && <> · faixa sugerida: <Badge v="ATIVO" label={sug.codigo} /></>}</p>
            <Field label="Faixa salarial"><Select name="gradeId" defaultValue={p.gradeId ?? ""}><option value="">—</option>{grades.map(g => <option key={g.id} value={g.id}>{g.codigo}{g.nome ? ` · ${g.nome}` : ""} ({fmtBRL(g.minimo)} – {fmtBRL(g.maximo)})</option>)}</Select></Field>
            <Field label="Descrição do cargo"><Textarea name="descricao" className="min-h-[70px]" defaultValue={p.descricao ?? ""} /></Field>
            <Field label="Requisitos"><Textarea name="requisitos" className="min-h-[50px]" defaultValue={p.requisitos ?? ""} /></Field>
            <Btn small>Salvar</Btn></form> : <p className="text-sm text-slate-600">{p.descricao ?? "Sem descrição."}</p>}
        </Card>
      </div>
    </Page>
  );
}
