import { notFound, redirect } from "next/navigation";
import Link from "@/components/Link";
import { sql } from "@/db";
import { requireSession, can, type Role } from "@/lib/auth";
import { Page, Card, Flash, Badge, Btn, Select, Field, Input, Textarea } from "@/components/ui";
import { ATUACAO, ATUACOES, efetivoDoUsuario, filtrarMenu, aprovaPadrao, lerPadroes, descontoPadrao, rotuloAtuacao, rotuloAlcada, defDoCargo, type AcessoUsuario, type Substituicao } from "@/lib/acesso";
import { montarMenu } from "@/lib/menu";
import { ehComite } from "@/lib/etica";
import { podePrivacidade } from "@/lib/privacidade";
import { fmtData, hoje, addDays } from "@/lib/utils";
import { salvarExcecao, voltarAoCargo, salvarAcessoConta, salvarSubstituicao, encerrarSubstituicao } from "../../../acesso-actions";
import { CamposAcesso } from "../../_editor";

export const dynamic = "force-dynamic";
const ORIGEM: Record<string, string> = { CARGO: "Acesso do cargo da ficha", EXCECAO: "Exceção individual", SEM_CARGO: "Ficha sem cargo (autoatendimento)", DIRETO: "Conta sem ficha" };

export default async function OQueAPessoaVe({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); if (!can.configurar(s)) redirect("/");
  const { id } = await params; const sp = await searchParams; const uid = Number(id); if (!Number.isInteger(uid)) notFound();
  const r = await efetivoDoUsuario(uid); if (!r) notFound();
  const { linha: u, ef, sessao } = r; const ua = (u.acesso ?? null) as AcessoUsuario | null; const sub = (u.substituicao ?? null) as Substituicao | null;
  let membroEtica = false, gestorPriv = false; try { membroEtica = await ehComite(sessao); gestorPriv = await podePrivacidade(sessao); } catch { /* opcional */ }
  let temEquipe = false; if (u.employee_id) { const [t] = await sql<{ ok: boolean }[]>`SELECT EXISTS (SELECT 1 FROM employees WHERE gestor_id=${u.employee_id} AND situacao IN ('ATIVO','FERIAS','AFASTADO','EM_ADMISSAO')) AS ok`; temEquipe = !!t?.ok; }
  const m = montarMenu(sessao, { nNotif: 0, membroEtica, gestorPriv, temEquipe }); const menu = filtrarMenu(m.grupos, m.inferior, sessao);
  const [ficha] = u.employee_id ? await sql<{ nome: string; unidade: string | null; situacao: string; cargo: string | null; position_id: number | null }[]>`SELECT e.nome, un.nome AS unidade, e.situacao, p.nome AS cargo, e.position_id FROM employees e LEFT JOIN units un ON un.id=e.unit_id LEFT JOIN positions p ON p.id=e.position_id WHERE e.id=${u.employee_id}` : [];
  const [unidadeConta] = u.unit_id ? await sql<{ nome: string }[]>`SELECT nome FROM units WHERE id=${u.unit_id}` : [];
  const [cargos, units, padrao] = await Promise.all([sql<{ id: number; nome: string; acesso: unknown; familia: string | null }[]>`SELECT id, nome, acesso, familia FROM positions ORDER BY ordem, nome`, sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ORDER BY nome`, lerPadroes()]);
  const subAtiva = !!(sub && sub.ate >= hoje());
  const doCargo = ficha?.position_id ? defDoCargo(cargos.find(c => c.id === ficha.position_id) ?? null) : null;
  const atEx = (sp.atuacao && sp.atuacao in ATUACAO ? sp.atuacao : ua?.atuacao ?? doCargo?.atuacao ?? "COLABORADOR") as Role;
  const pdEx = aprovaPadrao(atEx, padrao.aprova);
  const contaRole = (u.role in ATUACAO ? u.role : "LEITURA") as Role; const pdConta = aprovaPadrao(contaRole, padrao.aprova);
  return (
    <Page title={`O que ${u.nome} vê`} sub={<>Acesso efetivo agora, com a origem dele. Para mudar o de todas as pessoas do cargo, edite o cargo — não a pessoa. <Link href="/configuracoes#usuarios" className="text-acao underline">Usuários e acessos</Link> · <Link href="/configuracoes/acessos" className="text-acao underline">Matriz de acesso</Link></>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-md border border-line bg-white px-3 py-2"><div className="text-xs text-slate-600">Origem</div><div className="font-semibold text-navy">{ORIGEM[ef.origem]}</div><div className="text-[11px] text-slate-500">{u.email}{!u.ativo ? " · inativo" : ""}</div></div>
        <div className="rounded-md border border-line bg-white px-3 py-2"><div className="text-xs text-slate-600">Cargo</div><div className="font-semibold text-navy">{ficha ? ficha.cargo ?? "ficha sem cargo" : "—"}</div><div className="text-[11px] text-slate-500">{ficha ? `${ficha.nome} · ${ficha.unidade ?? ""}` : "conta sem ficha"}{ficha?.position_id ? <> · <Link href={`/configuracoes/acessos/cargo/${ficha.position_id}`} className="text-acao hover:underline">acesso do cargo</Link></> : null}</div></div>
        <div className="rounded-md border border-line bg-white px-3 py-2"><div className="text-xs text-slate-600">Atuação e alcance</div><div className="font-semibold text-navy">{rotuloAtuacao(ef.role)}</div><div className="text-[11px] text-slate-500">{ATUACAO[ef.role].alcance === "UNIDADE" ? `unidade ${ficha?.unidade ?? unidadeConta?.nome ?? ""}` : u.employee_id ? "rede toda" : unidadeConta ? `rede · unidade de referência ${unidadeConta.nome}` : "rede toda"}</div></div>
        <div className="rounded-md border border-line bg-white px-3 py-2"><div className="text-xs text-slate-600">Telas · aprovações</div><div className="font-semibold text-navy">{menu.grupos.reduce((n, [, xs]) => n + xs.length, 0)} · {ef.aprova.length}</div><div className="text-[11px] text-slate-500">{ef.telas ? "telas escolhidas" : "todas as da atuação"}</div></div>
      </div>
      {ef.bloqueio === "DESLIGADO" && <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-erro">A ficha está desligada: este login não entra mais (o acesso foi encerrado automaticamente).</p>}
      {ef.origem === "EXCECAO" && <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"><b>Exceção individual:</b> {ef.excecaoMotivo ?? "sem motivo registrado"}{ua?.em ? ` · desde ${fmtData(ua.em)}${ua.por ? ` (${ua.por})` : ""}` : ""}</p>}
      {subAtiva && <p className="mb-4 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-navy"><b>Substituição:</b> recebe também o acesso de {ef.substituicao?.cargo} até {fmtData(sub!.ate)} — {sub!.motivo}</p>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card title="Menu desta pessoa (o que ela vê)">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {menu.grupos.map(([g, xs]) => <div key={g || "geral"}><div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{g || "Geral"}</div><ul className="mt-0.5 space-y-0.5 text-sm">{xs.map(([h, l]) => <li key={h} className="text-slate-800">{l}</li>)}</ul></div>)}
          </div>
          <div className="mt-4 border-t border-line pt-3 text-sm"><b className="text-navy">Aprova:</b> {ef.aprova.length ? ef.aprova.map(k => rotuloAlcada(k)).join(" · ") : <span className="text-slate-500">nada</span>} · <b className="text-navy">descontos até</b> {String(ef.descontoPct).replace(".", ",")}%</div>
          <p className="mt-2 text-xs text-slate-500">Atalhos do celular: {menu.inferior.map(i => i.rotulo).join(" · ") || "—"}. Telas fora do menu (detalhes de um registro, por exemplo) seguem a regra da própria tela e o alcance.</p>
        </Card>
        <div className="space-y-4">
          {u.employee_id ? (
            <Card title="Exceção individual">
              {ef.origem === "EXCECAO"
                ? <form action={voltarAoCargo} className="mb-3"><input type="hidden" name="id" value={uid} /><Btn small kind="ghost">Voltar ao acesso do cargo{doCargo ? ` (${ATUACAO[doCargo.atuacao].curto})` : ""}</Btn></form>
                : <p className="mb-3 text-xs text-slate-600">Hoje segue o cargo. Use exceção só quando esta pessoa, e não o cargo inteiro, precisa de outro acesso — com motivo. Fica destacada na Matriz.</p>}
              <form method="get" className="mb-2 flex items-end gap-2"><Field label="Atuação da exceção" className="min-w-0 flex-1"><Select name="atuacao" defaultValue={atEx}>{ATUACOES.map(x => <option key={x} value={x}>{ATUACAO[x].rotulo}</option>)}</Select></Field><Btn small kind="ghost">Ver telas</Btn></form>
              <form action={salvarExcecao} className="space-y-2"><input type="hidden" name="id" value={uid} />
                <details><summary className="cursor-pointer text-xs text-acao">Telas e aprovações da exceção ({rotuloAtuacao(atEx)})</summary><div className="mt-2"><CamposAcesso atuacao={atEx} telas={ua?.atuacao === atEx ? ua.telas ?? null : null} aprova={ua?.atuacao === atEx && ua.aprova ? ua.aprova : pdEx} padraoAprova={pdEx} seguePadrao={!(ua?.atuacao === atEx && ua.aprova)} descontoPct={ua?.atuacao === atEx ? ua.descontoPct ?? null : null} descontoPadrao={descontoPadrao(atEx, padrao.desconto)} estreito /></div></details>
                {ATUACAO[atEx].alcance === "UNIDADE" && <Field label="Unidade"><Select name="unitId" defaultValue={String(ua?.unitId ?? "")}><option value="">a da ficha</option>{units.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field>}
                <Field label="Motivo (obrigatório)"><Textarea name="motivo" required minLength={10} defaultValue={ef.origem === "EXCECAO" ? ua?.motivo ?? "" : ""} placeholder="Ex.: acumula a tesouraria até a contratação da vaga" /></Field>
                <Btn small>{ef.origem === "EXCECAO" ? "Atualizar exceção" : "Registrar exceção"}</Btn>
              </form>
            </Card>
          ) : (
            <Card title="Acesso da conta sem ficha">
              <p className="mb-2 text-xs text-slate-600">Atuação desta conta: <b>{rotuloAtuacao(contaRole)}</b> (troque em Usuários e acessos → Editar). Abaixo, as telas e aprovações dela.</p>
              <form action={salvarAcessoConta} className="space-y-2"><input type="hidden" name="id" value={uid} />
                <details open><summary className="cursor-pointer text-xs text-acao">Telas e aprovações</summary><div className="mt-2"><CamposAcesso atuacao={contaRole} telas={ua?.telas ?? null} aprova={ua?.aprova ?? pdConta} padraoAprova={pdConta} seguePadrao={!ua?.aprova} descontoPct={ua?.descontoPct ?? null} descontoPadrao={descontoPadrao(contaRole, padrao.desconto)} estreito /></div></details>
                <Field label="Para que serve esta conta"><Input name="motivo" defaultValue={ua?.motivo ?? ""} placeholder="Ex.: contabilidade externa — consulta do financeiro" /></Field>
                <Btn small>Salvar o acesso da conta</Btn>
              </form>
            </Card>
          )}
          {u.employee_id && (
            <Card title="Substituição temporária">
              {subAtiva ? <div className="space-y-2 text-sm"><p>Substitui <b>{ef.substituicao?.cargo}</b> até <b>{fmtData(sub!.ate)}</b>.<span className="block text-xs text-slate-600">{sub!.motivo}{sub!.por ? ` · registrado por ${sub!.por}` : ""}</span></p><form action={encerrarSubstituicao}><input type="hidden" name="id" value={uid} /><Btn small kind="ghost">Encerrar agora</Btn></form></div>
                : <form action={salvarSubstituicao} className="space-y-2"><input type="hidden" name="id" value={uid} />
                    <p className="text-xs text-slate-600">Férias, licença ou vaga em aberto: a pessoa recebe também o acesso do cargo substituído e, no dia seguinte ao fim, volta sozinha ao do cargo dela.</p>
                    <Field label="Cargo substituído"><Select name="positionId" required defaultValue="">{[<option key="" value="">— escolha —</option>, ...cargos.filter(c => c.id !== ficha?.position_id).map(c => <option key={c.id} value={c.id}>{c.nome} · {ATUACAO[defDoCargo(c).atuacao].curto}</option>)]}</Select></Field>
                    <Field label="Até (inclusive)"><Input type="date" name="ate" required min={hoje()} defaultValue={addDays(hoje(), 30)} /></Field>
                    <Field label="Motivo"><Input name="motivo" required minLength={5} placeholder="Ex.: férias da gerente financeira" /></Field>
                    <Btn small>Registrar substituição</Btn>
                  </form>}
              {sub && !subAtiva && <p className="mt-2 text-[11px] text-slate-500">Última: {sub.motivo} (até {fmtData(sub.ate)}).</p>}
            </Card>
          )}
        </div>
      </div>
    </Page>
  );
}
