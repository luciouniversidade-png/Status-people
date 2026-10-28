import { notFound, redirect } from "next/navigation";
import Link from "@/components/Link";
import { sql } from "@/db";
import { requireSession, can, type Role } from "@/lib/auth";
import { Page, Card, Flash, Table, Td, Badge, Btn, Select, Field } from "@/components/ui";
import { ATUACAO, defDoCargo, telasDaAtuacao, aprovaPadrao, lerPadroes, descontoPadrao, rotuloAtuacao, rotuloAlcada, naoRevisado, ALCADAS } from "@/lib/acesso";
import { fmtData } from "@/lib/utils";
import { salvarAcessoCargo, copiarAcessoCargo } from "../../../acesso-actions";
import { criarAcessosAutoatendimento } from "../../../actions";
import { EscolhaAtuacao, CamposAcesso, gruposDeTelas } from "../../_editor";

export const dynamic = "force-dynamic";
const ORIGEM: Record<string, [string, string]> = { CARGO: ["ATIVO", "do cargo"], EXCECAO: ["PENDENTE", "exceção individual"], SEM_CARGO: ["ABERTO", "ficha sem cargo"], DIRETO: ["ABERTO", "conta sem ficha"] };

export default async function AcessoDoCargo({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); if (!can.configurar(s)) redirect("/");
  const { id } = await params; const sp = await searchParams; const pid = Number(id); if (!Number.isInteger(pid)) notFound();
  const [p] = await sql<{ id: number; nome: string; area: string; familia: string | null; acesso: unknown; pai: string | null }[]>`SELECT p.id, p.nome, p.area, p.familia, p.acesso, q.nome AS pai FROM positions p LEFT JOIN positions q ON q.id=p.parent_id WHERE p.id=${pid}`;
  if (!p) notFound();
  const def = defDoCargo(p); const revisado = !naoRevisado(p.acesso);
  const atuacao = (sp.atuacao && sp.atuacao in ATUACAO ? sp.atuacao : def.atuacao) as Role; const trocou = atuacao !== def.atuacao;
  const pds = await lerPadroes(); const padrao = pds.aprova; const pdAprova = aprovaPadrao(atuacao, padrao); const pdDesc = descontoPadrao(atuacao, pds.desconto);
  const telas = trocou ? null : def.telas; const aprova = trocou || !def.aprova ? pdAprova : def.aprova; const segue = trocou || !def.aprova;
  const [pessoas, outros, [{ semAcesso }]] = await Promise.all([
    sql<{ id: number; nome: string; email: string; ativo: boolean; origem_acesso: string | null; role: string; unidade: string | null; substituicao: { ate?: string } | null }[]>`SELECT u.id, u.nome, u.email, u.ativo, u.origem_acesso, u.role, un.nome AS unidade, u.substituicao FROM users u JOIN employees e ON e.id=u.employee_id LEFT JOIN units un ON un.id=e.unit_id WHERE e.position_id=${pid} ORDER BY u.ativo DESC, u.nome`,
    sql<{ id: number; nome: string; acesso: unknown; familia: string | null }[]>`SELECT id, nome, acesso, familia FROM positions WHERE id <> ${pid} ORDER BY ordem, nome`,
    sql<{ semAcesso: number }[]>`SELECT count(*)::int AS "semAcesso" FROM employees e WHERE e.position_id=${pid} AND e.situacao IN ('ATIVO','EM_ADMISSAO') AND NOT EXISTS (SELECT 1 FROM users u WHERE u.employee_id=e.id)`,
  ]);
  const totalTelas = telasDaAtuacao(def.atuacao).length; const nTelas = def.telas ? def.telas.length : totalTelas;
  const fora = def.telas ? telasDaAtuacao(def.atuacao).filter(t => !t.fixa && !def.telas!.includes(t.chave)) : [];
  const efAprova = def.aprova ?? aprovaPadrao(def.atuacao, padrao);
  return (
    <Page title={`Acesso do cargo: ${p.nome}`} sub={<>O que quem tem este cargo vê, faz e aprova — vale para todas as pessoas do cargo, sem configurar pessoa por pessoa. Mudou o cargo na ficha, o acesso muda na próxima tela. <Link href="/configuracoes/acessos" className="text-acao underline">Matriz de acesso</Link></>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-md border border-line bg-white px-3 py-2"><div className="text-xs text-slate-600">Atuação</div><div className="font-semibold text-navy">{rotuloAtuacao(def.atuacao)}</div><div className="text-[11px] text-slate-500">{revisado ? `revisado em ${fmtData(def.atualizadoEm ?? null)}${def.atualizadoPor ? ` · ${def.atualizadoPor}` : ""}` : "sugerida pelo nome do cargo — confira e salve"}</div></div>
        <div className="rounded-md border border-line bg-white px-3 py-2"><div className="text-xs text-slate-600">Alcance</div><div className="font-semibold text-navy">{ATUACAO[def.atuacao].alcance === "UNIDADE" ? "Unidade da pessoa" : "Rede toda"}</div></div>
        <div className="rounded-md border border-line bg-white px-3 py-2"><div className="text-xs text-slate-600">Telas</div><div className="font-semibold text-navy">{def.telas ? `${nTelas} de ${totalTelas}` : `Todas (${totalTelas})`}</div><div className="text-[11px] text-slate-500">{def.telas ? `${fora.length} fora do acesso` : "inclui telas novas"}</div></div>
        <div className="rounded-md border border-line bg-white px-3 py-2"><div className="text-xs text-slate-600">Aprovações</div><div className="font-semibold text-navy">{efAprova.length}</div><div className="text-[11px] text-slate-500">{def.aprova ? "personalizadas no cargo" : "padrão da atuação"}</div></div>
      </div>
      {fora.length > 0 && <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"><b>Não vê:</b> {fora.map(t => t.rotulo).join(" · ")}</p>}

      <Card title="1. Atuação do cargo" className="mb-4">
        <p className="mb-3 text-xs text-slate-600">A atuação define como a pessoa trabalha dentro das telas (o que pode alterar) e o alcance (só a unidade dela ou a rede). Cargo {p.nome} · área {p.area}{p.pai ? ` · reporta a ${p.pai}` : ""}.</p>
        <EscolhaAtuacao atual={atuacao} base={`/configuracoes/acessos/cargo/${pid}`} />
        {trocou && <p className="mt-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-navy">Mostrando as telas e as aprovações padrão de <b>{rotuloAtuacao(atuacao)}</b>. Nada muda até você salvar abaixo.</p>}
      </Card>

      <form action={salvarAcessoCargo}>
        <input type="hidden" name="id" value={pid} />
        <Card title={`2. Telas e aprovações — ${rotuloAtuacao(atuacao)}`} className="mb-4">
          <CamposAcesso atuacao={atuacao} telas={telas} aprova={aprova} padraoAprova={pdAprova} seguePadrao={segue} descontoPct={trocou ? null : def.descontoPct ?? null} descontoPadrao={pdDesc} />
          <div className="mt-4 flex flex-wrap items-center gap-3"><Btn>Salvar o acesso do cargo</Btn><span className="text-xs text-slate-500">Vale para {pessoas.filter(x => x.ativo && x.origem_acesso === "CARGO").length} pessoa(s) com acesso neste cargo, na próxima tela de cada uma.</span></div>
        </Card>
      </form>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card title={`Pessoas com este cargo (${pessoas.length} acesso(s)${semAcesso ? ` · ${semAcesso} ficha(s) ativa(s) sem acesso` : ""})`}>
          <Table head={["Pessoa", "Unidade", "Acesso", ""]} empty="Ninguém deste cargo tem acesso ainda — crie em Configurações → Usuários e acessos.">
            {pessoas.map(u => { const [tom, rot] = ORIGEM[u.origem_acesso ?? "CARGO"] ?? ORIGEM.CARGO; return (
              <tr key={u.id}><Td>{u.nome}<div className="text-[11px] text-slate-500">{u.email}</div></Td><Td>{u.unidade ?? "—"}</Td>
                <Td>{u.ativo ? <Badge v={tom} label={rot} /> : <Badge v="DESLIGADO" label="inativo" />}{u.origem_acesso === "EXCECAO" && <div className="text-[11px] text-slate-500">atuação: {rotuloAtuacao(u.role)}</div>}{u.substituicao?.ate && <div className="text-[11px] text-aviso">substituição até {fmtData(u.substituicao.ate)}</div>}</Td>
                <Td><Link href={`/configuracoes/acessos/usuario/${u.id}`} className="text-xs text-acao hover:underline">ver acesso</Link></Td></tr>); })}
          </Table>
          {semAcesso > 0 && <form action={criarAcessosAutoatendimento} className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-line bg-mist px-3 py-2"><input type="hidden" name="positionId" value={pid} /><input type="hidden" name="voltar" value={`/configuracoes/acessos/cargo/${pid}`} /><Btn small kind="ghost">Criar os acessos das {semAcesso} ficha(s) deste cargo</Btn><span className="text-xs text-slate-600">Cada login nasce com o acesso deste cargo; quem não tem e-mail na ficha fica listado. A senha ninguém conhece: a pessoa usa “Esqueci minha senha” ou recebe do RH uma senha temporária.</span></form>}
        </Card>
        <div className="space-y-4">
          <Card title="Copiar de outro cargo">
            <form action={copiarAcessoCargo} className="space-y-2"><input type="hidden" name="id" value={pid} />
              <Field label="Cargo de origem"><Select name="origemId" required defaultValue="">{[<option key="" value="">— escolha —</option>, ...outros.map(o => { const d = defDoCargo(o); return <option key={o.id} value={o.id}>{o.nome} · {ATUACAO[d.atuacao].curto}{d.telas ? " (telas personalizadas)" : ""}</option>; })]}</Select></Field>
              <Btn small kind="ghost">Copiar atuação, telas e aprovações</Btn>
            </form>
          </Card>
          <Card title="Como fica o menu">
            <div className="space-y-2 text-xs">{gruposDeTelas(def.atuacao).map(([g, ts]) => { const vis = ts.filter(t => t.fixa || !def.telas || def.telas.includes(t.chave)); return vis.length ? <div key={g}><div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{g}</div><div className="text-slate-700">{vis.map(t => t.rotulo).join(" · ")}</div></div> : null; })}</div>
            <div className="mt-3 border-t border-line pt-2 text-xs text-slate-600"><b>Aprova:</b> {efAprova.length ? efAprova.map(k => rotuloAlcada(k)).join(" · ") : "nada"} · <b>descontos até</b> {String(def.descontoPct ?? descontoPadrao(def.atuacao, pds.desconto)).replace(".", ",")}%</div>
            <p className="mt-2 text-[11px] text-slate-500">Quadro do acesso salvo. {ALCADAS.length} aprovações possíveis; {totalTelas} telas na atuação {rotuloAtuacao(def.atuacao)}.</p>
          </Card>
        </div>
      </div>
    </Page>
  );
}
