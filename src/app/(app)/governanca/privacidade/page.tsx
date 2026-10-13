import Link from "@/components/Link";
import { requireSession, scopeUnit, can } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Table, Td, Badge, Flash, Field, Btn, Input, Select, Textarea, Stat } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { fmtData, fmtDataHora, hoje, getSettings } from "@/lib/utils";
import { podePrivacidade, coberturaConsentimentos, finalidades, PEDIDO_TIPO, TITULAR_TIPO, PEDIDO_STATUS, PEDIDO_ABERTO, INC_RISCO, INC_STATUS, CATEGORIAS_DADOS } from "@/lib/privacidade";
import { salvarConfigPrivacidade, salvarFinalidade, registrarPedido, registrarIncidente } from "./actions";

export const dynamic = "force-dynamic";

export default async function Privacidade({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const sp = await searchParams; const cfg = await getSettings(); const h = hoje();
  const gestor = await podePrivacidade(s); const escopo = scopeUnit(s);
  if (!gestor) return <Page title="Privacidade (LGPD)"><Card><p className="text-sm text-slate-600">Esta área é da Direção, do RH e do encarregado de dados. As autorizações de imagem de cada aluno ficam na ficha do aluno e em <Link className="text-acao underline" href="/governanca/privacidade/consentimentos">Autorizações</Link>.</p></Card></Page>;
  const [cob, fins, pedidos, incidentes, users, units] = await Promise.all([coberturaConsentimentos(escopo), finalidades(false),
    sql<{ id: number; protocolo: string; tipo: string; titular_nome: string; titular_tipo: string | null; status: string; prazo: string; canal: string; created_at: string }[]>`SELECT id, protocolo, tipo, titular_nome, titular_tipo, status, prazo::text, canal, created_at::text FROM privacy_requests ORDER BY (status = ANY(${PEDIDO_ABERTO})) DESC, prazo, id DESC LIMIT 100`,
    sql<{ id: number; codigo: string; titulo: string; risco: string; status: string; prazo_anpd: string | null; comunicar: boolean | null; comunicado_anpd_em: string | null; ciencia_em: string }[]>`SELECT id, codigo, titulo, risco, status, prazo_anpd::text, comunicar, comunicado_anpd_em::text, ciencia_em::text FROM privacy_incidents ORDER BY (status <> 'ENCERRADO') DESC, ciencia_em DESC LIMIT 100`,
    sql<{ id: number; nome: string }[]>`SELECT id, nome FROM users WHERE ativo AND role <> 'COLABORADOR' ORDER BY nome`, sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ORDER BY nome`]);
  const abertos = pedidos.filter(p => PEDIDO_ABERTO.includes(p.status)); const venc = abertos.filter(p => p.prazo < h).length;
  const incAbertos = incidentes.filter(i => i.status !== "ENCERRADO"); const incAtraso = incAbertos.filter(i => i.prazo_anpd && i.prazo_anpd < h && (i.comunicar === null || (i.comunicar && !i.comunicado_anpd_em))).length;
  const p = cfg.privacidade;
  return (
    <Page title="Privacidade (LGPD)" sub="Autorizações de imagem e divulgação por família, pedidos de titulares com prazo, incidentes com o prazo de comunicação à ANPD e o registro que a lei exige." actions={<><Btn kind="ghost" href="/governanca/privacidade/consentimentos">Autorizações por aluno</Btn><Btn kind="ghost" href="/privacidade">Portal do titular</Btn></>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      {!p.encarregadoNome && <Card className="mb-4 border-amber-300"><p className="text-sm text-aviso">Encarregado (DPO) não informado. A LGPD exige a identidade e o contato do encarregado divulgados publicamente — preencha abaixo; aparece no portal do titular.</p></Card>}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Pedidos em aberto" value={abertos.length} hint={venc ? `${venc} com prazo vencido` : "nenhum vencido"} />
        <Stat label="Incidentes abertos" value={<span className={incAtraso ? "text-erro" : ""}>{incAbertos.length}</span>} hint={incAtraso ? `${incAtraso} com comunicação atrasada` : undefined} />
        <Stat label="Alunos atuais" value={cob.total} />
        <Stat label="Sem nenhuma autorização registrada" value={cob.porFinalidade[0]?.semRegistro ?? "—"} hint={cob.porFinalidade[0] ? `em “${cob.porFinalidade[0].titulo}”` : undefined} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
        <Card title="Autorizações (alunos atuais)" actions={<Link className="text-xs text-acao" href="/governanca/privacidade/consentimentos">ver por aluno</Link>}>
          <Table head={["Finalidade", "Autorizado", "Não autorizado", "Revogado", "Sem registro"]}>{cob.porFinalidade.map(f => <tr key={f.id}><Td>{f.titulo}<div className="text-[11px] text-slate-500">v{f.versao}{f.na_rematricula ? " · no link de rematrícula" : ""}</div></Td><Td className="text-ok">{f.concedido}</Td><Td>{f.negado}</Td><Td className={f.revogado ? "text-aviso" : ""}>{f.revogado}</Td><Td>{f.semRegistro}</Td></tr>)}</Table>
          <p className="mt-2 text-xs text-slate-500">A matrícula e as notas não dependem destas autorizações. Sem registro = não autorizado.</p>
        </Card>
        <Card title="Incidentes de segurança com dados" actions={<Modal label="Registrar incidente" kind="primary" title="Registrar incidente">
          <form action={registrarIncidente} className="space-y-2"><Field label="O que aconteceu (uma linha)"><Input name="titulo" required placeholder="E-mail com lista de alunos enviado a destinatário errado" /></Field><Field label="Descrição"><Textarea name="descricao" /></Field>
            <div className="grid grid-cols-2 gap-2"><Field label="Ciência da escola (data e hora)" hint="O prazo conta daqui"><Input name="cienciaEm" type="datetime-local" required /></Field><Field label="Ocorrido/detectado em"><Input name="detectadoEm" type="datetime-local" /></Field>
              <Field label="Unidade"><Select name="unitId"><option value="">Rede</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field><Field label="Titulares afetados (estimativa)"><Input name="titulares" type="number" min={0} /></Field></div>
            <fieldset className="rounded border border-line p-2"><legend className="px-1 text-xs text-slate-600">Dados envolvidos</legend><div className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">{CATEGORIAS_DADOS.map(c => <label key={c} className="flex items-center gap-2"><input type="checkbox" name="categorias" value={c} />{c}</label>)}</div></fieldset>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="criancas" value="1" /> Envolve dados de crianças ou adolescentes</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="sensiveis" value="1" /> Envolve dados sensíveis (saúde etc.)</label>
            <Field label="Medidas já tomadas"><Textarea name="medidas" className="min-h-[50px]" /></Field><Btn small>Registrar</Btn></form></Modal>}>
          <Table head={["Incidente", "Risco", "Prazo de comunicação", "Situação"]} empty="Nenhum incidente registrado.">{incidentes.map(i => <tr key={i.id}><Td><Link className="text-acao" href={`/governanca/privacidade/incidentes/${i.id}`}>{i.codigo}</Link><div className="text-[11px] text-slate-600">{i.titulo}</div></Td><Td>{INC_RISCO[i.risco]}</Td><Td className={i.status !== "ENCERRADO" && i.prazo_anpd && i.prazo_anpd < h && (i.comunicar === null || (i.comunicar && !i.comunicado_anpd_em)) ? "font-medium text-erro" : ""}>{fmtData(i.prazo_anpd)}{i.comunicado_anpd_em ? <div className="text-[11px] text-ok">ANPD comunicada</div> : i.comunicar === false ? <div className="text-[11px] text-slate-500">não comunicar (justificado)</div> : null}</Td><Td><Badge v={i.status === "ENCERRADO" ? "APROVADA" : "PENDENTE"} label={INC_STATUS[i.status]} /></Td></tr>)}</Table>
          <p className="mt-2 text-xs text-slate-500">Prazo: {p.prazoIncidenteDiasUteis} dias úteis da ciência{p.pequenoPorte ? ", em dobro (agente de pequeno porte)" : ""}. Todo incidente fica registrado por no mínimo 5 anos — o sistema não permite apagar.</p>
        </Card>
        <Card title="Pedidos de titulares" className="lg:col-span-2" actions={<Modal label="Registrar pedido recebido" title="Pedido recebido por e-mail, telefone ou presencialmente">
          <form action={registrarPedido} className="space-y-2"><div className="grid grid-cols-2 gap-2"><Field label="Tipo"><Select name="tipo" required>{Object.entries(PEDIDO_TIPO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field><Field label="Canal"><Select name="canal"><option value="EMAIL">E-mail</option><option value="PRESENCIAL">Presencial</option><option value="TELEFONE">Telefone</option></Select></Field>
            <Field label="Titular"><Input name="titularNome" required /></Field><Field label="Relação"><Select name="titularTipo" required>{Object.entries(TITULAR_TIPO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field><Field label="Aluno relacionado"><Input name="alunoNome" /></Field><Field label="Recebido em"><Input name="recebidoEm" type="date" defaultValue={h} max={h} /></Field><Field label="E-mail"><Input name="email" /></Field><Field label="Telefone"><Input name="telefone" /></Field></div>
            <Field label="Descrição"><Textarea name="descricao" /></Field><Btn small>Registrar</Btn></form></Modal>}>
          <Table head={["Protocolo", "Pedido", "Titular", "Prazo", "Situação"]} empty="Nenhum pedido.">{pedidos.map(x => <tr key={x.id}><Td><Link className="text-acao" href={`/governanca/privacidade/pedidos/${x.id}`}>{x.protocolo}</Link><div className="text-[11px] text-slate-500">{fmtDataHora(x.created_at)} · {x.canal.toLowerCase()}</div></Td><Td>{PEDIDO_TIPO[x.tipo]}</Td><Td>{x.titular_nome}<div className="text-[11px] text-slate-500">{TITULAR_TIPO[x.titular_tipo ?? ""] ?? ""}</div></Td><Td className={PEDIDO_ABERTO.includes(x.status) && x.prazo < h ? "font-medium text-erro" : ""}>{fmtData(x.prazo)}</Td><Td><Badge v={["RESPONDIDA"].includes(x.status) ? "APROVADA" : x.status === "INDEFERIDA" ? "CANCELADA" : "PENDENTE"} label={PEDIDO_STATUS[x.status]} /></Td></tr>)}</Table>
        </Card>
        <Card title="Finalidades de consentimento">
          <ul className="space-y-2 text-sm">{fins.map(f => <li key={f.id} className={`rounded border border-line p-2 ${f.ativo ? "" : "opacity-60"}`}><div className="flex items-center justify-between gap-2"><b>{f.titulo}</b><Modal label="Editar" title={f.titulo}><FormFin f={f} /></Modal></div><div className="text-xs text-slate-600">{f.texto}</div><div className="text-[11px] text-slate-500">{f.codigo} · versão {f.versao}{f.na_rematricula ? " · aparece no link de rematrícula" : ""}{f.ativo ? "" : " · inativa"}</div></li>)}</ul>
          <details className="mt-3"><summary className="cursor-pointer text-xs text-acao">Nova finalidade</summary><div className="mt-2"><FormFin /></div></details>
        </Card>
        {can.configurar(s) && <Card title="Encarregado (DPO) e prazos">
          <form action={salvarConfigPrivacidade} className="space-y-2">
            <div className="grid grid-cols-2 gap-2"><Field label="Nome do encarregado (público)"><Input name="encarregadoNome" defaultValue={p.encarregadoNome} /></Field><Field label="E-mail (público)"><Input name="encarregadoEmail" defaultValue={p.encarregadoEmail} /></Field><Field label="Telefone (público)"><Input name="encarregadoTelefone" defaultValue={p.encarregadoTelefone} /></Field>
              <Field label="Usuário do encarregado no sistema"><Select name="dpoUserId" defaultValue={p.dpoUserId ?? ""}><option value="">—</option>{users.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>
              <Field label="Prazo de resposta (dias)"><Input name="prazoPedidoDias" type="number" min={1} max={15} defaultValue={p.prazoPedidoDias} /></Field><Field label="Prazo do incidente (dias úteis)"><Input name="prazoIncidenteDiasUteis" type="number" min={1} max={3} defaultValue={p.prazoIncidenteDiasUteis} /></Field></div>
            <Field label="Agente de pequeno porte (prazos em dobro)" hint="Atenção: tratar dados de crianças em larga escala pode caracterizar alto risco e afastar o benefício (Res. CD/ANPD nº 2/2022, art. 4º). Confirme com a assessoria jurídica."><Select name="pequenoPorte" defaultValue={p.pequenoPorte ? "1" : "0"}><option value="0">Não</option><option value="1">Sim</option></Select></Field>
            <Btn small>Salvar</Btn></form></Card>}
      </div>
    </Page>
  );
}
function FormFin({ f }: { f?: { id: number; codigo: string; titulo: string; texto: string; ativo: boolean; na_rematricula: boolean; ordem: number } }) {
  return <form action={salvarFinalidade} className="space-y-2">{f && <input type="hidden" name="id" value={f.id} />}{!f && <Field label="Código"><Input name="codigo" placeholder="IMAGEM_EVENTOS" required /></Field>}
    <Field label="Título"><Input name="titulo" required defaultValue={f?.titulo ?? ""} /></Field><Field label="Texto exibido em destaque ao responsável" hint="Mudar o texto cria nova versão"><Textarea name="texto" required defaultValue={f?.texto ?? ""} /></Field>
    <div className="grid grid-cols-3 gap-2"><Field label="Situação"><Select name="ativo" defaultValue={f && !f.ativo ? "0" : "1"}><option value="1">Ativa</option><option value="0">Inativa</option></Select></Field><Field label="No link de rematrícula"><Select name="naRematricula" defaultValue={f && !f.na_rematricula ? "0" : "1"}><option value="1">Sim</option><option value="0">Não</option></Select></Field><Field label="Ordem"><Input name="ordem" type="number" defaultValue={f?.ordem ?? 0} /></Field></div>
    <Btn small>Salvar finalidade</Btn></form>;
}
