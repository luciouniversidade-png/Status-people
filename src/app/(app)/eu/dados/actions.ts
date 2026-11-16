"use server";
// v34 · Meu espaço → Meus dados: pedir alteração cadastral (com comprovante) e inclusão ou exclusão de dependente. Tudo passa pelo RH.
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, assert } from "@/lib/auth";
import { audit, str, int, getSettings } from "@/lib/utils";
import { comMensagem } from "@/lib/redirecionar";
import * as C from "@/lib/cadastro";
import { notificar, usuariosPorPerfil } from "@/lib/comunicacao";

const go = (b: string, k: "ok" | "erro", m: string) => comMensagem(b, k, m);
const msgErro = (e: unknown) => (e instanceof Error ? e.message : "Erro inesperado.");
const VOLTA = "/eu/dados";

async function limiteAbertos(eid: number) {
  const cfg = await getSettings(); const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM employee_change_requests WHERE employee_id=${eid} AND status='PENDENTE'`;
  assert(n < Number(cfg.cadastro.maxPedidosAbertos), "Você já tem pedidos aguardando o RH. Espere a análise (ou cancele um) antes de abrir outro.");
  return cfg;
}

export async function pedirAlteracaoCadastral(fd: FormData) {
  const s = await requireSession(); let protocolo = "";
  try {
    assert(!!s.employeeId, "Sua conta não está ligada a uma ficha."); const cfg = await limiteAbertos(s.employeeId!);
    const campos = await C.lerMudancas(fd, s.employeeId!, C.CAMPOS.filter(c => c.meuEspaco));
    assert(campos.length > 0, "Nada mudou em relação à sua ficha.");
    const { arquivos } = await C.gravarDocumentos(fd, "doc", Number(cfg.plataforma.anexoMaxMb), ["Comprovante de residência", "Certidão (estado civil)", "Comprovante da conta", "Comprovante de escolaridade", "Outro"], { userId: s.id, nome: s.nome });
    const exigem = [...new Set(campos.map(c => C.CAMPO.get(c.campo)?.comprovante).filter((x): x is string => !!x))];
    assert(!exigem.length || arquivos.length > 0, `Anexe o comprovante: ${exigem.join("; ")}.`);
    const r = await C.criarPedido({ employeeId: s.employeeId!, origem: "MEU_ESPACO", tipo: "CADASTRO", campos, dependentes: [], arquivos, solicitanteUserId: s.id, quemNome: s.nome, motivo: str(fd, "obs").slice(0, 500) || null });
    protocolo = r.protocolo;
    await notificar(await usuariosPorPerfil(["RH"]), "Alteração cadastral para revisar", "1 pedido novo do Meu espaço.", `/colaboradores/alteracoes/${r.id}`, "ACAO", `cad:${r.id}`);
    await audit(s, "pedir alteração cadastral", "employees", s.employeeId!, null, { protocolo, campos: campos.map(c => c.campo), anexos: arquivos.length });
  } catch (e) { redirect(go(VOLTA, "erro", msgErro(e))); }
  redirect(go(VOLTA, "ok", `Pedido ${protocolo} enviado ao RH. Os dados mudam na sua ficha depois da revisão.`));
}

export async function pedirInclusaoDependente(fd: FormData) {
  const s = await requireSession(); let protocolo = "";
  try {
    assert(!!s.employeeId, "Sua conta não está ligada a uma ficha."); const cfg = await limiteAbertos(s.employeeId!);
    const deps = C.lerDependentes(fd); assert(deps.length === 1, "Informe o nome e o parentesco do dependente.");
    const { arquivos } = await C.gravarDocumentos(fd, "doc", Number(cfg.plataforma.anexoMaxMb), C.DOCS_DEPENDENTE, { userId: s.id, nome: s.nome });
    assert(arquivos.length > 0, "Anexe o documento do dependente (certidão de nascimento ou de casamento, termo de guarda…).");
    const r = await C.criarPedido({ employeeId: s.employeeId!, origem: "MEU_ESPACO", tipo: "DEPENDENTE", campos: [], dependentes: deps, arquivos, solicitanteUserId: s.id, quemNome: s.nome, motivo: str(fd, "obs").slice(0, 500) || null });
    protocolo = r.protocolo;
    await notificar(await usuariosPorPerfil(["RH"]), "Inclusão de dependente para revisar", "1 pedido novo do Meu espaço.", `/colaboradores/alteracoes/${r.id}`, "ACAO", `cad:${r.id}`);
    await audit(s, "pedir inclusão de dependente", "employees", s.employeeId!, null, { protocolo, parentesco: deps[0].parentesco });
  } catch (e) { redirect(go(`${VOLTA}#dependentes`, "erro", msgErro(e))); }
  redirect(go(`${VOLTA}#dependentes`, "ok", `Pedido ${protocolo} enviado ao RH.`));
}

export async function pedirExclusaoDependente(fd: FormData) {
  const s = await requireSession(); let protocolo = "";
  try {
    assert(!!s.employeeId, "Sua conta não está ligada a uma ficha."); const cfg = await limiteAbertos(s.employeeId!);
    const did = int(fd, "dependentId") ?? 0; const [d] = await sql<{ id: number; nome: string; parentesco: string }[]>`SELECT id, nome, parentesco FROM employee_dependents WHERE id=${did} AND employee_id=${s.employeeId} AND ativo`;
    assert(!!d, "Dependente não encontrado."); const motivo = str(fd, "motivo"); assert(motivo.length >= 3, "Informe o motivo (ex.: maioridade, divórcio, óbito).");
    const { arquivos } = await C.gravarDocumentos(fd, "doc", Number(cfg.plataforma.anexoMaxMb), C.DOCS_DEPENDENTE, { userId: s.id, nome: s.nome });
    const r = await C.criarPedido({ employeeId: s.employeeId!, origem: "MEU_ESPACO", tipo: "DEPENDENTE", campos: [], dependentes: [{ acao: "EXCLUIR", dependentId: d!.id, nome: d!.nome, parentesco: d!.parentesco, motivo }], dependentId: d!.id, arquivos, solicitanteUserId: s.id, quemNome: s.nome, motivo });
    protocolo = r.protocolo;
    await notificar(await usuariosPorPerfil(["RH"]), "Exclusão de dependente para revisar", "1 pedido novo do Meu espaço.", `/colaboradores/alteracoes/${r.id}`, "ACAO", `cad:${r.id}`);
    await audit(s, "pedir exclusão de dependente", "employees", s.employeeId!, null, { protocolo });
  } catch (e) { redirect(go(`${VOLTA}#dependentes`, "erro", msgErro(e))); }
  redirect(go(`${VOLTA}#dependentes`, "ok", `Pedido ${protocolo} enviado ao RH.`));
}

export async function cancelarPedidoCadastral(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0;
  try {
    const r = await sql`UPDATE employee_change_requests SET status='CANCELADO', decidido_em=now(), decidido_nome=${s.nome} WHERE id=${id} AND employee_id=${s.employeeId ?? 0} AND status='PENDENTE'`;
    assert(r.count === 1, "Pedido não encontrado ou já analisado."); await audit(s, "cancelar pedido de alteração cadastral", "employee_change_requests", id, null, null);
  } catch (e) { redirect(go(VOLTA, "erro", msgErro(e))); }
  redirect(go(VOLTA, "ok", "Pedido cancelado."));
}
