import {
  pgTable, serial, text, integer, boolean, date, timestamp, jsonb, numeric,
} from "drizzle-orm/pg-core";

// Convenção: IDs técnicos inteiros; datas civis em `date`; instantes em `timestamp`.
// Textos com domínio controlado (tipos/status) ficam como text para manter a migração idempotente.

export const companies = pgTable("companies", {
  id: serial("id").primaryKey(),
  nome: text("nome").notNull(),
  cnpj: text("cnpj"),
});

export const units = pgTable("units", {
  id: serial("id").primaryKey(),
  nome: text("nome").notNull(),
  codigo: text("codigo").notNull(),
});

export const positions = pgTable("positions", {
  id: serial("id").primaryKey(),
  nome: text("nome").notNull(),
  area: text("area").notNull(),            // Direção · Pedagógica · Administrativa · Serviços
  parentId: integer("parent_id"),          // cargo ao qual reporta (organograma)
  regulamentado: boolean("regulamentado").notNull().default(false),
  ordem: integer("ordem").notNull().default(100),
  gradeId: integer("grade_id"),            // faixa salarial
  pontos: integer("pontos"),               // avaliação de cargo por pontos
  avaliacao: jsonb("avaliacao"),           // { fator: nota }
  descricao: text("descricao"),
  requisitos: text("requisitos"),
});

export const employees = pgTable("employees", {
  id: serial("id").primaryKey(),
  nome: text("nome").notNull(),
  cpf: text("cpf"),
  email: text("email"),
  telefone: text("telefone"),
  dataNascimento: date("data_nascimento"),
  endereco: text("endereco"),
  companyId: integer("company_id"),
  unitId: integer("unit_id").notNull(),
  positionId: integer("position_id"),
  nivel: text("nivel"),                    // Júnior · Pleno · Sênior
  gestorId: integer("gestor_id"),          // employees.id do gestor direto
  vinculo: text("vinculo").notNull(),      // CLT · HORISTA · ESTAGIARIO · PJ · TEMPORARIO
  admissao: date("admissao").notNull(),
  desligamento: date("desligamento"),
  motivoDesligamento: text("motivo_desligamento"),
  situacao: text("situacao").notNull().default("ATIVO"), // EM_ADMISSAO · ATIVO · DESLIGADO
  jornadaMinDia: integer("jornada_min_dia"),   // carga horária diária em minutos (ex.: 528 = 8h48)
  turno: text("turno"),
  regime: text("regime").notNull().default("ADMINISTRATIVO"), // DOCENTE · ADMINISTRATIVO — define o calendário aplicável
  salario: numeric("salario", { precision: 12, scale: 2 }), // visível só para RH/Direção
  obs: text("obs"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  nome: text("nome").notNull(),
  senhaHash: text("senha_hash").notNull(),
  role: text("role").notNull(),            // DIRECAO · RH · DIRETOR_UNIDADE · GESTOR · LEITURA
  unitId: integer("unit_id"),              // escopo do DIRETOR_UNIDADE / GESTOR
  employeeId: integer("employee_id"),
  ativo: boolean("ativo").notNull().default(true),
  totpSecret: text("totp_secret"),
  totpAtivo: boolean("totp_ativo").notNull().default(false),
  backupCodes: jsonb("backup_codes"),      // hashes bcrypt dos códigos de recuperação
  trocarSenha: boolean("trocar_senha").notNull().default(false), // senha temporária: obriga troca no próximo acesso
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const leaveRequests = pgTable("leave_requests", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  tipo: text("tipo").notNull(),            // FERIAS · AFASTAMENTO_SAUDE · LICENCA · FOLGA_BANCO · OUTRO
  inicio: date("inicio").notNull(),
  fim: date("fim").notNull(),
  dias: integer("dias").notNull(),
  periodoRef: date("periodo_ref"),         // início do período aquisitivo a que as férias se referem
  justificativa: text("justificativa"),
  status: text("status").notNull().default("SOLICITADA"), // SOLICITADA · APROVADA · REJEITADA · CANCELADA
  solicitadoPor: integer("solicitado_por"),
  aprovadoPor: integer("aprovado_por"),
  decididoEm: timestamp("decidido_em"),
  motivoDecisao: text("motivo_decisao"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const hourEntries = pgTable("hour_entries", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  data: date("data").notNull(),
  minutos: integer("minutos").notNull(),   // positivo = crédito (hora extra) · negativo = débito (atraso/falta/compensação)
  tipo: text("tipo").notNull(),            // EXTRA · ATRASO · FALTA · COMPENSACAO · AJUSTE
  descricao: text("descricao"),
  status: text("status").notNull().default("PENDENTE"), // PENDENTE · APROVADO · REJEITADO
  lancadoPor: integer("lancado_por"),
  aprovadoPor: integer("aprovado_por"),
  timesheetDayId: integer("timesheet_day_id"), // gerado pelo espelho de ponto (um lançamento por dia)
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const processes = pgTable("processes", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  tipo: text("tipo").notNull(),            // ADMISSAO · DESLIGAMENTO
  status: text("status").notNull().default("ABERTO"), // ABERTO · CONCLUIDO · CANCELADO
  inicio: date("inicio").notNull(),
  prazo: date("prazo"),
  concluidoEm: timestamp("concluido_em"),
  responsavelUserId: integer("responsavel_user_id"),
  obs: text("obs"),
});

export const processItems = pgTable("process_items", {
  id: serial("id").primaryKey(),
  processId: integer("process_id").notNull(),
  titulo: text("titulo").notNull(),
  obrigatorio: boolean("obrigatorio").notNull().default(true),
  concluido: boolean("concluido").notNull().default(false),
  concluidoEm: timestamp("concluido_em"),
  concluidoPor: integer("concluido_por"),
  ordem: integer("ordem").notNull().default(0),
});

export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  tipo: text("tipo").notNull(),
  nome: text("nome"),
  link: text("link"),                      // URL no Drive ou outro repositório
  validade: date("validade"),
  obrigatorio: boolean("obrigatorio").notNull().default(true),
  recebidoEm: date("recebido_em"),
  obs: text("obs"),
});

export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  at: timestamp("at").notNull().defaultNow(),
  userId: integer("user_id"),
  userNome: text("user_nome"),
  acao: text("acao").notNull(),
  entidade: text("entidade").notNull(),
  entidadeId: integer("entidade_id"),
  antes: jsonb("antes"),
  depois: jsonb("depois"),
});

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
});

