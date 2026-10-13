import type { Metadata } from "next";
import { cookies } from "next/headers";
import { sql } from "@/db";
import { fmtDataHora } from "@/lib/utils";
import { ETICA_STATUS, CATEGORIA_ETICA } from "@/lib/etica";
import { acompanharRelato, mensagemDenunciante } from "../actions";
import { Btn } from "@/components/Btn";
import { textoErro } from "@/lib/aviso";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Acompanhar relato · Colégio Status", robots: { index: false, follow: false } };
const inp = "w-full rounded-md border border-line bg-white px-3 py-2.5 text-base sm:text-sm";

export default async function AcompanharRelato({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams; const jar = await cookies();
  const [r] = sp.p ? await sql<{ id: number; protocolo: string; categoria: string; status: string; codigo_hash: string; created_at: string }[]>`SELECT id, protocolo, categoria, status, codigo_hash, created_at::text FROM ethics_reports WHERE protocolo=${sp.p}` : [];
  const liberado = r && jar.get(`etica_${r.id}`)?.value === r.codigo_hash;
  const msgs = liberado ? await sql<{ autor: string; texto: string; created_at: string }[]>`SELECT autor, texto, created_at::text FROM ethics_messages WHERE report_id=${r.id} AND autor IN ('DENUNCIANTE','COMITE') ORDER BY id` : [];
  return (
    <main className="min-h-screen bg-mist px-3 py-6 sm:px-4 sm:py-8"><div className="mx-auto max-w-xl rounded-lg border border-line bg-white p-4 shadow-sm sm:p-6">
      <div className="mb-2 text-xs tracking-wide text-slate-500">COLÉGIO STATUS · CANAL DE ÉTICA</div>
      {liberado && r ? <><h1 className="text-xl font-semibold text-navy">Relato {r.protocolo}</h1>
        <p className="mt-1 text-sm text-slate-600">{CATEGORIA_ETICA[r.categoria]} · enviado {fmtDataHora(r.created_at)} · <b>{ETICA_STATUS[r.status]}</b></p>
        {sp.ok && <p className="mt-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-ok">Mensagem enviada ao comitê.</p>}
        {textoErro(sp) && <p role="alert" className="mt-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-erro">{textoErro(sp)}</p>}
        <ul className="mt-3 space-y-2">{msgs.length === 0 ? <li className="text-sm text-slate-500">Nenhuma mensagem ainda.</li> : msgs.map((m, i) => <li key={i} className={`rounded-md p-2 text-sm ${m.autor === "COMITE" ? "bg-sky-50" : "bg-mist"}`}><div className="text-[11px] text-slate-500">{m.autor === "COMITE" ? "Comitê" : "Você"} · {fmtDataHora(m.created_at)}</div><p className="whitespace-pre-wrap">{m.texto}</p></li>)}</ul>
        {["RECEBIDA", "EM_APURACAO"].includes(r.status) && <form action={mensagemDenunciante} className="mt-3 space-y-2"><input type="hidden" name="protocolo" value={r.protocolo} /><textarea name="texto" rows={3} required className={inp} placeholder="Complemento ou resposta ao comitê" /><Btn small>Enviar mensagem</Btn></form>}</> :
        <form action={acompanharRelato} className="space-y-3"><h1 className="text-xl font-semibold text-navy">Acompanhar relato</h1>
          {textoErro(sp) && <p role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-erro">{textoErro(sp)}</p>}
          <label className="block text-sm"><span className="mb-1 block font-medium">Protocolo</span><input name="protocolo" required defaultValue={sp.p ?? ""} className={inp} placeholder="ET-XXXX-XXXX" /></label>
          <label className="block text-sm"><span className="mb-1 block font-medium">Código</span><input name="codigo" required autoComplete="off" className={inp} /></label>
          <Btn>Consultar</Btn></form>}
      <p className="mt-4 text-xs"><a className="text-acao underline" href="/etica">Canal de ética</a></p>
    </div></main>
  );
}
