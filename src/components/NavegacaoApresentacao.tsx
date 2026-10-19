"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/** Teclado (← → espaço PageUp PageDown, Esc sai), tela cheia e passagem automática (?auto=segundos) do modo apresentação. */
export function NavegacaoApresentacao({ anterior, proximo, primeiro, sair, auto }: { anterior: string | null; proximo: string | null; primeiro: string; sair: string; auto: number | null }) {
  const router = useRouter(); const [cheia, setCheia] = useState(false);
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && ["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName)) return;
      if ((e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") && proximo) { e.preventDefault(); router.push(proximo); }
      else if ((e.key === "ArrowLeft" || e.key === "PageUp") && anterior) { e.preventDefault(); router.push(anterior); }
      else if (e.key === "Escape" && !document.fullscreenElement) router.push(sair);
    };
    const tela = () => setCheia(!!document.fullscreenElement);
    window.addEventListener("keydown", tecla); document.addEventListener("fullscreenchange", tela);
    return () => { window.removeEventListener("keydown", tecla); document.removeEventListener("fullscreenchange", tela); };
  }, [anterior, proximo, sair, router]);
  useEffect(() => {
    if (!auto || auto < 5) return; const t = setTimeout(() => router.push(proximo ?? primeiro), auto * 1000);
    return () => clearTimeout(t);
  }, [auto, proximo, primeiro, router]);
  return (
    <button type="button" onClick={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen?.(); }} className="rounded border border-white/30 px-2.5 py-1 text-xs text-white hover:bg-white/10 print:hidden">
      {cheia ? "Sair da tela cheia" : "Tela cheia"}
    </button>
  );
}
