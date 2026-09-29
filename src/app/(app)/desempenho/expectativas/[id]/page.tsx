import { notFound } from "next/navigation";
import { eq, asc } from "drizzle-orm";
import { requireStaff } from "@/lib/auth";
import { db, schema, sql } from "@/db";
import { Page, Card, Table, Td, Badge, Flash, Btn } from "@/components/ui";
import { fmtData, fmtDataHora } from "@/lib/utils";
import { FAMILIAS } from "@/lib/avaliacao";
import { salvarExpectativas, publicarExpectativas, novaVersaoExpectativas } from "../../desenvolvimento-actions";
import { CamposPerfil } from "@/components/CamposPerfil";

export const dynamic = "force-dynamic";

export default async function Perfil({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaff(); const { id } = await params; const sp = await searchParams; const pid = Number(id); const rh = ["DIRECAO", "RH"].includes(s.role);
  const [p] = await db.select().from(schema.roleProfiles).where(eq(schema.roleProfiles.id, pid)); if (!p) notFound();
  const positions = await db.select({ id: schema.positions.id, nome: schema.positions.nome }).from(schema.positions).orderBy(asc(schema.positions.nome));
  const acks = await sql<{ nome: string; at: string; comentario: string | null }[]>`SELECT e.nome, a.at::text, a.comentario FROM role_profile_acks a JOIN employees e ON e.id=a.employee_id WHERE a.profile_id=${pid} ORDER BY a.at DESC`;
  const lista = (t: string, xs: unknown) => ((xs as string[] | null) ?? []).length ? <div><div className="text-xs font-medium text-slate-500">{t}</div><ul className="list-disc pl-5 text-sm">{(xs as string[]).map((x, i) => <li key={i}>{x}</li>)}</ul></div> : null;
  return (
    <Page title={`${p.titulo} · v${p.versao}`} sub={<span className="flex flex-wrap items-center gap-2"><Badge v={p.status === "VIGENTE" ? "APROVADA" : p.status === "ARQUIVADO" ? "CANCELADA" : "EM_AQUISICAO"} label={p.status.toLowerCase()} />{p.familia ? FAMILIAS[p.familia] : ""}{p.nivel ? ` · nível ${p.nivel}` : ""}{p.vigenciaInicio ? ` · vigente desde ${fmtData(p.vigenciaInicio)}` : ""}{p.vigenciaFim ? ` até ${fmtData(p.vigenciaFim)}` : ""}</span>} actions={rh ? <div className="flex gap-2">{p.status === "RASCUNHO" && <form action={publicarExpectativas}><input type="hidden" name="id" value={pid} /><Btn>Publicar como vigente</Btn></form>}<form action={novaVersaoExpectativas}><input type="hidden" name="id" value={pid} /><Btn kind="ghost">Nova versão</Btn></form><Btn kind="ghost" href="/desempenho/expectativas">Perfis</Btn></div> : <Btn kind="ghost" href="/desempenho/expectativas">Perfis</Btn>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="grid gap-4 lg:grid-cols-[1fr_380px] lg:items-start">
        {rh && p.status === "RASCUNHO" ? <Card title="Editar rascunho"><form action={salvarExpectativas} className="space-y-2"><input type="hidden" name="id" value={pid} /><CamposPerfil p={p as unknown as Record<string, unknown>} positions={positions} /><Btn small>Salvar</Btn></form></Card> :
          <Card title="Perfil"><div className="space-y-3">{p.finalidade && <p className="text-sm"><b>Finalidade:</b> {p.finalidade}</p>}{lista("Responsabilidades principais", p.responsabilidades)}{lista("Entregas esperadas", p.entregas)}{((p.competencias as { nome: string; nivel: number; descricao: string | null }[] | null) ?? []).length > 0 && <Table head={["Competência", "Nível requerido", "Descrição"]}>{(p.competencias as { nome: string; nivel: number; descricao: string | null }[]).map(c => <tr key={c.nome}><Td>{c.nome}</Td><Td>{c.nivel}</Td><Td className="text-xs">{c.descricao ?? "—"}</Td></tr>)}</Table>}{lista("Comportamentos observáveis", p.comportamentos)}{lista("Evidências adequadas", p.evidencias)}{lista("Condições necessárias", p.condicoes)}{p.status === "VIGENTE" && <p className="text-[11px] text-slate-500">Perfil vigente não é editado; crie uma nova versão.</p>}</div></Card>}
        <Card title={`Ciência dos colaboradores (${acks.length})`}>{acks.length === 0 ? <p className="text-sm text-slate-500">Ninguém registrou ciência ainda.</p> : <ul className="space-y-1 text-sm">{acks.map((a, i) => <li key={i}>{a.nome} <span className="text-xs text-slate-500">· {fmtDataHora(a.at)}{a.comentario ? ` · “${a.comentario}”` : ""}</span></li>)}</ul>}<p className="mt-2 text-[11px] text-slate-500">Ciência não é concordância.</p></Card>
      </div>
    </Page>
  );
}
