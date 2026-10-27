"use server";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, assert, scopeUnit } from "@/lib/auth";
import { audit, str, int, hoje, caminhoSeguro, getSettings, addDays } from "@/lib/utils";
import { notificar } from "@/lib/comunicacao";
import { prazosContratuais, decidePrazo, DECISAO_LABEL, TIPO_PRAZO, type TipoPrazo, type Prazo } from "@/lib/contratos-prazo";

const go = (b: string, k: "ok" | "erro", msg: string) => `${b}${b.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(msg)}`;
const msgErro = (e: unknown) => e instanceof Error ? e.message : "Erro inesperado.";
const dataOk = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d + "T00:00:00Z"));
const br = (d: string) => d.split("-").reverse().join("/");
const BASE = "/contratos-prazo";

async function prazoAtual(unitId: number, empId: number, tipo: string, etapa: number): Promise<Prazo> {
  const p = (await prazosContratuais({ unitId })).find(x => x.employee_id === empId && x.tipo === tipo && x.etapa === etapa);
  if (!p) throw new Error("Este prazo não está mais em aberto (já decidido ou fora do período)."); return p;
}
async function pessoa(id: number) {
  const [e] = await sql<{ id: number; unit_id: number; gestor_id: number | null; vinculo: string; admissao: string; situacao: string }[]>`SELECT id, unit_id, gestor_id, vinculo, admissao::text, situacao FROM employees WHERE id=${id}`;
  return e;
}

/** Decisão sobre o prazo em curso: prorrogar, efetivar, encerrar no prazo ou renovar o TCE — RH, Direção ou direção da unidade, com motivo e trilha. */
export async function decidirPrazo(fd: FormData) {
  const s = await requireSession(); const b = caminhoSeguro(str(fd, "voltar"), BASE); let msg = "";
  try {
    if (!decidePrazo(s)) { await audit(s, "acesso negado: decidir contrato com prazo", "employment_terms", null, null, { papel: s.role }); throw new Error("A decisão é do RH, da Direção ou da direção da unidade — o gestor registra a recomendação."); }
    const empId = int(fd, "employeeId") ?? 0; const tipo = str(fd, "tipo") as TipoPrazo; const etapa = int(fd, "etapa") ?? 0; const decisao = str(fd, "decisao"); const motivo = str(fd, "motivo");
    const e = await pessoa(empId); assert(!!e, "Colaborador não encontrado."); const esc = scopeUnit(s); assert(esc === null || esc === e.unit_id, "Colaborador de outra unidade.");
    const atual = await prazoAtual(e.unit_id, empId, tipo, etapa); assert(atual.opcoes.includes(decisao), "Escolha uma das decisões possíveis para este prazo.");
    assert(motivo.length >= 5, "Registre o motivo (ex.: avaliação de experiência, desempenho, necessidade da escola).");
    const cfg = await getSettings(); const c = cfg.contratosPrazo; let novaData: string | null = null;
    if (tipo === "ESTAGIO" && decisao === "RENOVAR") {
      novaData = str(fd, "novaData"); assert(dataOk(novaData), "Informe o novo término do TCE."); assert(novaData > atual.vence_em, "O novo término vem depois do atual.");
      assert(!!atual.limite && novaData <= atual.limite, `O estágio não passa de ${Number(c.estagioMaxMeses ?? 24)} meses na mesma escola (limite ${atual.limite ? br(atual.limite) : ""}), exceto pessoa com deficiência.`);
    }
    if (tipo === "TEMPORARIO" && decisao === "PRORROGAR") {
      const legal2 = addDays(e.admissao, Number(c.temporarioDias ?? 180) + Number(c.temporarioProrrogacaoDias ?? 90) - 1); const pedida = str(fd, "novaData");
      novaData = pedida ? pedida : legal2; assert(dataOk(novaData) && novaData > atual.vence_em && novaData <= legal2, `A prorrogação do temporário vai até ${br(legal2)} no máximo.`);
    }
    await sql`INSERT INTO employment_terms (employee_id, tipo, etapa, vence_em, decisao, motivo, nova_data, decidido_por, decidido_em) VALUES (${empId}, ${tipo}, ${etapa}, ${atual.vence_em}, ${decisao}, ${motivo.slice(0, 1000)}, ${novaData}, ${s.id}, now())
      ON CONFLICT (employee_id, tipo, etapa) DO UPDATE SET vence_em=EXCLUDED.vence_em, decisao=EXCLUDED.decisao, motivo=EXCLUDED.motivo, nova_data=EXCLUDED.nova_data, decidido_por=EXCLUDED.decidido_por, decidido_em=EXCLUDED.decidido_em`;
    if (novaData) await sql`UPDATE employees SET termino_contrato=${novaData}, updated_at=now() WHERE id=${empId}`;
    await audit(s, "decidir contrato com prazo", "employment_terms", empId, { tipo, etapa, venceEm: atual.vence_em, recomendacao: atual.recomendacao }, { decisao, motivo, novaData });
    if (e.gestor_id) { const [g] = await sql<{ id: number }[]>`SELECT id FROM users WHERE employee_id=${e.gestor_id} AND ativo LIMIT 1`; if (g && g.id !== s.id) await notificar([g.id], "Decisão registrada: contrato com prazo da sua equipe", `${TIPO_PRAZO[tipo]} · ${DECISAO_LABEL[decisao]}`, `${BASE}?gestor=${e.gestor_id}`, "INFO", `prazo:${empId}:${tipo}:${etapa}`); }
    msg = decisao === "ENCERRAR" ? `Decisão registrada (encerrar em ${br(atual.vence_em)}). Abra o desligamento em Admissões e desligamentos para o checklist e o exame demissional.`
      : decisao === "EFETIVAR" && tipo !== "EXPERIENCIA" ? "Decisão registrada (efetivar). A contratação CLT é um novo vínculo: abra a admissão em Admissões e desligamentos."
      : decisao === "PRORROGAR" && tipo === "EXPERIENCIA" ? "Prorrogação registrada — o fim da experiência entra no acompanhamento." : `Decisão registrada: ${DECISAO_LABEL[decisao].toLowerCase()}.`;
  } catch (e) { redirect(go(b, "erro", msgErro(e))); }
  redirect(go(b, "ok", msg));
}

