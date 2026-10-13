"use server";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, can, assert, assertScope, scopeUnit } from "@/lib/auth";
import { audit, str, strOrNull, int, getSettings, fmtData, caminhoSeguro } from "@/lib/utils";
import { foneWa, linkWa, enviarWhatsApp, preencher } from "@/lib/comunicacao";
import { gerarLink, painelRematricula } from "@/lib/rematricula";
import { MARCA_RASCUNHO_CONTRATO } from "@/db/setup";
import { appUrl } from "@/lib/url";

const go = (b: string, k: "ok" | "erro", msg: string) => `${b}${b.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(msg)}`;
const B = "/matriculas/rematricula";
const back = (fd: FormData) => caminhoSeguro(str(fd, "voltar"), B);
const numero = (fd: FormData, k: string, min: number, max: number, rotulo: string) => { const v = str(fd, k); const n = Number(v); if (!v || !Number.isInteger(n) || n < min || n > max) throw new Error(`${rotulo}: informe um número inteiro entre ${min} e ${max}.`); return n; };

async function linkDoEscopo(s: Awaited<ReturnType<typeof requireSession>>, id: number) {
  const [l] = await sql<{ id: number; student_id: number; unit_id: number | null; status: string; token: string; ano: number; expira_em: string; nome: string; responsavel: string | null; telefone: string | null; unidade: string | null }[]>`SELECT l.id, l.student_id, l.unit_id, l.status, l.token, l.ano, l.expira_em::text, st.nome, st.responsavel, st.telefone, u.nome AS unidade FROM rematricula_links l JOIN students st ON st.id=l.student_id LEFT JOIN units u ON u.id=l.unit_id WHERE l.id=${id}`;
  if (!l) throw new Error("Link não encontrado.");
  const u = scopeUnit(s); if (u !== null && l.unit_id !== u) throw new Error("Sem acesso a esta unidade.");
  return l;
}

