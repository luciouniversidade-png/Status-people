import Link from "@/components/Link";
import { requireMatriculas, scopeUnit, can } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Stat, Table, Td, Badge, Flash, Select, Field, Btn, Input, Textarea } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { Copiar } from "@/components/Copiar";
import { fmtData, fmtDataHora, getSettings } from "@/lib/utils";
import { painelRematricula, contratoVigente, SITUACAO_REM, cpfMascarado } from "@/lib/rematricula";
import { processarVencimentos } from "@/lib/matriculas";
import { appUrl } from "@/lib/url";
import { gerarLinkRematricula, gerarLinksEmLote, enviarConviteRematricula, marcarConviteEnviado, cancelarLinkRematricula, alterarSerieLink, salvarConfigRematricula } from "./actions";

export const dynamic = "force-dynamic";
const TOM: Record<string, string> = { MATRICULADA: "APROVADA", RESERVADA: "EM_ADMISSAO", ABERTO: "PENDENTE", ENVIADO: "PENDENTE", GERADO: "NEUTRO", RECUSOU: "REJEITADA", EXPIRADO: "CANCELADA", SEM_LINK: "NEUTRO", CONCLUINTE: "CANCELADA" };
const LIMITE = 400;

export default async function Rematricula({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireMatriculas(); const sp = await searchParams; const cfg = await getSettings(); const ano = cfg.matriculas.anoLetivo as number;
  await processarVencimentos();
  const escopo = scopeUnit(s); const unidade = escopo ?? (sp.unidade ? Number(sp.unidade) : null);
  const [todas, contrato, units, grades, base] = await Promise.all([painelRematricula(ano, unidade), contratoVigente(ano), sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ORDER BY nome`, sql<{ id: number; nome: string }[]>`SELECT id, nome FROM grades ORDER BY ordem`, appUrl()]);
  const q = (sp.q ?? "").trim().toLowerCase();
  const rows = todas.filter(r => (!sp.serie || r.serie_atual === sp.serie) && (!sp.situacao || r.situacao === sp.situacao) && (!q || r.nome.toLowerCase().includes(q) || (r.responsavel ?? "").toLowerCase().includes(q)));
  const n = (k: string) => todas.filter(r => r.situacao === k).length; const baseN = todas.filter(r => r.situacao !== "CONCLUINTE").length; const feitas = n("MATRICULADA") + n("RESERVADA");
  const series = [...new Set(todas.map(r => r.serie_atual).filter(Boolean))] as string[];
  const pode = can.reservar(s); const voltar = `/matriculas/rematricula?${new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && !["ok", "erro"].includes(k)) as [string, string][]).toString()}`;
  const aceites = await sql<{ id: number; student_id: number; aceite: { nome: string; em: string; ip: string | null; cpfFinal: string } | null; contrato_versao: number | null; contrato_hash: string | null; dados_atualizados: Record<string, { de: string | null; para: string | null }> | null; turma: string | null; integral: string | null }[]>`SELECT l.id, l.student_id, l.aceite, l.contrato_versao, l.contrato_hash, l.dados_atualizados, c.nome AS turma, ci.nome AS integral FROM rematricula_links l LEFT JOIN classes c ON c.id=l.class_id LEFT JOIN classes ci ON ci.id=l.integral_class_id WHERE l.ano=${ano} AND l.status='CONCLUIDA' AND l.student_id = ANY(${rows.slice(0, LIMITE).map(r => r.student_id)})`;
  const aceiteDe = new Map(aceites.map(a => [a.student_id, a]));
  return (
    <Page title={`Rematrícula ${ano}`} sub="Link individual para a família: confere os dados, escolhe o turno dentro das vagas e aceita o contrato com registro de data, versão e IP. Valores e boletos continuam no ActiveSoft."
      actions={<><Btn kind="ghost" href={`/api/export/rematricula${unidade ? `?unidade=${unidade}` : ""}`}>Exportar CSV (com links)</Btn>{can.editar(s) && <Btn kind="ghost" href="/matriculas/rematricula/contrato">Contrato {ano}</Btn>}</>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      {!contrato ? <Card className="mb-4 border-amber-300" title="Contrato não publicado"><p className="text-sm text-slate-700">Os links só podem ser gerados com o contrato {ano} publicado — a família aceita exatamente a versão vigente. {can.editar(s) ? <Link className="text-acao underline" href="/matriculas/rematricula/contrato">Publicar o contrato</Link> : "Peça à Direção/RH para publicar."}</p></Card>
        : <p className="mb-3 text-xs text-slate-500">Contrato vigente: <b>{contrato.titulo}</b> · versão {contrato.versao} · publicado em {fmtDataHora(contrato.publicado_em)}</p>}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        <Stat label="Alunos que seguem" value={baseN} hint={n("CONCLUINTE") ? `${n("CONCLUINTE")} concluinte(s) fora` : undefined} />
        <Stat label="Rematrícula feita" value={<span className="text-ok">{baseN ? `${Math.round(1000 * feitas / baseN) / 10}%` : "—"}</span>} hint={`${feitas} de ${baseN}`} />
        <Stat label="Matriculados" value={n("MATRICULADA")} href="?situacao=MATRICULADA" />
        <Stat label="Reserva (falta financeiro)" value={n("RESERVADA")} href="?situacao=RESERVADA" />
        <Stat label="Abriram e não concluíram" value={<span className="text-aviso">{n("ABERTO")}</span>} href="?situacao=ABERTO" />
        <Stat label="Link enviado" value={n("ENVIADO") + n("GERADO")} href="?situacao=ENVIADO" />
        <Stat label="Recusaram" value={<span className="text-erro">{n("RECUSOU")}</span>} href="?situacao=RECUSOU" />
        <Stat label="Sem link" value={n("SEM_LINK") + n("EXPIRADO")} href="?situacao=SEM_LINK" hint={n("EXPIRADO") ? `${n("EXPIRADO")} com link expirado` : undefined} />
      </div>
      <form className="mb-3 grid grid-cols-2 items-end gap-2 rounded-md border border-line bg-white p-3 sm:flex sm:flex-wrap">
        {!escopo && <Field label="Unidade"><Select name="unidade" defaultValue={unidade ?? ""}><option value="">Todas</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>}
        <Field label="Série atual"><Select name="serie" defaultValue={sp.serie ?? ""}><option value="">Todas</option>{series.map(x => <option key={x}>{x}</option>)}</Select></Field>
        <Field label="Situação"><Select name="situacao" defaultValue={sp.situacao ?? ""}><option value="">Todas</option>{Object.entries(SITUACAO_REM).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="Buscar"><Input name="q" defaultValue={sp.q ?? ""} placeholder="aluno ou responsável" /></Field>
        <Btn kind="ghost">Filtrar</Btn>
      </form>
      {pode && contrato && <div className="mb-3 flex flex-wrap items-center gap-2"><form action={gerarLinksEmLote}><input type="hidden" name="voltar" value={voltar} />{unidade && <input type="hidden" name="unidade" value={unidade} />}{sp.serie && <input type="hidden" name="serie" value={sp.serie} />}<Btn small>Gerar links para quem está sem link{sp.serie ? ` (${sp.serie})` : ""}</Btn></form><span className="text-xs text-slate-500">Respeita a unidade e a série filtradas; não gera para quem já tem reserva, link ativo, recusou ou é concluinte.</span></div>}
      <Table head={["Aluno / responsável", "Série", "Situação", "Datas", ""]} empty="Nenhum aluno atual neste filtro (cadastre ou importe os alunos com a série atual).">
        {rows.slice(0, LIMITE).map(r => { const ac = aceiteDe.get(r.student_id); const ativo = ["GERADO", "ENVIADO", "ABERTO"].includes(r.situacao); const url = r.token ? `${base}/rematricula/${r.token}` : "";
          return <tr key={r.student_id}>
            <Td><Link className="font-medium text-acao" href={`/matriculas/alunos/${r.student_id}`}>{r.nome}</Link><div className="text-[11px] text-slate-500">{r.responsavel ?? "sem responsável"} · {r.telefone ?? "sem telefone"}{!escopo && r.unidade ? ` · ${r.unidade}` : ""}</div></Td>
            <Td className="whitespace-nowrap text-xs">{r.serie_atual ?? "—"} → <b>{r.serie_prevista ?? "—"}</b></Td>
            <Td><Badge v={TOM[r.situacao] ?? "NEUTRO"} label={SITUACAO_REM[r.situacao]} />{r.mat_turma && <div className="text-[11px] text-slate-600">{r.mat_turma}{r.situacao === "RESERVADA" ? ` · reserva até ${fmtData(r.reserva_ate)}${r.contrato ? " · contrato ✓" : ""}` : ""}</div>}{r.situacao === "RECUSOU" && <div className="text-[11px] text-slate-600">{r.recusa_motivo}{r.case_id ? <> · <Link className="text-acao" href={`/atendimento/casos/${r.case_id}`}>pedido de saída #{r.case_id}</Link></> : ""}</div>}</Td>
            <Td className="whitespace-nowrap text-[11px] text-slate-600">{r.enviado_em && <div>enviado {fmtData(r.enviado_em.slice(0, 10))}</div>}{r.aberto_em && <div>aberto {fmtData(r.aberto_em.slice(0, 10))}</div>}{r.concluido_em && <div>respondido {fmtData(r.concluido_em.slice(0, 10))}</div>}{ativo && r.expira_em && <div>vale até {fmtData(r.expira_em)}</div>}</Td>
            <Td>{pode && <div className="flex flex-wrap gap-1">
              {(r.situacao === "SEM_LINK" || r.situacao === "EXPIRADO") && contrato && r.grade_prevista_id && <form action={gerarLinkRematricula}><input type="hidden" name="studentId" value={r.student_id} /><input type="hidden" name="voltar" value={voltar} /><Btn small kind="ghost">Gerar link</Btn></form>}
              {ativo && r.link_id && <><form action={enviarConviteRematricula}><input type="hidden" name="id" value={r.link_id} /><input type="hidden" name="voltar" value={voltar} /><Btn small>WhatsApp</Btn></form><Copiar texto={url} />
                <Modal label="Mais" title={`Link de ${r.nome}`}><div className="space-y-3"><p className="break-all rounded bg-mist p-2 font-mono text-[11px]">{url}</p>
                  <form action={marcarConviteEnviado} className="flex flex-wrap items-end gap-2"><input type="hidden" name="id" value={r.link_id} /><input type="hidden" name="voltar" value={voltar} /><Field label="Enviado por outro canal"><Select name="canal"><option>E-mail</option><option>Impresso</option><option>Telefone</option><option>Outro</option></Select></Field><Btn small kind="ghost">Registrar envio</Btn></form>
                  <form action={alterarSerieLink} className="grid grid-cols-1 gap-2 border-t border-line pt-3 sm:grid-cols-2"><input type="hidden" name="id" value={r.link_id} /><input type="hidden" name="voltar" value={voltar} /><Field label="Série prevista"><Select name="gradeId" defaultValue={r.grade_prevista_id ?? ""}>{grades.map(g => <option key={g.id} value={g.id}>{g.nome}</option>)}</Select></Field><Field label="Motivo (ex.: retenção)"><Input name="motivo" /></Field><div><Btn small kind="ghost">Alterar série</Btn></div></form>
                  <form action={cancelarLinkRematricula} className="space-y-2 border-t border-line pt-3"><input type="hidden" name="id" value={r.link_id} /><input type="hidden" name="voltar" value={voltar} /><Field label="Motivo do cancelamento"><Input name="motivo" required /></Field><Btn small danger>Cancelar link</Btn></form></div></Modal></>}
              {ac && <Modal label="Aceite" title={`Aceite de ${r.nome}`}><dl className="space-y-1 text-sm"><div><dt className="text-xs text-slate-500">Turma</dt><dd>{ac.turma}{ac.integral ? ` + Integral ${ac.integral}` : ""}</dd></div><div><dt className="text-xs text-slate-500">Assinado por</dt><dd>{ac.aceite?.nome} · CPF {cpfMascarado(`000000000${ac.aceite?.cpfFinal ?? ""}`)}</dd></div><div><dt className="text-xs text-slate-500">Quando e de onde</dt><dd>{fmtDataHora(ac.aceite?.em)} · IP {ac.aceite?.ip ?? "—"}</dd></div><div><dt className="text-xs text-slate-500">Contrato</dt><dd className="break-all font-mono text-[11px]">versão {ac.contrato_versao} · SHA-256 {ac.contrato_hash}</dd></div>{ac.dados_atualizados && Object.keys(ac.dados_atualizados).length > 0 && <div><dt className="text-xs text-slate-500">Dados atualizados pela família</dt><dd className="text-xs">{Object.entries(ac.dados_atualizados).map(([k, v]) => <div key={k}>{k}: {k === "cpf_responsavel" ? "informado" : `${v.de ?? "—"} → ${v.para ?? "—"}`}</div>)}</dd></div>}</dl></Modal>}
            </div>}</Td>
          </tr>; })}
      </Table>
      {rows.length > LIMITE && <p className="mt-2 text-xs text-slate-500">Mostrando {LIMITE} de {rows.length}. Use os filtros ou exporte o CSV.</p>}
      {can.editar(s) && <Card className="mt-6" title="Configuração da rematrícula">
        <form action={salvarConfigRematricula} className="space-y-2">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><Field label="Validade do link (dias)"><Input name="validadeLinkDias" type="number" min={1} max={120} defaultValue={cfg.rematricula.validadeLinkDias} /></Field><Field label="Reserva após o aceite (dias)" hint="Prazo para o financeiro confirmar."><Input name="reservaDias" type="number" min={1} max={120} defaultValue={cfg.rematricula.reservaDias} /></Field><Field label="Avisar se abriu e não concluiu (dias)"><Input name="lembreteAbertoDias" type="number" min={1} max={30} defaultValue={cfg.rematricula.lembreteAbertoDias} /></Field><Field label="Integral só no contraturno"><Select name="integralContraturno" defaultValue={cfg.rematricula.integralContraturno ? "1" : "0"}><option value="1">Sim</option><option value="0">Não</option></Select></Field></div>
          <Field label="Texto do convite (WhatsApp)" hint="Variáveis: {responsavel} {aluno} {ano} {link} {prazo} {unidade}"><Textarea name="convite" defaultValue={cfg.rematricula.convite} className="min-h-[90px]" /></Field>
          <Btn small>Salvar configuração</Btn>
        </form></Card>}
    </Page>
  );
}
