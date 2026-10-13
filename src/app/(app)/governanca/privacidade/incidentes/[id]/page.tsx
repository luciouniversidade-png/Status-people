import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Badge, Flash, Field, Btn, Select, Textarea, Input } from "@/components/ui";
import { fmtData, fmtDataHora, hoje } from "@/lib/utils";
import { podePrivacidade, INC_RISCO, INC_STATUS } from "@/lib/privacidade";
import { atualizarIncidente } from "../../actions";
import { Anexos } from "@/components/Anexos";

export const dynamic = "force-dynamic";

export default async function Incidente({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); if (!(await podePrivacidade(s))) redirect("/governanca/privacidade");
  const { id } = await params; const sp = await searchParams;
  const [i] = await sql<{ id: number; codigo: string; titulo: string; descricao: string | null; unidade: string | null; detectado_em: string | null; ciencia_em: string; categorias_dados: string[] | null; titulares_estimados: number | null; envolve_criancas: boolean; dados_sensiveis: boolean; risco: string; prazo_anpd: string | null; comunicar: boolean | null; justificativa_nao_comunicar: string | null; comunicado_anpd_em: string | null; comunicado_titulares_em: string | null; medidas: string | null; causa: string | null; status: string; historico: { em: string; por: string; texto: string }[] | null; encerrado_em: string | null }[]>`SELECT i.id, i.codigo, i.titulo, i.descricao, u.nome AS unidade, i.detectado_em::text, i.ciencia_em::text, i.categorias_dados, i.titulares_estimados, i.envolve_criancas, i.dados_sensiveis, i.risco, i.prazo_anpd::text, i.comunicar, i.justificativa_nao_comunicar, i.comunicado_anpd_em::text, i.comunicado_titulares_em::text, i.medidas, i.causa, i.status, i.historico, i.encerrado_em::text FROM privacy_incidents i LEFT JOIN units u ON u.id=i.unit_id WHERE i.id=${Number(id)}`;
  if (!i) notFound();
  const pend = i.status !== "ENCERRADO" && (i.comunicar === null || (i.comunicar && !i.comunicado_anpd_em)); const atraso = pend && i.prazo_anpd && i.prazo_anpd < hoje();
  return (
    <Page title={`Incidente ${i.codigo}`} sub={i.titulo} actions={<Btn kind="ghost" href="/governanca/privacidade">Privacidade</Btn>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      {pend && <Card className={`mb-4 ${atraso ? "border-2 border-erro" : "border-amber-300"}`}><p className="text-sm"><b>{atraso ? "Prazo vencido" : "Prazo"} para comunicar a ANPD e os titulares: {fmtData(i.prazo_anpd)}</b> (contado em dias úteis da ciência em {fmtDataHora(i.ciencia_em)}). Quando houver risco ou dano relevante, a comunicação é obrigatória; quando não houver, registre a justificativa.</p></Card>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <div className="space-y-4">
          <Card title="Registro">
            <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2"><div><dt className="text-xs text-slate-500">Unidade</dt><dd>{i.unidade ?? "Rede"}</dd></div><div><dt className="text-xs text-slate-500">Ocorrido/detectado</dt><dd>{fmtDataHora(i.detectado_em)}</dd></div><div><dt className="text-xs text-slate-500">Ciência</dt><dd>{fmtDataHora(i.ciencia_em)}</dd></div><div><dt className="text-xs text-slate-500">Titulares afetados</dt><dd>{i.titulares_estimados ?? "não estimado"}</dd></div><div className="sm:col-span-2"><dt className="text-xs text-slate-500">Dados</dt><dd>{(i.categorias_dados ?? []).join(", ") || "—"}{i.envolve_criancas ? " · crianças/adolescentes" : ""}{i.dados_sensiveis ? " · dados sensíveis" : ""}</dd></div></dl>
            {i.descricao && <p className="mt-3 whitespace-pre-wrap rounded bg-mist p-3 text-sm">{i.descricao}</p>}
            <div className="mt-3 flex flex-wrap gap-2"><Badge v={i.risco === "RELEVANTE" ? "REJEITADA" : i.risco === "BAIXO" ? "APROVADA" : "PENDENTE"} label={INC_RISCO[i.risco]} /><Badge v={i.status === "ENCERRADO" ? "APROVADA" : "PENDENTE"} label={INC_STATUS[i.status]} />{i.comunicado_anpd_em && <Badge v="APROVADA" label={`ANPD comunicada ${fmtDataHora(i.comunicado_anpd_em)}`} />}{i.comunicado_titulares_em && <Badge v="APROVADA" label={`titulares comunicados ${fmtDataHora(i.comunicado_titulares_em)}`} />}</div>
            {i.comunicar === false && <p className="mt-2 text-sm text-slate-600">Decisão de não comunicar: {i.justificativa_nao_comunicar}</p>}
            {(i.medidas || i.causa) && <div className="mt-3 space-y-1 text-sm">{i.medidas && <p><b>Medidas:</b> {i.medidas}</p>}{i.causa && <p><b>Causa:</b> {i.causa}</p>}</div>}
          </Card>
          <Card title="Histórico (não pode ser apagado)"><ul className="space-y-1 text-sm">{(i.historico ?? []).map((h, k) => <li key={k}><span className="text-xs text-slate-500">{fmtDataHora(h.em)} · {h.por}</span> — {h.texto}</li>)}</ul></Card>
          <Anexos entidade="privacy_incident" id={i.id} voltar={`/governanca/privacidade/incidentes/${i.id}`} titulo="Evidências e comunicações" podeEnviar={i.status !== "ENCERRADO"} />
        </div>
        {i.status !== "ENCERRADO" && <Card title="Avaliar e decidir">
          <form action={atualizarIncidente} className="space-y-2"><input type="hidden" name="id" value={i.id} />
            <Field label="Avaliação de risco"><Select name="risco" defaultValue={i.risco}>{Object.entries(INC_RISCO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="Comunicação à ANPD e aos titulares"><Select name="comunicar" defaultValue={i.comunicar === null ? "" : i.comunicar ? "1" : "0"}><option value="">Ainda não decidido</option><option value="1">Comunicar</option><option value="0">Não comunicar (sem risco relevante)</option></Select></Field>
            <Field label="Justificativa (se não comunicar)"><Textarea name="justificativa" defaultValue={i.justificativa_nao_comunicar ?? ""} className="min-h-[50px]" /></Field>
            <div className="grid grid-cols-2 gap-2"><Field label="ANPD comunicada em"><Input name="comunicadoAnpdEm" type="datetime-local" /></Field><Field label="Titulares comunicados em"><Input name="comunicadoTitularesEm" type="datetime-local" /></Field></div>
            <Field label="Medidas tomadas"><Textarea name="medidas" defaultValue={i.medidas ?? ""} className="min-h-[50px]" /></Field><Field label="Causa"><Textarea name="causa" defaultValue={i.causa ?? ""} className="min-h-[50px]" /></Field>
            <Field label="Situação"><Select name="status" defaultValue={i.status}>{Object.entries(INC_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="Nota"><Input name="nota" /></Field><Btn small>Salvar</Btn></form></Card>}
      </div>
    </Page>
  );
}
