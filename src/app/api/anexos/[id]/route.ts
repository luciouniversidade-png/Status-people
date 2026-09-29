import { NextResponse } from "next/server";
import { sql } from "@/db";
import { getSession, scopeUnit } from "@/lib/auth";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession(); if (!s) return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  const { id } = await params;
  const [a] = await sql<{ entidade: string; entidade_id: number; nome: string; mime: string; dados: Buffer; unit_id: number | null }[]>`SELECT entidade, entidade_id, nome, mime, dados, unit_id FROM attachments WHERE id=${Number(id)}`;
  if (!a) return NextResponse.json({ erro: "Não encontrado." }, { status: 404 });
  const u = scopeUnit(s); if (u !== null && a.unit_id !== null && a.unit_id !== u) return NextResponse.json({ erro: "Não autorizado." }, { status: 403 });
  if (s.role === "COLABORADOR" && !(a.entidade === "employee" && a.entidade_id === s.employeeId) && a.entidade !== "work_order" && a.entidade !== "procedure") return NextResponse.json({ erro: "Não autorizado." }, { status: 403 });
  if (s.role === "LEITURA" && a.entidade === "employee") return NextResponse.json({ erro: "Não autorizado." }, { status: 403 });
  return new NextResponse(new Uint8Array(a.dados), { headers: { "Content-Type": a.mime, "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(a.nome)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
