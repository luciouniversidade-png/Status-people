"use server";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, can, assert, type Role } from "@/lib/auth";
import { audit, str, int, hoje } from "@/lib/utils";
const erroMsg = (e: unknown) => (e instanceof Error ? e.message : "Erro inesperado.");
import { comMensagem } from "@/lib/redirecionar";
import {
  ATUACAO, ALCADAS, ehAlcada, defDoCargo, normalizarTelas, telasDaAtuacao, sincronizarAcessos, sincronizarPorCargo, calcularAcesso, lerPadraoAprovacao, rotuloAtuacao,
  type DefAcesso, type AcessoUsuario, type Substituicao, type LinhaAcesso,
} from "@/lib/acesso";

const go = (b: string, k: "ok" | "erro", m: string, hash = "") => comMensagem(b, k, m, hash);
const CARGO = (id: number) => `/configuracoes/acessos/cargo/${id}`;
const USUARIO = (id: number) => `/configuracoes/acessos/usuario/${id}`;

/** Lê do formulário a definição de acesso (atuação + telas marcadas + aprovações). */
function lerDef(fd: FormData): DefAcesso {
  const at = str(fd, "atuacao"); if (!(at in ATUACAO)) throw new Error("Escolha a atuação.");
  const atuacao = at as Role;
  const disp = new Set(telasDaAtuacao(atuacao).map(t => t.chave));
  const marcadas = fd.getAll("telas").map(String).filter(k => disp.has(k));
  const telas = normalizarTelas(atuacao, marcadas);
  const aprova = str(fd, "seguePadrao") === "1" ? null : fd.getAll("aprova").map(String).filter(ehAlcada);
  const dTxt = str(fd, "descontoPct").replace(",", "."); const descontoPct = dTxt === "" ? null : Number(dTxt);
  if (descontoPct !== null && (!Number.isFinite(descontoPct) || descontoPct < 0 || descontoPct > 100)) throw new Error("Alçada de desconto: use um percentual de 0 a 100 (ou deixe vazio para o padrão da atuação).");
  return { atuacao, telas, aprova, descontoPct };
}

/**
 * Trava de segurança: depois da mudança, alguém ativo continua podendo configurar o sistema (Configurações e Acesso por cargo)?
 * Simula o acesso de todos com a definição nova — evita trancar a rede para fora do próprio sistema.
 */
async function aindaHaQuemConfigure(mudanca: { positionId?: number; def?: DefAcesso | null; userId?: number; acesso?: AcessoUsuario | null; substituicao?: Substituicao | null }) {
  const rows = await sql<LinhaAcesso[]>`
    SELECT u.id, u.nome, u.email, u.role, u.unit_id, u.employee_id, u.ativo, u.acesso, u.substituicao,
           e.unit_id AS e_unit, e.situacao AS e_sit, e.position_id AS e_pos, p.nome AS p_nome, p.acesso AS p_acesso, p.familia AS p_familia,
           ps.id AS s_pos, ps.nome AS s_nome, ps.acesso AS s_acesso, ps.familia AS s_familia
    FROM users u LEFT JOIN employees e ON e.id = u.employee_id LEFT JOIN positions p ON p.id = e.position_id
    LEFT JOIN positions ps ON ps.id = CASE WHEN jsonb_typeof(u.substituicao->'positionId') = 'number' THEN (u.substituicao->>'positionId')::int END
    WHERE u.ativo`;
  const padrao = await lerPadraoAprovacao(); let n = 0;
  for (const r of rows) {
    const x = { ...r };
    if (mudanca.positionId && mudanca.def !== undefined) { if (x.e_pos === mudanca.positionId) x.p_acesso = mudanca.def; if (x.s_pos === mudanca.positionId) x.s_acesso = mudanca.def; }
    if (mudanca.userId === x.id) { if (mudanca.acesso !== undefined) x.acesso = mudanca.acesso; if (mudanca.substituicao !== undefined) x.substituicao = mudanca.substituicao; }
    const ef = calcularAcesso(x, padrao); if (ef.bloqueio) continue;
    const configura = ef.role === "RH" || ef.role === "DIRECAO";
    const ve = !ef.telas || (ef.telas.includes("/configuracoes") && ef.telas.includes("/configuracoes/acessos"));
    if (configura && ve) n++;
  }
  return n > 0;
}

