import { notFound } from "next/navigation";
import Link from "@/components/Link";
import { sql } from "@/db";
import { scopeUnit } from "@/lib/auth";
import { Page, Card, Table, Td, Flash, Btn, Select, Badge } from "@/components/ui";
import { DIAS_CURTO } from "@/lib/cobertura";
import { fmtData } from "@/lib/utils";
import { confirmarImportacaoGrade, descartarImportacaoGrade } from "../../../grade-actions";
import { requireCobertura, SubNavCobertura, professoresDoEscopo, COORDENA } from "../../../_ui";

export const dynamic = "force-dynamic";
type Lote = { destino: string; dataNova: string | null; rascunhoId: number | null; substituir: boolean; nomeNova: string | null; linhas: { nome: string; unitId: number; dia: number; inicio: string; fim: string; turma: string; disciplina: string | null; linha: number }[]; nomes: { chave: string; nome: string; aulas: number; sugerido: number | null; ambiguo: boolean; candidatos: { id: number; nome: string; unidade: string; motivo: string }[] }[]; depara?: Record<string, number> };

/** Etapa 2 da importação da grade: o de-para nome × colaborador é confirmado por humano, nome a nome (CRQ-TMP-V3-01). */
export default async function ConfirmarImportacao({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireCobertura(); const { id } = await params; const sp = await searchParams;
  if (!COORDENA.includes(s.role)) notFound();
  const [bt] = await sql<{ id: number; payload: Lote; status: string; created_at: string; user_id: number }[]>`SELECT id, payload, status, created_at::text, user_id FROM import_batches WHERE id=${Number(id)} AND tipo='GRADE'`;
  if (!bt) notFound(); const p = bt.payload; const escopo = scopeUnit(s); if (escopo !== null && p.linhas.some(l => l.unitId !== escopo)) notFound();
  const [profs, units] = await Promise.all([professoresDoEscopo(s), sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units`]);
  const un = (uid: number) => units.find(u => u.id === uid)?.nome ?? "—";
  const destino = p.destino === "NOVA" ? `nova vigência (rascunho) a partir de ${fmtData(p.dataNova)}${p.nomeNova ? ` — “${p.nomeNova}”` : ""}` : p.destino === "RASCUNHO" ? "o rascunho da unidade" : "a grade em vigor (mudanças valem a partir de hoje)";
  const aberta = bt.status === "PREVIA";
  return (
    <Page title="Importar grade — confirmar o de-para" sub={`${p.linhas.length} aula(s) lidas de ${p.nomes.length} nome(s) · destino: ${destino}${p.substituir ? " · substitui a grade das unidades do arquivo" : ""}. Nada foi gravado ainda.`} actions={<Btn kind="ghost" href="/cobertura/grade">Grade horária</Btn>}>
      <SubNavCobertura ativo="/cobertura/grade" s={s} />
      <Flash ok={sp.ok} erro={sp.erro} />
      {!aberta && <Card className="mb-4"><p className="text-sm">Esta importação já foi {bt.status === "APLICADA" ? "aplicada" : "descartada"}. <Link className="text-acao underline" href="/cobertura/grade">Voltar à grade</Link>.</p></Card>}
      <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-aviso">A grade informa a carga de AULAS, não a de contrato: confira se cada nome da planilha é mesmo a pessoa indicada. Nome igual também se confirma (já houve dois “Carol” na mesma escola). Sem par, escolha a pessoa ou marque “ignorar”.</p>
      <form action={confirmarImportacaoGrade}><input type="hidden" name="batchId" value={bt.id} />
        <Table head={["Nome na planilha", "Aulas", "Colaborador(a)", "Por quê", "Confirmo"]}>
          {p.nomes.map((n, i) => { const sug = n.sugerido; const outros = profs.filter(x => !n.candidatos.some(c => c.id === x.id)); return (
            <tr key={n.chave}><Td className="font-medium">{n.nome}{n.ambiguo && <div className="text-[11px] font-normal text-aviso">mais de uma pessoa com este nome</div>}</Td><Td>{n.aulas}</Td>
              <Td><Select name={`dp_${i}`} defaultValue={sug ?? ""} aria-label={`Colaborador para ${n.nome}`} className="!py-1 !text-xs"><option value="">— escolha —</option><option value="0">Ignorar as aulas deste nome</option>
                {n.candidatos.length > 0 && <optgroup label="Candidatos">{n.candidatos.map(c => <option key={c.id} value={c.id}>{c.nome} · {c.unidade}</option>)}</optgroup>}
                <optgroup label="Outros professores">{outros.map(x => <option key={x.id} value={x.id}>{x.nome} · {x.unidade}</option>)}</optgroup></Select></Td>
              <Td className="text-xs">{n.candidatos.length ? n.candidatos.map(c => `${c.nome.split(" ")[0]}: ${c.motivo}`).join("; ") : <Badge v="REJEITADA" label="sem par" />}</Td>
              <Td><label className="flex items-center gap-1.5 text-xs"><input type="checkbox" name={`ok_${i}`} value="1" aria-label={`Confirmo o de-para de ${n.nome}`} /> confirmo</label></Td></tr>); })}
        </Table>
        {aberta && <div className="mt-3 flex flex-wrap gap-2"><Btn>Aplicar importação</Btn></div>}
      </form>
      {aberta && <form action={descartarImportacaoGrade} className="mt-2"><input type="hidden" name="batchId" value={bt.id} /><Btn small kind="ghost">Descartar importação</Btn></form>}
      <Card title="Aulas lidas" className="mt-4">
        <Table head={["Linha", "Nome", "Unidade", "Dia", "Horário", "Turma", "Disciplina"]}>
          {p.linhas.slice(0, 400).map(l => <tr key={l.linha}><Td>{l.linha}</Td><Td>{l.nome}</Td><Td>{un(l.unitId)}</Td><Td>{DIAS_CURTO[l.dia]}</Td><Td className="whitespace-nowrap">{l.inicio}–{l.fim}</Td><Td>{l.turma}</Td><Td>{l.disciplina ?? "—"}</Td></tr>)}
        </Table>
      </Card>
    </Page>
  );
}
