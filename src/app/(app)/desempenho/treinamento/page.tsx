import Link from "@/components/Link";
import { requireStaff } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Table, Td, Badge, Flash, Field, Input, Select, Textarea, Btn } from "@/components/ui";
import { fmtData } from "@/lib/utils";
import { criarTreinamento } from "../desenvolvimento-actions";

export const dynamic = "force-dynamic";

export default async function Treinamentos({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaff(); const sp = await searchParams; const rh = ["DIRECAO", "RH"].includes(s.role);
  const rows = await sql<{ id: number; titulo: string; status: string; created_at: string; casos: number; respondentes: number; meus: number; modelo: string | null; model_versao: number | null }[]>`SELECT t.id, t.titulo, t.status, t.created_at::text, jsonb_array_length(t.casos)::int AS casos, (SELECT count(DISTINCT user_id) FROM rater_training_responses x WHERE x.training_id=t.id)::int AS respondentes, (SELECT count(*) FROM rater_training_responses x WHERE x.training_id=t.id AND x.user_id=${s.id})::int AS meus, m.nome AS modelo, t.model_versao FROM rater_trainings t LEFT JOIN eval_models m ON m.id=t.model_id ORDER BY t.id DESC`;
  const modelos = await sql<{ id: number; nome: string; versao: number }[]>`SELECT id, nome, versao FROM eval_models WHERE status<>'ARQUIVADO' ORDER BY nome`;
  return (
    <Page title="Preparação de avaliadores" sub="Antes de avaliar, cada avaliador responde casos simulados sozinho; depois vê a referência, compara com o grupo e discute. Diferenças de interpretação viram ajuste de rubrica, não correção automática de notas." actions={<Btn kind="ghost" href="/desempenho">Desempenho</Btn>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className={`grid gap-4 ${rh ? "lg:grid-cols-[1fr_420px]" : ""} lg:items-start`}>
        <Table head={["Treinamento", "Modelo", "Casos", "Respondentes", "Você", "Situação"]} empty="Nenhum treinamento.">{rows.map(r => <tr key={r.id}><Td><Link className="font-medium text-acao" href={`/desempenho/treinamento/${r.id}`}>{r.titulo}</Link><div className="text-[11px] text-slate-500">{fmtData(r.created_at)}</div></Td><Td className="text-xs">{r.modelo ? `${r.modelo} v${r.model_versao}` : "—"}</Td><Td>{r.casos}</Td><Td>{r.respondentes}</Td><Td className="text-xs">{r.meus}/{r.casos}</Td><Td><Badge v={r.status === "ABERTO" ? "ATIVO" : "CANCELADA"} label={r.status.toLowerCase()} /></Td></tr>)}</Table>
        {rh && <Card title="Novo treinamento"><form action={criarTreinamento} className="space-y-2"><Field label="Título"><Input name="titulo" required placeholder="Calibração inicial — Professores 2026" /></Field><Field label="Modelo de referência"><Select name="modelId" defaultValue=""><option value="">—</option>{modelos.map(m => <option key={m.id} value={m.id}>{m.nome} v{m.versao}</option>)}</Select></Field><Field label="Orientações"><Textarea name="orientacoes" className="min-h-[50px]" defaultValue="Avalie apenas pelo critério e pela evidência descrita. Diferencie falta de evidência de desempenho insuficiente." /></Field><Field label="Casos (um por linha): Título :: situação observada :: nota de referência 1–5 :: justificativa"><Textarea name="casos" className="min-h-[140px] font-mono text-xs" required placeholder={"Devolutiva de atividades :: Em 4 semanas, 3 de 4 turmas receberam devolutiva escrita em até 7 dias; uma turma atrasou por licença do auxiliar. :: 3 :: Atende no essencial; o atraso tem causa institucional registrada.\nComunicação com famílias :: Duas reclamações registradas no período, ambas resolvidas em 48 h com registro no sistema. :: 4 :: Resolve com rapidez e registro; reclamação resolvida não é, por si, desempenho abaixo."} /></Field><Btn small>Criar</Btn><p className="text-[11px] text-slate-500">Use situações realistas sem dados identificáveis de colaboradores, alunos ou famílias.</p></form></Card>}
      </div>
    </Page>
  );
}
