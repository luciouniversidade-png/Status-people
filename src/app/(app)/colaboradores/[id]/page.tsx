import { Modal } from "@/components/Modal";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, desc, asc, and } from "drizzle-orm";
import { db, schema, sql } from "@/db";
import { requireSession, can, canSeeEmployee, ROLE_LABEL } from "@/lib/auth";
import { Page, Card, Badge, Btn, Flash, Table, Td, Field, Input, Select, Textarea } from "@/components/ui";
import { fmtData, fmtDataHora, fmtMin, fmtMoeda, idade, hoje, addDays, periodosFerias, situacaoDerivada, SITUACAO_LABEL, VINCULO_LABEL, LEAVE_TIPOS, LEAVE_LABEL, LEAVE_STATUS, HOUR_TIPOS, HOUR_LABEL, HOUR_STATUS, PROC_LABEL, PROC_STATUS, getSettings } from "@/lib/utils";
import { iniciarDesligamento, salvarDocumento, marcarRecebido, excluirDocumento, excluirColaborador } from "../actions";
import { solicitarAfastamento, decidirAfastamento } from "../../ferias/actions";
import { lancarHoras, decidirHoras, excluirHoras } from "../../banco-de-horas/actions";
import { registrarCheckin, reajustarSalario } from "../../talento/actions";
import { MOTIVO_SAL, fmtBRL } from "@/lib/talento";
import { matrizTreinamento, PROG_STATUS } from "@/lib/clima-academy";

export const dynamic = "force-dynamic";

