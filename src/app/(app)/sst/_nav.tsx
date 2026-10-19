import Link from "@/components/Link";

const ABAS: [string, string][] = [["/sst", "Exames ocupacionais (ASO)"], ["/sst/incidentes", "Incidentes, CAT e CIPA"], ["/sst/conformidade", "Treinamentos NR, brigada e EPI"]];
export function SstNav({ atual }: { atual: string }) {
  return <nav className="-mx-1 mb-4 flex gap-1 overflow-x-auto px-1 text-sm print:hidden" aria-label="Saúde e segurança">{ABAS.map(([h, t]) => <Link key={h} href={h} aria-current={h === atual ? "page" : undefined} className={`whitespace-nowrap rounded-md border px-3 py-1.5 ${h === atual ? "border-navy bg-navy text-white" : "border-line bg-white text-navy hover:bg-mist"}`}>{t}</Link>)}</nav>;
}
