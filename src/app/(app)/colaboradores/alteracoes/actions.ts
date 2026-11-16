"use server";
// v34 · revisão das alterações cadastrais (Meu espaço e ficha de admissão pelo link): o RH aprova ou recusa campo a campo e aplica.
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, assert } from "@/lib/auth";
import { audit, str, int, getSettings, hoje, addDays } from "@/lib/utils";
import { comMensagem } from "@/lib/redirecionar";
import * as C from "@/lib/cadastro";
import { notificar } from "@/lib/comunicacao";
import { usuariosDasFichas } from "@/lib/assinaturas";

const go = (b: string, k: "ok" | "erro", m: string) => comMensagem(b, k, m);
const msgErro = (e: unknown) => (e instanceof Error ? e.message : "Erro inesperado.");
const END = ["cep", "logradouro", "numero", "complemento", "bairro", "cidade", "uf"];

type Pedido = { id: number; employee_id: number; tipo: string; origem: string; protocolo: string; status: string; campos: C.MudancaCampo[]; dependentes: (C.DependentePedido & { cpfDigitos?: string | null })[]; dependent_id: number | null; invite_id: number | null };

export async function decidirPedido(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const volta = `/colaboradores/alteracoes/${id}`; let msg = "";
  try {
    assert(C.podeRevisarCadastro(s), "Só RH e Direção revisam alterações cadastrais.");
    const [p] = await sql<Pedido[]>`SELECT id, employee_id, tipo, origem, protocolo, status, campos, dependentes, dependent_id, invite_id FROM employee_change_requests WHERE id=${id}`;
    assert(!!p, "Pedido não encontrado."); assert(p!.status === "PENDENTE", "Pedido já decidido.");
    const campos = p!.campos.map(c => ({ ...c, decisao: str(fd, `c_${c.campo}`) === "APROVADO" ? "APROVADO" as const : "RECUSADO" as const }));
    const deps = p!.dependentes.map((d, i) => ({ ...d, decisao: str(fd, `d_${i}`) === "APROVADO" ? "APROVADO" as const : "RECUSADO" as const }));
    const total = campos.length + deps.length; const aprov = campos.filter(c => c.decisao === "APROVADO").length + deps.filter(d => d.decisao === "APROVADO").length;
    const motivo = str(fd, "motivo").slice(0, 800);
    assert(aprov === total || motivo.length >= 5, "Escreva o motivo do que foi recusado (a pessoa vê).");
    // aplica: colunas aprovadas na ficha; endereço composto de novo; dependentes incluídos ou encerrados
    const upd: Record<string, unknown> = {};
    for (const c of campos.filter(x => x.decisao === "APROVADO")) upd[c.campo] = C.CAMPO.get(c.campo)?.tipo === "simnao" ? c.depois === "true" : c.depois;
    await sql.begin(async tx => {
      if (Object.keys(upd).length) {
        await tx`UPDATE employees SET ${tx(upd)}, updated_at=now() WHERE id=${p!.employee_id}`;
        if (END.some(k => k in upd)) {
          const [e] = await tx<Record<string, string | null>[]>`SELECT cep, logradouro, numero, complemento, bairro, cidade, uf FROM employees WHERE id=${p!.employee_id}`;
          const txt = [[e.logradouro, e.numero].filter(Boolean).join(", "), e.complemento, e.bairro, [e.cidade, e.uf].filter(Boolean).join("/"), e.cep ? `CEP ${e.cep}` : null].filter(Boolean).join(" · ");
          if (txt) await tx`UPDATE employees SET endereco=${txt} WHERE id=${p!.employee_id}`;
        }
      }
      for (const d of deps.filter(x => x.decisao === "APROVADO")) {
        if (d.acao === "INCLUIR") await tx`INSERT INTO employee_dependents (employee_id, nome, parentesco, data_nascimento, cpf, irrf, salario_familia, plano_saude, origem) VALUES (${p!.employee_id}, ${d.nome}, ${d.parentesco}, ${d.dataNascimento ?? null}, ${d.cpfDigitos ?? null}, ${!!d.irrf}, ${!!d.salarioFamilia}, ${!!d.planoSaude}, ${p!.origem})`;
        else if (d.acao === "EXCLUIR" && d.dependentId) await tx`UPDATE employee_dependents SET ativo=false, fim=${hoje()}, motivo_fim=${d.motivo ?? null}, updated_at=now() WHERE id=${d.dependentId} AND employee_id=${p!.employee_id}`;
      }
      const status = aprov === total ? "APROVADO" : aprov === 0 ? "RECUSADO" : "PARCIAL";
      // o CPF do dependente só fica na ficha do dependente: some do pedido depois da decisão
      await tx`UPDATE employee_change_requests SET status=${status}, motivo=${motivo || null}, campos=${JSON.stringify(campos)}::jsonb, dependentes=${JSON.stringify(deps.map(({ cpfDigitos: _c, ...r }) => r))}::jsonb, decidido_por=${s.id}, decidido_nome=${s.nome}, decidido_em=now(), aplicados=${JSON.stringify({ campos: campos.filter(c => c.decisao === "APROVADO").map(c => c.campo), dependentes: deps.filter(d => d.decisao === "APROVADO").length })}::jsonb WHERE id=${id}`;
      if (p!.tipo === "ADMISSAO" && p!.invite_id && status !== "RECUSADO") await tx`UPDATE admission_invites SET estado='CONCLUIDO' WHERE id=${p!.invite_id} AND estado='ATIVO' AND NOT EXISTS (SELECT 1 FROM employee_change_requests x WHERE x.invite_id=${p!.invite_id} AND x.status='PENDENTE' AND x.id<>${id})`;
      msg = status === "APROVADO" ? `Pedido ${p!.protocolo} aplicado na ficha.` : status === "PARCIAL" ? `Pedido ${p!.protocolo} aplicado em parte (${aprov} de ${total}).` : `Pedido ${p!.protocolo} recusado.`;
    });
    await notificar(await usuariosDasFichas([p!.employee_id]), "Seu pedido de alteração cadastral foi analisado", "Veja o resultado no Meu espaço → Meus dados.", "/eu/dados", "INFO");
    // a trilha registra QUAIS campos mudaram, nunca os valores (dados bancários, RG, PIS e raça/cor ficam fora)
    await audit(s, "decidir alteração cadastral", "employees", p!.employee_id, null, { protocolo: p!.protocolo, aprovados: campos.filter(c => c.decisao === "APROVADO").map(c => c.campo), recusados: campos.filter(c => c.decisao === "RECUSADO").map(c => c.campo), dependentes: deps.map(d => `${d.acao}:${d.decisao}`) });
  } catch (e) { redirect(go(volta, "erro", msgErro(e))); }
  redirect(go("/colaboradores/alteracoes", "ok", msg));
}

