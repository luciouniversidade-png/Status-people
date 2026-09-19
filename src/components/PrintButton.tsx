"use client";
export function PrintButton() {
  return <button type="button" onClick={() => window.print()} className="inline-flex items-center rounded-md border border-line bg-white px-3.5 py-2 text-sm font-medium text-navy hover:bg-mist print:hidden">Imprimir / salvar PDF</button>;
}
