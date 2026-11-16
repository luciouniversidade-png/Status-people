/**
 * v34 · Cadastro do colaborador: a ficha de admissão preenchida pelo link (sem login) e as alterações cadastrais pedidas no
 * Meu espaço (endereço, nome social, estado civil, conta salário, escolaridade…) com comprovante. Nada vale sozinho: o RH revisa
 * campo a campo e aplica só o que aprovar. Dados bancários, RG, PIS e raça/cor nunca aparecem na trilha de auditoria.
 */
import { createHash, randomBytes } from "crypto";
import { sql } from "@/db";
import type { Session } from "./auth";
import { hoje } from "./utils";

export type CampoDef = { k: string; rotulo: string; grupo: string; tipo?: "texto" | "data" | "select" | "simnao"; opcoes?: [string, string][]; max?: number; sensivel?: boolean; comprovante?: string; admissao?: boolean; meuEspaco?: boolean; dica?: string };
export const ESTADO_CIVIL: [string, string][] = [["SOLTEIRO", "Solteiro(a)"], ["CASADO", "Casado(a)"], ["UNIAO_ESTAVEL", "União estável"], ["DIVORCIADO", "Divorciado(a)"], ["SEPARADO", "Separado(a) judicialmente"], ["VIUVO", "Viúvo(a)"]];
// categorias do IBGE (as do eSocial); “não informado” é opção válida no eSocial
export const RACA_COR: [string, string][] = [["BRANCA", "Branca"], ["PRETA", "Preta"], ["PARDA", "Parda"], ["AMARELA", "Amarela"], ["INDIGENA", "Indígena"], ["NAO_INFORMADO", "Prefiro não informar"]];
export const ESCOLARIDADE: [string, string][] = [["FUND_INC", "Fundamental incompleto"], ["FUND", "Fundamental completo"], ["MEDIO_INC", "Médio incompleto"], ["MEDIO", "Médio completo"], ["SUP_INC", "Superior incompleto"], ["SUP", "Superior completo"], ["POS", "Pós-graduação / especialização"], ["MESTRADO", "Mestrado"], ["DOUTORADO", "Doutorado"]];
export const TIPO_CONTA: [string, string][] = [["CORRENTE", "Conta corrente"], ["POUPANCA", "Poupança"], ["SALARIO", "Conta salário"]];
export const SEXO: [string, string][] = [["F", "Feminino"], ["M", "Masculino"]];
export const UFS = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");

