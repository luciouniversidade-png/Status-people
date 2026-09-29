import Link from "@/components/Link";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Table, Td, Badge, Flash, Field, Input, Select, Textarea, Btn } from "@/components/ui";
import { FAMILIAS } from "@/lib/avaliacao";
import { salvarModelo } from "../criterios-actions";

export const dynamic = "force-dynamic";

export default async function Modelos({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaff(); if (!["DIRECAO", "RH"].includes(s.role)) redirect("/desempenho"); const sp = await searchParams;
  const rows = await sql<{ id: number; nome: string; familia: string; versao: number; status: string; peso_resultados: number; peso_atitudes: number; nota_composta: boolean; n: number; ciclos: number; congelado_em: Date | string | null }[]>`SELECT m.*, jsonb_array_length(m.criterios)::int AS n, (SELECT count(*) FROM perf_cycles c WHERE c.model_id=m.id)::int AS ciclos FROM eval_models m ORDER BY m.familia, m.versao DESC`;
  return (
    <Page title="Modelos de avaliação" sub="Um modelo por família de cargos: critérios em Resultados e Atitudes, competências técnicas à parte, rubrica por nível e evidência esperada. Nota composta só quando o modelo aprovado define finalidade e limites; pesos como 60/40 são exemplos de configuração, não regra validada. Ao abrir um ciclo o modelo congela; mudanças viram nova versão." actions={<Btn kind="ghost" href="/desempenho">Desempenho</Btn>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="grid gap-4 lg:grid-cols-[1fr_340px] lg:items-start">
        <Table head={["Modelo", "Família", "Versão", "Critérios", "Composição", "Ciclos", "Situação"]} empty="Nenhum modelo. Crie o primeiro ao lado — ele já vem com critérios sugeridos para a família.">{rows.map(m => <tr key={m.id}><Td><Link className="font-medium text-acao" href={`/desempenho/modelos/${m.id}`}>{m.nome}</Link></Td><Td>{FAMILIAS[m.familia] ?? m.familia}</Td><Td>v{m.versao}</Td><Td>{m.n}</Td><Td className="text-xs">{m.nota_composta ? `nota composta ${m.peso_resultados}/${m.peso_atitudes}` : "perfil por eixo"}</Td><Td>{m.ciclos || "—"}</Td><Td><Badge v={m.status === "ATIVO" ? "APROVADA" : m.status === "ARQUIVADO" ? "CANCELADA" : "EM_AQUISICAO"} label={m.status === "ATIVO" ? "Ativo" : m.status === "ARQUIVADO" ? "Arquivado" : "Rascunho"} />{m.congelado_em && <Badge v="ATIVO" label="congelado" />}</Td></tr>)}</Table>
        <Card title="Novo modelo"><form action={salvarModelo} className="space-y-2"><Field label="Nome"><Input name="nome" required placeholder="Ex.: Professores 2027" /></Field><Field label="Família de cargos"><Select name="familia">{Object.entries(FAMILIAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field><div className="grid grid-cols-2 gap-2"><Field label="Peso Resultados (%)"><Input name="pesoResultados" type="number" defaultValue={60} /></Field><Field label="Peso Atitudes (%)"><Input name="pesoAtitudes" type="number" defaultValue={40} /></Field></div><Field label="Cobertura mínima por eixo (%)" hint="Parte do peso aplicável que precisa estar avaliada para concluir."><Input name="coberturaMinima" type="number" defaultValue={50} /></Field><label className="flex items-center gap-2 text-xs"><input type="checkbox" name="notaComposta" value="1" /> Habilitar nota composta (exige finalidade)</label><Field label="Finalidade da nota composta"><Textarea name="finalidade" className="min-h-[40px]" placeholder="Para que a nota será usada e seus limites" /></Field><label className="flex items-center gap-2 text-xs"><input type="checkbox" name="vazio" value="1" /> Começar sem critérios (em vez dos sugeridos)</label><Btn small>Criar</Btn><p className="text-xs text-slate-500">Os critérios sugeridos são um ponto de partida para o RH homologar: escala 1–5, rubrica nos níveis 1, 3 e 5, evidência esperada. Valores institucionais entram como práticas observáveis.</p></form></Card>
      </div>
    </Page>
  );
}
