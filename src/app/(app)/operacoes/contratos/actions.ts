"use server";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, assert, scopeUnit, type Session } from "@/lib/auth";
import { audit, str, strOrNull, int, hoje } from "@/lib/utils";
import { RENOVACAO, TIPO_LICENCA, podeContratos, podeLicencas, PERFIS_CONTRATO, PERFIS_LICENCA } from "@/lib/contratos";
import { comMensagem } from "@/lib/redirecionar";

const go = (b: string, k: "ok" | "erro", msg: string) => comMensagem(b, k, msg);
const iso = (v: string | null, rot: string) => { if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`${rot}: data inválida.`); return v; };
/** Valor em reais digitado do jeito brasileiro: "2.400,00", "2400", "R$ 2.400" ou "2400.5". */
const dinheiro = (fd: FormData, k: string, rot: string) => { const t = str(fd, k).replace(/[R$\s]/g, ""); if (!t) return null; const v = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : /^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, "") : t); if (!Number.isFinite(v) || v < 0) throw new Error(`${rot}: valor inválido.`); return String(Math.round(v * 100) / 100); };
/** Responsável precisa poder abrir o registro (contrato: Direção, Financeiro, Operações, RH, diretor da unidade; licença: sem o Financeiro). */
async function validarResp(id: number | null, unitId: number | null, tipo: "contrato" | "licenca") {
  if (!id) return null; const [u] = await sql<{ role: string; unit_id: number | null }[]>`SELECT role, unit_id FROM users WHERE id=${id} AND ativo`;
  const perfis = tipo === "contrato" ? PERFIS_CONTRATO : PERFIS_LICENCA;
  if (!u || !perfis.includes(u.role) || (u.unit_id !== null && unitId !== null && u.unit_id !== unitId) || (u.role === "DIRETOR_UNIDADE" && unitId === null)) throw new Error("Responsável inválido: escolha alguém que acompanha contratos/licenças desta unidade."); return id;
}
const unidadeDoForm = (s: Session, fd: FormData) => { const u = scopeUnit(s); const x = int(fd, "unitId"); if (u !== null) { if (x !== null && x !== u) throw new Error("Sem acesso a esta unidade."); return u; } return x; };

