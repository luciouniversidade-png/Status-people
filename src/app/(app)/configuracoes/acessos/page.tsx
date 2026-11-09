import { redirect } from "next/navigation";
import Link from "@/components/Link";
import { sql } from "@/db";
import { requireSession, can, type Role } from "@/lib/auth";
import { Page, Card, Flash, Table, Td, Badge, Btn, Field, Input, Select } from "@/components/ui";
import { ATUACAO, ATUACOES, ALCADAS, defDoCargo, telasDaAtuacao, aprovaPadrao, lerPadroes, descontoPadrao, rotuloAtuacao, naoRevisado, lerAjuste, rotuloTela, type Substituicao, type AcessoUsuario, type Tela } from "@/lib/acesso";
import { fmtData, hoje, addDays } from "@/lib/utils";
import { sincronizarTudo, salvarAprovacoesCargos, ajusteTelasLote, tirarAjusteTelas } from "../acesso-actions";
import { MarcarGrupo, MarcarPessoas, ContadorLote } from "@/components/AcessoEditorCliente";

export const dynamic = "force-dynamic";
const ABAS: [string, string][] = [["cargos", "Cargos"], ["pessoas", "Telas por pessoa"], ["telas", "Quem vê cada tela"], ["aprovacoes", "Quem aprova o quê"], ["fora", "Fora do padrão"]];

