import { sql } from "@/db";
import type { Session } from "./auth";
import { getSettings, hoje, addDays } from "./utils";

/**
 * v27 · RH — contratos com prazo (Personio “probation periods / ending contracts”, adaptado à lei brasileira):
 * - Experiência (CLT e horista): 1º período (padrão 45 dias) e fim do contrato (padrão 90) — CLT art. 445, parágrafo único (máx. 90 dias, uma prorrogação).
 *   Sem decisão registrada até o fim, o contrato passa a prazo indeterminado: o sistema avisa antes e registra a decisão (prorrogar, efetivar, encerrar).
 * - Estágio: término do TCE e limite de 2 anos na mesma parte concedente (Lei 11.788/2008, art. 11 — exceto pessoa com deficiência).
 * - Temporário: 180 dias + prorrogação de até 90 (Lei 6.019/1974, art. 10, §§ 1º e 2º, com a Lei 13.429/2017).
 * O gestor direto recomenda; RH, Direção ou a direção da unidade decidem — tudo com trilha.
 */
export type TipoPrazo = "EXPERIENCIA" | "ESTAGIO" | "TEMPORARIO";
export const TIPO_PRAZO: Record<TipoPrazo, string> = { EXPERIENCIA: "Experiência", ESTAGIO: "Estágio (TCE)", TEMPORARIO: "Temporário" };
export const DECISAO_LABEL: Record<string, string> = { PRORROGAR: "Prorrogar", EFETIVAR: "Efetivar", ENCERRAR: "Encerrar no prazo", RENOVAR: "Renovar o TCE" };
export type SituacaoPrazo = "A_DECIDIR" | "VENCENDO" | "VENCIDO" | "SEM_DATA" | "DECIDIDO";
export const SITUACAO_PRAZO: Record<SituacaoPrazo, { rotulo: string; tom: string }> = {
  A_DECIDIR: { rotulo: "Em curso", tom: "ABERTO" }, VENCENDO: { rotulo: "Decidir agora", tom: "VENCE_EM_BREVE" }, VENCIDO: { rotulo: "Venceu sem decisão", tom: "VENCIDO" },
  SEM_DATA: { rotulo: "Sem término cadastrado", tom: "PENDENTE" }, DECIDIDO: { rotulo: "Decidido", tom: "APROVADA" },
};
export const decidePrazo = (s: Session) => ["RH", "DIRECAO", "DIRETOR_UNIDADE"].includes(s.role);
export const vePrazo = (s: Session) => ["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR", "LEITURA"].includes(s.role);

export type Prazo = {
  employee_id: number; nome: string; unidade: string; unit_id: number; gestor_id: number | null; gestor: string | null; vinculo: string; admissao: string; termino: string | null;
  tipo: TipoPrazo; etapa: number; rotulo: string; vence_em: string; dias: number; limite: string | null; situacao: SituacaoPrazo; opcoes: string[]; alerta: string | null;
  recomendacao: string | null; recomendacao_motivo: string | null; recomendado_por: string | null; decisao: string | null; motivo: string | null; decidido_por: string | null; decidido_em: string | null; nova_data: string | null;
};
const somaMeses = (iso: string, m: number) => { const d = new Date(iso + "T12:00:00Z"); const dia = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + m); const ult = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); d.setUTCDate(Math.min(dia, ult)); return d.toISOString().slice(0, 10); };
const diasAte = (d: string, h: string) => Math.round((Date.parse(d + "T00:00:00Z") - Date.parse(h + "T00:00:00Z")) / 86400000);