/** Salva o acesso do cargo: vale na próxima tela de cada pessoa do cargo. */
export async function salvarAcessoCargo(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; let msg = "";
  try {
    assert(can.configurar(s), "Só Direção e RH configuram o acesso dos cargos.");
    const [p] = await sql<{ id: number; nome: string; acesso: unknown; familia: string | null }[]>`SELECT id, nome, acesso, familia FROM positions WHERE id=${id}`; if (!p) throw new Error("Cargo não encontrado.");
    const antes = defDoCargo(p); const def: DefAcesso = { ...lerDef(fd), atualizadoEm: hoje(), atualizadoPor: s.nome, sugerida: false };
    if (!(await aindaHaQuemConfigure({ positionId: id, def }))) throw new Error("Com esta mudança ninguém ativo conseguiria configurar o sistema (Configurações e Acesso por cargo). Mantenha a atuação Direção ou RH com essas telas em pelo menos um acesso.");
    await sql`UPDATE positions SET acesso=${JSON.stringify(def)}::jsonb WHERE id=${id}`;
    await audit(s, "acesso do cargo", "positions", id, antes, def);
    await sincronizarPorCargo(id);
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM users u JOIN employees e ON e.id=u.employee_id WHERE e.position_id=${id} AND u.ativo AND u.acesso IS NULL`;
    msg = `Acesso do cargo ${p.nome} salvo: ${rotuloAtuacao(def.atuacao)}, ${def.telas ? `${def.telas.length} de ${telasDaAtuacao(def.atuacao).length} telas` : "todas as telas da atuação"}, ${def.aprova ? `${def.aprova.length} aprovação(ões) marcadas` : "aprovações no padrão da atuação"}. Vale para ${n} pessoa(s) na próxima tela.`;
  } catch (e) { redirect(go(CARGO(id), "erro", erroMsg(e))); }
  redirect(go(CARGO(id), "ok", msg));
}

/** Copia o acesso (atuação, telas e aprovações) de outro cargo. */
export async function copiarAcessoCargo(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const de = int(fd, "origemId") ?? 0; let msg = "";
  try {
    assert(can.configurar(s)); assert(id !== de, "Escolha outro cargo para copiar.");
    const [p] = await sql<{ id: number; nome: string; acesso: unknown; familia: string | null }[]>`SELECT id, nome, acesso, familia FROM positions WHERE id=${id}`;
    const [o] = await sql<{ id: number; nome: string; acesso: unknown; familia: string | null }[]>`SELECT id, nome, acesso, familia FROM positions WHERE id=${de}`;
    if (!p || !o) throw new Error("Cargo não encontrado.");
    const od = defDoCargo(o); const def: DefAcesso = { atuacao: od.atuacao, telas: od.telas, aprova: od.aprova, descontoPct: od.descontoPct ?? null, atualizadoEm: hoje(), atualizadoPor: `${s.nome} (cópia de ${o.nome})` , sugerida: false };
    if (!(await aindaHaQuemConfigure({ positionId: id, def }))) throw new Error("Com esta cópia ninguém ativo conseguiria configurar o sistema.");
    await sql`UPDATE positions SET acesso=${JSON.stringify(def)}::jsonb WHERE id=${id}`;
    await audit(s, "acesso do cargo (cópia)", "positions", id, defDoCargo(p), { ...def, de: o.nome });
    await sincronizarPorCargo(id); msg = `${p.nome} agora tem o mesmo acesso de ${o.nome}.`;
  } catch (e) { redirect(go(CARGO(id), "erro", erroMsg(e))); }
  redirect(go(CARGO(id), "ok", msg));
}

/** Exceção individual (pessoa com ficha): atuação diferente da do cargo, sempre com motivo. */
export async function salvarExcecao(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; let msg = "";
  try {
    assert(can.configurar(s));
    const [u] = await sql<{ id: number; nome: string; employee_id: number | null; acesso: AcessoUsuario | null; e_unit: number | null }[]>`SELECT u.id, u.nome, u.employee_id, u.acesso, e.unit_id AS e_unit FROM users u LEFT JOIN employees e ON e.id=u.employee_id WHERE u.id=${id}`;
    if (!u) throw new Error("Acesso não encontrado."); if (!u.employee_id) throw new Error("Conta sem ficha: o acesso é definido na própria conta.");
    const def = lerDef(fd); const motivo = str(fd, "motivo"); if (motivo.length < 10) throw new Error("Escreva o motivo da exceção (mínimo 10 caracteres).");
    const unitId = ATUACAO[def.atuacao].alcance === "UNIDADE" ? (int(fd, "unitId") ?? u.e_unit) : null;
    const acesso: AcessoUsuario = { atuacao: def.atuacao, telas: def.telas, aprova: def.aprova, descontoPct: def.descontoPct, unitId, motivo, em: hoje(), por: s.nome };
    if (!(await aindaHaQuemConfigure({ userId: id, acesso }))) throw new Error("Com esta exceção ninguém ativo conseguiria configurar o sistema.");
    await sql`UPDATE users SET acesso=${JSON.stringify(acesso)}::jsonb WHERE id=${id}`;
    await audit(s, "exceção de acesso", "users", id, u.acesso, acesso);
    await sincronizarAcessos([id]); msg = `Exceção registrada para ${u.nome}: ${rotuloAtuacao(def.atuacao)}. Ela fica destacada na lista e em Acesso por cargo até alguém voltar ao acesso do cargo.`;
  } catch (e) { redirect(go(USUARIO(id), "erro", erroMsg(e))); }
  redirect(go(USUARIO(id), "ok", msg));
}

/** Tira a exceção: a pessoa volta ao acesso do cargo da ficha. */
export async function voltarAoCargo(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0;
  try {
    assert(can.configurar(s));
    const [u] = await sql<{ acesso: AcessoUsuario | null; employee_id: number | null }[]>`SELECT acesso, employee_id FROM users WHERE id=${id}`; if (!u?.employee_id) throw new Error("Só para acesso vinculado a uma ficha.");
    if (!(await aindaHaQuemConfigure({ userId: id, acesso: null }))) throw new Error("Voltar ao cargo tiraria o último acesso que configura o sistema.");
    await sql`UPDATE users SET acesso=NULL WHERE id=${id}`; await audit(s, "acesso volta ao cargo", "users", id, u.acesso, null); await sincronizarAcessos([id]);
  } catch (e) { redirect(go(USUARIO(id), "erro", erroMsg(e))); }
  redirect(go(USUARIO(id), "ok", "Exceção encerrada: o acesso volta a ser o do cargo da ficha."));
}

/** Telas e aprovações de uma conta sem ficha (a atuação fica no cadastro da conta). */
export async function salvarAcessoConta(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0;
  try {
    assert(can.configurar(s));
    const [u] = await sql<{ role: Role; employee_id: number | null; acesso: AcessoUsuario | null }[]>`SELECT role, employee_id, acesso FROM users WHERE id=${id}`;
    if (!u) throw new Error("Acesso não encontrado."); if (u.employee_id) throw new Error("Esta conta tem ficha: o acesso vem do cargo (ou de uma exceção).");
    fd.set("atuacao", u.role); const def = lerDef(fd);
    const acesso: AcessoUsuario | null = def.telas || def.aprova || def.descontoPct !== null ? { telas: def.telas, aprova: def.aprova, descontoPct: def.descontoPct, motivo: str(fd, "motivo") || u.acesso?.motivo || null, em: hoje(), por: s.nome } : null;
    if (!(await aindaHaQuemConfigure({ userId: id, acesso }))) throw new Error("Com esta mudança ninguém ativo conseguiria configurar o sistema.");
    await sql`UPDATE users SET acesso=${acesso ? JSON.stringify(acesso) : null}::jsonb WHERE id=${id}`; await audit(s, "acesso da conta sem ficha", "users", id, u.acesso, acesso); await sincronizarAcessos([id]);
  } catch (e) { redirect(go(USUARIO(id), "erro", erroMsg(e))); }
  redirect(go(USUARIO(id), "ok", "Acesso da conta salvo."));
}

/** Substituição temporária: por um período a pessoa recebe também o acesso de outro cargo (férias, licença, vaga em aberto). */
export async function salvarSubstituicao(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; let msg = "";
  try {
    assert(can.configurar(s));
    const positionId = int(fd, "positionId"); const ate = str(fd, "ate"); const motivo = str(fd, "motivo");
    const [u] = await sql<{ nome: string; employee_id: number | null; substituicao: Substituicao | null; e_pos: number | null }[]>`SELECT u.nome, u.employee_id, u.substituicao, e.position_id AS e_pos FROM users u LEFT JOIN employees e ON e.id=u.employee_id WHERE u.id=${id}`;
    if (!u) throw new Error("Acesso não encontrado."); if (!u.employee_id) throw new Error("Substituição é para quem tem ficha (o acesso volta sozinho ao do cargo na data de fim).");
    if (!positionId) throw new Error("Escolha o cargo substituído."); if (positionId === u.e_pos) throw new Error("A pessoa já tem este cargo.");
    const [p] = await sql<{ nome: string }[]>`SELECT nome FROM positions WHERE id=${positionId}`; if (!p) throw new Error("Cargo não encontrado.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ate) || ate < hoje()) throw new Error("Informe a data de fim (hoje ou depois).");
    const lim = new Date(); lim.setUTCDate(lim.getUTCDate() + 366); if (ate > lim.toISOString().slice(0, 10)) throw new Error("Substituição de no máximo 1 ano — além disso, ajuste o cargo na ficha.");
    if (motivo.length < 5) throw new Error("Escreva o motivo da substituição (ex.: férias da titular).");
    const sub: Substituicao = { positionId, ate, motivo, desde: hoje(), por: s.nome };
    await sql`UPDATE users SET substituicao=${JSON.stringify(sub)}::jsonb WHERE id=${id}`; await audit(s, "substituição de acesso", "users", id, u.substituicao, sub); await sincronizarAcessos([id]);
    msg = `${u.nome} recebe também o acesso de ${p.nome} até ${ate.split("-").reverse().join("/")}. No dia seguinte o acesso volta sozinho ao do cargo.`;
  } catch (e) { redirect(go(USUARIO(id), "erro", erroMsg(e))); }
  redirect(go(USUARIO(id), "ok", msg));
}
export async function encerrarSubstituicao(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0;
  try {
    assert(can.configurar(s)); const [u] = await sql<{ substituicao: Substituicao | null }[]>`SELECT substituicao FROM users WHERE id=${id}`; if (!u?.substituicao) throw new Error("Sem substituição registrada.");
    if (!(await aindaHaQuemConfigure({ userId: id, substituicao: null }))) throw new Error("Encerrar agora tiraria o último acesso que configura o sistema.");
    await sql`UPDATE users SET substituicao=NULL WHERE id=${id}`; await audit(s, "substituição encerrada", "users", id, u.substituicao, null); await sincronizarAcessos([id]);
  } catch (e) { redirect(go(USUARIO(id), "erro", erroMsg(e))); }
  redirect(go(USUARIO(id), "ok", "Substituição encerrada: o acesso volta ao do cargo."));
}

/** Recalcula o acesso de todos agora (a rotina diária também faz). */
export async function sincronizarTudo() {
  const s = await requireSession(); let msg = "";
  try { assert(can.configurar(s)); const r = await sincronizarAcessos(); await audit(s, "recalcular acessos", "users", null, null, r); msg = `Acessos recalculados: ${r.mudaram} atualizado(s)${r.encerrados ? `, ${r.encerrados} encerrado(s) por desligamento` : ""}.`; }
  catch (e) { redirect(go("/configuracoes/acessos", "erro", erroMsg(e))); }
  redirect(go("/configuracoes/acessos", "ok", msg));
}

/** Aprovações em lote por cargo (matriz “quem aprova o quê”): grava, em cada cargo, a lista marcada. */
export async function salvarAprovacoesCargos(fd: FormData) {
  const s = await requireSession(); let msg = "";
  try {
    assert(can.configurar(s));
    const cargos = await sql<{ id: number; nome: string; acesso: unknown; familia: string | null }[]>`SELECT id, nome, acesso, familia FROM positions ORDER BY id`;
    let n = 0; const padrao = await lerPadraoAprovacao();
    for (const c of cargos) {
      if (str(fd, `c_${c.id}`) !== "1") continue; // só os cargos que estavam no formulário
      const d = defDoCargo(c); const marcadas = ALCADAS.map(a => a.chave).filter(k => str(fd, `a_${c.id}_${k}`) === "1");
      const dTxt = str(fd, `p_${c.id}`).replace(",", "."); const descontoPct = dTxt === "" ? null : Number(dTxt);
      if (descontoPct !== null && (!Number.isFinite(descontoPct) || descontoPct < 0 || descontoPct > 100)) throw new Error(`${c.nome}: alçada de desconto de 0 a 100%.`);
      const pd = ALCADAS.map(a => a.chave).filter(k => (padrao[k] ?? []).includes(d.atuacao));
      const aprova = marcadas.length === pd.length && marcadas.every(k => pd.includes(k)) ? null : marcadas;
      if (JSON.stringify(aprova) === JSON.stringify(d.aprova) && (descontoPct ?? null) === (d.descontoPct ?? null)) continue;
      const def: DefAcesso = { ...d, aprova, descontoPct, atualizadoEm: hoje(), atualizadoPor: s.nome };
      await sql`UPDATE positions SET acesso=${JSON.stringify(def)}::jsonb WHERE id=${c.id}`; await audit(s, "aprovações do cargo", "positions", c.id, d, def); await sincronizarPorCargo(c.id); n++;
    }
    msg = n ? `Aprovações salvas em ${n} cargo(s).` : "Nada mudou.";
  } catch (e) { redirect(go("/configuracoes/acessos?aba=aprovacoes", "erro", erroMsg(e))); }
  redirect(go("/configuracoes/acessos?aba=aprovacoes", "ok", msg));
}
