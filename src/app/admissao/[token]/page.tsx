import type { Metadata } from "next";
import { sql } from "@/db";
import { getSettings } from "@/lib/utils";
import { textoErro } from "@/lib/aviso";
import * as C from "@/lib/cadastro";
import { enviarFichaAdmissao } from "../actions";
import { Btn } from "@/components/Btn";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ficha cadastral · Colégio Status", robots: { index: false, follow: false } };
const inp = "w-full rounded-md border border-line bg-white px-3 py-2.5 text-base text-ink focus:border-acao focus:outline-none focus:ring-1 focus:ring-acao sm:text-sm";
const ARQ = "block w-full rounded-md border border-line bg-white px-2 py-2 text-sm";

function Rotulo({ t, dica, children }: { t: string; dica?: string; children: React.ReactNode }) { return <label className="block text-sm"><span className="mb-1 block font-medium text-slate-700">{t}</span>{children}{dica ? <span className="mt-0.5 block text-[11px] text-slate-500">{dica}</span> : null}</label>; }

/**
 * v34 · Ficha cadastral pelo link (admissão ou recadastramento), sem login. Mostra só o primeiro nome: nenhum dado da ficha aparece
 * na página (o link pode ser encaminhado por engano). Tudo o que chega daqui é revisado pelo RH antes de valer.
 */
