// v31 · abas do ciclo: visão geral (configuração, calibração), cronograma e etapas, participantes 360° e relatório 360°.
import Link from "@/components/Link";

const ABAS = [["", "Visão geral e calibração"], ["/etapas", "Cronograma e etapas"], ["/participantes", "Participantes (360°)"], ["/relatorio-360", "Relatório 360°"]] as const;
export function NavCiclo({ cid, atual }: { cid: number; atual: "" | "/etapas" | "/participantes" | "/relatorio-360" }) {
  return <nav aria-label="Seções do ciclo" className="mb-4 flex flex-wrap gap-1 border-b border-line print:hidden">{ABAS.map(([k, v]) => <Link key={k} href={`/desempenho/ciclos/${cid}${k}`} aria-current={atual === k ? "page" : undefined} className={`rounded-t px-3 py-2 text-sm ${atual === k ? "border border-b-white border-line bg-white font-medium text-navy" : "text-slate-600 hover:text-navy"}`}>{v}</Link>)}</nav>;
}
