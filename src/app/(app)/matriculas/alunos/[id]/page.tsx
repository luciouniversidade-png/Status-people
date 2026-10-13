import Link from "@/components/Link";
import { notFound } from "next/navigation";
import { eq, asc } from "drizzle-orm";
import { db, schema, sql } from "@/db";
import { requireMatriculas, can, scopeUnit } from "@/lib/auth";
import { Modal } from "@/components/Modal";
import { relacionamento, CONTATO_TIPO, PERCEPCAO } from "@/lib/radar-familia";
import { segmentoFamilia } from "@/lib/gestao-calc";
import { CANAL_LABEL } from "@/lib/atendimento";
import { atribuirCarteira, marcarEtapa, definirIndicacao } from "../../../atendimento/radar-actions";
import { FormInteracao, SegBadge } from "../../../atendimento/_radar";
import { Page, Card, Table, Td, Badge, Flash, Field, Select, Btn, Input } from "@/components/ui";
import { fmtData, fmtDataHora, getSettings, ENR_STATUS, WL_STATUS, idade, hoje } from "@/lib/utils";
import { processarVencimentos } from "@/lib/matriculas";
import { AlunoForm } from "../AlunoForm";
import { ReservaForm, AcoesMatricula, turmasAbertas } from "../../_shared";
import { entrarFila, sairFila } from "../../actions";
import { NovoCasoForm, usuariosAtivos } from "../../../atendimento/_shared";
import { atualizarSinais } from "../../../atendimento/actions";
import { riscoFamilias, CASE_TIPO_LABEL, CASE_STATUS, ABERTOS } from "@/lib/atendimento";
import { Anexos } from "@/components/Anexos";
import { EnviarMensagem } from "@/components/EnviarMensagem";
import { Copiar } from "@/components/Copiar";
import { appUrl } from "@/lib/url";
import { REM_STATUS } from "@/lib/rematricula";
import { gerarLinkRematricula, enviarConviteRematricula } from "../../rematricula/actions";
import { autorizacoes, docMascarado, GESTAO_SEG, podePortaria } from "@/lib/seguranca";
import { salvarAutorizacao, desativarAutorizacao } from "../../../operacoes/seguranca/actions";
import type { Session } from "@/lib/auth";
import { consentimentosAtuais, finalidades, podePrivacidade, CONSENT_STATUS, CONSENT_ORIGEM } from "@/lib/privacidade";
import { registrarConsentimento } from "../../../governanca/privacidade/actions";

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
  const scope = scopeUnit(s); const naUnidade = scope === null || st.unitAtualId === scope;
  const podeDistribuir = ["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR"].includes(s.role) && naUnidade; const atende = ["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR", "COMERCIAL"].includes(s.role) && naUnidade;
  const [rel, destinos, familiasRede] = await Promise.all([relacionamento(sid), podeDistribuir && st.alunoAtual ? usuariosAtivos().then(us => us.filter(x => !["DIRETOR_UNIDADE", "GESTOR"].includes(x.role) || x.unitId === st.unitAtualId)) : Promise.resolve([]),
    !st.alunoAtual && can.reservar(s) ? sql<{ id: number; nome: string; unidade: string | null }[]>`SELECT st.id, st.nome, u.nome AS unidade FROM students st LEFT JOIN units u ON u.id=st.unit_atual_id WHERE st.aluno_atual AND st.id <> ${sid} ORDER BY st.nome LIMIT 3000` : Promise.resolve([])]);
  const segmento = segmentoFamilia({ nivelRisco: risco?.nivel ?? null, saidaAberta: rel.saidaAberta, slaVencido: rel.slaVencido > 0, passoVencido: !!rel.passoVencido });
  const etapaSugerida = rel.etapas.find(e => e.status === "ATRASADA" || e.status === "PROXIMA")?.chave ?? null;
  const podeDesfazer = ["RH", "DIRECAO", "DIRETOR_UNIDADE"].includes(s.role) && naUnidade;
  const voltar = `/matriculas/alunos/${sid}`; const hojeIso = hoje(); const ativos = hist.filter(h => h.ano === ano && ["RESERVADA", "CONFIRMADA"].includes(h.status));
  return (
    <Page title={st.nome} sub={<span>{st.dataNascimento ? `${idade(st.dataNascimento)} anos · ` : ""}{st.alunoAtual ? "aluno da rede" : "candidato"}{st.responsavel ? ` · resp.: ${st.responsavel}` : ""}{st.telefone ? ` · ${st.telefone}` : ""} · <Link className="text-acao" href="/matriculas/alunos">lista</Link></span>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
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
          {st.alunoAtual && naUnidade && <Card title="Relacionamento e jornada da família" actions={atende ? <Modal label="Registrar interação" kind="primary" title={`Interação — ${st.nome}`}><FormInteracao studentId={sid} voltar={`${voltar}#relacionamento`} etapas={cfg.atendimento.jornada} etapaSugerida={etapaSugerida} /></Modal> : undefined}>
            <div id="relacionamento" />
            <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span>Segmento: <SegBadge s={segmento} pontos={risco?.pontos} /></span>
              <span>Carteira: <b>{rel.carteira ?? <span className="text-aviso">sem responsável</span>}</b></span>
              <span className={rel.diasSemContato === null || rel.diasSemContato > rel.semContatoDias ? "text-aviso" : ""}>Último contato: {rel.ultimoContato ? `${fmtData(rel.ultimoContato)} (há ${rel.diasSemContato} dia(s))` : "nunca registrado"}</span>
              {rel.passoVencido && <span className="text-erro">Próximo passo vencido em {fmtData(rel.passoVencido.em)}{rel.passoVencido.texto ? `: ${rel.passoVencido.texto}` : ""}</span>}
            </div>
            {podeDistribuir && <form action={atribuirCarteira} className="mb-3 flex flex-wrap items-end gap-2"><input type="hidden" name="studentId" value={sid} /><input type="hidden" name="voltar" value={`${voltar}#relacionamento`} /><Field label="Responsável pela família"><Select name="userId" defaultValue={rel.carteiraUserId ?? ""}><option value="">— sem responsável —</option>{destinos.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field><Btn small kind="ghost">Definir carteira</Btn></form>}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Jornada {rel.ano}</div>
                <ul className="space-y-1.5 text-sm">{rel.etapas.map(e => <li key={e.chave} className="flex flex-wrap items-center justify-between gap-2">
                  <span>{e.nome}<span className="text-xs text-slate-500">{e.prazo ? ` · até ${fmtData(e.prazo)}` : ""}</span></span>
                  {e.registro ? <span className="flex items-center gap-1 text-xs text-ok">cumprida {fmtData(e.registro.concluida_em)}{e.registro.usuario ? ` · ${e.registro.usuario}` : ""}{podeDesfazer && <form action={marcarEtapa} className="inline"><input type="hidden" name="studentId" value={sid} /><input type="hidden" name="etapa" value={e.chave} /><input type="hidden" name="ano" value={rel.ano} /><input type="hidden" name="desfazer" value="1" /><input type="hidden" name="voltar" value={`${voltar}#relacionamento`} /><button className="ml-1 text-slate-400 hover:text-erro" aria-label={`desfazer ${e.nome}`}>desfazer</button></form>}</span>
                    : <span className="flex items-center gap-1.5"><Badge v={e.status === "ATRASADA" ? "REJEITADA" : e.status === "PROXIMA" ? "PENDENTE" : "NEUTRO"} label={e.status === "ATRASADA" ? "atrasada" : e.status === "PROXIMA" ? "próxima" : e.status === "SEM_PRAZO" ? "sem prazo" : "futura"} />{atende && <form action={marcarEtapa}><input type="hidden" name="studentId" value={sid} /><input type="hidden" name="etapa" value={e.chave} /><input type="hidden" name="voltar" value={`${voltar}#relacionamento`} /><Btn small kind="ghost">Cumprida</Btn></form>}</span>}
                </li>)}</ul></div>
              <div><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Interações</div>
                {rel.contatos.length === 0 ? <p className="text-sm text-slate-500">Nenhuma interação registrada.</p> : <ul className="space-y-2 text-sm">{rel.contatos.map(c => <li key={c.id}><div className="text-xs text-slate-500">{fmtData(c.data)} · {CONTATO_TIPO[c.tipo] ?? c.tipo}{c.canal ? ` · ${CANAL_LABEL[c.canal] ?? c.canal}` : ""} · {c.user_nome ?? "—"}{c.percepcao ? <> · <span className={c.percepcao === "NEGATIVA" ? "text-erro" : c.percepcao === "POSITIVA" ? "text-ok" : ""}>{PERCEPCAO[c.percepcao]}</span></> : null}</div><div className="text-slate-700">{c.resumo}</div>{c.proximo_passo && <div className={`text-xs ${c.proximo_em && c.proximo_em < hojeIso ? "text-erro" : "text-acao"}`}>Próximo passo: {c.proximo_passo}{c.proximo_em ? ` até ${fmtData(c.proximo_em)}` : ""}</div>}</li>)}</ul>}
              </div>
            </div>
            {rel.indicados.length > 0 && <p className="mt-3 border-t border-line pt-2 text-xs text-slate-600">Indicou à escola: {rel.indicados.map((x, k) => <span key={x.id}>{k ? ", " : ""}<Link className="text-acao" href={`/matriculas/alunos/${x.id}`}>{x.nome}</Link>{x.aluno_atual ? " (aluno)" : ""}</span>)}</p>}
          </Card>}
          {!st.alunoAtual && <Card title="Indicação"><p className="mb-2 text-sm">{rel.indicadoPor ? <>Indicado pela família de <Link className="text-acao" href={`/matriculas/alunos/${rel.indicadoPorId}`}>{rel.indicadoPor}</Link>.</> : "Sem indicação registrada."}</p>
            {can.reservar(s) && <form action={definirIndicacao} className="flex flex-wrap items-end gap-2"><input type="hidden" name="studentId" value={sid} /><input type="hidden" name="voltar" value={voltar} /><Field label="Família que indicou (aluno da rede)" className="min-w-[260px] flex-1"><Input name="indicadoPor" list="familias-rede" defaultValue={rel.indicadoPor && rel.indicadoPorId ? `${rel.indicadoPor} (#${rel.indicadoPorId})` : ""} placeholder="comece a digitar o nome do aluno" /></Field><datalist id="familias-rede">{familiasRede.map(f => <option key={f.id} value={`${f.nome}${f.unidade ? ` — ${f.unidade}` : ""} (#${f.id})`} />)}</datalist><Btn small kind="ghost">Salvar indicação</Btn></form>}
            <p className="mt-2 text-xs text-slate-500">Sem origem definida, a origem do candidato passa a ser Indicação — conta no funil de captação por canal. Deixe em branco e salve para remover.</p></Card>}
          <Card title="Mensagem à família" className="mt-4 print:hidden"><EnviarMensagem nome={st.responsavel ?? st.nome} contato={st.telefone ?? st.email ?? ""} vars={{ aluno: st.nome }} categoria="MATRICULA" entidade="student" entidadeId={sid} studentId={sid} unitId={st.unitAtualId ?? null} voltar={`/matriculas/alunos/${sid}`} /></Card>
          <Anexos entidade="student" id={sid} voltar={`/matriculas/alunos/${sid}`} titulo="Documentos da matrícula" />
          <Card title="Dados do aluno">{can.reservar(s) ? <AlunoForm st={st} /> : <p className="text-sm text-slate-600">Somente leitura.</p>}</Card>
        </div>
        <div className="space-y-4">
          {st.alunoAtual && <AutorizacoesCard s={s} sid={sid} voltar={voltar} naUnidade={naUnidade} />}
          {st.alunoAtual && naUnidade && <RetiradaCard s={s} sid={sid} voltar={voltar} />}
          <div id="rematricula" />
          {st.alunoAtual && <RematriculaCard sid={sid} ano={ano} pode={can.reservar(s) && naUnidade} temReserva={ativos.some(a => a.modalidade === "REGULAR")} voltar={voltar} />}
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

/** Rematrícula do ano letivo pelo link: situação, envio e evidência do aceite. */
async function RematriculaCard({ sid, ano, pode, temReserva, voltar }: { sid: number; ano: number; pode: boolean; temReserva: boolean; voltar: string }) {
  const [l] = await sql<{ id: number; status: string; token: string; expira_em: string; enviado_em: string | null; aberto_em: string | null; concluido_em: string | null; recusa_motivo: string | null; case_id: number | null; contrato_versao: number | null; aceite: { nome: string; em: string } | null; serie: string | null }[]>`SELECT l.id, l.status, l.token, l.expira_em::text, l.enviado_em::text, l.aberto_em::text, l.concluido_em::text, l.recusa_motivo, l.case_id, l.contrato_versao, l.aceite, g.nome AS serie FROM rematricula_links l LEFT JOIN grades g ON g.id=l.grade_id WHERE l.student_id=${sid} AND l.ano=${ano} ORDER BY (l.status='PENDENTE') DESC, l.id DESC LIMIT 1`;
  const url = l ? `${await appUrl()}/rematricula/${l.token}` : "";
  return (
    <Card title={`Rematrícula ${ano}`}>
      {!l ? <p className="text-sm text-slate-600">{temReserva ? `Já tem reserva ou matrícula em ${ano}.` : "Nenhum link gerado."}</p> : <div className="space-y-1 text-sm">
        <div><Badge v={l.status === "CONCLUIDA" ? "APROVADA" : l.status === "RECUSADA" ? "REJEITADA" : l.status === "PENDENTE" ? "PENDENTE" : "CANCELADA"} label={REM_STATUS[l.status]} /> <span className="text-xs text-slate-500">{l.serie ? `série prevista ${l.serie}` : ""}</span></div>
        {l.status === "PENDENTE" && <p className="text-xs text-slate-600">Vale até {fmtData(l.expira_em)} · {l.aberto_em ? `aberto em ${fmtDataHora(l.aberto_em)}` : l.enviado_em ? `enviado em ${fmtDataHora(l.enviado_em)}` : "ainda não enviado"}</p>}
        {l.status === "CONCLUIDA" && <p className="text-xs text-slate-600">Contrato v{l.contrato_versao} aceito por {l.aceite?.nome} em {fmtDataHora(l.aceite?.em ?? l.concluido_em)}.</p>}
        {l.status === "RECUSADA" && <p className="text-xs text-slate-600">Motivo: {l.recusa_motivo}{l.case_id ? <> · <Link className="text-acao" href={`/atendimento/casos/${l.case_id}`}>pedido de saída #{l.case_id}</Link></> : null}</p>}
      </div>}
      {pode && <div className="mt-2 flex flex-wrap gap-1">
        {l?.status === "PENDENTE" ? <><form action={enviarConviteRematricula}><input type="hidden" name="id" value={l.id} /><input type="hidden" name="voltar" value={voltar} /><Btn small>Enviar por WhatsApp</Btn></form><Copiar texto={url} /></>
          : !temReserva && <form action={gerarLinkRematricula}><input type="hidden" name="studentId" value={sid} /><input type="hidden" name="voltar" value={voltar} /><Btn small kind="ghost">Gerar link de rematrícula</Btn></form>}
        <Link className="self-center text-xs text-acao" href="/matriculas/rematricula">painel da rematrícula</Link>
      </div>}
    </Card>
  );
}

/** Quem pode buscar o aluno (e quem não pode). Restrição só a gestão registra e vê o detalhe; a portaria vê o alerta. */
async function RetiradaCard({ s, sid, voltar }: { s: Session; sid: number; voltar: string }) {
  const gest = GESTAO_SEG.includes(s.role); const edita = can.reservar(s) || await podePortaria(s);
  if (!edita && s.role !== "LEITURA" && !gest) return null;
  const lista = (await autorizacoes(sid)).filter(a => a.ativo); const h = hoje();
  return (
    <Card title="Quem pode buscar">
      <div id="retirada" />
      {lista.length === 0 ? <p className="text-sm text-slate-500">Ninguém cadastrado: na portaria, só a coordenação libera.</p> : <ul className="space-y-1.5 text-sm">{lista.map(a => <li key={a.id} className={`rounded border px-2 py-1 ${a.tipo === "PROIBIDO" ? "border-erro bg-red-50 text-erro" : "border-line"}`}>
        <div className="flex items-center justify-between gap-2"><span><b>{a.tipo === "PROIBIDO" ? "NÃO entregar: " : ""}{a.nome}</b>{a.parentesco ? ` · ${a.parentesco}` : ""}</span>
          {(a.tipo === "PROIBIDO" ? gest : edita) && <form action={desativarAutorizacao}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="voltar" value={`${voltar}#retirada`} /><button className="text-xs text-slate-500 hover:text-erro">remover</button></form>}</div>
        <div className="text-[11px] text-slate-500">doc. {docMascarado(a.documento)}{a.telefone ? ` · ${a.telefone}` : ""}{a.validade ? ` · até ${fmtData(a.validade)}${a.validade < h ? " (vencida)" : ""}` : ""}</div>
        {a.tipo === "PROIBIDO" && gest && a.restricao_obs && <div className="text-[11px]">{a.restricao_obs}</div>}
      </li>)}</ul>}
      {edita && <details className="mt-2"><summary className="cursor-pointer text-xs text-acao">Incluir pessoa</summary>
        <form action={salvarAutorizacao} className="mt-2 space-y-2"><input type="hidden" name="studentId" value={sid} /><input type="hidden" name="voltar" value={`${voltar}#retirada`} />
          <Field label="Nome completo"><Input name="nome" required /></Field>
          <div className="grid grid-cols-2 gap-2"><Field label="Parentesco"><Input name="parentesco" placeholder="avó, motorista…" /></Field><Field label="Documento"><Input name="documento" /></Field><Field label="Telefone"><Input name="telefone" /></Field><Field label="Válido até"><Input name="validade" type="date" /></Field></div>
          {gest ? <><Field label="Tipo"><Select name="tipo" defaultValue="AUTORIZADO"><option value="AUTORIZADO">Autorizado a buscar</option><option value="PROIBIDO">NÃO pode buscar (restrição)</option></Select></Field><Field label="Base da restrição (só para restrição)"><Input name="restricaoObs" placeholder="decisão judicial nº…, pedido formal do responsável legal" /></Field></> : <input type="hidden" name="tipo" value="AUTORIZADO" />}
          <Btn small kind="ghost">Salvar</Btn></form></details>}
    </Card>
  );
}

/** Autorizações (LGPD): situação vigente por finalidade e registro pela secretaria; revogar avisa marketing e direção. */
async function AutorizacoesCard({ s, sid, voltar, naUnidade }: { s: Session; sid: number; voltar: string; naUnidade: boolean }) {
  const [fins, atual] = await Promise.all([finalidades(), consentimentosAtuais([sid])]);
  if (!fins.length) return null;
  const edita = naUnidade && (can.reservar(s) || await podePrivacidade(s));
  return (
    <Card title="Autorizações de imagem e divulgação">
      <div id="autorizacoes" />
      <ul className="space-y-1.5 text-sm">{fins.map(f => { const c = atual.get(`${sid}:${f.id}`); const st = c?.status ?? "SEM_REGISTRO"; return <li key={f.id}><div className="flex items-center justify-between gap-2"><span>{f.titulo}</span><Badge v={st === "CONCEDIDO" ? "APROVADA" : st === "REVOGADO" ? "REJEITADA" : st === "NEGADO" ? "NEUTRO" : "PENDENTE"} label={CONSENT_STATUS[st]} /></div>{c && <div className="text-[11px] text-slate-500">{fmtData(c.em.slice(0, 10))} · {CONSENT_ORIGEM[c.origem] ?? c.origem}{c.titular_nome ? ` · ${c.titular_nome}` : ""}{c.versao !== f.versao ? ` · texto v${c.versao} (atual v${f.versao})` : ""}</div>}</li>; })}</ul>
      {edita && <details className="mt-2"><summary className="cursor-pointer text-xs text-acao">Registrar autorização ou revogação</summary>
        <form action={registrarConsentimento} className="mt-2 space-y-2"><input type="hidden" name="studentId" value={sid} /><input type="hidden" name="voltar" value={`${voltar}#autorizacoes`} />
          <Field label="Finalidade"><Select name="purposeId" required>{fins.map(f => <option key={f.id} value={f.id}>{f.titulo}</option>)}</Select></Field>
          <div className="grid grid-cols-2 gap-2"><Field label="Situação"><Select name="status" required><option value="CONCEDIDO">Autorizou</option><option value="NEGADO">Não autorizou</option><option value="REVOGADO">Revogou</option></Select></Field><Field label="Origem"><Select name="origem"><option value="SECRETARIA">Termo na secretaria</option><option value="PEDIDO_TITULAR">Pedido do responsável</option></Select></Field></div>
          <Field label="Responsável que assinou"><Input name="titularNome" required /></Field><Field label="Observação"><Input name="obs" /></Field>
          <Btn small kind="ghost">Registrar</Btn><p className="text-[11px] text-slate-500">Revogar avisa o marketing e a direção para não usar mais a imagem. A matrícula não depende disto.</p></form></details>}
    </Card>
  );
}
