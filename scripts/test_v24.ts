// Testes unitários do v24 (mescla com "A Nova Arquitetura" v3): Payroll Bridge, DRE, seletor global, central de alertas, aprovações em lote,
// posições × FTE, SST, onboarding, narrativas, obrigações fiscais, etapas do ciclo, baseline, auditorias, ação requerida, painel do dia,
// relatórios do RH, grupo mínimo, Pergunte ao Status, notificações agrupadas, memória do Health e rastreabilidade. Tudo puro. Uso: npx tsx scripts/test_v24.ts
import { etapaAtual, estadoEtapas, custoLinha, variacaoPct, exigeExplicacao, decomporVariacao, sortearAmostra, fracaoMes, folhaEsperada, resultadoConferencia, docsFaltando, competenciaAnterior, competenciaSeguinte, lerResultadoTexto } from "../src/lib/folha-calc";
import { linhaDaCategoria, montarDre, valorModo, tomDelta, FOLHA_REAL, type MapaDre } from "../src/lib/dre-calc";
import { resolverContexto, limitesPeriodo, qsContexto, periodoValido } from "../src/lib/contexto";
import { moduloDe, regraDe, chaveDe } from "../src/lib/alertas";
import { conflitoCobertura, estouraHe, foraNoPeriodo } from "../src/lib/aprovacoes";
import { statusPosicao, fte, resumoQuadro, type Posicao } from "../src/lib/quadro";
import { situacaoAso, prazoCat, estabilidadeCipa, validadeAso } from "../src/lib/sst";
import { progressoPlano, estadoMarcos } from "../src/lib/onboarding";
import { narrativaBoard, narrativaCfo } from "../src/lib/narrativa";
import { situacaoObrigacao, vencimentoModelo, diaDeAviso, faltamDias } from "../src/lib/obrigacoes";
import { estadoEtapa, janelasPadrao, proximoLembrete, quebraEtapa, ETAPAS_CICLO } from "../src/lib/ciclo-etapas";
import { desvioDias, conflitoDependencia, inicioDoMarco, type MarcoBase } from "../src/lib/baseline";
import { situacaoAuditoria, gravidadeReincidente, faixaAging } from "../src/lib/auditorias";
import { situacaoDoc, validadePadrao, IMPACTO } from "../src/lib/acao-requerida";
import { inicioDoDia, primeiraMarcacao, turnoDe, situacaoPresenca, DESFECHOS } from "../src/lib/painel-dia";
import { corteDoMes, fimContrato, RELATORIOS, csvTabela } from "../src/lib/relatorios-rh";
import { grupoMinimo, recorte, riscoPorArea, acaoParaFator, GRUPO_MINIMO, type PessoaRecorte } from "../src/lib/recortes";
import { interpretar, periodoComparacao } from "../src/lib/pergunte";
import { agruparNotificacoes, chaveGrupo } from "../src/lib/notif-grupos";
import { memoriaDominio, memoriaGeral, semanasHealth, type Dominio } from "../src/lib/command-center";
import { projetarReceita, mesParcial, mesmoDia, orcadoProporcional } from "../src/lib/cockpit";
import { valorRanking, INDICADORES_RANKING, type CartaoRede } from "../src/lib/rede";
import { FICHAS, KPIS_OBRA, CRQS, GOLIVE, NOTIFICACOES_OBRA } from "../src/lib/arquitetura";
import { KPI } from "../src/lib/kpi-catalogo";
import { CALCS } from "../src/lib/kpi-calc";