export const CAMPOS: CampoDef[] = [
  { k: "nome_social", rotulo: "Nome social", grupo: "Pessoal", max: 120, admissao: true, meuEspaco: true, dica: "Como você quer ser chamado(a). Aparece no ONE no lugar do nome civil nas telas do dia a dia." },
  { k: "data_nascimento", rotulo: "Data de nascimento", grupo: "Pessoal", tipo: "data", admissao: true },
  { k: "sexo", rotulo: "Sexo (eSocial)", grupo: "Pessoal", tipo: "select", opcoes: SEXO, admissao: true },
  { k: "estado_civil", rotulo: "Estado civil", grupo: "Pessoal", tipo: "select", opcoes: ESTADO_CIVIL, admissao: true, meuEspaco: true, comprovante: "Certidão de casamento, averbação de divórcio ou declaração de união estável" },
  { k: "raca_cor", rotulo: "Raça/cor (IBGE, exigida pelo eSocial)", grupo: "Pessoal", tipo: "select", opcoes: RACA_COR, sensivel: true, admissao: true },
  { k: "escolaridade", rotulo: "Escolaridade", grupo: "Pessoal", tipo: "select", opcoes: ESCOLARIDADE, admissao: true, meuEspaco: true, comprovante: "Diploma, certificado ou declaração de conclusão" },
  { k: "nacionalidade", rotulo: "Nacionalidade", grupo: "Pessoal", max: 60, admissao: true },
  { k: "naturalidade", rotulo: "Naturalidade (cidade/UF)", grupo: "Pessoal", max: 80, admissao: true },
  { k: "rg", rotulo: "RG (número)", grupo: "Documentos", max: 20, sensivel: true, admissao: true },
  { k: "rg_orgao", rotulo: "RG — órgão emissor/UF", grupo: "Documentos", max: 20, admissao: true },
  { k: "rg_emissao", rotulo: "RG — data de emissão", grupo: "Documentos", tipo: "data", admissao: true },
  { k: "pis", rotulo: "PIS/PASEP/NIS", grupo: "Documentos", max: 14, sensivel: true, admissao: true },
  { k: "cep", rotulo: "CEP", grupo: "Endereço", max: 9, admissao: true, meuEspaco: true, comprovante: "Comprovante de residência (até 90 dias)" },
  { k: "logradouro", rotulo: "Logradouro", grupo: "Endereço", max: 160, admissao: true, meuEspaco: true, comprovante: "Comprovante de residência (até 90 dias)" },
  { k: "numero", rotulo: "Número", grupo: "Endereço", max: 20, admissao: true, meuEspaco: true, comprovante: "Comprovante de residência (até 90 dias)" },
  { k: "complemento", rotulo: "Complemento", grupo: "Endereço", max: 80, admissao: true, meuEspaco: true },
  { k: "bairro", rotulo: "Bairro", grupo: "Endereço", max: 80, admissao: true, meuEspaco: true, comprovante: "Comprovante de residência (até 90 dias)" },
  { k: "cidade", rotulo: "Cidade", grupo: "Endereço", max: 80, admissao: true, meuEspaco: true, comprovante: "Comprovante de residência (até 90 dias)" },
  { k: "uf", rotulo: "UF", grupo: "Endereço", tipo: "select", opcoes: UFS.map(u => [u, u]), admissao: true, meuEspaco: true, comprovante: "Comprovante de residência (até 90 dias)" },
  { k: "telefone", rotulo: "Celular (com DDD)", grupo: "Contato", max: 20, admissao: true },
  { k: "email", rotulo: "E-mail pessoal", grupo: "Contato", max: 160, admissao: true },
  { k: "contato_emergencia", rotulo: "Contato de emergência (nome e telefone)", grupo: "Contato", max: 160, admissao: true },
  { k: "banco_codigo", rotulo: "Banco (código ou nome)", grupo: "Conta salário", max: 60, sensivel: true, admissao: true, meuEspaco: true, comprovante: "Comprovante da conta (print do app ou cartão) no seu nome" },
  { k: "banco_agencia", rotulo: "Agência", grupo: "Conta salário", max: 12, sensivel: true, admissao: true, meuEspaco: true, comprovante: "Comprovante da conta (print do app ou cartão) no seu nome" },
  { k: "banco_conta", rotulo: "Conta (com dígito)", grupo: "Conta salário", max: 20, sensivel: true, admissao: true, meuEspaco: true, comprovante: "Comprovante da conta (print do app ou cartão) no seu nome" },
  { k: "banco_tipo", rotulo: "Tipo de conta", grupo: "Conta salário", tipo: "select", opcoes: TIPO_CONTA, sensivel: true, admissao: true, meuEspaco: true },
  { k: "pix_chave", rotulo: "Chave PIX (opcional)", grupo: "Conta salário", max: 120, sensivel: true, admissao: true, meuEspaco: true },
  { k: "vale_transporte", rotulo: "Quer vale-transporte?", grupo: "Benefícios", tipo: "simnao", admissao: true },
  { k: "vt_obs", rotulo: "Vale-transporte: linhas e trajeto (ida e volta)", grupo: "Benefícios", max: 300, admissao: true },
];
export const CAMPO = new Map(CAMPOS.map(c => [c.k, c]));
export const GRUPOS = [...new Set(CAMPOS.map(c => c.grupo))];
export const PARENTESCO: [string, string][] = [["FILHO", "Filho(a) ou enteado(a)"], ["CONJUGE", "Cônjuge"], ["COMPANHEIRO", "Companheiro(a) (união estável)"], ["PAI_MAE", "Pai ou mãe"], ["MENOR_GUARDA", "Menor sob guarda judicial"], ["OUTRO", "Outro"]];
export const DOCS_ADMISSAO = ["Documento com foto (RG ou CNH)", "CPF (se não constar no documento)", "Comprovante de residência", "Carteira de Trabalho Digital (print da tela de dados pessoais)", "Título de eleitor", "Certificado de reservista (homens)", "Certidão de nascimento ou casamento", "Comprovante de escolaridade", "Certidão de nascimento dos filhos", "Cartão de vacinação dos filhos até 7 anos", "Foto 3x4", "Outro"];
export const DOCS_DEPENDENTE = ["Certidão de nascimento", "Certidão de casamento ou declaração de união estável", "Termo de guarda judicial", "CPF do dependente", "Outro"];

