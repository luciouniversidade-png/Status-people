"use server";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, assert, scopeUnit } from "@/lib/auth";
import { audit, str, strOrNull, int, num, getSettings, caminhoSeguro, arquivoParaTexto } from "@/lib/utils";
import { notificar, usuariosPorPerfil } from "@/lib/comunicacao";
import { podeFolha, podePreparar, podeConferir, pendenciasFechamento, pendenciasPacote, montarPacote, cicloPorId, garantirCiclo, eventoFolha, esperadaDaEntidade, totalAnteriorAceito, resultadoDoCiclo, pessoasDaEntidade } from "@/lib/folha";
import { lerResultadoTexto, custoLinha, variacaoPct, exigeExplicacao, resultadoConferencia, sortearAmostra, docsFaltando, competenciaAnterior, MOTIVOS_VARIACAO, TIPOS_DOC } from "@/lib/folha-calc";
import { comMensagem } from "@/lib/redirecionar";

const go = (b: string, k: "ok" | "erro", msg: string) => comMensagem(b, k, msg);
const mesOk = (m: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
const msgErro = (e: unknown) => e instanceof Error ? e.message : "Erro inesperado.";

// ------------------------------------------------------------------ passo 1 · fechamento do ponto por unidade
export async function fecharPonto(fd: FormData) {
  const s = await requireSession(); const unitId = int(fd, "unitId") ?? 0; const mes = str(fd, "mes"); const ressalva = strOrNull(fd, "ressalva"); const voltar = caminhoSeguro(str(fd, "voltar"), `/ponto?mes=${mes}`);
  try {
    assert(mesOk(mes), "Mês inválido."); assert(["RH", "DIRECAO", "DIRETOR_UNIDADE"].includes(s.role), "Fecha o mês: RH, Direção ou o diretor(a) da unidade.");
    const u = scopeUnit(s); assert(u === null || u === unitId, "Você só fecha o mês da sua unidade.");
    const [un] = await sql<{ nome: string }[]>`SELECT nome FROM units WHERE id=${unitId}`; assert(!!un, "Unidade não encontrada.");
    const [ja] = await sql<{ status: string }[]>`SELECT status FROM timesheet_locks WHERE unit_id=${unitId} AND mes=${mes}`; assert(ja?.status !== "FECHADO", "Este mês já está fechado na unidade.");
    const p = await pendenciasFechamento(unitId, mes);
    if (p.total > 0) {
      assert(!!ressalva, `Há pendências: ${[p.sem_folha && `${p.sem_folha} sem folha no mês`, p.sem_jornada && `${p.sem_jornada} sem jornada`, p.pendentes && `${p.pendentes} lançamento(s) aguardando aprovação`, p.divergencias && `${p.divergencias} divergência(s) da auditoria do ponto em aberto`].filter(Boolean).join(", ")}. Resolva ou feche com ressalva justificada (RH/Direção).`);
      assert(["RH", "DIRECAO"].includes(s.role), "Fechar com ressalva é decisão do RH ou da Direção.");
      assert(p.pendentes === 0, "Lançamentos aguardando aprovação precisam ser decididos antes do fechamento (eles mudam o saldo do mês).");
      assert((ressalva ?? "").length >= 10, "Descreva a ressalva (mínimo 10 caracteres).");
    }
    const resumo = { ativos: p.ativos, semFolha: p.sem_folha, semJornada: p.sem_jornada, divergencias: p.divergencias };
    await sql`INSERT INTO timesheet_locks (unit_id, mes, status, fechado_por, fechado_por_nome, fechado_em, ressalva, resumo) VALUES (${unitId}, ${mes}, 'FECHADO', ${s.id}, ${s.nome}, now(), ${ressalva}, ${JSON.stringify(resumo)}::jsonb)
      ON CONFLICT (unit_id, mes) DO UPDATE SET status='FECHADO', fechado_por=EXCLUDED.fechado_por, fechado_por_nome=EXCLUDED.fechado_por_nome, fechado_em=now(), ressalva=EXCLUDED.ressalva, resumo=EXCLUDED.resumo`;
    await audit(s, "fechar ponto do mês", "timesheet_locks", unitId, null, { mes, unidade: un.nome, ressalva: !!ressalva, ...resumo });
    await eventoFolha(null, mes, null, s, "PONTO_FECHADO", `Ponto de ${mes.split("-").reverse().join("/")} fechado em ${un.nome}${ressalva ? ` com ressalva: ${ressalva}` : ""}.`);
    // todas as unidades com gente do mês fechadas: avisa RH e Financeiro que o pacote está liberado (Ap. J)
    const [abertas] = await sql<{ n: number }[]>`SELECT count(DISTINCT e.unit_id)::int AS n FROM employees e WHERE e.situacao IN ('ATIVO','FERIAS','AFASTADO') AND NOT EXISTS (SELECT 1 FROM timesheet_locks l WHERE l.unit_id=e.unit_id AND l.mes=${mes} AND l.status='FECHADO')`;
    if (!abertas.n) await notificar(await usuariosPorPerfil(["RH", "FINANCEIRO"]), `Pacote da folha liberado — ${mes.split("-").reverse().join("/")}`, "O ponto de todas as unidades está fechado. Gere o pacote ao contador.", `/folha?mes=${mes}`, "ACAO", `folha-liberada-${mes}`);
  } catch (e) { redirect(go(voltar, "erro", msgErro(e))); }
  redirect(go(voltar, "ok", "Mês fechado: o espelho do ponto está congelado para a folha."));
}

export async function reabrirPonto(fd: FormData) {
  const s = await requireSession(); const unitId = int(fd, "unitId") ?? 0; const mes = str(fd, "mes"); const motivo = str(fd, "motivo"); const voltar = caminhoSeguro(str(fd, "voltar"), `/ponto?mes=${mes}`);
  try {
    assert(["RH", "DIRECAO"].includes(s.role), "Reabrir o mês é decisão do RH ou da Direção."); assert(motivo.length >= 10, "Justifique a reabertura (mínimo 10 caracteres).");
    const [l] = await sql<{ id: number; status: string }[]>`SELECT id, status FROM timesheet_locks WHERE unit_id=${unitId} AND mes=${mes}`; assert(l?.status === "FECHADO", "O mês não está fechado.");
    // pacote já gerado para uma entidade com gente nesta unidade: só a Direção reabre, e o ciclo volta ao início
    const ciclos = await sql<{ id: number; company_id: number; status: string }[]>`SELECT c.id, c.company_id, c.status FROM payroll_cycles c WHERE c.competencia=${mes} AND c.pacote_em IS NOT NULL AND EXISTS (SELECT 1 FROM employees e WHERE e.company_id=c.company_id AND e.unit_id=${unitId})`;
    if (ciclos.length) {
      assert(s.role === "DIRECAO", "O pacote da folha deste mês já saiu: só a Direção reabre o ponto (o ciclo volta ao início).");
      assert(!ciclos.some(c => ["ACEITO", "ARQUIVADO"].includes(c.status)), "O resultado da folha deste mês já foi aceito: corrija pelo mês seguinte (ajuste) com o contador.");
      for (const c of ciclos) { await sql`UPDATE payroll_cycles SET status='ABERTO', updated_at=now() WHERE id=${c.id}`; await eventoFolha(c.id, mes, c.company_id, s, "PACOTE_INVALIDADO", `Ponto reaberto (${motivo}). Gere e envie o pacote de novo.`); }
    }
    await sql`UPDATE timesheet_locks SET status='REABERTO', reaberto_por=${s.id}, reaberto_em=now(), motivo_reabertura=${motivo} WHERE id=${l.id}`;
    await audit(s, "reabrir ponto do mês", "timesheet_locks", unitId, { status: "FECHADO" }, { mes, motivo });
    await eventoFolha(null, mes, null, s, "PONTO_REABERTO", `Ponto de ${mes.split("-").reverse().join("/")} reaberto: ${motivo}`);
  } catch (e) { redirect(go(voltar, "erro", msgErro(e))); }
  redirect(go(voltar, "ok", "Mês reaberto: as alterações voltam a ser permitidas e ficam registradas."));
}

// ------------------------------------------------------------------ passo 2 · pacote ao contador
export async function gerarPacote(fd: FormData) {
  const s = await requireSession(); const companyId = int(fd, "companyId") ?? 0; const mes = str(fd, "mes"); const voltar = caminhoSeguro(str(fd, "voltar"), `/folha?mes=${mes}`);
  let id = 0;
  try {
    assert(mesOk(mes), "Competência inválida."); assert(podePreparar(s), "Quem prepara o pacote é o RH (ou a Direção).");
    id = await garantirCiclo(companyId, mes); const c = await cicloPorId(id); assert(!!c, "Ciclo não encontrado.");
    assert(["ABERTO", "PACOTE_ENVIADO", "DEVOLVIDO"].includes(c!.status), "A prévia já foi conferida: o pacote não muda mais nesta competência.");
    const p = await pendenciasPacote(companyId, mes);
    if (p.bloqueios.length) { await eventoFolha(id, mes, companyId, s, "PACOTE_BLOQUEADO", `Tentativa de gerar o pacote bloqueada: ${p.bloqueios.map(b => b.texto).join("; ")}`); throw new Error(`Pacote travado: ${p.bloqueios.map(b => b.texto).join("; ")}.`); }
    assert(p.pessoas > 0, "Nenhuma pessoa desta entidade (CNPJ empregador) na competência.");
    const pacote = await montarPacote(companyId, mes);
    await sql`UPDATE payroll_cycles SET pacote=${JSON.stringify(pacote)}::jsonb, pacote_em=now(), pacote_por=${s.id}, pacote_por_nome=${s.nome}, status='PACOTE_ENVIADO', updated_at=now() WHERE id=${id}`;
    await eventoFolha(id, mes, companyId, s, "PACOTE_GERADO", `Pacote gerado (conferência ${pacote.hash}): ${pacote.headcount} no quadro, ${pacote.admissoes.length} admissão(ões), ${pacote.desligamentos.length} desligamento(s), ${pacote.afastamentos.length} afastamento(s), ${pacote.ferias.length} férias.`);
    await audit(s, "gerar pacote da folha", "payroll_cycles", id, null, { mes, companyId, hash: pacote.hash });
  } catch (e) { redirect(go(voltar, "erro", msgErro(e))); }
  redirect(go(`/folha/${id}`, "ok", "Pacote gerado. Baixe o arquivo e envie ao contador; a prévia volta para conferência."));
}

// ------------------------------------------------------------------ passo 3 · prévia e conferência (Four-Eyes)
export async function registrarPrevia(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "cycleId") ?? 0; const voltar = `/folha/${id}`;
  try {
    assert(podeConferir(s), "A prévia é registrada por quem confere: Financeiro ou Direção."); const c = await cicloPorId(id); assert(!!c, "Ciclo não encontrado.");
    assert(["PACOTE_ENVIADO", "DEVOLVIDO"].includes(c!.status), "Registre a prévia depois do pacote e antes da conferência.");
    const previa = { headcount: int(fd, "headcount"), proventos: num(fd, "proventos"), encargos: num(fd, "encargos"), informadaEm: new Date().toISOString(), por: s.nome };
    assert(previa.headcount !== null && previa.proventos !== null, "Informe pelo menos o headcount e o total de proventos da prévia.");
    await sql`UPDATE payroll_cycles SET previa=${JSON.stringify(previa)}::jsonb, updated_at=now() WHERE id=${id}`;
    await eventoFolha(id, c!.competencia, c!.company_id, s, "PREVIA", `Prévia do contador registrada: ${previa.headcount} pessoas, proventos ${previa.proventos?.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}.`);
  } catch (e) { redirect(go(voltar, "erro", msgErro(e))); }
  redirect(go(voltar, "ok", "Prévia registrada. Confira a amostra e registre a conferência."));
}

