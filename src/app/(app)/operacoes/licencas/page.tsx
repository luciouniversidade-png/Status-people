import { redirect } from "next/navigation";
import Link from "@/components/Link";
import { requireSession, scopeUnit } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Table, Td, Badge, Flash, Field, Btn, Input, Select, Textarea, Stat } from "@/components/ui";
import { fmtData } from "@/lib/utils";
import { painelLicencas, TIPO_LICENCA, MATRIZ_LICENCAS, LIC_SIT, podeLicencas, veLicencas, PERFIS_LICENCA } from "@/lib/contratos";
import { salvarLicenca } from "../contratos/actions";

export const dynamic = "force-dynamic";

export default async function Licencas({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); if (!veLicencas(s)) redirect(s.role === "COLABORADOR" ? "/solicitacoes" : "/operacoes"); const sp = await searchParams; const escopo = scopeUnit(s); const pode = podeLicencas(s);
  const [p, users] = await Promise.all([painelLicencas(escopo), sql<{ id: number; nome: string }[]>`SELECT id, nome FROM users WHERE ativo AND role = ANY(${PERFIS_LICENCA}) ORDER BY nome`]);
  const n = (k: string) => p.lista.filter(l => l.situacao === k).length; const lacunas = p.matriz.reduce((a, u) => a + Object.values(u.tipos).filter(t => t.situacao === "NAO_CADASTRADA").length, 0);
  return (
    <Page title="Licenças, alvarás e laudos" sub="Alvará, AVCB, licença sanitária, ato autorizativo e laudos de cada unidade, com validade, responsável, evidência anexada e alerta antes de vencer." actions={<Btn kind="ghost" href="/api/export/licencas">Exportar CSV</Btn>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4"><Stat label="Vencidas" value={<span className={n("VENCIDA") ? "text-erro" : ""}>{n("VENCIDA")}</span>} /><Stat label="Vencem em breve" value={<span className={n("VENCE") ? "text-aviso" : ""}>{n("VENCE")}</span>} /><Stat label="Em dia" value={n("EM_DIA")} /><Stat label="Não cadastradas (lacunas)" value={lacunas} /></div>
      <Card className="mb-4" title="Matriz por unidade">
        <Table head={["Documento", ...p.matriz.map(u => u.nome)]}>{MATRIZ_LICENCAS.map(t => <tr key={t}><Td className="text-xs font-medium">{TIPO_LICENCA[t]}</Td>{p.matriz.map(u => { const c = u.tipos[t]; const [tom, rot] = LIC_SIT[c.situacao]; return <Td key={u.id}>{c.id ? <Link href={`/operacoes/licencas/${c.id}`}><Badge v={tom} label={rot} /></Link> : <Badge v={tom} label={rot} />}</Td>; })}</tr>)}</Table>
      </Card>
      <div className={`grid grid-cols-1 gap-4 ${pode ? "lg:grid-cols-[minmax(0,1fr)_340px]" : ""} lg:items-start`}>
        <Table head={["Documento", "Unidade", "Validade", "Situação", "Evidência"]} empty="Nenhum documento cadastrado.">{p.lista.map(l => { const [tom, rot] = LIC_SIT[l.situacao]; return <tr key={l.id}><Td><Link className="text-acao" href={`/operacoes/licencas/${l.id}`}>{l.nome ?? TIPO_LICENCA[l.tipo]}</Link><div className="text-[11px] text-slate-500">{TIPO_LICENCA[l.tipo]}{l.orgao ? ` · ${l.orgao}` : ""}{l.responsavel ? ` · ${l.responsavel}` : ""}</div></Td><Td>{l.unidade}</Td><Td>{l.validade ? fmtData(l.validade) : "—"}</Td><Td><Badge v={tom} label={rot} /></Td><Td className={l.anexos ? "text-xs" : "text-xs text-aviso"}>{l.anexos ? `${l.anexos} anexo(s)` : l.status === "DISPENSADA" ? "—" : "sem anexo"}</Td></tr>; })}</Table>
        {pode && <Card title="Cadastrar documento">
          <form action={salvarLicenca} className="space-y-2">
            <div className="grid grid-cols-2 gap-2">{escopo === null ? <Field label="Unidade"><Select name="unitId" required>{p.units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field> : <input type="hidden" name="unitId" value={escopo} />}<Field label="Tipo"><Select name="tipo" required>{Object.entries(TIPO_LICENCA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
              <Field label="Órgão emissor"><Input name="orgao" placeholder="Prefeitura, CBMMS, Vigilância…" /></Field><Field label="Número"><Input name="numero" /></Field>
              <Field label="Emissão"><Input name="emissao" type="date" /></Field><Field label="Validade"><Input name="validade" type="date" /></Field>
              <Field label="Avisar com (dias)"><Input name="antecedenciaDias" type="number" min={1} max={365} defaultValue={60} /></Field><Field label="Responsável"><Select name="responsavelUserId"><option value="">—</option>{users.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field></div>
            <Field label="Nome (opcional)"><Input name="nome" /></Field><Field label="Observação"><Textarea name="obs" className="min-h-[40px]" /></Field>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="dispensar" value="1" /> Não se aplica a esta unidade (explique na observação)</label>
            <Btn small>Cadastrar</Btn></form></Card>}
      </div>
    </Page>
  );
}
