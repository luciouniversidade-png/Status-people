import Link from "@/components/Link";
import { scopeUnit, can } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Table, Td, Badge, Flash, Field, Btn, Input, Select, Textarea } from "@/components/ui";
import { fmtDataHora, getSettings, fmtData } from "@/lib/utils";
import { fmtDuracao, podePortaria, semSimulado } from "@/lib/seguranca";
import { iniciarEmergencia } from "../actions";
import { requireSeguranca, SubNavSeg } from "../_ui";

export const dynamic = "force-dynamic";

export default async function Emergencias({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSeguranca(); const sp = await searchParams; const cfg = await getSettings(); const escopo = scopeUnit(s); const pode = (await podePortaria(s)) || can.operacoes(s);
  const [evs, units, atrasadas] = await Promise.all([
    sql<{ id: number; unidade: string; tipo: string; cenario: string; status: string; inicio: string; tempo_evacuacao_seg: number | null; meta_seg: number | null; grupos: number; ocorrencias: number; falhas: number; acoes: number }[]>`SELECT e.id, u.nome AS unidade, e.tipo, e.cenario, e.status, e.inicio::text, e.tempo_evacuacao_seg, e.meta_seg, (SELECT count(*) FROM emergency_checks c WHERE c.event_id=e.id)::int AS grupos, (SELECT count(*) FROM emergency_checks c WHERE c.event_id=e.id AND c.status='OCORRENCIA')::int AS ocorrencias, (SELECT count(*) FROM emergency_failures f WHERE f.event_id=e.id)::int AS falhas, (SELECT count(*) FROM emergency_failures f WHERE f.event_id=e.id AND f.action_plan_id IS NOT NULL)::int AS acoes FROM emergency_events e JOIN units u ON u.id=e.unit_id ${escopo === null ? sql`` : sql`WHERE e.unit_id=${escopo}`} ORDER BY e.inicio DESC LIMIT 100`,
    sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ${escopo === null ? sql`` : sql`WHERE id=${escopo}`} ORDER BY nome`, semSimulado(escopo)]);
  return (
    <Page title="Simulados e emergências" sub={`Simulado de abandono ou emergência real: chamada por turma no ponto de encontro, tempo de evacuação (meta ${cfg.portaria.metaEvacuacaoMin} min), falhas que viram ações e entrega às famílias com conferência de quem pode buscar.`}>
      <SubNavSeg ativo="/operacoes/seguranca/emergencias" />
      <Flash ok={sp.ok} erro={sp.erro} />
      {atrasadas.length > 0 && <Card className="mb-4 border-amber-300"><p className="text-sm text-aviso">Sem simulado de abandono nos últimos {cfg.portaria.simuladoMeses} meses: {atrasadas.map(u => `${u.nome}${u.ultimo ? ` (último ${fmtData(u.ultimo)})` : " (nenhum registrado)"}`).join(" · ")}.</p></Card>}
      <div className={`grid grid-cols-1 gap-4 ${pode ? "lg:grid-cols-[minmax(0,1fr)_320px]" : ""} lg:items-start`}>
        <Table head={["Quando", "Evento", "Evacuação", "Ocorrências", "Falhas → ações"]} empty="Nenhum simulado registrado.">{evs.map(e => <tr key={e.id}><Td className="whitespace-nowrap text-xs">{fmtDataHora(e.inicio)}<div>{e.unidade}</div></Td><Td><Link className="font-medium text-acao" href={`/operacoes/seguranca/emergencias/${e.id}`}>{e.cenario}</Link><div className="flex gap-1">{e.tipo === "REAL" ? <Badge v="REJEITADA" label="Emergência real" /> : <Badge v="NEUTRO" label="Simulado" />}{e.status === "EM_ANDAMENTO" && <Badge v="PENDENTE" label="em andamento" />}</div></Td><Td>{fmtDuracao(e.tempo_evacuacao_seg)}{e.tempo_evacuacao_seg !== null && e.meta_seg ? <div className={`text-[11px] ${e.tempo_evacuacao_seg <= e.meta_seg ? "text-ok" : "text-erro"}`}>{e.tempo_evacuacao_seg <= e.meta_seg ? "dentro da meta" : "acima da meta"}</div> : null}</Td><Td>{e.ocorrencias ? <span className="text-erro">{e.ocorrencias} grupo(s)</span> : "—"}</Td><Td>{e.falhas ? `${e.falhas} → ${e.acoes}` : "—"}</Td></tr>)}</Table>
        {pode && <Card title="Iniciar">
          <form action={iniciarEmergencia} className="space-y-2">
            {!escopo && <Field label="Unidade"><Select name="unitId" required>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>}
            <Field label="Tipo"><Select name="tipo" defaultValue="SIMULADO"><option value="SIMULADO">Simulado de abandono</option><option value="REAL">Emergência real</option></Select></Field>
            <Field label="Cenário"><Select name="cenario" required>{(cfg.portaria.cenarios as string[]).map(c => <option key={c}>{c}</option>)}</Select></Field>
            <Field label="Pontos de encontro"><Input name="pontosEncontro" placeholder="Quadra coberta; estacionamento" /></Field>
            <Field label="Observações"><Textarea name="observacoes" className="min-h-[50px]" /></Field>
            <Btn small>Iniciar e abrir a chamada</Btn>
            <p className="text-xs text-slate-500">A chamada já vem com um grupo por série (alunos atuais da unidade), a equipe e os visitantes na escola. Emergência real avisa a direção, o RH e operações na hora.</p>
          </form></Card>}
      </div>
    </Page>
  );
}
