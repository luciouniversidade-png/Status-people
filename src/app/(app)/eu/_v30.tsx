// v30 · Meu espaço: itens sob minha responsabilidade (ciência do termo) e minha formação (o RH valida)
import { sql } from "@/db";
import type { Session } from "@/lib/auth";
import { Card, Badge, Btn, Table, Td } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { fmtData } from "@/lib/utils";
import { QUALIF_TIPO, maiorTitulacao, ITEM_TIPO, ITEM_STATUS, ITEM_TOM } from "@/lib/pessoas-v30";
import { cienciaItem, excluirQualificacao } from "../colaboradores/v30-actions";
import { FormQualif } from "../colaboradores/[id]/_v30";

export async function MeuEspacoV30({ s, eid }: { s: Session; eid: number }) {
  const [itens, quals] = await Promise.all([
    sql<{ id: number; tipo: string; descricao: string; identificacao: string | null; entregue_em: string; ciencia_em: string | null; devolver_ate: string | null; status: string; devolvido_em: string | null }[]>`SELECT id, tipo, descricao, identificacao, entregue_em::text, ciencia_em::text, devolver_ate::text, status, devolvido_em::text FROM employee_items WHERE employee_id=${eid} ORDER BY status='COM_COLABORADOR' DESC, entregue_em DESC LIMIT 40`,
    sql<{ id: number; tipo: string; curso: string; instituicao: string | null; conclusao: string | null; em_andamento: boolean; status: string; motivo_recusa: string | null }[]>`SELECT id, tipo, curso, instituicao, conclusao::text, em_andamento, status, motivo_recusa FROM employee_qualifications WHERE employee_id=${eid} ORDER BY conclusao DESC NULLS FIRST, id DESC`,
  ]);
  const semCiencia = itens.filter(i => i.status === "COM_COLABORADOR" && !i.ciencia_em).length; void s;
  return <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
    <Card title={`Itens sob minha responsabilidade${semCiencia ? ` — ${semCiencia} para dar ciência` : ""}`}>
      <div id="itens" />
      <Table head={["Item", "Desde", "Situação"]} empty="Nenhum item registrado com você (chaves, notebook, crachá, uniforme…).">{itens.map(i => <tr key={i.id}>
        <Td><div className="font-medium text-ink">{i.descricao}</div><div className="text-xs text-slate-500">{ITEM_TIPO[i.tipo] ?? i.tipo}{i.identificacao ? ` · ${i.identificacao}` : ""}{i.devolver_ate && i.status === "COM_COLABORADOR" ? ` · devolver até ${fmtData(i.devolver_ate)}` : ""}</div></Td>
        <Td className="whitespace-nowrap text-xs">{fmtData(i.entregue_em)}</Td>
        <Td>{i.status === "COM_COLABORADOR" && !i.ciencia_em ? <form action={cienciaItem}><input type="hidden" name="id" value={i.id} /><Btn small>Dar ciência</Btn></form> : <><Badge v={ITEM_TOM[i.status] ?? "PENDENTE"} label={ITEM_STATUS[i.status] ?? i.status} />{i.status === "COM_COLABORADOR" && i.ciencia_em ? <div className="text-[11px] text-ok">ciência em {fmtData(i.ciencia_em.slice(0, 10))}</div> : i.devolvido_em ? <div className="text-[11px] text-slate-500">{fmtData(i.devolvido_em)}</div> : null}</>}</Td>
      </tr>)}</Table>
      <p className="mt-2 text-[11px] text-slate-500">Dar ciência = “recebi e me responsabilizo pela guarda e pela devolução”. Algo errado? Fale com quem entregou ou abra uma solicitação.</p>
    </Card>
    <Card title={`Minha formação · ${maiorTitulacao(quals)}`} actions={<Modal label="Informar formação" title="Informar formação ou curso"><p className="mb-2 text-xs text-slate-600">O RH valida com o comprovante (diploma, certificado) — envie o arquivo em Minha ficha → Arquivos do colaborador.</p><FormQualif employeeId={eid} voltar="/eu#formacao" /></Modal>}>
      <div id="formacao" />
      <Table head={["Formação", "Conclusão", "Situação"]} empty="Nenhuma formação registrada ainda.">{quals.map(q => <tr key={q.id}>
        <Td><div className="font-medium text-ink">{q.curso}</div><div className="text-xs text-slate-500">{QUALIF_TIPO[q.tipo] ?? q.tipo}{q.instituicao ? ` · ${q.instituicao}` : ""}</div></Td>
        <Td className="whitespace-nowrap text-xs">{q.em_andamento ? "em andamento" : fmtData(q.conclusao)}</Td>
        <Td>{q.status === "VALIDADA" ? <Badge v="APROVADA" label="validada" /> : q.status === "RECUSADA" ? <div><Badge v="REJEITADA" label="não validada" /><div className="text-[11px] text-slate-500">{q.motivo_recusa}</div></div> : <Badge v="PENDENTE" label="aguardando o RH" />}
          {q.status !== "VALIDADA" && <form action={excluirQualificacao} className="mt-1"><input type="hidden" name="id" value={q.id} /><input type="hidden" name="employeeId" value={eid} /><input type="hidden" name="voltar" value="/eu#formacao" /><button className="text-[11px] text-slate-400 underline hover:text-erro">excluir</button></form>}</Td>
      </tr>)}</Table>
    </Card>
  </div>;
}
