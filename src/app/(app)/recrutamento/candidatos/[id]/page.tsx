import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema, sql } from "@/db";
import { requireStaff } from "@/lib/auth";
import { Page, Card, Table, Td, Badge, Flash, Field, Input, Select, Textarea, Btn } from "@/components/ui";
import { fmtDataHora, getSettings } from "@/lib/utils";
import { ETAPA_LABEL, ORIGEM_CAND, REQ_STATUS } from "@/lib/talento";
import { salvarCandidato } from "../../../talento/actions";

export const dynamic = "force-dynamic";

export default async function Candidato({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaff(); const { id } = await params; const sp = await searchParams; const cid = Number(id); const cfg = await getSettings();
  const [c] = await db.select().from(schema.candidates).where(eq(schema.candidates.id, cid)); if (!c) notFound();
  const apps = await sql<{ id: number; vaga: string; requisition_id: number; rstatus: string; etapa: string; scorecard: Record<string, number> | null; notas: string | null; motivo: string | null; employee_id: number | null; updated_at: Date }[]>`SELECT a.id, r.titulo AS vaga, r.id AS requisition_id, r.status AS rstatus, a.etapa, a.scorecard, a.notas, a.motivo_reprovacao AS motivo, a.employee_id, a.updated_at FROM applications a JOIN requisitions r ON r.id=a.requisition_id WHERE a.candidate_id=${cid} ORDER BY a.updated_at DESC`;
  const gestao = ["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR"].includes(s.role);
  return (
    <Page title={c.nome} sub={<span>{c.origem ? ORIGEM_CAND[c.origem] ?? c.origem : ""}{c.cidade ? ` · ${c.cidade}` : ""}{c.formacao ? ` · ${c.formacao}` : ""} · <Link className="text-acao" href="/recrutamento/candidatos">banco de talentos</Link></span>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="grid gap-4 lg:grid-cols-[1fr_340px] lg:items-start">
        <Card title="Candidaturas">
          <Table head={["Vaga", "Situação da vaga", "Etapa", "Scorecard", "Anotações", "Atualizada"]} empty="Sem candidaturas.">{apps.map(a => <tr key={a.id}><Td><Link className="text-acao" href={`/recrutamento/vagas/${a.requisition_id}`}>{a.vaga}</Link>{a.employee_id && <div className="text-xs"><Link className="text-ok" href={`/colaboradores/${a.employee_id}`}>contratado → ficha</Link></div>}</Td><Td className="text-xs">{REQ_STATUS[a.rstatus]}</Td><Td><Badge v={a.etapa === "CONTRATADO" ? "APROVADA" : a.etapa === "REPROVADO" ? "REJEITADA" : a.etapa === "DESISTIU" ? "CANCELADA" : "EM_ADMISSAO"} label={ETAPA_LABEL[a.etapa] ?? a.etapa} />{a.motivo && <div className="text-xs text-slate-500">{a.motivo}</div>}</Td><Td className="text-xs">{a.scorecard ? Object.entries(a.scorecard).map(([k, v]) => `${k}: ${v}`).join(" · ") : "—"}</Td><Td className="text-xs">{a.notas ?? "—"}</Td><Td className="text-xs">{fmtDataHora(a.updated_at)}</Td></tr>)}</Table>
        </Card>
        <Card title="Dados">{gestao ? <form action={salvarCandidato} className="space-y-2"><input type="hidden" name="id" value={cid} /><Field label="Nome"><Input name="nome" defaultValue={c.nome} required /></Field><div className="grid grid-cols-2 gap-2"><Field label="Telefone"><Input name="telefone" defaultValue={c.telefone ?? ""} /></Field><Field label="E-mail"><Input name="email" defaultValue={c.email ?? ""} /></Field></div><div className="grid grid-cols-2 gap-2"><Field label="Origem"><Select name="origem" defaultValue={c.origem ?? ""}>{cfg.recrutamento.origens.map(o => <option key={o} value={o}>{ORIGEM_CAND[o] ?? o}</option>)}</Select></Field><Field label="Cidade"><Input name="cidade" defaultValue={c.cidade ?? ""} /></Field></div><Field label="Formação"><Input name="formacao" defaultValue={c.formacao ?? ""} /></Field><Field label="Tags"><Input name="tags" defaultValue={c.tags ?? ""} /></Field><Field label="Currículo (link)"><Input name="curriculoLink" defaultValue={c.curriculoLink ?? ""} /></Field><Field label="Observações"><Textarea name="obs" className="min-h-[50px]" defaultValue={c.obs ?? ""} /></Field><label className="flex items-center gap-2 text-xs"><input type="checkbox" name="consentimentoLgpd" value="1" defaultChecked={c.consentimentoLgpd} /> Consentimento LGPD</label><Btn small>Salvar</Btn></form> : <p className="text-sm">{c.telefone} {c.email}</p>}</Card>
      </div>
    </Page>
  );
}
