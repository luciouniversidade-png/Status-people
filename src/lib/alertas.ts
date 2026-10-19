import { sql } from "@/db";
import type { Session } from "./auth";
import { getSettings, hoje } from "./utils";
import type { Alerta } from "./command-center";

/**
 * Central de alertas persistente (T-003 · Nova Arquitetura): todo alerta com dono, SLA, tratar (desfecho obrigatório),
 * delegar e silenciar (validade e motivo obrigatórios); estouro do SLA sobe em degraus (dono → gestor → Direção — CRQ-PRJ-V3-04).
 * Os alertas nascem das regras dos módulos (Command Center); a varredura grava, atualiza e resolve sozinha o que deixou de existir.
 * Alerta sem dono resolvível é defeito de configuração e aparece para a Direção com a regra de origem.
 */
export type Severidade = "ALTO" | "MEDIO";
export const SEVERIDADE_LABEL: Record<string, string> = { ALTO: "Crítico", MEDIO: "Atenção", INFO: "Informativo" };
export const STATUS_ALERTA: Record<string, string> = { ABERTO: "Aberto", TRATADO: "Tratado", SILENCIADO: "Silenciado", RESOLVIDO: "Resolvido (condição deixou de existir)" };
export const MODULOS_SENSIVEIS = ["Privacidade", "SST"];

/** Módulo do alerta pelo prefixo do texto ("Financeiro: …"). */
export function moduloDe(texto: string) { const i = texto.indexOf(":"); return i > 0 && i < 30 ? texto.slice(0, i).trim() : "Geral"; }
/** Regra estável do alerta: o texto sem números, datas e valores (a contagem muda; a regra não). */
export function regraDe(texto: string) {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/r\$\s?[\d.,]+/g, "#").replace(/\d{1,2}\/\d{1,2}(\/\d{2,4})?/g, "#").replace(/-?\d+([.,]\d+)?%?/g, "#").replace(/\s+/g, " ").trim().slice(0, 200);
}
export const chaveDe = (a: Pick<Alerta, "texto">) => `${moduloDe(a.texto)}|${regraDe(a.texto)}`;

/** Prazo (SLA) do alerta pela severidade. */
export async function slaHoras(sev: string) { const cfg = await getSettings(); return Number((cfg.alertas.slaHoras as Record<string, number>)[sev] ?? 72); }

/** Dono: usuário fixo do módulo (Configurações) ou o primeiro perfil da lista com usuário ativo; alerta de unidade prefere quem é da unidade. */
export async function resolverDono(modulo: string, unitId: number | null): Promise<number | null> {
  const cfg = await getSettings();
  // alerta do recorte de uma unidade: o dono é alguém que enxerga esse recorte (diretor de unidade, depois coordenação daquela unidade);
  // quem é de rede acompanha o agregado no recorte da rede e recebe o alerta da unidade só quando ele escala até a Direção
  if (unitId !== null) {
    const perfisUn = [...((cfg.alertas.donos as Record<string, string[]>)[modulo] ?? []).filter(p => ["DIRETOR_UNIDADE", "GESTOR"].includes(p)), "DIRETOR_UNIDADE", "GESTOR"];
    for (const p of [...new Set(perfisUn)]) { const [x] = await sql<{ id: number }[]>`SELECT id FROM users WHERE ativo AND role=${p} AND unit_id=${unitId} ORDER BY id LIMIT 1`; if (x) return x.id; }
    return null;
  }
  const fixo = (cfg.alertas.donoUsuario as Record<string, number>)[modulo];
  if (fixo) { const [u] = await sql<{ id: number }[]>`SELECT id FROM users WHERE id=${fixo} AND ativo`; if (u) return u.id; }
  const perfis = (cfg.alertas.donos as Record<string, string[]>)[modulo] ?? ["DIRECAO"];
  for (const p of perfis) {
    // perfis de unidade só servem quando o alerta é da unidade (e a pessoa é dela)
    if (["DIRETOR_UNIDADE", "GESTOR"].includes(p)) { if (unitId === null) continue; const [x] = await sql<{ id: number }[]>`SELECT id FROM users WHERE ativo AND role=${p} AND unit_id=${unitId} ORDER BY id LIMIT 1`; if (x) return x.id; continue; }
    const [u] = await sql<{ id: number }[]>`SELECT id FROM users WHERE ativo AND role=${p} ORDER BY ${unitId !== null ? sql`(unit_id=${unitId}) DESC NULLS LAST,` : sql``} (unit_id IS NULL) DESC, id LIMIT 1`;
    if (u) return u.id;
  }
  return null;
}

