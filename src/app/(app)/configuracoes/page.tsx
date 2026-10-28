import { Modal } from "@/components/Modal";
import { redirect } from "next/navigation";
import { asc } from "drizzle-orm";
import { db, schema, sql } from "@/db";
import { requireSession, can, ROLE_LABEL, type Role } from "@/lib/auth";
import Link from "@/components/Link";
import { ATUACAO, ATUACOES, defDoCargo, telasDaAtuacao, rotuloAtuacao, type AcessoUsuario, type Substituicao } from "@/lib/acesso";
import { Page, Card, Flash, Table, Td, Field, Input, Select, Btn, Textarea, Badge } from "@/components/ui";
import { getSettings } from "@/lib/utils";
import { salvarUnidade, salvarEmpresa, salvarCargo, excluirCargo, salvarUsuario, salvarAlcadas, salvarChecklist, salvarDocsPadrao, salvarParamInsights } from "./actions";
import { salvarSerie, salvarParamMatriculas } from "../matriculas/actions";
import { redefinir2FA, gerarSenhaTemp, criarAcessosAutoatendimento } from "./actions";
import { salvarParamAtendimento } from "../atendimento/actions";
import { salvarParamGovernanca } from "../governanca/actions";
import { salvarParamAnalytics } from "../talentos/actions";
import { salvarParamEstrategia } from "../estrategia/gestao-actions";
import { ParametrosV24 } from "./_v24";
import { ParametrosV25 } from "./_v25";
import { ParametrosV27 } from "./_v27";
import { ParametrosV28 } from "./_v28";
import { ParametrosV30 } from "./_v30";

export const dynamic = "force-dynamic";
const ROLES: Role[] = ["DIRECAO", "RH", "DIRETOR_UNIDADE", "GESTOR", "COMERCIAL", "FINANCEIRO", "OPERACOES", "LEITURA", "COLABORADOR"];
const AREAS = ["Direção", "Pedagógica", "Administrativa", "Serviços"];

// rótulos dos pesos e metas do People Health (as chaves continuam as mesmas no banco)
const ROTULO_PESO: Record<string, string> = { turnover: "Rotatividade", absenteismo: "Absenteísmo", bancoHoras: "Banco de horas", enps: "eNPS", desempenho: "Desempenho", treinamento: "Treinamento", vagas: "Vagas abertas", clima: "Clima" };
const ROTULO_META: Record<string, string> = { turnoverAnualPct: "Rotatividade anual (%)", absenteismoPct: "Absenteísmo (%)", debitoMedioHoras: "Débito médio no banco (h)", enps: "eNPS mínimo", desempenho: "Desempenho médio (1–5)", treinamentoPct: "Treinamento concluído (%)", vagasAbertasPct: "Vagas abertas (% do quadro)" };

