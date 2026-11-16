import Link from "@/components/Link";
import { sql } from "@/db";
import type { Session } from "@/lib/auth";
import { Card, Badge, Btn, Field, Input, Select, Textarea } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { fmtData, fmtDataHora, hoje, addDays, getSettings } from "@/lib/utils";
import { pedidosDoColaborador, TIPO_ASSINATURA } from "@/lib/assinaturas";
import { pesquisasPendentes } from "@/lib/pesquisas";
import { TIPO_AJUSTE, STATUS_AJUSTE, TOM_AJUSTE, STATUS_ATESTADO, TOM_ATESTADO, evolucaoSalarial } from "@/lib/autoatendimento";
import { semanaDe, NOTAS } from "@/lib/humor";
import { DOC_PESSOAL, fmtCompetencia } from "@/lib/folha-dividir";
import { TIPOS_PESSOAIS_FOLHA } from "@/lib/anexos";
import { MOTIVO_SAL } from "@/lib/talento";
import { CORES, fmtTurno, DIAS_SEM } from "@/lib/escalas";
import { pedirAjustePonto, cancelarAjustePonto, enviarAtestado, registrarHumor, darParabens } from "./v34-actions";

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** v34 · O que chega ao Meu espaço: o que assinar, pesquisas, termômetro, documentos, ponto (ajuste e atestado), escala e evolução salarial. */
export async function AvisosV34({ s, eid }: { s: Session; eid: number }) {
  const [assinar, pesquisas, [novos], cfg] = await Promise.all([
    pedidosDoColaborador(eid), pesquisasPendentes(s),
    sql<{ n: number }[]>`SELECT count(*)::int AS n FROM payroll_docs d WHERE d.employee_id=${eid} AND d.tipo = ANY(${TIPOS_PESSOAIS_FOLHA}) AND NOT EXISTS (SELECT 1 FROM payroll_doc_views v WHERE v.doc_id=d.id AND v.user_id=${s.id})`,
    getSettings(),
  ]);
  const semana = semanaDe(hoje()); const [jaHumor] = cfg.termometro.ativo !== false ? await sql`SELECT 1 FROM mood_marks WHERE user_id=${s.id} AND dia=${semana}` : [true];
  const itens: [string, string, string][] = [];
  if (assinar.length) itens.push([`/eu/assinaturas${assinar.length === 1 ? `/${assinar[0].id}` : ""}`, `✍️ ${assinar.length} documento(s) para assinar`, assinar.some(a => a.tipo === "ESPELHO") ? "inclui o espelho do ponto" : TIPO_ASSINATURA[assinar[0].tipo] ?? ""]);
  if (pesquisas.length) itens.push([pesquisas.length === 1 ? `/eu/pesquisas/${pesquisas[0].id}` : "/eu/pesquisas", `📝 ${pesquisas.length} pesquisa(s) para responder`, `até ${fmtData(pesquisas[0].fim)}`]);
  if (novos?.n) itens.push(["/eu/documentos", `📄 ${novos.n} documento(s) novo(s)`, "holerite, recibo ou informe"]);
  return <>
    {itens.length ? <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">{itens.map(([href, t, sub]) => <Link key={href} href={href} className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 hover:border-acao"><span className="block text-sm font-medium text-navy">{t}</span><span className="block text-xs text-slate-600">{sub}</span></Link>)}</div> : null}
    {!jaHumor ? <Card title="Como foi a sua semana?" className="mb-4">
      <form action={registrarHumor} className="space-y-2"><input type="hidden" name="voltar" value="/eu" />
        <div className="grid grid-cols-5 gap-1.5">{NOTAS.map(([n, e, r]) => <label key={n} className="flex cursor-pointer flex-col items-center gap-0.5 rounded-md border border-line px-1 py-2 text-center has-[:checked]:border-acao has-[:checked]:bg-sky-50"><input type="radio" name="nota" value={n} required className="sr-only" /><span className="text-2xl" aria-hidden>{e}</span><span className="text-[11px] leading-tight text-slate-600">{r}</span></label>)}</div>
        <details className="text-xs"><summary className="cursor-pointer text-slate-600">O que mais pesou? (opcional, até 3)</summary><div className="mt-1.5 flex flex-wrap gap-1.5">{(cfg.termometro.fatores as string[]).map(f => <label key={f} className="flex items-center gap-1 rounded-full border border-line px-2 py-0.5 has-[:checked]:border-acao has-[:checked]:bg-sky-50"><input type="checkbox" name="fatores" value={f} className="sr-only" />{f}</label>)}</div></details>
        <div className="flex flex-wrap items-center gap-2"><Btn small>Enviar</Btn><span className="text-[11px] text-slate-500">Anônimo: o ONE guarda só a soma do grupo, nunca a sua resposta. Uma vez por semana.</span></div>
      </form></Card> : null}
  </>;
}

