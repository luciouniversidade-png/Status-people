"use server";
// v34 · Meu espaço: ajuste de ponto, atestado pelo celular, termômetro de humor (anônimo), parabéns ao aniversariante.
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, assert } from "@/lib/auth";
import { audit, str, getSettings, hoje, addDays, caminhoSeguro } from "@/lib/utils";
import { comMensagem } from "@/lib/redirecionar";
import { TIPO_AJUSTE, lerMarcacoes } from "@/lib/autoatendimento";
import { notificar, usuariosPorPerfil } from "@/lib/comunicacao";
import { mesFechado } from "@/lib/folha";
import { semanaDe } from "@/lib/humor";

const go = (b: string, k: "ok" | "erro", m: string) => comMensagem(b, k, m);
const msgErro = (e: unknown) => (e instanceof Error ? e.message : "Erro inesperado.");
const ehData = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

export async function pedirAjustePonto(fd: FormData) {
  const s = await requireSession(); const volta = "/eu#ajuste";
  try {
    assert(!!s.employeeId, "Sua conta não está ligada a uma ficha."); const cfg = await getSettings();
    assert(cfg.meuEspaco.permitirAjustePonto !== false, "O pedido de ajuste de ponto pelo Meu espaço está desligado. Fale com o RH.");
    const data = str(fd, "data"); assert(ehData(data), "Informe o dia."); assert(data <= hoje(), "Ajuste de ponto é para um dia que já passou (ou hoje).");
    assert(data >= addDays(hoje(), -Number(cfg.meuEspaco.ajustePontoDiasMax)), `Só dá para pedir ajuste dos últimos ${cfg.meuEspaco.ajustePontoDiasMax} dias. Para dias mais antigos, fale com o RH.`);
    const [e] = await sql<{ unit_id: number; gestor_id: number | null; nome: string }[]>`SELECT unit_id, gestor_id, nome FROM employees WHERE id=${s.employeeId}`;
    assert(!(await mesFechado(e.unit_id, data)), "O ponto deste mês já foi fechado. Fale com o RH (o ajuste entra na folha do mês seguinte).");
    const tipo = str(fd, "tipo"); assert(!!TIPO_AJUSTE[tipo], "Escolha o motivo do ajuste.");
    const m = lerMarcacoes(str(fd, "marcacoes")); const motivo = str(fd, "motivo").slice(0, 600); assert(motivo.length >= 5, "Explique o que aconteceu (mínimo 5 caracteres).");
    await sql`INSERT INTO timesheet_adjust_requests (employee_id, data, tipo, marcacoes, motivo, solicitante_user_id) VALUES (${s.employeeId}, ${data}, ${tipo}, ${m.texto}, ${motivo}, ${s.id})`;
    // aviso para quem aprova (gestor direto e direção da unidade) e para o RH: só contagem
    const gestorUser = e.gestor_id ? (await sql<{ id: number }[]>`SELECT id FROM users WHERE employee_id=${e.gestor_id} AND ativo`).map(r => r.id) : [];
    await notificar([...new Set([...gestorUser, ...await usuariosPorPerfil(["DIRETOR_UNIDADE"], e.unit_id), ...await usuariosPorPerfil(["RH"])])], "Ajuste de ponto para aprovar", "1 pedido novo.", "/ponto/ajustes", "ACAO");
    await audit(s, "pedir ajuste de ponto", "employees", s.employeeId!, null, { data, tipo });
  } catch (e) { const m = msgErro(e); redirect(go(volta, "erro", /ts_adjust_aberto_uq|duplicate/i.test(m) ? "Já há um pedido de ajuste aberto para este dia." : m)); }
  redirect(go(volta, "ok", "Pedido de ajuste enviado. Você acompanha a resposta aqui."));
}

export async function cancelarAjustePonto(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id"));
  const r = await sql`UPDATE timesheet_adjust_requests SET status='CANCELADO' WHERE id=${id} AND employee_id=${s.employeeId ?? 0} AND status='PENDENTE'`;
  redirect(go("/eu#ajuste", r.count ? "ok" : "erro", r.count ? "Pedido cancelado." : "Pedido não encontrado ou já analisado."));
}

