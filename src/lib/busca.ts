import { sql } from "@/db";
import { scopeUnit, can, type Session } from "./auth";
import { veContratos } from "./contratos";
import { kpisVisiveis, vePainelExecutivo } from "./kpi";
import { nomeKpi } from "./kpi-catalogo";
import { getSettings } from "./utils";

/**
 * Busca global (v23 · Ctrl+K): pessoas, alunos, solicitações, casos, chamados, ações, projetos, POPs, contratos e indicadores —
 * só o que o perfil já pode abrir nos módulos, no escopo da unidade. Sem acento e sem diferença de maiúsculas.
 * Nada de dado sensível no resultado: nome, unidade e o que é — o resto fica na tela de destino.
 */
export type ResultadoBusca = { grupo: string; titulo: string; sub: string | null; href: string };
const DE = "áàâãäéèêëíìîïóòôõöúùûüçñ", PARA = "aaaaaeeeeiiiiooooouuuucn";
export const normalizar = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
const campo = (col: ReturnType<typeof sql>) => sql`translate(lower(${col}), ${DE}, ${PARA})`;

export async function buscar(s: Session, termo: string, porGrupo = 6): Promise<ResultadoBusca[]> {
  const q = normalizar(termo).slice(0, 60); if (q.length < 2) return [];
  const like = `%${q.replace(/[%_\\]/g, m => `\\${m}`)}%`; const escopo = scopeUnit(s); const r = s.role;
  const uf = (col: string) => escopo === null ? sql`` : sql`AND ${sql(col)}=${escopo}`;
  const staff = ["DIRECAO", "RH", "DIRETOR_UNIDADE", "GESTOR", "LEITURA"].includes(r);
  const matric = !["COLABORADOR", "OPERACOES"].includes(r);
  const atend = ["DIRECAO", "RH", "DIRETOR_UNIDADE", "GESTOR", "COMERCIAL", "LEITURA"].includes(r);
  const gest = r !== "COLABORADOR";
  const tarefas: Promise<ResultadoBusca[]>[] = [];
  if (staff) tarefas.push(sql<{ id: number; nome: string; unidade: string; cargo: string | null; situacao: string }[]>`SELECT e.id, e.nome, un.nome AS unidade, p.nome AS cargo, e.situacao FROM employees e JOIN units un ON un.id=e.unit_id LEFT JOIN positions p ON p.id=e.position_id WHERE ${campo(sql`e.nome`)} LIKE ${like} ${uf("e.unit_id")} ORDER BY (e.situacao='DESLIGADO'), e.nome LIMIT ${porGrupo}`
    .then(xs => xs.map(x => ({ grupo: "Colaboradores", titulo: x.nome, sub: [x.cargo, x.unidade, x.situacao === "DESLIGADO" ? "desligado" : null].filter(Boolean).join(" · "), href: `/colaboradores/${x.id}` }))));
  if (matric) tarefas.push(sql<{ id: number; nome: string; atual: boolean; unidade: string | null; serie: string | null }[]>`SELECT st.id, st.nome, st.aluno_atual AS atual, un.nome AS unidade, g.nome AS serie FROM students st LEFT JOIN units un ON un.id=st.unit_atual_id LEFT JOIN grades g ON g.id=st.serie_atual_id WHERE (${campo(sql`st.nome`)} LIKE ${like} OR ${campo(sql`coalesce(st.responsavel, '')`)} LIKE ${like}) ${escopo === null ? sql`` : sql`AND (st.unit_atual_id=${escopo} OR st.unit_atual_id IS NULL)`} ORDER BY st.aluno_atual DESC, st.nome LIMIT ${porGrupo}`
    .then(xs => xs.map(x => ({ grupo: "Alunos e candidatos", titulo: x.nome, sub: [x.atual ? "aluno" : "candidato", x.serie, x.unidade].filter(Boolean).join(" · "), href: `/matriculas/alunos/${x.id}` }))));
  // mesma regra da tela da solicitação: quem pediu, quem aprova (qualquer etapa), Direção/RH/Financeiro e a direção da unidade
  tarefas.push(sql<{ id: number; numero: string; titulo: string; status: string }[]>`SELECT id, numero, titulo, status FROM requests r
      WHERE (r.solicitante_user_id=${s.id} OR EXISTS (SELECT 1 FROM jsonb_array_elements(r.etapas) e WHERE e->'aprovadores' @> ${JSON.stringify([s.id])}::jsonb) OR ${["DIRECAO", "RH", "FINANCEIRO"].includes(r)} OR (${r === "DIRETOR_UNIDADE"} AND r.unit_id=${s.unitId ?? 0}))
        AND (${campo(sql`r.titulo`)} LIKE ${like} OR lower(r.numero) LIKE ${like}) ORDER BY r.created_at DESC LIMIT ${porGrupo}`
    .then(xs => xs.map(x => ({ grupo: "Solicitações", titulo: `${x.numero} · ${x.titulo}`, sub: x.status.replace("_", " ").toLowerCase(), href: `/solicitacoes/${x.id}` }))));
  if (atend) tarefas.push(sql<{ id: number; assunto: string; unidade: string | null; status: string }[]>`SELECT c.id, c.assunto, un.nome AS unidade, c.status FROM cases c LEFT JOIN units un ON un.id=c.unit_id WHERE ${campo(sql`c.assunto`)} LIKE ${like} ${uf("c.unit_id")} ORDER BY c.created_at DESC LIMIT ${porGrupo}`
    .then(xs => xs.map(x => ({ grupo: "Casos das famílias", titulo: x.assunto, sub: [x.unidade, x.status.replace(/_/g, " ").toLowerCase()].filter(Boolean).join(" · "), href: `/atendimento/casos/${x.id}` }))));
  // chamados: quem não é de operações vê só os que abriu (mesma regra da lista de chamados)
  tarefas.push(sql<{ id: number; titulo: string; unidade: string | null; status: string }[]>`SELECT w.id, w.titulo, un.nome AS unidade, w.status FROM work_orders w LEFT JOIN units un ON un.id=w.unit_id WHERE ${campo(sql`w.titulo`)} LIKE ${like} ${uf("w.unit_id")} ${can.operacoes(s) ? sql`` : sql`AND w.solicitante_user_id=${s.id}`} ORDER BY w.created_at DESC LIMIT ${porGrupo}`
    .then(xs => xs.map(x => ({ grupo: "Chamados", titulo: x.titulo, sub: [x.unidade, x.status.replace(/_/g, " ").toLowerCase()].filter(Boolean).join(" · "), href: `/operacoes/chamados/${x.id}` }))));
  if (gest) {
    tarefas.push(sql<{ id: number; titulo: string; status: string; prazo: string | null }[]>`SELECT id, titulo, status, prazo::text FROM action_plans WHERE ${campo(sql`titulo`)} LIKE ${like} ${escopo === null ? sql`` : sql`AND (unit_id IS NULL OR unit_id=${escopo})`} ORDER BY (status IN ('CONCLUIDA','CANCELADA')), prazo NULLS LAST LIMIT ${porGrupo}`
      .then(xs => xs.map(x => ({ grupo: "Plano de ação", titulo: x.titulo, sub: `${x.status.replace(/_/g, " ").toLowerCase()}${x.prazo ? ` · prazo ${x.prazo.split("-").reverse().join("/")}` : ""}`, href: `/estrategia/acoes/${x.id}` }))));
    tarefas.push(sql<{ id: number; nome: string; status: string }[]>`SELECT id, nome, status FROM projects WHERE ${campo(sql`nome`)} LIKE ${like} ${escopo === null ? sql`` : sql`AND (unit_id IS NULL OR unit_id=${escopo})`} ORDER BY nome LIMIT ${porGrupo}`
      .then(xs => xs.map(x => ({ grupo: "Projetos", titulo: x.nome, sub: x.status.replace(/_/g, " ").toLowerCase(), href: `/estrategia/projetos/${x.id}` }))));
  }
  tarefas.push(sql<{ id: number; codigo: string; titulo: string; area: string | null }[]>`SELECT id, codigo, titulo, area FROM procedures WHERE status IN ('VIGENTE','EM_REVISAO') AND (${campo(sql`titulo`)} LIKE ${like} OR lower(codigo) LIKE ${like}) ORDER BY codigo LIMIT ${porGrupo}`
    .then(xs => xs.map(x => ({ grupo: "POPs e processos", titulo: `${x.codigo} · ${x.titulo}`, sub: x.area, href: `/governanca/pops/${x.id}` }))));
  if (veContratos(s)) tarefas.push(sql<{ id: number; objeto: string; fornecedor: string | null }[]>`SELECT c.id, c.objeto, f.nome AS fornecedor FROM contracts c LEFT JOIN suppliers f ON f.id=c.supplier_id WHERE (${campo(sql`c.objeto`)} LIKE ${like} OR ${campo(sql`coalesce(f.nome, '')`)} LIKE ${like}) ${escopo === null ? sql`` : sql`AND (c.unit_id IS NULL OR c.unit_id=${escopo})`} ORDER BY c.fim NULLS LAST LIMIT ${porGrupo}`
    .then(xs => xs.map(x => ({ grupo: "Contratos", titulo: x.objeto, sub: x.fornecedor, href: `/operacoes/contratos/${x.id}` }))));
  if (vePainelExecutivo(s)) tarefas.push((async () => {
    const cfg = await getSettings(); const ano = cfg.matriculas.anoLetivo as number;
    return (await kpisVisiveis(s)).filter(k => normalizar(`${nomeKpi(k, ano)} ${k.formula}`).includes(q)).slice(0, porGrupo).map(k => ({ grupo: "Indicadores", titulo: nomeKpi(k, ano), sub: k.fonte, href: `/executivo/indicador/${encodeURIComponent(k.chave)}` }));
  })());
  const grupos = await Promise.all(tarefas.map(t => t.catch(() => [] as ResultadoBusca[])));
  return grupos.flat();
}