export async function MeuEspacoV34({ s, eid }: { s: Session; eid: number }) {
  const cfg = await getSettings(); const h = hoje();
  const [ajustes, atestados, docs, escala, [aniv], wishes, [faleRh]] = await Promise.all([
    sql<{ id: number; data: string; tipo: string; marcacoes: string; status: string; resposta: string | null; aprovado_nome: string | null }[]>`SELECT id, data::text, tipo, marcacoes, status, resposta, aprovado_nome FROM timesheet_adjust_requests WHERE employee_id=${eid} ORDER BY created_at DESC LIMIT 6`,
    sql<{ id: number; tipo: string; inicio: string; fim: string; dias: number | null; status: string; resposta: string | null }[]>`SELECT id, tipo, inicio::text, fim::text, dias, status, resposta FROM medical_certificates WHERE employee_id=${eid} ORDER BY created_at DESC LIMIT 5`,
    sql<{ id: number; tipo: string; competencia: string | null; attachment_id: number }[]>`SELECT d.id, CASE WHEN d.tipo='HOLERITE' THEN 'HOLERITES' ELSE d.tipo END AS tipo, coalesce(d.competencia, c.competencia) AS competencia, d.attachment_id FROM payroll_docs d LEFT JOIN payroll_cycles c ON c.id=d.cycle_id WHERE d.employee_id=${eid} AND d.tipo = ANY(${TIPOS_PESSOAIS_FOLHA}) ORDER BY coalesce(d.competencia, c.competencia) DESC NULLS LAST, d.id DESC LIMIT 4`,
    sql<{ data: string; folga: boolean; nome: string | null; sigla: string | null; inicio: string | null; fim: string | null; cor: string | null; equipe: string }[]>`SELECT a.data::text, a.folga, t.nome, t.sigla, t.inicio, t.fim, t.cor, st.nome AS equipe FROM shift_assignments a LEFT JOIN shift_types t ON t.id=a.shift_type_id JOIN shift_teams st ON st.id=a.team_id
      WHERE a.employee_id=${eid} AND a.data BETWEEN ${h} AND ${addDays(h, 13)} AND EXISTS (SELECT 1 FROM shift_publications p WHERE p.team_id=a.team_id AND p.semana = (a.data - ((extract(isodow from a.data)::int + 6) % 7))::date) ORDER BY a.data`,
    sql<{ md: string | null }[]>`SELECT to_char(data_nascimento, 'MM-DD') AS md FROM employees WHERE id=${eid}`,
    sql<{ de_nome: string; mensagem: string | null; at: string }[]>`SELECT de_nome, mensagem, at::text FROM birthday_wishes WHERE para_employee_id=${eid} AND ano=${Number(h.slice(0, 4))} ORDER BY at DESC`,
    sql<{ id: number }[]>`SELECT id FROM request_types WHERE codigo='FALE_RH' AND ativo`,
  ]);
  const evol = cfg.meuEspaco.mostrarEvolucaoSalarial !== false ? await evolucaoSalarial(eid) : [];
  // aniversariantes da unidade: da véspera até uma semana depois (só dia e mês; idade nunca aparece)
  const anivs = cfg.meuEspaco.mostrarAniversariantes !== false ? await sql<{ id: number; nome: string; md: string; ja: boolean }[]>`SELECT e.id, e.nome, to_char(e.data_nascimento, 'DD/MM') AS md, EXISTS (SELECT 1 FROM birthday_wishes w WHERE w.para_employee_id=e.id AND w.de_user_id=${s.id} AND w.ano=${Number(h.slice(0, 4))}) AS ja
    FROM employees e WHERE e.situacao='ATIVO' AND e.id <> ${eid} AND e.data_nascimento IS NOT NULL AND e.unit_id=(SELECT unit_id FROM employees WHERE id=${eid})
      AND (make_date(${Number(h.slice(0, 4))}, extract(month FROM e.data_nascimento)::int, CASE WHEN extract(month FROM e.data_nascimento)=2 AND extract(day FROM e.data_nascimento)=29 THEN 28 ELSE extract(day FROM e.data_nascimento)::int END) - ${h}::date) BETWEEN -7 AND 1 ORDER BY to_char(e.data_nascimento, 'MM-DD')` : [];
  const ehAniv = !!aniv?.md && Math.abs(Math.round((Date.parse(h) - Date.parse(`${h.slice(0, 4)}-${aniv.md}`)) / 86400000)) <= 7;
  return <div className="mt-4 space-y-4">
    {wishes.length && ehAniv ? <Card title={`🎉 Parabéns! ${wishes.length} mensagem(ns) de aniversário`}><div id="parabens" /><ul className="space-y-1 text-sm">{wishes.map((w, i) => <li key={i} className="[overflow-wrap:anywhere]"><b>{w.de_nome}</b>{w.mensagem ? `: ${w.mensagem}` : " te deu parabéns."}</li>)}</ul></Card> : null}
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card title="Ponto: ajuste e atestado" actions={<span className="flex gap-1">
        {cfg.meuEspaco.permitirAjustePonto !== false ? <Modal label="Pedir ajuste de ponto" title="Pedir ajuste de ponto"><form action={pedirAjustePonto} className="space-y-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><Field label="Dia"><Input type="date" name="data" required max={h} min={addDays(h, -Number(cfg.meuEspaco.ajustePontoDiasMax))} /></Field><Field label="O que houve"><Select name="tipo">{Object.entries(TIPO_AJUSTE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field></div>
          <Field label="Marcações corretas do dia (entrada, saída, entrada, saída)"><Input name="marcacoes" required placeholder="07:30 11:30 13:00 17:18" /></Field>
          <Field label="Explique"><Textarea name="motivo" required minLength={5} maxLength={600} className="min-h-[60px]" /></Field>
          <p className="text-[11px] text-slate-500">Vai para o(a) seu(sua) gestor(a) aprovar; depois o RH lança no ponto.</p><Btn small>Enviar</Btn></form></Modal> : null}
        {cfg.meuEspaco.permitirAtestado !== false ? <Modal label="Enviar atestado" title="Enviar atestado"><form action={enviarAtestado} className="space-y-2">
          <Field label="Tipo"><Select name="tipo"><option value="DIAS">Atestado de dias (afastamento)</option><option value="HORAS">Comparecimento (consulta ou exame, por horas)</option></Select></Field>
          <div className="grid grid-cols-2 gap-2"><Field label="Primeiro dia (ou o dia)"><Input type="date" name="inicio" required /></Field><Field label="Último dia"><Input type="date" name="fim" /></Field></div>
          <Field label="Horário (comparecimento)"><Input name="horas" placeholder="08:00 às 10:30" /></Field>
          <Field label="Foto ou PDF do atestado"><input type="file" name="arquivo" accept="image/*,application/pdf" capture="environment" required className="block w-full rounded-md border border-line bg-white px-2 py-1.5 text-xs" /></Field>
          <Field label="Observação (opcional)"><Input name="obs" maxLength={300} /></Field>
          <p className="text-[11px] text-slate-500">Não precisa informar o CID (código da doença): o ONE não pede nem guarda. Só o RH vê o arquivo. Guarde o original em papel.</p><Btn small>Enviar ao RH</Btn></form></Modal> : null}
      </span>}>
        <div id="ajuste" /><div id="atestado" />
        {ajustes.length === 0 && atestados.length === 0 ? <p className="text-sm text-slate-500">Esqueceu de bater o ponto ou ficou doente? Peça o ajuste ou envie o atestado por aqui — pelo celular, com foto.</p> : <ul className="divide-y divide-line text-sm">
          {ajustes.map(a => <li key={`a${a.id}`} className="flex flex-wrap items-center justify-between gap-2 py-1.5"><span className="min-w-0">Ajuste {fmtData(a.data)} · <span className="tabular-nums">{a.marcacoes}</span><span className="block text-[11px] text-slate-500">{TIPO_AJUSTE[a.tipo] ?? a.tipo}{a.aprovado_nome ? ` · ${a.aprovado_nome}` : ""}{a.resposta ? `: ${a.resposta}` : ""}</span></span><span className="flex items-center gap-1.5"><Badge v={TOM_AJUSTE[a.status] ?? "PENDENTE"} label={STATUS_AJUSTE[a.status] ?? a.status} />{a.status === "PENDENTE" ? <form action={cancelarAjustePonto}><input type="hidden" name="id" value={a.id} /><button className="text-[11px] text-erro">cancelar</button></form> : null}</span></li>)}
          {atestados.map(a => <li key={`m${a.id}`} className="flex flex-wrap items-center justify-between gap-2 py-1.5"><span className="min-w-0">Atestado {a.tipo === "DIAS" ? `${a.dias} dia(s) · ${fmtData(a.inicio)}` : `comparecimento · ${fmtData(a.inicio)}`}{a.resposta ? <span className="block text-[11px] text-slate-500">RH: {a.resposta}</span> : null}</span><Badge v={TOM_ATESTADO[a.status] ?? "PENDENTE"} label={STATUS_ATESTADO[a.status] ?? a.status} /></li>)}
        </ul>}
      </Card>
      <Card title="Meus documentos" actions={<Link className="text-xs text-acao underline" href="/eu/documentos">todos</Link>}>
        {docs.length === 0 ? <p className="text-sm text-slate-500">Holerites, recibos de férias e de 13º e informes de rendimentos aparecem aqui quando o RH publicar.</p> : <ul className="space-y-1 text-sm">{docs.map(d => <li key={d.id}><a className="text-acao" href={`/api/anexos/${d.attachment_id}`} target="_blank" rel="noopener">{DOC_PESSOAL[d.tipo] ?? d.tipo} · {fmtCompetencia(d.competencia)}</a></li>)}</ul>}
        <ul className="mt-2 space-y-0.5 border-t border-line pt-2 text-xs"><li><Link className="text-acao" href="/eu/assinaturas">Documentos para assinar</Link></li><li><Link className="text-acao" href="/eu/dados">Meus dados e dependentes</Link></li><li><Link className="text-acao" href="/eu/pesquisas">Pesquisas</Link></li>{faleRh ? <li><Link className="text-acao" href={`/solicitacoes/nova?tipo=${faleRh.id}`}>Fale com o RH</Link></li> : null}</ul>
      </Card>
    </div>
    {anivs.length ? <Card title="🎂 Aniversariantes da sua unidade"><ul className="space-y-1 text-sm">{anivs.map(a => <li key={a.id} className="flex flex-wrap items-center justify-between gap-2"><span>{a.nome} <span className="text-xs text-slate-500">· {a.md}</span></span>{a.ja ? <span className="text-[11px] text-ok">🎉 enviado</span> : <BotaoParabens employeeId={a.id} voltar="/eu" />}</li>)}</ul></Card> : null}
    {escala.length ? <Card title={`Minha escala — ${escala[0].equipe}`}><div id="escala" />
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-7">{escala.map(x => <div key={x.data} className={`rounded-md border px-2 py-1.5 text-xs ${x.folga ? "border-line bg-slate-50 text-slate-500" : CORES[x.cor ?? "sky"] ?? CORES.sky} ${x.data === h ? "ring-1 ring-acao" : ""}`}><span className="block font-medium">{DIAS_SEM[new Date(`${x.data}T12:00:00Z`).getUTCDay()]} {x.data.slice(8)}/{x.data.slice(5, 7)}</span>{x.folga ? "folga" : `${x.sigla ?? x.nome} · ${x.inicio && x.fim ? fmtTurno({ inicio: x.inicio, fim: x.fim }) : ""}`}</div>)}</div>
      <p className="mt-2 text-[11px] text-slate-500">Escala publicada pelo responsável da equipe. Mudanças chegam como aviso.</p></Card> : null}
    {evol.length ? <EvolucaoSalarial pontos={evol} /> : null}
  </div>;
}

