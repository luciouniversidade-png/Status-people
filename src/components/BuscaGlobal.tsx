"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Item = { grupo: string; titulo: string; sub: string | null; href: string; pergunta?: boolean };
type Resp = { ok: true; titulo: string; texto: string; valor: string; fonte: string; periodo: string; comparacao: string | null; serie: (number | null)[]; href: string } | { ok: false; recusa: string; sugestoes: string[] };
const norm = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
/** Parece pergunta (modo "Pergunte ao Status"): termina em "?" ou começa com quanto/qual/quantos/como está… */
const ehPergunta = (q: string) => { const t = norm(q); return t.length >= 6 && (t.endsWith("?") || /^(quanto|quantos|quantas|qual|quais|como (esta|estao|anda|foi)|o que|cresceu|houve)\b/.test(t)); };
/** Ações executáveis pela busca (navegam até a fila certa). */
const ACOES: { gatilho: RegExp; titulo: string; href: string }[] = [
  { gatilho: /^aprov/, titulo: "Aprovar férias e banco de horas em lote", href: "/aprovacoes" }, { gatilho: /^(tratar|ver) alert/, titulo: "Tratar alertas (central)", href: "/alertas" },
  { gatilho: /^(abrir|novo|nova) chamad/, titulo: "Abrir chamado de manutenção", href: "/operacoes/chamados" }, { gatilho: /^(registrar|lancar) (ausencia|falta)/, titulo: "Registrar ausência de professor (substituição)", href: "/cobertura" },
  { gatilho: /^(nova|abrir) solicita/, titulo: "Nova solicitação", href: "/solicitacoes" }, { gatilho: /^(fechar|fechamento) (do )?ponto/, titulo: "Fechar o ponto do mês por unidade", href: "/ponto#fechamento" },
  { gatilho: /^(gerar|ver) (o )?pacote/, titulo: "Ciclo da folha (Payroll Bridge)", href: "/folha" }, { gatilho: /^(quem|presen)/, titulo: "Painel do dia (presenças agora)", href: "/ponto/hoje" },
];
function Mini({ valores }: { valores: (number | null)[] }) {
  const xs = valores.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null); if (xs.length < 2) return null;
  const min = Math.min(...xs.map(p => p.v)), max = Math.max(...xs.map(p => p.v)); const W = 120, H = 30; const x = (i: number) => (W * i) / Math.max(1, valores.length - 1); const y = (v: number) => max === min ? H / 2 : H - 3 - ((H - 6) * (v - min)) / (max - min);
  return <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden className="shrink-0"><polyline fill="none" stroke="#1f5fa0" strokeWidth="2" points={xs.map(p => `${x(p.i)},${y(p.v)}`).join(" ")} /><circle cx={x(xs[xs.length - 1].i)} cy={y(xs[xs.length - 1].v)} r="2.5" fill="#1f5fa0" /></svg>;
}

/**
 * Busca global do ONE (Ctrl+K ou ⌘K, ou "/" fora de campos): telas do menu do perfil (na hora, sem ir ao servidor) e registros
 * dos módulos (pessoas, alunos, solicitações, casos, chamados, ações, projetos, POPs, contratos, indicadores) — no escopo do perfil.
 * Setas navegam, Enter abre, Esc fecha.
 */