export default async function MatrizDeAcesso({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); if (!can.configurar(s)) redirect("/");
  const sp = await searchParams; const aba = ABAS.some(([k]) => k === sp.aba) ? sp.aba! : "cargos";
  const [cargos, users, [{ semAcesso }], pds] = await Promise.all([
    sql<{ id: number; nome: string; area: string; familia: string | null; acesso: unknown; pessoas: number; acessos: number }[]>`SELECT p.id, p.nome, p.area, p.familia, p.acesso,
        (SELECT count(*)::int FROM employees e WHERE e.position_id=p.id AND e.situacao <> 'DESLIGADO') AS pessoas,
        (SELECT count(*)::int FROM users u JOIN employees e ON e.id=u.employee_id WHERE e.position_id=p.id AND u.ativo) AS acessos
      FROM positions p ORDER BY p.ordem, p.nome`,
    sql<{ id: number; nome: string; email: string; role: string; ativo: boolean; origem_acesso: string | null; acesso: AcessoUsuario | null; substituicao: Substituicao | null; aprova: string[] | null; cargo: string | null; unidade: string | null; sit: string | null; ajuste_telas: unknown; employee_id: number | null; position_id: number | null; unit_ref: number | null }[]>`SELECT u.id, u.nome, u.email, u.role, u.ativo, u.origem_acesso, u.acesso, u.substituicao, u.aprova, p.nome AS cargo, un.nome AS unidade, e.situacao AS sit,
        u.ajuste_telas, u.employee_id, e.position_id, coalesce(e.unit_id, u.unit_id) AS unit_ref
      FROM users u LEFT JOIN employees e ON e.id=u.employee_id LEFT JOIN positions p ON p.id=e.position_id LEFT JOIN units un ON un.id=coalesce(e.unit_id, u.unit_id) ORDER BY u.nome`,
    sql<{ semAcesso: number }[]>`SELECT count(*)::int AS "semAcesso" FROM employees e WHERE e.situacao IN ('ATIVO','EM_ADMISSAO') AND NOT EXISTS (SELECT 1 FROM users u WHERE u.employee_id=e.id)`,
    lerPadroes(),
  ]);
  const padrao = pds.aprova; const defs = new Map(cargos.map(c => [c.id, defDoCargo(c)]));
  const ativos = users.filter(u => u.ativo);
  const excecoes = ativos.filter(u => u.origem_acesso === "EXCECAO"); const subs = ativos.filter(u => u.substituicao && u.substituicao.ate >= hoje());
  const semFicha = ativos.filter(u => u.origem_acesso === "DIRETO"); const semCargo = ativos.filter(u => u.origem_acesso === "SEM_CARGO");
  const personalizados = cargos.filter(c => { const d = defs.get(c.id)!; return d.telas || d.aprova; }).length;
  const naoRevisados = cargos.filter(c => naoRevisado(c.acesso)).length;
  // v32 · telas por pessoa: quem tem ajuste em vigor (vencido não conta) e o que ele muda
  const h0 = hoje(); const ajustes = ativos.filter(u => u.employee_id).map(u => ({ u, a: lerAjuste(u.ajuste_telas) })).filter((x): x is { u: (typeof ativos)[number]; a: NonNullable<ReturnType<typeof lerAjuste>> } => !!x.a);
  const emVigor = ajustes.filter(x => !x.a.ate || x.a.ate >= h0);
  const ajustePorTela = (k: string) => ({ mais: emVigor.filter(x => x.a.mais.includes(k)).map(x => x.u), menos: emVigor.filter(x => x.a.menos.includes(k)).map(x => x.u) });
  const veTela = (c: { id: number }, chave: string) => { const d = defs.get(c.id)!; return telasDaAtuacao(d.atuacao).some(t => t.chave === chave) && (!d.telas || d.telas.includes(chave) || telasDaAtuacao(d.atuacao).find(t => t.chave === chave)?.fixa); };
  const aprovaCargo = (c: { id: number }) => { const d = defs.get(c.id)!; return d.aprova ?? aprovaPadrao(d.atuacao, padrao); };
  // catálogo de telas por grupo (todas as atuações)
  const catalogo = new Map<string, Map<string, string>>();
  for (const r of ATUACOES) for (const t of telasDaAtuacao(r)) { if (t.fixa) continue; const g = catalogo.get(t.grupo) ?? new Map<string, string>(); if (!g.has(t.chave)) g.set(t.chave, t.rotulo); catalogo.set(t.grupo, g); }
  const grupos = [...catalogo.keys()]; const grupo = sp.grupo && catalogo.has(sp.grupo) ? sp.grupo : grupos.includes("Financeiro") ? "Financeiro" : grupos[0];
  const href = (k: string, extra = "") => `/configuracoes/acessos?aba=${k}${extra}`;
  return (
    <Page title="Acesso por cargo" sub="Cada cargo define o que a pessoa vê (telas), como atua (o que pode alterar e o alcance) e o que aprova. Usuário novo: escolha a ficha — o acesso vem do cargo. Promoveu, mudou o cargo na ficha: o acesso muda na próxima tela."
      actions={<form action={sincronizarTudo}><Btn small kind="ghost">Recalcular acessos agora</Btn></form>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {([["Cargos", cargos.length, `${personalizados} personalizado(s)`], ["Acessos ativos", ativos.length, `${ativos.filter(u => u.origem_acesso === "CARGO").length} pelo cargo`], ["Telas por pessoa", emVigor.length, "ajustes sobre o cargo"], ["Exceções", excecoes.length, "com motivo"], ["Substituições", subs.length, "temporárias, em curso"], ["Contas sem ficha", semFicha.length, "atuação na conta"], ["Fichas sem acesso", semAcesso, "ativas ou em admissão"]] as [string, number, string][]).map(([l, v, h]) => <div key={l} className="rounded-md border border-line bg-white px-3 py-2"><div className="text-xs text-slate-600">{l}</div><div className="text-xl font-semibold tabular-nums text-navy">{v}</div><div className="text-[11px] text-slate-500">{h}</div></div>)}
      </div>
      {naoRevisados > 0 && <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{naoRevisados} cargo(s) com a atuação só sugerida pelo nome do cargo (selo “sugerida”): abra cada um, confira a atuação e as telas e salve — o selo sai.</p>}
      <nav className="mb-4 flex flex-wrap gap-2 text-sm">{ABAS.map(([k, l]) => <Link key={k} href={href(k)} className={`rounded border px-2.5 py-1 ${k === aba ? "border-acao bg-sky-50 font-medium text-navy" : "border-line bg-white text-navy hover:bg-mist"}`}>{l}</Link>)}</nav>

      {aba === "cargos" && <Card title="Cargos e o acesso de cada um">
        <Table head={["Cargo", "Atuação", "Alcance", "Telas", "Aprova", "Pessoas", ""]}>
          {cargos.map(c => { const d = defs.get(c.id)!; const tot = telasDaAtuacao(d.atuacao).length; const ap = aprovaCargo(c); const revisado = !naoRevisado(c.acesso); return (
            <tr key={c.id}><Td><Link href={`/configuracoes/acessos/cargo/${c.id}`} className="font-medium text-navy hover:underline">{c.nome}</Link><div className="text-[11px] text-slate-500">{c.area}</div></Td>
              <Td>{ATUACAO[d.atuacao].curto}{!revisado && <div><Badge v="PENDENTE" label="sugerida" /></div>}</Td>
              <Td className="whitespace-nowrap">{ATUACAO[d.atuacao].alcance === "UNIDADE" ? "unidade" : "rede"}</Td>
              <Td className="whitespace-nowrap">{d.telas ? `${d.telas.length} de ${tot}` : `todas (${tot})`}</Td>
              <Td><span className="text-xs">{ap.length ? ap.map(k => ALCADAS.find(a => a.chave === k)?.curto ?? k).join(", ") : "—"}</span>{d.aprova && <div className="text-[10px] text-slate-500">personalizado</div>}</Td>
              <Td className="whitespace-nowrap tabular-nums">{c.acessos} / {c.pessoas}<div className="text-[10px] text-slate-500">acessos / fichas</div></Td>
              <Td className="whitespace-nowrap"><Link href={`/configuracoes/acessos/cargo/${c.id}`} className="text-xs text-acao hover:underline">Editar acesso</Link></Td></tr>); })}
        </Table>
        <p className="mt-2 text-xs text-slate-500">Novo cargo: Configurações → Cargos e organograma (já nasce com a atuação escolhida). Atuações: {ATUACOES.map(r => ATUACAO[r].rotulo).join(" · ")}.</p>
      </Card>}

      {aba === "pessoas" && (() => {
        // v32 · telas por pessoa: os ajustes em vigor e o ajuste em lote (várias pessoas, várias telas)
        const fCargo = Number(sp.cargo) || 0, fUn = Number(sp.unidade) || 0, fq = (sp.q ?? "").trim().toLowerCase(), fSo = sp.so === "1";
        const comFicha = ativos.filter(u => u.employee_id && u.sit !== "DESLIGADO");
        const unidades = [...new Map(comFicha.filter(u => u.unit_ref && u.unidade).map(u => [u.unit_ref!, u.unidade!])).entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
        const cargosCom = cargos.filter(c => comFicha.some(u => u.position_id === c.id));
        const pessoas = comFicha.filter(u => (!fCargo || u.position_id === fCargo) && (!fUn || u.unit_ref === fUn) && (!fq || u.nome.toLowerCase().includes(fq)) && (!fSo || !!lerAjuste(u.ajuste_telas)));
        const roles = ATUACOES.filter(r => pessoas.some(u => u.role === r));
        const cat = new Map<string, Tela[]>(); const vistos = new Set<string>();
        for (const r of roles) for (const t of telasDaAtuacao(r)) { if (t.fixa || vistos.has(t.chave)) continue; vistos.add(t.chave); cat.set(t.grupo, [...(cat.get(t.grupo) ?? []), t]); }
        const qs = new URLSearchParams(Object.entries({ aba: "pessoas", cargo: fCargo ? String(fCargo) : "", unidade: fUn ? String(fUn) : "", q: sp.q ?? "", so: fSo ? "1" : "" }).filter(([, v]) => v));
        const voltar = `/configuracoes/acessos?${qs.toString()}`;
        return <div className="space-y-4">
          <Card title={`Telas por pessoa — ajustes sobre o cargo (${ajustes.length})`}>
            <p className="mb-3 text-xs text-slate-600">O padrão de cada pessoa é o cargo. Aqui ficam só as diferenças: telas que a pessoa vê <b className="text-ok">a mais</b> e telas que ela <b className="text-erro">não vê</b> mesmo o cargo dando — com motivo e, se for o caso, data de fim. Mudou o cargo, o resto acompanha.</p>
            <Table head={["Pessoa", "Cargo e atuação", "A mais", "A menos", "Motivo", "Vale até", ""]} empty="Ninguém com telas diferentes do cargo.">
              {ajustes.map(({ u, a }) => { const venc = !!(a.ate && a.ate < h0); return (
                <tr key={u.id} className={venc ? "opacity-60" : ""}><Td className="min-w-[9rem]"><Link href={`/configuracoes/acessos/usuario/${u.id}#telas`} className="font-medium text-navy hover:underline">{u.nome}</Link><div className="text-[11px] text-slate-500">{u.unidade ?? ""}</div></Td>
                  <Td>{u.cargo ?? "—"}<div className="text-[11px] text-slate-500">{rotuloAtuacao(u.role)}</div></Td>
                  <Td className="text-xs">{a.mais.length ? a.mais.map(k => <div key={k} className="text-ok">+ {rotuloTela(k)}</div>) : <span className="text-slate-400">—</span>}</Td>
                  <Td className="text-xs">{a.menos.length ? a.menos.map(k => <div key={k} className="text-erro">− {rotuloTela(k)}</div>) : <span className="text-slate-400">—</span>}</Td>
                  <Td className="max-w-[16rem] text-xs">{a.motivo}<div className="text-[10px] text-slate-500">{a.em ? fmtData(a.em) : ""}{a.por ? ` · ${a.por}` : ""}</div></Td>
                  <Td className="whitespace-nowrap text-xs">{a.ate ? <>{fmtData(a.ate)}{venc && <div><Badge v="CANCELADA" label="vencido" /></div>}</> : "sem prazo"}</Td>
                  <Td className="whitespace-nowrap"><div className="flex flex-col items-start gap-1"><Link href={`/configuracoes/acessos/usuario/${u.id}#telas`} className="text-xs text-acao hover:underline">editar</Link><form action={tirarAjusteTelas}><input type="hidden" name="id" value={u.id} /><input type="hidden" name="voltar" value={voltar} /><button className="text-xs text-slate-600 hover:underline">voltar ao cargo</button></form></div></Td></tr>); })}
            </Table>
          </Card>

          <Card title="Ajuste em lote — várias pessoas e várias telas de uma vez">
            <form method="get" className="mb-3 grid grid-cols-1 gap-2 rounded-md bg-mist p-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto_auto] lg:items-end"><input type="hidden" name="aba" value="pessoas" />
              <Field label="Cargo"><Select name="cargo" defaultValue={fCargo ? String(fCargo) : ""}>{[<option key="" value="">Todos</option>, ...cargosCom.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)]}</Select></Field>
              <Field label="Unidade"><Select name="unidade" defaultValue={fUn ? String(fUn) : ""}>{[<option key="" value="">Todas</option>, ...unidades.map(([id, n]) => <option key={id} value={id}>{n}</option>)]}</Select></Field>
              <Field label="Buscar pessoa"><Input name="q" defaultValue={sp.q ?? ""} placeholder="nome" /></Field>
              <label className="flex items-center gap-2 pb-2 text-xs"><input type="checkbox" name="so" value="1" defaultChecked={fSo} /> só quem já tem ajuste</label>
              <Btn small kind="ghost">Filtrar</Btn>
            </form>
            {pessoas.length === 0 ? <p className="text-sm text-slate-500">Ninguém com acesso ativo e ficha neste filtro.</p> :
            <form action={ajusteTelasLote} className="space-y-4"><input type="hidden" name="voltar" value={voltar} />
              <div data-lista className="rounded-md border border-line">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-mist px-3 py-2"><span className="text-sm font-semibold text-navy">1. Pessoas ({pessoas.length} no filtro)</span><MarcarPessoas /></div>
                <div className="grid max-h-80 grid-cols-1 gap-x-4 overflow-auto px-3 py-2 sm:grid-cols-2 xl:grid-cols-3">
                  {pessoas.map(u => { const a = lerAjuste(u.ajuste_telas); return <label key={u.id} className="flex items-start gap-2 py-1 text-sm"><input type="checkbox" name="users" value={u.id} className="mt-0.5" /><span className="min-w-0"><span className="text-navy">{u.nome}</span><span className="block text-[11px] text-slate-500">{u.cargo ?? "ficha sem cargo"} · {ATUACAO[u.role as Role]?.curto ?? u.role}{u.unidade ? ` · ${u.unidade}` : ""}{a ? ` · ajuste +${a.mais.length} −${a.menos.length}` : ""}</span></span></label>; })}
                </div>
              </div>
              <fieldset className="rounded-md border border-line p-3"><legend className="px-1 text-sm font-semibold text-navy">2. O que fazer</legend>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {([["ACRESCENTAR", "Acrescentar as telas marcadas", "a pessoa passa a ver, mesmo o cargo não dando"], ["RETIRAR", "Retirar as telas marcadas", "a pessoa deixa de ver, mesmo o cargo dando"], ["PADRAO", "Voltar ao padrão do cargo", "nas telas marcadas — ou em todas, se nenhuma tela for marcada"]] as const).map(([v, l, d], i) => <label key={v} className="flex cursor-pointer items-start gap-2 rounded-md border border-line px-2.5 py-2 text-sm hover:bg-mist"><input type="radio" name="acao" value={v} defaultChecked={i === 0} className="mt-0.5" /><span><b className="text-navy">{l}</b><span className="block text-xs text-slate-600">{d}</span></span></label>)}
                </div>
              </fieldset>
              <div>
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2"><span className="text-sm font-semibold text-navy">3. Telas</span><span className="text-xs text-slate-500">As telas das atuações das pessoas listadas ({roles.map(r => ATUACAO[r].curto).join(", ")}). Para quem a atuação não tem a tela, ela fica sem efeito.</span></div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {[...cat.entries()].map(([g, ts]) => <fieldset key={g} className="rounded-md border border-line p-3"><legend className="px-1 text-sm font-medium text-navy">{g}<MarcarGrupo /></legend>{ts.map(t => <label key={t.chave} className="flex items-start gap-2 py-0.5 text-sm"><input type="checkbox" name="telas" value={t.chave} className="mt-0.5" /><span>{t.rotulo}</span></label>)}</fieldset>)}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_12rem]">
                <Field label="4. Motivo (obrigatório para acrescentar ou retirar)"><Input name="motivo" placeholder="Ex.: auxiliares apoiam o fechamento do mês" /></Field>
                <Field label="Vale até (opcional)"><Input type="date" name="ate" min={h0} max={addDays(h0, 366)} /></Field>
              </div>
              <div className="flex flex-wrap items-center gap-3"><Btn>Aplicar às pessoas marcadas</Btn><ContadorLote /><span className="text-xs text-slate-500">Cada pessoa continua seguindo o próprio cargo; o ONE guarda só a diferença. Uma data de fim por pessoa (vale para todo o ajuste dela). Contas sem ficha ficam de fora (as telas delas estão no próprio acesso).</span></div>
            </form>}
          </Card>
        </div>;
      })()}

      {aba === "telas" && <Card title="Quem vê cada tela">
        <nav className="mb-3 flex flex-wrap gap-1.5 text-xs">{grupos.map(g => <Link key={g} href={href("telas", `&grupo=${encodeURIComponent(g)}`)} className={`rounded border px-2 py-0.5 ${g === grupo ? "border-acao bg-sky-50 font-medium" : "border-line hover:bg-mist"}`}>{g}</Link>)}</nav>
        <Table head={["Tela", "Cargos que veem", "Pessoas com ajuste", "Atuações que podem ver"]}>
          {[...(catalogo.get(grupo)?.entries() ?? [])].map(([k, rot]) => { const quem = cargos.filter(c => veTela(c, k)); const podem = ATUACOES.filter(r => telasDaAtuacao(r).some(t => t.chave === k)); const pa = ajustePorTela(k); return (
            <tr key={k}><Td className="min-w-[10rem]"><b className="text-navy">{rot}</b><div className="text-[11px] text-slate-500">{k}</div></Td>
              <Td>{quem.length ? <div className="flex flex-wrap gap-1">{quem.map(c => <Link key={c.id} href={`/configuracoes/acessos/cargo/${c.id}`} className="rounded bg-mist px-1.5 py-0.5 text-[11px] text-navy hover:underline">{c.nome}</Link>)}</div> : <span className="text-xs text-slate-500">nenhum cargo</span>}</Td>
              <Td>{pa.mais.length + pa.menos.length ? <div className="flex flex-wrap gap-1">{pa.mais.map(u => <Link key={`m${u.id}`} href={`/configuracoes/acessos/usuario/${u.id}#telas`} className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-ok hover:underline" title="vê, a mais que o cargo">+ {u.nome}</Link>)}{pa.menos.map(u => <Link key={`n${u.id}`} href={`/configuracoes/acessos/usuario/${u.id}#telas`} className="rounded bg-red-50 px-1.5 py-0.5 text-[11px] text-erro hover:underline" title="não vê, mesmo o cargo dando">− {u.nome}</Link>)}</div> : <span className="text-xs text-slate-400">—</span>}</Td>
              <Td className="text-xs text-slate-600">{podem.map(r => ATUACAO[r].curto).join(", ")}</Td></tr>); })}
        </Table>
        <p className="mt-2 text-xs text-slate-500">Uma tela só aparece para o cargo se a atuação dele a permite e ela está marcada no cargo. <b className="text-ok">+</b> pessoa que vê a mais que o cargo · <b className="text-erro">−</b> pessoa que não vê mesmo com o cargo dando (aba Telas por pessoa). Contas sem ficha e exceções individuais estão na aba Fora do padrão.</p>
      </Card>}

      {aba === "aprovacoes" && <Card title="Quem aprova o quê (por cargo)">
        <form action={salvarAprovacoesCargos}>
          <Table head={["Cargo", ...ALCADAS.map(a => ({ label: a.curto, className: "!whitespace-normal text-center !px-0.5 min-w-[3.1rem] text-[11px] leading-tight" })), { label: "Desconto até %", className: "!whitespace-normal text-center !px-0.5 min-w-[3.6rem] text-[11px] leading-tight" }]} denso>
            {cargos.map(c => { const d = defs.get(c.id)!; const ap = aprovaCargo(c); const pd = aprovaPadrao(d.atuacao, padrao); return (
              <tr key={c.id}><Td className="min-w-[8.5rem]"><input type="hidden" name={`c_${c.id}`} value="1" /><Link href={`/configuracoes/acessos/cargo/${c.id}`} className="text-navy hover:underline">{c.nome}</Link><div className="text-[10px] text-slate-500">{ATUACAO[d.atuacao].curto}{d.aprova ? " · personalizado" : ""}</div></Td>
                {ALCADAS.map(a => <Td key={a.chave} className="text-center"><input type="checkbox" name={`a_${c.id}_${a.chave}`} value="1" defaultChecked={ap.includes(a.chave)} aria-label={`${c.nome}: ${a.rotulo}`} title={`${a.rotulo}${pd.includes(a.chave) ? " (padrão da atuação)" : ""}`} className={pd.includes(a.chave) ? "accent-slate-500" : ""} /></Td>)}<Td className="text-center"><input type="number" name={`p_${c.id}`} min={0} max={100} step="0.5" defaultValue={d.descontoPct ?? ""} placeholder={String(descontoPadrao(d.atuacao, pds.desconto))} aria-label={`${c.nome}: alçada de desconto (%)`} className="w-14 rounded border border-line px-1 py-0.5 text-center text-xs" /></Td></tr>); })}
          </Table>
          <div className="mt-3 flex flex-wrap items-center gap-3"><Btn>Salvar aprovações dos cargos</Btn><span className="text-xs text-slate-500">Cargo que fica igual ao padrão da atuação volta a seguir o padrão (Configurações → Aprovações: padrão de cada atuação).</span></div>
        </form>
        <div className="mt-4 border-t border-line pt-3">
          <h3 className="mb-1 text-sm font-semibold text-navy">Contas sem ficha</h3>
          {semFicha.length ? <ul className="space-y-1 text-sm">{semFicha.map(u => <li key={u.id}><Link href={`/configuracoes/acessos/usuario/${u.id}`} className="text-navy hover:underline">{u.nome}</Link> <span className="text-xs text-slate-500">({rotuloAtuacao(u.role)}) — aprova: {(u.aprova ?? []).map(k => ALCADAS.find(a => a.chave === k)?.curto ?? k).join(", ") || "nada"}</span></li>)}</ul> : <p className="text-xs text-slate-500">Nenhuma.</p>}
        </div>
      </Card>}

      {aba === "fora" && <div className="space-y-4">
        <Card title={`Exceções individuais (${excecoes.length})`}>
          <Table head={["Pessoa", "Cargo da ficha", "Atuação na exceção", "Motivo", ""]} empty="Ninguém fora do acesso do cargo.">
            {excecoes.map(u => <tr key={u.id}><Td>{u.nome}<div className="text-[11px] text-slate-500">{u.unidade ?? ""}</div></Td><Td>{u.cargo ?? "—"}</Td><Td>{rotuloAtuacao(u.role)}</Td><Td className="text-xs">{u.acesso?.motivo ?? "—"}{u.acesso?.em && <div className="text-[10px] text-slate-500">{fmtData(u.acesso.em)}{u.acesso.por ? ` · ${u.acesso.por}` : ""}</div>}</Td><Td><Link href={`/configuracoes/acessos/usuario/${u.id}`} className="text-xs text-acao hover:underline">revisar</Link></Td></tr>)}
          </Table>
        </Card>
        <Card title={`Telas por pessoa (${emVigor.length})`}>
          {emVigor.length ? <ul className="space-y-1 text-sm">{emVigor.map(({ u, a }) => <li key={u.id}><Link href={`/configuracoes/acessos/usuario/${u.id}#telas`} className="text-navy hover:underline">{u.nome}</Link> <span className="text-xs text-slate-500">({u.cargo ?? "—"}) · <b className="text-ok">+{a.mais.length}</b> <b className="text-erro">−{a.menos.length}</b>{a.ate ? ` · até ${fmtData(a.ate)}` : ""} — {a.motivo}</span></li>)}</ul> : <p className="text-xs text-slate-500">Ninguém com telas diferentes do cargo.</p>}
          <p className="mt-2 text-xs text-slate-500">Revise e aplique em lote na aba <Link href={href("pessoas")} className="text-acao underline">Telas por pessoa</Link>.</p>
        </Card>
        <Card title={`Substituições em curso (${subs.length})`}>
          <Table head={["Pessoa", "Cargo da ficha", "Substitui", "Até", "Motivo", ""]} empty="Nenhuma substituição em curso.">
            {subs.map(u => { const c = cargos.find(x => x.id === u.substituicao!.positionId); return <tr key={u.id}><Td>{u.nome}</Td><Td>{u.cargo ?? "—"}</Td><Td>{c?.nome ?? "—"}</Td><Td className="whitespace-nowrap">{fmtData(u.substituicao!.ate)}</Td><Td className="text-xs">{u.substituicao!.motivo}</Td><Td><Link href={`/configuracoes/acessos/usuario/${u.id}`} className="text-xs text-acao hover:underline">ver</Link></Td></tr>; })}
          </Table>
        </Card>
        <Card title={`Contas sem ficha (${semFicha.length})`}>
          <Table head={["Conta", "Atuação", "Telas", ""]} empty="Nenhuma conta sem ficha.">
            {semFicha.map(u => <tr key={u.id}><Td>{u.nome}<div className="text-[11px] text-slate-500">{u.email}</div></Td><Td>{rotuloAtuacao(u.role)}{u.unidade ? <div className="text-[11px] text-slate-500">{u.unidade}</div> : null}</Td><Td className="text-xs">{u.acesso?.telas ? `${u.acesso.telas.length} de ${telasDaAtuacao(u.role as Role).length}` : "todas da atuação"}{u.acesso?.motivo ? <div className="text-[10px] text-slate-500">{u.acesso.motivo}</div> : null}</Td><Td><Link href={`/configuracoes/acessos/usuario/${u.id}`} className="text-xs text-acao hover:underline">ver acesso</Link></Td></tr>)}
          </Table>
          <p className="mt-2 text-xs text-slate-500">Para contabilidade externa, consultoria, TI e homologação. Pessoas da escola entram pela ficha — o acesso vem do cargo.</p>
        </Card>
        {semCargo.length > 0 && <Card title={`Fichas sem cargo (${semCargo.length})`}><p className="mb-2 text-xs text-slate-600">Sem cargo na ficha, a pessoa fica só com o autoatendimento. Preencha o cargo na ficha.</p><ul className="text-sm">{semCargo.map(u => <li key={u.id}>{u.nome} <span className="text-xs text-slate-500">{u.unidade ?? ""}</span></li>)}</ul></Card>}
        <p className="text-xs text-slate-500">{semAcesso} ficha(s) ativa(s) ou em admissão ainda sem login. Crie de uma vez em Configurações → Usuários e acessos → Acessos em lote: cada pessoa já entra com o acesso do próprio cargo.</p>
      </div>}
    </Page>
  );
}
