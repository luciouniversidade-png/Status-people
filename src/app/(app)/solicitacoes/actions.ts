"use server";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, assert, scopeUnit, type Session } from "@/lib/auth";
import { audit, str, strOrNull, int, hoje, addDays, caminhoSeguro, getSettings } from "@/lib/utils";
import { competenciaFechada, mensagemTrava } from "@/lib/conciliacao";
import { notificar } from "@/lib/comunicacao";
import { excecoesDespesa, EXCECAO_ROTULO, categoriaDoTipo } from "@/lib/despesas";
import { lerCampos, lerEtapas, montarEtapas, podeDecidir, perfilDe, fmtValorBr, type Campo, type Etapa, type EtapaSnap } from "@/lib/solicitacoes";

const go = (b: string, k: "ok" | "erro", msg: string) => `${b}${b.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(msg)}`;
type Tipo = { id: number; nome: string; campos: Campo[]; etapas: Etapa[]; prazo_dias: number; perfis: string[] | null; ativo: boolean };
type Req = { id: number; numero: string; titulo: string; type_id: number; status: string; etapa_atual: number; etapas: EtapaSnap[]; solicitante_user_id: number; unit_id: number | null; valor: string | null };

/** Lê e valida as respostas do formulário conforme os campos do tipo; devolve os dados e o valor (primeiro campo de valor). */
function lerDados(fd: FormData, campos: Campo[]) {
  const dados: Record<string, string | number | boolean | null> = {}; let valor: number | null = null;
  for (const c of campos) {
    const raw = str(fd, `campo_${c.id}`);
    if (!raw) { if (c.obrigatorio && c.tipo !== "SIM_NAO") throw new Error(`Preencha “${c.rotulo}”.`); dados[c.id] = c.tipo === "SIM_NAO" ? false : null; continue; }
    if (c.tipo === "NUMERO" || c.tipo === "VALOR") { const n = Number(raw.replace(/[R$\s]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".")); if (!Number.isFinite(n) || n < 0) throw new Error(`“${c.rotulo}”: número inválido.`); dados[c.id] = n; if (c.tipo === "VALOR" && valor === null) valor = n; }
    else if (c.tipo === "DATA") { if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error(`“${c.rotulo}”: data inválida.`); dados[c.id] = raw; }
    else if (c.tipo === "SELECAO") { if (!c.opcoes?.includes(raw)) throw new Error(`“${c.rotulo}”: escolha uma das opções.`); dados[c.id] = raw; }
    else if (c.tipo === "SIM_NAO") dados[c.id] = raw === "1";
    else dados[c.id] = raw.slice(0, c.tipo === "TEXTO_LONGO" ? 4000 : 300);
  }
  return { dados, valor };
}
async function numeroNovo() { const ano = hoje().slice(0, 4); const [{ n }] = await sql<{ n: number }[]>`SELECT coalesce(max(substring(numero from '[0-9]+$')::int), 0)::int AS n FROM requests WHERE numero LIKE ${`SOL-${ano}-%`}`; return `SOL-${ano}-${String(n + 1).padStart(4, "0")}`; }
async function unidadeDo(s: Session, fd: FormData) {
  const escolhida = int(fd, "unitId"); const u = scopeUnit(s);
  if (u !== null) return u;
  if (s.employeeId) { const [e] = await sql<{ unit_id: number }[]>`SELECT unit_id FROM employees WHERE id=${s.employeeId}`; if (!escolhida && e) return e.unit_id; }
  if (!escolhida) throw new Error("Escolha a unidade a que a solicitação se refere.");
  const [x] = await sql`SELECT 1 FROM units WHERE id=${escolhida}`; if (!x) throw new Error("Unidade inválida."); return escolhida;
}
const avisarEtapa = async (r: { id: number; numero: string; titulo: string }, e: EtapaSnap, valor: number | null) => notificar(e.aprovadores, `Aprovar: ${r.titulo}`, `${r.numero} · etapa “${e.nome}”${valor !== null ? ` · ${fmtValorBr(valor)}` : ""}`, `/solicitacoes/${r.id}`, "ACAO");

