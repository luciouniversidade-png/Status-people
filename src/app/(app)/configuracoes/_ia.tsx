import Link from "@/components/Link";
import { sql } from "@/db";
import { Card, Btn, Badge } from "@/components/ui";
import { configIA, MODELO_PADRAO } from "@/lib/ia";
import { fmtDataHora } from "@/lib/utils";
import { testarIA } from "./ia-actions";

const USOS: [string, string, string][] = [
  ["Estratégia → Assistente IA", "/estrategia/assistente", "rascunhos de leitura executiva, pauta do comitê e prioridades, só com os fatos agregados do painel"],
  ["People AI", "/analytics/assistente", "perguntas sobre os dados de pessoas, com dados agregados e anonimizados"],
  ["Desempenho → Apoio de IA", "/desempenho", "síntese, pauta e rascunho de feedback a partir das evidências que o gestor já vê"],
  ["Recrutamento → Calcular com IA", "/recrutamento", "aderência do candidato: a IA aponta o trecho e o sistema confere e calcula"],
];

/** v32 · IA (opcional): situação, como ligar (Claude API + variáveis do servidor) e o teste de conexão — a chave nunca aparece. */
export async function BlocoIA() {
  const c = configIA();
  const [ult] = await sql<{ at: string; user_nome: string | null; depois: { ok?: boolean; modelo?: string; ms?: number; erro?: string } | null }[]>`SELECT at, user_nome, depois FROM audit_log WHERE acao='teste da IA' ORDER BY id DESC LIMIT 1`;
  return (
    <Card title="IA (opcional) — ligar e testar" className="mb-4" actions={c.ligada ? <Badge v="ATIVO" label="ligada" /> : <Badge v="PENDENTE" label="desligada" />}><div id="ia" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-3 text-sm">
          {c.ligada
            ? <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-ok"><b>IA ligada.</b> Chave cadastrada no servidor (nunca aparece aqui) · modelo <b>{c.modelo}</b>{c.modeloPadrao ? " (padrão)" : ""}{c.workspace ? <> · workspace <code className="rounded bg-white px-1 text-xs">{c.workspace}</code></> : null}{c.enderecoPadrao ? null : <> · endereço de teste <code className="rounded bg-white px-1 text-xs">{c.endereco}</code></>}.</p>
            : <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-aviso"><b>IA desligada nesta instalação.</b> Sem a variável <code className="rounded bg-white px-1 text-xs">AI_API_KEY</code> nada é enviado, gerado nem simulado — o restante do sistema funciona normalmente.</p>}
          <div>
            <div className="mb-1 font-semibold text-navy">Como ligar (uma vez, uns 5 minutos)</div>
            <ol className="list-decimal space-y-1 pl-5 text-[13px] text-slate-700">
              <li><b>Créditos:</b> em <b>platform.claude.com → Billing</b>, compre créditos (a API é cobrada por uso, à parte da assinatura do Claude). Planos Max, Ultra e Team incluem créditos mensais da API: claude.ai → Settings → Billing → <i>API credits</i>.</li>
              <li><b>Chave:</b> em <b>platform.claude.com → API keys → Create key</b>, escolha <b>um workspace</b> (ex.: Default) e a expiração <b>Never</b>; copie a chave (começa com <code className="text-xs">sk-ant-</code> e aparece uma vez só).</li>
              <li><b>Servidor:</b> no Vercel, projeto → <b>Settings → Environment Variables</b>: <code className="text-xs">AI_API_KEY</code> = a chave e <code className="text-xs">AI_MODEL</code> = <code className="text-xs">{MODELO_PADRAO}</code> (Production) → Save.</li>
              <li><b>Publicar:</b> Deployments → o mais recente → ⋯ → <b>Redeploy</b> (a variável só vale numa publicação nova). Depois, volte aqui e clique em <b>Testar a IA agora</b>.</li>
            </ol>
            <p className="mt-1 text-[11px] text-slate-500">A chave fica só nas variáveis do servidor — nunca em planilha, e-mail ou WhatsApp. Chave sem workspace: cadastre também <code>AI_WORKSPACE_ID</code> (Console → Workspaces). Para limitar o gasto, crie um workspace só para o ONE e defina o limite dele no Console.</p>
          </div>
        </div>
        <div className="min-w-0 space-y-3 text-sm">
          <div>
            <div className="mb-1 font-semibold text-navy">Onde a IA aparece</div>
            <ul className="space-y-1 text-[13px] text-slate-700">{USOS.map(([t, h, d]) => <li key={h}><Link href={h} className="text-acao hover:underline">{t}</Link>: {d}.</li>)}</ul>
            <p className="mt-1 text-[11px] text-slate-500">Sempre rascunho com a fonte citada e revisão humana; a IA não decide, não dá nota e não recebe nomes de famílias. Cada tela mostra exatamente o que será enviado.</p>
          </div>
          <form action={testarIA} className="rounded-md border border-line bg-mist/60 p-3">
            <div className="mb-1 font-semibold text-navy">Teste de conexão</div>
            <p className="mb-2 text-[12px] text-slate-600">Envia só a frase “Teste de conexão do STATUS ONE” e espera um “OK” — nenhum dado da escola sai. Mostra o modelo e o tempo de resposta, ou o que corrigir (chave, créditos, workspace, modelo).</p>
            <Btn small pendingText="Testando…">Testar a IA agora</Btn>
            {ult && <p className="mt-2 text-[11px] text-slate-600">Último teste: {fmtDataHora(ult.at)}{ult.user_nome ? ` · ${ult.user_nome}` : ""} · {ult.depois?.ok ? <span className="text-ok">respondeu ({ult.depois.modelo}, {ult.depois.ms} ms)</span> : <span className="text-erro">falhou</span>}</p>}
          </form>
        </div>
      </div>
    </Card>
  );
}
