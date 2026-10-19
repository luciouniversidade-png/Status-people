import { redirect } from "next/navigation";
import Link from "@/components/Link";
import { requireSession, scopeUnit } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Table, Td, Flash, Field, Input, Select, Btn, Badge } from "@/components/ui";
import { getSettings, fmtDataHora } from "@/lib/utils";
import { preencher } from "@/lib/comunicacao";
import { destinatariosCampanha, PUBLICO_CAMPANHA, CAMPANHA_STATUS, AUTORES_MASSA_LISTA, emHorarioComercial, type FiltroCampanha } from "@/lib/massa";
import { criarCampanha } from "../massa-actions";

export const dynamic = "force-dynamic";

/** CRQ-COM-V3-01 · Envio em massa: recorte → prévia (quantos, quem fica de fora, como fica a mensagem) → aprovação de outra pessoa → disparo em horário comercial. */
export default async function EnvioMassa({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const sp = await searchParams; const cfg = await getSettings();
  if (!AUTORES_MASSA_LISTA.includes(s.role)) redirect("/comunicacao/comunicados");
  const u = scopeUnit(s);
  const [modelos, units, grades, classes, campanhas] = await Promise.all([
    sql<{ id: number; titulo: string; canal: string; categoria: string; texto: string }[]>`SELECT id, titulo, canal, categoria, texto FROM message_templates WHERE ativo ORDER BY categoria, titulo`,
    sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ${u === null ? sql`` : sql`WHERE id=${u}`} ORDER BY nome`,
    sql<{ id: number; nome: string }[]>`SELECT id, nome FROM grades ORDER BY ordem, nome`,
    sql<{ id: number; nome: string; unidade: string }[]>`SELECT c.id, c.nome, un.nome AS unidade FROM classes c JOIN units un ON un.id=c.unit_id WHERE c.ano=(SELECT max(ano) FROM classes) ${u === null ? sql`` : sql`AND c.unit_id=${u}`} ORDER BY un.nome, c.nome`,
    sql<{ id: number; titulo: string; canal: string; publico: string; total: number; status: string; autor_nome: string | null; created_at: string; disparo_em: string | null }[]>`SELECT id, titulo, canal, publico, total, status, autor_nome, created_at::text, to_char((disparo_em AT TIME ZONE 'UTC') AT TIME ZONE 'America/Campo_Grande', 'DD/MM HH24:MI') AS disparo_em FROM message_campaigns ORDER BY created_at DESC LIMIT 30`,
  ]);
  const canal = sp.canal === "EMAIL" ? "EMAIL" : "WHATSAPP"; const publico = sp.publico === "COLABORADORES" ? "COLABORADORES" : "FAMILIAS";
  const modelo = modelos.find(m => m.id === Number(sp.modelo) && m.canal === canal) ?? null;
  const filtro: FiltroCampanha = { unitId: u ?? (Number(sp.unidade) || null), gradeId: Number(sp.serie) || null, classId: Number(sp.turma) || null, inadimplentes: sp.inadimplentes === "1" };
  const previa = sp.ver ? await destinatariosCampanha(publico, canal, filtro) : null;
  const h = cfg.comunicacao.horarioComercial as { inicio: string; fim: string; dias: number[] };
  return (
    <Page title="Envio em massa" sub={`Mensagem para uma lista de famílias ou da equipe: sempre com modelo aprovado, aprovação de outra pessoa (Direção ou RH) e disparo só em horário comercial (${h.inicio}–${h.fim}). ${emHorarioComercial(cfg) ? "Agora é horário comercial." : "Agora está fora do horário comercial: o que for aprovado fica agendado."}`}
      actions={<><Btn kind="ghost" href="/comunicacao/modelos">Modelos</Btn><Btn kind="ghost" href="/comunicacao/mensagens">Histórico de mensagens</Btn></>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <div className="min-w-0 space-y-4">
          <Card title="1. Recorte e prévia">
            <form className="grid grid-cols-1 gap-2 sm:grid-cols-2"><input type="hidden" name="ver" value="1" />
              <Field label="Canal"><Select name="canal" defaultValue={canal}><option value="WHATSAPP">WhatsApp</option><option value="EMAIL">E-mail</option></Select></Field>
              <Field label="Público"><Select name="publico" defaultValue={publico}>{Object.entries(PUBLICO_CAMPANHA).filter(([k]) => k === "FAMILIAS" || ["DIRECAO", "RH", "DIRETOR_UNIDADE"].includes(s.role)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
              <Field label="Modelo (aprovado)"><Select name="modelo" defaultValue={modelo?.id ?? ""}><option value="">Escolha</option>{modelos.filter(m => m.canal === canal).map(m => <option key={m.id} value={m.id}>{m.categoria} · {m.titulo}</option>)}</Select></Field>
              {u === null && <Field label="Unidade"><Select name="unidade" defaultValue={sp.unidade ?? ""}><option value="">Todas</option>{units.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field>}
              {publico === "FAMILIAS" && <><Field label="Série"><Select name="serie" defaultValue={sp.serie ?? ""}><option value="">Todas</option>{grades.map(g => <option key={g.id} value={g.id}>{g.nome}</option>)}</Select></Field>
                <Field label="Turma"><Select name="turma" defaultValue={sp.turma ?? ""}><option value="">Todas</option>{classes.map(c => <option key={c.id} value={c.id}>{c.unidade} · {c.nome}</option>)}</Select></Field>
                {["DIRECAO", "FINANCEIRO"].includes(s.role) && <label className="flex items-center gap-2 text-xs sm:col-span-2"><input type="checkbox" name="inadimplentes" value="1" defaultChecked={filtro.inadimplentes} /> Só famílias marcadas como inadimplentes</label>}</>}
              <div className="sm:col-span-2"><Btn small kind="ghost">Ver prévia</Btn></div>
            </form>
            {previa && <div className="mt-3 space-y-2 border-t border-line pt-3 text-sm">
              <p><b>{previa.validos.length}</b> destinatário(s) com {canal === "EMAIL" ? "e-mail" : "WhatsApp"} válido{previa.semContato ? ` · ${previa.semContato} sem contato ficam de fora` : ""} (um envio por contato: irmãos recebem uma vez).</p>
              {modelo ? previa.validos.slice(0, 3).map((d, i) => <p key={i} className="whitespace-pre-wrap rounded border border-line bg-mist p-2 text-xs">{preencher(modelo.texto, { ...d.vars, nome: d.nome, assinatura: cfg.comunicacao.assinatura as string })}</p>) : <p className="text-xs text-aviso">Escolha o modelo para ver como a mensagem fica.</p>}
            </div>}
          </Card>
          <Card title="Envios em massa">
            <Table head={["Envio", "Canal", "Público", "Destinatários", "Situação", "Criado"]} empty="Nenhum envio em massa ainda.">
              {campanhas.map(c => <tr key={c.id}><Td><Link className="text-acao" href={`/comunicacao/massa/${c.id}`}>{c.titulo}</Link><div className="text-[11px] text-slate-500">{c.autor_nome}</div></Td><Td>{c.canal === "EMAIL" ? "E-mail" : "WhatsApp"}</Td><Td className="text-xs">{PUBLICO_CAMPANHA[c.publico]}</Td><Td className="tabular-nums">{c.total}</Td><Td><Badge v={CAMPANHA_STATUS[c.status]?.[0] ?? "NEUTRO"} label={CAMPANHA_STATUS[c.status]?.[1] ?? c.status} />{c.status === "AGENDADA" && c.disparo_em ? <div className="text-[11px] text-slate-500">dispara {c.disparo_em}</div> : null}</Td><Td className="whitespace-nowrap text-xs">{fmtDataHora(c.created_at)}</Td></tr>)}
            </Table>
          </Card>
        </div>
        <Card title="2. Enviar para aprovação">
          {!previa || !modelo ? <p className="text-sm text-slate-500">Faça a prévia com um modelo escolhido.</p> : previa.validos.length === 0 ? <p className="text-sm text-aviso">Nenhum destinatário com contato válido.</p> :
            <form action={criarCampanha} className="space-y-2"><input type="hidden" name="canal" value={canal} /><input type="hidden" name="publico" value={publico} /><input type="hidden" name="templateId" value={modelo.id} />
              {filtro.unitId && <input type="hidden" name="unitId" value={filtro.unitId} />}{filtro.gradeId && <input type="hidden" name="gradeId" value={filtro.gradeId} />}{filtro.classId && <input type="hidden" name="classId" value={filtro.classId} />}{filtro.inadimplentes && <input type="hidden" name="inadimplentes" value="1" />}
              <Field label="Título do envio"><Input name="titulo" defaultValue={modelo.titulo} required /></Field>
              {canal === "EMAIL" && <Field label="Assunto do e-mail"><Input name="assunto" defaultValue={modelo.titulo} /></Field>}
              <p className="text-xs text-slate-600">{previa.validos.length} destinatário(s) · modelo “{modelo.titulo}”. Outra pessoa (Direção ou RH) aprova; o disparo respeita o horário comercial. Com a API do WhatsApp não configurada, as mensagens entram no histórico com o link de envio.</p>
              <Btn small>Enviar para aprovação</Btn></form>}
        </Card>
      </div>
    </Page>
  );
}
