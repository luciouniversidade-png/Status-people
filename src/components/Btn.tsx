"use client";
import Link from "@/components/Link";
import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

/** Botão com estado de envio: dentro de um formulário mostra "Enviando…" e bloqueia clique duplo enquanto a ação roda. */
export function Btn({ children, kind = "primary", href, type = "submit", name, value, formAction, small, danger, pendingText }: { children: ReactNode; kind?: "primary" | "ghost"; href?: string; type?: "submit" | "button"; name?: string; value?: string; formAction?: (fd: FormData) => void | Promise<void>; small?: boolean; danger?: boolean; pendingText?: string }) {
  const base = `inline-flex items-center justify-center gap-1.5 rounded-md font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-acao/60 disabled:cursor-wait disabled:opacity-70 ${small ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm"}`;
  const style = danger ? "border border-red-200 bg-white text-erro hover:bg-red-50" : kind === "primary" ? "bg-acao text-white hover:bg-navy-700" : "border border-line bg-white text-navy hover:bg-mist";
  if (href) return <Link href={href} className={`${base} ${style}`}>{children}</Link>;
  return <Inner type={type} name={name} value={value} formAction={formAction} className={`${base} ${style}`} pendingText={pendingText}>{children}</Inner>;
}
/**
 * O React 19 monta o envio com um campo temporário para o botão clicado (nome/valor) e o liga ao formulário por `form.id`.
 * Num formulário que tem um campo chamado "id", `form.id` devolve esse campo (e não o atributo id): o campo temporário fica
 * ligado a um formulário inexistente e o nome/valor do botão some do envio (ex.: Aprovar/Rejeitar chegavam sem a decisão).
 * Aqui o nome/valor do botão entra como campo oculto real no clique e sai logo depois do envio.
 */
function garantirNomeDoBotao(b: HTMLButtonElement, name: string, value: string | undefined) {
  const f = b.form; if (!f || typeof (f as unknown as { id: unknown }).id === "string") return;
  const h = document.createElement("input"); h.type = "hidden"; h.name = name; h.value = value ?? ""; f.appendChild(h);
  setTimeout(() => h.remove(), 0);
}
function Inner({ children, className, type, name, value, formAction, pendingText }: { children: ReactNode; className: string; type: "submit" | "button"; name?: string; value?: string; formAction?: (fd: FormData) => void | Promise<void>; pendingText?: string }) {
  const { pending } = useFormStatus();
  return <button type={type} name={name} value={value} formAction={formAction} onClick={name && type === "submit" && !formAction ? e => garantirNomeDoBotao(e.currentTarget, name, value) : undefined} disabled={pending && type === "submit"} aria-busy={pending} className={className}>{pending && type === "submit" ? <><span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />{pendingText ?? "Enviando…"}</> : children}</button>;
}
