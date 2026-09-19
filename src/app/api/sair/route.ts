import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE } from "@/lib/session";

// Encerra a sessão a partir de um redirecionamento (ex.: usuário desativado enquanto estava logado).
export async function GET(req: Request) {
  (await cookies()).delete(COOKIE);
  const motivo = new URL(req.url).searchParams.get("motivo");
  return NextResponse.redirect(new URL(`/login${motivo ? `?erro=${encodeURIComponent(motivo)}` : ""}`, req.url));
}