export const soDig = (t: string | null | undefined) => (t ?? "").replace(/\D/g, "");
const ehData = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
export const mascaraValor = (k: string, v: string | null | undefined): string => {
  if (v === null || v === undefined || v === "") return "—"; const c = CAMPO.get(k);
  if (k === "banco_conta" || k === "pix_chave" || k === "rg" || k === "pis") return v.length <= 4 ? "••••" : `••••${v.slice(-3)}`;
  if (c?.opcoes) return c.opcoes.find(o => o[0] === v)?.[1] ?? v;
  if (c?.tipo === "simnao") return v === "true" || v === "SIM" ? "Sim" : "Não";
  if (c?.tipo === "data") return v.split("-").reverse().join("/");
  return v;
};
export const exibirValor = (k: string, v: string | null | undefined): string => { const c = CAMPO.get(k); if (v === null || v === undefined || v === "") return "—"; if (c?.opcoes) return c.opcoes.find(o => o[0] === v)?.[1] ?? v; if (c?.tipo === "simnao") return v === "true" || v === "SIM" ? "Sim" : "Não"; if (c?.tipo === "data") return v.split("-").reverse().join("/"); return v; };

/** Valida e normaliza um valor do formulário; retorna "" quando vazio. Lança erro com o rótulo do campo. */
export function normalizar(k: string, bruto: string): string {
  const c = CAMPO.get(k); if (!c) throw new Error("Campo desconhecido.");
  let v = bruto.replace(/\s+/g, " ").trim(); if (!v) return "";
  if (c.max && !["cep", "pis", "telefone", "banco_agencia", "banco_conta"].includes(k)) v = v.slice(0, c.max); // esses validam o formato inteiro (não cortam)
  if (c.tipo === "data") { if (!ehData(v)) throw new Error(`${c.rotulo}: data inválida.`); if (v > hoje()) throw new Error(`${c.rotulo}: data no futuro.`); return v; }
  if (c.tipo === "select") { if (!c.opcoes!.some(o => o[0] === v)) throw new Error(`${c.rotulo}: escolha uma opção da lista.`); return v; }
  if (c.tipo === "simnao") return v === "SIM" || v === "true" ? "true" : "false";
  if (k === "cep") { const d = soDig(v); if (d.length !== 8) throw new Error("CEP: 8 números."); return `${d.slice(0, 5)}-${d.slice(5)}`; }
  if (k === "pis") { const d = soDig(v); if (d.length !== 11) throw new Error("PIS/PASEP/NIS: 11 números."); return d; }
  if (k === "telefone") { const d = soDig(v); if (d.length < 10 || d.length > 13) throw new Error("Celular: informe com DDD."); return v.slice(0, 20); }
  if (k === "email") { v = v.toLowerCase(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) throw new Error("E-mail pessoal inválido."); return v; }
  if (k === "banco_agencia" || k === "banco_conta") { if (!/^[0-9xX\- ]{1,20}$/.test(v)) throw new Error(`${c.rotulo}: só números (e o dígito).`); return v.toUpperCase(); }
  return v;
}

export type MudancaCampo = { campo: string; rotulo: string; antes: string | null; depois: string | null; decisao?: "APROVADO" | "RECUSADO" | null };
export type DependentePedido = { acao: "INCLUIR" | "EXCLUIR" | "ALTERAR"; dependentId?: number | null; nome: string; parentesco: string; dataNascimento?: string | null; cpf?: string | null; irrf?: boolean; salarioFamilia?: boolean; planoSaude?: boolean; motivo?: string | null; decisao?: "APROVADO" | "RECUSADO" | null };
export type Documento = { attachmentId: number; tipo: string; nome: string };

/** Valores atuais (como texto) das colunas do cadastro. */
export async function valoresAtuais(employeeId: number): Promise<Record<string, string | null>> {
  const cols = CAMPOS.map(c => c.k);
  const [r] = await sql<Record<string, unknown>[]>`SELECT ${sql(cols)} FROM employees WHERE id=${employeeId}`;
  const out: Record<string, string | null> = {};
  for (const k of cols) { const v = r?.[k]; out[k] = v === null || v === undefined ? null : v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === "boolean" ? String(v) : String(v); }
  return out;
}

