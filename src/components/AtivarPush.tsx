"use client";
import { useEffect, useState } from "react";
import { salvarAssinaturaPush, removerAssinaturaPush, preferenciaPush, testarPush, estadoAssinaturaPush } from "@/app/(app)/conta/push-actions";

const chave = (b64: string) => { const p = "=".repeat((4 - (b64.length % 4)) % 4); const raw = atob((b64 + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from([...raw].map(c => c.charCodeAt(0))); };
type Estado = "carregando" | "sem-suporte" | "ios-instalar" | "negado" | "desligado" | "ligado";

/** Ativa as notificações neste aparelho (PWA). No iPhone, só funciona com o app instalado na Tela de Início (iOS 16.4+). */
export function AtivarPush({ publicKey }: { publicKey: string }) {
  const [estado, setEstado] = useState<Estado>("carregando"); const [msg, setMsg] = useState(""); const [tipos, setTipos] = useState("ACAO_ALERTA"); const [endpoint, setEndpoint] = useState(""); const [ocupado, setOcupado] = useState(false);
  useEffect(() => { (async () => {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent); const instalado = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) { setEstado(ios && !instalado ? "ios-instalar" : "sem-suporte"); return; }
    if (Notification.permission === "denied") { setEstado("negado"); return; }
    const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription();
    // O aparelho só conta como ativo se o servidor tem esta assinatura para quem está logado (outra pessoa pode ter usado o aparelho, ou a pessoa saiu do sistema)
    if (sub && Notification.permission === "granted") { const e = await estadoAssinaturaPush(sub.endpoint); if (e.minha) { setEndpoint(sub.endpoint); setTipos(e.tipos); setEstado("ligado"); return; } }
    setEstado(ios && !instalado ? "ios-instalar" : "desligado");
  })().catch(() => setEstado("sem-suporte")); }, []);
  async function ligar() {
    setMsg(""); setOcupado(true); try {
      const perm = await Notification.requestPermission(); if (perm !== "granted") { setEstado(perm === "denied" ? "negado" : "desligado"); return; }
      const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chave(publicKey) });
      const r = await salvarAssinaturaPush(JSON.parse(JSON.stringify(sub)), navigator.userAgent); if (!r.ok) throw new Error(r.erro);
      setEndpoint(sub.endpoint); setTipos(r.tipos); setEstado("ligado"); setMsg("Notificações ativadas neste aparelho.");
    } catch (e) { setMsg(`Não foi possível ativar: ${e instanceof Error ? e.message : e}`); } finally { setOcupado(false); }
  }
  async function desligar() { setOcupado(true); try { const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); await removerAssinaturaPush(sub?.endpoint ?? endpoint); if (sub) await sub.unsubscribe(); setEstado("desligado"); setMsg("Notificações desativadas neste aparelho."); } catch { setMsg("Não foi possível desativar."); } finally { setOcupado(false); } }
  async function testar() { setOcupado(true); try { const r = await testarPush(); setMsg(r.enviados ? "Enviamos uma notificação de teste. Se não chegou, confira as permissões do aparelho e o modo “não perturbe”." : "Nenhum aparelho recebeu — ative de novo."); if (!r.enviados) setEstado("desligado"); } finally { setOcupado(false); } }
  async function preferir(v: string) { setTipos(v); const r = await preferenciaPush(endpoint, v); setMsg(r.ok ? "Preferência salva." : "Não foi possível salvar: ative de novo neste aparelho."); }
  const btn = "inline-flex items-center rounded-md px-3 py-2 text-sm font-medium disabled:opacity-60";
  return (
    <div className="space-y-2 text-sm" data-push-estado={estado}>
      {estado === "carregando" && <p className="text-slate-500">Verificando este aparelho…</p>}
      {estado === "sem-suporte" && <p className="text-slate-600">Este navegador não aceita notificações. No Android, use o Chrome; no computador, Chrome, Edge ou Firefox.</p>}
      {estado === "ios-instalar" && <div className="rounded-md border border-sky-200 bg-sky-50 p-3"><b>No iPhone ou iPad:</b> toque em <b>Compartilhar</b> e em <b>Adicionar à Tela de Início</b>. Depois abra o STATUS ONE pelo ícone e volte aqui para ativar (iOS 16.4 ou mais novo).</div>}
      {estado === "negado" && <p className="text-aviso">As notificações foram bloqueadas para este site. Libere nas configurações do navegador (cadeado ao lado do endereço) e recarregue.</p>}
      {estado === "desligado" && <button type="button" onClick={ligar} disabled={ocupado} className={`${btn} bg-acao text-white hover:bg-navy-700`}>Ativar notificações neste aparelho</button>}
      {estado === "ligado" && <div className="flex flex-wrap items-center gap-2"><span className="rounded bg-emerald-50 px-2 py-1 text-ok">Ativas neste aparelho</span>
        <select value={tipos} onChange={e => preferir(e.target.value)} className="rounded-md border border-line px-2 py-1.5 text-sm" aria-label="Quais avisos"><option value="ACAO_ALERTA">Só o que pede ação e alertas</option><option value="TODOS">Todos os avisos</option></select>
        <button type="button" onClick={testar} disabled={ocupado} className={`${btn} border border-line bg-white text-navy hover:bg-mist`}>Testar</button><button type="button" onClick={desligar} disabled={ocupado} className={`${btn} border border-red-200 bg-white text-erro hover:bg-red-50`}>Desativar</button></div>}
      {msg && <p className="text-xs text-slate-600" role="status">{msg}</p>}
    </div>
  );
}