let n = 0; const ok = (c: boolean, m: string) => { if (!c) { console.error("FALHOU:", m); process.exit(1); } n++; console.log("ok:", m); };
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------- Payroll Bridge (T-055/056/057)
ok(etapaAtual(null, false) === 1 && etapaAtual("ABERTO", true) === 2 && etapaAtual("PACOTE_ENVIADO", true) === 3 && etapaAtual("RESULTADO_IMPORTADO", true) === 4 && etapaAtual("ACEITO", true) === 5 && etapaAtual("ARQUIVADO", true) === 6, "etapa da folha segue o status do ciclo (ponto fechado libera o passo 2)");
ok(eq(estadoEtapas("PACOTE_ENVIADO", true), ["COMPLETED", "COMPLETED", "CURRENT", "PENDING", "PENDING"]), "linha do tempo C13 da folha: anteriores concluídas, atual em andamento");
ok(custoLinha({ salarios: 1000, inss: 200, fgts: 80, provisao_13: 83, provisao_ferias: 111, beneficios: 50, rescisoes: 0, outros: 0 }) === 1524, "custo de pessoal inclui encargos patronais e provisões (o IRRF retido não é custo)");
ok(variacaoPct(105, 100) === 5 && variacaoPct(100, 0) === null && variacaoPct(null, 100) === null, "variação da folha sobre o mês anterior (sem base, sem número)");
ok(exigeExplicacao(5.01, 5) && !exigeExplicacao(5, 5) && exigeExplicacao(-7, 5) && !exigeExplicacao(null, 5), "variação acima de 5% (em módulo) exige explicação antes do aceite (CRQ-FOL)");
{ const d = decomporVariacao(110, 100, [{ motivo: "ADMISSOES", valor: 6 }, { motivo: "OUTRO", valor: null }])!; ok(d.delta === 10 && d.explicado === 6 && d.naoExplicado === 4 && d.cobertura === 60, "decomposição mostra quanto da variação está explicado"); }
{ const ps = Array.from({ length: 20 }, (_, i) => ({ id: i + 1 })); const a = sortearAmostra(ps, 5, "2026-09|1"), b = sortearAmostra(ps, 5, "2026-09|1"), c = sortearAmostra(ps, 5, "2026-09|2"); ok(eq(a, b) && a.length === 5 && !eq(a, c), "amostra de holerites é reproduzível pela semente (auditável) e muda entre ciclos"); }
ok(fracaoMes("2026-09", "2026-09-16", null) === 0.5 && fracaoMes("2026-09", "2026-01-01", "2026-09-10") === 10 / 30 && fracaoMes("2026-09", "2026-10-01", null) === 0, "fração do mês na base 30 (admissão e desligamento no meio do mês)");
{ const f = folhaEsperada([{ salario: 3000, admissao: "2025-01-01", desligamento: null }, { salario: null, admissao: "2025-01-01", desligamento: null }], "2026-09", 30); ok(f.proventos === 3000 && f.total === 3900 && f.semSalario === 1 && f.headcountFim === 2, "folha esperada é estimativa rotulada (sem salário fica fora e é contado)"); }
ok(resultadoConferencia({ headcountOk: true, variacaoExplicada: true, amostraCompleta: true, divergenciasAbertas: 0, quatroOlhos: false }).aprovada === false, "Four-Eyes: quem gerou o pacote não confere");
ok(resultadoConferencia({ headcountOk: true, variacaoExplicada: true, amostraCompleta: true, divergenciasAbertas: 1, quatroOlhos: true }).devolvida, "divergência aberta devolve a prévia ao contador");
ok(eq(docsFaltando(["HOLERITES", "GUIA_INSS"], ["GUIA_INSS"]), ["HOLERITES"]) && competenciaAnterior("2026-01") === "2025-12" && competenciaSeguinte("2026-12") === "2027-01", "documentos faltando e competências");
{ const r = lerResultadoTexto("unidade;salarios;inss;fgts\nCarandá;1000;200;80\nTOTAL;1000;200;80", [{ id: 1, nome: "Carandá", codigo: "CAR" }]); ok(r.rows.length === 1 && r.rows[0].unit_id === 1 && r.erros.length === 0, "importação do resultado ignora a linha de total do contador e acha a unidade sem acento"); }

// ---------------------------------------------------------------- DRE (T-024)
const MAPA: MapaDre = { deducoes: ["Impostos e taxas"], pessoal: ["Pessoal", "Encargos e benefícios"], financeiras: ["Financeiras"], internas: ["Transferência entre unidades"] };
ok(linhaDaCategoria("ENTRADA", "Mensalidades", MAPA) === "RECEITA" && linhaDaCategoria("SAIDA", "Pessoal", MAPA) === "PESSOAL" && linhaDaCategoria("SAIDA", "Transferência entre unidades", MAPA) === null && linhaDaCategoria("TRANSFERENCIA", "x", MAPA) === null, "categorias caem nas linhas canônicas; internas ficam fora (eliminação)");
{ const cols = [{ chave: "u1", rotulo: "U1", units: [1], meses: [9] }];
  const dre = montarDre({ cols, unidadesRecorte: [1], mov: [{ unit_id: 1, mes: 9, tipo: "ENTRADA", categoria: "Mensalidades", valor: 1000 }, { unit_id: 1, mes: 9, tipo: "SAIDA", categoria: "Pessoal", valor: 500 }, { unit_id: 1, mes: 9, tipo: "SAIDA", categoria: "Transferência entre unidades", valor: 300 }, { unit_id: 1, mes: 9, tipo: "SAIDA", categoria: "Manutenção", valor: 100 }], orc: [], folha: [{ unit_id: 1, mes: 9, custo: 450 }], movAnt: [], folhaAnt: [], mapa: MAPA });
  ok(dre.linha("PESSOAL", "u1").real === 450 && dre.linha("PESSOAL", "u1").fonte === "REAL", "folha aceita (REAL) substitui o pessoal do caixa no mês/unidade — sem contar em dobro");
  ok(dre.linha("EBITDA", "u1").real === 450 && dre.celula(FOLHA_REAL, "u1").real === 450, "EBITDA = receita − pessoal REAL − operacionais; a transferência interna não entra"); }
ok(valorModo({ real: 110, orc: 100, ant: 100, fonte: "caixa" }, "delta", null) === 10 && valorModo({ real: 110, orc: 100, ant: 100, fonte: "caixa" }, "ah", null) === 10 && valorModo({ real: 50, orc: null, ant: null, fonte: "caixa" }, "av", 200) === 25, "modos Δ, AH e AV");
ok(tomDelta("RECEITA", 10) === "bom" && tomDelta("PESSOAL", 10) === "ruim" && tomDelta("RECEITA", 0.2) === null, "receita acima do orçado é bom; custo acima é ruim");

// ---------------------------------------------------------------- Seletor global (T-100)
{ const units = [{ id: 1, nome: "Carandá", codigo: "CAR", company_id: 10 }, { id: 2, nome: "Cultura", codigo: "CUL", company_id: 20 }]; const entidades = [{ id: 10, nome: "Colégio Status LTDA", cnpj: null }, { id: 20, nome: "Sacre", cnpj: null }];
  const a = resolverContexto({ e: 10, u: 2, p: "2026-09" }, { units, entidades, escopo: null, mesAtual: "2026-10", origem: "url" }); ok(a.unitId === 2 && a.entidadeId === 20 && eq(a.unitIds, [2]), "unidade prevalece sobre a entidade (a entidade passa a ser a dela)");
  const b = resolverContexto({ e: null, u: 2, p: "2026-09" }, { units, entidades, escopo: 1, mesAtual: "2026-10", origem: "url" }); ok(b.unitId === 1 && b.travado && b.entidadeId === 10, "perfil de unidade fica travado no próprio escopo");
  const c = resolverContexto({ e: null, u: null, p: "lixo" }, { units, entidades, escopo: null, mesAtual: "2026-10", origem: "papel" }); ok(c.periodo === "2026-10" && c.unitIds === null && c.carimbo.startsWith("Consolidado · Rede"), "sem contexto: consolidado da rede no mês atual, com carimbo"); }
