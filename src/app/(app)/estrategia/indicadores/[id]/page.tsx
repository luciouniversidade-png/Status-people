import Link from "@/components/Link";
import { Modal } from "@/components/Modal";
import { notFound } from "next/navigation";
import { requireGestao, scopeUnit } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Table, Td, Badge, Flash, Field, Input, Btn } from "@/components/ui";
import { fmtData, fmtDataHora, getSettings, hoje } from "@/lib/utils";
import { listarIndicadores, listarAcoes, fmtValor, TIPO_IND, ACAO_STATUS, ORIGEM_FUNIL_LABEL } from "@/lib/gestao-estrategica";
import { FREQ_LABEL, DIRECAO_IND, ultimosPeriodos, periodoDe, nomePeriodo, farol, type Perspectiva } from "@/lib/gestao-calc";
import { FONTES } from "@/lib/estrategia";
import { registrarMedicao, ativarIndicador } from "../../gestao-actions";
import { SubNav, FarolBadge, GraficoSerie, regraFarol } from "../../_ui";
import { FormIndicador, opcoesIndicador } from "../_form";
import { FormAcao, opcoesAcao } from "../../acoes/_form";

export const dynamic = "force-dynamic";

export default async function Indicador({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireGestao(); const { id } = await params; const sp = await searchParams; const iid = Number(id); if (!Number.isInteger(iid)) notFound();
  const u = scopeUnit(s); const cfg = await getSettings();
  const [i] = await listarIndicadores(u, { ids: [iid], incluirInativos: true, meses: 24 }); if (!i) notFound();
  const [historico, refs, acoes] = await Promise.all([
    sql<{ periodo: string; valor: number | null; origem: string; obs: string | null; user_nome: string | null; updated_at: Date }[]>`SELECT periodo, valor::float, origem, obs, user_nome, updated_at FROM indicator_values WHERE indicator_id=${iid} ORDER BY periodo DESC LIMIT 36`,
    i.tipo === "CALCULADO" ? sql<{ id: number; nome: string }[]>`SELECT id, nome FROM indicators WHERE id IN (${i.numerador_id ?? 0}, ${i.denominador_id ?? 0})` : Promise.resolve([] as { id: number; nome: string }[]),
    listarAcoes(u, { situacao: "TODAS", indicatorId: iid, limite: 50 })]);
  const ESTR = ["DIRECAO", "RH"].includes(s.role);
  const podeEditar = ESTR || (s.role === "DIRETOR_UNIDADE" && i.unit_id !== null && i.unit_id === s.unitId);
  const podeMedir = i.tipo === "MANUAL" && i.ativo && (ESTR || i.responsavel_user_id === s.id || (s.role === "DIRETOR_UNIDADE" && i.unit_id === s.unitId) || (i.funil === "INVESTIMENTO" && s.role === "COMERCIAL"));
  const podeAcao = ["DIRECAO", "RH", "DIRETOR_UNIDADE", "GESTOR", "FINANCEIRO", "OPERACOES", "COMERCIAL"].includes(s.role);
  const per = ultimosPeriodos(periodoDe(hoje()), 13); const nomeP = new Map((cfg.estrategia.perspectivas as Perspectiva[]).map(p => [p.chave, p.nome]));
  const [opcoes, opAcao] = await Promise.all([podeEditar ? opcoesIndicador(s) : null, podeAcao ? opcoesAcao(s) : null]);
  const nomeRef = (rid: number | null) => refs.find(r => r.id === rid)?.nome ?? "—";
  const linhas = i.tipo === "CALCULADO" ? Object.keys({ ...i.serie, ...i.motivos }).sort().reverse().map(p => ({ periodo: p, valor: i.serie[p] ?? null, origem: "CALCULADO", obs: i.motivos[p] ?? null, user_nome: null as string | null, updated_at: null as Date | null })) : historico;
  return (
    <Page title={`${i.codigo ? `${i.codigo} · ` : ""}${i.nome}`} sub={<span className="flex flex-wrap items-center gap-2"><FarolBadge f={i.farol} /> {TIPO_IND[i.tipo]} · {FREQ_LABEL[i.frequencia] ?? i.frequencia} · {i.unidade ?? "rede"}{i.perspectiva ? ` · ${nomeP.get(i.perspectiva) ?? i.perspectiva}` : ""}{i.area ? ` · ${i.area}` : ""}{i.ativo ? "" : " · INATIVO"}</span>}
      actions={<>{podeEditar && opcoes && <Modal label="Editar indicador" small={false} title="Editar indicador"><FormIndicador o={opcoes} i={i} /></Modal>}<Btn kind="ghost" href="/estrategia/indicadores">Indicadores</Btn></>}>
      <SubNav atual="indicadores" />
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="space-y-4">
          <Card title="Série dos últimos 13 meses"><GraficoSerie periodos={per} serie={i.serie} config={i.config} unidade={i.unidade_medida} />
            <p className="mt-2 text-xs text-slate-600"><b>Regra do farol:</b> {regraFarol(i.config, i.unidade_medida)}</p>
            {!i.emDia && <p className="mt-1 text-xs text-aviso">Medição atrasada: a última é de {i.ultimoPeriodo ? nomePeriodo(i.ultimoPeriodo) : "—"} e a frequência é {(FREQ_LABEL[i.frequencia] ?? i.frequencia).toLowerCase()}.</p>}
          </Card>
          <Card title="Medições">
            <Table head={["Período", "Valor", "Farol", "Origem", "Registrado por", "Observação"]} empty="Nenhuma medição ainda.">{linhas.map(v => <tr key={v.periodo}><Td className="whitespace-nowrap">{nomePeriodo(v.periodo)}</Td><Td className="whitespace-nowrap tabular-nums font-medium">{fmtValor(v.valor, i.unidade_medida)}</Td><Td><FarolBadge f={farol(v.valor, i.config)} /></Td><Td className="text-xs">{v.origem === "SISTEMA" ? "sistema" : v.origem === "IMPORTACAO" ? "planilha" : v.origem === "CALCULADO" ? "calculado" : "manual"}</Td><Td className="text-xs">{v.user_nome ?? "—"}{v.updated_at ? <div className="text-[11px] text-slate-500">{fmtDataHora(v.updated_at)}</div> : null}</Td><Td className="text-xs text-slate-600">{v.obs ?? ""}</Td></tr>)}</Table>
            <p className="mt-2 text-xs text-slate-500">Correções de medição substituem o valor do período e o valor anterior fica na auditoria.</p>
          </Card>
          <Card title={`Ações ligadas a este indicador (${acoes.length})`} actions={podeAcao && opAcao ? <Modal label="Nova ação" title="Nova ação para este indicador"><FormAcao o={opAcao} padrao={{ indicatorId: iid, unitId: i.unit_id, origem: `Indicador: ${i.nome}`, voltar: `/estrategia/indicadores/${iid}` }} /></Modal> : undefined}>
            <Table head={["O quê", "Quem", "Prazo", "Situação"]} empty="Nenhuma ação ligada. Indicador fora do alvo pede plano: o quê, quem e quando.">{acoes.map(a => <tr key={a.id}><Td>{a.titulo}</Td><Td className="text-xs">{a.responsavel ?? "—"}</Td><Td className={`whitespace-nowrap text-xs ${a.vencida ? "text-erro" : ""}`}>{fmtData(a.prazo)}</Td><Td><Badge v={a.status === "CONCLUIDA" ? "APROVADA" : a.status === "CANCELADA" ? "CANCELADA" : a.status === "BLOQUEADA" || a.vencida ? "PENDENTE" : "EM_ADMISSAO"} label={a.vencida ? "Vencida" : ACAO_STATUS[a.status]} /></Td></tr>)}</Table>
          </Card>
        </div>
        <div className="space-y-4">
          {podeMedir && <Card title="Registrar medição"><form action={registrarMedicao} className="space-y-2"><input type="hidden" name="indicatorId" value={iid} />
            <div className="grid grid-cols-2 gap-2"><Field label="Período"><Input name="periodo" type="month" required max={periodoDe(hoje())} defaultValue={periodoDe(hoje())} /></Field><Field label={`Valor${i.unidade_medida ? ` (${i.unidade_medida})` : ""}`}><Input name="valor" required inputMode="decimal" type="number" step="any" /></Field></div>
            <Field label="Observação"><Input name="obs" placeholder="fonte, ressalva" /></Field><Btn small>Registrar</Btn></form></Card>}
          <Card title="Ficha do indicador"><dl className="space-y-1.5 text-sm">
            <div><dt className="text-xs text-slate-500">Direção</dt><dd>{DIRECAO_IND[i.direcao]}</dd></div>
            <div><dt className="text-xs text-slate-500">Último valor</dt><dd className="tabular-nums">{fmtValor(i.ultimoValor, i.unidade_medida)} {i.ultimoPeriodo ? <span className="text-xs text-slate-500">({nomePeriodo(i.ultimoPeriodo)})</span> : null}</dd></div>
            {i.descricao && <div><dt className="text-xs text-slate-500">O que mede</dt><dd className="whitespace-pre-line text-slate-700">{i.descricao}</dd></div>}
            {i.tipo === "SISTEMA" && <div><dt className="text-xs text-slate-500">Lido do sistema</dt><dd>{i.fonte ? FONTES[i.fonte]?.nome ?? i.fonte : "—"}</dd></div>}
            {i.tipo === "CALCULADO" && <div><dt className="text-xs text-slate-500">Cálculo</dt><dd><Link className="text-acao" href={`/estrategia/indicadores/${i.numerador_id}`}>{nomeRef(i.numerador_id)}</Link> ÷ <Link className="text-acao" href={`/estrategia/indicadores/${i.denominador_id}`}>{nomeRef(i.denominador_id)}</Link>{i.fator !== null && i.fator !== 1 ? ` × ${i.fator}` : ""}<div className="text-xs text-slate-500">mês a mês; sem medição em um dos lados ou denominador zero → sem base (não vira zero)</div></dd></div>}
            {i.funil === "INVESTIMENTO" && <div><dt className="text-xs text-slate-500">Funil de marketing</dt><dd>Investimento em captação{i.canal ? ` — ${ORIGEM_FUNIL_LABEL[i.canal] ?? i.canal}` : ""} · <Link className="text-acao" href="/estrategia/marketing">ver funil</Link></dd></div>}
            <div><dt className="text-xs text-slate-500">Responsável pela medição</dt><dd>{i.responsavel ?? "—"}</dd></div>
            <div><dt className="text-xs text-slate-500">Objetivo ligado</dt><dd>{i.objective_id ? <Link className="text-acao" href={`/estrategia/okrs/${i.objective_id}`}>{i.objetivo}</Link> : "—"}</dd></div>
          </dl>
            {podeEditar && <form action={ativarIndicador} className="mt-3 border-t border-line pt-3"><input type="hidden" name="id" value={iid} /><input type="hidden" name="ativo" value={i.ativo ? "0" : "1"} /><Btn small kind="ghost" danger={i.ativo}>{i.ativo ? "Desativar indicador" : "Reativar indicador"}</Btn><p className="mt-1 text-xs text-slate-500">Desativar tira o indicador das contas e dos alertas; as medições ficam preservadas.</p></form>}
          </Card>
        </div>
      </div>
    </Page>
  );
}
