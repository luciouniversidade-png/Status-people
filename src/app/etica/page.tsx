import type { Metadata } from "next";
import { cookies } from "next/headers";
import { sql } from "@/db";
import { CATEGORIA_ETICA, RELACAO_ETICA } from "@/lib/etica";
import { enviarRelato, limparComprovanteEtica } from "./actions";
import { Btn } from "@/components/Btn";
import { textoErro } from "@/lib/aviso";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Canal de ética · Colégio Status", robots: { index: false, follow: false } };
const inp = "w-full rounded-md border border-line bg-white px-3 py-2.5 text-base sm:text-sm";

export default async function CanalEtica({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams; const units = await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ORDER BY nome`;
  const novo = sp.enviado ? (await cookies()).get("etica_novo")?.value?.split("|") : undefined;
  return (
    <main className="min-h-screen bg-mist px-3 py-6 sm:px-4 sm:py-8"><div className="mx-auto max-w-2xl space-y-4">
      <div className="rounded-lg border border-line bg-white p-4 shadow-sm sm:p-6">
        <div className="mb-2 text-xs tracking-wide text-slate-500">COLÉGIO STATUS · CANAL DE ÉTICA</div>
        <h1 className="text-xl font-semibold text-navy">Relate com segurança</h1>
        <p className="mt-2 text-sm text-slate-700">Use este canal para relatar assédio sexual ou moral, discriminação, violência, situações de risco a crianças e adolescentes, fraude ou outra conduta contrária às regras da escola. <b>Você pode relatar sem se identificar:</b> não pedimos login e não registramos seu endereço de rede. Um comitê de triagem analisa cada relato; quem é citado não tem acesso ao caso.</p>
        <p className="mt-2 text-xs"><a className="text-acao underline" href="/etica/acompanhar">Acompanhar um relato</a></p>
      </div>
      {sp.enviado ? <div className="rounded-lg border border-emerald-200 bg-white p-4 shadow-sm sm:p-6"><h2 className="text-lg font-semibold text-ok">Relato recebido</h2>
        {novo ? <><p className="mt-2 text-sm">Guarde o protocolo e o código: são a única forma de acompanhar e conversar com o comitê sem se identificar. O código não aparece de novo.</p><p className="mt-2 rounded bg-mist p-3 font-mono text-base">Protocolo: <b>{novo[0]}</b><br />Código: <b>{novo[1]}</b></p><form action={limparComprovanteEtica} className="mt-3"><button className="rounded-md border border-line bg-white px-3 py-2 text-sm text-navy">Anotei — tirar da tela</button><span className="ml-2 text-xs text-slate-500">Em computador compartilhado, clique antes de sair.</span></form></> : <p className="mt-2 text-sm">Obrigado pela coragem de relatar.</p>}</div> :
      <form action={enviarRelato} className="space-y-3 rounded-lg border border-line bg-white p-4 shadow-sm sm:p-6">
        {textoErro(sp) && <p role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-erro">{textoErro(sp)}</p>}
        <input name="site" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
        <label className="block text-sm"><span className="mb-1 block font-medium">Tipo de conduta</span><select name="categoria" required className={inp}><option value="">Escolha</option>{Object.entries(CATEGORIA_ETICA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="block text-sm"><span className="mb-1 block font-medium">O que aconteceu</span><textarea name="relato" required rows={6} className={inp} placeholder="Descreva os fatos: o quê, quando, onde, como. Evite incluir dados que não sejam necessários." /></label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-sm"><span className="mb-1 block font-medium">Quem está envolvido</span><input name="envolvidos" className={inp} placeholder="nomes ou funções" /></label>
          <label className="block text-sm"><span className="mb-1 block font-medium">Unidade</span><select name="unitId" className={inp}><option value="">Prefiro não dizer</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</select></label>
          <label className="block text-sm"><span className="mb-1 block font-medium">Onde</span><input name="local" className={inp} /></label>
          <label className="block text-sm"><span className="mb-1 block font-medium">Quando</span><input name="quando" className={inp} placeholder="data aproximada" /></label>
          <label className="block text-sm"><span className="mb-1 block font-medium">Testemunhas (opcional)</span><input name="testemunhas" className={inp} /></label>
          <label className="block text-sm"><span className="mb-1 block font-medium">Você é</span><select name="relacao" className={inp}>{Object.entries(RELACAO_ETICA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        </div>
        <details className="rounded-md border border-line p-3"><summary className="cursor-pointer text-sm">Quero me identificar (opcional)</summary>
          <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" name="identificar" value="1" /> Autorizo o comitê a me contatar</label>
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2"><input name="nome" placeholder="Nome" className={inp} /><input name="contato" placeholder="Telefone ou e-mail" className={inp} /></div></details>
        <p className="text-xs text-slate-500">A escola não admite retaliação contra quem relata de boa-fé.</p>
        <Btn pendingText="Enviando…">Enviar relato</Btn>
      </form>}
    </div></main>
  );
}