/** Proventos (salários) do resultado aceito do mês anterior — base da variação da prévia. */
async function proventosAnteriores(companyId: number, mes: string) {
  const [r] = await sql<{ v: number | null }[]>`SELECT sum(r.salarios)::float AS v FROM payroll_cycles c JOIN payroll_results r ON r.cycle_id=c.id WHERE c.company_id=${companyId} AND c.competencia=${competenciaAnterior(mes)} AND c.aceito_em IS NOT NULL`;
  return r?.v ?? null;
}

export async function registrarConferencia(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "cycleId") ?? 0; const voltar = `/folha/${id}`; let msg = "";
  try {
    assert(podeConferir(s), "Conferem a prévia: Financeiro ou Direção."); const c = await cicloPorId(id); assert(!!c, "Ciclo não encontrado.");
    assert(["PACOTE_ENVIADO", "DEVOLVIDO"].includes(c!.status), "A conferência acontece depois do pacote e antes do resultado."); assert(!!c!.previa, "Registre a prévia do contador antes de conferir.");
    const cfg = await getSettings(); const esp = await esperadaDaEntidade(c!.company_id, c!.competencia);
    const amostra = sortearAmostra(esp.pessoas.filter(p => !p.desligamento || p.desligamento >= `${c!.competencia}-01`), Number(cfg.folha.amostraHolerites), `${c!.competencia}|${c!.company_id}`)
      .map(p => { const v = str(fd, `amostra_${p.id}`); return { employee_id: p.id, nome: p.nome, ok: v === "ok" ? true : v === "div" ? false : null, obs: strOrNull(fd, `obs_${p.id}`) }; });
    const hc = str(fd, "headcountOk"); const headcountOk = hc === "sim" ? true : hc === "nao" ? false : null;
    const [{ n: expl }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM payroll_explanations WHERE cycle_id=${id}`;
    const varPrevia = variacaoPct(c!.previa!.proventos, await proventosAnteriores(c!.company_id, c!.competencia));
    const precisa = exigeExplicacao(varPrevia, Number(cfg.folha.variacaoMaxPct));
    const novasDiv = amostra.filter(a => a.ok === false).map(a => ({ employee_id: a.employee_id, descricao: `Holerite de ${a.nome}: ${a.obs ?? "divergente"}` }));
    if (headcountOk === false) novasDiv.push({ employee_id: 0, descricao: `Headcount da prévia (${c!.previa!.headcount}) diferente do cadastro (${esp.headcountFim})${strOrNull(fd, "obsHeadcount") ? `: ${str(fd, "obsHeadcount")}` : ""}` });
    const [{ n: abertas }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM payroll_divergences WHERE cycle_id=${id} AND status='DEVOLVIDA'`;
    const r = resultadoConferencia({ headcountOk, amostraCompleta: amostra.every(a => a.ok !== null), variacaoExplicada: !precisa || expl > 0, divergenciasAbertas: abertas + novasDiv.length, quatroOlhos: c!.pacote_por !== s.id });
    assert(r.faltando.length === 0, `Falta: ${r.faltando.join("; ")}.`);
    const conferencia = { headcountOk, amostra, resultado: r.aprovada ? "APROVADA" : "DEVOLVIDA", esperado: { proventos: esp.proventos, encargos: esp.encargos, total: esp.total, headcountFim: esp.headcountFim, semSalario: esp.semSalario }, variacaoPrevia: varPrevia };
    await sql.begin(async tx => {
      for (const d of novasDiv) await tx`INSERT INTO payroll_divergences (cycle_id, employee_id, descricao, user_id) VALUES (${id}, ${d.employee_id || null}, ${d.descricao}, ${s.id})`;
      await tx`UPDATE payroll_cycles SET conferencia=${JSON.stringify(conferencia)}::jsonb, conferido_em=now(), conferido_por=${s.id}, conferido_por_nome=${s.nome}, status=${r.aprovada ? "CONFERIDO" : "DEVOLVIDO"}, updated_at=now() WHERE id=${id}`;
    });
    await eventoFolha(id, c!.competencia, c!.company_id, s, r.aprovada ? "CONFERIDO" : "DEVOLVIDO", r.aprovada ? `Prévia conferida e aprovada por ${s.nome} (amostra de ${amostra.length} holerites).` : `Prévia devolvida ao contador com ${abertas + novasDiv.length} divergência(s).`);
    await audit(s, r.aprovada ? "aprovar conferência da folha" : "devolver prévia da folha", "payroll_cycles", id, null, { competencia: c!.competencia, divergencias: abertas + novasDiv.length });
    if (!r.aprovada && c!.pacote_por) await notificar([c!.pacote_por], `Prévia da folha devolvida — ${c!.competencia.split("-").reverse().join("/")}`, `${abertas + novasDiv.length} divergência(s) para o contador corrigir.`, `/folha/${id}`, "ACAO");
    msg = r.aprovada ? "Conferência aprovada. Importe o resultado final do contador." : "Prévia devolvida ao contador com as divergências nominais. Depois da correção, marque-as como resolvidas e confira de novo.";
  } catch (e) { redirect(go(voltar, "erro", msgErro(e))); }
  redirect(go(voltar, "ok", msg));
}

