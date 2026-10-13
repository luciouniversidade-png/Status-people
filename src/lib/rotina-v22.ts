import { sql } from "@/db";
import { getSettings, hoje, addDays } from "./utils";
import { notificar as notificarBase, usuariosPorPerfil } from "./comunicacao";
import { expirarLinks } from "./rematricula";
import { sincronizarAfastamentos } from "./cobertura";
import { situacaoBrigada, semSimulado } from "./seguranca";
import { PEDIDO_ABERTO } from "./privacidade";
import { ETICA_ABERTO, responsaveisRelato, candidatosEtica, impedidosEfetivos } from "./etica";
import { situacaoLicenca, TIPO_LICENCA } from "./contratos";
import type { EtapaSnap } from "./solicitacoes";

const br = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
const dias = (de: string, ate: string) => Math.round((Date.parse(ate + "T00:00:00Z") - Date.parse(de + "T00:00:00Z")) / 86400000);
/** Segunda-feira da semana (chave de avisos semanais). */
const semana = (h: string) => { const d = new Date(h + "T12:00:00Z").getUTCDay(); return addDays(h, -((d + 6) % 7)); };

/**
 * Rotina diária dos módulos v22 (chamada por /api/tarefas). Cada aviso tem chave própria: repetir a rotina no mesmo dia não duplica.
 * Cada bloco roda isolado (uma falha não impede os demais) e só avisa usuários ativos. Avisos sensíveis (privacidade, ética) não levam conteúdo.
 */
