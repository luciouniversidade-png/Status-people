import Link from "@/components/Link";
import { redirect } from "next/navigation";
import { requireSession, type Session } from "@/lib/auth";
import { Field, Input, Btn, Badge } from "@/components/ui";
import { registrarRetirada } from "./actions";
import type { Autorizacao } from "@/lib/seguranca";
import { docMascarado, GESTAO_SEG } from "@/lib/seguranca";
import { fmtData } from "@/lib/utils";

export async function requireSeguranca(): Promise<Session> { const s = await requireSession(); if (s.role === "COLABORADOR") redirect(s.employeeId ? `/colaboradores/${s.employeeId}` : "/conta"); return s; }
export function SubNavSeg({ ativo }: { ativo: string }) {
  const itens: [string, string][] = [["/operacoes/seguranca", "Portaria e saídas"], ["/operacoes/seguranca/emergencias", "Simulados e emergências"], ["/operacoes/seguranca/brigada", "Brigada"]];
  return <nav className="mb-4 flex flex-wrap gap-1">{itens.map(([h, l]) => <Link key={h} href={h} className={`rounded-md px-3 py-1.5 text-sm ${ativo === h ? "bg-navy text-white" : "border border-line bg-white text-navy hover:bg-mist"}`}>{l}</Link>)}</nav>;
}
/** Conferência de quem retira o aluno: lista de autorizados (um toque para entregar), restrições em destaque e exceção só para a gestão. */
export function Retirada({ s, aluno, lista, voltar, eventId }: { s: Session; aluno: { id: number; nome: string; serie: string | null }; lista: Autorizacao[]; voltar: string; eventId?: number }) {
  const h = new Date().toLocaleDateString("en-CA", { timeZone: "America/Campo_Grande" }); const gest = GESTAO_SEG.includes(s.role);
  const vig = lista.filter(a => a.ativo && (!a.validade || a.validade >= h)); const proib = vig.filter(a => a.tipo === "PROIBIDO"); const aut = vig.filter(a => a.tipo === "AUTORIZADO");
  const hid = <><input type="hidden" name="studentId" value={aluno.id} /><input type="hidden" name="voltar" value={voltar} />{eventId && <input type="hidden" name="eventId" value={eventId} />}</>;
  return (
    <div className="space-y-3">
      <div className="text-sm"><b className="text-navy">{aluno.nome}</b>{aluno.serie ? ` · ${aluno.serie}` : ""} <Link className="ml-1 text-xs text-acao" href={`/matriculas/alunos/${aluno.id}#retirada`}>lista completa</Link></div>
      {proib.length > 0 && <div role="alert" className="rounded-md border-2 border-erro bg-red-50 p-3 text-sm text-erro"><b>NÃO ENTREGAR a:</b> {proib.map(p => p.nome).join(", ")}.{gest ? proib.map(p => p.restricao_obs ? <span key={p.id} className="block text-xs">{p.nome}: {p.restricao_obs}</span> : null) : <span className="block text-xs">Em caso de tentativa, acione a coordenação ou a direção.</span>}</div>}
      {aut.length === 0 ? <p className="text-sm text-aviso">Nenhuma pessoa autorizada cadastrada. Só a coordenação ou a direção liberam, com justificativa.</p> :
        <ul className="space-y-2">{aut.map(a => <li key={a.id} className="rounded-md border border-line p-2"><div className="flex flex-wrap items-center justify-between gap-2"><span><b>{a.nome}</b>{a.parentesco ? ` · ${a.parentesco}` : ""}<span className="block text-[11px] text-slate-500">doc. {docMascarado(a.documento)}{a.validade ? ` · até ${fmtData(a.validade)}` : ""}</span></span>
          <form action={registrarRetirada} className="flex flex-wrap items-center gap-2">{hid}<input type="hidden" name="authorizationId" value={a.id} /><label className="flex items-center gap-1 text-xs"><input type="checkbox" name="avisado" value="1" /> responsável avisado</label><input name="motivo" placeholder="motivo" className="w-28 rounded border border-line px-2 py-1 text-xs" aria-label="motivo" /><Btn small>Entregar</Btn></form></div></li>)}</ul>}
      <details className="rounded-md border border-line p-2"><summary className="cursor-pointer text-xs text-acao">Outra pessoa (fora da lista)</summary>
        <form action={registrarRetirada} className="mt-2 space-y-2">{hid}
          <div className="grid grid-cols-2 gap-2"><Field label="Nome completo de quem retira"><Input name="retiradoPor" required /></Field><Field label="Documento"><Input name="documento" /></Field></div>
          {gest ? <Field label="Justificativa da exceção" hint="Quem confirmou, como e quando (ex.: mãe confirmou por telefone às 10h12)"><Input name="excecao" /></Field> : <p className="text-xs text-aviso">Fora da lista, só a coordenação ou a direção liberam. O sistema confere restrições mesmo assim.</p>}
          <Field label="Motivo"><Input name="motivo" /></Field><Btn small kind="ghost">Conferir e registrar</Btn></form></details>
    </div>
  );
}
export const BadgeRetirada = ({ status, excecao }: { status: string; excecao: string | null }) => status === "BLOQUEADA" ? <Badge v="REJEITADA" label="Bloqueada" /> : excecao ? <Badge v="PENDENTE" label="Liberada por exceção" /> : <Badge v="APROVADA" label="Liberada" />;
