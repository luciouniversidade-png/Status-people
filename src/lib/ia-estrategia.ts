import { hoje, getSettings } from "./utils";
import type { FonteIA } from "./ia-desempenho";
import { painelGestao, painelMarketing, listarAcoes, fmtValor, metaTexto } from "./gestao-estrategica";
import { radarFamilias } from "./radar-familia";
import { FAROL_LABEL, FAIXA_SAUDE, RITUAL_TIPO, aderenciaRitual, nomePeriodo, periodoDe, type TipoRitual } from "./gestao-calc";
import { SAUDE, ATIVOS_PROJ } from "./estrategia";

export { TAREFAS_ESTRATEGIA, CONFIG_IA_ESTRATEGIA, montarPromptEstrategia } from "./ia-estrategia-prompt";

/** Fatos do painel no escopo (rede ou unidade) — exatamente o que é enviado à IA, e o que a tela mostra antes de gerar. */
export async function fatosEstrategicos(unitId: number | null): Promise<FonteIA[]> {
  const cfg = await getSettings(); const h = hoje(); const per = periodoDe(h);
  const [g, mk, rad, atencao] = await Promise.all([painelGestao(unitId), painelMarketing(unitId, per, 3), radarFamilias(unitId), listarAcoes(unitId, { situacao: "ATENCAO", limite: 10 })]);
  const f: FonteIA[] = []; let n = 0; const add = (natureza: string, texto: string) => { f.push({ id: String(++n), natureza, data: h, texto }); };
  add("SAUDE", `Saúde estratégica: ${g.saude.score === null ? "sem dados para calcular" : `${Math.round(g.saude.score)} de 100 (${FAIXA_SAUDE[g.saude.faixa!]})`}.`);
  for (const c of g.comps) add("COMPONENTE", `${c.nome}: ${c.valor === null ? "sem base" : `${Math.round(c.valor)}%`} — ${c.detalhe}.`);
  for (const o of g.ok.objetivos.filter(o => o.status === "ATIVO")) add("OKR", `Objetivo “${o.titulo}” (ciclo ${g.ciclo}): progresso ${o.progresso === null ? "sem medição" : `${o.progresso}%`}. KRs: ${o.krs.map(k => `${k.titulo} — atual ${fmtValor(k.valor_atual, k.metrica)}, meta ${fmtValor(k.valor_meta, k.metrica)}`).join("; ") || "nenhum"}.`);
  for (const i of g.inds.filter(i => i.temMeta)) add("INDICADOR", `${i.nome}${i.unidade ? ` (${i.unidade})` : ""}: ${i.ultimoValor === null ? "sem medição" : `${fmtValor(i.ultimoValor, i.unidade_medida)} em ${nomePeriodo(i.ultimoPeriodo!)}`}; meta ${metaTexto(i.config, i.unidade_medida)}; farol ${FAROL_LABEL[i.farol]}${i.emDia ? "" : "; medição atrasada"}.`);
  for (const r of g.pf.rows.filter(r => ATIVOS_PROJ.includes(r.status) && (r.saude !== "VERDE" || r.marcos_atrasados))) add("PROJETO", `Projeto “${r.nome}”: ${SAUDE[r.saude]}; ${r.marcos_ok}/${r.marcos} marco(s) concluído(s), ${r.marcos_atrasados} atrasado(s).`);
  add("ACOES", `Plano de ação: ${g.ac.abertas} ação(ões) aberta(s), ${g.ac.vencidas} vencida(s), ${g.ac.bloqueadas} bloqueada(s), ${g.ac.concluidas_30} concluída(s) em 30 dias.`);
  // Ações: sem o texto livre (título e motivo do bloqueio podem trazer nomes de pessoas) — só a situação e o vínculo institucional
  for (const a of atencao) add("ACAO", `Ação do plano nº ${a.id}${a.unidade ? ` (${a.unidade})` : ""}, ligada a ${a.objetivo ? `objetivo “${a.objetivo}”` : a.indicador ? `indicador “${a.indicador}”` : a.projeto ? `projeto “${a.projeto}”` : a.ritual ? `ritual “${a.ritual}”` : "nenhum objetivo, indicador ou projeto"}: ${a.status === "BLOQUEADA" ? `bloqueada${a.bloqueio_desde ? ` desde ${a.bloqueio_desde.split("-").reverse().join("/")}` : ""}, aguardando apoio` : `vencida há ${a.dias_atraso} dia(s)`}.`);
  for (const r of g.rit.lista.filter(r => r.ativo)) { const ad = aderenciaRitual(r.realizadas_janela, r.tipo as TipoRitual, r.criado_dias); add("RITUAL", `Ritual “${r.nome}” (${RITUAL_TIPO[r.tipo as TipoRitual]}): ${r.situacao === "ATRASADO" ? "atrasado" : "em dia"}; aderência ${ad.pct === null ? "sem base" : `${ad.pct}%`}; ${r.ata_pendente} ata(s) pendente(s).`); }
  if (g.mat.pct !== null) add("PROCESSOS", `Maturidade média dos processos: ${Math.round(g.mat.pct)}% em ${g.mat.itens.length} POP(s); ${g.mat.porNivel[4]} no nível 5.`);
  const a = mk.atual; add("CAPTACAO", `Captação em ${nomePeriodo(per)}: ${a.candidatos} candidato(s), ${a.reservas} reserva(s), ${a.matriculas} matrícula(s) nova(s); investimento ${fmtValor(a.investimento, "R$")}; custo por matrícula ${a.cac.valor === null ? "sem base" : fmtValor(a.cac.valor, "R$")}.`);
  const rs = rad.resumo; add("FAMILIAS", `Famílias ativas: ${rs.ativas} — ${rs.saudaveis} saudáveis, ${rs.atencao} em atenção, ${rs.risco} em risco; ${rs.saidas} pedido(s) de saída; ${rs.rematriculaPendente} sem rematrícula para ${cfg.matriculas.anoLetivo}; NPS ${rs.nps === null ? "sem respostas" : rs.nps} (${rs.npsRespostas} resposta(s) em 180 dias).`);
  for (const al of g.alertas) add("ALERTA", al.texto);
  return f;
}
