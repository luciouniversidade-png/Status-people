import Link from "@/components/Link";
import { notFound, redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession } from "@/lib/auth";
import { Page, Card, Flash, Stat, Badge, Btn, Field, Input, Select, Textarea, Table, Td } from "@/components/ui";
import { EtapasC13 } from "@/components/Etapas";
import { BarrasH, COR } from "@/components/graficos";
import { podeFolha, podePreparar, podeConferir, cicloPorId, pendenciasPacote, esperadaDaEntidade, resultadoDoCiclo, totalAnteriorAceito } from "@/lib/folha";
import { ETAPAS_FOLHA, STATUS_CICLO, TIPOS_DOC, MOTIVOS_VARIACAO, estadoEtapas, sortearAmostra, variacaoPct, exigeExplicacao, decomporVariacao, custoLinha, docsFaltando, competenciaAnterior } from "@/lib/folha-calc";
import { registrarPrevia, registrarConferencia, resolverDivergencia, adicionarExplicacao, removerExplicacao, importarResultado, aceitarResultado, enviarDocumentoFolha, arquivarCiclo, cobrarDocumentos } from "../actions";
import { fmtReais, fmtPct, rotuloMes } from "@/lib/formato";
import { fmtDataHora, getSettings } from "@/lib/utils";

