import Link from "@/components/Link";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession } from "@/lib/auth";
import { Page, Card, Flash, Stat, Badge, Btn, Field, Input } from "@/components/ui";
import { EtapasC13, MiniEtapas } from "@/components/Etapas";
import { podeFolha, podePreparar, pendenciasPacote, ciclosDaCompetencia, competenciaPadrao, timelineFolha, resultadoDoCiclo } from "@/lib/folha";
import { ETAPAS_FOLHA, STATUS_CICLO, estadoEtapas, competenciaAnterior } from "@/lib/folha-calc";
import { gerarPacote } from "./actions";
import { fmtReais, rotuloMes } from "@/lib/formato";
import { fmtDataHora } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** T-055 · Ciclo mensal da folha (Payroll Bridge): o cálculo segue com o contador; o sistema fecha, envia, confere, importa e arquiva. */
export default async function Folha({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); if (!podeFolha(s) && s.role !== "LEITURA") redirect("/"); const sp = await searchParams;
  const mes = sp.mes && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.mes) ? sp.mes : await competenciaPadrao();
  const entidades = await sql<{ id: number; nome: string; cnpj: string | null; pessoas: number }[]>`SELECT c.id, c.nome, c.cnpj, (SELECT count(*) FROM employees e WHERE e.company_id=c.id AND e.situacao <> 'DESLIGADO')::int AS pessoas FROM companies c ORDER BY c.nome`;
  const ciclos = await ciclosDaCompetencia(mes);
  const blocos = await Promise.all(entidades.map(async e => {
    const c = ciclos.find(x => x.company_id === e.id) ?? null; const p = await pendenciasPacote(e.id, mes);
    const lockOk = p.unidades.length > 0 && p.unidades.every(u => u.fechado);
    const total = c && ["ACEITO", "ARQUIVADO", "RESULTADO_IMPORTADO"].includes(c.status) ? (await resultadoDoCiclo(c.id)).total : null;
    return { e, c, p, lockOk, estados: estadoEtapas(c?.status, lockOk), total };
  }));
  const comGente = blocos.filter(b => b.p.pessoas > 0);
  const meses = Array.from({ length: 12 }, (_, i) => { let m = mes; for (let k = 0; k < 11 - i; k++) m = competenciaAnterior(m); return m; });
  const tl = await timelineFolha(meses);
  const realMes = blocos.filter(b => b.c && ["ACEITO", "ARQUIVADO"].includes(b.c.status)).reduce((a, b) => a + (b.total ?? 0), 0);
  const travados = comGente.filter(b => b.p.bloqueios.length && (!b.c || ["ABERTO", "PACOTE_ENVIADO", "DEVOLVIDO"].includes(b.c.status))).length;
  const voltar = `/folha?mes=${mes}`;
  return (
    <Page title="Ciclo mensal da folha" sub={<>Payroll Bridge: o <b>cálculo</b> (holerite, INSS/IRRF/FGTS, eSocial e guias) segue com o contador; aqui a folha vira um ciclo com trava — ponto fechado, pacote, conferência a quatro olhos, resultado aceito (custo REAL) e arquivo.</>}
      actions={<><Btn kind="ghost" href={`/folha/custo?ctx_p=${mes}`}>Custo por dimensão</Btn><Btn kind="ghost" href="/folha/arquivo">Holerites e guias</Btn><Btn kind="ghost" href={`/ponto?mes=${mes}#fechamento`}>Fechamento do ponto</Btn></>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <form className="mb-4 flex flex-wrap items-end gap-2"><Field label="Competência"><Input type="month" name="mes" defaultValue={mes} /></Field><Btn kind="ghost">Ver</Btn></form>
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="Entidades com gente na competência" value={comGente.length} hint={`${entidades.length} cadastradas`} />
        <Stat label="Ciclos completos" value={`${comGente.filter(b => b.c?.status === "ARQUIVADO").length}/${comGente.length}`} hint={rotuloMes(mes)} />
        <Stat label="Pacotes travados" value={<span className={travados ? "text-erro" : "text-ok"}>{travados}</span>} hint="pendências obrigatórias antes do envio" />
        <Stat label="Custo de pessoal REAL" value={realMes ? fmtReais(realMes, true) : "sem fonte"} hint={realMes ? "resultados aceitos da competência" : "nenhum resultado aceito ainda — nunca vira zero"} />
      </div>

      <Card title="Linha do tempo — 12 competências × 5 passos" className="mb-4">
        <div className="overflow-x-auto [-webkit-overflow-scrolling:touch]">
          <table className="w-full min-w-[720px] text-xs">
            <thead><tr><th className="sticky left-0 bg-white px-2 py-1 text-left font-medium text-slate-600">Entidade</th>{meses.map(m => <th key={m} className={`px-1 py-1 text-center font-medium ${m === mes ? "text-navy" : "text-slate-500"}`}><Link href={`/folha?mes=${m}`} className="hover:underline">{rotuloMes(m)}</Link></th>)}</tr></thead>
            <tbody>{comGente.map(b => <tr key={b.e.id} className="border-t border-line"><th scope="row" className="sticky left-0 whitespace-nowrap bg-white px-2 py-1.5 text-left font-medium">{b.e.nome}</th>{meses.map(m => { const c = tl.ciclos.find(x => x.company_id === b.e.id && x.competencia === m); const est = estadoEtapas(c?.status ?? null, !!c && c.status !== "ABERTO"); return <td key={m} className="px-1 py-1.5 text-center"><Link href={`/folha?mes=${m}`}><MiniEtapas estados={est} titulo={`${b.e.nome} · ${rotuloMes(m)}: ${c ? STATUS_CICLO[c.status] ?? c.status : "sem ciclo"}`} /></Link></td>; })}</tr>)}</tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">Cada quadradinho é um passo: ponto · pacote · conferência · resultado · arquivo. Verde concluído, azul em andamento, cinza pendente.</p>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {comGente.length === 0 && <Card><p className="text-sm text-slate-600">Nenhum colaborador está vinculado a um CNPJ empregador. Informe a empresa na ficha de cada pessoa (ou na importação) para o ciclo da folha começar.</p></Card>}
        {comGente.map(b => (
          <Card key={b.e.id} title={<span>{b.e.nome}{b.e.cnpj ? <span className="ml-2 text-xs font-normal text-slate-500">CNPJ {b.e.cnpj}</span> : null}</span>} actions={b.c ? <Link href={`/folha/${b.c.id}`} className="text-xs font-medium text-acao">Abrir o ciclo →</Link> : null}>
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-600"><Badge v={b.c?.status === "ARQUIVADO" ? "APROVADA" : b.p.bloqueios.length ? "PENDENTE" : "ABERTO"} label={b.c ? STATUS_CICLO[b.c.status] ?? b.c.status : "Ciclo não iniciado"} /><span>{b.p.pessoas} pessoa(s) na competência · unidades: {b.p.unidades.map(u => `${u.nome} ${u.fechado ? "✓" : "aberta"}`).join(" · ")}</span></div>
            <EtapasC13 rotulo={`Passos da folha de ${b.e.nome}`} etapas={ETAPAS_FOLHA.map((et, i) => ({ nome: et.curto, estado: b.estados[i], sub: i === 0 ? `${b.p.unidades.filter(u => u.fechado).length}/${b.p.unidades.length} unidades` : i === 1 && b.c?.pacote_em ? fmtDataHora(b.c.pacote_em) : i === 2 && b.c?.conferido_por_nome ? b.c.conferido_por_nome : i === 3 && b.total !== null ? fmtReais(b.total, true) : undefined }))} />
            {(b.p.bloqueios.length > 0 || b.p.avisos.length > 0) && <ul className="mt-3 space-y-1 text-xs">
              {b.p.bloqueios.map((x, i) => <li key={`b${i}`} className="flex gap-1.5 text-erro"><span aria-hidden>⛔</span><Link href={x.href} className="hover:underline">{x.texto}</Link></li>)}
              {b.p.avisos.map((x, i) => <li key={`a${i}`} className="flex gap-1.5 text-aviso"><span aria-hidden>⚠</span><Link href={x.href} className="hover:underline">{x.texto}</Link></li>)}
            </ul>}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {podePreparar(s) && (!b.c || ["ABERTO", "PACOTE_ENVIADO", "DEVOLVIDO"].includes(b.c.status)) && <form action={gerarPacote}><input type="hidden" name="companyId" value={b.e.id} /><input type="hidden" name="mes" value={mes} /><input type="hidden" name="voltar" value={voltar} /><Btn small kind={b.p.bloqueios.length ? "ghost" : "primary"}>{b.c?.pacote_em ? "Gerar o pacote de novo" : "Gerar pacote ao contador"}</Btn></form>}
              {b.c?.pacote_em && <a className="text-xs font-medium text-acao" href={`/api/folha/pacote/${b.c.id}`}>Baixar pacote (CSV)</a>}
              {b.p.bloqueios.length > 0 && <span className="text-[11px] text-slate-500">O pacote não sai com pendência obrigatória — a tentativa fica no histórico.</span>}
            </div>
          </Card>
        ))}
      </div>
      <p className="mt-4 text-xs text-slate-500">Regras: CRQ-FOL-V3-01 (pacote só com o ponto de todas as unidades fechado) · CRQ-FOL-V3-02 (variação acima de 5% explicada antes do aceite; conferência por outra pessoa) · CRQ-FOL-V3-03 (holerites restritos e consulta registrada) · CRQ-FOL-V3-04 (resultado aceito é a única fonte REAL do custo de pessoal). Internalizar o cálculo é decisão da Direção (Cap. 10, Visão Futura).</p>
    </Page>
  );
}
