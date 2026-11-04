"use client";
// v31 · “Adicionar um novo par avaliador › avaliado”: dois campos e o botão ⇄ que troca quem avalia e quem é avaliado.
import { useState } from "react";

const cls = "w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink focus:border-acao focus:outline-none focus:ring-1 focus:ring-acao";
export function ParAvaliador({ usuarios, avaliados }: { usuarios: { id: number; nome: string; employee_id: number | null; extra: string }[]; avaliados: { review_id: number; employee_id: number; nome: string; extra: string }[] }) {
  const [u, setU] = useState(""); const [r, setR] = useState(""); const [aviso, setAviso] = useState("");
  const trocar = () => {
    const usr = usuarios.find(x => String(x.id) === u); const rev = avaliados.find(x => String(x.review_id) === r);
    const novoR = usr?.employee_id ? avaliados.find(x => x.employee_id === usr.employee_id) : undefined; const novoU = rev ? usuarios.find(x => x.employee_id === rev.employee_id) : undefined;
    if ((u && !novoR) || (r && !novoU)) { setAviso(u && !novoR ? "Quem avalia não tem avaliação neste ciclo." : "O avaliado não tem acesso ao ONE para avaliar."); return; }
    setAviso(""); setU(novoU ? String(novoU.id) : ""); setR(novoR ? String(novoR.review_id) : "");
  };
  return <div className="space-y-2">
    <label className="block"><span className="mb-1 block text-xs font-medium text-slate-700">Avaliador</span><select name="userId" required value={u} onChange={e => setU(e.target.value)} className={cls}><option value="" disabled>Selecione quem avalia…</option>{usuarios.map(x => <option key={x.id} value={x.id}>{x.nome}{x.extra ? ` — ${x.extra}` : ""}</option>)}</select></label>
    <div className="flex justify-center"><button type="button" onClick={trocar} title="Trocar avaliador e avaliado" aria-label="Trocar avaliador e avaliado" className="grid h-8 w-8 place-items-center rounded-full bg-navy text-white hover:bg-acao">⇄</button></div>
    <label className="block"><span className="mb-1 block text-xs font-medium text-slate-700">Avaliado</span><select name="reviewId" required value={r} onChange={e => setR(e.target.value)} className={cls}><option value="" disabled>Selecione um avaliado…</option>{avaliados.map(x => <option key={x.review_id} value={x.review_id}>{x.nome}{x.extra ? ` — ${x.extra}` : ""}</option>)}</select></label>
    {aviso && <p className="text-[11px] text-aviso">{aviso}</p>}
  </div>;
}
