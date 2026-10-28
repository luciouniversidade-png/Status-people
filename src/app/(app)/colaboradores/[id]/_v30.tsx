// v30 · ficha completa: histórico funcional, formação e qualificações, itens sob responsabilidade
import Link from "@/components/Link";
import { sql } from "@/db";
import type { Session } from "@/lib/auth";
import { can, scopeUnit } from "@/lib/auth";
import { Card, Badge, Btn, Field, Input, Select, Textarea, Table, Td } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { fmtData, fmtDataHora, hoje } from "@/lib/utils";
import { MOV_TIPO, MOV_TOM, MOV_MANUAIS, MOTIVOS_MOV, descreverMudanca, enriquecerMoves, estadoNaAdmissao, QUALIF_TIPO, maiorTitulacao, ITEM_TIPO, ITEM_STATUS, ITEM_TOM, podeItens } from "@/lib/pessoas-v30";
import { registrarMovManual, excluirMov, salvarQualificacao, validarQualificacao, excluirQualificacao, entregarItem, devolverItem, excluirItem } from "../v30-actions";

type Emp = { id: number; unitId: number; admissao: string; situacao: string };
const fmtMoeda = (v: number | null) => v === null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export async function FichaV30({ s, emp }: { s: Session; emp: Emp }) {
  const id = emp.id; const h = hoje(); const editor = can.editar(s); const itensOk = podeItens(s) && (scopeUnit(s) === null || scopeUnit(s) === emp.unitId);
  const [moves0, quals, itens, ativos] = await Promise.all([
    sql<{ id: number; data: string; tipo: string; motivo: string | null; de: Record<string, unknown> | null; para: Record<string, unknown> | null; obs: string | null; origem: string; user_nome: string | null; created_at: string }[]>`SELECT id, data::text, tipo, motivo, de, para, obs, origem, user_nome, created_at::text FROM employee_moves WHERE employee_id=${id} ORDER BY data DESC, id DESC`,
    sql<{ id: number; tipo: string; curso: string; instituicao: string | null; area: string | null; conclusao: string | null; em_andamento: boolean; carga_horas: number | null; registro: string | null; status: string; motivo_recusa: string | null; validador: string | null }[]>`SELECT q.id, q.tipo, q.curso, q.instituicao, q.area, q.conclusao::text, q.em_andamento, q.carga_horas::float, q.registro, q.status, q.motivo_recusa, u.nome AS validador FROM employee_qualifications q LEFT JOIN users u ON u.id=q.validado_por WHERE q.employee_id=${id} ORDER BY q.status='PENDENTE' DESC, q.conclusao DESC NULLS FIRST, q.id DESC`,
    sql<{ id: number; tipo: string; descricao: string; identificacao: string | null; asset_id: number | null; patrimonio: string | null; valor: number | null; entregue_em: string; entregou: string | null; ciencia_em: string | null; devolver_ate: string | null; devolvido_em: string | null; recebeu: string | null; condicao: string | null; obs: string | null; status: string }[]>`SELECT i.id, i.tipo, i.descricao, i.identificacao, i.asset_id, a.codigo || ' · ' || a.nome AS patrimonio, i.valor::float, i.entregue_em::text, u1.nome AS entregou, i.ciencia_em::text, i.devolver_ate::text, i.devolvido_em::text, u2.nome AS recebeu, i.condicao, i.obs, i.status FROM employee_items i LEFT JOIN assets a ON a.id=i.asset_id LEFT JOIN users u1 ON u1.id=i.entregue_por LEFT JOIN users u2 ON u2.id=i.recebido_por WHERE i.employee_id=${id} ORDER BY i.status='COM_COLABORADOR' DESC, i.entregue_em DESC, i.id DESC`,
    itensOk ? sql<{ id: number; codigo: string; nome: string }[]>`SELECT a.id, a.codigo, a.nome FROM assets a WHERE a.unit_id=${emp.unitId} AND a.status <> 'BAIXADO' AND NOT EXISTS (SELECT 1 FROM employee_items i WHERE i.asset_id=a.id AND i.status='COM_COLABORADOR') ORDER BY a.codigo LIMIT 300` : Promise.resolve([]),
  ]);
  const moves = estadoNaAdmissao(await enriquecerMoves(moves0)); // nomes no lugar dos códigos; a admissão do sistema não contradiz a promoção que veio depois
  const titulacao = maiorTitulacao(quals);
  const com = itens.filter(i => i.status === "COM_COLABORADOR");
  return (<>
    <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
      <Card title={`Histórico funcional (${moves.length})`} actions={editor ? <Modal label="Lançar fato passado" title="Lançar uma movimentação passada">
        <form action={registrarMovManual} className="space-y-2"><input type="hidden" name="employeeId" value={id} />
          <p className="text-xs text-slate-600">Para fatos de antes do sistema (ou esquecidos). Mudanças de agora: edite a ficha — o histórico registra sozinho, com a data de vigência.</p>
          <div className="grid grid-cols-2 gap-2"><Field label="Tipo"><Select name="tipo" required defaultValue="">{[<option key="" value="">Escolha</option>, ...MOV_MANUAIS.map(k => <option key={k} value={k}>{MOV_TIPO[k]}</option>)]}</Select></Field><Field label="Data"><Input name="data" type="date" required max={h} min={emp.admissao} /></Field></div>
          <Field label="O que mudou (de → para)"><Input name="descricao" required placeholder="Ex.: Auxiliar de secretaria → Secretária escolar" /></Field>
          <Field label="Motivo"><Select name="motivo" defaultValue="">{[<option key="" value="">—</option>, ...MOTIVOS_MOV.map(m => <option key={m} value={m}>{m}</option>)]}</Select></Field>
          <Field label="Observação"><Input name="obs" /></Field><Btn small>Lançar</Btn></form></Modal> : undefined}>
        <div id="historico" />
        {moves.length === 0 ? <p className="text-sm text-slate-500">Sem movimentações registradas.</p> :
          <ol className="relative space-y-3 border-l border-line pl-4">{moves.map(m => <li key={m.id} className="text-sm">
            <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-acao" aria-hidden />
            <div className="flex flex-wrap items-center gap-2"><span className="text-xs tabular-nums text-slate-500">{fmtData(m.data)}</span><Badge v={MOV_TOM[m.tipo] ?? "PENDENTE"} label={MOV_TIPO[m.tipo] ?? m.tipo} />{m.origem === "MANUAL" && <span className="text-[11px] text-slate-400">lançado à mão</span>}</div>
            <div className="mt-0.5 text-slate-700 [overflow-wrap:anywhere]">{m.para && "descricao" in m.para ? String(m.para.descricao) : m.tipo === "ADMISSAO" ? `${String(m.para?.cargo ?? "cargo a definir")} · ${String(m.para?.unidade ?? "")}` : m.tipo === "DESLIGAMENTO" ? (m.motivo ?? "Desligamento") : descreverMudanca(m.de, m.para)}</div>
            {(m.motivo && m.tipo !== "DESLIGAMENTO") || m.obs ? <div className="text-xs text-slate-500">{[m.motivo && m.tipo !== "DESLIGAMENTO" ? m.motivo : null, m.obs].filter(Boolean).join(" · ")}</div> : null}
            <div className="text-[11px] text-slate-400">{m.user_nome ?? "sistema"} · {fmtDataHora(m.created_at)}{editor && !(["ADMISSAO", "DESLIGAMENTO"].includes(m.tipo) && m.origem !== "MANUAL") && <> · <Modal label="excluir" kind="link" title="Excluir movimentação do histórico"><form action={excluirMov} className="space-y-2"><input type="hidden" name="id" value={m.id} /><input type="hidden" name="employeeId" value={id} /><Field label="Por que sai do histórico?"><Input name="motivo" required minLength={5} placeholder="Ex.: lançada em duplicidade" /></Field><Btn small danger>Excluir</Btn></form></Modal></>}</div>
          </li>)}</ol>}
      </Card>

      <Card title={`Formação e qualificações · ${titulacao}`} actions={editor ? <Modal label="Adicionar" title="Adicionar formação ou qualificação"><FormQualif employeeId={id} voltar={`/colaboradores/${id}#formacao`} /></Modal> : undefined}>
        <div id="formacao" />
        <Table head={["Formação", "Instituição", "Conclusão", "Situação"]} empty="Nenhuma formação registrada (o colaborador pode informar pelo Meu espaço; o RH valida).">{quals.map(q => <tr key={q.id}>
          <Td><div className="font-medium text-ink">{q.curso}</div><div className="text-xs text-slate-500">{QUALIF_TIPO[q.tipo] ?? q.tipo}{q.area ? ` · ${q.area}` : ""}{q.carga_horas ? ` · ${String(q.carga_horas).replace(".", ",")} h` : ""}{q.registro ? ` · registro ${q.registro}` : ""}</div></Td>
          <Td className="text-xs">{q.instituicao ?? "—"}</Td><Td className="whitespace-nowrap text-xs">{q.em_andamento ? "em andamento" : fmtData(q.conclusao)}</Td>
          <Td>{q.status === "PENDENTE" ? <div className="space-y-1"><Badge v="PENDENTE" label="aguardando validação" />{editor && <div className="flex flex-wrap gap-1"><form action={validarQualificacao}><input type="hidden" name="id" value={q.id} /><input type="hidden" name="employeeId" value={id} /><input type="hidden" name="decisao" value="VALIDADA" /><Btn small kind="ghost">Validar</Btn></form><Modal label="Recusar" title="Recusar formação"><form action={validarQualificacao} className="space-y-2"><input type="hidden" name="id" value={q.id} /><input type="hidden" name="employeeId" value={id} /><input type="hidden" name="decisao" value="RECUSADA" /><Field label="Motivo"><Input name="motivo" required minLength={5} placeholder="Ex.: envie o diploma pelo Meu espaço" /></Field><Btn small danger>Recusar</Btn></form></Modal></div>}</div>
            : q.status === "RECUSADA" ? <div><Badge v="REJEITADA" label="recusada" /><div className="text-[11px] text-slate-500">{q.motivo_recusa}</div></div> : <Badge v="APROVADA" label="validada" />}
            {editor && <form action={excluirQualificacao} className="mt-1"><input type="hidden" name="id" value={q.id} /><input type="hidden" name="employeeId" value={id} /><button className="text-[11px] text-slate-400 underline hover:text-erro">excluir</button></form>}</Td>
        </tr>)}</Table>
        <p className="mt-2 text-xs text-slate-500">Maior titulação concluída e validada: <b>{titulacao}</b>. Entra na titulação do corpo docente (People Analytics → Composição).</p>
      </Card>
    </div>

    <Card title={`Itens sob responsabilidade${com.length ? ` — ${com.length} com a pessoa` : ""}`} className="mt-4" actions={itensOk && emp.situacao !== "DESLIGADO" ? <Modal label="Entregar item" title="Registrar item entregue ao colaborador">
      <form action={entregarItem} className="space-y-2"><input type="hidden" name="employeeId" value={id} />
        <div className="grid grid-cols-2 gap-2"><Field label="Tipo"><Select name="tipo" required defaultValue="">{[<option key="" value="">Escolha</option>, ...Object.entries(ITEM_TIPO).map(([k, v]) => <option key={k} value={k}>{v}</option>)]}</Select></Field><Field label="Entregue em"><Input name="entregueEm" type="date" defaultValue={h} max={h} /></Field></div>
        <Field label="Descrição"><Input name="descricao" placeholder="Ex.: Chave da sala 12 · Notebook Dell" /></Field>
        <div className="grid grid-cols-2 gap-2"><Field label="Identificação (série, número)"><Input name="identificacao" /></Field><Field label="Valor (R$, opcional)"><Input name="valor" inputMode="decimal" /></Field></div>
        <Field label="Patrimônio (opcional)" hint="Liga ao cadastro de ativos: o ativo passa a mostrar com quem está."><Select name="assetId" defaultValue="">{[<option key="" value="">— sem vínculo —</option>, ...ativos.map(a => <option key={a.id} value={a.id}>{a.codigo} · {a.nome}</option>)]}</Select></Field>
        <div className="grid grid-cols-2 gap-2"><Field label="Devolver até (opcional)"><Input name="devolverAte" type="date" /></Field><Field label="Observação"><Input name="obs" /></Field></div>
        <Btn small>Registrar entrega</Btn></form></Modal> : undefined}>
      <div id="itens" />
      <Table head={["Item", "Entregue", "Ciência", "Situação", ""]} empty="Nenhum item registrado (chaves, notebook, crachá, uniforme…).">{itens.map(i => <tr key={i.id}>
        <Td><div className="font-medium text-ink">{i.descricao}</div><div className="text-xs text-slate-500">{ITEM_TIPO[i.tipo] ?? i.tipo}{i.identificacao ? ` · ${i.identificacao}` : ""}{i.patrimonio ? ` · patrimônio ${i.patrimonio}` : ""}{i.valor ? ` · ${fmtMoeda(i.valor)}` : ""}</div></Td>
        <Td className="whitespace-nowrap text-xs">{fmtData(i.entregue_em)}<div className="text-slate-500">{i.entregou ?? ""}</div>{i.devolver_ate && i.status === "COM_COLABORADOR" && <div className={i.devolver_ate < h ? "text-erro" : "text-slate-500"}>devolver até {fmtData(i.devolver_ate)}</div>}</Td>
        <Td className="text-xs">{i.ciencia_em ? <span className="text-ok">✓ {fmtData(i.ciencia_em.slice(0, 10))}</span> : i.status === "COM_COLABORADOR" ? <span className="text-aviso">aguardando</span> : "—"}</Td>
        <Td><Badge v={ITEM_TOM[i.status] ?? "PENDENTE"} label={ITEM_STATUS[i.status] ?? i.status} />{i.devolvido_em && <div className="text-[11px] text-slate-500">{fmtData(i.devolvido_em)}{i.recebeu ? ` · ${i.recebeu}` : ""}{i.condicao ? ` · ${i.condicao}` : ""}</div>}{i.obs && <div className="max-w-[260px] text-[11px] text-slate-500 [overflow-wrap:anywhere]">{i.obs}</div>}</Td>
        <Td>{itensOk && i.status === "COM_COLABORADOR" && <Modal label="Devolução" title={`Devolução — ${i.descricao}`}><form action={devolverItem} className="space-y-2"><input type="hidden" name="id" value={i.id} /><input type="hidden" name="employeeId" value={id} />
          <div className="grid grid-cols-2 gap-2"><Field label="Situação"><Select name="status" defaultValue="DEVOLVIDO"><option value="DEVOLVIDO">Devolvido</option><option value="EXTRAVIADO">Extraviado / não devolvido</option><option value="BAIXADO">Baixado (consumo ou descarte)</option></Select></Field><Field label="Data"><Input name="data" type="date" defaultValue={h} max={h} /></Field></div>
          <Field label="Condição na devolução"><Select name="condicao" defaultValue="Em bom estado"><option>Em bom estado</option><option>Com desgaste normal</option><option>Danificado</option></Select></Field>
          <Field label="Observação" hint="Obrigatória no extravio e na baixa (o que aconteceu e o que foi combinado)."><Textarea name="obs" /></Field><Btn small>Registrar</Btn></form></Modal>}
          {can.editar(s) && <form action={excluirItem} className="mt-1"><input type="hidden" name="id" value={i.id} /><input type="hidden" name="employeeId" value={id} /><button className="text-[11px] text-slate-400 underline hover:text-erro">excluir lançamento</button></form>}</Td>
      </tr>)}</Table>
      <p className="mt-2 text-xs text-slate-500">A pessoa dá ciência pelo Meu espaço (termo de responsabilidade). O desligamento só conclui com tudo devolvido ou com o extravio registrado. {com.some(i => i.asset_id) ? <Link className="text-acao" href="/operacoes/ativos">Ver patrimônio</Link> : null}</p>
    </Card>
  </>);
}

