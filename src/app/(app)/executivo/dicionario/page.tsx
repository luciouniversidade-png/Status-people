import { redirect } from "next/navigation";
import Link from "@/components/Link";
import { requireGestao } from "@/lib/auth";
import { Page, Card, Btn } from "@/components/ui";
import { PrintButton } from "@/components/PrintButton";
import { kpisVisiveis, vePainelExecutivo, estadoBase } from "@/lib/kpi";
import { AREAS, ORDEM_AREAS, SENTIDO_LABEL, AGREGACAO_LABEL, HISTORICO_LABEL, CATALOGO_VERSAO, nomeKpi } from "@/lib/kpi-catalogo";
import { getSettings, fmtData } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** Dicionário de indicadores: o que cada número significa, como é calculado e de onde vem — para a gestão e para a auditoria. */
export default async function Dicionario() {
  const s = await requireGestao(); if (!vePainelExecutivo(s)) redirect("/");
  const [defs, cfg, est] = await Promise.all([kpisVisiveis(s), getSettings(), estadoBase()]);
  const ano = cfg.matriculas.anoLetivo as number;
  return (
    <Page title="Dicionário de indicadores" sub={`${defs.length} indicadores visíveis para o seu perfil · catálogo ${CATALOGO_VERSAO}${est?.completoEm ? ` · base reconstruída em ${fmtData(est.completoEm.slice(0, 10))}` : ""}`} actions={<div className="flex gap-2 print:hidden"><Btn kind="ghost" href="/executivo">Painel Executivo</Btn><PrintButton /></div>}>
      <Card className="mb-4"><ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
        <li><b>Mês sem medição fica em branco</b> — nunca vira zero. Zero aparece só quando o sistema já registrava aquele assunto e, no mês, não houve nenhum caso.</li>
        <li><b>Razões</b> (percentuais, médias) da rede e do acumulado no ano são recalculadas pelas somas dos numeradores e denominadores, não pela média das unidades.</li>
        <li><b>Reconstruídos</b> são recalculados dos registros datados (24 meses). <b>Fotos diárias</b> guardam o valor do dia: o histórico começa quando a base é ligada.</li>
        <li>Pesquisas com poucas respostas numa unidade não mostram resultado (anonimato). Nenhum dado pessoal entra nos painéis: só números agregados.</li>
      </ul></Card>
      {ORDEM_AREAS.filter(a => defs.some(k => k.area === a)).map(a => (
        <Card key={a} title={AREAS[a].nome} className="mb-4 break-inside-avoid">
          <dl className="divide-y divide-line">
            {defs.filter(k => k.area === a).map(k => (
              <div key={k.chave} className="py-3 first:pt-0 last:pb-0">
                <dt className="flex flex-wrap items-baseline justify-between gap-2"><Link href={`/executivo/indicador/${encodeURIComponent(k.chave)}`} className="font-semibold text-acao hover:underline">{nomeKpi(k, ano)}</Link><span className="text-[11px] text-slate-500">{k.chave}</span></dt>
                <dd className="mt-1 space-y-0.5 text-sm text-slate-700">
                  <div><span className="text-slate-500">Fórmula: </span>{k.formula}</div>
                  <div><span className="text-slate-500">Fonte: </span>{k.fonte}</div>
                  <div className="text-xs text-slate-500">{SENTIDO_LABEL[k.sentido]} · {AGREGACAO_LABEL[k.agregacao]} · {HISTORICO_LABEL[k.historico]}{k.restricao === "SALARIAL" ? " · visível só para Direção, RH e Financeiro" : k.restricao === "PRIVACIDADE" ? " · visível só para quem trata privacidade" : ""}{k.metaPadrao ? ` · meta padrão ${k.metaPadrao(cfg)}${k.unidade === "%" ? "%" : ""}` : k.metaOrcamento ? " · sem meta cadastrada, compara com o orçamento" : ""}</div>
                  {k.obs && <div className="text-xs text-slate-500">{k.obs}</div>}
                </dd>
              </div>
            ))}
          </dl>
        </Card>
      ))}
    </Page>
  );
}
