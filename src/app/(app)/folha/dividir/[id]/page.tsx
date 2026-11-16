import Link from "@/components/Link";
import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Flash, Btn, Select, Stat, Table, Td } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { fmtDataHora } from "@/lib/utils";
import { podePreparar } from "@/lib/folha";
import { TIPOS_DIVISAO, fmtCompetencia, pessoasDoPeriodo, agrupar, type PaginaDivisao } from "@/lib/folha-dividir";
import { ajustarPagina, publicarDivisao, descartarDivisao } from "../actions";

export const dynamic = "force-dynamic";
const POR: Record<string, string> = { CPF: "pelo CPF", NOME: "pelo nome", CONTINUACAO: "continuação", MANUAL: "escolhido pelo RH" };

/** v34 · Prévia da divisão: o dono de cada página, quem ficou sem documento e o que conferir antes de publicar. */
export default async function Previa({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); if (!podePreparar(s)) redirect("/sem-acesso?t=%2Ffolha%2Fdividir"); const sp = await searchParams; const id = Number((await params).id);
  const [d] = await sql<{ id: number; tipo: string; competencia: string; nome_arquivo: string | null; attachment_id: number | null; paginas: number; status: string; user_nome: string | null; created_at: string; confirmado_em: string | null; publicados: number | null; resultado: { companyId: number | null; paginas: PaginaDivisao[] }; empresa: string | null }[]>`
    SELECT p.id, p.tipo, p.competencia, p.nome_arquivo, p.attachment_id, p.paginas, p.status, p.user_nome, p.created_at::text, p.confirmado_em::text, p.publicados, p.resultado, co.nome AS empresa
    FROM pdf_splits p LEFT JOIN companies co ON co.id=(p.resultado->>'companyId')::int WHERE p.id=${id}`;
  if (!d) notFound();
  const pags = d.resultado.paginas; const grupos = agrupar(pags); const previa = d.status === "PREVIA";
  const pessoas = await pessoasDoPeriodo(d.tipo, d.competencia, d.resultado.companyId);
  const comDoc = new Set(grupos.map(g => g.employeeId)); const semDoc = pessoas.filter(p => !comDoc.has(p.id));
  const semDono = pags.filter(p => !p.employeeId); const conferir = pags.filter(p => p.por === "CONTINUACAO" || (p.por === "NOME" && p.alerta));
  const pub = d.status === "PUBLICADO" ? await sql<{ employee_id: number; nome: string; abriu: string | null; conta: boolean }[]>`SELECT d.employee_id, e.nome, (SELECT min(v.at)::text FROM payroll_doc_views v JOIN users u ON u.id=v.user_id WHERE v.doc_id=d.id AND u.employee_id=d.employee_id) AS abriu, EXISTS (SELECT 1 FROM users x WHERE x.employee_id=d.employee_id AND x.ativo) AS conta FROM payroll_docs d JOIN employees e ON e.id=d.employee_id WHERE d.split_id=${id} ORDER BY e.nome` : [];
  const abriram = pub.filter(p => p.abriu).length;
  return (
    <Page title={`${TIPOS_DIVISAO[d.tipo] ?? d.tipo} · ${fmtCompetencia(d.competencia)}`} sub={`${d.nome_arquivo ?? "PDF"} · ${d.paginas} página(s) · ${d.empresa ?? "todas as empresas"} · enviado por ${d.user_nome ?? "—"} em ${fmtDataHora(d.created_at)}${d.confirmado_em ? ` · publicado em ${fmtDataHora(d.confirmado_em)}` : ""}`}
      actions={<span className="flex flex-wrap gap-2">{d.attachment_id ? <a className="inline-flex items-center rounded-md border border-line bg-white px-3 py-2 text-sm text-navy hover:bg-slate-50" href={`/api/anexos/${d.attachment_id}`} target="_blank" rel="noopener">PDF original</a> : null}<Btn kind="ghost" href="/folha/dividir">Voltar</Btn></span>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Pessoas com documento" value={grupos.length} hint={`de ${pessoas.length} na equipe do período`} />
        <Stat label="Páginas sem dono" value={<span className={semDono.length ? "text-aviso" : ""}>{semDono.length}</span>} hint={semDono.length ? "ficam de fora se não escolher" : "todas identificadas"} />
        <Stat label="Para conferir" value={<span className={conferir.length ? "text-aviso" : ""}>{conferir.length}</span>} hint="continuação ou só pelo nome" />
        <Stat label="Equipe sem documento" value={semDoc.length} hint="não acharam página" />
        {d.status === "PUBLICADO" ? <Stat label="Abertos pela pessoa" value={`${abriram}/${pub.length}`} /> : <Stat label="Situação" value={<span className="text-sm">{d.status === "PREVIA" ? "Prévia (nada publicado)" : "Descartada"}</span>} />}
      </div>
      {previa ? <Card title="Publicar" className="mb-4">
        <form action={publicarDivisao} className="flex flex-wrap items-center gap-3"><input type="hidden" name="id" value={d.id} />
          {conferir.length ? <label className="flex items-start gap-1.5 text-sm"><input type="checkbox" name="conferi" value="1" required className="mt-1" /> Conferi as {conferir.length} página(s) destacadas em amarelo.</label> : null}
          <Btn>Publicar {grupos.length} documento(s) no Meu espaço</Btn>
          <span className="text-xs text-slate-500">Cada pessoa recebe um aviso sem valores. Se esta competência já tinha documento publicado por outra divisão, ele é substituído.</span>
        </form>
        <div className="mt-3 border-t border-line pt-3"><Modal label="Descartar a prévia" title="Descartar a prévia" kind="danger"><form action={descartarDivisao} className="space-y-2"><input type="hidden" name="id" value={d.id} /><p className="text-sm">O PDF original (com os dados de todos) é apagado e nada é publicado.</p><Btn small danger>Descartar</Btn></form></Modal></div>
      </Card> : null}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] xl:items-start">
        <Card title="Página a página">
          <Table head={["Pág.", "Pessoa", "Como", ""]} denso>
            {pags.map(p => { const destaque = !p.employeeId ? "bg-red-50" : p.por === "CONTINUACAO" || (p.por === "NOME" && p.alerta) ? "bg-amber-50" : ""; return <tr key={p.pagina} className={destaque}>
              <Td className="tabular-nums">{p.pagina}</Td>
              <Td>{p.nome ?? <span className="text-slate-500">sem dono</span>}{p.alerta ? <span className="block text-[11px] text-slate-600">{p.alerta}</span> : null}</Td>
              <Td className="text-xs">{p.por ? POR[p.por] : "—"}</Td>
              <Td>{previa ? <form action={ajustarPagina} className="flex items-center gap-1"><input type="hidden" name="id" value={d.id} /><input type="hidden" name="pagina" value={p.pagina} />
                <Select name="employeeId" defaultValue={p.employeeId ? String(p.employeeId) : ""} aria-label={`Dono da página ${p.pagina}`} className="!w-44 !py-1 !text-xs"><option value="">— deixar de fora —</option>{pessoas.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select><Btn small kind="ghost">ok</Btn></form> : null}</Td>
            </tr>; })}
          </Table>
        </Card>
        <div className="min-w-0 space-y-4">
          {d.status === "PUBLICADO" ? <Card title={`Publicados (${pub.length})`}>
            <ul className="divide-y divide-line text-sm">{pub.map(p => <li key={p.employee_id} className="flex flex-wrap justify-between gap-2 py-1.5"><Link className="text-acao" href={`/colaboradores/${p.employee_id}`}>{p.nome}</Link><span className="text-xs text-slate-500">{p.abriu ? `abriu em ${fmtDataHora(p.abriu)}` : p.conta ? "ainda não abriu" : "sem conta no ONE"}</span></li>)}</ul>
          </Card> : <Card title={`Por pessoa (${grupos.length})`}>
            <ul className="divide-y divide-line text-sm">{grupos.map(g => <li key={g.employeeId} className="flex flex-wrap justify-between gap-2 py-1.5"><span>{g.nome}</span><span className="text-xs text-slate-500">pág. {g.paginas.join(", ")}</span></li>)}</ul>
          </Card>}
          <Card title={`Equipe sem documento (${semDoc.length})`}>
            {semDoc.length === 0 ? <p className="text-sm text-ok">Todos da equipe do período têm documento.</p> : <><p className="mb-2 text-xs text-slate-500">Normal para quem não teve este documento no período (ex.: sem férias no mês). Confira se falta alguém.</p>{semDoc.length <= 12 ? <ul className="columns-1 text-sm sm:columns-2">{semDoc.map(p => <li key={p.id}>{p.nome}</li>)}</ul> : <details><summary className="cursor-pointer text-sm text-acao">Ver os {semDoc.length} nomes</summary><ul className="mt-2 columns-1 text-sm sm:columns-2">{semDoc.map(p => <li key={p.id}>{p.nome}</li>)}</ul></details>}</>}
          </Card>
        </div>
      </div>
    </Page>
  );
}
