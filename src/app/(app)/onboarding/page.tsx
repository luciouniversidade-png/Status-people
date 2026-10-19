import Link from "@/components/Link";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, scopeUnit } from "@/lib/auth";
import { Page, Card, Flash, Stat, Table, Td, Badge, Btn } from "@/components/ui";
import { BarrasH, COR } from "@/components/graficos";
import { planosOnboarding } from "@/lib/onboarding";
import { gerarPlanos, criarPlano } from "./actions";
import { fmtData, hoje, addDays } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** T-072 · Onboarding 30-60-90: plano por pessoa com % e atraso, marcos 7/30/60/90, buddy e pesquisa do novato. */
export default async function Onboarding({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const sp = await searchParams;
  if (s.role === "COLABORADOR") { const [p] = s.employeeId ? await sql<{ id: number }[]>`SELECT id FROM onboarding_plans WHERE employee_id=${s.employeeId} OR buddy_employee_id=${s.employeeId} ORDER BY (employee_id=${s.employeeId}) DESC LIMIT 1` : []; redirect(p ? `/onboarding/${p.id}` : "/"); }
  if (!["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR", "LEITURA"].includes(s.role)) redirect("/");
  const u = scopeUnit(s); const todos = sp.todos === "1"; const h = hoje();
  const planos = await planosOnboarding(u, todos);
  const semPlano = await sql<{ id: number; nome: string; admissao: string }[]>`SELECT e.id, e.nome, e.admissao::text FROM employees e WHERE e.situacao IN ('ATIVO','EM_ADMISSAO') AND e.admissao >= ${addDays(h, -90)} ${u === null ? sql`` : sql`AND e.unit_id=${u}`} AND NOT EXISTS (SELECT 1 FROM onboarding_plans p WHERE p.employee_id=e.id) ORDER BY e.admissao DESC`;
  const ativos = planos.filter(p => p.status === "EM_ANDAMENTO"); const atrasados = ativos.filter(p => p.atrasados > 0);
  const porArea = [...new Set(ativos.map(p => p.area ?? "Sem área"))].map(a => { const xs = ativos.filter(p => (p.area ?? "Sem área") === a); const tot = xs.reduce((x, p) => x + p.total, 0), ok = xs.reduce((x, p) => x + p.ok, 0); return { a, pct: tot ? Math.round((100 * ok) / tot) : null, atr: xs.reduce((x, p) => x + p.atrasados, 0), n: xs.length }; });
  const notas = ativos.map(p => p.nota_media).filter((x): x is number => x !== null);
  const pode = ["RH", "DIRECAO", "DIRETOR_UNIDADE"].includes(s.role);
  return (
    <Page title="Onboarding 30-60-90" sub="Integração com plano por pessoa: marcos de 7, 30, 60 e 90 dias, buddy, trilha obrigatória e a pesquisa do novato — o atraso aparece antes de virar frustração."
      actions={pode ? <form action={gerarPlanos}><input type="hidden" name="voltar" value="/onboarding" /><Btn small kind="ghost">Gerar planos dos admitidos recentes</Btn></form> : undefined}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="Planos em andamento" value={ativos.length} />
        <Stat label="Com marco atrasado" value={<span className={atrasados.length ? "text-erro" : "text-ok"}>{atrasados.length}</span>} hint="RH intervém nos atrasados" />
        <Stat label="Admitidos sem plano (90 dias)" value={<span className={semPlano.length ? "text-aviso" : ""}>{semPlano.length}</span>} />
        <Stat label="Experiência do novato" value={notas.length ? `${(notas.reduce((a, b) => a + b, 0) / notas.length).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}/5` : "—"} hint="média das pesquisas de 30 e 90 dias" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-start">
        <Card title="Planos" className="lg:col-span-2" actions={<Link href={todos ? "/onboarding" : "/onboarding?todos=1"} className="text-xs text-acao">{todos ? "só em andamento" : "incluir concluídos"}</Link>}>
          <Table head={["Novato", "Cargo · unidade", "Início", "Progresso", "Atraso", "Próximo marco", "Buddy"]} empty="Nenhum plano. Gere os planos dos admitidos recentes.">
            {planos.map(p => <tr key={p.id}><Td><Link href={`/onboarding/${p.id}`} className="font-medium text-acao">{p.nome}</Link>{p.status === "CONCLUIDO" && <div><Badge v="APROVADA" label="concluído" /></div>}</Td><Td className="text-xs">{p.cargo ?? "—"} · {p.unidade}</Td><Td className="whitespace-nowrap text-xs">{fmtData(p.inicio)}</Td>
              <Td><div className="flex items-center gap-2"><div className="h-2 w-20 rounded bg-mist"><div className="h-2 rounded" style={{ width: `${p.total ? (100 * p.ok) / p.total : 0}%`, background: p.atrasados ? COR.erro : COR.ok }} /></div><span className="text-xs tabular-nums">{p.total ? Math.round((100 * p.ok) / p.total) : 0}%</span></div></Td>
              <Td>{p.atrasados ? <Badge v="REJEITADA" label={`${p.atrasados} atrasado(s)`} /> : <span className="text-xs text-slate-400">—</span>}</Td><Td className="text-xs">{p.proximo_prazo ? <>{fmtData(p.proximo_prazo)} · {p.proximo_titulo}</> : "—"}</Td><Td className="text-xs">{p.buddy ?? <span className="text-aviso">definir</span>}</Td></tr>)}
          </Table>
        </Card>
        <div className="space-y-4">
          <Card title="Por área"><BarrasH rotulo="Progresso médio por área" itens={porArea.map(x => ({ rotulo: x.a, valor: x.pct, sub: `${x.n} novato(s)${x.atr ? ` · ${x.atr} atrasado(s)` : ""}`, cor: x.atr ? COR.aviso : COR.ok }))} formato={v => `${v}%`} max={100} /></Card>
          {pode && semPlano.length > 0 && <Card title="Admitidos sem plano"><ul className="space-y-2 text-sm">{semPlano.slice(0, 10).map(e => <li key={e.id} className="flex items-center justify-between gap-2"><span>{e.nome}<span className="block text-[11px] text-slate-500">admissão {fmtData(e.admissao)}</span></span><form action={criarPlano}><input type="hidden" name="employeeId" value={e.id} /><Btn small kind="ghost">Criar plano</Btn></form></li>)}</ul></Card>}
          <Card title="Como funciona"><ul className="list-disc space-y-1 pl-4 text-xs text-slate-600"><li>O plano nasce do modelo em Configurações (onboarding) quando a admissão é concluída.</li><li>Cada marco tem responsável: RH, gestor, buddy ou o próprio novato.</li><li>Marco vencido entra na Central de alertas e o responsável recebe o lembrete.</li><li>A pesquisa do novato (30 e 90 dias) é vista só pelo RH e pela Direção.</li></ul></Card>
        </div>
      </div>
    </Page>
  );
}
