import Link from "@/components/Link";
import { requireSession } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Field, Select, Btn, Textarea, Flash, Stat } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { BarrasH, Colunas, COR, corSerie } from "@/components/graficos";
import { podeReconhecer, podeModerar, valoresDaEscola, colegasReconheciveis, mural, estatisticasMural, MURAL_MAX } from "@/lib/reconhecimento";
import { addDays, hoje, fmtDataHora } from "@/lib/utils";
import { rotuloMes } from "@/lib/formato";
import { reconhecer, aplaudir, moderar } from "./actions";

export const dynamic = "force-dynamic";

/** Mural de reconhecimento: colegas reconhecem colegas pelos valores da escola. */
export default async function Reconhecimento({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const sp = await searchParams; const h = hoje();
  const [valores, colegas, units] = await Promise.all([valoresDaEscola(), podeReconhecer(s) ? colegasReconheciveis(s) : Promise.resolve([]), sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ORDER BY nome`]);
  const unidade = units.some(u => u.id === Number(sp.unidade)) ? Number(sp.unidade) : null;
  const valor = sp.valor && valores.includes(sp.valor) ? sp.valor : null;
  const pessoa = Number(sp.pessoa) > 0 ? Number(sp.pessoa) : null;
  const [recados, est] = await Promise.all([mural(s, { unidade, valor, pessoa }), estatisticasMural(addDays(h, -365))]);
  const q = (extra: Record<string, string | number | null>) => { const p = new URLSearchParams(); const base: Record<string, string | number | null> = { unidade, valor, pessoa, ...extra }; for (const [k, v] of Object.entries(base)) if (v !== null && v !== undefined && v !== "") p.set(k, String(v)); const t = p.toString(); return `/reconhecimento${t ? `?${t}` : ""}`; };
  const voltar = q({}); const mod = podeModerar(s);
  const corValor = (v: string | null) => v ? corSerie(Math.max(0, valores.indexOf(v))) : COR.neutro;
  const iniciais = (n: string) => n.split(" ").filter(Boolean).slice(0, 2).map(x => x[0]).join("").toUpperCase();
  return (
    <Page title="Mural de reconhecimento" sub="Reconheça um colega pelo que ele fez — ligado aos valores do Colégio Status. O recado fica no mural e a pessoa é avisada.">
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
        <div className="space-y-4">
          {podeReconhecer(s) && <Card title="Reconhecer um colega">
            {colegas.length === 0 ? <p className="text-sm text-slate-500">Nenhum colega disponível para reconhecer.</p> :
              <form action={reconhecer} className="space-y-3"><input type="hidden" name="voltar" value={voltar} />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Quem"><Select name="para" required defaultValue=""><option value="" disabled>Escolha o colega…</option>{colegas.map(c => <option key={c.id} value={c.id}>{c.nome}{c.cargo ? ` — ${c.cargo}` : ""} ({c.unidade})</option>)}</Select></Field>
                  <Field label="Valor da escola"><Select name="valor" defaultValue={valores[0] ?? ""}>{valores.map(v => <option key={v} value={v}>{v}</option>)}<option value="">Outro motivo</option></Select></Field>
                </div>
                <Field label="O que a pessoa fez" hint={`Seja específico: a situação e o impacto. Até ${MURAL_MAX} caracteres.`}><Textarea name="mensagem" required minLength={10} maxLength={MURAL_MAX} placeholder="Ex.: cobriu a turma do 5º ano em cima da hora e ainda preparou uma atividade que as crianças adoraram." /></Field>
                <Btn pendingText="Publicando…">Publicar no mural</Btn>
              </form>}
          </Card>}
          <form className="flex flex-wrap items-end gap-2 print:hidden">
            <Field label="Unidade"><Select name="unidade" defaultValue={unidade ?? ""}><option value="">Todas</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>
            <Field label="Valor"><Select name="valor" defaultValue={valor ?? ""}><option value="">Todos</option>{valores.map(v => <option key={v} value={v}>{v}</option>)}</Select></Field>
            <Btn kind="ghost">Filtrar</Btn>{(unidade || valor || pessoa) && <Btn kind="ghost" href="/reconhecimento">Limpar</Btn>}
          </form>
          {recados.length === 0 ? <Card><p className="py-6 text-center text-sm text-slate-500">Nenhum reconhecimento {unidade || valor || pessoa ? "neste filtro" : "ainda — seja o primeiro!"}</p></Card> :
            <ul className="space-y-3">
              {recados.map(r => (
                <li key={r.id} className={`rounded-md border bg-white p-4 ${r.status === "OCULTO" ? "border-dashed border-slate-300 opacity-70" : "border-line"}`} style={{ borderLeft: `4px solid ${corValor(r.valor)}` }}>
                  <div className="flex items-start gap-3">
                    <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-semibold text-white" style={{ background: corValor(r.valor) }}>{iniciais(r.para_nome)}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"><Link href={q({ pessoa: r.para_id })} className="font-semibold text-navy hover:underline">{r.para_nome}</Link><span className="text-xs text-slate-500">{r.para_cargo ? `${r.para_cargo} · ` : ""}{r.para_unidade}</span>{r.valor && <Link href={q({ valor: r.valor })} className="rounded-full px-2 py-0.5 text-[11px] font-medium text-white" style={{ background: corValor(r.valor) }}>{r.valor}</Link>}</div>
                      <p className="mt-1 whitespace-pre-line text-sm text-ink [overflow-wrap:anywhere]">{r.mensagem}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                        <span>por {r.de_nome} · {fmtDataHora(r.created_at)}</span>
                        {r.status === "PUBLICADO" && !podeReconhecer(s) && r.palmas > 0 && <span aria-label={`${r.palmas} aplausos`}>👏 {r.palmas}</span>}
                        {r.status === "PUBLICADO" && podeReconhecer(s) && <form action={aplaudir}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="voltar" value={voltar} /><button className={`rounded-full border px-2 py-0.5 ${r.minha ? "border-acao bg-sky-50 text-acao" : "border-line hover:bg-mist"}`} aria-pressed={r.minha} aria-label={r.minha ? "Desfazer aplauso" : "Aplaudir"}>👏 {r.palmas || ""}</button></form>}
                        {r.status === "OCULTO" && <span className="text-aviso">oculto do mural{r.oculto_motivo ? `: ${r.oculto_motivo}` : ""}</span>}
                        {mod && (r.status === "PUBLICADO"
                          ? <Modal label="ocultar" kind="link" title="Ocultar recado do mural"><form action={moderar} className="space-y-2"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="acao" value="ocultar" /><input type="hidden" name="voltar" value={voltar} /><Field label="Motivo (fica na auditoria)"><Textarea name="motivo" required minLength={5} /></Field><Btn small danger>Ocultar</Btn></form></Modal>
                          : <form action={moderar}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="acao" value="publicar" /><input type="hidden" name="voltar" value={voltar} /><button className="text-acao hover:underline">publicar de novo</button></form>)}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>}
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2 lg:grid-cols-1 xl:grid-cols-3">
            <Stat label="Recados em 12 meses" value={est.total.n} />
            <Stat label="Pessoas reconhecidas" value={est.total.pessoas} />
            <Stat label="Quem reconheceu" value={est.total.autores} />
          </div>
          <Card title="Valores mais reconhecidos (12 meses)">{est.porValor.length === 0 ? <p className="text-sm text-slate-500">Ainda sem recados.</p> : <BarrasH rotulo="Reconhecimentos por valor" itens={est.porValor.map(v => ({ chave: v.valor, rotulo: v.valor, valor: v.n, cor: corValor(valores.includes(v.valor) ? v.valor : null), href: valores.includes(v.valor) ? q({ valor: v.valor }) : undefined }))} formato={x => String(x)} largRotulo="7.5rem" />}</Card>
          {est.porMes.length > 1 && <Card title="Recados por mês"><Colunas categorias={est.porMes.map(m => rotuloMes(m.mes))} series={[{ nome: "Recados", valores: est.porMes.map(m => m.n), cor: COR.acao }]} rotulos tamanho="terco" rotulo="Reconhecimentos publicados por mês" /></Card>}
          <Card title="Por unidade (12 meses)">{est.porUnidade.length === 0 ? <p className="text-sm text-slate-500">Ainda sem recados.</p> : <BarrasH rotulo="Reconhecimentos por unidade" itens={est.porUnidade.map(u => ({ chave: u.unidade, rotulo: u.unidade, valor: u.n, cor: COR.navy }))} formato={x => String(x)} largRotulo="7.5rem" />}</Card>
        </div>
      </div>
    </Page>
  );
}
