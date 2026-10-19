"use client";
import Link, { useLinkStatus } from "next/link";
import type { ReactNode } from "react";

function Pending() { const { pending } = useLinkStatus(); return pending ? <span aria-hidden className="ml-auto inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent opacity-80" /> : null; }
/** Link de navegação que mostra um giro enquanto a próxima tela carrega — feedback imediato no celular. Marca a tela atual (aria-current). */
export function NavLink({ href, className, children, ativo = false, ativoClassName = "" }: { href: string; className: string; children: ReactNode; ativo?: boolean; ativoClassName?: string }) {
  return <Link href={href} prefetch={false} aria-current={ativo ? "page" : undefined} className={`${className} ${ativo ? ativoClassName : ""} flex items-center gap-2`}>{children}<Pending /></Link>;
}
