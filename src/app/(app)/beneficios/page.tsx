import { redirect } from "next/navigation";
import Link from "@/components/Link";
import { requireSession, can } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Table, Td, Badge, Flash, Btn, Field, Input, Select, Textarea, Stat } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { BarrasH, COR } from "@/components/graficos";
import { fmtData, fmtMoeda, getSettings, hoje, VINCULO_LABEL } from "@/lib/utils";
import { adesoes, custoBeneficios, elegivel, movimentosBeneficios, ADESAO_STATUS, type Plano, type PessoaBenef } from "@/lib/beneficios";
import { salvarPlano, aderirBeneficio, encerrarAdesao, atualizarAdesao, recalcularAdesoes } from "./actions";

export const dynamic = "force-dynamic";
const ABAS: [string, string][] = [["catalogo", "Catálogo e regras"], ["adesoes", "Adesões"], ["elegiveis", "Elegíveis sem adesão"], ["mes", "Movimentações do mês"], ["custo", "Custo"]];
const n2 = (v: number | null | undefined) => (v == null ? "—" : fmtMoeda(v));

function FormPlano({ p, tipos, units }: { p?: Plano; tipos: Record<string, string>; units: { id: number; nome: string }[] }) {
  const el = p?.elegibilidade ?? {};
  return <form action={salvarPlano} className="space-y-2">{p && <input type="hidden" name="id" value={p.id} />}
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><Field label="Nome"><Input name="nome" required defaultValue={p?.nome ?? ""} placeholder="Ex.: Plano de saúde enfermaria" /></Field><Field label="Tipo"><Select name="tipo" defaultValue={p?.tipo ?? "SAUDE"}>{Object.entries(tipos).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field></div>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><Field label="Fornecedor"><Input name="fornecedor" defaultValue={p?.fornecedor ?? ""} /></Field><Field label="Preço por titular (R$/mês)" hint="VT e bolsa: informado na adesão"><Input name="custoEmpresa" type="number" step="0.01" min={0} defaultValue={p?.custo_empresa ?? ""} /></Field><Field label="% que a escola paga"><Input name="custoEmpresaPct" type="number" step="0.01" min={0} max={100} defaultValue={p?.custo_empresa_pct ?? 100} /></Field><Field label="Preço por dependente (R$)"><Input name="custoDependente" type="number" step="0.01" min={0} defaultValue={p?.custo_dependente ?? ""} /></Field></div>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><Field label="Desconto fixo (R$/mês)" hint="coparticipação fixa"><Input name="descontoColab" type="number" step="0.01" min={0} defaultValue={p?.desconto_colab ?? ""} /></Field><Field label="Desconto (% do salário)" hint="VT: até 6%"><Input name="descontoColabPct" type="number" step="0.01" min={0} max={100} defaultValue={p?.desconto_colab_pct ?? ""} /></Field><Field label="% da escola nos dependentes"><Input name="depPctEmpresa" type="number" step="1" min={0} max={100} defaultValue={el.depPctEmpresa ?? 0} /></Field><Field label="Carência (dias após a admissão)"><Input name="carenciaDias" type="number" min={0} max={365} defaultValue={p?.carencia_dias ?? 0} /></Field></div>
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_10rem]">
      <fieldset className="rounded-md border border-line p-2 text-xs"><legend className="px-1 text-slate-600">Vínculos elegíveis (nenhum = todos)</legend><div className="flex flex-wrap gap-x-3 gap-y-1">{Object.entries(VINCULO_LABEL).map(([k, v]) => <label key={k} className="flex items-center gap-1"><input type="checkbox" name="vinculos" value={k} defaultChecked={el.vinculos?.includes(k)} /> {v}</label>)}</div></fieldset>
      <fieldset className="rounded-md border border-line p-2 text-xs"><legend className="px-1 text-slate-600">Unidades (nenhuma = todas)</legend><div className="flex flex-wrap gap-x-3 gap-y-1">{units.map(u => <label key={u.id} className="flex items-center gap-1"><input type="checkbox" name="unidades" value={u.id} defaultChecked={el.unidades?.includes(u.id)} /> {u.nome}</label>)}</div></fieldset>
      <Field label="Jornada mínima (h/dia)"><Input name="jornadaMinH" type="number" step="0.5" min={0} max={12} defaultValue={el.jornadaMinDia ? el.jornadaMinDia / 60 : ""} /></Field>
    </div>
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]"><Field label="Observações (regras, documentos, quando entra)"><Textarea name="obs" defaultValue={p?.obs ?? ""} className="min-h-[50px]" /></Field><Field label="Situação"><Select name="ativo" defaultValue={p && !p.ativo ? "0" : "1"}><option value="1">Ativo</option><option value="0">Inativo (sem novas adesões)</option></Select></Field></div>
    <Btn small>{p ? "Salvar" : "Criar benefício"}</Btn></form>;
}

