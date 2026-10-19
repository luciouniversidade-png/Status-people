import Link from "@/components/Link";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, scopeUnit } from "@/lib/auth";
import { Page, Card, Flash, Stat, Table, Td, Btn, Field, Select, Input, Badge } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { Situacao } from "@/components/graficos";
import { painelAso, podeSst, TIPOS_ASO, RESULTADO_ASO, SITUACAO_ASO } from "@/lib/sst";
import { registrarAso, concluirAgendado, salvarPeriodicidade } from "./actions";
import { SstNav } from "./_nav";
import { fmtData, hoje, getSettings } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** T-101 · Exames ocupacionais (ASO): colaborador × exame exigido × validade, agenda do mês e pendências que travam a admissão. */
export default async function Sst({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); if (!podeSst(s)) redirect("/"); const sp = await searchParams; const u = scopeUnit(s);
  const cfg = await getSettings(); const h = hoje(); const filtro = sp.sit ?? "";
  const linhas = await painelAso(u); const lista = filtro ? linhas.filter(l => l.situacao === filtro) : linhas.filter(l => l.situacao !== "EM_DIA");
  const cont = (k: string) => linhas.filter(l => l.situacao === k).length;
  const agenda = await sql<{ id: number; nome: string; tipo: string; data: string; clinica: string | null }[]>`SELECT x.id, e.nome, x.tipo, x.data::text, x.clinica FROM sst_exams x JOIN employees e ON e.id=x.employee_id WHERE x.situacao='AGENDADO' AND x.data >= ${h}::date - 7 ${u === null ? sql`` : sql`AND e.unit_id=${u}`} ORDER BY x.data LIMIT 40`;
  const cargos = await sql<{ id: number; nome: string; aso_meses: number | null; n: number }[]>`SELECT p.id, p.nome, p.aso_meses, (SELECT count(*) FROM employees e WHERE e.position_id=p.id AND e.situacao <> 'DESLIGADO')::int AS n FROM positions p ORDER BY p.ordem, p.nome`;
  const voltar = `/sst${filtro ? `?sit=${filtro}` : ""}`;
  return (
    <Page title="Saúde e segurança do trabalho" sub="ASO por cargo com validade e agenda — sem dado clínico: só tipo, data, validade, aptidão e restrição administrativa. Acesso restrito ao RH e à Direção.">
      <Flash ok={sp.ok} erro={sp.erro} />
      <SstNav atual="/sst" />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {(["EM_DIA", "VENCENDO", "VENCIDO", "SEM_ADMISSIONAL", "RETORNO_PENDENTE", "SEM_REGISTRO"] as const).map(k => <Stat key={k} label={SITUACAO_ASO[k].rotulo} value={<span className={SITUACAO_ASO[k].tom === "ruim" && cont(k) ? "text-erro" : SITUACAO_ASO[k].tom === "atencao" && cont(k) ? "text-aviso" : ""}>{cont(k)}</span>} href={`/sst?sit=${k}`} />)}
      </div>
      {cont("SEM_REGISTRO") > 0 && <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{cont("SEM_REGISTRO")} pessoa(s) sem nenhum ASO no sistema. Registre o último exame de cada uma para a validade começar a ser acompanhada (a ausência não vira “em dia”).</p>}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:items-start">
        <Card title={filtro ? `${SITUACAO_ASO[filtro]?.rotulo ?? filtro} (${lista.length})` : `Pendências (${lista.length})`} className="xl:col-span-2" actions={filtro ? <Link href="/sst" className="text-xs text-acao">ver pendências</Link> : <Link href="/sst?sit=EM_DIA" className="text-xs text-acao">ver em dia</Link>}>
          <Table head={["Colaborador", "Cargo · unidade", "Situação", "Último exame", "Validade", ""]} empty="Nenhuma pendência de ASO.">
            {lista.map(l => <tr key={l.id}><Td><Link href={`/colaboradores/${l.id}`} className="text-acao">{l.nome}</Link></Td><Td className="text-xs">{l.cargo ?? "—"} · {l.unidade}<div className="text-[11px] text-slate-500">periódico a cada {l.meses} meses</div></Td><Td><Situacao tom={SITUACAO_ASO[l.situacao]?.tom ?? "neutro"} texto={SITUACAO_ASO[l.situacao]?.rotulo ?? l.situacao} />{l.agendado && <div className="text-[11px] text-acao">agendado {fmtData(l.agendado)}</div>}</Td><Td className="text-xs">{l.ultimo ? `${TIPOS_ASO[l.ultimo.tipo]} · ${fmtData(l.ultimo.data)} · ${RESULTADO_ASO[l.ultimo.resultado] ?? l.ultimo.resultado}` : "—"}</Td><Td className={`whitespace-nowrap text-xs ${l.validade && l.validade < h ? "text-erro" : ""}`}>{fmtData(l.validade)}</Td>
              <Td><Modal label="Registrar" kind="link" title={`ASO · ${l.nome}`}><form action={registrarAso} className="space-y-2"><input type="hidden" name="employeeId" value={l.id} /><input type="hidden" name="voltar" value={voltar} />
                <div className="grid grid-cols-2 gap-2"><Field label="Tipo"><Select name="tipo" defaultValue={l.situacao === "SEM_ADMISSIONAL" ? "ADMISSIONAL" : l.situacao === "RETORNO_PENDENTE" ? "RETORNO" : l.situacao === "DEMISSIONAL_PENDENTE" ? "DEMISSIONAL" : "PERIODICO"}>{Object.entries(TIPOS_ASO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field><Field label="Data"><Input type="date" name="data" defaultValue={h} required /></Field></div>
                <div className="grid grid-cols-2 gap-2"><Field label="Resultado"><Select name="resultado">{Object.entries(RESULTADO_ASO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field><Field label="Validade (opcional)" hint={`padrão: +${l.meses} meses`}><Input type="date" name="validade" /></Field></div>
                <Field label="Restrição administrativa (se houver)" hint="Ex.: não carregar peso. Nunca o diagnóstico."><Input name="restricao" /></Field><Field label="Clínica"><Input name="clinica" /></Field>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="agendado" value="1" /> É um agendamento (exame ainda não feito)</label><Btn small>Salvar</Btn></form></Modal></Td></tr>)}
          </Table>
        </Card>
        <div className="space-y-4">
          <Card title="Agenda de exames">{agenda.length === 0 ? <p className="text-sm text-slate-600">Nenhum exame agendado.</p> : <ul className="space-y-2 text-sm">{agenda.map(a => <li key={a.id} className="flex flex-wrap items-center gap-2"><b className="tabular-nums">{fmtData(a.data)}</b><span>{a.nome}</span><Badge v="ABERTO" label={TIPOS_ASO[a.tipo]} />{a.data <= h && <form action={concluirAgendado} className="ml-auto flex items-center gap-1"><input type="hidden" name="id" value={a.id} /><input type="hidden" name="voltar" value="/sst" /><Select name="resultado" className="h-8 text-xs">{Object.entries(RESULTADO_ASO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select><Btn small kind="ghost">Feito</Btn></form>}</li>)}</ul>}</Card>
          <Card title="Periodicidade por cargo"><div id="periodicidade" className="max-h-80 space-y-1 overflow-y-auto pr-1 text-sm">{cargos.filter(c => c.n > 0 || c.aso_meses).map(c => <form key={c.id} action={salvarPeriodicidade} className="flex items-center gap-2"><input type="hidden" name="positionId" value={c.id} /><span className="min-w-0 flex-1 truncate">{c.nome} <span className="text-[11px] text-slate-500">({c.n})</span></span><Input name="meses" type="number" min={6} max={36} defaultValue={c.aso_meses ?? ""} placeholder={String(cfg.sst.asoMesesPadrao)} className="h-8 w-20 text-xs" /><Btn small kind="ghost">ok</Btn></form>)}</div><p className="mt-2 text-[11px] text-slate-500">Vazio = padrão de {cfg.sst.asoMesesPadrao} meses. O PCMSO da escola prevalece: ajuste conforme o programa do médico do trabalho.</p></Card>
          <Card title="Regras"><ul className="list-disc space-y-1 pl-4 text-xs text-slate-600"><li>Admissão: o item “Exame admissional (ASO)” só conclui com o ASO apto registrado.</li><li>Afastamento por saúde de {cfg.sst.afastamentoRetornoDias} dias ou mais pede ASO de retorno.</li><li>Desligamento: demissional, ou exame nos últimos {cfg.sst.dispensaDemissionalDias} dias (NR-7).</li><li>Vencidos entram na Central de alertas só como contagem.</li></ul></Card>
        </div>
      </div>
    </Page>
  );
}