/** Atestado pelo celular: foto ou PDF. Sem CID: o ONE não pergunta e não guarda. Só o RH e a Direção veem o arquivo. */
export async function enviarAtestado(fd: FormData) {
  const s = await requireSession(); const volta = "/eu#atestado";
  try {
    assert(!!s.employeeId, "Sua conta não está ligada a uma ficha."); const cfg = await getSettings();
    assert(cfg.meuEspaco.permitirAtestado !== false, "O envio de atestado pelo Meu espaço está desligado. Entregue ao RH.");
    const tipo = str(fd, "tipo") === "HORAS" ? "HORAS" : "DIAS";
    const inicio = str(fd, "inicio"); assert(ehData(inicio), "Informe a data do atestado.");
    const fim = tipo === "DIAS" ? (str(fd, "fim") || inicio) : inicio; assert(ehData(fim) && fim >= inicio, "O último dia não pode ser antes do primeiro.");
    assert(inicio >= addDays(hoje(), -60) && inicio <= addDays(hoje(), 30), "Data fora do prazo: atestados de até 60 dias atrás.");
    const dias = tipo === "DIAS" ? Math.round((Date.parse(fim) - Date.parse(inicio)) / 86400000) + 1 : 0; assert(dias <= 120, "Período longo demais: entregue ao RH.");
    const horas = tipo === "HORAS" ? str(fd, "horas").slice(0, 40) : null; if (tipo === "HORAS") assert(!!horas && /\d/.test(horas), "Informe o horário da consulta ou exame (ex.: 08:00 às 10:30).");
    const f = fd.get("arquivo"); assert(!!f && typeof f === "object" && "arrayBuffer" in f && (f as File).size > 0, "Tire a foto do atestado ou anexe o PDF.");
    const file = f as File; assert(file.size <= Number(cfg.plataforma.anexoMaxMb) * 1048576, `Arquivo acima de ${cfg.plataforma.anexoMaxMb} MB.`);
    const mime = file.type || "application/octet-stream"; assert(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"].includes(mime), "Envie foto (JPG, PNG, HEIC) ou PDF.");
    const obs = str(fd, "obs").slice(0, 300) || null;
    await sql.begin(async tx => {
      const [m] = await tx<{ id: number }[]>`INSERT INTO medical_certificates (employee_id, tipo, inicio, fim, dias, horas, obs) VALUES (${s.employeeId}, ${tipo}, ${inicio}, ${fim}, ${dias || null}, ${horas}, ${obs}) RETURNING id`;
      const [a] = await tx<{ id: number }[]>`INSERT INTO attachments (entidade, entidade_id, nome, mime, tamanho, dados, descricao, unit_id, user_id, user_nome) VALUES ('medical_certificate', ${m.id}, ${file.name.replace(/[^\w.\-() ]/g, "_").slice(0, 120) || "atestado"}, ${mime}, ${file.size}, ${Buffer.from(await file.arrayBuffer())}, 'Atestado', NULL, ${s.id}, ${s.nome}) RETURNING id`;
      await tx`UPDATE medical_certificates SET attachment_id=${a.id} WHERE id=${m.id}`;
    });
    await notificar(await usuariosPorPerfil(["RH"]), "Atestado recebido pelo Meu espaço", "1 atestado para conferir.", "/ponto/atestados", "ACAO");
    await audit(s, "enviar atestado", "employees", s.employeeId!, null, { tipo, inicio, fim, dias });
  } catch (e) { redirect(go(volta, "erro", msgErro(e))); }
  redirect(go(volta, "ok", "Atestado enviado ao RH. Guarde o original em papel até o RH confirmar."));
}

/** Termômetro de humor: 1 resposta por semana. Nada guarda a resposta de uma pessoa: só contadores do grupo; a marca (quem já respondeu na semana) fica separada e não tem a nota. Sem trilha de auditoria. */
export async function registrarHumor(fd: FormData) {
  const s = await requireSession(); const volta = caminhoSeguro(str(fd, "voltar"), "/eu");
  try {
    const cfg = await getSettings(); assert(cfg.termometro.ativo !== false, "Termômetro desligado.");
    const nota = Number(str(fd, "nota")); assert(Number.isInteger(nota) && nota >= 1 && nota <= 5, "Escolha como foi a semana (1 a 5).");
    const fatores = fd.getAll("fatores").map(String).filter(f => (cfg.termometro.fatores as string[]).includes(f)).slice(0, 3);
    const semana = semanaDe(hoje());
    const [e] = s.employeeId ? await sql<{ unit_id: number; gestor_id: number | null }[]>`SELECT unit_id, gestor_id FROM employees WHERE id=${s.employeeId}` : [];
    await sql.begin(async tx => {
      const r = await tx`INSERT INTO mood_marks (user_id, dia) VALUES (${s.id}, ${semana}) ON CONFLICT DO NOTHING`;
      if (r.count === 0) throw new Error("Você já respondeu nesta semana. Obrigado!");
      // só incrementa contadores: nenhuma linha guarda a resposta de uma pessoa
      const u = e?.unit_id ?? s.unitId ?? 0; const g = e?.gestor_id ?? 0;
      await tx`INSERT INTO mood_counts (semana, unit_id, gestor_id, nota, n) VALUES (${semana}, ${u}, ${g}, ${nota}, 1) ON CONFLICT (semana, unit_id, gestor_id, nota) DO UPDATE SET n = mood_counts.n + 1`;
      for (const f of fatores) await tx`INSERT INTO mood_factor_counts (semana, unit_id, gestor_id, nota, fator, n) VALUES (${semana}, ${u}, ${g}, ${nota}, ${f}, 1) ON CONFLICT (semana, unit_id, gestor_id, nota, fator) DO UPDATE SET n = mood_factor_counts.n + 1`;
    });
  } catch (e) { redirect(go(volta, "erro", msgErro(e))); }
  redirect(go(volta, "ok", "Obrigado! Sua resposta é anônima e só aparece somada com a do grupo."));
}

/** Parabéns ao aniversariante (uma mensagem por pessoa por ano). */
export async function darParabens(fd: FormData) {
  const s = await requireSession(); const para = Number(fd.get("employeeId")); const volta = caminhoSeguro(str(fd, "voltar"), "/");
  try {
    const cfg = await getSettings(); assert(cfg.meuEspaco.mostrarAniversariantes !== false, "Aniversariantes desligados nas configurações.");
    assert(para > 0 && para !== s.employeeId, "Escolha a pessoa.");
    const [e] = await sql<{ id: number; nascimento: string | null }[]>`SELECT id, to_char(data_nascimento, 'MM-DD') AS nascimento FROM employees WHERE id=${para} AND situacao <> 'DESLIGADO'`;
    assert(!!e && !!e.nascimento, "Pessoa não encontrada."); const h = hoje(); const ano = Number(h.slice(0, 4));
    const alvo = `${ano}-${e!.nascimento}`; const dif = Math.round((Date.parse(h) - Date.parse(alvo)) / 86400000);
    assert(dif >= -1 && dif <= 7, "Os parabéns abrem na véspera e vão até uma semana depois do aniversário.");
    const msg = str(fd, "mensagem").slice(0, 280) || null;
    const r = await sql`INSERT INTO birthday_wishes (para_employee_id, de_user_id, de_nome, ano, mensagem) VALUES (${para}, ${s.id}, ${s.nome}, ${ano}, ${msg}) ON CONFLICT (para_employee_id, de_user_id, ano) DO NOTHING`;
    assert(r.count === 1, "Você já deu parabéns a esta pessoa neste ano.");
    const users = (await sql<{ id: number }[]>`SELECT id FROM users WHERE employee_id=${para} AND ativo`).map(x => x.id);
    await notificar(users, "Parabéns! 🎉", "Você recebeu mensagens de aniversário. Veja no Meu espaço.", "/eu#parabens", "INFO", `parabens:${para}:${h}`);
  } catch (e) { redirect(go(volta, "erro", msgErro(e))); }
  redirect(go(volta, "ok", "Parabéns enviados!"));
}
