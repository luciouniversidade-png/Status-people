import { Modal } from "@/components/Modal";
import { redirect } from "next/navigation";
import { asc } from "drizzle-orm";
import { db, schema, sql } from "@/db";
import { requireSession, can, ROLE_LABEL, type Role } from "@/lib/auth";
import { Page, Card, Flash, Table, Td, Field, Input, Select, Btn, Textarea, Badge } from "@/components/ui";
import { getSettings } from "@/lib/utils";
import { salvarUnidade, salvarEmpresa, salvarCargo, excluirCargo, salvarUsuario, salvarAlcadas, salvarChecklist, salvarDocsPadrao } from "./actions";
import { salvarSerie, salvarParamMatriculas } from "../matriculas/actions";
import { redefinir2FA, gerarSenhaTemp } from "./actions";
import { salvarParamAtendimento } from "../atendimento/actions";
import { salvarParamGovernanca } from "../governanca/actions";
import { salvarParamAnalytics } from "../talentos/actions";

export const dynamic = "force-dynamic";
const ROLES: Role[] = ["DIRECAO", "RH", "DIRETOR_UNIDADE", "GESTOR", "COMERCIAL", "FINANCEIRO", "OPERACOES", "LEITURA", "COLABORADOR"];
const AREAS = ["Direção", "Pedagógica", "Administrativa", "Serviços"];

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
    db.select({ id: schema.employees.id, nome: schema.employees.nome }).from(schema.employees).orderBy(asc(schema.employees.nome)),
  ]);
  const nomePos = (id: number | null) => positions.find(p => p.id === id)?.nome ?? "—";
  const nav = [["unidades", "Unidades"], ["empresas", "Empresas"], ["cargos", "Cargos"], ["usuarios", "Usuários e acessos"], ["alcadas", "Alçadas"], ["checklists", "Checklists e documentos"], ["matriculas", "Matrículas: séries e prazos"], ["atendimento", "Atendimento: SLA e protocolos"], ["governanca", "Governança: áreas e prazos"], ["analytics", "People Health: pesos e metas"]];

  return (
    <Page title="Configurações" sub="Estrutura da rede, acessos e regras de aprovação. Toda alteração fica na auditoria.">
      <Flash ok={sp.ok} erro={sp.erro} />
      <nav className="mb-4 flex flex-wrap gap-2 text-sm">{nav.map(([id, l]) => <a key={id} href={`#${id}`} className="rounded border border-line bg-white px-2.5 py-1 text-navy hover:bg-mist">{l}</a>)}</nav>

      <Card title="Unidades" className="mb-4"><div id="unidades" />
        <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
          <Table head={["Nome", "Código", ""]}>{units.map(u => <tr key={u.id}><Td>{u.nome}</Td><Td>{u.codigo}</Td><Td><Modal label={"Editar"} kind="link"><form action={salvarUnidade} className="flex flex-wrap items-end gap-2"><input type="hidden" name="id" value={u.id} /><Field label="Nome"><Input name="nome" defaultValue={u.nome} /></Field><Field label="Código"><Input name="codigo" defaultValue={u.codigo} className="w-24" /></Field><Btn small>Salvar</Btn></form></Modal></Td></tr>)}</Table>
          <form action={salvarUnidade} className="space-y-2 rounded-md bg-mist p-3"><div className="text-sm font-semibold text-navy">Nova unidade</div><Field label="Nome"><Input name="nome" required /></Field><Field label="Código"><Input name="codigo" required placeholder="Ex.: CAR" /></Field><Btn small>Adicionar</Btn></form>
        </div>
      </Card>

      <Card title="Empresas (CNPJs empregadores)" className="mb-4"><div id="empresas" />
        <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
          <Table head={["Nome", "CNPJ", ""]}>{companies.map(c => <tr key={c.id}><Td>{c.nome}</Td><Td>{c.cnpj ?? "—"}</Td><Td><Modal label={"Editar"} kind="link"><form action={salvarEmpresa} className="flex flex-wrap items-end gap-2"><input type="hidden" name="id" value={c.id} /><Field label="Nome"><Input name="nome" defaultValue={c.nome} /></Field><Field label="CNPJ"><Input name="cnpj" defaultValue={c.cnpj ?? ""} /></Field><Btn small>Salvar</Btn></form></Modal></Td></tr>)}</Table>
          <form action={salvarEmpresa} className="space-y-2 rounded-md bg-mist p-3"><div className="text-sm font-semibold text-navy">Nova empresa</div><Field label="Nome"><Input name="nome" required /></Field><Field label="CNPJ"><Input name="cnpj" /></Field><Btn small>Adicionar</Btn></form>
        </div>
      </Card>

      <Card title="Cargos e organograma" className="mb-4"><div id="cargos" />
        <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
          <Table head={["Ordem", "Cargo", "Área", "Reporta a", "", ""]}>{positions.map(p => <tr key={p.id}><Td>{p.ordem}</Td><Td>{p.nome}{p.regulamentado && <span className="ml-1 text-xs text-slate-400">regulamentado</span>}</Td><Td>{p.area}</Td><Td>{nomePos(p.parentId)}</Td>
            <Td><Modal label={"Editar"} kind="link"><form action={salvarCargo} className="grid gap-2 sm:grid-cols-2"><input type="hidden" name="id" value={p.id} />
              <Field label="Nome"><Input name="nome" defaultValue={p.nome} /></Field><Field label="Área"><Select name="area" defaultValue={p.area}>{AREAS.map(a => <option key={a}>{a}</option>)}</Select></Field>
              <Field label="Reporta a"><Select name="parentId" defaultValue={p.parentId ?? ""}><option value="">— (topo)</option>{positions.filter(x => x.id !== p.id).map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field><Field label="Ordem"><Input name="ordem" type="number" defaultValue={p.ordem} /></Field>
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="regulamentado" value="1" defaultChecked={p.regulamentado} /> Profissão regulamentada</label><div><Btn small>Salvar</Btn></div></form></Modal></Td>
            <Td><form action={excluirCargo}><input type="hidden" name="id" value={p.id} /><Btn small danger>Excluir</Btn></form></Td></tr>)}</Table>
          <form action={salvarCargo} className="space-y-2 rounded-md bg-mist p-3"><div className="text-sm font-semibold text-navy">Novo cargo</div>
            <Field label="Nome"><Input name="nome" required /></Field><Field label="Área"><Select name="area" defaultValue="Administrativa">{AREAS.map(a => <option key={a}>{a}</option>)}</Select></Field>
            <Field label="Reporta a"><Select name="parentId"><option value="">— (topo)</option>{positions.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field><Field label="Ordem"><Input name="ordem" type="number" defaultValue={100} /></Field>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="regulamentado" value="1" /> Profissão regulamentada</label><Btn small>Adicionar</Btn></form>
        </div>
      </Card>

      <Card title="Usuários e acessos" className="mb-4"><div id="usuarios" />
        <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
          <Table head={["Nome", "E-mail", "Perfil", "Unidade", "Situação", ""]}>{users.map(u => <tr key={u.id}><Td>{u.nome}</Td><Td>{u.email}</Td><Td>{ROLE_LABEL[u.role as Role] ?? u.role}</Td><Td>{units.find(x => x.id === u.unitId)?.nome ?? "rede"}</Td><Td><Badge v={u.ativo ? "ATIVO" : "DESLIGADO"} label={u.ativo ? "Ativo" : "Inativo"} />{u.totpAtivo && <Badge v="APROVADA" label="2FA" />}{pediu.has(u.id) && <div className="mt-1"><Badge v="PENDENTE" label="pediu nova senha" /><form action={gerarSenhaTemp} className="mt-1"><input type="hidden" name="id" value={u.id} /><Btn small>Gerar senha temporária</Btn></form></div>}{u.trocarSenha && <div className="text-xs text-aviso">senha temporária ativa</div>}</Td>
            <Td><Modal label={"Editar"} kind="link"><form action={salvarUsuario} className="grid gap-2 sm:grid-cols-2"><input type="hidden" name="id" value={u.id} />
              <Field label="Nome"><Input name="nome" defaultValue={u.nome} /></Field><Field label="E-mail"><Input name="email" defaultValue={u.email} /></Field>
              <Field label="Perfil"><Select name="role" defaultValue={u.role}>{ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</Select></Field><Field label="Unidade (escopo)"><Select name="unitId" defaultValue={u.unitId ?? ""}><option value="">Rede</option>{units.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field>
              <Field label="Colaborador vinculado"><Select name="employeeId" defaultValue={u.employeeId ?? ""}><option value="">—</option>{emps.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}</Select></Field><Field label="Nova senha (opcional)"><Input name="senha" type="password" autoComplete="new-password" /></Field>
              <Field label="Situação"><Select name="ativo" defaultValue={u.ativo ? "1" : "0"}><option value="1">Ativo</option><option value="0">Inativo</option></Select></Field><div className="flex items-end"><Btn small>Salvar</Btn></div></form>{u.totpAtivo && <form action={redefinir2FA} className="mt-2"><input type="hidden" name="id" value={u.id} /><button className="text-xs text-erro underline">Redefinir verificação em duas etapas (perdeu o celular)</button></form>}</Modal></Td></tr>)}</Table>
          <form action={salvarUsuario} className="space-y-2 rounded-md bg-mist p-3"><div className="text-sm font-semibold text-navy">Novo usuário</div>
            <Field label="Nome"><Input name="nome" required /></Field><Field label="E-mail (login)"><Input name="email" required /></Field>
            <Field label="Perfil"><Select name="role" defaultValue="GESTOR">{ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</Select></Field>
            <Field label="Unidade (escopo)" hint="Obrigatória para Diretor de unidade e Gestor"><Select name="unitId"><option value="">Rede</option>{units.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field>
            <Field label="Colaborador vinculado"><Select name="employeeId"><option value="">—</option>{emps.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}</Select></Field>
            <Field label="Senha inicial"><Input name="senha" type="password" required minLength={8} autoComplete="new-password" /></Field><Btn small>Criar acesso</Btn></form>
        </div>
        <p className="mt-3 text-xs text-slate-500">Perfis: Direção e RH veem tudo e editam; Diretor de unidade e Gestor veem só a própria unidade e podem solicitar; Somente leitura consulta; Colaborador (autoatendimento) vê apenas a própria ficha, pede férias e lança horas para aprovação — exige o colaborador vinculado. Salário e CPF só aparecem para RH e Direção.</p>
      </Card>

      <Card title="Alçadas de aprovação" className="mb-4"><div id="alcadas" />
        <form action={salvarAlcadas} className="grid gap-4 sm:grid-cols-3">
          {([["ferias", "Férias e afastamentos"], ["banco", "Banco de horas"], ["processos", "Concluir admissão/desligamento"], ["matricula", "Confirmar matrícula (contrato + financeiro)"], ["excecaoCapacidade", "Matrícula acima da capacidade"], ["excecao", "Aprovar exceções a POPs e regras"], ["pops", "Publicar POPs e registrar decisões"], ["vagas", "Aprovar requisição de vaga"], ["remuneracao", "Alterar faixas e salários"], ["calibracao", "Calibrar e encerrar ciclos de desempenho"], ["financeiro", "Importar títulos e caixa, orçamento, preços"]] as const).map(([k, label]) => (
            <fieldset key={k} className="rounded-md border border-line p-3"><legend className="px-1 text-sm font-medium text-navy">{label}</legend>
              {ROLES.filter(r => r !== "LEITURA" && r !== "COLABORADOR").map(r => <label key={r} className="flex items-center gap-2 py-0.5 text-sm"><input type="checkbox" name={k} value={r} defaultChecked={cfg.alcadas[k].includes(r)} /> {ROLE_LABEL[r]}</label>)}
            </fieldset>
          ))}
          <div className="sm:col-span-3"><Btn>Salvar alçadas</Btn> <span className="ml-2 text-xs text-slate-500">Quem solicita nunca aprova a própria solicitação (exceto RH/Direção).</span></div>
        </form>
      </Card>

      <Card title="Checklists e documentos padrão" className="mb-4"><div id="checklists" />
        <div className="grid gap-4 lg:grid-cols-3">
          <form action={salvarChecklist} className="space-y-2"><input type="hidden" name="key" value="admissao" /><Field label="Checklist de admissão (um item por linha)"><Textarea name="itens" className="min-h-[220px]" defaultValue={cfg.admissao.join("\n")} /></Field><Btn small>Salvar</Btn></form>
          <form action={salvarChecklist} className="space-y-2"><input type="hidden" name="key" value="desligamento" /><Field label="Checklist de desligamento"><Textarea name="itens" className="min-h-[220px]" defaultValue={cfg.desligamento.join("\n")} /></Field><Btn small>Salvar</Btn></form>
          <form action={salvarDocsPadrao} className="space-y-2"><Field label="Documentos padrão" hint="Escreva (opcional) no fim da linha para não exigir."><Textarea name="itens" className="min-h-[220px]" defaultValue={cfg.documentos.map(([t, o]) => `${t}${o ? "" : " (opcional)"}`).join("\n")} /></Field><Btn small>Salvar</Btn></form>
        </div>
      </Card>

      <Card title="Matrículas — séries, ano letivo e prazos" className="mb-4"><div id="matriculas" />
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <Table head={["Ordem", "Série", "Segmento", ""]}>{grades.map(g => <tr key={g.id}><Td>{g.ordem}</Td><Td>{g.nome}</Td><Td>{g.segmento}</Td><Td><Modal label={"Editar"} kind="link"><form action={salvarSerie} className="flex flex-wrap items-end gap-2"><input type="hidden" name="id" value={g.id} /><Field label="Nome"><Input name="nome" defaultValue={g.nome} /></Field><Field label="Segmento"><Input name="segmento" defaultValue={g.segmento} /></Field><Field label="Ordem"><Input name="ordem" type="number" defaultValue={g.ordem} className="w-20" /></Field><Btn small>Salvar</Btn></form></Modal></Td></tr>)}</Table>
          <div className="space-y-4">
            <form action={salvarParamMatriculas} className="space-y-2 rounded-md bg-mist p-3"><div className="text-sm font-semibold text-navy">Parâmetros</div>
              <Field label="Ano letivo em captação"><Input name="anoLetivo" type="number" defaultValue={cfg.matriculas.anoLetivo} /></Field>
              <Field label="Prazo padrão da reserva (dias)"><Input name="reservaDias" type="number" min={1} defaultValue={cfg.matriculas.reservaDias} /></Field>
              <Field label="Prazo da oferta na fila (dias)"><Input name="ofertaFilaDias" type="number" min={1} defaultValue={cfg.matriculas.ofertaFilaDias} /></Field>
              <Btn small>Salvar</Btn></form>
            <form action={salvarSerie} className="space-y-2 rounded-md bg-mist p-3"><div className="text-sm font-semibold text-navy">Nova série</div><Field label="Nome"><Input name="nome" required /></Field><Field label="Segmento"><Input name="segmento" required placeholder="Ex.: Fundamental I" /></Field><Field label="Ordem"><Input name="ordem" type="number" defaultValue={100} /></Field><Btn small>Adicionar</Btn></form>
          </div>
        </div>
      </Card>
      <Card title="Atendimento — SLA, categorias e protocolos" className="mb-4"><div id="atendimento" />
        <form action={salvarParamAtendimento} className="grid gap-4 lg:grid-cols-3">
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
        <form action={salvarParamGovernanca} className="grid gap-4 lg:grid-cols-3">
          <Field label="Áreas de processo (uma por linha)"><Textarea name="areas" className="min-h-[200px]" defaultValue={cfg.governanca.areas.join("\n")} /></Field>
          <Field label="Motivos padronizados de exceção"><Textarea name="motivosExcecao" className="min-h-[200px]" defaultValue={cfg.governanca.motivosExcecao.join("\n")} /></Field>
          <div className="space-y-2"><Field label="Revisão de POP a cada (meses)"><Input name="revisaoPopMeses" type="number" min={1} defaultValue={cfg.governanca.revisaoPopMeses} /></Field><Field label="Validade padrão de exceção (dias)"><Input name="excecaoValidadeDias" type="number" min={1} defaultValue={cfg.governanca.excecaoValidadeDias} /></Field></div>
          <div className="lg:col-span-3"><Btn>Salvar parâmetros de governança</Btn></div>
        </form>
      </Card>
      <Card title="People Health — pesos e metas" className="mb-4"><div id="analytics" />
        <form action={salvarParamAnalytics} className="grid gap-4 lg:grid-cols-2">
          <div><div className="mb-1 text-sm font-semibold text-navy">Pesos (somam até 100)</div><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{Object.entries(cfg.analytics.pesos).map(([k, v]) => <Field key={k} label={k}><Input name={`peso_${k}`} type="number" min={0} max={40} defaultValue={v as number} /></Field>)}</div></div>
          <div><div className="mb-1 text-sm font-semibold text-navy">Metas</div><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{Object.entries(cfg.analytics.metas).map(([k, v]) => <Field key={k} label={k}><Input name={`meta_${k}`} type="number" step="0.1" defaultValue={v as number} /></Field>)}<Field label="custoReposicaoSalarios"><Input name="custoReposicaoSalarios" type="number" step="0.5" defaultValue={cfg.analytics.custoReposicaoSalarios} /></Field></div></div>
          <div className="lg:col-span-2"><Btn>Salvar pesos e metas</Btn></div>
        </form>
      </Card>
    </Page>
  );
}