async function evento(alertId: number, s: Pick<Session, "id" | "nome"> | null, tipo: string, texto: string) {
  await sql`INSERT INTO alert_events (alert_id, user_id, user_nome, tipo, texto) VALUES (${alertId}, ${s?.id ?? null}, ${s?.nome ?? "varredura"}, ${tipo}, ${texto})`;
}

/**
 * Varredura de um escopo (0 = rede; senão a unidade): grava os alertas atuais, reabre o que voltou ou venceu o silêncio,
 * e marca como resolvido o que sumiu. Devolve o resumo. `forcar` ignora o intervalo mínimo entre varreduras.
 */
export async function varrerAlertas(escopo: number, opcoes: { forcar?: boolean; minutos?: number } = {}) {
  const [ult] = await sql<{ at: string; min: number }[]>`SELECT at::text, (extract(epoch FROM now() - at) / 60)::float AS min FROM alert_sweeps WHERE escopo=${escopo}`;
  if (!opcoes.forcar && ult && ult.min < (opcoes.minutos ?? 10)) return { varreu: false, em: ult.at };
  const { healthGeral } = await import("./command-center");
  const hg = await healthGeral(escopo === 0 ? null : escopo, { sensiveis: true, licencas: true });
  const cfg = await getSettings(); const reabrirDias = Number(cfg.alertas.reabrirTratadoDias ?? 7); const h = hoje();
  const vistos = new Set<string>(); let novos = 0, reabertos = 0;
  // recorte de unidade: dono precisa enxergar o recorte (diretor/coordenação local); dono de rede herdado de versão anterior é reatribuído
  const locais = escopo === 0 ? null : new Set((await sql<{ id: number }[]>`SELECT id FROM users WHERE ativo AND role IN ('DIRETOR_UNIDADE','GESTOR') AND unit_id=${escopo}`).map(r => r.id));
  for (const a of hg.alertas) {
    if (escopo !== 0 && MODULOS_SENSIVEIS.includes(moduloDe(a.texto))) continue; // sensível só no recorte da rede (contagem para Direção e RH)
    const chave = chaveDe(a); if (vistos.has(chave)) continue; vistos.add(chave);
    const modulo = moduloDe(a.texto); const sev = a.nivel; const horas = await slaHoras(sev);
    const [ex] = await sql<{ id: number; status: string; tratado_em: string | null; silenciado_ate: string | null; dono_user_id: number | null }[]>`SELECT id, status, tratado_em::text, silenciado_ate::text, dono_user_id FROM alerts WHERE chave=${chave} AND escopo=${escopo}`;
    if (!ex) {
      const dono = await resolverDono(modulo, escopo === 0 ? null : escopo);
      const [n] = await sql<{ id: number }[]>`INSERT INTO alerts (chave, escopo, unit_id, regra, modulo, severidade, titulo, href, dono_user_id, defeito, sla_ate) VALUES (${chave}, ${escopo}, ${escopo === 0 ? null : escopo}, ${regraDe(a.texto)}, ${modulo}, ${sev}, ${a.texto}, ${a.href}, ${dono}, ${dono ? null : `Sem dono resolvível para o módulo "${modulo}": configure o responsável em Configurações → Central de alertas.`}, now() + ${`${horas} hours`}::interval) RETURNING id`;
      await evento(n.id, null, "CRIADO", `Alerta criado pela regra: ${regraDe(a.texto)}`); novos++;
      continue;
    }
    const voltar = ex.status === "RESOLVIDO" ? "reapareceu" : ex.status === "SILENCIADO" && ex.silenciado_ate && ex.silenciado_ate < h ? "silêncio venceu e a condição persiste" : ex.status === "TRATADO" && ex.tratado_em && (Date.now() - Date.parse(ex.tratado_em)) / 86400000 > reabrirDias ? `tratado há mais de ${reabrirDias} dias e a condição persiste` : null;
    if (voltar) {
      await sql`UPDATE alerts SET status='ABERTO', titulo=${a.texto}, href=${a.href}, severidade=${sev}, visto_em=now(), escalonamento=0, sla_ate=now() + ${`${horas} hours`}::interval, ocorrencias=ocorrencias + ${ex.status === "RESOLVIDO" ? 1 : 0}, resolvido_em=NULL, updated_at=now() WHERE id=${ex.id}`;
      await evento(ex.id, null, "REABERTO", `Reaberto: ${voltar}.`); reabertos++;
    } else await sql`UPDATE alerts SET titulo=${a.texto}, href=${a.href}, severidade=${sev}, visto_em=now(), updated_at=now() WHERE id=${ex.id}`;
    if (locais && ex.dono_user_id !== null && !locais.has(ex.dono_user_id)) {
      const novo = await resolverDono(modulo, escopo);
      if (novo !== ex.dono_user_id) { await sql`UPDATE alerts SET dono_user_id=${novo}, defeito=${novo === null}, updated_at=now() WHERE id=${ex.id}`; await evento(ex.id, null, "DELEGADO", "Dono ajustado ao recorte da unidade (quem é de rede acompanha pelo agregado)."); }
    }
  }
  const sumiram = await sql<{ id: number }[]>`UPDATE alerts SET status='RESOLVIDO', resolvido_em=now(), updated_at=now() WHERE escopo=${escopo} AND status IN ('ABERTO','TRATADO','SILENCIADO') AND NOT (chave = ANY(${[...vistos, "§"]})) RETURNING id`;
  for (const r of sumiram) await evento(r.id, null, "RESOLVIDO", "A condição deixou de existir na varredura.");
  await sql`INSERT INTO alert_sweeps (escopo, at, n) VALUES (${escopo}, now(), ${vistos.size}) ON CONFLICT (escopo) DO UPDATE SET at=now(), n=EXCLUDED.n`;
  return { varreu: true, novos, reabertos, resolvidos: sumiram.length, ativos: vistos.size };
}

