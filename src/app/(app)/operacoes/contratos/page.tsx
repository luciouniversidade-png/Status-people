import { redirect } from "next/navigation";
import Link from "@/components/Link";
import { requireSession, scopeUnit } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Table, Td, Badge, Flash, Field, Btn, Select, Stat } from "@/components/ui";
import { fmtData, getSettings, hoje } from "@/lib/utils";
import { brl } from "@/lib/operacoes";
import { situacaoContrato, RENOVACAO, CONTRATO_STATUS, podeContratos, veContratos, PERFIS_CONTRATO } from "@/lib/contratos";
import { FormContrato, type OpcoesContrato } from "./_form";

export const dynamic = "force-dynamic";

export default async function Contratos({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); if (!veContratos(s)) redirect(s.role === "COLABORADOR" ? "/solicitacoes" : "/operacoes"); const sp = await searchParams; const cfg = await getSettings(); const escopo = scopeUnit(s); const h = hoje(); const pode = podeContratos(s);
  const st = sp.status ?? "VIGENTE";
  const rows = await sql<{ id: number; objeto: string; numero: string | null; fornecedor: string; unidade: string | null; inicio: string; fim: string | null; renovacao: string; aviso_previo_dias: number; proximo_reajuste: string | null; status: string; valor_mensal: string | null; responsavel: string | null; anexos: number }[]>`SELECT c.id, c.objeto, c.numero, s.nome AS fornecedor, u.nome AS unidade, c.inicio::text, c.fim::text, c.renovacao, c.aviso_previo_dias, c.proximo_reajuste::text, c.status, c.valor_mensal::text, us.nome AS responsavel, (SELECT count(*) FROM attachments a WHERE a.entidade='contract' AND a.entidade_id=c.id)::int AS anexos FROM contracts c JOIN suppliers s ON s.id=c.supplier_id LEFT JOIN units u ON u.id=c.unit_id LEFT JOIN users us ON us.id=c.responsavel_user_id WHERE ${st === "TODOS" ? sql`true` : sql`c.status=${st}`} ${escopo === null ? sql`` : sql`AND (c.unit_id IS NULL OR c.unit_id=${escopo})`} ORDER BY c.fim NULLS LAST, c.objeto`;
  const lista = rows.map(r => ({ ...r, sit: situacaoContrato(r, cfg.contratos.avisos as number[], h) }));
  const o: OpcoesContrato = { fornecedores: await sql`SELECT id, nome FROM suppliers WHERE ativo ORDER BY nome`, units: await sql`SELECT id, nome FROM units ${escopo === null ? sql`` : sql`WHERE id=${escopo}`} ORDER BY nome`, users: await sql`SELECT id, nome FROM users WHERE ativo AND role = ANY(${PERFIS_CONTRATO}) ORDER BY nome`, podeRede: escopo === null && s.role !== "DIRETOR_UNIDADE" };
  const vig = lista.filter(r => r.status === "VIGENTE"); const mensal = vig.reduce((a, r) => a + Number(r.valor_mensal ?? 0), 0);
  return (
    <Page title="Contratos de fornecedores" sub={`Vigência, renovação, aviso prévio e reajuste de cada contrato, com alerta aos ${(cfg.contratos.avisos as number[]).join(" e ")} dias do fim e no prazo para avisar a não renovação. Contrato assinado: anexe no contrato.`} actions={<Btn kind="ghost" href="/api/export/contratos">Exportar CSV</Btn>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4"><Stat label="Contratos vigentes" value={vig.length} /><Stat label="Valor mensal comprometido" value={brl(mensal)} /><Stat label="Pedem decisão" value={<span className={vig.some(r => r.sit.alertas.some(a => a.nivel === "ALTO")) ? "text-erro" : ""}>{vig.filter(r => r.sit.alertas.length).length}</span>} /><Stat label="Vencidos sem decisão" value={<span className={vig.some(r => r.sit.chave === "VENCIDO") ? "text-erro" : ""}>{vig.filter(r => r.sit.chave === "VENCIDO").length}</span>} /></div>
      <form className="mb-3 flex flex-wrap items-end gap-2"><Field label="Situação"><Select name="status" defaultValue={st}><option value="VIGENTE">Vigentes</option><option value="ENCERRADO">Encerrados</option><option value="CANCELADO">Cancelados</option><option value="TODOS">Todos</option></Select></Field><Btn kind="ghost">Filtrar</Btn></form>
      <div className={`grid grid-cols-1 gap-4 ${pode ? "lg:grid-cols-[minmax(0,1fr)_360px]" : ""} lg:items-start`}>
        <Table head={["Contrato", "Vigência", "Valor", "Situação"]} empty="Nenhum contrato.">{lista.map(r => <tr key={r.id}><Td><Link className="font-medium text-acao" href={`/operacoes/contratos/${r.id}`}>{r.objeto}</Link><div className="text-[11px] text-slate-500">{r.fornecedor} · {r.unidade ?? "rede"}{r.numero ? ` · nº ${r.numero}` : ""}{r.anexos ? ` · ${r.anexos} anexo(s)` : " · sem anexo"}</div></Td>
          <Td className="whitespace-nowrap text-xs">{fmtData(r.inicio)} → {r.fim ? fmtData(r.fim) : "indeterminado"}<div className="text-slate-500">{RENOVACAO[r.renovacao]}</div></Td><Td className="text-xs">{r.valor_mensal ? `${brl(r.valor_mensal)}/mês` : "—"}</Td>
          <Td>{r.status !== "VIGENTE" ? <Badge v="CANCELADA" label={CONTRATO_STATUS[r.status]} /> : r.sit.alertas.length ? r.sit.alertas.map((a, i) => <div key={i} className={`text-xs ${a.nivel === "ALTO" ? "font-medium text-erro" : "text-aviso"}`}>{a.texto}</div>) : <Badge v="APROVADA" label="Em dia" />}</Td></tr>)}</Table>
        {pode && <Card title="Novo contrato">{o.fornecedores.length ? <FormContrato o={o} /> : <p className="text-sm text-slate-600">Cadastre o fornecedor primeiro em <Link className="text-acao underline" href="/operacoes/fornecedores">Fornecedores</Link>.</p>}</Card>}
      </div>
    </Page>
  );
}
