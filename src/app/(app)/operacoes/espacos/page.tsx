import { redirect } from "next/navigation";
import Link from "@/components/Link";
import { requireSession, scopeUnit, can } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Stat, Table, Td, Badge, Flash, Field, Btn, Select } from "@/components/ui";
import { getSettings } from "@/lib/utils";
import { mapaSalas, TIPO_ESPACO } from "@/lib/espacos";
import { atribuirSala } from "./actions";
import { SubNavEspacos } from "./_ui";

export const dynamic = "force-dynamic";

export default async function MapaSalas({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); if (s.role === "COLABORADOR") redirect("/operacoes/espacos/reservas");
  const sp = await searchParams; const cfg = await getSettings(); const escopo = scopeUnit(s);
  const units = await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ${escopo === null ? sql`` : sql`WHERE id=${escopo}`} ORDER BY nome`;
  const anos = (await sql<{ ano: number }[]>`SELECT DISTINCT ano FROM classes ORDER BY ano`).map(a => a.ano);
  const unidade = escopo ?? (sp.unidade ? Number(sp.unidade) : units[0]?.id); const ano = sp.ano ? Number(sp.ano) : (cfg.matriculas.anoLetivo as number);
  if (!unidade) return <Page title="Mapa de salas"><Card><p className="text-sm">Nenhuma unidade cadastrada.</p></Card></Page>;
  const m = await mapaSalas(ano, unidade); const pode = can.operacoes(s) || can.gradeTurmas(s);
  const salasLivres = (turno: string) => m.linhas.filter(l => l.tipo !== "EQUIPAMENTO" && l.ativo && !(l.porTurno[turno] ?? []).length);
  const alertas = m.linhas.flatMap(l => l.alertas.map(a => `${l.nome}: ${a}`));
  const voltar = `/operacoes/espacos?unidade=${unidade}&ano=${ano}`;
  return (
    <Page title="Mapa de salas por turno" sub={`Que turma ocupa cada sala em ${ano}, com alunos × vagas × capacidade física (informada ou pela área, ${String(cfg.espacos.m2PorAluno).replace(".", ",")} m² por aluno). Ligado às turmas de Matrículas.`}>
      <SubNavEspacos ativo="/operacoes/espacos" gestao />
      <Flash ok={sp.ok} erro={sp.erro} />
      <form className="mb-4 grid grid-cols-2 items-end gap-2 rounded-md border border-line bg-white p-3 sm:flex sm:flex-wrap">
        {!escopo && <Field label="Unidade"><Select name="unidade" defaultValue={unidade}>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>}
        <Field label="Ano letivo"><Select name="ano" defaultValue={ano}>{(anos.length ? anos : [ano]).map(a => <option key={a}>{a}</option>)}</Select></Field>
        <Btn kind="ghost">Ver</Btn>
      </form>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Salas e ambientes" value={m.linhas.filter(l => l.ativo).length} />
        {m.turnos.slice(0, 2).map(t => <Stat key={t} label={`Salas livres · ${t.toLowerCase()}`} value={m.livres[t] ?? 0} />)}
        <Stat label="Turmas sem sala" value={<span className={m.semSala.length ? "text-aviso" : ""}>{m.semSala.length}</span>} />
      </div>
      {alertas.length > 0 && <Card className="mb-4 border-amber-300" title={`Atenção (${alertas.length})`}><ul className="list-disc space-y-0.5 pl-5 text-sm text-aviso">{alertas.map((a, i) => <li key={i}>{a}</li>)}</ul></Card>}
      {m.linhas.length === 0 ? <Card><p className="text-sm text-slate-600">Nenhuma sala cadastrada nesta unidade. {pode && <Link className="text-acao underline" href="/operacoes/espacos/cadastro">Cadastre as salas</Link>}</p></Card> :
        <Table head={["Sala", "Capacidade", ...m.turnos]}>
          {m.linhas.map(l => <tr key={l.id} className={!l.ativo ? "opacity-60" : ""}>
            <Td className="font-medium">{l.nome}<div className="text-[11px] font-normal text-slate-500">{TIPO_ESPACO[l.tipo]}{l.alertas.length ? <span className="text-aviso"> · {l.alertas.length} alerta(s)</span> : null}</div></Td>
            <Td>{l.capacidade ?? <span className="text-xs text-slate-400">não informada</span>}{l.capOrigem === "pela área" && <div className="text-[11px] text-slate-500">pela área ({String(l.area_m2).replace(".", ",")} m²)</div>}</Td>
            {m.turnos.map(t => <Td key={t}>{(l.porTurno[t] ?? []).length === 0 ? <span className="text-xs text-slate-400">livre</span> : (l.porTurno[t] ?? []).map(c => { const acima = l.capacidade !== null && c.ocupadas > l.capacidade; const vagasAcima = l.capacidade !== null && c.vagas > l.capacidade;
              return <div key={c.class_id} className="mb-1"><Link className="text-acao" href={`/matriculas/turmas/${c.class_id}`}>{c.nome}</Link>{c.modalidade === "INTEGRAL" && <Badge v="NEUTRO" label="Integral" />}<div className={`text-[11px] ${acima ? "font-medium text-erro" : vagasAcima ? "text-aviso" : "text-slate-500"}`}>{c.ocupadas} alunos · {c.vagas} vagas{l.capacidade !== null ? ` · ${l.capacidade} lugares` : ""}</div></div>; })}</Td>)}
          </tr>)}
        </Table>}
      <Card className="mt-4" title={`Turmas de ${ano} sem sala (${m.semSala.length})`}>
        {m.semSala.length === 0 ? <p className="text-sm text-ok">Todas as turmas têm sala.</p> : <Table head={["Turma", "Turno", "Vagas", "Alunos", pode ? "Sala" : ""]}>
          {m.semSala.map(c => <tr key={c.id}><Td><Link className="text-acao" href={`/matriculas/turmas/${c.id}`}>{c.nome}</Link>{c.modalidade === "INTEGRAL" && <span className="text-[11px] text-slate-500"> · Integral</span>}</Td><Td>{c.turno}</Td><Td>{c.vagas}</Td><Td>{c.ocupadas}</Td>
            <Td>{pode && <form action={atribuirSala} className="flex flex-wrap items-center gap-1"><input type="hidden" name="classId" value={c.id} /><input type="hidden" name="voltar" value={voltar} /><Select name="spaceId" required className="max-w-[12rem] py-1 text-xs" aria-label={`Sala para ${c.nome}`}><option value="">Escolha</option>{salasLivres(c.turno).map(x => <option key={x.id} value={x.id}>{x.nome}{x.capacidade ? ` (${x.capacidade})` : ""}</option>)}</Select><Btn small kind="ghost">Ligar</Btn></form>}</Td></tr>)}
        </Table>}
        {pode && m.turmas.some(c => c.space_id) && <details className="mt-3 border-t border-line pt-3"><summary className="cursor-pointer text-xs text-acao">Trocar ou tirar a sala de uma turma</summary>
          <form action={atribuirSala} className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"><input type="hidden" name="voltar" value={voltar} />
            <Field label="Turma"><Select name="classId" required><option value="">Escolha</option>{m.turmas.filter(c => c.space_id).map(c => <option key={c.id} value={c.id}>{c.nome} · {c.turno}</option>)}</Select></Field>
            <Field label="Nova sala"><Select name="spaceId"><option value="">— sem sala —</option>{m.linhas.filter(l => l.ativo).map(l => <option key={l.id} value={l.id}>{l.nome}</option>)}</Select></Field><Btn small kind="ghost">Salvar</Btn></form></details>}
      </Card>
    </Page>
  );
}