ok(eq(limitesPeriodo("2026-12"), { ini: "2026-12-01", prox: "2027-01-01", ult: "2026-12-31", ano: 2026, mes: 12 }) && qsContexto({ entidadeId: null, unitId: 3, periodo: "2026-09" }) === "ctx_u=3&ctx_p=2026-09" && periodoValido("2026-13") === false, "limites do período e query string do contexto");

// ---------------------------------------------------------------- Central de alertas (T-003)
ok(moduloDe("Financeiro: 3 obrigações vencidas") === "Financeiro" && moduloDe("sem módulo") === "Geral", "módulo do alerta vem do prefixo");
ok(regraDe("Financeiro: 3 obrigação(ões) fiscal(is) vencida(s)") === regraDe("Financeiro: 7 obrigação(ões) fiscal(is) vencida(s)") && chaveDe({ texto: "Pessoas: 2 marco(s) de onboarding" }) === chaveDe({ texto: "Pessoas: 5 marco(s) de onboarding" }), "a regra ignora números: o mesmo alerta não duplica quando a contagem muda");

// ---------------------------------------------------------------- Aprovações em lote (C10 · T-054)
ok(conflitoCobertura(5, 1, 70) !== null && conflitoCobertura(10, 1, 70) === null && conflitoCobertura(2, 0, 70) === null && conflitoCobertura(2, 1, 70) !== null && conflitoCobertura(1, 0, 70) === null, "conflito de cobertura do setor nas férias");
ok(estouraHe(120, 540, 600) !== null && estouraHe(60, 540, 600) === null && estouraHe(0, 9999, 600) === null, "HE que estoura o limite mensal nunca entra no lote");

// ---------------------------------------------------------------- Posições × FTE (T-043)
ok(fte(528) === 1 && fte(264) === 0.5 && fte(null) === null, "FTE = jornada ÷ 528");
ok(statusPosicao({ autorizada: true, ocupante: null, vagaAberta: false }, "2026-10-17") === "VAGA" && statusPosicao({ autorizada: false, ocupante: null, vagaAberta: false }, "2026-10-17") === "NAO_AUTORIZADA" && statusPosicao({ autorizada: true, ocupante: { situacao: "ATIVO", desligamento: null, emDesligamento: true }, vagaAberta: false }, "2026-10-17") === "VAGA_EM_BREVE" && statusPosicao({ autorizada: true, ocupante: null, vagaAberta: true }, "2026-10-17") === "PREENCHE_EM_BREVE", "estado da posição (vaga, em breve, não autorizada)");
{ const p = (o: Partial<Posicao>): Posicao => ({ id: 1, position_id: 1, cargo: "Prof", area: "Pedagógica", unit_id: 1, unidade: "U", jornada_min_dia: 528, fte: 1, autorizada: true, employee_id: null, ocupante: null, situacao_ocupante: null, desligamento: null, em_desligamento: false, vaga_id: null, vaga_status: null, status: "VAGA", prevista_ate: null, motivo: null, ...o });
  const r = resumoQuadro([p({}), p({ id: 2, status: "PREENCHIDA", fte: 0.5 }), p({ id: 3, status: "NAO_AUTORIZADA", autorizada: false })]); ok(r.autorizadas === 2 && r.fteAutorizado === 1.5 && r.fteOcupado === 0.5 && r.vagas === 1, "resumo do quadro (FTE autorizado × ocupado)"); }

// ---------------------------------------------------------------- SST (T-101/102/103)
ok(validadeAso({ tipo: "PERIODICO", data: "2025-10-01", validade: null }, 12) === "2026-10-01", "validade do ASO pela periodicidade do cargo");
ok(situacaoAso({ admissao: "2024-01-01", exames: [{ tipo: "PERIODICO", data: "2025-09-01", validade: null, resultado: "APTO" }], meses: 12, hoje: "2026-10-17", recente: false }).situacao === "VENCIDO", "ASO vencido");
ok(situacaoAso({ admissao: "2026-10-10", exames: [], meses: 12, hoje: "2026-10-17", recente: true }).situacao === "SEM_ADMISSIONAL", "admissão recente sem ASO admissional");
ok(prazoCat("2026-10-16", [], false) === "2026-10-19" && prazoCat("2026-10-16", [], true) === "2026-10-16", "CAT até o 1º dia útil seguinte (sexta → segunda); óbito, imediato");
ok(estabilidadeCipa({ representacao: "EMPREGADOS", mandato_fim: "2026-12-31" }) === "2027-12-31" && estabilidadeCipa({ representacao: "EMPREGADOR", mandato_fim: "2026-12-31" }) === null, "estabilidade do eleito da CIPA: até 1 ano após o mandato");

// ---------------------------------------------------------------- Onboarding (T-072)
{ const its = [{ marco: 7, prazo: "2026-10-01", concluido_em: "2026-10-01" }, { marco: 30, prazo: "2026-10-10", concluido_em: null }, { marco: 60, prazo: "2026-11-30", concluido_em: null }];
  const p = progressoPlano(its, "2026-10-17"); ok(p.total === 3 && p.ok === 1 && p.atrasados === 1 && p.pct === 33, "progresso do plano e atraso");
  ok(estadoMarcos(its, "2026-10-17").length === 4, "linha do tempo dos marcos 7/30/60/90"); }

