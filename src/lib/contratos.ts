import { sql } from "@/db";
import { hoje, addDays, getSettings } from "./utils";
import type { Session } from "./auth";

/** Contratos: Direção, Financeiro, Operações, RH e diretor(a) da unidade (só da unidade). Licenças: Direção, Operações, RH e diretor(a) da unidade. */
export const PERFIS_CONTRATO = ["DIRECAO", "FINANCEIRO", "OPERACOES", "RH", "DIRETOR_UNIDADE"];
export const PERFIS_LICENCA = ["DIRECAO", "OPERACOES", "RH", "DIRETOR_UNIDADE"];
export const podeContratos = (s: Session) => PERFIS_CONTRATO.includes(s.role);
export const podeLicencas = (s: Session) => PERFIS_LICENCA.includes(s.role);
/** Quem vê (sem editar): os mesmos perfis + Leitura (auditoria). Coordenação, comercial e colaboradores não veem contratos nem licenças. */
export const veContratos = (s: Session) => podeContratos(s) || s.role === "LEITURA";
export const veLicencas = (s: Session) => podeLicencas(s) || s.role === "LEITURA";

export const RENOVACAO: Record<string, string> = { AUTOMATICA: "Renovação automática", MANUAL: "Renovação negociada", SEM_RENOVACAO: "Sem renovação" };
export const CONTRATO_STATUS: Record<string, string> = { VIGENTE: "Vigente", ENCERRADO: "Encerrado", CANCELADO: "Cancelado" };
export const INDICES = ["IPCA", "IGP-M", "INPC", "Fixo / sem reajuste", "Outro"];
export const TIPO_LICENCA: Record<string, string> = {
  ALVARA_FUNCIONAMENTO: "Alvará de localização e funcionamento", AVCB: "AVCB — Corpo de Bombeiros", SANITARIA: "Licença sanitária (Vigilância Sanitária)", AUTORIZACAO_ENSINO: "Ato autorizativo de funcionamento (Conselho/SED)",
  LAUDO_ELETRICO: "Laudo das instalações elétricas", SPDA: "Laudo do SPDA (para-raios)", CAIXA_DAGUA: "Limpeza e laudo da caixa d'água", CONTROLE_PRAGAS: "Controle de pragas", EXTINTORES: "Recarga e inspeção de extintores", ACESSIBILIDADE: "Laudo de acessibilidade", SEGURO: "Seguro do imóvel e responsabilidade civil", OUTRO: "Outro documento",
};
/** Tipos que formam a matriz por unidade (o "Outro" só aparece quando cadastrado). */
export const MATRIZ_LICENCAS = Object.keys(TIPO_LICENCA).filter(k => k !== "OUTRO");
export const LIC_SIT: Record<string, [string, string]> = { EM_DIA: ["APROVADA", "Em dia"], VENCE: ["PENDENTE", "Vence em breve"], VENCIDA: ["REJEITADA", "Vencida"], SEM_VALIDADE: ["NEUTRO", "Sem validade"], NAO_CADASTRADA: ["CANCELADA", "Não cadastrada"], DISPENSADA: ["CANCELADA", "Não se aplica"] };

const dias = (de: string, ate: string) => Math.round((Date.parse(ate + "T00:00:00Z") - Date.parse(de + "T00:00:00Z")) / 86400000);
/** Situação do contrato: vencido, prazo de denúncia (aviso prévio) chegando, vencendo nos avisos configurados, reajuste próximo. */
export function situacaoContrato(c: { status: string; fim: string | null; aviso_previo_dias: number; renovacao: string; proximo_reajuste: string | null }, avisos: number[], h = hoje()) {
  const alertas: { nivel: "ALTO" | "MEDIO"; texto: string }[] = [];
  if (c.status !== "VIGENTE") return { chave: c.status, alertas, diasFim: null as number | null, limite: null as string | null };
  if (!c.fim) { if (c.proximo_reajuste && c.proximo_reajuste >= h && dias(h, c.proximo_reajuste) <= 30) alertas.push({ nivel: "MEDIO", texto: `reajuste em ${dias(h, c.proximo_reajuste)} dia(s)` }); return { chave: "PRAZO_INDETERMINADO", alertas, diasFim: null, limite: null }; }
  const df = dias(h, c.fim); const limite = addDays(c.fim, -c.aviso_previo_dias);
  if (df < 0) alertas.push({ nivel: "ALTO", texto: `vencido há ${-df} dia(s) — renove, encerre ou registre a renovação automática` });
  else {
    if (c.renovacao !== "SEM_RENOVACAO" && h <= limite && dias(h, limite) <= 15) alertas.push({ nivel: "ALTO", texto: `prazo para avisar a não renovação termina em ${dias(h, limite)} dia(s)` });
    const marco = [...avisos].sort((a, b) => a - b).find(a => df <= a); if (marco !== undefined) alertas.push({ nivel: df <= Math.min(...avisos) ? "ALTO" : "MEDIO", texto: `vence em ${df} dia(s)` });
  }
  if (c.proximo_reajuste && c.proximo_reajuste >= h && dias(h, c.proximo_reajuste) <= 30) alertas.push({ nivel: "MEDIO", texto: `reajuste em ${dias(h, c.proximo_reajuste)} dia(s)` });
  return { chave: df < 0 ? "VENCIDO" : alertas.length ? "ATENCAO" : "EM_DIA", alertas, diasFim: df, limite };
}
export function situacaoLicenca(l: { status: string; validade: string | null; antecedencia_dias: number } | null, h = hoje()) {
  if (!l) return "NAO_CADASTRADA"; if (l.status === "DISPENSADA") return "DISPENSADA"; if (!l.validade) return "SEM_VALIDADE";
  return l.validade < h ? "VENCIDA" : l.validade <= addDays(h, l.antecedencia_dias) ? "VENCE" : "EM_DIA";
}

