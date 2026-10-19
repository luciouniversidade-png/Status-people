// Testes unitários do v23 (ONE Insights): formatação e variação, base de indicadores, leitura do mês, previsões, FP&A,
// central de fluxos (SLA), pendências, busca, início e gráficos. Tudo puro — não precisa de banco. Uso: npx tsx scripts/test_v23.ts
import { variacao, rotuloMes, mesPorExtenso, fmtKpi } from "../src/lib/formato";
import { CATALOGO, KPI, CATALOGO_VERSAO, alertaPadrao, farolKpi, agregar, acumulado, ultimaMedicao, leituraDoMes, projetarCampanha, porUnidade, preenche, nomeKpi, type KpiDef, type Ponto, type VisaoKpi } from "../src/lib/kpi-catalogo";
import { CALCS } from "../src/lib/kpi-calc";
import { AREAS_POR_PERFIL, vePainelExecutivo, kpisVisiveis, podeEditarMeta, podeComentar, podeRecalcular, periodoValido, periodoPadrao } from "../src/lib/kpi";
import { desvio, previsaoAno, passosCascata, type Fpa } from "../src/lib/fpa";
import { situacao, resumir, porSemana, leituraFluxos, porResponsavel, porUnidadeFluxo, abertosPorSemana, esperas, fimDoDia, veFluxos, FLUXOS, type Instancia } from "../src/lib/fluxos";
import { situacaoPend, ordenar, resumoPendencias, type Pendencia } from "../src/lib/pendencias";
import { seloSla } from "../src/lib/sla-texto";
import { normalizar } from "../src/lib/busca";
import { fimDaCampanha, segundaDe } from "../src/lib/metas-matricula";
import { rotuloVisivel, corVisivel } from "../src/lib/quem-fora";
import { padroes, atalhosDe, BLOCOS, ATALHOS, PERFIS_MODULO } from "../src/lib/inicio";
import { podeReconhecer, podeModerar } from "../src/lib/reconhecimento";
import { escala } from "../src/components/graficos";
import { itemAtivo } from "../src/components/MenuLinks";
import type { Session } from "../src/lib/session";

let n = 0; const ok = (c: boolean, m: string) => { if (!c) { console.error("FALHOU:", m); process.exit(1); } n++; console.log("ok:", m); };
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const S = (role: Session["role"], extra: Partial<Session> = {}): Session => ({ id: 1, nome: "Teste", email: "t@x", role, unitId: 2, employeeId: null, ...extra });

