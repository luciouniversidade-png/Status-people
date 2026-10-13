import { sql } from "@/db";
import { getSession } from "@/lib/auth";
import { Card, Field, Input, Btn } from "@/components/ui";
import { fmtDataHora } from "@/lib/utils";
import { enviarAnexo, removerAnexo } from "@/app/(app)/anexos/actions";

const fmtTam = (b: number) => b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;

/** Lista e envia arquivos ligados a um registro (ficha, caso, chamado, aluno, projeto, POP). */
export async function Anexos({ entidade, id, voltar, podeEnviar = true, titulo = "Anexos" }: { entidade: string; id: number; voltar: string; podeEnviar?: boolean; titulo?: string }) {
  const s = await getSession();
  // "remover" só aparece para quem pode remover: quem anexou, RH ou Direção — e nunca em evidência de incidente ou de relato de ética
  const podeRemover = (a: { user_id: number | null }) => podeEnviar && !!s && (a.user_id === s.id || ["DIRECAO", "RH"].includes(s.role)) && !["privacy_incident", "ethics_report"].includes(entidade);
  const rows = await sql<{ id: number; nome: string; mime: string; tamanho: number; descricao: string | null; user_nome: string | null; user_id: number | null; created_at: Date | string }[]>`SELECT id, nome, mime, tamanho, descricao, user_nome, user_id, created_at FROM attachments WHERE entidade=${entidade} AND entidade_id=${id} ORDER BY created_at DESC`;
  return (
    <Card title={`${titulo} (${rows.length})`} className="mt-4">
      {rows.length === 0 ? <p className="text-sm text-slate-500">Nenhum arquivo.</p> : <ul className="divide-y divide-line text-sm">{rows.map(a => <li key={a.id} className="flex flex-wrap items-center gap-2 py-2"><a className="font-medium text-acao" href={`/api/anexos/${a.id}`} target="_blank" rel="noreferrer">{a.nome}</a><span className="text-xs text-slate-500">{fmtTam(a.tamanho)} · {a.user_nome ?? "—"} · {fmtDataHora(a.created_at)}</span>{a.descricao && <span className="text-xs text-slate-600">— {a.descricao}</span>}{podeRemover(a) && <form action={removerAnexo} className="ml-auto print:hidden"><input type="hidden" name="id" value={a.id} /><input type="hidden" name="voltar" value={voltar} /><button className="text-xs text-erro">remover</button></form>}</li>)}</ul>}
      {podeEnviar && <form action={enviarAnexo} className="mt-3 grid grid-cols-1 gap-2 border-t border-line pt-3 print:hidden sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"><input type="hidden" name="entidade" value={entidade} /><input type="hidden" name="entidadeId" value={id} /><input type="hidden" name="voltar" value={voltar} />
        <Field label="Arquivo (PDF, imagem, Word, Excel — até 8 MB)"><input type="file" name="arquivo" required className="block w-full rounded-md border border-line bg-white px-2 py-1.5 text-xs file:mr-2 file:rounded file:border-0 file:bg-acao file:px-2 file:py-1 file:text-xs file:text-white" /></Field>
        <Field label="Descrição (opcional)"><Input name="descricao" /></Field><div className="flex items-end"><Btn small kind="ghost">Anexar</Btn></div></form>}
    </Card>
  );
}