export default async function FichaAdmissao({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { token } = await params; const sp = await searchParams;
  const Shell = ({ children }: { children: React.ReactNode }) => <main className="min-h-screen bg-mist px-3 py-6 sm:px-4 sm:py-8"><div className="mx-auto max-w-2xl rounded-lg border border-line bg-white p-4 shadow-sm sm:p-6"><div className="mb-4 border-b border-line pb-3 text-xs font-semibold uppercase tracking-wide text-navy">Colégio Status · Ficha cadastral</div>{children}</div></main>;
  let c; try { c = await C.contextoAdmissao(token); } catch (e) { return <Shell><h1 className="text-xl font-semibold text-navy">Link indisponível</h1><p className="mt-2 text-sm text-slate-600">{e instanceof Error ? e.message : "Link inválido."}</p></Shell>; }
  const cfg = await getSettings(); const erro = textoErro(sp);
  const [ult] = await sql<{ protocolo: string; status: string; created_at: string }[]>`SELECT protocolo, status, created_at::text FROM employee_change_requests WHERE invite_id=${c.inviteId} ORDER BY id DESC LIMIT 1`;
  const primeiro = c.nome.split(" ")[0]; const restam = Math.max(0, Number(cfg.cadastro.maxEnviosAdmissao) - c.envios);
  const campos = C.CAMPOS.filter(x => x.admissao); const grupos = [...new Set(campos.map(x => x.grupo))];
  return (
    <Shell>
      <h1 className="text-xl font-semibold text-navy">Olá, {primeiro}!</h1>
      <p className="mt-1 text-sm text-slate-600">Preencha seus dados e envie os documentos para o RH do Colégio Status{c.cargo ? ` (${c.cargo} · ${c.unidade})` : ""}. Link pessoal válido até {c.expira_em.split("-").reverse().join("/")} — não compartilhe.</p>
      {sp.ok ? <p role="status" className="mt-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-ok">Recebemos sua ficha{sp.protocolo && /^ADM-\d{4}-\d{4}$/.test(sp.protocolo) ? ` (protocolo ${sp.protocolo})` : ""}. O RH confere e entra em contato se faltar algo. Obrigado!</p> : null}
      {erro ? <p role="alert" className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-erro">{erro}</p> : null}
      {ult && !sp.ok ? <p className="mt-3 rounded border border-line bg-sky-50 px-3 py-2 text-xs text-slate-700">Você já enviou a ficha em {ult.created_at.slice(0, 10).split("-").reverse().join("/")} (protocolo {ult.protocolo}). {ult.status === "PENDENTE" ? "Está com o RH para conferência." : "O RH já analisou."} {restam ? `Se precisar corrigir ou completar, envie de novo (restam ${restam} envio(s)).` : ""}</p> : null}
      <section className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950"><b>Privacidade (LGPD):</b> seus dados e documentos são usados pelo Colégio Status para a admissão e o cadastro no eSocial, na folha de pagamento e nos benefícios (cumprimento de obrigação legal e do contrato de trabalho). Ficam restritos ao RH e à Direção. Raça/cor é exigida pelo eSocial e pode ser “prefiro não informar”. Não envie dados de saúde por aqui.</section>
      {restam > 0 ? <form action={enviarFichaAdmissao} className="mt-5 space-y-5"><input type="hidden" name="token" value={token} />
        {grupos.map(g => <section key={g}><h2 className="mb-2 text-sm font-semibold text-navy">{g}</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{campos.filter(x => x.grupo === g).map(x => <div key={x.k} className={x.k === "logradouro" || x.k === "vt_obs" || x.k === "contato_emergencia" ? "sm:col-span-2" : ""}><Rotulo t={x.rotulo} dica={x.dica}>
            {x.tipo === "select" ? <select name={x.k} defaultValue="" className={inp}><option value="">—</option>{x.opcoes!.map(([k, r]) => <option key={k} value={k}>{r}</option>)}</select>
              : x.tipo === "simnao" ? <select name={x.k} defaultValue="" className={inp}><option value="">—</option><option value="SIM">Sim</option><option value="NAO">Não</option></select>
              : x.tipo === "data" ? <input type="date" name={x.k} className={inp} />
              : <input name={x.k} maxLength={x.max} className={inp} inputMode={["cep", "pis", "banco_agencia", "banco_conta"].includes(x.k) ? "numeric" : x.k === "telefone" ? "tel" : x.k === "email" ? "email" : undefined} autoComplete={x.k === "email" ? "email" : x.k === "telefone" ? "tel" : x.k === "cep" ? "postal-code" : "off"} />}
          </Rotulo></div>)}</div></section>)}
        <section><h2 className="mb-2 text-sm font-semibold text-navy">Dependentes (filhos, cônjuge)</h2>
          <p className="mb-2 text-xs text-slate-600">Para imposto de renda, salário-família e plano de saúde. Deixe em branco se não tiver.</p>
          {[0, 1, 2, 3].map(i => <details key={i} open={i === 0} className="mb-2 rounded border border-line p-2"><summary className="cursor-pointer text-sm text-navy">Dependente {i + 1}</summary>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Rotulo t="Nome completo"><input name={`dep${i}Nome`} maxLength={120} className={inp} /></Rotulo>
              <Rotulo t="Parentesco"><select name={`dep${i}Parentesco`} defaultValue="" className={inp}><option value="">—</option>{C.PARENTESCO.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Rotulo>
              <Rotulo t="Nascimento"><input type="date" name={`dep${i}Nascimento`} className={inp} /></Rotulo>
              <Rotulo t="CPF do dependente"><input name={`dep${i}Cpf`} inputMode="numeric" maxLength={14} className={inp} /></Rotulo>
            </div>
            <div className="mt-2 flex flex-wrap gap-3 text-xs"><label className="flex items-center gap-1"><input type="checkbox" name={`dep${i}Irrf`} value="1" /> dependente no imposto de renda</label><label className="flex items-center gap-1"><input type="checkbox" name={`dep${i}Sf`} value="1" /> salário-família</label><label className="flex items-center gap-1"><input type="checkbox" name={`dep${i}Plano`} value="1" /> plano de saúde</label></div>
          </details>)}
        </section>
        <section><h2 className="mb-2 text-sm font-semibold text-navy">Documentos (foto legível ou PDF, até {cfg.plataforma.anexoMaxMb} MB cada)</h2>
          <div className="space-y-2">{Array.from({ length: 8 }, (_, i) => <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]"><select name={`doc${i}Tipo`} defaultValue={C.DOCS_ADMISSAO[Math.min(i, C.DOCS_ADMISSAO.length - 1)]} className={inp} aria-label={`Tipo do documento ${i + 1}`}>{C.DOCS_ADMISSAO.map(t => <option key={t}>{t}</option>)}</select><input type="file" name={`doc${i}`} accept="application/pdf,image/*" capture={undefined} className={ARQ} aria-label={`Documento ${i + 1}`} /></div>)}</div>
        </section>
        <Rotulo t="Observação para o RH (opcional)"><textarea name="obs" maxLength={500} className={`${inp} min-h-[70px]`} /></Rotulo>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="aceite" value="1" required className="mt-1" /> Li o aviso de privacidade e confirmo que os dados são verdadeiros.</label>
        <Btn>Enviar ao RH</Btn>
      </form> : <p className="mt-4 text-sm text-slate-600">O número de envios deste link acabou. Se precisar corrigir algo, fale com o RH.</p>}
    </Shell>
  );
}