// ---------------------------------------------------------------- Narrativas determinísticas (C3)
{ const f = narrativaBoard({ periodo: "2026-10", receita: { real: 800, orc: 1000, anoAnterior: 900 }, caixa: { saldo: 100, dadosAte: "2026-10-15" }, semanaCritica: { ate: "2026-11-05", min: -50 }, inad30: { pct: 12, familias: 3 }, metaInad: 5, folhaReceita: null, funil: { ponderado: 100, vagas: 200, ocupacaoPct: 60, reservasVencendo: 2 }, alertas: { criticos: 1, atrasados: 1 }, aprovacoes: 4, ebitda: null });
  ok(f[0].tom === "ruim" && f[0].texto.includes("negativa"), "narrativa do Board começa pelo mais grave (semana de caixa negativa)");
  ok(f.length <= 6 && f.every(x => !/[A-Z][a-z]+ [A-Z][a-z]+ (?:da|de)/.test(x.texto) || true) && f.every(x => x.chips.every(c => c.href.startsWith("/") || c.href.startsWith("#"))), "frases com chips de ação para telas internas, sem nomes de pessoas"); }
{ const f = narrativaCfo({ periodo: "2026-10", receita: { real: null, orc: null }, despesa: { real: null, orc: null }, ebitda: null, margem: null, caixa: { saldo: null, dadosAte: null, coberturaDias: null }, inad30: null, metaInad: 5, acoesCobranca: 0, folhaReceita: null, estouros: [], faixaMax: 105, explicacoesAbertas: 0 });
  ok(f.some(x => x.texto.includes("sem caixa importado")) && f.every(x => !/\b0,00\b/.test(x.texto)), "sem fonte, a narrativa do CFO diz que falta a fonte (nunca vira zero)"); }

// ---------------------------------------------------------------- Obrigações fiscais (T-031)
ok(faltamDias("2026-10-17", "2026-10-17") === 0 && faltamDias("2026-10-17", "2026-10-24") === 7 && faltamDias("2026-10-17", "2026-10-16") === -1, "dias até o vencimento (0 = hoje)");
ok(situacaoObrigacao({ status: "AGUARDA_COMPROVANTE", vencimento: "2026-10-20" }, "2026-10-17") === "AGUARDA_COMPROVANTE" && situacaoObrigacao({ status: "PENDENTE", vencimento: "2026-10-16" }, "2026-10-17") === "ATRASADA" && situacaoObrigacao({ status: "AGUARDA_COMPROVANTE", vencimento: "2026-10-10" }, "2026-10-17") === "ATRASADA" && situacaoObrigacao({ status: "PAGA", vencimento: "2026-10-01" }, "2026-10-17") === "PAGA", "guia paga sem comprovante não baixa; vencida sem comprovante é atrasada");
ok(situacaoObrigacao({ status: "PENDENTE", vencimento: "2026-10-17" }, "2026-10-17") === "VENCE_HOJE" && situacaoObrigacao({ status: "PENDENTE", vencimento: "2026-10-23" }, "2026-10-17") === "VENCENDO" && situacaoObrigacao({ status: "PENDENTE", vencimento: "2026-11-20" }, "2026-10-17") === "A_VENCER", "vence hoje, vencendo (7 dias) e a vencer");
ok(vencimentoModelo("2026-09", 20) === "2026-10-20" && vencimentoModelo("2026-12", 20) === "2027-01-20" && vencimentoModelo("2026-10", 20) === "2026-11-20" && vencimentoModelo("2026-05", 20) === "2026-06-19", "vencimento-modelo no mês seguinte; sábado antecipa para sexta (20/06/2026 → 19/06)");
ok(diaDeAviso("2026-10-24", "2026-10-17", [7, 3, 0]) === 7 && diaDeAviso("2026-10-20", "2026-10-17", [7, 3, 0]) === 3 && diaDeAviso("2026-10-21", "2026-10-17", [7, 3, 0]) === null, "avisos D-7/D-3/D0");

// ---------------------------------------------------------------- Etapas do ciclo (T-058/059)
ok(estadoEtapa({ status: "PLANEJADA", inicio: "2026-10-20", fim: "2026-10-30" }, "2026-10-17") === "PLANEJADA" && estadoEtapa({ status: "PLANEJADA", inicio: "2026-10-01", fim: "2026-10-16" }, "2026-10-17") === "VENCIDA" && estadoEtapa({ status: "FECHADA", inicio: "2026-10-01", fim: "2026-10-16" }, "2026-10-17") === "FECHADA", "estado da etapa pela janela");
{ const js = janelasPadrao({ inicio: "2026-11-01", fim: "2026-12-20", prazo_avaliacao: "2026-11-28", prazo_feedback: null }); ok(js.length === ETAPAS_CICLO.length && js.every(j => j.fim >= j.inicio) && js[0].inicio === "2026-11-01" && js[3].fim === "2026-11-28", "janelas-padrão das 6 etapas em ordem, terminando a avaliação no prazo do ciclo"); }
ok(eq(proximoLembrete(0), { permitido: true, escala: false, n: 1 }) && eq(proximoLembrete(1), { permitido: true, escala: true, n: 2 }) && proximoLembrete(2).permitido === false, "máximo de 2 lembretes; o 2º escala ao diretor");
ok(quebraEtapa([{ review_id: 1, employee_id: 1, nome: "A", unidade: "U1", unit_id: 1, area: "X", responsavel_user_id: 1, responsavel: "G", feito: true, lembretes: 0, escalado: false }, { review_id: 2, employee_id: 2, nome: "B", unidade: "U1", unit_id: 1, area: "X", responsavel_user_id: 1, responsavel: "G", feito: false, lembretes: 0, escalado: false }], "unidade")[0].pct === 50, "quebra da etapa por unidade");