/** Recomendação do gestor direto (ou de quem decide) antes do vencimento. */
export async function recomendarPrazo(fd: FormData) {
  const s = await requireSession(); const b = caminhoSeguro(str(fd, "voltar"), BASE);
  try {
    const empId = int(fd, "employeeId") ?? 0; const tipo = str(fd, "tipo") as TipoPrazo; const etapa = int(fd, "etapa") ?? 0; const rec = str(fd, "recomendacao"); const motivo = str(fd, "motivo");
    const e = await pessoa(empId); assert(!!e, "Colaborador não encontrado.");
    assert(decidePrazo(s) ? (scopeUnit(s) === null || scopeUnit(s) === e.unit_id) : (!!s.employeeId && e.gestor_id === s.employeeId), "Só o gestor direto (ou RH/Direção) recomenda.");
    const atual = await prazoAtual(e.unit_id, empId, tipo, etapa); assert(atual.opcoes.includes(rec), "Escolha uma recomendação possível."); assert(motivo.length >= 10, "Conte em poucas linhas como foi o período (mín. 10 caracteres).");
    await sql`INSERT INTO employment_terms (employee_id, tipo, etapa, vence_em, recomendacao, recomendacao_motivo, recomendado_por, recomendado_em) VALUES (${empId}, ${tipo}, ${etapa}, ${atual.vence_em}, ${rec}, ${motivo.slice(0, 1500)}, ${s.id}, now())
      ON CONFLICT (employee_id, tipo, etapa) DO UPDATE SET recomendacao=EXCLUDED.recomendacao, recomendacao_motivo=EXCLUDED.recomendacao_motivo, recomendado_por=EXCLUDED.recomendado_por, recomendado_em=EXCLUDED.recomendado_em`;
    await audit(s, "recomendar decisão de contrato com prazo", "employment_terms", empId, { recomendacao: atual.recomendacao }, { tipo, etapa, recomendacao: rec });
    const rh = (await sql<{ id: number }[]>`SELECT id FROM users WHERE ativo AND (role IN ('RH','DIRECAO') OR (role='DIRETOR_UNIDADE' AND unit_id=${e.unit_id}))`).map(u => u.id).filter(id => id !== s.id);
    await notificar(rh, "Recomendação do gestor: contrato com prazo", `${TIPO_PRAZO[tipo]} · vence em ${br(atual.vence_em)}`, BASE, "ACAO", `prazorec:${empId}:${tipo}:${etapa}`);
  } catch (e) { redirect(go(b, "erro", msgErro(e))); }
  redirect(go(b, "ok", "Recomendação registrada — o RH decide até o vencimento."));
}

/** Término do TCE (estágio) ou do contrato temporário — dentro do limite legal. */
export async function definirTermino(fd: FormData) {
  const s = await requireSession(); const b = caminhoSeguro(str(fd, "voltar"), BASE);
  try {
    assert(decidePrazo(s), "Só RH, Direção ou direção da unidade cadastram o término.");
    const empId = int(fd, "employeeId") ?? 0; const termino = str(fd, "termino"); const e = await pessoa(empId); assert(!!e, "Colaborador não encontrado."); const esc = scopeUnit(s); assert(esc === null || esc === e.unit_id, "Colaborador de outra unidade.");
    assert(["ESTAGIARIO", "TEMPORARIO"].includes(e.vinculo), "Término cadastrado aqui é para estágio ou temporário."); assert(dataOk(termino) && termino >= e.admissao, "Informe um término depois da admissão.");
    const cfg = await getSettings(); const c = cfg.contratosPrazo;
    const limite = e.vinculo === "ESTAGIARIO" ? (() => { const d = new Date(e.admissao + "T12:00:00Z"); d.setUTCMonth(d.getUTCMonth() + Number(c.estagioMaxMeses ?? 24)); return addDays(d.toISOString().slice(0, 10), -1); })() : addDays(e.admissao, Number(c.temporarioDias ?? 180) + Number(c.temporarioProrrogacaoDias ?? 90) - 1);
    assert(termino <= limite, `Acima do limite legal (${br(limite)}).`);
    const [antes] = await sql<{ t: string | null }[]>`SELECT termino_contrato::text AS t FROM employees WHERE id=${empId}`;
    await sql`UPDATE employees SET termino_contrato=${termino}, updated_at=now() WHERE id=${empId}`;
    await audit(s, "definir término de contrato", "employees", empId, { termino: antes?.t ?? null }, { termino });
  } catch (e) { redirect(go(b, "erro", msgErro(e))); }
  redirect(go(b, "ok", "Término cadastrado."));
}
