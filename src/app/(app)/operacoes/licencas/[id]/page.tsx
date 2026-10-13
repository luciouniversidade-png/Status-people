import Link from "@/components/Link";
import { notFound, redirect } from "next/navigation";
import { requireSession, scopeUnit } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Badge, Flash, Field, Btn, Input, Select, Textarea } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { fmtData } from "@/lib/utils";
import { situacaoLicenca, TIPO_LICENCA, LIC_SIT, podeLicencas, veLicencas, PERFIS_LICENCA } from "@/lib/contratos";
import { salvarLicenca, renovarLicenca } from "../../contratos/actions";
import { Anexos } from "@/components/Anexos";

export const dynamic = "force-dynamic";

export default async function Licenca({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); if (!veLicencas(s)) redirect(s.role === "COLABORADOR" ? "/solicitacoes" : "/operacoes"); const { id } = await params; const sp = await searchParams; const escopo = scopeUnit(s);
  const [l] = await sql<{ id: number; unit_id: number; unidade: string; tipo: string; nome: string | null; orgao: string | null; numero: string | null; emissao: string | null; validade: string | null; antecedencia_dias: number; responsavel_user_id: number | null; responsavel: string | null; status: string; obs: string | null; renovado_de: number | null; renovado_por: number | null }[]>`SELECT l.id, l.unit_id, u.nome AS unidade, l.tipo, l.nome, l.orgao, l.numero, l.emissao::text, l.validade::text, l.antecedencia_dias, l.responsavel_user_id, us.nome AS responsavel, l.status, l.obs, l.renovado_de, (SELECT id FROM licenses x WHERE x.renovado_de=l.id LIMIT 1) AS renovado_por FROM licenses l JOIN units u ON u.id=l.unit_id LEFT JOIN users us ON us.id=l.responsavel_user_id WHERE l.id=${Number(id)}`;
  if (!l || (escopo !== null && l.unit_id !== escopo)) notFound();
  const sit = l.status === "SUBSTITUIDA" ? null : situacaoLicenca(l); const pode = podeLicencas(s);
  const users = pode ? await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM users WHERE ativo AND role = ANY(${PERFIS_LICENCA}) ORDER BY nome` : [];
  return (
    <Page title={l.nome ?? TIPO_LICENCA[l.tipo]} sub={`${TIPO_LICENCA[l.tipo]} · ${l.unidade}`} actions={<Btn kind="ghost" href="/operacoes/licencas">Licenças</Btn>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="space-y-4">
          <Card title="Documento" actions={sit ? <Badge v={LIC_SIT[sit][0]} label={LIC_SIT[sit][1]} /> : <Badge v="CANCELADA" label="Substituído (histórico)" />}>
            <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2"><div><dt className="text-xs text-slate-500">Órgão · número</dt><dd>{l.orgao ?? "—"}{l.numero ? ` · ${l.numero}` : ""}</dd></div><div><dt className="text-xs text-slate-500">Emissão · validade</dt><dd>{fmtData(l.emissao)} · {l.validade ? fmtData(l.validade) : "sem validade"}</dd></div><div><dt className="text-xs text-slate-500">Aviso</dt><dd>{l.antecedencia_dias} dias antes</dd></div><div><dt className="text-xs text-slate-500">Responsável</dt><dd>{l.responsavel ?? "—"}</dd></div>
              <div><dt className="text-xs text-slate-500">Histórico</dt><dd>{l.renovado_de ? <Link className="text-acao" href={`/operacoes/licencas/${l.renovado_de}`}>documento anterior</Link> : "—"}{l.renovado_por ? <> · <Link className="text-acao" href={`/operacoes/licencas/${l.renovado_por}`}>versão atual</Link></> : null}</dd></div></dl>
            {l.obs && <p className="mt-3 whitespace-pre-wrap rounded bg-mist p-2 text-sm">{l.obs}</p>}
          </Card>
          <Anexos entidade="license" id={l.id} voltar={`/operacoes/licencas/${l.id}`} titulo="Evidência (documento, laudo, protocolo de renovação)" podeEnviar={pode && l.status !== "SUBSTITUIDA"} />
        </div>
        {pode && l.status === "ATIVA" && <div className="space-y-4">
          <Card title="Renovar"><form action={renovarLicenca} className="space-y-2"><input type="hidden" name="id" value={l.id} /><div className="grid grid-cols-2 gap-2"><Field label="Nova emissão"><Input name="emissao" type="date" /></Field><Field label="Nova validade"><Input name="validade" type="date" required /></Field></div><Field label="Novo número"><Input name="numero" /></Field><Field label="Observação"><Input name="obs" /></Field><Btn small>Registrar renovação</Btn></form></Card>
          <Card title="Editar"><Modal label="Editar dados" title={TIPO_LICENCA[l.tipo]}><form action={salvarLicenca} className="space-y-2"><input type="hidden" name="id" value={l.id} /><input type="hidden" name="unitId" value={l.unit_id} /><input type="hidden" name="tipo" value={l.tipo} />
            <div className="grid grid-cols-2 gap-2"><Field label="Órgão"><Input name="orgao" defaultValue={l.orgao ?? ""} /></Field><Field label="Número"><Input name="numero" defaultValue={l.numero ?? ""} /></Field><Field label="Emissão"><Input name="emissao" type="date" defaultValue={l.emissao ?? ""} /></Field><Field label="Validade"><Input name="validade" type="date" defaultValue={l.validade ?? ""} /></Field><Field label="Avisar com (dias)"><Input name="antecedenciaDias" type="number" defaultValue={l.antecedencia_dias} /></Field><Field label="Responsável"><Select name="responsavelUserId" defaultValue={l.responsavel_user_id ?? ""}><option value="">—</option>{users.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field></div>
            <Field label="Nome"><Input name="nome" defaultValue={l.nome ?? ""} /></Field><Field label="Observação"><Textarea name="obs" defaultValue={l.obs ?? ""} className="min-h-[40px]" /></Field><Btn small>Salvar</Btn></form></Modal></Card>
        </div>}
      </div>
    </Page>
  );
}
