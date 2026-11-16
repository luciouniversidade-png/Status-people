import { NextResponse } from "next/server";
import { sql } from "@/db";
import { getSession } from "@/lib/auth";
import { acessoDocumento, comprovantePdf } from "@/lib/assinaturas";

/**
 * v34 · arquivo de um documento para assinatura (?modo=arquivo) ou o comprovante com a página de evidências (?modo=comprovante).
 * RH e Direção veem tudo; a direção da unidade, a própria unidade; a pessoa, só o próprio pedido (o comprovante dela sai só com ela).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession(); if (!s) return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  const id = Number((await params).id); const u = new URL(req.url); const modo = u.searchParams.get("modo") ?? "arquivo";
  const ac = await acessoDocumento(s, id); if (!ac.ok) return NextResponse.json({ erro: "Não autorizado." }, { status: 403 });
  const cab = (nome: string, baixar: boolean) => ({ "Content-Type": "application/pdf", "Content-Disposition": `${baixar ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(nome)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
  if (modo === "comprovante") {
    const pedido = ac.pedido ?? (u.searchParams.get("pedido") ? Number(u.searchParams.get("pedido")) : null);
    try { const c = await comprovantePdf(id, pedido); return new NextResponse(new Uint8Array(c.pdf), { headers: cab(c.nome, true) }); }
    catch (e) { return NextResponse.json({ erro: e instanceof Error ? e.message : "Falha ao gerar o comprovante." }, { status: 500 }); }
  }
  const [a] = await sql<{ nome: string; dados: Buffer }[]>`SELECT a.nome, a.dados FROM sign_documents d JOIN attachments a ON a.id=d.attachment_id WHERE d.id=${id}`;
  if (!a) return NextResponse.json({ erro: "Não encontrado." }, { status: 404 });
  return new NextResponse(new Uint8Array(a.dados), { headers: cab(a.nome, u.searchParams.get("baixar") === "1") });
}