export type LicRow = { id: number; unit_id: number; unidade: string; tipo: string; nome: string | null; orgao: string | null; numero: string | null; emissao: string | null; validade: string | null; antecedencia_dias: number; responsavel: string | null; responsavel_user_id: number | null; status: string; obs: string | null; anexos: number };
/** Licenças vigentes (ativas ou dispensadas) por unidade e tipo, com a situação e a matriz de lacunas. */
export async function painelLicencas(unitId: number | null) {
  const rows = await sql<LicRow[]>`SELECT l.id, l.unit_id, u.nome AS unidade, l.tipo, l.nome, l.orgao, l.numero, l.emissao::text, l.validade::text, l.antecedencia_dias, us.nome AS responsavel, l.responsavel_user_id, l.status, l.obs, (SELECT count(*) FROM attachments a WHERE a.entidade='license' AND a.entidade_id=l.id)::int AS anexos FROM licenses l JOIN units u ON u.id=l.unit_id LEFT JOIN users us ON us.id=l.responsavel_user_id WHERE l.status IN ('ATIVA','DISPENSADA') ${unitId === null ? sql`` : sql`AND l.unit_id=${unitId}`} ORDER BY u.nome, l.tipo, l.validade NULLS LAST`;
  const units = await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ${unitId === null ? sql`` : sql`WHERE id=${unitId}`} ORDER BY nome`;
  const lista = rows.map(r => ({ ...r, situacao: situacaoLicenca(r) }));
  const matriz = units.map(u => ({ ...u, tipos: Object.fromEntries(MATRIZ_LICENCAS.map(t => { const ls = lista.filter(l => l.unit_id === u.id && l.tipo === t); const pior = ["VENCIDA", "VENCE", "SEM_VALIDADE", "EM_DIA", "DISPENSADA"].find(st => ls.some(l => l.situacao === st)); return [t, { situacao: pior ?? "NAO_CADASTRADA", id: ls.find(l => l.situacao === pior)?.id ?? null }]; })) }));
  return { lista, matriz, units };
}
export async function alertasContratosLicencas(unitId: number | null) {
  const cfg = await getSettings(); const h = hoje();
  const cs = await sql<{ id: number; objeto: string; fornecedor: string; status: string; fim: string | null; aviso_previo_dias: number; renovacao: string; proximo_reajuste: string | null; unit_id: number | null; responsavel_user_id: number | null }[]>`SELECT c.id, c.objeto, s.nome AS fornecedor, c.status, c.fim::text, c.aviso_previo_dias, c.renovacao, c.proximo_reajuste::text, c.unit_id, c.responsavel_user_id FROM contracts c JOIN suppliers s ON s.id=c.supplier_id WHERE c.status='VIGENTE' ${unitId === null ? sql`` : sql`AND (c.unit_id IS NULL OR c.unit_id=${unitId})`}`;
  const contratos = cs.map(c => ({ ...c, sit: situacaoContrato(c, cfg.contratos.avisos as number[], h) })).filter(c => c.sit.alertas.length);
  const { lista } = await painelLicencas(unitId);
  return { contratos, licencas: lista.filter(l => ["VENCIDA", "VENCE"].includes(l.situacao)) };
}