export const dynamic = "force-dynamic";
const R = (v: number | null | undefined) => v === null || v === undefined ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
// número com centavos sem o "R$" (tabelas largas, com a unidade no título)
const N = (v: number | null | undefined) => v === null || v === undefined ? "—" : v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function CicloFolha({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); if (!podeFolha(s) && s.role !== "LEITURA") redirect("/"); const sp = await searchParams; const { id } = await params;
  const c = await cicloPorId(Number(id)); if (!c) notFound();
  const cfg = await getSettings();
  const [[ent], p, esp, res, anterior, explic, diverg, docs, eventos] = await Promise.all([
    sql<{ nome: string; cnpj: string | null }[]>`SELECT nome, cnpj FROM companies WHERE id=${c.company_id}`,
    pendenciasPacote(c.company_id, c.competencia), esperadaDaEntidade(c.company_id, c.competencia), resultadoDoCiclo(c.id), totalAnteriorAceito(c.company_id, c.competencia),
    sql<{ id: number; motivo: string; valor: number | null; texto: string | null; user_nome: string | null; created_at: string }[]>`SELECT id, motivo, valor::float, texto, user_nome, created_at::text FROM payroll_explanations WHERE cycle_id=${c.id} ORDER BY id`,
    sql<{ id: number; descricao: string; status: string; created_at: string; resolvida_em: string | null }[]>`SELECT id, descricao, status, created_at::text, resolvida_em::text FROM payroll_divergences WHERE cycle_id=${c.id} ORDER BY status, id`,
    sql<{ id: number; tipo: string; employee_id: number | null; colaborador: string | null; attachment_id: number; nome: string; user_nome: string | null; created_at: string; consultas: number }[]>`SELECT d.id, d.tipo, d.employee_id, e.nome AS colaborador, d.attachment_id, a.nome, a.user_nome, d.created_at::text, (SELECT count(*) FROM payroll_doc_views v WHERE v.doc_id=d.id)::int AS consultas FROM payroll_docs d JOIN attachments a ON a.id=d.attachment_id LEFT JOIN employees e ON e.id=d.employee_id WHERE d.cycle_id=${c.id} ORDER BY d.tipo, d.id`,
    sql<{ at: string; user_nome: string | null; tipo: string; texto: string | null }[]>`SELECT at::text, user_nome, tipo, texto FROM payroll_events WHERE cycle_id=${c.id} OR (cycle_id IS NULL AND competencia=${c.competencia} AND tipo IN ('PONTO_FECHADO','PONTO_REABERTO')) ORDER BY at DESC LIMIT 60`,
  ]);
  const lockOk = p.unidades.length > 0 && p.unidades.every(u => u.fechado); const est = estadoEtapas(c.status, lockOk);
  const [ant] = await sql<{ v: number | null }[]>`SELECT sum(r.salarios)::float AS v FROM payroll_cycles x JOIN payroll_results r ON r.cycle_id=x.id WHERE x.company_id=${c.company_id} AND x.competencia=${competenciaAnterior(c.competencia)} AND x.aceito_em IS NOT NULL`;
  const varPrevia = c.previa ? variacaoPct(c.previa.proventos, ant?.v ?? null) : null; const limite = Number(cfg.folha.variacaoMaxPct);
  const amostra = sortearAmostra(esp.pessoas.filter(x => !x.desligamento || x.desligamento >= `${c.competencia}-01`), Number(cfg.folha.amostraHolerites), `${c.competencia}|${c.company_id}`);
  const decomp = decomporVariacao(res.total, anterior, explic);
  const faltam = docsFaltando(cfg.folha.docsObrigatorios as string[], docs.map(d => d.tipo));
  const verHolerite = ["RH", "DIRECAO"].includes(s.role); const docsVisiveis = docs.filter(d => verHolerite || d.tipo.startsWith("GUIA_") || d.tipo === "RESUMO_FOLHA");
  const quatroOlhos = c.pacote_por !== s.id; const fase = c.status;
  const mes = c.competencia.split("-").reverse().join("/");
  return (
    <Page title={`Folha ${mes} · ${ent?.nome ?? "Entidade"}`} sub={<>{STATUS_CICLO[c.status] ?? c.status} · o cálculo é do contador; o sistema controla o ciclo e guarda a trilha. <Link href={`/folha?mes=${c.competencia}`} className="text-acao">← todas as entidades</Link></>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <Card className="mb-4"><EtapasC13 rotulo="Passos do ciclo" etapas={ETAPAS_FOLHA.map((et, i) => ({ nome: et.nome, estado: est[i], sub: et.regra }))} /></Card>

      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="Folha esperada (estimativa do cadastro)" value={fmtReais(esp.total, true)} hint={`proventos ${fmtReais(esp.proventos, true)} + ${cfg.financeiro.encargosPct}% encargos estimados · nunca REAL`} />
        <Stat label="Prévia do contador" value={c.previa ? fmtReais(c.previa.proventos, true) : "—"} hint={c.previa ? `${c.previa.headcount} pessoas · por ${c.previa.por}` : "aguardando a prévia"} />
        <Stat label="Resultado importado" value={res.total === null ? "—" : fmtReais(res.total, true)} hint={res.total === null ? "custo total da escola (sem IRRF)" : c.aceito_em ? "aceito — custo REAL" : "aguardando aceite"} />
        <Stat label="Variação sobre o mês anterior" value={<span className={exigeExplicacao(c.variacao_pct, limite) ? "text-erro" : ""}>{c.variacao_pct === null ? "—" : `${c.variacao_pct > 0 ? "+" : ""}${fmtPct(c.variacao_pct)}`}</span>} hint={anterior === null ? "sem resultado aceito no mês anterior" : `base ${fmtReais(anterior, true)} · limite ${limite}%`} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:items-start">
        {/* passo 2 */}
        <Card title="2 · Pacote ao contador">
          {c.pacote ? <>
            <p className="text-sm">Gerado por <b>{c.pacote_por_nome}</b> em {fmtDataHora(c.pacote_em)} · conferência <code className="rounded bg-mist px-1 text-xs">{c.pacote.hash}</code></p>
            <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-slate-700 sm:grid-cols-3"><li>{c.pacote.headcount} no quadro</li><li>{c.pacote.admissoes.length} admissão(ões)</li><li>{c.pacote.desligamentos.length} desligamento(s)</li><li>{c.pacote.afastamentos.length} afastamento(s)</li><li>{c.pacote.ferias.length} férias</li><li>{c.pacote.horasExtras.length} com HE aprovadas</li>{c.pacote.beneficios && <li>{c.pacote.beneficios.length} benefício(s) no mês</li>}</ul>
            <div className="mt-3 flex flex-wrap gap-2"><a className="inline-flex items-center rounded-md bg-acao px-3 py-1.5 text-xs font-medium text-white" href={`/api/folha/pacote/${c.id}`}>Baixar pacote (CSV)</a></div>
            <p className="mt-2 text-[11px] text-slate-500">Afastamentos saem só com o tipo genérico e as datas — nenhum dado clínico vai no pacote. Pensões e descontos autorizados não têm registro no sistema (informar por fora).</p>
          </> : <p className="text-sm text-slate-600">O pacote ainda não foi gerado. {p.bloqueios.length ? "Resolva as pendências obrigatórias na tela do ciclo." : "Gere pela tela do ciclo."}</p>}
        </Card>

        {/* passo 3 */}
        <Card title="3 · Conferência da prévia (duas pessoas)">
          {podeConferir(s) && ["PACOTE_ENVIADO", "DEVOLVIDO"].includes(fase) && <form action={registrarPrevia} className="mb-3 grid grid-cols-1 gap-2 rounded-md border border-line p-3 sm:grid-cols-[repeat(3,minmax(0,1fr))_auto]"><input type="hidden" name="cycleId" value={c.id} />
            <Field label="Headcount da prévia"><Input name="headcount" type="number" min={0} defaultValue={c.previa?.headcount ?? ""} required /></Field><Field label="Total de proventos"><Input name="proventos" inputMode="decimal" defaultValue={c.previa?.proventos ?? ""} required /></Field><Field label="Encargos (opcional)"><Input name="encargos" inputMode="decimal" defaultValue={c.previa?.encargos ?? ""} /></Field><div className="flex items-end"><Btn small kind="ghost">Registrar prévia</Btn></div></form>}
          <Table head={["Item", "Cadastro (estimativa)", "Prévia", "Situação"]}>
            <tr><Td>Headcount no fim do mês</Td><Td className="tabular-nums">{esp.headcountFim}</Td><Td className="tabular-nums">{c.previa?.headcount ?? "—"}</Td><Td>{!c.previa ? "—" : c.previa.headcount === esp.headcountFim ? <Badge v="APROVADA" label="confere" /> : <Badge v="PENDENTE" label={`diferença de ${(c.previa.headcount ?? 0) - esp.headcountFim}`} />}</Td></tr>
            <tr><Td>Proventos</Td><Td className="tabular-nums">{R(esp.proventos)}{esp.semSalario ? <div className="text-[11px] text-aviso">{esp.semSalario} sem salário no cadastro</div> : null}</Td><Td className="tabular-nums">{R(c.previa?.proventos)}</Td><Td>{c.previa?.proventos && esp.proventos ? fmtPct(100 * ((c.previa.proventos - esp.proventos) / esp.proventos)) : "—"}</Td></tr>
            <tr><Td>Variação sobre o mês anterior</Td><Td>{ant?.v ? R(ant.v) : "sem base"}</Td><Td className="tabular-nums">{varPrevia === null ? "—" : `${varPrevia > 0 ? "+" : ""}${fmtPct(varPrevia)}`}</Td><Td>{exigeExplicacao(varPrevia, limite) ? (explic.length ? <Badge v="APROVADA" label="explicada" /> : <Badge v="REJEITADA" label={`acima de ${limite}% — explique`} />) : "—"}</Td></tr>
          </Table>
          {podeConferir(s) && ["PACOTE_ENVIADO", "DEVOLVIDO"].includes(fase) && c.previa && <form action={registrarConferencia} className="mt-3 space-y-3"><input type="hidden" name="cycleId" value={c.id} />
            {!quatroOlhos && <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-aviso">Você gerou o pacote: a conferência precisa ser feita por outra pessoa (Four-Eyes).</p>}
            <fieldset className="text-sm"><legend className="mb-1 font-medium">O headcount da prévia confere com o cadastro?</legend><label className="mr-4"><input type="radio" name="headcountOk" value="sim" defaultChecked={c.previa.headcount === esp.headcountFim} /> Sim</label><label><input type="radio" name="headcountOk" value="nao" defaultChecked={c.previa.headcount !== esp.headcountFim} /> Não — devolver</label><Input name="obsHeadcount" placeholder="Observação (quem falta ou sobra)" className="mt-1" /></fieldset>
            <div><div className="mb-1 text-sm font-medium">Amostra de {amostra.length} holerites (sorteio fixo do ciclo)</div><ul className="space-y-2">{amostra.map(a => { const prev = c.conferencia?.amostra?.find(x => x.employee_id === a.id); return <li key={a.id} className="grid grid-cols-1 items-center gap-2 rounded-md border border-line p-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]"><span><b>{a.nome}</b><span className="block text-[11px] text-slate-500">{a.cargo ?? "—"} · {a.unidade}{verHolerite && a.salario !== null ? ` · salário cadastrado ${R(a.salario)}` : ""}</span></span><span className="flex gap-3 text-xs"><label><input type="radio" name={`amostra_${a.id}`} value="ok" defaultChecked={prev?.ok === true} /> confere</label><label><input type="radio" name={`amostra_${a.id}`} value="div" defaultChecked={prev?.ok === false} /> divergente</label></span><Input name={`obs_${a.id}`} placeholder="Se divergente: o quê" defaultValue={prev?.obs ?? ""} /></li>; })}</ul></div>
            <Btn small>Registrar conferência</Btn>
          </form>}
          {c.conferido_por_nome && <p className="mt-3 text-xs text-slate-600">Última conferência: {c.conferencia?.resultado === "APROVADA" ? "aprovada" : "devolvida"} por <b>{c.conferido_por_nome}</b> em {fmtDataHora(c.conferido_em)}.</p>}
          {diverg.length > 0 && <div className="mt-3"><div className="mb-1 text-sm font-medium">Divergências devolvidas ao contador</div><ul className="space-y-1 text-sm">{diverg.map(d => <li key={d.id} className="flex flex-wrap items-center gap-2"><Badge v={d.status === "RESOLVIDA" ? "APROVADA" : "PENDENTE"} label={d.status === "RESOLVIDA" ? "resolvida" : "devolvida"} /><span className="min-w-0 flex-1">{d.descricao}</span>{d.status === "DEVOLVIDA" && podeFolha(s) && <form action={resolverDivergencia}><input type="hidden" name="id" value={d.id} /><input type="hidden" name="cycleId" value={c.id} /><Btn small kind="ghost">Contador corrigiu</Btn></form>}</li>)}</ul></div>}
        </Card>

        {/* explicações */}
        <Card title="Explicações da variação">
          {explic.length === 0 ? <p className="text-sm text-slate-600">Nenhuma explicação vinculada.{exigeExplicacao(varPrevia ?? c.variacao_pct, limite) ? <b className="text-erro"> A variação passou de {limite}%: explique antes da conferência e do aceite.</b> : ""}</p>
            : <ul className="space-y-1 text-sm">{explic.map(x => <li key={x.id} className="flex flex-wrap items-baseline gap-2"><b>{MOTIVOS_VARIACAO[x.motivo] ?? x.motivo}</b><span className="tabular-nums">{R(x.valor)}</span>{x.texto && <span className="text-slate-600">— {x.texto}</span>}<span className="text-[11px] text-slate-400">{x.user_nome}</span>{!["ACEITO", "ARQUIVADO"].includes(fase) && podeFolha(s) && <form action={removerExplicacao} className="ml-auto"><input type="hidden" name="id" value={x.id} /><input type="hidden" name="cycleId" value={c.id} /><button className="text-xs text-erro">remover</button></form>}</li>)}</ul>}
          {decomp && <div className="mt-3"><div className="mb-1 text-xs font-medium text-slate-600">Decomposição da variação ({R(decomp.delta)})</div><BarrasH rotulo="Decomposição da variação da folha" divergente formato={v => fmtReais(v, true)} itens={[...decomp.itens.map(i => ({ rotulo: MOTIVOS_VARIACAO[i.motivo] ?? i.motivo, valor: i.valor })), { rotulo: "Não explicado", valor: decomp.naoExplicado, cor: COR.neutro }]} /></div>}
          {!["ACEITO", "ARQUIVADO"].includes(fase) && podeFolha(s) && s.role !== "LEITURA" && <form action={adicionarExplicacao} className="mt-3 grid grid-cols-1 gap-2 border-t border-line pt-3 sm:grid-cols-[minmax(0,1fr)_8rem_minmax(0,1.4fr)_auto]"><input type="hidden" name="cycleId" value={c.id} /><Field label="Motivo"><Select name="motivo">{Object.entries(MOTIVOS_VARIACAO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field><Field label="Valor (R$)"><Input name="valor" inputMode="decimal" /></Field><Field label="Explicação"><Input name="texto" placeholder="ex.: 3 admissões na Cultura" /></Field><div className="flex items-end"><Btn small kind="ghost">Vincular</Btn></div></form>}
        </Card>

        {/* passo 4 */}
        <Card title="4 · Resultado do contador">
          {res.rows.length > 0 && <><Table head={["Unidade · área", "Pessoas", "Proventos", "Encargos", "Provisões", "Benefícios e rescisões", "Custo (R$)"]}>{res.rows.map(r => <tr key={r.id}><Td>{r.unidade ?? "—"}<div className="text-xs text-slate-500">{r.area ?? "—"}</div></Td><Td className="tabular-nums">{r.headcount ?? "—"}</Td><Td className="text-right tabular-nums">{N(r.salarios)}</Td><Td className="text-right tabular-nums">{N(r.inss + r.fgts)}</Td><Td className="text-right tabular-nums">{N(r.provisao_13 + r.provisao_ferias)}</Td><Td className="text-right tabular-nums">{N(r.beneficios + r.rescisoes + r.outros)}</Td><Td className="text-right font-medium tabular-nums">{N(custoLinha(r))}</Td></tr>)}</Table>
            <p className="mt-1 text-[11px] text-slate-500">Valores em reais.</p>
            <p className="mt-2 text-sm">Custo total: <b>{R(res.total)}</b> · encargos {R(res.encargos)} · provisões {R(res.provisoes)}{res.headcount !== null ? ` · ${res.headcount} pessoas` : ""}. IRRF é retido do colaborador e não entra no custo.</p></>}
          {podeConferir(s) && ["CONFERIDO", "RESULTADO_IMPORTADO"].includes(fase) && <form action={importarResultado} className="mt-3 space-y-2 border-t border-line pt-3"><input type="hidden" name="cycleId" value={c.id} />
            <Field label="Arquivo do contador (CSV/XLSX) ou cole abaixo" hint="Colunas: unidade; área; headcount; salários; INSS patronal; FGTS; IRRF; provisão 13º; provisão férias; benefícios; rescisões; outros. Linha de total é ignorada."><input type="file" name="arquivo" accept=".csv,.txt,.xlsx,.xls" className="block w-full rounded-md border border-line bg-white px-2 py-1.5 text-xs" /></Field>
            <Textarea name="texto" placeholder={"unidade;area;headcount;salarios;inss;fgts;irrf;provisao_13;provisao_ferias;beneficios;rescisoes;outros\nCarandá;Pedagógica;12;38000;8360;3040;1200;3166;4222;2400;0;0"} className="font-mono text-xs" />
            <Btn small kind={fase === "RESULTADO_IMPORTADO" ? "ghost" : "primary"}>{fase === "RESULTADO_IMPORTADO" ? "Importar de novo (substitui)" : "Importar resultado"}</Btn></form>}
          {podeConferir(s) && fase === "RESULTADO_IMPORTADO" && <form action={aceitarResultado} className="mt-3 flex flex-wrap items-center gap-2"><input type="hidden" name="cycleId" value={c.id} /><Btn small>Aceitar resultado (vira custo REAL)</Btn>{exigeExplicacao(c.variacao_pct, limite) && !explic.length && <span className="text-xs text-erro">Variação de {fmtPct(c.variacao_pct)}: vincule explicações antes.</span>}</form>}
          {c.aceito_em && <p className="mt-2 text-xs text-ok">Aceito em {fmtDataHora(c.aceito_em)} — custo REAL na DRE, no KPI-13 e no custo por aluno.</p>}
          {!res.rows.length && !["CONFERIDO", "RESULTADO_IMPORTADO"].includes(fase) && <p className="text-sm text-slate-600">O resultado entra depois da conferência aprovada.</p>}
        </Card>

        {/* passo 5 */}
        <Card title="5 · Holerites e guias" actions={<Link href="/folha/arquivo" className="text-xs text-acao">Arquivo completo →</Link>}>
          {docsVisiveis.length === 0 ? <p className="text-sm text-slate-600">Nenhum documento arquivado.</p> : <ul className="divide-y divide-line text-sm">{docsVisiveis.map(d => <li key={d.id} className="flex flex-wrap items-center gap-2 py-1.5"><Badge v="ABERTO" label={TIPOS_DOC[d.tipo] ?? d.tipo} /><a href={`/api/anexos/${d.attachment_id}`} target="_blank" rel="noreferrer" className="font-medium text-acao">{d.nome}</a>{d.colaborador && <span className="text-xs text-slate-500">· {d.colaborador}</span>}<span className="ml-auto text-[11px] text-slate-500">{d.user_nome} · {fmtDataHora(d.created_at)} · {d.consultas} consulta(s)</span></li>)}</ul>}
          {faltam.length > 0 && <p className="mt-2 text-xs text-aviso">Faltando: {faltam.map(t => TIPOS_DOC[t] ?? t).join(", ")}.</p>}
          {(podePreparar(s) || s.role === "FINANCEIRO") && <form action={enviarDocumentoFolha} className="mt-3 grid grid-cols-1 gap-2 border-t border-line pt-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto]"><input type="hidden" name="cycleId" value={c.id} />
            <Field label="Tipo"><Select name="tipo">{Object.entries(TIPOS_DOC).filter(([k]) => podePreparar(s) || k.startsWith("GUIA_")).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="Colaborador (holerite individual)"><Select name="employeeId" defaultValue=""><option value="">— lote / documento geral —</option>{esp.pessoas.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field>
            <Field label="Arquivo"><input type="file" name="arquivo" required className="block w-full rounded-md border border-line bg-white px-2 py-1.5 text-xs" /></Field><div className="flex items-end"><Btn small kind="ghost">Anexar</Btn></div></form>}
          <div className="mt-3 flex flex-wrap gap-2">
            {podePreparar(s) && fase === "ACEITO" && <form action={arquivarCiclo}><input type="hidden" name="cycleId" value={c.id} /><Btn small kind={faltam.length ? "ghost" : "primary"}>Arquivar e completar o ciclo</Btn></form>}
            {podeFolha(s) && faltam.length > 0 && s.role !== "LEITURA" && <form action={cobrarDocumentos}><input type="hidden" name="cycleId" value={c.id} /><Btn small kind="ghost">Registrar cobrança ao contador</Btn></form>}
          </div>
        </Card>

        <Card title="Trilha do ciclo" className="xl:col-span-2">
          {eventos.length === 0 ? <p className="text-sm text-slate-600">Sem eventos.</p> : <ol className="space-y-1 text-sm">{eventos.map((e, i) => <li key={i} className="grid grid-cols-[9.5rem_minmax(0,1fr)] gap-2"><span className="text-xs tabular-nums text-slate-500">{fmtDataHora(e.at)}</span><span><b className="text-navy">{e.user_nome ?? "sistema"}</b> · {e.texto}</span></li>)}</ol>}
          <p className="mt-2 text-[11px] text-slate-500">Competência {rotuloMes(c.competencia)} · a trilha não pode ser editada nem apagada pela interface.</p>
        </Card>
      </div>
    </Page>
  );
}
