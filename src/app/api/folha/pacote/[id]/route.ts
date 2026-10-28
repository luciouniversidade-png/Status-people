import { veTela } from "@/lib/acesso";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { podeFolha, cicloPorId, pacoteCsv } from "@/lib/folha";
import { audit } from "@/lib/utils";
import { sql } from "@/db";

/** Pacote da folha (CSV) gerado no passo 2 — exatamente o retrato guardado no ciclo (o hash confere com a trilha). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession(); if (!s) return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  if (!veTela(s, "/folha")) return NextResponse.json({ erro: "Tela fora do acesso do seu cargo." }, { status: 403 }); // v29: tela fora do acesso do cargo
  if (!podeFolha(s)) return NextResponse.json({ erro: "Não autorizado." }, { status: 403 });
  const { id } = await params; const c = await cicloPorId(Number(id));
  if (!c?.pacote) return NextResponse.json({ erro: "Pacote não gerado." }, { status: 404 });
  const [e] = await sql<{ nome: string }[]>`SELECT nome FROM companies WHERE id=${c.company_id}`;
  await audit(s, "exportar pacote da folha", "payroll_cycles", c.id, null, { competencia: c.competencia, hash: c.pacote.hash });
  const nome = `pacote_folha_${c.competencia}_${(e?.nome ?? "entidade").normalize("NFD").replace(/[^\w]+/g, "_").slice(0, 40)}.csv`;
  return new NextResponse(pacoteCsv(c.pacote), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${nome}"`, "Cache-Control": "private, no-store" } });
}