export async function gerarLinkRematricula(fd: FormData) {
  const s = await requireSession(); const b = back(fd); let msg = "";
  try {
    assert(can.reservar(s), "Seu perfil não gera links de rematrícula.");
    const cfg = await getSettings(); const ano = cfg.matriculas.anoLetivo as number;
    const [c] = await sql`SELECT 1 FROM contract_templates WHERE ano=${ano} AND status='VIGENTE'`; if (!c) throw new Error(`Publique o contrato ${ano} antes de gerar links (Rematrícula → Contrato).`);
    const studentId = int(fd, "studentId"); if (!studentId) throw new Error("Aluno não informado.");
    const [st] = await sql<{ unit_atual_id: number | null }[]>`SELECT unit_atual_id FROM students WHERE id=${studentId}`; if (!st) throw new Error("Aluno não encontrado.");
    if (scopeUnit(s) !== null) { if (st.unit_atual_id === null) throw new Error("Sem acesso a este aluno."); assertScope(s, st.unit_atual_id); }
    const r = await gerarLink(studentId, ano, s.id, int(fd, "gradeId"));
    await audit(s, r.novo ? "gerar link de rematrícula" : "consultar link de rematrícula", "rematricula_links", r.id, null, { studentId, ano });
    msg = r.novo ? "Link de rematrícula gerado." : "O aluno já tinha um link ativo — é o mesmo.";
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", msg));
}

/** Gera links para todos os alunos atuais do filtro que ainda não têm link, reserva ou recusa (pula concluintes e quem está sem série). */
export async function gerarLinksEmLote(fd: FormData) {
  const s = await requireSession(); let msg = "";
  try {
    assert(can.reservar(s), "Seu perfil não gera links de rematrícula.");
    const cfg = await getSettings(); const ano = cfg.matriculas.anoLetivo as number;
    const [c] = await sql`SELECT 1 FROM contract_templates WHERE ano=${ano} AND status='VIGENTE'`; if (!c) throw new Error(`Publique o contrato ${ano} antes de gerar links.`);
    const escopo = scopeUnit(s); const unidade = escopo ?? int(fd, "unidade"); const serie = strOrNull(fd, "serie");
    const rows = (await painelRematricula(ano, unidade)).filter(r => (r.situacao === "SEM_LINK" || r.situacao === "EXPIRADO") && (!serie || r.serie_atual === serie));
    let n = 0, semSerie = 0; const erros: string[] = [];
    for (const r of rows) { if (!r.grade_prevista_id) { semSerie++; continue; } try { const x = await gerarLink(r.student_id, ano, s.id); if (x.novo) n++; } catch (e) { erros.push(`${r.nome}: ${e instanceof Error ? e.message : e}`); } }
    await audit(s, "gerar links de rematrícula em lote", "rematricula_links", null, null, { ano, unidade, serie, gerados: n, semSerie, erros: erros.length });
    msg = `${n} link(s) gerado(s).` + (semSerie ? ` ${semSerie} aluno(s) sem série atual na ficha ficaram de fora.` : "") + (erros.length ? ` ${erros.length} com erro: ${erros.slice(0, 3).join(" · ")}` : "");
  } catch (e) { redirect(go(back(fd), "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(back(fd), "ok", msg));
}

/** Registra o envio do convite (Comunicação → Mensagens) e abre o WhatsApp com o texto pronto; com a API configurada, envia direto. */
export async function enviarConviteRematricula(fd: FormData) {
  const s = await requireSession(); const b = back(fd); let destino = "";
  try {
    assert(can.reservar(s), "Seu perfil não envia convites de rematrícula.");
    const l = await linkDoEscopo(s, int(fd, "id") ?? 0); if (l.status !== "PENDENTE") throw new Error("Este link não está ativo.");
    const cfg = await getSettings(); const fone = foneWa(l.telefone); if (!fone) throw new Error(`Telefone de ${l.nome} ausente ou inválido — corrija na ficha do aluno.`);
    const base = { responsavel: l.responsavel ?? "família", aluno: l.nome, ano: l.ano, prazo: fmtData(l.expira_em), unidade: l.unidade ?? "Colégio Status" };
    const texto = preencher(cfg.rematricula.convite as string, { ...base, link: `${await appUrl()}/rematricula/${l.token}` });
    // no histórico de mensagens (que outros perfis leem) o link fica mascarado: quem tem o link age em nome da família
    const registro = preencher(cfg.rematricula.convite as string, { ...base, link: `${await appUrl()}/rematricula/…${l.token.slice(-4)} (link individual, não guardado)` });
    const [m] = await sql<{ id: number }[]>`INSERT INTO messages (canal, destinatario_nome, destinatario_contato, student_id, entidade, entidade_id, texto, status, user_id, user_nome, unit_id) VALUES ('WHATSAPP', ${l.responsavel ?? l.nome}, ${l.telefone}, ${l.student_id}, 'rematricula', ${l.id}, ${registro}, 'REGISTRADA', ${s.id}, ${s.nome}, ${l.unit_id}) RETURNING id`;
    const r = await enviarWhatsApp(fone, texto);
    await sql`UPDATE messages SET status=${r.ok ? "ENVIADA" : r.via === "api" ? "FALHOU" : "REGISTRADA"}, enviada_em=${r.ok ? new Date().toISOString() : null}, provedor_id=${r.id ?? null}, erro=${r.ok ? null : r.erro ?? null} WHERE id=${m.id}`;
    await sql`UPDATE rematricula_links SET enviado_em=coalesce(enviado_em, now()), enviado_por=${s.id}, updated_at=now() WHERE id=${l.id}`;
    await audit(s, "enviar convite de rematrícula", "rematricula_links", l.id, null, { mensagem: m.id, via: r.via, ok: r.ok });
    if (r.via === "api" && !r.ok) throw new Error(`Falha no envio pela API do WhatsApp: ${r.erro}`);
    destino = r.ok ? go(b, "ok", "Convite enviado pela API do WhatsApp.") : linkWa(fone, texto)!;
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(destino);
}

export async function marcarConviteEnviado(fd: FormData) {
  const s = await requireSession(); const b = back(fd);
  try { assert(can.reservar(s)); const l = await linkDoEscopo(s, int(fd, "id") ?? 0); if (l.status !== "PENDENTE") throw new Error("Este link não está ativo.");
    await sql`UPDATE rematricula_links SET enviado_em=coalesce(enviado_em, now()), enviado_por=${s.id}, updated_at=now() WHERE id=${l.id}`; await audit(s, "marcar convite de rematrícula enviado", "rematricula_links", l.id, null, { canal: str(fd, "canal") || "outro" });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Envio registrado."));
}

export async function cancelarLinkRematricula(fd: FormData) {
  const s = await requireSession(); const b = back(fd);
  try { assert(can.reservar(s)); const l = await linkDoEscopo(s, int(fd, "id") ?? 0); if (l.status !== "PENDENTE") throw new Error("Só links ativos podem ser cancelados.");
    const motivo = str(fd, "motivo"); if (!motivo) throw new Error("Informe o motivo do cancelamento.");
    await sql`UPDATE rematricula_links SET status='CANCELADA', cancel_motivo=${motivo}, updated_at=now() WHERE id=${l.id} AND status='PENDENTE'`; await audit(s, "cancelar link de rematrícula", "rematricula_links", l.id, { status: "PENDENTE" }, { status: "CANCELADA", motivo });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Link cancelado — o endereço deixa de funcionar."));
}

/** Série prevista diferente da sequência (ex.: retenção): só enquanto o link está ativo; a escolha anterior da família é descartada. */
export async function alterarSerieLink(fd: FormData) {
  const s = await requireSession(); const b = back(fd);
  try { assert(can.reservar(s)); const l = await linkDoEscopo(s, int(fd, "id") ?? 0); if (l.status !== "PENDENTE") throw new Error("Só links ativos podem mudar de série.");
    const gradeId = int(fd, "gradeId"); const [g] = await sql<{ nome: string }[]>`SELECT nome FROM grades WHERE id=${gradeId ?? 0}`; if (!g) throw new Error("Escolha a série.");
    await sql`UPDATE rematricula_links SET grade_id=${gradeId}, rascunho=NULL, class_id=NULL, integral_class_id=NULL, updated_at=now() WHERE id=${l.id}`; await audit(s, "alterar série prevista da rematrícula", "rematricula_links", l.id, null, { serie: g.nome, motivo: strOrNull(fd, "motivo") });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Série prevista alterada."));
}

export async function salvarConfigRematricula(fd: FormData) {
  const s = await requireSession();
  try { assert(can.editar(s), "Só Direção/RH configuram a rematrícula.");
    const convite = str(fd, "convite"); if (!convite.includes("{link}")) throw new Error("O texto do convite precisa ter a variável {link}.");
    const v = { validadeLinkDias: numero(fd, "validadeLinkDias", 1, 120, "Validade do link"), reservaDias: numero(fd, "reservaDias", 1, 120, "Prazo da reserva"), lembreteAbertoDias: numero(fd, "lembreteAbertoDias", 1, 30, "Lembrete"), integralContraturno: str(fd, "integralContraturno") === "1", convite };
    await sql`INSERT INTO settings (key, value) VALUES ('rematricula', ${JSON.stringify(v)}::jsonb) ON CONFLICT (key) DO UPDATE SET value=settings.value || EXCLUDED.value`; await audit(s, "configurar rematrícula", "settings", null, null, v);
  } catch (e) { redirect(go(B, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(B, "ok", "Configuração da rematrícula salva."));
}

// ---------- Contrato do ano letivo (versionado) ----------
const BC = `${B}/contrato`;
export async function salvarContrato(fd: FormData) {
  const s = await requireSession(); let msg = "";
  try { assert(can.editar(s), "Só Direção/RH editam o contrato.");
    const cfg = await getSettings(); const ano = int(fd, "ano") ?? (cfg.matriculas.anoLetivo as number); const titulo = str(fd, "titulo"); const texto = str(fd, "texto");
    if (!titulo || texto.length < 50) throw new Error("Informe o título e o texto completo do contrato.");
    const id = int(fd, "id");
    if (id) { const [c] = await sql<{ status: string }[]>`SELECT status FROM contract_templates WHERE id=${id}`; if (!c) throw new Error("Contrato não encontrado."); if (c.status !== "RASCUNHO") throw new Error("Versão publicada não se edita: crie uma nova versão.");
      await sql`UPDATE contract_templates SET titulo=${titulo}, texto=${texto}, updated_at=now() WHERE id=${id}`; await audit(s, "editar contrato (rascunho)", "contract_templates", id, null, { titulo }); msg = "Rascunho salvo."; }
    else { const [r] = await sql<{ id: number; versao: number }[]>`SELECT id, versao FROM contract_templates WHERE ano=${ano} AND status='RASCUNHO' ORDER BY versao DESC LIMIT 1`; if (r) throw new Error(`Já existe um rascunho (versão ${r.versao}) para ${ano}: edite-o.`);
      const [{ v }] = await sql<{ v: number }[]>`SELECT coalesce(max(versao), 0)::int + 1 AS v FROM contract_templates WHERE ano=${ano}`;
      const [n] = await sql<{ id: number }[]>`INSERT INTO contract_templates (ano, titulo, versao, texto, created_by) VALUES (${ano}, ${titulo}, ${v}, ${texto}, ${s.id}) RETURNING id`; await audit(s, "nova versão de contrato", "contract_templates", n.id, null, { ano, versao: v }); msg = `Versão ${v} criada como rascunho.`; }
  } catch (e) { redirect(go(BC, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(BC, "ok", msg));
}
export async function publicarContrato(fd: FormData) {
  const s = await requireSession(); let msg = "";
  try { assert(can.editar(s), "Só Direção/RH publicam o contrato.");
    const id = int(fd, "id") ?? 0; const [c] = await sql<{ id: number; ano: number; versao: number; status: string; texto: string }[]>`SELECT id, ano, versao, status, texto FROM contract_templates WHERE id=${id}`;
    if (!c || c.status !== "RASCUNHO") throw new Error("Só rascunhos podem ser publicados.");
    if (c.texto.includes(MARCA_RASCUNHO_CONTRATO)) throw new Error("O texto ainda tem o aviso de rascunho: cole o contrato oficial (revisado pela assessoria jurídica) e apague o aviso antes de publicar.");
    await sql.begin(async tx => { await tx`UPDATE contract_templates SET status='ARQUIVADO', updated_at=now() WHERE ano=${c.ano} AND status='VIGENTE'`; await tx`UPDATE contract_templates SET status='VIGENTE', publicado_em=now(), publicado_por=${s.id}, updated_at=now() WHERE id=${c.id}`; });
    await audit(s, "publicar contrato", "contract_templates", c.id, null, { ano: c.ano, versao: c.versao }); msg = `Contrato ${c.ano} versão ${c.versao} publicado. Aceites já feitos continuam com a versão que a família aceitou.`;
  } catch (e) { redirect(go(BC, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(BC, "ok", msg));
}
export async function novaVersaoContrato(fd: FormData) {
  const s = await requireSession(); let msg = "";
  try { assert(can.editar(s), "Só Direção/RH editam o contrato.");
    const [c] = await sql<{ ano: number; titulo: string; texto: string }[]>`SELECT ano, titulo, texto FROM contract_templates WHERE id=${int(fd, "id") ?? 0} AND status IN ('VIGENTE','ARQUIVADO')`; if (!c) throw new Error("Versão de origem não encontrada.");
    const [r] = await sql`SELECT 1 FROM contract_templates WHERE ano=${c.ano} AND status='RASCUNHO'`; if (r) throw new Error("Já existe um rascunho para este ano: edite-o.");
    const [{ v }] = await sql<{ v: number }[]>`SELECT coalesce(max(versao), 0)::int + 1 AS v FROM contract_templates WHERE ano=${c.ano}`;
    const [n] = await sql<{ id: number }[]>`INSERT INTO contract_templates (ano, titulo, versao, texto, created_by) VALUES (${c.ano}, ${c.titulo}, ${v}, ${c.texto}, ${s.id}) RETURNING id`; await audit(s, "nova versão de contrato", "contract_templates", n.id, null, { ano: c.ano, versao: v }); msg = `Versão ${v} criada a partir da anterior (rascunho).`;
  } catch (e) { redirect(go(BC, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(BC, "ok", msg));
}
