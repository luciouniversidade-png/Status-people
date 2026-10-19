import Link from "@/components/Link";
import type { ReactNode } from "react";

/** Estado de uma etapa (C13 · linha do tempo de ciclo): concluída, em andamento ou pendente; "atrasada" pinta de vermelho. */
export type EstadoC13 = "COMPLETED" | "CURRENT" | "PENDING" | "LATE" | "CLOSED";
const COR: Record<EstadoC13, { bola: string; texto: string; rotulo: string }> = {
  COMPLETED: { bola: "border-ok bg-ok text-white", texto: "text-ok", rotulo: "concluída" },
  CURRENT: { bola: "border-acao bg-white text-acao ring-2 ring-acao/30", texto: "text-acao", rotulo: "em andamento" },
  PENDING: { bola: "border-slate-300 bg-white text-slate-400", texto: "text-slate-500", rotulo: "pendente" },
  LATE: { bola: "border-erro bg-white text-erro ring-2 ring-erro/25", texto: "text-erro", rotulo: "atrasada" },
  // encerrada por decisão antes de todos concluírem (com justificativa): não é "concluída"
  CLOSED: { bola: "border-aviso bg-amber-50 text-aviso", texto: "text-aviso", rotulo: "fechada com pendências" },
};

/** Linha do tempo de etapas (C13): horizontal no computador, vertical no celular; cada etapa com estado, janela e observação. */
export function EtapasC13({ etapas, rotulo }: { etapas: { nome: string; estado: EstadoC13; sub?: ReactNode; href?: string }[]; rotulo: string }) {
  return (
    <ol aria-label={rotulo} className="grid grid-cols-1 gap-2 sm:grid-flow-col sm:auto-cols-fr sm:gap-0">
      {etapas.map((e, i) => { const c = COR[e.estado]; const nome = e.href ? <Link href={e.href} className="hover:underline">{e.nome}</Link> : e.nome; return (
        <li key={i} className="relative flex items-start gap-2 sm:flex-col sm:items-center sm:px-1 sm:text-center">
          {i > 0 && <span aria-hidden className={`absolute left-[0.85rem] top-[-0.5rem] h-2 w-0.5 sm:left-[-50%] sm:top-[0.85rem] sm:h-0.5 sm:w-full ${etapas[i - 1].estado === "COMPLETED" ? "bg-ok" : "bg-slate-200"}`} />}
          <span className={`relative z-[1] flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold ${c.bola}`} aria-hidden>{e.estado === "COMPLETED" ? "✓" : e.estado === "CLOSED" ? "!" : i + 1}</span>
          <span className="min-w-0 text-xs leading-snug sm:mt-1"><span className="block font-medium text-ink [overflow-wrap:anywhere]">{nome}</span><span className={`block ${c.texto}`}>{c.rotulo}</span>{e.sub && <span className="block text-[11px] text-slate-500">{e.sub}</span>}</span>
        </li>); })}
    </ol>
  );
}

/** Cinco quadradinhos de estado (para a grade de meses × entidades). */
export function MiniEtapas({ estados, titulo }: { estados: EstadoC13[]; titulo: string }) {
  return <span className="inline-flex gap-0.5" title={titulo} aria-label={titulo}>{estados.map((e, i) => <span key={i} className={`inline-block h-2.5 w-2.5 rounded-sm ${e === "COMPLETED" ? "bg-ok" : e === "CURRENT" ? "bg-acao" : e === "LATE" ? "bg-erro" : e === "CLOSED" ? "bg-aviso" : "bg-slate-200"}`} />)}</span>;
}
