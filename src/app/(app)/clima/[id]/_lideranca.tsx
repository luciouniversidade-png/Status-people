// v30 · resultado da pesquisa de liderança: índice por gestor (com o mínimo de respostas), pontos de atenção e práticas sugeridas
import Link from "@/components/Link";
import type { Session } from "@/lib/auth";
import { scopeUnit, can } from "@/lib/auth";
import { Card, Table, Td, Stat, Badge } from "@/components/ui";
import { getSettings } from "@/lib/utils";
import type { Pergunta } from "@/lib/clima-academy";
import { resultadosLideranca, ACOES_LIDERANCA } from "@/lib/lideranca";

const cor = (v: number | null, alvo: number, atencao: number) => (v === null ? "text-slate-400" : v >= alvo ? "text-ok" : v >= atencao ? "text-aviso" : "text-erro");

export async function LiderancaResultado({ s, surveyId, perguntas, minimo }: { s: Session; surveyId: number; perguntas: Pergunta[]; minimo: number }) {
  const cfg = await getSettings(); const li = cfg.clima.lideranca; const alvo = Number(li.favoravelAlvo), atencao = Number(li.atencaoAbaixo);
  const r = await resultadosLideranca(surveyId, perguntas, minimo, atencao);
  const u = scopeUnit(s); const tudo = can.editar(s);
  const visiveis = tudo ? r.lista : s.role === "DIRETOR_UNIDADE" ? r.lista.filter(l => l.unitId === u) : r.lista.filter(l => l.gestorId === s.employeeId);
  const dims = r.pontos.map(p => p.dimensao);
  return <>
    <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
      <Stat label="Índice de efetividade da liderança (rede)" value={r.indiceRede === null ? "—" : <span className={cor(r.indiceRede, alvo, atencao)}>{r.indiceRede}%</span>} hint={`respostas favoráveis (4–5) · alvo ${alvo}%`} />
      <Stat label="Gestores com resultado" value={r.gestoresComMinimo} hint={`${r.gestoresAbaixoMinimo} com menos de ${r.minimo} respostas (protegidos)`} />
      <Stat label="Abaixo do alvo" value={r.lista.filter(l => l.indice !== null && l.indice < alvo).length} hint={`de ${r.gestoresComMinimo} com resultado`} />
      <Stat label="Respostas" value={r.total} hint={r.semGestor ? `${r.semGestor} sem gestor indicado` : "todas com o gestor indicado"} />
    </div>
    {r.gestoresComMinimo > 0 && <Card className="mb-4" title="Pontos de atenção — onde a liderança precisa de apoio">
      <ul className="space-y-2">{r.pontos.filter(p => p.abaixo > 0).map(p => <li key={p.dimensao} className="rounded-md border border-amber-200 bg-amber-50 p-2 text-sm"><div><b>{p.abaixo} de {p.de}</b> gestor(es) com <b>{p.dimensao}</b> abaixo de {atencao}% favorável{p.rede !== null ? ` · rede: ${p.rede}%` : ""}</div>
        {(ACOES_LIDERANCA[p.dimensao] ?? []).length > 0 && <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">{ACOES_LIDERANCA[p.dimensao].map(a => <li key={a.texto}>→ <Link className="text-acao" href={a.href}>{a.texto}</Link></li>)}</ul>}</li>)}
        {r.pontos.every(p => p.abaixo === 0) && <li className="text-sm text-ok">Nenhuma dimensão abaixo de {atencao}% para os gestores com resultado.</li>}</ul>
      <p className="mt-2 text-[11px] text-slate-500">O índice apoia a conversa de desenvolvimento do gestor — não é nota de desempenho nem ranking público.</p>
    </Card>}
    <Card className="mb-4" title={tudo ? "Resultado por gestor" : s.role === "DIRETOR_UNIDADE" ? "Resultado dos gestores da unidade" : "O seu resultado"}>
      <Table denso head={["Gestor", "Respostas", "Índice", ...dims.map(d => d.split(" ")[0]), "Recomendação"]} empty={tudo ? "Nenhuma resposta ainda." : "Sem resultado para você nesta pesquisa (ou menos respostas que o mínimo)."}>{visiveis.map(l => <tr key={l.gestorId}><Td><div className="font-medium text-ink">{l.nome}</div><div className="text-[11px] text-slate-500">{l.unidade}</div>{l.atencao.length > 0 && <div className="mt-0.5"><Badge v="PENDENTE" label={`atenção: ${l.atencao.length}`} /></div>}</Td><Td className="tabular-nums">{l.n}</Td>
        {l.liberado ? <><Td className={`font-semibold tabular-nums ${cor(l.indice, alvo, atencao)}`}>{l.indice}%</Td>{l.porDimensao.map(d => <Td key={d.dimensao} className={`tabular-nums ${cor(d.favoravel, alvo, atencao)}`}>{d.favoravel ?? "—"}</Td>)}<Td className="tabular-nums">{l.nps ?? "—"}</Td></> : <Td colSpan={dims.length + 2}><span className="text-xs text-slate-400">menos de {r.minimo} respostas — protegido</span></Td>}</tr>)}</Table>
      <p className="mt-2 text-[11px] text-slate-500">Índice = % de respostas 4 ou 5 nas dimensões. Recomendação = promotores (9–10) − detratores (0–6). Cada gestor vê o próprio resultado em Minha equipe → “Liderança na visão da equipe” (com o mínimo de respostas).</p>
      {tudo && visiveis.some(l => l.comentarios.length) && <details className="mt-3"><summary className="cursor-pointer text-xs text-acao">Comentários por gestor (só RH e Direção)</summary><div className="mt-2 space-y-2">{visiveis.filter(l => l.comentarios.length).map(l => <div key={l.gestorId}><div className="text-xs font-semibold text-navy">{l.nome}</div><ul className="space-y-1 text-xs">{l.comentarios.map((c, i) => <li key={i} className="rounded bg-mist px-2 py-1 whitespace-pre-wrap">{c}</li>)}</ul></div>)}</div></details>}
    </Card>
  </>;
}
