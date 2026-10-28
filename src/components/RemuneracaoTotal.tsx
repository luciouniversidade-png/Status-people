// v30 · Remuneração total estimada (no estilo dos “total rewards statements”): o que a escola investe na pessoa em um ano — para a ficha (RH/Direção) e o Meu espaço (a própria pessoa)
import { Card, Table, Td } from "@/components/ui";
import { Rosca, corSerie } from "@/components/graficos";
import { fmtMoeda, fmtData } from "@/lib/utils";
import { remuneracaoTotal, adesoes } from "@/lib/beneficios";

export async function RemuneracaoTotal({ employeeId, proprio = false }: { employeeId: number; proprio?: boolean }) {
  const [r, lista] = await Promise.all([remuneracaoTotal(employeeId), adesoes({ employeeId })]);
  if (!r) return null; const ativas = lista.filter(a => a.status === "ATIVO");
  return <Card className="mt-4" title={proprio ? "Meus benefícios e remuneração total" : "Benefícios e remuneração total"}>
    <div id="beneficios" />
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div>
        <Table head={["Benefício", "Desde", "A escola paga/mês", "Desconto/mês"]} empty={proprio ? "Nenhum benefício registrado para você. Dúvidas? Fale com o RH." : "Nenhum benefício ativo."}>{ativas.map(a => <tr key={a.id}><Td className="text-xs"><div className="font-medium text-ink">{a.plano}</div>{a.aluno && <div className="text-[11px] text-slate-500">aluno(a): {a.aluno}{a.bolsa_pct ? ` · ${a.bolsa_pct}%` : ""}</div>}{a.dependentes > 0 && <div className="text-[11px] text-slate-500">{a.dependentes} dependente(s)</div>}</Td><Td className="text-xs">{fmtData(a.inicio)}</Td><Td className="text-xs">{fmtMoeda(a.valor_empresa)}</Td><Td className="text-xs">{fmtMoeda(a.valor_colab)}</Td></tr>)}</Table>
        {lista.length > ativas.length && <p className="mt-1 text-[11px] text-slate-500">{lista.length - ativas.length} benefício(s) encerrado(s) no histórico.</p>}
      </div>
      <div>
        {r.salario > 0 ? <>
          <div className="flex flex-wrap items-baseline gap-x-3"><div className="text-2xl font-semibold tabular-nums text-navy">{fmtMoeda(r.total)}</div><div className="text-xs text-slate-600">por ano · equivale a {fmtMoeda(r.mensalEquivalente)}/mês{r.multiplicador ? ` · ${r.multiplicador.toFixed(2).replace(".", ",")}× o salário` : ""}</div></div>
          <Rosca rotulo="Composição da remuneração total" formato={v => fmtMoeda(v)} fatias={r.partes.map((p, i) => ({ rotulo: p.rotulo, valor: p.valor, cor: corSerie(i) }))} />
          <p className="mt-1 text-[11px] text-slate-500">Estimativa para a conversa de valorização — não é holerite. {r.clt ? `FGTS de ${String(r.fgtsPct).replace(".", ",")}% e encargos de ${String(Math.max(0, r.encargosPct - r.fgtsPct)).replace(".", ",")}% sobre salário, 13º e férias (estimativa da escola).` : "Vínculo sem 13º, férias e FGTS pela CLT."} Benefícios: o que a escola paga, em 12 meses.</p>
        </> : <p className="text-sm text-slate-500">Sem salário registrado para estimar a remuneração total.</p>}
      </div>
    </div>
  </Card>;
}
