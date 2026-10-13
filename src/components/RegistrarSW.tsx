"use client";
import { useEffect } from "react";
/** Registra o service worker (app instalável, notificações e página sem conexão). */
export function RegistrarSW() {
  useEffect(() => { if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => { /* navegador sem suporte ou modo privado */ }); }, []);
  return null;
}
