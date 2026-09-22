import { redirect } from "next/navigation";
import { requireMatriculas, can } from "@/lib/auth";
import { Page, Flash, Card, Textarea, Btn, Field } from "@/components/ui";
import { importarAlunos } from "../actions";
export const dynamic = "force-dynamic";
export default async function Importar({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const s = await requireMatriculas(); if (!can.reservar(s)) redirect("/matriculas/alunos");
  const { erro } = await searchParams;
  return (
    <Page title="Importar alunos" sub="Base atual de alunos (para a rematrícula) ou lista de candidatos. Cole o CSV.">
      <Flash erro={erro} />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <form action={importarAlunos} className="space-y-3"><Field label="Conteúdo CSV"><Textarea name="csv" className="min-h-[320px] font-mono text-xs" placeholder={"nome;nascimento;responsavel;telefone;email;unidade;serie;aluno_atual\nAna Souza;12/03/2019;Carla Souza;67 99999-0000;carla@...;Carandá;Jardim II;sim"} /></Field><Field label="Ou envie o arquivo (.xlsx/.xls/.csv)"><input type="file" name="arquivo" accept=".xlsx,.xls,.xlsm,.csv,.txt" className="block w-full rounded-md border border-line bg-white px-2 py-1.5 text-xs file:mr-2 file:rounded file:border-0 file:bg-acao file:px-2 file:py-1 file:text-xs file:text-white" /></Field><Btn>Importar</Btn></form>
        <Card title="Como preparar"><ul className="space-y-2 text-sm text-slate-700">
          <li>Obrigatória: <b>nome</b>. Opcionais: nascimento (DD/MM/AAAA), responsavel, telefone, email, unidade, serie (série atual), aluno_atual (sim/não), origem.</li>
          <li>Quem tem unidade e série atual entra como aluno da rede (rematrícula). Sem unidade, entra como candidato.</li>
          <li>Nome já cadastrado (mesma data de nascimento) é pulado. Nada é sobrescrito.</li>
          <li>Depois da importação, reserve ou matricule cada aluno na turma de 2027 pela ficha ou pela turma.</li>
        </ul></Card>
      </div>
    </Page>
  );
}
