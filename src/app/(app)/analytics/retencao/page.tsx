import Link from "@/components/Link";
import { redirect } from "next/navigation";
import { requireStaff, scopeUnit } from "@/lib/auth";
import { Page, Card, Table, Td, Stat, Field, Select, Btn } from "@/components/ui";
import { Linhas, Colunas, BarrasH, COR } from "@/components/graficos";
import { rotuloMes, fmtPct } from "@/lib/formato";
import { fmtData } from "@/lib/utils";
import { movimentacaoRetencao, pontosQuentes, fatoresSaida } from "@/lib/retencao";

export const dynamic = "force-dynamic";
const pct = (v: number | null | undefined, c = 1) => v == null ? "—" : fmtPct(v * 100, c);
const sinal = (n: number) => n > 0 ? `+${n}` : String(n);

export default async function Retencao({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaff(); if (!["RH", "DIRECAO", "DIRETOR_UNIDADE"].includes(s.role)) redirect("/"); const sp = await searchParams;
  const meses = [6, 12, 24].includes(Number(sp.meses)) ? Number(sp.meses) : 12; const u = scopeUnit(s);
  const [R, Q, F] = await Promise.all([movimentacaoRetencao(u, meses), pontosQuentes(u, meses), fatoresSaida(u, meses)]);
  const k = R.kpi; const varSaidas = k.saidasAnt ? (k.saidas - k.saidasAnt) / k.saidasAnt : null;
  return (
    <Page title="Movimentação e retenção" sub={`Quem entra, quem sai, por quê e onde agir · últimos ${meses} meses (desde ${fmtData(R.inicio)}) comparados aos ${meses} anteriores${u !== null ? " · sua unidade" : " · rede"}`}
      actions={<><form className="flex items-end gap-1"><Field label="Período"><Select name="meses" defaultValue={String(meses)}><option value="6">6 meses</option><option value="12">12 meses</option><option value="24">24 meses</option></Select></Field><Btn small kind="ghost">Ver</Btn></form><Btn kind="ghost" href="/analytics">People Analytics</Btn></>}>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        <Stat label="Quadro hoje" value={k.ativos} hint={k.crescimento != null ? `${k.crescimento >= 0 ? "+" : ""}${pct(k.crescimento)} no período (era ${k.quadroInicio})` : undefined} />
        <Stat label="Entradas" value={k.entradas} hint="admissões no período" />
        <Stat label="Saídas" value={k.saidas} hint={varSaidas != null ? `${varSaidas >= 0 ? "+" : ""}${pct(varSaidas, 0)} vs período anterior (${k.saidasAnt})` : `período anterior: ${k.saidasAnt}`} />
        <Stat label="Rotatividade" value={pct(k.turnover)} hint={`saídas ÷ quadro médio · ${pct(k.mediaMensal)} ao mês`} />
        <Stat label="Retenção 12 meses" value={pct(k.retencao12, 0)} hint={`de ${k.base12} ativos há 1 ano`} />
        <Stat label="Completaram 1 ano" value={pct(k.completaram1ano, 0)} hint={`contratados há 12–24 meses (${k.coorte})`} />
        <Stat label="Saídas no 1º ano" value={<span className={R.primeiroAno.length ? "text-aviso" : ""}>{R.primeiroAno.length}</span>} hint="no período" />
        <Stat label="Liderados por gestor" value={k.mediaLiderados != null ? k.mediaLiderados.toFixed(1).replace(".", ",") : "—"} hint={`${k.gestores} gestor(es) · ${R.semGestor} sem gestor`} />
      </div>

      {Q.linhas.some(l => l.alertas.length) && <Card className="mb-4" title="Pontos quentes — onde agir primeiro">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">{Q.linhas.filter(l => l.alertas.length).map(l => <div key={l.unitId} className="rounded-md border border-line p-3">
          <div className="mb-1 flex items-baseline justify-between"><b className="text-navy">{l.unidade}</b><span className="text-xs text-slate-500">{l.ativos} ativos · {l.saidas} saídas</span></div>
          <ul className="space-y-1.5 text-xs">{l.alertas.map((a, i) => <li key={i} className="rounded border-l-2 border-aviso bg-[#fff8ec] px-2 py-1"><span className="font-semibold text-aviso">{a.tipo}</span> · {a.texto}<div className="text-slate-600">→ {a.acao}</div></li>)}</ul></div>)}</div>
        <p className="mt-2 text-[11px] text-slate-500">Clima da última pesquisa encerrada{Q.pesquisa ? ` (${Q.pesquisa.nome}, ${fmtData(Q.pesquisa.fim)})` : ""}: dimensões com menos de 60% de respostas favoráveis, só onde a unidade atingiu o mínimo de anonimato. Saídas acima de 1,3× a média da rede.</p>
      </Card>}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Quadro, entradas e saídas mês a mês"><Colunas categorias={R.mensal.map(m => rotuloMes(m.mes))} series={[{ nome: "Entradas", valores: R.mensal.map(m => m.entradas), cor: COR.ok }, { nome: "Saídas", valores: R.mensal.map(m => m.saidas), cor: COR.erro }]} linhas={[{ nome: "Quadro no fim do mês", valores: R.mensal.map(m => m.quadro), cor: COR.navy }]} rotulos rotulo="Entradas e saídas por mês" formato={x => String(Math.round(x))} /></Card>
        <Card title="Rotatividade mensal"><Linhas categorias={R.mensal.map(m => rotuloMes(m.mes))} series={[{ nome: "Saídas ÷ quadro médio do mês", valores: R.mensal.map(m => m.taxa == null ? null : m.taxa * 100), cor: COR.erro, area: true }]} formato={x => fmtPct(x, 1)} formatoDica={x => fmtPct(x, 1)} rotulo="Rotatividade mensal" /></Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title={`Por que as pessoas saem — período × ${meses} meses anteriores`}>
          <Table head={["Motivo", "Agora", "Antes", "Variação"]} empty="Nenhuma saída nos dois períodos.">{R.motivos.map(m => <tr key={m.motivo}><Td>{m.motivo}</Td><Td><b>{m.atual}</b></Td><Td>{m.anterior}</Td><Td className={m.dif == null ? "text-erro" : m.dif > 0 ? "text-erro" : m.dif < 0 ? "text-ok" : ""}>{m.dif == null ? "novo" : m.dif === 0 ? "=" : `${m.dif > 0 ? "+" : ""}${Math.round(m.dif * 100)}%`}</Td></tr>)}</Table>
          <p className="mt-1 text-[11px] text-slate-500">Motivo como registrado no desligamento. Padronize os textos (ex.: “Proposta melhor”, “Mudança de cidade”, “Desempenho”) para a comparação ficar fiel.</p>
        </Card>
        <Card title="Saídas por tempo de casa"><BarrasH rotulo="Saídas por tempo de casa" itens={R.porCasa.map(c => ({ rotulo: c.faixa, valor: c.saidas, cor: ["até 3 meses", "3 a 6 meses", "6 a 12 meses"].includes(c.faixa) ? COR.erro : COR.acao }))} formato={x => String(Math.round(x))} />
          <p className="mt-1 text-[11px] text-slate-500">Em vermelho, saídas no primeiro ano — sinal de seleção ou integração a rever.</p></Card>
      </div>

      <Card className="mt-4" title={`Fatores associados às saídas — taxa de cada grupo × taxa geral (${F.geral === null ? "—" : `${F.geral.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`} em ${meses} meses)`}>
        {F.aumentam.length + F.diminuem.length === 0 ? <p className="text-sm text-slate-500">Sem diferença relevante entre grupos com {F.minimo}+ pessoas no período (ou sem saídas).</p> : <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div><p className="mb-1 text-xs font-semibold text-erro">Grupos que saem mais que a média</p><BarrasH divergente rotulo="Grupos com taxa de saída acima da geral" itens={F.aumentam.map(g => ({ rotulo: g.grupo.charAt(0).toUpperCase() + g.grupo.slice(1), valor: g.delta, cor: COR.erro, sub: `${g.dim} · ${g.taxa.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% · ${g.saidas} de ${g.n} pessoas` }))} formato={x => `${x > 0 ? "+" : ""}${x.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} p.p.`} largRotulo="12rem" /></div>
          <div><p className="mb-1 text-xs font-semibold text-ok">Grupos que ficam mais</p><BarrasH divergente rotulo="Grupos com taxa de saída abaixo da geral" itens={F.diminuem.map(g => ({ rotulo: g.grupo.charAt(0).toUpperCase() + g.grupo.slice(1), valor: g.delta, cor: COR.ok, sub: `${g.dim} · ${g.taxa.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% · ${g.saidas} de ${g.n} pessoas` }))} formato={x => `${x > 0 ? "+" : ""}${x.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} p.p.`} largRotulo="12rem" /></div>
        </div>}
        <p className="mt-2 text-[11px] text-slate-500">Taxa = saídas no período ÷ pessoas que passaram pelo quadro no período. Só grupos com {F.minimo} pessoas ou mais (nada identifica ninguém). Associação, não causa: mostra onde investigar — tempo de casa curto, unidade, turno, ausência de PDI.</p>
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Saídas por gestor direto"><Table head={["Gestor", "Saídas", "Equipe no período", "Taxa"]} empty="Nenhuma saída no período.">{R.porGestor.map(g => <tr key={g.gestor}><Td>{g.gestor}</Td><Td>{g.saidas}</Td><Td>{g.equipe}</Td><Td className={g.taxa != null && g.taxa > (k.turnover ?? 0) * 1.5 && g.saidas >= 2 ? "font-medium text-erro" : ""}>{pct(g.taxa, 0)}</Td></tr>)}</Table>
          <p className="mt-1 text-[11px] text-slate-500">Em vermelho: taxa 1,5× acima da rede com 2+ saídas. Não é veredito sobre o líder — é onde conversar primeiro.</p></Card>
        <Card title="Quem saiu antes de completar 1 ano"><Table head={["Colaborador", "Unidade", "Ficou", "Motivo"]} empty="Ninguém saiu antes de 1 ano. 👍">{R.primeiroAno.map(p => <tr key={p.id}><Td><Link className="text-acao" href={`/colaboradores/${p.id}`}>{p.nome}</Link><span className="block text-[11px] text-slate-500">{p.cargo ?? "cargo não informado"}</span></Td><Td className="text-xs">{p.unidade}</Td><Td className="whitespace-nowrap tabular-nums">{p.dias} dias</Td><Td className="text-xs">{p.motivo}</Td></tr>)}</Table></Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Onde o quadro cresceu ou encolheu — por unidade"><Table head={["Unidade", "Antes", "Hoje", "Variação"]} empty="">{R.porUnidade.map(x => <tr key={x.nome}><Td>{x.nome}</Td><Td>{x.antes}</Td><Td><b>{x.agora}</b></Td><Td className={x.dif > 0 ? "text-ok" : x.dif < 0 ? "text-erro" : ""}>{sinal(x.dif)}{x.pct != null ? ` (${x.pct >= 0 ? "+" : ""}${pct(x.pct, 0)})` : ""}</Td></tr>)}</Table></Card>
        <Card title="Onde o quadro cresceu ou encolheu — por área"><Table head={["Área", "Antes", "Hoje", "Variação"]} empty="">{R.porArea.map(x => <tr key={x.nome}><Td>{x.nome}</Td><Td>{x.antes}</Td><Td><b>{x.agora}</b></Td><Td className={x.dif > 0 ? "text-ok" : x.dif < 0 ? "text-erro" : ""}>{sinal(x.dif)}{x.pct != null ? ` (${x.pct >= 0 ? "+" : ""}${pct(x.pct, 0)})` : ""}</Td></tr>)}</Table></Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Estrutura de liderança — liderados diretos por gestor">
          <BarrasH rotulo="Liderados por gestor" itens={R.gestores.slice(0, 20).map(g => ({ rotulo: g.nome, sub: [g.cargo, g.unidade].filter(Boolean).join(" · "), valor: g.liderados, cor: g.liderados > 15 ? COR.erro : g.liderados <= 2 ? COR.aviso : COR.acao }))} formato={x => String(Math.round(x))} largRotulo="12rem" />
          <p className="mt-1 text-[11px] text-slate-500">Mais de 15 liderados diretos (vermelho) dificulta acompanhar cada pessoa; 1–2 (amarelo) pode ser camada de gestão desnecessária. {R.semGestor} ativo(s) sem gestor definido{R.gestorInativo.length ? ` · ${R.gestorInativo.length} gestor(es) já desligado(s) ainda vinculado(s) a equipe` : ""}.</p>
        </Card>
        <Card title="Desenvolvimento (PDI)">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3"><Stat label="Com PDI ativo" value={pct(R.desenv.pctComPdi, 0)} hint={`${R.desenv.comPdi} de ${R.desenv.ativos}`} /><Stat label="Ações concluídas" value={pct(R.desenv.pctConcl, 0)} hint={`${R.desenv.concluidas} de ${R.desenv.acoes}`} /><Stat label="Ações atrasadas" value={<span className={R.desenv.atrasadas ? "text-erro" : ""}>{R.desenv.atrasadas}</span>} hint={`${R.desenv.pessoasAtrasadas} pessoa(s)`} /><Stat label="Paradas há 60+ dias" value={R.desenv.paradas} hint="não iniciadas" /></div>
          <p className="mt-2 text-[11px] text-slate-500">Detalhe por pessoa em Desempenho → Liderança e na ficha de cada colaborador.</p>
        </Card>
      </div>
    </Page>
  );
}
