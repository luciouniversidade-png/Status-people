import { is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import { requireStaff } from "@/lib/auth";
import { schema, sql } from "@/db";
import { Page, Card, Flash, Btn, Badge } from "@/components/ui";
import { fmtDataHora } from "@/lib/utils";
import { APP_VERSION, SCHEMA_VERSION } from "@/lib/versao";
import { atualizarBanco } from "./actions";

export const dynamic = "force-dynamic";
const AREAS: [RegExp, string][] = [
  [/^(perf_|eval_|pdi_|role_profile|dev_needs|teaching_|rater_|career_|review_raters|ai_drafts|feedbacks|behavior_profiles)/, "Desempenho e Painel do Colaborador"],
  [/^(announcement|message|notifications|attachments)/, "Comunicados, mensagens, anexos e notificações"],
  [/^ai_agents/, "Agentes de IA"], [/^(requisition|candidate|interview)/, "Recrutamento"], [/^(course|training|enroll|lesson)/, "Academy"],
  [/^(successor|critical_positions)/, "Sucessão"], [/^positions$/, "Cargos — usado por Configurações, Documentos, Recrutamento, Academy e Sucessão"],
  [/^documents$/, "Documentos"], [/^(settings|users|password_resets)$/, "Acesso e configurações"],
];
const area = (t: string) => AREAS.find(([r]) => r.test(t))?.[1] ?? "Sistema";

/** Diagnóstico do banco: compara o que o código espera (esquema) com o banco real e aplica as atualizações. Não depende de tabelas novas. */
export default async function Banco({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaff(); const sp = await searchParams; const pode = ["DIRECAO", "RH"].includes(s.role);
  if (!["DIRECAO", "RH", "LEITURA"].includes(s.role)) return <Page title="Banco de dados"><Card><p className="text-sm">Sem acesso.</p></Card></Page>;
  const esperado = (Object.values(schema) as unknown[]).filter(t => is(t, PgTable)).map(t => { const c = getTableConfig(t as PgTable); return { tabela: c.name, colunas: c.columns.map(x => x.name) }; });
  const reais = await sql<{ table_name: string; column_name: string }[]>`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema()`;
  const mapa = new Map<string, Set<string>>(); reais.forEach(r => { if (!mapa.has(r.table_name)) mapa.set(r.table_name, new Set()); mapa.get(r.table_name)!.add(r.column_name); });
  const faltaTabela = esperado.filter(t => !mapa.has(t.tabela));
  const faltaColuna = esperado.filter(t => mapa.has(t.tabela)).flatMap(t => t.colunas.filter(c => !mapa.get(t.tabela)!.has(c)).map(c => ({ tabela: t.tabela, coluna: c })));
  type Reg = { versao?: string; em?: string; aplicadas?: number; falhas?: { sql: string; erro: string }[] };
  const reg: Reg | null = await sql<{ value: Reg }[]>`SELECT value FROM settings WHERE key='banco'`.then(rows => rows[0]?.value ?? null).catch(() => null);
  const emDia = !faltaTabela.length && !faltaColuna.length && reg?.versao === SCHEMA_VERSION && !(reg?.falhas ?? []).length;
  const porArea = new Map<string, string[]>(); faltaTabela.forEach(t => porArea.set(area(t.tabela), [...(porArea.get(area(t.tabela)) ?? []), `tabela ${t.tabela}`])); faltaColuna.forEach(c => porArea.set(area(c.tabela), [...(porArea.get(area(c.tabela)) ?? []), `${c.tabela}.${c.coluna}`]));
  return (
    <Page title="Banco de dados" sub="Confere se o banco tem tudo o que esta versão do sistema usa e aplica as atualizações. Seguro repetir: nenhuma informação é apagada." actions={<Btn kind="ghost" href="/configuracoes">Configurações</Btn>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <Card className={`mb-4 ${emDia ? "border-emerald-200" : "border-amber-300"}`} title={<span className="flex items-center gap-2">{emDia ? <Badge v="APROVADA" label="Banco em dia" /> : <Badge v="PENDENTE" label="Atualização necessária" />}<span className="text-xs font-normal text-slate-500">Sistema {APP_VERSION} · esquema exigido {SCHEMA_VERSION}</span></span>}>
        <dl className="grid gap-2 text-sm sm:grid-cols-3"><div><dt className="text-xs text-slate-500">Esquema registrado no banco</dt><dd className="font-medium">{reg?.versao ?? "não registrado (anterior à v20.2)"}</dd></div><div><dt className="text-xs text-slate-500">Última atualização</dt><dd className="font-medium">{reg?.em ? fmtDataHora(reg.em) : "—"}</dd></div><div><dt className="text-xs text-slate-500">Itens que faltam no banco</dt><dd className="font-medium">{faltaTabela.length} tabela(s) · {faltaColuna.length} coluna(s)</dd></div></dl>
        {pode ? <form action={atualizarBanco} className="mt-3"><Btn>{emDia ? "Aplicar de novo (verificação)" : "Aplicar atualizações do banco"}</Btn></form> : <p className="mt-3 text-xs text-slate-500">Somente Direção ou RH aplicam atualizações.</p>}
        {!emDia && <p className="mt-2 text-xs text-slate-600">Enquanto o banco não for atualizado, as telas das áreas abaixo mostram erro. Isso acontece quando o código novo é publicado e a atualização do banco ainda não foi aplicada.</p>}
      </Card>
      {porArea.size > 0 && <Card className="mb-4" title="O que falta, por área">{[...porArea.entries()].map(([a, itens]) => <div key={a} className="mb-2 text-sm"><div className="font-medium text-navy">{a}</div><div className="text-xs text-slate-600">{itens.slice(0, 12).join(" · ")}{itens.length > 12 ? ` · +${itens.length - 12}` : ""}</div></div>)}</Card>}
      {(reg?.falhas ?? []).length > 0 && <Card title={`Pendências da última atualização (${reg!.falhas!.length})`}><p className="mb-2 text-xs text-slate-600">As demais instruções foram aplicadas. Estas precisam de ajuste nos dados antes de repetir — por exemplo, registros duplicados impedem criar um índice de unicidade. Envie esta lista ao suporte se não souber o que fazer.</p><ul className="space-y-2">{reg!.falhas!.map((f, i) => <li key={i} className="rounded-md border border-red-200 bg-red-50/40 p-2 text-xs"><div className="font-medium text-erro">{f.erro}</div><div className="mt-1 break-all font-mono text-[11px] text-slate-600">{f.sql}</div></li>)}</ul></Card>}
    </Page>
  );
}
