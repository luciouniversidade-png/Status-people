import Link from "@/components/Link";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { requireSession } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Table, Td, Badge, Flash, Field, Btn, Input, Textarea, Stat } from "@/components/ui";
import { fmtData, fmtDataHora, hoje, addDays, getSettings } from "@/lib/utils";
import { appUrl } from "@/lib/url";
import { CATEGORIA_ETICA, ETICA_STATUS, RESULTADO_ETICA, ETICA_ABERTO, comite, relatorioEtica, candidatosEtica, impedidosEfetivos } from "@/lib/etica";
import { salvarConfigEtica, publicarRegrasEtica } from "./actions";

export const dynamic = "force-dynamic";

export default async function Etica({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const sp = await searchParams; const cfg = await getSettings(); const h = hoje();
  const c = await comite(); const membro = c.membros.some(m => m.id === s.id); const gestao = ["DIRECAO", "RH"].includes(s.role);
  if (!membro && !gestao) redirect("/governanca");
  const [direcao, rh] = await Promise.all([sql<{ id: number }[]>`SELECT id FROM users WHERE ativo AND role='DIRECAO'`, sql<{ id: number }[]>`SELECT id FROM users WHERE ativo AND role='RH'`]);
  const elegiveis = (imp: number[]) => { let l = c.membros.map(m => m.id).filter(i => !imp.includes(i)); if (!l.length) l = direcao.map(x => x.id).filter(i => !imp.includes(i)); if (!l.length) l = rh.map(x => x.id).filter(i => !imp.includes(i)); return l; };
  const todos = await sql<{ id: number; protocolo: string; categoria: string; status: string; gravidade: number | null; prazo_triagem: string | null; prazo_conclusao: string | null; impedidos: number[] | null; liberados: number[] | null; envolvidos: string | null; relato: string; responsavel: string | null; created_at: string; resultado: string | null; msgs: number }[]>`SELECT r.id, r.protocolo, r.categoria, r.status, r.gravidade, r.prazo_triagem::text, r.prazo_conclusao::text, r.impedidos, r.liberados, r.envolvidos, r.relato, u.nome AS responsavel, r.created_at::text, r.resultado, (SELECT count(*) FROM ethics_messages m WHERE m.report_id=r.id AND m.autor='DENUNCIANTE')::int AS msgs FROM ethics_reports r LEFT JOIN users u ON u.id=r.responsavel_user_id ORDER BY (r.status IN ('RECEBIDA','EM_APURACAO')) DESC, r.created_at DESC LIMIT 300`;
  const cands = await candidatosEtica(); const meus = todos.filter(r => elegiveis(impedidosEfetivos(r, cands)).includes(s.id));
  const rel = await relatorioEtica(addDays(h, -365)); const url = `${await appUrl()}/etica`; const qr = await QRCode.toDataURL(url, { margin: 1, width: 220 });
  const [com] = cfg.etica.comunicadoId ? await sql<{ id: number; ciencias: number; alvo: number }[]>`SELECT a.id, (SELECT count(*) FROM announcement_acks k WHERE k.announcement_id=a.id)::int AS ciencias, (SELECT count(*) FROM users WHERE ativo AND role <> 'LEITURA')::int AS alvo FROM announcements a WHERE a.id=${cfg.etica.comunicadoId}` : [];
  const [cur] = cfg.etica.cursoId ? await sql<{ id: number; titulo: string; ok: number; total: number }[]>`SELECT c.id, c.titulo, (SELECT count(*) FROM training_progress t WHERE t.course_id=c.id AND t.status='CONCLUIDO' AND (t.valido_ate IS NULL OR t.valido_ate >= ${h}))::int AS ok, (SELECT count(*) FROM employees WHERE situacao='ATIVO')::int AS total FROM courses c WHERE c.id=${cfg.etica.cursoId}` : [];
  const users = s.role === "DIRECAO" ? await sql<{ id: number; nome: string; role: string }[]>`SELECT id, nome, role FROM users WHERE ativo AND role NOT IN ('LEITURA','COLABORADOR') ORDER BY nome` : [];
  return (
    <Page title="Canal de ética" sub="Relatos anônimos com protocolo, comitê de triagem que não vê o caso em que é citado, prazos, conversa com quem relatou e relatório sem dados pessoais. Regras divulgadas com ciência e treinamento anual (Lei 14.457/2022).">
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Relatos em 12 meses" value={rel.porCat.reduce((a, x) => a + x.n, 0)} />
        <Stat label="Em aberto" value={todos.filter(r => ETICA_ABERTO.includes(r.status)).length} />
        <Stat label="Prazo vencido" value={<span className={rel.vencidos.triagem + rel.vencidos.conclusao ? "text-erro" : ""}>{rel.vencidos.triagem + rel.vencidos.conclusao}</span>} hint={`${rel.vencidos.triagem} na triagem · ${rel.vencidos.conclusao} na conclusão`} />
        <Stat label="Tempo médio até concluir" value={rel.tempoMedioDias === null ? "—" : `${rel.tempoMedioDias} dias`} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="space-y-4">
          {membro || meus.length ? <Card title={`Relatos para você tratar (${meus.length})`}>
            <Table head={["Protocolo", "Tipo", "Situação", "Prazo", "Responsável"]} empty="Nenhum relato.">{meus.map(r => { const vencido = (r.status === "RECEBIDA" && r.prazo_triagem && r.prazo_triagem < h) || (ETICA_ABERTO.includes(r.status) && r.prazo_conclusao && r.prazo_conclusao < h);
              return <tr key={r.id}><Td><Link className="font-medium text-acao" href={`/governanca/etica/${r.id}`}>{r.protocolo}</Link><div className="text-[11px] text-slate-500">{fmtDataHora(r.created_at)}{r.msgs ? ` · ${r.msgs} msg do relator` : ""}</div></Td><Td>{CATEGORIA_ETICA[r.categoria]}{r.gravidade ? <div className="text-[11px] text-slate-500">gravidade {r.gravidade}</div> : null}</Td><Td><Badge v={ETICA_ABERTO.includes(r.status) ? "PENDENTE" : "APROVADA"} label={ETICA_STATUS[r.status]} />{r.resultado && <div className="text-[11px] text-slate-500">{RESULTADO_ETICA[r.resultado]}</div>}</Td><Td className={vencido ? "font-medium text-erro" : "text-xs"}>{r.status === "RECEBIDA" ? `triagem ${fmtData(r.prazo_triagem)}` : ETICA_ABERTO.includes(r.status) ? `conclusão ${fmtData(r.prazo_conclusao)}` : "—"}</Td><Td className="text-xs">{r.responsavel ?? "—"}</Td></tr>; })}</Table>
            <p className="mt-2 text-xs text-slate-500">Relatos em que você foi citado não aparecem aqui. Cada abertura de relato fica registrada na auditoria.</p>
          </Card> : <Card><p className="text-sm text-slate-600">Você não faz parte do comitê de triagem: vê só o relatório agregado.</p></Card>}
          <Card title="Relatório do canal (12 meses, sem dados pessoais)">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><Table head={["Tipo", "Relatos"]} empty="Nenhum relato.">{rel.porCat.map(x => <tr key={x.categoria}><Td>{CATEGORIA_ETICA[x.categoria]}</Td><Td>{x.n}</Td></tr>)}</Table>
              <Table head={["Situação", "Relatos"]} empty="—">{rel.porStatus.map((x, i) => <tr key={i}><Td>{ETICA_STATUS[x.status]}{x.resultado ? ` · ${RESULTADO_ETICA[x.resultado]}` : ""}</Td><Td>{x.n}</Td></tr>)}</Table></div>
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Divulgação do canal"><img src={qr} alt="QR code do canal de ética" className="mx-auto h-44 w-44" /><p className="mt-2 break-all text-center text-xs"><a className="text-acao underline" href="/etica" target="_blank">{url}</a></p><p className="mt-1 text-center text-[11px] text-slate-500">Imprima o QR code em murais e salas dos professores.</p></Card>
          {gestao && <Card title="Regras e treinamento (Lei 14.457/2022)">
            <div className="space-y-3 text-sm">
              <div>{com ? <p>Regras publicadas: <Link className="text-acao" href={`/comunicacao/comunicados#c${com.id}`}>comunicado</Link> · ciência de {com.ciencias}/{com.alvo}</p> : <form action={publicarRegrasEtica} className="space-y-2"><input type="hidden" name="o" value="comunicado" /><Field label="Regras de conduta (comunicado com ciência)"><Textarea name="texto" className="min-h-[100px]" defaultValue={"Regras de conduta do Colégio Status\n\n1. Não toleramos assédio sexual, assédio moral, discriminação ou qualquer forma de violência — entre colegas, com alunos, famílias ou prestadores.\n2. Quem presenciar ou sofrer essas condutas deve relatar pelo canal de ética, de forma anônima se preferir.\n3. Todo relato é apurado por um comitê de triagem, com sigilo; ninguém citado participa da apuração.\n4. Condutas confirmadas geram medidas disciplinares, de advertência até desligamento, sem prejuízo das medidas legais.\n5. É proibida a retaliação contra quem relata de boa-fé."} /></Field><Btn small kind="ghost">Publicar com ciência obrigatória</Btn></form>}</div>
              <div>{cur ? <p>Treinamento: <Link className="text-acao" href={`/academy/cursos/${cur.id}`}>{cur.titulo}</Link> · em dia {cur.ok}/{cur.total}</p> : <form action={publicarRegrasEtica}><input type="hidden" name="o" value="curso" /><Btn small kind="ghost">Criar treinamento anual no Academy</Btn></form>}</div>
            </div></Card>}
          {s.role === "DIRECAO" && <Card title="Comitê de triagem e prazos">
            <form action={salvarConfigEtica} className="space-y-2">
              <fieldset className="max-h-56 overflow-y-auto rounded border border-line p-2"><legend className="px-1 text-xs text-slate-600">Membros {c.padrao ? "(sem comitê definido: a Direção responde)" : ""}</legend>{users.map(u => <label key={u.id} className="flex items-center gap-2 text-xs"><input type="checkbox" name="comite" value={u.id} defaultChecked={!c.padrao && c.membros.some(m => m.id === u.id)} />{u.nome}</label>)}</fieldset>
              <div className="grid grid-cols-2 gap-2"><Field label="Triagem (dias)"><Input name="prazoTriagemDias" type="number" min={1} max={30} defaultValue={cfg.etica.prazoTriagemDias} /></Field><Field label="Conclusão (dias)"><Input name="prazoConclusaoDias" type="number" min={5} max={180} defaultValue={cfg.etica.prazoConclusaoDias} /></Field></div>
              <Btn small>Salvar</Btn><p className="text-xs text-slate-500">Prefira um comitê de 3 a 5 pessoas de áreas diferentes. Quem for citado num relato é afastado dele automaticamente.</p></form></Card>}
        </div>
      </div>
    </Page>
  );
}