export default async function Configuracoes({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); if (!can.configurar(s)) redirect("/");
  const sp = await searchParams; const cfg = await getSettings();
  const grades = await db.select().from(schema.grades).orderBy(asc(schema.grades.ordem), asc(schema.grades.nome));
  const pedidos = await sql<{ user_id: number }[]>`SELECT DISTINCT user_id FROM password_resets WHERE usado_em IS NULL AND expira_em > now() AND via_email=false`; const pediu = new Set(pedidos.map(x => x.user_id));
  const [units, companies, positions, users, emps] = await Promise.all([
    db.select().from(schema.units).orderBy(asc(schema.units.nome)),
    db.select().from(schema.companies).orderBy(asc(schema.companies.nome)),
    db.select().from(schema.positions).orderBy(asc(schema.positions.ordem), asc(schema.positions.nome)),
    db.select().from(schema.users).orderBy(asc(schema.users.nome)),
    sql<{ id: number; nome: string; email: string | null; situacao: string; cargo: string | null; position_id: number | null; unidade: string | null }[]>`SELECT e.id, e.nome, e.email, e.situacao, p.nome AS cargo, e.position_id, un.nome AS unidade FROM employees e LEFT JOIN positions p ON p.id=e.position_id LEFT JOIN units un ON un.id=e.unit_id ORDER BY e.nome`,
  ]);
  const defs = new Map(positions.map(p => [p.id, defDoCargo(p)]));
  const fichaDe = (id: number | null) => emps.find(e => e.id === id);
  const comLogin = new Set(users.map(u => u.employeeId).filter(Boolean));
  const nomePos = (id: number | null) => positions.find(p => p.id === id)?.nome ?? "—";
  const nav = [["unidades", "Unidades"], ["empresas", "Empresas"], ["cargos", "Cargos"], ["usuarios", "Usuários e acessos"], ["alcadas", "Aprovações (padrão)"], ["checklists", "Checklists e documentos"], ["matriculas", "Matrículas: séries e prazos"], ["atendimento", "Atendimento: SLA e protocolos"], ["governanca", "Governança: áreas e prazos"], ["v24", "Nova Arquitetura: alertas, folha, SST, orçamento"], ["analytics", "People Health: pesos e metas"]];

  return (
    <Page title="Configurações" sub="Estrutura da rede, acessos e regras de aprovação. Toda alteração fica na auditoria.">
      <Flash ok={sp.ok} erro={sp.erro} />
      <nav className="mb-4 flex flex-wrap gap-2 text-sm"><Link href="/configuracoes/acessos" className="rounded border border-acao bg-sky-50 px-2.5 py-1 font-medium text-navy hover:bg-mist">Acesso por cargo →</Link>{nav.map(([id, l]) => <a key={id} href={`#${id}`} className="rounded border border-line bg-white px-2.5 py-1 text-navy hover:bg-mist">{l}</a>)}</nav>

      <Card title="Unidades" className="mb-4"><div id="unidades" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <Table head={["Nome", "Código", "Entidade (CNPJ)", ""]}>{units.map(u => <tr key={u.id}><Td>{u.nome}</Td><Td>{u.codigo}</Td><Td>{companies.find(c => c.id === u.companyId)?.nome ?? <span className="text-xs text-aviso">sem vínculo</span>}</Td><Td><Modal label={"Editar"} kind="link"><form action={salvarUnidade} className="flex flex-wrap items-end gap-2"><input type="hidden" name="id" value={u.id} /><Field label="Nome"><Input name="nome" defaultValue={u.nome} /></Field><Field label="Código"><Input name="codigo" defaultValue={u.codigo} className="w-24" /></Field><Field label="Entidade (CNPJ)" hint="Base do Consolidado e das visões por entidade (DRE, folha, obrigações)"><Select name="companyId" defaultValue={u.companyId ?? ""}><option value="">— sem vínculo —</option>{companies.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</Select></Field><Btn small>Salvar</Btn></form></Modal></Td></tr>)}</Table>
          <form action={salvarUnidade} className="space-y-2 rounded-md bg-mist p-3"><div className="text-sm font-semibold text-navy">Nova unidade</div><Field label="Nome"><Input name="nome" required /></Field><Field label="Código"><Input name="codigo" required placeholder="Ex.: CAR" /></Field><Btn small>Adicionar</Btn></form>
        </div>
      </Card>

      <Card title="Empresas (CNPJs empregadores)" className="mb-4"><div id="empresas" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <Table head={["Nome", "CNPJ", ""]}>{companies.map(c => <tr key={c.id}><Td>{c.nome}</Td><Td>{c.cnpj ?? "—"}</Td><Td><Modal label={"Editar"} kind="link"><form action={salvarEmpresa} className="flex flex-wrap items-end gap-2"><input type="hidden" name="id" value={c.id} /><Field label="Nome"><Input name="nome" defaultValue={c.nome} /></Field><Field label="CNPJ"><Input name="cnpj" defaultValue={c.cnpj ?? ""} /></Field><Btn small>Salvar</Btn></form></Modal></Td></tr>)}</Table>
          <form action={salvarEmpresa} className="space-y-2 rounded-md bg-mist p-3"><div className="text-sm font-semibold text-navy">Nova empresa</div><Field label="Nome"><Input name="nome" required /></Field><Field label="CNPJ"><Input name="cnpj" /></Field><Btn small>Adicionar</Btn></form>
        </div>
      </Card>

      <Card title="Cargos e organograma" className="mb-4"><div id="cargos" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <Table head={["Ordem", "Cargo", "Área", "Reporta a", "Acesso no sistema", ""]}>{positions.map(p => { const d = defs.get(p.id)!; return <tr key={p.id}><Td>{p.ordem}</Td><Td>{p.nome}{p.regulamentado && <span className="ml-1 text-xs text-slate-400">regulamentado</span>}</Td><Td>{p.area}</Td><Td>{nomePos(p.parentId)}</Td>
            <Td><Link href={`/configuracoes/acessos/cargo/${p.id}`} className="text-navy hover:underline">{ATUACAO[d.atuacao].curto}</Link><div className="text-[11px] text-slate-500">{d.telas ? `${d.telas.length} de ${telasDaAtuacao(d.atuacao).length} telas` : "todas as telas"}{d.aprova ? " · aprovações do cargo" : ""}</div></Td>
            <Td><div className="flex flex-wrap items-center gap-x-3 gap-y-1"><Link href={`/configuracoes/acessos/cargo/${p.id}`} className="text-xs text-acao hover:underline">Acesso</Link><Modal label={"Editar"} kind="link"><form action={salvarCargo} className="grid grid-cols-1 gap-2 sm:grid-cols-2"><input type="hidden" name="id" value={p.id} />
              <Field label="Nome"><Input name="nome" defaultValue={p.nome} /></Field><Field label="Área"><Select name="area" defaultValue={p.area}>{AREAS.map(a => <option key={a}>{a}</option>)}</Select></Field>
              <Field label="Reporta a"><Select name="parentId" defaultValue={p.parentId ?? ""}><option value="">— (topo)</option>{positions.filter(x => x.id !== p.id).map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field><Field label="Ordem"><Input name="ordem" type="number" defaultValue={p.ordem} /></Field>
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="regulamentado" value="1" defaultChecked={p.regulamentado} /> Profissão regulamentada</label><Field label="Formação exigida (se houver)"><Input name="formacaoExigida" defaultValue={p.formacaoExigida ?? ""} placeholder="Ex.: formação em educação especial" /></Field><Field label="Documento que comprova"><Input name="documentoFormacao" defaultValue={p.documentoFormacao ?? ""} placeholder="Diploma, Certificado…" /></Field><div><Btn small>Salvar</Btn></div></form></Modal>
            <form action={excluirCargo}><input type="hidden" name="id" value={p.id} /><Btn small danger>Excluir</Btn></form></div></Td></tr>; })}</Table>
          <form action={salvarCargo} className="space-y-2 rounded-md bg-mist p-3"><div className="text-sm font-semibold text-navy">Novo cargo</div>
            <Field label="Nome"><Input name="nome" required /></Field><Field label="Área"><Select name="area" defaultValue="Administrativa">{AREAS.map(a => <option key={a}>{a}</option>)}</Select></Field>
            <Field label="Reporta a"><Select name="parentId"><option value="">— (topo)</option>{positions.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field><Field label="Ordem"><Input name="ordem" type="number" defaultValue={100} /></Field>
            <Field label="Atuação no sistema" hint="Quem tiver este cargo entra com este acesso; as telas e aprovações se ajustam em Acesso."><Select name="atuacao" defaultValue="">{[<option key="" value="">sugerir pelo nome do cargo</option>, ...ATUACOES.map(r => <option key={r} value={r}>{ATUACAO[r].rotulo}</option>)]}</Select></Field>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="regulamentado" value="1" /> Profissão regulamentada</label><Field label="Formação exigida (se houver)"><Input name="formacaoExigida" /></Field><Field label="Documento que comprova"><Input name="documentoFormacao" placeholder="Diploma, Certificado…" /></Field><Btn small>Adicionar</Btn></form>
        </div>
      </Card>

      <Card title="Usuários e acessos" className="mb-4"><div id="usuarios" />
        <p className="mb-3 text-xs text-slate-600">O acesso de cada pessoa vem do <b>cargo da ficha</b>: o que ela vê, como atua e o que aprova são definidos uma vez, no cargo (<Link href="/configuracoes/acessos" className="text-acao underline">Acesso por cargo</Link>). Promoveu ou mudou o cargo na ficha, o acesso muda na próxima tela; desligou, o login deixa de entrar. Contas sem ficha (contabilidade externa, consultoria, TI, homologação) têm a atuação definida na própria conta.</p>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Table head={["Nome", "E-mail", "Cargo e acesso", "Alcance", "Situação", ""]}>{users.map(u => { const f = fichaDe(u.employeeId); const ua = (u.acesso ?? null) as AcessoUsuario | null; const sub = (u.substituicao ?? null) as Substituicao | null; const origem = u.origemAcesso ?? (u.employeeId ? "CARGO" : "DIRETO"); const r = (u.role in ATUACAO ? u.role : "LEITURA") as Role; return <tr key={u.id}><Td>{u.nome}</Td><Td>{u.email}</Td>
            <Td>{f ? <><span className="text-navy">{f.cargo ?? "ficha sem cargo"}</span><div className="text-[11px] text-slate-500">{rotuloAtuacao(r)}</div></> : <><span className="text-navy">Conta sem ficha</span><div className="text-[11px] text-slate-500">{rotuloAtuacao(r)}</div></>}
              {origem === "EXCECAO" && <div className="mt-0.5"><Badge v="PENDENTE" label="exceção" /></div>}{sub && sub.ate >= new Date().toISOString().slice(0, 10) && <div className="mt-0.5"><Badge v="ABERTO" label="substituindo" /></div>}</Td>
            <Td className="whitespace-nowrap">{ATUACAO[r].alcance === "UNIDADE" ? (units.find(x => x.id === u.unitId)?.nome ?? "unidade") : "rede"}</Td>
            <Td><Badge v={u.ativo ? "ATIVO" : "DESLIGADO"} label={u.ativo ? "Ativo" : f?.situacao === "DESLIGADO" ? "Encerrado (desligado)" : "Inativo"} />{u.totpAtivo && <Badge v="APROVADA" label="2FA" />}{pediu.has(u.id) && <div className="mt-1"><Badge v="PENDENTE" label="pediu nova senha" /><form action={gerarSenhaTemp} className="mt-1"><input type="hidden" name="id" value={u.id} /><Btn small>Gerar senha temporária</Btn></form></div>}{u.trocarSenha && <div className="text-xs text-aviso">senha temporária ativa</div>}</Td>
            <Td className="whitespace-nowrap"><div className="flex flex-col items-start gap-1"><Link href={`/configuracoes/acessos/usuario/${u.id}`} className="text-xs text-acao hover:underline">Ver acesso</Link><Modal label={"Editar"} kind="link"><form action={salvarUsuario} className="grid grid-cols-1 gap-2 sm:grid-cols-2"><input type="hidden" name="id" value={u.id} /><input type="hidden" name="modo" value={origem === "EXCECAO" ? "excecao" : "auto"} />
              <Field label="Nome"><Input name="nome" defaultValue={u.nome} /></Field><Field label="E-mail (login)"><Input name="email" defaultValue={u.email} /></Field>
              <Field label="Ficha vinculada" hint="Com ficha, o acesso vem do cargo dela." className="sm:col-span-2"><Select name="employeeId" defaultValue={u.employeeId ?? ""}><option value="">— conta sem ficha —</option>{emps.filter(e => e.id === u.employeeId || !comLogin.has(e.id)).map(e => <option key={e.id} value={e.id}>{`${e.nome}${e.cargo ? ` · ${e.cargo}` : ""}${e.situacao === "DESLIGADO" ? " (desligado)" : ""}`}</option>)}</Select></Field>
              {origem === "EXCECAO" ? <><Field label="Atuação (exceção individual)"><Select name="atuacao" defaultValue={ua?.atuacao ?? r}>{ATUACOES.map(x => <option key={x} value={x}>{ATUACAO[x].rotulo}</option>)}</Select></Field><Field label="Motivo da exceção"><Input name="motivo" defaultValue={ua?.motivo ?? ""} /></Field></>
                : <Field label="Atuação (só conta sem ficha)" hint="Ignorada quando há ficha: vale a do cargo."><Select name="atuacao" defaultValue={r}>{ATUACOES.filter(x => x !== "COLABORADOR").map(x => <option key={x} value={x}>{ATUACAO[x].rotulo}</option>)}</Select></Field>}
              <Field label="Unidade (conta sem ficha)" hint="Obrigatória para Direção da unidade e Coordenação"><Select name="unitId" defaultValue={u.unitId ?? ""}><option value="">Rede</option>{units.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field>
              <Field label="Nova senha (opcional)"><Input name="senha" type="password" autoComplete="new-password" /></Field>
              <Field label="Situação"><Select name="ativo" defaultValue={u.ativo ? "1" : "0"}><option value="1">Ativo</option><option value="0">Inativo</option></Select></Field><div className="flex items-end"><Btn small>Salvar</Btn></div></form>
              <p className="mt-2 text-xs text-slate-500">Exceção individual (com motivo), substituição temporária e as telas de conta sem ficha: <Link href={`/configuracoes/acessos/usuario/${u.id}`} className="text-acao underline">Ver acesso</Link>.</p>
              <form action={gerarSenhaTemp} className="mt-2 border-t border-line pt-2"><input type="hidden" name="id" value={u.id} /><Btn small kind="ghost">Gerar senha temporária</Btn><p className="mt-1 text-xs text-slate-500">Mostrada uma vez; o usuário é obrigado a trocar no primeiro acesso. Use na entrega do acesso ou quando a pessoa esquecer a senha.</p></form>{u.totpAtivo && <form action={redefinir2FA} className="mt-2"><input type="hidden" name="id" value={u.id} /><button className="text-xs text-erro underline">Redefinir verificação em duas etapas (perdeu o celular)</button></form>}</Modal></div></Td></tr>; })}</Table>
          <form action={salvarUsuario} className="space-y-2 rounded-md bg-mist p-3"><div className="text-sm font-semibold text-navy">Novo acesso</div><input type="hidden" name="modo" value="auto" />
            <Field label="Pessoa (ficha)" hint="O acesso vem do cargo da ficha — não precisa escolher mais nada."><Select name="employeeId" defaultValue="">{[<option key="" value="">— escolha a pessoa —</option>, ...emps.filter(e => e.situacao !== "DESLIGADO" && !comLogin.has(e.id)).map(e => <option key={e.id} value={e.id}>{`${e.nome}${e.cargo ? ` · ${e.cargo}` : " · sem cargo"}${e.unidade ? ` · ${e.unidade}` : ""}`}</option>), <option key="0" value="0">Conta sem ficha (contabilidade, consultoria, TI)</option>]}</Select></Field>
            <Field label="Nome" hint="Em branco = o da ficha."><Input name="nome" /></Field><Field label="E-mail (login)" hint="Em branco = o e-mail da ficha."><Input name="email" /></Field>
            <details className="rounded-md border border-line bg-white px-2 py-1.5"><summary className="cursor-pointer text-xs font-medium text-navy">Só para conta sem ficha: atuação e unidade</summary>
              <div className="mt-2 space-y-2"><Field label="Atuação"><Select name="atuacao" defaultValue="LEITURA">{ATUACOES.filter(x => x !== "COLABORADOR").map(x => <option key={x} value={x}>{ATUACAO[x].rotulo}</option>)}</Select></Field>
              <Field label="Unidade" hint="Obrigatória para Direção da unidade e Coordenação"><Select name="unitId"><option value="">Rede</option>{units.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field>
              <p className="text-[11px] text-slate-500">As telas e aprovações da conta se ajustam depois, em “Ver acesso”.</p></div></details>
            <Field label="Senha inicial" hint="Em branco = o sistema gera uma senha temporária, mostrada uma vez; a troca é obrigatória no primeiro acesso."><Input name="senha" type="password" minLength={8} autoComplete="new-password" /></Field><Btn small>Criar acesso</Btn></form>
        </div>
        <form action={criarAcessosAutoatendimento} className="mt-4 flex flex-wrap items-end gap-2 rounded-md border border-line p-3"><div className="w-full text-sm font-semibold text-navy">Acessos em lote (pelo cargo de cada ficha)</div>
          <p className="w-full text-xs text-slate-600">Cria o login de quem tem e-mail na ficha e ainda não tem acesso (ativos e em admissão); cada pessoa já entra com o acesso do próprio cargo (professor: autoatendimento; coordenação: a da coordenação, e assim por diante). Ninguém conhece a senha criada: a pessoa entra por “Esqueci minha senha” ou recebe do RH uma senha temporária (Editar → Gerar senha temporária).</p>
          <Field label="Unidade"><Select name="unitId" defaultValue=""><option value="">Todas</option>{units.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field>
          <Btn small>Criar acessos de quem ainda não tem</Btn></form>
        <p className="mt-3 text-xs text-slate-500">Atuações: Direção da rede e RH veem a rede e configuram; Direção da unidade e Coordenação ficam na unidade da pessoa; Financeiro, Comercial, Operações e Consulta atuam na rede; Autoatendimento vê só a própria ficha. Salário e CPF só aparecem para RH e Direção. Toda alteração de acesso fica na auditoria.</p>
      </Card>

      <Card title="Aprovações — padrão de cada atuação" className="mb-4" actions={<Link href="/configuracoes/acessos?aba=aprovacoes" className="text-xs text-acao hover:underline">Quem aprova o quê, por cargo →</Link>}><div id="alcadas" />
        <p className="mb-3 text-xs text-slate-600">Ponto de partida das aprovações: cargo que não personalizou as aprovações (e conta sem ficha) segue este padrão pela atuação. Para o gerente aprovar e o auxiliar não, marque no cargo (Acesso por cargo → Quem aprova o quê).</p>
        <form action={salvarAlcadas} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {([["ferias", "Férias e afastamentos"], ["banco", "Banco de horas"], ["processos", "Concluir admissão/desligamento"], ["matricula", "Confirmar matrícula (contrato + financeiro)"], ["excecaoCapacidade", "Matrícula acima da capacidade"], ["excecao", "Aprovar exceções a POPs e regras"], ["pops", "Publicar POPs e registrar decisões"], ["vagas", "Aprovar requisição de vaga"], ["remuneracao", "Alterar faixas e salários"], ["calibracao", "Calibrar e encerrar ciclos de desempenho"], ["financeiro", "Importar títulos e caixa, orçamento, preços e plano de contas"]] as const).map(([k, label]) => (
            <fieldset key={k} className="rounded-md border border-line p-3"><legend className="px-1 text-sm font-medium text-navy">{label}</legend>
              {ROLES.filter(r => r !== "LEITURA" && r !== "COLABORADOR").map(r => <label key={r} className="flex items-center gap-2 py-0.5 text-sm"><input type="checkbox" name={k} value={r} defaultChecked={cfg.alcadas[k].includes(r)} /> {ROLE_LABEL[r]}</label>)}
            </fieldset>
          ))}
          <div className="sm:col-span-3"><Btn>Salvar o padrão das atuações</Btn> <span className="ml-2 text-xs text-slate-500">Quem solicita nunca aprova a própria solicitação (exceto RH/Direção).</span></div>
        </form>
      </Card>

      <Card title="Checklists e documentos padrão" className="mb-4"><div id="checklists" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <form action={salvarChecklist} className="space-y-2"><input type="hidden" name="key" value="admissao" /><Field label="Checklist de admissão (um item por linha)"><Textarea name="itens" className="min-h-[220px]" defaultValue={cfg.admissao.join("\n")} /></Field><Btn small>Salvar</Btn></form>
          <form action={salvarChecklist} className="space-y-2"><input type="hidden" name="key" value="desligamento" /><Field label="Checklist de desligamento"><Textarea name="itens" className="min-h-[220px]" defaultValue={cfg.desligamento.join("\n")} /></Field><Btn small>Salvar</Btn></form>
          <form action={salvarDocsPadrao} className="space-y-2"><Field label="Documentos padrão" hint="Escreva (opcional) no fim da linha para não exigir."><Textarea name="itens" className="min-h-[220px]" defaultValue={cfg.documentos.map(([t, o]) => `${t}${o ? "" : " (opcional)"}`).join("\n")} /></Field><Btn small>Salvar</Btn></form>
        </div>
      </Card>

      <Card title="Matrículas — séries, ano letivo e prazos" className="mb-4"><div id="matriculas" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Table head={["Ordem", "Série", "Segmento", ""]}>{grades.map(g => <tr key={g.id}><Td>{g.ordem}</Td><Td>{g.nome}</Td><Td>{g.segmento}</Td><Td><Modal label={"Editar"} kind="link"><form action={salvarSerie} className="flex flex-wrap items-end gap-2"><input type="hidden" name="id" value={g.id} /><Field label="Nome"><Input name="nome" defaultValue={g.nome} /></Field><Field label="Segmento"><Input name="segmento" defaultValue={g.segmento} /></Field><Field label="Ordem"><Input name="ordem" type="number" defaultValue={g.ordem} className="w-20" /></Field><Btn small>Salvar</Btn></form></Modal></Td></tr>)}</Table>
          <div className="space-y-4">
            <form action={salvarParamMatriculas} className="space-y-2 rounded-md bg-mist p-3"><div className="text-sm font-semibold text-navy">Parâmetros</div>
              <Field label="Ano letivo em captação"><Input name="anoLetivo" type="number" defaultValue={cfg.matriculas.anoLetivo} /></Field>
              <Field label="Prazo padrão da reserva (dias)"><Input name="reservaDias" type="number" min={1} defaultValue={cfg.matriculas.reservaDias} /></Field>
              <Field label="Prazo da oferta na fila (dias)"><Input name="ofertaFilaDias" type="number" min={1} defaultValue={cfg.matriculas.ofertaFilaDias} /></Field>
              <Field label="Fim da campanha de matrículas" hint={`para a previsão; vazio = 31/01/${cfg.matriculas.anoLetivo}`}><Input name="fimCampanha" type="date" defaultValue={String(cfg.matriculas.fimCampanha ?? "")} /></Field>
              <Field label="Meta de rematrícula (%)" hint="padrão das metas por unidade"><Input name="metaRematriculaPct" type="number" min={1} max={100} defaultValue={Number(cfg.matriculas.metaRematriculaPct ?? 85)} /></Field>
              <Btn small>Salvar</Btn></form>
            <form action={salvarSerie} className="space-y-2 rounded-md bg-mist p-3"><div className="text-sm font-semibold text-navy">Nova série</div><Field label="Nome"><Input name="nome" required /></Field><Field label="Segmento"><Input name="segmento" required placeholder="Ex.: Fundamental I" /></Field><Field label="Ordem"><Input name="ordem" type="number" defaultValue={100} /></Field><Btn small>Adicionar</Btn></form>
          </div>
        </div>
      </Card>
      <Card title="Atendimento — SLA, categorias e protocolos" className="mb-4"><div id="atendimento" />
        <form action={salvarParamAtendimento} className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="space-y-2">
            <div className="text-sm font-semibold text-navy">Prazo de resposta (horas)</div>
            {(["URGENTE", "ALTA", "NORMAL", "BAIXA"] as const).map(k => <Field key={k} label={k.charAt(0) + k.slice(1).toLowerCase()}><Input name={`sla_${k}`} type="number" min={1} defaultValue={(cfg.atendimento.slaHoras as Record<string, number>)[k]} /></Field>)}
            <Field label="Aluno atual sem rematrícula conta como risco a partir de"><Input name="riscoRematriculaApos" type="date" defaultValue={cfg.atendimento.riscoRematriculaApos} /></Field>
            <Field label="Categorias de reclamação (uma por linha)"><Textarea name="categorias" className="min-h-[140px]" defaultValue={cfg.atendimento.categorias.join("\n")} /></Field>
          </div>
          <Field label="Service Recovery — passos para reclamações"><Textarea name="recovery" className="min-h-[300px]" defaultValue={cfg.atendimento.recovery.join("\n")} /></Field>
          <Field label="Protocolo de retenção — passos para pedidos de saída"><Textarea name="retencao" className="min-h-[300px]" defaultValue={cfg.atendimento.retencao.join("\n")} /></Field>
          <div className="lg:col-span-3"><Btn>Salvar parâmetros de atendimento</Btn> <span className="ml-2 text-xs text-slate-500">Os passos valem para os próximos casos abertos.</span></div>
        </form>
      </Card>
      <Card title="Governança — áreas, motivos de exceção e prazos" className="mb-4"><div id="governanca" />
        <form action={salvarParamGovernanca} className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Field label="Áreas de processo (uma por linha)"><Textarea name="areas" className="min-h-[200px]" defaultValue={cfg.governanca.areas.join("\n")} /></Field>
          <Field label="Motivos padronizados de exceção"><Textarea name="motivosExcecao" className="min-h-[200px]" defaultValue={cfg.governanca.motivosExcecao.join("\n")} /></Field>
          <div className="space-y-2"><Field label="Revisão de POP a cada (meses)"><Input name="revisaoPopMeses" type="number" min={1} defaultValue={cfg.governanca.revisaoPopMeses} /></Field><Field label="Validade padrão de exceção (dias)"><Input name="excecaoValidadeDias" type="number" min={1} defaultValue={cfg.governanca.excecaoValidadeDias} /></Field></div>
          <div className="lg:col-span-3"><Btn>Salvar parâmetros de governança</Btn></div>
        </form>
      </Card>
      <Card title="Estratégia — ciclo, perspectivas, saúde estratégica e rituais" className="mb-4"><div id="estrategia" />
        <form action={salvarParamEstrategia} className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="space-y-2">
            <Field label="Ciclo atual"><Input name="cicloAtual" defaultValue={cfg.estrategia.cicloAtual} /></Field>
            <Field label="Pilares (um por linha)"><Textarea name="pilares" className="min-h-[130px]" defaultValue={(cfg.estrategia.pilares as string[]).join("\n")} /></Field>
            <Field label="Projeto sem status report vira alerta após (dias)"><Input name="atualizacaoProjetoDias" type="number" min={1} max={120} defaultValue={cfg.estrategia.atualizacaoProjetoDias} /></Field>
            <Field label="Áreas dos indicadores (uma por linha)"><Textarea name="areasIndicador" className="min-h-[120px]" defaultValue={(cfg.estrategia.areasIndicador as string[]).join("\n")} /></Field>
          </div>
          <div className="space-y-2">
            <div className="text-sm font-semibold text-navy">Perspectivas do mapa (de cima para baixo)</div>
            {(cfg.estrategia.perspectivas as { chave: string; nome: string; descricao: string }[]).map(p => <div key={p.chave} className="grid grid-cols-[8rem_minmax(0,1fr)] gap-1.5"><Input name={`persp_nome_${p.chave}`} defaultValue={p.nome} aria-label={`Nome da perspectiva ${p.chave}`} /><Input name={`persp_desc_${p.chave}`} defaultValue={p.descricao} aria-label={`Descrição da perspectiva ${p.chave}`} /></div>)}
            <div className="pt-2 text-sm font-semibold text-navy">Perspectiva sugerida para cada pilar</div>
            {(cfg.estrategia.pilares as string[]).map((pl, i) => <div key={pl} className="grid grid-cols-[minmax(0,1fr)_10rem] items-center gap-1.5 text-xs"><span>{pl}<input type="hidden" name={`mapaPilar_${i}`} value={pl} /></span><Select name={`mapa_${i}`} defaultValue={(cfg.estrategia.perspectivaDoPilar as Record<string, string>)[pl] ?? ""}><option value="">—</option>{(cfg.estrategia.perspectivas as { chave: string; nome: string }[]).map(p => <option key={p.chave} value={p.chave}>{p.nome}</option>)}</Select></div>)}
          </div>
          <div className="space-y-2">
            <div className="text-sm font-semibold text-navy">Saúde estratégica — pesos</div>
            <div className="grid grid-cols-2 gap-2">{([["okrs", "Progresso dos OKRs"], ["indicadores", "Indicadores no alvo"], ["projetos", "Projetos sem risco"], ["acoes", "Ações em dia"], ["rituais", "Rituais em dia"]] as const).map(([k, l]) => <Field key={k} label={l}><Input name={`peso_${k}`} type="number" min={0} max={100} defaultValue={(cfg.estrategia.pesosSaude as Record<string, number>)[k] ?? 0} /></Field>)}</div>
            <div className="grid grid-cols-2 gap-2"><Field label="Atenção a partir de"><Input name="faixaAtencao" type="number" min={1} max={99} defaultValue={(cfg.estrategia.faixasSaude as number[])[0]} /></Field><Field label="Boa a partir de"><Input name="faixaBoa" type="number" min={2} max={100} defaultValue={(cfg.estrategia.faixasSaude as number[])[1]} /></Field></div>
            <div className="grid grid-cols-2 gap-2"><Field label="Ritual atrasado após (dias)"><Input name="toleranciaRitualDias" type="number" min={0} max={30} defaultValue={cfg.estrategia.toleranciaRitualDias} /></Field><Field label="Ata pendente após (dias)"><Input name="ataPendenteDias" type="number" min={0} max={30} defaultValue={cfg.estrategia.ataPendenteDias} /></Field></div>
            <p className="text-xs text-slate-500">Componente sem base de cálculo sai da conta e o peso é redistribuído entre os demais.</p>
          </div>
          <div className="lg:col-span-3"><Btn>Salvar parâmetros da estratégia</Btn></div>
        </form>
      </Card>
      <Card title="Insights — farol dos indicadores, resumo, lembretes, prazos e caixa" className="mb-4"><div id="insights" />
        <form action={salvarParamInsights} className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="space-y-2">
            <div className="text-sm font-semibold text-navy">Painel Executivo</div>
            <Field label="Tolerância do farol (% da meta)" hint="sem limite de atenção cadastrado, o indicador fica em atenção até esta distância da meta"><Input name="toleranciaPct" type="number" min={1} max={50} defaultValue={Number(cfg.insights?.toleranciaPct ?? 10)} /></Field>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="resumoSemanal" value="1" defaultChecked={cfg.insights?.resumoSemanal !== false} className="mt-1" /><span>Enviar o resumo executivo da semana (segunda-feira) para quem assinou</span></label>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="lembretePendencias" value="1" defaultChecked={cfg.insights?.lembretePendencias !== false} className="mt-1" /><span>Lembrete diário das pendências vencidas e de hoje (dias úteis; só números e módulos, nunca o conteúdo)</span></label>
          </div>
          <div className="space-y-2">
            <div className="text-sm font-semibold text-navy">Central de fluxos e SLA</div>
            <Field label="Em risco quando resta até (% do prazo)"><Input name="riscoPct" type="number" min={5} max={90} defaultValue={Number(cfg.fluxos?.riscoPct ?? 25)} /></Field>
            <Field label="Prazo para decidir vagas, descontos e exceções (dias)"><Input name="prazoDecisaoDias" type="number" min={1} max={30} defaultValue={Number(cfg.fluxos?.prazoDecisaoDias ?? 2)} /></Field>
            <Field label="Prazo para aprovar férias e afastamentos (dias)" hint="nunca depois da véspera do início"><Input name="prazoFeriasDias" type="number" min={1} max={30} defaultValue={Number(cfg.fluxos?.prazoFeriasDias ?? 3)} /></Field>
          </div>
          <div className="space-y-2">
            <div className="text-sm font-semibold text-navy">Caixa projetado — recebimento esperado</div>
            <Field label="Cenário pessimista (%)"><Input name="cenarioPessimistaPct" type="number" min={0} max={100} defaultValue={Number(cfg.fpa?.cenarioPessimistaPct ?? 85)} /></Field>
            <Field label="Cenário otimista (%)"><Input name="cenarioOtimistaPct" type="number" min={0} max={100} defaultValue={Number(cfg.fpa?.cenarioOtimistaPct ?? 100)} /></Field>
            <Field label="Reserva mínima de caixa da rede (R$)" hint="0 = só o alerta de saldo negativo"><Input name="reservaMinima" type="number" min={0} step={1000} defaultValue={Number(cfg.fpa?.reservaMinima ?? 0)} /></Field>
            <p className="text-xs text-slate-500">A faixa do caixa projetado vai do pessimista ao otimista sobre o que está previsto para entrar. Abaixo da reserva no cenário pessimista, o caixa projetado e a central de alertas avisam.</p>
          </div>
          <div className="lg:col-span-3"><Btn>Salvar parâmetros do Insights</Btn></div>
        </form>
      </Card>
      <ParametrosV24 />
      <ParametrosV25 />
      <ParametrosV27 />
      <ParametrosV28 />
      <ParametrosV30 />
      <Card title="People Health — pesos e metas" className="mb-4"><div id="analytics" />
        <form action={salvarParamAnalytics} className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div><div className="mb-1 text-sm font-semibold text-navy">Pesos (somam até 100)</div><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{Object.entries(cfg.analytics.pesos).map(([k, v]) => <Field key={k} label={ROTULO_PESO[k] ?? k}><Input name={`peso_${k}`} type="number" min={0} max={40} defaultValue={v as number} /></Field>)}</div></div>
          <div><div className="mb-1 text-sm font-semibold text-navy">Metas</div><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{Object.entries(cfg.analytics.metas).map(([k, v]) => <Field key={k} label={ROTULO_META[k] ?? k}><Input name={`meta_${k}`} type="number" step="0.1" defaultValue={v as number} /></Field>)}<Field label="Custo de reposição (salários)"><Input name="custoReposicaoSalarios" type="number" step="0.5" defaultValue={cfg.analytics.custoReposicaoSalarios} /></Field></div></div>
          <div className="lg:col-span-2"><Btn>Salvar pesos e metas</Btn></div>
        </form>
      </Card>
    </Page>
  );
}
