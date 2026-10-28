import { notFound } from "next/navigation";
import { sql } from "@/db";
import { requireSession, can } from "@/lib/auth";
import { Page, Card, Flash, Btn, Field, Select, Textarea } from "@/components/ui";
import { fmtData, getSettings } from "@/lib/utils";
import { avaliarContratacao } from "../../v30-actions";

export const dynamic = "force-dynamic";

/** v30 · Aos 90 dias, o gestor direto diz como está a contratação — entra no índice de qualidade (com a retenção e a 1ª avaliação). */
export default async function AvaliarContratacao({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const { id } = await params; const sp = await searchParams; const cfg = await getSettings();
  const [a] = await sql<{ application_id: number; employee_id: number; nome: string; cargo: string | null; unidade: string; admissao: string; vaga: string; gestor_id: number | null; solicitante: number | null; nota: number | null; contrataria: boolean | null; comentario: string | null; respondido_em: string | null }[]>`
    SELECT a.id AS application_id, e.id AS employee_id, e.nome, p.nome AS cargo, u.nome AS unidade, e.admissao::text, r.titulo AS vaga, e.gestor_id, r.solicitante_user_id AS solicitante, f.nota, f.contrataria, f.comentario, f.respondido_em::text
    FROM applications a JOIN employees e ON e.id=a.employee_id JOIN requisitions r ON r.id=a.requisition_id JOIN units u ON u.id=e.unit_id LEFT JOIN positions p ON p.id=e.position_id LEFT JOIN hire_feedback f ON f.employee_id=e.id WHERE a.id=${Number(id)} AND a.etapa='CONTRATADO'`;
  if (!a) notFound();
  const pode = (!!s.employeeId && a.gestor_id === s.employeeId) || (a.gestor_id === null && a.solicitante === s.id) || can.editar(s); if (!pode) notFound();
  const dias = Math.floor((Date.parse(new Date().toISOString().slice(0, 10)) - Date.parse(a.admissao)) / 86400000);
  return (
    <Page title={`Como está a contratação de ${a.nome.split(" ")[0]}?`} sub={`${a.cargo ?? a.vaga} · ${a.unidade} · admissão ${fmtData(a.admissao)} (${dias} dias)`}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <Card className="max-w-xl">
        <p className="mb-3 text-sm text-slate-600">Três perguntas rápidas, {cfg.recrutamento.satisfacaoGestorDias} dias depois da admissão. A resposta entra no índice de qualidade da contratação, junto com a permanência e a primeira avaliação — e ajuda a ver quais origens e perfis dão certo.</p>
        <form action={avaliarContratacao} className="space-y-3"><input type="hidden" name="applicationId" value={a.application_id} />
          <Field label="De 1 a 5, como está a contratação?"><Select name="nota" required defaultValue={a.nota ?? ""}><option value="">Escolha</option><option value="5">5 · muito acima do esperado</option><option value="4">4 · acima do esperado</option><option value="3">3 · dentro do esperado</option><option value="2">2 · abaixo do esperado</option><option value="1">1 · muito abaixo do esperado</option></Select></Field>
          <Field label="Contrataria de novo?"><Select name="contrataria" required defaultValue={a.contrataria === null ? "" : a.contrataria ? "1" : "0"}><option value="">Escolha</option><option value="1">Sim</option><option value="0">Não</option></Select></Field>
          <Field label="Comentário (opcional)"><Textarea name="comentario" defaultValue={a.comentario ?? ""} placeholder="O que está indo bem, o que precisa de apoio" /></Field>
          <Btn>{a.respondido_em ? "Atualizar a avaliação" : "Enviar"}</Btn>
          {a.respondido_em && <p className="text-[11px] text-slate-500">Respondida em {fmtData(a.respondido_em.slice(0, 10))}.</p>}
        </form>
      </Card>
    </Page>
  );
}
