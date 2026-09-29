import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireStaff } from "@/lib/auth";
import { db, schema, sql } from "@/db";
import { Page, Card, Badge, Flash, Field, Select, Textarea, Btn } from "@/components/ui";
import { ESCALA } from "@/lib/avaliacao";
import { responderCaso, registrarDiscussao } from "../../desenvolvimento-actions";

export const dynamic = "force-dynamic";
type Caso = { id: string; titulo: string; descricao: string; referencia: number; justificativa: string | null };

export default async function Treinamento({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaff(); const { id } = await params; const sp = await searchParams; const tid = Number(id); const rh = ["DIRECAO", "RH"].includes(s.role);
  const [t] = await db.select().from(schema.raterTrainings).where(eq(schema.raterTrainings.id, tid)); if (!t) notFound();
  const resp = await sql<{ caso_id: string; user_id: number; nome: string; nota: number; justificativa: string | null }[]>`SELECT x.caso_id, x.user_id, u.nome, (x.notas->>'nota')::int AS nota, x.justificativa FROM rater_training_responses x JOIN users u ON u.id=x.user_id WHERE x.training_id=${tid} ORDER BY x.id`;
  const casos = (t.casos as Caso[]) ?? [];
  return (
    <Page title={t.titulo} sub={<span className="flex items-center gap-2"><Badge v={t.status === "ABERTO" ? "ATIVO" : "CANCELADA"} label={t.status.toLowerCase()} />{t.orientacoes}</span>} actions={<Btn kind="ghost" href="/desempenho/treinamento">Treinamentos</Btn>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="space-y-4">{casos.map((c, i) => { const meu = resp.find(r => r.caso_id === c.id && r.user_id === s.id); const todas = resp.filter(r => r.caso_id === c.id); const ver = !!meu || rh; const dist = [1, 2, 3, 4, 5].map(k => todas.filter(r => r.nota === k).length); return (
        <Card key={c.id} title={`Caso ${i + 1} — ${c.titulo}`}><p className="text-sm">{c.descricao}</p>
          {!meu && t.status === "ABERTO" && ["DIRECAO", "RH", "DIRETOR_UNIDADE", "GESTOR"].includes(s.role) && <form action={responderCaso} className="mt-2 space-y-2"><input type="hidden" name="trainingId" value={tid} /><input type="hidden" name="casoId" value={c.id} /><Field label="Sua nota"><Select name="nota" defaultValue="" required><option value="">—</option>{[1, 2, 3, 4, 5].map(k => <option key={k} value={k}>{k} · {ESCALA[k]}</option>)}</Select></Field><Field label="Justificativa com base no critério e na evidência"><Textarea name="justificativa" className="min-h-[50px]" required /></Field><Btn small>Responder</Btn><p className="text-[11px] text-slate-500">A referência e as respostas do grupo aparecem depois que você responder.</p></form>}
          {ver && <div className="mt-2 rounded-md bg-mist p-3 text-sm">{meu && <div>Sua resposta: <b>{meu.nota}</b> — {meu.justificativa}</div>}<div>Referência: <b>{c.referencia}</b>{c.justificativa ? ` — ${c.justificativa}` : ""}</div><div className="text-xs text-slate-600">Distribuição do grupo ({todas.length}): {dist.map((n, k) => `${k + 1}: ${n}`).join(" · ")}{todas.length ? ` · ${todas.filter(r => r.nota === c.referencia).length} igual(is) à referência` : ""}</div>{rh && todas.length > 0 && <ul className="mt-1 space-y-0.5 text-xs">{todas.map((r, k) => <li key={k}>{r.nome}: {r.nota} — {r.justificativa}</li>)}</ul>}</div>}
        </Card>); })}
        <Card title="Discussão e ajustes de rubrica">{t.discussao ? <p className="whitespace-pre-wrap text-sm">{t.discussao}</p> : <p className="text-sm text-slate-500">Nada registrado.</p>}{rh && <form action={registrarDiscussao} className="mt-2 space-y-2"><input type="hidden" name="trainingId" value={tid} /><Field label="Síntese da discussão, divergências e ajustes de rubrica propostos"><Textarea name="discussao" className="min-h-[90px]" defaultValue={t.discussao ?? ""} /></Field><label className="flex items-center gap-2 text-xs"><input type="checkbox" name="encerrar" value="1" /> Encerrar treinamento</label><Btn small>Salvar</Btn></form>}</Card>
      </div>
    </Page>
  );
}