/** Compara o formulário com a ficha: só os campos que mudaram entram no pedido. */
export async function lerMudancas(fd: FormData, employeeId: number, quais: CampoDef[]): Promise<MudancaCampo[]> {
  const atual = await valoresAtuais(employeeId); const out: MudancaCampo[] = [];
  for (const c of quais) {
    const bruto = fd.get(c.k); if (typeof bruto !== "string") continue;
    const v = normalizar(c.k, bruto); const antes = atual[c.k];
    if (v === "" && (antes === null || antes === "")) continue;
    if (v === "" ) continue; // apagar um dado não se pede por aqui (o RH faz na ficha)
    if (v !== (antes ?? "")) out.push({ campo: c.k, rotulo: c.rotulo, antes, depois: v });
  }
  return out;
}

export function lerDependentes(fd: FormData): DependentePedido[] {
  const out: DependentePedido[] = [];
  for (let i = 0; i < 8; i++) {
    const nome = String(fd.get(`dep${i}Nome`) ?? "").replace(/\s+/g, " ").trim(); if (!nome) continue;
    const parentesco = String(fd.get(`dep${i}Parentesco`) ?? ""); if (!PARENTESCO.some(p => p[0] === parentesco)) throw new Error(`Dependente ${nome}: escolha o parentesco.`);
    const nasc = String(fd.get(`dep${i}Nascimento`) ?? "").trim(); if (nasc && (!ehData(nasc) || nasc > hoje())) throw new Error(`Dependente ${nome}: data de nascimento inválida.`);
    const cpf = soDig(String(fd.get(`dep${i}Cpf`) ?? "")); if (cpf && cpf.length !== 11) throw new Error(`Dependente ${nome}: CPF com 11 números.`);
    out.push({ acao: "INCLUIR", nome: nome.slice(0, 120), parentesco, dataNascimento: nasc || null, cpf: cpf || null, irrf: fd.get(`dep${i}Irrf`) === "1", salarioFamilia: fd.get(`dep${i}Sf`) === "1", planoSaude: fd.get(`dep${i}Plano`) === "1" });
  }
  return out;
}

/** Comprovantes enviados (até 10 arquivos de até o limite de anexo cada): gravados como anexo restrito do pedido. */
export async function gravarDocumentos(fd: FormData, prefixo: string, maxMb: number, tipos: string[], quem: { userId: number | null; nome: string }): Promise<{ arquivos: { bytes: Buffer; nome: string; mime: string; tipo: string }[] }> {
  const arquivos: { bytes: Buffer; nome: string; mime: string; tipo: string }[] = [];
  for (let i = 0; i < 10; i++) {
    const f = fd.get(`${prefixo}${i}`); if (!f || typeof f !== "object" || !("arrayBuffer" in f) || (f as File).size === 0) continue;
    const file = f as File; if (file.size > maxMb * 1048576) throw new Error(`Arquivo “${file.name.slice(0, 40)}” acima de ${maxMb} MB.`);
    const mime = file.type || "application/octet-stream"; if (!["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"].includes(mime)) throw new Error(`“${file.name.slice(0, 40)}”: envie PDF ou foto (JPG, PNG, WEBP, HEIC).`);
    const tipo = String(fd.get(`${prefixo}${i}Tipo`) ?? "Outro"); arquivos.push({ bytes: Buffer.from(await file.arrayBuffer()), nome: file.name.replace(/[^\w.\-() áéíóúâêôãõçÁÉÍÓÚÂÊÔÃÕÇ]/g, "_").slice(0, 120) || "arquivo", mime, tipo: tipos.includes(tipo) ? tipo : "Outro" });
  }
  void quem; return { arquivos };
}

export async function novoProtocolo(prefixo: "CAD" | "ADM" | "DEP"): Promise<string> {
  const ano = hoje().slice(0, 4); const base = `${prefixo}-${ano}-`;
  const [{ n }] = await sql<{ n: number }[]>`SELECT coalesce(max(substring(protocolo from ${base.length + 1}::int)::int), 0)::int AS n FROM employee_change_requests WHERE protocolo LIKE ${base + "%"}`;
  return `${base}${String(n + 1).padStart(4, "0")}`;
}

