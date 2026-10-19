import { requireMatriculas, scopeUnit } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Field, Select, Btn, Input } from "@/components/ui";
import { Funil } from "@/components/graficos";
import { Quadro, type ColunaQuadro, type CartaoQuadro, type TomCartao } from "@/components/Quadro";
import { fmtData, getSettings, hoje } from "@/lib/utils";
import { painelRematricula, type LinhaRem } from "@/lib/rematricula";
import { processarVencimentos } from "@/lib/matriculas";

export const dynamic = "force-dynamic";

const DIA = 86400000;
const diasDesde = (iso: string | null, h: string) => iso ? Math.max(0, Math.floor((Date.parse(`${h}T12:00:00Z`) - Date.parse(`${iso.slice(0, 10)}T12:00:00Z`)) / DIA)) : null;
const COLS: { chave: string; titulo: string; cor: string; descricao: string }[] = [
  { chave: "SEM_LINK", titulo: "Sem link", cor: "#94a3b8", descricao: "gere o link" },
  { chave: "GERADO", titulo: "Link gerado", cor: "#7a8696", descricao: "ainda não enviado" },
  { chave: "ENVIADO", titulo: "Link enviado", cor: "#4a90c2", descricao: "família não abriu" },
  { chave: "ABERTO", titulo: "Abriu, não concluiu", cor: "#e9a23b", descricao: "retome o contato" },
  { chave: "RESERVADA", titulo: "Reserva", cor: "#1f5fa0", descricao: "confirmar matrícula" },
  { chave: "MATRICULADA", titulo: "Matriculado", cor: "#1f7a4d", descricao: "concluído" },
  { chave: "RECUSOU", titulo: "Recusou", cor: "#a12b2b", descricao: "pedido de saída aberto" },
  { chave: "EXPIRADO", titulo: "Link expirado", cor: "#d1495b", descricao: "gere outro" },
];