export const loginAttempts = pgTable("login_attempts", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  ip: text("ip"),
  ok: boolean("ok").notNull(),
  at: timestamp("at").notNull().defaultNow(),
});

// ================= MATRÍCULAS (DOM-03 Academic & Capacity) =================
export const grades = pgTable("grades", {
  id: serial("id").primaryKey(),
  nome: text("nome").notNull(),          // Maternal · Jardim I · … · 1º ano · … · 3ª série
  segmento: text("segmento").notNull(),  // Educação Infantil · Fundamental I · Fundamental II · Ensino Médio
  ordem: integer("ordem").notNull().default(100),
});

export const classes = pgTable("classes", {
  id: serial("id").primaryKey(),
  ano: integer("ano").notNull(),
  unitId: integer("unit_id").notNull(),
  modalidade: text("modalidade").notNull().default("REGULAR"), // REGULAR · INTEGRAL
  gradeId: integer("grade_id"),                  // série (REGULAR); grupos do Integral podem abranger várias
  seriesTexto: text("series_texto"),             // ex.: "Maternal + Jardim I" (Integral)
  turno: text("turno").notNull(),                // Matutino · Vespertino · Integral
  nome: text("nome").notNull(),                  // ex.: "5º ano A"
  vagas: integer("vagas").notNull(),
  status: text("status").notNull().default("ABERTA"), // ABERTA · FECHADA
  obs: text("obs"),
});

