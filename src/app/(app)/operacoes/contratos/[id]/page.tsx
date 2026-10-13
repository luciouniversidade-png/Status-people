import Link from "@/components/Link";
import { notFound, redirect } from "next/navigation";
import { requireSession, scopeUnit } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Badge, Flash, Field, Btn, Input, Select, Textarea } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { fmtData, getSettings, hoje, addDays } from "@/lib/utils";
import { brl } from "@/lib/operacoes";
import { situacaoContrato, RENOVACAO, CONTRATO_STATUS, podeContratos, veContratos, PERFIS_CONTRATO } from "@/lib/contratos";
import { renovarContrato, encerrarContrato } from "../actions";
import { FormContrato, type OpcoesContrato, type ContratoForm } from "../_form";
import { Anexos } from "@/components/Anexos";

export const dynamic = "force-dynamic";

export default async function Contrato({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); if (!veContratos(s)) redirect(s.role === "COLABORADOR" ? "/solicitacoes" : "/operacoes"); const { id } = await params; const sp = await searchParams; const cfg = await getSettings(); const escopo = scopeUnit(s);
  const [c] = await sql<(ContratoForm & { fornecedor: string; unidade: string | null; status: string; responsavel: string | null; renovado_de: number | null; renovado_por: number | null })[]>`SELECT c.id, c.supplier_id, c.unit_id, c.objeto, c.numero, c.valor_mensal::text, c.valor_total::text, c.inicio::text, c.fim::text, c.renovacao, c.aviso_previo_dias, c.reajuste_indice, c.proximo_reajuste::text, c.responsavel_user_id, c.obs, s.nome AS fornecedor, u.nome AS unidade, c.status, us.nome AS responsavel, c.renovado_de, (SELECT id FROM contracts x WHERE x.renovado_de=c.id LIMIT 1) AS renovado_por FROM contracts c JOIN suppliers s ON s.id=c.supplier_id LEFT JOIN units u ON u.id=c.unit_id LEFT JOIN users us ON us.id=c.responsavel_user_id WHERE c.id=${Number(id)}`;
  if (!c || (escopo !== null && c.unit_id !== null && c.unit_id !== escopo)) notFound();
  const sit = situacaoContrato(c, cfg.contratos.avisos as number[], hoje()); const pode = podeContratos(s) && (escopo === null || c.unit_id === escopo);
  const o: OpcoesContrato = { fornecedores: await sql`SELECT id, nome FROM suppliers WHERE ativo OR id=${c.supplier_id} ORDER BY nome`, units: await sql`SELECT id, nome FROM units ${escopo === null ? sql`` : sql`WHERE id=${escopo}`} ORDER BY nome`, users: await sql`SELECT id, nome FROM users WHERE ativo AND role = ANY(${PERFIS_CONTRATO}) ORDER BY nome`, podeRede: escopo === null && s.role !== "DIRETOR_UNIDADE" };
  return (
    <Page title={c.objeto} sub={`${c.fornecedor} · ${c.unidade ?? "rede"}${c.numero ? ` · contrato nº ${c.numero}` : ""}`} actions={<Btn kind="ghost" href="/operacoes/contratos">Contratos</Btn>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      {c.status === "VIGENTE" && sit.alertas.length > 0 && <Card className="mb-4 border-amber-300"><ul className="text-sm">{sit.alertas.map((a, i) => <li key={i} className={a.nivel === "ALTO" ? "font-medium text-erro" : "text-aviso"}>{a.texto}</li>)}</ul>{sit.limite && c.renovacao !== "SEM_RENOVACAO" && <p className="mt-1 text-xs text-slate-600">Para não renovar, avise o fornecedor até {fmtData(sit.limite)} ({c.aviso_previo_dias} dias antes do fim).</p>}</Card>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <div className="space-y-4">
          <Card title="Contrato" actions={<Badge v={c.status === "VIGENTE" ? "APROVADA" : "CANCELADA"} label={CONTRATO_STATUS[c.status]} />}>
            <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2"><div><dt className="text-xs text-slate-500">Vigência</dt><dd>{fmtData(c.inicio)} → {c.fim ? fmtData(c.fim) : "indeterminado"}</dd></div><div><dt className="text-xs text-slate-500">Renovação</dt><dd>{RENOVACAO[c.renovacao]} · aviso prévio {c.aviso_previo_dias} dias</dd></div><div><dt className="text-xs text-slate-500">Valores</dt><dd>{c.valor_mensal ? `${brl(c.valor_mensal)}/mês` : "—"}{c.valor_total ? ` · total ${brl(c.valor_total)}` : ""}</dd></div><div><dt className="text-xs text-slate-500">Reajuste</dt><dd>{c.reajuste_indice ?? "—"}{c.proximo_reajuste ? ` · próximo em ${fmtData(c.proximo_reajuste)}` : ""}</dd></div><div><dt className="text-xs text-slate-500">Responsável</dt><dd>{c.responsavel ?? "—"}</dd></div>
              <div><dt className="text-xs text-slate-500">Histórico</dt><dd>{c.renovado_de ? <Link className="text-acao" href={`/operacoes/contratos/${c.renovado_de}`}>período anterior</Link> : "—"}{c.renovado_por ? <> · <Link className="text-acao" href={`/operacoes/contratos/${c.renovado_por}`}>renovação</Link></> : null}</dd></div></dl>
            {c.obs && <p className="mt-3 whitespace-pre-wrap rounded bg-mist p-2 text-sm">{c.obs}</p>}
          </Card>
          <Anexos entidade="contract" id={c.id} voltar={`/operacoes/contratos/${c.id}`} titulo="Contrato assinado, aditivos e notificações" podeEnviar={pode} />
        </div>
        {pode && c.status === "VIGENTE" && <div className="space-y-4">
          <Card title="Renovar"><form action={renovarContrato} className="space-y-2"><input type="hidden" name="id" value={c.id} /><div className="grid grid-cols-2 gap-2"><Field label="Novo início"><Input name="inicio" type="date" defaultValue={c.fim ? addDays(c.fim, 1) : ""} /></Field><Field label="Novo fim"><Input name="fim" type="date" required /></Field><Field label="Novo valor mensal"><Input name="valorMensal" inputMode="decimal" defaultValue={c.valor_mensal ?? ""} /></Field><Field label="Próximo reajuste"><Input name="proximoReajuste" type="date" /></Field></div><Field label="Observação"><Input name="obs" /></Field><Btn small>Renovar contrato</Btn></form></Card>
          <Card title="Editar"><Modal label="Editar dados do contrato" title={c.objeto}><FormContrato o={o} c={c} /></Modal></Card>
          <Card title="Encerrar"><form action={encerrarContrato} className="space-y-2"><input type="hidden" name="id" value={c.id} /><Field label="Como"><Select name="status"><option value="ENCERRADO">Encerrado (fim/não renovado)</option><option value="CANCELADO">Cancelado (rescisão)</option></Select></Field><Field label="Motivo"><Textarea name="motivo" required className="min-h-[50px]" /></Field><Btn small danger>Encerrar</Btn></form></Card>
        </div>}
      </div>
    </Page>
  );
}