function regra(p: Plano, units: { id: number; nome: string }[]) {
  const el = p.elegibilidade ?? {}; const xs: string[] = [];
  if (el.vinculos?.length) xs.push(el.vinculos.map(v => VINCULO_LABEL[v] ?? v).join("/")); if (el.unidades?.length) xs.push(el.unidades.map(u => units.find(x => x.id === u)?.nome ?? "?").join(", "));
  if (el.jornadaMinDia) xs.push(`${String(el.jornadaMinDia / 60).replace(".", ",")} h/dia+`); if (p.carencia_dias) xs.push(`carência ${p.carencia_dias} d`);
  return xs.length ? xs.join(" · ") : "todos";
}

/** v30 · Benefícios: catálogo com regra e carência, adesões (dependentes, bolsa de filho), quem é elegível e ainda não aderiu, o mês da folha e o custo. */
export default async function Beneficios({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); if (!can.verSalario(s)) redirect("/");
  const sp = await searchParams; const aba = ABAS.some(([k]) => k === sp.aba) ? sp.aba! : "catalogo"; const cfg = await getSettings(); const tipos = cfg.beneficios.tipos as Record<string, string>; const h = hoje();
  const [units, planos, pessoas, ativas] = await Promise.all([
    sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ORDER BY nome`,
    sql<(Plano & { ativas: number; empresa: number; colab: number })[]>`SELECT p.id, p.nome, p.tipo, p.fornecedor, p.custo_empresa::float, p.custo_empresa_pct::float, p.desconto_colab::float, p.desconto_colab_pct::float, p.custo_dependente::float, p.elegibilidade, p.carencia_dias, p.ativo, p.obs,
      (SELECT count(*) FROM benefit_enrollments a WHERE a.plan_id=p.id AND a.status='ATIVO')::int AS ativas, (SELECT coalesce(sum(valor_empresa),0) FROM benefit_enrollments a WHERE a.plan_id=p.id AND a.status='ATIVO')::float AS empresa, (SELECT coalesce(sum(valor_colab),0) FROM benefit_enrollments a WHERE a.plan_id=p.id AND a.status='ATIVO')::float AS colab
      FROM benefit_plans p ORDER BY p.ativo DESC, p.nome`,
    sql<(PessoaBenef & { unidade: string })[]>`SELECT e.id, e.nome, e.vinculo, e.unit_id, e.position_id, e.jornada_min_dia, e.admissao::text, e.salario::float, e.situacao, un.nome AS unidade FROM employees e JOIN units un ON un.id=e.unit_id WHERE e.situacao IN ('ATIVO','FERIAS','AFASTADO','EM_ADMISSAO') ORDER BY e.nome`,
    sql<{ plan_id: number; employee_id: number }[]>`SELECT plan_id, employee_id FROM benefit_enrollments WHERE status='ATIVO'`,
  ]);
  const empresaMes = planos.reduce((a, p) => a + p.empresa, 0), colabMes = planos.reduce((a, p) => a + p.colab, 0); const comBenef = new Set(ativas.map(a => a.employee_id)).size;
  const bolsas = planos.filter(p => p.tipo === "BOLSA_DEPENDENTE"); const nBolsas = bolsas.reduce((a, p) => a + p.ativas, 0);
  const abas = <div className="mb-4 flex flex-wrap gap-2">{ABAS.map(([k, r]) => <Link key={k} href={`/beneficios?aba=${k}`} className={`rounded-full border px-3 py-1 text-xs font-medium ${aba === k ? "border-acao bg-acao text-white" : "border-line bg-white text-navy hover:bg-mist"}`}>{r}</Link>)}</div>;
  let corpo: React.ReactNode = null;

  if (aba === "catalogo") {
    corpo = <Card title={`Catálogo (${planos.filter(p => p.ativo).length} ativo(s))`} actions={<Modal label="Novo benefício" title="Novo benefício"><FormPlano tipos={tipos} units={units} /></Modal>}>
      <Table head={["Benefício", "Regra de elegibilidade", "Preço", "Escola paga", "Desconto", "Adesões", "Custo/mês (escola)", ""]} empty="Nenhum benefício cadastrado — comece pelo VT, VA/VR e plano de saúde.">{planos.map(p => <tr key={p.id} className={p.ativo ? "" : "opacity-50"}><Td><div className="font-medium">{p.nome}</div><div className="text-[11px] text-slate-500">{tipos[p.tipo] ?? p.tipo}{p.fornecedor ? ` · ${p.fornecedor}` : ""}</div></Td><Td className="text-xs">{regra(p, units)}</Td>
        <Td className="text-xs">{p.tipo === "VT" ? "custo do transporte" : p.tipo === "BOLSA_DEPENDENTE" ? "mensalidade × %" : n2(p.custo_empresa)}{p.custo_dependente ? <div className="text-[11px] text-slate-500">+ {n2(p.custo_dependente)}/dependente</div> : null}</Td>
        <Td className="text-xs">{p.tipo === "VT" ? "o que passar do desconto" : `${String(p.custo_empresa_pct ?? 100).replace(".", ",")}%`}</Td><Td className="text-xs">{p.desconto_colab ? n2(p.desconto_colab) : p.desconto_colab_pct ? `${String(p.desconto_colab_pct).replace(".", ",")}% do salário` : "—"}</Td>
        <Td className="tabular-nums">{p.ativas ? <Link className="text-acao" href={`/beneficios?aba=adesoes&plano=${p.id}`}>{p.ativas}</Link> : 0}</Td><Td className="text-xs">{n2(p.empresa)}</Td><Td><Modal label="Editar" kind="link" title={`Editar · ${p.nome}`}><FormPlano p={p} tipos={tipos} units={units} /></Modal></Td></tr>)}</Table>
      <p className="mt-2 text-[11px] text-slate-500">Vale-transporte: a escola paga o custo do transporte e desconta no máximo {cfg.beneficios.vtDescontoMaxPct}% do salário-base (Lei 7.418/1985). Bolsa para filho(a): o valor é a mensalidade da série do aluno × % da bolsa (ou o valor informado). Preço com % da escola: a pessoa paga o restante; dependentes pela regra do plano.</p>
    </Card>;
  }

  if (aba === "adesoes") {
    const planoF = sp.plano ? Number(sp.plano) : null; const status = sp.status === "ENCERRADO" ? "ENCERRADO" : sp.status === "todas" ? null : "ATIVO"; const unidadeF = sp.u ? Number(sp.u) : null; const q = (sp.q ?? "").trim().toLowerCase();
    const [lista, alunos] = await Promise.all([adesoes({ planId: planoF, status, unitId: unidadeF }), sql<{ id: number; nome: string; unidade: string | null }[]>`SELECT s.id, s.nome, u.nome AS unidade FROM students s LEFT JOIN units u ON u.id=s.unit_atual_id WHERE s.aluno_atual ORDER BY s.nome LIMIT 3000`]);
    const filtrada = q ? lista.filter(a => a.nome.toLowerCase().includes(q) || a.plano.toLowerCase().includes(q) || (a.aluno ?? "").toLowerCase().includes(q)) : lista;
    corpo = <Card title={`Adesões (${filtrada.length})`} actions={<div className="flex flex-wrap gap-2"><form action={recalcularAdesoes}><input type="hidden" name="planId" value={planoF ?? ""} /><Btn small kind="ghost">Recalcular pelos salários atuais</Btn></form>
      <Modal label="Nova adesão" title="Registrar adesão a um benefício"><form action={aderirBeneficio} className="space-y-2"><input type="hidden" name="voltar" value="/beneficios?aba=adesoes" />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><Field label="Colaborador"><Select name="employeeId" required defaultValue="">{[<option key="" value="">Escolha</option>, ...pessoas.map(e => <option key={e.id} value={e.id}>{e.nome} · {e.unidade}</option>)]}</Select></Field><Field label="Benefício"><Select name="planId" required defaultValue={planoF ?? ""}>{[<option key="" value="">Escolha</option>, ...planos.filter(p => p.ativo).map(p => <option key={p.id} value={p.id}>{p.nome}</option>)]}</Select></Field></div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3"><Field label="Início"><Input name="inicio" type="date" defaultValue={h} /></Field><Field label="Dependentes"><Input name="dependentes" type="number" min={0} max={10} defaultValue={0} /></Field><Field label="Valor (VT: custo do transporte; bolsa: opcional)"><Input name="valor" type="number" step="0.01" min={0} /></Field></div>
        <details className="rounded-md border border-line p-2 text-xs"><summary className="cursor-pointer text-acao">Bolsa de estudos para filho(a)</summary><div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_8rem]"><Field label="Aluno(a) — digite e escolha"><Input name="aluno" list="alunos-bolsa" placeholder="Nome do aluno" /></Field><Field label="% da bolsa"><Input name="bolsaPct" type="number" step="1" min={1} max={100} /></Field></div><datalist id="alunos-bolsa">{alunos.map(a => <option key={a.id} value={`${a.nome}${a.unidade ? ` · ${a.unidade}` : ""} (#${a.id})`} />)}</datalist></details>
        <details className="rounded-md border border-line p-2 text-xs"><summary className="cursor-pointer text-acao">Ajustar valores ou conceder fora da regra</summary><div className="mt-2 grid grid-cols-2 gap-2"><Field label="A escola paga (R$/mês)"><Input name="valorEmpresa" type="number" step="0.01" min={0} placeholder="calculado" /></Field><Field label="Desconto em folha (R$/mês)"><Input name="valorColab" type="number" step="0.01" min={0} placeholder="calculado" /></Field></div><label className="mt-2 flex items-center gap-2"><input type="checkbox" name="excecao" value="1" /> Conceder mesmo fora da regra (exceção — fica registrada)</label></details>
        <Field label="Observação / justificativa"><Textarea name="obs" className="min-h-[40px]" /></Field>
        <Btn small>Registrar adesão</Btn></form></Modal></div>}>
      <form className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"><input type="hidden" name="aba" value="adesoes" />
        <Input name="q" defaultValue={sp.q ?? ""} placeholder="Buscar pessoa, benefício ou aluno" aria-label="Buscar" />
        <Select name="plano" defaultValue={planoF ?? ""} aria-label="Benefício"><option value="">Todos os benefícios</option>{planos.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}</Select>
        <Select name="u" defaultValue={unidadeF ?? ""} aria-label="Unidade"><option value="">Todas as unidades</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select>
        <Select name="status" defaultValue={sp.status ?? "ATIVO"} aria-label="Situação"><option value="ATIVO">Ativas</option><option value="ENCERRADO">Encerradas</option><option value="todas">Todas</option></Select><Btn kind="ghost" small>Filtrar</Btn></form>
      <Table head={["Colaborador", "Benefício", "Desde", "Dependentes", "A escola paga", "Desconto em folha", "Situação", ""]} empty="Nenhuma adesão com estes filtros.">{filtrada.slice(0, 300).map(a => <tr key={a.id}><Td><Link className="text-acao" href={`/colaboradores/${a.employee_id}#beneficios`}>{a.nome}</Link><div className="text-[11px] text-slate-500">{a.unidade}</div></Td>
        <Td className="text-xs">{a.plano}{a.aluno && <div className="text-[11px] text-slate-500">aluno(a): {a.aluno}{a.bolsa_pct ? ` · ${a.bolsa_pct}%` : ""}</div>}{a.obs?.startsWith("EXCEÇÃO") && <div className="text-[11px] text-aviso">exceção à regra</div>}</Td>
        <Td className="text-xs">{fmtData(a.inicio)}{a.fim && <div className="text-[11px] text-slate-500">até {fmtData(a.fim)}</div>}</Td><Td className="tabular-nums">{a.dependentes || "—"}</Td><Td className="text-xs">{n2(a.valor_empresa)}</Td><Td className="text-xs">{n2(a.valor_colab)}</Td>
        <Td><Badge v={a.status === "ATIVO" ? "ATIVO" : "CANCELADA"} label={ADESAO_STATUS[a.status] ?? a.status} />{a.motivo_fim && <div className="text-[11px] text-slate-500">{a.motivo_fim}</div>}</Td>
        <Td>{a.status === "ATIVO" && <div className="flex flex-col gap-1"><Modal label="Alterar" kind="link" title={`Alterar · ${a.nome} · ${a.plano}`}><form action={atualizarAdesao} className="space-y-2"><input type="hidden" name="id" value={a.id} /><input type="hidden" name="voltar" value="/beneficios?aba=adesoes" /><div className="grid grid-cols-2 gap-2"><Field label="Dependentes"><Input name="dependentes" type="number" min={0} max={10} defaultValue={a.dependentes} /></Field><Field label="Valor base (VT/bolsa)"><Input name="valor" type="number" step="0.01" min={0} placeholder="mantém" /></Field><Field label="A escola paga"><Input name="valorEmpresa" type="number" step="0.01" min={0} placeholder="recalcula" /></Field><Field label="Desconto em folha"><Input name="valorColab" type="number" step="0.01" min={0} placeholder="recalcula" /></Field></div><Btn small>Salvar</Btn></form></Modal>
          <Modal label="Encerrar" kind="link" title={`Encerrar · ${a.nome} · ${a.plano}`}><form action={encerrarAdesao} className="space-y-2"><input type="hidden" name="id" value={a.id} /><input type="hidden" name="voltar" value="/beneficios?aba=adesoes" /><Field label="Fim"><Input name="fim" type="date" defaultValue={h} /></Field><Field label="Motivo"><Input name="motivo" required placeholder="Ex.: pediu cancelamento; mudou de endereço" /></Field><Btn small danger>Encerrar</Btn></form></Modal></div>}</Td></tr>)}</Table>
      {filtrada.length > 300 && <p className="mt-1 text-xs text-slate-500">Mostrando 300 de {filtrada.length} adesões — use a busca e os filtros (o relatório sob medida de Benefícios exporta tudo).</p>}
    </Card>;
  }

  if (aba === "elegiveis") {
    const linhas = planos.filter(p => p.ativo && p.tipo !== "BOLSA_DEPENDENTE").map(p => { const xs = pessoas.filter(e => e.situacao !== "EM_ADMISSAO" && !ativas.some(a => a.plan_id === p.id && a.employee_id === e.id)).map(e => ({ e, r: elegivel(p, e, h) })); return { p, elegiveis: xs.filter(x => x.r.ok).map(x => x.e), carencia: xs.filter(x => !x.r.ok && x.r.motivos.length === 1 && x.r.motivos[0].startsWith("carência")).map(x => ({ e: x.e, ate: x.r.liberaEm })) }; });
    corpo = <Card title="Quem é elegível e ainda não aderiu">
      {linhas.length === 0 ? <p className="text-sm text-slate-500">Cadastre benefícios no catálogo.</p> : <ul className="space-y-2">{linhas.map(l => <li key={l.p.id} className="rounded-md border border-line p-2 text-sm"><div className="flex flex-wrap items-baseline gap-2"><b className="text-navy">{l.p.nome}</b><span className="text-xs text-slate-500">{l.elegiveis.length} elegível(is) sem adesão · {l.carencia.length} em carência</span><Link className="ml-auto text-xs text-acao" href={`/beneficios?aba=adesoes&plano=${l.p.id}`}>adesões</Link></div>
        {l.elegiveis.length > 0 && <details className="mt-1 text-xs"><summary className="cursor-pointer text-acao">ver quem</summary><p className="mt-1 text-slate-600">{l.elegiveis.slice(0, 80).map(e => e.nome).join(" · ")}{l.elegiveis.length > 80 ? ` · +${l.elegiveis.length - 80}` : ""}</p></details>}
        {l.carencia.length > 0 && <p className="mt-1 text-[11px] text-slate-500">Em carência: {l.carencia.slice(0, 20).map(c => `${c.e.nome} (libera ${fmtData(c.ate)})`).join(" · ")}</p>}</li>)}</ul>}
      <p className="mt-2 text-[11px] text-slate-500">Elegível = dentro da regra do benefício (vínculo, unidade, jornada) e já fora da carência. Não aderir pode ser escolha da pessoa (ex.: VT recusado) — registre a recusa na ficha quando a lei pedir a declaração.</p>
    </Card>;
  }

  if (aba === "mes") {
    const comp = sp.comp && /^\d{4}-\d{2}$/.test(sp.comp) ? sp.comp : h.slice(0, 7); const ini = `${comp}-01`; const [yy, mm] = comp.split("-").map(Number); const fim = new Date(Date.UTC(yy, mm, 0)).toISOString().slice(0, 10);
    const ids = (await sql<{ id: number }[]>`SELECT id FROM employees`).map(x => x.id); const mov = await movimentosBeneficios(ids, ini, fim); const nome = new Map((await sql<{ id: number; nome: string; unidade: string }[]>`SELECT e.id, e.nome, u.nome AS unidade FROM employees e JOIN units u ON u.id=e.unit_id`).map(x => [x.id, x]));
    const grupo = (k: string) => mov.filter(m => m.movimento === k);
    corpo = <Card title={`Movimentações de ${comp.split("-").reverse().join("/")}`} actions={<form className="flex items-center gap-2"><input type="hidden" name="aba" value="mes" /><Input type="month" name="comp" defaultValue={comp} aria-label="Competência" className="w-auto" /><Btn small kind="ghost">Ver</Btn></form>}>
      <div className="mb-3 grid grid-cols-3 gap-2"><Stat label="Adesões no mês" value={grupo("ADESAO").length} /><Stat label="Encerramentos" value={grupo("ENCERRAMENTO").length} /><Stat label="Descontos em folha" value={fmtMoeda(mov.filter(m => m.movimento !== "ENCERRAMENTO").reduce((a, m) => a + Number(m.valor_colab ?? 0), 0))} hint={`${mov.filter(m => m.movimento === "DESCONTO").length} desconto(s) ativos`} /></div>
      <Table head={["Colaborador", "Benefício", "Movimento", "Início", "Fim", "Dependentes", "Desconto", "Escola"]} empty="Nenhum benefício na competência.">{mov.map((m, i) => { const p = nome.get(m.employee_id); return <tr key={i}><Td>{p?.nome ?? "—"}<div className="text-[11px] text-slate-500">{p?.unidade}</div></Td><Td className="text-xs">{m.plano}</Td><Td><Badge v={m.movimento === "ADESAO" ? "APROVADA" : m.movimento === "ENCERRAMENTO" ? "CANCELADA" : "EM_AQUISICAO"} label={m.movimento === "ADESAO" ? "adesão" : m.movimento === "ENCERRAMENTO" ? "encerramento" : "desconto"} /></Td><Td className="text-xs">{fmtData(m.inicio)}</Td><Td className="text-xs">{fmtData(m.fim)}</Td><Td className="tabular-nums">{m.dependentes || "—"}</Td><Td className="text-xs">{n2(m.valor_colab)}</Td><Td className="text-xs">{n2(m.valor_empresa)}</Td></tr>; })}</Table>
      <p className="mt-2 text-[11px] text-slate-500">Esta lista entra no pacote da folha da competência (seção “Benefícios”) — o contador recebe adesões, encerramentos e os descontos a lançar. <Link className="text-acao" href="/folha">Ciclo da folha</Link></p>
    </Card>;
  }

  if (aba === "custo") {
    const c = await custoBeneficios(null); const porPlano = [...new Map(c.map(x => [x.plan_id, { plano: x.plano, empresa: 0, colab: 0, pessoas: 0 }])).entries()].map(([id, v]) => { const xs = c.filter(x => x.plan_id === id); return { id, ...v, empresa: xs.reduce((a, x) => a + x.empresa, 0), colab: xs.reduce((a, x) => a + x.colab, 0), pessoas: xs.reduce((a, x) => a + x.pessoas, 0) }; });
    const porUnidade = units.map(u => { const xs = c.filter(x => x.unit_id === u.id); return { u, empresa: xs.reduce((a, x) => a + x.empresa, 0), colab: xs.reduce((a, x) => a + x.colab, 0), pessoas: new Set(ativas.filter(a => pessoas.find(p => p.id === a.employee_id)?.unit_id === u.id).map(a => a.employee_id)).size, quadro: pessoas.filter(p => p.unit_id === u.id).length }; });
    corpo = <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card title="Por benefício — custo mensal"><BarrasH rotulo="Custo mensal por benefício" formato={v => fmtMoeda(v)} itens={porPlano.sort((a, b) => b.empresa + b.colab - (a.empresa + a.colab)).map(p => ({ rotulo: p.plano, valor: p.empresa + p.colab, sub: `${p.pessoas} pessoa(s)`, segmentos: [{ valor: p.empresa, cor: COR.acao, rotulo: "escola" }, { valor: p.colab, cor: COR.neutro, rotulo: "colaborador" }] }))} largRotulo="11rem" /><p className="mt-1 text-[11px] text-slate-500">Azul: o que a escola paga · cinza: o que é descontado em folha.</p></Card>
      <Card title="Por unidade"><Table head={["Unidade", "Pessoas com benefício", "A escola paga/mês", "Por pessoa do quadro", "Desconto em folha/mês"]}>{porUnidade.map(x => <tr key={x.u.id}><Td>{x.u.nome}</Td><Td className="tabular-nums">{x.pessoas} de {x.quadro}</Td><Td className="text-xs">{fmtMoeda(x.empresa)}</Td><Td className="text-xs">{x.quadro ? fmtMoeda(x.empresa / x.quadro) : "—"}</Td><Td className="text-xs">{fmtMoeda(x.colab)}</Td></tr>)}</Table>
        <p className="mt-2 text-[11px] text-slate-500">Em 12 meses, a escola investe ~{fmtMoeda(empresaMes * 12)} em benefícios (estimativa pelas adesões ativas). O custo real do mês vem do resultado da folha (Custo de folha).</p></Card>
    </div>;
  }

  return (
    <Page title="Benefícios" sub={<>Catálogo, regras de elegibilidade e carência, adesões com dependentes e bolsa de estudos para filhos. O que muda no mês vai no pacote da folha. Valores por pessoa: só RH e Direção.</>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <Stat label="Benefícios ativos" value={planos.filter(p => p.ativo).length} href="/beneficios?aba=catalogo" /><Stat label="Pessoas com benefício" value={comBenef} hint={`de ${pessoas.length} no quadro`} href="/beneficios?aba=adesoes" />
        <Stat label="A escola paga por mês" value={fmtMoeda(empresaMes)} hint={`~${fmtMoeda(empresaMes * 12)} no ano`} href="/beneficios?aba=custo" /><Stat label="Descontado em folha" value={fmtMoeda(colabMes)} hint="por mês" href="/beneficios?aba=mes" /><Stat label="Bolsas para filhos" value={nBolsas} hint={bolsas.length ? fmtMoeda(bolsas.reduce((a, p) => a + p.empresa, 0)) + "/mês" : "sem plano de bolsa"} />
      </div>
      {abas}
      {corpo}
    </Page>
  );
}
