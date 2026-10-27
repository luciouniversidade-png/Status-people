import { redirect } from "next/navigation";
import Link from "@/components/Link";
import { requireSession, scopeUnit } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Badge, Flash, Btn, Stat, Table, Td, Field, Input, Select, Textarea } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { audit, fmtData, getSettings } from "@/lib/utils";
import { prazosContratuais, decidePrazo, vePrazo, TIPO_PRAZO, DECISAO_LABEL, SITUACAO_PRAZO, type TipoPrazo } from "@/lib/contratos-prazo";
import { decidirPrazo, recomendarPrazo, definirTermino } from "./actions";

export const dynamic = "force-dynamic";

/** v27 · Contratos com prazo: experiência (45+45), estágio (TCE e limite de 2 anos) e temporário (180+90) — recomendação do gestor, decisão do RH e trilha. */
export default async function ContratosPrazo({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const sp = await searchParams;
  if (!vePrazo(s)) { await audit(s, "acesso negado: contratos com prazo", "employment_terms", null, null, { papel: s.role }); redirect("/"); }
  const cfg = await getSettings(); const c = cfg.contratosPrazo; const u = scopeUnit(s); const decide = decidePrazo(s);
  const amplo = ["RH", "DIRECAO", "DIRETOR_UNIDADE", "LEITURA"].includes(s.role);
  const gestores = amplo ? await sql<{ id: number; nome: string }[]>`SELECT DISTINCT g.id, g.nome FROM employees g JOIN employees e ON e.gestor_id=g.id AND e.situacao <> 'DESLIGADO' ${u === null ? sql`` : sql`AND e.unit_id=${u}`} ORDER BY g.nome` : [];
  const gestorId = !amplo ? s.employeeId ?? -1 : sp.gestor ? Number(sp.gestor) || null : null;
  const sit = ["abertos", "decididos", "todos"].includes(sp.sit ?? "") ? sp.sit! : "abertos"; const tipo = sp.tipo && sp.tipo in TIPO_PRAZO ? sp.tipo as TipoPrazo : null;
  const todos = await prazosContratuais({ unitId: u, gestorId, incluirDecididos: sit !== "abertos" });
  const lista = todos.filter(p => (sit === "decididos" ? p.situacao === "DECIDIDO" : sit === "abertos" ? p.situacao !== "DECIDIDO" : true) && (!tipo || p.tipo === tipo));
  const abertos = todos.filter(p => p.situacao !== "DECIDIDO");
  const n = (f: (p: (typeof todos)[number]) => boolean) => abertos.filter(f).length;
  const voltar = `/contratos-prazo?sit=${sit}${tipo ? `&tipo=${tipo}` : ""}${gestorId && amplo ? `&gestor=${gestorId}` : ""}`;
  return (
    <Page title="Contratos com prazo" sub={`Experiência (${c.experienciaPrimeiroDias} + ${Number(c.experienciaTotalDias) - Number(c.experienciaPrimeiroDias)} dias), estágio e temporário: o gestor recomenda, o RH decide antes do vencimento — sem contrato virando prazo indeterminado por esquecimento.`}
      actions={<><Btn kind="ghost" href="/processos">Admissões e desligamentos</Btn>{["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR"].includes(s.role) && <Btn kind="ghost" href="/equipe">Minha equipe</Btn>}</>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <Stat label="Venceram sem decisão" value={<span className={n(p => p.situacao === "VENCIDO") ? "text-erro" : "text-ok"}>{n(p => p.situacao === "VENCIDO")}</span>} hint="registre já a decisão" />
        <Stat label={`Decidir em até ${c.avisoDias} dias`} value={<span className={n(p => p.situacao === "VENCENDO") ? "text-aviso" : ""}>{n(p => p.situacao === "VENCENDO")}</span>} hint={`${n(p => p.situacao === "VENCENDO" && !!p.recomendacao)} com recomendação do gestor`} />
        <Stat label="Experiências em curso" value={n(p => p.tipo === "EXPERIENCIA")} hint={`${n(p => p.tipo === "EXPERIENCIA" && p.etapa === 2)} no 2º período`} />
        <Stat label="Estágios" value={n(p => p.tipo === "ESTAGIO")} hint={`${n(p => p.tipo === "ESTAGIO" && p.situacao === "SEM_DATA")} sem término do TCE`} />
        <Stat label="Temporários" value={n(p => p.tipo === "TEMPORARIO")} hint="180 + 90 dias no máximo" />
      </div>
      <Card title={`Prazos (${lista.length})`}>
        <form className="mb-3 flex flex-wrap items-end gap-2">
        <Field label="Situação"><Select name="sit" defaultValue={sit} className="!w-36"><option value="abertos">Em aberto</option><option value="decididos">Decididos</option><option value="todos">Todos</option></Select></Field>
        <Field label="Tipo"><Select name="tipo" defaultValue={tipo ?? ""} className="!w-36"><option value="">Todos</option>{Object.entries(TIPO_PRAZO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        {amplo && gestores.length > 0 && <Field label="Equipe de"><Select name="gestor" defaultValue={gestorId ? String(gestorId) : ""} className="!w-44"><option value="">Todas</option>{gestores.map(g => <option key={g.id} value={g.id}>{g.nome}</option>)}</Select></Field>}
        <Btn small kind="ghost">Ver</Btn></form>
        <Table head={["Pessoa", { label: "Contrato", className: "hidden sm:table-cell" }, { label: "Vence em", className: "hidden sm:table-cell" }, { label: "Recomendação do gestor", className: "hidden sm:table-cell" }, { label: "Situação", className: "hidden sm:table-cell" }, ""]} empty={sit === "abertos" ? "Nenhum contrato com prazo em aberto. 👍" : "Nada neste filtro."}>
          {lista.map(p => { const st = SITUACAO_PRAZO[p.situacao]; const ehGestor = !!s.employeeId && p.gestor_id === s.employeeId;
            const quando = p.dias < 0 ? `há ${-p.dias} dia(s)` : p.dias === 0 ? "hoje" : `em ${p.dias} dia(s)`; const corQuando = p.dias < 0 ? "text-erro" : p.dias <= Number(c.avisoDias) ? "text-aviso" : "text-slate-500"; return <tr key={`${p.employee_id}-${p.tipo}-${p.etapa}`} className={p.situacao === "VENCIDO" ? "bg-red-50/40" : p.situacao === "VENCENDO" ? "bg-amber-50/40" : ""}>
            <Td><Link className="font-medium text-acao" href={`/colaboradores/${p.employee_id}`}>{p.nome}</Link><div className="text-xs text-slate-500">{p.unidade}{p.gestor ? ` · gestor: ${p.gestor}` : ""} · admissão {fmtData(p.admissao)}</div>
              {/* celular: contrato, prazo, situação e recomendação dentro da 1ª coluna (as colunas próprias aparecem a partir do tablet) */}
              <div className="mt-1 space-y-0.5 text-[11px] sm:hidden"><div><b>{TIPO_PRAZO[p.tipo]}</b> · {p.rotulo}</div>
                <div>vence {fmtData(p.vence_em)}{p.situacao !== "DECIDIDO" && <span className={corQuando}> · {quando}</span>}</div>
                <div><Badge v={st.tom} label={p.decisao ? DECISAO_LABEL[p.decisao] : st.rotulo} /></div>
                {p.recomendacao && <div>Gestor recomenda: <b>{DECISAO_LABEL[p.recomendacao]}</b></div>}
                {p.alerta && <div className="text-aviso [overflow-wrap:anywhere]">{p.alerta}</div>}</div></Td>
            <Td className="hidden text-xs sm:table-cell"><b>{TIPO_PRAZO[p.tipo]}</b><div>{p.rotulo}</div>{p.limite && <div className="text-[11px] text-slate-500">limite legal {fmtData(p.limite)}</div>}</Td>
            <Td className="hidden whitespace-nowrap text-xs sm:table-cell">{fmtData(p.vence_em)}{p.situacao !== "DECIDIDO" && <div className={`text-[11px] ${corQuando}`}>{quando}</div>}</Td>
            <Td className="hidden text-xs sm:table-cell">{p.recomendacao ? <><b>{DECISAO_LABEL[p.recomendacao]}</b><div className="max-w-[16rem] text-[11px] text-slate-500 [overflow-wrap:anywhere]">{p.recomendacao_motivo}{p.recomendado_por ? ` — ${p.recomendado_por}` : ""}</div></> : <span className="text-slate-400">—</span>}</Td>
            <Td className="hidden sm:table-cell"><Badge v={st.tom} label={p.decisao ? DECISAO_LABEL[p.decisao] : st.rotulo} />{p.decisao && <div className="mt-0.5 max-w-[16rem] text-[11px] text-slate-500 [overflow-wrap:anywhere]">{p.motivo}{p.nova_data ? ` · até ${fmtData(p.nova_data)}` : ""}{p.decidido_por ? ` — ${p.decidido_por}` : ""}</div>}{p.alerta && <div className="mt-0.5 max-w-[18rem] text-[11px] text-aviso [overflow-wrap:anywhere]">{p.alerta}</div>}</Td>
            <Td className="sm:min-w-[9rem]"><span className="flex flex-col items-end gap-1 sm:flex-row sm:flex-wrap sm:justify-end">
              {p.situacao !== "DECIDIDO" && decide && <Modal label="Decidir" kind="primary" title={`${TIPO_PRAZO[p.tipo]} de ${p.nome} — ${p.rotulo} (${fmtData(p.vence_em)})`}>
                <form action={decidirPrazo} className="space-y-2"><input type="hidden" name="employeeId" value={p.employee_id} /><input type="hidden" name="tipo" value={p.tipo} /><input type="hidden" name="etapa" value={p.etapa} /><input type="hidden" name="voltar" value={voltar} />
                  {p.recomendacao && <p className="rounded bg-mist p-2 text-xs">Recomendação do gestor: <b>{DECISAO_LABEL[p.recomendacao]}</b> — {p.recomendacao_motivo}</p>}
                  <fieldset className="space-y-1 text-sm">{p.opcoes.map((o, i) => <label key={o} className="flex items-start gap-2"><input type="radio" name="decisao" value={o} defaultChecked={o === p.recomendacao || (!p.recomendacao && i === 0)} className="mt-1" /><span><b>{DECISAO_LABEL[o]}</b><span className="block text-[11px] text-slate-500">{o === "PRORROGAR" && p.tipo === "EXPERIENCIA" ? `Segue até o fim da experiência (${c.experienciaTotalDias} dias).` : o === "PRORROGAR" ? `Prorroga até ${c.temporarioProrrogacaoDias} dias (data abaixo).` : o === "EFETIVAR" ? (p.tipo === "EXPERIENCIA" ? "Passa a prazo indeterminado." : "Contratação CLT: novo vínculo pela admissão.") : o === "RENOVAR" ? "Novo término do TCE (até o limite de 2 anos)." : "Desliga no fim do prazo: abra o desligamento (checklist e exame demissional)."}</span></span></label>)}</fieldset>
                  {(p.opcoes.includes("RENOVAR") || (p.tipo === "TEMPORARIO" && p.opcoes.includes("PRORROGAR"))) && <Field label={p.tipo === "ESTAGIO" ? "Novo término do TCE (se renovar)" : "Fim da prorrogação (se prorrogar)"} hint={p.limite ? `Máximo: ${fmtData(p.limite)}` : undefined}><Input name="novaData" type="date" min={p.vence_em} max={p.limite ?? undefined} /></Field>}
                  <Field label="Motivo"><Textarea name="motivo" required className="min-h-[60px]" /></Field><Btn small>Registrar decisão</Btn></form></Modal>}
              {p.situacao !== "DECIDIDO" && (ehGestor || decide) && <Modal label="Recomendar" title={`Recomendação — ${p.nome}`}>
                <form action={recomendarPrazo} className="space-y-2"><input type="hidden" name="employeeId" value={p.employee_id} /><input type="hidden" name="tipo" value={p.tipo} /><input type="hidden" name="etapa" value={p.etapa} /><input type="hidden" name="voltar" value={voltar} />
                  <Field label="Recomendo"><Select name="recomendacao" defaultValue={p.recomendacao ?? p.opcoes[0]}>{p.opcoes.map(o => <option key={o} value={o}>{DECISAO_LABEL[o]}</option>)}</Select></Field>
                  <Field label="Como foi o período" hint="Entregas, adaptação à cultura, assiduidade, pontos a desenvolver."><Textarea name="motivo" required defaultValue={p.recomendacao_motivo ?? ""} className="min-h-[70px]" /></Field><Btn small>Registrar recomendação</Btn></form></Modal>}
              {decide && ["ESTAGIARIO", "TEMPORARIO"].includes(p.vinculo) && p.situacao !== "DECIDIDO" && <Modal label="Término" title={`Término do ${p.vinculo === "ESTAGIARIO" ? "TCE" : "contrato"} — ${p.nome}`}>
                <form action={definirTermino} className="space-y-2"><input type="hidden" name="employeeId" value={p.employee_id} /><input type="hidden" name="voltar" value={voltar} />
                  <Field label="Termina em" hint={p.limite ? `Limite legal: ${fmtData(p.limite)}` : undefined}><Input name="termino" type="date" defaultValue={p.termino ?? ""} min={p.admissao} max={p.limite ?? undefined} required /></Field><Btn small>Salvar término</Btn></form></Modal>}
            </span></Td></tr>; })}
        </Table>
      </Card>
      <Card title="Regras" className="mt-4">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>Experiência (CLT e horista): até {c.experienciaTotalDias} dias com uma prorrogação (CLT art. 445, parágrafo único). O 1º período termina no {c.experienciaPrimeiroDias}º dia contado da admissão. Sem decisão até o fim, o contrato passa a prazo indeterminado.</li>
          <li>Estágio: término do TCE e limite de {c.estagioMaxMeses} meses na mesma escola (Lei 11.788/2008, art. 11), exceto pessoa com deficiência.</li>
          <li>Temporário: {c.temporarioDias} dias, prorrogáveis por até {c.temporarioProrrogacaoDias} (Lei 6.019/1974, art. 10, §§ 1º e 2º).</li>
          <li>O gestor direto registra a recomendação; RH, Direção ou a direção da unidade registram a decisão com motivo. Encerrar no prazo abre o caminho do desligamento (checklist e exame demissional) em Admissões e desligamentos. Tudo vai para a auditoria.</li>
        </ul>
        {s.role === "DIRECAO" || s.role === "RH" ? <p className="mt-2 text-xs"><Link className="text-acao underline" href="/configuracoes#v27-prazos">Ajustar prazos e aviso em Configurações</Link></p> : null}
      </Card>
    </Page>
  );
}
