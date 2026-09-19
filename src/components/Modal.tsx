"use client";
import { useRef, type ReactNode } from "react";

/** Botão que abre uma janela (dialog nativo) com o conteúdo — formulários de ação saem de dentro das tabelas e ficam legíveis no PC e no celular. */
export function Modal({ label, title, children, kind = "ghost", small = true, className = "" }: { label: ReactNode; title?: string; children: ReactNode; kind?: "ghost" | "primary" | "link" | "danger"; small?: boolean; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const btn = kind === "link" ? "text-acao hover:underline text-xs" : `inline-flex items-center justify-center rounded-md font-medium ${small ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm"} ${kind === "primary" ? "bg-acao text-white hover:bg-navy-700" : kind === "danger" ? "border border-red-200 bg-white text-erro hover:bg-red-50" : "border border-line bg-white text-navy hover:bg-mist"}`;
  return (
    <>
      <button type="button" onClick={() => ref.current?.showModal()} className={`${btn} ${className}`}>{label}</button>
      <dialog ref={ref} onClick={e => { if (e.target === ref.current) ref.current?.close(); }} className="w-[min(38rem,94vw)] rounded-lg border border-line bg-white p-0 text-ink shadow-2xl backdrop:bg-navy/50 open:animate-in">
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3"><h3 className="text-sm font-semibold text-navy">{title ?? (typeof label === "string" ? label : "")}</h3><button type="button" aria-label="Fechar" onClick={() => ref.current?.close()} className="rounded px-2 py-1 text-lg leading-none text-slate-500 hover:bg-mist">×</button></div>
        <div className="max-h-[78vh] overflow-y-auto px-4 py-4 text-left text-sm">{children}</div>
      </dialog>
    </>
  );
}
