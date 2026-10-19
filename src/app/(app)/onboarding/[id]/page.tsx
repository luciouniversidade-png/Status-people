import { notFound, redirect } from "next/navigation";
import Link from "@/components/Link";
import { sql } from "@/db";
import { requireSession } from "@/lib/auth";
import { Page, Card, Flash, Badge, Btn, Field, Select, Input, Textarea } from "@/components/ui";
import { EtapasC13 } from "@/components/Etapas";
import { papelNoPlano, estadoMarcos, progressoPlano, RESP_ONB, TIPO_ONB } from "@/lib/onboarding";
import { concluirItemOnb, definirBuddy, responderPesquisaOnb } from "../actions";
import { fmtData, hoje } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function PlanoOnboarding({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const { id } = await params; const sp = await searchParams; const planId = Number(id);
  const papel = await papelNoPlano(s, planId); if (!papel) notFound();
  const ve = papel.papeis.size > 0 || s.role === "LEITURA" || (s.role === "GESTOR" && s.unitId === papel.unit_id); if (!ve) redirect("/");
  const [p] = await sql<{ nome: string; cargo: string | null; unidade: string; inicio: string; status: string; gestor: string | null; buddy_id: number | null; buddy: string | null }[]>`SELECT e.nome, po.nome AS cargo, u.nome AS unidade, p.inicio::text, p.status, ug.nome AS gestor, p.buddy_employee_id AS buddy_id, b.nome AS buddy FROM onboarding_plans p JOIN employees e ON e.id=p.employee_id JOIN units u ON u.id=e.unit_id LEFT JOIN positions po ON po.id=e.position_id LEFT JOIN users ug ON ug.id=p.gestor_user_id LEFT JOIN employees b ON b.id=p.buddy_employee_id WHERE p.id=${planId}`;
  const itens = await sql<{ id: number; marco: number; titulo: string; tipo: string; responsavel: string; prazo: string; concluido_em: string | null; nota: string | null }[]>`SELECT id, marco, titulo, tipo, responsavel, prazo::text, concluido_em::text, nota FROM onboarding_items WHERE plan_id=${planId} ORDER BY prazo, ordem`;
  const pesquisas = await sql<{ marco: number; nota: number; comentario: string | null }[]>`SELECT marco, nota, comentario FROM onboarding_surveys WHERE plan_id=${planId} ORDER BY marco`;
  const equipe = papel.papeis.has("RH") || papel.papeis.has("GESTOR") ? await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM employees WHERE unit_id=${papel.unit_id} AND situacao='ATIVO' AND id <> ${papel.employee_id} ORDER BY nome` : [];
  const h = hoje(); const prog = progressoPlano(itens, h); const marcos = estadoMarcos(itens, h); const verPesquisa = papel.papeis.has("RH") || papel.papeis.has("NOVATO");
  const podeItem = (resp: string, tipo: string) => papel.papeis.has("RH") || papel.papeis.has("GESTOR") || (papel.papeis.has(resp) && (tipo !== "PESQUISA" || papel.papeis.has("NOVATO")));
  return (
    <Page title={`Onboarding · ${p.nome}`} sub={`${p.cargo ?? "—"} · ${p.unidade} · início ${fmtData(p.inicio)} · gestor ${p.gestor ?? "—"} · buddy ${p.buddy ?? "a definir"}`}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <p className="mb-3 text-sm"><Link href="/onboarding" className="text-acao">← todos os planos</Link></p>
      <Card className="mb-4"><div className="mb-3 flex flex-wrap items-center gap-3 text-sm"><b className="text-navy">{prog.pct ?? 0}% concluído</b><span className="text-slate-600">{prog.ok}/{prog.total} itens</span>{prog.atrasados ? <Badge v="REJEITADA" label={`${prog.atrasados} atrasado(s)`} /> : <Badge v="APROVADA" label="em dia" />}{p.status === "CONCLUIDO" && <Badge v="APROVADA" label="plano concluído" />}</div>
        <EtapasC13 rotulo="Marcos do onboarding" etapas={marcos.map(m => ({ nome: `${m.marco} dias`, estado: m.estado, sub: m.prazo ? `${fmtData(m.prazo)} · ${m.feitos}/${m.total}` : undefined }))} /></Card>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-start">
        <Card title="Itens do plano" className="lg:col-span-2">
          <ul className="divide-y divide-line">{itens.map(i => { const atrasado = !i.concluido_em && i.prazo < h; return (
            <li key={i.id} className="flex flex-wrap items-start gap-2 py-2 text-sm">
              <span className={`mt-0.5 inline-block h-4 w-4 shrink-0 rounded-full border-2 ${i.concluido_em ? "border-ok bg-ok" : atrasado ? "border-erro" : "border-slate-300"}`} aria-hidden />
              <span className="min-w-0 flex-1"><span className={i.concluido_em ? "text-slate-500 line-through" : "font-medium"}>{i.titulo}</span><span className="block text-[11px] text-slate-500">D+{i.marco} · {fmtData(i.prazo)} · {RESP_ONB[i.responsavel] ?? i.responsavel} · {TIPO_ONB[i.tipo] ?? i.tipo}{atrasado ? " · atrasado" : ""}{i.nota ? ` · ${i.nota}` : ""}</span></span>
              {podeItem(i.responsavel, i.tipo) && i.tipo !== "PESQUISA" && <form action={concluirItemOnb} className="flex items-center gap-1"><input type="hidden" name="itemId" value={i.id} /><input type="hidden" name="planId" value={planId} />{!i.concluido_em && i.tipo === "CHECKIN" && <Input name="nota" placeholder="combinados do check-in" className="h-8 w-44 text-xs" />}<Btn small kind="ghost">{i.concluido_em ? "Reabrir" : "Concluir"}</Btn></form>}
            </li>); })}</ul>
        </Card>
        <div className="space-y-4">
          {(papel.papeis.has("RH") || papel.papeis.has("GESTOR")) && <Card title="Buddy"><form action={definirBuddy} className="space-y-2"><input type="hidden" name="planId" value={planId} /><Field label="Colega que acompanha os primeiros 90 dias"><Select name="buddyId" defaultValue={p.buddy_id ?? ""}><option value="">— sem buddy —</option>{equipe.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}</Select></Field><Btn small kind="ghost">Salvar</Btn></form></Card>}
          {verPesquisa && <Card title="Pesquisa do novato">
            {pesquisas.length > 0 && <ul className="mb-3 space-y-1 text-sm">{pesquisas.map(q => <li key={q.marco}><b>{q.marco} dias:</b> {q.nota}/5{q.comentario ? ` — ${q.comentario}` : ""}</li>)}</ul>}
            {papel.papeis.has("NOVATO") && [30, 90].filter(m => !pesquisas.some(q => q.marco === m) && itens.some(i => i.tipo === "PESQUISA" && i.marco === m)).map(m => <form key={m} action={responderPesquisaOnb} className="mb-3 space-y-2 rounded-md border border-line p-2"><input type="hidden" name="planId" value={planId} /><input type="hidden" name="marco" value={m} /><Field label={`Como estão seus primeiros ${m} dias? (1 a 5)`}><Select name="nota" defaultValue="4">{[5, 4, 3, 2, 1].map(n => <option key={n} value={n}>{n}</option>)}</Select></Field><Textarea name="comentario" placeholder="O que ajudou e o que faltou" className="min-h-[56px]" /><Btn small>Enviar</Btn></form>)}
            {!pesquisas.length && !papel.papeis.has("NOVATO") && <p className="text-xs text-slate-500">Ainda sem respostas. O novato responde pelo próprio plano.</p>}
          </Card>}
        </div>
      </div>
    </Page>
  );
}
