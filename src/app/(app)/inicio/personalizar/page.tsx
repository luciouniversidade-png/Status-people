import { requireSession } from "@/lib/auth";
import { Page, Card, Btn, Flash, Input } from "@/components/ui";
import { BLOCOS, ATALHOS, MAX_ATALHOS, MAX_KPIS_INICIO, PERFIS_MODULO, preferencias, padroes, blocosPossiveis, atalhosPossiveis } from "@/lib/inicio";
import { kpisVisiveis, vePainelExecutivo } from "@/lib/kpi";
import { AREAS, ORDEM_AREAS, nomeKpi } from "@/lib/kpi-catalogo";
import { getSettings } from "@/lib/utils";
import { salvarInicio, restaurarInicio } from "./actions";

export const dynamic = "force-dynamic";

/** Personalizar o Início: blocos (e ordem), atalhos, indicadores e página inicial. Tudo sem programação — marque e salve. */
export default async function Personalizar({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const sp = await searchParams;
  const [p, cfg] = await Promise.all([preferencias(s), getSettings()]); const pad = padroes(s);
  const blocos = blocosPossiveis(s); const ordem = (k: string) => { const i = p.blocos.indexOf(k as never); return i >= 0 ? i + 1 : ""; };
  const atalhos = atalhosPossiveis(s);
  const kpis = vePainelExecutivo(s) ? await kpisVisiveis(s) : [];
  const kpisMarcados = new Set(p.kpis?.length ? p.kpis : kpis.filter(k => k.destaque).sort((a, b) => (a.destaque ?? 99) - (b.destaque ?? 99)).slice(0, 4).map(k => k.chave));
  const modulo = PERFIS_MODULO[s.role] ?? (s.role === "COLABORADOR" ? "a sua ficha (Meu painel)" : null);
  return (
    <Page title="Personalizar o Início" sub="Escolha o que aparece na sua página inicial e em que ordem. Vale só para você." actions={<Btn kind="ghost" href="/">Voltar ao Início</Btn>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <form action={salvarInicio} className="space-y-4">
        {modulo && <Card title="Página inicial">
          <div className="space-y-2 text-sm">
            <label className="flex items-start gap-2"><input type="radio" name="paginaInicial" value="modulo" defaultChecked={p.paginaInicial !== "inicio"} className="mt-1" /><span>Entrar direto {PERFIS_MODULO[s.role] ? `no meu módulo (${PERFIS_MODULO[s.role]})` : "na minha ficha"} <span className="text-slate-500">— padrão da sua atuação</span></span></label>
            <label className="flex items-start gap-2"><input type="radio" name="paginaInicial" value="inicio" defaultChecked={p.paginaInicial === "inicio"} className="mt-1" /><span>Entrar no Início personalizado (pendências, atalhos e blocos abaixo)</span></label>
          </div>
        </Card>}
        <Card title="Blocos e ordem">
          <p className="mb-3 text-xs text-slate-500">Marque os blocos e numere a ordem (1 aparece primeiro). Sem número, o bloco vai para o fim.</p>
          <ul className="divide-y divide-line">{blocos.map(b => <li key={b.chave} className="flex flex-wrap items-center gap-3 py-2">
            <label className="flex min-w-0 flex-1 items-start gap-2 text-sm"><input type="checkbox" name={`bloco_${b.chave}`} value="1" defaultChecked={p.blocos.includes(b.chave)} className="mt-1" /><span className="min-w-0"><b className="text-navy">{b.nome}</b>{pad.blocos.includes(b.chave) && <span className="ml-1 text-[11px] text-slate-400">padrão</span>}<span className="block text-xs text-slate-500">{b.descricao}</span></span></label>
            <label className="flex items-center gap-1 text-xs text-slate-600">ordem <Input name={`ordem_${b.chave}`} type="number" min={1} max={20} defaultValue={ordem(b.chave)} className="!w-16 !py-1" /></label>
          </li>)}</ul>
        </Card>
        <Card title={`Atalhos (até ${MAX_ATALHOS})`}>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">{atalhos.map(a => <label key={a.chave} className="flex items-center gap-2 text-sm"><input type="checkbox" name="atalho" value={a.chave} defaultChecked={p.atalhos.includes(a.chave)} />{a.rotulo}</label>)}</div>
        </Card>
        {kpis.length > 0 && <Card title={`Meus indicadores (até ${MAX_KPIS_INICIO})`}>
          <div id="indicadores" className="space-y-3">{ORDEM_AREAS.filter(ar => kpis.some(k => k.area === ar)).map(ar => <fieldset key={ar}><legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{AREAS[ar].nome}</legend>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">{kpis.filter(k => k.area === ar).map(k => <label key={k.chave} className="flex items-center gap-2 text-sm"><input type="checkbox" name="kpi" value={k.chave} defaultChecked={kpisMarcados.has(k.chave)} />{nomeKpi(k, cfg.matriculas.anoLetivo as number)}</label>)}</div></fieldset>)}</div>
        </Card>}
        <div className="flex flex-wrap gap-2"><Btn pendingText="Salvando…">Salvar o meu Início</Btn></div>
      </form>
      {p.personalizado && <form action={restaurarInicio} className="mt-3"><Btn kind="ghost" danger small>Restaurar o padrão da atuação</Btn></form>}
    </Page>
  );
}