/**
 * Unidades com quem acompanhe no recorte local (diretor de unidade ou coordenação ativos). Sem ninguém lá, a varredura da unidade só
 * duplicaria o que o recorte da rede já mostra agregado — e os alertas cairiam num dono que não os vê na própria central.
 */
export async function unidadesComGestorLocal() {
  return (await sql<{ unit_id: number }[]>`SELECT DISTINCT unit_id FROM users WHERE ativo AND role IN ('DIRETOR_UNIDADE','GESTOR') AND unit_id IS NOT NULL`).map(r => r.unit_id);
}
/** Encerra os alertas abertos de um recorte de unidade que deixou de ser varrido (sem gestor local): o recorte da rede acompanha. */
export async function encerrarEscopoSemGestor(unitId: number) {
  const fechados = await sql<{ id: number }[]>`UPDATE alerts SET status='RESOLVIDO', resolvido_em=now(), updated_at=now() WHERE escopo=${unitId} AND status IN ('ABERTO','TRATADO','SILENCIADO') RETURNING id`;
  for (const r of fechados) await evento(r.id, null, "RESOLVIDO", "Unidade sem diretor nem coordenação no sistema: o alerta segue acompanhado no recorte da rede.");
  return fechados.length;
}

/**
 * Escalonamento em degraus (rotina): SLA estourado sobe um degrau e renova o prazo; a 80% do prazo o dono recebe o aviso.
 * Degrau 1 = gestor (diretor da unidade, no alerta de unidade; Direção, no da rede); degrau 2 = Direção.
 */
export async function escalarAlertas() {
  const { notificar, usuariosPorPerfil } = await import("./comunicacao");
  const vencidos = await sql<{ id: number; escopo: number; titulo: string; severidade: string; escalonamento: number; dono_user_id: number | null }[]>`SELECT id, escopo, titulo, severidade, escalonamento, dono_user_id FROM alerts WHERE status='ABERTO' AND sla_ate < now() AND escalonamento < 2`;
  let n = 0;
  for (const a of vencidos) {
    const prox = a.escalonamento + 1; const horas = await slaHoras(a.severidade);
    const destino = prox === 1 && a.escopo !== 0 ? await usuariosPorPerfil(["DIRETOR_UNIDADE"], a.escopo) : await usuariosPorPerfil(["DIRECAO"]);
    await sql`UPDATE alerts SET escalonamento=${prox}, sla_ate=now() + ${`${horas} hours`}::interval, updated_at=now() WHERE id=${a.id}`;
    await evento(a.id, null, "ESCALADO", prox === 1 ? "Prazo estourado: escalado ao gestor." : "Prazo estourado de novo: escalado à Direção.");
    await notificar(destino.filter(id => id !== a.dono_user_id || prox === 2), `Alerta sem tratamento (${prox === 1 ? "gestor" : "Direção"})`, a.titulo, `/alertas?id=${a.id}`, "ALERTA", `alerta-esc-${a.id}-${prox}`);
    n++;
  }
  // aviso de 80% do prazo ao dono (uma vez por degrau)
  const quase = await sql<{ id: number; titulo: string; dono_user_id: number; escalonamento: number }[]>`SELECT id, titulo, dono_user_id, escalonamento FROM alerts WHERE status='ABERTO' AND dono_user_id IS NOT NULL AND sla_ate > now() AND now() >= sla_ate - (sla_ate - greatest(primeiro_em, updated_at)) * 0.2`;
  for (const a of quase) await notificar([a.dono_user_id], "Alerta vencendo — tratar agora", a.titulo, `/alertas?id=${a.id}`, "ACAO", `alerta-80-${a.id}-${a.escalonamento}`);
  return { escalados: n, avisos80: quase.length };
}

