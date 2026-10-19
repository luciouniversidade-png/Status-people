import Link from "@/components/Link";
import { requireSession } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Table, Td, Badge } from "@/components/ui";
import { fmtData } from "@/lib/utils";
import { REV_STATUS, CYCLE_STATUS } from "@/lib/talento";
import { ESTADO_AV } from "@/lib/avaliacao";

export const dynamic = "force-dynamic";

const nota = (v: unknown) => (typeof v === "number" ? v.toFixed(1).replace(".", ",") : "—");

export default async function Minha() {
  const s = await requireSession();
  const rows = s.employeeId ? await sql<{ id: number; ciclo: string; status: string; cstatus: string; inicio: string; fim: string; nota_final: number | null; pdi_n: number; criterios: boolean; fase: string | null; estado: string | null; auto: boolean; ciencia: string | null; calc: { R?: number | null; A?: number | null; N?: number | null } | null; composta: boolean; pdis: number }[]>`
    SELECT r.id, c.nome AS ciclo, r.status, c.status AS cstatus, c.inicio::text, c.fim::text, r.nota_final::float, coalesce(jsonb_array_length(r.pdi),0)::int AS pdi_n,
      (c.criterios IS NOT NULL) AS criterios, c.fase, r.estado, (r.auto_criterios IS NOT NULL) AS auto, r.ciencia_em::text AS ciencia, r.calc, coalesce(c.nota_composta, false) AS composta,
      (SELECT count(*) FROM pdi_plans p WHERE p.employee_id=r.employee_id AND p.status='ATIVO' AND (p.review_id=r.id OR p.cycle_id=c.id))::int AS pdis
    FROM perf_reviews r JOIN perf_cycles c ON c.id=r.cycle_id WHERE r.employee_id=${s.employeeId} ORDER BY c.inicio DESC` : [];
  const painel = s.employeeId ? `/colaboradores/${s.employeeId}/painel?aba=avaliacoes` : "/conta";
  return (
    <Page title="Minha avaliação" sub="Seus ciclos de desempenho: autoavaliação, resultado, ciência e PDI.">
      {!s.employeeId ? <Card><p className="text-sm text-slate-600">Seu acesso não está vinculado a um cadastro de colaborador. Peça ao RH para vincular.</p></Card> : <>
        <Table head={["Ciclo", "Período", "Fase do ciclo", "Minha situação", "Resultado", "PDI", ""]} empty="Nenhum ciclo de avaliação para você ainda.">
          {rows.map(r => {
            if (!r.criterios) return <tr key={r.id}><Td className="font-medium">{r.ciclo}</Td><Td className="text-xs">{fmtData(r.inicio)} – {fmtData(r.fim)}</Td><Td>{CYCLE_STATUS[r.cstatus]}</Td><Td><Badge v={r.status === "CONCLUIDA" ? "APROVADA" : r.status === "PENDENTE" ? "PENDENTE" : "EM_ADMISSAO"} label={REV_STATUS[r.status]} /></Td><Td className="tabular-nums">{r.cstatus === "ENCERRADO" && r.nota_final ? r.nota_final.toFixed(2) : "—"}</Td><Td>{r.pdi_n || "—"}</Td><Td><Link className="text-acao" href={`/desempenho/avaliacoes/${r.id}`}>{r.cstatus === "ABERTO" && r.status === "PENDENTE" ? "fazer autoavaliação" : "abrir"}</Link></Td></tr>;
            // v24.1 · ciclo por critérios: a autoavaliação e o resultado ficam no Painel do Colaborador (aba Avaliações)
            const publicada = r.estado === "PUBLICADA" || r.estado === "CONTESTADA"; const aberta = r.fase === "ACOMPANHAMENTO" || r.fase === "AVALIACAO";
            const situacao = publicada ? (r.estado === "CONTESTADA" ? "Contestada" : r.ciencia ? "Publicada · ciência registrada" : "Publicada · aguarda sua ciência") : r.estado === "INCONCLUSIVA" ? "Inconclusiva" : r.estado === "RASCUNHO" ? (r.auto ? "Autoavaliação feita · aguarda o gestor" : "Aguarda sua autoavaliação") : ESTADO_AV[r.estado ?? ""] ?? "—";
            const tom = publicada ? (r.ciencia ? "APROVADA" : "PENDENTE") : r.estado === "RASCUNHO" && !r.auto && aberta ? "PENDENTE" : "EM_ADMISSAO";
            const resultado = publicada ? (r.composta && typeof r.calc?.N === "number" ? r.calc.N.toFixed(2).replace(".", ",") : `R ${nota(r.calc?.R)} · A ${nota(r.calc?.A)}`) : r.estado === "INCONCLUSIVA" ? "sem nota" : "—";
            const acao = publicada ? (r.ciencia ? "ver resultado" : "ver resultado e registrar ciência") : aberta && r.estado === "RASCUNHO" ? (r.auto ? "rever autoavaliação" : "fazer autoavaliação") : "abrir";
            return <tr key={r.id}><Td className="font-medium">{r.ciclo}</Td><Td className="text-xs">{fmtData(r.inicio)} – {fmtData(r.fim)}</Td><Td>{CYCLE_STATUS[r.cstatus]}</Td><Td><Badge v={tom} label={situacao} /></Td><Td className="tabular-nums">{resultado}</Td><Td>{r.pdis || "—"}</Td><Td><Link className="text-acao" href={painel}>{acao}</Link></Td></tr>;
          })}
        </Table>
        <p className="mt-2 text-xs text-slate-500">Nos ciclos por critérios, a autoavaliação é uma perspectiva separada — não entra no resultado. Ciência não significa concordância: ao registrar, você pode comentar ou contestar.</p>
      </>}
    </Page>
  );
}
