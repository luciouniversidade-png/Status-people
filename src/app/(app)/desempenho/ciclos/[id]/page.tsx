import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema, sql } from "@/db";
import { requireStaff, scopeUnit, can } from "@/lib/auth";
import { Page, Card, Table, Td, Badge, Flash, Btn, Stat, Select, Input } from "@/components/ui";
import { fmtData, getSettings } from "@/lib/utils";
import { CYCLE_STATUS, REV_STATUS, resumoCiclo, NIVEL_LABEL } from "@/lib/talento";
import { gerarAvaliacoes, mudarStatusCiclo, calibrar } from "../../../talento/actions";

export const dynamic = "force-dynamic";

export default async function Ciclo({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaff(); const { id } = await params; const sp = await searchParams; const cid = Number(id); const cfg = await getSettings(); const u = scopeUnit(s);
  const [c] = await db.select().from(schema.perfCycles).where(eq(schema.perfCycles.id, cid)); if (!c) notFound();
  const rows = await sql<{ id: number; nome: string; unidade: string; cargo: string | null; avaliador: string | null; status: string; nota_final: number | null; potencial: number | null; desempenho_nivel: number | null; pdi_n: number }[]>`SELECT r.id, e.nome, un.nome AS unidade, p.nome AS cargo, us.nome AS avaliador, r.status, r.nota_final::float, r.potencial, r.desempenho_nivel, coalesce(jsonb_array_length(r.pdi),0)::int AS pdi_n FROM perf_reviews r JOIN employees e ON e.id=r.employee_id JOIN units un ON un.id=e.unit_id LEFT JOIN positions p ON p.id=e.position_id LEFT JOIN users us ON us.id=r.avaliador_user_id WHERE r.cycle_id=${cid} ${u === null ? sql`` : sql`AND e.unit_id=${u}`} ORDER BY un.nome, e.nome`;
  const { tot, boxes } = await resumoCiclo(cid); const podeCal = can.aprovar(s, cfg.alcadas.calibracao);
  const boxN = (d: number, p: number) => boxes.find(b => b.d === d && b.p === p)?.n ?? 0;
  const boxesCfg = cfg.desempenho.boxes as Record<string, string>;
  return (
    <Page title={c.nome} sub={<span className="flex flex-wrap items-center gap-2"><Badge v={c.status === "ENCERRADO" ? "APROVADA" : c.status === "ABERTO" ? "EM_ADMISSAO" : c.status === "CALIBRACAO" ? "PENDENTE" : "EM_AQUISICAO"} label={CYCLE_STATUS[c.status]} /> {fmtData(c.inicio)} – {fmtData(c.fim)} · {(c.competencias as string[]).length} competências · <Link className="text-acao" href="/desempenho">ciclos</Link></span>}
      actions={<>{can.editar(s) && c.status !== "ENCERRADO" && <form action={gerarAvaliacoes}><input type="hidden" name="cycleId" value={cid} /><Btn kind="ghost">Gerar avaliações (novos ativos)</Btn></form>}{podeCal && <form action={mudarStatusCiclo} className="flex gap-1"><input type="hidden" name="cycleId" value={cid} />{c.status !== "ABERTO" && c.status !== "ENCERRADO" && <Btn kind="ghost" name="status" value="ABERTO">Abrir</Btn>}{c.status === "ABERTO" && <Btn kind="ghost" name="status" value="CALIBRACAO">Iniciar calibração</Btn>}{c.status !== "ENCERRADO" && <Btn name="status" value="ENCERRADO">Encerrar ciclo</Btn>}</form>}<Btn kind="ghost" href={`/api/export/desempenho?ciclo=${cid}`}>Exportar CSV</Btn></>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <Stat label="Avaliações" value={tot.total} /><Stat label="Aguardando gestor" value={<span className={tot.pendentes + tot.auto ? "text-aviso" : ""}>{tot.pendentes + tot.auto}</span>} hint={`${tot.auto} com autoavaliação`} /><Stat label="Avaliadas / calibradas" value={tot.avaliadas} /><Stat label="Concluídas" value={tot.concluidas} /><Stat label="Nota média" value={tot.media ? tot.media.toFixed(2) : "—"} hint={`escala 1–${cfg.desempenho.escala}`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_380px] lg:items-start">
        <Table head={["Colaborador", "Unidade", "Cargo", "Avaliador", "Situação", "Nota", "Desempenho", "Potencial", "PDI"]} empty="Nenhuma avaliação. Clique em “Gerar avaliações”.">
          {rows.map(r => <tr key={r.id}><Td><Link className="font-medium text-acao" href={`/desempenho/avaliacoes/${r.id}`}>{r.nome}</Link></Td><Td>{r.unidade}</Td><Td className="text-xs">{r.cargo ?? "—"}</Td><Td className="text-xs">{r.avaliador ?? "—"}</Td><Td><Badge v={r.status === "CONCLUIDA" ? "APROVADA" : r.status === "PENDENTE" ? "PENDENTE" : r.status === "CALIBRADA" ? "ATIVO" : "EM_ADMISSAO"} label={REV_STATUS[r.status]} /></Td><Td className="tabular-nums">{r.nota_final?.toFixed(2) ?? "—"}</Td><Td>{r.desempenho_nivel ? NIVEL_LABEL[r.desempenho_nivel] : "—"}</Td><Td>{r.potencial ? NIVEL_LABEL[r.potencial] : "—"}</Td><Td>{r.pdi_n || "—"}</Td></tr>)}
        </Table>
        <Card title="Nine Box (desempenho × potencial)">
          <div className="grid grid-cols-[60px_1fr_1fr_1fr] gap-1 text-center text-xs">
            <div /><div className="font-medium text-slate-600">Desemp. baixo</div><div className="font-medium text-slate-600">Desemp. médio</div><div className="font-medium text-slate-600">Desemp. alto</div>
            {[3, 2, 1].map(p => <div key={p} className="contents"><div className="flex items-center justify-center font-medium text-slate-600">Pot. {NIVEL_LABEL[p].toLowerCase()}</div>{[1, 2, 3].map(d => <div key={d} className={`rounded p-2 ${d === 3 && p === 3 ? "bg-emerald-100" : d + p >= 5 ? "bg-emerald-50" : d + p === 4 ? "bg-amber-50" : "bg-red-50"}`}><div className="text-xl font-semibold text-navy">{boxN(d, p)}</div><div className="text-[10px] leading-tight text-slate-600">{boxesCfg[`${d}-${p}`]}</div></div>)}</div>)}
          </div>
          <p className="mt-2 text-xs text-slate-500">Desempenho: nota ≥ {cfg.desempenho.limiarAlto} alto · ≥ {cfg.desempenho.limiarMedio} médio. Potencial: julgamento do gestor (1–3), ajustável na calibração.</p>
          {podeCal && c.status === "CALIBRACAO" && <details className="mt-3"><summary className="cursor-pointer text-xs text-acao">Calibrar em lote</summary><div className="mt-2 space-y-2">{rows.filter(r => ["AVALIADA", "CALIBRADA"].includes(r.status)).map(r => <form key={r.id} action={calibrar} className="flex items-center gap-1 text-xs"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="voltar" value={`/desempenho/ciclos/${cid}`} /><span className="w-32 truncate">{r.nome}</span><Select name="desempenhoNivel" defaultValue={r.desempenho_nivel ?? ""} className="!w-20 !py-0.5 !text-xs">{[1, 2, 3].map(n => <option key={n} value={n}>D{n}</option>)}</Select><Select name="potencial" defaultValue={r.potencial ?? ""} className="!w-20 !py-0.5 !text-xs">{[1, 2, 3].map(n => <option key={n} value={n}>P{n}</option>)}</Select><Input name="nota" placeholder="nota" className="!w-24 !py-0.5 !text-xs" /><Btn small kind="ghost">ok</Btn></form>)}</div></details>}
        </Card>
      </div>
    </Page>
  );
}
