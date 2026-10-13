import Link from "@/components/Link";
export function SubNavEspacos({ ativo, gestao }: { ativo: string; gestao: boolean }) {
  const itens: [string, string][] = [...(gestao ? [["/operacoes/espacos", "Mapa de salas"] as [string, string]] : []), ["/operacoes/espacos/reservas", "Reservas"], ...(gestao ? [["/operacoes/espacos/cadastro", "Espaços"] as [string, string]] : [])];
  return <nav className="mb-4 flex flex-wrap gap-1">{itens.map(([h, l]) => <Link key={h} href={h} className={`rounded-md px-3 py-1.5 text-sm ${ativo === h ? "bg-navy text-white" : "border border-line bg-white text-navy hover:bg-mist"}`}>{l}</Link>)}</nav>;
}
