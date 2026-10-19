/* STATUS ONE — service worker: instala o app, mostra notificações push e uma página amigável sem internet.
   Não guarda dados do sistema em cache (tudo é sempre buscado do servidor). */
const VERSAO = "one-v23-1";
const OFFLINE = "/offline.html";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll([OFFLINE, "/icons/icon-192.png"])).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSAO).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Só navegações (GET): se a rede falhar, mostra a página offline. Demais requisições seguem direto para a rede.
self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate" || e.request.method !== "GET") return;
  e.respondWith(fetch(e.request).catch(() => caches.match(OFFLINE)));
});
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { titulo: "STATUS ONE", texto: e.data ? e.data.text() : "" }; }
  const titulo = d.titulo || "STATUS ONE";
  e.waitUntil(self.registration.showNotification(titulo, {
    body: d.texto || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-96.png",
    tag: d.tag || undefined,
    renotify: !!d.tag,
    requireInteraction: d.tipo === "ALERTA",
    data: { url: d.link || "/notificacoes" },
  }));
});
// Toque na notificação: abre o link (sempre dentro do próprio sistema) numa janela já aberta do app ou numa nova.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  let url = new URL("/notificacoes", self.location.origin).href;
  try { const u = new URL((e.notification.data && e.notification.data.url) || "/notificacoes", self.location.origin); if (u.origin === self.location.origin) url = u.href; } catch { /* usa /notificacoes */ }
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (ws) => {
    const w = ws.find((c) => c.url.startsWith(self.location.origin));
    if (w) { try { await w.focus(); await w.navigate(url); return; } catch { /* janela não controlada: abre outra */ } }
    await self.clients.openWindow(url);
  }));
});
// O navegador trocou a assinatura (expirou ou foi renovada): assina de novo e avisa o servidor, sem a pessoa precisar ativar outra vez.
const bytes = (b64) => { const p = "=".repeat((4 - (b64.length % 4)) % 4); const raw = atob((b64 + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };
self.addEventListener("pushsubscriptionchange", (e) => {
  e.waitUntil((async () => {
    const antigo = e.oldSubscription ? e.oldSubscription.endpoint : null;
    let nova = e.newSubscription || null;
    if (!nova) {
      let chave = e.oldSubscription && e.oldSubscription.options ? e.oldSubscription.options.applicationServerKey : null;
      if (!chave) { const r = await fetch("/api/push", { credentials: "same-origin" }); if (!r.ok) return; chave = bytes((await r.json()).publicKey); }
      nova = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chave });
    }
    await fetch("/api/push", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ antigo, sub: nova.toJSON() }) });
  })().catch(() => {}));
});