export const students = pgTable("students", {
  id: serial("id").primaryKey(),
  nome: text("nome").notNull(),
  dataNascimento: date("data_nascimento"),
  responsavel: text("responsavel"),
  telefone: text("telefone"),
  email: text("email"),
  cpfResponsavel: text("cpf_responsavel"),
  alunoAtual: boolean("aluno_atual").notNull().default(false), // já estuda na rede (rematrícula)
  unitAtualId: integer("unit_atual_id"),
  serieAtualId: integer("serie_atual_id"),
  origem: text("origem"),                        // REMATRICULA · INDICACAO · SITE · REDES · OUTRO
  inadimplente: boolean("inadimplente").notNull().default(false), // sinal financeiro (importado do ActiveSoft)
  riscoObs: text("risco_obs"),                   // observação manual de risco de saída
  obs: text("obs"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const enrollments = pgTable("enrollments", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").notNull(),
  classId: integer("class_id").notNull(),
  ano: integer("ano").notNull(),
  modalidade: text("modalidade").notNull().default("REGULAR"),
  status: text("status").notNull().default("RESERVADA"), // RESERVADA · CONFIRMADA · EXPIRADA · CANCELADA · TRANSFERIDA
  reservaAte: date("reserva_ate"),
  contratoAssinado: boolean("contrato_assinado").notNull().default(false),
  financeiroOk: boolean("financeiro_ok").notNull().default(false),
  confirmadaEm: timestamp("confirmada_em"),
  motivoCancelamento: text("motivo_cancelamento"),
  excecao: text("excecao"),                      // justificativa quando acima da capacidade
  responsavelUserId: integer("responsavel_user_id"),
  obs: text("obs"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const waitlist = pgTable("waitlist", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").notNull(),
  ano: integer("ano").notNull(),
  unitId: integer("unit_id").notNull(),
  gradeId: integer("grade_id").notNull(),
  turno: text("turno"),                          // preferência; null = qualquer
  modalidade: text("modalidade").notNull().default("REGULAR"),
  status: text("status").notNull().default("AGUARDANDO"), // AGUARDANDO · OFERTADA · CONVERTIDA · DESISTIU
  ofertaAte: date("oferta_ate"),
  ofertaClassId: integer("oferta_class_id"),
  obs: text("obs"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ================= PONTO E JORNADA =================
export const schedules = pgTable("schedules", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  vigenciaInicio: date("vigencia_inicio").notNull(),
  vigenciaFim: date("vigencia_fim"),
  seg: integer("seg").notNull().default(0), ter: integer("ter").notNull().default(0), qua: integer("qua").notNull().default(0),
  qui: integer("qui").notNull().default(0), sex: integer("sex").notNull().default(0), sab: integer("sab").notNull().default(0), dom: integer("dom").notNull().default(0),
  horarios: text("horarios"),              // texto livre: "Seg 07:00–12:00 · Ter 13:00–17:30 …"
  obs: text("obs"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const calendarDays = pgTable("calendar_days", {
  id: serial("id").primaryKey(),
  data: date("data").notNull(),
  tipo: text("tipo").notNull(),            // FERIADO · NAO_LETIVO · RECESSO · FERIAS_COLETIVAS · DISPENSA · PONTO_FACULTATIVO
  descricao: text("descricao"),
  publico: text("publico").notNull().default("TODOS"), // TODOS · DOCENTE · ADMINISTRATIVO
  unitId: integer("unit_id"),              // null = rede
});

export const timesheetDays = pgTable("timesheet_days", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  data: date("data").notNull(),
  esperadoMin: integer("esperado_min").notNull().default(0),
  trabalhadoMin: integer("trabalhado_min").notNull().default(0),
  status: text("status").notNull().default("NORMAL"), // NORMAL · FALTA · ATESTADO · FOLGA_BANCO · DISPENSA · FERIAS · AFASTADO · RECESSO · FERIADO · DSR · NAO_LETIVO
  marcacoes: text("marcacoes"),            // "07:02 12:05 13:01 17:10" (opcional)
  obs: text("obs"),
  origem: text("origem").notNull().default("MANUAL"), // MANUAL · IMPORT · AUTO
  updatedBy: integer("updated_by"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const importBatches = pgTable("import_batches", {
  id: serial("id").primaryKey(),
  tipo: text("tipo").notNull(),            // PONTO_XLSX
  userId: integer("user_id"),
  payload: jsonb("payload").notNull(),     // resultado da leitura, aguardando confirmação
  status: text("status").notNull().default("PREVIA"), // PREVIA · APLICADO · DESCARTADO
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ================= ATENDIMENTO E RETENÇÃO DA FAMÍLIA (DOM-12) =================
export const cases = pgTable("cases", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id"),          // família do aluno (null = contato avulso)
  unitId: integer("unit_id").notNull(),
  contatoNome: text("contato_nome"),
  contatoTelefone: text("contato_telefone"),
  tipo: text("tipo").notNull(),              // SOLICITACAO · DUVIDA · RECLAMACAO · ELOGIO · FINANCEIRO · PEDAGOGICO · SAIDA · OUTRO
  categoria: text("categoria"),              // taxonomia (reclamações)
  gravidade: integer("gravidade"),           // 1 leve · 2 moderada · 3 grave
  canal: text("canal").notNull().default("WHATSAPP"),
  assunto: text("assunto").notNull(),
  descricao: text("descricao"),
  prioridade: text("prioridade").notNull().default("NORMAL"), // BAIXA · NORMAL · ALTA · URGENTE
  status: text("status").notNull().default("ABERTO"),         // ABERTO · EM_ATENDIMENTO · AGUARDANDO_FAMILIA · RESOLVIDO · FECHADO · REABERTO
  responsavelUserId: integer("responsavel_user_id"),
  abertoPor: integer("aberto_por"),
  slaAte: timestamp("sla_ate"),
  escaladoEm: timestamp("escalado_em"),
  resolvidoEm: timestamp("resolvido_em"),
  fechadoEm: timestamp("fechado_em"),
  causaRaiz: text("causa_raiz"),
  acaoCorretiva: text("acao_corretiva"),
  resultado: text("resultado"),              // retenção: RETIDO · PERDIDO · EM_ANDAMENTO
  motivoSaida: text("motivo_saida"),
  checklist: jsonb("checklist"),             // [{titulo, feito}] — Service Recovery ou protocolo de retenção
  satisfacao: integer("satisfacao"),         // CSAT 1–5 após o fechamento
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const caseEvents = pgTable("case_events", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull(),
  at: timestamp("at").notNull().defaultNow(),
  userId: integer("user_id"),
  userNome: text("user_nome"),
  tipo: text("tipo").notNull(),              // COMENTARIO · CONTATO · STATUS · ATRIBUICAO · ESCALONAMENTO · CHECKLIST
  texto: text("texto"),
});

export const surveys = pgTable("surveys", {
  id: serial("id").primaryKey(),
  tipo: text("tipo").notNull(),              // NPS (0–10) · CSAT (1–5)
  nota: integer("nota").notNull(),
  comentario: text("comentario"),
  studentId: integer("student_id"),
  unitId: integer("unit_id").notNull(),
  caseId: integer("case_id"),
  canal: text("canal"),
  data: date("data").notNull(),
  anonimo: boolean("anonimo").notNull().default(false),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ================= GOVERNANÇA E POPs (DOM-07) =================
export const procedures = pgTable("procedures", {
  id: serial("id").primaryKey(),
  codigo: text("codigo").notNull(),          // POP-001
  titulo: text("titulo").notNull(),
  area: text("area").notNull(),
  unitId: integer("unit_id"),                // null = rede
  ownerUserId: integer("owner_user_id"),
  status: text("status").notNull().default("RASCUNHO"), // RASCUNHO · VIGENTE · EM_REVISAO · OBSOLETO
  versao: integer("versao").notNull().default(1),
  objetivo: text("objetivo"),
  escopo: text("escopo"),
  passos: text("passos"),                    // um passo por linha
  responsavel: text("responsavel"),          // RACI: quem executa
  aprovador: text("aprovador"),
  consultados: text("consultados"),
  informados: text("informados"),
  indicadores: text("indicadores"),
  link: text("link"),
  publicadoEm: timestamp("publicado_em"),
  revisarEm: date("revisar_em"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const procedureVersions = pgTable("procedure_versions", {
  id: serial("id").primaryKey(),
  procedureId: integer("procedure_id").notNull(),
  versao: integer("versao").notNull(),
  conteudo: jsonb("conteudo").notNull(),     // cópia dos campos no momento da publicação
  notas: text("notas"),
  publicadoPor: integer("publicado_por"),
  publicadoEm: timestamp("publicado_em").notNull().defaultNow(),
});

export const procedureAcks = pgTable("procedure_acks", {
  id: serial("id").primaryKey(),
  procedureId: integer("procedure_id").notNull(),
  versao: integer("versao").notNull(),
  userId: integer("user_id").notNull(),
  at: timestamp("at").notNull().defaultNow(),
});

export const exceptions = pgTable("exceptions", {
  id: serial("id").primaryKey(),
  procedureId: integer("procedure_id"),
  regra: text("regra").notNull(),            // qual regra/POP está sendo excepcionada
  motivo: text("motivo").notNull(),          // padronizado
  descricao: text("descricao"),
  impacto: text("impacto"),
  referencia: text("referencia"),            // ex.: aluno, contrato, colaborador
  unitId: integer("unit_id"),
  solicitanteUserId: integer("solicitante_user_id").notNull(),
  aprovadorUserId: integer("aprovador_user_id"),
  status: text("status").notNull().default("SOLICITADA"), // SOLICITADA · APROVADA · REJEITADA · EXPIRADA · REVISADA
  validadeAte: date("validade_ate"),
  decididoEm: timestamp("decidido_em"),
  motivoDecisao: text("motivo_decisao"),
  revisaoNota: text("revisao_nota"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const controls = pgTable("controls", {
  id: serial("id").primaryKey(),
  titulo: text("titulo").notNull(),
  area: text("area").notNull(),
  procedureId: integer("procedure_id"),
  unitId: integer("unit_id"),
  frequencia: text("frequencia").notNull().default("MENSAL"), // DIARIO · SEMANAL · MENSAL · TRIMESTRAL · ANUAL
  responsavelUserId: integer("responsavel_user_id"),
  descricao: text("descricao"),
  ativo: boolean("ativo").notNull().default(true),
  proximaEm: date("proxima_em"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const controlRuns = pgTable("control_runs", {
  id: serial("id").primaryKey(),
  controlId: integer("control_id").notNull(),
  data: date("data").notNull(),
  resultado: text("resultado").notNull(),    // CONFORME · NAO_CONFORME
  evidencia: text("evidencia"),
  obs: text("obs"),
  userId: integer("user_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const nonconformities = pgTable("nonconformities", {
  id: serial("id").primaryKey(),
  titulo: text("titulo").notNull(),
  origem: text("origem").notNull(),          // CONTROLE · RECLAMACAO · AUDITORIA · EXCECAO · OUTRO
  descricao: text("descricao"),
  procedureId: integer("procedure_id"),
  controlId: integer("control_id"),
  caseId: integer("case_id"),
  unitId: integer("unit_id"),
  gravidade: integer("gravidade").notNull().default(2),
  causaRaiz: text("causa_raiz"),
  acaoCorretiva: text("acao_corretiva"),
  acaoPreventiva: text("acao_preventiva"),
  responsavelUserId: integer("responsavel_user_id"),
  prazo: date("prazo"),
  status: text("status").notNull().default("ABERTA"), // ABERTA · EM_TRATAMENTO · VERIFICACAO · ENCERRADA
  eficaciaVerificada: boolean("eficacia_verificada").notNull().default(false),
  encerradaEm: timestamp("encerrada_em"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const decisions = pgTable("decisions", {
  id: serial("id").primaryKey(),
  data: date("data").notNull(),
  titulo: text("titulo").notNull(),
  area: text("area").notNull(),
  unitId: integer("unit_id"),
  contexto: text("contexto"),
  decisao: text("decisao").notNull(),
  alternativas: text("alternativas"),
  consequencias: text("consequencias"),
  responsavelUserId: integer("responsavel_user_id"),
  status: text("status").notNull().default("VIGENTE"), // VIGENTE · REVOGADA · SUBSTITUIDA
  revisarEm: date("revisar_em"),
  substituidaPor: integer("substituida_por"),
  link: text("link"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ================= CARGOS E SALÁRIOS =================
export const salaryGrades = pgTable("salary_grades", {
  id: serial("id").primaryKey(),
  codigo: text("codigo").notNull(),          // G1 … G8
  nome: text("nome"),
  minimo: numeric("minimo", { precision: 12, scale: 2 }).notNull(),
  medio: numeric("medio", { precision: 12, scale: 2 }).notNull(),
  maximo: numeric("maximo", { precision: 12, scale: 2 }).notNull(),
  pontosMin: integer("pontos_min"),
  pontosMax: integer("pontos_max"),
  ordem: integer("ordem").notNull().default(100),
  vigenciaInicio: date("vigencia_inicio"),
  obs: text("obs"),
});

export const salaryHistory = pgTable("salary_history", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  data: date("data").notNull(),
  salarioAnterior: numeric("salario_anterior", { precision: 12, scale: 2 }),
  salario: numeric("salario", { precision: 12, scale: 2 }).notNull(),
  motivo: text("motivo").notNull(),          // ADMISSAO · PROMOCAO · MERITO · ENQUADRAMENTO · DISSIDIO · AJUSTE
  obs: text("obs"),
  userId: integer("user_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ================= DESEMPENHO =================
export const perfCycles = pgTable("perf_cycles", {
  id: serial("id").primaryKey(),
  nome: text("nome").notNull(),
  inicio: date("inicio").notNull(),
  fim: date("fim").notNull(),
  status: text("status").notNull().default("PLANEJADO"), // PLANEJADO · ABERTO · CALIBRACAO · ENCERRADO
  competencias: jsonb("competencias").notNull(),          // string[]
  unitId: integer("unit_id"),
  descricao: text("descricao"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const perfReviews = pgTable("perf_reviews", {
  id: serial("id").primaryKey(),
  cycleId: integer("cycle_id").notNull(),
  employeeId: integer("employee_id").notNull(),
  avaliadorUserId: integer("avaliador_user_id"),
  status: text("status").notNull().default("PENDENTE"),   // PENDENTE · AUTOAVALIADA · AVALIADA · CALIBRADA · CONCLUIDA
  auto: jsonb("auto"),                                     // { notas: {comp: n}, comentario }
  gestor: jsonb("gestor"),                                 // { notas: {comp: n}, comentario, pontosFortes, melhorias }
  notaFinal: numeric("nota_final", { precision: 4, scale: 2 }),
  potencial: integer("potencial"),                         // 1 baixo · 2 médio · 3 alto
  desempenhoNivel: integer("desempenho_nivel"),            // 1 baixo · 2 médio · 3 alto (derivado da nota, ajustável na calibração)
  calibracaoNota: text("calibracao_nota"),
  pdi: jsonb("pdi"),                                       // [{acao, prazo, status}]
  concluidaEm: timestamp("concluida_em"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const perfGoals = pgTable("perf_goals", {
  id: serial("id").primaryKey(),
  cycleId: integer("cycle_id").notNull(),
  employeeId: integer("employee_id").notNull(),
  titulo: text("titulo").notNull(),
  indicador: text("indicador"),
  meta: text("meta"),
  resultado: text("resultado"),
  peso: integer("peso").notNull().default(1),
  atingimento: integer("atingimento"),       // 0–150 (%)
  status: text("status").notNull().default("EM_ANDAMENTO"), // EM_ANDAMENTO · ATINGIDA · PARCIAL · NAO_ATINGIDA
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const perfCheckins = pgTable("perf_checkins", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  data: date("data").notNull(),
  userId: integer("user_id"),
  temas: text("temas"),
  combinados: text("combinados"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ================= RECRUTAMENTO E SELEÇÃO =================
export const requisitions = pgTable("requisitions", {
  id: serial("id").primaryKey(),
  titulo: text("titulo").notNull(),
  positionId: integer("position_id"),
  unitId: integer("unit_id").notNull(),
  quantidade: integer("quantidade").notNull().default(1),
  tipo: text("tipo").notNull().default("SUBSTITUICAO"),   // SUBSTITUICAO · AUMENTO_QUADRO · NOVO_CARGO
  justificativa: text("justificativa"),
  requisitos: text("requisitos"),
  regime: text("regime").notNull().default("CLT"),
  jornada: text("jornada"),
  faixa: text("faixa"),
  status: text("status").notNull().default("SOLICITADA"), // SOLICITADA · APROVADA · ABERTA · PREENCHIDA · CANCELADA
  solicitanteUserId: integer("solicitante_user_id"),
  aprovadorUserId: integer("aprovador_user_id"),
  responsavelUserId: integer("responsavel_user_id"),
  prazo: date("prazo"),
  abertaEm: date("aberta_em"),
  fechadaEm: date("fechada_em"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const candidates = pgTable("candidates", {
  id: serial("id").primaryKey(),
  nome: text("nome").notNull(),
  email: text("email"),
  telefone: text("telefone"),
  cidade: text("cidade"),
  curriculoLink: text("curriculo_link"),
  origem: text("origem"),
  formacao: text("formacao"),
  tags: text("tags"),
  obs: text("obs"),
  consentimentoLgpd: boolean("consentimento_lgpd").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const applications = pgTable("applications", {
  id: serial("id").primaryKey(),
  requisitionId: integer("requisition_id").notNull(),
  candidateId: integer("candidate_id").notNull(),
  etapa: text("etapa").notNull().default("TRIAGEM"),
  scorecard: jsonb("scorecard"),             // { criterio: nota }
  notas: text("notas"),
  propostaValor: numeric("proposta_valor", { precision: 12, scale: 2 }),
  motivoReprovacao: text("motivo_reprovacao"),
  employeeId: integer("employee_id"),        // quando contratado
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const applicationEvents = pgTable("application_events", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").notNull(),
  at: timestamp("at").notNull().defaultNow(),
  userNome: text("user_nome"),
  texto: text("texto").notNull(),
});

// ================= CLIMA E eNPS =================
export const climateSurveys = pgTable("climate_surveys", {
  id: serial("id").primaryKey(),
  nome: text("nome").notNull(),
  tipo: text("tipo").notNull().default("CLIMA"),        // CLIMA · ENPS · PULSE
  inicio: date("inicio").notNull(),
  fim: date("fim").notNull(),
  status: text("status").notNull().default("RASCUNHO"), // RASCUNHO · ABERTA · ENCERRADA
  unitId: integer("unit_id"),
  perguntas: jsonb("perguntas").notNull(),              // [{id, dimensao, texto, tipo: ESCALA|ENPS|TEXTO}]
  token: text("token").notNull().unique(),              // link público anônimo
  minimoAnonimato: integer("minimo_anonimato").notNull().default(5),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const climateResponses = pgTable("climate_responses", {
  id: serial("id").primaryKey(),
  surveyId: integer("survey_id").notNull(),
  unitId: integer("unit_id"),
  regime: text("regime"),                               // DOCENTE · ADMINISTRATIVO (opcional, informado pelo respondente)
  respostas: jsonb("respostas").notNull(),              // { qid: valor }
  comentario: text("comentario"),
  at: timestamp("at").notNull().defaultNow(),
});

export const climateActions = pgTable("climate_actions", {
  id: serial("id").primaryKey(),
  surveyId: integer("survey_id").notNull(),
  dimensao: text("dimensao"),
  unitId: integer("unit_id"),
  acao: text("acao").notNull(),
  responsavelUserId: integer("responsavel_user_id"),
  prazo: date("prazo"),
  status: text("status").notNull().default("PLANEJADA"), // PLANEJADA · EM_ANDAMENTO · CONCLUIDA
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ================= STATUS ACADEMY =================
export const courses = pgTable("courses", {
  id: serial("id").primaryKey(),
  codigo: text("codigo").notNull(),
  titulo: text("titulo").notNull(),
  area: text("area"),
  descricao: text("descricao"),
  tipo: text("tipo").notNull().default("OPCIONAL"),     // OBRIGATORIO · TRILHA_CARGO · OPCIONAL
  formato: text("formato").notNull().default("ONLINE"), // PRESENCIAL · ONLINE · LEITURA · POP
  cargaHoras: numeric("carga_horas", { precision: 5, scale: 1 }),
  link: text("link"),
  procedureId: integer("procedure_id"),                 // formato POP: concluído = ciência do POP vigente
  validadeMeses: integer("validade_meses"),             // recertificação
  paraTodos: boolean("para_todos").notNull().default(false),
  paraCargos: jsonb("para_cargos"),                     // number[] (position ids)
  paraRegime: text("para_regime"),                      // DOCENTE · ADMINISTRATIVO · null
  ativo: boolean("ativo").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const trainingProgress = pgTable("training_progress", {
  id: serial("id").primaryKey(),
  courseId: integer("course_id").notNull(),
  employeeId: integer("employee_id").notNull(),
  status: text("status").notNull().default("PENDENTE"), // PENDENTE · EM_ANDAMENTO · CONCLUIDO
  inicioEm: date("inicio_em"),
  concluidoEm: date("concluido_em"),
  validoAte: date("valido_ate"),
  nota: numeric("nota", { precision: 4, scale: 1 }),
  evidencia: text("evidencia"),
  registradoPor: integer("registrado_por"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const trainingSessions = pgTable("training_sessions", {
  id: serial("id").primaryKey(),
  courseId: integer("course_id").notNull(),
  data: date("data").notNull(),
  horario: text("horario"),
  local: text("local"),
  instrutor: text("instrutor"),
  unitId: integer("unit_id"),
  vagas: integer("vagas"),
  obs: text("obs"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const sessionAttendance = pgTable("session_attendance", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull(),
  employeeId: integer("employee_id").notNull(),
  presente: boolean("presente").notNull().default(false),
});

export const trainingNeeds = pgTable("training_needs", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id"),
  unitId: integer("unit_id"),
  descricao: text("descricao").notNull(),
  origem: text("origem").notNull().default("GESTOR"),   // PDI · GESTOR · NC · CLIMA · OUTRO
  prioridade: text("prioridade").notNull().default("NORMAL"),
  courseId: integer("course_id"),
  status: text("status").notNull().default("ABERTA"),   // ABERTA · PLANEJADA · ATENDIDA
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ================= SUCESSÃO E TALENTOS =================
export const criticalPositions = pgTable("critical_positions", {
  id: serial("id").primaryKey(),
  positionId: integer("position_id").notNull(),
  unitId: integer("unit_id"),
  titularEmployeeId: integer("titular_employee_id"),
  criticidade: integer("criticidade").notNull().default(2), // 1 média · 2 alta · 3 crítica
  motivo: text("motivo"),
  riscoSaida: text("risco_saida").notNull().default("MEDIO"), // BAIXO · MEDIO · ALTO
  contingencia: text("contingencia"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const successors = pgTable("successors", {
  id: serial("id").primaryKey(),
  criticalPositionId: integer("critical_position_id").notNull(),
  employeeId: integer("employee_id").notNull(),
  prontidao: text("prontidao").notNull().default("EM_DESENVOLVIMENTO"), // PRONTO · UM_DOIS_ANOS · EM_DESENVOLVIMENTO
  plano: text("plano"),
  ativo: boolean("ativo").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const talentReviews = pgTable("talent_reviews", {
  id: serial("id").primaryKey(),
  nome: text("nome").notNull(),
  data: date("data").notNull(),
  status: text("status").notNull().default("PLANEJADO"), // PLANEJADO · REALIZADO
  participantes: text("participantes"),
  notas: text("notas"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const talentReviewItems = pgTable("talent_review_items", {
  id: serial("id").primaryKey(),
  reviewId: integer("review_id").notNull(),
  employeeId: integer("employee_id").notNull(),
  classificacao: text("classificacao").notNull().default("SOLIDO"), // TALENTO_CHAVE · ALTO_POTENCIAL · SOLIDO · ATENCAO
  riscoPerda: text("risco_perda").notNull().default("MEDIO"),
  impactoPerda: text("impacto_perda").notNull().default("MEDIO"),
  acao: text("acao"),
  responsavelUserId: integer("responsavel_user_id"),
  prazo: date("prazo"),
  status: text("status").notNull().default("PLANEJADA"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ================= PEOPLE ANALYTICS E IA =================
export const aiLog = pgTable("ai_log", {
  id: serial("id").primaryKey(),
  at: timestamp("at").notNull().defaultNow(),
  userId: integer("user_id"),
  userNome: text("user_nome"),
  pergunta: text("pergunta").notNull(),
  resposta: text("resposta"),
  modelo: text("modelo"),
  tokensEntrada: integer("tokens_entrada"),
  tokensSaida: integer("tokens_saida"),
  erro: text("erro"),
});

// ================= FINANCEIRO (DOM-04 — camada de gestão sobre o ActiveSoft) =================
export const receivables = pgTable("receivables", {
  id: serial("id").primaryKey(),
  externalId: text("external_id"),          // nº do título no ActiveSoft
  studentId: integer("student_id"),
  alunoNome: text("aluno_nome").notNull(),
  responsavel: text("responsavel"),
  telefone: text("telefone"),
  unitId: integer("unit_id").notNull(),
  tipo: text("tipo").notNull().default("MENSALIDADE"), // MENSALIDADE · INTEGRAL · MATERIAL · TAXA · OUTRO
  competencia: text("competencia"),         // YYYY-MM
  vencimento: date("vencimento").notNull(),
  valor: numeric("valor", { precision: 12, scale: 2 }).notNull(),
  valorPago: numeric("valor_pago", { precision: 12, scale: 2 }),
  pagoEm: date("pago_em"),
  status: text("status").notNull().default("ABERTO"), // ABERTO · PAGO · NEGOCIADO · CANCELADO
  agreementId: integer("agreement_id"),
  obs: text("obs"),
  importadoEm: timestamp("importado_em").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const collectionActions = pgTable("collection_actions", {
  id: serial("id").primaryKey(),
  receivableId: integer("receivable_id"),
  alunoNome: text("aluno_nome").notNull(),
  unitId: integer("unit_id").notNull(),
  etapa: text("etapa").notNull(),           // LEMBRETE · CONTATO · NEGOCIACAO · AVISO_FORMAL · JURIDICO
  canal: text("canal"),
  texto: text("texto"),
  resultado: text("resultado"),             // SEM_RETORNO · PROMESSA · ACORDO · PAGO · RECUSA
  userId: integer("user_id"),
  userNome: text("user_nome"),
  at: timestamp("at").notNull().defaultNow(),
});

export const agreements = pgTable("agreements", {
  id: serial("id").primaryKey(),
  alunoNome: text("aluno_nome").notNull(),
  studentId: integer("student_id"),
  unitId: integer("unit_id").notNull(),
  valorOriginal: numeric("valor_original", { precision: 12, scale: 2 }).notNull(),
  valorAcordado: numeric("valor_acordado", { precision: 12, scale: 2 }).notNull(),
  parcelas: integer("parcelas").notNull().default(1),
  primeiraParcela: date("primeira_parcela").notNull(),
  status: text("status").notNull().default("ATIVO"), // ATIVO · CUMPRIDO · QUEBRADO · CANCELADO
  obs: text("obs"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const agreementInstallments = pgTable("agreement_installments", {
  id: serial("id").primaryKey(),
  agreementId: integer("agreement_id").notNull(),
  numero: integer("numero").notNull(),
  vencimento: date("vencimento").notNull(),
  valor: numeric("valor", { precision: 12, scale: 2 }).notNull(),
  pagoEm: date("pago_em"),
});

export const discounts = pgTable("discounts", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id"),
  alunoNome: text("aluno_nome").notNull(),
  unitId: integer("unit_id").notNull(),
  ano: integer("ano").notNull(),
  tipo: text("tipo").notNull(),
  percentual: numeric("percentual", { precision: 5, scale: 2 }).notNull(),
  motivo: text("motivo"),
  validadeAte: date("validade_ate"),
  status: text("status").notNull().default("SOLICITADO"), // SOLICITADO · APROVADO · REJEITADO · EXPIRADO
  solicitanteUserId: integer("solicitante_user_id"),
  aprovadorUserId: integer("aprovador_user_id"),
  decididoEm: timestamp("decidido_em"),
  motivoDecisao: text("motivo_decisao"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const tuitionPrices = pgTable("tuition_prices", {
  id: serial("id").primaryKey(),
  ano: integer("ano").notNull(),
  unitId: integer("unit_id").notNull(),
  gradeId: integer("grade_id"),
  modalidade: text("modalidade").notNull().default("REGULAR"),
  valorMensal: numeric("valor_mensal", { precision: 12, scale: 2 }).notNull(),
  parcelas: integer("parcelas").notNull().default(12),
});

export const cashEntries = pgTable("cash_entries", {
  id: serial("id").primaryKey(),
  unitId: integer("unit_id").notNull(),
  data: date("data").notNull(),
  tipo: text("tipo").notNull(),             // ENTRADA · SAIDA · TRANSFERENCIA
  categoria: text("categoria").notNull(),
  forma: text("forma"),                     // PIX · CARTAO · BOLETO · DINHEIRO · TRANSFERENCIA · OUTRO
  descricao: text("descricao"),
  valor: numeric("valor", { precision: 12, scale: 2 }).notNull(),
  contraparte: text("contraparte"),
  hash: text("hash"),                       // dedupe de importação
  importadoEm: timestamp("importado_em").notNull().defaultNow(),
});

export const cashBalances = pgTable("cash_balances", {
  id: serial("id").primaryKey(),
  unitId: integer("unit_id").notNull(),
  mes: text("mes").notNull(),               // YYYY-MM
  saldoInicial: numeric("saldo_inicial", { precision: 12, scale: 2 }).notNull(),
});

export const budgets = pgTable("budgets", {
  id: serial("id").primaryKey(),
  ano: integer("ano").notNull(),
  unitId: integer("unit_id").notNull(),
  tipo: text("tipo").notNull().default("SAIDA"), // ENTRADA · SAIDA
  categoria: text("categoria").notNull(),
  valorMensal: numeric("valor_mensal", { precision: 12, scale: 2 }).notNull(),
});

// ================= COMMAND CENTER EXECUTIVO (DOM-14) =================
export const healthSnapshots = pgTable("health_snapshots", {
  id: serial("id").primaryKey(),
  data: date("data").notNull(),
  unitId: integer("unit_id"),                // null = rede
  geral: integer("geral").notNull(),
  scores: jsonb("scores").notNull(),         // { pessoas, processos, matriculas, atendimento, financeiro }
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const execPending = pgTable("exec_pending", {
  id: serial("id").primaryKey(),
  titulo: text("titulo").notNull(),
  area: text("area"),
  descricao: text("descricao"),
  prazo: date("prazo"),
  responsavelUserId: integer("responsavel_user_id"),
  status: text("status").notNull().default("ABERTA"), // ABERTA · DECIDIDA · ADIADA
  decisionId: integer("decision_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ================= OPERAÇÕES E MANUTENÇÃO (DOM-10) =================
export const assets = pgTable("assets", {
  id: serial("id").primaryKey(),
  codigo: text("codigo"),                    // nº de patrimônio
  nome: text("nome").notNull(),
  categoria: text("categoria").notNull().default("OUTRO"),
  unitId: integer("unit_id").notNull(),
  ambiente: text("ambiente"),
  aquisicao: date("aquisicao"),
  valor: numeric("valor", { precision: 12, scale: 2 }),
  fornecedor: text("fornecedor"),
  garantiaAte: date("garantia_ate"),
  status: text("status").notNull().default("EM_USO"), // EM_USO · MANUTENCAO · BAIXADO
  preventivaDias: integer("preventiva_dias"),
  ultimaPreventiva: date("ultima_preventiva"),
  obs: text("obs"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const workOrders = pgTable("work_orders", {
  id: serial("id").primaryKey(),
  tipo: text("tipo").notNull().default("CORRETIVA"), // CORRETIVA · PREVENTIVA · MELHORIA · LIMPEZA · TI · SEGURANCA
  titulo: text("titulo").notNull(),
  descricao: text("descricao"),
  unitId: integer("unit_id").notNull(),
  ambiente: text("ambiente"),
  assetId: integer("asset_id"),
  prioridade: text("prioridade").notNull().default("NORMAL"),
  status: text("status").notNull().default("ABERTO"), // ABERTO · EM_EXECUCAO · AGUARDANDO · CONCLUIDO · CANCELADO
  solicitanteUserId: integer("solicitante_user_id"),
  responsavelUserId: integer("responsavel_user_id"),
  supplierId: integer("supplier_id"),
  slaAte: timestamp("sla_ate"),
  custoPrevisto: numeric("custo_previsto", { precision: 12, scale: 2 }),
  custoReal: numeric("custo_real", { precision: 12, scale: 2 }),
  iniciadoEm: timestamp("iniciado_em"),
  concluidoEm: timestamp("concluido_em"),
  evidencia: text("evidencia"),
  avaliacao: integer("avaliacao"),
  inspectionId: integer("inspection_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const workOrderEvents = pgTable("work_order_events", {
  id: serial("id").primaryKey(),
  workOrderId: integer("work_order_id").notNull(),
  at: timestamp("at").notNull().defaultNow(),
  userNome: text("user_nome"),
  tipo: text("tipo").notNull(),
  texto: text("texto"),
});

export const inspections = pgTable("inspections", {
  id: serial("id").primaryKey(),
  unitId: integer("unit_id").notNull(),
  ambiente: text("ambiente").notNull(),
  tipo: text("tipo").notNull(),              // chave do checklist (SALA_DE_AULA, BANHEIRO, …)
  data: date("data").notNull(),
  inspetorUserId: integer("inspetor_user_id"),
  itens: jsonb("itens").notNull(),           // [{item, ok, obs}]
  conformes: integer("conformes").notNull().default(0),
  total: integer("total").notNull().default(0),
  obs: text("obs"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const suppliers = pgTable("suppliers", {
  id: serial("id").primaryKey(),
  nome: text("nome").notNull(),
  servico: text("servico"),
  telefone: text("telefone"),
  email: text("email"),
  contrato: text("contrato"),
  ativo: boolean("ativo").notNull().default(true),
  obs: text("obs"),
});

// ================= ESTRATÉGIA E PROJETOS (DOM-08) =================
export const objectives = pgTable("objectives", {
  id: serial("id").primaryKey(),
  ciclo: text("ciclo").notNull(),               // ex.: "2027", "2026-S2"
  pilar: text("pilar"),
  titulo: text("titulo").notNull(),
  descricao: text("descricao"),
  ownerUserId: integer("owner_user_id"),
  unitId: integer("unit_id"),
  status: text("status").notNull().default("ATIVO"), // ATIVO · CONCLUIDO · CANCELADO
  ordem: integer("ordem").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const keyResults = pgTable("key_results", {
  id: serial("id").primaryKey(),
  objectiveId: integer("objective_id").notNull(),
  titulo: text("titulo").notNull(),
  metrica: text("metrica"),                     // unidade: %, alunos, R$, dias…
  valorInicial: numeric("valor_inicial", { precision: 14, scale: 2 }).notNull().default("0"),
  valorMeta: numeric("valor_meta", { precision: 14, scale: 2 }).notNull(),
  valorAtual: numeric("valor_atual", { precision: 14, scale: 2 }),
  direcao: text("direcao").notNull().default("SUBIR"), // SUBIR · DESCER
  fonte: text("fonte"),                         // null = manual; "SISTEMA:<chave>" = lido do sistema
  ownerUserId: integer("owner_user_id"),
  prazo: date("prazo"),
  confianca: integer("confianca"),              // 1 baixa · 2 média · 3 alta (último check-in)
  atualizadoEm: timestamp("atualizado_em"),
});

export const krCheckins = pgTable("kr_checkins", {
  id: serial("id").primaryKey(),
  keyResultId: integer("key_result_id").notNull(),
  data: date("data").notNull(),
  valor: numeric("valor", { precision: 14, scale: 2 }),
  confianca: integer("confianca"),
  comentario: text("comentario"),
  userId: integer("user_id"),
  userNome: text("user_nome"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  nome: text("nome").notNull(),
  descricao: text("descricao"),
  objectiveId: integer("objective_id"),
  ownerUserId: integer("owner_user_id"),
  unitId: integer("unit_id"),
  status: text("status").notNull().default("PLANEJADO"), // IDEIA · PLANEJADO · EM_ANDAMENTO · PAUSADO · CONCLUIDO · CANCELADO
  prioridade: text("prioridade").notNull().default("NORMAL"),
  inicio: date("inicio"),
  fim: date("fim"),
  orcamento: numeric("orcamento", { precision: 12, scale: 2 }),
  gasto: numeric("gasto", { precision: 12, scale: 2 }),
  saude: text("saude").notNull().default("VERDE"),   // VERDE · AMARELO · VERMELHO (último status report)
  resultadoEsperado: text("resultado_esperado"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const milestones = pgTable("milestones", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  titulo: text("titulo").notNull(),
  prazo: date("prazo").notNull(),
  responsavelUserId: integer("responsavel_user_id"),
  concluidoEm: date("concluido_em"),
  ordem: integer("ordem").notNull().default(0),
});

export const projectUpdates = pgTable("project_updates", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  data: date("data").notNull(),
  saude: text("saude").notNull(),
  feito: text("feito"),
  proximo: text("proximo"),
  riscos: text("riscos"),
  userId: integer("user_id"),
  userNome: text("user_nome"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const projectRisks = pgTable("project_risks", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  descricao: text("descricao").notNull(),
  probabilidade: integer("probabilidade").notNull().default(2),
  impacto: integer("impacto").notNull().default(2),
  mitigacao: text("mitigacao"),
  status: text("status").notNull().default("ABERTO"), // ABERTO · MITIGADO · OCORREU
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ================= REDEFINIÇÃO DE SENHA =================
export const passwordResets = pgTable("password_resets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  tokenHash: text("token_hash"),            // sha256 do token do link (quando há e-mail)
  expiraEm: timestamp("expira_em").notNull(),
  usadoEm: timestamp("usado_em"),
  viaEmail: boolean("via_email").notNull().default(false),
  atendidoPor: integer("atendido_por"),     // RH que gerou senha temporária
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
