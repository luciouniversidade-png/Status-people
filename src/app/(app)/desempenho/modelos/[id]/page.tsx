import Link from "@/components/Link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireStaff } from "@/lib/auth";
import { Page, Card, Table, Td, Badge, Flash, Field, Input, Select, Textarea, Btn } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { FAMILIAS, EIXO_LABEL, ESCALA, type Criterio } from "@/lib/avaliacao";
import { salvarModelo, salvarCriterio, novaVersaoModelo } from "../../criterios-actions";

export const dynamic = "force-dynamic";

export default async function Modelo({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaff(); if (!["DIRECAO", "RH"].includes(s.role)) redirect("/desempenho"); const { id } = await params; const sp = await searchParams; const mid = Number(id);
  const [m] = await db.select().from(schema.evalModels).where(eq(schema.evalModels.id, mid)); if (!m) notFound(); const crit = m.criterios as Criterio[]; const congelado = !!m.congeladoEm;
  const CritForm = ({ c }: { c?: Criterio }) => <form action={salvarCriterio} className="space-y-2"><input type="hidden" name="modelId" value={mid} />{c && <input type="hidden" name="criterioId" value={c.id} />}
    <div className="grid grid-cols-[minmax(0,1fr)_150px_80px] gap-2"><Field label="Critério"><Input name="titulo" defaultValue={c?.titulo ?? ""} required /></Field><Field label="Eixo"><Select name="eixo" defaultValue={c?.eixo ?? "RESULTADOS"}>{Object.entries(EIXO_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field><Field label="Peso"><Input name="peso" type="number" step="0.5" min={0.5} defaultValue={c?.peso ?? 1} /></Field></div>
    <Field label="O que é avaliado (comportamento/entrega observável)"><Textarea name="descricao" className="min-h-[50px]" defaultValue={c?.descricao ?? ""} /></Field>
    <div className="text-xs font-medium text-slate-600">Rubrica por nível (o que caracteriza cada nota)</div>{[1, 2, 3, 4, 5].map(n => <Field key={n} label={`${n} · ${ESCALA[n]}`}><Input name={`n${n}`} defaultValue={c?.niveis?.[String(n)] ?? ""} /></Field>)}
    <Field label="Evidência esperada"><Input name="evidencia" defaultValue={c?.evidencia ?? ""} placeholder="Registros, relatórios, observações…" /></Field>
    <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="naPermitido" value="1" defaultChecked={c?.naPermitido ?? true} /> Permitir “não aplicável” (com justificativa e aprovação do RH)</label>
    <div className="flex gap-2"><Btn small>Salvar critério</Btn>{c && <Btn small kind="ghost" danger name="excluir" value="1">Excluir</Btn>}</div></form>;
  const soma = (e: string) => crit.filter(c => c.eixo === e).reduce((a, c) => a + c.peso, 0);
  return (
    <Page title={`${m.nome} · v${m.versao}`} sub={<span className="flex flex-wrap items-center gap-2"><Badge v={m.status === "ATIVO" ? "APROVADA" : m.status === "ARQUIVADO" ? "CANCELADA" : "EM_AQUISICAO"} label={m.status} />{congelado && <Badge v="ATIVO" label="congelado — em uso por ciclo" />}{FAMILIAS[m.familia]} · {m.notaComposta ? `nota composta ${m.pesoResultados}/${m.pesoAtitudes}` : "perfil por eixo (sem nota composta)"} · cobertura mínima {m.coberturaMinima}% · <Link className="text-acao" href="/desempenho/modelos">modelos</Link></span>} actions={<form action={novaVersaoModelo}><input type="hidden" name="modelId" value={mid} /><Btn kind="ghost">Criar nova versão</Btn></form>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      {congelado && <Card className="mb-4 border-amber-200"><p className="text-sm">Este modelo está congelado porque um ciclo o utiliza: critérios, rubricas e pesos não mudam mais. Para evoluir, crie uma nova versão — os ciclos antigos continuam com esta.</p></Card>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <div className="space-y-4">{(["RESULTADOS", "ATITUDES", "TECNICA"] as const).map(e => <Card key={e} title={`${EIXO_LABEL[e]} (${crit.filter(c => c.eixo === e).length} critério(s) · peso total ${soma(e)})${e === "TECNICA" ? " — orienta o PDI, fora do cálculo" : ""}`}>
          <Table head={["Critério", "Peso", "Rubrica (1 · 3 · 5)", "Evidência", "N/A", ""]} empty="Nenhum critério neste eixo.">{crit.filter(c => c.eixo === e).map(c => <tr key={c.id}><Td><div className="font-medium">{c.titulo}</div><div className="text-xs text-slate-600">{c.descricao}</div></Td><Td>{c.peso}</Td><Td className="text-xs text-slate-600">{[1, 3, 5].map(n => c.niveis?.[String(n)] ? <div key={n}><b>{n}</b> {c.niveis[String(n)]}</div> : null)}</Td><Td className="text-xs">{c.evidencia ?? "—"}</Td><Td className="text-xs">{c.naPermitido ? "sim" : "não"}</Td><Td>{!congelado && <Modal label="Editar" kind="link"><CritForm c={c} /></Modal>}</Td></tr>)}</Table></Card>)}</div>
        <div className="space-y-4">{!congelado && <Card title="Novo critério"><CritForm /></Card>}
          <Card title="Modelo"><form action={salvarModelo} className="space-y-2"><input type="hidden" name="id" value={mid} /><Field label="Nome"><Input name="nome" defaultValue={m.nome} required /></Field><Field label="Família"><Select name="familia" defaultValue={m.familia}>{Object.entries(FAMILIAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field><div className="grid grid-cols-2 gap-2"><Field label="Peso Resultados"><Input name="pesoResultados" type="number" defaultValue={m.pesoResultados} disabled={congelado} /></Field><Field label="Peso Atitudes"><Input name="pesoAtitudes" type="number" defaultValue={m.pesoAtitudes} disabled={congelado} /></Field></div><Field label="Cobertura mínima por eixo (%)"><Input name="coberturaMinima" type="number" defaultValue={m.coberturaMinima} disabled={congelado} /></Field><label className="flex items-center gap-2 text-xs"><input type="checkbox" name="notaComposta" value="1" defaultChecked={m.notaComposta} disabled={congelado} /> Nota composta habilitada</label><Field label="Finalidade da nota composta"><Textarea name="finalidade" className="min-h-[40px]" defaultValue={m.finalidade ?? ""} disabled={congelado} /></Field><div className="grid grid-cols-2 gap-2"><Field label="Faixas da matriz (3 limites)"><Input name="faixasMatriz" defaultValue={((m.faixas as { matriz?: number[] } | null)?.matriz ?? [2, 3, 4]).join(" / ")} disabled={congelado} /></Field><Field label="Faixas da nota final (2 limites)"><Input name="faixasFinal" defaultValue={((m.faixas as { final?: number[] } | null)?.final ?? [3, 4]).join(" / ")} disabled={congelado} /></Field></div><Field label="Situação"><Select name="status" defaultValue={m.status}><option value="RASCUNHO">Rascunho</option><option value="ATIVO">Ativo (aprovado para ciclos)</option><option value="ARQUIVADO">Arquivado</option></Select></Field><Btn small kind="ghost" >Salvar</Btn></form></Card></div>
      </div>
    </Page>
  );
}
