"use client";
import { useState } from "react";

/** Copia um texto (link, protocolo) para a área de transferência, com confirmação visual. */
export function Copiar({ texto, label = "Copiar link", className = "" }: { texto: string; label?: string; className?: string }) {
  const [ok, setOk] = useState(false);
  return <button type="button" data-copiar={texto} onClick={async () => { try { await navigator.clipboard.writeText(texto); } catch { const t = document.createElement("textarea"); t.value = texto; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove(); } setOk(true); setTimeout(() => setOk(false), 1800); }} className={`inline-flex items-center justify-center rounded-md border border-line bg-white px-2.5 py-1 text-xs font-medium text-navy hover:bg-mist ${className}`}>{ok ? "Copiado ✓" : label}</button>;
}
