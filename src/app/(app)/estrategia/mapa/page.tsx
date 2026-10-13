import Link from "@/components/Link";
import { requireGestao, scopeUnit } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Flash, Field, Select, Btn } from "@/components/ui";
import { getSettings } from "@/lib/utils";
import { okrs } from "@/lib/estrategia";
import { listarIndicadores } from "@/lib/gestao-estrategica";
import { perspectivaDoObjetivo, type Perspectiva } from "@/lib/gestao-calc";
import { definirPerspectiva, ligarObjetivos, desligarObjetivos } from "../gestao-actions";
import { SubNav, Barra } from "../_ui";

export const dynamic = "force-dynamic";

export default async function Mapa({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireGestao(); const sp = await searchParams; const cfg = await getSettings(); const u = scopeUnit(s); const ciclo = sp.ciclo ?? cfg.estrategia.cicloAtual;
  const [ok, inds, links, ciclos] = await Promise.all([okrs(ciclo, u), listarIndicadores(u),
    sql<{ id: number; de: number; para: number }[]>`SELECT l.id, l.de_objective_id AS de, l.para_objective_id AS para FROM objective_links l JOIN objectives o ON o.id=l.de_objective_id WHERE o.ciclo=${ciclo} ORDER BY l.id`,
    sql<{ ciclo: string }[]>`SELECT DISTINCT ciclo FROM objectives ORDER BY ciclo DESC`]);
  const persp = cfg.estrategia.perspectivas as Perspectiva[]; const mapaPilar = cfg.estrategia.perspectivaDoPilar as Record<string, string>;
  const objs = ok.objetivos.filter(o => o.status === "ATIVO").map(o => ({ ...o, persp: perspectivaDoObjetivo(o.perspectiva, o.pilar, mapaPilar), sugerida: !o.perspectiva }));
  const nome = new Map(objs.map(o => [o.id, o.titulo])); const visiveis = new Set(objs.map(o => o.id));
  const ls = links.filter(l => visiveis.has(l.de) && visiveis.has(l.para));
  const ESTR = ["DIRECAO", "RH"].includes(s.role); const posicionaveis = objs.filter(o => ESTR || (s.role === "DIRETOR_UNIDADE" && o.unit_id !== null && o.unit_id === s.unitId));
  const bandas = [...persp.map(p => ({ ...p, objs: objs.filter(o => o.persp === p.chave) })), ...(objs.some(o => !o.persp || !persp.some(p => p.chave === o.persp)) ? [{ chave: "SEM", nome: "Sem perspectiva", descricao: "Objetivos que ainda não foram posicionados no mapa", objs: objs.filter(o => !o.persp || !persp.some(p => p.chave === o.persp)) }] : [])];
  return (
    <Page title={`Mapa estratégico ${ciclo}`} sub="Os objetivos do ciclo organizados por perspectiva, com as relações de causa e efeito: o que se faz em aprendizado, pessoas e processos sustenta o valor para as famílias e o resultado financeiro.">
      <SubNav atual="mapa" />
      <Flash ok={sp.ok} erro={sp.erro} />
      <form className="mb-3 flex items-end gap-2"><Field label="Ciclo"><Select name="ciclo" defaultValue={ciclo}>{[...new Set([ciclo, cfg.estrategia.cicloAtual, ...ciclos.map(c => c.ciclo)])].map(c => <option key={c}>{c}</option>)}</Select></Field><Btn kind="ghost">Ver</Btn></form>
      <div className={`grid grid-cols-1 gap-4 ${posicionaveis.length ? "lg:grid-cols-[minmax(0,1fr)_320px]" : ""} lg:items-start`}>
        <div className="space-y-3">
          {objs.length === 0 && <Card><p className="text-sm text-slate-500">Nenhum objetivo ativo no ciclo {ciclo}. Defina os objetivos em OKRs.</p></Card>}
          {bandas.map(b => { const is = inds.filter(i => i.perspectiva === b.chave && i.temMeta); const noAlvo = is.filter(i => i.farol === "VERDE" && i.emDia).length;
            return <section key={b.chave} id={`p-${b.chave}`} className={`rounded-md border ${b.chave === "SEM" ? "border-dashed border-amber-300 bg-amber-50/40" : "border-line bg-white"}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-2"><div><h2 className="text-sm font-semibold text-navy">{b.nome}</h2><p className="text-xs text-slate-500">{b.descricao}</p></div>
                {b.chave !== "SEM" && <Link href={`/estrategia/indicadores?perspectiva=${b.chave}`} className="text-xs text-acao">{is.length ? `${noAlvo} de ${is.length} indicador(es) no alvo` : "nenhum indicador com meta"}</Link>}</div>
              <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3">
                {b.objs.length === 0 ? <p className="text-xs text-slate-400">Nenhum objetivo nesta perspectiva.</p> : b.objs.map(o => { const para = ls.filter(l => l.de === o.id); const de = ls.filter(l => l.para === o.id);
                  return <div key={o.id} className="rounded-md border border-line bg-white p-2.5">
                    <div className="flex items-start justify-between gap-2"><Link className="text-sm font-medium text-acao" href={`/estrategia/okrs/${o.id}`}>{o.titulo}</Link><span className={`text-sm font-semibold tabular-nums ${o.progresso === null ? "text-slate-400" : o.progresso >= 70 ? "text-ok" : o.progresso >= 40 ? "text-aviso" : "text-erro"}`}>{o.progresso === null ? "—" : `${o.progresso}%`}</span></div>
                    <div className="my-1"><Barra p={o.progresso} faixas={[40, 70]} /></div>
                    <div className="text-[11px] text-slate-500">{o.owner ?? "sem dono"} · {o.unidade ?? "rede"} · {o.krs.length} KR(s){o.sugerida && o.persp ? ` · posição sugerida pelo pilar ${o.pilar}` : ""}</div>
                    {para.length > 0 && <div className="mt-1.5 text-[11px]"><span className="text-slate-500">contribui para → </span>{para.map(l => <span key={l.id} className="mr-1 inline-flex items-center gap-1 rounded bg-mist px-1.5 py-0.5">{nome.get(l.para)}{ESTR && <form action={desligarObjetivos} className="inline"><input type="hidden" name="id" value={l.id} /><input type="hidden" name="voltar" value={`/estrategia/mapa?ciclo=${ciclo}`} /><button aria-label="remover relação" className="text-slate-400 hover:text-erro">×</button></form>}</span>)}</div>}
                    {de.length > 0 && <div className="mt-1 text-[11px]"><span className="text-slate-500">sustentado por ← </span>{de.map(l => <span key={l.id} className="mr-1 inline-block rounded bg-mist px-1.5 py-0.5">{nome.get(l.de)}</span>)}</div>}
                  </div>; })}
              </div>
            </section>; })}
          <p className="text-xs text-slate-500">A perspectiva definida no objetivo prevalece; sem ela, vale a sugerida pelo pilar (Configurações → Estratégia). Leitura de baixo para cima: aprendizado e pessoas sustentam os processos, que geram valor para as famílias e sustentabilidade financeira.</p>
        </div>
        {posicionaveis.length > 0 && <div className="space-y-4">
          <Card title="Posicionar objetivo"><form action={definirPerspectiva} className="space-y-2"><input type="hidden" name="voltar" value={`/estrategia/mapa?ciclo=${ciclo}`} />
            <Field label="Objetivo"><Select name="objectiveId" required>{posicionaveis.map(o => <option key={o.id} value={o.id}>{o.titulo}</option>)}</Select></Field>
            <Field label="Perspectiva"><Select name="perspectiva"><option value="">Usar a sugerida pelo pilar</option>{persp.map(p => <option key={p.chave} value={p.chave}>{p.nome}</option>)}</Select></Field>
            <Btn small>Posicionar</Btn></form></Card>
          {ESTR && objs.length > 1 && <Card title="Relação de causa e efeito"><form action={ligarObjetivos} className="space-y-2"><input type="hidden" name="voltar" value={`/estrategia/mapa?ciclo=${ciclo}`} />
            <Field label="Este objetivo…"><Select name="deObjectiveId" required>{objs.map(o => <option key={o.id} value={o.id}>{o.titulo}</option>)}</Select></Field>
            <Field label="…contribui para"><Select name="paraObjectiveId" required>{objs.map(o => <option key={o.id} value={o.id}>{o.titulo}</option>)}</Select></Field>
            <Btn small>Ligar</Btn><p className="text-xs text-slate-500">Só objetivos do mesmo ciclo; relação que fecharia um ciclo (A → B → A, direta ou indireta) é recusada.</p></form></Card>}
        </div>}
      </div>
    </Page>
  );
}