export default async function Ficha({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const { id: idStr } = await params; const sp = await searchParams; const id = Number(idStr);
  const [emp] = await db.select().from(schema.employees).where(eq(schema.employees.id, id));
  if (!emp) notFound();
  if (!canSeeEmployee(s, emp)) notFound();
  const cfg = await getSettings();
  const h = hoje(); const back = `/colaboradores/${id}`;

  const [[unit], [company], [position], [gestor], leaves, hours, docs, procs, hist, [{ saldo }]] = await Promise.all([
    db.select().from(schema.units).where(eq(schema.units.id, emp.unitId)),
    emp.companyId ? db.select().from(schema.companies).where(eq(schema.companies.id, emp.companyId)) : Promise.resolve([undefined]),
    emp.positionId ? db.select().from(schema.positions).where(eq(schema.positions.id, emp.positionId)) : Promise.resolve([undefined]),
    emp.gestorId ? db.select({ id: schema.employees.id, nome: schema.employees.nome }).from(schema.employees).where(eq(schema.employees.id, emp.gestorId)) : Promise.resolve([undefined]),
    db.select().from(schema.leaveRequests).where(eq(schema.leaveRequests.employeeId, id)).orderBy(desc(schema.leaveRequests.inicio)),
    db.select().from(schema.hourEntries).where(eq(schema.hourEntries.employeeId, id)).orderBy(desc(schema.hourEntries.data), desc(schema.hourEntries.id)).limit(40),
    db.select().from(schema.documents).where(eq(schema.documents.employeeId, id)).orderBy(asc(schema.documents.id)),
    db.select().from(schema.processes).where(eq(schema.processes.employeeId, id)).orderBy(desc(schema.processes.id)),
    db.select().from(schema.auditLog).where(and(eq(schema.auditLog.entidade, "employees"), eq(schema.auditLog.entidadeId, id))).orderBy(desc(schema.auditLog.at)).limit(20),
    sql<{ saldo: number }[]>`SELECT coalesce(sum(minutos),0)::int AS saldo FROM hour_entries WHERE employee_id=${id} AND status='APROVADO'`,
  ]);
  const [salHist, checkins] = await Promise.all([
    can.verSalario(s) ? sql<{ data: string; salario_anterior: number | null; salario: number; motivo: string; obs: string | null }[]>`SELECT data::text, salario_anterior::float, salario::float, motivo, obs FROM salary_history WHERE employee_id=${id} ORDER BY data DESC, id DESC LIMIT 10` : Promise.resolve([]),
    sql<{ id: number; data: string; temas: string | null; combinados: string | null; quem: string | null }[]>`SELECT k.id, k.data::text, k.temas, k.combinados, u.nome AS quem FROM perf_checkins k LEFT JOIN users u ON u.id=k.user_id WHERE k.employee_id=${id} ORDER BY k.data DESC LIMIT 8`,
  ]);
  const treinos = (await matrizTreinamento(emp.unitId)).linhas.find(l => l.emp.id === id);
  const vigentes = leaves.filter(l => l.status === "APROVADA" && l.inicio <= h && l.fim >= h);
  const situacao = situacaoDerivada(emp.situacao, vigentes);
  const periodos = periodosFerias(emp.admissao, leaves.filter(l => l.status === "APROVADA" && l.tipo === "FERIAS" && l.periodoRef).map(l => ({ periodoRef: l.periodoRef, dias: l.dias })));
  const podeAprovarFerias = can.aprovar(s, cfg.alcadas.ferias); const podeAprovarBanco = can.aprovar(s, cfg.alcadas.banco);
  const sensivel = can.verSensivel(s);
  const docStatus = (d: typeof docs[number]) => d.validade && d.validade < h ? "VENCIDO" : d.validade && d.validade <= addDays(h, 30) ? "VENCE_EM_BREVE" : d.recebidoEm ? "RECEBIDO" : d.obrigatorio ? "PENDENTE" : "OPCIONAL";

  return (
    <Page title={emp.nome}
      sub={<span className="flex flex-wrap items-center gap-2"><Badge v={situacao} label={SITUACAO_LABEL[situacao]} />{position?.nome ?? "sem cargo"}{emp.nivel ? ` · ${emp.nivel}` : ""} · {unit?.nome} · {VINCULO_LABEL[emp.vinculo] ?? emp.vinculo}</span>}
      actions={can.editar(s) ? <><Btn kind="ghost" href={`/colaboradores/${id}/editar`}>Editar</Btn>{emp.situacao !== "DESLIGADO" && <Btn kind="ghost" href="#desligamento">Desligar</Btn>}</> : undefined}>
      <Flash ok={sp.ok} erro={sp.erro} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Dados" className="lg:col-span-2">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            {[
              ["Admissão", fmtData(emp.admissao)], ["Tempo de casa", tempoDeCasa(emp.admissao, emp.desligamento ?? h)],
              ["Empresa", company?.nome ?? "—"], ["Gestor direto", gestor ? <Link className="text-acao" href={`/colaboradores/${gestor.id}`}>{gestor.nome}</Link> : "—"],
              ["Carga diária", emp.jornadaMinDia ? `${fmtMin(emp.jornadaMinDia).slice(1)} (${emp.jornadaMinDia} min)` : "—"], ["Turno", emp.turno ?? "—"],
              ["E-mail", emp.email ?? "—"], ["Telefone", emp.telefone ?? "—"],
              ["Nascimento", emp.dataNascimento ? `${fmtData(emp.dataNascimento)} (${idade(emp.dataNascimento)} anos)` : "—"],
              ...(sensivel ? [["CPF", emp.cpf ?? "—"], ["Salário base", fmtMoeda(emp.salario)]] : []),
              ["Endereço", emp.endereco ?? "—"],
              ...(emp.desligamento ? [["Desligamento", `${fmtData(emp.desligamento)}${emp.motivoDesligamento ? ` · ${emp.motivoDesligamento}` : ""}`]] : []),
            ].map(([k, v], i) => <div key={i}><dt className="text-xs text-slate-500">{k}</dt><dd className="font-medium text-ink">{v}</dd></div>)}
          </dl>
          {emp.obs && <p className="mt-3 rounded bg-mist px-3 py-2 text-sm text-slate-700">{emp.obs}</p>}
        </Card>
        <Card title="Banco de horas">
          <div className={`text-3xl font-semibold tabular-nums ${saldo < 0 ? "text-erro" : saldo > 0 ? "text-ok" : "text-navy"}`}>{fmtMin(saldo)}</div>
          <p className="mt-1 text-xs text-slate-500">Saldo dos lançamentos aprovados · {hours.filter(x => x.status === "PENDENTE").length} pendente(s) · <Link className="text-acao" href={`/ponto/${id}`}>folha de ponto</Link></p>
          <div className="mt-3 text-sm">
            <div className="text-xs text-slate-500">Processos</div>
            {procs.length === 0 ? <div className="text-slate-500">Nenhum</div> : procs.map(p => <div key={p.id}><Link className="text-acao" href={`/processos/${p.id}`}>{PROC_LABEL[p.tipo]}</Link> · <Badge v={p.status} label={PROC_STATUS[p.status]} /></div>)}
          </div>
        </Card>
      </div>

      {/* ---------- Férias e afastamentos ---------- */}
      <Card title="Férias e afastamentos" className="mt-4" >
        <div id="ferias" />
        <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
          <div className="space-y-4">
            <Table head={["Período aquisitivo", "Concessivo até", "Direito", "Usados", "Saldo", "Situação"]}>
              {periodos.map(p => <tr key={p.inicio}><Td>{fmtData(p.inicio)} – {fmtData(p.fim)}</Td><Td>{fmtData(p.concessivoAte)}</Td><Td>{p.direito}</Td><Td>{p.usados}</Td><Td className="font-medium">{p.saldo}</Td><Td><Badge v={p.status} label={{ EM_AQUISICAO: "Em aquisição", ABERTO: "Disponível", VENCIDO: "Vencido — férias em dobro", QUITADO: "Quitado" }[p.status]} /></Td></tr>)}
            </Table>
            <Table head={["Tipo", "Período", "Dias", "Situação", "Justificativa", ""]} empty="Sem solicitações.">
              {leaves.map(l => (
                <tr key={l.id}>
                  <Td>{LEAVE_LABEL[l.tipo]}</Td><Td className="whitespace-nowrap">{fmtData(l.inicio)} – {fmtData(l.fim)}</Td><Td>{l.dias}</Td>
                  <Td><Badge v={l.status} label={LEAVE_STATUS[l.status]} />{l.motivoDecisao && <div className="text-xs text-slate-500">{l.motivoDecisao}</div>}</Td>
                  <Td className="max-w-[240px] text-slate-600">{l.tipo === "AFASTAMENTO_SAUDE" && !sensivel ? <span className="text-slate-400">restrito ao RH</span> : l.justificativa ?? "—"}</Td>
                  <Td>
                    {l.status === "SOLICITADA" && (
                      <form action={decidirAfastamento} className="flex flex-wrap gap-1">
                        <input type="hidden" name="id" value={l.id} /><input type="hidden" name="voltar" value={back} />
                        {podeAprovarFerias && <><Btn small name="decisao" value="APROVADA">Aprovar</Btn><Btn small kind="ghost" name="decisao" value="REJEITADA">Rejeitar</Btn></>}
                        <Btn small kind="ghost" name="decisao" value="CANCELADA">Cancelar</Btn>
                      </form>
                    )}
                    {l.status === "APROVADA" && l.inicio > h && can.editar(s) && (
                      <form action={decidirAfastamento}><input type="hidden" name="id" value={l.id} /><input type="hidden" name="voltar" value={back} /><Btn small kind="ghost" name="decisao" value="CANCELADA">Cancelar</Btn></form>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          </div>
          {can.solicitar(s) && emp.situacao !== "DESLIGADO" && (
            <form action={solicitarAfastamento} className="space-y-2 rounded-md border border-line bg-mist p-3">
              <div className="text-sm font-semibold text-navy">Nova solicitação</div>
              <input type="hidden" name="employeeId" value={id} /><input type="hidden" name="voltar" value={back} />
              <Field label="Tipo"><Select name="tipo" defaultValue="FERIAS">{LEAVE_TIPOS.map(t => <option key={t} value={t}>{LEAVE_LABEL[t]}</option>)}</Select></Field>
              <div className="grid grid-cols-2 gap-2"><Field label="Início"><Input name="inicio" type="date" required /></Field><Field label="Fim"><Input name="fim" type="date" required /></Field></div>
              <Field label="Justificativa" hint="Afastamentos por saúde: detalhes visíveis só para RH/Direção."><Textarea name="justificativa" className="min-h-[60px]" /></Field>
              <Btn small>Enviar para aprovação</Btn>
            </form>
          )}
        </div>
      </Card>

      {/* ---------- Banco de horas ---------- */}
      <Card title="Lançamentos do banco de horas" className="mt-4">
        <div id="banco" />
        <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
          <Table head={["Data", "Tipo", "Minutos", "Descrição", "Situação", ""]} empty="Nenhum lançamento. O saldo começa em zero.">
            {hours.map(x => (
              <tr key={x.id}>
                <Td className="whitespace-nowrap">{fmtData(x.data)}</Td><Td>{HOUR_LABEL[x.tipo]}</Td>
                <Td className={`font-medium tabular-nums ${x.minutos < 0 ? "text-erro" : "text-ok"}`}>{fmtMin(x.minutos)}</Td>
                <Td className="text-slate-600">{x.descricao ?? "—"}</Td><Td><Badge v={x.status} label={HOUR_STATUS[x.status]} /></Td>
                <Td>
                  <div className="flex gap-1">
                    {x.status === "PENDENTE" && podeAprovarBanco && <form action={decidirHoras} className="flex gap-1"><input type="hidden" name="id" value={x.id} /><input type="hidden" name="voltar" value={back} /><Btn small name="decisao" value="APROVADO">Aprovar</Btn><Btn small kind="ghost" name="decisao" value="REJEITADO">Rejeitar</Btn></form>}
                    {can.editar(s) && <form action={excluirHoras}><input type="hidden" name="id" value={x.id} /><input type="hidden" name="voltar" value={back} /><Btn small danger>Excluir</Btn></form>}
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
          {can.solicitar(s) && emp.situacao !== "DESLIGADO" && (
            <form action={lancarHoras} className="space-y-2 rounded-md border border-line bg-mist p-3">
              <div className="text-sm font-semibold text-navy">Novo lançamento</div>
              <input type="hidden" name="employeeId" value={id} /><input type="hidden" name="voltar" value={back} />
              <Field label="Data"><Input name="data" type="date" required defaultValue={h} /></Field>
              <Field label="Tipo" hint="Hora extra soma; atraso, falta e compensação descontam."><Select name="tipo" defaultValue="EXTRA">{HOUR_TIPOS.map(t => <option key={t} value={t}>{HOUR_LABEL[t]}</option>)}</Select></Field>
              <div className="grid grid-cols-3 gap-2"><Field label="Horas"><Input name="horas" type="number" min={0} defaultValue={0} /></Field><Field label="Minutos"><Input name="minutos" type="number" min={0} max={59} defaultValue={0} /></Field><Field label="Ajuste"><Select name="sinal" defaultValue="+"><option value="+">+</option><option value="-">−</option></Select></Field></div>
              <Field label="Descrição"><Input name="descricao" placeholder="Ex.: sábado letivo · reunião de pais" /></Field>
              <Btn small>{podeAprovarBanco ? "Lançar" : "Enviar para aprovação"}</Btn>
            </form>
          )}
        </div>
      </Card>

      {/* ---------- Documentos ---------- */}
      <Card title="Documentos" className="mt-4">
        <div id="documentos" />
        <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
          <Table head={["Documento", "Recebido em", "Validade", "Situação", "Link", ""]} empty="Nenhum documento listado.">
            {docs.map(d => { const st = docStatus(d); return (
              <tr key={d.id}>
                <Td>{d.tipo}{d.nome && <div className="text-xs text-slate-500">{d.nome}</div>}{!d.obrigatorio && <span className="ml-1 text-xs text-slate-400">opcional</span>}</Td>
                <Td>{fmtData(d.recebidoEm)}</Td><Td>{fmtData(d.validade)}</Td>
                <Td><Badge v={st} label={{ VENCIDO: "Vencido", VENCE_EM_BREVE: "Vence em 30 dias", RECEBIDO: "Recebido", PENDENTE: "Pendente", OPCIONAL: "Não entregue" }[st]} /></Td>
                <Td>{d.link ? <a className="text-acao" href={d.link} target="_blank" rel="noreferrer">abrir</a> : "—"}</Td>
                <Td>{can.editar(s) && <div className="flex gap-1">
                  {!d.recebidoEm && <form action={marcarRecebido}><input type="hidden" name="docId" value={d.id} /><input type="hidden" name="employeeId" value={id} /><Btn small>Recebido hoje</Btn></form>}
                  <Modal label={"Editar"} kind="ghost">
                    <form action={salvarDocumento} className="space-y-2">
                      <input type="hidden" name="docId" value={d.id} /><input type="hidden" name="employeeId" value={id} />
                      <Field label="Tipo"><Input name="tipo" defaultValue={d.tipo} required /></Field>
                      <Field label="Descrição"><Input name="nome" defaultValue={d.nome ?? ""} /></Field>
                      <Field label="Link (Drive)"><Input name="link" defaultValue={d.link ?? ""} /></Field>
                      <div className="grid grid-cols-2 gap-2"><Field label="Recebido em"><Input name="recebidoEm" type="date" defaultValue={d.recebidoEm ?? ""} /></Field><Field label="Validade"><Input name="validade" type="date" defaultValue={d.validade ?? ""} /></Field></div>
                      <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="obrigatorio" value="1" defaultChecked={d.obrigatorio} /> Obrigatório</label>
                      <div className="flex gap-1"><Btn small>Salvar</Btn><Btn small danger formAction={excluirDocumento}>Excluir</Btn></div>
                    </form></Modal>
                </div>}</Td>
              </tr>); })}
          </Table>
          {can.editar(s) && (
            <form action={salvarDocumento} className="space-y-2 rounded-md border border-line bg-mist p-3">
              <div className="text-sm font-semibold text-navy">Adicionar documento</div>
              <input type="hidden" name="employeeId" value={id} />
              <Field label="Tipo"><Input name="tipo" required placeholder="Ex.: ASO periódico" /></Field>
              <Field label="Link (Drive ou outro)"><Input name="link" placeholder="https://" /></Field>
              <div className="grid grid-cols-2 gap-2"><Field label="Recebido em"><Input name="recebidoEm" type="date" /></Field><Field label="Validade"><Input name="validade" type="date" /></Field></div>
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="obrigatorio" value="1" defaultChecked /> Obrigatório</label>
              <Btn small>Salvar</Btn>
            </form>
          )}
        </div>
      </Card>

      {/* ---------- Remuneração e 1:1 ---------- */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2 lg:items-start">
        {can.verSalario(s) && <Card title="Remuneração">
          <Table head={["Data", "De", "Para", "Motivo", "Justificativa"]} empty="Sem histórico salarial registrado.">{salHist.map((x, i) => <tr key={i}><Td>{fmtData(x.data)}</Td><Td className="tabular-nums">{fmtBRL(x.salario_anterior)}</Td><Td className="tabular-nums">{fmtBRL(x.salario)}</Td><Td className="text-xs">{MOTIVO_SAL[x.motivo] ?? x.motivo}</Td><Td className="text-xs text-slate-600">{x.obs ?? "—"}</Td></tr>)}</Table>
          {can.aprovar(s, cfg.alcadas.remuneracao) && emp.situacao !== "DESLIGADO" && <form action={reajustarSalario} className="mt-3 grid gap-2 border-t border-line pt-3 sm:grid-cols-[1fr_1fr_1fr_auto]"><input type="hidden" name="employeeId" value={id} /><Field label="Novo salário (R$)"><Input name="salario" type="number" step="0.01" min={0} required defaultValue={emp.salario ?? ""} /></Field><Field label="Motivo"><Select name="motivo" defaultValue="MERITO">{Object.entries(MOTIVO_SAL).filter(([k]) => k !== "ADMISSAO").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field><Field label="Justificativa"><Input name="obs" /></Field><div className="flex items-end"><Btn small>Reajustar</Btn></div></form>}
          {position && <p className="mt-2 text-xs text-slate-500"><Link className="text-acao" href={`/cargos-salarios/${position.id}`}>Ver faixa e ocupantes do cargo</Link></p>}
        </Card>}
        <Card title="Conversas 1:1">
          <ul className="space-y-1 text-sm">{checkins.length === 0 && <li className="text-slate-500">Nenhuma conversa registrada.</li>}{checkins.map(k => <li key={k.id}><span className="text-xs text-slate-500">{fmtData(k.data)} · {k.quem}</span> — {k.temas}{k.combinados && <div className="text-xs text-slate-600">Combinados: {k.combinados}</div>}</li>)}</ul>
          {["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR"].includes(s.role) && emp.situacao !== "DESLIGADO" && <form action={registrarCheckin} className="mt-3 grid gap-2 border-t border-line pt-3 sm:grid-cols-[140px_1fr_1fr_auto]"><input type="hidden" name="employeeId" value={id} /><Field label="Data"><Input name="data" type="date" defaultValue={h} /></Field><Field label="Temas"><Input name="temas" required /></Field><Field label="Combinados"><Input name="combinados" /></Field><div className="flex items-end"><Btn small kind="ghost">Registrar</Btn></div></form>}
          <p className="mt-2 text-xs text-slate-500"><Link className="text-acao" href="/desempenho">Ciclos de desempenho</Link></p>
        </Card>
      </div>

      <Card title={`Treinamentos obrigatórios${treinos && treinos.total ? ` — ${treinos.ok}/${treinos.total}` : ""}`} className="mt-4">
        <Table head={["Treinamento", "Situação", "Concluído em", "Válido até"]} empty="Nenhum treinamento obrigatório para este cargo/regime.">{(treinos?.itens ?? []).map(i => <tr key={i.curso.id}><Td>{i.curso.codigo} {i.curso.titulo}</Td><Td><Badge v={i.status === "CONCLUIDO" ? (i.vencendo ? "VENCE_EM_BREVE" : "APROVADA") : i.status === "VENCIDO" ? "VENCIDO" : "PENDENTE"} label={PROG_STATUS[i.status]} /></Td><Td className="text-xs">{fmtData(i.concluidoEm)}</Td><Td className="text-xs">{fmtData(i.validoAte)}</Td></tr>)}</Table>
        <p className="mt-2 text-xs text-slate-500"><Link className="text-acao" href="/academy/matriz">Matriz de treinamento</Link></p>
      </Card>

      {/* ---------- Histórico ---------- */}
      <Card title="Histórico de alterações" className="mt-4">
        <Table head={["Quando", "Quem", "Ação", "Detalhe"]} empty="Nenhuma alteração registrada.">
          {hist.map(a => <tr key={a.id}><Td className="whitespace-nowrap text-slate-500">{fmtDataHora(a.at)}</Td><Td>{a.userNome}</Td><Td>{a.acao}</Td><Td className="max-w-[420px] truncate text-xs text-slate-500">{a.depois ? JSON.stringify(a.depois).slice(0, 160) : ""}</Td></tr>)}
        </Table>
      </Card>

      {/* ---------- Desligamento ---------- */}
      {can.editar(s) && emp.situacao !== "DESLIGADO" && (
        <Card title="Desligar colaborador" className="mt-4 border-red-200">
          <div id="desligamento" />
          <form action={iniciarDesligamento} className="grid gap-3 sm:grid-cols-[180px_1fr_auto]">
            <input type="hidden" name="id" value={id} />
            <Field label="Data do desligamento"><Input name="desligamento" type="date" defaultValue={h} required /></Field>
            <Field label="Motivo"><Input name="motivo" placeholder="Ex.: pedido do colaborador · término de contrato · sem justa causa" /></Field>
            <div className="flex items-end"><Btn danger>Iniciar desligamento</Btn></div>
          </form>
          <div className="mt-2 text-xs text-slate-500">Abre o checklist de desligamento. O vínculo só é encerrado quando o checklist for concluído. Quem não tem histórico pode ser excluído: <form action={excluirColaborador} className="inline"><input type="hidden" name="id" value={id} /><button className="text-erro underline">excluir cadastro</button></form>.</div>
          <p className="mt-1 text-xs text-slate-500">Perfil atual: {ROLE_LABEL[s.role]}.</p>
        </Card>
      )}
    </Page>
  );
}

function tempoDeCasa(adm: string, ate: string) {
  const a = new Date(adm + "T00:00:00Z"), b = new Date(ate + "T00:00:00Z");
  let meses = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()); if (b.getUTCDate() < a.getUTCDate()) meses--;
  if (meses < 0) return "ainda não iniciou";
  const anos = Math.floor(meses / 12), m = meses % 12;
  return `${anos ? `${anos} ano${anos > 1 ? "s" : ""}` : ""}${anos && m ? " e " : ""}${m || !anos ? `${m} mês${m !== 1 ? "es" : ""}` : ""}`;
}
