import { Modal } from "@/components/Modal";
import { redirect } from "next/navigation";
import { asc } from "drizzle-orm";
import { db, schema, sql } from "@/db";
import { requireStaff, can } from "@/lib/auth";
import { Page, Card, Table, Td, Flash, Field, Input, Btn } from "@/components/ui";
import { getSettings, fmtData, hoje } from "@/lib/utils";
import { fmtBRL } from "@/lib/talento";
import { salvarFaixa, excluirFaixa, reajustarFaixas } from "../../talento/actions";

export const dynamic = "force-dynamic";

export default async function Faixas({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaff(); if (!can.verSalario(s)) redirect("/"); const sp = await searchParams; const cfg = await getSettings(); const pode = can.aprovar(s, cfg.alcadas.remuneracao);
  const grades = await db.select().from(schema.salaryGrades).orderBy(asc(schema.salaryGrades.ordem));
  const uso = await sql<{ grade_id: number; cargos: number; pessoas: number }[]>`SELECT p.grade_id, count(DISTINCT p.id)::int AS cargos, count(e.id)::int AS pessoas FROM positions p LEFT JOIN employees e ON e.position_id=p.id AND e.situacao <> 'DESLIGADO' WHERE p.grade_id IS NOT NULL GROUP BY p.grade_id`;
  const Form = ({ g }: { g?: typeof grades[number] }) => <form action={salvarFaixa} className="grid grid-cols-2 gap-2">{g && <input type="hidden" name="id" value={g.id} />}
    <Field label="Código"><Input name="codigo" required defaultValue={g?.codigo ?? ""} placeholder="G1" /></Field><Field label="Nome"><Input name="nome" defaultValue={g?.nome ?? ""} placeholder="Operacional" /></Field>
    <Field label="Mínimo (R$)"><Input name="minimo" type="number" step="0.01" required defaultValue={g?.minimo ?? ""} /></Field><Field label="Máximo (R$)"><Input name="maximo" type="number" step="0.01" required defaultValue={g?.maximo ?? ""} /></Field>
    <Field label="Médio (R$)" hint="vazio = média"><Input name="medio" type="number" step="0.01" defaultValue={g?.medio ?? ""} /></Field><Field label="Ordem"><Input name="ordem" type="number" defaultValue={g?.ordem ?? 100} /></Field>
    <Field label="Pontos de"><Input name="pontosMin" type="number" defaultValue={g?.pontosMin ?? ""} /></Field><Field label="Pontos até"><Input name="pontosMax" type="number" defaultValue={g?.pontosMax ?? ""} /></Field>
    <Field label="Vigência"><Input name="vigenciaInicio" type="date" defaultValue={g?.vigenciaInicio ?? ""} /></Field><div className="flex items-end"><Btn small>{g ? "Salvar" : "Adicionar faixa"}</Btn></div></form>;
  return (
    <Page title="Faixas salariais" sub="Estrutura de grades: mínimo, médio e máximo por faixa, e o intervalo de pontos da avaliação de cargos que leva a cada uma.">
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="grid gap-4 lg:grid-cols-[1fr_360px] lg:items-start">
        <Table head={["Faixa", "Nome", "Mínimo", "Médio", "Máximo", "Amplitude", "Pontos", "Cargos · pessoas", "Vigência", ""]} empty="Nenhuma faixa. Crie a estrutura ao lado (ex.: G1 a G8).">
          {grades.map(g => { const u = uso.find(x => x.grade_id === g.id); return <tr key={g.id}><Td className="font-medium">{g.codigo}</Td><Td>{g.nome ?? "—"}</Td><Td className="tabular-nums">{fmtBRL(g.minimo)}</Td><Td className="tabular-nums">{fmtBRL(g.medio)}</Td><Td className="tabular-nums">{fmtBRL(g.maximo)}</Td><Td>{Math.round(100 * (Number(g.maximo) - Number(g.minimo)) / Number(g.minimo))}%</Td><Td className="text-xs">{g.pontosMin !== null ? `${g.pontosMin}–${g.pontosMax}` : "—"}</Td><Td className="text-xs">{u ? `${u.cargos} · ${u.pessoas}` : "—"}</Td><Td className="text-xs">{fmtData(g.vigenciaInicio)}</Td>
            <Td>{pode && <div className="flex gap-1"><Modal label={"Editar"} kind="link"><div className=""><Form g={g} /></div></Modal><form action={excluirFaixa}><input type="hidden" name="id" value={g.id} /><button className="text-xs text-erro">excluir</button></form></div>}</Td></tr>; })}
        </Table>
        {pode && <div className="space-y-4"><Card title="Nova faixa"><Form /></Card>
          <Card title="Reajuste coletivo (dissídio)"><form action={reajustarFaixas} className="space-y-2"><Field label="Percentual (%)"><Input name="pct" type="number" step="0.01" required /></Field><Field label="Vigência"><Input name="vigenciaInicio" type="date" defaultValue={hoje()} /></Field><label className="flex items-center gap-2 text-xs"><input type="checkbox" name="aplicarSalarios" value="1" /> Aplicar também aos salários de todos os ativos (gera histórico “Dissídio”)</label><label className="flex items-center gap-2 text-xs"><input type="checkbox" name="confirmo" value="1" /> Confirmo o reajuste</label><Btn small danger>Aplicar reajuste</Btn></form></Card></div>}
      </div>
    </Page>
  );
}
