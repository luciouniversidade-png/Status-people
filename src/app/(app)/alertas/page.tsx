import Link from "@/components/Link";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession } from "@/lib/auth";
import { Page, Card, Flash, Stat, Btn, Field, Select, Input, Textarea, Badge } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { MapaCalor } from "@/components/graficos";
import { varrerAlertas, listarAlertas, escopoDo, ultimaVarredura, SEVERIDADE_LABEL, STATUS_ALERTA } from "@/lib/alertas";
import { tratarAlerta, delegarAlerta, silenciarAlerta, reabrirAlerta, varrerAgora } from "./actions";
import { fmtDataHora, hoje, addDays } from "@/lib/utils";

export const dynamic = "force-dynamic";
const prazo = (h: number | null) => h === null ? "—" : h < 0 ? `estourado há ${Math.round(-h) >= 48 ? `${Math.round(-h / 24)} dias` : `${Math.round(-h)} h`}` : h >= 48 ? `${Math.round(h / 24)} dias` : `${Math.round(h)} h`;

/** T-003 · Central de alertas: caixa única do que exige atenção, com dono, prazo, tratar/delegar/silenciar e escalonamento em degraus. */
export default async function Alertas({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); if (s.role === "COLABORADOR") redirect("/"); const sp = await searchParams;
  const escopo = escopoDo(s); try { await varrerAlertas(escopo); } catch { /* a central mostra o último retrato */ }
  const status = sp.status ?? ""; const dono = sp.dono === "eu" || sp.dono === "sem" ? sp.dono : null; const modulo = sp.modulo ?? null;
  const [lista, todos, ult, usuarios] = await Promise.all([listarAlertas(s, escopo, { status: status || undefined, dono, modulo }), listarAlertas(s, escopo, {}), ultimaVarredura(escopo), sql<{ id: number; nome: string; role: string }[]>`SELECT id, nome, role FROM users WHERE ativo AND role <> 'COLABORADOR' ORDER BY nome`]);
  const modulos = [...new Set(todos.map(a => a.modulo))].sort();
  const atrasados = todos.filter(a => a.horas_restantes !== null && a.horas_restantes < 0); const semDono = todos.filter(a => !a.dono_user_id);
  const destaque = sp.id ? Number(sp.id) : null; const eventos = destaque ? await sql<{ at: string; user_nome: string | null; tipo: string; texto: string | null }[]>`SELECT at::text, user_nome, tipo, texto FROM alert_events WHERE alert_id=${destaque} ORDER BY at DESC LIMIT 20` : [];
  const qs = (k: Record<string, string | null>) => { const p = new URLSearchParams(); const base = { status, dono: dono ?? "", modulo: modulo ?? "", ...k }; Object.entries(base).forEach(([a, b]) => { if (b) p.set(a, b); }); const t = p.toString(); return t ? `/alertas?${t}` : "/alertas"; };
  const voltar = qs({});
  return (
    <Page title="Central de alertas" sub="Tudo o que exige atenção na rede, com dono, prazo e o caminho para resolver. Estourou o prazo, sobe um degrau: dono → gestor → Direção."
      actions={s.role !== "LEITURA" ? <form action={varrerAgora}><input type="hidden" name="voltar" value={voltar} /><Btn small kind="ghost">Varrer agora</Btn></form> : undefined}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="Abertos" value={todos.length} hint={ult ? `última varredura ${fmtDataHora(ult.at)}` : "sem varredura"} />
        <Stat label="Críticos" value={<span className={todos.some(a => a.severidade === "ALTO") ? "text-erro" : ""}>{todos.filter(a => a.severidade === "ALTO").length}</span>} />
        <Stat label="Com prazo estourado" value={<span className={atrasados.length ? "text-erro" : "text-ok"}>{atrasados.length}</span>} hint="sobem de degrau na rotina" />
        <Stat label="Sem dono (defeito)" value={<span className={semDono.length ? "text-aviso" : ""}>{semDono.length}</span>} hint="configure o responsável do módulo" href={qs({ dono: "sem" })} />
      </div>
      {todos.length > 0 && <Card title="Mapa: módulo × severidade" className="mb-4"><MapaCalor rotulo="Alertas abertos por módulo e severidade" cabecalho="Módulo" colunas={[{ chave: "ALTO", rotulo: "Crítico" }, { chave: "MEDIO", rotulo: "Atenção" }, { chave: "ATRASO", rotulo: "Prazo estourado" }]} linhas={modulos.map(m => ({ chave: m, rotulo: m, href: qs({ modulo: m }) }))} celula={(m, c) => { const xs = todos.filter(a => a.modulo === m); const n = c === "ATRASO" ? xs.filter(a => (a.horas_restantes ?? 1) < 0).length : xs.filter(a => a.severidade === c).length; return { texto: n ? String(n) : "—", tom: !n ? "vazio" : c === "ALTO" || c === "ATRASO" ? "ruim" : "atencao", href: qs({ modulo: m }) }; }} /></Card>}
      <form className="mb-3 flex flex-wrap items-end gap-2 text-sm" action="/alertas"><Field label="Situação"><Select name="status" defaultValue={status}><option value="">Abertos</option><option value="TRATADO">Tratados</option><option value="SILENCIADO">Silenciados</option><option value="RESOLVIDO">Resolvidos</option><option value="todos">Todos</option></Select></Field><Field label="Dono"><Select name="dono" defaultValue={dono ?? ""}><option value="">Todos</option><option value="eu">Meus</option><option value="sem">Sem dono</option></Select></Field><Field label="Módulo"><Select name="modulo" defaultValue={modulo ?? ""}><option value="">Todos</option>{modulos.map(m => <option key={m} value={m}>{m}</option>)}</Select></Field><Btn small kind="ghost">Filtrar</Btn></form>
      {lista.length === 0 ? <Card><p className="py-6 text-center text-sm text-slate-600">Nada exige atenção{status ? " neste filtro" : ""} — última varredura {ult ? fmtDataHora(ult.at) : "—"}.</p></Card> :
        <ul className="space-y-2">{lista.map(a => <li key={a.id} id={`a${a.id}`} className={`rounded-md border bg-white p-3 text-sm ${destaque === a.id ? "border-acao ring-2 ring-acao/30" : a.severidade === "ALTO" ? "border-red-200" : "border-line"}`}>
          <div className="flex flex-wrap items-start gap-2">
            <Badge v={a.severidade === "ALTO" ? "REJEITADA" : "PENDENTE"} label={SEVERIDADE_LABEL[a.severidade]} /><Badge v="ABERTO" label={a.modulo} />{a.status !== "ABERTO" && <Badge v="CANCELADA" label={STATUS_ALERTA[a.status] ?? a.status} />}{a.escalonamento > 0 && <Badge v="REJEITADA" label={a.escalonamento === 1 ? "escalado ao gestor" : "escalado à Direção"} />}
            <span className="min-w-0 flex-1 font-medium text-ink [overflow-wrap:anywhere]">{a.href ? <Link href={a.href} className="hover:underline">{a.titulo}</Link> : a.titulo}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600"><span>Dono: <b>{a.dono ?? <span className="text-aviso">sem dono</span>}</b></span>{a.status === "ABERTO" && <span className={a.horas_restantes !== null && a.horas_restantes < 0 ? "font-medium text-erro" : ""}>Prazo: {prazo(a.horas_restantes)}</span>}<span>desde {fmtDataHora(a.primeiro_em)}{a.ocorrencias > 1 ? ` · ${a.ocorrencias}ª ocorrência` : ""}</span>{a.unidade && <span>{a.unidade}</span>}<Link href={qs({ id: String(a.id) })} className="text-acao">trilha</Link></div>
          {a.defeito && <p className="mt-1 text-xs text-aviso">⚠ Defeito de configuração: {a.defeito} <span className="text-slate-500">(regra: {a.regra})</span></p>}
          {a.desfecho && a.status === "TRATADO" && <p className="mt-1 text-xs text-ok">Desfecho: {a.desfecho}</p>}{a.status === "SILENCIADO" && <p className="mt-1 text-xs text-slate-600">Silenciado até {a.silenciado_ate?.split("-").reverse().join("/")}: {a.motivo_silencio}</p>}
          {s.role !== "LEITURA" && a.status !== "RESOLVIDO" && <div className="mt-2 flex flex-wrap gap-2">
            {a.status === "ABERTO" && <Modal label="Tratar" kind="primary" title="Tratar o alerta"><form action={tratarAlerta} className="space-y-2"><input type="hidden" name="id" value={a.id} /><input type="hidden" name="voltar" value={voltar} /><p className="text-sm">{a.titulo}</p><Field label="Desfecho (obrigatório)"><Textarea name="desfecho" required minLength={10} placeholder="O que foi feito e o que falta" /></Field><Btn small>Registrar</Btn></form></Modal>}
            <Modal label="Delegar" title="Delegar o alerta"><form action={delegarAlerta} className="space-y-2"><input type="hidden" name="id" value={a.id} /><input type="hidden" name="voltar" value={voltar} /><Field label="Novo dono"><Select name="donoId" defaultValue={a.dono_user_id ?? ""}>{usuarios.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field><Field label="Observação"><Input name="obs" /></Field><Btn small>Delegar</Btn></form></Modal>
            {a.status === "ABERTO" && <Modal label="Silenciar" title="Silenciar com validade"><form action={silenciarAlerta} className="space-y-2"><input type="hidden" name="id" value={a.id} /><input type="hidden" name="voltar" value={voltar} /><Field label="Até (máx. 90 dias)"><Input type="date" name="ate" min={addDays(hoje(), 1)} max={addDays(hoje(), 90)} defaultValue={addDays(hoje(), 7)} required /></Field><Field label="Motivo (obrigatório)"><Textarea name="motivo" required minLength={10} /></Field><Btn small>Silenciar</Btn></form></Modal>}
            {["TRATADO", "SILENCIADO"].includes(a.status) && <form action={reabrirAlerta}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="voltar" value={voltar} /><Btn small kind="ghost">Reabrir</Btn></form>}
          </div>}
          {destaque === a.id && eventos.length > 0 && <ol className="mt-3 space-y-1 border-t border-line pt-2 text-xs text-slate-600">{eventos.map((e, i) => <li key={i}><span className="tabular-nums text-slate-400">{fmtDataHora(e.at)}</span> · <b>{e.user_nome ?? "varredura"}</b> · {e.tipo.toLowerCase()} — {e.texto}</li>)}</ol>}
        </li>)}</ul>}
      <p className="mt-4 text-xs text-slate-500">Os alertas nascem das regras dos módulos e se resolvem sozinhos quando a condição deixa de existir. Privacidade e SST aparecem só para Direção e RH, e sempre como contagem. Dono por módulo e prazos em Configurações → Central de alertas.</p>
    </Page>
  );
}
