import Link from "@/components/Link";
import { requireStaff } from "@/lib/auth";
import { db, schema, sql } from "@/db";
import { asc } from "drizzle-orm";
import { Page, Card, Table, Td, Badge, Flash, Btn } from "@/components/ui";
import { fmtData } from "@/lib/utils";
import { FAMILIAS } from "@/lib/avaliacao";
import { salvarExpectativas } from "../desenvolvimento-actions";
import { CamposPerfil } from "@/components/CamposPerfil";

export const dynamic = "force-dynamic";

export default async function Expectativas({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaff(); const sp = await searchParams; const rh = ["DIRECAO", "RH"].includes(s.role);
  const rows = await sql<{ id: number; titulo: string; versao: number; status: string; familia: string | null; nivel: string | null; cargo: string | null; vigencia_inicio: string | null; acks: number; alvo: number }[]>`SELECT rp.id, rp.titulo, rp.versao, rp.status, rp.familia, rp.nivel, ps.nome AS cargo, rp.vigencia_inicio::text,
    (SELECT count(*) FROM role_profile_acks a WHERE a.profile_id=rp.id)::int AS acks,
    (SELECT count(*) FROM employees e JOIN positions p2 ON p2.id=e.position_id WHERE e.situacao='ATIVO' AND (p2.id=rp.position_id OR (rp.position_id IS NULL AND p2.familia=rp.familia)))::int AS alvo
    FROM role_profiles rp LEFT JOIN positions ps ON ps.id=rp.position_id ORDER BY rp.status='VIGENTE' DESC, rp.titulo, rp.versao DESC`;
  const positions = await db.select({ id: schema.positions.id, nome: schema.positions.nome }).from(schema.positions).orderBy(asc(schema.positions.nome));
  return (
    <Page title="Perfis de expectativas por cargo" sub="Finalidade, responsabilidades, entregas, competências com nível requerido, comportamentos observáveis, evidências adequadas e condições para o trabalho — versionados e com ciência do colaborador." actions={<Btn kind="ghost" href="/desempenho">Desempenho</Btn>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className={`grid grid-cols-1 gap-4 ${rh ? "lg:grid-cols-[minmax(0,1fr)_460px]" : ""} lg:items-start`}>
        <Table head={["Perfil", "Aplica-se a", "Versão", "Situação", "Vigência", "Ciência"]} empty="Nenhum perfil cadastrado.">{rows.map(r => <tr key={r.id}><Td><Link className="font-medium text-acao" href={`/desempenho/expectativas/${r.id}`}>{r.titulo}</Link></Td><Td className="text-xs">{r.cargo ?? (r.familia ? FAMILIAS[r.familia] : "—")}{r.nivel ? ` · ${r.nivel}` : ""}</Td><Td>v{r.versao}</Td><Td><Badge v={r.status === "VIGENTE" ? "APROVADA" : r.status === "ARQUIVADO" ? "CANCELADA" : "EM_AQUISICAO"} label={r.status.toLowerCase()} /></Td><Td className="text-xs">{r.vigencia_inicio ? `desde ${fmtData(r.vigencia_inicio)}` : "—"}</Td><Td className="text-xs">{r.status === "VIGENTE" ? `${r.acks}/${r.alvo}` : "—"}</Td></tr>)}</Table>
        {rh && <Card title="Novo perfil (rascunho)"><form action={salvarExpectativas} className="space-y-2"><CamposPerfil positions={positions} /><Btn small>Criar rascunho</Btn></form></Card>}
      </div>
    </Page>
  );
}