export async function salvarContrato(fd: FormData) {
  const s = await requireSession(); let id = int(fd, "id") ?? 0; const novo = !id;
  try {
    assert(podeContratos(s), "Sem permissão para contratos.");
    const [sup] = await sql<{ id: number; ativo: boolean }[]>`SELECT id, ativo FROM suppliers WHERE id=${int(fd, "supplierId") ?? 0}`; if (!sup) throw new Error("Escolha o fornecedor (cadastre em Fornecedores).");
    const unitId = unidadeDoForm(s, fd); if (unitId !== null) { const [u] = await sql`SELECT 1 FROM units WHERE id=${unitId}`; if (!u) throw new Error("Unidade inválida."); }
    if (s.role === "DIRETOR_UNIDADE" && unitId === null) throw new Error("Diretor(a) de unidade cadastra só contratos da própria unidade.");
    const objeto = str(fd, "objeto"); if (objeto.length < 3) throw new Error("Descreva o objeto do contrato.");
    const inicio = iso(strOrNull(fd, "inicio"), "Início"); if (!inicio) throw new Error("Informe o início."); const fim = iso(strOrNull(fd, "fim"), "Fim"); if (fim && fim < inicio) throw new Error("O fim é anterior ao início.");
    const renovacao = str(fd, "renovacao") || "MANUAL"; if (!RENOVACAO[renovacao]) throw new Error("Tipo de renovação inválido.");
    const aviso = Number(str(fd, "avisoPrevioDias") || "30"); if (!Number.isInteger(aviso) || aviso < 0 || aviso > 365) throw new Error("Aviso prévio: 0 a 365 dias.");
    const d = { supplierId: sup.id, unitId, objeto, numero: strOrNull(fd, "numero"), valorMensal: dinheiro(fd, "valorMensal", "Valor mensal"), valorTotal: dinheiro(fd, "valorTotal", "Valor total"), inicio, fim, renovacao, aviso, indice: strOrNull(fd, "reajusteIndice"), reajuste: iso(strOrNull(fd, "proximoReajuste"), "Próximo reajuste"), resp: await validarResp(int(fd, "responsavelUserId"), unitId, "contrato"), obs: strOrNull(fd, "obs") };
    if (id) {
      const [c] = await sql<{ unit_id: number | null; status: string }[]>`SELECT unit_id, status FROM contracts WHERE id=${id}`; if (!c) throw new Error("Contrato não encontrado"); const u = scopeUnit(s); if (u !== null && c.unit_id !== u) throw new Error("Sem acesso a este contrato."); if (c.status !== "VIGENTE") throw new Error("Contrato encerrado não se edita.");
      await sql`UPDATE contracts SET supplier_id=${d.supplierId}, unit_id=${d.unitId}, objeto=${d.objeto}, numero=${d.numero}, valor_mensal=${d.valorMensal}, valor_total=${d.valorTotal}, inicio=${d.inicio}, fim=${d.fim}, renovacao=${d.renovacao}, aviso_previo_dias=${d.aviso}, reajuste_indice=${d.indice}, proximo_reajuste=${d.reajuste}, responsavel_user_id=${d.resp}, obs=${d.obs}, updated_at=now() WHERE id=${id}`;
    } else { const [r] = await sql<{ id: number }[]>`INSERT INTO contracts (supplier_id, unit_id, objeto, numero, valor_mensal, valor_total, inicio, fim, renovacao, aviso_previo_dias, reajuste_indice, proximo_reajuste, responsavel_user_id, obs, created_by) VALUES (${d.supplierId}, ${d.unitId}, ${d.objeto}, ${d.numero}, ${d.valorMensal}, ${d.valorTotal}, ${d.inicio}, ${d.fim}, ${d.renovacao}, ${d.aviso}, ${d.indice}, ${d.reajuste}, ${d.resp}, ${d.obs}, ${s.id}) RETURNING id`; id = r.id; }
    await audit(s, novo ? "cadastrar contrato" : "editar contrato", "contracts", id, null, { objeto, fim, renovacao });
  } catch (e) { redirect(go(novo ? "/operacoes/contratos" : `/operacoes/contratos/${id}`, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(`/operacoes/contratos/${id}`, "ok", "Contrato salvo."));
}
/** Renovar: novo período (o histórico fica no contrato anterior, encerrado), mantendo fornecedor, objeto e condições. */
export async function renovarContrato(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; let nid = 0;
  try {
    assert(podeContratos(s), "Sem permissão para contratos.");
    const [c] = await sql<{ id: number; unit_id: number | null; status: string; fim: string | null; supplier_id: number; objeto: string; numero: string | null; valor_mensal: string | null; renovacao: string; aviso_previo_dias: number; reajuste_indice: string | null; responsavel_user_id: number | null }[]>`SELECT id, unit_id, status, fim::text, supplier_id, objeto, numero, valor_mensal::text, renovacao, aviso_previo_dias, reajuste_indice, responsavel_user_id FROM contracts WHERE id=${id}`;
    if (!c || c.status !== "VIGENTE") throw new Error("Só contratos vigentes são renovados."); const u = scopeUnit(s); if (u !== null && c.unit_id !== u) throw new Error("Sem acesso a este contrato.");
    const inicio = iso(strOrNull(fd, "inicio"), "Início") ?? (c.fim ? new Date(Date.parse(c.fim + "T00:00:00Z") + 86400000).toISOString().slice(0, 10) : hoje()); const fim = iso(strOrNull(fd, "fim"), "Fim"); if (!fim || fim <= inicio) throw new Error("Informe o novo fim (depois do início).");
    const valor = dinheiro(fd, "valorMensal", "Valor mensal") ?? c.valor_mensal;
    nid = await sql.begin(async tx => { await tx`UPDATE contracts SET status='ENCERRADO', obs=concat_ws(E'\n', obs, ${`Renovado em ${new Date().toLocaleDateString("pt-BR")}`}::text), updated_at=now() WHERE id=${id}`;
      const [n] = await tx<{ id: number }[]>`INSERT INTO contracts (supplier_id, unit_id, objeto, numero, valor_mensal, inicio, fim, renovacao, aviso_previo_dias, reajuste_indice, proximo_reajuste, responsavel_user_id, renovado_de, obs, created_by) VALUES (${c.supplier_id}, ${c.unit_id}, ${c.objeto}, ${strOrNull(fd, "numero") ?? c.numero}, ${valor}, ${inicio}, ${fim}, ${c.renovacao}, ${c.aviso_previo_dias}, ${c.reajuste_indice}, ${iso(strOrNull(fd, "proximoReajuste"), "Próximo reajuste")}, ${c.responsavel_user_id}, ${id}, ${strOrNull(fd, "obs")}, ${s.id}) RETURNING id`; return n.id; });
    await audit(s, "renovar contrato", "contracts", nid, { anterior: id }, { inicio, fim, valor });
  } catch (e) { redirect(go(`/operacoes/contratos/${id}`, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(`/operacoes/contratos/${nid}`, "ok", "Contrato renovado: novo período criado; o anterior foi encerrado."));
}
export async function encerrarContrato(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0;
  try {
    assert(podeContratos(s), "Sem permissão para contratos."); const [c] = await sql<{ unit_id: number | null; status: string }[]>`SELECT unit_id, status FROM contracts WHERE id=${id}`; if (!c || c.status !== "VIGENTE") throw new Error("Contrato não está vigente.");
    const u = scopeUnit(s); if (u !== null && c.unit_id !== u) throw new Error("Sem acesso a este contrato.");
    const st = str(fd, "status") === "CANCELADO" ? "CANCELADO" : "ENCERRADO"; const motivo = str(fd, "motivo"); if (motivo.length < 5) throw new Error("Registre o motivo (ex.: não renovado, rescisão por desempenho).");
    await sql`UPDATE contracts SET status=${st}, obs=concat_ws(E'\n', obs, ${`${st === "CANCELADO" ? "Cancelado" : "Encerrado"}: ${motivo}`}::text), updated_at=now() WHERE id=${id}`; await audit(s, "encerrar contrato", "contracts", id, null, { st, motivo });
  } catch (e) { redirect(go(`/operacoes/contratos/${id}`, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(`/operacoes/contratos/${id}`, "ok", "Contrato encerrado."));
}

// ---------- Licenças, alvarás e laudos ----------
export async function salvarLicenca(fd: FormData) {
  const s = await requireSession(); let id = int(fd, "id") ?? 0; const novo = !id;
  try {
    assert(podeLicencas(s), "Sem permissão para licenças.");
    const unitId = unidadeDoForm(s, fd); if (!unitId) throw new Error("Escolha a unidade."); const [u] = await sql`SELECT 1 FROM units WHERE id=${unitId}`; if (!u) throw new Error("Unidade inválida.");
    const tipo = str(fd, "tipo"); if (!TIPO_LICENCA[tipo]) throw new Error("Escolha o tipo.");
    const emissao = iso(strOrNull(fd, "emissao"), "Emissão"); const validade = iso(strOrNull(fd, "validade"), "Validade"); if (emissao && validade && validade < emissao) throw new Error("Validade anterior à emissão.");
    const ant = Number(str(fd, "antecedenciaDias") || "60"); if (!Number.isInteger(ant) || ant < 1 || ant > 365) throw new Error("Antecedência do aviso: 1 a 365 dias.");
    const dispensar = str(fd, "dispensar") === "1"; const obs = strOrNull(fd, "obs"); if (dispensar && (!obs || obs.length < 5)) throw new Error("Explique por que não se aplica à unidade.");
    const resp = await validarResp(int(fd, "responsavelUserId"), unitId, "licenca");
    if (id) {
      const [l] = await sql<{ unit_id: number; status: string }[]>`SELECT unit_id, status FROM licenses WHERE id=${id}`; if (!l) throw new Error("Registro não encontrado"); const sc = scopeUnit(s); if (sc !== null && l.unit_id !== sc) throw new Error("Sem acesso a esta unidade."); if (l.status === "SUBSTITUIDA") throw new Error("Registro substituído (histórico) não se edita.");
      await sql`UPDATE licenses SET unit_id=${unitId}, tipo=${tipo}, nome=${strOrNull(fd, "nome")}, orgao=${strOrNull(fd, "orgao")}, numero=${strOrNull(fd, "numero")}, emissao=${emissao}, validade=${validade}, antecedencia_dias=${ant}, responsavel_user_id=${resp}, status=${dispensar ? "DISPENSADA" : "ATIVA"}, obs=${obs}, updated_at=now() WHERE id=${id}`;
    } else { const [r] = await sql<{ id: number }[]>`INSERT INTO licenses (unit_id, tipo, nome, orgao, numero, emissao, validade, antecedencia_dias, responsavel_user_id, status, obs, created_by) VALUES (${unitId}, ${tipo}, ${strOrNull(fd, "nome")}, ${strOrNull(fd, "orgao")}, ${strOrNull(fd, "numero")}, ${emissao}, ${validade}, ${ant}, ${resp}, ${dispensar ? "DISPENSADA" : "ATIVA"}, ${obs}, ${s.id}) RETURNING id`; id = r.id; }
    await audit(s, novo ? "cadastrar licença" : "editar licença", "licenses", id, null, { tipo, unitId, validade, dispensar });
  } catch (e) { redirect(go(novo ? "/operacoes/licencas" : `/operacoes/licencas/${id}`, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(`/operacoes/licencas/${id}`, "ok", "Registro salvo. Anexe a evidência (documento ou laudo) abaixo."));
}
/** Renovação: novo registro com a nova validade; o anterior fica como histórico (substituído). */
export async function renovarLicenca(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; let nid = 0;
  try {
    assert(podeLicencas(s), "Sem permissão para licenças.");
    const [l] = await sql<{ id: number; unit_id: number; tipo: string; nome: string | null; orgao: string | null; antecedencia_dias: number; responsavel_user_id: number | null; status: string; validade: string | null }[]>`SELECT id, unit_id, tipo, nome, orgao, antecedencia_dias, responsavel_user_id, status, validade::text FROM licenses WHERE id=${id}`;
    if (!l || l.status !== "ATIVA") throw new Error("Só registros ativos são renovados."); const sc = scopeUnit(s); if (sc !== null && l.unit_id !== sc) throw new Error("Sem acesso a esta unidade.");
    const validade = iso(strOrNull(fd, "validade"), "Validade"); if (!validade || validade <= hoje()) throw new Error("Informe a nova validade (futura).");
    nid = await sql.begin(async tx => { await tx`UPDATE licenses SET status='SUBSTITUIDA', updated_at=now() WHERE id=${id}`;
      const [n] = await tx<{ id: number }[]>`INSERT INTO licenses (unit_id, tipo, nome, orgao, numero, emissao, validade, antecedencia_dias, responsavel_user_id, renovado_de, obs, created_by) VALUES (${l.unit_id}, ${l.tipo}, ${l.nome}, ${l.orgao}, ${strOrNull(fd, "numero")}, ${iso(strOrNull(fd, "emissao"), "Emissão") ?? hoje()}, ${validade}, ${l.antecedencia_dias}, ${l.responsavel_user_id}, ${id}, ${strOrNull(fd, "obs")}, ${s.id}) RETURNING id`; return n.id; });
    await audit(s, "renovar licença", "licenses", nid, { anterior: id, validade: l.validade }, { validade });
  } catch (e) { redirect(go(`/operacoes/licencas/${id}`, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(`/operacoes/licencas/${nid}`, "ok", "Renovada. Anexe o novo documento."));
}