export async function abrirSolicitacao(fd: FormData) {
  const s = await requireSession(); let id = 0; const tid = int(fd, "typeId") ?? 0;
  try {
    assert(s.role !== "LEITURA", "Perfil somente leitura não abre solicitações.");
    const [t] = await sql<Tipo[]>`SELECT id, nome, campos, etapas, prazo_dias, perfis, ativo FROM request_types WHERE id=${tid}`; if (!t || !t.ativo) throw new Error("Tipo de solicitação indisponível.");
    if (t.perfis?.length && !t.perfis.includes(s.role)) throw new Error("Seu perfil não abre este tipo de solicitação.");
    const { dados, valor } = lerDados(fd, t.campos); const unitId = await unidadeDo(s, fd);
    const titulo = str(fd, "titulo") || `${t.nome}${typeof dados[t.campos[0]?.id] === "string" ? ` — ${String(dados[t.campos[0].id]).slice(0, 60)}` : ""}`;
    const etapas = await montarEtapas(t.etapas, valor, unitId, s.id);
    let numero = ""; for (let k = 0; k < 3 && !id; k++) { numero = await numeroNovo();
      const r = await sql<{ id: number }[]>`INSERT INTO requests (numero, type_id, titulo, dados, valor, unit_id, solicitante_user_id, solicitante_nome, etapas, prazo_etapa) VALUES (${numero}, ${t.id}, ${titulo.slice(0, 200)}, ${JSON.stringify(dados)}::jsonb, ${valor}, ${unitId}, ${s.id}, ${s.nome}, ${JSON.stringify(etapas)}::jsonb, ${addDays(hoje(), t.prazo_dias)}) ON CONFLICT (numero) DO NOTHING RETURNING id`;
      if (r[0]) id = r[0].id; }
    if (!id) throw new Error("Não foi possível numerar a solicitação. Tente de novo.");
    await sql`INSERT INTO request_events (request_id, etapa, tipo, texto, user_id, user_nome) VALUES (${id}, 0, 'CRIADA', ${`Aberta${valor !== null ? ` · ${fmtValorBr(valor)}` : ""}: ${etapas.length} etapa(s) de aprovação`}, ${s.id}, ${s.nome})`;
    await audit(s, "abrir solicitação", "requests", id, null, { numero, tipo: t.nome, valor });
    await avisarEtapa({ id, numero, titulo }, etapas[0], valor);
  } catch (e) { redirect(go(`/solicitacoes/nova?tipo=${tid}`, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(`/solicitacoes/${id}`, "ok", "Solicitação enviada para aprovação."));
}


/** Aprovar (passa à próxima etapa ou conclui), rejeitar ou devolver para ajuste — sempre por um aprovador da etapa atual, nunca pelo solicitante. */
/** Uma decisão (aprovar, rejeitar, devolver) com trilha da etapa, auditoria e avisos. Usada no item e no lote (C10). */
async function decidirUma(s: Session, id: number, decisao: string, obs: string | null, lote = false): Promise<string> {
  const out = await sql.begin(async tx => {
    const [r] = await tx<Req[]>`SELECT id, numero, titulo, type_id, status, etapa_atual, etapas, solicitante_user_id, unit_id, valor::text FROM requests WHERE id=${id} FOR UPDATE`; if (!r) throw new Error("Solicitação não encontrada.");
    if (r.solicitante_user_id === s.id) throw new Error("Ninguém aprova a própria solicitação.");
    if (!podeDecidir(s, r)) throw new Error("Esta etapa não está com você (ou já foi decidida).");
    const etapas = r.etapas.map((e, i) => i === r.etapa_atual ? { ...e, decisao: decisao === "APROVAR" ? "APROVADA" : decisao === "REJEITAR" ? "REJEITADA" : "DEVOLVIDA", por: s.id, porNome: s.nome, em: new Date().toISOString(), obs: obs ?? (lote ? "aprovada em lote" : null) } : e);
    const ultima = r.etapa_atual >= etapas.length - 1;
    const status = decisao === "APROVAR" ? (ultima ? "APROVADA" : "EM_APROVACAO") : decisao === "REJEITAR" ? "REJEITADA" : "DEVOLVIDA";
    const prox = decisao === "APROVAR" && !ultima ? r.etapa_atual + 1 : r.etapa_atual;
    const [t] = await tx<{ prazo_dias: number }[]>`SELECT prazo_dias FROM request_types WHERE id=${r.type_id}`;
    await tx`UPDATE requests SET etapas=${JSON.stringify(etapas)}::jsonb, status=${status}, etapa_atual=${prox}, prazo_etapa=${status === "EM_APROVACAO" ? addDays(hoje(), t?.prazo_dias ?? 2) : null}, concluida_em=${["APROVADA", "REJEITADA"].includes(status) ? tx`now()` : null}, updated_at=now() WHERE id=${id}`;
    await tx`INSERT INTO request_events (request_id, etapa, tipo, texto, user_id, user_nome) VALUES (${id}, ${r.etapa_atual}, ${decisao === "APROVAR" ? "APROVADA" : decisao === "REJEITAR" ? "REJEITADA" : "DEVOLVIDA"}, ${`${etapas[r.etapa_atual].nome}${obs ? `: ${obs}` : lote ? " (aprovação em lote)" : ""}`}, ${s.id}, ${s.nome})`;
    return { r, etapas, status, prox };
  });
  await audit(s, `solicitação: ${decisao.toLowerCase()}${lote ? " (lote)" : ""}`, "requests", id, { status: out.r.status }, { status: out.status, etapa: out.r.etapa_atual });
  const valor = out.r.valor === null ? null : Number(out.r.valor);
  if (out.status === "EM_APROVACAO") { await avisarEtapa(out.r, out.etapas[out.prox], valor); return `Aprovada nesta etapa; seguiu para “${out.etapas[out.prox].nome}”.`; }
  await notificar([out.r.solicitante_user_id], `${out.status === "APROVADA" ? "Aprovada" : out.status === "REJEITADA" ? "Rejeitada" : "Devolvida para ajuste"}: ${out.r.titulo}`, `${out.r.numero}${obs ? ` · ${obs}` : ""}`, `/solicitacoes/${id}`, out.status === "APROVADA" ? "INFO" : "ACAO");
  return out.status === "APROVADA" ? "Solicitação aprovada (última etapa)." : out.status === "REJEITADA" ? "Solicitação rejeitada." : "Devolvida ao solicitante para ajuste.";
}

export async function decidirSolicitacao(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const b = caminhoSeguro(str(fd, "voltar"), `/solicitacoes/${id}`); let msg = "";
  try {
    const decisao = str(fd, "decisao"); if (!["APROVAR", "REJEITAR", "DEVOLVER"].includes(decisao)) throw new Error("Decisão inválida.");
    const obs = strOrNull(fd, "obs"); if (decisao !== "APROVAR" && (!obs || obs.length < 5)) throw new Error(decisao === "REJEITAR" ? "Explique o motivo da rejeição." : "Diga o que precisa ser ajustado.");
    // atalho de aprovação da lista: só para o normal; exceção da política exige abrir o item (C10)
    if (decisao === "APROVAR" && str(fd, "rapido") === "1") { const ex = (await excecoesDespesa([id])).get(id) ?? []; if (ex.length) throw new Error(`Exceção da política (${ex.map(e => EXCECAO_ROTULO[e.codigo]).join(", ")}): abra a solicitação e decida item a item.`); }
    msg = await decidirUma(s, id, decisao, obs);
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", msg));
}

/** C10 · Aprovação em lote: só o normal entra; exceções (sem documento, acima do lote, categoria bloqueada, orçamento) ficam de fora, com trilha item a item. */
export async function aprovarLote(fd: FormData) {
  const s = await requireSession(); const b = "/solicitacoes?aba=aprovar"; let msg = "";
  try {
    const ids = [...new Set(fd.getAll("ids").map(Number).filter(n => Number.isInteger(n) && n > 0))]; assert(ids.length > 0, "Marque ao menos uma solicitação para aprovar em lote.");
    assert(ids.length <= 100, "No máximo 100 por lote.");
    const exc = await excecoesDespesa(ids); const nums = new Map((await sql<{ id: number; numero: string }[]>`SELECT id, numero FROM requests WHERE id = ANY(${ids})`).map(r => [r.id, r.numero]));
    let ok = 0; const fora: string[] = [];
    for (const id of ids) {
      const ex = exc.get(id) ?? []; if (ex.length) { fora.push(`${nums.get(id) ?? `#${id}`} (${ex.map(e => EXCECAO_ROTULO[e.codigo].toLowerCase()).join(", ")})`); continue; }
      try { await decidirUma(s, id, "APROVAR", null, true); ok++; } catch (e) { fora.push(`${nums.get(id) ?? `#${id}`} (${e instanceof Error ? e.message : "erro"})`); }
    }
    await audit(s, "aprovação em lote de solicitações", "requests", null, null, { marcadas: ids.length, aprovadas: ok, foraDoLote: fora.length });
    msg = `${ok} aprovada(s) em lote${fora.length ? ` · ${fora.length} ficaram para decisão individual: ${fora.slice(0, 4).join("; ")}${fora.length > 4 ? "…" : ""}` : ""}.`;
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", msg));
}

/** O solicitante ajusta e reenvia: valida de novo, recalcula as etapas (o valor pode mudar a alçada) e recomeça a aprovação. */
export async function reenviarSolicitacao(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const b = `/solicitacoes/${id}`;
  try {
    const [r] = await sql<Req[]>`SELECT id, numero, titulo, type_id, status, etapa_atual, etapas, solicitante_user_id, unit_id, valor::text FROM requests WHERE id=${id}`; if (!r) throw new Error("Solicitação não encontrada.");
    if (r.solicitante_user_id !== s.id) throw new Error("Só quem abriu reenvia."); if (r.status !== "DEVOLVIDA") throw new Error("Só solicitações devolvidas são reenviadas.");
    const [t] = await sql<Tipo[]>`SELECT id, nome, campos, etapas, prazo_dias, perfis, ativo FROM request_types WHERE id=${r.type_id}`;
    const { dados, valor } = lerDados(fd, t.campos); const etapas = await montarEtapas(t.etapas, valor, r.unit_id, s.id);
    await sql`UPDATE requests SET dados=${JSON.stringify(dados)}::jsonb, valor=${valor}, etapas=${JSON.stringify(etapas)}::jsonb, etapa_atual=0, status='EM_APROVACAO', prazo_etapa=${addDays(hoje(), t.prazo_dias)}, updated_at=now() WHERE id=${id}`;
    await sql`INSERT INTO request_events (request_id, etapa, tipo, texto, user_id, user_nome) VALUES (${id}, 0, 'REENVIADA', ${strOrNull(fd, "obs") ?? "Ajustada e reenviada"}, ${s.id}, ${s.nome})`;
    await audit(s, "reenviar solicitação", "requests", id, { status: "DEVOLVIDA" }, { status: "EM_APROVACAO", valor }); await avisarEtapa(r, etapas[0], valor);
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Reenviada para aprovação."));
}

export async function cancelarSolicitacao(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const b = `/solicitacoes/${id}`;
  try {
    const [r] = await sql<{ status: string; solicitante_user_id: number }[]>`SELECT status, solicitante_user_id FROM requests WHERE id=${id}`; if (!r) throw new Error("Solicitação não encontrada.");
    if (r.solicitante_user_id !== s.id) throw new Error("Só quem abriu cancela."); if (!["EM_APROVACAO", "DEVOLVIDA"].includes(r.status)) throw new Error("Solicitação já concluída.");
    await sql`UPDATE requests SET status='CANCELADA', updated_at=now() WHERE id=${id}`; await sql`INSERT INTO request_events (request_id, tipo, texto, user_id, user_nome) VALUES (${id}, 'CANCELADA', ${strOrNull(fd, "obs")}, ${s.id}, ${s.nome})`;
    await audit(s, "cancelar solicitação", "requests", id);
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Solicitação cancelada."));
}

export async function comentarSolicitacao(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const b = `/solicitacoes/${id}`;
  try {
    const [r] = await sql<Req[]>`SELECT id, numero, titulo, type_id, status, etapa_atual, etapas, solicitante_user_id, unit_id, valor::text FROM requests WHERE id=${id}`; if (!r) throw new Error("Solicitação não encontrada.");
    const envolvido = r.solicitante_user_id === s.id || r.etapas.some(e => e.aprovadores.includes(s.id)) || ["DIRECAO", "RH"].includes(s.role) || (s.role === "DIRETOR_UNIDADE" && r.unit_id === s.unitId);
    if (!envolvido) throw new Error("Sem acesso a esta solicitação.");
    const texto = str(fd, "texto"); if (texto.length < 2) throw new Error("Escreva o comentário.");
    await sql`INSERT INTO request_events (request_id, etapa, tipo, texto, user_id, user_nome) VALUES (${id}, ${r.etapa_atual}, 'COMENTARIO', ${texto.slice(0, 2000)}, ${s.id}, ${s.nome})`;
    const dest = r.solicitante_user_id === s.id ? (r.status === "EM_APROVACAO" ? r.etapas[r.etapa_atual].aprovadores : []) : [r.solicitante_user_id];
    if (dest.length) await notificar(dest, `Comentário em ${r.numero}`, texto.slice(0, 140), b, "INFO");
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Comentário registrado."));
}

/** Tipos de solicitação: formulário (campos) e etapas de aprovação com alçada por valor. */
export async function salvarTipoSolicitacao(fd: FormData) {
  const s = await requireSession(); let msg = "";
  try {
    assert(["DIRECAO", "RH"].includes(s.role), "Só Direção/RH configuram os tipos de solicitação.");
    const id = int(fd, "id"); const nome = str(fd, "nome"); if (nome.length < 3) throw new Error("Nome do tipo.");
    const campos = lerCampos(str(fd, "campos")); const etapas = await lerEtapas(str(fd, "etapas"));
    const prazo = Number(str(fd, "prazoDias") || "2"); if (!Number.isInteger(prazo) || prazo < 1 || prazo > 30) throw new Error("Prazo por etapa: 1 a 30 dias.");
    const perfis = fd.getAll("perfis").map(String).map(p => (p === "COLABORADOR" ? p : perfilDe(p))).filter(Boolean) as string[];
    const d = { nome, descricao: strOrNull(fd, "descricao"), campos: JSON.stringify(campos), etapas: JSON.stringify(etapas), prazo, perfis: perfis.length ? JSON.stringify(perfis) : null, ativo: str(fd, "ativo") !== "0" };
    if (id) await sql`UPDATE request_types SET nome=${d.nome}, descricao=${d.descricao}, campos=${d.campos}::jsonb, etapas=${d.etapas}::jsonb, prazo_dias=${prazo}, perfis=${d.perfis}::jsonb, ativo=${d.ativo}, updated_at=now() WHERE id=${id}`;
    else { const codigo = (str(fd, "codigo") || nome).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "_").slice(0, 30); const [dup] = await sql`SELECT 1 FROM request_types WHERE codigo=${codigo}`; if (dup) throw new Error("Já existe um tipo com este código.");
      await sql`INSERT INTO request_types (codigo, nome, descricao, campos, etapas, prazo_dias, perfis, ativo) VALUES (${codigo}, ${d.nome}, ${d.descricao}, ${d.campos}::jsonb, ${d.etapas}::jsonb, ${prazo}, ${d.perfis}::jsonb, ${d.ativo})`; }
    await audit(s, id ? "editar tipo de solicitação" : "criar tipo de solicitação", "request_types", id, null, { nome, campos: campos.length, etapas: etapas.length });
    msg = `Tipo salvo: ${campos.length} campo(s), ${etapas.length} etapa(s). Solicitações já abertas seguem com as etapas da época.`;
  } catch (e) { redirect(go("/solicitacoes/tipos", "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go("/solicitacoes/tipos", "ok", msg));
}

/** T-029 · Pagamento da despesa aprovada: só com o débito do extrato (conciliado), nunca por declaração. Reclassifica o lançamento do caixa. */
export async function registrarPagamento(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const b = `/solicitacoes/${id}`;
  try {
    if (!["FINANCEIRO", "DIRECAO"].includes(s.role)) { await audit(s, "acesso negado: registrar pagamento de solicitação", "requests", id, null, { papel: s.role }); throw new Error("O pagamento é registrado pelo Financeiro ou pela Direção."); }
    const [r] = await sql<{ status: string; valor: number | null; pago_em: string | null; titulo: string; numero: string; solicitante_user_id: number; codigo: string; concluida_em: string | null }[]>`SELECT r.status, r.valor::float, r.pago_em::text, r.titulo, r.numero, r.solicitante_user_id, t.codigo, r.concluida_em::text FROM requests r JOIN request_types t ON t.id=r.type_id WHERE r.id=${id}`;
    assert(!!r, "Solicitação não encontrada."); assert(r.status === "APROVADA", "Só solicitação aprovada é paga."); const valorAprovado = r.valor ?? 0; assert(valorAprovado > 0, "Esta solicitação não tem valor a pagar."); assert(!r.pago_em, "Pagamento já registrado.");
    const lineId = int(fd, "lineId"); assert(!!lineId, "Escolha o débito do extrato que pagou esta despesa.");
    const [l] = await sql<{ data: string; valor: number; request_id: number | null; apelido: string; unit_id: number | null; cash_entry_id: number | null }[]>`SELECT l.data::text, l.valor::float, l.request_id, a.apelido, a.unit_id, l.cash_entry_id FROM bank_lines l JOIN bank_accounts a ON a.id=l.bank_account_id WHERE l.id=${lineId}`;
    assert(!!l, "Lançamento do extrato não encontrado."); assert(l.valor < 0, "Escolha um débito (saída) do extrato."); assert(!l.request_id, "Este débito já pagou outra solicitação.");
    assert(Math.abs(Math.abs(l.valor) - valorAprovado) < 0.005, `O débito (${Math.abs(l.valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}) não bate com o valor aprovado (${valorAprovado.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}).`);
    const trava = await competenciaFechada(l.data, l.unit_id); if (trava) throw new Error(mensagemTrava(trava));
    await sql`UPDATE requests SET pago_em=${l.data}, pagamento_line_id=${lineId}, pago_por=${s.id}, updated_at=now() WHERE id=${id}`;
    await sql`UPDATE bank_lines SET request_id=${id}, status='CONCILIADO', classe='DESPESA', classificado_por=${s.id} WHERE id=${lineId}`;
    const cfg = await getSettings(); const cat = categoriaDoTipo(cfg, r.codigo);
    if (l.cash_entry_id && cat) { const [ce] = await sql<{ categoria: string }[]>`SELECT categoria FROM cash_entries WHERE id=${l.cash_entry_id}`;
      if (ce && ce.categoria !== cat) { await sql`UPDATE cash_entries SET categoria=${cat}, descricao=${`${r.numero} · ${r.titulo}`.slice(0, 300)}, reclassificado_em=now() WHERE id=${l.cash_entry_id}`; await audit(s, "reclassificar lançamento de caixa", "cash_entries", l.cash_entry_id, { categoria: ce.categoria }, { categoria: cat, motivo: `Pagamento da solicitação ${r.numero}` }); } }
    await sql`INSERT INTO request_events (request_id, etapa, tipo, texto, user_id, user_nome) VALUES (${id}, NULL, 'PAGA', ${`Paga em ${l.data.split("-").reverse().join("/")} · débito da conta ${l.apelido} (conciliado)`}, ${s.id}, ${s.nome})`;
    await audit(s, "registrar pagamento de solicitação", "requests", id, { pago: false }, { pago: true, pagoEm: l.data, debito: lineId });
    await notificar([r.solicitante_user_id], `Pago: ${r.titulo}`, `${r.numero} · ${valorAprovado.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} em ${l.data.split("-").reverse().join("/")}`, b, "INFO", `solpaga:${id}`);
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Pagamento registrado com o débito conciliado."));
}
export async function desfazerPagamento(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const b = `/solicitacoes/${id}`;
  try {
    assert(["FINANCEIRO", "DIRECAO"].includes(s.role), "Só Financeiro e Direção desfazem o pagamento."); const motivo = str(fd, "motivo"); assert(motivo.length >= 5, "Explique o motivo.");
    const [r] = await sql<{ pagamento_line_id: number | null; pago_em: string | null }[]>`SELECT pagamento_line_id, pago_em::text FROM requests WHERE id=${id}`; assert(!!r?.pago_em, "Não há pagamento registrado.");
    if (r.pagamento_line_id) { const [l] = await sql<{ data: string; unit_id: number | null }[]>`SELECT l.data::text, a.unit_id FROM bank_lines l JOIN bank_accounts a ON a.id=l.bank_account_id WHERE l.id=${r.pagamento_line_id}`; if (l) { const t = await competenciaFechada(l.data, l.unit_id); if (t) throw new Error(mensagemTrava(t)); }
      await sql`UPDATE bank_lines SET request_id=NULL, status='IGNORADO', classe=NULL WHERE id=${r.pagamento_line_id}`; }
    await sql`UPDATE requests SET pago_em=NULL, pagamento_line_id=NULL, pago_por=NULL, updated_at=now() WHERE id=${id}`;
    await sql`INSERT INTO request_events (request_id, etapa, tipo, texto, user_id, user_nome) VALUES (${id}, NULL, 'COMENTARIO', ${`Pagamento desfeito: ${motivo}`}, ${s.id}, ${s.nome})`;
    await audit(s, "desfazer pagamento de solicitação", "requests", id, { pagoEm: r.pago_em }, { pago: false, motivo });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Pagamento desfeito."));
}

/** Programa a data do pagamento: a despesa aprovada entra na projeção de caixa (13 semanas) nessa data. */
export async function programarPagamento(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const b = caminhoSeguro(str(fd, "voltar"), `/solicitacoes/${id}`);
  try {
    assert(["FINANCEIRO", "DIRECAO"].includes(s.role), "O Financeiro ou a Direção programam o pagamento.");
    const data = str(fd, "data"); assert(/^\d{4}-\d{2}-\d{2}$/.test(data), "Informe a data prevista."); assert(data >= hoje(), "A data prevista não pode estar no passado.");
    const [r] = await sql<{ status: string; pago_em: string | null; previsto: string | null }[]>`SELECT status, pago_em::text, pagamento_previsto::text AS previsto FROM requests WHERE id=${id}`;
    assert(!!r && r.status === "APROVADA" && !r.pago_em, "Só despesa aprovada e ainda não paga é programada.");
    await sql`UPDATE requests SET pagamento_previsto=${data}, updated_at=now() WHERE id=${id}`;
    await sql`INSERT INTO request_events (request_id, etapa, tipo, texto, user_id, user_nome) VALUES (${id}, NULL, 'COMENTARIO', ${`Pagamento programado para ${data.split("-").reverse().join("/")}`}, ${s.id}, ${s.nome})`;
    await audit(s, "programar pagamento de solicitação", "requests", id, { previsto: r.previsto }, { previsto: data });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Pagamento programado — já entra na projeção de caixa."));
}