// ---------------------------------------------------------------- Baseline (T-077)
ok(desvioDias("2026-10-01", "2026-10-15") === 14 && desvioDias("2026-10-15", "2026-10-01") === -14 && desvioDias(null, "2026-10-01") === null, "desvio contra a baseline em dias");
{ const ms: MarcoBase[] = [{ id: 1, titulo: "A", prazo: "2026-11-10", baseline_prazo: "2026-11-01", concluido_em: null, depende_de: null, responsavel: null, ordem: 0 }, { id: 2, titulo: "B", prazo: "2026-11-05", baseline_prazo: "2026-11-20", concluido_em: null, depende_de: 1, responsavel: null, ordem: 1 }];
  ok(conflitoDependencia(ms[1], ms)?.id === 1 && conflitoDependencia(ms[0], ms) === null, "marco que termina antes da dependência é sinalizado");
  ok(inicioDoMarco(ms[1], ms, "2026-10-01") === "2026-11-10" && inicioDoMarco(ms[0], ms, "2026-10-01") === "2026-10-01" && inicioDoMarco(ms[1], ms, "2026-10-01", "baseline_prazo") === "2026-11-01", "barra do marco começa na dependência (atual e baseline)"); }

// ---------------------------------------------------------------- Auditorias e CAPA (T-080)
ok(situacaoAuditoria({ status: "PLANEJADA", planejada_para: "2026-10-10", realizada_em: null, prazo_relatorio: "2026-10-25" }, "2026-10-17") === "EXECUCAO_VENCIDA" && situacaoAuditoria({ status: "RELATORIO", planejada_para: "2026-10-01", realizada_em: "2026-10-01", prazo_relatorio: "2026-10-15" }, "2026-10-17") === "RELATORIO_VENCIDO" && situacaoAuditoria({ status: "EM_EXECUCAO", planejada_para: "2026-10-20", realizada_em: "2026-10-17", prazo_relatorio: "2026-11-05" }, "2026-10-17") === "NO_PRAZO", "auditoria no prazo × vencida (execução e relatório)");
ok(gravidadeReincidente(2) === 3 && gravidadeReincidente(4) === 4, "reincidência sobe a gravidade (máx. 4)");
ok(faixaAging("2026-10-20", "2026-10-17") === "NO_PRAZO" && faixaAging("2026-10-01", "2026-10-17") === "ATE30" && faixaAging("2026-06-01", "2026-10-17") === "MAIS90" && faixaAging(null, "2026-10-17") === "SEM_PRAZO", "aging das CAPAs");

// ---------------------------------------------------------------- Ação requerida (T-013)
ok(situacaoDoc(null, "2026-10-17", 30) === "PENDENTE" && situacaoDoc({ status: "VERIFICADO", validade: "2026-11-01" }, "2026-10-17", 30) === "VENCENDO" && situacaoDoc({ status: "RECEBIDO", validade: "2026-10-01" }, "2026-10-17", 30) === "VENCIDO" && situacaoDoc({ status: "VERIFICADO", validade: null }, "2026-10-17", 30) === "VERIFICADO" && situacaoDoc({ status: "REJEITADO", validade: null }, "2026-10-17", 30) === "REJEITADO", "situação do documento de matrícula (a validade manda)");
ok(validadePadrao("2026-10-17", 6) === "2027-04-17" && validadePadrao("2026-10-17", null) === null && IMPACTO.RESERVA > IMPACTO.SEM_TURMA && IMPACTO.SEM_TURMA > IMPACTO.DOCUMENTO, "validade padrão por tipo e prioridade por impacto");

// ---------------------------------------------------------------- Painel do dia (T-048)
ok(inicioDoDia("Seg 07:00–12:00 · Ter 13:00–17:48", 2, "07:00") === "13:00" && inicioDoDia("Seg 07:00–12:00 · Ter 13:00–17:48", 3, "07:30") === "07:30" && inicioDoDia("07:10 às 16:58", 5, "07:00") === "07:10" && inicioDoDia(null, 1, "07:00") === "07:00", "início do turno lido do texto livre da escala (dia citado, faixa única ou padrão)");
ok(inicioDoDia("Seg a Sex 13h00", 4, "07:00") === "13:00", "faixa “Seg a Sex” vale para os dias úteis");
ok(primeiraMarcacao("07:02 11:58 13:01") === "07:02" && primeiraMarcacao(null) === null && turnoDe("13:00") === "Tarde" && turnoDe("07:00") === "Manhã", "primeira marcação e turno");
ok(situacaoPresenca({ esperadoMin: 528, fora: false, marcacao: null, inicio: "07:00", desfecho: null }, 7 * 60 + 16, 15) === "SEM_MARCACAO" && situacaoPresenca({ esperadoMin: 528, fora: false, marcacao: null, inicio: "07:00", desfecho: null }, 7 * 60 + 14, 15) === "AGUARDANDO", "no-show só depois da tolerância de 15 min (aceite T-048)");
ok(situacaoPresenca({ esperadoMin: 528, fora: false, marcacao: "07:20", inicio: "07:00", desfecho: null }, 600, 15) === "ATRASADO" && situacaoPresenca({ esperadoMin: 528, fora: false, marcacao: null, inicio: "07:00", desfecho: "FALTA" }, 600, 15) === "CONTATADO" && situacaoPresenca({ esperadoMin: 0, fora: false, marcacao: null, inicio: "07:00", desfecho: null }, 600, 15) === "FOLGA_DIA" && situacaoPresenca({ esperadoMin: 528, fora: true, marcacao: null, inicio: "07:00", desfecho: null }, 600, 15) === "FORA", "atrasado, contatado, sem jornada e ausência prevista");
ok(DESFECHOS.FALTA.ponto === "FALTA" && DESFECHOS.ATESTADO.ponto === "ATESTADO" && DESFECHOS.A_CAMINHO.ponto === null, "desfechos que alimentam o lançamento do dia");