export function FormQualif({ employeeId, voltar }: { employeeId: number; voltar: string }) {
  return <form action={salvarQualificacao} className="space-y-2"><input type="hidden" name="employeeId" value={employeeId} /><input type="hidden" name="voltar" value={voltar} />
    <div className="grid grid-cols-2 gap-2"><Field label="Tipo"><Select name="tipo" required defaultValue="">{[<option key="" value="">Escolha</option>, ...Object.entries(QUALIF_TIPO).map(([k, v]) => <option key={k} value={k}>{v}</option>)]}</Select></Field><Field label="Curso"><Input name="curso" required placeholder="Ex.: Pedagogia · Letras — Inglês" /></Field></div>
    <div className="grid grid-cols-2 gap-2"><Field label="Instituição"><Input name="instituicao" /></Field><Field label="Área (opcional)"><Input name="area" placeholder="Ex.: Matemática · Educação infantil" /></Field></div>
    <div className="grid grid-cols-3 gap-2"><Field label="Conclusão"><Input name="conclusao" type="date" /></Field><Field label="Carga (h)"><Input name="cargaHoras" inputMode="decimal" /></Field><Field label="Registro"><Input name="registro" placeholder="CRP, CREF…" /></Field></div>
    <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="emAndamento" value="1" /> Em andamento</label>
    <Btn small>Salvar</Btn></form>;
}
