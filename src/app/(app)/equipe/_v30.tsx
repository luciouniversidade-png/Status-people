// v30 · Semana da equipe (no estilo dos painéis de ponto das plataformas de RH): quem trabalhou, faltou ou esteve fora em cada dia
// da semana, horas trabalhadas × previstas, a tendência das horas extras aprovadas (8 semanas) e o que espera a decisão do gestor.
// Ausência por saúde aparece como “ausência justificada” (o motivo é do RH).
import Link from "@/components/Link";
import { sql } from "@/db";
import { Card } from "@/components/ui";
import { Colunas, COR } from "@/components/graficos";
import { addDays, fmtData } from "@/lib/utils";
import { fmtMin } from "@/lib/utils";

const DIAS = ["seg", "ter", "qua", "qui", "sex"];
type Dia = { employee_id: number; data: string; status: string; esperado_min: number; trabalhado_min: number };

function celula(d: Dia | undefined, sensivel: boolean): { t: string; c: string; title: string } {
  if (!d) return { t: "·", c: "text-slate-300", title: "sem marcação importada" };
  if (d.status === "FALTA") return { t: "F", c: "bg-red-50 text-erro", title: "falta" };
  if (["ATESTADO", "AFASTADO"].includes(d.status)) return { t: "J", c: "bg-amber-50 text-aviso", title: sensivel ? (d.status === "ATESTADO" ? "atestado (abonado)" : "afastado") : "ausência justificada" };
  if (d.status === "FERIAS") return { t: "Fé", c: "bg-sky-50 text-acao", title: "férias" };
  if (d.status === "FOLGA_BANCO") return { t: "Fo", c: "bg-sky-50 text-acao", title: "folga do banco de horas" };
  if (["FERIADO", "RECESSO", "NAO_LETIVO", "DSR", "DISPENSA"].includes(d.status)) return { t: "—", c: "text-slate-400", title: "sem expediente" };
  const dif = d.trabalhado_min - d.esperado_min;
  if (d.esperado_min > 0 && dif < -30) return { t: "✓", c: "bg-amber-50 text-aviso", title: `trabalhou ${fmtMin(d.trabalhado_min).replace("+", "")} de ${fmtMin(d.esperado_min).replace("+", "")} (${fmtMin(dif)})` };
  return { t: "✓", c: "bg-emerald-50 text-ok", title: `trabalhou ${fmtMin(d.trabalhado_min).replace("+", "")}${dif > 30 ? ` (${fmtMin(dif)})` : ""}` };
}

const segundaDe = (d: string) => { const dow = new Date(d + "T12:00:00Z").getUTCDay(); return addDays(d, dow === 0 ? -6 : 1 - dow); };

