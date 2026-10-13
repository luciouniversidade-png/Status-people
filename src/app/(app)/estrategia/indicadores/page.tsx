import Link from "@/components/Link";
import { Modal } from "@/components/Modal";
import { requireGestao, scopeUnit } from "@/lib/auth";
import { Page, Card, Table, Td, Badge, Flash, Field, Input, Select, Textarea, Btn, Stat } from "@/components/ui";
import { getSettings, hoje } from "@/lib/utils";
import { listarIndicadores, fmtValor, TIPO_IND, type IndView } from "@/lib/gestao-estrategica";
import { FREQ_LABEL, FAROL_LABEL, ultimosPeriodos, periodoDe, nomePeriodo, type Perspectiva } from "@/lib/gestao-calc";
import { importarMedicoes, atualizarSistemaAgora } from "../gestao-actions";
import { SubNav, FarolBadge, Sparkline, metaCurta } from "../_ui";
import { FormIndicador, opcoesIndicador } from "./_form";

export const dynamic = "force-dynamic";
const SITUACOES: Record<string, string> = { NO_ALVO: "No alvo", ATENCAO: "Atenção", FORA: "Fora do alvo", SEM_META: "Sem meta", SEM_MEDICAO: "Medição atrasada" };

export default async function Indicadores({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireGestao(); const sp = await searchParams; const cfg = await getSettings(); const u = scopeUnit(s);
  const todos = await listarIndicadores(u, { incluirInativos: sp.inativos === "1" });
  const persp = cfg.estrategia.perspectivas as Perspectiva[]; const nomeP = new Map(persp.map(p => [p.chave, p.nome]));
  const passa = (i: IndView) => (!sp.perspectiva || (sp.perspectiva === "SEM" ? !i.perspectiva : i.perspectiva === sp.perspectiva)) && (!sp.area || i.area === sp.area) && (!sp.tipo || i.tipo === sp.tipo) && (!sp.q || `${i.nome} ${i.codigo ?? ""}`.toLowerCase().includes(sp.q.toLowerCase()))
    && (!sp.situacao || (sp.situacao === "NO_ALVO" && i.farol === "VERDE") || (sp.situacao === "ATENCAO" && i.farol === "AMARELO") || (sp.situacao === "FORA" && i.farol === "VERMELHO") || (sp.situacao === "SEM_META" && !i.temMeta) || (sp.situacao === "SEM_MEDICAO" && !i.emDia));
  const inds = todos.filter(passa); const ativos = todos.filter(i => i.ativo);
  const per = ultimosPeriodos(periodoDe(hoje()), 6);
  const grupos = [...persp.map(p => ({ chave: p.chave, nome: p.nome, xs: inds.filter(i => i.perspectiva === p.chave) })), { chave: "SEM", nome: "Sem perspectiva", xs: inds.filter(i => !i.perspectiva || !nomeP.has(i.perspectiva)) }].filter(g => g.xs.length);
  const podeCriar = ["DIRECAO", "RH", "DIRETOR_UNIDADE"].includes(s.role); const gestao = ["DIRECAO", "RH", "DIRETOR_UNIDADE", "GESTOR", "FINANCEIRO", "OPERACOES", "COMERCIAL"].includes(s.role);
  const opcoes = podeCriar ? await opcoesIndicador(s) : null;
  const conta = (f: (i: IndView) => boolean) => ativos.filter(f).length;
  return (
    <Page title="Indicadores" sub="Biblioteca de indicadores da escola: meta, limite de atenção e farol por regra explícita. Valores manuais, lidos do próprio sistema ou calculados (razão entre dois indicadores). Sem medição nunca vira zero."
      actions={<>{podeCriar && opcoes && <Modal label="Novo indicador" kind="primary" small={false} title="Novo indicador"><FormIndicador o={opcoes} /></Modal>}<Btn kind="ghost" href="/api/export/indicadores">Exportar CSV</Btn></>}>
      <SubNav atual="indicadores" />
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Indicadores ativos" value={ativos.length} hint={`${conta(i => i.tipo === "SISTEMA")} lido(s) do sistema · ${conta(i => i.tipo === "CALCULADO")} calculado(s)`} href="/estrategia/indicadores" />
        <Stat label="No alvo" value={<span className="text-ok">{conta(i => i.farol === "VERDE")}</span>} hint="pelo último valor medido" href="/estrategia/indicadores?situacao=NO_ALVO" />
        <Stat label="Atenção" value={<span className="text-aviso">{conta(i => i.farol === "AMARELO")}</span>} href="/estrategia/indicadores?situacao=ATENCAO" />
        <Stat label="Fora do alvo" value={<span className="text-erro">{conta(i => i.farol === "VERMELHO")}</span>} href="/estrategia/indicadores?situacao=FORA" />
        <Stat label="Sem meta" value={conta(i => !i.temMeta)} hint="acompanhados, sem classificação" href="/estrategia/indicadores?situacao=SEM_META" />
        <Stat label="Medição atrasada" value={<span className={conta(i => !i.emDia) ? "text-aviso" : ""}>{conta(i => !i.emDia)}</span>} hint="última medição fora da frequência" href="/estrategia/indicadores?situacao=SEM_MEDICAO" />
      </div>
      <form className="mb-3 grid grid-cols-2 items-end gap-2 sm:flex sm:flex-wrap">
        <Field label="Perspectiva"><Select name="perspectiva" defaultValue={sp.perspectiva ?? ""}><option value="">Todas</option>{persp.map(p => <option key={p.chave} value={p.chave}>{p.nome}</option>)}<option value="SEM">Sem perspectiva</option></Select></Field>
        <Field label="Área"><Select name="area" defaultValue={sp.area ?? ""}><option value="">Todas</option>{(cfg.estrategia.areasIndicador as string[]).map(a => <option key={a}>{a}</option>)}</Select></Field>
        <Field label="Situação"><Select name="situacao" defaultValue={sp.situacao ?? ""}><option value="">Todas</option>{Object.entries(SITUACOES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="Tipo"><Select name="tipo" defaultValue={sp.tipo ?? ""}><option value="">Todos</option>{Object.entries(TIPO_IND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="Buscar"><Input name="q" defaultValue={sp.q ?? ""} placeholder="nome ou código" /></Field>
        <label className="flex items-center gap-1.5 pb-2 text-xs"><input type="checkbox" name="inativos" value="1" defaultChecked={sp.inativos === "1"} /> incluir inativos</label>
        <Btn kind="ghost">Filtrar</Btn>
      </form>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="space-y-4">
          {grupos.length === 0 && <Card><p className="text-sm text-slate-500">{todos.length ? "Nenhum indicador com esses filtros." : "Nenhum indicador cadastrado. Comece pelos que a Direção já acompanha (inadimplência, ocupação, NPS, turnover) — os lidos do sistema se atualizam sozinhos."}</p></Card>}
          {grupos.map(g => <Card key={g.chave} title={`${g.nome} (${g.xs.length})`}>
            <Table head={["Indicador", "Último valor", "Meta", "Farol", `Últimos 6 meses`, "Medição"]}>{g.xs.map(i => <tr key={i.id} className={i.ativo ? "" : "opacity-60"}>
              <Td><Link className="font-medium text-acao" href={`/estrategia/indicadores/${i.id}`}>{i.codigo ? `${i.codigo} · ` : ""}{i.nome}</Link><div className="text-xs text-slate-500">{TIPO_IND[i.tipo]} · {FREQ_LABEL[i.frequencia] ?? i.frequencia} · {i.unidade ?? "rede"}{i.area ? ` · ${i.area}` : ""}{i.responsavel ? ` · ${i.responsavel}` : ""}{i.ativo ? "" : " · inativo"}</div></Td>
              <Td className="whitespace-nowrap tabular-nums">{fmtValor(i.ultimoValor, i.unidade_medida)}<div className="text-[11px] text-slate-500">{i.ultimoPeriodo ? nomePeriodo(i.ultimoPeriodo) : "sem medição"}</div></Td>
              <Td className="whitespace-nowrap text-xs">{metaCurta(i.config, i.unidade_medida)}</Td>
              <Td><FarolBadge f={i.farol} /></Td>
              <Td><Sparkline valores={per.map(p => i.serie[p])} /></Td>
              <Td className={`text-xs ${i.emDia ? "text-ok" : "text-aviso"}`}>{i.emDia ? "em dia" : "atrasada"}</Td>
            </tr>)}</Table>
          </Card>)}
          <p className="text-xs text-slate-500">Farol: {Object.values(FAROL_LABEL).join(" · ")}. “Medição em dia” = a última medição cobre o período mais recente da frequência (mensal: mês anterior ou atual). Indicadores lidos do sistema gravam o mês atual automaticamente (no máximo uma vez por hora) e, nas contagens mensais, também o mês anterior fechado.</p>
        </div>
        <div className="space-y-4">
          {gestao && <Card title="Importar medições"><form action={importarMedicoes} className="space-y-2">
            <Field label="Cole do Excel" hint="indicador (código ou nome exato) ; período (AAAA-MM ou MM/AAAA) ; valor — uma medição por linha. Só indicadores manuais; quem não é responsável pelo indicador recebe o erro da linha."><Textarea name="csv" className="min-h-[110px] font-mono text-xs" placeholder={"FIN-01;09/2026;4,8\nFIN-01;10/2026;4,1"} /></Field>
            <Field label="ou envie a planilha (.xlsx, .csv)"><input type="file" name="arquivo" accept=".xlsx,.xls,.csv,.txt" className="block w-full text-xs" /></Field>
            <Btn small>Importar</Btn></form></Card>}
          {gestao && <Card title="Leituras do sistema"><form action={atualizarSistemaAgora}><Btn small kind="ghost" pendingText="Lendo…">Atualizar agora</Btn></form><p className="mt-2 text-xs text-slate-500">Lê agora as métricas que alimentam os indicadores do tipo “lido do sistema” (ocupação, inadimplência, NPS, turnover, rematrícula, funil de captação…). A rotina diária faz isso sozinha.</p></Card>}
          <Card title="Como ler o farol"><ul className="space-y-1 text-xs text-slate-600"><li><Badge v="APROVADA" label="No alvo" /> atingiu a meta (ou está dentro da faixa).</li><li><Badge v="PENDENTE" label="Atenção" /> não atingiu a meta, mas está dentro do limite de atenção.</li><li><Badge v="REJEITADA" label="Fora do alvo" /> passou do limite de atenção.</li><li><Badge v="NEUTRO" label="Sem meta" /> acompanhado sem classificação.</li><li><Badge v="NEUTRO" label="Sem medição" /> nenhuma medição — nunca vira zero.</li></ul></Card>
        </div>
      </div>
    </Page>
  );
}
