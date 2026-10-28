import { redirect } from "next/navigation";
import Link from "@/components/Link";
import { requireSession, can } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Flash, Stat, Table, Td, Badge, Field, Input, Select, Textarea, Btn } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { BarrasH } from "@/components/graficos";
import { getSettings, hoje, fmtData } from "@/lib/utils";
import { fmtReais, fmtPct } from "@/lib/formato";
import { pessoasIgualdade, compararSalarios, composicaoSexo, prazoSemestre, inicioJanela, type PessoaIg } from "@/lib/igualdade";
import { salvarTransparencia } from "./actions";

import { FAMILIAS } from "@/lib/avaliacao";

export const dynamic = "force-dynamic";
const COR_F = "#8e5bb5", COR_M = "#2a9d8f", COR_NI = "#cbd5e1";
const pctTxt = (v: number | null) => (v === null ? "—" : `${v.toFixed(1).replace(".", ",")}%`);

/** v30 · Igualdade salarial e diversidade (Lei 14.611/2023): composição por sexo, liderança, remuneração no mesmo cargo e o relatório semestral. */
export default async function Igualdade({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); if (!can.verSalario(s)) redirect("/analytics"); const sp = await searchParams;
  const cfg = await getSettings(); const h = hoje(); const ano = Number(h.slice(0, 4)); const ig = cfg.igualdade;
  const porNivel = sp.nivel !== "0";
  const [ps, regs, empresas] = await Promise.all([
    pessoasIgualdade(),
    sql<{ company_id: number; ano: number; semestre: number; empregados: number | null; publicado_em: string | null; onde: string | null; link: string | null; diferenca_pct: number | null; plano_acao: string | null; plano_prazo: string | null; registrado_por_nome: string | null }[]>`SELECT company_id, ano, semestre, empregados, publicado_em::text, onde, link, diferenca_pct::float, plano_acao, plano_prazo::text, registrado_por_nome FROM pay_transparency_reports WHERE ano >= ${ano - 1} ORDER BY ano DESC, semestre DESC`,
    sql<{ id: number; nome: string; cnpj: string | null }[]>`SELECT id, nome, cnpj FROM companies ORDER BY nome`,
  ]);
  const comp = compararSalarios(ps, Math.max(2, Number(ig.grupoMinimo) || 3), Number(ig.limiteDiferencaPct) || 5, h, porNivel);
  const sexo = composicaoSexo(ps, ig.familiasLideranca as string[]);
  const porUnidade = [...new Set(ps.map(p => p.unidade))].sort().map(u => ({ u, c: composicaoSexo(ps.filter(p => p.unidade === u), ig.familiasLideranca as string[]) }));
  const porEmpresa = empresas.map(e => ({ e, c: composicaoSexo(ps.filter(p => p.companyId === e.id), ig.familiasLideranca as string[]), clt: ps.filter(p => p.companyId === e.id && ["CLT", "HORISTA", "TEMPORARIO"].includes(p.vinculo)).length }));
  const acima = comp.grupos.filter(g => g.acimaLimite); const pequenos = comp.grupos.filter(g => !g.comparavel);
  const segs = (c: { F: number; M: number; NI: number }) => [{ valor: c.F, cor: COR_F, rotulo: "Mulheres" }, { valor: c.M, cor: COR_M, rotulo: "Homens" }, ...(c.NI ? [{ valor: c.NI, cor: COR_NI, rotulo: "Não informado" }] : [])];
  const semSexo = ps.filter((p: PessoaIg) => !p.sexo).length;
  return (
    <Page title="Igualdade salarial e diversidade" sub={<>Mulheres e homens no quadro, na liderança e na remuneração do <b>mesmo cargo</b> (Lei 14.611/2023 · CLT art. 461). Só RH e Direção. <Link className="text-acao" href="/analytics">People Analytics</Link></>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      {semSexo > 0 && <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-aviso">{semSexo} pessoa(s) sem o sexo informado na ficha — ficam fora das comparações. Complete em Colaboradores → Editar (campo do eSocial).</div>}
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="Mulheres no quadro" value={pctTxt(sexo.pctMulheres)} hint={`${sexo.geral.F} mulheres · ${sexo.geral.M} homens`} />
        <Stat label="Mulheres na liderança" value={pctTxt(sexo.pctMulheresLideranca)} hint={`${sexo.lideranca.F} de ${sexo.lideranca.F + sexo.lideranca.M} (gestão, coordenação e quem tem equipe)`} />
        <Stat label="No mesmo cargo: mulheres recebem" value={comp.ajustada === null ? "—" : `${(comp.ajustada * 100).toFixed(1).replace(".", ",")}%`} hint={comp.ajustada === null ? `nenhum cargo com ${ig.grupoMinimo}+ mulheres e ${ig.grupoMinimo}+ homens` : `do que recebem os homens · ${comp.comparados} grupo(s), ${comp.pessoasComparadas} pessoas`} />
        <Stat label="Diferença bruta (todos os cargos)" value={comp.bruta === null ? "—" : `${(comp.bruta * 100).toFixed(1).replace(".", ",")}%`} hint="salário médio das mulheres ÷ dos homens — reflete a composição dos cargos" />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:items-start">
        <Card title="Composição por unidade">
          <BarrasH rotulo="Pessoas por sexo em cada unidade" formato={v => String(v)} itens={porUnidade.map(({ u, c }) => ({ rotulo: u, valor: c.geral.total, segmentos: segs(c.geral), texto: `${pctTxt(c.pctMulheres)} mulheres` }))} />
          <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-600"><span><i className="mr-1 inline-block h-2 w-3 rounded-sm align-middle" style={{ background: COR_F }} />Mulheres</span><span><i className="mr-1 inline-block h-2 w-3 rounded-sm align-middle" style={{ background: COR_M }} />Homens</span>{semSexo > 0 && <span><i className="mr-1 inline-block h-2 w-3 rounded-sm align-middle" style={{ background: COR_NI }} />Não informado</span>}</div>
        </Card>
        <Card title="Liderança por unidade">
          <BarrasH rotulo="Liderança por sexo em cada unidade" formato={v => String(v)} itens={porUnidade.filter(x => x.c.lideranca.total).map(({ u, c }) => ({ rotulo: u, valor: c.lideranca.total, segmentos: segs(c.lideranca), texto: `${pctTxt(c.pctMulheresLideranca)} mulheres` }))} />
          <p className="mt-2 text-[11px] text-slate-500">Liderança = cargos das famílias {(ig.familiasLideranca as string[]).map(f => FAMILIAS[f] ?? f).join(" e ")} ou quem tem equipe direta no organograma.</p>
        </Card>
      </div>

      <Card className="mt-4" title={`Remuneração no mesmo cargo${porNivel ? " e nível" : ""} — ${comp.comparados} grupo(s) comparável(is)${acima.length ? `, ${acima.length} acima de ${ig.limiteDiferencaPct}%` : ""}`} actions={<Link className="text-xs text-acao" href={porNivel ? "/analytics/igualdade?nivel=0" : "/analytics/igualdade"}>{porNivel ? "comparar só por cargo" : "comparar por cargo e nível"}</Link>}>
        <Table head={["Cargo", "Mulheres", "Homens", "Média das mulheres", "Média dos homens", "Diferença", "Tempo médio de casa (M · H)"]} empty="Nenhum cargo com salário cadastrado.">
          {comp.grupos.filter(g => g.comparavel).map(g => <tr key={g.chave}><Td><div className="font-medium text-ink">{g.cargo}{g.nivel ? <span className="text-slate-500"> · {g.nivel}</span> : null}</div><div className="text-[11px] text-slate-500">{g.base === "HORA" ? "valor da hora contratada" : "salário do mês"}</div></Td>
            <Td className="tabular-nums">{g.nF}</Td><Td className="tabular-nums">{g.nM}</Td>
            <Td className="tabular-nums">{g.base === "HORA" ? `${fmtReais(g.mediaF)}/h` : fmtReais(g.mediaF)}</Td><Td className="tabular-nums">{g.base === "HORA" ? `${fmtReais(g.mediaM)}/h` : fmtReais(g.mediaM)}</Td>
            <Td>{g.diferencaPct === null ? "—" : <span className={g.acimaLimite ? "font-semibold text-erro" : "text-ok"}>{g.diferencaPct > 0 ? `mulheres ${fmtPct(g.diferencaPct)} abaixo` : g.diferencaPct < 0 ? `mulheres ${fmtPct(-g.diferencaPct)} acima` : "igual"}</span>}{g.acimaLimite && <div><Badge v="PENDENTE" label="explicar por critério objetivo" /></div>}</Td>
            <Td className="text-xs tabular-nums">{g.casaF === null ? "—" : `${g.casaF.toFixed(1).replace(".", ",")} · ${g.casaM!.toFixed(1).replace(".", ",")} anos`}</Td></tr>)}
        </Table>
        {pequenos.length > 0 && <details className="mt-3"><summary className="cursor-pointer text-xs text-acao">{pequenos.length} grupo(s) pequeno(s) — menos de {ig.grupoMinimo} mulheres ou {ig.grupoMinimo} homens: não comparados</summary><ul className="mt-2 grid grid-cols-1 gap-1 text-xs text-slate-600 sm:grid-cols-2">{pequenos.map(g => <li key={g.chave}>{g.cargo}{g.nivel ? ` · ${g.nivel}` : ""}: {g.nF} mulher(es) · {g.nM} homem(ns)</li>)}</ul></details>}
        <p className="mt-3 text-[11px] text-slate-500">A diferença no mesmo cargo e nível só se justifica por critério objetivo (CLT art. 461): tempo de serviço maior que 4 anos e na função maior que 2 anos, produtividade e perfeição técnica, ou plano de cargos e salários. Sem justificativa, vale o plano de ação e a correção. Grupo mínimo e limite em Configurações → Igualdade salarial. Estágio (bolsa) e PJ ficam fora.</p>
      </Card>

      <Card className="mt-4" title="Relatório de transparência salarial (março e setembro)" actions={<Modal label="Registrar publicação" title="Registrar o relatório semestral"><FormTransp empresas={empresas} ano={ano} /></Modal>}>
        <div id="transparencia" />
        <Table head={["Empresa (CNPJ)", "Empregados", "Obrigatório", `1º semestre ${ano}`, `2º semestre ${ano}`]}>
          {porEmpresa.map(({ e, clt }) => { const obrig = clt >= Number(ig.empregadosObrigatorio); const st = (sem: number) => { const r = regs.find(x => x.company_id === e.id && x.ano === ano && x.semestre === sem); const aberta = h >= inicioJanela(ano, sem); const prazo = prazoSemestre(ano, sem);
            return r?.publicado_em ? <div><Badge v="APROVADA" label={`publicado ${fmtData(r.publicado_em)}`} /><div className="text-[11px] text-slate-500 [overflow-wrap:anywhere]">{r.onde}{r.link ? <> · <a className="text-acao" href={r.link} target="_blank" rel="noreferrer">link</a></> : null}{r.diferenca_pct !== null ? ` · diferença ${fmtPct(r.diferenca_pct)}` : ""}{r.plano_acao ? " · com plano de ação" : ""}</div></div>
              : !obrig ? <span className="text-xs text-slate-500">não se aplica</span> : !aberta ? <span className="text-xs text-slate-500">abre em {fmtData(inicioJanela(ano, sem))}</span> : <Badge v={h > prazo ? "VENCIDO" : "PENDENTE"} label={h > prazo ? `atrasado (prazo ${fmtData(prazo)})` : `publicar até ${fmtData(prazo)}`} />; };
            return <tr key={e.id}><Td><div className="font-medium text-ink">{e.nome}</div><div className="text-[11px] text-slate-500">{e.cnpj ?? "CNPJ não cadastrado"}</div></Td><Td className="tabular-nums">{clt}</Td><Td>{obrig ? <Badge v="EM_ADMISSAO" label="sim (100+)" /> : <span className="text-xs text-slate-500">não ({clt} &lt; {ig.empregadosObrigatorio})</span>}</Td><Td>{st(1)}</Td><Td>{st(2)}</Td></tr>; })}
        </Table>
        <p className="mt-2 text-[11px] text-slate-500">O Ministério do Trabalho gera o relatório com os dados do eSocial; a empresa com 100 ou mais empregados publica no site, nas redes ou em local visível, em março e setembro, e mantém o plano de ação quando há diferença (Decreto 11.795/2023). O ONE lembra o prazo em Minhas pendências e guarda onde foi publicado.</p>
      </Card>
    </Page>
  );
}

function FormTransp({ empresas, ano }: { empresas: { id: number; nome: string }[]; ano: number }) {
  return <form action={salvarTransparencia} className="space-y-2">
    <div className="grid grid-cols-3 gap-2"><Field label="Empresa"><Select name="companyId" required defaultValue="">{[<option key="" value="">Escolha</option>, ...empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)]}</Select></Field><Field label="Ano"><Input name="ano" type="number" defaultValue={ano} required /></Field><Field label="Semestre"><Select name="semestre" defaultValue="1"><option value="1">1º (março)</option><option value="2">2º (setembro)</option></Select></Field></div>
    <div className="grid grid-cols-2 gap-2"><Field label="Publicado em"><Input name="publicadoEm" type="date" /></Field><Field label="Onde"><Input name="onde" placeholder="Site, redes sociais, mural…" /></Field></div>
    <Field label="Link (opcional)"><Input name="link" placeholder="https://" /></Field>
    <Field label="Diferença apontada no relatório (%)" hint="Positiva = mulheres recebem menos."><Input name="diferencaPct" inputMode="decimal" /></Field>
    <Field label="Plano de ação (obrigatório quando há diferença)"><Textarea name="planoAcao" placeholder="Medidas, metas e prazos para mitigar a diferença" /></Field>
    <div className="grid grid-cols-2 gap-2"><Field label="Prazo do plano"><Input name="planoPrazo" type="date" /></Field><Field label="Observação"><Input name="obs" /></Field></div>
    <Btn small>Registrar</Btn></form>;
}