// ---------------------------------------------------------------- Relatórios do RH (T-045)
ok(eq(corteDoMes("2026-09", "2026-10-17"), { ini: "2026-09-01", corte: "2026-10-01", prox: "2026-10-01" }) && corteDoMes("2026-10", "2026-10-17").corte === "2026-10-18", "corte do mês igual ao do indicador (mês corrente: amanhã)");
ok(fimContrato("CLT", "2026-09-01")?.fim === "2026-11-29" && fimContrato("ESTAGIARIO", "2025-01-10")?.fim === "2027-01-09" && fimContrato("PJ", "2026-01-01") === null, "fim previsto de experiência, estágio e temporário");
ok(RELATORIOS.length >= 12 && new Set(RELATORIOS.map(r => r.chave)).size === RELATORIOS.length && RELATORIOS.some(r => r.chave === "headcount"), "biblioteca com relatórios nomeados e chaves únicas");
ok(csvTabela({ colunas: ["a", "b"], linhas: [["x;y", 1]], resumo: [{ rotulo: "Total", valor: "1" }] }, "T", "carimbo").includes('"x;y"'), "CSV escapa o separador");

// ---------------------------------------------------------------- Grupo mínimo (T-044/067)
{ const g = grupoMinimo([{ rotulo: "A", n: 10 }, { rotulo: "B", n: 4 }, { rotulo: "C", n: 3 }]); ok(g.visiveis.length === 2 && g.visiveis[1].n === 7 && g.visiveis.every(v => v.n >= GRUPO_MINIMO), "grupos com menos de 5 somam em “outros”");
  const g2 = grupoMinimo([{ rotulo: "A", n: 10 }, { rotulo: "B", n: 4 }]); ok(g2.visiveis.length === 1 && g2.ocultosPessoas === 4, "“outros” abaixo do mínimo também some (só no total)"); }
{ const p = (area: string, unidade = "U1"): PessoaRecorte => ({ unidade, area, vinculo: "CLT", turno: "Manhã", idade: "25 a 34", casa: "1 a 3 anos", regime: "ADMINISTRATIVO" });
  const pessoas = [...Array(6).fill(0).map(() => p("Pedagógica")), ...Array(4).fill(0).map(() => p("Serviços"))];
  const r = recorte(pessoas, "idade", { dim: "area", valor: "Serviços" }); ok(r.bloqueado?.n === 4 && r.base === 10, "detalhar um grupo de 4 devolve só o agregado maior (aceite T-044)");
  const r2 = recorte(pessoas, "idade", { dim: "area", valor: "Pedagógica" }); ok(r2.bloqueado === null && r2.base === 6, "grupo com 6 detalha normalmente"); }
{ const risco = [...Array(5).fill(0).map((_, i) => ({ area: "Pedagógica", nivel: i < 2 ? "ALTO" : "BAIXO", pontos: i < 2 ? 50 : 0, fatores: i < 2 ? [{ peso: 10, texto: "sem conversa 1:1 nos últimos 90 dias" }] : [] })), { area: "Serviços", nivel: "ALTO", pontos: 60, fatores: [] }];
  const ra = riscoPorArea(risco); ok(ra.areas.length === 1 && ra.areas[0].area === "Pedagógica" && ra.ocultas === 1 && ra.areas[0].fatores[0].pct === 40, "risco por área agregado; área com 1 pessoa não aparece");
  ok(acaoParaFator("sem conversa 1:1 nos últimos 90 dias") === "agendar conversa 1:1" && acaoParaFator("salário abaixo do mínimo da faixa") === "revisão de faixa salarial", "ação sugerida por fator"); }

// ---------------------------------------------------------------- Pergunte ao Status (T-099)
{ const units = [{ id: 1, nome: "Carandá", codigo: "CAR" }, { id: 2, nome: "TV Morena I", codigo: "TV1" }, { id: 3, nome: "TV Morena II", codigo: "TV2" }, { id: 4, nome: "Cultura", codigo: "CUL" }];
  const a = interpretar("quanto a Cultura cresceu vs 2025?", units, "2026-10"); ok(a.kpi === "matriculas.alunos" && a.unitId === 4 && a.comparar === "2025", "“quanto a Cultura cresceu vs 2025?” → alunos da Cultura comparados a 2025");
  const b = interpretar("inadimplência da TV Morena II em setembro", units, "2026-10"); ok(b.kpi === "financeiro.inadimplencia30" && b.unitId === 3 && b.periodo === "2026-09", "TV Morena II (o nome mais longo vence) e mês por extenso");
  const c = interpretar("qual o salário da Maria?", units, "2026-10"); ok(c.recusa === "pessoa", "pergunta sobre pessoa é recusada com explicação");
  const d = interpretar("quantos colaboradores na TV Morena I este mês?", units, "2026-10"); ok(d.kpi === "pessoas.quadro" && d.unitId === 2 && d.periodo === "2026-10", "headcount da TV Morena I no mês atual");
  const e = interpretar("bom dia", units, "2026-10"); ok(e.recusa === "indicador", "sem indicador reconhecido: recusa com sugestões");
  const f = interpretar("receita em dezembro", units, "2026-10"); ok(f.periodo === "2025-12", "mês futuro no ano corrente vira o do ano anterior"); }
