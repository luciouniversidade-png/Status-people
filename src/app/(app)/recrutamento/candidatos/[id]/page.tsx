import Link from "@/components/Link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema, sql } from "@/db";
import { requireStaff } from "@/lib/auth";
import { Page, Card, Table, Td, Badge, Flash, Field, Input, Select, Textarea, Btn } from "@/components/ui";
import { fmtDataHora, getSettings } from "@/lib/utils";
import { ETAPA_LABEL, ORIGEM_CAND, REQ_STATUS } from "@/lib/talento";
import { salvarCandidato } from "../../../talento/actions";
import { PortalCandidato } from "./_portal";
import { VEREDITO_LABEL, faixaFit, type DetalheFit } from "@/lib/recrutamento-fit";
import { calcularAderencia } from "../../fit-actions";

export const dynamic = "force-dynamic";

export default async function Candidato({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaff(); const { id } = await params; const sp = await searchParams; const cid = Number(id); const cfg = await getSettings();
  const [c] = await db.select().from(schema.candidates).where(eq(schema.candidates.id, cid)); if (!c) notFound();
  const apps = await sql<{ id: number; vaga: string; requisition_id: number; rstatus: string; etapa: string; scorecard: Record<string, number> | null; notas: string | null; motivo: string | null; employee_id: number | null; updated_at: Date }[]>`SELECT a.id, r.titulo AS vaga, r.id AS requisition_id, r.status AS rstatus, a.etapa, a.scorecard, a.notas, a.motivo_reprovacao AS motivo, a.employee_id, a.updated_at FROM applications a JOIN requisitions r ON r.id=a.requisition_id WHERE a.candidate_id=${cid} ORDER BY a.updated_at DESC`;
  const gestao = ["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR"].includes(s.role);
  // v26 · aderência por candidatura, com os trechos que comprovam cada critério
  const fits = apps.length ? await sql<{ application_id: number; score: number; atende: number; total: number; obrigatorios_faltando: number; detalhes: DetalheFit[]; metodo: string; calculado_em: Date; mascarados: number }[]>`SELECT application_id, score, atende, total, obrigatorios_faltando, detalhes, metodo, calculado_em, mascarados FROM application_fit WHERE application_id = ANY(${apps.map(a => a.id)}::int[])` : [];
  return (
    <Page title={c.nome} sub={<span>{c.origem ? ORIGEM_CAND[c.origem] ?? c.origem : ""}{c.cidade ? ` · ${c.cidade}` : ""}{c.formacao ? ` · ${c.formacao}` : ""} · <Link className="text-acao" href="/recrutamento/candidatos">banco de talentos</Link></span>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <Card title="Candidaturas">
          <Table head={["Vaga", "Situação da vaga", "Etapa", "Scorecard", "Anotações", "Atualizada"]} empty="Sem candidaturas.">{apps.map(a => <tr key={a.id}><Td><Link className="text-acao" href={`/recrutamento/vagas/${a.requisition_id}`}>{a.vaga}</Link>{a.employee_id && <div className="text-xs"><Link className="text-ok" href={`/colaboradores/${a.employee_id}`}>contratado → ficha</Link></div>}</Td><Td className="text-xs">{REQ_STATUS[a.rstatus]}</Td><Td><Badge v={a.etapa === "CONTRATADO" ? "APROVADA" : a.etapa === "REPROVADO" ? "REJEITADA" : a.etapa === "DESISTIU" ? "CANCELADA" : "EM_ADMISSAO"} label={ETAPA_LABEL[a.etapa] ?? a.etapa} />{a.motivo && <div className="text-xs text-slate-500">{a.motivo}</div>}</Td><Td className="text-xs">{a.scorecard ? Object.entries(a.scorecard).map(([k, v]) => `${k}: ${v}`).join(" · ") : "—"}</Td><Td className="text-xs">{a.notas ?? "—"}</Td><Td className="text-xs">{fmtDataHora(a.updated_at)}</Td></tr>)}</Table>
        </Card>
        <Card title="Dados">{gestao ? <form action={salvarCandidato} className="space-y-2"><input type="hidden" name="id" value={cid} /><Field label="Nome"><Input name="nome" defaultValue={c.nome} required /></Field><div className="grid grid-cols-2 gap-2"><Field label="Telefone"><Input name="telefone" defaultValue={c.telefone ?? ""} /></Field><Field label="E-mail"><Input name="email" defaultValue={c.email ?? ""} /></Field></div><div className="grid grid-cols-2 gap-2"><Field label="Origem"><Select name="origem" defaultValue={c.origem ?? ""}>{cfg.recrutamento.origens.map(o => <option key={o} value={o}>{ORIGEM_CAND[o] ?? o}</option>)}</Select></Field><Field label="Cidade"><Input name="cidade" defaultValue={c.cidade ?? ""} /></Field></div><Field label="Formação"><Input name="formacao" defaultValue={c.formacao ?? ""} /></Field><Field label="Tags"><Input name="tags" defaultValue={c.tags ?? ""} /></Field><Field label="Currículo (link)"><Input name="curriculoLink" defaultValue={c.curriculoLink ?? ""} /></Field><Field label="Currículo em texto" hint="Base da aderência. Dados sensíveis são retirados antes da análise."><Textarea name="curriculoTexto" className="min-h-[110px]" defaultValue={c.curriculoTexto ?? ""} /></Field><Field label="Observações"><Textarea name="obs" className="min-h-[50px]" defaultValue={c.obs ?? ""} /></Field><label className="flex items-center gap-2 text-xs"><input type="checkbox" name="consentimentoLgpd" value="1" defaultChecked={c.consentimentoLgpd} /> Consentimento LGPD</label><Btn small>Salvar</Btn></form> : <p className="text-sm">{c.telefone} {c.email}</p>}</Card>
      </div>
      {apps.length > 0 && <Card className="mt-4" title="Aderência às vagas (sugestão do sistema — a decisão é humana)"><div className="space-y-3">{apps.map(a => { const f = fits.find(x => x.application_id === a.id); return <div key={a.id} className="rounded-md border border-line p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span><Link className="font-medium text-acao" href={`/recrutamento/vagas/${a.requisition_id}#aderencia`}>{a.vaga}</Link> · {f ? <b className="text-navy">{f.score}% · {faixaFit(f.score)}</b> : <span className="text-slate-500">não calculada</span>}{f && <span className="text-xs text-slate-500"> · {f.atende}/{f.total} critérios · {f.metodo === "IA" ? "IA (trechos conferidos)" : "regras"} · {fmtDataHora(f.calculado_em)}</span>}</span>
        {gestao && a.rstatus === "ABERTA" && !["REPROVADO", "DESISTIU", "CONTRATADO"].includes(a.etapa) && <form action={calcularAderencia}><input type="hidden" name="requisitionId" value={a.requisition_id} /><input type="hidden" name="applicationId" value={a.id} /><input type="hidden" name="candidateId" value={cid} /><input type="hidden" name="volta" value="candidato" /><input type="hidden" name="modo" value="REGRAS" /><Btn small kind="ghost">Recalcular</Btn></form>}</div>
        {f && <ul className="mt-2 space-y-1 text-xs">{f.detalhes.map(d => <li key={d.id}><span className={d.veredito === "ATENDE" ? "text-ok" : d.veredito === "PARCIAL" ? "text-aviso" : "text-slate-500"}>{VEREDITO_LABEL[d.veredito]}</span> — <b>{d.criterio}</b>{d.tipo === "DESEJAVEL" ? " (desejável)" : ""}{d.evidencia && <span className="italic text-slate-600"> · “{d.evidencia}” ({d.fonte})</span>}</li>)}</ul>}
        {f && f.mascarados > 0 && <p className="mt-1 text-[10px] text-slate-400">{f.mascarados} frase(s) com dado sensível retiradas antes da análise.</p>}</div>; })}</div></Card>}
      <PortalCandidato s={s} cid={cid} apps={apps.map(a => ({ id: a.id, vaga: a.vaga, etapa: a.etapa, requisition_id: a.requisition_id }))} />
    </Page>
  );
}
