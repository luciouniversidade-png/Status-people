import Link from "@/components/Link";
import { sql } from "@/db";
import { requireMatriculas, scopeUnit } from "@/lib/auth";
import { Page, Card, Flash, Stat, Field, Input, Select, Btn } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { acaoRequerida, SITUACAO_DOC, IMPACTO } from "@/lib/acao-requerida";
import { ocupacao } from "@/lib/matriculas";
import { audit, hoje, fmtData, getSettings } from "@/lib/utils";
import { reservar, prorrogar } from "../actions";
import { designarTitular, registrarDocumento, reenviarSolicitacao } from "../acao-actions";

export const dynamic = "force-dynamic";
const CHIP: Record<string, string> = { bom: "border-emerald-200 bg-emerald-50 text-ok", atencao: "border-amber-200 bg-amber-50 text-aviso", ruim: "border-red-200 bg-red-50 text-erro", neutro: "border-slate-200 bg-slate-50 text-slate-600" };

/** T-013 · Ação requerida: o que está estruturalmente quebrado — consertar antes de analisar. Itens só somem quando resolvidos. */
export default async function AcaoRequerida({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireMatriculas(); const sp = await searchParams; const cfg = await getSettings(); const h = hoje(); const escopo = scopeUnit(s);
  const units = await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ORDER BY nome`;
  // escopo por unidade: pedir outra unidade é negado e auditado (aceite T-013)
  let negado = false; if (escopo !== null && sp.unidade && Number(sp.unidade) !== escopo) { negado = true; await audit(s, "acesso negado: outra unidade (Ação requerida)", "units", Number(sp.unidade) || null, null, { pedida: sp.unidade, escopo }); }
  const unitId = escopo ?? (sp.unidade && units.some(u => u.id === Number(sp.unidade)) ? Number(sp.unidade) : null);
  const opera = ["DIRECAO", "RH", "DIRETOR_UNIDADE", "GESTOR", "COMERCIAL"].includes(s.role); const coord = opera && s.role !== "COMERCIAL";
  const [ar, turmasAno, profs] = await Promise.all([acaoRequerida(unitId), ocupacao(cfg.matriculas.anoLetivo, unitId, "REGULAR"),
    sql<{ id: number; nome: string; unit_id: number; cargo: string | null }[]>`SELECT e.id, e.nome, e.unit_id, p.nome AS cargo FROM employees e LEFT JOIN positions p ON p.id=e.position_id WHERE e.situacao IN ('ATIVO','FERIAS','AFASTADO') ${unitId === null ? sql`` : sql`AND e.unit_id=${unitId}`} ORDER BY (p.nome ILIKE 'professor%') DESC, e.nome`]);
  const voltar = `/matriculas/acao${unitId && escopo === null ? `?unidade=${unitId}` : ""}`;
  const enviar = sp.enviar ? ar.documentos.find(d => d.student_id === Number(sp.enviar)) ?? null : null;
  const docsEnviar = (sp.docs ?? "").split("|").filter(Boolean);
  const textoMsg = enviar ? `Olá, ${enviar.responsavel ?? "família"}! Para concluir a matrícula de ${enviar.nome} em ${ar.ano}, precisamos de: ${docsEnviar.join(", ")}. Pode nos enviar? Obrigado! — Colégio Status` : "";
  const fone = enviar ? (enviar.telefone ?? "").replace(/\D/g, "") : ""; const linkEnvio = !enviar ? null : fone.length >= 10 ? `https://wa.me/${fone.startsWith("55") ? fone : `55${fone}`}?text=${encodeURIComponent(textoMsg)}` : enviar.email ? `mailto:${enviar.email}?subject=${encodeURIComponent(`Documentos da matrícula ${ar.ano}`)}&body=${encodeURIComponent(textoMsg)}` : null;
  // listas longas (rede com ~1.400 alunos): 20 por seção; "ver todos" abre a seção inteira (até 300) sem pesar a tela
  const LIM = (k: string) => sp.ver === k ? 300 : 20;
  const Mais = ({ k, n }: { k: string; n: number }) => n > LIM(k) || (sp.ver === k && n > 20) ? <p className="mt-1 text-xs text-slate-500 print:hidden">Mostrando {Math.min(n, LIM(k))} de {n}. {sp.ver === k ? <Link className="text-acao" href={`${voltar}#${k}`}>mostrar só os 20 primeiros</Link> : <Link className="text-acao" href={`${voltar}${voltar.includes("?") ? "&" : "?"}ver=${k}#${k}`}>ver {n > 300 ? "os 300 primeiros" : "todos"}</Link>}</p> : null;
  const blocos = [
    { k: "RESERVA", titulo: `Reservas vencendo em ${cfg.acaoRequerida.reservaHoras} h`, n: ar.reservas.length, ancora: "reservas", sub: `${ar.reservas.filter(r => r.vencida).length} já vencida(s)` },
    { k: "SEM_TURMA", titulo: `Alunos atuais sem turma ${ar.ano}`, n: ar.semTurma.length, ancora: "sem-turma", sub: "sem reserva nem matrícula" },
    { k: "SEM_TITULAR", titulo: "Turmas sem titular", n: ar.semTitular.length, ancora: "titular", sub: `${ar.anoAtual} e ${ar.ano}` },
    { k: "DOCUMENTO", titulo: "Alunos com documento pendente", n: ar.documentos.length, ancora: "documentos", sub: `${ar.contadores.VENCENDO + ar.contadores.VENCIDO} vencendo ou vencido(s)` },
  ].sort((a, b) => (b.n > 0 ? IMPACTO[b.k] : -1) - (a.n > 0 ? IMPACTO[a.k] : -1));
  return (
    <Page title="Ação requerida" sub="Pendências estruturais da operação: consertar antes de analisar. Ordem por impacto (vaga e receita primeiro); cada item se resolve aqui mesmo e só some quando resolvido.">
      <Flash ok={sp.ok} erro={negado ? "Acesso negado a outra unidade — a tentativa foi registrada na auditoria. Mostrando a sua unidade." : sp.erro} />
      {escopo === null && <form className="mb-4 flex items-end gap-2 print:hidden"><Field label="Unidade"><Select name="unidade" defaultValue={unitId ?? ""}><option value="">Rede</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field><Btn kind="ghost">Ver</Btn></form>}
      {enviar && <div role="status" className="mb-4 rounded-md border border-acao/30 bg-sky-50 p-3 text-sm"><b>Mensagem pronta para {enviar.responsavel ?? enviar.nome}:</b> <span className="text-slate-700">{textoMsg}</span>{linkEnvio ? <a href={linkEnvio} target="_blank" rel="noopener noreferrer" className="ml-2 inline-flex rounded-md bg-acao px-2.5 py-1 text-xs font-medium text-white">abrir {fone.length >= 10 ? "WhatsApp" : "e-mail"}</a> : <span className="ml-2 text-aviso">cadastro sem WhatsApp e sem e-mail</span>}</div>}
      <section aria-label="Contagem por tipo" className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">{blocos.map(b => <a key={b.k} href={`#${b.ancora}`} className={`rounded-md border bg-white p-3 hover:shadow-sm ${b.n ? "border-l-4 border-line border-l-aviso" : "border-line"}`}><div className="text-xs text-slate-600">{b.titulo}</div><div className={`text-2xl font-semibold tabular-nums ${b.n ? "text-navy" : "text-ok"}`}>{b.n}</div><div className="text-[11px] text-slate-500">{b.n ? b.sub : "nada pendente"}</div></a>)}</section>
      <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-7">{(["total", "PENDENTE", "RECEBIDO", "VERIFICADO", "REJEITADO", "VENCENDO", "VENCIDO"] as const).map(k => <Stat key={k} label={k === "total" ? "Documentos exigidos" : SITUACAO_DOC[k].rotulo} value={ar.contadores[k]} />)}</div>

      <Card title={`Reservas vencendo (${ar.reservas.length})`} className="mb-4 scroll-mt-20"><div id="reservas" />
        {ar.reservas.length === 0 ? <p className="text-sm text-slate-600">Nenhuma reserva vencendo.</p> : <ul className="divide-y divide-line text-sm">{ar.reservas.slice(0, LIM("reservas")).map(r => <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5"><span className="min-w-0"><Link href={`/matriculas/alunos/${r.student_id}`} className="font-medium text-acao hover:underline">{r.aluno}</Link><span className="block text-xs text-slate-600">{r.turma} · {r.unidade} · <span className={r.vencida ? "font-medium text-erro" : "text-aviso"}>{r.vencida ? "venceu" : "vence"} {fmtData(r.reserva_ate)}</span></span></span>{opera && <span className="flex gap-2 print:hidden"><Link href={`/matriculas/reservas?q=${encodeURIComponent(r.aluno)}`} className="rounded-md bg-acao px-2.5 py-1 text-xs font-medium text-white">Confirmar</Link><form action={prorrogar}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="dias" value={cfg.matriculas.reservaDias} /><input type="hidden" name="voltar" value={voltar} /><Btn small kind="ghost">+{cfg.matriculas.reservaDias} dias</Btn></form></span>}</li>)}</ul>}
        <Mais k="reservas" n={ar.reservas.length} />
      </Card>

      <Card title={`Alunos atuais sem turma ${ar.ano} (${ar.semTurma.length})`} className="mb-4 scroll-mt-20"><div id="sem-turma" />
        {ar.semTurma.length === 0 ? <p className="text-sm text-slate-600">Todos os alunos atuais têm reserva ou matrícula {ar.ano} (ou recusaram a rematrícula).</p> : <ul className="divide-y divide-line text-sm">{ar.semTurma.slice(0, LIM("sem-turma")).map(a => { const opc = turmasAno.filter(t => t.unit_id === a.unit_id && t.livres > 0 && t.status !== "FECHADA"); return <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5"><span className="min-w-0"><Link href={`/matriculas/alunos/${a.id}`} className="font-medium text-acao hover:underline">{a.nome}</Link><span className="block text-xs text-slate-600">{a.unidade ?? "sem unidade"} · série atual {a.serie ?? "—"} · rematrícula: {a.link ? a.link.toLowerCase() : "link não gerado"}</span></span>{opera && <Modal label="Alocar" title={`Alocar ${a.nome} em ${ar.ano}`}><form action={reservar} className="space-y-2"><input type="hidden" name="studentId" value={a.id} /><input type="hidden" name="voltar" value={voltar} /><Field label="Turma (com vaga)"><Select name="classId" required>{opc.length === 0 ? <option value="">sem turma com vaga na unidade</option> : opc.map(t => <option key={t.class_id} value={t.class_id}>{t.nome} · {t.turno} · {t.livres} vaga(s)</option>)}</Select></Field><p className="text-xs text-slate-500">Cria a reserva pelo prazo padrão ({cfg.matriculas.reservaDias} dias); a confirmação segue o fluxo de matrícula.</p><Btn small>Reservar vaga</Btn></form></Modal>}</li>; })}</ul>}
        <Mais k="sem-turma" n={ar.semTurma.length} />{ar.semTurma.length > 20 && <p className="mt-1 text-xs text-slate-500">Para muitos alunos de uma vez, use a Rematrícula (links em lote).</p>}
      </Card>

      <Card title={`Turmas sem titular (${ar.semTitular.length})`} className="mb-4 scroll-mt-20"><div id="titular" />
        {ar.semTitular.length === 0 ? <p className="text-sm text-slate-600">Todas as turmas regulares têm titular ativo.</p> : <ul className="divide-y divide-line text-sm">{ar.semTitular.slice(0, LIM("titular")).map(t => <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5"><span className="min-w-0"><Link href={`/matriculas/turmas/${t.id}`} className="font-medium text-acao hover:underline">{t.nome}</Link><span className="block text-xs text-slate-600">{t.ano} · {t.unidade} · {t.turno} · {t.alunos} aluno(s)</span></span>{coord && <form action={designarTitular} className="flex items-center gap-1 print:hidden"><input type="hidden" name="classId" value={t.id} /><input type="hidden" name="voltar" value={voltar} /><label className="sr-only" htmlFor={`tit${t.id}`}>Titular</label><select id={`tit${t.id}`} name="employeeId" required className="max-w-[14rem] rounded border border-line px-1.5 py-1 text-xs">{profs.filter(p => p.unit_id === t.unit_id || s.role === "DIRECAO").map(p => <option key={p.id} value={p.id}>{p.nome}{p.cargo ? ` · ${p.cargo}` : ""}</option>)}</select><Btn small kind="ghost">Designar</Btn></form>}</li>)}</ul>}
        <Mais k="titular" n={ar.semTitular.length} />
      </Card>

      <Card title={`Documentos de matrícula pendentes (${ar.documentos.length} aluno(s))`} className="scroll-mt-20"><div id="documentos" />
        {ar.documentos.length === 0 ? <p className="text-sm text-slate-600">Nenhum documento pendente, rejeitado ou vencendo entre os matriculados e reservados {ar.ano}.</p> : <ul className="divide-y divide-line text-sm">{ar.documentos.slice(0, LIM("documentos")).map(d => { const faltam = d.itens.filter(i => ["PENDENTE", "REJEITADO", "VENCIDO", "VENCENDO"].includes(i.situacao)); return <li key={d.student_id} className="py-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2"><span><Link href={`/matriculas/alunos/${d.student_id}`} className="font-medium text-acao hover:underline">{d.nome}</Link> <span className="text-xs text-slate-600">· {d.unidade} · {d.status === "CONFIRMADA" ? "matriculado" : "reserva"} · {d.faltando} pendência(s)</span></span>
            {opera && <form action={reenviarSolicitacao} className="flex flex-wrap items-center gap-1 print:hidden"><input type="hidden" name="studentId" value={d.student_id} /><input type="hidden" name="voltar" value={voltar} />{faltam.map(i => <input key={i.tipo} type="hidden" name="tipo" value={i.tipo} />)}<Btn small>Reenviar solicitação</Btn></form>}</div>
          <div className="mt-1 flex flex-wrap gap-1">{d.itens.map(i => { const st = SITUACAO_DOC[i.situacao]; return opera ? <Modal key={i.tipo} label={<span className={`rounded border px-1.5 py-0.5 text-[11px] ${CHIP[st.tom]}`}>{i.tipo} · {st.rotulo}{i.validade ? ` · ${fmtData(i.validade)}` : ""}</span>} kind="link" title={`${i.tipo} · ${d.nome}`}><form action={registrarDocumento} className="space-y-2"><input type="hidden" name="studentId" value={d.student_id} /><input type="hidden" name="tipo" value={i.tipo} /><input type="hidden" name="voltar" value={voltar} /><p className="text-xs text-slate-600">Situação: {st.rotulo}{i.solicitado_em ? ` · solicitado em ${fmtData(i.solicitado_em)} (${i.solicitacoes}×)` : ""}{i.motivo ? ` · ${i.motivo}` : ""}</p><div className="grid grid-cols-2 gap-2"><Field label="Validade (vazio = padrão do tipo)"><Input name="validade" type="date" /></Field><Field label="Motivo (se rejeitar)"><Input name="motivo" /></Field></div><div className="flex flex-wrap gap-1"><Btn small name="acao" value="RECEBIDO">Recebido</Btn><Btn small kind="ghost" name="acao" value="VERIFICADO">Verificado</Btn><Btn small kind="ghost" name="acao" value="REJEITADO">Rejeitar</Btn><Btn small kind="ghost" name="acao" value="PENDENTE">Voltar a pendente</Btn></div></form></Modal> : <span key={i.tipo} className={`rounded border px-1.5 py-0.5 text-[11px] ${CHIP[st.tom]}`}>{i.tipo} · {st.rotulo}</span>; })}</div>
        </li>; })}</ul>}
        <Mais k="documentos" n={ar.documentos.length} />
        <p className="mt-2 text-[11px] text-slate-500">Documentos exigidos e validades em Configurações › Ação requerida. Documento a {ar.vencendoDias} dias do vencimento entra na fila; o reenvio registra o contato na timeline da família.</p>
      </Card>
    </Page>
  );
}
