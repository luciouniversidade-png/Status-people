import Link from "@/components/Link";
import { scopeUnit } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Table, Td, Flash, Field, Btn, Input, Select, Textarea, Badge } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { DIAS, DIAS_CURTO } from "@/lib/cobertura";
import { versoesDaUnidade, versao as lerVersao, versaoVigente, situacao, SITUACAO_ROTULO, GRADE_ORIGEM, periodoTxt, validarVersao, chDeAulas } from "@/lib/grade";
import { salvarAula, removerAula, importarGrade } from "../actions";
import { novaVigencia, ativarVigencia, descartarVigencia } from "../grade-actions";
import { requireCobertura, SubNavCobertura, professoresDoEscopo, COORDENA } from "../_ui";
import { hoje, fmtData } from "@/lib/utils";

export const dynamic = "force-dynamic";
type Aula = { id: number; employee_id: number; professor: string; unit_id: number; unidade: string; dia_semana: number; inicio: string; fim: string; turno: string; turma: string; disciplina: string | null; space_id: number | null; sala: string | null; version_id: number | null };

/** T-053 · Grade horária com vigência: qual horário vale em qual período, validações de choque, comparador e CH a partir da vigência. */
export default async function GradeHoraria({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireCobertura(); const sp = await searchParams; const escopo = scopeUnit(s); const h = hoje();
  const unidade = escopo ?? (sp.unidade ? Number(sp.unidade) : null); const prof = sp.professor ? Number(sp.professor) : null;
  const visao = ["professor", "turma", "sala"].includes(sp.visao ?? "") ? sp.visao! : "professor";
  const pode = COORDENA.includes(s.role);
  const [units, profs, salas] = await Promise.all([
    sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ${escopo === null ? sql`` : sql`WHERE id=${escopo}`} ORDER BY nome`, professoresDoEscopo(s),
    sql<{ id: number; nome: string; unidade: string; unit_id: number }[]>`SELECT sp.id, sp.nome, u.nome AS unidade, sp.unit_id FROM spaces sp JOIN units u ON u.id=sp.unit_id WHERE sp.ativo ${escopo === null ? sql`` : sql`AND sp.unit_id=${escopo}`} ORDER BY u.nome, sp.nome`]);
  const versoes = unidade ? await versoesDaUnidade(unidade) : [];
  const pedida = sp.versao ? await lerVersao(Number(sp.versao)) : null;
  const v = pedida && pedida.unit_id === unidade ? pedida : unidade ? await versaoVigente(unidade, h) : null;
  const sit = v ? situacao(v, h) : null;
  const editavel = pode && (!v || sit === "RASCUNHO" || sit === "VIGENTE" || sit === "FUTURA");
  const slots = await sql<Aula[]>`SELECT t.id, t.employee_id, e.nome AS professor, t.unit_id, u.nome AS unidade, t.dia_semana, t.inicio, t.fim, t.turno, t.turma, t.disciplina, t.space_id, sp.nome AS sala, t.version_id
      FROM teacher_slots t JOIN employees e ON e.id=t.employee_id JOIN units u ON u.id=t.unit_id LEFT JOIN spaces sp ON sp.id=t.space_id
      WHERE t.ativo ${v ? sql`AND (t.version_id=${v.id}${sit === "VIGENTE" ? sql` OR (t.version_id IS NULL AND t.unit_id=${v.unit_id})` : sql``})` : unidade ? sql`AND t.unit_id=${unidade} AND slot_vigente(t.version_id, current_date)` : sql`AND slot_vigente(t.version_id, current_date)`}
      ${prof ? sql`AND t.employee_id=${prof}` : sql``} ORDER BY e.nome, t.dia_semana, t.inicio LIMIT 3000`;
  const achados = v && (sit === "RASCUNHO" || sit === "FUTURA") ? await validarVersao(v.id) : [];
  const bloqueios = achados.filter(a => a.nivel === "BLOQUEIA");
  const qs = (extra: Record<string, string | number | null | undefined>) => `/cobertura/grade?${new URLSearchParams(Object.entries({ unidade: unidade ?? "", versao: v?.id ?? "", professor: prof ?? "", visao, ...extra }).filter(([, x]) => x !== "" && x !== null && x !== undefined).map(([k, x]) => [k, String(x)])).toString()}`;
  const voltar = qs({});
  const profsComAula = new Set(slots.map(x => x.employee_id)).size;
  const rascunho = versoes.find(x => x.status === "RASCUNHO");
  const anterior = v ? versoes.find(x => x.id !== v.id && x.status === "ATIVA" && x.vigencia_inicio < v.vigencia_inicio) : null;
  const Form = ({ t }: { t?: Aula }) => <form action={salvarAula} className="space-y-2">{t && <input type="hidden" name="id" value={t.id} />}{v && <input type="hidden" name="versaoId" value={v.id} />}<input type="hidden" name="voltar" value={voltar} />
    <Field label="Professor(a)"><Select name="employeeId" required defaultValue={t?.employee_id ?? prof ?? ""}><option value="">Escolha</option>{profs.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}</Select></Field>
    <div className="grid grid-cols-2 gap-2"><Field label="Unidade"><Select name="unitId" required defaultValue={t?.unit_id ?? unidade ?? ""}>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field><Field label="Dia"><Select name="dia" required defaultValue={t?.dia_semana ?? 1}>{[1, 2, 3, 4, 5, 6].map(d => <option key={d} value={d}>{DIAS[d]}</option>)}</Select></Field>
      <Field label="Início"><Input name="inicio" required placeholder="07:00" defaultValue={t?.inicio ?? ""} /></Field><Field label="Fim"><Input name="fim" required placeholder="07:50" defaultValue={t?.fim ?? ""} /></Field>
      <Field label="Turma"><Input name="turma" required placeholder="5º ano A" defaultValue={t?.turma ?? ""} /></Field><Field label="Disciplina"><Input name="disciplina" placeholder="Matemática" defaultValue={t?.disciplina ?? ""} /></Field></div>
    <Field label="Sala (opcional)"><Select name="spaceId" defaultValue={t?.space_id ?? ""}><option value="">—</option>{salas.filter(x => !unidade || x.unit_id === unidade).map(x => <option key={x.id} value={x.id}>{x.unidade} · {x.nome}</option>)}</Select></Field>
    <Btn small>{t ? "Salvar aula" : "Incluir aula"}</Btn>
    {sit === "VIGENTE" && v && v.vigencia_inicio < h && <p className="text-[11px] text-slate-500">Na grade em vigor, mudar professor, dia ou horário (ou incluir/retirar aula) vale a partir de hoje — o que passou fica como era.</p>}</form>;
  const acoes = (t: Aula) => editavel && <div className="flex flex-col items-stretch gap-1 2xl:flex-row"><Modal label="Editar" title={`Aula de ${t.professor}`}><Form t={t} /></Modal><form action={removerAula}><input type="hidden" name="id" value={t.id} /><input type="hidden" name="voltar" value={voltar} /><Btn small kind="ghost">Remover</Btn></form></div>;
  // CH da grade por professor (para a coluna da visão por professor)
  const chs = new Map([...new Set(slots.map(x => x.employee_id))].map(id => [id, chDeAulas(slots.filter(x => x.employee_id === id))]));
  const hm = (m: number) => `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, "0") : ""}`;
  const turmas = [...new Set(slots.map(x => x.turma))].sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
  const porSala = [...new Set(slots.filter(x => x.sala).map(x => `${x.unidade} · ${x.sala}`))].sort();
  return (
    <Page title="Grade horária dos professores" sub={`Grade com vigência: qual horário vale em qual período. ${slots.length} aula(s) semanais de ${profsComAula} professor(es)${v ? ` · ${v.nome} (${periodoTxt(v)})` : ""}. É a base das aulas a cobrir, de quem está livre e da CH dos professores.`}>
      <SubNavCobertura ativo="/cobertura/grade" s={s} />
      <Flash ok={sp.ok} erro={sp.erro} />
      <form className="mb-4 grid grid-cols-2 items-end gap-2 rounded-md border border-line bg-white p-3 sm:flex sm:flex-wrap">
        {!escopo && <Field label="Unidade"><Select name="unidade" defaultValue={unidade ?? ""}><option value="">Todas (grade em vigor)</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>}
        {unidade && versoes.length > 0 && <Field label="Vigência"><Select name="versao" defaultValue={v?.id ?? ""}>{versoes.map(x => <option key={x.id} value={x.id}>{x.nome} · {SITUACAO_ROTULO[situacao(x, h)][1]}</option>)}</Select></Field>}
        <Field label="Professor(a)"><Select name="professor" defaultValue={prof ?? ""}><option value="">Todos</option>{profs.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}</Select></Field>
        <Field label="Ver por"><Select name="visao" defaultValue={visao}><option value="professor">Professor</option><option value="turma">Turma</option><option value="sala">Sala</option></Select></Field>
        <Btn kind="ghost">Ver</Btn>
      </form>
      {unidade && <Card title="Vigências da unidade" className="mb-4" actions={pode && !rascunho ? <Modal label="Nova vigência" title="Nova vigência da grade">
          <form action={novaVigencia} className="space-y-2"><input type="hidden" name="unitId" value={unidade} />
            <Field label="Nome"><Input name="nome" required placeholder="Grade do 2º semestre" /></Field>
            <Field label="Vale a partir de"><Input type="date" name="inicio" required defaultValue={h} /></Field>
            <Field label="Começar com"><Select name="base" defaultValue="VIGENTE"><option value="VIGENTE">Cópia da grade em vigor nessa data</option><option value="VAZIA">Grade vazia (montar ou importar)</option></Select></Field>
            <Field label="Observação (opcional)"><Textarea name="obs" className="min-h-[50px]" /></Field>
            <Btn small>Criar rascunho</Btn>
            <p className="text-[11px] text-slate-500">O rascunho não afeta nada até ser ativado. Ao ativar, a grade anterior termina na véspera; a CH muda só quando o RH aplicar a CH da nova vigência.</p>
          </form></Modal> : null}>
        {versoes.length === 0 ? <p className="text-sm text-slate-500">Nenhuma vigência ainda: a primeira aula incluída ou importada cria a grade inicial (vale a partir do dia em que for cadastrada).</p> :
          <ul className="divide-y divide-line text-sm">{versoes.map(x => { const st = situacao(x, h); const [tom, rot] = SITUACAO_ROTULO[st]; return (
            <li key={x.id} className={`flex flex-wrap items-center justify-between gap-2 py-2 ${x.id === v?.id ? "font-medium" : ""}`}>
              <span className="min-w-0"><Link className="text-acao" href={`/cobertura/grade?unidade=${unidade}&versao=${x.id}`}>{x.nome}</Link> <span className="text-xs text-slate-500">· {periodoTxt(x)} · {x.aulas} aula(s), {x.professores} professor(es) · {GRADE_ORIGEM[x.origem] ?? x.origem}{x.ch_aplicada_em ? ` · CH aplicada em ${fmtData(x.ch_aplicada_em.slice(0, 10))}` : x.status === "ATIVA" ? " · CH não aplicada" : ""}</span></span>
              <span className="flex flex-wrap items-center gap-1"><Badge v={tom} label={rot} />{x.copiada_de && <Link className="text-xs text-acao underline" href={`/cobertura/grade/comparar?a=${x.copiada_de}&b=${x.id}`}>comparar</Link>}{x.status === "ATIVA" && ["RH", "DIRECAO", "DIRETOR_UNIDADE"].includes(s.role) && st !== "ENCERRADA" && <Link className="text-xs text-acao underline" href={`/cobertura/grade/ch?versao=${x.id}`}>CH</Link>}</span>
            </li>); })}</ul>}
      </Card>}
      {v && sit === "RASCUNHO" && pode && <Card title={`Rascunho: ${v.nome} — ${periodoTxt(v)}`} className="mb-4 border-amber-300">
        {achados.length ? <ul className="mb-3 space-y-1 text-xs">{achados.map((a, i) => <li key={i} className={a.nivel === "BLOQUEIA" ? "text-erro" : "text-aviso"}><b>{a.nivel === "BLOQUEIA" ? "Bloqueia:" : "Aviso:"}</b> {a.texto}</li>)}</ul> : <p className="mb-3 text-xs text-ok">Validação sem achados: nenhum professor em dois lugares ao mesmo tempo, durações dentro do padrão.</p>}
        <div className="flex flex-wrap items-end gap-2">
          {!bloqueios.length && <form action={ativarVigencia} className="flex flex-wrap items-end gap-2"><input type="hidden" name="versaoId" value={v.id} />{v.vigencia_inicio < h && <Field label="Justificativa (início no passado)"><Input name="justificativa" required minLength={15} placeholder="Por que a grade vale desde antes de hoje" /></Field>}<Btn small>Ativar vigência</Btn></form>}
          {v.copiada_de && <Btn small kind="ghost" href={`/cobertura/grade/comparar?a=${v.copiada_de}&b=${v.id}`}>Comparar com a grade de origem</Btn>}
          <form action={descartarVigencia}><input type="hidden" name="versaoId" value={v.id} /><Btn small kind="ghost">Descartar rascunho</Btn></form>
        </div>
      </Card>}
      {v && sit === "FUTURA" && achados.length > 0 && <Card title="Validação da vigência futura" className="mb-4"><ul className="space-y-1 text-xs">{achados.map((a, i) => <li key={i} className={a.nivel === "BLOQUEIA" ? "text-erro" : "text-aviso"}>{a.texto}</li>)}</ul></Card>}
      {v && sit === "ENCERRADA" && <p className="mb-3 rounded-md border border-line bg-mist px-3 py-2 text-xs text-slate-600">Vigência encerrada: só leitura. O que passou fica como foi — mudanças entram numa nova vigência.{anterior ? <> <Link className="text-acao underline" href={`/cobertura/grade/comparar?a=${anterior.id}&b=${v.id}`}>Comparar com a anterior</Link>.</> : null}</p>}
      <div className={`grid grid-cols-1 gap-4 ${editavel ? "lg:grid-cols-[minmax(0,1fr)_340px]" : ""} lg:items-start`}>
        <div className="min-w-0 space-y-3">
          {visao === "professor" && <Table head={["Professor(a)", "Dia", "Horário", "Turma", "Disciplina", "Sala", ""]} empty="Nenhuma aula nesta vigência. Inclua ao lado ou importe a planilha da grade.">
            {slots.map((t, i) => <tr key={t.id}><Td className="font-medium">{t.professor}{!unidade && <div className="text-[11px] font-normal text-slate-500">{t.unidade}</div>}{(i === 0 || slots[i - 1].employee_id !== t.employee_id) && chs.get(t.employee_id) ? <div className="text-[11px] font-normal text-slate-500">CH pela grade: {hm(chs.get(t.employee_id)!.total)}/sem</div> : null}</Td><Td>{DIAS_CURTO[t.dia_semana]}</Td><Td className="whitespace-nowrap">{t.inicio}–{t.fim}<div className="text-[11px] text-slate-500">{t.turno}</div></Td><Td>{t.turma}</Td><Td>{t.disciplina ?? "—"}</Td><Td>{t.sala ?? "—"}</Td>
              <Td>{acoes(t)}</Td></tr>)}
          </Table>}
          {visao === "turma" && (turmas.length === 0 ? <Card><p className="text-sm text-slate-500">Nenhuma aula.</p></Card> : turmas.map(tu => { const xs = slots.filter(x => x.turma === tu); return (
            <Card key={tu} title={`${tu}${!unidade ? ` · ${xs[0].unidade}` : ""}`}><div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3 lg:grid-cols-6">{[1, 2, 3, 4, 5, 6].map(d => <div key={d} className="min-w-0 rounded border border-line p-1.5"><div className="font-semibold text-navy">{DIAS_CURTO[d]}</div>{xs.filter(x => x.dia_semana === d).map(x => <div key={x.id} className="mt-1 leading-tight"><span className="tabular-nums">{x.inicio}–{x.fim}</span><div className="text-slate-600 [overflow-wrap:anywhere]">{x.disciplina ?? "—"} · {x.professor.split(" ")[0]}</div></div>)}{!xs.some(x => x.dia_semana === d) && <div className="mt-1 text-slate-400">—</div>}</div>)}</div></Card>); }))}
          {visao === "sala" && (porSala.length === 0 ? <Card><p className="text-sm text-slate-500">Nenhuma aula com sala definida nesta vigência.</p></Card> : porSala.map(sa => { const xs = slots.filter(x => `${x.unidade} · ${x.sala}` === sa); return (
            <Card key={sa} title={sa}><div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3 lg:grid-cols-6">{[1, 2, 3, 4, 5, 6].map(d => <div key={d} className="min-w-0 rounded border border-line p-1.5"><div className="font-semibold text-navy">{DIAS_CURTO[d]}</div>{xs.filter(x => x.dia_semana === d).map(x => <div key={x.id} className="mt-1 leading-tight"><span className="tabular-nums">{x.inicio}–{x.fim}</span><div className="text-slate-600 [overflow-wrap:anywhere]">{x.turma} · {x.professor.split(" ")[0]}</div></div>)}</div>)}</div></Card>); }))}
          {visao === "sala" && <p className="text-xs text-slate-500">Reservas avulsas e ocupação do dia: <Link className="text-acao underline" href="/operacoes/espacos">Mapa de salas</Link>.</p>}
        </div>
        {editavel && <div className="space-y-4">
          <Card title={sit === "RASCUNHO" ? "Incluir aula no rascunho" : "Incluir aula"}><Form /></Card>
          <Card title="Importar planilha">
            <form action={importarGrade} className="space-y-2">
              <Field label="Arquivo (.xlsx ou .csv)"><input type="file" name="arquivo" accept=".xlsx,.xls,.csv,.txt" className="block w-full rounded-md border border-line bg-white px-2 py-1.5 text-xs" /></Field>
              <Field label="…ou cole as linhas" hint="Colunas: professor (nome, e-mail ou CPF), unidade, dia, inicio, fim, turma, disciplina, sala"><Textarea name="csv" className="min-h-[90px] font-mono text-xs" placeholder={"professor;unidade;dia;inicio;fim;turma;disciplina;sala\nAna Paula Lima;Carandá;Segunda;07:00;07:50;5º ano A;Matemática;Sala 12"} /></Field>
              <Field label="Destino"><Select name="destino" defaultValue={sit === "RASCUNHO" ? "RASCUNHO" : "VIGENTE"}><option value="VIGENTE">Grade em vigor (a partir de hoje)</option>{rascunho && <option value="RASCUNHO">Rascunho “{rascunho.nome}”</option>}{!rascunho && <option value="NOVA">Nova vigência (rascunho) a partir de…</option>}</Select></Field>
              {rascunho && <input type="hidden" name="rascunhoId" value={rascunho.id} />}
              {!rascunho && <div className="grid grid-cols-2 gap-2"><Field label="Nova vigência: início"><Input type="date" name="inicioNova" defaultValue={h} /></Field><Field label="Nome"><Input name="nomeNova" placeholder="Grade de setembro" /></Field></div>}
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="substituir" value="1" /> Substituir a grade das unidades do arquivo (em vez de acrescentar)</label>
              <Btn small>Ler arquivo</Btn>
              <p className="text-xs text-slate-500">Duas etapas: o sistema lê e valida tudo (qualquer linha com erro impede a importação); depois você confirma o de-para de cada professor — nunca automático.</p>
            </form>
          </Card>
        </div>}
      </div>
    </Page>
  );
}