export function BuscaGlobal({ paginas, variante = "barra", atalho = true }: { paginas: { href: string; titulo: string; grupo: string }[]; variante?: "barra" | "icone"; atalho?: boolean }) {
  const router = useRouter(); const dlg = useRef<HTMLDialogElement>(null); const inp = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState(""); const [remotos, setRemotos] = useState<Item[]>([]); const [carregando, setCarregando] = useState(false); const [sel, setSel] = useState(0); const [erro, setErro] = useState<string | null>(null);
  const [resp, setResp] = useState<Resp | null>(null); const [perguntando, setPerguntando] = useState(false); const [historico, setHistorico] = useState<string[]>([]);
  useEffect(() => { try { const h = JSON.parse(localStorage.getItem("one_busca_hist") ?? "[]"); if (Array.isArray(h)) setHistorico(h.filter((x: unknown) => typeof x === "string").slice(0, 8)); } catch { /* sem armazenamento */ } }, []);
  const lembrar = useCallback((t: string) => { const v = t.trim(); if (v.length < 2) return; setHistorico(h => { const n = [v, ...h.filter(x => x !== v)].slice(0, 8); try { localStorage.setItem("one_busca_hist", JSON.stringify(n)); } catch { /* sem armazenamento */ } return n; }); }, []);
  const perguntar = useCallback(async (texto: string) => {
    setPerguntando(true); setResp(null); lembrar(texto);
    try { const r = await fetch(`/api/busca/pergunta?q=${encodeURIComponent(texto)}`, { cache: "no-store" }); const j = await r.json(); setResp(r.ok ? j : { ok: false, recusa: j.erro ?? "Não consegui responder agora.", sugestoes: [] }); }
    catch { setResp({ ok: false, recusa: "Não consegui responder agora.", sugestoes: [] }); } finally { setPerguntando(false); }
  }, [lembrar]);
  const abrir = useCallback(() => { dlg.current?.showModal(); setTimeout(() => inp.current?.focus(), 0); }, []);
  const fechar = useCallback(() => { dlg.current?.close(); }, []);
  useEffect(() => {
    if (!atalho) return;
    const tecla = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement | null; const digitando = !!alvo && (["INPUT", "TEXTAREA", "SELECT"].includes(alvo.tagName) || alvo.isContentEditable);
      if ((e.key === "k" || e.key === "K") && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (dlg.current?.open) fechar(); else abrir(); }
      else if (e.key === "/" && !digitando && !dlg.current?.open) { e.preventDefault(); abrir(); }
    };
    window.addEventListener("keydown", tecla); return () => window.removeEventListener("keydown", tecla);
  }, [abrir, fechar, atalho]);
  // busca nos módulos com espera curta entre as teclas
  useEffect(() => {
    const t = norm(q); if (t.length < 2) { setRemotos([]); setErro(null); return; }
    const ctrl = new AbortController(); setCarregando(true);
    const id = setTimeout(async () => {
      try { const r = await fetch(`/api/busca?q=${encodeURIComponent(q)}`, { signal: ctrl.signal, cache: "no-store" }); const j = await r.json(); if (!r.ok) { setErro(j.erro ?? "Busca indisponível."); setRemotos([]); } else { setErro(null); setRemotos(j.resultados ?? []); } }
      catch (e) { if ((e as Error).name !== "AbortError") setErro("Busca indisponível agora."); }
      finally { setCarregando(false); }
    }, 220);
    return () => { clearTimeout(id); ctrl.abort(); };
  }, [q]);
  const locais = useMemo(() => { const t = norm(q); if (!t) return [...historico.map(h => ({ grupo: "Buscas recentes", titulo: h, sub: null, href: `?q=${encodeURIComponent(h)}`, pergunta: ehPergunta(h) })), ...paginas.slice(0, 8).map(p => ({ grupo: "Atalhos", titulo: p.titulo, sub: p.grupo || null, href: p.href }))]; return paginas.filter(p => norm(`${p.titulo} ${p.grupo}`).includes(t)).slice(0, 8).map(p => ({ grupo: "Telas", titulo: p.titulo, sub: p.grupo || null, href: p.href })); }, [q, paginas, historico]);
  const acoes = useMemo(() => { const t = norm(q); return t.length < 3 ? [] : ACOES.filter(a => a.gatilho.test(t)).map(a => ({ grupo: "Ações", titulo: a.titulo, sub: "executar", href: a.href })); }, [q]);
  const modoPergunta = ehPergunta(q);
  const itens = useMemo(() => [...(modoPergunta ? [{ grupo: "Pergunte ao Status", titulo: q.trim(), sub: "Enter: responder com número, fonte e período", href: "", pergunta: true }] : []), ...acoes, ...locais, ...remotos], [modoPergunta, q, acoes, locais, remotos]);
  useEffect(() => { setSel(0); setResp(null); }, [q, remotos.length]);
  const ir = (it: Item | undefined) => { if (!it) return; if (it.pergunta) { if (it.grupo === "Buscas recentes") setQ(it.titulo); void perguntar(it.titulo); return; } if (it.grupo === "Buscas recentes") { setQ(it.titulo); return; } lembrar(q); fechar(); setQ(""); router.push(it.href); };
  const grupos = useMemo(() => { const m = new Map<string, { it: Item; i: number }[]>(); itens.forEach((it, i) => { if (!m.has(it.grupo)) m.set(it.grupo, []); m.get(it.grupo)!.push({ it, i }); }); return [...m.entries()]; }, [itens]);
  return (
    <>
      {variante === "barra"
        ? <button type="button" onClick={abrir} className="flex w-full items-center gap-2 rounded-md border border-sky-300/30 bg-white/5 px-3 py-2 text-left text-sm text-sky-100 hover:bg-white/10"><span aria-hidden>🔎</span><span className="flex-1">Buscar</span><kbd className="rounded border border-sky-300/40 px-1.5 text-[10px] text-sky-200">Ctrl K</kbd></button>
        : <button type="button" onClick={abrir} aria-label="Buscar" className="inline-flex items-center gap-1 rounded-md border border-sky-300/50 px-2.5 py-1.5 text-sm text-white"><span aria-hidden>🔎</span><span className="sr-only">Buscar</span></button>}
      <dialog ref={dlg} aria-label="Busca global" onClick={e => { if (e.target === dlg.current) fechar(); }} onClose={() => setSel(0)} className="mt-[8vh] w-[min(40rem,94vw)] rounded-lg border border-line bg-white p-0 text-ink shadow-2xl backdrop:bg-navy/50">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
          <span aria-hidden className="text-slate-400">🔎</span>
          <input ref={inp} value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar ou perguntar: “quanto a Cultura cresceu vs 2025?”" aria-label="Termo de busca" role="combobox" aria-expanded={itens.length > 0} aria-controls="busca-resultados" aria-activedescendant={itens[sel] ? `busca-item-${sel}` : undefined}
            onKeyDown={e => { if (e.key === "ArrowDown") { e.preventDefault(); setSel(i => Math.min(itens.length - 1, i + 1)); } else if (e.key === "ArrowUp") { e.preventDefault(); setSel(i => Math.max(0, i - 1)); } else if (e.key === "Enter") { e.preventDefault(); ir(itens[sel]); } }}
            className="min-w-0 flex-1 bg-transparent py-1 text-base outline-none placeholder:text-slate-400" autoComplete="off" />
          {carregando && <span aria-hidden className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-transparent" />}
          <button type="button" onClick={fechar} className="rounded px-1.5 text-xs text-slate-500 hover:bg-mist" aria-label="Fechar">Esc</button>
        </div>
        {(perguntando || resp) && <div className="border-b border-line bg-sky-50/60 px-3 py-2.5" role="status" aria-live="polite">{perguntando ? <p className="text-sm text-slate-600">Calculando…</p> : resp && resp.ok ? <div className="flex items-start gap-3"><div className="min-w-0 flex-1"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{resp.titulo} · {resp.periodo}</div><div className="text-2xl font-semibold tabular-nums text-navy">{resp.valor}</div><p className="text-sm text-ink">{resp.texto}</p><p className="mt-0.5 text-[11px] text-slate-500">Fonte: {resp.fonte}</p><button type="button" onClick={() => { fechar(); setQ(""); router.push(resp.href); }} className="mt-1 text-xs font-medium text-acao hover:underline">Abrir com o mesmo filtro →</button></div><Mini valores={resp.serie} /></div> : resp && !resp.ok ? <div><p className="text-sm text-aviso">{resp.recusa}</p>{resp.sugestoes.length > 0 && <p className="mt-1 text-xs text-slate-500">Tente: {resp.sugestoes.map((x, i) => <button key={x} type="button" onClick={() => { setQ(x); void perguntar(x); }} className="text-acao hover:underline">{x}{i < resp.sugestoes.length - 1 ? " · " : ""}</button>)}</p>}</div> : null}</div>}
        <div id="busca-resultados" role="listbox" className="max-h-[60vh] overflow-y-auto py-1">
          {grupos.map(([g, xs]) => (
            <div key={g} role="group" aria-label={g}>
              <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">{g}</div>
              {xs.map(({ it, i }) => (
                <div key={`${it.href}-${i}`} id={`busca-item-${i}`} role="option" aria-selected={i === sel} onMouseEnter={() => setSel(i)} onClick={() => ir(it)}
                  className={`mx-1 cursor-pointer rounded-md px-3 py-2 ${i === sel ? "bg-sky-50" : ""}`}>
                  <div className="truncate text-sm font-medium text-navy">{it.titulo}</div>
                  {it.sub && <div className="truncate text-xs text-slate-500">{it.sub}</div>}
                </div>
              ))}
            </div>
          ))}
          {norm(q).length >= 2 && !carregando && itens.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-500">{erro ?? "Nada encontrado."}</p>}
          {erro && itens.length > 0 && <p className="px-4 py-2 text-xs text-aviso">{erro}</p>}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-3 py-2 text-[11px] text-slate-500"><span>↑ ↓ navegar</span><span>Enter abrir</span><span>Esc fechar</span><span>termine com “?” para perguntar</span><span className="ml-auto">só o que o seu perfil pode ver</span></div>
      </dialog>
    </>
  );
}