/** Rematrícula em quadro: cada família na etapa em que está, com há quantos dias está parada — para a equipe agir em quem travou. */
export default async function QuadroRematricula({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireMatriculas(); const sp = await searchParams; const cfg = await getSettings(); const ano = cfg.matriculas.anoLetivo as number; const h = hoje();
  await processarVencimentos();
  const escopo = scopeUnit(s); const units = await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ORDER BY nome`;
  const unidade = escopo ?? (units.some(u => u.id === Number(sp.unidade)) ? Number(sp.unidade) : null);
  const todas = (await painelRematricula(ano, unidade)).filter(r => r.situacao !== "CONCLUINTE");
  const carteiras = [...new Map(todas.filter(r => r.carteira_user_id).map(r => [r.carteira_user_id!, r.carteira ?? "—"])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const carteira = sp.carteira === "minha" ? s.id : Number(sp.carteira) || null;
  const q = (sp.q ?? "").trim().toLowerCase();
  const rows = todas.filter(r => (!carteira || r.carteira_user_id === carteira) && (!q || r.nome.toLowerCase().includes(q) || (r.responsavel ?? "").toLowerCase().includes(q)));
  const alerta = Number(cfg.rematricula?.lembreteAbertoDias ?? 2);
  const cartao = (r: LinhaRem): CartaoQuadro => {
    const ref = r.situacao === "ENVIADO" ? r.enviado_em : r.situacao === "ABERTO" ? r.aberto_em : null; const d = diasDesde(ref, h);
    const tom: TomCartao | null = d === null ? null : d >= 7 ? "ruim" : d >= alerta ? "atencao" : null;
    const vence = r.situacao === "RESERVADA" && r.reserva_ate ? r.reserva_ate : null;
    return {
      chave: String(r.student_id), titulo: r.nome, href: `/matriculas/alunos/${r.student_id}`, responsavel: r.carteira,
      linhas: [`${r.serie_atual ?? "—"} → ${r.serie_prevista ?? "—"}`, unidade === null ? r.unidade : null, r.situacao === "RECUSOU" && r.recusa_motivo ? `Motivo: ${r.recusa_motivo}` : r.situacao === "RESERVADA" && r.mat_turma ? `Turma: ${r.mat_turma}` : null],
      selos: [
        ...(d !== null ? [{ texto: d === 0 ? "hoje" : `parado há ${d} dia(s)`, tom: (tom ?? "neutro") as TomCartao }] : []),
        ...(vence ? [{ texto: `reserva até ${fmtData(vence)}`, tom: (vence <= h ? "atencao" : "neutro") as TomCartao }] : []),
        ...(r.situacao === "RESERVADA" && r.contrato === false ? [{ texto: "contrato pendente", tom: "atencao" as const }] : []),
        ...(r.situacao === "RESERVADA" && r.financeiro === false ? [{ texto: "financeiro pendente", tom: "atencao" as const }] : []),
      ],
      destaque: tom ?? (r.situacao === "MATRICULADA" ? "bom" : r.situacao === "RECUSOU" || r.situacao === "EXPIRADO" ? "ruim" : null),
    };
  };
  const base = rows.length; const pct = (n: number) => base ? `${Math.round((100 * n) / base)}% da base` : null;
  const colunas: ColunaQuadro[] = COLS.map(c => { const xs = rows.filter(r => r.situacao === c.chave); return { ...c, total: pct(xs.length), itens: xs.sort((a, b) => (diasDesde(b.enviado_em ?? b.aberto_em, h) ?? -1) - (diasDesde(a.enviado_em ?? a.aberto_em, h) ?? -1)).map(cartao), mais: { texto: "abrir no painel", href: `/matriculas/rematricula?situacao=${c.chave}${unidade ? `&unidade=${unidade}` : ""}` } }; });
  const n = (k: string) => rows.filter(r => r.situacao === k).length;
  const enviados = base - n("SEM_LINK") - n("GERADO"); const abertos = n("ABERTO") + n("RESERVADA") + n("MATRICULADA") + n("RECUSOU"); const decididos = n("RESERVADA") + n("MATRICULADA");
  return (
    <Page title={`Rematrícula ${ano} — quadro`} sub="Cada família na etapa em que está. “Parado há N dias” conta desde o envio do link ou desde que a família abriu sem concluir; âmbar a partir do lembrete configurado, vermelho com 7 dias."
      actions={<div className="flex flex-wrap gap-2 print:hidden"><Btn kind="ghost" href={`/matriculas/rematricula${unidade ? `?unidade=${unidade}` : ""}`}>Painel e links</Btn><Btn kind="ghost" href="/matriculas/metas">Metas e previsão</Btn></div>}>
      <form className="mb-3 flex flex-wrap items-end gap-2 print:hidden">
        {escopo === null && <Field label="Unidade"><Select name="unidade" defaultValue={unidade ?? ""}><option value="">Rede</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>}
        <Field label="Carteira"><Select name="carteira" defaultValue={sp.carteira ?? ""}><option value="">Todas</option><option value="minha">Minha carteira</option>{carteiras.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}</Select></Field>
        <Field label="Buscar"><Input name="q" defaultValue={sp.q ?? ""} placeholder="aluno ou responsável" /></Field>
        <Btn kind="ghost">Ver</Btn>
      </form>
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,2fr)]">
        <div className="rounded-md border border-line bg-white p-4"><Funil rotulo="Funil da rematrícula" etapas={[{ rotulo: "Alunos na base", valor: base }, { rotulo: "Abordadas", sub: "link enviado ou já decidiram", valor: enviados }, { rotulo: "Responderam", sub: "abriram, reservaram ou recusaram", valor: abertos }, { rotulo: "Reserva ou matrícula", valor: decididos }]} /></div>
        <div className="grid grid-cols-2 content-start gap-3 sm:grid-cols-4">{[["Matriculados", n("MATRICULADA"), "text-ok"], ["Reservas", n("RESERVADA"), "text-acao"], ["Pararam (abriram sem concluir)", n("ABERTO"), "text-aviso"], ["Recusas", n("RECUSOU"), "text-erro"]].map(([t, v, c]) => <div key={t as string} className="rounded-md border border-line bg-white px-3 py-2.5"><div className="text-xs text-slate-600">{t}</div><div className={`text-2xl font-semibold tabular-nums ${c}`}>{v}</div><div className="text-[11px] text-slate-500">{base ? `${Math.round((100 * (v as number)) / base)}%` : "—"}</div></div>)}</div>
      </div>
      <Quadro rotulo="Quadro da rematrícula" colunas={colunas} max={30} />
    </Page>
  );
}