async function main() {
  // ---- formatação e variação
  ok(variacao(10.02, 10.04, "%")!.sentido === 0 && variacao(10.02, 10.04, "%")!.texto === "estável", "diferença que some no arredondamento é estável (nunca \"−0 p.p.\")");
  ok(variacao(12.3, 10, "%")!.texto === "+2,3 p.p." && variacao(12.3, 10, "%")!.sentido === 1, "percentual varia em pontos percentuais");
  ok(variacao(9, 10, "n")!.texto === "−1" && variacao(9, 10, "n")!.sentido === -1, "contagem pequena varia em número, não em %");
  ok(variacao(1200, 1000, "R$")!.texto === "+20%" && variacao(1030, 1000, "R$")!.texto === "+3%", "moeda varia em percentual");
  ok(variacao(null, 10, "n") === null && variacao(5, undefined, "n") === null, "sem um dos lados, não há variação (nunca vira zero)");
  ok(variacao(5, 0, "R$")!.rel === null && variacao(5, 0, "R$")!.texto.startsWith("+"), "base zero: variação absoluta, sem % infinito");
  ok(variacao(100, 100, "n")!.texto === "estável" && variacao(4.004, 4, "nota")!.texto === "estável", "igual é estável");
  ok(rotuloMes("2026-10") === "out/26" && rotuloMes("2026-01", false) === "jan" && mesPorExtenso("2026-03") === "março de 2026", "rótulos de mês em português");
  ok(fmtKpi(null, "%") === "—" && fmtKpi(undefined, "R$") === "—", "valor ausente aparece como travessão");

  // ---- metas e farol dos indicadores
  ok(alertaPadrao(90, "SUBIR", 10) === 81 && Math.abs(alertaPadrao(4, "DESCER", 10)! - 4.4) < 1e-9 && alertaPadrao(50, "NEUTRO", 10) === null, "limite de atenção padrão = tolerância da meta no sentido ruim");
  ok(alertaPadrao(0, "DESCER", 10) === 0.1, "meta zero ainda tem limite de atenção (não colapsa na meta)");
  ok(farolKpi(null, 90, null, "SUBIR", 10) === "SEM_DADO" && farolKpi(NaN, 90, null, "SUBIR", 10) === "SEM_DADO", "sem medição: sem dado, nunca vermelho");
  ok(farolKpi(85, null, null, "SUBIR", 10) === "SEM_META" && farolKpi(85, 90, null, "NEUTRO", 10) === "SEM_META", "sem meta ou indicador neutro: não classifica");
  ok(farolKpi(90, 90, null, "SUBIR", 10) === "VERDE" && farolKpi(81, 90, null, "SUBIR", 10) === "AMARELO" && farolKpi(80.9, 90, null, "SUBIR", 10) === "VERMELHO", "maior é melhor: verde na meta, atenção até o limite, vermelho abaixo");
  ok(farolKpi(3.9, 4, null, "DESCER", 10) === "VERDE" && farolKpi(4.3, 4, null, "DESCER", 10) === "AMARELO" && farolKpi(5, 4, null, "DESCER", 10) === "VERMELHO", "menor é melhor (inadimplência)");
  ok(farolKpi(86, 90, 85, "SUBIR", 10) === "AMARELO" && farolKpi(84, 90, 85, "SUBIR", 10) === "VERMELHO", "limite cadastrado vale sobre o padrão");

  // ---- catálogo
  const chaves = CATALOGO.map(k => k.chave);
  ok(new Set(chaves).size === chaves.length && CATALOGO.length >= 40, `catálogo com ${CATALOGO.length} indicadores e chaves únicas`);
  ok(CATALOGO.every(k => !!CALCS[k.chave]), "todo indicador do catálogo tem cálculo");
  ok(Object.keys(CALCS).every(c => !!KPI[c]), "nenhum cálculo órfão (sem indicador no catálogo)");
  ok(CATALOGO.every(k => k.formula.length > 10 && k.fonte.length > 3), "todo indicador tem fórmula e fonte no dicionário");
  ok(CATALOGO.filter(k => k.agregacao === "TAXA").every(k => typeof k.fator === "number"), "razões declaram o fator (100 = percentual)");
  ok(CATALOGO.every(k => !k.href || k.href.startsWith("/")), "links de ação são internos");
  ok(/^\d+\.\d+$/.test(CATALOGO_VERSAO), "versão do catálogo no formato N.N");
  const taxa = { chave: "t", agregacao: "TAXA", fator: 100, historico: "RECONSTRUIDO", unidade: "%", sentido: "SUBIR" } as KpiDef;
  const soma = { chave: "s", agregacao: "SOMA", historico: "RECONSTRUIDO", unidade: "n", sentido: "NEUTRO" } as KpiDef;
  const estoque = { chave: "e", agregacao: "ESTOQUE", historico: "RECONSTRUIDO", unidade: "n", sentido: "NEUTRO" } as KpiDef;
  ok(!preenche(taxa) && preenche(soma) && preenche(estoque) && !preenche({ ...soma, historico: "RETRATO" }), "só somas e estoques reconstruídos preenchem meses sem registro com zero");
  ok(porUnidade(soma) && !porUnidade({ ...soma, porUnidade: false }), "quebra por unidade é o padrão");
  ok(nomeKpi({ ...soma, nome: "Ocupação", sufixoAno: true }, 2027) === "Ocupação 2027" && nomeKpi({ ...soma, nome: "Quadro" }, 2027) === "Quadro", "nome com o ano letivo quando pedido");

  // ---- agregação da rede e acumulado
  const pt = (valor: number | null, num: number | null = null, den: number | null = null): Ponto => ({ valor, num, den });
  const r = agregar(taxa, [pt(10, 1, 10), pt(30, 30, 100)]);
  ok(Math.abs(r.valor! - (31 / 110) * 100) < 1e-9 && r.num === 31 && r.den === 110, "taxa da rede recalculada pelas somas (28,2%), não a média das unidades (20%)");
  ok(agregar(taxa, [pt(null, null, null), pt(null, null, null)]).valor === null, "rede sem nenhuma unidade medida fica sem dado");
  ok(agregar(soma, [pt(3), pt(null), pt(4)]).valor === 7 && agregar(soma, [pt(3), pt(null)], true).valor === null, "soma ignora unidade sem dado — ou exige todas quando pedido");
  const serie = new Map<string, Ponto>([["2025-12", pt(100)], ["2026-01", pt(2)], ["2026-02", pt(null)], ["2026-03", pt(5)]]);
  ok(acumulado(soma, serie, "2026-03") === 7, "acumulado do ano soma só os meses do ano");
  ok(acumulado(estoque, serie, "2026-03") === null && acumulado(soma, new Map([["2026-01", pt(null)]]), "2026-01") === null, "estoque não acumula; ano sem medição não vira zero");
  const st = new Map<string, Ponto>([["2026-01", pt(10, 1, 10)], ["2026-02", pt(50, 5, 10)]]);
  ok(acumulado(taxa, st, "2026-02") === 30, "acumulado de razão recalculado pelas somas (6 ÷ 20 = 30%)");
  ok(eq(ultimaMedicao(new Map([["2026-03", pt(80)]]), "2026-10"), { periodo: "2026-03", valor: 80 }) && ultimaMedicao(new Map([["2026-03", pt(80)]]), "2026-10", 6) === null, "medição pontual vale a última dentro da janela");

  // ---- leitura automática do mês (determinística)
  const defI = { ...soma, chave: "fin.inad", nome: "Inadimplência", unidade: "%", sentido: "DESCER", agregacao: "TAXA", fator: 100 } as KpiDef;
  const meses = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
  const vis = (o: Partial<VisaoKpi>): VisaoKpi => ({ def: defI, nome: "Inadimplência", periodo: "2026-09", valor: 6.5, medidoEm: null, den: 200, anterior: 5, anoAnterior: 4, acumulado: null, acumuladoAnoAnterior: null, meta: 4, alerta: 4.4, metaFonte: "CADASTRADA", periodicidade: "MENSAL", farol: "VERMELHO", serie: meses.map((p, i) => ({ periodo: p, valor: [4, 4.2, 4.5, 5, 5, 6.5][i] })), ...o });
  const l1 = leituraDoMes([vis({})]);
  ok(l1.length === 1 && l1[0].tom === "ruim" && l1[0].texto.includes("fora do alvo") && l1[0].texto.includes("(meta até 4%)"), "fora do alvo vira a frase mais pesada (uma por indicador)");
  ok(eq(leituraDoMes([vis({})]), l1), "mesma base, mesmo texto (sem IA)");
  const defQ = { ...soma, chave: "pes.adm", nome: "Admissões" } as KpiDef;
  const semMed = leituraDoMes([{ ...vis({}), def: defQ, nome: "Admissões", valor: null, farol: "SEM_DADO", serie: [...meses.slice(0, 5).map(p => ({ periodo: p, valor: 3 })), { periodo: "2026-09", valor: null }] }]);
  ok(semMed.length === 1 && semMed[0].tom === "neutro" && semMed[0].texto.includes("sem medição"), "mês sem lançamento depois de meses com dado avisa para conferir (não diz zero)");
  const varios = leituraDoMes(Array.from({ length: 12 }, (_, i) => ({ ...vis({}), def: { ...defI, chave: `k${i}` } })), 5);
  ok(varios.length === 5, "leitura limitada ao máximo de frases");
  const baseFraca = leituraDoMes([vis({ farol: "VERDE", meta: 10, den: 3 })]);
  ok(baseFraca.every(f => !f.texto.includes("seguidos") && !f.texto.includes("acima do normal")), "razão com base pequena não gera frase de movimento");

  // ---- previsões
  ok(projetarCampanha([10, 20, 30], 4, null) === null && projetarCampanha([10, 20, 30, 40], 0, null) === null, "sem ritmo suficiente ou sem semanas restantes, não projeta");
  const pc = projetarCampanha([10, 20, 30, 40, 50], 2, null)!;
  ok(pc.media === 10 && pc.final.provavel === 70 && pc.proj.length === 2, "projeção = ritmo médio estendido até o fim da campanha");
  ok(projetarCampanha([10, 20, 30, 40, 50], 2, 60)!.final.provavel === 60, "projeção limitada à capacidade de vagas");
  const pd = projetarCampanha([10, 20, 15, 25, 35], 3, null)!;
  ok(pd.min === 0 && pd.max === 10 && pd.media === 7.5 && pd.final.min <= pd.final.provavel && pd.final.provavel <= pd.final.max, "cancelamento não vira ritmo negativo; faixa contém o provável");

  // ---- FP&A
  ok(eq(desvio("ENTRADA", 100, 90), { abs: -10, pct: -10, favoravel: false, tom: "ruim" }) && desvio("ENTRADA", 100, 97)!.tom === "atencao", "receita abaixo do orçado é desfavorável (até 5%: atenção)");
  ok(desvio("SAIDA", 100, 90)!.favoravel && desvio("SAIDA", 100, 90)!.tom === "bom" && desvio("SAIDA", 100, 110)!.tom === "ruim", "despesa abaixo do orçado é favorável");
  ok(desvio("SAIDA", 100, null) === null && desvio("ENTRADA", null, 5) === null && desvio("SAIDA", 0, 10)!.pct === null, "sem orçado ou realizado não há desvio; orçado zero não gera %");
  const z12 = (v: number | null) => Array.from({ length: 12 }, () => v);
  ok(previsaoAno([10, 10, 10, ...z12(null).slice(3)], z12(12), 3) === 138, "previsão = realizado até o mês + orçado dos meses seguintes");
  ok(previsaoAno([10, 10, 10, ...z12(null).slice(3)], z12(null), 3) === 120 && previsaoAno(z12(null), z12(null), 3) === null, "sem orçamento, usa a média dos 3 últimos meses; sem nada, não prevê");
  const lf = (tipo: "ENTRADA" | "SAIDA", categoria: string, orcMes: number, realMes: number) => ({ tipo, categoria, orcMes, realMes, orcAcum: orcMes, realAcum: realMes });
  const f = { resultado: { orcMes: 100, realMes: 80, orcAcum: 100, realAcum: 80 }, linhas: [lf("ENTRADA", "Mensalidades", 500, 470), lf("SAIDA", "Pessoal", 300, 310), lf("SAIDA", "Manutenção", 100, 80)] } as unknown as Fpa;
  const pc1 = passosCascata(f, "mes");
  ok(pc1[0].valor === 100 && pc1[pc1.length - 1].valor === 80 && eq(pc1.slice(1, -1).map(p => p.valor), [-30, 20, -10]) && pc1[1].rotulo === "Receita: Mensalidades", "cascata: orçado → maiores desvios → realizado");
  ok(Math.abs(pc1.slice(1, -1).reduce((a, p) => a + p.valor, 0) - (80 - 100)) < 1e-9, "a cascata fecha: soma dos desvios = realizado − orçado");
  const pc2 = passosCascata(f, "mes", 1);
  ok(pc2.length === 4 && pc2[2].rotulo === "Demais categorias" && pc2[2].valor === 10, "categorias além do limite viram \"demais\"");
  ok(passosCascata({ ...f, resultado: { orcMes: null, realMes: 80 } } as unknown as Fpa, "mes").length === 0, "sem orçamento, sem cascata");

  // ---- central de fluxos (SLA)
  const D = 86400000; const agora = Date.parse("2026-10-17T12:00:00-04:00");
  const inst = (o: Partial<Instancia>): Instancia => ({ fluxo: "SOLICITACAO", id: 1, titulo: "x", unit_id: 1, unidade: "Carandá", etapa: "Em aprovação", responsavel: null, responsavel_user_id: null, aberto: agora - 5 * D, prazo: agora + 5 * D, concluido: null, href: "/x", ...o });
  ok(situacao(inst({ concluido: agora - D, prazo: agora }), agora) === "CONCLUIDO_NO_PRAZO" && situacao(inst({ concluido: agora, prazo: agora - D }), agora) === "CONCLUIDO_FORA" && situacao(inst({ concluido: agora, prazo: null }), agora) === "CONCLUIDO_SEM_PRAZO", "concluídos: no prazo, fora e sem prazo");
  ok(situacao(inst({ prazo: null }), agora) === "SEM_PRAZO" && situacao(inst({ prazo: agora - 1 }), agora) === "VENCIDO", "aberto: sem prazo e vencido");
  ok(situacao(inst({ aberto: agora - 8 * D, prazo: agora + 2 * D }), agora) === "EM_RISCO" && situacao(inst({}), agora) === "NO_PRAZO", "em risco quando resta até 25% do prazo");
  ok(situacao(inst({ aberto: agora - 9.2 * D, prazo: agora + 0.8 * D }), agora, 5) === "EM_RISCO", "menos de 1 dia num prazo de vários dias é risco, qualquer que seja o percentual");
  ok(fimDoDia("2026-10-17") === Date.parse("2026-10-18T03:59:59Z"), "prazo vence no fim do dia no fuso da escola");
  const insts = [
    inst({ id: 1, prazo: agora - D, responsavel: "Maria Souza", responsavel_user_id: 7 }), inst({ id: 2, responsavel: "Maria Souza", responsavel_user_id: 7 }),
    inst({ id: 3, fluxo: "CHAMADO", aberto: agora - 3 * D, prazo: agora - D, concluido: agora - 2 * D, unit_id: 2, unidade: "Cultura" }),
    inst({ id: 4, fluxo: "CHAMADO", aberto: agora - 4 * D, prazo: agora - 3 * D, concluido: agora - D, unit_id: 2, unidade: "Cultura" }),
    inst({ id: 5, fluxo: "VAGA", aberto: agora - D, prazo: null, concluido: agora - 2 * D }),
  ];
  const rs = resumir(insts, agora);
  ok(rs.total.abertos === 2 && rs.total.vencidos === 1 && rs.total.noPrazo === 1 && rs.total.concluidos === 3 && rs.total.concluidosComPrazo === 2 && rs.total.concluidosNoPrazo === 1, "resumo: abertos, vencidos, concluídos e cumprimento do prazo");
  const ch = rs.porFluxo.find(x => x.fluxo === "CHAMADO")!; const vg = rs.porFluxo.find(x => x.fluxo === "VAGA")!;
  ok(Math.abs(ch.cicloMedioDias! - 2) < 1e-9 && vg.cicloMedioDias === 0, "ciclo médio em dias, nunca negativo (data de conclusão anterior à abertura)");
  ok(Math.abs(rs.porFluxo.find(x => x.fluxo === "SOLICITACAO")!.maisAntigoDias! - 5) < 1e-9, "idade do item mais antigo em andamento");
  const sem = porSemana(insts, 4, agora);
  ok(sem.length === 4 && sem[3].noPrazo + sem[3].fora === 2 && sem[3].pct === 50 && sem[0].pct === null, "cumprimento por semana: semana sem conclusão fica sem dado");
  ok(eq(porResponsavel(insts, rs.situacoes).map(x => [x.nome, x.total, x.vencidos]), [["Maria Souza", 2, 1]]), "carga por responsável conta só itens em andamento");
  const un = porUnidadeFluxo(insts, rs.situacoes);
  ok(un.length === 2 && un.find(x => x.nome === "Cultura")!.pct === 50 && un.find(x => x.nome === "Carandá")!.vencidos === 1, "por unidade: vencidos e % no prazo");
  ok(abertosPorSemana(insts, 2, agora).reduce((a, w) => a + w.n, 0) === 5, "entrada de demanda por semana");
  ok(esperas(insts, agora).every(e => e.media >= 0) && esperas(insts, agora).length === 1, "onde esperam: só itens em andamento");
  const lfx = leituraFluxos({ resumo: rs, semanas: sem, gargalos: { etapas: [{ chave: "Férias · Coordenação", n: 4, media: 5, prazo: 2 }] }, unidades: un, agora });
  ok(lfx[0].tom === "ruim" && lfx[0].texto.startsWith("1 item vencido") && lfx.some(x => x.texto.includes("Gargalo de aprovação: Férias · Coordenação")), "leitura da central: vencidos primeiro e o gargalo contra o prazo");
  ok(lfx.every(x => !x.texto.includes("Maria")), "leitura da central nunca cita pessoas");
  ok(leituraFluxos({ resumo: resumir([], agora), semanas: porSemana([], 8, agora), gargalos: null, unidades: [], agora }).length === 0, "sem itens, sem frases");
  ok(Object.keys(FLUXOS).length === 12 && Object.values(FLUXOS).every(x => x.href(5).startsWith("/")), "12 processos com link para o item");

  // ---- pendências
  const h = "2026-10-17";
  ok(situacaoPend(null, h) === "SEM_PRAZO" && situacaoPend("2026-10-16", h) === "VENCIDA" && situacaoPend(h, h) === "HOJE" && situacaoPend("2026-10-20", h) === "PROXIMA" && situacaoPend("2026-10-21", h) === "FUTURA", "situação da pendência pelo prazo");
  const pend = (titulo: string, prazo: string | null): Pendencia => ({ chave: titulo, grupo: "APROVAR", modulo: "m", acao: "a", titulo, href: "/", prazo });
  ok(eq(ordenar([pend("c", null), pend("b", "2026-10-25"), pend("a", h), pend("z", "2026-10-01"), pend("y", "2026-10-15")], h).map(p => p.titulo), ["z", "y", "a", "b", "c"]), "caixa: vencidas (mais antiga primeiro), hoje, próximas e sem prazo no fim");
  ok(eq(resumoPendencias([pend("a", "2026-10-01"), pend("b", h), pend("c", "2026-10-19"), pend("d", null)], h), { total: 4, vencidas: 1, hoje: 1, proximas: 1 }), "resumo das pendências");

  // ---- prazo nos cartões do quadro
  const t0 = Date.parse("2026-10-17T12:00:00Z");
  ok(seloSla(null, t0) === null && eq(seloSla(new Date(t0 + 5 * 3600000), t0), { texto: "vence em 5 h", tom: "atencao" }) && eq(seloSla(new Date(t0 + 3 * D).toISOString(), t0), { texto: "vence em 3 d", tom: "neutro" }) && eq(seloSla(new Date(t0 - 2 * D), t0), { texto: "vencido há 2 d", tom: "ruim" }), "selo de prazo do cartão");
  ok(seloSla(new Date(t0 + 10 * 60000), t0)!.texto === "vence em 1 h", "menos de uma hora aparece como 1 h (nunca \"0 h\")");

  // ---- busca, campanha, ausências
  ok(normalizar("  JOÃO   da Conceição ") === "joao da conceicao" && normalizar("Ação") === "acao", "busca ignora acentos, caixa e espaços");
  ok(fimDaCampanha({ matriculas: { anoLetivo: 2027, fimCampanha: "" } }) === "2027-01-31" && fimDaCampanha({ matriculas: { anoLetivo: 2027, fimCampanha: "2027-02-15" } }) === "2027-02-15" && fimDaCampanha({ matriculas: { anoLetivo: 2027, fimCampanha: "15/02/2027" } }) === "2027-01-31", "fim da campanha: configurado, ou 31/jan do ano letivo");
  ok(segundaDe("2026-10-17") === "2026-10-12" && segundaDe("2026-10-12") === "2026-10-12" && segundaDe("2026-10-18") === "2026-10-12", "semana começa na segunda (domingo é o fim)");
  ok(rotuloVisivel("AFASTAMENTO", false) === "Ausência" && rotuloVisivel("ATESTADO", false) === "Ausência" && rotuloVisivel("AFASTAMENTO", true) === "Afastamento ou licença" && rotuloVisivel("FERIAS", false) === "Férias", "quem não trata dados sensíveis vê só \"Ausência\"");
  ok(corVisivel("AFASTAMENTO", false) === corVisivel("OUTRO", true), "nem a cor revela o tipo de ausência sensível");

  // ---- perfis: painel, metas, início, mural, fluxos
  ok(!vePainelExecutivo(S("COLABORADOR")) && vePainelExecutivo(S("LEITURA")) && !veFluxos(S("COLABORADOR")) && veFluxos(S("OPERACOES")), "autoatendimento não vê painel executivo nem central de fluxos");
  ok(!AREAS_POR_PERFIL.GESTOR.includes("financeiro") && !AREAS_POR_PERFIL.COMERCIAL.includes("pessoas") && AREAS_POR_PERFIL.FINANCEIRO.includes("financeiro"), "áreas do painel por perfil");
  const vDir = await kpisVisiveis(S("DIRECAO")); const vRh = await kpisVisiveis(S("RH"));
  ok(vDir.length === CATALOGO.length && vRh.length === CATALOGO.length, "Direção e RH veem todos os indicadores");
  const sal = CATALOGO.find(k => k.restricao === "SALARIAL"); const fin = CATALOGO.find(k => k.area === "financeiro")!; const pes = CATALOGO.find(k => k.area === "pessoas")!;
  ok(!sal || (podeEditarMeta(S("DIRECAO"), sal) && !podeEditarMeta(S("GESTOR"), sal)), "indicador salarial: meta só por quem pode");
  ok(podeEditarMeta(S("FINANCEIRO"), fin) && !podeEditarMeta(S("FINANCEIRO"), pes) && !podeEditarMeta(S("RH"), fin) && podeEditarMeta(S("RH"), pes) && !podeEditarMeta(S("LEITURA"), pes), "metas: Financeiro só as financeiras, RH as demais, leitura nenhuma");
  ok(!podeComentar(S("LEITURA")) && !podeComentar(S("COLABORADOR")) && podeComentar(S("GESTOR")) && podeRecalcular(S("RH")) && !podeRecalcular(S("FINANCEIRO")), "comentar e recalcular por perfil");
  ok(periodoValido("2026-09", "2026-10-17") && !periodoValido("2026-11", "2026-10-17") && !periodoValido("2026-13", "2026-10-17") && !periodoValido("2023-01", "2026-10-17") && !periodoValido("x", "2026-10-17") && periodoPadrao("2026-10-17") === "2026-09", "período: últimos 36 meses, padrão = último mês fechado");
  const pc0 = padroes(S("COLABORADOR"));
  ok(pc0.blocos.includes("pendencias") && pc0.blocos.includes("mural") && !pc0.blocos.includes("pessoas") && !pc0.blocos.includes("auditoria") && !pc0.blocos.includes("indicadores") && !pc0.blocos.includes("fluxos"), "início do autoatendimento sem dados de gestão");
  ok(padroes(S("DIRECAO")).blocos.includes("auditoria") && !padroes(S("GESTOR")).blocos.includes("auditoria"), "auditoria só para Direção e RH");
  ok(eq(atalhosDe(S("COLABORADOR"), ["colaborador", "pendencias", "executivo", "inexistente"]).map(a => a.chave), ["pendencias"]), "atalhos gravados passam de novo pela permissão");
  ok(!padroes(S("LEITURA")).atalhos.includes("reconhecer") && padroes(S("LEITURA")).atalhos.length > 0, "leitura não ganha atalho de ação");
  ok(BLOCOS.every(b => !b.padrao(S("COLABORADOR")) || b.pode(S("COLABORADOR"))) && ATALHOS.every(a => a.href.startsWith("/")) && PERFIS_MODULO.COMERCIAL === "/matriculas", "padrões nunca oferecem o que o perfil não pode");
  ok(!podeReconhecer(S("LEITURA")) && podeReconhecer(S("COLABORADOR")) && podeModerar(S("RH")) && !podeModerar(S("GESTOR")) && !podeModerar(S("DIRETOR_UNIDADE")), "mural: leitura só lê; moderação só Direção e RH");

  // ---- menu: tela atual destacada
  ok(itemAtivo("/", ["/", "/colaboradores"]) === "/" && itemAtivo("/colaboradores/5", ["/", "/colaboradores"]) === "/colaboradores", "Início só na própria raiz; telas internas acendem o item do módulo");
  ok(itemAtivo("/financeiro/orcamento/planilha", ["/financeiro", "/financeiro/orcamento", "/financeiro/projecao"]) === "/financeiro/orcamento" && itemAtivo("/financeiroX", ["/financeiro"]) === null, "vale o item mais específico; prefixo parcial não conta");
  ok(itemAtivo("/processos", ["/processos?tipo=ADMISSAO", "/processos?tipo=DESLIGAMENTO"]) === "/processos?tipo=ADMISSAO" && itemAtivo("/executivo/indicador/x", ["/", "/executivo"]) === "/executivo", "itens com filtro na URL comparam só o caminho");

  // ---- gráficos
  const inteiros = [[0, 9], [0, 3], [0, 1], [2, 7], [0, 13], [0, 23]].map(v => escala(v, true));
  ok(inteiros.every(e => e.ticks.every(t => Number.isInteger(t))), "contagens nunca têm marcas fracionadas no eixo");
  const e1 = escala([0, 9], true);
  ok(e1.lo === 0 && e1.hi >= 9 && e1.ticks[0] === 0, "eixo começa no zero quando pedido e cobre o máximo");
  const e2 = escala([0.1, 0.9], true);
  ok(e2.ticks.some(t => !Number.isInteger(t)), "valores fracionados mantêm marcas fracionadas");
  const e3 = escala([5, 5], true);
  ok(e3.lo === 0 && e3.hi > 5, "série constante ganha folga sem eixo negativo");
  const e4 = escala([-20, 30], false);
  ok(e4.lo <= -20 && e4.hi >= 30 && e4.ticks.includes(0), "eixo com negativos inclui o zero");

  console.log(`\nTODOS OS ${n} TESTES DO v23 PASSARAM`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
