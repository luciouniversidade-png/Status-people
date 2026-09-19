import Link from "next/link";
import { requireStaff, scopeUnit } from "@/lib/auth";
import { db, schema, sql } from "@/db";
import { asc } from "drizzle-orm";
import { Page, Card, Table, Td, Badge, Flash, Field, Input, Select, Textarea, Btn } from "@/components/ui";
import { getSettings } from "@/lib/utils";
import { okrs, OBJ_STATUS } from "@/lib/estrategia";
import { salvarObjetivo } from "../actions";

export const dynamic = "force-dynamic";

export default async function OKRs({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaff(); const sp = await searchParams; const cfg = await getSettings(); const u = scopeUnit(s); const ciclo = sp.ciclo ?? cfg.estrategia.cicloAtual;
  const [ok, units, users, ciclos] = await Promise.all([okrs(ciclo, u), db.select().from(schema.units).orderBy(asc(schema.units.nome)), sql<{ id: number; nome: string }[]>`SELECT id, nome FROM users WHERE ativo AND role <> 'LEITURA' ORDER BY nome`, sql<{ ciclo: string }[]>`SELECT DISTINCT ciclo FROM objectives ORDER BY ciclo DESC`]);
  const pode = ["DIRECAO", "RH", "DIRETOR_UNIDADE"].includes(s.role);
  return (
    <Page title={`OKRs ${ciclo}`} sub="Objetivo = onde queremos chegar. Resultado-chave = como saberemos que chegamos, com número. KRs ligados ao sistema se atualizam sozinhos." actions={<Btn kind="ghost" href="/estrategia">Painel</Btn>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <form className="mb-3 flex items-end gap-2"><Field label="Ciclo"><Select name="ciclo" defaultValue={ciclo}>{[...new Set([ciclo, cfg.estrategia.cicloAtual, ...ciclos.map(c => c.ciclo)])].map(c => <option key={c}>{c}</option>)}</Select></Field><Btn kind="ghost">Ver</Btn></form>
      <div className={`grid gap-4 ${pode ? "lg:grid-cols-[1fr_340px]" : ""} lg:items-start`}>
        <Table head={["Objetivo", "Pilar", "Dono", "Abrangência", "KRs", "Projetos", "Progresso", "Situação"]} empty="Nenhum objetivo neste ciclo.">{ok.objetivos.map(o => <tr key={o.id}><Td><Link className="font-medium text-acao" href={`/estrategia/okrs/${o.id}`}>{o.titulo}</Link>{o.descricao && <div className="text-xs text-slate-500">{o.descricao}</div>}</Td><Td className="text-xs">{o.pilar ?? "—"}</Td><Td className="text-xs">{o.owner ?? "—"}</Td><Td className="text-xs">{o.unidade ?? "rede"}</Td><Td>{o.krs.length}</Td><Td>{o.projetos || "—"}</Td><Td className={`font-semibold tabular-nums ${o.progresso === null ? "text-slate-400" : o.progresso >= 70 ? "text-ok" : o.progresso >= 40 ? "text-aviso" : "text-erro"}`}>{o.progresso === null ? "—" : `${o.progresso}%`}</Td><Td><Badge v={o.status === "CONCLUIDO" ? "APROVADA" : o.status === "CANCELADO" ? "CANCELADA" : "EM_ADMISSAO"} label={OBJ_STATUS[o.status]} /></Td></tr>)}</Table>
        {pode && <Card title="Novo objetivo"><form action={salvarObjetivo} className="space-y-2"><Field label="Ciclo"><Input name="ciclo" defaultValue={ciclo} /></Field><Field label="Objetivo"><Input name="titulo" required placeholder="Ex.: Encher as salas de 2027 com as famílias certas" /></Field><Field label="Por que importa"><Textarea name="descricao" className="min-h-[50px]" /></Field><div className="grid grid-cols-2 gap-2"><Field label="Pilar"><Select name="pilar">{cfg.estrategia.pilares.map(p => <option key={p}>{p}</option>)}</Select></Field><Field label="Abrangência"><Select name="unitId" defaultValue={u ?? ""}>{u === null && <option value="">Rede</option>}{units.filter(x => u === null || x.id === u).map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field></div><Field label="Dono"><Select name="ownerUserId" defaultValue={s.id}>{users.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field><Btn small>Criar objetivo</Btn><p className="text-xs text-slate-500">Depois, adicione 2 a 4 resultados-chave na página do objetivo.</p></form></Card>}
      </div>
    </Page>
  );
}
