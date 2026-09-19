import Link from "next/link";
import { requireStaff, scopeUnit } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Stat, Table, Td, Badge } from "@/components/ui";
import { fmtData, fmtDataHora, fmtMin, hoje, addDays } from "@/lib/utils";
import { feriasAVencer } from "@/lib/ferias";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const s = await requireStaff();
  const u = scopeUnit(s);
  const h = hoje(), em30 = addDays(h, 30);
  const uf = u === null ? sql`` : sql`AND e.unit_id = ${u}`;

  const [porUnidade, [tot], adm, desl, ferias, banco, docs, ult] = await Promise.all([
    sql<{ nome: string; ativos: number; em_admissao: number }[]>`SELECT u.nome, count(*) FILTER (WHERE e.situacao='ATIVO')::int AS ativos, count(*) FILTER (WHERE e.situacao='EM_ADMISSAO')::int AS em_admissao
      FROM units u LEFT JOIN employees e ON e.unit_id=u.id ${u === null ? sql`` : sql`AND u.id = ${u}`} GROUP BY u.id, u.nome ORDER BY u.nome`,
    sql<{ ativos: number; ferias: number; afastados: number }[]>`SELECT count(*) FILTER (WHERE e.situacao='ATIVO')::int AS ativos,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM leave_requests l WHERE l.employee_id=e.id AND l.status='APROVADA' AND l.tipo='FERIAS' AND l.inicio<=${h} AND l.fim>=${h}))::int AS ferias,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM leave_requests l WHERE l.employee_id=e.id AND l.status='APROVADA' AND l.tipo IN ('AFASTAMENTO_SAUDE','LICENCA') AND l.inicio<=${h} AND l.fim>=${h}))::int AS afastados
      FROM employees e WHERE e.situacao <> 'DESLIGADO' ${uf}`,
    sql<{ n: number }[]>`SELECT count(*)::int AS n FROM processes p JOIN employees e ON e.id=p.employee_id WHERE p.tipo='ADMISSAO' AND p.status='ABERTO' ${uf}`,
    sql<{ n: number }[]>`SELECT count(*)::int AS n FROM processes p JOIN employees e ON e.id=p.employee_id WHERE p.tipo='DESLIGAMENTO' AND p.status='ABERTO' ${uf}`,
    sql<{ id: number; nome: string; tipo: string; inicio: string; fim: string; dias: number }[]>`SELECT l.id, e.nome, l.tipo, l.inicio::text, l.fim::text, l.dias FROM leave_requests l JOIN employees e ON e.id=l.employee_id WHERE l.status='SOLICITADA' ${uf} ORDER BY l.inicio LIMIT 8`,
    sql<{ id: number; nome: string; saldo: number }[]>`SELECT e.id, e.nome, coalesce(sum(h.minutos),0)::int AS saldo FROM employees e JOIN hour_entries h ON h.employee_id=e.id AND h.status='APROVADO' WHERE e.situacao='ATIVO' ${uf} GROUP BY e.id, e.nome ORDER BY saldo ASC LIMIT 6`,
    sql<{ n: number }[]>`SELECT count(*)::int AS n FROM documents d JOIN employees e ON e.id=d.employee_id WHERE e.situacao<>'DESLIGADO' AND d.validade IS NOT NULL AND d.validade <= ${em30} ${uf}`,
    sql<{ at: Date; user_nome: string; acao: string; entidade: string; entidade_id: number }[]>`SELECT at, user_nome, acao, entidade, entidade_id FROM audit_log ORDER BY at DESC LIMIT 8`,
  ]);

  const alertasFerias = await feriasAVencer(u, 90);
  const mesAtual = Number(h.slice(5, 7));
  const [aniversariantes, tempoCasa] = await Promise.all([
    sql<{ id: number; nome: string; unidade: string; dia: number; idade: number }[]>`SELECT e.id, e.nome, u.nome AS unidade, extract(day FROM e.data_nascimento)::int AS dia, (extract(year FROM age(${h}::date, e.data_nascimento)))::int AS idade FROM employees e JOIN units u ON u.id=e.unit_id WHERE e.situacao='ATIVO' AND e.data_nascimento IS NOT NULL AND extract(month FROM e.data_nascimento)=${mesAtual} ${uf} ORDER BY dia, e.nome`,
    sql<{ id: number; nome: string; unidade: string; dia: number; anos: number }[]>`SELECT e.id, e.nome, u.nome AS unidade, extract(day FROM e.admissao)::int AS dia, (extract(year FROM ${h}::date) - extract(year FROM e.admissao))::int AS anos FROM employees e JOIN units u ON u.id=e.unit_id WHERE e.situacao='ATIVO' AND extract(month FROM e.admissao)=${mesAtual} AND extract(year FROM e.admissao) < extract(year FROM ${h}::date) ${uf} ORDER BY dia, e.nome`,
  ]);
  return (
    <Page title="Início" sub={u === null ? "Rede — quatro unidades" : porUnidade[0]?.nome}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Colaboradores ativos" value={tot.ativos} hint={`${tot.ferias} em férias · ${tot.afastados} afastados`} href="/colaboradores" />
        <Stat label="Admissões em andamento" value={adm[0].n} href="/processos?tipo=ADMISSAO" />
        <Stat label="Desligamentos em andamento" value={desl[0].n} href="/processos?tipo=DESLIGAMENTO" />
        <Stat label="Férias a vencer (90 dias)" value={<span className={alertasFerias.length ? "text-aviso" : ""}>{alertasFerias.length}</span>} hint="risco de férias em dobro" href="/ferias#vencendo" />
        <Stat label="Documentos vencendo em 30 dias" value={docs[0].n} href="/documentos" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2 lg:items-start">
        <Card title="Por unidade">
          <Table head={["Unidade", "Ativos", "Em admissão"]}>
            {porUnidade.map(r => <tr key={r.nome}><Td>{r.nome}</Td><Td>{r.ativos}</Td><Td>{r.em_admissao}</Td></tr>)}
          </Table>
        </Card>
        <Card title="Aguardando aprovação" actions={<Link href="/ferias" className="text-xs text-acao">Ver todas</Link>}>
          <Table head={["Colaborador", "Tipo", "Período", "Dias"]} empty="Nenhuma solicitação pendente.">
            {ferias.map(l => <tr key={l.id}><Td>{l.nome}</Td><Td><Badge v={l.tipo} label={l.tipo === "FERIAS" ? "Férias" : l.tipo === "AFASTAMENTO_SAUDE" ? "Afastamento" : l.tipo === "FOLGA_BANCO" ? "Folga" : "Licença/outro"} /></Td><Td>{fmtData(l.inicio)} – {fmtData(l.fim)}</Td><Td>{l.dias}</Td></tr>)}
          </Table>
        </Card>
        <Card title="Banco de horas — maiores débitos" actions={<Link href="/banco-de-horas" className="text-xs text-acao">Ver banco</Link>}>
          <Table head={["Colaborador", "Saldo"]} empty="Sem lançamentos aprovados.">
            {banco.map(b => <tr key={b.id}><Td><Link className="text-acao" href={`/colaboradores/${b.id}`}>{b.nome}</Link></Td><Td className={b.saldo < 0 ? "text-erro" : "text-ok"}>{fmtMin(b.saldo)}</Td></tr>)}
          </Table>
        </Card>
        <Card title="Datas do mês" >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className="mb-1 text-xs font-medium text-slate-600">Aniversariantes</div>
              {aniversariantes.length === 0 ? <div className="text-sm text-slate-500">Nenhum aniversário cadastrado neste mês.</div> : <ul className="space-y-0.5 text-sm">{aniversariantes.map(a => <li key={a.id}><span className="inline-block w-7 tabular-nums text-slate-500">{String(a.dia).padStart(2, "0")}</span><Link className="text-acao" href={`/colaboradores/${a.id}`}>{a.nome}</Link> <span className="text-xs text-slate-500">· {a.unidade}</span></li>)}</ul>}
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-slate-600">Tempo de casa</div>
              {tempoCasa.length === 0 ? <div className="text-sm text-slate-500">Nenhum aniversário de admissão neste mês.</div> : <ul className="space-y-0.5 text-sm">{tempoCasa.map(a => <li key={a.id}><span className="inline-block w-7 tabular-nums text-slate-500">{String(a.dia).padStart(2, "0")}</span><Link className="text-acao" href={`/colaboradores/${a.id}`}>{a.nome}</Link> <span className="text-xs text-slate-500">· {a.anos} {a.anos === 1 ? "ano" : "anos"}</span></li>)}</ul>}
            </div>
          </div>
        </Card>
        <Card title="Últimas ações registradas">
          <Table head={["Quando", "Quem", "Ação"]} empty="A trilha de auditoria começa com o primeiro registro.">
            {ult.map((a, i) => <tr key={i}><Td className="whitespace-nowrap text-slate-500">{fmtDataHora(a.at)}</Td><Td>{a.user_nome}</Td><Td>{a.acao} <span className="text-slate-500">{a.entidade}{a.entidade_id ? ` #${a.entidade_id}` : ""}</span></Td></tr>)}
          </Table>
        </Card>
      </div>
    </Page>
  );
}
