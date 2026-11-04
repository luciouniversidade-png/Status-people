// v31 · Relatório 360°: por avaliado, a autoavaliação, o gestor, os pares e os liderados (só grupos com o mínimo de respondentes),
// os pontos cegos (a pessoa se vê bem acima de como os outros a veem) e as forças ocultas (o contrário).
import Link from "@/components/Link";
import { notFound, redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, scopeUnit } from "@/lib/auth";
import { Page, Card, Table, Td, Select, Btn, Badge } from "@/components/ui";
import { agregarFontes, fmtNota, type Criterio, type RespostaFonte } from "@/lib/avaliacao";
import { RELACAO_360 } from "@/lib/participantes360";
import { NavCiclo } from "../_nav";

export const dynamic = "force-dynamic";
const LIMIAR = 1; // diferença (em pontos da escala 1–5) entre como a pessoa se vê e como os outros a veem

export default async function Relatorio360({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const { id } = await params; const sp = await searchParams; const cid = Number(id); const u = scopeUnit(s);
  const [c] = await sql<{ id: number; nome: string; criterios: Criterio[] | null; fontes: Record<string, { peso: number; minimo: number }> | null }[]>`SELECT id, nome, criterios, fontes FROM perf_cycles WHERE id=${cid}`; if (!c) notFound();
  const gestao = ["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR"].includes(s.role);
  if (!gestao && !s.employeeId) redirect("/desempenho/minha");
  const revs = await sql<{ id: number; employee_id: number; nome: string; unidade: string | null; estado: string; avaliador_user_id: number | null; gestor_id: number | null; auto_criterios: { notas?: Record<string, { nota?: number }> } | null; notas_criterios: Record<string, { nota?: number; na?: boolean }> | null }[]>`
    SELECT r.id, e.id AS employee_id, e.nome, un.nome AS unidade, r.estado, r.avaliador_user_id, e.gestor_id, r.auto_criterios, r.notas_criterios FROM perf_reviews r JOIN employees e ON e.id=r.employee_id LEFT JOIN units un ON un.id=e.unit_id
    WHERE r.cycle_id=${cid} ${gestao ? (u === null ? sql`` : sql`AND e.unit_id=${u}`) : sql`AND e.id=${s.employeeId ?? -1} AND r.estado IN ('PUBLICADA','CONTESTADA')`} ${s.role === "GESTOR" ? sql`AND (r.avaliador_user_id=${s.id} OR e.gestor_id=${s.employeeId ?? -1})` : sql``} ORDER BY e.nome`;
  const crit = (c.criterios ?? []).filter(x => x.eixo !== "TECNICA"); const fontes = c.fontes ?? null;
  const raters = revs.length ? await sql<{ review_id: number; grupo: string; status: string; notas: RespostaFonte | null; comentario: string | null }[]>`SELECT review_id, grupo, status, notas, comentario FROM review_raters WHERE review_id = ANY(${revs.map(r => r.id)}::int[])` : [];
  const media = (xs: (number | null | undefined)[]) => { const v = xs.filter((x): x is number => typeof x === "number"); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const resumo = revs.map(r => {
    const porGrupo: Record<string, RespostaFonte[]> = {}; raters.filter(x => x.review_id === r.id && x.status === "RESPONDIDO" && x.notas).forEach(x => (porGrupo[x.grupo] ??= []).push(x.notas!));
    const ag = fontes && crit.length ? agregarFontes(crit, porGrupo, fontes) : null;
    const linhas = crit.map(cr => { const auto = r.auto_criterios?.notas?.[cr.id]?.nota ?? null; const gest = r.notas_criterios?.[cr.id]?.nota ?? null; const pares = ag?.grupos.PAR?.valido ? ag.grupos.PAR.medias[cr.id] : null; const lid = ag?.grupos.LIDERADO?.valido ? ag.grupos.LIDERADO.medias[cr.id] : null;
      const outros = media([gest, pares, lid]); const gap = auto !== null && outros !== null ? auto - outros : null; return { cr, auto, gest, pares, lid, outros, gap }; });
    return { r, ag, linhas, auto: media(linhas.map(l => l.auto)), gest: media(linhas.map(l => l.gest)), pares: media(linhas.map(l => l.pares)), lid: media(linhas.map(l => l.lid)), cegos: linhas.filter(l => l.gap !== null && l.gap >= LIMIAR).length, ocultas: linhas.filter(l => l.gap !== null && l.gap <= -LIMIAR).length, nPar: porGrupo.PAR?.length ?? 0, nLid: porGrupo.LIDERADO?.length ?? 0 };
  });
  const sel = resumo.find(x => x.r.id === Number(sp.avaliado)) ?? (resumo.length === 1 ? resumo[0] : null);
  const comentarios = sel && sel.ag ? raters.filter(x => x.review_id === sel.r.id && x.status === "RESPONDIDO" && x.comentario && sel.ag!.grupos[x.grupo]?.valido).map(x => ({ grupo: x.grupo, texto: x.comentario! })).sort((a, b) => a.texto.localeCompare(b.texto)) : [];
  const n = (v: number | null) => (v === null ? "—" : fmtNota(v));
  return (
    <Page title={`Relatório 360° · ${c.nome}`} sub="Como cada pessoa se vê × como o gestor, os pares e os liderados a veem — por critério. Grupos abaixo do mínimo de respondentes não aparecem (anonimato).">
      {gestao && <NavCiclo cid={cid} atual="/relatorio-360" />}
      {crit.length === 0 ? <Card><p className="text-sm text-slate-500">Este ciclo não usa avaliação por critérios — o relatório 360° compara critério a critério.</p></Card> : <>
        {gestao && <Card className="mb-4" title={`Resumo (${resumo.length} avaliado(s))`}>
          <Table head={["Avaliado", "Auto", "Gestor", `Pares${fontes?.PAR ? ` (mín. ${fontes.PAR.minimo})` : ""}`, `Liderados${fontes?.LIDERADO ? ` (mín. ${fontes.LIDERADO.minimo})` : ""}`, "Pontos cegos", "Forças ocultas"]} empty="Nenhuma avaliação no seu escopo.">{resumo.map(x => <tr key={x.r.id} className={sel?.r.id === x.r.id ? "bg-sky-50/60" : ""}>
            <Td><Link className="font-medium text-acao" href={`/desempenho/ciclos/${cid}/relatorio-360?avaliado=${x.r.id}`}>{x.r.nome}</Link><div className="text-xs text-slate-500">{x.r.unidade ?? "—"}</div></Td>
            <Td className="tabular-nums">{n(x.auto)}</Td><Td className="tabular-nums">{n(x.gest)}</Td>
            <Td className="tabular-nums">{x.ag?.grupos.PAR?.valido ? n(x.pares) : <span className="text-xs text-slate-400">{x.nPar} resp.</span>}</Td>
            <Td className="tabular-nums">{x.ag?.grupos.LIDERADO?.valido ? n(x.lid) : <span className="text-xs text-slate-400">{fontes?.LIDERADO ? `${x.nLid} resp.` : "—"}</span>}</Td>
            <Td>{x.cegos ? <Badge v="PENDENTE" label={String(x.cegos)} /> : <span className="text-xs text-slate-400">0</span>}</Td><Td>{x.ocultas ? <Badge v="APROVADA" label={String(x.ocultas)} /> : <span className="text-xs text-slate-400">0</span>}</Td></tr>)}</Table>
          <p className="mt-2 text-[11px] text-slate-500">Médias na escala 1–5. Ponto cego: a autoavaliação está {LIMIAR} ponto(s) ou mais acima da média dos outros olhares; força oculta: {LIMIAR} ponto(s) ou mais abaixo. É matéria para conversa (1:1, devolutiva, PDI) — não muda nota.</p>
        </Card>}
        {gestao && resumo.length > 1 && <form className="mb-4 flex flex-wrap items-end gap-2"><Select name="avaliado" defaultValue={sel ? String(sel.r.id) : ""} aria-label="Avaliado" className="!w-72"><option value="">Escolha um avaliado…</option>{resumo.map(x => <option key={x.r.id} value={x.r.id}>{x.r.nome}</option>)}</Select><Btn small kind="ghost">Ver o detalhe</Btn></form>}
        {sel && <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
          <Card title={`${sel.r.nome} — critério a critério`}>
            <Table head={["Critério", "Auto", "Gestor", "Pares", "Liderados", "Outros (média)", "Leitura"]}>{sel.linhas.map(l => <tr key={l.cr.id}><Td className="text-sm">{l.cr.titulo}</Td><Td className="tabular-nums">{n(l.auto)}</Td><Td className="tabular-nums">{n(l.gest)}</Td><Td className="tabular-nums">{n(l.pares)}</Td><Td className="tabular-nums">{n(l.lid)}</Td><Td className="tabular-nums font-medium">{n(l.outros)}</Td>
              <Td className="text-xs">{l.gap === null ? <span className="text-slate-400">—</span> : l.gap >= LIMIAR ? <Badge v="PENDENTE" label="ponto cego" /> : l.gap <= -LIMIAR ? <Badge v="APROVADA" label="força oculta" /> : <span className="text-slate-500">alinhado</span>}</Td></tr>)}</Table>
            <p className="mt-2 text-[11px] text-slate-500">{sel.ag?.grupos.PAR ? `Pares: ${sel.nPar} resposta(s)${sel.ag.grupos.PAR.valido ? "" : " — abaixo do mínimo, não aparece"}. ` : ""}{sel.ag?.grupos.LIDERADO ? `Liderados: ${sel.nLid} resposta(s)${sel.ag.grupos.LIDERADO.valido ? "" : " — abaixo do mínimo, não aparece"}.` : ""} <Link className="text-acao" href={`/desempenho/avaliacoes/${sel.r.id}`}>Abrir a avaliação</Link></p>
          </Card>
          <div className="space-y-4">
            <Card title="Para a conversa"><ul className="space-y-1 text-sm">{sel.linhas.filter(l => l.gap !== null && Math.abs(l.gap) >= LIMIAR).length === 0 ? <li className="text-slate-500">Sem diferenças grandes entre a autoavaliação e os outros olhares.</li> : sel.linhas.filter(l => l.gap !== null && Math.abs(l.gap) >= LIMIAR).map(l => <li key={l.cr.id}>{l.gap! > 0 ? "🔎" : "💡"} <b>{l.cr.titulo}</b> <span className="text-xs text-slate-500">· se vê {n(l.auto)} × outros {n(l.outros)}</span></li>)}</ul>
              <div className="mt-3 flex flex-wrap gap-2"><Btn small kind="ghost" href={`/um-a-um?marcar=${sel.r.employee_id}`}>Marcar 1:1</Btn><Btn small kind="ghost" href={`/colaboradores/${sel.r.employee_id}/painel?aba=pdi`}>Abrir o PDI</Btn></div></Card>
            <Card title={`Comentários dos grupos (${comentarios.length})`}>{comentarios.length === 0 ? <p className="text-sm text-slate-500">Sem comentários de grupos com o mínimo de respondentes.</p> : <ul className="space-y-1.5 text-sm">{comentarios.map((x, i) => <li key={i} className="rounded-md bg-mist px-2 py-1"><span className="text-[11px] font-semibold text-slate-500">{RELACAO_360[x.grupo] ?? x.grupo}</span><div>{x.texto}</div></li>)}</ul>}<p className="mt-2 text-[11px] text-slate-500">Sem nome de quem escreveu, em ordem alfabética (não na ordem de resposta).</p></Card>
          </div>
        </div>}
      </>}
    </Page>
  );
}
