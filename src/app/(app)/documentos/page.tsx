import Link from "next/link";
import { requireStaff, scopeUnit } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Table, Td, Badge, Stat } from "@/components/ui";
import { fmtData, hoje, addDays } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function Documentos() {
  const s = await requireStaff(); const u = scopeUnit(s); const h = hoje(), em30 = addDays(h, 30);
  const uf = u === null ? sql`` : sql`AND e.unit_id=${u}`;
  const [vencendo, pendentes, [tot]] = await Promise.all([
    sql<{ id: number; nome: string; employee_id: number; unidade: string; tipo: string; validade: string }[]>`SELECT d.id, e.nome, e.id AS employee_id, u.nome AS unidade, d.tipo, d.validade::text FROM documents d JOIN employees e ON e.id=d.employee_id JOIN units u ON u.id=e.unit_id WHERE e.situacao<>'DESLIGADO' AND d.validade IS NOT NULL AND d.validade <= ${em30} ${uf} ORDER BY d.validade LIMIT 200`,
    sql<{ employee_id: number; nome: string; unidade: string; pendentes: number; total: number }[]>`SELECT e.id AS employee_id, e.nome, u.nome AS unidade, count(*) FILTER (WHERE d.obrigatorio AND d.recebido_em IS NULL)::int AS pendentes, count(*) FILTER (WHERE d.obrigatorio)::int AS total FROM employees e JOIN units u ON u.id=e.unit_id JOIN documents d ON d.employee_id=e.id WHERE e.situacao<>'DESLIGADO' ${uf} GROUP BY e.id, e.nome, u.nome HAVING count(*) FILTER (WHERE d.obrigatorio AND d.recebido_em IS NULL) > 0 ORDER BY 4 DESC, e.nome LIMIT 300`,
    sql<{ vencidos: number; em30: number; pend: number }[]>`SELECT count(*) FILTER (WHERE d.validade < ${h})::int AS vencidos, count(*) FILTER (WHERE d.validade >= ${h} AND d.validade <= ${em30})::int AS em30, count(*) FILTER (WHERE d.obrigatorio AND d.recebido_em IS NULL)::int AS pend FROM documents d JOIN employees e ON e.id=d.employee_id WHERE e.situacao<>'DESLIGADO' ${uf}`,
  ]);
  return (
    <Page title="Documentos" sub="Controle de entrega e validade. Os arquivos ficam no Drive; aqui fica o registro, o link e o prazo.">
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Vencidos" value={<span className="text-erro">{tot.vencidos}</span>} />
        <Stat label="Vencem em 30 dias" value={<span className="text-aviso">{tot.em30}</span>} />
        <Stat label="Obrigatórios não entregues" value={tot.pend} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 text-sm font-semibold text-navy">Validade próxima ou vencida</h2>
          <Table head={["Colaborador", "Unidade", "Documento", "Validade"]} empty="Nenhum documento com validade próxima.">
            {vencendo.map(d => <tr key={d.id}><Td><Link className="text-acao" href={`/colaboradores/${d.employee_id}#documentos`}>{d.nome}</Link></Td><Td>{d.unidade}</Td><Td>{d.tipo}</Td><Td><Badge v={d.validade < h ? "VENCIDO" : "VENCE_EM_BREVE"} label={fmtData(d.validade)} /></Td></tr>)}
          </Table>
        </div>
        <div>
          <h2 className="mb-2 text-sm font-semibold text-navy">Pendências de entrega</h2>
          <Table head={["Colaborador", "Unidade", "Pendentes"]} empty="Todos os documentos obrigatórios foram entregues.">
            {pendentes.map(r => <tr key={r.employee_id}><Td><Link className="text-acao" href={`/colaboradores/${r.employee_id}#documentos`}>{r.nome}</Link></Td><Td>{r.unidade}</Td><Td><span className="tabular-nums">{r.pendentes} de {r.total}</span></Td></tr>)}
          </Table>
        </div>
      </div>
    </Page>
  );
}
