import Link from "@/components/Link";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, scopeUnit } from "@/lib/auth";
import { Page, Card, Flash, Stat, Table, Td, Btn, Field, Select, Input } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { Colunas, Rosca, Situacao, COR } from "@/components/graficos";
import { posicoes, semPosicao, resumoQuadro, STATUS_POSICAO, type StatusPosicao } from "@/lib/quadro";
import { sincronizar, autorizarPosicoes, criarPosicoes, editarPosicao } from "./actions";
import { fmtNumero } from "@/lib/formato";
import { fmtData, fmtMin, getSettings } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** T-043 · Posições × FTE: a cadeira separada da pessoa — posições autorizadas, ocupadas e vagas por unidade e área, com o FTE da jornada real. */
export default async function Quadro({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); if (!["RH", "DIRECAO", "DIRETOR_UNIDADE", "FINANCEIRO", "LEITURA"].includes(s.role)) redirect("/"); const sp = await searchParams;
  const u = scopeUnit(s); const cfg = await getSettings(); const filtro = (sp.st ?? "") as StatusPosicao | "";
  const [ps, sem, cargos, units, emps] = await Promise.all([posicoes(u), semPosicao(u), sql<{ id: number; nome: string; area: string }[]>`SELECT id, nome, area FROM positions ORDER BY ordem, nome`, sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ${u === null ? sql`` : sql`WHERE id=${u}`} ORDER BY nome`, sql<{ id: number; nome: string }[]>`SELECT id, nome FROM employees WHERE situacao IN ('ATIVO','FERIAS','AFASTADO','EM_ADMISSAO') ${u === null ? sql`` : sql`AND unit_id=${u}`} ORDER BY nome`]);
  const r = resumoQuadro(ps); const lista = filtro ? ps.filter(p => p.status === filtro) : ps;
  const gestao = ["RH", "DIRECAO"].includes(s.role); const [hc] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM employees WHERE situacao IN ('ATIVO','FERIAS','AFASTADO') ${u === null ? sql`` : sql`AND unit_id=${u}`}`;
  const voltar = `/quadro${filtro ? `?st=${filtro}` : ""}`;
  return (
    <Page title="Posições e quadro (FTE)" sub={`A cadeira separada da pessoa: quadro autorizado, ocupado e vago por unidade e área. FTE = jornada diária ÷ ${cfg.quadro.jornadaPlenaMin} min (44 h semanais). Base do gate de reposição.`}
      actions={gestao ? <><form action={sincronizar}><input type="hidden" name="voltar" value={voltar} /><Btn small kind="ghost">Sincronizar com as pessoas</Btn></form>{s.role === "DIRECAO" && r.naoAutorizadas > 0 && <form action={autorizarPosicoes}><input type="hidden" name="todas" value="1" /><input type="hidden" name="voltar" value={voltar} /><Btn small>Autorizar {r.naoAutorizadas} posição(ões)</Btn></form>}</> : undefined}>
      <Flash ok={sp.ok} erro={sp.erro} />
      {ps.length === 0 && <Card className="mb-4"><p className="text-sm text-slate-700">O quadro ainda não foi montado. {gestao ? "Use “Sincronizar com as pessoas”: cada colaborador ativo ganha uma posição do seu cargo e unidade (a Direção autoriza o quadro de uma vez)." : "O RH monta o quadro a partir das pessoas."} Enquanto isso, o gate de reposição aceita vagas sem posição de origem.</p></Card>}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Posições autorizadas" value={r.autorizadas} hint={`FTE autorizado ${fmtNumero(r.fteAutorizado, 1)}`} />
        <Stat label="Preenchidas" value={r.preenchidas} hint={`FTE ocupado ${fmtNumero(r.fteOcupado, 1)} · ${hc.n} pessoas ativas`} href="/quadro?st=PREENCHIDA" />
        <Stat label="Vagas" value={<span className={r.vagas ? "text-erro" : ""}>{r.vagas}</span>} hint="abrir vaga passa pelo gate" href="/quadro?st=VAGA" />
        <Stat label="Vagas em breve" value={<span className={r.vagaEmBreve ? "text-aviso" : ""}>{r.vagaEmBreve}</span>} hint="desligamento em curso" href="/quadro?st=VAGA_EM_BREVE" />
        <Stat label="Preenchem em breve" value={r.preencheEmBreve} hint="vaga aberta ou admissão" href="/quadro?st=PREENCHE_EM_BREVE" />
        <Stat label="Aguardando autorização" value={r.naoAutorizadas} hint="aumento de quadro proposto" href="/quadro?st=NAO_AUTORIZADA" />
      </div>
      {sem.length > 0 && <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{sem.length} pessoa(s) ativa(s) sem posição no quadro{sem.filter(x => !x.position_id).length ? ` (${sem.filter(x => !x.position_id).length} sem cargo no cadastro)` : ""}. {gestao ? "Sincronize para vincular." : ""}</p>}
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Por unidade" className="lg:col-span-2"><Colunas empilhado categorias={r.unidades.map(x => x.unidade)} series={[{ nome: "Preenchidas", valores: r.unidades.map(x => x.preenchidas), cor: COR.ok }, { nome: "Vagas", valores: r.unidades.map(x => x.vagas), cor: COR.erro }, { nome: "Aguardando autorização", valores: r.unidades.map(x => x.pendentes), cor: COR.neutro }]} rotulos rotulo="Posições por unidade e situação" /></Card>
        <Card title="Quadro autorizado por área"><Rosca rotulo="Posições autorizadas por área" fatias={r.areas.map(a => ({ rotulo: a.area, valor: a.n }))} centro={{ valor: String(r.autorizadas), rotulo: "posições" }} formato={v => String(v)} /></Card>
      </div>
      <Card title={`${filtro ? STATUS_POSICAO[filtro].rotulo : "Todas as posições"} (${lista.length})`} actions={filtro ? <Link href="/quadro" className="text-xs text-acao">ver todas</Link> : undefined}>
        <Table head={["Cargo · área", "Unidade", "Situação", "Ocupante", "Jornada · FTE", "Vaga", ""]} empty="Nenhuma posição.">
          {lista.map(p => <tr key={p.id}><Td><b>{p.cargo}</b><div className="text-[11px] text-slate-500">{p.area}</div></Td><Td className="text-xs">{p.unidade}</Td><Td><Situacao tom={STATUS_POSICAO[p.status].tom} texto={STATUS_POSICAO[p.status].rotulo} /></Td>
            <Td className="text-xs">{p.ocupante && p.situacao_ocupante !== "DESLIGADO" ? <Link href={`/colaboradores/${p.employee_id}`} className="text-acao">{p.ocupante}</Link> : <span className="text-slate-400">—</span>}{p.desligamento && p.situacao_ocupante !== "DESLIGADO" ? <div className="text-aviso">sai {fmtData(p.desligamento)}</div> : null}</Td>
            <Td className="whitespace-nowrap text-xs tabular-nums">{fmtMin(p.jornada_min_dia).replace("+", "")}/dia · {fmtNumero(p.fte, 2)}</Td>
            <Td className="text-xs">{p.vaga_id ? <Link href={`/recrutamento/vagas/${p.vaga_id}`} className="text-acao">#{p.vaga_id} · {p.vaga_status === "ABERTA" ? "em seleção" : "no gate"}</Link> : (p.status === "VAGA" || p.status === "VAGA_EM_BREVE") && p.autorizada ? <Link href={`/recrutamento?slot=${p.id}#gate`} className="font-medium text-acao">abrir vaga (gate)</Link> : "—"}</Td>
            <Td>{gestao && <Modal label="Editar" kind="link" title={`${p.cargo} · ${p.unidade}`}><div className="space-y-3">
              <form action={editarPosicao} className="flex items-end gap-2"><input type="hidden" name="id" value={p.id} /><input type="hidden" name="acao" value="jornada" /><input type="hidden" name="voltar" value={voltar} /><Field label="Jornada diária (min)"><Input name="jornada" type="number" min={60} max={720} defaultValue={p.jornada_min_dia} /></Field><Btn small kind="ghost">Salvar</Btn></form>
              <form action={editarPosicao} className="flex items-end gap-2"><input type="hidden" name="id" value={p.id} /><input type="hidden" name="acao" value="ocupar" /><input type="hidden" name="voltar" value={voltar} /><Field label="Ocupante"><Select name="employeeId" defaultValue={p.employee_id ?? ""}>{emps.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}</Select></Field><Btn small kind="ghost">Vincular</Btn></form>
              <div className="flex gap-2">{p.employee_id && <form action={editarPosicao}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="acao" value="liberar" /><input type="hidden" name="voltar" value={voltar} /><Btn small kind="ghost">Liberar a posição</Btn></form>}<form action={editarPosicao}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="acao" value="extinguir" /><input type="hidden" name="voltar" value={voltar} /><Btn small danger>Extinguir (só vaga)</Btn></form></div>
            </div></Modal>}</Td></tr>)}
        </Table>
      </Card>
      {gestao && <Card title="Aumento de quadro (novas posições)" className="mt-4"><form action={criarPosicoes} className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_6rem_8rem]"><input type="hidden" name="voltar" value={voltar} />
        <Field label="Cargo"><Select name="positionId">{cargos.map(c => <option key={c.id} value={c.id}>{c.nome} · {c.area}</option>)}</Select></Field><Field label="Unidade"><Select name="unitId">{units.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field><Field label="Qtde"><Input name="quantidade" type="number" min={1} max={20} defaultValue={1} /></Field><Field label="Jornada (min/dia)"><Input name="jornada" type="number" min={60} max={720} defaultValue={Number(cfg.quadro.jornadaPlenaMin)} /></Field>
        <Field label="Motivo (fica no registro)" className="sm:col-span-3"><Input name="motivo" required minLength={5} placeholder="ex.: nova turma integral na Cultura em 2027" /></Field><div className="flex items-end"><Btn small>{s.role === "DIRECAO" ? "Criar autorizadas" : "Propor à Direção"}</Btn></div></form></Card>}
    </Page>
  );
}