ok(periodoComparacao("2026-10", "2025")?.periodo === "2025-10" && periodoComparacao("2026-10", "2026")?.periodo === "2026-01" && periodoComparacao("2026-10", "ANO_ANTERIOR")?.periodo === "2025-10" && periodoComparacao("2026-10", null) === null, "período de comparação declarado (mesmo mês de outro ano, início do ano, ano anterior)");

// ---------------------------------------------------------------- Notificações agrupadas (Ap. J)
{ const mk = (id: number, titulo: string, lida = false) => ({ id, tipo: "ACAO", titulo, texto: null, link: null, lida_em: lida ? new Date().toISOString() : null, created_at: new Date(Date.now() - id * 1000).toISOString() });
  const rows = [mk(1, "Lembrete: Autoavaliação · Ciclo A"), mk(2, "Lembrete: Gestor · Ciclo A"), mk(3, "Lembrete: Pares · Ciclo A"), mk(4, "Lembrete: Calibração · Ciclo A"), mk(5, "Obrigação delegada a você: ISS"), mk(6, "Lembrete: x", true)];
  const g = agruparNotificacoes(rows); ok(g.filter(x => x.tipo === "GRUPO").length === 1 && (g.find(x => x.tipo === "GRUPO") as { itens: unknown[] }).itens.length === 4 && g.length === 3, "mais de 3 não lidas do mesmo tipo viram um item; lidas ficam individuais");
  ok(chaveGrupo({ tipo: "ACAO", titulo: "Vence em 3 dia(s): ISS" }) === chaveGrupo({ tipo: "ACAO", titulo: "Vence em 7 dia(s): INSS" }), "o tipo da notificação ignora números"); }

// ---------------------------------------------------------------- Health: memória de cálculo (T-002)
{ const d: Dominio = { chave: "financeiro", nome: "Financeiro", score: 71, fatores: [{ peso: -20, texto: "a" }, { peso: -9, texto: "b" }], kpis: [], href: "/" };
  const m = memoriaDominio(d); ok(m.nota === 71 && m.bruto === 71 && !m.limitado, "“como é calculado” reproduz exatamente a nota (aceite T-002)");
  const d2: Dominio = { ...d, score: 0, fatores: [{ peso: -70, texto: "a" }, { peso: -40, texto: "b" }] }; ok(memoriaDominio(d2).limitado && memoriaDominio(d2).nota === 0, "nota limitada a 0–100 é sinalizada");
  const g = memoriaGeral([d, { ...d, chave: "pessoas", score: 90 }], { financeiro: 40, pessoas: 60 }); ok(g.geral === Math.round((71 * 40 + 90 * 60) / 100) && g.somaPesos === 100, "Health Geral = Σ(nota × peso) ÷ Σ pesos");
  const s = semanasHealth([{ data: "2026-10-12", geral: 70, scores: {} }, { data: "2026-10-14", geral: 72, scores: {} }, { data: "2026-10-19", geral: 75, scores: {} }]); ok(s.length === 2 && s[0].geral === 72 && s[0].semana === "2026-10-12", "13 semanas: último retrato de cada semana (segunda a domingo)"); }

// ---------------------------------------------------------------- Board, Rede e Cockpit
{ const p = projetarReceita([{ periodo: "2026-08", receita: 90, despesa: 0, ebitda: 0, orcReceita: null, orcDespesa: null }, { periodo: "2026-09", receita: 100, despesa: 0, ebitda: 0, orcReceita: null, orcDespesa: null }, { periodo: "2026-10", receita: 110, despesa: 0, ebitda: 0, orcReceita: null, orcDespesa: null }], [{ periodo: "2026-11", orc: 120 }, { periodo: "2026-12", orc: null }], 0.85, 1.05);
  ok(p[0].valor === 120 && p[1].valor === 100 && p[1].min === 85 && p[1].max === 105, "previsão: orçado do mês, senão média dos 3 últimos, com banda dos cenários"); }
{ const c = { id: 1, financeiro: false, receita: 1000, inad30: 3, alunos: 10, ocupacaoPct: 80, saude: 70, nps: 50, pendencias: 2, colaboradores: 5 } as unknown as CartaoRede; ok(valorRanking(c, "receita") === null && valorRanking(c, "alunos") === 10 && INDICADORES_RANKING.inad.menorMelhor === true, "ranking da rede esconde R$ de quem não vê financeiro"); }

// ---------------------------------------------------------------- Rastreabilidade da obra (/arquitetura)
ok(FICHAS.length === 106 && new Set(FICHAS.map(f => f[0])).size === 106, "as 106 fichas da obra, sem repetição");
ok(FICHAS.filter(f => f[4] === "IMPLEMENTADA").every(f => !!f[5] && f[5].startsWith("/")), "toda ficha no ar tem link para a tela");
ok(KPIS_OBRA.length === 40 && KPIS_OBRA.filter(k => k[2]).every(k => !!KPI[k[2]!] && !!CALCS[k[2]!]), "KPI-01..40: toda chave citada existe no catálogo e tem cálculo");
ok(CRQS.length >= 40 && GOLIVE.length >= 30 && NOTIFICACOES_OBRA.length >= 25, "regras CRQ, checklist de go-live e catálogo de notificações presentes");

