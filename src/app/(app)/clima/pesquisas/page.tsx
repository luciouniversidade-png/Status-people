import Link from "@/components/Link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Flash, Badge, Btn, Table, Td } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { fmtData, hoje, addDays } from "@/lib/utils";
import * as P from "@/lib/pesquisas";
import { FormPesquisa } from "./FormPesquisa";

export const dynamic = "force-dynamic";
const TOM: Record<string, string> = { RASCUNHO: "PENDENTE", ABERTA: "ABERTO", ENCERRADA: "CONCLUIDO" };
const EXEMPLO = `ESCALA | Recebo as informações de que preciso para trabalhar bem.
ESCALA | Minha liderança me dá retorno sobre o meu trabalho.
UNICA | Qual o melhor horário para a formação continuada? | Manhã; Tarde; Noite
MULTIPLA | Quais temas você quer na próxima formação? | Avaliação; Inclusão; Tecnologia; Gestão de sala
TEXTO | O que podemos melhorar na comunicação interna?`;

/** v34 · Pesquisas internas (escala, múltipla escolha e texto), anônimas ou identificadas, respondidas no Meu espaço. */
export default async function Pesquisas({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); if (!P.podePesquisas(s)) redirect("/sem-acesso?t=%2Fclima%2Fpesquisas"); const sp = await searchParams;
  const [lista, units, cargos] = await Promise.all([
    sql<{ id: number; titulo: string; identificada: boolean; status: string; publico: string; inicio: string; fim: string; respostas: number; nperg: number; criado_nome: string | null; unit_id: number | null; position_id: number | null }[]>`SELECT sv.id, sv.titulo, sv.identificada, sv.status, sv.publico, sv.inicio::text, sv.fim::text, (SELECT count(*) FROM custom_survey_marks m WHERE m.survey_id=sv.id)::int AS respostas, jsonb_array_length(sv.perguntas)::int AS nperg, sv.criado_nome, sv.unit_id, sv.position_id FROM custom_surveys sv ORDER BY (sv.status='ABERTA') DESC, sv.created_at DESC LIMIT 200`,
    sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ORDER BY nome`, sql<{ id: number; nome: string }[]>`SELECT id, nome FROM positions ORDER BY ordem, nome`,
  ]);
  const publicos = new Map<number, number>(); for (const p of lista) publicos.set(p.id, await P.tamanhoPublico(p));
  return (
    <Page title="Pesquisas internas" sub="Perguntas de escala, múltipla escolha e texto, respondidas no Meu espaço. Anônima: ninguém vê quem respondeu e o resultado só aparece com o mínimo de respostas. Identificada: avisa a pessoa e permite exportar."
      actions={<Modal label="Nova pesquisa" title="Nova pesquisa" kind="primary" small={false}><FormPesquisa units={units} cargos={cargos} valores={{ perguntas: EXEMPLO, inicio: hoje(), fim: addDays(hoje(), 14), minimo: 5, publico: "TODOS", identificada: false }} /></Modal>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <Card title={`Pesquisas (${lista.length})`}>
        <Table head={["Pesquisa", "Tipo", "Público", "Período", "Respostas", "Situação"]} empty="Nenhuma pesquisa criada.">
          {lista.map(p => { const pub = publicos.get(p.id) ?? 0; return <tr key={p.id}>
            <Td><Link className="font-medium text-acao [overflow-wrap:anywhere]" href={`/clima/pesquisas/${p.id}`}>{p.titulo}</Link><span className="block text-[11px] text-slate-500">{p.nperg} pergunta(s){p.criado_nome ? ` · ${p.criado_nome}` : ""}</span></Td>
            <Td className="text-xs">{p.identificada ? "Identificada" : "Anônima"}</Td><Td className="text-xs">{P.PUBLICO[p.publico]}</Td>
            <Td className="whitespace-nowrap text-xs">{fmtData(p.inicio)} – {fmtData(p.fim)}</Td>
            <Td className="text-xs">{p.respostas}{pub ? ` de ${pub} (${Math.round(100 * p.respostas / pub)}%)` : ""}</Td>
            <Td><Badge v={TOM[p.status] ?? "PENDENTE"} label={P.STATUS_PESQUISA[p.status]} /></Td>
          </tr>; })}
        </Table>
      </Card>
      <p className="mt-3 text-xs text-slate-500">Clima e eNPS (pesquisa por link, com dimensões e plano de ação) continuam em <Link className="text-acao underline" href="/clima">Clima e eNPS</Link>. O pulso semanal está no <Link className="text-acao underline" href="/clima/humor">Termômetro de humor</Link>.</p>
    </Page>
  );
}
