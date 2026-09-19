import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStaff, scopeUnit, can } from "@/lib/auth";
import { db, schema, sql } from "@/db";
import { asc } from "drizzle-orm";
import { Page, Card, Table, Td, Badge, Flash, Field, Input, Select, Textarea, Btn, Stat } from "@/components/ui";
import { fmtData } from "@/lib/utils";
import { mapaSucessao, busFactor, PRONTIDAO, NIVEL3 } from "@/lib/talentos-analytics";
import { salvarPosicaoCritica, excluirPosicaoCritica, salvarSucessor, criarTalentReview } from "../sucessao-analytics/actions";

export const dynamic = "force-dynamic";

export default async function Sucessao({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaff(); if (!["RH", "DIRECAO", "DIRETOR_UNIDADE"].includes(s.role)) redirect("/"); const sp = await searchParams; const u = scopeUnit(s);
  const [mapa, bus, positions, units, emps, reviews] = await Promise.all([mapaSucessao(u), busFactor(u), db.select().from(schema.positions).orderBy(asc(schema.positions.ordem)), db.select().from(schema.units).orderBy(asc(schema.units.nome)),
    sql<{ id: number; nome: string; unidade: string; cargo: string | null }[]>`SELECT e.id, e.nome, un.nome AS unidade, p.nome AS cargo FROM employees e JOIN units un ON un.id=e.unit_id LEFT JOIN positions p ON p.id=e.position_id WHERE e.situacao='ATIVO' ${u === null ? sql`` : sql`AND e.unit_id=${u}`} ORDER BY e.nome`,
    sql<{ id: number; nome: string; data: string; status: string; itens: number; chave: number; risco_alto: number }[]>`SELECT r.id, r.nome, r.data::text, r.status, (SELECT count(*) FROM talent_review_items i WHERE i.review_id=r.id)::int AS itens, (SELECT count(*) FROM talent_review_items i WHERE i.review_id=r.id AND i.classificacao IN ('TALENTO_CHAVE','ALTO_POTENCIAL'))::int AS chave, (SELECT count(*) FROM talent_review_items i WHERE i.review_id=r.id AND i.risco_perda='ALTO')::int AS risco_alto FROM talent_reviews r ORDER BY r.data DESC`]);
  return (
    <Page title="Sucessão e talentos" sub="Se alguém sair amanhã, quem assume? Posições críticas, sucessores por prontidão, dependências de uma única pessoa e talent review." actions={<Btn kind="ghost" href="/analytics">People Analytics</Btn>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="Bench strength" value={mapa.bench === null ? "—" : <span className={mapa.bench >= 70 ? "text-ok" : mapa.bench >= 40 ? "text-aviso" : "text-erro"}>{mapa.bench}%</span>} hint={`${mapa.comPronto} de ${mapa.posicoes.length} posições críticas com sucessor pronto`} />
        <Stat label="Posições sem sucessor" value={<span className={mapa.semSucessor ? "text-erro" : ""}>{mapa.semSucessor}</span>} />
        <Stat label="Dependências de uma pessoa" value={bus.unicos.length} hint="cargos de direção/administrativo com um único ocupante na unidade" />
        <Stat label="Talent reviews" value={reviews.length} hint={reviews[0] ? `último: ${fmtData(reviews[0].data)}` : "nenhum ainda"} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_360px] lg:items-start">
        <div className="space-y-4">
          <Card title="Mapa de sucessão">
            <Table head={["Posição crítica", "Titular", "Criticidade", "Risco de saída", "Sucessores", ""]} empty="Nenhuma posição crítica mapeada. Comece pelo lado: direção, coordenação, secretaria, financeiro.">
              {mapa.posicoes.map(p => <tr key={p.id}><Td><div className="font-medium">{p.cargo}</div><div className="text-xs text-slate-500">{p.unidade ?? "rede"}{p.motivo ? ` · ${p.motivo}` : ""}</div>{p.contingencia && <div className="text-xs text-slate-600">Contingência: {p.contingencia}</div>}</Td><Td>{p.titular ? <Link className="text-acao" href={`/colaboradores/${p.titular_id}`}>{p.titular}</Link> : <span className="text-aviso">vaga / não informado</span>}</Td><Td><Badge v={p.criticidade === 3 ? "REJEITADA" : p.criticidade === 2 ? "PENDENTE" : "EM_AQUISICAO"} label={p.criticidade === 3 ? "Crítica" : p.criticidade === 2 ? "Alta" : "Média"} /></Td><Td><Badge v={p.risco_saida === "ALTO" ? "REJEITADA" : p.risco_saida === "MEDIO" ? "PENDENTE" : "ATIVO"} label={NIVEL3[p.risco_saida]} /></Td>
                <Td>{p.sucessores.length === 0 ? <span className="text-xs text-erro">nenhum</span> : <ul className="space-y-0.5 text-xs">{p.sucessores.map(sc => <li key={sc.id}><Link className="text-acao" href={`/colaboradores/${sc.employee_id}`}>{sc.nome}</Link> · <Badge v={sc.prontidao === "PRONTO" ? "APROVADA" : sc.prontidao === "UM_DOIS_ANOS" ? "PENDENTE" : "EM_AQUISICAO"} label={PRONTIDAO[sc.prontidao]} />{sc.plano && <div className="text-slate-500">{sc.plano}</div>}</li>)}</ul>}
                  <details className="mt-1"><summary className="cursor-pointer text-xs text-acao">+ sucessor</summary><form action={salvarSucessor} className="mt-1 space-y-1 text-xs"><input type="hidden" name="criticalPositionId" value={p.id} /><Select name="employeeId" className="!py-1 !text-xs" required><option value="">Colaborador</option>{emps.map(e => <option key={e.id} value={e.id}>{e.nome} · {e.cargo ?? ""}</option>)}</Select><Select name="prontidao" defaultValue="EM_DESENVOLVIMENTO" className="!py-1 !text-xs">{Object.entries(PRONTIDAO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select><Input name="plano" placeholder="Plano de preparação" className="!py-1 !text-xs" /><Btn small>Adicionar</Btn></form></details></Td>
                <Td><form action={excluirPosicaoCritica}><input type="hidden" name="id" value={p.id} /><button className="text-xs text-erro">remover</button></form></Td></tr>)}
            </Table>
          </Card>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card title="Bus factor — dependências de uma única pessoa">
              <Table head={["Cargo", "Unidade", "Pessoa"]} empty="Nenhum cargo de direção/administrativo com ocupante único.">{bus.unicos.map((x, i) => <tr key={i}><Td>{x.cargo}</Td><Td>{x.unidade}</Td><Td><Link className="text-acao" href={`/colaboradores/${x.employee_id}`}>{x.nome}</Link></Td></tr>)}</Table>
              {(bus.pops.length > 0 || bus.controles.length > 0) && <ul className="mt-2 space-y-0.5 text-xs text-slate-600">{bus.pops.map((p, i) => <li key={"p" + i}>{p.nome} é dono de {p.n} POPs vigentes ({p.itens})</li>)}{bus.controles.map((c, i) => <li key={"c" + i}>{c.nome} responde por {c.n} controles</li>)}</ul>}
            </Card>
            <Card title="Talent reviews">
              <Table head={["Review", "Data", "Situação", "Pessoas", "Talentos", "Risco alto"]} empty="Nenhum talent review.">{reviews.map(r => <tr key={r.id}><Td><Link className="text-acao" href={`/sucessao/review/${r.id}`}>{r.nome}</Link></Td><Td className="text-xs">{fmtData(r.data)}</Td><Td><Badge v={r.status === "REALIZADO" ? "APROVADA" : "PENDENTE"} label={r.status === "REALIZADO" ? "Realizado" : "Planejado"} /></Td><Td>{r.itens}</Td><Td className="text-ok">{r.chave}</Td><Td className={r.risco_alto ? "text-erro" : ""}>{r.risco_alto}</Td></tr>)}</Table>
              {can.editar(s) && <form action={criarTalentReview} className="mt-3 grid gap-2 border-t border-line pt-3 sm:grid-cols-[1fr_130px_auto]"><Field label="Nome"><Input name="nome" required placeholder="Talent Review 2026" /></Field><Field label="Data"><Input name="data" type="date" required /></Field><div className="flex items-end"><Btn small>Criar</Btn></div></form>}
            </Card>
          </div>
        </div>
        <Card title="Mapear posição crítica"><form action={salvarPosicaoCritica} className="space-y-2">
          <Field label="Cargo"><Select name="positionId" required><option value="">Escolha</option>{positions.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}</Select></Field>
          <Field label="Unidade"><Select name="unitId" defaultValue={u ?? ""}><option value="">Rede</option>{units.filter(x => u === null || x.id === u).map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field>
          <Field label="Titular atual"><Select name="titularEmployeeId" defaultValue=""><option value="">—</option>{emps.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}</Select></Field>
          <div className="grid grid-cols-2 gap-2"><Field label="Criticidade"><Select name="criticidade" defaultValue="2"><option value="1">Média</option><option value="2">Alta</option><option value="3">Crítica — para a escola</option></Select></Field><Field label="Risco de saída do titular"><Select name="riscoSaida" defaultValue="MEDIO">{Object.entries(NIVEL3).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field></div>
          <Field label="Por que é crítica"><Input name="motivo" /></Field><Field label="Contingência imediata (quem cobre por 30 dias)"><Textarea name="contingencia" className="min-h-[50px]" /></Field>
          <Btn small>Salvar</Btn></form></Card>
      </div>
    </Page>
  );
}
