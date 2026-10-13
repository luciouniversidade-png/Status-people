import type { Metadata } from "next";
import { cookies } from "next/headers";
import { sql } from "@/db";
import { fmtData, fmtDataHora } from "@/lib/utils";
import { PEDIDO_TIPO, PEDIDO_STATUS } from "@/lib/privacidade";
import { acompanharPedido } from "../actions";
import { Btn } from "@/components/Btn";
import { textoErro } from "@/lib/aviso";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Acompanhar pedido · Colégio Status", robots: { index: false, follow: false } };
const inp = "w-full rounded-md border border-line bg-white px-3 py-2.5 text-base sm:text-sm";

export default async function AcompanharPedido({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams; const jar = await cookies();
  const [p] = sp.p ? await sql<{ id: number; protocolo: string; tipo: string; status: string; prazo: string; resposta: string | null; respondida_em: string | null; created_at: string; codigo_hash: string | null }[]>`SELECT id, protocolo, tipo, status, prazo::text, resposta, respondida_em::text, created_at::text, codigo_hash FROM privacy_requests WHERE protocolo=${sp.p}` : [];
  const liberado = p && p.codigo_hash && jar.get(`priv_${p.id}`)?.value === p.codigo_hash;
  return (
    <main className="min-h-screen bg-mist px-3 py-6 sm:px-4 sm:py-8"><div className="mx-auto max-w-xl rounded-lg border border-line bg-white p-4 shadow-sm sm:p-6">
      <div className="mb-2 text-xs tracking-wide text-slate-500">COLÉGIO STATUS · PRIVACIDADE</div>
      {liberado && p ? <><h1 className="text-xl font-semibold text-navy">Pedido {p.protocolo}</h1>
        <dl className="mt-3 space-y-1 text-sm"><div><dt className="inline text-slate-500">Pedido: </dt><dd className="inline">{PEDIDO_TIPO[p.tipo]}</dd></div><div><dt className="inline text-slate-500">Recebido em: </dt><dd className="inline">{fmtDataHora(p.created_at)}</dd></div><div><dt className="inline text-slate-500">Situação: </dt><dd className="inline font-medium">{PEDIDO_STATUS[p.status]}</dd></div><div><dt className="inline text-slate-500">Prazo: </dt><dd className="inline">{fmtData(p.prazo)}</dd></div></dl>
        {p.resposta && ["RESPONDIDA", "INDEFERIDA"].includes(p.status) && <div className="mt-3 rounded-md border border-line bg-mist p-3 text-sm"><div className="text-xs text-slate-500">Resposta em {fmtDataHora(p.respondida_em)}</div><p className="mt-1 whitespace-pre-wrap">{p.resposta}</p></div>}</> :
        <form action={acompanharPedido} className="space-y-3"><h1 className="text-xl font-semibold text-navy">Acompanhar pedido</h1>
          {textoErro(sp) && <p role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-erro">{textoErro(sp)}</p>}
          <label className="block text-sm"><span className="mb-1 block font-medium">Protocolo</span><input name="protocolo" required defaultValue={sp.p ?? ""} className={inp} placeholder="LGPD-2026-0001" /></label>
          <label className="block text-sm"><span className="mb-1 block font-medium">Código</span><input name="codigo" required autoComplete="off" className={inp} /></label>
          <Btn>Consultar</Btn></form>}
      <p className="mt-4 text-xs"><a className="text-acao underline" href="/privacidade">Voltar à central de privacidade</a></p>
    </div></main>
  );
}
