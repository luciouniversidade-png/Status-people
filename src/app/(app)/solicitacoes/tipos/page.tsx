import { redirect } from "next/navigation";
import { requireSession, ROLE_LABEL } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Flash, Btn, Field, Input, Select, Textarea, Badge } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { camposTexto, etapasTexto, vePainel, type Campo, type Etapa } from "@/lib/solicitacoes";
import { salvarTipoSolicitacao } from "../actions";
import { SubNavSol } from "../_ui";

export const dynamic = "force-dynamic";
const PERFIS = ["DIRECAO", "RH", "DIRETOR_UNIDADE", "GESTOR", "COMERCIAL", "FINANCEIRO", "OPERACOES", "COLABORADOR"] as const;

export default async function TiposSolicitacao({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); if (!["DIRECAO", "RH"].includes(s.role)) redirect("/solicitacoes"); const sp = await searchParams;
  const tipos = await sql<{ id: number; codigo: string; nome: string; descricao: string | null; campos: Campo[]; etapas: Etapa[]; prazo_dias: number; perfis: string[] | null; ativo: boolean; usos: number }[]>`SELECT t.id, t.codigo, t.nome, t.descricao, t.campos, t.etapas, t.prazo_dias, t.perfis, t.ativo, (SELECT count(*) FROM requests r WHERE r.type_id=t.id)::int AS usos FROM request_types t ORDER BY t.ordem, t.nome`;
  const textos = await Promise.all(tipos.map(t => etapasTexto(t.etapas)));
  const Form = ({ t, et }: { t?: typeof tipos[number]; et?: string }) => <form action={salvarTipoSolicitacao} className="space-y-2">{t && <input type="hidden" name="id" value={t.id} />}
    <div className="grid grid-cols-2 gap-2"><Field label="Nome"><Input name="nome" required defaultValue={t?.nome ?? ""} /></Field>{!t && <Field label="Código (opcional)"><Input name="codigo" /></Field>}<Field label="Prazo por etapa (dias)"><Input name="prazoDias" type="number" min={1} max={30} defaultValue={t?.prazo_dias ?? 2} /></Field><Field label="Situação"><Select name="ativo" defaultValue={t && !t.ativo ? "0" : "1"}><option value="1">Ativo</option><option value="0">Inativo</option></Select></Field></div>
    <Field label="Descrição"><Input name="descricao" defaultValue={t?.descricao ?? ""} /></Field>
    <Field label="Campos — um por linha" hint="Rótulo | tipo (texto, texto longo, número, valor (R$), data, seleção, sim/não) | obrigatório (sim/não) | opções separadas por ;"><Textarea name="campos" required className="min-h-[110px] font-mono text-xs" defaultValue={t ? camposTexto(t.campos) : "Descrição | texto longo | sim\nValor (R$) | valor (R$) | sim"} /></Field>
    <Field label="Etapas de aprovação — uma por linha" hint="Nome | quem aprova (Direção, RH, Diretor de unidade, Coordenação, Financeiro, Operações, Secretaria ou e-mail) | acima de VALOR (opcional)"><Textarea name="etapas" required className="min-h-[80px] font-mono text-xs" defaultValue={et ?? "Diretor(a) da unidade | Diretor de unidade\nDireção | Direção | acima de 1000"} /></Field>
    <fieldset className="rounded border border-line p-2"><legend className="px-1 text-xs text-slate-600">Quem pode abrir (nenhum marcado = todos)</legend><div className="grid grid-cols-2 gap-1 text-xs">{PERFIS.map(p => <label key={p} className="flex items-center gap-1"><input type="checkbox" name="perfis" value={p} defaultChecked={!!t?.perfis?.includes(p)} />{ROLE_LABEL[p]}</label>)}</div></fieldset>
    <Btn small>Salvar tipo</Btn></form>;
  return (
    <Page title="Tipos de solicitação" sub="Formulário de cada pedido e as etapas de aprovação, com alçada por valor. Mudanças valem para as próximas solicitações.">
      <SubNavSol ativo="/solicitacoes/tipos" painel={vePainel(s)} config pendentes={0} />
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <div className="space-y-3">{tipos.map((t, i) => <Card key={t.id} className={!t.ativo ? "opacity-60" : ""} title={<span>{t.nome} <span className="font-normal text-slate-500">· {t.codigo}</span></span>} actions={<Modal label="Editar" title={t.nome}><Form t={t} et={textos[i]} /></Modal>}>
          <p className="text-xs text-slate-600">{t.descricao}</p>
          <div className="mt-2 text-xs"><b>Campos:</b> {t.campos.map(c => `${c.rotulo}${c.obrigatorio ? "" : " (opcional)"}`).join(" · ")}</div>
          <div className="mt-1 text-xs"><b>Aprovação:</b> {t.etapas.map(e => `${e.nome}${e.acimaDe ? ` (acima de R$ ${e.acimaDe.toLocaleString("pt-BR")})` : ""}`).join(" → ")} · prazo {t.prazo_dias} dia(s) por etapa</div>
          <div className="mt-1 flex flex-wrap gap-1 text-xs">{t.perfis?.length ? t.perfis.map(p => <Badge key={p} v="NEUTRO" label={ROLE_LABEL[p as keyof typeof ROLE_LABEL] ?? p} />) : <span className="text-slate-500">todos os perfis abrem</span>}<span className="text-slate-500">· {t.usos} solicitação(ões)</span></div>
        </Card>)}</div>
        <Card title="Novo tipo"><Form /></Card>
      </div>
    </Page>
  );
}