export async function rotinaV22(h = hoje()) {
  const cfg = await getSettings();
  const r = { rematricula: { expirados: 0, abertosSemConcluir: 0, expirando: 0 }, substituicao: { ausenciasCriadas: 0, ausenciasCanceladas: 0, avisos: 0 }, portaria: { visitasAnonimizadas: 0, brigada: 0, simulado: 0, emergencias: 0 }, contratos: 0, licencas: 0, privacidade: 0, etica: 0, solicitacoes: 0, aparelhosRemovidos: 0, falhas: [] as string[] };
  const ativos = new Set((await sql<{ id: number }[]>`SELECT id FROM users WHERE ativo`).map(x => x.id));
  const notificar = (ids: (number | null | undefined)[], titulo: string, texto: string | null, link: string | null, tipo: "INFO" | "ACAO" | "ALERTA", chave: string) => { const ds = [...new Set(ids.filter((i): i is number => !!i && ativos.has(i)))]; return ds.length ? notificarBase(ds, titulo, texto, link, tipo, chave).then(() => 1) : Promise.resolve(0); };
  const bloco = async (nome: string, f: () => Promise<void>) => { try { await f(); } catch (e) { r.falhas.push(`${nome}: ${e instanceof Error ? e.message : String(e)}`); } };

  // ---------- Rematrícula: expira links vencidos; avisa a carteira (ou o comercial da unidade) sobre link aberto e não concluído e link perto de vencer sem ser aberto
  await bloco("rematricula", async () => {
    r.rematricula.expirados = await expirarLinks(h);
    const n = cfg.rematricula.lembreteAbertoDias as number;
    const abertos = await sql<{ id: number; student_id: number; nome: string; dest: number | null; unit_id: number | null; aberto_em: string; ano: number }[]>`SELECT l.id, l.student_id, st.nome, st.carteira_user_id AS dest, coalesce(l.unit_id, st.unit_atual_id) AS unit_id, l.aberto_em::text, l.ano FROM rematricula_links l JOIN students st ON st.id=l.student_id
      WHERE l.status='PENDENTE' AND l.aberto_em IS NOT NULL AND l.aberto_em::date <= ${addDays(h, -n)}::date`;
    for (const l of abertos) { const dest = l.dest ? [l.dest] : await usuariosPorPerfil(["COMERCIAL"], l.unit_id); r.rematricula.abertosSemConcluir += await notificar(dest, `Rematrícula aberta e não concluída: ${l.nome}`, `A família abriu o link de ${l.ano} em ${br(l.aberto_em)} e não concluiu. Vale um contato para ajudar.`, `/matriculas/alunos/${l.student_id}#rematricula`, "ACAO", `remaberto:${l.id}`); }
    const expirando = await sql<{ id: number; student_id: number; nome: string; dest: number | null; unit_id: number | null; expira_em: string; ano: number }[]>`SELECT l.id, l.student_id, st.nome, st.carteira_user_id AS dest, coalesce(l.unit_id, st.unit_atual_id) AS unit_id, l.expira_em::text, l.ano FROM rematricula_links l JOIN students st ON st.id=l.student_id
      WHERE l.status='PENDENTE' AND l.aberto_em IS NULL AND l.enviado_em IS NOT NULL AND l.expira_em BETWEEN ${h} AND ${addDays(h, 3)}`;
    for (const l of expirando) { const dest = l.dest ? [l.dest] : await usuariosPorPerfil(["COMERCIAL"], l.unit_id); r.rematricula.expirando += await notificar(dest, `Link de rematrícula vence sem ser aberto: ${l.nome}`, `O link de ${l.ano} vence em ${br(l.expira_em)} e a família ainda não abriu. Reenvie ou ligue.`, `/matriculas/alunos/${l.student_id}#rematricula`, "ACAO", `remexpira:${l.id}`); }
  });

  // ---------- Substituição: afastamentos aprovados viram ausências (próximos 7 dias); aulas sem professor hoje e amanhã; coberturas a confirmar
  await bloco("substituicao", async () => {
    const s = await sincronizarAfastamentos(h, addDays(h, 7)); r.substituicao.ausenciasCriadas = s.criadas; r.substituicao.ausenciasCanceladas = s.canceladas;
    for (const [data, quando, tipo] of [[h, "hoje", "ALERTA"], [addDays(h, 1), "amanhã", "ACAO"]] as const) {
      const porUnidade = await sql<{ unit_id: number; unidade: string; n: number }[]>`SELECT ca.unit_id, u.nome AS unidade, count(*)::int AS n FROM cover_assignments ca JOIN units u ON u.id=ca.unit_id WHERE ca.data=${data} AND ca.status IN ('ABERTA','CONVIDADO') GROUP BY ca.unit_id, u.nome`;
      for (const u of porUnidade) r.substituicao.avisos += await notificar(await usuariosPorPerfil(["GESTOR", "DIRETOR_UNIDADE"], u.unit_id), `${u.n} aula(s) sem professor ${quando} — ${u.unidade}`, `Convide quem está livre (a lista de sugestões já considera horário e carga).`, `/cobertura?data=${data}`, tipo, `semcob${quando === "hoje" ? "h" : "a"}:${u.unit_id}:${data}`);
    }
    const aConfirmar = await sql<{ unit_id: number; unidade: string; n: number }[]>`SELECT ca.unit_id, u.nome AS unidade, count(*)::int AS n FROM cover_assignments ca JOIN units u ON u.id=ca.unit_id WHERE ca.status='CONFIRMADA' AND ca.data < ${h} AND ca.data >= ${addDays(h, -45)} GROUP BY ca.unit_id, u.nome`;
    for (const u of aConfirmar) r.substituicao.avisos += await notificar(await usuariosPorPerfil(["GESTOR", "DIRETOR_UNIDADE"], u.unit_id), `${u.n} cobertura(s) a confirmar — ${u.unidade}`, "Marque como realizada para creditar as horas de quem cobriu (banco de horas).", "/cobertura/historico", "ACAO", `cobreal:${u.unit_id}:${semana(h)}`);
  });

  // ---------- Portaria e segurança
  await bloco("portaria", async () => {
    // LGPD: dados pessoais de visitantes saem depois do prazo de guarda (o registro de que houve a visita fica)
    const ret = cfg.portaria.retencaoVisitasDias as number;
    const an = await sql`UPDATE visits SET nome='Visitante (dados apagados)', documento=NULL, cracha=NULL, obs=NULL, anonimizado_em=now() WHERE anonimizado_em IS NULL AND entrada::date < ${addDays(h, -ret)}::date RETURNING id`;
    r.portaria.visitasAnonimizadas = an.length;
    const bri = await situacaoBrigada(null);
    for (const m of bri.membros.filter(m => m.situacao === "VENCIDO" || m.situacao === "VENCE")) {
      const proprio = await sql<{ id: number }[]>`SELECT id FROM users WHERE ativo AND employee_id=${m.employee_id}`;
      r.portaria.brigada += await notificar([...await usuariosPorPerfil(["DIRETOR_UNIDADE", "OPERACOES"], m.unit_id), ...proprio.map(p => p.id)], m.situacao === "VENCIDO" ? `Treinamento de brigada vencido: ${m.nome}` : `Treinamento de brigada vence em breve: ${m.nome}`, `${m.unidade} · validade ${m.validade ? br(m.validade) : "—"}. Agende a reciclagem e atualize a validade.`, "/operacoes/seguranca/brigada", m.situacao === "VENCIDO" ? "ALERTA" : "ACAO", `brigada:${m.id}:${m.situacao}:${m.validade}`);
    }
    for (const u of bri.porUnidade.filter(u => u.abaixo)) r.portaria.brigada += await notificar([...await usuariosPorPerfil(["DIRETOR_UNIDADE", "OPERACOES"], u.id), ...await usuariosPorPerfil(["DIRECAO"])], `Brigada abaixo do mínimo — ${u.nome}`, `${u.validos} brigadista(s) com treinamento válido; mínimo ${bri.min} por unidade.`, "/operacoes/seguranca/brigada", "ALERTA", `brigadamin:${u.id}:${h.slice(0, 7)}`);
    for (const u of await semSimulado(null)) r.portaria.simulado += await notificar(await usuariosPorPerfil(["DIRETOR_UNIDADE", "OPERACOES"], u.id), `Simulado de abandono pendente — ${u.nome}`, `${u.ultimo ? `Último simulado encerrado em ${br(u.ultimo)}` : "Nenhum simulado encerrado registrado"}; a meta é um a cada ${cfg.portaria.simuladoMeses} meses.`, "/operacoes/seguranca/emergencias", "ACAO", `simulado:${u.id}:${h.slice(0, 7)}`);
    // Emergência (ou simulado) esquecida aberta: lembra quem coordena de encerrar e registrar o tempo
    const abertas = await sql<{ id: number; tipo: string; unidade: string; unit_id: number; coordenador_user_id: number | null; created_by: number | null }[]>`SELECT e.id, e.tipo, u.nome AS unidade, e.unit_id, e.coordenador_user_id, e.created_by FROM emergency_events e JOIN units u ON u.id=e.unit_id WHERE e.status='EM_ANDAMENTO' AND e.inicio < now() - interval '6 hours'`;
    for (const e of abertas) r.portaria.emergencias += await notificar([e.coordenador_user_id, e.created_by, ...await usuariosPorPerfil(["DIRETOR_UNIDADE"], e.unit_id)], `${e.tipo === "REAL" ? "Emergência" : "Simulado"} ainda aberto — ${e.unidade}`, "Encerre o registro com a chamada final e as falhas encontradas.", `/operacoes/seguranca/emergencias/${e.id}`, "ACAO", `emeraberta:${e.id}`);
  });

  // ---------- Contratos de fornecedores: vencimento (nos marcos configurados), prazo para avisar a não renovação, vencido e reajuste
  await bloco("contratos", async () => {
    const avisos = [...(cfg.contratos.avisos as number[])].sort((a, b) => a - b);
    const cs = await sql<{ id: number; objeto: string; fornecedor: string; fim: string | null; aviso_previo_dias: number; renovacao: string; proximo_reajuste: string | null; unit_id: number | null; responsavel_user_id: number | null }[]>`SELECT c.id, c.objeto, s.nome AS fornecedor, c.fim::text, c.aviso_previo_dias, c.renovacao, c.proximo_reajuste::text, c.unit_id, c.responsavel_user_id FROM contracts c JOIN suppliers s ON s.id=c.supplier_id WHERE c.status='VIGENTE'`;
    const fin = await usuariosPorPerfil(["FINANCEIRO"]);
    for (const c of cs) {
      const dest = [c.responsavel_user_id, ...fin, ...(c.unit_id ? await usuariosPorPerfil(["DIRETOR_UNIDADE"], c.unit_id) : [])]; const nome = `${c.fornecedor} — ${c.objeto}`; const link = `/operacoes/contratos/${c.id}`;
      if (c.fim) {
        const df = dias(h, c.fim); const limite = addDays(c.fim, -c.aviso_previo_dias);
        if (df < 0) r.contratos += await notificar(dest, `Contrato vencido: ${nome}`, `Venceu em ${br(c.fim)}. Renove, encerre ou registre a renovação automática.`, link, "ALERTA", `ctrvenc:${c.id}:${c.fim}:${semana(h)}`);
        else {
          if (c.renovacao !== "SEM_RENOVACAO" && h <= limite && dias(h, limite) <= 15) r.contratos += await notificar(dest, `Prazo para avisar a não renovação: ${nome}`, `Se não quiser renovar, avise o fornecedor até ${br(limite)} (aviso prévio de ${c.aviso_previo_dias} dias).`, link, "ALERTA", `ctraviso:${c.id}:${limite}`);
          const marco = avisos.find(a => df <= a); if (marco !== undefined) r.contratos += await notificar(dest, `Contrato vence em ${df} dia(s): ${nome}`, `Fim em ${br(c.fim)} · ${c.renovacao === "AUTOMATICA" ? "renovação automática" : c.renovacao === "SEM_RENOVACAO" ? "sem renovação" : "renovação negociada"}.`, link, df <= avisos[0] ? "ALERTA" : "ACAO", `ctrfim:${c.id}:${c.fim}:${marco}`);
        }
      }
      if (c.proximo_reajuste && c.proximo_reajuste >= h && dias(h, c.proximo_reajuste) <= 30) r.contratos += await notificar(dest, `Reajuste de contrato em ${br(c.proximo_reajuste)}: ${nome}`, "Confira o índice e o novo valor antes da próxima cobrança.", link, "ACAO", `ctrreaj:${c.id}:${c.proximo_reajuste}`);
    }
  });

  // ---------- Licenças e alvarás: vence em breve (antecedência de cada documento) e vencida (lembrete semanal)
  await bloco("licencas", async () => {
    const ls = await sql<{ id: number; unit_id: number; unidade: string; tipo: string; nome: string | null; validade: string | null; antecedencia_dias: number; status: string; responsavel_user_id: number | null }[]>`SELECT l.id, l.unit_id, u.nome AS unidade, l.tipo, l.nome, l.validade::text, l.antecedencia_dias, l.status, l.responsavel_user_id FROM licenses l JOIN units u ON u.id=l.unit_id WHERE l.status='ATIVA' AND l.validade IS NOT NULL`;
    for (const l of ls) {
      const sit = situacaoLicenca(l, h); if (sit !== "VENCIDA" && sit !== "VENCE") continue;
      const nome = `${l.tipo === "OUTRO" && l.nome ? l.nome : TIPO_LICENCA[l.tipo] ?? l.tipo} — ${l.unidade}`;
      r.licencas += await notificar([l.responsavel_user_id, ...await usuariosPorPerfil(["OPERACOES", "DIRETOR_UNIDADE"], l.unit_id)], sit === "VENCIDA" ? `Licença vencida: ${nome}` : `Licença vence em ${dias(h, l.validade!)} dia(s): ${nome}`, sit === "VENCIDA" ? `Venceu em ${br(l.validade!)}. Providencie a renovação e anexe o novo documento.` : `Validade ${br(l.validade!)}. Comece a renovação agora (vistoria, taxas, laudos).`, `/operacoes/licencas/${l.id}`, sit === "VENCIDA" ? "ALERTA" : "ACAO", sit === "VENCIDA" ? `licvenc:${l.id}:${l.validade}:${semana(h)}` : `licvence:${l.id}:${l.validade}`);
    }
  });

  // ---------- Privacidade (LGPD): pedidos de titulares perto do prazo/vencidos e incidentes com prazo de comunicação à ANPD — sem dados pessoais no aviso
  await bloco("privacidade", async () => {
    const base = [cfg.privacidade.dpoUserId as number | null, ...await usuariosPorPerfil(cfg.privacidade.perfis as string[])];
    const peds = await sql<{ id: number; protocolo: string; prazo: string; responsavel_user_id: number | null }[]>`SELECT id, protocolo, prazo::text, responsavel_user_id FROM privacy_requests WHERE status = ANY(${PEDIDO_ABERTO}) AND prazo <= ${addDays(h, 3)}`;
    for (const p of peds) { const venc = p.prazo < h; r.privacidade += await notificar([p.responsavel_user_id, ...base], venc ? `Pedido de titular com prazo vencido: ${p.protocolo}` : `Pedido de titular vence em ${br(p.prazo)}: ${p.protocolo}`, "Responda pelo sistema (a resposta fica registrada para comprovação).", `/governanca/privacidade/pedidos/${p.id}`, venc ? "ALERTA" : "ACAO", `${venc ? "privpedv" : "privped"}:${p.id}:${p.prazo}`); }
    const incs = await sql<{ id: number; codigo: string; prazo_anpd: string | null; responsavel_user_id: number | null }[]>`SELECT id, codigo, prazo_anpd::text, responsavel_user_id FROM privacy_incidents WHERE status <> 'ENCERRADO' AND (comunicar IS NULL OR (comunicar AND comunicado_anpd_em IS NULL)) AND prazo_anpd IS NOT NULL AND prazo_anpd <= ${addDays(h, 1)}`;
    for (const i of incs) { const venc = i.prazo_anpd! < h; r.privacidade += await notificar([i.responsavel_user_id, ...base], venc ? `Incidente ${i.codigo}: prazo de comunicação à ANPD vencido` : `Incidente ${i.codigo}: comunicar à ANPD até ${br(i.prazo_anpd!)}`, "Decida e registre se o incidente será comunicado (com a justificativa, se não for).", `/governanca/privacidade/incidentes/${i.id}`, "ALERTA", `${venc ? "privincv" : "privinc"}:${i.id}:${i.prazo_anpd}`); }
  });

  // ---------- Canal de ética: prazos de triagem e de conclusão — só para quem pode tratar o relato (comitê sem impedidos), nunca com o conteúdo
  await bloco("etica", async () => {
    const rs = await sql<{ id: number; protocolo: string; status: string; prazo_triagem: string | null; prazo_conclusao: string | null; impedidos: number[] | null; liberados: number[] | null; envolvidos: string | null; relato: string }[]>`SELECT id, protocolo, status, prazo_triagem::text, prazo_conclusao::text, impedidos, liberados, envolvidos, relato FROM ethics_reports WHERE status = ANY(${ETICA_ABERTO})`;
    const cands = rs.length ? await candidatosEtica() : [];
    for (const x of rs) {
      const quem = (await responsaveisRelato(impedidosEfetivos(x, cands))).map(m => m.id);
      if (x.status === "RECEBIDA" && x.prazo_triagem && x.prazo_triagem <= addDays(h, 1)) r.etica += await notificar(quem, x.prazo_triagem < h ? `Canal de ética: triagem atrasada (${x.protocolo})` : `Canal de ética: triagem até ${br(x.prazo_triagem)} (${x.protocolo})`, "Abra o relato no sistema para fazer a triagem (o acesso fica registrado).", `/governanca/etica/${x.id}`, "ALERTA", `etitri:${x.id}:${x.prazo_triagem}:${x.prazo_triagem < h ? "v" : "p"}`);
      if (x.prazo_conclusao && x.prazo_conclusao < h) r.etica += await notificar(quem, `Canal de ética: apuração com prazo vencido (${x.protocolo})`, `Prazo de conclusão era ${br(x.prazo_conclusao)}. Conclua ou registre o andamento.`, `/governanca/etica/${x.id}`, "ALERTA", `eticonc:${x.id}:${x.prazo_conclusao}:${semana(h)}`);
    }
  });

  // ---------- Solicitações: etapa parada além do prazo (aprovadores da etapa) e devolvida há mais de 3 dias sem ajuste (solicitante)
  await bloco("solicitacoes", async () => {
    const rs = await sql<{ id: number; numero: string; titulo: string; status: string; etapa_atual: number; etapas: EtapaSnap[]; prazo_etapa: string | null; solicitante_user_id: number; updated_at: string }[]>`SELECT id, numero, titulo, status, etapa_atual, etapas, prazo_etapa::text, solicitante_user_id, updated_at::text FROM requests WHERE (status='EM_APROVACAO' AND prazo_etapa < ${h}) OR (status='DEVOLVIDA' AND updated_at::date <= ${addDays(h, -3)}::date)`;
    for (const x of rs) {
      if (x.status === "EM_APROVACAO") { const e = x.etapas[x.etapa_atual]; if (e) r.solicitacoes += await notificar(e.aprovadores, `Aprovação atrasada: ${x.titulo}`, `${x.numero} · etapa “${e.nome}” · prazo era ${br(x.prazo_etapa!)}.`, `/solicitacoes/${x.id}`, "ALERTA", `solatr:${x.id}:${x.etapa_atual}:${x.prazo_etapa}`); }
      else r.solicitacoes += await notificar([x.solicitante_user_id], `Solicitação aguardando seu ajuste: ${x.titulo}`, `${x.numero} foi devolvida para ajuste. Ajuste e reenvie, ou cancele.`, `/solicitacoes/${x.id}`, "ACAO", `soldev:${x.id}:${x.updated_at.slice(0, 10)}`);
    }
  });

  // ---------- Notificações no celular: aparelhos de usuários desativados saem da lista
  await bloco("aparelhos", async () => { const d = await sql`DELETE FROM push_subscriptions ps USING users u WHERE u.id=ps.user_id AND NOT u.ativo RETURNING ps.id`; r.aparelhosRemovidos = d.length; });
  return r;
}
