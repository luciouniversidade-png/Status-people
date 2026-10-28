import { veTela } from "@/lib/acesso";
import { NextResponse } from "next/server";
import { getSession, scopeUnit } from "@/lib/auth";
import { quadroParaRecortes, recorte, DIMENSOES, GRUPO_MINIMO, type PessoaRecorte } from "@/lib/recortes";
import { audit } from "@/lib/utils";

/** Export agregado dos recortes do quadro (grupo mínimo aplicado: nenhum grupo com menos de 5 sai no arquivo). */
export async function GET(req: Request) {
  const s = await getSession(); if (!s) return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  if (!veTela(s, "/analytics")) return NextResponse.json({ erro: "Tela fora do acesso do seu cargo." }, { status: 403 }); // v29: tela fora do acesso do cargo
  if (!["RH", "DIRECAO", "DIRETOR_UNIDADE"].includes(s.role)) return NextResponse.json({ erro: "Não autorizado." }, { status: 403 });
  const sp = new URL(req.url).searchParams; const dim = (Object.keys(DIMENSOES).includes(sp.get("dim") ?? "") ? sp.get("dim") : "unidade") as keyof PessoaRecorte;
  const fdim = Object.keys(DIMENSOES).includes(sp.get("fdim") ?? "") ? sp.get("fdim") as keyof PessoaRecorte : null; const fval = sp.get("fval");
  const unitId = scopeUnit(s) ?? (Number(sp.get("unidade")) || null);
  const r = recorte(await quadroParaRecortes(unitId), dim, fdim && fval ? { dim: fdim, valor: fval } : null);
  const out = [`Recorte do quadro por ${DIMENSOES[dim]};${fdim && fval && !r.bloqueado ? `filtro ${DIMENSOES[fdim]} = ${fval}` : "sem filtro"};grupo mínimo ${GRUPO_MINIMO}`, `${DIMENSOES[dim]};Pessoas`, ...r.visiveis.map(g => `"${g.rotulo.replace(/"/g, '""')}";${g.n}`), `Total;${r.base}`];
  await audit(s, "exportar recorte agregado do quadro", "employees", null, null, { dim, fdim, unitId });
  return new NextResponse("﻿" + out.join("\r\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="recorte_${dim}.csv"`, "Cache-Control": "private, no-store" } });
}
