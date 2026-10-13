import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Badge, Flash, Field, Btn, Select, Textarea } from "@/components/ui";
import { fmtData, fmtDataHora, audit } from "@/lib/utils";
import { CATEGORIA_ETICA, RELACAO_ETICA, ETICA_STATUS, RESULTADO_ETICA, ETICA_ABERTO, podeTratarRelato, responsaveisRelato, comite, candidatosEtica, impedidosEfetivos } from "@/lib/etica";
import { tratarRelato, mensagemComite, impedimentoRelato, concluirRelato } from "../actions";

export const dynamic = "force-dynamic";

export default async function Relato({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const { id } = await params; const sp = await searchParams;
  const [r] = await sql<{ id: number; protocolo: string; categoria: string; relato: string; envolvidos: string | null; local: string | null; quando: string | null; testemunhas: string | null; unidade: string | null; relacao: string | null; anonimo: boolean; contato: { nome: string; contato: string } | null; status: string; gravidade: number | null; prazo_triagem: string | null; prazo_conclusao: string | null; responsavel_user_id: number | null; impedidos: number[] | null; liberados: number[] | null; resultado: string | null; conclusao: string | null; medidas: string | null; concluida_em: string | null; created_at: string }[]>`SELECT r.id, r.protocolo, r.categoria, r.relato, r.envolvidos, r.local, r.quando, r.testemunhas, u.nome AS unidade, r.relacao, r.anonimo, r.contato, r.status, r.gravidade, r.prazo_triagem::text, r.prazo_conclusao::text, r.responsavel_user_id, r.impedidos, r.liberados, r.resultado, r.conclusao, r.medidas, r.concluida_em::text, r.created_at::text FROM ethics_reports r LEFT JOIN units u ON u.id=r.unit_id WHERE r.id=${Number(id)}`;
  if (!r || !(await podeTratarRelato(s, r))) notFound();
  await audit(s, "ver relato do canal de ética", "ethics_reports", r.id);
  const cands = await candidatosEtica(); const imp = impedidosEfetivos(r, cands);
  const [msgs, resp, c] = await Promise.all([sql<{ autor: string; texto: string; user_nome: string | null; created_at: string }[]>`SELECT autor, texto, user_nome, created_at::text FROM ethics_messages WHERE report_id=${r.id} ORDER BY id`, responsaveisRelato(imp), comite()]);
  const aberto = ETICA_ABERTO.includes(r.status);
  const nomes = new Map([...cands, ...c.membros, ...resp].map(m => [m.id, m.nome]));
  return (
    <Page title={`Relato ${r.protocolo}`} sub={`${CATEGORIA_ETICA[r.categoria]} · recebido ${fmtDataHora(r.created_at)} · ${r.anonimo ? "anônimo" : "identificado"}`}>
      <Flash ok={sp.ok} erro={sp.erro} />
      {r.categoria === "PROTECAO_ALUNO" && <Card className="mb-4 border-2 border-erro"><p className="text-sm text-erro"><b>Proteção de criança ou adolescente:</b> havendo suspeita ou confirmação de maus-tratos, a comunicação ao Conselho Tutelar é obrigatória (ECA, art. 13 e art. 245). Registre a comunicação neste relato.</p></Card>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="space-y-4">
          <Card title="Relato">
            <p className="whitespace-pre-wrap text-sm">{r.relato}</p>
            <dl className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2"><div><dt className="text-xs text-slate-500">Envolvidos</dt><dd>{r.envolvidos ?? "—"}</dd></div><div><dt className="text-xs text-slate-500">Onde / quando</dt><dd>{[r.local, r.quando].filter(Boolean).join(" · ") || "—"}</dd></div><div><dt className="text-xs text-slate-500">Testemunhas</dt><dd>{r.testemunhas ?? "—"}</dd></div><div><dt className="text-xs text-slate-500">Unidade · quem relatou</dt><dd>{r.unidade ?? "não informada"} · {RELACAO_ETICA[r.relacao ?? ""] ?? "—"}</dd></div>
              {r.contato && <div className="sm:col-span-2"><dt className="text-xs text-slate-500">Identificação (autorizada)</dt><dd>{r.contato.nome} · {r.contato.contato}</dd></div>}</dl>
            <div className="mt-3 flex flex-wrap gap-2"><Badge v={aberto ? "PENDENTE" : "APROVADA"} label={ETICA_STATUS[r.status]} />{r.gravidade && <Badge v={r.gravidade === 3 ? "REJEITADA" : "NEUTRO"} label={`gravidade ${r.gravidade}`} />}{aberto && <span className="text-xs text-slate-600">triagem até {fmtData(r.prazo_triagem)} · conclusão até {fmtData(r.prazo_conclusao)}</span>}</div>
            {!aberto && <div className="mt-3 rounded bg-mist p-3 text-sm">{r.resultado && <p><b>{RESULTADO_ETICA[r.resultado]}</b></p>}<p className="whitespace-pre-wrap">{r.conclusao}</p>{r.medidas && <p className="mt-1"><b>Medidas:</b> {r.medidas}</p>}<p className="mt-1 text-xs text-slate-500">Encerrado em {fmtDataHora(r.concluida_em)}</p></div>}
          </Card>
          <Card title="Conversa e notas">
            <ul className="space-y-2">{msgs.map((m, i) => <li key={i} className={`rounded-md p-2 text-sm ${m.autor === "DENUNCIANTE" ? "bg-amber-50" : m.autor === "COMITE" ? "bg-sky-50" : "bg-mist"}`}><div className="text-[11px] text-slate-500">{m.autor === "DENUNCIANTE" ? "Quem relatou" : m.autor === "COMITE" ? `Comitê → quem relatou · ${m.user_nome ?? ""}` : `Nota interna · ${m.user_nome ?? ""}`} · {fmtDataHora(m.created_at)}</div><p className="whitespace-pre-wrap">{m.texto}</p></li>)}{msgs.length === 0 && <li className="text-sm text-slate-500">Nenhuma mensagem.</li>}</ul>
            <form action={mensagemComite} className="mt-3 space-y-2 border-t border-line pt-3"><input type="hidden" name="id" value={r.id} /><Textarea name="texto" required className="min-h-[60px]" /><div className="flex flex-wrap items-center gap-2"><Select name="interna" defaultValue="1" className="w-auto"><option value="1">Nota interna do comitê</option>{aberto && <option value="0">Mensagem para quem relatou</option>}</Select><Btn small kind="ghost">Registrar</Btn></div></form>
          </Card>
        </div>
        <div className="space-y-4">
          {aberto && <Card title="Triagem e apuração">
            <form action={tratarRelato} className="space-y-2"><input type="hidden" name="id" value={r.id} />
              <Field label="Situação"><Select name="status" defaultValue={r.status}><option value="RECEBIDA">Recebido (triagem)</option><option value="EM_APURACAO">Em apuração</option></Select></Field>
              <Field label="Gravidade"><Select name="gravidade" defaultValue={r.gravidade ?? ""}><option value="">—</option><option value="1">1 · leve</option><option value="2">2 · moderada</option><option value="3">3 · grave</option></Select></Field>
              <Field label="Responsável pela apuração"><Select name="responsavelUserId" defaultValue={r.responsavel_user_id ?? ""}><option value="">—</option>{resp.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}</Select></Field><Btn small>Salvar</Btn></form></Card>}
          <Card title="Impedimentos">
            <p className="mb-2 text-xs text-slate-600">Quem é citado ou tem conflito de interesse não acessa o relato. Cada membro pode se declarar impedido; marcar outra pessoa (ou desfazer) é da Direção.</p>
            <ul className="space-y-1 text-sm">{c.membros.map(m => <li key={m.id} className="flex items-center justify-between gap-2"><span>{m.nome}</span>{imp.includes(m.id) ? <span className="flex items-center gap-1"><Badge v="REJEITADA" label="impedido" />{s.role === "DIRECAO" && m.id !== s.id && <form action={impedimentoRelato}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="userId" value={m.id} /><input type="hidden" name="desfazer" value="1" /><button className="text-[11px] text-acao">desfazer</button></form>}</span> : (m.id === s.id || s.role === "DIRECAO") ? <form action={impedimentoRelato}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="userId" value={m.id} /><button className="text-[11px] text-erro">{m.id === s.id ? "declarar-me impedido" : "marcar impedido"}</button></form> : null}</li>)}</ul>
            {imp.filter(i => !c.membros.some(m => m.id === i)).length > 0 && <p className="mt-2 text-xs text-slate-500">Outros impedidos: {imp.filter(i => !c.membros.some(m => m.id === i)).map(i => nomes.get(i) ?? `#${i}`).join(", ")}</p>}
          </Card>
          {aberto && <Card title="Encerrar">
            <form action={concluirRelato} className="space-y-2"><input type="hidden" name="id" value={r.id} />
              <Field label="Resultado"><Select name="resultado" defaultValue=""><option value="">—</option>{Object.entries(RESULTADO_ETICA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
              <Field label="Conclusão (registro interno)"><Textarea name="conclusao" className="min-h-[60px]" /></Field><Field label="Medidas adotadas"><Textarea name="medidas" className="min-h-[50px]" /></Field>
              <Field label="Retorno para quem relatou (opcional)"><Textarea name="retorno" className="min-h-[50px]" placeholder="Sem expor pessoas: informe que o relato foi apurado e as medidas cabíveis adotadas." /></Field>
              <div className="flex flex-wrap gap-2"><Btn small>Concluir apuração</Btn><Btn small kind="ghost" name="arquivar" value="1">Arquivar (fora do escopo)</Btn></div></form></Card>}
        </div>
      </div>
    </Page>
  );
}
