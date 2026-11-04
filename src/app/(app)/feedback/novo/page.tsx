// v31 · Mandar feedback: para quem, formato, assunto, texto, conteúdo da Academy, valores da escola, visibilidade; rascunho ou envio.
import Link from "@/components/Link";
import { requireSession, scopeUnit } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Flash, Field, Select, Btn } from "@/components/ui";
import { FormatoFeedback } from "@/components/FormatoFeedback";
import { fmtData } from "@/lib/utils";
import { colegasConversa, rotuloColega, FORMATO_FB } from "@/lib/conversas";
import { valoresDaEscola } from "@/lib/reconhecimento";
import { salvarFeedback } from "../actions";

export const dynamic = "force-dynamic";

export default async function MandarFeedback({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const sp = await searchParams;
  const [colegas, valores, cursos] = await Promise.all([colegasConversa(s), valoresDaEscola(), sql<{ id: number; titulo: string; area: string | null }[]>`SELECT id, titulo, area FROM courses WHERE ativo ORDER BY titulo`]);
  const rasc = sp.rascunho ? (await sql<{ id: number; employee_id: number; formato: string; assunto: string | null; texto: string | null; situacao: string | null; comportamento: string | null; impacto: string | null; valores: string[] | null; course_id: number | null; visibilidade: string; request_id: number | null }[]>`SELECT id, employee_id, formato, assunto, texto, situacao, comportamento, impacto, valores, course_id, visibilidade, request_id FROM feedbacks WHERE id=${Number(sp.rascunho)} AND autor_user_id=${s.id} AND status='RASCUNHO'`)[0] : undefined;
  const pedidoId = rasc?.request_id ?? (sp.pedido ? Number(sp.pedido) : null);
  const pedido = pedidoId ? (await sql<{ id: number; solicitante_nome: string | null; solicitante_employee_id: number | null; assunto: string; mensagem: string | null; prazo: string | null; status: string }[]>`SELECT id, solicitante_nome, solicitante_employee_id, assunto, mensagem, prazo::text, status FROM feedback_requests WHERE id=${pedidoId} AND para_user_id=${s.id}`)[0] : undefined;
  const para = rasc?.employee_id ?? pedido?.solicitante_employee_id ?? (sp.para ? Number(sp.para) : null);
  const alvo = para ? (await sql<{ gestor_id: number | null; unit_id: number }[]>`SELECT gestor_id, unit_id FROM employees WHERE id=${para}`)[0] : undefined;
  const gestao = !!alvo && (["RH", "DIRECAO"].includes(s.role) || (s.role === "DIRETOR_UNIDADE" && scopeUnit(s) === alvo.unit_id) || (!!s.employeeId && alvo.gestor_id === s.employeeId));
  const voltar = `/feedback/novo?${new URLSearchParams(Object.entries({ rascunho: sp.rascunho, pedido: sp.pedido, para: sp.para }).filter(([, v]) => v) as [string, string][]).toString()}`;
  return (
    <Page title="Mandar feedback" sub={<>Feedback útil é específico: o contexto, o que a pessoa fez e as consequências. Para pedir o seu, use <Link className="text-acao" href="/feedback?aba=pedidos">Pedir feedback</Link>.</>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      {pedido && <Card className="mb-4" title="Respondendo a um pedido"><p className="text-sm"><b>{pedido.solicitante_nome}</b> pediu feedback sobre: <b>{pedido.assunto}</b>{pedido.prazo ? <span className="text-xs text-slate-500"> · até {fmtData(pedido.prazo)}</span> : null}</p>{pedido.mensagem && <p className="mt-1 text-sm text-slate-600">“{pedido.mensagem}”</p>}{pedido.status !== "PENDENTE" && <p className="mt-1 text-xs text-aviso">Este pedido já não está aberto.</p>}</Card>}
      <Card>
        <form action={salvarFeedback} className="space-y-4"><input type="hidden" name="voltar" value={voltar} />{rasc && <input type="hidden" name="id" value={rasc.id} />}{pedido && <input type="hidden" name="pedidoId" value={pedido.id} />}
          {pedido ? <input type="hidden" name="employeeId" value={pedido.solicitante_employee_id ?? ""} /> : <Field label="Feedback para"><Select name="employeeId" required defaultValue={para ? String(para) : ""}><option value="" disabled>Buscar o colega…</option>{colegas.map(c => <option key={c.id} value={c.id}>{rotuloColega(c)}</option>)}</Select></Field>}
          <FormatoFeedback formatos={FORMATO_FB} inicial={rasc?.formato ?? (sp.formato === "ELOGIO" ? "ELOGIO" : "LIVRE")} texto={rasc?.texto} situacao={rasc?.situacao} comportamento={rasc?.comportamento} impacto={rasc?.impacto} assunto={rasc?.assunto ?? (pedido ? pedido.assunto : null)} />
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="rounded-md border border-line bg-mist/40 p-3"><div className="text-sm font-semibold text-navy">Academy</div><p className="mb-2 text-xs text-slate-600">Recomende um conteúdo da Academy adicionando-o ao seu feedback.</p><Select name="courseId" defaultValue={rasc?.course_id ? String(rasc.course_id) : ""} aria-label="Conteúdo da Academy"><option value="">+ Adicionar conteúdo (opcional)</option>{cursos.map(c => <option key={c.id} value={c.id}>{c.titulo}{c.area ? ` · ${c.area}` : ""}</option>)}</Select></div>
            <div className="rounded-md border border-line bg-mist/40 p-3"><div className="text-sm font-semibold text-navy">Valores</div><p className="mb-2 text-xs text-slate-600">Conecte seu feedback a valores. Isso ajudará a entendê-lo melhor.</p>{valores.length === 0 ? <p className="text-xs text-slate-500">Os valores vêm da Identidade (Estratégia) vigente.</p> : <div className="flex flex-wrap gap-1.5">{valores.map(v => <label key={v} className="cursor-pointer"><input type="checkbox" name="valores" value={v} defaultChecked={(rasc?.valores ?? []).includes(v)} className="peer sr-only" /><span className="inline-block rounded-full border border-line bg-white px-2.5 py-1 text-xs text-navy peer-checked:border-acao peer-checked:bg-sky-50 peer-checked:font-semibold peer-checked:text-acao">{v}</span></label>)}</div>}</div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Quem vê" hint={gestao ? "Como gestão da pessoa, o padrão é registrar no painel do colaborador (aba Feedbacks)." : "Entre colegas, o padrão é só a pessoa ver."}><Select name="visibilidade" defaultValue={rasc?.visibilidade ?? (gestao ? "GESTAO" : "PRIVADO")}>{gestao ? <><option value="GESTAO">Registrar no painel do colaborador (gestão vê)</option><option value="PRIVADO">Só a pessoa</option></> : <><option value="PRIVADO">Só a pessoa</option><option value="GESTOR">A pessoa e o gestor direto dela</option></>}</Select></Field>
            <label className="flex items-start gap-2 self-end rounded-md border border-line p-2 text-xs"><input type="checkbox" name="mural" value="1" className="mt-0.5" /> <span>Se for <b>elogio</b>, publicar também no Mural de reconhecimento (público, com o primeiro valor marcado).</span></label>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3"><Btn kind="ghost" name="acao" value="rascunho" pendingText="Salvando…">Salvar rascunho</Btn><Btn name="acao" value="enviar">Enviar</Btn></div>
        </form>
      </Card>
      <p className="mt-3 text-[11px] text-slate-500">Feedback não é avaliação: não vira nota e quantidade de elogios não conta pontos. O conteúdo de um feedback entre colegas fica com quem mandou e quem recebeu (e com o gestor direto, se você escolher).</p>
    </Page>
  );
}
