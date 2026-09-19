import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema, sql } from "@/db";
import { requireStaff, can, scopeUnit } from "@/lib/auth";
import { Page, Card, Badge, Flash, Field, Input, Select, Btn, Stat } from "@/components/ui";
import { fmtData } from "@/lib/utils";
import { sinaisPessoas, CLASSIF, NIVEL3 } from "@/lib/talentos-analytics";
import { NIVEL_LABEL } from "@/lib/talento";
import { salvarItemReview, encerrarTalentReview } from "../../../sucessao-analytics/actions";

export const dynamic = "force-dynamic";

export default async function Review({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaff(); if (!can.editar(s)) redirect("/sucessao"); const { id } = await params; const sp = await searchParams; const rid = Number(id);
  const [r] = await db.select().from(schema.talentReviews).where(eq(schema.talentReviews.id, rid)); if (!r) notFound();
  const [pessoas, itens, users] = await Promise.all([sinaisPessoas(scopeUnit(s)), db.select().from(schema.talentReviewItems).where(eq(schema.talentReviewItems.reviewId, rid)), sql<{ id: number; nome: string }[]>`SELECT id, nome FROM users WHERE ativo AND role IN ('RH','DIRECAO','DIRETOR_UNIDADE','GESTOR') ORDER BY nome`]);
  const so = sp.so ?? "SINAIS"; const lista = so === "SINAIS" ? pessoas.filter(p => p.nota !== null || p.fatores.length > 0 || itens.some(i => i.employeeId === p.id)) : pessoas;
  const classificados = itens.length; const chave = itens.filter(i => ["TALENTO_CHAVE", "ALTO_POTENCIAL"].includes(i.classificacao)).length; const riscoAlto = itens.filter(i => i.riscoPerda === "ALTO").length;
  return (
    <Page title={r.nome} sub={<span className="flex flex-wrap items-center gap-2"><Badge v={r.status === "REALIZADO" ? "APROVADA" : "PENDENTE"} label={r.status === "REALIZADO" ? "Realizado" : "Planejado"} /> {fmtData(r.data)} · <Link className="text-acao" href="/sucessao">sucessão</Link></span>}
      actions={r.status !== "REALIZADO" ? <form action={encerrarTalentReview} className="flex items-end gap-2"><input type="hidden" name="id" value={rid} /><Input name="notas" placeholder="Notas da reunião" className="!w-64" /><Btn>Registrar como realizado</Btn></form> : undefined}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4"><Stat label="Pessoas classificadas" value={`${classificados}/${pessoas.length}`} /><Stat label="Talentos-chave e alto potencial" value={<span className="text-ok">{chave}</span>} /><Stat label="Risco de perda alto" value={<span className={riscoAlto ? "text-erro" : ""}>{riscoAlto}</span>} /><Stat label="Com plano de retenção" value={itens.filter(i => i.acao).length} /></div>
      <form className="mb-3 flex items-end gap-2"><Field label="Mostrar"><Select name="so" defaultValue={so}><option value="SINAIS">Com avaliação, sinais ou já classificados</option><option value="TODOS">Todos os ativos</option></Select></Field><Btn kind="ghost">Filtrar</Btn></form>
      <Card title="Lista de talentos — sugestão automática e decisão da Direção">
        <p className="mb-3 text-xs text-slate-500">Sugestão = último ciclo de desempenho (desempenho × potencial). Sinais = risco de saída calculado (salário, reajuste, faltas, 1:1, PDI, treinamento). A classificação final é sempre humana.</p>
        <div className="overflow-x-auto"><table className="w-full text-xs"><thead className="bg-mist text-slate-600"><tr><th className="px-2 py-2 text-left">Colaborador</th><th className="px-2 py-2 text-left">Cargo · unidade</th><th className="px-2 py-2">Tempo</th><th className="px-2 py-2">Último ciclo</th><th className="px-2 py-2 text-left">Sinais de risco</th><th className="px-2 py-2 text-left">Sugestão</th><th className="px-2 py-2 text-left">Decisão</th></tr></thead>
          <tbody className="divide-y divide-line">{lista.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500">Ninguém com sinais ainda — encerre um ciclo de desempenho ou mostre todos.</td></tr>}
            {lista.map(p => { const it = itens.find(i => i.employeeId === p.id); return <tr key={p.id} className="align-top"><td className="px-2 py-2"><Link className="font-medium text-acao" href={`/colaboradores/${p.id}`}>{p.nome}</Link></td><td className="px-2 py-2">{p.cargo ?? "—"}{p.nivel ? ` (${p.nivel})` : ""}<div className="text-slate-500">{p.unidade}</div></td><td className="px-2 py-2 text-center">{p.tempoCasaAnos} a</td><td className="px-2 py-2 text-center">{p.nota !== null ? <>{p.nota.toFixed(1)}<div className="text-slate-500">D {p.desempenho ? NIVEL_LABEL[p.desempenho][0] : "—"} · P {p.potencial ? NIVEL_LABEL[p.potencial][0] : "—"}</div></> : "—"}</td>
              <td className="px-2 py-2">{p.fatores.length ? <><Badge v={p.nivel === "ALTO" ? "REJEITADA" : p.nivel === "MEDIO" ? "PENDENTE" : "ATIVO"} label={`${p.pontos} pts`} /><div className="text-slate-600">{p.fatores.map(f => f.texto).join(" · ")}</div></> : <span className="text-slate-400">sem sinais</span>}</td>
              <td className="px-2 py-2"><Badge v={p.sugestao === "TALENTO_CHAVE" ? "APROVADA" : p.sugestao === "ALTO_POTENCIAL" ? "ATIVO" : p.sugestao === "ATENCAO" ? "REJEITADA" : "EM_AQUISICAO"} label={CLASSIF[p.sugestao]} /></td>
              <td className="px-2 py-2">{r.status === "REALIZADO" && !it ? <span className="text-slate-400">—</span> : r.status === "REALIZADO" ? <div><Badge v={it!.classificacao === "TALENTO_CHAVE" ? "APROVADA" : it!.classificacao === "ATENCAO" ? "REJEITADA" : "ATIVO"} label={CLASSIF[it!.classificacao]} /><div className="text-slate-600">risco {NIVEL3[it!.riscoPerda].toLowerCase()} · impacto {NIVEL3[it!.impactoPerda].toLowerCase()}</div>{it!.acao && <div>{it!.acao}</div>}</div> :
                <form action={salvarItemReview} className="grid w-64 gap-1"><input type="hidden" name="reviewId" value={rid} /><input type="hidden" name="employeeId" value={p.id} />
                  <Select name="classificacao" defaultValue={it?.classificacao ?? p.sugestao} className="!py-1 !text-xs">{Object.entries(CLASSIF).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
                  <div className="grid grid-cols-2 gap-1"><Select name="riscoPerda" defaultValue={it?.riscoPerda ?? (p.nivel === "ALTO" ? "ALTO" : p.nivel === "MEDIO" ? "MEDIO" : "BAIXO")} className="!py-1 !text-xs">{Object.entries(NIVEL3).map(([k, v]) => <option key={k} value={k}>risco {v.toLowerCase()}</option>)}</Select><Select name="impactoPerda" defaultValue={it?.impactoPerda ?? "MEDIO"} className="!py-1 !text-xs">{Object.entries(NIVEL3).map(([k, v]) => <option key={k} value={k}>impacto {v.toLowerCase()}</option>)}</Select></div>
                  <Input name="acao" placeholder="Ação de retenção / desenvolvimento" defaultValue={it?.acao ?? ""} className="!py-1 !text-xs" /><div className="grid grid-cols-2 gap-1"><Select name="responsavelUserId" defaultValue={it?.responsavelUserId ?? s.id} className="!py-1 !text-xs">{users.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select><Input name="prazo" type="date" defaultValue={it?.prazo ?? ""} className="!py-1 !text-xs" /></div>
                  <Btn small kind={it ? "ghost" : "primary"}>{it ? "Atualizar" : "Classificar"}</Btn></form>}</td></tr>; })}</tbody></table></div>
      </Card>
      {r.notas && <Card title="Notas da reunião" className="mt-4"><p className="whitespace-pre-wrap text-sm">{r.notas}</p></Card>}
    </Page>
  );
}