/** Prazos contratuais em curso (e, se pedido, os já decididos) do recorte: unidade, equipe de um gestor ou rede inteira. */
export async function prazosContratuais(f: { unitId: number | null; gestorId?: number | null; incluirDecididos?: boolean }): Promise<Prazo[]> {
  const cfg = await getSettings(); const c = cfg.contratosPrazo; const h = hoje(); const aviso = Number(c.avisoDias ?? 10);
  const p1 = Number(c.experienciaPrimeiroDias ?? 45), tot = Number(c.experienciaTotalDias ?? 90), estMeses = Number(c.estagioMaxMeses ?? 24), tDias = Number(c.temporarioDias ?? 180), tProrr = Number(c.temporarioProrrogacaoDias ?? 90);
  const emps = await sql<{ id: number; nome: string; unidade: string; unit_id: number; gestor_id: number | null; gestor: string | null; vinculo: string; admissao: string; termino: string | null }[]>`SELECT e.id, e.nome, u.nome AS unidade, e.unit_id, e.gestor_id, g.nome AS gestor, e.vinculo, e.admissao::text, e.termino_contrato::text AS termino
    FROM employees e JOIN units u ON u.id=e.unit_id LEFT JOIN employees g ON g.id=e.gestor_id
    WHERE e.situacao IN ('ATIVO','FERIAS','AFASTADO','EM_ADMISSAO') AND (e.vinculo IN ('ESTAGIARIO','TEMPORARIO') OR (e.vinculo IN ('CLT','HORISTA') AND e.admissao > ${addDays(h, -(tot + 60))}::date))
      ${f.unitId === null ? sql`` : sql`AND e.unit_id=${f.unitId}`} ${f.gestorId ? sql`AND e.gestor_id=${f.gestorId}` : sql``} ORDER BY e.nome`;
  if (!emps.length) return [];
  const regs = await sql<{ employee_id: number; tipo: string; etapa: number; vence_em: string; recomendacao: string | null; recomendacao_motivo: string | null; recomendado_por: string | null; decisao: string | null; motivo: string | null; nova_data: string | null; decidido_por: string | null; decidido_em: string | null }[]>`SELECT t.employee_id, t.tipo, t.etapa, t.vence_em::text, t.recomendacao, t.recomendacao_motivo, ur.nome AS recomendado_por, t.decisao, t.motivo, t.nova_data::text, ud.nome AS decidido_por, t.decidido_em::text
    FROM employment_terms t LEFT JOIN users ur ON ur.id=t.recomendado_por LEFT JOIN users ud ON ud.id=t.decidido_por WHERE t.employee_id = ANY(${emps.map(e => e.id)}::int[])`;
  const reg = (id: number, tipo: string, etapa: number) => regs.find(r => r.employee_id === id && r.tipo === tipo && r.etapa === etapa);
  const out: Prazo[] = [];
  const linha = (e: typeof emps[number], tipo: TipoPrazo, etapa: number, rotulo: string, vence: string, opcoes: string[], extra: { limite?: string | null; alerta?: string | null; semData?: boolean } = {}) => {
    const r = reg(e.id, tipo, etapa); const dias = diasAte(vence, h);
    const situacao: SituacaoPrazo = r?.decisao ? "DECIDIDO" : extra.semData ? "SEM_DATA" : dias < 0 ? "VENCIDO" : dias <= aviso ? "VENCENDO" : "A_DECIDIR";
    if (situacao === "DECIDIDO" && !f.incluirDecididos) return;
    out.push({ employee_id: e.id, nome: e.nome, unidade: e.unidade, unit_id: e.unit_id, gestor_id: e.gestor_id, gestor: e.gestor, vinculo: e.vinculo, admissao: e.admissao, termino: e.termino, tipo, etapa, rotulo, vence_em: vence, dias, limite: extra.limite ?? null, situacao, opcoes, alerta: extra.alerta ?? null,
      recomendacao: r?.recomendacao ?? null, recomendacao_motivo: r?.recomendacao_motivo ?? null, recomendado_por: r?.recomendado_por ?? null, decisao: r?.decisao ?? null, motivo: r?.motivo ?? null, decidido_por: r?.decidido_por ?? null, decidido_em: r?.decidido_em ?? null, nova_data: r?.nova_data ?? null });
  };
  for (const e of emps) {
    if (e.vinculo === "CLT" || e.vinculo === "HORISTA") {
      const v1 = addDays(e.admissao, p1 - 1), v2 = addDays(e.admissao, tot - 1); const d1 = reg(e.id, "EXPERIENCIA", 1)?.decisao;
      if (!d1) linha(e, "EXPERIENCIA", 1, `Fim do 1º período (${p1} dias)`, v1, ["PRORROGAR", "EFETIVAR", "ENCERRAR"], { alerta: diasAte(v1, h) < 0 ? `O 1º período venceu: confirme a prorrogação prevista no contrato (até ${addDays(e.admissao, tot - 1).split("-").reverse().join("/")}) ou a efetivação.` : null });
      else { if (f.incluirDecididos) linha(e, "EXPERIENCIA", 1, `Fim do 1º período (${p1} dias)`, v1, []);
        if (d1 === "PRORROGAR") linha(e, "EXPERIENCIA", 2, `Fim da experiência (${tot} dias)`, v2, ["EFETIVAR", "ENCERRAR"], { alerta: diasAte(v2, h) < 0 ? "Passou de 90 dias sem decisão registrada: o contrato já é por prazo indeterminado — registre a efetivação." : null }); }
    } else if (e.vinculo === "ESTAGIARIO") {
      const limite = addDays(somaMeses(e.admissao, estMeses), -1); const feitas = regs.filter(r => r.employee_id === e.id && r.tipo === "ESTAGIO" && r.decisao).length;
      if (f.incluirDecididos) for (let k = 1; k <= feitas; k++) { const r = reg(e.id, "ESTAGIO", k); if (r) linha(e, "ESTAGIO", k, k === 1 ? "Término do TCE" : `Término do TCE (${k}ª renovação)`, r.vence_em, [], { limite }); }
      const ultima = feitas ? reg(e.id, "ESTAGIO", feitas) : null; if (ultima && ["ENCERRAR", "EFETIVAR"].includes(ultima.decisao ?? "")) continue;
      const etapa = feitas + 1; const vence = e.termino && e.termino <= limite ? e.termino : limite;
      const pertoLimite = diasAte(limite, h) <= 60; linha(e, "ESTAGIO", etapa, etapa === 1 ? "Término do TCE" : `Término do TCE (${etapa - 1}ª renovação)`, vence, ["RENOVAR", "EFETIVAR", "ENCERRAR"], { limite, semData: !e.termino, alerta: !e.termino ? `Cadastre o término do TCE. Limite legal de 2 anos: ${limite.split("-").reverse().join("/")}.` : pertoLimite ? `Limite legal de 2 anos em ${limite.split("-").reverse().join("/")} (exceto pessoa com deficiência): não cabe nova renovação além dele.` : null });
    } else if (e.vinculo === "TEMPORARIO") {
      const legal1 = addDays(e.admissao, tDias - 1), legal2 = addDays(e.admissao, tDias + tProrr - 1); const d1 = reg(e.id, "TEMPORARIO", 1)?.decisao;
      if (!d1) linha(e, "TEMPORARIO", 1, `Fim do contrato temporário (${tDias} dias)`, e.termino && e.termino < legal1 ? e.termino : legal1, ["PRORROGAR", "EFETIVAR", "ENCERRAR"]);
      else { if (f.incluirDecididos) linha(e, "TEMPORARIO", 1, `Fim do contrato temporário (${tDias} dias)`, reg(e.id, "TEMPORARIO", 1)!.vence_em, []);
        if (d1 === "PRORROGAR") linha(e, "TEMPORARIO", 2, `Fim da prorrogação (até ${tDias + tProrr} dias)`, e.termino && e.termino <= legal2 ? e.termino : legal2, ["EFETIVAR", "ENCERRAR"]); }
    }
  }
  const ordem: Record<SituacaoPrazo, number> = { VENCIDO: 0, VENCENDO: 1, SEM_DATA: 2, A_DECIDIR: 3, DECIDIDO: 4 };
  return out.sort((a, b) => ordem[a.situacao] - ordem[b.situacao] || a.vence_em.localeCompare(b.vence_em) || a.nome.localeCompare(b.nome));
}
