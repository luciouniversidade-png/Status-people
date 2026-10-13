import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getSettings } from "@/lib/utils";
import { PEDIDO_TIPO, TITULAR_TIPO } from "@/lib/privacidade";
import { abrirPedidoPublico, limparComprovantePrivacidade } from "./actions";
import { Btn } from "@/components/Btn";
import { textoErro } from "@/lib/aviso";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Privacidade · Colégio Status", robots: { index: false, follow: false } };
const inp = "w-full rounded-md border border-line bg-white px-3 py-2.5 text-base sm:text-sm";

export default async function PortalPrivacidade({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams; const cfg = await getSettings(); const p = cfg.privacidade;
  const novo = sp.enviado ? (await cookies()).get("priv_novo")?.value?.split("|") : undefined;
  return (
    <main className="min-h-screen bg-mist px-3 py-6 sm:px-4 sm:py-8"><div className="mx-auto max-w-2xl space-y-4">
      <div className="rounded-lg border border-line bg-white p-4 shadow-sm sm:p-6">
        <div className="mb-2 text-xs tracking-wide text-slate-500">COLÉGIO STATUS · PRIVACIDADE E PROTEÇÃO DE DADOS</div>
        <h1 className="text-xl font-semibold text-navy">Seus dados, seus direitos</h1>
        <p className="mt-2 text-sm text-slate-700">O Colégio Status trata dados de alunos, famílias e colaboradores para prestar os serviços educacionais, cumprir obrigações legais e manter a segurança na escola. Pela Lei Geral de Proteção de Dados (LGPD, art. 18), você pode pedir confirmação e acesso, correção, anonimização ou eliminação do que for desnecessário, portabilidade, informação sobre compartilhamento e a revogação de autorizações — como o uso de imagem.</p>
        <p className="mt-2 text-sm text-slate-700"><b>Encarregado (DPO):</b> {p.encarregadoNome || "a definir pela Direção"}{p.encarregadoEmail ? ` · ${p.encarregadoEmail}` : ""}{p.encarregadoTelefone ? ` · ${p.encarregadoTelefone}` : ""}. Prazo de resposta: até {p.prazoPedidoDias} dias.</p>
        <p className="mt-2 text-xs"><a className="text-acao underline" href="/privacidade/acompanhar">Acompanhar um pedido</a></p>
      </div>
      {sp.enviado ? <div className="rounded-lg border border-emerald-200 bg-white p-4 shadow-sm sm:p-6"><h2 className="text-lg font-semibold text-ok">Pedido recebido</h2>
        {novo ? <><p className="mt-2 text-sm">Guarde estes dados para acompanhar (o código não aparece de novo):</p><p className="mt-2 rounded bg-mist p-3 font-mono text-base">Protocolo: <b>{novo[0]}</b><br />Código: <b>{novo[1]}</b></p><form action={limparComprovantePrivacidade} className="mt-3"><button className="rounded-md border border-line bg-white px-3 py-2 text-sm text-navy">Anotei — tirar da tela</button><span className="ml-2 text-xs text-slate-500">Em computador compartilhado, clique antes de sair.</span></form></> : <p className="mt-2 text-sm">Obrigado. Responderemos pelo contato informado.</p>}</div> :
      <form action={abrirPedidoPublico} className="space-y-3 rounded-lg border border-line bg-white p-4 shadow-sm sm:p-6">
        <h2 className="text-lg font-semibold text-navy">Fazer um pedido</h2>
        {textoErro(sp) && <p role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-erro">{textoErro(sp)}</p>}
        <input name="site" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
        <label className="block text-sm"><span className="mb-1 block font-medium">O que você deseja</span><select name="tipo" required className={inp}><option value="">Escolha</option>{Object.entries(PEDIDO_TIPO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><label className="block text-sm"><span className="mb-1 block font-medium">Seu nome completo</span><input name="titularNome" required className={inp} autoComplete="name" /></label>
          <label className="block text-sm"><span className="mb-1 block font-medium">Sua relação com a escola</span><select name="titularTipo" required className={inp}><option value="">Escolha</option>{Object.entries(TITULAR_TIPO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="block text-sm"><span className="mb-1 block font-medium">Aluno(a) relacionado (se houver)</span><input name="alunoNome" className={inp} /></label>
          <label className="block text-sm"><span className="mb-1 block font-medium">E-mail</span><input name="email" type="email" className={inp} autoComplete="email" /></label>
          <label className="block text-sm"><span className="mb-1 block font-medium">Telefone</span><input name="telefone" inputMode="tel" className={inp} autoComplete="tel" /></label></div>
        <label className="block text-sm"><span className="mb-1 block font-medium">Conte o que você precisa</span><textarea name="descricao" required rows={4} className={inp} /></label>
        <p className="text-xs text-slate-500">Para entregar, corrigir ou apagar dados, a escola vai confirmar sua identidade antes. Use os dados informados só para responder este pedido.</p>
        <Btn pendingText="Enviando…">Enviar pedido</Btn>
      </form>}
    </div></main>
  );
}