/** Evolução salarial da própria pessoa: valores escondidos até tocar em “mostrar” (tela de celular em público). */
function EvolucaoSalarial({ pontos }: { pontos: { data: string; valor: number; motivo: string }[] }) {
  const W = 560, H = 140, P = 28; const vs = pontos.map(p => p.valor); const min = Math.min(...vs) * 0.95, max = Math.max(...vs) * 1.02;
  const x = (i: number) => P + (pontos.length === 1 ? (W - 2 * P) / 2 : (i * (W - 2 * P)) / (pontos.length - 1)); const y = (v: number) => H - P - ((v - min) / Math.max(1, max - min)) * (H - 2 * P);
  const d = pontos.map((p, i) => `${i ? "H" : "M"}${x(i).toFixed(1)}${i ? "" : ` ${y(p.valor).toFixed(1)}`}${i ? `V${y(p.valor).toFixed(1)}` : ""}`).join(" ");
  const cresc = pontos.length > 1 ? (pontos[pontos.length - 1].valor / pontos[0].valor - 1) * 100 : 0;
  return <Card title="Minha evolução salarial">
    <details><summary className="cursor-pointer text-sm text-acao">Mostrar (os valores ficam escondidos até você abrir)</summary>
      <p className="mt-2 text-sm">{pontos.length > 1 ? <>Desde {fmtData(pontos[0].data)}: <b className="text-ok">{cresc >= 0 ? "+" : ""}{cresc.toFixed(1).replace(".", ",")}%</b> · {pontos.length - 1} mudança(s)</> : "Sem mudanças registradas desde a admissão."}</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full" role="img" aria-label="Evolução salarial"><path d={d} fill="none" stroke="currentColor" strokeWidth="2" className="text-acao" />{pontos.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.valor)} r="3.5" className="fill-acao" />)}</svg>
      <ul className="mt-1 divide-y divide-line text-sm">{[...pontos].reverse().map((p, i, arr) => { const ant = arr[i + 1]; return <li key={i} className="flex flex-wrap justify-between gap-2 py-1"><span>{fmtData(p.data)} · {MOTIVO_SAL[p.motivo] ?? p.motivo}</span><span className="tabular-nums">{brl(p.valor)}{ant ? <span className="ml-1 text-xs text-slate-500">({((p.valor / ant.valor - 1) * 100).toFixed(1).replace(".", ",")}%)</span> : null}</span></li>; })}</ul>
    </details>
    <p className="mt-2 text-[11px] text-slate-500">Só você vê. Dúvidas sobre o seu salário: Fale com o RH. Atualizado em {fmtDataHora(new Date())}.</p>
  </Card>;
}

/** Botão de parabéns (home do RH e Meu espaço): da véspera até uma semana depois do aniversário. */
export function BotaoParabens({ employeeId, voltar }: { employeeId: number; voltar: string }) {
  return <Modal label="🎉 parabéns" kind="link" title="Dar parabéns"><form action={darParabens} className="space-y-2"><input type="hidden" name="employeeId" value={employeeId} /><input type="hidden" name="voltar" value={voltar} /><Field label="Mensagem (opcional)"><Input name="mensagem" maxLength={280} placeholder="Feliz aniversário! 🎂" /></Field><Btn small>Enviar</Btn></form></Modal>;
}
