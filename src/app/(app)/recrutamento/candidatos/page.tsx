import Link from "next/link";
import { requireStaff, can } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Table, Td, Flash, Field, Input, Select, Textarea, Btn } from "@/components/ui";
import { fmtData, getSettings } from "@/lib/utils";
import { ORIGEM_CAND, ETAPA_LABEL } from "@/lib/talento";
import { salvarCandidato, importarCandidatos } from "../../talento/actions";

export const dynamic = "force-dynamic";

export default async function Candidatos({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaff(); const sp = await searchParams; const cfg = await getSettings(); const q = (sp.q ?? "").trim();
  const rows = await sql<{ id: number; nome: string; telefone: string | null; email: string | null; cidade: string | null; origem: string | null; formacao: string | null; tags: string | null; created_at: Date; ultima: string | null; vaga: string | null; lgpd: boolean }[]>`SELECT c.id, c.nome, c.telefone, c.email, c.cidade, c.origem, c.formacao, c.tags, c.created_at, c.consentimento_lgpd AS lgpd, (SELECT a.etapa FROM applications a WHERE a.candidate_id=c.id ORDER BY a.updated_at DESC LIMIT 1) AS ultima, (SELECT r.titulo FROM applications a JOIN requisitions r ON r.id=a.requisition_id WHERE a.candidate_id=c.id ORDER BY a.updated_at DESC LIMIT 1) AS vaga FROM candidates c WHERE 1=1 ${q ? sql`AND (c.nome ILIKE ${"%" + q + "%"} OR c.formacao ILIKE ${"%" + q + "%"} OR c.tags ILIKE ${"%" + q + "%"} OR c.cidade ILIKE ${"%" + q + "%"})` : sql``} ORDER BY c.created_at DESC LIMIT 400`;
  const gestao = ["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR"].includes(s.role);
  return (
    <Page title="Banco de talentos" sub="Candidatos de todas as vagas. Busque por nome, formação, tags ou cidade." actions={<Btn kind="ghost" href="/recrutamento">Vagas</Btn>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className={`grid gap-4 ${gestao ? "lg:grid-cols-[1fr_340px]" : ""} lg:items-start`}>
        <div>
          <form className="mb-3 flex items-end gap-2"><Field label="Buscar"><Input name="q" defaultValue={q} /></Field><Btn kind="ghost">Filtrar</Btn></form>
          <Table head={["Candidato", "Contato", "Cidade", "Origem", "Formação / tags", "Última etapa", "Cadastro"]} empty="Nenhum candidato.">
            {rows.map(c => <tr key={c.id}><Td><Link className="font-medium text-acao" href={`/recrutamento/candidatos/${c.id}`}>{c.nome}</Link>{!c.lgpd && <div className="text-xs text-aviso">sem consentimento LGPD</div>}</Td><Td className="text-xs">{c.telefone ?? ""}<br />{c.email ?? ""}</Td><Td className="text-xs">{c.cidade ?? "—"}</Td><Td className="text-xs">{c.origem ? ORIGEM_CAND[c.origem] ?? c.origem : "—"}</Td><Td className="text-xs">{c.formacao ?? ""}{c.tags ? <div className="text-slate-500">{c.tags}</div> : null}</Td><Td className="text-xs">{c.ultima ? `${ETAPA_LABEL[c.ultima] ?? c.ultima} · ${c.vaga}` : "—"}</Td><Td className="text-xs">{fmtData(String(c.created_at).slice(0, 10))}</Td></tr>)}
          </Table>
        </div>
        {gestao && <div className="space-y-4"><Card title="Novo candidato (sem vaga)"><form action={salvarCandidato} className="space-y-2"><Field label="Nome"><Input name="nome" required /></Field><div className="grid grid-cols-2 gap-2"><Field label="Telefone"><Input name="telefone" /></Field><Field label="E-mail"><Input name="email" type="email" /></Field></div><div className="grid grid-cols-2 gap-2"><Field label="Origem"><Select name="origem" defaultValue="BANCO_TALENTOS">{cfg.recrutamento.origens.map(o => <option key={o} value={o}>{ORIGEM_CAND[o] ?? o}</option>)}</Select></Field><Field label="Cidade"><Input name="cidade" defaultValue="Campo Grande" /></Field></div><Field label="Formação"><Input name="formacao" /></Field><Field label="Tags"><Input name="tags" placeholder="professor, matemática, integral" /></Field><Field label="Currículo (link)"><Input name="curriculoLink" /></Field><label className="flex items-center gap-2 text-xs"><input type="checkbox" name="consentimentoLgpd" value="1" defaultChecked /> Consentimento LGPD</label><Btn small>Salvar</Btn></form></Card>
          {can.editar(s) && <Card title="Importar candidatos (CSV)"><form action={importarCandidatos} className="space-y-2"><Field label="nome;email;telefone;cidade;formacao;tags;origem;consentimento"><Textarea name="csv" className="min-h-[90px] font-mono text-xs" /></Field><Btn small kind="ghost">Importar</Btn></form></Card>}</div>}
      </div>
    </Page>
  );
}
