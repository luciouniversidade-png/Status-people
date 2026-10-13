import Link from "@/components/Link";
import { requireGestao, scopeUnit } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Table, Td, Flash, Field, Input, Select, Btn, Stat } from "@/components/ui";
import { hoje } from "@/lib/utils";
import { painelMarketing, fmtValor, fmtNum, ORIGEM_FUNIL_LABEL } from "@/lib/gestao-estrategica";
import { nomePeriodo, periodoDe, validoPeriodo } from "@/lib/gestao-calc";
import { registrarInvestimentosMes, criarInvestimentosMarketing } from "../gestao-actions";
import { ORIGENS_FUNIL } from "@/lib/metricas-extra";
import { SubNav, FarolBadge, Sparkline, metaCurta } from "../_ui";

export const dynamic = "force-dynamic";
type R = { valor: number | null; motivo: string | null };
const brl = (v: number | null) => fmtValor(v, "R$");
const Q = ({ r, fmt }: { r: R; fmt: (v: number | null) => string }) => r.valor === null ? <span className="text-xs text-slate-400" title={r.motivo ?? ""}>sem base</span> : <>{fmt(r.valor)}</>;
const pct = (v: number | null) => v === null ? "—" : `${fmtNum(v, 1)}%`;

export default async function Marketing({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireGestao(); const sp = await searchParams; const u = scopeUnit(s); const atual = periodoDe(hoje());
  const mes = sp.mes && validoPeriodo(sp.mes) && sp.mes <= atual ? sp.mes : atual;
  const [m, users] = await Promise.all([painelMarketing(u, mes, 6), sql<{ id: number; nome: string }[]>`SELECT id, nome FROM users WHERE ativo AND role NOT IN ('LEITURA','COLABORADOR') ORDER BY nome`]);
  const a = m.atual; const ESTR = ["DIRECAO", "RH"].includes(s.role);
  const podeInvest = m.invest.some(i => i.tipo === "MANUAL" && i.ativo && (ESTR || s.role === "COMERCIAL" || i.responsavel_user_id === s.id || (s.role === "DIRETOR_UNIDADE" && i.unit_id === s.unitId)));
  const semOrigem = m.canais.find(c => c.origem === "NAO_INFORMADA");
  return (
    <Page title="Marketing e captação" sub="Quanto custa trazer uma família: investimento mensal por canal × funil do cadastro de Matrículas (candidatos, reservas e matrículas novas por origem). Números agregados por mês e canal — nenhum lead individual é tratado aqui (não é CRM).">
      <SubNav atual="marketing" />
      <Flash ok={sp.ok} erro={sp.erro} />
      <form className="mb-3 flex items-end gap-2"><Field label="Mês"><Input name="mes" type="month" defaultValue={mes} max={atual} /></Field><Btn kind="ghost">Ver</Btn></form>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={`Investimento em ${nomePeriodo(mes)}`} value={<span className="text-xl">{brl(a.investimento)}</span>} hint={m.invest.length ? `${m.invest.length} canal(is) com indicador` : "sem indicador de investimento"} />
        <Stat label="Candidatos cadastrados" value={a.candidatos} hint="captação (sem rematrícula)" />
        <Stat label="Famílias que reservaram" value={a.reservas} />
        <Stat label="Matrículas novas confirmadas" value={a.matriculas} />
        <Stat label="Custo por candidato (CPL)" value={<span className="text-xl"><Q r={a.cpl} fmt={brl} /></span>} hint="investimento ÷ candidatos" />
        <Stat label="Custo por matrícula (CAC)" value={<span className="text-xl"><Q r={a.cac} fmt={brl} /></span>} hint="investimento ÷ matrículas novas" />
        <Stat label="Conversão candidato → matrícula" value={<Q r={a.conversao} fmt={pct} />} hint="matrículas novas ÷ candidatos do mês" />
        <Stat label="Reserva → matrícula" value={<Q r={a.reservaParaMatricula} fmt={pct} />} />
      </div>
      {m.investSoRede && <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-aviso">O investimento está registrado só para a rede: nesta visão de unidade, custo por candidato e por matrícula ficam sem base (dividir o gasto da rede pelos candidatos de uma unidade daria um número falso).</p>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="space-y-4">
          <Card title={`Por canal — ${nomePeriodo(mes)}`}>
            <Table head={["Canal (origem)", "Investimento", "Candidatos", "Reservas", "Matrículas", "CPL", "CAC", "Conversão"]}>{m.canais.map(c => <tr key={c.origem}><Td className="font-medium">{ORIGEM_FUNIL_LABEL[c.origem] ?? c.origem}</Td><Td className="whitespace-nowrap tabular-nums">{brl(c.investimento)}</Td><Td className="tabular-nums">{c.candidatos}</Td><Td className="tabular-nums">{c.reservas}</Td><Td className="tabular-nums">{c.matriculas}</Td><Td className="whitespace-nowrap tabular-nums"><Q r={c.cpl} fmt={brl} /></Td><Td className="whitespace-nowrap tabular-nums"><Q r={c.cac} fmt={brl} /></Td><Td className="tabular-nums"><Q r={c.conversao} fmt={pct} /></Td></tr>)}</Table>
            {m.semCanal !== null && <p className="mt-2 text-xs text-slate-600">Investimento sem canal definido no mês: {brl(m.semCanal)} (entra no total, não no custo por canal).</p>}
            {semOrigem && semOrigem.candidatos > 0 && <p className="mt-2 text-xs text-aviso">{semOrigem.candidatos} candidato(s) sem origem informada — preencha a origem no <Link className="underline" href="/matriculas/alunos">cadastro de Matrículas</Link> para o custo por canal ficar correto.</p>}
            <p className="mt-2 text-xs text-slate-500">“sem base” = falta medição ou o divisor é zero (passe o mouse para ver o motivo). Conversão do mês é aproximada: quem se matriculou no mês pode ter se cadastrado antes.</p>
          </Card>
          <Card title="Últimos 6 meses">
            <Table head={["Mês", "Investimento", "Candidatos", "Reservas", "Matrículas", "CPL", "CAC", "Conversão"]}>{m.tendencia.map(t => <tr key={t.periodo} className={t.periodo === mes ? "bg-mist/60" : ""}><Td className="whitespace-nowrap"><Link className="text-acao" href={`/estrategia/marketing?mes=${t.periodo}`}>{nomePeriodo(t.periodo)}</Link></Td><Td className="whitespace-nowrap tabular-nums">{brl(t.investimento)}</Td><Td className="tabular-nums">{t.candidatos}</Td><Td className="tabular-nums">{t.reservas}</Td><Td className="tabular-nums">{t.matriculas}</Td><Td className="whitespace-nowrap tabular-nums"><Q r={t.cpl} fmt={brl} /></Td><Td className="whitespace-nowrap tabular-nums"><Q r={t.cac} fmt={brl} /></Td><Td className="tabular-nums"><Q r={t.conversao} fmt={pct} /></Td></tr>)}</Table>
            <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-slate-600 sm:grid-cols-4">
              <div>Candidatos <Sparkline valores={m.tendencia.map(t => t.candidatos)} /></div><div>Matrículas <Sparkline valores={m.tendencia.map(t => t.matriculas)} /></div>
              <div>CPL <Sparkline valores={m.tendencia.map(t => t.cpl.valor)} /></div><div>CAC <Sparkline valores={m.tendencia.map(t => t.cac.valor)} /></div>
            </div>
          </Card>
          {m.outros.length > 0 && <Card title="Outros indicadores de matrículas e marketing"><Table head={["Indicador", "Último", "Meta", "Farol"]}>{m.outros.map(i => <tr key={i.id}><Td><Link className="text-acao" href={`/estrategia/indicadores/${i.id}`}>{i.nome}</Link></Td><Td className="whitespace-nowrap tabular-nums">{fmtValor(i.ultimoValor, i.unidade_medida)}{i.ultimoPeriodo ? <div className="text-[11px] text-slate-500">{nomePeriodo(i.ultimoPeriodo)}</div> : null}</Td><Td className="whitespace-nowrap text-xs">{metaCurta(i.config, i.unidade_medida)}</Td><Td><FarolBadge f={i.farol} /></Td></tr>)}</Table></Card>}
        </div>
        <div className="space-y-4">
          {podeInvest && <Card title={`Investimento de ${nomePeriodo(mes)}`}><form action={registrarInvestimentosMes} className="space-y-2"><input type="hidden" name="periodo" value={mes} />
            {m.invest.filter(i => i.tipo === "MANUAL" && i.ativo).sort((a, b) => (a.canal ? ORIGENS_FUNIL.indexOf(a.canal) : 99) - (b.canal ? ORIGENS_FUNIL.indexOf(b.canal) : 99)).map(i => <Field key={i.id} label={i.canal ? ORIGEM_FUNIL_LABEL[i.canal] ?? i.canal : i.nome}><Input name={`inv_${i.id}`} type="number" step="0.01" min="0" inputMode="decimal" defaultValue={i.serie[mes] ?? ""} placeholder="R$" /></Field>)}
            <Field label="Observação"><Input name="obs" placeholder="ex.: inclui impulsionamento da campanha de outubro" /></Field>
            <Btn small>Registrar investimentos</Btn><p className="text-xs text-slate-500">Campo vazio não é gravado (não vira zero). Para dizer que não houve investimento no canal, digite 0. Corrigir um mês substitui o valor e o anterior fica na auditoria.</p></form></Card>}
          {ESTR && m.invest.length === 0 && <Card title="Começar"><form action={criarInvestimentosMarketing} className="space-y-2"><p className="text-sm text-slate-700">Crie um indicador de investimento mensal para cada canal (indicação, site, redes sociais, visita, outros) — os mesmos canais da origem do candidato em Matrículas.</p><Field label="Responsável por informar os valores"><Select name="responsavelUserId" defaultValue={s.id}>{users.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field><Btn small>Criar indicadores de investimento</Btn></form></Card>}
          <Card title="Como cada número é calculado"><ul className="space-y-1.5 text-xs text-slate-600">
            <li><b>Candidatos:</b> cadastros do mês em Matrículas que não são rematrícula (alunos importados da rede ficam de fora; candidato que virou aluno continua contando no mês em que chegou).</li>
            <li><b>Reservas:</b> famílias que fizeram reserva no mês (cada aluno conta uma vez; quem já tinha matrícula confirmada antes não conta).</li>
            <li><b>Matrículas novas:</b> primeira matrícula confirmada do aluno, no mês da confirmação.</li>
            <li><b>CPL</b> = investimento ÷ candidatos · <b>CAC</b> = investimento ÷ matrículas novas · <b>Conversão</b> = matrículas novas ÷ candidatos.</li>
            <li>Sem investimento registrado ou divisor zero → “sem base”, nunca zero ou infinito.</li>
          </ul></Card>
        </div>
      </div>
    </Page>
  );
}
