import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, asc } from "drizzle-orm";
import { db, schema, sql } from "@/db";
import { requireMatriculas, can } from "@/lib/auth";
import { Page, Card, Table, Td, Badge, Flash, Field, Select, Btn, Input } from "@/components/ui";
import { fmtData, fmtDataHora, getSettings, ENR_STATUS, WL_STATUS, idade } from "@/lib/utils";
import { processarVencimentos } from "@/lib/matriculas";
import { AlunoForm } from "../AlunoForm";
import { ReservaForm, AcoesMatricula, turmasAbertas } from "../../_shared";
import { entrarFila, sairFila } from "../../actions";
import { NovoCasoForm } from "../../../atendimento/_shared";
import { atualizarSinais } from "../../../atendimento/actions";
import { riscoFamilias, CASE_TIPO_LABEL, CASE_STATUS, ABERTOS } from "@/lib/atendimento";

export const dynamic = "force-dynamic";

export default async function Aluno({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireMatriculas(); const { id } = await params; const sp = await searchParams; const cfg = await getSettings(); const ano = cfg.matriculas.anoLetivo;
  await processarVencimentos();
  const sid = Number(id); const [st] = await db.select().from(schema.students).where(eq(schema.students.id, sid)); if (!st) notFound();
  const [hist, fila, turmas, units, grades] = await Promise.all([
    sql<{ id: number; ano: number; modalidade: string; status: string; reserva_ate: string | null; contrato: boolean; fin: boolean; class_id: number; turma: string; unidade: string; turno: string; created_at: Date; motivo: string | null; excecao: string | null }[]>`SELECT e.id, e.ano, e.modalidade, e.status, e.reserva_ate::text, e.contrato_assinado AS contrato, e.financeiro_ok AS fin, e.class_id, c.nome AS turma, u.nome AS unidade, c.turno, e.created_at, e.motivo_cancelamento AS motivo, e.excecao FROM enrollments e JOIN classes c ON c.id=e.class_id JOIN units u ON u.id=c.unit_id WHERE e.student_id=${sid} ORDER BY e.ano DESC, e.id DESC`,
    sql<{ id: number; status: string; unidade: string; serie: string; turno: string | null; modalidade: string; oferta_ate: string | null; turma_oferta: string | null; created_at: Date }[]>`SELECT w.id, w.status, u.nome AS unidade, g.nome AS serie, w.turno, w.modalidade, w.oferta_ate::text, c.nome AS turma_oferta, w.created_at FROM waitlist w JOIN units u ON u.id=w.unit_id JOIN grades g ON g.id=w.grade_id LEFT JOIN classes c ON c.id=w.oferta_class_id WHERE w.student_id=${sid} ORDER BY w.id DESC`,
    turmasAbertas(s, ano), db.select().from(schema.units).orderBy(asc(schema.units.nome)), db.select().from(schema.grades).orderBy(asc(schema.grades.ordem)),
  ]);
  const podeConfirmar = can.aprovar(s, cfg.alcadas.matricula); const podeExcecao = can.aprovar(s, cfg.alcadas.excecaoCapacidade);
  const [casos, pesquisas, riscoLista] = await Promise.all([
    sql<{ id: number; assunto: string; tipo: string; status: string; created_at: Date; sla_ate: Date | null; resultado: string | null }[]>`SELECT id, assunto, tipo, status, created_at, sla_ate, resultado FROM cases WHERE student_id=${sid} ORDER BY created_at DESC LIMIT 12`,
    sql<{ tipo: string; nota: number; data: string; comentario: string | null }[]>`SELECT tipo, nota, data::text, comentario FROM surveys WHERE student_id=${sid} ORDER BY data DESC LIMIT 5`,
    st.alunoAtual ? riscoFamilias(st.unitAtualId ?? null) : Promise.resolve([]),
  ]);
  const risco = riscoLista.find(r => r.studentId === sid);
  const voltar = `/matriculas/alunos/${sid}`; const ativos = hist.filter(h => h.ano === ano && ["RESERVADA", "CONFIRMADA"].includes(h.status));
  return (
    <Page title={st.nome} sub={<span>{st.dataNascimento ? `${idade(st.dataNascimento)} anos · ` : ""}{st.alunoAtual ? "aluno da rede" : "candidato"}{st.responsavel ? ` · resp.: ${st.responsavel}` : ""}{st.telefone ? ` · ${st.telefone}` : ""} · <Link className="text-acao" href="/matriculas/alunos">lista</Link></span>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <Card title={`Situação ${ano}`}>
            {ativos.length === 0 && <p className="mb-2 text-sm text-slate-600">Sem reserva nem matrícula em {ano}.</p>}
            <Table head={["Ano", "Turma", "Modalidade", "Situação", "Reserva até", "Contrato", "Financeiro", ""]} empty="Nenhum histórico de matrícula.">
              {hist.map(e => <tr key={e.id} className={["CANCELADA", "EXPIRADA", "TRANSFERIDA"].includes(e.status) ? "opacity-60" : ""}>
                <Td>{e.ano}</Td><Td><Link className="text-acao" href={`/matriculas/turmas/${e.class_id}`}>{e.turma}</Link><div className="text-xs text-slate-500">{e.unidade} · {e.turno}</div>{e.excecao && <div className="text-xs text-aviso">exceção: {e.excecao}</div>}{e.motivo && <div className="text-xs text-slate-500">{e.motivo}</div>}</Td><Td>{e.modalidade === "REGULAR" ? "Regular" : "Integral"}</Td>
                <Td><Badge v={e.status === "CONFIRMADA" ? "APROVADA" : e.status === "RESERVADA" ? "SOLICITADA" : e.status === "EXPIRADA" ? "REJEITADA" : "CANCELADA"} label={ENR_STATUS[e.status]} /><div className="text-xs text-slate-500">{fmtDataHora(e.created_at)}</div></Td>
                <Td>{e.status === "RESERVADA" ? fmtData(e.reserva_ate) : "—"}</Td><Td>{e.contrato ? "✓" : "—"}</Td><Td>{e.fin ? "✓" : "—"}</Td>
                <Td><AcoesMatricula e={e} voltar={voltar} podeConfirmar={podeConfirmar} podeCancelarMat={podeConfirmar} turmas={turmas.filter(t => t.modalidade === e.modalidade)} /></Td>
              </tr>)}
            </Table>
          </Card>
          {fila.length > 0 && <Card title="Lista de espera">
            <Table head={["Unidade", "Série", "Turno", "Modalidade", "Situação", "Desde", ""]}>
              {fila.map(w => <tr key={w.id}><Td>{w.unidade}</Td><Td>{w.serie}</Td><Td>{w.turno ?? "qualquer"}</Td><Td>{w.modalidade === "REGULAR" ? "Regular" : "Integral"}</Td><Td><Badge v={w.status === "AGUARDANDO" ? "PENDENTE" : w.status === "OFERTADA" ? "EM_ADMISSAO" : w.status === "CONVERTIDA" ? "APROVADA" : "CANCELADA"} label={WL_STATUS[w.status]} />{w.status === "OFERTADA" && <div className="text-xs">{w.turma_oferta} até {fmtData(w.oferta_ate)}</div>}</Td><Td className="text-xs text-slate-500">{fmtDataHora(w.created_at)}</Td>
                <Td>{["AGUARDANDO", "OFERTADA"].includes(w.status) && can.reservar(s) && <form action={sairFila}><input type="hidden" name="id" value={w.id} /><input type="hidden" name="voltar" value={voltar} /><Btn small danger>Sair da fila</Btn></form>}</Td></tr>)}
            </Table>
          </Card>}
          <Card title="Atendimento e relacionamento">
            <div id="atendimento" />
            <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
              <span>Risco de saída: {risco ? <Badge v={risco.nivel === "ALTO" ? "REJEITADA" : risco.nivel === "MEDIO" ? "PENDENTE" : "ATIVO"} label={`${risco.nivel === "ALTO" ? "Alto" : risco.nivel === "MEDIO" ? "Médio" : "Baixo"} · ${risco.pontos} pontos`} /> : <Badge v="ATIVO" label="sem sinais" />}</span>
              {risco && <span className="text-xs text-slate-600">{risco.fatores.map(f => f.texto).join(" · ")}</span>}
              {pesquisas.length > 0 && <span className="text-xs text-slate-600">Último NPS/CSAT: {pesquisas[0].tipo} {pesquisas[0].nota} ({fmtData(pesquisas[0].data)})</span>}
            </div>
            <Table head={["Caso", "Tipo", "Situação", "Aberto em"]} empty="Nenhum atendimento registrado para esta família.">
              {casos.map(c => <tr key={c.id}><Td><Link className="text-acao" href={`/atendimento/casos/${c.id}`}>#{c.id} {c.assunto}</Link></Td><Td>{CASE_TIPO_LABEL[c.tipo]}{c.resultado && c.resultado !== "EM_ANDAMENTO" ? ` · ${c.resultado === "RETIDO" ? "retida" : "perdida"}` : ""}</Td><Td><Badge v={ABERTOS.includes(c.status) ? (c.sla_ate && new Date(c.sla_ate).getTime() < Date.now() ? "REJEITADA" : "EM_ADMISSAO") : "APROVADA"} label={CASE_STATUS[c.status]} /></Td><Td className="text-xs text-slate-500">{fmtDataHora(c.created_at)}</Td></tr>)}
            </Table>
            {can.reservar(s) && <form action={atualizarSinais} className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3"><input type="hidden" name="studentId" value={sid} /><input type="hidden" name="voltar" value={voltar} />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="inadimplente" value="1" defaultChecked={st.inadimplente} /> Inadimplente</label>
              <Field label="Observação de risco" className="min-w-[240px] flex-1"><Input name="riscoObs" defaultValue={st.riscoObs ?? ""} placeholder="Ex.: família comentou mudança de bairro" /></Field><Btn small kind="ghost">Salvar sinais</Btn></form>}
          </Card>
          <Card title="Dados do aluno">{can.reservar(s) ? <AlunoForm st={st} /> : <p className="text-sm text-slate-600">Somente leitura.</p>}</Card>
        </div>
        <div className="space-y-4">
          {can.reservar(s) && <NovoCasoForm s={s} categorias={cfg.atendimento.categorias} voltar={`${voltar}#atendimento`} studentId={sid} compacto />}
          {can.reservar(s) && ativos.filter(a => a.modalidade === "REGULAR").length === 0 && <ReservaForm s={s} cfg={cfg.matriculas} voltar={voltar} studentId={sid} turmas={turmas} podeExcecao={podeExcecao} podeConfirmar={podeConfirmar} />}
          {can.reservar(s) && ativos.filter(a => a.modalidade === "REGULAR").length > 0 && ativos.filter(a => a.modalidade === "INTEGRAL").length === 0 && turmas.some(t => t.modalidade === "INTEGRAL") && <ReservaForm s={s} cfg={cfg.matriculas} voltar={voltar} studentId={sid} turmas={turmas.filter(t => t.modalidade === "INTEGRAL")} podeExcecao={podeExcecao} podeConfirmar={podeConfirmar} />}
          {can.reservar(s) && !fila.some(w => ["AGUARDANDO", "OFERTADA"].includes(w.status)) && ativos.length === 0 && (
            <form action={entrarFila} className="space-y-2 rounded-md border border-line bg-mist p-3">
              <div className="text-sm font-semibold text-navy">Entrar na lista de espera</div>
              <input type="hidden" name="studentId" value={sid} /><input type="hidden" name="voltar" value={voltar} /><input type="hidden" name="ano" value={ano} />
              <Field label="Unidade"><Select name="unitId" required defaultValue={st.unitAtualId ?? ""}><option value="">Escolha</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>
              <Field label="Série pretendida"><Select name="gradeId" required><option value="">Escolha</option>{grades.map(g => <option key={g.id} value={g.id}>{g.nome}</option>)}</Select></Field>
              <Field label="Turno"><Select name="turno" defaultValue=""><option value="">Qualquer</option><option>Matutino</option><option>Vespertino</option></Select></Field>
              <Field label="Modalidade"><Select name="modalidade" defaultValue="REGULAR"><option value="REGULAR">Regular</option><option value="INTEGRAL">Integral</option></Select></Field>
              <Btn small kind="ghost">Incluir na fila</Btn>
            </form>
          )}
        </div>
      </div>
    </Page>
  );
}
