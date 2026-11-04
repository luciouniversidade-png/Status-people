// v31 · PDI — engajamento por liderança: para cada líder, quantos liderados aderiram ao PDI (plano ativo validado), quantos PDIs
// estão com ação atrasada e o progresso geral; abrindo o líder, a situação de cada liderado.
import Link from "@/components/Link";
import { redirect } from "next/navigation";
import { requireStaff, scopeUnit } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Stat, Field, Select, Btn, Badge } from "@/components/ui";
import { getSettings, hoje } from "@/lib/utils";
import { iniciais } from "@/lib/pessoas-v30";

export const dynamic = "force-dynamic";
type L = { gestor_id: number; gestor: string; unidade: string; employee_id: number; nome: string; cargo: string | null; validados: number; propostos: number; acoes: number; concluidas: number; atrasadas: number; a_validar: number };
const pctN = (a: number, b: number) => (b ? Math.round((100 * a) / b) : null);
const Barra = ({ p }: { p: number | null }) => <div className="flex items-center gap-2"><div className="h-1.5 w-24 overflow-hidden rounded bg-mist sm:w-32"><div className="h-1.5 rounded bg-navy" style={{ width: `${p ?? 0}%` }} /></div><span className="w-9 text-xs tabular-nums text-slate-600">{p === null ? "—" : `${p}%`}</span></div>;