export async function resolverDivergencia(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const cycleId = int(fd, "cycleId") ?? 0; const voltar = `/folha/${cycleId}`;
  try { assert(podeFolha(s), "Sem permissão."); const [d] = await sql<{ descricao: string }[]>`UPDATE payroll_divergences SET status='RESOLVIDA', resolvida_em=now(), resolvida_por=${s.id} WHERE id=${id} AND cycle_id=${cycleId} AND status='DEVOLVIDA' RETURNING descricao`; assert(!!d, "Divergência não encontrada.");
    const c = await cicloPorId(cycleId); await eventoFolha(cycleId, c!.competencia, c!.company_id, s, "DIVERGENCIA_RESOLVIDA", d.descricao); }
  catch (e) { redirect(go(voltar, "erro", msgErro(e))); }
  redirect(go(voltar, "ok", "Divergência marcada como resolvida pelo contador."));
}

export async function adicionarExplicacao(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "cycleId") ?? 0; const voltar = `/folha/${id}`;
  try {
    assert(podeFolha(s), "Sem permissão."); const motivo = str(fd, "motivo"); assert(!!MOTIVOS_VARIACAO[motivo], "Escolha o motivo."); const texto = strOrNull(fd, "texto"); const valor = num(fd, "valor");
    assert(valor !== null || !!texto, "Informe o valor ou descreva a explicação.");
    const c = await cicloPorId(id); assert(!!c && !["ACEITO", "ARQUIVADO"].includes(c.status), "Ciclo já aceito.");
    await sql`INSERT INTO payroll_explanations (cycle_id, motivo, valor, texto, user_id, user_nome) VALUES (${id}, ${motivo}, ${valor}, ${texto}, ${s.id}, ${s.nome})`;
    await eventoFolha(id, c!.competencia, c!.company_id, s, "EXPLICACAO", `${MOTIVOS_VARIACAO[motivo]}${valor !== null ? `: ${valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}` : ""}${texto ? ` — ${texto}` : ""}`);
  } catch (e) { redirect(go(voltar, "erro", msgErro(e))); }
  redirect(go(voltar, "ok", "Explicação vinculada à variação."));
}
export async function removerExplicacao(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const cycleId = int(fd, "cycleId") ?? 0; const voltar = `/folha/${cycleId}`;
  try { assert(podeFolha(s), "Sem permissão."); const c = await cicloPorId(cycleId); assert(!!c && !["ACEITO", "ARQUIVADO"].includes(c.status), "Ciclo já aceito: a explicação faz parte do registro."); await sql`DELETE FROM payroll_explanations WHERE id=${id} AND cycle_id=${cycleId}`; await eventoFolha(cycleId, c!.competencia, c!.company_id, s, "EXPLICACAO_REMOVIDA", `Explicação ${id} removida.`); }
  catch (e) { redirect(go(voltar, "erro", msgErro(e))); }
  redirect(go(voltar, "ok", "Explicação removida."));
}