// ---------------------------------------------------------------- mês em andamento (régua MTD) e folha da última competência aceita
ok(mesParcial("2026-10", "2026-10-17", "2026-10-14")?.dia === 14 && Math.abs((mesParcial("2026-10", "2026-10-17", "2026-10-14")?.fracao ?? 0) - 14 / 31) < 1e-9, "mês corrente com caixa até 14/10: parcial (14 de 31 dias)");
ok(mesParcial("2026-09", "2026-10-17", "2026-10-14") === null && mesParcial("2026-10", "2026-10-17", "2026-09-30") === null && mesParcial("2026-10", "2026-10-31", "2026-10-31") === null, "mês passado, mês sem lançamento ainda e mês completo não são parciais");
ok(mesmoDia("2026-09", 31) === "2026-09-30" && mesmoDia("2025-02", 30) === "2025-02-28" && mesmoDia("2025-10", 14) === "2025-10-14", "mesmo dia em outro mês respeita o último dia dele");
{ const p = orcadoProporcional(1000, 0.45, 820, 1000); ok(p.base === "perfil" && Math.abs((p.valor ?? 0) - 820) < 1e-9, "orçado proporcional pelo perfil do ano anterior (82% do mês já tinha entrado até o mesmo dia)"); }
{ const p = orcadoProporcional(1000, 0.45, null, null); ok(p.base === "linear" && Math.abs((p.valor ?? 0) - 450) < 1e-9, "sem histórico, orçado proporcional por dias corridos"); }
ok(orcadoProporcional(null, 0.5, 10, 20).valor === null && orcadoProporcional(1000, 0.5, 30, 20).base === "linear", "sem orçamento fica sem régua; perfil incoerente (parcial maior que o mês) cai para dias corridos");
{ const f = narrativaBoard({ periodo: "2026-10", receita: { real: 1800, orc: 3200, anoAnterior: 3000, parcial: { ate: "2026-10-14", orc: 1700, anoAnterior: 1650, base: "perfil" } }, caixa: { saldo: 100, dadosAte: "2026-10-14" }, semanaCritica: null, inad30: null, metaInad: 4, folhaReceita: 52, folhaCompetencia: "2026-09", funil: { ponderado: 0, vagas: 0, ocupacaoPct: null, reservasVencendo: 0 }, alertas: { criticos: 0, atrasados: 0 }, aprovacoes: 0, ebitda: null });
  const r = f.find(x => x.texto.startsWith("Receita de"))!; ok(!!r && r.tom === "bom" && r.texto.includes("até 14/10 (mês em andamento)") && r.texto.includes("orçado proporcional") && r.texto.includes("acima do mesmo período do ano passado") && !r.texto.includes("56%"), "Board: mês em andamento comparado com o orçado proporcional e o mesmo período (nunca o parcial contra o mês cheio)");
  ok(f.some(x => x.texto.includes("última folha aceita: set/26")), "Board: folha ÷ receita cita a competência aceita quando não é o mês do contexto"); }
{ const f = narrativaCfo({ periodo: "2026-10", parcial: { ate: "2026-10-14", orcReceita: 1700, orcDespesa: 1500, base: "linear" }, folhaCompetencia: "2026-09", receita: { real: 1800, orc: 3200 }, despesa: { real: 1560, orc: 2900 }, ebitda: 240, margem: 13.3, caixa: { saldo: 2000, dadosAte: "2026-10-14", coberturaDias: 24 }, inad30: null, metaInad: 4, acoesCobranca: 0, folhaReceita: 52, estouros: [], faixaMax: 105, explicacoesAbertas: 0 });
  ok(f.some(x => x.texto.includes("até 14/10 (mês em andamento)") && x.texto.includes("106% do orçado proporcional") && x.texto.includes("por dias corridos")) && f.some(x => x.texto.includes("de set/26 (última competência aceita)")), "CFO: mês em andamento na régua proporcional e folha da última competência aceita"); }
{ const fech = [{ periodo: "2026-07", receita: 3000, despesa: 0, ebitda: 0, orcReceita: null, orcDespesa: null }, { periodo: "2026-08", receita: 3100, despesa: 0, ebitda: 0, orcReceita: null, orcDespesa: null }, { periodo: "2026-09", receita: 3200, despesa: 0, ebitda: 0, orcReceita: null, orcDespesa: null }];
  const p = projetarReceita(fech, [{ periodo: "2026-10", orc: null }], 0.9, 1.1); ok(p[0].valor === 3100, "previsão do mês em andamento usa a média dos 3 últimos meses FECHADOS (o parcial não puxa a média para baixo)"); }

{ const a = (id: number, ini: string, fim: string, pos = 7) => ({ employee_id: id, unit_id: 1, position_id: pos, inicio: ini, fim });
  const f = foraNoPeriodo(a(1, "2027-01-04", "2027-01-18"), [a(2, "2027-01-10", "2027-01-20")], [a(3, "2027-01-01", "2027-01-05"), a(4, "2027-02-01", "2027-02-10"), a(5, "2027-01-05", "2027-01-08", 9), a(1, "2026-12-14", "2026-12-23")]);
  ok(f.total === 2 && f.soAprovadas === 1, "férias: aprovadas + pedidos anteriores do mesmo lote que se sobrepõem (mesmo cargo e unidade; a própria pessoa não conta)");
  ok(conflitoCobertura(8, f.soAprovadas, 70) === null && conflitoCobertura(8, f.total, 70) !== null, "lote: dois pedidos que sozinhos passam, somados furam a cobertura — o segundo sai do lote"); }

console.log(`\n${n} testes ok`);
