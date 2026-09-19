import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, and, desc } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession, can, canSeeEmployee } from "@/lib/auth";
import { Page, Card, Badge, Btn, Flash, Field, Input, Select, Textarea, Table, Td } from "@/components/ui";
import { PrintButton } from "@/components/PrintButton";
import { fmtData, fmtDataHora, getSettings } from "@/lib/utils";
import { REV_STATUS, CYCLE_STATUS, NIVEL_LABEL, GOAL_STATUS, mediaNotas } from "@/lib/talento";
import { autoavaliar, avaliarGestor, calibrar, atualizarPdi, salvarMeta } from "../../../talento/actions";

export const dynamic = "force-dynamic";
type Notas = { notas?: Record<string, number>; comentario?: string | null; realizacoes?: string | null; pontosFortes?: string | null; melhorias?: string | null };

export default async function Avaliacao({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const { id } = await params; const sp = await searchParams; const rid = Number(id); const cfg = await getSettings();
  const [r] = await db.select().from(schema.perfReviews).where(eq(schema.perfReviews.id, rid)); if (!r) notFound();
  const [[c], [e], metas, checkins] = await Promise.all([db.select().from(schema.perfCycles).where(eq(schema.perfCycles.id, r.cycleId)), db.select().from(schema.employees).where(eq(schema.employees.id, r.employeeId)), db.select().from(schema.perfGoals).where(and(eq(schema.perfGoals.cycleId, r.cycleId), eq(schema.perfGoals.employeeId, r.employeeId))), db.select().from(schema.perfCheckins).where(eq(schema.perfCheckins.employeeId, r.employeeId)).orderBy(desc(schema.perfCheckins.data)).limit(6)]);
  if (!e || !c) notFound();
  const proprio = s.employeeId === e.id; if (!proprio && !canSeeEmployee(s, e)) notFound();
  const comps = c.competencias as string[]; const auto = (r.auto as Notas | null) ?? {}; const g = (r.gestor as Notas | null) ?? {}; const pdi = (r.pdi as { acao: string; prazo: string | null; status: string }[] | null) ?? [];
  const avaliador = ["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR"].includes(s.role) && !proprio; const podeCal = can.aprovar(s, cfg.alcadas.calibracao); const aberto = c.status === "ABERTO" || c.status === "CALIBRACAO";
  const voltar = `/desempenho/avaliacoes/${rid}`; const esc = Array.from({ length: cfg.desempenho.escala }, (_, i) => i + 1);
  return (
    <Page title={`Avaliação — ${e.nome}`} sub={<span className="flex flex-wrap items-center gap-2"><Badge v={r.status === "CONCLUIDA" ? "APROVADA" : r.status === "PENDENTE" ? "PENDENTE" : "EM_ADMISSAO"} label={REV_STATUS[r.status]} /> {c.nome} · {CYCLE_STATUS[c.status]} · nota {r.notaFinal ?? "—"}{r.desempenhoNivel && r.potencial ? ` · ${(cfg.desempenho.boxes as Record<string, string>)[`${r.desempenhoNivel}-${r.potencial}`]}` : ""} · <Link className="text-acao" href={proprio ? "/desempenho/minha" : `/desempenho/ciclos/${c.id}`}>voltar</Link></span>} actions={<PrintButton />}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="grid gap-4 lg:grid-cols-[1fr_360px] lg:items-start">
        <div className="space-y-4">
          <Card title="Competências — autoavaliação × gestor">
            <Table head={["Competência", "Auto", "Gestor"]}>{comps.map(k => <tr key={k}><Td>{k}</Td><Td className="tabular-nums">{auto.notas?.[k] ?? "—"}</Td><Td className="tabular-nums font-medium">{g.notas?.[k] ?? "—"}</Td></tr>)}<tr className="bg-mist"><Td className="font-medium">Média</Td><Td className="tabular-nums">{mediaNotas(auto.notas) ?? "—"}</Td><Td className="tabular-nums font-medium">{mediaNotas(g.notas) ?? "—"}</Td></tr></Table>
            {(auto.realizacoes || auto.comentario) && <div className="mt-3 text-sm"><div className="text-xs font-medium text-slate-500">Autoavaliação — realizações e comentário</div><p className="whitespace-pre-wrap">{auto.realizacoes}{auto.comentario ? `\n${auto.comentario}` : ""}</p></div>}
            {(g.pontosFortes || g.melhorias || g.comentario) && <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">{g.pontosFortes && <div><dt className="text-xs font-medium text-slate-500">Pontos fortes</dt><dd>{g.pontosFortes}</dd></div>}{g.melhorias && <div><dt className="text-xs font-medium text-slate-500">A desenvolver</dt><dd>{g.melhorias}</dd></div>}{g.comentario && <div><dt className="text-xs font-medium text-slate-500">Comentário do gestor</dt><dd>{g.comentario}</dd></div>}</dl>}
            {r.calibracaoNota && <p className="mt-2 text-xs text-slate-600">Calibração: {r.calibracaoNota}</p>}
          </Card>
          <Card title="Metas do ciclo">
            <Table head={["Meta", "Indicador", "Alvo", "Resultado", "Peso", "Atingimento", "Situação"]} empty="Sem metas cadastradas.">{metas.map(m => <tr key={m.id}><Td>{m.titulo}</Td><Td className="text-xs">{m.indicador ?? "—"}</Td><Td className="text-xs">{m.meta ?? "—"}</Td><Td className="text-xs">{m.resultado ?? "—"}</Td><Td>{m.peso}</Td><Td>{m.atingimento !== null ? `${m.atingimento}%` : "—"}</Td><Td><Badge v={m.status === "ATINGIDA" ? "APROVADA" : m.status === "NAO_ATINGIDA" ? "REJEITADA" : m.status === "PARCIAL" ? "PENDENTE" : "EM_ADMISSAO"} label={GOAL_STATUS[m.status]} /></Td></tr>)}</Table>
            {aberto && (avaliador || proprio) && <details className="mt-2 print:hidden"><summary className="cursor-pointer text-xs text-acao">Adicionar / atualizar meta</summary><form action={salvarMeta} className="mt-2 grid gap-2 sm:grid-cols-3"><input type="hidden" name="cycleId" value={c.id} /><input type="hidden" name="employeeId" value={e.id} /><input type="hidden" name="voltar" value={voltar} />
              <Field label="Meta"><Input name="titulo" required /></Field><Field label="Indicador"><Input name="indicador" /></Field><Field label="Alvo"><Input name="meta" /></Field><Field label="Resultado"><Input name="resultado" /></Field><Field label="Peso"><Input name="peso" type="number" min={1} defaultValue={1} /></Field><Field label="Atingimento (%)"><Input name="atingimento" type="number" min={0} max={150} /></Field><Field label="Situação"><Select name="status" defaultValue="EM_ANDAMENTO">{Object.entries(GOAL_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field><div className="flex items-end"><Btn small>Salvar meta</Btn></div></form></details>}
          </Card>
          <Card title="PDI — plano de desenvolvimento">
            {pdi.length === 0 ? <p className="text-sm text-slate-500">O PDI é definido pelo gestor na avaliação.</p> : <ul className="divide-y divide-line">{pdi.map((it, i) => <li key={i} className="flex items-start gap-3 py-2"><form action={atualizarPdi}><input type="hidden" name="id" value={rid} /><input type="hidden" name="idx" value={i} /><input type="hidden" name="voltar" value={voltar} /><button aria-label="pdi" className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded border text-xs ${it.status === "CONCLUIDA" ? "border-ok bg-ok text-white" : "border-slate-400 bg-white"}`}>{it.status === "CONCLUIDA" ? "✓" : ""}</button></form><span className={`text-sm ${it.status === "CONCLUIDA" ? "text-slate-500 line-through" : ""}`}>{it.acao}{it.prazo && <span className="ml-2 text-xs text-slate-500">até {fmtData(it.prazo)}</span>}</span></li>)}</ul>}
          </Card>
          {checkins.length > 0 && <Card title="Conversas 1:1 recentes"><ul className="space-y-2 text-sm">{checkins.map(k => <li key={k.id}><span className="text-xs text-slate-500">{fmtData(k.data)}</span> · {k.temas}{k.combinados && <div className="text-xs text-slate-600">Combinados: {k.combinados}</div>}</li>)}</ul></Card>}
        </div>
        <div className="space-y-4 print:hidden">
          {proprio && c.status === "ABERTO" && <Card title="Minha autoavaliação"><form action={autoavaliar} className="space-y-2"><input type="hidden" name="id" value={rid} /><input type="hidden" name="voltar" value={voltar} />
            {comps.map((k, i) => <Field key={k} label={k}><Select name={`a_${i}`} defaultValue={auto.notas?.[k] ?? ""}><option value="">—</option>{esc.map(n => <option key={n} value={n}>{n}</option>)}</Select></Field>)}
            <Field label="Principais realizações no período"><Textarea name="realizacoes" className="min-h-[70px]" defaultValue={auto.realizacoes ?? ""} /></Field><Field label="Comentário"><Textarea name="autoComentario" className="min-h-[50px]" defaultValue={auto.comentario ?? ""} /></Field><Btn small>Salvar autoavaliação</Btn></form></Card>}
          {avaliador && aberto && <Card title="Avaliação do gestor"><form action={avaliarGestor} className="space-y-2"><input type="hidden" name="id" value={rid} />
            {comps.map((k, i) => <Field key={k} label={k} hint={auto.notas?.[k] ? `autoavaliação: ${auto.notas[k]}` : undefined}><Select name={`g_${i}`} defaultValue={g.notas?.[k] ?? ""} required><option value="">—</option>{esc.map(n => <option key={n} value={n}>{n}</option>)}</Select></Field>)}
            <Field label="Potencial" hint="1 baixo · 2 médio · 3 alto — capacidade de assumir mais responsabilidade"><Select name="potencial" defaultValue={r.potencial ?? ""} required><option value="">—</option>{[1, 2, 3].map(n => <option key={n} value={n}>{n} · {NIVEL_LABEL[n]}</option>)}</Select></Field>
            <Field label="Pontos fortes"><Textarea name="pontosFortes" className="min-h-[50px]" defaultValue={g.pontosFortes ?? ""} /></Field><Field label="A desenvolver"><Textarea name="melhorias" className="min-h-[50px]" defaultValue={g.melhorias ?? ""} /></Field><Field label="Comentário"><Input name="gestorComentario" defaultValue={g.comentario ?? ""} /></Field>
            <div className="text-xs font-medium text-slate-600">PDI — até 3 ações</div>{[1, 2, 3].map(i => <div key={i} className="grid grid-cols-[1fr_120px] gap-1"><Input name={`pdi_${i}`} placeholder={`Ação ${i}`} defaultValue={pdi[i - 1]?.acao ?? ""} /><Input name={`pdiPrazo_${i}`} type="date" defaultValue={pdi[i - 1]?.prazo ?? ""} /></div>)}
            <Btn small>Salvar avaliação</Btn></form></Card>}
          {podeCal && ["AVALIADA", "CALIBRADA"].includes(r.status) && c.status !== "ENCERRADO" && <Card title="Calibração"><form action={calibrar} className="space-y-2"><input type="hidden" name="id" value={rid} /><input type="hidden" name="voltar" value={voltar} />
            <Field label="Nível de desempenho"><Select name="desempenhoNivel" defaultValue={r.desempenhoNivel ?? ""}>{[1, 2, 3].map(n => <option key={n} value={n}>{n} · {NIVEL_LABEL[n]}</option>)}</Select></Field><Field label="Potencial"><Select name="potencial" defaultValue={r.potencial ?? ""}>{[1, 2, 3].map(n => <option key={n} value={n}>{n} · {NIVEL_LABEL[n]}</option>)}</Select></Field><Field label="Justificativa"><Input name="nota" defaultValue={r.calibracaoNota ?? ""} /></Field><Btn small kind="ghost">Registrar calibração</Btn></form></Card>}
          <Card title="Resumo"><dl className="space-y-1 text-sm"><div><dt className="text-xs text-slate-500">Colaborador</dt><dd><Link className="text-acao" href={`/colaboradores/${e.id}`}>{e.nome}</Link></dd></div><div><dt className="text-xs text-slate-500">Nota final</dt><dd className="text-xl font-semibold tabular-nums text-navy">{r.notaFinal ?? "—"}</dd></div><div><dt className="text-xs text-slate-500">Desempenho × potencial</dt><dd>{r.desempenhoNivel ? NIVEL_LABEL[r.desempenhoNivel] : "—"} × {r.potencial ? NIVEL_LABEL[r.potencial] : "—"}</dd></div><div><dt className="text-xs text-slate-500">Atualizada</dt><dd className="text-xs">{fmtDataHora(r.updatedAt)}</dd></div></dl></Card>
        </div>
      </div>
    </Page>
  );
}