/** Cria o pedido com os anexos (transação): o RH revisa em Colaboradores → Alterações cadastrais. */
export async function criarPedido(o: { employeeId: number; origem: "MEU_ESPACO" | "ADMISSAO" | "RH"; tipo: "CADASTRO" | "DEPENDENTE" | "ADMISSAO"; campos: MudancaCampo[]; dependentes: DependentePedido[]; dependentId?: number | null; motivo?: string | null; arquivos: { bytes: Buffer; nome: string; mime: string; tipo: string }[]; solicitanteUserId: number | null; inviteId?: number | null; quemNome: string }) {
  const protocolo = await novoProtocolo(o.tipo === "ADMISSAO" ? "ADM" : o.tipo === "DEPENDENTE" ? "DEP" : "CAD");
  let id = 0;
  await sql.begin(async tx => {
    const [r] = await tx<{ id: number }[]>`INSERT INTO employee_change_requests (employee_id, origem, tipo, protocolo, campos, dependentes, dependent_id, motivo, solicitante_user_id, invite_id) VALUES (${o.employeeId}, ${o.origem}, ${o.tipo}, ${protocolo}, ${JSON.stringify(o.campos)}::jsonb, ${JSON.stringify(o.dependentes.map(d => ({ ...d, cpf: d.cpf ? `***${d.cpf.slice(-2)}` : null, cpfDigitos: d.cpf ?? null })))}::jsonb, ${o.dependentId ?? null}, ${o.motivo ?? null}, ${o.solicitanteUserId}, ${o.inviteId ?? null}) RETURNING id`;
    id = r.id; const docs: Documento[] = [];
    for (const a of o.arquivos) { const [x] = await tx<{ id: number }[]>`INSERT INTO attachments (entidade, entidade_id, nome, mime, tamanho, dados, descricao, unit_id, user_id, user_nome) VALUES ('employee_change', ${id}, ${a.nome}, ${a.mime}, ${a.bytes.length}, ${a.bytes}, ${a.tipo}, NULL, ${o.solicitanteUserId}, ${o.quemNome}) RETURNING id`; docs.push({ attachmentId: x.id, tipo: a.tipo, nome: a.nome }); }
    await tx`UPDATE employee_change_requests SET documentos=${JSON.stringify(docs)}::jsonb WHERE id=${id}`;
  });
  return { id, protocolo };
}

// ------------------------------------------------------------------ convite da ficha de admissão
export const hashToken = (t: string) => createHash("sha256").update(`adm:${t}`).digest("hex");
export const novoToken = () => randomBytes(24).toString("base64url");
export type ContextoAdmissao = { inviteId: number; employeeId: number; nome: string; unidade: string; cargo: string | null; admissao: string; expira_em: string; envios: number; estado: string };
export async function contextoAdmissao(token: string, marcar = true): Promise<ContextoAdmissao> {
  if (!token || token.length < 20 || token.length > 80) throw new Error("Link inválido.");
  const [c] = await sql<ContextoAdmissao[]>`SELECT i.id AS "inviteId", i.employee_id AS "employeeId", e.nome, u.nome AS unidade, p.nome AS cargo, e.admissao::text, i.expira_em::text, i.envios, i.estado
    FROM admission_invites i JOIN employees e ON e.id=i.employee_id JOIN units u ON u.id=e.unit_id LEFT JOIN positions p ON p.id=e.position_id WHERE i.token_hash=${hashToken(token)}`;
  if (!c) throw new Error("Link inválido.");
  if (c.estado !== "ATIVO" || c.expira_em < hoje()) throw new Error("Este link não está mais ativo. Peça um novo ao RH do Colégio Status.");
  if (marcar) await sql`UPDATE admission_invites SET aberto_em=coalesce(aberto_em, now()) WHERE id=${c.inviteId}`;
  return c;
}

/** Quem revisa e aplica alterações cadastrais: RH e Direção. */
export const podeRevisarCadastro = (s: Session) => ["RH", "DIRECAO"].includes(s.role);
export const ORIGEM: Record<string, string> = { MEU_ESPACO: "Meu espaço", ADMISSAO: "Ficha de admissão (link)", RH: "RH" };
export const TIPO_PEDIDO: Record<string, string> = { CADASTRO: "Dados cadastrais", DEPENDENTE: "Dependentes", ADMISSAO: "Ficha de admissão" };
export const STATUS_PEDIDO: Record<string, string> = { PENDENTE: "Aguardando o RH", APROVADO: "Aplicado", PARCIAL: "Aplicado em parte", RECUSADO: "Recusado", CANCELADO: "Cancelado" };
export const TOM_PEDIDO: Record<string, string> = { PENDENTE: "PENDENTE", APROVADO: "APROVADA", PARCIAL: "APROVADA", RECUSADO: "REJEITADA", CANCELADO: "CANCELADA" };