/** semana: qualquer data da semana a mostrar (padrão: a semana de hoje). Sem espelho importado na semana, oferece a última semana importada. */
export async function SemanaEquipe({ eq, h, sensivel, amplo, semana, base }: { eq: { id: number; nome: string }[]; h: string; sensivel: boolean; amplo: boolean; semana?: string | null; base: string }) {
  const ids = eq.map(e => e.id); if (!ids.length) return null;
  const segHoje = segundaDe(h); const pedida = semana && /^\d{4}-\d{2}-\d{2}$/.test(semana) ? segundaDe(semana) : segHoje;
  const seg = pedida > segHoje ? segHoje : pedida; const dias = DIAS.map((_, i) => addDays(seg, i)); // dias depois de hoje ficam em branco
  const ini8 = addDays(seg, -7 * 7);
  const href = (d: string) => `${base}${base.includes("?") ? "&" : "?"}semana=${d}#semana`;
  const [rows, extras, [pend], [ult]] = await Promise.all([
    sql<Dia[]>`SELECT employee_id, data::text, status, esperado_min, trabalhado_min FROM timesheet_days WHERE employee_id IN ${sql(ids)} AND data BETWEEN ${seg}::date AND ${dias[4]}::date`,
    sql<{ semana: string; min: number }[]>`SELECT date_trunc('week', data)::date::text AS semana, sum(minutos)::int AS min FROM hour_entries WHERE employee_id IN ${sql(ids)} AND tipo='EXTRA' AND status='APROVADO' AND data >= ${ini8}::date AND data <= ${dias[4]}::date GROUP BY 1`,
    sql<{ banco: number; ferias: number }[]>`SELECT (SELECT count(*) FROM hour_entries WHERE employee_id IN ${sql(ids)} AND status='PENDENTE')::int AS banco, (SELECT count(*) FROM leave_requests WHERE employee_id IN ${sql(ids)} AND status='SOLICITADA')::int AS ferias`,
    sql<{ data: string | null }[]>`SELECT max(data)::text AS data FROM timesheet_days WHERE employee_id IN ${sql(ids)} AND data < ${seg}::date`,
  ]);
  const semanas = Array.from({ length: 8 }, (_, i) => addDays(ini8, i * 7));
  const serie = semanas.map(w => (extras.find(x => x.semana === w)?.min ?? 0) / 60);
  const tot = (eid: number) => rows.filter(r => r.employee_id === eid).reduce((a, r) => ({ esp: a.esp + r.esperado_min, trab: a.trab + r.trabalhado_min }), { esp: 0, trab: 0 });
  const faltas = rows.filter(r => r.status === "FALTA").length; const semDado = ids.length * dias.filter(x => x <= h).length - rows.filter(r => r.data <= h).length;
  const ultSemana = !rows.length && ult?.data ? segundaDe(ult.data) : null;
  const nav = <div className="mb-2 flex flex-wrap items-center gap-3 text-xs"><Link className="text-acao" href={href(addDays(seg, -7))}>← semana anterior</Link>{seg < segHoje && <Link className="text-acao" href={href(addDays(seg, 7))}>próxima semana →</Link>}{seg < segHoje && <Link className="text-acao" href={href(h)}>esta semana</Link>}</div>;
  return <div id="semana" className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
    <Card title={`Semana da equipe — ${fmtData(seg)} a ${fmtData(dias[4])}`}>
      {nav}
      {ultSemana && <p className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-aviso">O espelho de ponto desta semana ainda não foi importado. <Link className="font-medium underline" href={href(ultSemana)}>Ver a semana de {fmtData(ultSemana)} (a última importada)</Link></p>}
      <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-sm"><thead className="text-xs text-slate-500"><tr><th className="py-1 text-left font-medium">Pessoa</th>{dias.map((dd, i) => <th key={dd} className={`py-1 font-medium ${dd === h ? "text-navy" : ""}`}>{DIAS[i]} <span className="text-[10px] font-normal">{dd.slice(8, 10)}</span></th>)}<th className="py-1 text-right font-medium">Trabalhado × previsto</th></tr></thead>
        <tbody className="divide-y divide-line">{eq.map(e => { const t = tot(e.id); return <tr key={e.id}><td className="py-1 pr-2"><span className="text-ink">{e.nome}</span></td>
          {dias.map(dd => { const c = celula(rows.find(r => r.employee_id === e.id && r.data === dd), sensivel); return <td key={dd} className="py-1 text-center"><span title={c.title} className={`inline-grid h-6 w-7 place-items-center rounded text-[11px] font-semibold ${dd > h ? "text-slate-200" : c.c}`}>{dd > h ? "" : c.t}</span></td>; })}
          <td className={`py-1 text-right text-xs tabular-nums ${t.esp && t.trab - t.esp < -60 ? "text-aviso" : "text-slate-600"}`}>{t.esp ? `${fmtMin(t.trab).replace("+", "")} / ${fmtMin(t.esp).replace("+", "")}` : "—"}</td></tr>; })}</tbody></table></div>
      <p className="mt-2 text-[11px] text-slate-500">✓ verde: jornada cumprida · ✓ amarelo: trabalhou menos que o previsto · F: falta · J: ausência justificada · Fé/Fo: férias/folga · ·: espelho ainda não importado{semDado > 0 ? ` (${semDado} dia(s) sem marcação nesta semana)` : ""}. {faltas ? <b className="text-erro">{faltas} falta(s) na semana. </b> : null}Passe o mouse no dia para ver as horas.</p>
    </Card>
    <Card title="Horas extras aprovadas — 8 semanas">
      <Colunas rotulo="Horas extras aprovadas da equipe por semana" categorias={semanas.map(w => fmtData(w).slice(0, 5))} series={[{ nome: "Horas extras", valores: serie, cor: COR.acao }]} formato={v => `${Math.round(v)} h`} legenda={false} altura={170} />
      <div className="mt-2 flex flex-wrap gap-3 text-xs">{pend.banco > 0 ? <Link className="text-acao" href="/aprovacoes?aba=banco">{pend.banco} lançamento(s) do banco aguardando decisão</Link> : <span className="text-ok">Banco de horas sem pendência</span>}{pend.ferias > 0 ? <Link className="text-acao" href="/aprovacoes?aba=ferias">{pend.ferias} pedido(s) de férias/afastamento</Link> : null}{amplo && <Link className="text-acao" href="/ponto">Ponto da unidade</Link>}</div>
    </Card>
  </div>;
}
