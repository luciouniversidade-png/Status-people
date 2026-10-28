import { notFound } from "next/navigation";
import { createHash } from "crypto";
import { sql } from "@/db";
import { requireSession, scopeUnit } from "@/lib/auth";
import { fmtData } from "@/lib/utils";
import { PrintButton } from "@/components/PrintButton";

export const dynamic = "force-dynamic";
const GESTAO = ["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR"];

/** v30 · Certificado de conclusão (imprimível), com código de conferência guardado no registro do treinamento. */
export default async function Certificado({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession(); const { id } = await params;
  const [p] = await sql<{ id: number; employee_id: number; nome: string; unit_id: number; titulo: string; codigo: string; carga: number | null; instrutor: string | null; concluido_em: string | null; status: string; certificado: string | null; empresa: string | null }[]>`
    SELECT p.id, p.employee_id, e.nome, e.unit_id, c.titulo, c.codigo, c.carga_horas::float AS carga, c.instrutor, p.concluido_em::text, p.status, p.certificado, co.nome AS empresa
    FROM training_progress p JOIN employees e ON e.id=p.employee_id JOIN courses c ON c.id=p.course_id LEFT JOIN companies co ON co.id=e.company_id WHERE p.id=${Number(id)}`;
  if (!p || p.status !== "CONCLUIDO") notFound();
  const pode = s.employeeId === p.employee_id || (GESTAO.includes(s.role) && (scopeUnit(s) === null || scopeUnit(s) === p.unit_id)); if (!pode) notFound();
  let codigo = p.certificado;
  if (!codigo) { codigo = createHash("sha256").update(`${p.id}|${p.employee_id}|${p.codigo}|${p.concluido_em}|${process.env.AUTH_SECRET ?? ""}`).digest("hex").slice(0, 10).toUpperCase(); await sql`UPDATE training_progress SET certificado=${codigo} WHERE id=${p.id} AND certificado IS NULL`; }
  return (
    <main className="mx-auto max-w-3xl p-4 print:p-0">
      <div className="mb-3 flex justify-end print:hidden"><PrintButton /></div>
      <article className="rounded-lg border-4 border-double border-navy bg-white px-6 py-10 text-center shadow-sm sm:px-12">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-acao">Colégio Status · STATUS Academy</div>
        <h1 className="mt-6 text-3xl font-semibold text-navy">Certificado de conclusão</h1>
        <p className="mt-6 text-base text-slate-700">Certificamos que</p>
        <p className="mt-2 text-2xl font-semibold text-ink [overflow-wrap:anywhere]">{p.nome}</p>
        <p className="mt-4 text-base text-slate-700">concluiu o treinamento</p>
        <p className="mt-2 text-xl font-semibold text-navy">{p.codigo} · {p.titulo}</p>
        <p className="mt-4 text-sm text-slate-600">{p.carga ? `Carga horária: ${String(p.carga).replace(".", ",")} h · ` : ""}Concluído em {fmtData(p.concluido_em)}{p.instrutor ? ` · Instrutor(a): ${p.instrutor}` : ""}</p>
        <div className="mx-auto mt-10 w-64 border-t border-slate-400 pt-1 text-xs text-slate-600">{p.empresa ?? "Colégio Status"} · Gestão de Pessoas</div>
        <p className="mt-6 text-[11px] text-slate-500">Código de conferência: <b className="tracking-widest">{codigo}</b> — o RH confere pelo registro do treinamento.</p>
      </article>
    </main>
  );
}
