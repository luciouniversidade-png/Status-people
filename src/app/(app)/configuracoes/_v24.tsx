import { sql } from "@/db";
import { Card, Field, Input, Select, Textarea, Btn } from "@/components/ui";
import { getSettings } from "@/lib/utils";
import { TIPOS_DOC } from "@/lib/folha-calc";
import { salvarParametrosV24 } from "./v24-actions";

/** Configurações da Nova Arquitetura (v24): uma seção por regra, cada uma com a sua validação e trilha na auditoria. */
export async function ParametrosV24() {
  const cfg = await getSettings();
  const [users, catsBanco] = await Promise.all([sql<{ id: number; nome: string; role: string }[]>`SELECT id, nome, role FROM users WHERE ativo AND role <> 'COLABORADOR' ORDER BY nome`, sql<{ c: string }[]>`SELECT DISTINCT categoria AS c FROM cash_entries WHERE categoria IS NOT NULL ORDER BY 1`]);
  const a = cfg.alertas as { slaHoras: Record<string, number>; reabrirTratadoDias: number; donos: Record<string, string[]>; donoUsuario: Record<string, number> };
  const d = cfg.dre as Record<string, string[]>; const catsDre = [...new Set([...(cfg.financeiro.categoriasEntrada as string[]), ...(cfg.financeiro.categoriasSaida as string[]), ...d.deducoes, ...d.pessoal, ...d.financeiras, ...d.internas, ...catsBanco.map(x => x.c)])];
  const pesos = cfg.board.pesosFunil as Record<string, number>; const donosCat = (cfg.orcamento.donosCategoria ?? {}) as Record<string, number>;
  const Sec = ({ id, titulo, children, nota }: { id: string; titulo: string; children: React.ReactNode; nota?: string }) => <details className="rounded-md border border-line bg-white" id={`v24-${id}`}><summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-navy">{titulo}</summary><form action={salvarParametrosV24} className="space-y-2 border-t border-line p-3"><input type="hidden" name="secao" value={id} />{children}{nota && <p className="text-[11px] text-slate-500">{nota}</p>}<Btn small>Salvar</Btn></form></details>;
  const Check = ({ name, value, on, rotulo }: { name: string; value: string; on: boolean; rotulo: string }) => <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" name={name} value={value} defaultChecked={on} /> {rotulo}</label>;
  return (
    <Card title="Nova Arquitetura (v24) — regras e parâmetros" className="mb-4"><div id="v24" />
      <div className="space-y-2">
        <Sec id="alertas" titulo="Central de alertas — SLA, donos e reabertura" nota="Dono por módulo: atuações em ordem de preferência (o primeiro com usuário ativo). Usuário fixo sobrepõe a atuação. Sem dono resolvível = defeito de configuração (aparece na central).">
          <div className="grid grid-cols-3 gap-2"><Field label="SLA crítico (h)"><Input name="slaAlto" defaultValue={a.slaHoras.ALTO} /></Field><Field label="SLA atenção (h)"><Input name="slaMedio" defaultValue={a.slaHoras.MEDIO} /></Field><Field label="Reabrir tratado após (dias)"><Input name="reabrir" defaultValue={a.reabrirTratadoDias} /></Field></div>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">{Object.entries(a.donos).map(([m, rs]) => <div key={m} className="grid grid-cols-[7.5rem_minmax(0,1fr)_minmax(0,1fr)] items-center gap-1.5 text-xs"><span className="font-medium">{m}</span><Input name={`donos_${m}`} defaultValue={rs.join(", ")} className="!py-1 !text-xs" aria-label={`Atuações donas de ${m}`} /><Select name={`fixo_${m}`} defaultValue={a.donoUsuario?.[m] ?? ""} className="!py-1 !text-xs" aria-label={`Usuário fixo de ${m}`}><option value="">— sem fixo —</option>{users.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></div>)}</div>
        </Sec>
        <Sec id="aprovacoes" titulo="Aprovações em lote, quadro e painel do dia" nota="Limites de lote: só a Direção altera. Pedido que estoura limite nunca entra no lote — vira exceção com decisão individual.">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3"><Field label="Limite de HE no mês (h/pessoa)"><Input name="limiteHeH" defaultValue={Number(cfg.aprovacoes.limiteHeMensalMin) / 60} /></Field><Field label="Maior lançamento no lote (h)"><Input name="maxLancH" defaultValue={Number(cfg.aprovacoes.maxLancamentoMin) / 60} /></Field><Field label="Férias: mínimo de presentes no setor (%)"><Input name="minPres" defaultValue={cfg.aprovacoes.feriasMinimoPresentesPct} /></Field><Field label="Jornada plena para FTE (min/dia)"><Input name="jornadaPlena" defaultValue={cfg.quadro.jornadaPlenaMin} /></Field><Field label="Início padrão do turno"><Input name="inicioPadrao" defaultValue={cfg.ponto.inicioPadrao} placeholder="07:00" /></Field><Field label="Tolerância do no-show (min)"><Input name="tolerancia" defaultValue={cfg.ponto.toleranciaNoShowMin} /></Field></div>
        </Sec>
        <Sec id="folha" titulo="Payroll Bridge — conferência e arquivo" nota="Cálculo da folha segue com o contador (decisão vigente). Variação acima do limite exige explicação antes do aceite.">
          <div className="grid grid-cols-2 gap-2"><Field label="Variação máxima sem explicação (%)"><Input name="variacao" defaultValue={cfg.folha.variacaoMaxPct} /></Field><Field label="Holerites sorteados na conferência"><Input name="amostra" defaultValue={cfg.folha.amostraHolerites} /></Field></div>
          <fieldset><legend className="text-xs font-medium text-slate-600">Documentos obrigatórios para arquivar</legend><div className="mt-1 flex flex-wrap gap-3">{Object.entries(TIPOS_DOC).map(([k, v]) => <Check key={k} name="docs" value={k} on={(cfg.folha.docsObrigatorios as string[]).includes(k)} rotulo={v} />)}</div></fieldset>
          <Check name="lock" value="1" on={!!cfg.folha.exigirLockTodas} rotulo="Pacote só sai com o ponto de todas as unidades da entidade fechado" />
        </Sec>
        <Sec id="obrigacoes" titulo="Obrigações fiscais — calendário-modelo e avisos" nota="Uma linha por obrigação: tipo | dia do vencimento no mês seguinte à competência (vazio = cadastrar manualmente). Fim de semana antecipa; feriados e datas legais: confira com o contador.">
          <Field label="Calendário-modelo"><Textarea name="modelos" defaultValue={(cfg.obrigacoes.modelos as { tipo: string; dia: number | null }[]).map(m => `${m.tipo} | ${m.dia ?? ""}`).join("\n")} className="min-h-[110px] font-mono text-xs" /></Field>
          <Field label="Avisos antes do vencimento (dias)"><Input name="avisos" defaultValue={(cfg.obrigacoes.avisosDias as number[]).join(", ")} /></Field>
        </Sec>
        <Sec id="sst" titulo="SST — ASO, investigação e conformidade" nota="O PCMSO e o médico do trabalho prevalecem. Nunca guardamos dado clínico: só tipo, datas, aptidão e restrição administrativa.">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3"><Field label="Periodicidade padrão do ASO (meses)"><Input name="aso" defaultValue={cfg.sst.asoMesesPadrao} /></Field><Field label="Prazo da investigação (dias)"><Input name="investigacao" defaultValue={cfg.sst.investigacaoDias} /></Field><Field label="Afastamento que pede ASO de retorno (dias)"><Input name="retorno" defaultValue={cfg.sst.afastamentoRetornoDias} /></Field><Field label="Último exame dispensa o demissional (dias)"><Input name="dispensa" defaultValue={cfg.sst.dispensaDemissionalDias} /></Field></div>
          <Check name="admissional" value="1" on={!!cfg.sst.exigirAsoAdmissional} rotulo="Item “Exame admissional (ASO)” só conclui com o ASO registrado" />
          <Field label="Áreas de cursos da Academy que entram na conformidade (uma por linha)"><Textarea name="areas" defaultValue={(cfg.sst.areasCursos as string[]).join("\n")} className="min-h-[50px]" /></Field>
        </Sec>
        <Sec id="financeiro" titulo="Orçado × real, DRE e Board" nota="Categoria acima do teto da banda no mês encerrado gera pedido de explicação ao dono (sem dono: direção da unidade, depois Financeiro). Transferências internas ficam fora da DRE (eliminação).">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5"><Field label="Banda mínima (%)"><Input name="faixaMin" defaultValue={cfg.orcamento.faixaMinPct} /></Field><Field label="Banda máxima (%)"><Input name="faixaMax" defaultValue={cfg.orcamento.faixaMaxPct} /></Field><Field label="Peso: matrícula"><Input name="pConf" defaultValue={pesos.CONFIRMADA ?? 1} /></Field><Field label="Peso: reserva"><Input name="pRes" defaultValue={pesos.RESERVADA ?? 0.6} /></Field><Field label="Peso: fila"><Input name="pFila" defaultValue={pesos.FILA ?? 0.15} /></Field></div>
          <h4 className="text-xs font-semibold text-slate-600">Dono de cada categoria de despesa</h4>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">{(cfg.financeiro.categoriasSaida as string[]).map(c => <div key={c} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-1.5 text-xs"><span>{c}</span><Select name={`dono_${c}`} defaultValue={donosCat[c] ?? ""} className="!py-1 !text-xs" aria-label={`Dono de ${c}`}><option value="">— padrão —</option>{users.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></div>)}</div>
          {(["deducoes", "pessoal", "financeiras", "internas"] as const).map(k => <fieldset key={k}><legend className="text-xs font-medium text-slate-600">DRE · {k === "deducoes" ? "deduções da receita" : k === "pessoal" ? "pessoal (substituído pela folha aceita)" : k === "financeiras" ? "resultado financeiro" : "transferências internas (eliminadas)"}</legend><div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">{catsDre.map(c => <Check key={c} name={k} value={c} on={d[k].includes(c)} rotulo={c} />)}</div></fieldset>)}
        </Sec>
        <Sec id="acao" titulo="Ação requerida — documentos de matrícula" nota="Uma linha por documento: nome | validade em meses (vazio = não vence).">
          <Field label="Documentos exigidos"><Textarea name="documentos" defaultValue={(cfg.acaoRequerida.documentos as { tipo: string; validadeMeses: number | null }[]).map(x => `${x.tipo} | ${x.validadeMeses ?? ""}`).join("\n")} className="min-h-[110px] font-mono text-xs" /></Field>
          <div className="grid grid-cols-2 gap-2"><Field label="Vencendo em até (dias)"><Input name="vencendo" defaultValue={cfg.acaoRequerida.vencendoDias} /></Field><Field label="Reservas vencendo em até (h)"><Input name="reservaH" defaultValue={cfg.acaoRequerida.reservaHoras} /></Field></div>
        </Sec>
        <Sec id="onboarding" titulo="Onboarding 30-60-90 — modelo" nota="Uma linha por item: marco (7, 30, 60 ou 90) | título | tipo (TAREFA, TRILHA, CHECKIN, PESQUISA) | responsável (RH, GESTOR, BUDDY, NOVATO). Vale para os próximos planos.">
          <Field label="Itens do modelo"><Textarea name="modelo" defaultValue={(cfg.onboarding.modelo as { marco: number; titulo: string; tipo: string; responsavel: string }[]).map(x => `${x.marco} | ${x.titulo} | ${x.tipo} | ${x.responsavel}`).join("\n")} className="min-h-[150px] font-mono text-xs" /></Field>
        </Sec>
      </div>
    </Card>
  );
}