// ------------------------------------------------------------------ passo 4 · resultado do contador
export async function importarResultado(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "cycleId") ?? 0; const voltar = `/folha/${id}`; let msg = "";
  try {
    assert(podeConferir(s), "Importa o resultado: Financeiro ou Direção."); const c = await cicloPorId(id); assert(!!c, "Ciclo não encontrado.");
    assert(["CONFERIDO", "RESULTADO_IMPORTADO"].includes(c!.status), c!.status === "ACEITO" || c!.status === "ARQUIVADO" ? "Resultado já aceito: correções entram como ajuste no mês seguinte." : "Confira e aprove a prévia antes de importar o resultado.");
    const arq = fd.get("arquivo"); let texto = str(fd, "texto"); if (arq instanceof File && arq.size > 0) texto = await arquivoParaTexto(arq);
    const units = await sql<{ id: number; nome: string; codigo: string }[]>`SELECT id, nome, codigo FROM units`;
    const { rows, erros } = lerResultadoTexto(texto, units); assert(erros.length === 0, `Corrija o arquivo: ${erros.slice(0, 5).join("; ")}${erros.length > 5 ? "…" : ""}`); assert(rows.length > 0, "Nenhuma linha com valores.");
    const total = Math.round(rows.reduce((a, r) => a + custoLinha(r), 0) * 100) / 100; const anterior = await totalAnteriorAceito(c!.company_id, c!.competencia); const variacao = variacaoPct(total, anterior);
    await sql.begin(async tx => {
      await tx`DELETE FROM payroll_results WHERE cycle_id=${id}`;
      for (const r of rows) await tx`INSERT INTO payroll_results (cycle_id, unit_id, area, headcount, salarios, inss, fgts, irrf, provisao_13, provisao_ferias, beneficios, rescisoes, outros) VALUES (${id}, ${r.unit_id}, ${r.area}, ${r.headcount}, ${r.salarios}, ${r.inss}, ${r.fgts}, ${r.irrf}, ${r.provisao_13}, ${r.provisao_ferias}, ${r.beneficios}, ${r.rescisoes}, ${r.outros})`;
      await tx`UPDATE payroll_cycles SET status='RESULTADO_IMPORTADO', resultado_em=now(), resultado_por=${s.id}, resultado_por_nome=${s.nome}, total=${total}, total_anterior=${anterior}, variacao_pct=${variacao}, updated_at=now() WHERE id=${id}`;
    });
    await eventoFolha(id, c!.competencia, c!.company_id, s, "RESULTADO_IMPORTADO", `Resultado importado: ${rows.length} linha(s), custo total ${total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}${variacao !== null ? ` (${variacao > 0 ? "+" : ""}${variacao.toLocaleString("pt-BR")}% sobre o mês anterior)` : ""}.`);
    await audit(s, "importar resultado da folha", "payroll_cycles", id, null, { competencia: c!.competencia, linhas: rows.length });
    msg = "Resultado importado. Confira a decomposição e registre o aceite — só o aceite vira custo REAL.";
  } catch (e) { redirect(go(voltar, "erro", msgErro(e))); }
  redirect(go(voltar, "ok", msg));
}

