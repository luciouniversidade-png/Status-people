/**
 * v34 · Divisão do PDF da folha por pessoa: o contador manda um PDF único com todos os holerites (ou recibos de férias, 13º,
 * PLR, informes de rendimentos); o ONE lê o texto de cada página, acha o dono pelo CPF (ou, na falta, pelo nome completo),
 * mostra a prévia para o RH conferir e só então publica um PDF por pessoa no Meu espaço de cada uma.
 * O CPF lido nas páginas é usado só na memória para casar a página com a ficha: a prévia guarda a página e a ficha, nunca o CPF.
 */
import { sql } from "@/db";

export const TIPOS_DIVISAO: Record<string, string> = {
  HOLERITES: "Holerites (contracheques) do mês", ADIANTAMENTO: "Recibos de adiantamento (vale)", RECIBO_FERIAS: "Recibos de férias", DECIMO_TERCEIRO: "Recibos do 13º salário", PLR: "Recibos de PLR",
  INFORME_RENDIMENTOS: "Informes de rendimentos (IRPF) do ano",
};
/** Rótulo curto de cada documento pessoal (lista do Meu espaço e avisos). */
export const DOC_PESSOAL: Record<string, string> = { HOLERITES: "Holerite", HOLERITE: "Holerite", ADIANTAMENTO: "Adiantamento", RECIBO_FERIAS: "Recibo de férias", DECIMO_TERCEIRO: "13º salário", PLR: "PLR", INFORME_RENDIMENTOS: "Informe de rendimentos" };
export const anual = (tipo: string) => tipo === "INFORME_RENDIMENTOS";
export const fmtCompetencia = (c: string | null | undefined) => !c ? "—" : /^\d{4}$/.test(c) ? `ano-calendário ${c}` : `${c.slice(5, 7)}/${c.slice(0, 4)}`;

export type PaginaDivisao = { pagina: number; employeeId: number | null; nome: string | null; por: "CPF" | "NOME" | "CONTINUACAO" | "MANUAL" | null; alerta?: string | null };
type Pessoa = { id: number; nome: string; cpf: string | null };

const soDig = (t: string | null | undefined) => (t ?? "").replace(/\D/g, "");
export const normNome = (t: string) => ` ${t.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z]+/g, " ").replace(/\s+/g, " ").trim()} `;
// CPF com ou sem pontuação, aceitando espaços que a extração de texto às vezes insere entre os grupos
const RE_CPF = /(?<!\d)(\d{3})[.\s]?(\d{3})[.\s]?(\d{3})\s?[-–]?\s?(\d{2})(?!\d)/g;

/** Quem pode receber o documento: ativos no período (holerite de rescisão inclui quem saiu no mês); informe: quem trabalhou no ano. */
export async function pessoasDoPeriodo(tipo: string, competencia: string, companyId: number | null): Promise<Pessoa[]> {
  const ini = anual(tipo) ? `${competencia}-01-01` : `${competencia}-01`;
  const fim = anual(tipo) ? `${competencia}-12-31` : new Date(Date.UTC(Number(competencia.slice(0, 4)), Number(competencia.slice(5, 7)), 0)).toISOString().slice(0, 10);
  return sql<Pessoa[]>`SELECT e.id, e.nome, e.cpf FROM employees e WHERE e.situacao <> 'EM_ADMISSAO' AND e.admissao <= ${fim} AND (e.desligamento IS NULL OR e.desligamento >= ${ini})
    ${companyId ? sql`AND e.company_id=${companyId}` : sql``} ORDER BY e.nome`;
}

/** Acha o dono de cada página. Página sem identificação logo depois de uma identificada vira “continuação” (marcada para conferir). */
export function identificarPaginas(textos: string[], pessoas: Pessoa[]): PaginaDivisao[] {
  const porCpf = new Map<string, Pessoa>(); for (const p of pessoas) { const d = soDig(p.cpf); if (d.length === 11) porCpf.set(d, p); }
  const nomes = pessoas.map(p => ({ p, n: normNome(p.nome) })).filter(x => x.n.trim().split(" ").length >= 2);
  const contagemNome = new Map<string, number>(); for (const x of nomes) contagemNome.set(x.n, (contagemNome.get(x.n) ?? 0) + 1);
  const out: PaginaDivisao[] = [];
  textos.forEach((t, i) => {
    const pagina = i + 1;
    const cpfs = new Set<string>(); for (const m of t.matchAll(RE_CPF)) cpfs.add(m.slice(1, 5).join(""));
    const achadosCpf = [...new Set([...cpfs].map(c => porCpf.get(c)).filter((x): x is Pessoa => !!x))];
    if (achadosCpf.length === 1) { out.push({ pagina, employeeId: achadosCpf[0].id, nome: achadosCpf[0].nome, por: "CPF" }); return; }
    if (achadosCpf.length > 1) { out.push({ pagina, employeeId: null, nome: null, por: null, alerta: `CPF de ${achadosCpf.length} pessoas na mesma página: escolha o dono.` }); return; }
    const tn = normNome(t);
    const porNome = nomes.filter(x => tn.includes(x.n));
    if (porNome.length) {
      const maior = Math.max(...porNome.map(x => x.n.length)); const melhores = porNome.filter(x => x.n.length === maior);
      const distintos = [...new Set(melhores.map(x => x.p.id))];
      if (distintos.length === 1 && (contagemNome.get(melhores[0].n) ?? 0) === 1) { const p = melhores[0].p; out.push({ pagina, employeeId: p.id, nome: p.nome, por: "NOME", alerta: cpfs.size ? "CPF da página não confere com a ficha: achado pelo nome — confira." : null }); return; }
      out.push({ pagina, employeeId: null, nome: null, por: null, alerta: distintos.length > 1 ? "Mais de um nome da equipe na página: escolha o dono." : "Nome repetido na equipe (homônimos): escolha o dono." }); return;
    }
    const ant = out[out.length - 1];
    if (ant?.employeeId && cpfs.size === 0 && t.trim().length > 0) { out.push({ pagina, employeeId: ant.employeeId, nome: ant.nome, por: "CONTINUACAO", alerta: "Página sem nome nem CPF: atribuída à pessoa da página anterior — confira." }); return; }
    out.push({ pagina, employeeId: null, nome: null, por: null, alerta: t.trim() ? (cpfs.size ? "CPF de quem não está na equipe do período (ou ficha sem CPF)." : "Nenhum nome ou CPF da equipe nesta página.") : "Página sem texto (imagem digitalizada): escolha o dono ou deixe de fora." });
  });
  return out;
}

/** Agrupa as páginas por pessoa, na ordem do PDF. */
export function agrupar(paginas: PaginaDivisao[]) {
  const m = new Map<number, { employeeId: number; nome: string; paginas: number[] }>();
  for (const p of paginas) if (p.employeeId) { const g = m.get(p.employeeId) ?? { employeeId: p.employeeId, nome: p.nome ?? "", paginas: [] }; g.paginas.push(p.pagina); m.set(p.employeeId, g); }
  return [...m.values()];
}
