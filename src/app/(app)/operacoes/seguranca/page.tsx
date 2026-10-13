import Link from "@/components/Link";
import { scopeUnit } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Table, Td, Flash, Field, Btn, Input, Select, Stat } from "@/components/ui";
import { fmtDataHora, hoje } from "@/lib/utils";
import { VISITA_TIPO, autorizacoes, podePortaria, docMascarado, GESTAO_SEG } from "@/lib/seguranca";
import { registrarVisita, registrarSaidaVisita } from "./actions";
import { requireSeguranca, SubNavSeg, Retirada, BadgeRetirada } from "./_ui";

export const dynamic = "force-dynamic";

export default async function Portaria({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSeguranca(); const sp = await searchParams; const h = hoje(); const escopo = scopeUnit(s);
  const units = await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ${escopo === null ? sql`` : sql`WHERE id=${escopo}`} ORDER BY nome`;
  const unidade = escopo ?? (sp.unidade ? Number(sp.unidade) : units[0]?.id ?? 0); const opera = await podePortaria(s); const gest = GESTAO_SEG.includes(s.role);
  const q = (sp.q ?? "").trim();
  const [dentro, movimento, saidas, achados, emAndamento] = await Promise.all([
    sql<{ id: number; tipo: string; nome: string; documento: string | null; empresa: string | null; visitado: string | null; cracha: string | null; entrada: string }[]>`SELECT id, tipo, nome, documento, empresa, visitado, cracha, entrada::text FROM visits WHERE unit_id=${unidade} AND saida IS NULL AND entrada > now() - interval '18 hours' ORDER BY entrada`,
    sql<{ n: number; saidas: number }[]>`SELECT count(*)::int AS n, count(saida)::int AS saidas FROM visits WHERE unit_id=${unidade} AND (entrada AT TIME ZONE 'UTC' AT TIME ZONE 'America/Campo_Grande')::date = ${h}`,
    sql<{ id: number; aluno: string; student_id: number; hora: string; retirado_por: string; status: string; excecao_justificativa: string | null; motivo: string | null; registrado_nome: string | null; emergencia: number | null }[]>`SELECT d.id, st.nome AS aluno, d.student_id, d.hora, d.retirado_por, d.status, d.excecao_justificativa, d.motivo, d.registrado_nome, d.emergency_event_id AS emergencia FROM early_departures d JOIN students st ON st.id=d.student_id WHERE d.unit_id=${unidade} AND d.data=${h} ORDER BY d.created_at DESC`,
    q.length >= 2 ? sql<{ id: number; nome: string; serie: string | null; responsavel: string | null }[]>`SELECT st.id, st.nome, g.nome AS serie, st.responsavel FROM students st LEFT JOIN grades g ON g.id=st.serie_atual_id WHERE st.aluno_atual AND st.unit_atual_id=${unidade} AND st.nome ILIKE ${"%" + q + "%"} ORDER BY st.nome LIMIT 15` : Promise.resolve([]),
    sql<{ id: number; tipo: string; cenario: string }[]>`SELECT id, tipo, cenario FROM emergency_events WHERE unit_id=${unidade} AND status='EM_ANDAMENTO'`]);
  const sel = sp.studentId ? (await sql<{ id: number; nome: string; serie: string | null; unit: number | null }[]>`SELECT st.id, st.nome, g.nome AS serie, st.unit_atual_id AS unit FROM students st LEFT JOIN grades g ON g.id=st.serie_atual_id WHERE st.id=${Number(sp.studentId)} AND st.aluno_atual`)[0] : undefined;
  const selOk = sel && sel.unit === unidade ? sel : undefined; const lista = selOk ? await autorizacoes(selOk.id) : [];
  const base = `/operacoes/seguranca?unidade=${unidade}`; const voltarSel = selOk ? `${base}&studentId=${selOk.id}` : base;
  return (
    <Page title="Portaria e segurança" sub="Visitantes e prestadores, saída antecipada com conferência de quem pode buscar cada aluno (restrições bloqueiam), simulados de abandono, chamada de emergência e brigada.">
      <SubNavSeg ativo="/operacoes/seguranca" />
      <Flash ok={sp.ok} erro={sp.erro} />
      {emAndamento.map(e => <Card key={e.id} className="mb-4 border-2 border-erro"><p className="text-sm font-semibold text-erro">{e.tipo === "REAL" ? "EMERGÊNCIA EM ANDAMENTO" : "Simulado em andamento"}: {e.cenario} — <Link className="underline" href={`/operacoes/seguranca/emergencias/${e.id}`}>abrir a chamada</Link></p></Card>)}
      {!escopo && <form className="mb-3 flex flex-wrap items-end gap-2"><Field label="Unidade"><Select name="unidade" defaultValue={unidade}>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field><Btn kind="ghost">Trocar</Btn></form>}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4"><Stat label="Visitantes na escola agora" value={dentro.length} /><Stat label="Entradas hoje" value={movimento[0].n} /><Stat label="Saídas antecipadas hoje" value={saidas.filter(x => x.status === "LIBERADA").length} /><Stat label="Retiradas bloqueadas hoje" value={<span className={saidas.some(x => x.status === "BLOQUEADA") ? "text-erro" : ""}>{saidas.filter(x => x.status === "BLOQUEADA").length}</span>} /></div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
        <div className="space-y-4">
          <Card title="Saída antecipada — quem pode buscar">
            <form className="mb-3 flex flex-wrap items-end gap-2"><input type="hidden" name="unidade" value={unidade} /><Field label="Aluno" className="min-w-0 flex-1"><Input name="q" defaultValue={q} placeholder="Digite parte do nome" /></Field><Btn kind="ghost">Buscar</Btn></form>
            {q && !selOk && (achados.length === 0 ? <p className="text-sm text-slate-500">Nenhum aluno atual com esse nome nesta unidade.</p> : <ul className="divide-y divide-line text-sm">{achados.map(a => <li key={a.id} className="py-1.5"><Link className="text-acao" href={`${base}&studentId=${a.id}`}>{a.nome}</Link><span className="text-xs text-slate-500"> · {a.serie ?? "sem série"}{a.responsavel ? ` · resp. ${a.responsavel}` : ""}</span></li>)}</ul>)}
            {selOk && (opera ? <Retirada s={s} aluno={selOk} lista={lista} voltar={voltarSel} /> : <p className="text-sm text-slate-600">Somente leitura.</p>)}
          </Card>
          <Card title={`Saídas de hoje (${saidas.length})`}>
            <Table head={["Hora", "Aluno", "Com", "Situação"]} empty="Nenhuma saída antecipada hoje.">{saidas.map(x => <tr key={x.id}><Td>{x.hora}</Td><Td><Link className="text-acao" href={`${base}&studentId=${x.student_id}`}>{x.aluno}</Link>{x.emergencia ? <div className="text-[11px] text-erro">entrega na emergência</div> : null}</Td><Td>{x.retirado_por}{x.motivo && <div className="text-[11px] text-slate-500">{x.motivo}</div>}</Td><Td><BadgeRetirada status={x.status} excecao={x.excecao_justificativa} />{x.excecao_justificativa && gest && <div className="text-[11px] text-slate-600">{x.excecao_justificativa}</div>}<div className="text-[11px] text-slate-500">{x.registrado_nome}</div></Td></tr>)}</Table>
          </Card>
        </div>
        <div className="space-y-4">
          <Card title={`Visitantes na escola agora (${dentro.length})`}>
            <Table head={["Entrada", "Quem", "Visita", ""]} empty="Ninguém de fora na escola.">{dentro.map(v => <tr key={v.id}><Td className="whitespace-nowrap text-xs">{fmtDataHora(v.entrada).slice(-5)}</Td><Td>{v.nome}<div className="text-[11px] text-slate-500">{VISITA_TIPO[v.tipo]}{v.empresa ? ` · ${v.empresa}` : ""} · doc. {docMascarado(v.documento)}{v.cracha ? ` · crachá ${v.cracha}` : ""}</div></Td><Td className="text-xs">{v.visitado ?? "—"}</Td><Td>{opera && <form action={registrarSaidaVisita}><input type="hidden" name="id" value={v.id} /><input type="hidden" name="voltar" value={base} /><Btn small kind="ghost">Saída</Btn></form>}</Td></tr>)}</Table>
          </Card>
          {opera && <Card title="Registrar entrada">
            <form action={registrarVisita} className="space-y-2"><input type="hidden" name="unitId" value={unidade} /><input type="hidden" name="voltar" value={base} />
              <div className="grid grid-cols-2 gap-2"><Field label="Tipo"><Select name="tipo" defaultValue="VISITANTE">{Object.entries(VISITA_TIPO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field><Field label="Crachá"><Input name="cracha" /></Field></div>
              <Field label="Nome completo"><Input name="nome" required /></Field>
              <div className="grid grid-cols-2 gap-2"><Field label="Documento"><Input name="documento" /></Field><Field label="Empresa"><Input name="empresa" /></Field></div>
              <div className="grid grid-cols-2 gap-2"><Field label="Visita a (pessoa ou setor)"><Input name="visitado" /></Field><Field label="Motivo"><Input name="motivo" /></Field></div>
              <Btn small>Registrar entrada</Btn><p className="text-xs text-slate-500">Nome e documento de visitantes são anonimizados automaticamente após o prazo de guarda configurado.</p>
            </form></Card>}
        </div>
      </div>
    </Page>
  );
}