export async function aceitarResultado(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "cycleId") ?? 0; const voltar = `/folha/${id}`;
  try {
    assert(podeConferir(s), "Aceita o resultado: Financeiro ou Direção."); const c = await cicloPorId(id); assert(c?.status === "RESULTADO_IMPORTADO", "Importe o resultado antes do aceite.");
    const cfg = await getSettings(); const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM payroll_explanations WHERE cycle_id=${id}`;
    if (exigeExplicacao(c!.variacao_pct, Number(cfg.folha.variacaoMaxPct))) assert(n > 0, `A folha variou ${c!.variacao_pct?.toLocaleString("pt-BR")}% sobre o mês anterior (limite ${cfg.folha.variacaoMaxPct}%): vincule as explicações (admissões, HE, reajuste…) antes do aceite.`);
    await sql`UPDATE payroll_cycles SET status='ACEITO', aceito_em=now(), aceito_por=${s.id}, updated_at=now() WHERE id=${id}`;
    await eventoFolha(id, c!.competencia, c!.company_id, s, "ACEITO", "Resultado aceito: o custo de pessoal da competência passa a ser REAL na DRE, no KPI-13 e no custo por aluno (folha.resultado.importado).");
    await audit(s, "aceitar resultado da folha", "payroll_cycles", id, null, { competencia: c!.competencia, total: c!.total, variacao: c!.variacao_pct });
  } catch (e) { redirect(go(voltar, "erro", msgErro(e))); }
  redirect(go(voltar, "ok", "Resultado aceito: custo de pessoal REAL na DRE. Falta arquivar holerites e guias."));
}

// ------------------------------------------------------------------ passo 5 · arquivo
export async function enviarDocumentoFolha(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "cycleId") ?? 0; const tipo = str(fd, "tipo"); const voltar = caminhoSeguro(str(fd, "voltar"), `/folha/${id}`);
  try {
    assert(!!TIPOS_DOC[tipo], "Escolha o tipo do documento.");
    assert(podePreparar(s) || (s.role === "FINANCEIRO" && tipo.startsWith("GUIA_")), "Arquiva: RH ou Direção (o Financeiro anexa as guias).");
    const c = await cicloPorId(id); assert(!!c, "Ciclo não encontrado.");
    const cfg = await getSettings(); const arq = fd.get("arquivo"); if (!arq || typeof arq !== "object" || !("arrayBuffer" in arq) || (arq as File).size === 0) throw new Error("Escolha o arquivo.");
    const f = arq as File; assert(f.size <= cfg.plataforma.anexoMaxMb * 1048576, `Arquivo acima de ${cfg.plataforma.anexoMaxMb} MB.`); const mime = f.type || "application/octet-stream"; assert(cfg.plataforma.anexoTipos.includes(mime), `Tipo não permitido (${mime}).`);
    const employeeId = int(fd, "employeeId");
    if (employeeId) { const ps = await pessoasDaEntidade(c!.company_id, c!.competencia); assert(ps.some(p => p.id === employeeId), "A pessoa não pertence a esta entidade na competência."); }
    const nome = f.name.replace(/[^\w.\-() áéíóúâêôãõçÁÉÍÓÚÂÊÔÃÕÇ]/g, "_").slice(0, 120); const dados = Buffer.from(await f.arrayBuffer());
    const [a] = await sql<{ id: number }[]>`INSERT INTO attachments (entidade, entidade_id, nome, mime, tamanho, dados, descricao, unit_id, user_id, user_nome) VALUES ('payroll_cycle', ${id}, ${nome}, ${mime}, ${f.size}, ${dados}, ${TIPOS_DOC[tipo]}, NULL, ${s.id}, ${s.nome}) RETURNING id`;
    const tipoObr = tipo === "GUIA_INSS" ? "INSS%" : tipo === "GUIA_FGTS" ? "FGTS%" : tipo === "GUIA_IRRF" ? "IRRF%" : null;
    const [ob] = tipoObr ? await sql<{ id: number }[]>`SELECT id FROM obligations WHERE company_id=${c!.company_id} AND competencia=${c!.competencia} AND tipo ILIKE ${tipoObr} ORDER BY id LIMIT 1` : [];
    await sql`INSERT INTO payroll_docs (cycle_id, tipo, employee_id, attachment_id, obligation_id, user_id) VALUES (${id}, ${tipo}, ${employeeId}, ${a.id}, ${ob?.id ?? null}, ${s.id})`;
    await eventoFolha(id, c!.competencia, c!.company_id, s, "DOCUMENTO", `${TIPOS_DOC[tipo]} anexado${employeeId ? " (individual)" : ""}${ob ? " e ligado à obrigação do mês" : ""}.`);
    await audit(s, "anexar documento da folha", "payroll_docs", a.id, null, { cycleId: id, tipo });
  } catch (e) { redirect(go(voltar, "erro", msgErro(e))); }
  redirect(go(voltar, "ok", "Documento arquivado. Cada consulta fica registrada."));
}

export async function arquivarCiclo(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "cycleId") ?? 0; const voltar = `/folha/${id}`;
  try {
    assert(podePreparar(s), "Arquiva o ciclo: RH ou Direção."); const c = await cicloPorId(id); assert(c?.status === "ACEITO", "Aceite o resultado antes de arquivar.");
    const cfg = await getSettings(); const docs = await sql<{ tipo: string }[]>`SELECT DISTINCT tipo FROM payroll_docs WHERE cycle_id=${id}`;
    const faltam = docsFaltando(cfg.folha.docsObrigatorios as string[], docs.map(d => d.tipo)); assert(!faltam.length, `Faltam documentos: ${faltam.map(t => TIPOS_DOC[t] ?? t).join(", ")}.`);
    await sql`UPDATE payroll_cycles SET status='ARQUIVADO', arquivado_em=now(), arquivado_por=${s.id}, updated_at=now() WHERE id=${id}`;
    await eventoFolha(id, c!.competencia, c!.company_id, s, "ARQUIVADO", "Ciclo completo: ponto fechado, pacote enviado, prévia conferida, resultado aceito e documentos arquivados.");
    await audit(s, "arquivar ciclo da folha", "payroll_cycles", id, null, { competencia: c!.competencia });
  } catch (e) { redirect(go(voltar, "erro", msgErro(e))); }
  redirect(go(voltar, "ok", "Ciclo da folha completo."));
}

export async function cobrarDocumentos(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "cycleId") ?? 0; const voltar = caminhoSeguro(str(fd, "voltar"), `/folha/${id}`);
  try { assert(podeFolha(s), "Sem permissão."); const c = await cicloPorId(id); assert(!!c, "Ciclo não encontrado."); const cfg = await getSettings(); const docs = await sql<{ tipo: string }[]>`SELECT DISTINCT tipo FROM payroll_docs WHERE cycle_id=${id}`;
    const faltam = docsFaltando(cfg.folha.docsObrigatorios as string[], docs.map(d => d.tipo)); assert(faltam.length > 0, "Nenhum documento obrigatório faltando.");
    await eventoFolha(id, c!.competencia, c!.company_id, s, "COBRANCA", `Cobrança ao contador: ${faltam.map(t => TIPOS_DOC[t] ?? t).join(", ")}.`); }
  catch (e) { redirect(go(voltar, "erro", msgErro(e))); }
  redirect(go(voltar, "ok", "Cobrança registrada na trilha do ciclo."));
}