/** Gera o link da ficha cadastral (admissão ou recadastramento). O link aparece uma vez só para o RH copiar e enviar. */
export async function gerarConviteAdmissao(fd: FormData) {
  const s = await requireSession(); const eid = int(fd, "employeeId") ?? 0; const volta = `/colaboradores/${eid}`; let token = ""; let ate = "";
  try {
    assert(C.podeRevisarCadastro(s), "Só RH e Direção geram o link da ficha.");
    const [e] = await sql<{ situacao: string }[]>`SELECT situacao FROM employees WHERE id=${eid}`; assert(!!e, "Colaborador não encontrado."); assert(e!.situacao !== "DESLIGADO", "Ficha de pessoa desligada.");
    const email = str(fd, "email").toLowerCase(); assert(!email || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email), "E-mail inválido.");
    const cfg = await getSettings(); ate = addDays(hoje(), Number(cfg.cadastro.conviteDias)); token = C.novoToken();
    await sql.begin(async tx => { await tx`UPDATE admission_invites SET estado='CANCELADO' WHERE employee_id=${eid} AND estado='ATIVO'`; await tx`INSERT INTO admission_invites (employee_id, token_hash, email, expira_em, criado_por, criado_nome) VALUES (${eid}, ${C.hashToken(token)}, ${email || null}, ${ate}, ${s.id}, ${s.nome})`; });
    await audit(s, "gerar link da ficha cadastral", "employees", eid, null, { ate, email: email ? "informado" : null });
  } catch (e) { redirect(go(`${volta}#admissao`, "erro", msgErro(e))); }
  redirect(`${volta}?convite=${encodeURIComponent(token)}&ok=${encodeURIComponent(`Link gerado, válido até ${ate.split("-").reverse().join("/")}. Copie agora (ele não aparece de novo) e envie à pessoa por WhatsApp ou e-mail.`)}#admissao`);
}

export async function cancelarConviteAdmissao(fd: FormData) {
  const s = await requireSession(); const eid = int(fd, "employeeId") ?? 0; const volta = `/colaboradores/${eid}#admissao`;
  try {
    assert(C.podeRevisarCadastro(s), "Só RH e Direção.");
    const r = await sql`UPDATE admission_invites SET estado='CANCELADO' WHERE employee_id=${eid} AND estado='ATIVO'`; assert(r.count > 0, "Nenhum link ativo.");
    await audit(s, "cancelar link da ficha cadastral", "employees", eid, null, null);
  } catch (e) { redirect(go(volta, "erro", msgErro(e))); }
  redirect(go(volta, "ok", "Link cancelado: quem tiver o endereço não consegue mais enviar."));
}

/** Dependente cadastrado direto pelo RH (com documento conferido fora do sistema) ou encerrado. */
export async function salvarDependenteRh(fd: FormData) {
  const s = await requireSession(); const eid = int(fd, "employeeId") ?? 0; const volta = `/colaboradores/${eid}#dependentes`;
  try {
    assert(C.podeRevisarCadastro(s), "Só RH e Direção.");
    const did = int(fd, "dependentId");
    if (did && str(fd, "acao") === "ENCERRAR") { const motivo = str(fd, "motivo"); assert(motivo.length >= 3, "Informe o motivo."); await sql`UPDATE employee_dependents SET ativo=false, fim=${hoje()}, motivo_fim=${motivo}, updated_at=now() WHERE id=${did} AND employee_id=${eid}`; await audit(s, "encerrar dependente", "employees", eid, null, { dependente: did }); }
    else {
      const [d] = C.lerDependentes((() => { const f = new FormData(); for (const k of ["Nome", "Parentesco", "Nascimento", "Cpf", "Irrf", "Sf", "Plano"]) { const v = fd.get(`dep0${k}`); if (typeof v === "string") f.set(`dep0${k}`, v); } return f; })());
      assert(!!d, "Informe o nome e o parentesco.");
      await sql`INSERT INTO employee_dependents (employee_id, nome, parentesco, data_nascimento, cpf, irrf, salario_familia, plano_saude, origem) VALUES (${eid}, ${d.nome}, ${d.parentesco}, ${d.dataNascimento ?? null}, ${d.cpf ?? null}, ${!!d.irrf}, ${!!d.salarioFamilia}, ${!!d.planoSaude}, 'RH')`;
      await audit(s, "incluir dependente", "employees", eid, null, { parentesco: d.parentesco, irrf: !!d.irrf, salarioFamilia: !!d.salarioFamilia });
    }
  } catch (e) { redirect(go(volta, "erro", msgErro(e))); }
  redirect(go(volta, "ok", "Dependentes atualizados."));
}
