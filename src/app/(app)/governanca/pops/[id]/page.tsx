import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, desc } from "drizzle-orm";
import { db, schema, sql } from "@/db";
import { requireSession, can } from "@/lib/auth";
import { Page, Card, Badge, Btn, Flash, Field, Input, Select, Textarea } from "@/components/ui";
import { PrintButton } from "@/components/PrintButton";
import { fmtData, fmtDataHora, getSettings } from "@/lib/utils";
import { POP_STATUS } from "@/lib/governanca";
import { salvarPop, publicarPop, mudarStatusPop, darCiencia } from "../../actions";
import { GESTAO, usuariosGestao } from "../../_shared";

export const dynamic = "force-dynamic";

export default async function Pop({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const { id } = await params; const sp = await searchParams; const pid = Number(id); const cfg = await getSettings();
  const [p] = await db.select().from(schema.procedures).where(eq(schema.procedures.id, pid)); if (!p) notFound();
  const [versoes, acks, users, units, [owner]] = await Promise.all([
    db.select().from(schema.procedureVersions).where(eq(schema.procedureVersions.procedureId, pid)).orderBy(desc(schema.procedureVersions.versao)),
    sql<{ nome: string; at: Date; versao: number }[]>`SELECT u.nome, a.at, a.versao FROM procedure_acks a JOIN users u ON u.id=a.user_id WHERE a.procedure_id=${pid} AND a.versao=${p.versao} ORDER BY a.at DESC`,
    usuariosGestao(), db.select().from(schema.units), p.ownerUserId ? db.select({ nome: schema.users.nome }).from(schema.users).where(eq(schema.users.id, p.ownerUserId)) : Promise.resolve([undefined]),
  ]);
  const podeEditar = can.editar(s) || p.ownerUserId === s.id; const podePublicar = can.aprovar(s, cfg.alcadas.pops); const jaDeu = (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM procedure_acks WHERE procedure_id=${pid} AND versao=${p.versao} AND user_id=${s.id}`)[0].n > 0;
  const passos = (p.passos ?? "").split("\n").map(x => x.trim()).filter(Boolean);
  return (
    <Page title={`${p.codigo} — ${p.titulo}`} sub={<span className="flex flex-wrap items-center gap-2"><Badge v={p.status === "VIGENTE" ? "APROVADA" : p.status === "EM_REVISAO" ? "PENDENTE" : p.status === "OBSOLETO" ? "CANCELADA" : "EM_AQUISICAO"} label={POP_STATUS[p.status]} /> v{p.versao} · {p.area} · dono: {owner?.nome ?? <span className="text-aviso">não definido</span>}{p.publicadoEm && ` · publicado ${fmtDataHora(p.publicadoEm)}`}{p.revisarEm && ` · revisar em ${fmtData(p.revisarEm)}`} · <Link className="text-acao" href="/governanca/pops">biblioteca</Link></span>}
      actions={<PrintButton />}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="grid gap-4 lg:grid-cols-[1fr_340px] lg:items-start">
        <div className="space-y-4">
          <Card title="Procedimento">
            {p.objetivo && <p className="mb-2 text-sm"><span className="text-xs font-medium text-slate-500">Objetivo · </span>{p.objetivo}</p>}
            {p.escopo && <p className="mb-2 text-sm"><span className="text-xs font-medium text-slate-500">Escopo · </span>{p.escopo}</p>}
            {passos.length ? <ol className="mt-3 space-y-1.5 text-sm">{passos.map((x, i) => <li key={i} className="flex gap-3"><span className="w-6 shrink-0 text-right font-semibold tabular-nums text-navy">{i + 1}.</span><span>{x.replace(/^\d+[.)]\s*/, "")}</span></li>)}</ol> : <p className="text-sm text-slate-500">Sem passos cadastrados — cole o texto oficial no formulário ao lado.</p>}
            {(p.responsavel || p.aprovador || p.consultados || p.informados) && <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-4">{[["Responsável (executa)", p.responsavel], ["Aprovador", p.aprovador], ["Consultados", p.consultados], ["Informados", p.informados]].map(([k, v]) => v ? <div key={k}><dt className="text-xs text-slate-500">{k}</dt><dd>{v}</dd></div> : null)}</dl>}
            {p.indicadores && <p className="mt-3 text-sm"><span className="text-xs font-medium text-slate-500">Indicadores · </span>{p.indicadores}</p>}
            {p.link && <p className="mt-2 text-sm"><a className="text-acao" href={p.link} target="_blank" rel="noreferrer">Documento completo (Drive)</a></p>}
            {p.status === "VIGENTE" && <div className="mt-4 border-t border-line pt-3 print:hidden">{jaDeu ? <p className="text-sm text-ok">Você já deu ciência desta versão.</p> : <form action={darCiencia}><input type="hidden" name="id" value={pid} /><Btn>Li e entendi este procedimento (v{p.versao})</Btn></form>}</div>}
          </Card>
          {p.status === "VIGENTE" && <Card title={`Ciência da equipe — versão ${p.versao} (${acks.length})`}>{acks.length === 0 ? <p className="text-sm text-slate-500">Ninguém deu ciência ainda.</p> : <ul className="grid gap-1 text-sm sm:grid-cols-2">{acks.map((a, i) => <li key={i}>{a.nome} <span className="text-xs text-slate-500">· {fmtDataHora(a.at)}</span></li>)}</ul>}</Card>}
          {versoes.length > 0 && <Card title="Histórico de versões"><ul className="space-y-1 text-sm">{versoes.map(v => <li key={v.id}>v{v.versao} · {fmtDataHora(v.publicadoEm)} · {users.find(u => u.id === v.publicadoPor)?.nome ?? ""}{v.notas ? ` — ${v.notas}` : ""}</li>)}</ul></Card>}
        </div>
        {(podeEditar || podePublicar) && <div className="space-y-4 print:hidden">
          {podePublicar && p.status !== "OBSOLETO" && <Card title="Publicação">
            <form action={publicarPop} className="space-y-2"><input type="hidden" name="id" value={pid} /><Field label="Notas da versão"><Input name="notas" placeholder="O que mudou" /></Field><Btn small>{p.status === "VIGENTE" ? `Publicar nova versão (v${p.versao + 1})` : "Publicar como vigente"}</Btn></form>
            <form action={mudarStatusPop} className="mt-3 flex flex-wrap gap-1 border-t border-line pt-3"><input type="hidden" name="id" value={pid} />{p.status === "VIGENTE" && <Btn small kind="ghost" name="status" value="EM_REVISAO">Colocar em revisão</Btn>}{p.status !== "RASCUNHO" && <Btn small kind="ghost" name="status" value="RASCUNHO">Voltar a rascunho</Btn>}<Btn small danger name="status" value="OBSOLETO">Tornar obsoleto</Btn></form>
          </Card>}
          {podeEditar && p.status !== "OBSOLETO" && <Card title="Editar conteúdo">
            <form action={salvarPop} className="space-y-2"><input type="hidden" name="id" value={pid} />
              <div className="grid grid-cols-[100px_1fr] gap-2"><Field label="Código"><Input name="codigo" defaultValue={p.codigo} required /></Field><Field label="Título"><Input name="titulo" defaultValue={p.titulo} required /></Field></div>
              <div className="grid grid-cols-2 gap-2"><Field label="Área"><Select name="area" defaultValue={p.area}>{cfg.governanca.areas.map(a => <option key={a}>{a}</option>)}</Select></Field><Field label="Unidade"><Select name="unitId" defaultValue={p.unitId ?? ""}><option value="">Rede</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field></div>
              <div className="grid grid-cols-2 gap-2"><Field label="Dono"><Select name="ownerUserId" defaultValue={p.ownerUserId ?? ""}><option value="">—</option>{users.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field><Field label="Próxima revisão"><Input name="revisarEm" type="date" defaultValue={p.revisarEm ?? ""} /></Field></div>
              <Field label="Objetivo"><Textarea name="objetivo" className="min-h-[50px]" defaultValue={p.objetivo ?? ""} /></Field>
              <Field label="Escopo"><Input name="escopo" defaultValue={p.escopo ?? ""} /></Field>
              <Field label="Passos (um por linha)"><Textarea name="passos" className="min-h-[220px] font-mono text-xs" defaultValue={p.passos ?? ""} /></Field>
              <div className="grid grid-cols-2 gap-2"><Field label="Responsável (executa)"><Input name="responsavel" defaultValue={p.responsavel ?? ""} /></Field><Field label="Aprovador"><Input name="aprovador" defaultValue={p.aprovador ?? ""} /></Field><Field label="Consultados"><Input name="consultados" defaultValue={p.consultados ?? ""} /></Field><Field label="Informados"><Input name="informados" defaultValue={p.informados ?? ""} /></Field></div>
              <Field label="Indicadores"><Input name="indicadores" defaultValue={p.indicadores ?? ""} /></Field>
              <Field label="Link do documento (Drive)"><Input name="link" defaultValue={p.link ?? ""} /></Field>
              <Btn small>Salvar</Btn><p className="text-xs text-slate-500">Salvar não publica: a equipe continua vendo a versão vigente até você publicar.</p>
            </form>
          </Card>}
        </div>}
      </div>
    </Page>
  );
}
