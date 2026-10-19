import type { TomCartao } from "@/components/Quadro";
/** Texto curto do prazo (SLA) de um item aberto: "vencido há 2 d", "vence em 5 h", "vence em 3 d". */
export function seloSla(slaAte: Date | string | null, agora = Date.now()): { texto: string; tom: TomCartao } | null {
  if (!slaAte) return null; const t = new Date(slaAte).getTime(); const d = t - agora; const h = Math.abs(d) / 3600000;
  const fmt = h < 24 ? `${Math.max(1, Math.round(h))} h` : `${Math.round(h / 24)} d`;
  if (d < 0) return { texto: `vencido há ${fmt}`, tom: "ruim" };
  return { texto: `vence em ${fmt}`, tom: h <= 24 ? "atencao" : "neutro" };
}