export type AlertaRow = { id: number; chave: string; escopo: number; unit_id: number | null; unidade: string | null; regra: string; modulo: string; severidade: string; titulo: string; href: string | null; dono_user_id: number | null; dono: string | null; defeito: string | null; sla_ate: string | null; status: string; desfecho: string | null; silenciado_ate: string | null; motivo_silencio: string | null; escalonamento: number; ocorrencias: number; primeiro_em: string; visto_em: string; tratado_em: string | null; resolvido_em: string | null; horas_restantes: number | null };

/** Módulos que cada perfil enxerga na central (Direção, RH e Leitura veem tudo; os demais, o próprio domínio e o que é deles). */
export function modulosDoPerfil(role: string): string[] | null {
  if (["DIRECAO", "RH", "LEITURA", "DIRETOR_UNIDADE"].includes(role)) return null;
  if (role === "FINANCEIRO") return ["Financeiro", "Folha"];
  if (role === "COMERCIAL") return ["Matrículas", "Atendimento"];
  if (role === "OPERACOES") return ["Operações", "Segurança"];
  return [];
}

export async function listarAlertas(s: Session, escopo: number, filtro: { status?: string; dono?: "eu" | "sem" | null; modulo?: string | null } = {}) {
  const mods = modulosDoPerfil(s.role); const sens = ["DIRECAO", "RH"].includes(s.role);
  const st = filtro.status === "todos" ? null : filtro.status ? [filtro.status] : ["ABERTO"];
  return sql<AlertaRow[]>`SELECT a.id, a.chave, a.escopo, a.unit_id, u.nome AS unidade, a.regra, a.modulo, a.severidade, a.titulo, a.href, a.dono_user_id, us.nome AS dono, a.defeito, a.sla_ate::text, a.status, a.desfecho, a.silenciado_ate::text, a.motivo_silencio, a.escalonamento, a.ocorrencias, a.primeiro_em::text, a.visto_em::text, a.tratado_em::text, a.resolvido_em::text,
      CASE WHEN a.sla_ate IS NULL THEN NULL ELSE (extract(epoch FROM a.sla_ate - now()) / 3600)::float END AS horas_restantes
    FROM alerts a LEFT JOIN units u ON u.id=a.unit_id LEFT JOIN users us ON us.id=a.dono_user_id
    WHERE (a.escopo=${escopo} ${escopo === 0 && s.role === "DIRECAO" ? sql`OR (a.escopo <> 0 AND a.escalonamento >= 2)` : sql``}) ${st ? sql`AND a.status = ANY(${st})` : sql``}
      ${mods === null ? sql`` : sql`AND (a.modulo = ANY(${mods.concat("§")}) OR a.dono_user_id=${s.id})`}
      ${sens ? sql`` : sql`AND NOT (a.modulo = ANY(${MODULOS_SENSIVEIS}))`}
      ${filtro.dono === "eu" ? sql`AND a.dono_user_id=${s.id}` : filtro.dono === "sem" ? sql`AND a.dono_user_id IS NULL` : sql``}
      ${filtro.modulo ? sql`AND a.modulo=${filtro.modulo}` : sql``}
    ORDER BY (a.status='ABERTO') DESC, (a.sla_ate < now()) DESC, (a.severidade='ALTO') DESC, a.sla_ate NULLS LAST, a.id DESC LIMIT 300`;
}
/** Escopo do perfil: diretor(a) de unidade e gestor(a) veem a varredura da própria unidade; os demais, a da rede. */
export const escopoDo = (s: Session) => ["DIRETOR_UNIDADE", "GESTOR"].includes(s.role) && s.unitId ? s.unitId : 0;
/** Os 3 mais críticos (mini-central do Board e do Início). */
export async function maisCriticos(s: Session, n = 3) { return (await listarAlertas(s, escopoDo(s))).slice(0, n); }
export async function ultimaVarredura(escopo: number) { const [r] = await sql<{ at: string; n: number }[]>`SELECT at::text, n FROM alert_sweeps WHERE escopo=${escopo}`; return r ?? null; }
