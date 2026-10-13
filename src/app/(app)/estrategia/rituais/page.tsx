import Link from "@/components/Link";
import { Modal } from "@/components/Modal";
import { requireGestao, scopeUnit } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Table, Td, Badge, Flash, Field, Input, Select, Btn, Stat } from "@/components/ui";
import { fmtData, getSettings, hoje } from "@/lib/utils";
import { resumoRituais } from "@/lib/metricas-extra";
import { RITUAL_TIPO, aderenciaRitual, somaDias, type TipoRitual } from "@/lib/gestao-calc";
import { criarRitualDeModelo } from "../gestao-actions";
import { SubNav, corFaixa } from "../_ui";
import { FormRitual, opcoesRitual } from "./_form";

export const dynamic = "force-dynamic";

export default async function Rituais({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireGestao(); const sp = await searchParams; const u = scopeUnit(s); const cfg = await getSettings(); const h = hoje(); const faixas = cfg.estrategia.faixasSaude as [number, number];
  const gestao = ["DIRECAO", "RH", "DIRETOR_UNIDADE", "GESTOR", "FINANCEIRO", "OPERACOES", "COMERCIAL"].includes(s.role);
  const [r, opcoes, recentes] = await Promise.all([resumoRituais(u), gestao ? opcoesRitual(s) : null,
    sql<{ id: number; data: string; status: string; ritual: string; ritual_id: number; ata: boolean; decisoes: number; encaminhamentos: number }[]>`SELECT m.id, m.data::text, m.status, r.nome AS ritual, r.id AS ritual_id, coalesce(trim(m.ata),'') <> '' AS ata, (SELECT count(*) FROM decisions d WHERE d.ritual_meeting_id=m.id)::int AS decisoes, (SELECT count(*) FROM action_plans a WHERE a.ritual_meeting_id=m.id)::int AS encaminhamentos FROM ritual_meetings m JOIN rituals r ON r.id=m.ritual_id WHERE 1=1 ${u === null ? sql`` : sql`AND (r.unit_id IS NULL OR r.unit_id=${u})`} ORDER BY m.data DESC, m.id DESC LIMIT 12`]);
  const lista = r.lista.filter(x => sp.inativos === "1" || x.ativo);
  const ads = r.lista.filter(x => x.ativo).map(x => aderenciaRitual(x.realizadas_janela, x.tipo, x.criado_dias).pct).filter((p): p is number => p !== null); const adMedia = ads.length ? ads.reduce((a, p) => a + p, 0) / ads.length : null;
  const agenda = r.lista.filter(x => x.ativo && x.proxima_data && x.proxima_data <= somaDias(h, 14)).sort((a, b) => a.proxima_data!.localeCompare(b.proxima_data!));
  const modelos = cfg.estrategia.modelosRituais as { chave: string; nome: string; tipo: TipoRitual; duracaoMin: number; finalidade: string }[];
  return (
    <Page title="Rituais de gestão" sub="As reuniões que fazem a estratégia acontecer: cadência, dono, participantes, pauta automática, ata, decisões e encaminhamentos com responsável e prazo. Atrasado = passou da data prevista além da tolerância."
      actions={opcoes ? <Modal label="Novo ritual" kind="primary" small={false} title="Novo ritual de gestão"><FormRitual o={opcoes} donoPadrao={s.id} /></Modal> : undefined}>
      <SubNav atual="rituais" />
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <Stat label="Rituais ativos" value={r.ativos} />
        <Stat label="Em dia" value={r.ativos ? <span className={corFaixa(r.pct, faixas)}>{r.emDia}/{r.ativos}</span> : "—"} hint={`tolerância de ${cfg.estrategia.toleranciaRitualDias} dia(s)`} />
        <Stat label="Atrasados" value={<span className={r.atrasados.length ? "text-erro" : ""}>{r.atrasados.length}</span>} />
        <Stat label="Atas pendentes" value={<span className={r.atasPendentes ? "text-aviso" : ""}>{r.atasPendentes}</span>} hint={`reunião sem ata há mais de ${cfg.estrategia.ataPendenteDias} dia(s)`} />
        <Stat label="Aderência média" value={adMedia === null ? "—" : <span className={corFaixa(adMedia, faixas)}>{Math.round(adMedia)}%</span>} hint="realizadas ÷ esperadas (90 dias)" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="space-y-4">
          <Card title="Rituais" actions={<Link className="text-xs text-acao" href={sp.inativos === "1" ? "/estrategia/rituais" : "/estrategia/rituais?inativos=1"}>{sp.inativos === "1" ? "só ativos" : "incluir inativos"}</Link>}>
            <Table head={["Ritual", "Cadência", "Dono", "Próxima reunião", "Última", "Aderência", "Atas"]} empty="Nenhum ritual. Comece por um modelo ao lado.">{lista.map(x => { const ad = aderenciaRitual(x.realizadas_janela, x.tipo, x.criado_dias); return <tr key={x.id} className={x.ativo ? "" : "opacity-60"}>
              <Td><Link className="font-medium text-acao" href={`/estrategia/rituais/${x.id}`}>{x.nome}</Link><div className="text-xs text-slate-500">{x.unidade ?? "rede"}{x.duracao_min ? ` · ${x.duracao_min} min` : ""}{(x.participantes ?? []).length ? ` · ${(x.participantes ?? []).length} participante(s)` : ""}{x.ativo ? "" : " · inativo"}</div></Td>
              <Td className="text-xs">{RITUAL_TIPO[x.tipo]}</Td><Td className="text-xs">{x.dono ?? "—"}</Td>
              <Td className="whitespace-nowrap text-xs">{fmtData(x.proxima_data) || "—"} {x.ativo && x.situacao === "ATRASADO" ? <Badge v="REJEITADA" label="atrasado" /> : null}</Td>
              <Td className="whitespace-nowrap text-xs">{fmtData(x.ultima) || "nunca"}</Td>
              <Td className={`text-xs tabular-nums ${corFaixa(ad.pct, faixas)}`}>{ad.pct === null ? "sem base" : `${ad.pct}%`}<div className="text-[11px] text-slate-500">{x.realizadas_janela}/{ad.esperadas}</div></Td>
              <Td className={`text-xs ${x.ata_pendente ? "text-aviso" : "text-slate-500"}`}>{x.ata_pendente ? `${x.ata_pendente} pendente(s)` : "em dia"}</Td>
            </tr>; })}</Table>
          </Card>
          <Card title="Reuniões recentes"><Table head={["Data", "Ritual", "Situação", "Ata", "Decisões", "Encaminhamentos"]} empty="Nenhuma reunião registrada.">{recentes.map(m => <tr key={m.id}><Td className="whitespace-nowrap"><Link className="text-acao" href={`/estrategia/reunioes/${m.id}`}>{fmtData(m.data)}</Link></Td><Td className="text-xs">{m.ritual}</Td><Td><Badge v={m.status === "REALIZADA" ? "APROVADA" : "CANCELADA"} label={m.status === "REALIZADA" ? "Realizada" : "Cancelada"} /></Td><Td className={`text-xs ${m.status === "REALIZADA" && !m.ata ? "text-aviso" : ""}`}>{m.status !== "REALIZADA" ? "—" : m.ata ? "registrada" : "pendente"}</Td><Td className="text-xs">{m.decisoes || "—"}</Td><Td className="text-xs">{m.encaminhamentos || "—"}</Td></tr>)}</Table></Card>
        </div>
        <div className="space-y-4">
          <Card title="Próximos 14 dias">{agenda.length === 0 ? <p className="text-sm text-slate-500">Nenhuma reunião prevista.</p> : <ul className="space-y-1.5 text-sm">{agenda.map(x => <li key={x.id} className="flex items-baseline justify-between gap-2"><Link className="text-acao" href={`/estrategia/rituais/${x.id}`}>{x.nome}</Link><span className={`whitespace-nowrap text-xs ${x.situacao === "ATRASADO" ? "text-erro" : x.proxima_data === h ? "font-semibold text-navy" : "text-slate-500"}`}>{x.proxima_data === h ? "hoje" : fmtData(x.proxima_data)}</span></li>)}</ul>}</Card>
          {opcoes && <Card title="Criar a partir de um modelo"><form action={criarRitualDeModelo} className="space-y-2">
            <Field label="Modelo"><Select name="modelo">{modelos.map(m => <option key={m.chave} value={m.chave}>{m.nome} — {RITUAL_TIPO[m.tipo]}, {m.duracaoMin} min</option>)}</Select></Field>
            <div className="grid grid-cols-2 gap-2"><Field label="Abrangência"><Select name="unitId" defaultValue={opcoes.podeRede ? "" : opcoes.units[0]?.id}>{opcoes.podeRede && <option value="">Rede</option>}{opcoes.units.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field><Field label="Primeira reunião"><Input name="proximaData" type="date" defaultValue={h} /></Field></div>
            <Btn small>Criar ritual</Btn><p className="text-xs text-slate-500">Você fica como dono; depois ajuste participantes, pauta e os indicadores revisados.</p></form>
            <ul className="mt-3 space-y-1 border-t border-line pt-2 text-xs text-slate-600">{modelos.map(m => <li key={m.chave}><b>{m.nome}:</b> {m.finalidade}</li>)}</ul></Card>}
        </div>
      </div>
    </Page>
  );
}