export default async function PdiLideranca({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaff(); if (!["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR", "LEITURA"].includes(s.role)) redirect("/desempenho");
  const sp = await searchParams; const u = scopeUnit(s); const h = hoje(); const cfg = await getSettings(); const alvo = Number(cfg.desempenho.pdiAdesaoAlvo) || 80;
  const units = await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ORDER BY nome`; const fUn = u ?? (sp.unidade ? Number(sp.unidade) : null);
  const linhas = await sql<L[]>`SELECT g.id AS gestor_id, g.nome AS gestor, un.nome AS unidade, e.id AS employee_id, e.nome, p.nome AS cargo,
      (SELECT count(*) FROM pdi_plans x WHERE x.employee_id=e.id AND x.status='ATIVO' AND x.validado_em IS NOT NULL)::int AS validados,
      (SELECT count(*) FROM pdi_plans x WHERE x.employee_id=e.id AND x.status='ATIVO' AND x.validado_em IS NULL)::int AS propostos,
      (SELECT count(*) FROM pdi_actions a JOIN pdi_plans x ON x.id=a.plan_id WHERE x.employee_id=e.id AND x.status='ATIVO' AND a.status <> 'CANCELADA')::int AS acoes,
      (SELECT count(*) FROM pdi_actions a JOIN pdi_plans x ON x.id=a.plan_id WHERE x.employee_id=e.id AND x.status='ATIVO' AND a.status='CONCLUIDA')::int AS concluidas,
      (SELECT count(*) FROM pdi_actions a JOIN pdi_plans x ON x.id=a.plan_id WHERE x.employee_id=e.id AND x.status='ATIVO' AND a.status IN ('NAO_INICIADA','EM_ANDAMENTO') AND a.prazo < ${h})::int AS atrasadas,
      (SELECT count(*) FROM pdi_actions a JOIN pdi_plans x ON x.id=a.plan_id WHERE x.employee_id=e.id AND x.status='ATIVO' AND a.status='AGUARDANDO_VALIDACAO')::int AS a_validar
    FROM employees e JOIN employees g ON g.id=e.gestor_id JOIN units un ON un.id=g.unit_id LEFT JOIN positions p ON p.id=e.position_id
    WHERE e.situacao IN ('ATIVO','FERIAS','AFASTADO') AND g.situacao <> 'DESLIGADO' ${fUn === null ? sql`` : sql`AND g.unit_id=${fUn}`} ${s.role === "GESTOR" ? sql`AND g.id=${s.employeeId ?? -1}` : sql``}
    ORDER BY g.nome, e.nome`;
  const lideres = [...new Map(linhas.map(l => [l.gestor_id, { id: l.gestor_id, nome: l.gestor, unidade: l.unidade }])).values()].map(g => {
    const xs = linhas.filter(l => l.gestor_id === g.id); const aderiu = xs.filter(x => x.validados > 0); const comPdi = xs.filter(x => x.validados + x.propostos > 0);
    const atraso = comPdi.filter(x => x.atrasadas > 0); const acoes = xs.reduce((a, x) => a + x.acoes, 0), concl = xs.reduce((a, x) => a + x.concluidas, 0);
    return { ...g, xs, adesao: pctN(aderiu.length, xs.length), aderiram: aderiu.length, atraso: pctN(atraso.length, comPdi.length), comPdi: comPdi.length, comAtraso: atraso.length, progresso: pctN(concl, acoes), aValidar: xs.reduce((a, x) => a + x.a_validar, 0) + xs.reduce((a, x) => a + x.propostos, 0) };
  }).sort((a, b) => (a.adesao ?? -1) - (b.adesao ?? -1) || a.nome.localeCompare(b.nome));
  const tot = linhas.length; const ader = linhas.filter(x => x.validados > 0).length; const comPdi = linhas.filter(x => x.validados + x.propostos > 0); const atr = comPdi.filter(x => x.atrasadas > 0).length;
  const tAc = linhas.reduce((a, x) => a + x.acoes, 0), tCo = linhas.reduce((a, x) => a + x.concluidas, 0);
  return (
    <Page title="PDI — engajamento por liderança" sub={<>Quem já tem plano de desenvolvimento ativo, quais PDIs têm ação atrasada e como anda a execução, líder a líder. Abra o líder para ver cada liderado. <Link className="text-acao" href="/desempenho/lideranca">Liderança e encaminhamentos</Link></>}
      actions={u === null && s.role !== "GESTOR" ? <form className="flex items-end gap-1"><Field label="Unidade"><Select name="unidade" defaultValue={fUn ? String(fUn) : ""}><option value="">Rede</option>{units.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field><Btn small kind="ghost">Ver</Btn></form> : undefined}>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Adesão ao PDI" value={<span className={pctN(ader, tot) !== null && pctN(ader, tot)! >= alvo ? "text-ok" : "text-aviso"}>{pctN(ader, tot) === null ? "—" : `${pctN(ader, tot)}%`}</span>} hint={`${ader} de ${tot} liderados · alvo ${alvo}%`} />
        <Stat label="PDIs com atraso" value={<span className={atr ? "text-erro" : "text-ok"}>{pctN(atr, comPdi.length) === null ? "—" : `${pctN(atr, comPdi.length)}%`}</span>} hint={`${atr} de ${comPdi.length} com PDI`} />
        <Stat label="Progresso geral" value={pctN(tCo, tAc) === null ? "—" : `${pctN(tCo, tAc)}%`} hint={`${tCo} de ${tAc} ações concluídas`} />
        <Stat label="Para validar" value={linhas.reduce((a, x) => a + x.a_validar + x.propostos, 0)} hint="planos propostos e ações concluídas" />
      </div>
      <Card title={`Engajamento por liderança (${lideres.length} líder(es))`}>
        <div className="hidden grid-cols-[minmax(0,1fr)_9rem_9rem_10rem] gap-3 border-b border-line px-2 pb-1 text-xs font-medium text-slate-600 sm:grid"><span>Líderes</span><span>Adesão ao PDI</span><span>PDIs com atraso</span><span>Progresso geral</span></div>
        {lideres.length === 0 ? <p className="py-2 text-sm text-slate-500">Nenhum líder com equipe no seu escopo.</p> : lideres.map(g => <details key={g.id} className="group border-b border-line last:border-0" open={lideres.length === 1}>
          <summary className="grid cursor-pointer list-none grid-cols-1 gap-1 px-2 py-2 hover:bg-mist/60 sm:grid-cols-[minmax(0,1fr)_9rem_9rem_10rem] sm:items-center sm:gap-3">
            <span className="flex min-w-0 items-center gap-2"><span className="text-slate-400 transition group-open:rotate-90">›</span><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-mist text-[10px] font-semibold text-navy">{iniciais(g.nome)}</span><span className="min-w-0"><span className="block truncate font-medium text-ink">{g.nome}</span><span className="block text-[11px] text-slate-500">{g.unidade} · {g.xs.length} liderado(s)</span></span></span>
            <span className={`text-sm tabular-nums ${g.adesao !== null && g.adesao >= alvo ? "text-ok" : "text-aviso"}`}><span className="text-xs text-slate-500 sm:hidden">Adesão: </span>{g.adesao === null ? "—" : `${g.adesao}%`} <span className="text-[11px] text-slate-500">({g.aderiram}/{g.xs.length})</span></span>
            <span className={`text-sm tabular-nums ${g.comAtraso ? "text-erro" : "text-slate-600"}`}><span className="text-xs text-slate-500 sm:hidden">Com atraso: </span>{g.atraso === null ? "—" : `${g.atraso}%`} <span className="text-[11px] text-slate-500">({g.comAtraso}/{g.comPdi})</span></span>
            <Barra p={g.progresso} />
          </summary>
          <div className="mb-2 ml-2 overflow-x-auto rounded-md border border-line sm:ml-8"><table className="w-full min-w-[520px] text-sm"><thead className="bg-mist text-xs text-slate-600"><tr><th className="px-2 py-1.5 text-left font-medium">Liderados</th><th className="px-2 py-1.5 text-left font-medium">Aderiu</th><th className="px-2 py-1.5 text-left font-medium">Progresso geral</th><th className="px-2 py-1.5 text-left font-medium">Atenção</th></tr></thead>
            <tbody className="divide-y divide-line">{g.xs.map(x => <tr key={x.employee_id}><td className="px-2 py-1.5"><Link className="font-medium text-acao" href={`/colaboradores/${x.employee_id}/painel?aba=pdi`}>{x.nome}</Link><div className="text-[11px] text-slate-500">{x.cargo ?? "—"}</div></td>
              <td className="px-2 py-1.5">{x.validados > 0 ? <Badge v="APROVADA" label="Sim" /> : x.propostos > 0 ? <Badge v="PENDENTE" label="Proposto" /> : <Badge v="REJEITADA" label="Não" />}</td>
              <td className="px-2 py-1.5"><Barra p={pctN(x.concluidas, x.acoes)} /></td>
              <td className="px-2 py-1.5 text-xs">{x.atrasadas ? <span className="text-erro">{x.atrasadas} ação(ões) atrasada(s)</span> : null}{x.a_validar ? <span className="ml-1 text-aviso">{x.a_validar} a validar</span> : null}{x.propostos ? <span className="ml-1 text-aviso">plano aguardando validação</span> : null}{!x.atrasadas && !x.a_validar && !x.propostos && <span className="text-slate-400">—</span>}</td></tr>)}</tbody></table></div>
        </details>)}
        <p className="mt-2 text-[11px] text-slate-500">Aderiu = tem plano de desenvolvimento ativo e validado pelo gestor (proposto = o colaborador propôs e falta validar). PDI com atraso = alguma ação passou do prazo sem conclusão. Progresso geral = ações concluídas ÷ ações válidas (canceladas fora). Execução não é prova de desenvolvimento: aplicação e resultado ficam no painel de cada pessoa.</p>
      </Card>
    </Page>
  );
}
