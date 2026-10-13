import { headers } from "next/headers";
import type { Metadata } from "next";
import { sql } from "@/db";
import { fmtData, fmtDataHora, hoje } from "@/lib/utils";
import { opcoesTurmas, contratoDoLink, contratoVigente, semPrefixoIntegral, MOTIVOS_RECUSA, type Rascunho } from "@/lib/rematricula";
import { escolherRematricula, aceitarRematricula, recusarRematricula } from "../actions";
import { Btn } from "@/components/Btn";
import { PrintButton } from "@/components/PrintButton";
import { textoErro } from "@/lib/aviso";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Rematrícula · Colégio Status", robots: { index: false, follow: false } };

const inp = "w-full rounded-md border border-line bg-white px-3 py-2.5 text-base text-ink focus:border-acao focus:outline-none focus:ring-1 focus:ring-acao sm:text-sm";
type L = { id: number; student_id: number; ano: number; unit_id: number | null; grade_id: number | null; status: string; expira_em: string; aberto_em: string | null; concluido_em: string | null; rascunho: Rascunho | null; contrato_versao: number | null; contrato_hash: string | null; contrato_texto: string | null; aceite: { nome: string; em: string; cpfFinal: string } | null; aluno: string; responsavel: string | null; telefone: string | null; email: string | null; serie_atual: string | null; serie_prevista: string | null; unidade: string | null; turma: string | null; turno: string | null; integral: string | null; integral_turno: string | null ; tem_cpf: boolean };

