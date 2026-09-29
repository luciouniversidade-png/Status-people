/** Radar simples (0–100 por eixo). Eixo sem dados aparece como "s/d" e fica no centro, sem virar zero no texto. */
export function Radar({ eixos, valores, tamanho = 260, rotulo }: { eixos: string[]; valores: (number | null)[]; tamanho?: number; rotulo?: string }) {
  const n = eixos.length, c = tamanho / 2, r = c - 62;
  const pt = (i: number, v: number) => { const a = -Math.PI / 2 + (2 * Math.PI * i) / n; return [c + r * (v / 100) * Math.cos(a), c + r * (v / 100) * Math.sin(a)] as const; };
  const poly = valores.map((v, i) => pt(i, v ?? 0).join(",")).join(" ");
  return (
    <svg viewBox={`0 0 ${tamanho} ${tamanho}`} role="img" aria-label={rotulo ?? `Radar: ${eixos.map((e, i) => `${e} ${valores[i] === null ? "sem dados" : `${valores[i]}%`}`).join(", ")}`} className="h-auto w-full max-w-[280px]">
      {[25, 50, 75, 100].map(a => <polygon key={a} points={eixos.map((_, i) => pt(i, a).join(",")).join(" ")} fill="none" stroke="#e2e8f0" />)}
      {eixos.map((_, i) => { const [x, y] = pt(i, 100); return <line key={i} x1={c} y1={c} x2={x} y2={y} stroke="#e2e8f0" />; })}
      <polygon points={poly} fill="rgba(30,58,138,0.16)" stroke="#1e3a8a" strokeWidth={1.5} />
      {valores.map((v, i) => { if (v === null) return null; const [x, y] = pt(i, v); return <circle key={i} cx={x} cy={y} r={2.5} fill="#1e3a8a" />; })}
      {eixos.map((e, i) => { const [x, y] = pt(i, 118); return <text key={e} x={x} y={y} fontSize={9} textAnchor={x < c - 6 ? "end" : x > c + 6 ? "start" : "middle"} dominantBaseline="middle" fill="#475569">{e} {valores[i] === null ? "(s/d)" : `${valores[i]}%`}</text>; })}
    </svg>
  );
}
