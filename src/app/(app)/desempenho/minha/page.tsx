import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Table, Td, Badge } from "@/components/ui";
import { fmtData } from "@/lib/utils";
import { REV_STATUS, CYCLE_STATUS } from "@/lib/talento";

export const dynamic = "force-dynamic";

export default async function Minha() {
  const s = await requireSession();
  const rows = s.employeeId ? await sql<{ id: number; ciclo: string; status: string; cstatus: string; inicio: string; fim: string; nota_final: number | null; pdi_n: number }[]>`SELECT r.id, c.nome AS ciclo, r.status, c.status AS cstatus, c.inicio::text, c.fim::text, r.nota_final::float, coalesce(jsonb_array_length(r.pdi),0)::int AS pdi_n FROM perf_reviews r JOIN perf_cycles c ON c.id=r.cycle_id WHERE r.employee_id=${s.employeeId} ORDER BY c.inicio DESC` : [];
  return (
    <Page title="Minha avaliação" sub="Seus ciclos de desempenho: autoavaliação, resultado, PDI.">
      {!s.employeeId ? <Card><p className="text-sm text-slate-600">Seu acesso não está vinculado a um cadastro de colaborador. Peça ao RH para vincular.</p></Card> :
        <Table head={["Ciclo", "Período", "Fase do ciclo", "Minha situação", "Nota", "PDI", ""]} empty="Nenhum ciclo de avaliação para você ainda.">
          {rows.map(r => <tr key={r.id}><Td className="font-medium">{r.ciclo}</Td><Td className="text-xs">{fmtData(r.inicio)} – {fmtData(r.fim)}</Td><Td>{CYCLE_STATUS[r.cstatus]}</Td><Td><Badge v={r.status === "CONCLUIDA" ? "APROVADA" : r.status === "PENDENTE" ? "PENDENTE" : "EM_ADMISSAO"} label={REV_STATUS[r.status]} /></Td><Td className="tabular-nums">{r.cstatus === "ENCERRADO" && r.nota_final ? r.nota_final.toFixed(2) : "—"}</Td><Td>{r.pdi_n || "—"}</Td><Td><Link className="text-acao" href={`/desempenho/avaliacoes/${r.id}`}>{r.cstatus === "ABERTO" && r.status === "PENDENTE" ? "fazer autoavaliação" : "abrir"}</Link></Td></tr>)}
        </Table>}
    </Page>
  );
}
