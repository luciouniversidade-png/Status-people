import Link from "@/components/Link";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, scopeUnit } from "@/lib/auth";
import { Page, Card, Table, Td, Badge, Flash, Field, Select, Input, Textarea, Stat, Btn } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { audit, getSettings, fmtData, fmtDataHora } from "@/lib/utils";
import { brl } from "@/lib/financeiro";
import { fmtReais } from "@/lib/formato";
import { podeOperar, podeVer, ISSUE_TIPO, DESFECHOS } from "@/lib/conciliacao";
import { atribuirPendencia, resolverPendencia, reabrirPendencia } from "./actions";

export const dynamic = "force-dynamic";
const SECRETARIA = ["NAO_IDENTIFICADO", "SEM_BAIXA", "VENDA_SEM_TITULO"];

/** T-039 · Divergências & pendências: a lista única do que não bateu — sistema × banco × operadora — com idade, dono e desfecho. */
export default async function Divergencias({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const sp = await searchParams;
  if (!podeVer(s)) { await audit(s, "acesso negado: divergências da conciliação", "recon_issues", null, null, { papel: s.role }); redirect("/?erro=" + encodeURIComponent("Divergências da conciliação são do Financeiro e da Direção — a tentativa foi registrada.")); }
  const cfg = await getSettings(); const opera = podeOperar(s); const secretaria = s.role === "COMERCIAL"; const escopo = scopeUnit(s);
  const situacao = ["abertas", "resolvidas", "todas"].includes(sp.situacao ?? "") ? sp.situacao! : "abertas"; const tipo = ISSUE_TIPO[sp.tipo ?? ""] ? sp.tipo! : ""; const idade = Number(sp.idade) || 0; const meus = sp.dono === "meus";
  const filtros = sql`${situacao === "abertas" ? sql`AND i.status='ABERTA'` : situacao === "resolvidas" ? sql`AND i.status='RESOLVIDA'` : sql``} ${tipo ? sql`AND i.tipo=${tipo}` : sql``} ${idade ? sql`AND i.status='ABERTA' AND i.created_at::date <= current_date - ${idade}::int` : sql``}
    ${meus ? sql`AND i.dono_user_id=${s.id}` : sql``} ${escopo !== null ? sql`AND i.unit_id=${escopo}` : sql``} ${secretaria ? sql`AND i.tipo = ANY(${SECRETARIA})` : sql``}`;
  const [itens, [st], aprendizado, donos] = await Promise.all([
    sql<{ id: number; tipo: string; origem: string; valor: number | null; descricao: string; unidade: string | null; dono: string | null; dono_user_id: number | null; prazo: string | null; idade: number; escalonamento: number; status: string; desfecho: string | null; desfecho_obs: string | null; resolvido_em: string | null; resolvido_por: string | null; referencia: string; anexos: number }[]>`
      SELECT i.id, i.tipo, i.origem, i.valor::float, i.descricao, un.nome AS unidade, u.nome AS dono, i.dono_user_id, i.prazo::text, (current_date - i.created_at::date)::int AS idade, i.escalonamento, i.status, i.desfecho, i.desfecho_obs, i.resolvido_em::text, ur.nome AS resolvido_por, i.referencia::text,
        (SELECT count(*) FROM attachments a WHERE a.entidade='recon_issue' AND a.entidade_id=i.id)::int AS anexos
      FROM recon_issues i LEFT JOIN units un ON un.id=i.unit_id LEFT JOIN users u ON u.id=i.dono_user_id LEFT JOIN users ur ON ur.id=i.resolvido_por WHERE 1=1 ${filtros}
      ORDER BY CASE WHEN i.status='ABERTA' THEN 0 ELSE 1 END, i.escalonamento DESC, i.created_at LIMIT 300`,
    sql<{ abertas: number; valor: number; d15: number; d30: number; media: number | null; semdono: number; resolvidas30: number }[]>`SELECT count(*) FILTER (WHERE status='ABERTA')::int AS abertas, coalesce(sum(abs(valor)) FILTER (WHERE status='ABERTA'),0)::float AS valor,
        count(*) FILTER (WHERE status='ABERTA' AND created_at::date <= current_date - 15)::int AS d15, count(*) FILTER (WHERE status='ABERTA' AND created_at::date <= current_date - 30)::int AS d30,
        avg(current_date - created_at::date) FILTER (WHERE status='ABERTA')::float AS media, count(*) FILTER (WHERE status='ABERTA' AND dono_user_id IS NULL)::int AS semdono, count(*) FILTER (WHERE status='RESOLVIDA' AND resolvido_em >= now() - interval '30 days')::int AS resolvidas30
      FROM recon_issues i WHERE 1=1 ${escopo !== null ? sql`AND i.unit_id=${escopo}` : sql``} ${secretaria ? sql`AND i.tipo = ANY(${SECRETARIA})` : sql``}`,
    sql<{ tipo: string; desfecho: string; n: number; valor: number }[]>`SELECT tipo, desfecho, count(*)::int AS n, coalesce(sum(abs(valor)),0)::float AS valor FROM recon_issues i WHERE status='RESOLVIDA' AND resolvido_em >= now() - interval '90 days' ${escopo !== null ? sql`AND i.unit_id=${escopo}` : sql``} GROUP BY 1, 2 ORDER BY n DESC LIMIT 12`,
    opera ? sql<{ id: number; nome: string; role: string }[]>`SELECT id, nome, role FROM users WHERE ativo AND role IN ('FINANCEIRO','DIRECAO','COMERCIAL','DIRETOR_UNIDADE') ORDER BY role, nome` : Promise.resolve([]),
  ]);
  const [d15, d30] = cfg.conciliacao.escalonamentoDias as number[]; const alcada = cfg.conciliacao.perdaAlcadaFinanceiro as number;
  const qs = (extra: Record<string, string>) => { const p = new URLSearchParams(Object.entries({ situacao, tipo, idade: idade ? String(idade) : "", dono: meus ? "meus" : "", ...extra }).filter(([, v]) => v)); return `/financeiro/divergencias${p.toString() ? `?${p}` : ""}`; };
  const voltar = qs({});
  return (
    <Page title="Divergências e pendências" sub="Tudo o que não bateu entre ActiveSoft, banco e Cielo, numa lista só — com idade, dono, prazo e desfecho documentado. Divergência esquecida é dinheiro perdido."
      actions={<><Btn kind="ghost" href={`/api/export/divergencias?situacao=${situacao}`}>Exportar CSV</Btn><Btn kind="ghost" href="/financeiro/recebimentos">Recebimentos do mês</Btn>{!secretaria && <Btn kind="ghost" href="/financeiro/conciliacao">Conciliação</Btn>}</>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Abertas" value={<span className={st.abertas ? "text-erro" : "text-ok"}>{st.abertas}</span>} hint={`${fmtReais(st.valor, true)} em jogo`} href={qs({ situacao: "abertas", idade: "" })} />
        <Stat label={`Há mais de ${d15} dias`} value={<span className={st.d15 ? "text-aviso" : ""}>{st.d15}</span>} hint="escaladas ao gestor financeiro" href={qs({ situacao: "abertas", idade: String(d15) })} />
        <Stat label={`Há mais de ${d30} dias`} value={<span className={st.d30 ? "text-erro" : ""}>{st.d30}</span>} hint="escaladas à Direção" href={qs({ situacao: "abertas", idade: String(d30) })} />
        <Stat label="Idade média" value={st.media === null ? "—" : `${Math.round(st.media)} d`} hint="das abertas (KPI-39)" />
        <Stat label="Sem dono" value={<span className={st.semdono ? "text-erro" : ""}>{st.semdono}</span>} hint="toda pendência precisa de um nome" />
        <Stat label="Resolvidas em 30 dias" value={st.resolvidas30} hint="com desfecho tipificado" href={qs({ situacao: "resolvidas", idade: "" })} />
      </div>
      <form className="mb-3 flex flex-wrap items-end gap-2 rounded-md border border-line bg-white p-3">
        <Field label="Situação" className="w-full sm:w-40"><Select name="situacao" defaultValue={situacao}><option value="abertas">Abertas</option><option value="resolvidas">Resolvidas</option><option value="todas">Todas</option></Select></Field>
        <Field label="Tipo" className="w-full sm:w-64"><Select name="tipo" defaultValue={tipo}><option value="">Todos</option>{Object.entries(ISSUE_TIPO).filter(([k]) => !secretaria || SECRETARIA.includes(k)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="Idade" className="w-full sm:w-40"><Select name="idade" defaultValue={idade ? String(idade) : ""}><option value="">Qualquer</option><option value={String(d15)}>+{d15} dias</option><option value={String(d30)}>+{d30} dias</option></Select></Field>
        <Field label="Dono" className="w-full sm:w-40"><Select name="dono" defaultValue={meus ? "meus" : ""}><option value="">Todos</option><option value="meus">Só as minhas</option></Select></Field>
        <Btn kind="ghost">Filtrar</Btn>
      </form>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <Card title={`${situacao === "abertas" ? "Abertas" : situacao === "resolvidas" ? "Resolvidas" : "Todas"} (${itens.length})`}>
          <Table head={["#", "Tipo", "O que não bateu", "Valor", "Idade", "Dono · prazo", ""]} empty="Nenhuma pendência neste filtro.">
            {itens.map(i => <tr key={i.id} id={`p${i.id}`} className={i.status === "ABERTA" && i.escalonamento >= 2 ? "bg-red-50/40" : ""}>
              <Td className="text-slate-500">{i.id}</Td>
              <Td><div className="text-sm font-medium text-ink">{ISSUE_TIPO[i.tipo] ?? i.tipo}</div><div className="text-[11px] text-slate-500">{i.origem} · {i.unidade ?? "rede"} · ref. {fmtData(i.referencia)}</div></Td>
              <Td className="max-w-[26rem] text-xs text-slate-700">{i.descricao}{i.status === "RESOLVIDA" && <div className="mt-1 rounded bg-mist px-2 py-1 text-[11px]"><b>{DESFECHOS[i.desfecho ?? ""]?.rotulo ?? i.desfecho}</b>{i.desfecho_obs ? ` — ${i.desfecho_obs}` : ""}<div className="text-slate-500">{i.resolvido_por ?? "sistema"} · {fmtDataHora(i.resolvido_em)}</div></div>}</Td>
              <Td className="whitespace-nowrap tabular-nums">{i.valor === null ? "—" : brl(i.valor)}</Td>
              <Td>{i.status !== "ABERTA" ? <Badge v="APROVADA" label="resolvida" /> : i.escalonamento >= 2 ? <Badge v="REJEITADA" label={`${i.idade} d · Direção`} /> : i.escalonamento === 1 ? <Badge v="PENDENTE" label={`${i.idade} d · financeiro`} /> : <span className="text-xs tabular-nums">{i.idade} d</span>}</Td>
              <Td className="text-xs">{i.dono ?? <span className="text-erro">sem dono</span>}<div className="text-[11px] text-slate-500">{i.prazo ? `prazo ${fmtData(i.prazo)}` : ""}{i.anexos ? ` · ${i.anexos} anexo(s)` : ""}</div></Td>
              <Td className="whitespace-nowrap">{i.status === "ABERTA" ? <div className="flex flex-col items-start gap-1">
                {(opera || SECRETARIA.includes(i.tipo)) && <Modal label="Resolver" kind="primary" title={`Resolver #${i.id} · ${ISSUE_TIPO[i.tipo] ?? i.tipo}`}><form action={resolverPendencia} className="space-y-2"><input type="hidden" name="id" value={i.id} /><input type="hidden" name="voltar" value={voltar} />
                  <p className="text-xs text-slate-600">{i.descricao}</p>
                  <Field label="Desfecho"><Select name="desfecho" required defaultValue="">{[["", "Escolha"], ...Object.entries(DESFECHOS).filter(([k]) => k !== "CONCILIADO_AUTO" && (opera || ["IDENTIFICADO", "BAIXA_REGISTRADA", "NAO_PROCEDE"].includes(k))).map(([k, v]) => [k, `${v.rotulo}${v.evidencia === "ARQUIVO" ? " (exige anexo)" : ""}`])].map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
                  <Field label="O que foi feito (fica no aprendizado)"><Textarea name="obs" required minLength={10} /></Field>
                  <Field label="Evidência (comprovante, carta da operadora, e-mail — PDF ou imagem)"><input type="file" name="arquivo" className="block w-full rounded-md border border-line bg-white px-2 py-1.5 text-xs file:mr-2 file:rounded file:border-0 file:bg-acao file:px-2 file:py-1 file:text-xs file:text-white" /></Field>
                  <p className="text-[11px] text-slate-500">Perda assumida acima de {brl(alcada)} só com a Direção.</p><Btn small>Encerrar pendência</Btn></form></Modal>}
                {opera && <Modal label="Atribuir" title={`Atribuir #${i.id}`}><form action={atribuirPendencia} className="space-y-2"><input type="hidden" name="id" value={i.id} /><input type="hidden" name="voltar" value={voltar} />
                  <Field label="Dono"><Select name="donoUserId" defaultValue={i.dono_user_id ?? ""}><option value="">—</option>{donos.map(d => <option key={d.id} value={d.id}>{d.nome}</option>)}</Select></Field><Field label="Prazo"><Input type="date" name="prazo" defaultValue={i.prazo ?? ""} /></Field><Btn small>Salvar</Btn></form></Modal>}
              </div> : opera ? <Modal label="Reabrir" title={`Reabrir #${i.id}`}><form action={reabrirPendencia} className="space-y-2"><input type="hidden" name="id" value={i.id} /><input type="hidden" name="voltar" value={voltar} /><Field label="Motivo"><Input name="motivo" required minLength={5} /></Field><Btn small>Reabrir</Btn></form></Modal> : null}</Td>
            </tr>)}
          </Table>
        </Card>
        <div className="space-y-4">
          <Card title="Aprendizado (90 dias)">
            {aprendizado.length === 0 ? <p className="text-sm text-slate-500">Nenhuma pendência resolvida nos últimos 90 dias.</p> :
              <ul className="space-y-1.5 text-xs">{aprendizado.map(x => <li key={`${x.tipo}${x.desfecho}`} className="flex justify-between gap-2"><span><b>{ISSUE_TIPO[x.tipo] ?? x.tipo}</b> → {DESFECHOS[x.desfecho]?.rotulo ?? x.desfecho}</span><span className="whitespace-nowrap tabular-nums text-slate-500">{x.n} · {brl(x.valor)}</span></li>)}</ul>}
            <p className="mt-2 text-[11px] text-slate-500">Desfecho que se repete aponta o processo a corrigir — leve ao comitê mensal.</p>
          </Card>
          <Card title="Regras">
            <ul className="list-disc space-y-1 pl-5 text-xs text-slate-600">
              <li>Toda pendência tem dono e prazo; a secretaria cuida de pagador não identificado e de baixa a registrar.</li>
              <li>Aberta há {d15} dias: escala ao gestor financeiro. Há {d30}: à Direção (CRQ-COB-V3-02).</li>
              <li>Encerrar exige desfecho tipificado e evidência; perda assumida acima de {brl(alcada)} só com a Direção.</li>
              <li>A conciliação resolve sozinha o que encontrou par depois — com trilha (“par encontrado numa nova conciliação”).</li>
              <li>A quitação oficial é do ActiveSoft: o sistema nunca dá baixa em título (CRQ-COB-V3-04).</li>
            </ul>
          </Card>
          {!secretaria && <Card title="Atalhos"><ul className="space-y-1 text-sm"><li><Link className="text-acao" href="/financeiro/conciliacao?aba=triagem">Triagem de pagadores</Link></li><li><Link className="text-acao" href="/financeiro/conciliacao?aba=cartao">Cartão: taxas e repasses</Link></li><li><Link className="text-acao" href="/financeiro/recebimentos">Fechamento da competência</Link></li></ul></Card>}
        </div>
      </div>
    </Page>
  );
}
