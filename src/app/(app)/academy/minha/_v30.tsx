// v30 · Meus treinamentos: avaliar o que concluí, meus certificados e as inscrições abertas
import Link from "@/components/Link";
import { sql } from "@/db";
import { Card, Table, Td, Badge, Btn, Field, Select, Textarea } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { fmtData, addDays, hoje } from "@/lib/utils";
import { COURSE_FORMATO } from "@/lib/clima-academy";
import { avaliarTreinamento, inscreverTreinamento, desistirInscricao } from "../v30-actions";

const INSC: Record<string, [string, string]> = { AGUARDANDO_APROVACAO: ["PENDENTE", "aguardando o gestor"], INSCRITO: ["APROVADA", "inscrito(a)"], RECUSADA: ["REJEITADA", "não aprovada"], DESISTIU: ["CANCELADA", "desistiu"] };

export async function MeusTreinamentosV30({ eid }: { eid: number }) {
  const [concluidos, abertos] = await Promise.all([
    sql<{ id: number; course_id: number; titulo: string; codigo: string; concluido_em: string | null; nota: number | null; carga: number | null }[]>`SELECT p.id, p.course_id, c.titulo, c.codigo, p.concluido_em::text, f.nota, c.carga_horas::float AS carga FROM training_progress p JOIN courses c ON c.id=p.course_id LEFT JOIN training_feedback f ON f.course_id=p.course_id AND f.employee_id=p.employee_id WHERE p.employee_id=${eid} AND p.status='CONCLUIDO' AND c.formato <> 'POP' ORDER BY p.concluido_em DESC NULLS LAST LIMIT 30`,
    sql<{ id: number; titulo: string; codigo: string; formato: string; carga: number | null; exige: boolean; descricao: string | null; status: string | null; motivo: string | null; turmas: { id: number; data: string; horario: string | null; local: string | null }[] }[]>`
      SELECT c.id, c.titulo, c.codigo, c.formato, c.carga_horas::float AS carga, c.exige_aprovacao AS exige, c.descricao, t.status, t.motivo,
        coalesce((SELECT json_agg(json_build_object('id', s.id, 'data', s.data, 'horario', s.horario, 'local', s.local) ORDER BY s.data) FROM training_sessions s WHERE s.course_id=c.id AND s.data >= current_date), '[]'::json) AS turmas
      FROM courses c LEFT JOIN training_enrollments t ON t.course_id=c.id AND t.employee_id=${eid} WHERE c.ativo AND c.inscricao_aberta ORDER BY c.titulo`,
  ]);
  const aAvaliar = concluidos.filter(c => c.nota === null && c.concluido_em && c.concluido_em >= addDays(hoje(), -120));
  return <>
    <Card className="mt-4" title={`Avaliar o que concluí${aAvaliar.length ? ` (${aAvaliar.length})` : ""}`}>
      <div id="avaliar" />
      {aAvaliar.length === 0 ? <p className="text-sm text-slate-500">Nada para avaliar agora.</p> : <ul className="space-y-2">{aAvaliar.map(c => <li key={c.course_id} id={`reacao${c.course_id}`} className="rounded-md border border-line p-2 text-sm"><div className="font-medium">{c.codigo} {c.titulo}</div>
        <form action={avaliarTreinamento} className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-[repeat(2,minmax(0,1fr))_minmax(0,2fr)_auto] sm:items-end"><input type="hidden" name="courseId" value={c.course_id} />
          <Field label="Nota (1 a 5)"><Select name="nota" required defaultValue="">{[<option key="" value="">—</option>, ...[5, 4, 3, 2, 1].map(n => <option key={n} value={n}>{n}</option>)]}</Select></Field>
          <Field label="Vou usar no trabalho?"><Select name="aplicavel" defaultValue=""><option value="">—</option><option value="5">muito</option><option value="4">bastante</option><option value="3">em parte</option><option value="2">pouco</option><option value="1">não</option></Select></Field>
          <Field label="Comentário (opcional)"><Textarea name="comentario" className="min-h-[38px]" /></Field><Btn small>Enviar</Btn></form></li>)}</ul>}
    </Card>
    <Card className="mt-4" title="Meus certificados">
      <Table head={["Treinamento", "Concluído em", "Carga", ""]} empty="Nenhum treinamento concluído ainda.">{concluidos.map(c => <tr key={c.id}><Td>{c.codigo} {c.titulo}</Td><Td className="text-xs">{fmtData(c.concluido_em)}</Td><Td className="text-xs">{c.carga ? `${String(c.carga).replace(".", ",")} h` : "—"}</Td><Td><Link className="text-xs text-acao" href={`/academy/certificado/${c.id}`}>certificado</Link></Td></tr>)}</Table>
    </Card>
    <Card className="mt-4" title="Inscrições abertas">
      <div id="inscricoes" />
      <Table head={["Treinamento", "Formato", "Situação", ""]} empty="Nenhum treinamento com inscrição aberta agora.">{abertos.map(c => { const st = c.status ? INSC[c.status] : null; const ativa = c.status === "INSCRITO" || c.status === "AGUARDANDO_APROVACAO"; return <tr key={c.id}><Td><div className="font-medium">{c.codigo} {c.titulo}</div>{c.descricao && <div className="text-[11px] text-slate-500">{c.descricao}</div>}{c.turmas.length > 0 && <div className="text-[11px] text-slate-500">Turmas: {c.turmas.map(t => `${fmtData(t.data)}${t.horario ? ` ${t.horario}` : ""}`).join(" · ")}</div>}</Td><Td className="text-xs">{COURSE_FORMATO[c.formato] ?? c.formato}{c.carga ? ` · ${String(c.carga).replace(".", ",")} h` : ""}</Td>
        <Td>{st ? <><Badge v={st[0]} label={st[1]} />{c.motivo && c.status === "RECUSADA" && <div className="text-[11px] text-slate-500">{c.motivo}</div>}</> : <span className="text-xs text-slate-400">—</span>}</Td>
        <Td>{ativa ? <Modal label="Desistir" kind="link" title="Cancelar a inscrição"><form action={desistirInscricao} className="space-y-2"><input type="hidden" name="courseId" value={c.id} /><Field label="Motivo (opcional)"><Textarea name="motivo" className="min-h-[40px]" /></Field><Btn small danger>Cancelar inscrição</Btn></form></Modal> : <form action={inscreverTreinamento} className="flex flex-wrap items-center gap-1"><input type="hidden" name="courseId" value={c.id} />{c.turmas.length > 1 && <select name="sessionId" className="rounded border border-line px-1 py-0.5 text-xs" aria-label="Turma">{c.turmas.map(t => <option key={t.id} value={t.id}>{fmtData(t.data)}</option>)}</select>}<Btn small>{c.exige ? "Pedir inscrição" : "Inscrever-me"}</Btn></form>}</Td></tr>; })}</Table>
      <p className="mt-2 text-[11px] text-slate-500">Com aprovação do gestor, a inscrição fica “aguardando o gestor” até a decisão — você é avisado(a).</p>
    </Card>
  </>;
}