export default async function RematriculaFamilia({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { token } = await params; const sp = await searchParams;
  const [l] = await sql<L[]>`SELECT l.id, l.student_id, l.ano, l.unit_id, l.grade_id, l.status, l.expira_em::text, l.aberto_em::text, l.concluido_em::text, l.rascunho, l.contrato_versao, l.contrato_hash, l.contrato_texto, l.aceite, st.nome AS aluno, st.responsavel, st.telefone, st.email, (coalesce(st.cpf_responsavel, '') <> '') AS tem_cpf, ga.nome AS serie_atual, gp.nome AS serie_prevista, u.nome AS unidade, c.nome AS turma, c.turno, ci.nome AS integral, ci.turno AS integral_turno
    FROM rematricula_links l JOIN students st ON st.id=l.student_id LEFT JOIN grades ga ON ga.id=st.serie_atual_id LEFT JOIN grades gp ON gp.id=l.grade_id LEFT JOIN units u ON u.id=l.unit_id LEFT JOIN classes c ON c.id=l.class_id LEFT JOIN classes ci ON ci.id=l.integral_class_id WHERE l.token=${token}`;
  const Shell = ({ children, ano }: { children: React.ReactNode; ano?: number }) => <main className="min-h-screen bg-mist px-3 py-6 sm:px-4 sm:py-8"><div className="mx-auto max-w-2xl rounded-lg border border-line bg-white p-4 shadow-sm sm:p-6"><div className="mb-4 text-xs tracking-wide text-slate-500">COLÉGIO STATUS · REMATRÍCULA {ano ?? ""}</div>{children}</div><p className="mx-auto mt-3 max-w-2xl px-1 text-[11px] text-slate-500">Seus dados são tratados pelo Colégio Status para a matrícula e a prestação dos serviços educacionais. Dúvidas sobre privacidade: <a className="underline" href="/privacidade">central de privacidade</a>.</p></main>;
  const Erro = () => textoErro(sp) ? <p role="alert" className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-erro">{textoErro(sp)}</p> : null;
  if (!l) return <Shell><h1 className="text-xl font-semibold text-navy">Link inválido</h1><p className="mt-2 text-sm text-slate-600">Confira se o endereço foi copiado inteiro ou fale com a secretaria da escola.</p></Shell>;

  if (l.status === "CONCLUIDA") return (
    <Shell ano={l.ano}>
      <h1 className="text-xl font-semibold text-ok">Rematrícula concluída</h1>
      {sp.concluida && <p className="mt-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-ok">Pronto! A vaga de {l.aluno} está reservada com o contrato aceito.</p>}
      <dl className="mt-4 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        <div><dt className="text-xs text-slate-500">Aluno(a)</dt><dd className="font-medium">{l.aluno}</dd></div>
        <div><dt className="text-xs text-slate-500">Turma {l.ano}</dt><dd className="font-medium">{l.turma} · {l.turno}{l.integral ? ` + Integral (${semPrefixoIntegral(l.integral)})` : ""}</dd></div>
        <div><dt className="text-xs text-slate-500">Aceite</dt><dd>{l.aceite?.nome} · {fmtDataHora(l.aceite?.em ?? l.concluido_em)}</dd></div>
        <div><dt className="text-xs text-slate-500">Comprovante</dt><dd className="break-all font-mono text-[11px]">nº {l.id} · contrato v{l.contrato_versao} · {l.contrato_hash?.slice(0, 16)}</dd></div>
      </dl>
      <p className="mt-4 text-sm text-slate-700"><b>Próximo passo:</b> o financeiro da escola envia os boletos de {l.ano} pelo sistema financeiro. A matrícula é confirmada quando a primeira parcela estiver em ordem.</p>
      <details className="mt-4 rounded-md border border-line p-3"><summary className="cursor-pointer text-sm font-medium text-acao">Ver o contrato aceito</summary><div className="mt-2 max-h-[60vh] overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-slate-700">{l.contrato_texto}</div></details>
      <div className="mt-4 print:hidden"><PrintButton /></div>
    </Shell>
  );
  if (l.status === "RECUSADA") return <Shell ano={l.ano}><h1 className="text-xl font-semibold text-navy">Resposta recebida</h1><p className="mt-2 text-sm text-slate-600">Registramos que {l.aluno} não deve continuar em {l.ano}. Alguém da escola vai entrar em contato para entender o que aconteceu — se mudar de ideia, é só falar com a secretaria.</p></Shell>;
  if (l.status !== "PENDENTE" || l.expira_em < hoje()) return <Shell ano={l.ano}><h1 className="text-xl font-semibold text-navy">Link expirado</h1><p className="mt-2 text-sm text-slate-600">Este link de rematrícula não está mais ativo. Fale com a secretaria da unidade {l.unidade ?? ""} para receber um novo.</p></Shell>;
  // "abriu" = a família abriu no navegador. Pré-visualizações de link (WhatsApp, Telegram, redes) buscam a página sozinhas e não contam.
  const ua = (await headers()).get("user-agent") ?? "";
  if (!l.aberto_em && !/bot|crawl|spider|preview|whatsapp|facebookexternalhit|facebot|telegram|slack|discord|skype|linkedin|embedly|pinterest|vkshare|headless/i.test(ua)) await sql`UPDATE rematricula_links SET aberto_em=now() WHERE id=${l.id} AND aberto_em IS NULL`;
  if (!l.grade_id || !l.serie_prevista) return <Shell ano={l.ano}><h1 className="text-xl font-semibold text-navy">Fale com a secretaria</h1><p className="mt-2 text-sm text-slate-600">Não encontramos a série de {l.aluno} para {l.ano}. A secretaria da unidade {l.unidade ?? ""} vai orientar a rematrícula.</p></Shell>;
  const contrato = await contratoVigente(l.ano);
  if (!contrato) return <Shell ano={l.ano}><h1 className="text-xl font-semibold text-navy">Rematrícula online indisponível</h1><p className="mt-2 text-sm text-slate-600">O contrato de {l.ano} ainda não foi publicado. Tente mais tarde ou fale com a secretaria.</p></Shell>;
  const cab = <><h1 className="text-xl font-semibold text-navy">Rematrícula {l.ano} de {l.aluno}</h1><p className="mt-1 text-sm text-slate-600">{l.serie_atual ? `${l.serie_atual} → ` : ""}<b>{l.serie_prevista}</b>{l.unidade ? ` · unidade ${l.unidade}` : ""} · link válido até {fmtData(l.expira_em)}</p></>;

  // Etapa 2: contrato + consentimentos + aceite
  const doc = sp.etapa === "contrato" && l.rascunho ? await contratoDoLink(l) : null;
  if (doc && l.rascunho) {
    const fins = await sql<{ id: number; titulo: string; texto: string }[]>`SELECT id, titulo, texto FROM consent_purposes WHERE ativo AND na_rematricula ORDER BY ordem, id`;
    return (
      <Shell ano={l.ano}>{cab}<Erro />
        <div className="mt-4 rounded-md border border-sky-200 bg-sky-50 p-3 text-sm"><div className="text-xs text-slate-500">Sua escolha</div><div className="font-medium text-navy">{doc.turma.nome} · {doc.turma.turno} · {doc.turma.unidade}{doc.integral ? ` + Integral (${semPrefixoIntegral(doc.integral.nome)})` : ""}</div><div className="text-xs text-slate-600">Responsável financeiro: {l.rascunho.responsavel} · {l.rascunho.telefone}</div><a className="mt-1 inline-block text-xs text-acao underline" href={`/rematricula/${token}`}>alterar escolha ou dados</a></div>
        <form action={aceitarRematricula} className="mt-4 space-y-4"><input type="hidden" name="token" value={token} /><input type="hidden" name="hash" value={doc.hash} />
          <section><h2 className="text-sm font-semibold text-navy">{contrato.titulo} <span className="font-normal text-slate-500">· versão {contrato.versao}</span></h2>
            <div className="mt-2 max-h-[55vh] overflow-y-auto whitespace-pre-wrap rounded-md border border-line bg-mist/50 p-3 text-xs leading-relaxed text-slate-800" tabIndex={0}>{doc.texto}</div></section>
          {fins.length > 0 && <section><h2 className="text-sm font-semibold text-navy">Autorizações opcionais</h2><p className="text-xs text-slate-600">Cada uma é independente e <b>não interfere na matrícula</b>. Só marque o que autoriza; pode mudar de ideia quando quiser.</p>
            <div className="mt-2 space-y-2">{fins.map(f => <label key={f.id} className="flex cursor-pointer gap-3 rounded-md border-2 border-amber-300 bg-amber-50/60 p-3 text-sm has-[:checked]:border-acao has-[:checked]:bg-sky-50"><input type="checkbox" name={`consent_${f.id}`} value="1" className="mt-1 h-5 w-5 shrink-0 accent-acao" /><span><span className="block font-semibold text-navy">{f.titulo}</span><span className="block text-xs text-slate-700">{f.texto}</span></span></label>)}</div></section>}
          <section className="space-y-3 rounded-md border border-line p-3"><h2 className="text-sm font-semibold text-navy">Aceite eletrônico</h2>
            <label className="block text-sm"><span className="mb-1 block font-medium text-slate-700">Nome completo do responsável financeiro (assinatura)</span><input name="assinatura" required defaultValue={l.rascunho.responsavel} autoComplete="name" className={inp} /></label>
            <label className="block text-sm"><span className="mb-1 block font-medium text-slate-700">CPF do responsável financeiro</span><input name="cpf" required inputMode="numeric" autoComplete="off" placeholder="000.000.000-00" className={inp} /><span className="mt-1 block text-xs text-slate-500">Conferido com o cadastro da escola. Guardamos só o necessário como prova do aceite.</span></label>
            <label className="flex cursor-pointer items-start gap-3 text-sm"><input type="checkbox" name="aceito" value="1" required className="mt-0.5 h-5 w-5 shrink-0 accent-acao" /><span>Li e aceito o contrato acima (versão {contrato.versao}). Sei que a data, a hora, o endereço de rede (IP) e este texto ficam registrados como comprovante.</span></label>
          </section>
          <Btn pendingText="Concluindo…">Aceitar e concluir a rematrícula</Btn>
        </form>
      </Shell>
    );
  }

  // Etapa 1: dados + turma + (opcional) Integral
  const op = await opcoesTurmas(l); const r = l.rascunho;
  return (
    <Shell ano={l.ano}>{cab}<Erro />
      <form action={escolherRematricula} className="mt-4 space-y-5"><input type="hidden" name="token" value={token} />
        <section className="space-y-3"><h2 className="text-sm font-semibold text-navy">1. Confira os dados do responsável financeiro</h2>
          <label className="block text-sm"><span className="mb-1 block font-medium text-slate-700">Nome completo</span><input name="responsavel" required defaultValue={r?.responsavel ?? l.responsavel ?? ""} autoComplete="name" className={inp} /></label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-sm"><span className="mb-1 block font-medium text-slate-700">Celular com DDD</span><input name="telefone" required inputMode="tel" defaultValue={r?.telefone ?? l.telefone ?? ""} autoComplete="tel" className={inp} /></label>
            <label className="block text-sm"><span className="mb-1 block font-medium text-slate-700">E-mail</span><input name="email" type="email" defaultValue={r?.email ?? l.email ?? ""} autoComplete="email" className={inp} /></label>
          </div></section>
        <section><h2 className="text-sm font-semibold text-navy">2. Escolha a turma de {l.serie_prevista} em {l.ano}</h2>
          {op.outraUnidade && <p className="mt-1 text-xs text-aviso">A unidade atual não oferece {l.serie_prevista}; estas são as opções da rede.</p>}
          {op.regulares.length === 0 ? <p className="mt-2 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-aviso">Ainda não há turmas abertas para {l.serie_prevista} em {l.ano}. Fale com a secretaria.</p> :
            <div className="mt-2 space-y-2">{op.regulares.map(t => <label key={t.id} className={`flex items-center gap-3 rounded-md border p-3 text-sm ${t.livres > 0 ? "cursor-pointer border-line has-[:checked]:border-acao has-[:checked]:bg-sky-50" : "border-line bg-mist text-slate-500"}`}><input type="radio" name="classId" value={t.id} required disabled={t.livres <= 0} defaultChecked={r?.classId === t.id} className="h-5 w-5 accent-acao" /><span className="flex-1"><span className="block font-medium">{t.turno} · {t.nome}</span><span className="block text-xs">{op.outraUnidade ? `${t.unidade} · ` : ""}{t.livres > 0 ? (t.livres <= 3 ? `últimas ${t.livres} vaga(s)` : "com vagas") : "sem vaga — fale com a secretaria (lista de espera)"}</span></span></label>)}</div>}
        </section>
        {op.integrais.length > 0 && <section><h2 className="text-sm font-semibold text-navy">3. Integral (opcional)</h2><p className="text-xs text-slate-600">O Integral acontece no contraturno da turma regular.</p>
          <div className="mt-2 space-y-2"><label className="flex cursor-pointer items-center gap-3 rounded-md border border-line p-3 text-sm has-[:checked]:border-acao has-[:checked]:bg-sky-50"><input type="radio" name="integralClassId" value="" defaultChecked={!r?.integralClassId} className="h-5 w-5 accent-acao" /><span>Sem Integral</span></label>
            {op.integrais.map(t => <label key={t.id} className={`flex items-center gap-3 rounded-md border p-3 text-sm ${t.livres > 0 ? "cursor-pointer border-line has-[:checked]:border-acao has-[:checked]:bg-sky-50" : "border-line bg-mist text-slate-500"}`}><input type="radio" name="integralClassId" value={t.id} disabled={t.livres <= 0} defaultChecked={r?.integralClassId === t.id} className="h-5 w-5 accent-acao" /><span className="flex-1"><span className="block font-medium">{t.nome}</span><span className="block text-xs">{t.livres > 0 ? `para quem estuda no turno ${t.turno === "Matutino" ? "da tarde" : "da manhã"}` : "sem vaga"}</span></span></label>)}</div></section>}
        <Btn pendingText="Conferindo…">Continuar para o contrato</Btn>
      </form>
      <details className="mt-6 rounded-md border border-line p-3"><summary className="cursor-pointer text-sm text-slate-600">{l.aluno} não vai continuar no Colégio Status em {l.ano}</summary>
        <form action={recusarRematricula} className="mt-3 space-y-3"><input type="hidden" name="token" value={token} />
          <label className="block text-sm"><span className="mb-1 block font-medium text-slate-700">Pode nos contar o principal motivo?</span><select name="motivo" required className={inp}><option value="">Escolha</option>{MOTIVOS_RECUSA.map(m => <option key={m}>{m}</option>)}</select></label>
          <label className="block text-sm"><span className="mb-1 block font-medium text-slate-700">Comentário (opcional)</span><textarea name="obs" rows={3} className={inp} /></label>
          {l.tem_cpf && <label className="block text-sm"><span className="mb-1 block font-medium text-slate-700">CPF do responsável financeiro</span><input name="cpf" required inputMode="numeric" autoComplete="off" placeholder="000.000.000-00" className={inp} /><span className="mt-1 block text-xs text-slate-500">Para confirmar que a resposta é de quem responde pela matrícula.</span></label>}
          <p className="text-xs text-slate-500">Alguém da escola vai entrar em contato para conversar. Se mudar de ideia, fale com a secretaria.</p>
          <Btn kind="ghost" pendingText="Enviando…">Enviar resposta</Btn>
        </form></details>
    </Shell>
  );
}
