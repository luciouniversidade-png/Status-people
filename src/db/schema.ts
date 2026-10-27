import {
  pgTable, serial, text, integer, boolean, date, timestamp, jsonb, numeric, customType,
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
  companyId: integer("company_id"),               // v24: entidade (CNPJ) a que a unidade pertence
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
  formacaoExigida: text("formacao_exigida"),
  documentoFormacao: text("documento_formacao"),
  familia: text("familia"),                 // família para o modelo de avaliação: PROFESSORES · COORDENACAO · SECRETARIA · ATENDIMENTO_COMERCIAL · APOIO_OPERACIONAL · GESTAO
  asoMeses: integer("aso_meses"),                  // v24: periodicidade do exame periódico (PCMSO)
  epis: jsonb("epis"),                             // v24: EPIs exigidos pelo cargo (ids)
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
  feriasQuitadasAte: date("ferias_quitadas_ate"), // carga inicial: períodos aquisitivos encerrados até esta data contam como quitados
  salario: numeric("salario", { precision: 12, scale: 2 }), // visível só para RH/Direção
  obs: text("obs"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  contatoEmergencia: text("contato_emergencia"),          // v25 · T-104: atualizado pelo próprio colaborador
  terminoContrato: date("termino_contrato"),              // v27 · estágio (fim do TCE), temporário ou prazo determinado
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
  lote: text("lote"),                              // v24: aprovação em lote
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
  lote: text("lote"),
  decididoEm: timestamp("decidido_em"),
  motivoDecisao: text("motivo_decisao"),
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
  spaceId: integer("space_id"),                  // sala da turma (mapa de salas por turno, v22)
  titularEmployeeId: integer("titular_employee_id"), // v24 · professor(a) titular (T-013: turma sem titular é pendência estrutural)
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
  carteiraUserId: integer("carteira_user_id"),   // responsável pelo relacionamento com a família (Radar da família)
  indicadoPorId: integer("indicado_por_id"),     // família (aluno) que indicou este candidato
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
  auditId: integer("audit_id"),
  eficaciaEvidencia: text("eficacia_evidencia"),
  eficaciaEm: date("eficacia_em"),
  reincidenciaDe: integer("reincidencia_de"),
  reincidencias: integer("reincidencias").notNull().default(0),
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
  ritualMeetingId: integer("ritual_meeting_id"), // decisão registrada em reunião de ritual de gestão
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
  // Avaliação por critérios (Painel do Colaborador): modelo congelado ao abrir o ciclo
  modelId: integer("model_id"),
  modelVersao: integer("model_versao"),
  criterios: jsonb("criterios"),                            // snapshot [{id, eixo, titulo, descricao, peso, niveis, evidencia, naPermitido}]
  pesoResultados: integer("peso_resultados").notNull().default(60),
  pesoAtitudes: integer("peso_atitudes").notNull().default(40),
  fase: text("fase").notNull().default("PLANEJAMENTO"),     // PLANEJAMENTO · ACOMPANHAMENTO · AVALIACAO · CALIBRACAO · FEEDBACK · CONCLUSAO · ARQUIVADO
  prazoAvaliacao: date("prazo_avaliacao"),
  prazoFeedback: date("prazo_feedback"),
  familias: jsonb("familias"),                             // string[] famílias elegíveis (vazio = todas)
  notaComposta: boolean("nota_composta").notNull().default(false),
  faixas: jsonb("faixas"),
  coberturaMinima: integer("cobertura_minima").notNull().default(50),
  fontes: jsonb("fontes"),                                // múltiplas fontes opt-in: { PAR: {peso, minimo}, LIDERADO: {peso, minimo} }
  piloto: boolean("piloto").notNull().default(false),
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
  // Avaliação por critérios
  estado: text("estado").notNull().default("RASCUNHO"),    // RASCUNHO · ENVIADA · EM_CALIBRACAO · PUBLICADA · CONTESTADA
  notasCriterios: jsonb("notas_criterios"),                // gestor: { critId: { nota, na, naJustificativa, naAprovado, evidencia } }
  autoCriterios: jsonb("auto_criterios"),                  // autoavaliação por critério (perspectiva separada)
  calc: jsonb("calc"),                                     // memória de cálculo publicada
  notasOriginais: jsonb("notas_originais"),                // antes da calibração
  calibradoPor: integer("calibrado_por"),
  calibracaoJustificativa: text("calibracao_justificativa"),
  enviadaEm: timestamp("enviada_em"),
  publicadaEm: timestamp("publicada_em"),
  cienciaEm: timestamp("ciencia_em"),
  comentarioColaborador: text("comentario_colaborador"),
  contestacao: text("contestacao"),
  contestacaoEm: timestamp("contestacao_em"),
  respostaContestacao: text("resposta_contestacao"),
  snapshot: jsonb("snapshot"),                             // { unitId, unidade, positionId, cargo, gestorId, familia } no momento da geração
  inconclusivaJustificativa: text("inconclusiva_justificativa"),
  inconclusivaAprovadaPor: integer("inconclusiva_aprovada_por"),
  aprovadoPor: integer("aprovado_por"),                    // quem publicou (aprovação)
  periodoObsInicio: date("periodo_obs_inicio"),
  periodoObsFim: date("periodo_obs_fim"),
  calibracaoEvidencia: text("calibracao_evidencia"),
  iniciadaEm: timestamp("iniciada_em"),
  versao: integer("versao").notNull().default(1),          // controle de concorrência otimista
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
  tipo: text("tipo").notNull().default("OPERACIONAL"),    // OPERACIONAL · MELHORIA · APRENDIZAGEM · EXPLORATORIA · COLETIVA
  unidadeMedida: text("unidade_medida"),
  linhaBase: numeric("linha_base", { precision: 14, scale: 4 }),
  esperado: numeric("esperado", { precision: 14, scale: 4 }),
  direcao: text("direcao").notNull().default("MAIOR_MELHOR"), // MAIOR_MELHOR · MENOR_MELHOR · FAIXA · BINARIO · MARCOS
  faixaMin: numeric("faixa_min", { precision: 14, scale: 4 }),
  faixaMax: numeric("faixa_max", { precision: 14, scale: 4 }),
  prazo: date("prazo"),
  fonte: text("fonte"),
  responsavelUserId: integer("responsavel_user_id"),
  dependencias: text("dependencias"),
  periodicidade: text("periodicidade"),
  regraInterpretacao: text("regra_interpretacao"),
  participaAvaliacao: boolean("participa_avaliacao").notNull().default(false),
  criterioId: text("criterio_id"),
  conversao: jsonb("conversao"),                          // [{ ate: número (progresso %), nota: 1..5 }] aprovada antes do ciclo
  conversaoAprovadaPor: integer("conversao_aprovada_por"),
  conversaoAprovadaEm: timestamp("conversao_aprovada_em"),
  valorAtual: numeric("valor_atual", { precision: 14, scale: 4 }),
  marcos: jsonb("marcos"),                                // [{ titulo, feito }]
  contribuicao: text("contribuicao"),                     // contribuição individual em meta coletiva
  original: jsonb("original"),
  alteracoes: jsonb("alteracoes"),                        // [{ em, por, de, para, justificativa }]
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const perfCheckins = pgTable("perf_checkins", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  data: date("data").notNull(),
  userId: integer("user_id"),
  temas: text("temas"),
  combinados: text("combinados"),
  tipo: text("tipo").notNull().default("REUNIAO"),        // ANDAMENTO (atualização curta) · REUNIAO (acompanhamento)
  cycleId: integer("cycle_id"),
  goalId: integer("goal_id"),
  avancou: text("avancou"),
  evidencia: text("evidencia"),
  bloqueio: text("bloqueio"),
  apoio: text("apoio"),
  proximoCompromisso: text("proximo_compromisso"),
  compromissoGestor: text("compromisso_gestor"),
  compromissoColaborador: text("compromisso_colaborador"),
  compromissoPrazo: date("compromisso_prazo"),
  compromissoCumprido: boolean("compromisso_cumprido"),
  pautaColaborador: text("pauta_colaborador"),
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
  slotId: integer("slot_id"),                      // v24: posição de origem (gate de reposição)
  gate: jsonb("gate"),                             // v24: motivo, orçamento, alternativa avaliada e decisão
  criteriosFit: jsonb("criterios_fit"),            // v26: critérios de aderência [{id, texto, tipo, termos}]
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
  exclusaoPedidaEm: timestamp("exclusao_pedida_em"),        // v25 · pedido de exclusão (LGPD) pelo portal
  curriculoTexto: text("curriculo_texto"),                  // v26 · currículo em texto (base da aderência)
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
  retiradaEm: timestamp("retirada_em"),                    // v25 · T-106: retirada pelo candidato no portal
});

export const applicationEvents = pgTable("application_events", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").notNull(),
  at: timestamp("at").notNull().defaultNow(),
  userNome: text("user_nome"),
  texto: text("texto").notNull(),
  origem: text("origem").notNull().default("RH"),          // v25 · RH · CANDIDATO · RH_PARA_CANDIDATO (aparece no portal)
});

// v26 · aderência com evidências (sugestão) e decisão humana sobre a shortlist
export const applicationFit = pgTable("application_fit", {
  applicationId: integer("application_id").primaryKey(),
  score: integer("score").notNull(),
  atende: integer("atende").notNull().default(0),
  total: integer("total").notNull().default(0),
  obrigatoriosFaltando: integer("obrigatorios_faltando").notNull().default(0),
  detalhes: jsonb("detalhes").notNull(),
  metodo: text("metodo").notNull(),                        // REGRAS · IA
  modelo: text("modelo"),
  versao: text("versao").notNull(),
  mascarados: integer("mascarados").notNull().default(0),
  calculadoEm: timestamp("calculado_em").notNull().defaultNow(),
  calculadoPor: integer("calculado_por"),
});
export const shortlistDecisions = pgTable("shortlist_decisions", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").notNull(),
  decisao: text("decisao").notNull(),                      // AVANCAR · RESERVAR · REPROVAR
  scoreNoMomento: integer("score_no_momento"),
  posicao: integer("posicao"),
  divergiu: boolean("divergiu").notNull().default(false),
  justificativa: text("justificativa"),
  decididoPor: integer("decidido_por").notNull(),
  decididoNome: text("decidido_nome"),
  decididoEm: timestamp("decidido_em").notNull().defaultNow(),
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
  requisitos: text("requisitos"),
  evidencias: text("evidencias"),
  lacunas: text("lacunas"),
  experiencias: text("experiencias"),
  interesseDeclarado: text("interesse_declarado"),
  revisaoEm: date("revisao_em"),
  responsavelUserId: integer("responsavel_user_id"),
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
  formaPagamento: text("forma_pagamento"),                 // v25 · forma da baixa no ActiveSoft (PIX, BOLETO, CARTAO, ...)
  conciliadoEm: timestamp("conciliado_em"),
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
  bankAccountId: integer("bank_account_id"),               // v25 · origem no extrato
  bankLineId: integer("bank_line_id"),
  reclassificadoEm: timestamp("reclassificado_em"),
  contaId: integer("conta_id"),                             // v28 · conta do plano de contas (a categoria acompanha a conta)
  costCenterId: integer("cost_center_id"),                  // v28 · centro de custo (sem ele: a unidade que pagou)
  classificadoPor: integer("classificado_por"),
  classificadoEm: timestamp("classificado_em"),
  classificacaoOrigem: text("classificacao_origem"),        // MANUAL · REGRA · SUGESTAO · CONTAS_A_PAGAR
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
  perspectiva: text("perspectiva"),           // perspectiva do mapa estratégico (null = sugerida pelo pilar)
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
  baselineVersao: integer("baseline_versao").notNull().default(0),
});

export const milestones = pgTable("milestones", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  titulo: text("titulo").notNull(),
  prazo: date("prazo").notNull(),
  responsavelUserId: integer("responsavel_user_id"),
  concluidoEm: date("concluido_em"),
  ordem: integer("ordem").notNull().default(0),
  baselinePrazo: date("baseline_prazo"),            // v24: linha de base
  dependeDe: integer("depende_de"),                 // v24: marco do qual este depende (T-077)
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

// ================= COMUNICAÇÃO E INBOX (DOM-13) =================
export const announcements = pgTable("announcements", {
  id: serial("id").primaryKey(),
  titulo: text("titulo").notNull(),
  texto: text("texto").notNull(),
  publico: text("publico").notNull().default("TODOS"),   // TODOS · UNIDADE · PERFIL
  unitId: integer("unit_id"),
  role: text("role"),
  requerCiencia: boolean("requer_ciencia").notNull().default(false),
  prazoCiencia: date("prazo_ciencia"),
  fixado: boolean("fixado").notNull().default(false),
  autorUserId: integer("autor_user_id"),
  autorNome: text("autor_nome"),
  publicadoEm: timestamp("publicado_em").notNull().defaultNow(),
  expiraEm: date("expira_em"),
  status: text("status").notNull().default("PUBLICADO"),  // v25 · CRQ-COM-V3-01: AGUARDANDO_APROVACAO · APROVADO · AGENDADO · PUBLICADO · REJEITADO
  destinatarios: integer("destinatarios"),
  aprovadoPor: integer("aprovado_por"),
  aprovadoEm: timestamp("aprovado_em"),
  motivoRejeicao: text("motivo_rejeicao"),
  disparoEm: timestamp("disparo_em"),
  disparadoEm: timestamp("disparado_em"),
});

export const announcementAcks = pgTable("announcement_acks", {
  id: serial("id").primaryKey(),
  announcementId: integer("announcement_id").notNull(),
  userId: integer("user_id").notNull(),
  at: timestamp("at").notNull().defaultNow(),
});

export const messageTemplates = pgTable("message_templates", {
  id: serial("id").primaryKey(),
  codigo: text("codigo").notNull(),
  titulo: text("titulo").notNull(),
  categoria: text("categoria").notNull().default("GERAL"), // COBRANCA · MATRICULA · ATENDIMENTO · PEDAGOGICO · RH · GERAL
  canal: text("canal").notNull().default("WHATSAPP"),
  texto: text("texto").notNull(),                          // variáveis {nome} {aluno} {valor} {data} {unidade} {responsavel}
  ativo: boolean("ativo").notNull().default(true),
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  canal: text("canal").notNull().default("WHATSAPP"),     // WHATSAPP · EMAIL · TELEFONE · PRESENCIAL
  destinatarioNome: text("destinatario_nome").notNull(),
  destinatarioContato: text("destinatario_contato"),
  studentId: integer("student_id"),
  employeeId: integer("employee_id"),
  entidade: text("entidade"),                             // caso, receivable, work_order…
  entidadeId: integer("entidade_id"),
  templateId: integer("template_id"),
  texto: text("texto").notNull(),
  status: text("status").notNull().default("REGISTRADA"), // REGISTRADA · ENVIADA · ENTREGUE · FALHOU · AGENDADA
  agendadaPara: timestamp("agendada_para"),
  enviadaEm: timestamp("enviada_em"),
  provedorId: text("provedor_id"),
  erro: text("erro"),
  userId: integer("user_id"),
  userNome: text("user_nome"),
  unitId: integer("unit_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  campaignId: integer("campaign_id"),                     // v25 · envio em massa (CRQ-COM-V3-01)
});

// ================= PLATAFORMA: ANEXOS E NOTIFICAÇÕES (DOM-15) =================
export const attachments = pgTable("attachments", {
  id: serial("id").primaryKey(),
  entidade: text("entidade").notNull(),                   // employee · student · case · work_order · project · procedure · receivable
  entidadeId: integer("entidade_id").notNull(),
  nome: text("nome").notNull(),
  mime: text("mime").notNull(),
  tamanho: integer("tamanho").notNull(),
  dados: customType<{ data: Buffer; driverData: Buffer }>({ dataType() { return "bytea"; } })("dados").notNull(),
  descricao: text("descricao"),
  unitId: integer("unit_id"),
  userId: integer("user_id"),
  userNome: text("user_nome"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  tipo: text("tipo").notNull().default("INFO"),           // INFO · ACAO · ALERTA
  titulo: text("titulo").notNull(),
  texto: text("texto"),
  link: text("link"),
  lidaEm: timestamp("lida_em"),
  chave: text("chave"),                                   // evita duplicar o mesmo aviso (ex.: sla:123)
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ================= AVALIAÇÃO POR CRITÉRIOS (Painel do Colaborador) =================
export const evalModels = pgTable("eval_models", {
  id: serial("id").primaryKey(),
  nome: text("nome").notNull(),
  familia: text("familia").notNull(),                     // PROFESSORES · COORDENACAO · SECRETARIA · ATENDIMENTO_COMERCIAL · APOIO_OPERACIONAL · GESTAO
  versao: integer("versao").notNull().default(1),
  status: text("status").notNull().default("RASCUNHO"),   // RASCUNHO · ATIVO · ARQUIVADO
  pesoResultados: integer("peso_resultados").notNull().default(60),
  pesoAtitudes: integer("peso_atitudes").notNull().default(40),
  criterios: jsonb("criterios").notNull(),                // [{id, eixo, titulo, descricao, peso, niveis: {1..5}, evidencia, naPermitido}]
  finalidade: text("finalidade"),                         // finalidade da nota composta (obrigatória para habilitá-la)
  notaComposta: boolean("nota_composta").notNull().default(false),
  faixas: jsonb("faixas"),                                // { matriz: [2,3,4], final: [3,4] } — configuradas e versionadas
  coberturaMinima: integer("cobertura_minima").notNull().default(50), // % do peso de cada eixo com critério válido para concluir
  congeladoEm: timestamp("congelado_em"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const evalEvidences = pgTable("eval_evidences", {
  id: serial("id").primaryKey(),
  reviewId: integer("review_id"),
  employeeId: integer("employee_id"),
  cycleId: integer("cycle_id"),
  criterioId: text("criterio_id"),
  criterios: jsonb("criterios"),                          // string[] — uma evidência pode apoiar mais de um critério (sinaliza dupla contagem)
  natureza: text("natureza").notNull().default("REGISTRO"), // REGISTRO (verificável) · OBSERVACAO (direta) · RELATO (terceiro) · AUTO (autoavaliação) · INTERPRETACAO (do avaliador)
  dataFato: date("data_fato"),
  fonte: text("fonte"),
  contexto: text("contexto"),
  visibilidade: text("visibilidade").notNull().default("COLABORADOR"), // COLABORADOR (o avaliado vê) · GESTAO
  validacao: text("validacao").notNull().default("NAO_VALIDADA"),    // NAO_VALIDADA · VALIDADA · CONTESTADA
  limitacoes: text("limitacoes"),
  contestacao: text("contestacao"),
  contestadaEm: timestamp("contestada_em"),
  complemento: text("complemento"),
  origemModulo: text("origem_modulo"),
  origemRef: text("origem_ref"),
  origemAtualizadoEm: timestamp("origem_atualizado_em"),
  tipo: text("tipo").notNull().default("TEXTO"),          // TEXTO · LINK · ANEXO
  titulo: text("titulo").notNull(),
  texto: text("texto"),
  url: text("url"),
  attachmentId: integer("attachment_id"),
  userId: integer("user_id"),
  userNome: text("user_nome"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const feedbacks = pgTable("feedbacks", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  cycleId: integer("cycle_id"),
  reviewId: integer("review_id"),
  tipo: text("tipo").notNull().default("DESENVOLVIMENTO"), // RECONHECIMENTO · DESENVOLVIMENTO · DEVOLUTIVA
  data: date("data").notNull(),
  situacao: text("situacao").notNull(),
  comportamento: text("comportamento").notNull(),
  impacto: text("impacto"),
  evidencia: text("evidencia"),
  acordo: text("acordo"),
  autorUserId: integer("autor_user_id"),
  autorNome: text("autor_nome"),
  cienciaEm: timestamp("ciencia_em"),
  comentarioColaborador: text("comentario_colaborador"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const pdiPlans = pgTable("pdi_plans", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  cycleId: integer("cycle_id"),
  reviewId: integer("review_id"),
  criterioId: text("criterio_id"),
  competencia: text("competencia").notNull(),
  evidencia: text("evidencia"),
  objetivo: text("objetivo").notNull(),
  situacaoInicial: text("situacao_inicial"),
  meta: text("meta"),
  indicador: text("indicador"),
  status: text("status").notNull().default("ATIVO"),      // ATIVO · CONCLUIDO · CANCELADO
  validadoPor: integer("validado_por"),
  validadoEm: timestamp("validado_em"),
  tipo: text("tipo").notNull().default("CRESCIMENTO"),    // CRESCIMENTO · MELHORIA_FORMAL (plano formal de melhoria — fluxo próprio)
  natureza: text("natureza").notNull().default("LACUNA"), // LACUNA · FORTALEZA (ponto forte a aprofundar/compartilhar)
  compartilhar: boolean("compartilhar").notNull().default(false),
  aplicacaoStatus: text("aplicacao_status").notNull().default("PENDENTE"), // PENDENTE · APLICANDO · APLICADA · NAO_APLICADA
  aplicacaoEvidencia: text("aplicacao_evidencia"),
  aplicacaoEm: date("aplicacao_em"),
  resultadoStatus: text("resultado_status").notNull().default("NAO_VERIFICADO"), // NAO_VERIFICADO · MELHORA_OBSERVADA · SEM_MUDANCA · INCONCLUSIVO
  resultadoObservado: text("resultado_observado"),
  resultadoVerificadoPor: integer("resultado_verificado_por"),
  resultadoVerificadoEm: timestamp("resultado_verificado_em"),
  expectativas: text("expectativas"),
  prazoFinal: date("prazo_final"),
  manifestacao: text("manifestacao"),
  manifestacaoEm: timestamp("manifestacao_em"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const pdiActions = pgTable("pdi_actions", {
  id: serial("id").primaryKey(),
  planId: integer("plan_id").notNull(),
  tipo: text("tipo").notNull().default("TREINAMENTO_INTERNO"), // CURSO · LEITURA · MENTORIA · OBSERVACAO · PROJETO · TREINAMENTO_INTERNO
  descricao: text("descricao").notNull(),
  responsavelUserId: integer("responsavel_user_id"),
  apoio: text("apoio"),
  prazo: date("prazo"),
  exigeEvidencia: boolean("exige_evidencia").notNull().default(true),
  status: text("status").notNull().default("NAO_INICIADA"), // NAO_INICIADA · EM_ANDAMENTO · AGUARDANDO_VALIDACAO · CONCLUIDA · CANCELADA
  evidencia: text("evidencia"),
  courseId: integer("course_id"),
  concluidaEm: date("concluida_em"),
  validadaPor: integer("validada_por"),
  validadaEm: timestamp("validada_em"),
  cancelJustificativa: text("cancel_justificativa"),
  compromissoColaborador: text("compromisso_colaborador"),
  compromissoGestor: text("compromisso_gestor"),
  recursos: text("recursos"),
  tempoPrevisto: text("tempo_previsto"),
  formaAcompanhamento: text("forma_acompanhamento"),
  bloqueio: text("bloqueio"),
  bloqueioDesde: date("bloqueio_desde"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const pdiCheckins = pgTable("pdi_checkins", {
  id: serial("id").primaryKey(),
  actionId: integer("action_id").notNull(),
  data: date("data").notNull(),
  texto: text("texto"),
  obstaculo: text("obstaculo"),
  novoPrazo: date("novo_prazo"),
  userId: integer("user_id"),
  userNome: text("user_nome"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const behaviorProfiles = pgTable("behavior_profiles", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  instrumento: text("instrumento").notNull(),
  fornecedor: text("fornecedor"),
  versao: text("versao"),
  data: date("data").notNull(),
  responsavelUserId: integer("responsavel_user_id"),
  escala: text("escala"),                                 // descrição da escala original (ex.: 0–100 por fator, não composicional)
  d: numeric("d", { precision: 6, scale: 2 }),
  i: numeric("i", { precision: 6, scale: 2 }),
  s: numeric("s", { precision: 6, scale: 2 }),
  c: numeric("c", { precision: 6, scale: 2 }),
  relatorioUrl: text("relatorio_url"),
  attachmentId: integer("attachment_id"),
  limitacoes: text("limitacoes"),
  obs: text("obs"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ================= APRIMORAMENTO V2 — expectativas, encaminhamentos, prática docente, avaliadores, carreira, fontes, IA =================
export const roleProfiles = pgTable("role_profiles", {
  id: serial("id").primaryKey(),
  positionId: integer("position_id"),
  familia: text("familia"),
  nivel: text("nivel"),
  titulo: text("titulo").notNull(),
  versao: integer("versao").notNull().default(1),
  status: text("status").notNull().default("RASCUNHO"),   // RASCUNHO · VIGENTE · ARQUIVADO
  vigenciaInicio: date("vigencia_inicio"),
  vigenciaFim: date("vigencia_fim"),
  finalidade: text("finalidade"),
  responsabilidades: jsonb("responsabilidades"), entregas: jsonb("entregas"), competencias: jsonb("competencias"), // competencias: [{ nome, nivel (1–5), descricao }]
  comportamentos: jsonb("comportamentos"), evidencias: jsonb("evidencias"), condicoes: jsonb("condicoes"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const roleProfileAcks = pgTable("role_profile_acks", { id: serial("id").primaryKey(), profileId: integer("profile_id").notNull(), employeeId: integer("employee_id").notNull(), comentario: text("comentario"), at: timestamp("at").notNull().defaultNow() });
export const devNeeds = pgTable("dev_needs", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id"), unitId: integer("unit_id"), cycleId: integer("cycle_id"), reviewId: integer("review_id"), criterioId: text("criterio_id"),
  origem: text("origem").notNull().default("GESTAO"),     // AVALIACAO · ACOMPANHAMENTO · OBSERVACAO · FEEDBACK · GESTAO
  descricao: text("descricao").notNull(),
  hipotese: text("hipotese").notNull().default("CONTEXTO"), // INDIVIDUAL · PROCESSO · ORIENTACAO · RECURSO · DEPENDENCIA · CONTEXTO
  encaminhamento: text("encaminhamento").notNull(),       // PDI · PROCESSO · FORMACAO_COLETIVA · APOIO_LIDERANCA · INFRAESTRUTURA
  acao: text("acao"), responsavelUserId: integer("responsavel_user_id"), prazo: date("prazo"), apoio: text("apoio"), evidenciaEsperada: text("evidencia_esperada"), verificacao: text("verificacao"),
  status: text("status").notNull().default("ABERTO"),     // ABERTO · EM_ANDAMENTO · CONCLUIDO · CANCELADO
  refModulo: text("ref_modulo"), refId: integer("ref_id"), resultadoVerificado: text("resultado_verificado"),
  createdBy: integer("created_by"), createdAt: timestamp("created_at").notNull().defaultNow(), updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const teachingObservations = pgTable("teaching_observations", {
  id: serial("id").primaryKey(), employeeId: integer("employee_id").notNull(), observadorUserId: integer("observador_user_id"), unitId: integer("unit_id"),
  segmento: text("segmento"), turmaRef: text("turma_ref"),        // rótulo da turma apenas — nenhum dado de estudante
  finalidade: text("finalidade").notNull().default("FORMATIVA"), // FORMATIVA · FORMAL
  podeCompor: boolean("pode_compor").notNull().default(false),  // definido no planejamento; só FORMAL pode compor avaliação
  dataPlanejada: date("data_planejada"), dataObservacao: date("data_observacao"), focoPlanejado: text("foco_planejado"),
  rubrica: jsonb("rubrica"),                                    // [{ dimensao, nivel (1–4 descritivo), registro }]
  status: text("status").notNull().default("PLANEJADA"),        // PLANEJADA · OBSERVADA · DEVOLUTIVA · FOCO · APLICACAO · REOBSERVADA
  devolutiva: text("devolutiva"), focoDesenvolvimento: text("foco_desenvolvimento"), aplicacao: text("aplicacao"), anteriorId: integer("anterior_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const raterTrainings = pgTable("rater_trainings", { id: serial("id").primaryKey(), titulo: text("titulo").notNull(), modelId: integer("model_id"), modelVersao: integer("model_versao"), versao: integer("versao").notNull().default(1), orientacoes: text("orientacoes"), casos: jsonb("casos").notNull(), discussao: text("discussao"), status: text("status").notNull().default("ABERTO"), createdBy: integer("created_by"), createdAt: timestamp("created_at").notNull().defaultNow() });
export const raterTrainingResponses = pgTable("rater_training_responses", { id: serial("id").primaryKey(), trainingId: integer("training_id").notNull(), userId: integer("user_id").notNull(), casoId: text("caso_id").notNull(), notas: jsonb("notas").notNull(), justificativa: text("justificativa"), at: timestamp("at").notNull().defaultNow() });
export const careerInterests = pgTable("career_interests", { id: serial("id").primaryKey(), employeeId: integer("employee_id").notNull(), data: date("data").notNull(), interesses: text("interesses"), funcoes: text("funcoes"), lideranca: text("lideranca").notNull().default("NAO_INFORMADO"), mobilidade: text("mobilidade"), obs: text("obs"), registradoPor: integer("registrado_por"), createdAt: timestamp("created_at").notNull().defaultNow() });
export const reviewRaters = pgTable("review_raters", { id: serial("id").primaryKey(), reviewId: integer("review_id").notNull(), userId: integer("user_id").notNull(), grupo: text("grupo").notNull(), motivo: text("motivo"), status: text("status").notNull().default("CONVIDADO"), notas: jsonb("notas"), comentario: text("comentario"), respondidoEm: timestamp("respondido_em"), createdAt: timestamp("created_at").notNull().defaultNow() });
export const aiDrafts = pgTable("ai_drafts", { id: serial("id").primaryKey(), employeeId: integer("employee_id").notNull(), reviewId: integer("review_id"), tipo: text("tipo").notNull(), modelo: text("modelo"), configVersao: text("config_versao"), fontes: jsonb("fontes"), texto: text("texto").notNull(), alertas: jsonb("alertas"), status: text("status").notNull().default("RASCUNHO"), aprovadoPor: integer("aprovado_por"), aprovadoEm: timestamp("aprovado_em"), createdBy: integer("created_by"), createdAt: timestamp("created_at").notNull().defaultNow() });

/** Agentes de IA da operação (inventário com dono humano, nível de autonomia N0–N3, escopo e limites). */
export const aiAgents = pgTable("ai_agents", {
  id: serial("id").primaryKey(),
  nome: text("nome").notNull(),
  funcao: text("funcao").notNull(),
  area: text("area"),
  unitId: integer("unit_id"),
  positionId: integer("position_id"),
  donoUserId: integer("dono_user_id"),
  nivel: text("nivel").notNull().default("N1"),
  ferramenta: text("ferramenta"),
  dados: text("dados"),
  limites: text("limites"),
  revisaoHumana: text("revisao_humana"),
  status: text("status").notNull().default("PILOTO"),
  revisaoEm: date("revisao_em"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ======================= Gestão estratégica (v21) =======================
/** Identidade institucional versionada: missão, visão, valores (com práticas observáveis), proposta de valor e posicionamento. */
export const strategyIdentity = pgTable("strategy_identity", {
  id: serial("id").primaryKey(),
  versao: integer("versao").notNull().default(1),
  status: text("status").notNull().default("RASCUNHO"),   // RASCUNHO · VIGENTE · ARQUIVADO
  missao: text("missao"),
  visao: text("visao"),
  proposito: text("proposito"),
  valores: jsonb("valores"),                              // [{ nome, pratica }]
  propostaValor: text("proposta_valor"),
  posicionamento: text("posicionamento"),
  horizonte: text("horizonte"),
  vigenciaInicio: date("vigencia_inicio"),
  aprovadoPor: integer("aprovado_por"),
  aprovadoEm: timestamp("aprovado_em"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
/** Relação de causa e efeito entre objetivos no mapa estratégico (de → contribui para). */
export const objectiveLinks = pgTable("objective_links", {
  id: serial("id").primaryKey(),
  deObjectiveId: integer("de_objective_id").notNull(),
  paraObjectiveId: integer("para_objective_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
/** Indicadores de acompanhamento contínuo (diferentes dos KRs, que são metas de um ciclo). */
export const indicators = pgTable("indicators", {
  id: serial("id").primaryKey(),
  codigo: text("codigo"),
  nome: text("nome").notNull(),
  descricao: text("descricao"),
  perspectiva: text("perspectiva"),
  area: text("area"),
  unitId: integer("unit_id"),                              // null = rede
  unidadeMedida: text("unidade_medida"),
  direcao: text("direcao").notNull().default("MAIOR_MELHOR"), // MAIOR_MELHOR · MENOR_MELHOR · FAIXA
  meta: numeric("meta", { precision: 14, scale: 4 }),
  alerta: numeric("alerta", { precision: 14, scale: 4 }),
  faixaMin: numeric("faixa_min", { precision: 14, scale: 4 }),
  faixaMax: numeric("faixa_max", { precision: 14, scale: 4 }),
  tipo: text("tipo").notNull().default("MANUAL"),         // MANUAL · SISTEMA · CALCULADO
  fonte: text("fonte"),                                     // chave da métrica do sistema (tipo SISTEMA)
  numeradorId: integer("numerador_id"),                     // tipo CALCULADO: numerador ÷ denominador × fator
  denominadorId: integer("denominador_id"),
  fator: numeric("fator", { precision: 14, scale: 4 }),
  frequencia: text("frequencia").notNull().default("MENSAL"),
  funil: text("funil"),                                     // marketing: INVESTIMENTO (valor aplicado no mês)
  canal: text("canal"),                                     // marketing: origem/canal (mesmas chaves da origem do aluno)
  objectiveId: integer("objective_id"),
  responsavelUserId: integer("responsavel_user_id"),
  ativo: boolean("ativo").notNull().default(true),
  ordem: integer("ordem").notNull().default(0),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
/** Uma medição por indicador e mês ('YYYY-MM'). */
export const indicatorValues = pgTable("indicator_values", {
  id: serial("id").primaryKey(),
  indicatorId: integer("indicator_id").notNull(),
  periodo: text("periodo").notNull(),
  valor: numeric("valor", { precision: 16, scale: 4 }),
  origem: text("origem").notNull().default("MANUAL"),     // MANUAL · SISTEMA · IMPORTACAO
  obs: text("obs"),
  userId: integer("user_id"),
  userNome: text("user_nome"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
/** Plano de ação 5W2H: o quê, por quê, onde, quando, quem, como, quanto. */
export const actionPlans = pgTable("action_plans", {
  id: serial("id").primaryKey(),
  titulo: text("titulo").notNull(),                        // o quê
  porque: text("porque"),                                   // por quê
  unitId: integer("unit_id"),                               // onde (unidade)
  local: text("local"),                                     // onde (detalhe)
  inicio: date("inicio"),                                   // quando
  prazo: date("prazo"),
  responsavelUserId: integer("responsavel_user_id"),        // quem
  como: text("como"),                                       // como
  custoPrevisto: numeric("custo_previsto", { precision: 12, scale: 2 }), // quanto
  custoReal: numeric("custo_real", { precision: 12, scale: 2 }),
  status: text("status").notNull().default("A_FAZER"),     // A_FAZER · EM_ANDAMENTO · BLOQUEADA · CONCLUIDA · CANCELADA
  bloqueio: text("bloqueio"),
  bloqueioDesde: date("bloqueio_desde"),
  evidencia: text("evidencia"),
  concluidaEm: date("concluida_em"),
  cancelJustificativa: text("cancel_justificativa"),
  objectiveId: integer("objective_id"),
  indicatorId: integer("indicator_id"),
  projectId: integer("project_id"),
  ritualMeetingId: integer("ritual_meeting_id"),
  origem: text("origem"),                                   // texto livre da origem (ex.: não conformidade #12)
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
/** Rituais de gestão: reuniões recorrentes com finalidade, pauta, participantes e indicadores revisados. */
export const rituals = pgTable("rituals", {
  id: serial("id").primaryKey(),
  nome: text("nome").notNull(),
  tipo: text("tipo").notNull().default("MENSAL"),
  finalidade: text("finalidade"),
  unitId: integer("unit_id"),
  donoUserId: integer("dono_user_id"),
  participantes: jsonb("participantes"),                  // [userId]
  pautaPadrao: text("pauta_padrao"),
  indicadores: jsonb("indicadores"),                      // [indicatorId]
  objetivos: jsonb("objetivos"),                          // [objectiveId] revisados no ritual
  duracaoMin: integer("duracao_min"),
  proximaData: date("proxima_data"),
  ativo: boolean("ativo").notNull().default(true),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const ritualMeetings = pgTable("ritual_meetings", {
  id: serial("id").primaryKey(),
  ritualId: integer("ritual_id").notNull(),
  data: date("data").notNull(),
  status: text("status").notNull().default("REALIZADA"),  // REALIZADA · CANCELADA
  presentes: jsonb("presentes"),                           // [userId]
  pauta: text("pauta"),
  ata: text("ata"),
  indicadoresSnapshot: jsonb("indicadores_snapshot"),     // [{ id, nome, periodo, valor, farol }]
  cancelMotivo: text("cancel_motivo"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ======================= Radar da família (v21) =======================
/** Interações registradas com a família (ligação, mensagem, reunião…), com próximo passo combinado. */
export const familyContacts = pgTable("family_contacts", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").notNull(),
  data: date("data").notNull(),
  canal: text("canal"),
  tipo: text("tipo").notNull().default("CONTATO"),
  etapa: text("etapa"),                                    // etapa da jornada concluída nesta interação (opcional)
  resumo: text("resumo").notNull(),
  percepcao: text("percepcao"),                            // POSITIVA · NEUTRA · NEGATIVA (registrada por quem atendeu)
  proximoPasso: text("proximo_passo"),
  proximoEm: date("proximo_em"),
  userId: integer("user_id"),
  userNome: text("user_nome"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
/** Etapas da jornada da família cumpridas no ano letivo. */
/** Rascunhos do assistente estratégico (IA como apoio: fatos citados, revisão humana obrigatória). */
export const strategyAiDrafts = pgTable("strategy_ai_drafts", {
  id: serial("id").primaryKey(),
  tarefa: text("tarefa").notNull(),
  unitId: integer("unit_id"),
  modelo: text("modelo"),
  configVersao: text("config_versao"),
  fontes: jsonb("fontes"),
  texto: text("texto").notNull(),
  alertas: jsonb("alertas"),
  status: text("status").notNull().default("RASCUNHO"), // RASCUNHO · APROVADO · DESCARTADO
  aprovadoPor: integer("aprovado_por"),
  aprovadoEm: timestamp("aprovado_em"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const familyJourney = pgTable("family_journey", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").notNull(),
  ano: integer("ano").notNull(),
  etapa: text("etapa").notNull(),
  concluidaEm: date("concluida_em").notNull(),
  contactId: integer("contact_id"),
  userId: integer("user_id"),
  obs: text("obs"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ======================= v22: rematrícula por link =======================
/** Link individual de rematrícula: a família confere os dados, escolhe o turno dentro das vagas e aceita o contrato (evidência guardada). */
export const rematriculaLinks = pgTable("rematricula_links", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").notNull(),
  ano: integer("ano").notNull(),
  unitId: integer("unit_id"),                              // unidade do aluno quando o link foi gerado (escopo)
  gradeId: integer("grade_id"),                            // série prevista para o ano (definida pela escola)
  token: text("token").notNull().unique(),
  status: text("status").notNull().default("PENDENTE"),   // PENDENTE · CONCLUIDA · RECUSADA · CANCELADA · EXPIRADA
  expiraEm: date("expira_em").notNull(),
  enviadoEm: timestamp("enviado_em"),
  enviadoPor: integer("enviado_por"),
  abertoEm: timestamp("aberto_em"),
  concluidoEm: timestamp("concluido_em"),
  classId: integer("class_id"),
  integralClassId: integer("integral_class_id"),
  enrollmentId: integer("enrollment_id"),
  integralEnrollmentId: integer("integral_enrollment_id"),
  contratoId: integer("contrato_id"),
  contratoVersao: integer("contrato_versao"),
  contratoHash: text("contrato_hash"),                     // SHA-256 do texto exibido e aceito
  contratoTexto: text("contrato_texto"),                   // texto exato aceito (com as variáveis preenchidas)
  aceite: jsonb("aceite"),                                 // { nome, cpfFinal, ip, userAgent, em }
  dadosAtualizados: jsonb("dados_atualizados"),            // { campo: { de, para } }
  rascunho: jsonb("rascunho"),                             // escolha da etapa 1 (turma, Integral e dados) até o aceite
  recusaMotivo: text("recusa_motivo"),
  recusaObs: text("recusa_obs"),
  caseId: integer("case_id"),
  cancelMotivo: text("cancel_motivo"),
  criadoPor: integer("criado_por"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
/** Modelo de contrato do ano letivo, versionado: só uma versão vigente por ano; o aceite guarda a versão e o texto exato. */
export const contractTemplates = pgTable("contract_templates", {
  id: serial("id").primaryKey(),
  ano: integer("ano").notNull(),
  titulo: text("titulo").notNull(),
  versao: integer("versao").notNull().default(1),
  texto: text("texto").notNull(),
  status: text("status").notNull().default("RASCUNHO"),   // RASCUNHO · VIGENTE · ARQUIVADO
  publicadoEm: timestamp("publicado_em"),
  publicadoPor: integer("publicado_por"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ======================= v22: substituição de professor =======================
/** Grade horária dos professores (aula = professor × dia da semana × horário × turma). */
export const teacherSlots = pgTable("teacher_slots", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  unitId: integer("unit_id").notNull(),
  diaSemana: integer("dia_semana").notNull(),              // 1 = segunda … 6 = sábado
  inicio: text("inicio").notNull(),                        // HH:MM
  fim: text("fim").notNull(),
  turno: text("turno").notNull(),                          // Matutino · Vespertino · Noturno
  turma: text("turma").notNull(),
  disciplina: text("disciplina"),
  spaceId: integer("space_id"),
  ativo: boolean("ativo").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  versionId: integer("version_id"),                        // v25 · T-053: vigência da grade
});
/** Ausência de professor num dia (falta, atestado, afastamento aprovado, formação…), que gera as aulas a cobrir. */
export const coverAbsences = pgTable("cover_absences", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  unitId: integer("unit_id"),
  data: date("data").notNull(),
  inicio: text("inicio"),                                  // período parcial (vazio = dia todo)
  fim: text("fim"),
  motivo: text("motivo").notNull(),                        // FALTA · ATESTADO · AFASTAMENTO · FERIAS · LICENCA · FORMACAO · OUTRO
  origem: text("origem").notNull().default("COORDENACAO"), // COORDENACAO · PROFESSOR · AFASTAMENTO
  leaveRequestId: integer("leave_request_id"),
  status: text("status").notNull().default("ATIVA"),      // ATIVA · CANCELADA
  obs: text("obs"),
  registradoPor: integer("registrado_por"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
/** Aula a cobrir numa data: quem cobre, aceite, realização e crédito no banco de horas. Guarda um retrato da aula (turma, horário). */
export const coverAssignments = pgTable("cover_assignments", {
  id: serial("id").primaryKey(),
  absenceId: integer("absence_id").notNull(),
  slotId: integer("slot_id"),
  data: date("data").notNull(),
  unitId: integer("unit_id").notNull(),
  turma: text("turma").notNull(),
  disciplina: text("disciplina"),
  inicio: text("inicio").notNull(),
  fim: text("fim").notNull(),
  turno: text("turno"),
  ausenteEmployeeId: integer("ausente_employee_id").notNull(),
  coberturaEmployeeId: integer("cobertura_employee_id"),
  status: text("status").notNull().default("ABERTA"),     // ABERTA · CONVIDADO · CONFIRMADA · REALIZADA · SEM_PROFESSOR · CANCELADA
  solucao: text("solucao"),                                // sem professor: ATIVIDADE_ORIENTADA · JUNCAO · DISPENSA · OUTRA
  minutos: integer("minutos").notNull().default(0),
  hourEntryId: integer("hour_entry_id"),
  recusas: jsonb("recusas"),                               // [{ employeeId, nome, em, motivo }]
  convidadoPor: integer("convidado_por"),
  convidadoEm: timestamp("convidado_em"),
  respondidoEm: timestamp("respondido_em"),
  realizadaEm: timestamp("realizada_em"),
  obs: text("obs"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ======================= v22: espaços (mapa de salas e reservas) =======================
export const spaces = pgTable("spaces", {
  id: serial("id").primaryKey(),
  unitId: integer("unit_id").notNull(),
  nome: text("nome").notNull(),
  tipo: text("tipo").notNull().default("SALA"),            // SALA · LABORATORIO · QUADRA · AUDITORIO · BIBLIOTECA · BRINQUEDOTECA · EQUIPAMENTO · OUTRO
  capacidade: integer("capacidade"),                       // pessoas (equipamento: unidades)
  areaM2: numeric("area_m2", { precision: 8, scale: 2 }),
  reservavel: boolean("reservavel").notNull().default(false),
  ativo: boolean("ativo").notNull().default(true),
  obs: text("obs"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const spaceBookings = pgTable("space_bookings", {
  id: serial("id").primaryKey(),
  spaceId: integer("space_id").notNull(),
  unitId: integer("unit_id").notNull(),
  data: date("data").notNull(),
  inicio: text("inicio").notNull(),
  fim: text("fim").notNull(),
  titulo: text("titulo").notNull(),
  turma: text("turma"),
  grupo: text("grupo"),                                    // reservas repetidas (mesma série semanal)
  status: text("status").notNull().default("CONFIRMADA"), // CONFIRMADA · CANCELADA
  solicitanteUserId: integer("solicitante_user_id"),
  solicitanteNome: text("solicitante_nome"),
  cancelMotivo: text("cancel_motivo"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ======================= v22: portaria e segurança =======================
export const visits = pgTable("visits", {
  id: serial("id").primaryKey(),
  unitId: integer("unit_id").notNull(),
  tipo: text("tipo").notNull().default("VISITANTE"),      // VISITANTE · PRESTADOR · ENTREGA · FAMILIA · OUTRO
  nome: text("nome").notNull(),
  documento: text("documento"),
  empresa: text("empresa"),
  motivo: text("motivo"),
  visitado: text("visitado"),                              // pessoa ou setor visitado
  cracha: text("cracha"),
  entrada: timestamp("entrada").notNull().defaultNow(),
  saida: timestamp("saida"),
  registradoPor: integer("registrado_por"),
  saidaPor: integer("saida_por"),
  anonimizadoEm: timestamp("anonimizado_em"),
  obs: text("obs"),
});
/** Quem pode (ou não pode) buscar o aluno. PROIBIDO bloqueia a entrega; o detalhe da restrição só a gestão vê. */
export const pickupAuthorizations = pgTable("pickup_authorizations", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").notNull(),
  nome: text("nome").notNull(),
  parentesco: text("parentesco"),
  documento: text("documento"),
  telefone: text("telefone"),
  tipo: text("tipo").notNull().default("AUTORIZADO"),     // AUTORIZADO · PROIBIDO
  validade: date("validade"),
  restricaoObs: text("restricao_obs"),
  ativo: boolean("ativo").notNull().default(true),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
/** Saída antecipada (e entrega à família numa emergência) com conferência de quem retira. */
export const earlyDepartures = pgTable("early_departures", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").notNull(),
  unitId: integer("unit_id").notNull(),
  data: date("data").notNull(),
  hora: text("hora").notNull(),
  retiradoPor: text("retirado_por").notNull(),
  documento: text("documento"),
  authorizationId: integer("authorization_id"),
  status: text("status").notNull().default("LIBERADA"),   // LIBERADA · BLOQUEADA
  motivo: text("motivo"),
  excecaoJustificativa: text("excecao_justificativa"),
  autorizadoPor: integer("autorizado_por"),
  registradoPor: integer("registrado_por"),
  registradoNome: text("registrado_nome"),
  responsavelAvisado: boolean("responsavel_avisado").notNull().default(false),
  emergencyEventId: integer("emergency_event_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const brigadeMembers = pgTable("brigade_members", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  unitId: integer("unit_id").notNull(),
  funcao: text("funcao").notNull().default("BRIGADISTA"), // BRIGADISTA · LIDER · SOCORRISTA
  turno: text("turno"),
  treinamentoEm: date("treinamento_em"),
  validade: date("validade"),
  ativo: boolean("ativo").notNull().default(true),
  obs: text("obs"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
/** Simulado de abandono ou emergência real: chamada por grupo, tempo de evacuação, falhas e entrega às famílias. */
export const emergencyEvents = pgTable("emergency_events", {
  id: serial("id").primaryKey(),
  unitId: integer("unit_id").notNull(),
  tipo: text("tipo").notNull().default("SIMULADO"),       // SIMULADO · REAL
  cenario: text("cenario").notNull(),
  status: text("status").notNull().default("EM_ANDAMENTO"), // EM_ANDAMENTO · ENCERRADO
  inicio: timestamp("inicio").notNull().defaultNow(),
  evacuacaoEm: timestamp("evacuacao_em"),
  encerradoEm: timestamp("encerrado_em"),
  tempoEvacuacaoSeg: integer("tempo_evacuacao_seg"),
  metaSeg: integer("meta_seg"),
  pontosEncontro: text("pontos_encontro"),
  observacoes: text("observacoes"),
  coordenadorUserId: integer("coordenador_user_id"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const emergencyChecks = pgTable("emergency_checks", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull(),
  grupo: text("grupo").notNull(),
  ordem: integer("ordem").notNull().default(0),
  esperado: integer("esperado"),
  presentes: integer("presentes"),
  feridos: integer("feridos").notNull().default(0),
  naoLocalizados: integer("nao_localizados").notNull().default(0),
  status: text("status").notNull().default("PENDENTE"),   // PENDENTE · SEGURO · OCORRENCIA
  responsavel: text("responsavel"),
  checadoEm: timestamp("checado_em"),
  checadoPor: text("checado_por"),
  obs: text("obs"),
});
export const emergencyFailures = pgTable("emergency_failures", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull(),
  descricao: text("descricao").notNull(),
  gravidade: text("gravidade").notNull().default("MEDIA"), // BAIXA · MEDIA · ALTA
  actionPlanId: integer("action_plan_id"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ======================= v22: privacidade (LGPD) =======================
export const consentPurposes = pgTable("consent_purposes", {
  id: serial("id").primaryKey(),
  codigo: text("codigo").notNull().unique(),
  titulo: text("titulo").notNull(),
  texto: text("texto").notNull(),                          // texto exibido em destaque para o responsável
  versao: integer("versao").notNull().default(1),
  ativo: boolean("ativo").notNull().default(true),
  naRematricula: boolean("na_rematricula").notNull().default(true),
  ordem: integer("ordem").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
/** Histórico de consentimentos (só acrescenta): a situação vigente é o registro mais recente por aluno e finalidade. */
export const consents = pgTable("consents", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").notNull(),
  purposeId: integer("purpose_id").notNull(),
  versao: integer("versao").notNull(),
  status: text("status").notNull(),                        // CONCEDIDO · NEGADO · REVOGADO
  titularNome: text("titular_nome"),
  origem: text("origem").notNull(),                        // REMATRICULA_LINK · SECRETARIA · PEDIDO_TITULAR
  evidencia: jsonb("evidencia"),
  userId: integer("user_id"),
  userNome: text("user_nome"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const privacyRequests = pgTable("privacy_requests", {
  id: serial("id").primaryKey(),
  protocolo: text("protocolo").notNull().unique(),
  codigoHash: text("codigo_hash"),
  tipo: text("tipo").notNull(),
  titularNome: text("titular_nome").notNull(),
  titularTipo: text("titular_tipo"),
  alunoNome: text("aluno_nome"),
  contatoEmail: text("contato_email"),
  contatoTelefone: text("contato_telefone"),
  descricao: text("descricao"),
  canal: text("canal").notNull().default("PORTAL"),
  studentId: integer("student_id"),
  employeeId: integer("employee_id"),
  status: text("status").notNull().default("RECEBIDA"),   // RECEBIDA · EM_ANALISE · AGUARDANDO_TITULAR · RESPONDIDA · INDEFERIDA
  prazo: date("prazo").notNull(),
  identidadeVerificada: boolean("identidade_verificada").notNull().default(false),
  responsavelUserId: integer("responsavel_user_id"),
  resposta: text("resposta"),
  respondidaEm: timestamp("respondida_em"),
  historico: jsonb("historico"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
/** Incidentes de segurança com dados pessoais: registro obrigatório (mantido por 5 anos), prazo de comunicação à ANPD em dias úteis. */
export const privacyIncidents = pgTable("privacy_incidents", {
  id: serial("id").primaryKey(),
  codigo: text("codigo").notNull().unique(),
  titulo: text("titulo").notNull(),
  descricao: text("descricao"),
  unitId: integer("unit_id"),
  detectadoEm: timestamp("detectado_em"),
  cienciaEm: timestamp("ciencia_em").notNull(),
  categoriasDados: jsonb("categorias_dados"),
  titularesEstimados: integer("titulares_estimados"),
  envolveCriancas: boolean("envolve_criancas").notNull().default(false),
  dadosSensiveis: boolean("dados_sensiveis").notNull().default(false),
  risco: text("risco").notNull().default("EM_AVALIACAO"), // EM_AVALIACAO · BAIXO · RELEVANTE
  prazoAnpd: date("prazo_anpd"),
  comunicar: boolean("comunicar"),
  justificativaNaoComunicar: text("justificativa_nao_comunicar"),
  comunicadoAnpdEm: timestamp("comunicado_anpd_em"),
  comunicadoTitularesEm: timestamp("comunicado_titulares_em"),
  medidas: text("medidas"),
  causa: text("causa"),
  status: text("status").notNull().default("ABERTO"),     // ABERTO · CONTIDO · ENCERRADO
  responsavelUserId: integer("responsavel_user_id"),
  historico: jsonb("historico"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  encerradoEm: timestamp("encerrado_em"),
});

// ======================= v22: canal de ética =======================
export const ethicsReports = pgTable("ethics_reports", {
  id: serial("id").primaryKey(),
  protocolo: text("protocolo").notNull().unique(),
  codigoHash: text("codigo_hash").notNull(),
  categoria: text("categoria").notNull(),
  relato: text("relato").notNull(),
  envolvidos: text("envolvidos"),
  local: text("local"),
  quando: text("quando"),
  testemunhas: text("testemunhas"),
  unitId: integer("unit_id"),
  relacao: text("relacao"),
  anonimo: boolean("anonimo").notNull().default(true),
  contato: jsonb("contato"),                               // só quando a pessoa escolhe se identificar
  status: text("status").notNull().default("RECEBIDA"),   // RECEBIDA · EM_APURACAO · CONCLUIDA · ARQUIVADA
  gravidade: integer("gravidade"),
  prazoTriagem: date("prazo_triagem"),
  prazoConclusao: date("prazo_conclusao"),
  responsavelUserId: integer("responsavel_user_id"),
  impedidos: jsonb("impedidos"),                           // ids do comitê que não podem ver este relato
  liberados: jsonb("liberados"),                           // ids que a Direção liberou de impedimento automático (homônimo)
  resultado: text("resultado"),                            // PROCEDENTE · PARCIAL · IMPROCEDENTE · INCONCLUSIVO
  conclusao: text("conclusao"),
  medidas: text("medidas"),
  concluidaEm: timestamp("concluida_em"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const ethicsMessages = pgTable("ethics_messages", {
  id: serial("id").primaryKey(),
  reportId: integer("report_id").notNull(),
  autor: text("autor").notNull(),                          // DENUNCIANTE · COMITE · NOTA_INTERNA
  texto: text("texto").notNull(),
  userId: integer("user_id"),
  userNome: text("user_nome"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ======================= v22: central de solicitações =======================
export const requestTypes = pgTable("request_types", {
  id: serial("id").primaryKey(),
  codigo: text("codigo").notNull().unique(),
  nome: text("nome").notNull(),
  descricao: text("descricao"),
  campos: jsonb("campos").notNull(),                       // [{ id, rotulo, tipo, obrigatorio, opcoes }]
  etapas: jsonb("etapas").notNull(),                       // [{ nome, perfis, usuarios, acimaDe }]
  prazoDias: integer("prazo_dias").notNull().default(2),
  perfis: jsonb("perfis"),                                 // quem pode abrir (vazio = todos)
  ativo: boolean("ativo").notNull().default(true),
  ordem: integer("ordem").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const requests = pgTable("requests", {
  id: serial("id").primaryKey(),
  numero: text("numero").notNull().unique(),
  typeId: integer("type_id").notNull(),
  titulo: text("titulo").notNull(),
  dados: jsonb("dados").notNull(),
  valor: numeric("valor", { precision: 12, scale: 2 }),
  unitId: integer("unit_id"),
  solicitanteUserId: integer("solicitante_user_id").notNull(),
  solicitanteNome: text("solicitante_nome"),
  status: text("status").notNull().default("EM_APROVACAO"), // EM_APROVACAO · DEVOLVIDA · APROVADA · REJEITADA · CANCELADA
  etapaAtual: integer("etapa_atual").notNull().default(0),
  etapas: jsonb("etapas").notNull(),                       // retrato das etapas aplicáveis: [{ nome, aprovadores, decisao, por, porNome, em, obs }]
  prazoEtapa: date("prazo_etapa"),
  concluidaEm: timestamp("concluida_em"),
  pagoEm: date("pago_em"),                                  // v25 · T-029: só com o débito conciliado do extrato
  pagamentoLineId: integer("pagamento_line_id"),
  pagoPor: integer("pago_por"),
  pagamentoPrevisto: date("pagamento_previsto"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const requestEvents = pgTable("request_events", {
  id: serial("id").primaryKey(),
  requestId: integer("request_id").notNull(),
  etapa: integer("etapa"),
  tipo: text("tipo").notNull(),                            // CRIADA · APROVADA · REJEITADA · DEVOLVIDA · REENVIADA · CANCELADA · COMENTARIO
  texto: text("texto"),
  userId: integer("user_id"),
  userNome: text("user_nome"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ======================= v22: contratos de fornecedores e licenças =======================
export const contracts = pgTable("contracts", {
  id: serial("id").primaryKey(),
  supplierId: integer("supplier_id").notNull(),
  unitId: integer("unit_id"),
  objeto: text("objeto").notNull(),
  numero: text("numero"),
  valorMensal: numeric("valor_mensal", { precision: 12, scale: 2 }),
  valorTotal: numeric("valor_total", { precision: 14, scale: 2 }),
  inicio: date("inicio").notNull(),
  fim: date("fim"),
  renovacao: text("renovacao").notNull().default("MANUAL"), // AUTOMATICA · MANUAL · SEM_RENOVACAO
  avisoPrevioDias: integer("aviso_previo_dias").notNull().default(30),
  reajusteIndice: text("reajuste_indice"),
  proximoReajuste: date("proximo_reajuste"),
  responsavelUserId: integer("responsavel_user_id"),
  status: text("status").notNull().default("VIGENTE"),    // VIGENTE · ENCERRADO · CANCELADO
  renovadoDe: integer("renovado_de"),
  obs: text("obs"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const licenses = pgTable("licenses", {
  id: serial("id").primaryKey(),
  unitId: integer("unit_id").notNull(),
  tipo: text("tipo").notNull(),
  nome: text("nome"),
  orgao: text("orgao"),
  numero: text("numero"),
  emissao: date("emissao"),
  validade: date("validade"),
  antecedenciaDias: integer("antecedencia_dias").notNull().default(60),
  responsavelUserId: integer("responsavel_user_id"),
  status: text("status").notNull().default("ATIVA"),      // ATIVA · SUBSTITUIDA · DISPENSADA
  renovadoDe: integer("renovado_de"),
  obs: text("obs"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ======================= v22: app no celular (notificações push) =======================
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userAgent: text("user_agent"),
  tipos: text("tipos").notNull().default("ACAO_ALERTA"),  // TODOS · ACAO_ALERTA
  falhas: integer("falhas").notNull().default(0),
  ultimoEnvio: timestamp("ultimo_envio"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ======================= v23: ONE Insights =======================
// Base de indicadores: série mensal por indicador e unidade (unit_id 0 = rede). Chave primária composta (chave, periodo, unit_id) criada pela migração.
export const kpiSeries = pgTable("kpi_series", {
  chave: text("chave").notNull(),
  periodo: text("periodo").notNull(),                     // 'YYYY-MM'
  unitId: integer("unit_id").notNull().default(0),
  valor: numeric("valor"),                                // vazio = sem medição (nunca vira zero)
  num: numeric("num"),
  den: numeric("den"),
  origem: text("origem").notNull().default("CALCULADO"),  // CALCULADO (reconstruído dos registros) · RETRATO (foto do mês)
  calculadoEm: timestamp("calculado_em").notNull().defaultNow(),
});
export const kpiTargets = pgTable("kpi_targets", {
  id: serial("id").primaryKey(),
  chave: text("chave").notNull(),
  ano: integer("ano").notNull(),
  unitId: integer("unit_id").notNull().default(0),
  meta: numeric("meta").notNull(),
  alerta: numeric("alerta"),
  periodicidade: text("periodicidade").notNull().default("MENSAL"), // MENSAL · ANUAL (só para indicadores que somam no ano)
  obs: text("obs"),
  userId: integer("user_id"),
  userNome: text("user_nome"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const kpiComments = pgTable("kpi_comments", {
  id: serial("id").primaryKey(),
  chave: text("chave").notNull(),
  periodo: text("periodo").notNull(),
  unitId: integer("unit_id").notNull().default(0),
  texto: text("texto").notNull(),
  userId: integer("user_id"),
  userNome: text("user_nome"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const kpiSubscriptions = pgTable("kpi_subscriptions", {
  userId: integer("user_id").primaryKey(),
  unitId: integer("unit_id"),
  ativo: boolean("ativo").notNull().default(true),
  email: boolean("email").notNull().default(true),
  ultimoEnvio: date("ultimo_envio"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const kpiWeekly = pgTable("kpi_weekly", {
  semana: text("semana").notNull(),
  chave: text("chave").notNull(),
  unitId: integer("unit_id").notNull().default(0),
  valor: numeric("valor"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const budgetMonths = pgTable("budget_months", {
  id: serial("id").primaryKey(),
  ano: integer("ano").notNull(),
  unitId: integer("unit_id").notNull(),
  tipo: text("tipo").notNull(),           // ENTRADA · SAIDA
  categoria: text("categoria").notNull(),
  mes: integer("mes").notNull(),          // 1–12
  valor: numeric("valor", { precision: 14, scale: 2 }).notNull(),
  userId: integer("user_id"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const budgetComments = pgTable("budget_comments", {
  id: serial("id").primaryKey(),
  ano: integer("ano").notNull(),
  mes: integer("mes").notNull(),
  unitId: integer("unit_id"),
  tipo: text("tipo").notNull(),
  categoria: text("categoria").notNull(),
  texto: text("texto").notNull(),
  userId: integer("user_id"),
  userNome: text("user_nome"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const recognitions = pgTable("recognitions", {
  id: serial("id").primaryKey(),
  deUserId: integer("de_user_id"),
  deNome: text("de_nome").notNull(),
  paraEmployeeId: integer("para_employee_id").notNull(),
  valor: text("valor"),                    // valor da identidade (Identidade → valores)
  mensagem: text("mensagem").notNull(),
  unitId: integer("unit_id"),
  status: text("status").notNull().default("PUBLICADO"), // PUBLICADO · OCULTO
  ocultoPor: integer("oculto_por"),
  ocultoMotivo: text("oculto_motivo"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const recognitionReactions = pgTable("recognition_reactions", {
  recognitionId: integer("recognition_id").notNull(),
  userId: integer("user_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const userPrefs = pgTable("user_prefs", {
  userId: integer("user_id").primaryKey(),
  inicio: jsonb("inicio"),
  atalhos: jsonb("atalhos"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  contexto: jsonb("contexto"),                     // v24: contexto padrão (entidade · unidade · período)
  favoritos: jsonb("favoritos"),                   // v24: relatórios favoritos
});

// ------------------------------------------------------------------ v24 · Nova Arquitetura (as consultas usam SQL direto; aqui ficam para o diagnóstico do banco)
const ts = (n: string) => timestamp(n);
export const alerts = pgTable("alerts", { id: serial("id").primaryKey(), chave: text("chave").notNull(), escopo: integer("escopo").notNull().default(0), unitId: integer("unit_id"), regra: text("regra").notNull(), modulo: text("modulo").notNull(), severidade: text("severidade").notNull().default("MEDIO"), titulo: text("titulo").notNull(), href: text("href"), donoUserId: integer("dono_user_id"), defeito: text("defeito"), slaAte: ts("sla_ate"), status: text("status").notNull().default("ABERTO"), desfecho: text("desfecho"), silenciadoAte: date("silenciado_ate"), motivoSilencio: text("motivo_silencio"), escalonamento: integer("escalonamento").notNull().default(0), ocorrencias: integer("ocorrencias").notNull().default(1), primeiroEm: ts("primeiro_em").notNull().defaultNow(), vistoEm: ts("visto_em").notNull().defaultNow(), tratadoEm: ts("tratado_em"), tratadoPor: integer("tratado_por"), resolvidoEm: ts("resolvido_em"), updatedAt: ts("updated_at").notNull().defaultNow() });
export const alertEvents = pgTable("alert_events", { id: serial("id").primaryKey(), alertId: integer("alert_id").notNull(), at: ts("at").notNull().defaultNow(), userId: integer("user_id"), userNome: text("user_nome"), tipo: text("tipo").notNull(), texto: text("texto") });
export const alertSweeps = pgTable("alert_sweeps", { escopo: integer("escopo").primaryKey(), at: ts("at").notNull().defaultNow(), n: integer("n").notNull().default(0) });
export const positionSlots = pgTable("position_slots", { id: serial("id").primaryKey(), positionId: integer("position_id").notNull(), unitId: integer("unit_id").notNull(), jornadaMinDia: integer("jornada_min_dia").notNull().default(528), autorizada: boolean("autorizada").notNull().default(false), autorizadaPor: integer("autorizada_por"), autorizadaEm: ts("autorizada_em"), employeeId: integer("employee_id"), previstaAte: date("prevista_ate"), ativa: boolean("ativa").notNull().default(true), motivo: text("motivo"), obs: text("obs"), createdBy: integer("created_by"), createdAt: ts("created_at").notNull().defaultNow(), updatedAt: ts("updated_at").notNull().defaultNow() });
export const timesheetLocks = pgTable("timesheet_locks", { id: serial("id").primaryKey(), unitId: integer("unit_id").notNull(), mes: text("mes").notNull(), status: text("status").notNull().default("FECHADO"), fechadoPor: integer("fechado_por"), fechadoPorNome: text("fechado_por_nome"), fechadoEm: ts("fechado_em").notNull().defaultNow(), ressalva: text("ressalva"), resumo: jsonb("resumo"), reabertoPor: integer("reaberto_por"), reabertoEm: ts("reaberto_em"), motivoReabertura: text("motivo_reabertura") });
export const payrollCycles = pgTable("payroll_cycles", { id: serial("id").primaryKey(), competencia: text("competencia").notNull(), companyId: integer("company_id").notNull(), status: text("status").notNull().default("ABERTO"), pacote: jsonb("pacote"), pacoteEm: ts("pacote_em"), pacotePor: integer("pacote_por"), pacotePorNome: text("pacote_por_nome"), previa: jsonb("previa"), conferencia: jsonb("conferencia"), conferidoEm: ts("conferido_em"), conferidoPor: integer("conferido_por"), conferidoPorNome: text("conferido_por_nome"), resultadoEm: ts("resultado_em"), resultadoPor: integer("resultado_por"), resultadoPorNome: text("resultado_por_nome"), total: numeric("total", { precision: 14, scale: 2 }), totalAnterior: numeric("total_anterior", { precision: 14, scale: 2 }), variacaoPct: numeric("variacao_pct", { precision: 8, scale: 2 }), aceitoEm: ts("aceito_em"), aceitoPor: integer("aceito_por"), arquivadoEm: ts("arquivado_em"), arquivadoPor: integer("arquivado_por"), obs: text("obs"), createdAt: ts("created_at").notNull().defaultNow(), updatedAt: ts("updated_at").notNull().defaultNow() });
export const payrollResults = pgTable("payroll_results", { id: serial("id").primaryKey(), cycleId: integer("cycle_id").notNull(), unitId: integer("unit_id"), area: text("area"), headcount: integer("headcount"), salarios: numeric("salarios", { precision: 14, scale: 2 }).notNull().default("0"), inss: numeric("inss", { precision: 14, scale: 2 }).notNull().default("0"), fgts: numeric("fgts", { precision: 14, scale: 2 }).notNull().default("0"), irrf: numeric("irrf", { precision: 14, scale: 2 }).notNull().default("0"), provisao13: numeric("provisao_13", { precision: 14, scale: 2 }).notNull().default("0"), provisaoFerias: numeric("provisao_ferias", { precision: 14, scale: 2 }).notNull().default("0"), beneficios: numeric("beneficios", { precision: 14, scale: 2 }).notNull().default("0"), rescisoes: numeric("rescisoes", { precision: 14, scale: 2 }).notNull().default("0"), outros: numeric("outros", { precision: 14, scale: 2 }).notNull().default("0") });
export const payrollEvents = pgTable("payroll_events", { id: serial("id").primaryKey(), cycleId: integer("cycle_id"), competencia: text("competencia").notNull(), companyId: integer("company_id"), at: ts("at").notNull().defaultNow(), userId: integer("user_id"), userNome: text("user_nome"), tipo: text("tipo").notNull(), texto: text("texto") });
export const payrollExplanations = pgTable("payroll_explanations", { id: serial("id").primaryKey(), cycleId: integer("cycle_id").notNull(), motivo: text("motivo").notNull(), valor: numeric("valor", { precision: 14, scale: 2 }), texto: text("texto"), userId: integer("user_id"), userNome: text("user_nome"), createdAt: ts("created_at").notNull().defaultNow() });
export const payrollDivergences = pgTable("payroll_divergences", { id: serial("id").primaryKey(), cycleId: integer("cycle_id").notNull(), employeeId: integer("employee_id"), descricao: text("descricao").notNull(), status: text("status").notNull().default("DEVOLVIDA"), resolvidaEm: ts("resolvida_em"), resolvidaPor: integer("resolvida_por"), userId: integer("user_id"), createdAt: ts("created_at").notNull().defaultNow() });
export const payrollDocs = pgTable("payroll_docs", { id: serial("id").primaryKey(), cycleId: integer("cycle_id").notNull(), tipo: text("tipo").notNull(), employeeId: integer("employee_id"), attachmentId: integer("attachment_id").notNull(), obligationId: integer("obligation_id"), userId: integer("user_id"), createdAt: ts("created_at").notNull().defaultNow() });
export const payrollDocViews = pgTable("payroll_doc_views", { id: serial("id").primaryKey(), docId: integer("doc_id").notNull(), userId: integer("user_id"), userNome: text("user_nome"), at: ts("at").notNull().defaultNow() });
export const obligations = pgTable("obligations", { id: serial("id").primaryKey(), companyId: integer("company_id"), unitId: integer("unit_id"), tipo: text("tipo").notNull(), descricao: text("descricao"), competencia: text("competencia"), vencimento: date("vencimento").notNull(), valor: numeric("valor", { precision: 14, scale: 2 }), status: text("status").notNull().default("PENDENTE"), pagoEm: date("pago_em"), responsavelUserId: integer("responsavel_user_id"), origem: text("origem").notNull().default("MANUAL"), cycleId: integer("cycle_id"), baixadoPor: integer("baixado_por"), obs: text("obs"), createdBy: integer("created_by"), createdAt: ts("created_at").notNull().defaultNow(), updatedAt: ts("updated_at").notNull().defaultNow() });
export const fiscalCases = pgTable("fiscal_cases", { id: serial("id").primaryKey(), titulo: text("titulo").notNull(), orgao: text("orgao"), tipo: text("tipo"), companyIds: jsonb("company_ids"), abertura: date("abertura"), prazo: date("prazo"), status: text("status").notNull().default("ABERTO"), responsavelUserId: integer("responsavel_user_id"), descricao: text("descricao"), createdBy: integer("created_by"), createdAt: ts("created_at").notNull().defaultNow(), updatedAt: ts("updated_at").notNull().defaultNow() });
export const fiscalCaseEvents = pgTable("fiscal_case_events", { id: serial("id").primaryKey(), caseId: integer("case_id").notNull(), data: date("data").notNull(), tipo: text("tipo").notNull(), texto: text("texto").notNull(), prazo: date("prazo"), cumpridoEm: date("cumprido_em"), userId: integer("user_id"), userNome: text("user_nome"), createdAt: ts("created_at").notNull().defaultNow() });
export const sstExams = pgTable("sst_exams", { id: serial("id").primaryKey(), employeeId: integer("employee_id").notNull(), tipo: text("tipo").notNull(), data: date("data").notNull(), validade: date("validade"), resultado: text("resultado").notNull().default("APTO"), restricao: text("restricao"), clinica: text("clinica"), situacao: text("situacao").notNull().default("REALIZADO"), userId: integer("user_id"), createdAt: ts("created_at").notNull().defaultNow() });
export const sstIncidents = pgTable("sst_incidents", { id: serial("id").primaryKey(), unitId: integer("unit_id").notNull(), employeeId: integer("employee_id"), data: date("data").notNull(), hora: text("hora"), tipo: text("tipo").notNull(), gravidade: text("gravidade").notNull().default("LEVE"), comAfastamento: boolean("com_afastamento").notNull().default(false), local: text("local"), descricao: text("descricao").notNull(), catNecessaria: boolean("cat_necessaria").notNull().default(false), catPrazo: date("cat_prazo"), catNumero: text("cat_numero"), catEmitidaEm: date("cat_emitida_em"), causas: text("causas"), medidas: text("medidas"), investigacaoPrazo: date("investigacao_prazo"), investigadoEm: date("investigado_em"), actionPlanId: integer("action_plan_id"), status: text("status").notNull().default("ABERTO"), escaladoEm: ts("escalado_em"), createdBy: integer("created_by"), createdAt: ts("created_at").notNull().defaultNow(), updatedAt: ts("updated_at").notNull().defaultNow() });
export const cipaMembers = pgTable("cipa_members", { id: serial("id").primaryKey(), unitId: integer("unit_id").notNull(), employeeId: integer("employee_id").notNull(), representacao: text("representacao").notNull().default("EMPREGADOS"), funcao: text("funcao").notNull().default("MEMBRO"), titular: boolean("titular").notNull().default(true), mandatoInicio: date("mandato_inicio").notNull(), mandatoFim: date("mandato_fim").notNull(), ativo: boolean("ativo").notNull().default(true), createdAt: ts("created_at").notNull().defaultNow() });
export const cipaMeetings = pgTable("cipa_meetings", { id: serial("id").primaryKey(), unitId: integer("unit_id").notNull(), data: date("data").notNull(), tipo: text("tipo").notNull().default("ORDINARIA"), pauta: text("pauta"), ata: text("ata"), realizada: boolean("realizada").notNull().default(false), createdAt: ts("created_at").notNull().defaultNow() });
export const epiItems = pgTable("epi_items", { id: serial("id").primaryKey(), nome: text("nome").notNull(), ca: text("ca"), trocaDias: integer("troca_dias"), ativo: boolean("ativo").notNull().default(true), createdAt: ts("created_at").notNull().defaultNow() });
export const epiDeliveries = pgTable("epi_deliveries", { id: serial("id").primaryKey(), employeeId: integer("employee_id").notNull(), epiId: integer("epi_id").notNull(), data: date("data").notNull(), quantidade: integer("quantidade").notNull().default(1), termoAssinado: boolean("termo_assinado").notNull().default(false), proximaTroca: date("proxima_troca"), devolvidoEm: date("devolvido_em"), userId: integer("user_id"), createdAt: ts("created_at").notNull().defaultNow() });
export const onboardingPlans = pgTable("onboarding_plans", { id: serial("id").primaryKey(), employeeId: integer("employee_id").notNull(), inicio: date("inicio").notNull(), gestorUserId: integer("gestor_user_id"), buddyEmployeeId: integer("buddy_employee_id"), status: text("status").notNull().default("EM_ANDAMENTO"), concluidoEm: ts("concluido_em"), createdBy: integer("created_by"), createdAt: ts("created_at").notNull().defaultNow() });
export const onboardingItems = pgTable("onboarding_items", { id: serial("id").primaryKey(), planId: integer("plan_id").notNull(), marco: integer("marco").notNull(), titulo: text("titulo").notNull(), tipo: text("tipo").notNull().default("TAREFA"), responsavel: text("responsavel").notNull().default("GESTOR"), prazo: date("prazo").notNull(), concluidoEm: ts("concluido_em"), concluidoPor: integer("concluido_por"), nota: text("nota"), lembradoEm: date("lembrado_em"), ordem: integer("ordem").notNull().default(0) });
export const onboardingSurveys = pgTable("onboarding_surveys", { id: serial("id").primaryKey(), planId: integer("plan_id").notNull(), marco: integer("marco").notNull(), nota: integer("nota").notNull(), comentario: text("comentario"), createdAt: ts("created_at").notNull().defaultNow() });
export const perfCycleStages = pgTable("perf_cycle_stages", { id: serial("id").primaryKey(), cycleId: integer("cycle_id").notNull(), etapa: text("etapa").notNull(), inicio: date("inicio").notNull(), fim: date("fim").notNull(), status: text("status").notNull().default("PLANEJADA"), fechadaEm: ts("fechada_em"), fechadaPor: integer("fechada_por"), ordem: integer("ordem").notNull().default(0) });
export const perfStageChanges = pgTable("perf_stage_changes", { id: serial("id").primaryKey(), stageId: integer("stage_id").notNull(), deFim: date("de_fim"), paraFim: date("para_fim"), motivo: text("motivo").notNull(), userId: integer("user_id"), userNome: text("user_nome"), createdAt: ts("created_at").notNull().defaultNow() });
export const perfReminders = pgTable("perf_reminders", { id: serial("id").primaryKey(), cycleId: integer("cycle_id").notNull(), etapa: text("etapa").notNull(), employeeId: integer("employee_id").notNull(), n: integer("n").notNull().default(1), escalado: boolean("escalado").notNull().default(false), userId: integer("user_id"), at: ts("at").notNull().defaultNow() });
export const audits = pgTable("audits", { id: serial("id").primaryKey(), titulo: text("titulo").notNull(), tipo: text("tipo").notNull().default("INTERNA"), area: text("area"), unitId: integer("unit_id"), leadUserId: integer("lead_user_id"), planejadaPara: date("planejada_para").notNull(), realizadaEm: date("realizada_em"), prazoRelatorio: date("prazo_relatorio"), status: text("status").notNull().default("PLANEJADA"), escopo: text("escopo"), conclusao: text("conclusao"), createdBy: integer("created_by"), createdAt: ts("created_at").notNull().defaultNow(), updatedAt: ts("updated_at").notNull().defaultNow() });
export const projectBaselines = pgTable("project_baselines", { id: serial("id").primaryKey(), projectId: integer("project_id").notNull(), versao: integer("versao").notNull(), motivo: text("motivo").notNull(), decisionId: integer("decision_id"), marcos: jsonb("marcos").notNull(), userId: integer("user_id"), userNome: text("user_nome"), createdAt: ts("created_at").notNull().defaultNow() });
export const budgetExplainRequests = pgTable("budget_explain_requests", { id: serial("id").primaryKey(), ano: integer("ano").notNull(), mes: integer("mes").notNull(), escopo: integer("escopo").notNull().default(0), categoria: text("categoria").notNull(), executadoPct: numeric("executado_pct", { precision: 8, scale: 2 }), responsavelUserId: integer("responsavel_user_id"), status: text("status").notNull().default("ABERTA"), respondidaEm: ts("respondida_em"), createdAt: ts("created_at").notNull().defaultNow() });
export const reportSchedules = pgTable("report_schedules", { id: serial("id").primaryKey(), userId: integer("user_id").notNull(), relatorio: text("relatorio").notNull(), params: jsonb("params"), dia: integer("dia").notNull().default(1), ativo: boolean("ativo").notNull().default(true), ultimoEnvio: date("ultimo_envio"), createdAt: ts("created_at").notNull().defaultNow() });
export const dailyContacts = pgTable("daily_contacts", { id: serial("id").primaryKey(), employeeId: integer("employee_id").notNull(), data: date("data").notNull(), desfecho: text("desfecho").notNull(), obs: text("obs"), userId: integer("user_id"), userNome: text("user_nome"), createdAt: ts("created_at").notNull().defaultNow() });
export const goliveItems = pgTable("golive_items", { chave: text("chave").primaryKey(), feito: boolean("feito").notNull().default(false), evidencia: text("evidencia"), responsavel: text("responsavel"), userId: integer("user_id"), userNome: text("user_nome"), updatedAt: ts("updated_at").notNull().defaultNow() });

// v24 · T-013 · documentos de matrícula do aluno (pendente → recebido → verificado/rejeitado; vencimento)
export const studentDocuments = pgTable("student_documents", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").notNull(),
  tipo: text("tipo").notNull(),
  status: text("status").notNull().default("PENDENTE"),
  validade: date("validade"),
  solicitadoEm: date("solicitado_em"),
  solicitacoes: integer("solicitacoes").notNull().default(0),
  recebidoEm: date("recebido_em"),
  verificadoPor: integer("verificado_por"),
  verificadoEm: timestamp("verificado_em"),
  motivo: text("motivo"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ------------------------------------------------------------ v25 · Conciliação bancária e de cartão (Cap. 21 · T-026, T-033…T-035, T-039)
export const bankAccounts = pgTable("bank_accounts", {
  id: serial("id").primaryKey(),
  apelido: text("apelido").notNull(),
  banco: text("banco"),
  agencia: text("agencia"),
  conta: text("conta"),
  companyId: integer("company_id"),
  unitId: integer("unit_id"),
  tipo: text("tipo").notNull().default("CORRENTE"),
  ativo: boolean("ativo").notNull().default(true),
  obs: text("obs"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const reconImports = pgTable("recon_imports", {
  id: serial("id").primaryKey(),
  tipo: text("tipo").notNull(),
  bankAccountId: integer("bank_account_id"),
  arquivo: text("arquivo"),
  linhas: integer("linhas").notNull().default(0),
  novas: integer("novas").notNull().default(0),
  repetidas: integer("repetidas").notNull().default(0),
  travadas: integer("travadas").notNull().default(0),
  periodoIni: date("periodo_ini"),
  periodoFim: date("periodo_fim"),
  userId: integer("user_id"),
  userNome: text("user_nome"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const bankLines = pgTable("bank_lines", {
  id: serial("id").primaryKey(),
  bankAccountId: integer("bank_account_id").notNull(),
  importId: integer("import_id"),
  data: date("data").notNull(),
  valor: numeric("valor", { precision: 12, scale: 2 }).notNull(),
  forma: text("forma").notNull().default("OUTRO"),
  descricao: text("descricao"),
  documento: text("documento"),
  pagador: text("pagador"),
  pagadorDoc: text("pagador_doc"),
  chave: text("chave").notNull(),
  status: text("status").notNull().default("PENDENTE"),
  studentId: integer("student_id"),
  classe: text("classe"),
  observacao: text("observacao"),
  cashEntryId: integer("cash_entry_id"),
  classificadoPor: integer("classificado_por"),
  requestId: integer("request_id"),                        // T-029: débito que pagou a solicitação
  payableInstallmentId: integer("payable_installment_id"), // v27: débito que pagou a parcela da conta a pagar
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const cardSales = pgTable("card_sales", {
  id: serial("id").primaryKey(),
  importId: integer("import_id"),
  unitId: integer("unit_id"),
  dataVenda: date("data_venda").notNull(),
  dataPagamento: date("data_pagamento"),
  bandeira: text("bandeira").notNull(),
  produto: text("produto").notNull(),
  parcelas: integer("parcelas").notNull().default(1),
  parcela: integer("parcela").notNull().default(1),
  nsu: text("nsu"),
  autorizacao: text("autorizacao"),
  valorBruto: numeric("valor_bruto", { precision: 12, scale: 2 }).notNull(),
  valorTaxa: numeric("valor_taxa", { precision: 12, scale: 2 }).notNull().default("0"),
  valorLiquido: numeric("valor_liquido", { precision: 12, scale: 2 }).notNull(),
  antecipado: boolean("antecipado").notNull().default(false),
  chave: text("chave").notNull().unique(),
  status: text("status").notNull().default("PENDENTE"),
  repasse: text("repasse").notNull().default("A_RECEBER"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const reconMatches = pgTable("recon_matches", {
  id: serial("id").primaryKey(),
  tipo: text("tipo").notNull(),
  grupo: text("grupo"),
  receivableId: integer("receivable_id"),
  bankLineId: integer("bank_line_id"),
  cardSaleId: integer("card_sale_id"),
  valor: numeric("valor", { precision: 12, scale: 2 }).notNull(),
  confianca: integer("confianca").notNull().default(0),
  metodo: text("metodo").notNull().default("AUTO"),
  status: text("status").notNull().default("SUGERIDO"),
  motivo: text("motivo"),
  userId: integer("user_id"),
  userNome: text("user_nome"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  confirmadoEm: timestamp("confirmado_em"),
  desfeitoEm: timestamp("desfeito_em"),
  motivoDesfazer: text("motivo_desfazer"),
});
export const reconIssues = pgTable("recon_issues", {
  id: serial("id").primaryKey(),
  chave: text("chave").notNull().unique(),
  tipo: text("tipo").notNull(),
  origem: text("origem").notNull(),
  unitId: integer("unit_id"),
  valor: numeric("valor", { precision: 12, scale: 2 }),
  descricao: text("descricao").notNull(),
  bankLineId: integer("bank_line_id"),
  cardSaleId: integer("card_sale_id"),
  receivableId: integer("receivable_id"),
  referencia: date("referencia").notNull(),
  donoUserId: integer("dono_user_id"),
  prazo: date("prazo"),
  status: text("status").notNull().default("ABERTA"),
  desfecho: text("desfecho"),
  desfechoObs: text("desfecho_obs"),
  resolvidoEm: timestamp("resolvido_em"),
  resolvidoPor: integer("resolvido_por"),
  escalonamento: integer("escalonamento").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const reconClosings = pgTable("recon_closings", {
  id: serial("id").primaryKey(),
  competencia: text("competencia").notNull(),
  companyId: integer("company_id"),
  recebido: numeric("recebido", { precision: 14, scale: 2 }),
  conciliado: numeric("conciliado", { precision: 14, scale: 2 }),
  explicado: numeric("explicado", { precision: 14, scale: 2 }),
  pct: numeric("pct", { precision: 6, scale: 2 }),
  status: text("status").notNull().default("FECHADA"),
  obs: text("obs"),
  fechadoPor: integer("fechado_por"),
  fechadoEm: timestamp("fechado_em").notNull().defaultNow(),
  reabertoPor: integer("reaberto_por"),
  reabertoEm: timestamp("reaberto_em"),
  motivoReabertura: text("motivo_reabertura"),
});
// ------------------------------------------------------------ v25 · comunicação em massa (CRQ-COM-V3-01) e revisão de POP por exceção repetida (CRQ-PRJ-V3-03)
export const messageCampaigns = pgTable("message_campaigns", {
  id: serial("id").primaryKey(), titulo: text("titulo").notNull(), canal: text("canal").notNull(), templateId: integer("template_id").notNull(), publico: text("publico").notNull(), filtro: jsonb("filtro").notNull(), assunto: text("assunto"),
  total: integer("total").notNull().default(0), status: text("status").notNull().default("AGUARDANDO_APROVACAO"), autorUserId: integer("autor_user_id").notNull(), autorNome: text("autor_nome"), aprovadoPor: integer("aprovado_por"), aprovadoEm: timestamp("aprovado_em"),
  motivoRejeicao: text("motivo_rejeicao"), disparoEm: timestamp("disparo_em"), disparadoEm: timestamp("disparado_em"), enviadas: integer("enviadas").notNull().default(0), registradas: integer("registradas").notNull().default(0), falhas: integer("falhas").notNull().default(0), createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const procedureReviews = pgTable("procedure_reviews", {
  id: serial("id").primaryKey(), chave: text("chave").notNull(), procedureId: integer("procedure_id"), regra: text("regra").notNull(), motivo: text("motivo").notNull(), evidencias: jsonb("evidencias").notNull(), prazo: date("prazo").notNull(), donoUserId: integer("dono_user_id"),
  status: text("status").notNull().default("ABERTA"), desfecho: text("desfecho"), desfechoObs: text("desfecho_obs"), versaoPublicada: integer("versao_publicada"), concluidaPor: integer("concluida_por"), concluidaEm: timestamp("concluida_em"), escaladaEm: timestamp("escalada_em"), createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const candidatePortalLinks = pgTable("candidate_portal_links", {
  id: serial("id").primaryKey(), applicationId: integer("application_id").notNull(), tokenHash: text("token_hash").notNull().unique(), status: text("status").notNull().default("ATIVO"), expiraEm: date("expira_em").notNull(), criadoPor: integer("criado_por"), criadoEm: timestamp("criado_em").notNull().defaultNow(), abertoEm: timestamp("aberto_em"), ultimoAcesso: timestamp("ultimo_acesso"), encerradoEm: timestamp("encerrado_em"),
});
export const candidateDocRequests = pgTable("candidate_doc_requests", {
  id: serial("id").primaryKey(), applicationId: integer("application_id").notNull(), tipo: text("tipo").notNull(), obrigatorio: boolean("obrigatorio").notNull().default(true), status: text("status").notNull().default("PENDENTE"), enviadoEm: timestamp("enviado_em"), conferidoPor: integer("conferido_por"), conferidoEm: timestamp("conferido_em"), motivoRecusa: text("motivo_recusa"), criadoPor: integer("criado_por"), createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const interviewSlots = pgTable("interview_slots", {
  id: serial("id").primaryKey(), applicationId: integer("application_id").notNull(), etapa: text("etapa").notNull(), inicio: timestamp("inicio").notNull(), duracaoMin: integer("duracao_min").notNull().default(45), local: text("local"), status: text("status").notNull().default("OFERECIDO"), escolhidoEm: timestamp("escolhido_em"), criadoPor: integer("criado_por"), createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const gradeVersions = pgTable("grade_versions", {
  id: serial("id").primaryKey(), unitId: integer("unit_id").notNull(), nome: text("nome").notNull(), vigenciaInicio: date("vigencia_inicio").notNull(), vigenciaFim: date("vigencia_fim"), status: text("status").notNull().default("RASCUNHO"), origem: text("origem").notNull().default("MANUAL"), copiadaDe: integer("copiada_de"), obs: text("obs"), justificativa: text("justificativa"),
  criadaPor: integer("criada_por"), criadaEm: timestamp("criada_em").notNull().defaultNow(), ativadaPor: integer("ativada_por"), ativadaEm: timestamp("ativada_em"), chAplicadaPor: integer("ch_aplicada_por"), chAplicadaEm: timestamp("ch_aplicada_em"), descartadaEm: timestamp("descartada_em"),
});
export const timesheetAudit = pgTable("timesheet_audit", {
  id: serial("id").primaryKey(), employeeId: integer("employee_id").notNull(), unitId: integer("unit_id"), data: date("data").notNull(), tipo: text("tipo").notNull(), minutos: integer("minutos").notNull().default(0), detalhe: text("detalhe"), status: text("status").notNull().default("ABERTA"), decisaoObs: text("decisao_obs"), decididoPor: integer("decidido_por"), decididoEm: timestamp("decidido_em"), hourEntryId: integer("hour_entry_id"), createdAt: timestamp("created_at").notNull().defaultNow(), updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ================= v27 · CONTAS A PAGAR (títulos com parcelas, recorrência e baixa pelo extrato) =================
export const payables = pgTable("payables", {
  id: serial("id").primaryKey(),
  numero: integer("numero").notNull(),
  unitId: integer("unit_id"),
  supplierId: integer("supplier_id"),
  fornecedorNome: text("fornecedor_nome").notNull(),
  contractId: integer("contract_id"),
  categoria: text("categoria").notNull(),                  // categoria de saída do caixa/DRE (financeiro.categoriasSaida)
  tipoDocumento: text("tipo_documento").notNull().default("Boleto"),
  numeroDocumento: text("numero_documento"),
  emissao: date("emissao").notNull(),
  descricao: text("descricao").notNull(),
  recorrente: boolean("recorrente").notNull().default(false),
  natureza: text("natureza").notNull().default("OPERACAO"),     // v27 · OPERACAO (dia a dia) · INVESTIMENTO (obra, equipamento) · EXTRAORDINARIA (não se repete)
  contaId: integer("conta_id"),                                 // v28 · conta do plano de contas (define a categoria)
  costCenterId: integer("cost_center_id"),                      // v28 · centro de custo (unidade, segmento, área, projeto ou corporativo)
  valorTotal: numeric("valor_total", { precision: 12, scale: 2 }).notNull(),  // parcelado: total dividido · recorrente: valor de cada parcela
  parcelas: integer("parcelas").notNull(),
  intervalo: text("intervalo").notNull().default("MENSAL"),
  diasIntervalo: integer("dias_intervalo"),                 // intervalo "a cada N dias"
  primeiroVencimento: date("primeiro_vencimento"),          // dia-âncora original (antes do ajuste para dia útil) — base para estender a recorrência
  ajustarDiaUtil: boolean("ajustar_dia_util").notNull().default(false),
  status: text("status").notNull().default("ATIVO"),       // AGUARDANDO_APROVACAO · ATIVO · REJEITADO · CANCELADO · QUITADO
  companyId: integer("company_id"),                        // entidade (CNPJ) — da unidade ou escolhida quando é da rede
  responsavelUserId: integer("responsavel_user_id"),       // quem responde pela despesa
  chaveNfe: text("chave_nfe"),                             // chave de acesso da NF-e/NFC-e/CT-e (44 posições, DV conferido)
  aprovacoes: jsonb("aprovacoes").notNull().default([]),   // [{userId, nome, at}] — dupla checagem acima do valor configurado
  aprovacoesNecessarias: integer("aprovacoes_necessarias").notNull().default(0),
  motivosAprovacao: jsonb("motivos_aprovacao"),
  aprovadoPor: integer("aprovado_por"),
  aprovadoEm: timestamp("aprovado_em"),
  motivoRejeicao: text("motivo_rejeicao"),
  obs: text("obs"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const payableInstallments = pgTable("payable_installments", {
  id: serial("id").primaryKey(),
  payableId: integer("payable_id").notNull(),
  parcela: integer("parcela").notNull(),
  emissao: date("emissao").notNull(),
  vencimento: date("vencimento").notNull(),
  valor: numeric("valor", { precision: 12, scale: 2 }).notNull(),
  status: text("status").notNull().default("A_PAGAR"),     // A_PAGAR · PAGA · CANCELADA
  pagoEm: date("pago_em"),
  valorPago: numeric("valor_pago", { precision: 12, scale: 2 }),
  juros: numeric("juros", { precision: 12, scale: 2 }).notNull().default("0"),
  desconto: numeric("desconto", { precision: 12, scale: 2 }).notNull().default("0"),
  bankLineId: integer("bank_line_id"),
  competencia: text("competencia"),                        // AAAA-MM a que a despesa se refere
  codigoBarras: text("codigo_barras"),                     // código de barras do boleto (44 dígitos), único entre parcelas vivas
  programadoPara: date("programado_para"),                 // programação financeira (data em que o Financeiro vai pagar)
  contaProgramadaId: integer("conta_programada_id"),
  programadoPor: integer("programado_por"),
  programadoEm: timestamp("programado_em"),
  retida: boolean("retida").notNull().default(false),      // em contestação/retida: não entra na programação nem na baixa
  motivoRetencao: text("motivo_retencao"),
  retidaPor: integer("retida_por"),
  retidaEm: timestamp("retida_em"),
  baixaManual: boolean("baixa_manual").notNull().default(false),
  motivoBaixa: text("motivo_baixa"),
  pagoPor: integer("pago_por"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const payableEvents = pgTable("payable_events", {
  id: serial("id").primaryKey(),
  payableId: integer("payable_id").notNull(),
  at: timestamp("at").notNull().defaultNow(),
  userNome: text("user_nome"),
  texto: text("texto").notNull(),
});

// ================= v27 · RH: CONTRATOS COM PRAZO (experiência, estágio, temporário) =================
export const employmentTerms = pgTable("employment_terms", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  tipo: text("tipo").notNull(),                            // EXPERIENCIA · ESTAGIO · TEMPORARIO
  etapa: integer("etapa").notNull().default(1),            // experiência: 1 = fim do 1º período, 2 = fim do contrato · estágio/temporário: nº da renovação
  venceEm: date("vence_em").notNull(),
  recomendacao: text("recomendacao"),                      // recomendação do gestor direto
  recomendacaoMotivo: text("recomendacao_motivo"),
  recomendadoPor: integer("recomendado_por"),
  recomendadoEm: timestamp("recomendado_em"),
  decisao: text("decisao"),                                // PRORROGAR · EFETIVAR · ENCERRAR · RENOVAR
  motivo: text("motivo"),
  novaData: date("nova_data"),
  decididoPor: integer("decidido_por"),
  decididoEm: timestamp("decidido_em"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});


// ================= v28 · PLANO DE CONTAS, CENTROS DE CUSTO, RATEIO E ORÇAMENTO PELO HISTÓRICO =================
export const chartAccounts = pgTable("chart_accounts", {
  id: serial("id").primaryKey(),
  codigo: text("codigo").notNull(),                 // 1 · 1.1 · 1.1.01 · 1.1.01.001 (grupo, subgrupo, conta, subconta)
  nome: text("nome").notNull(),
  nivel: integer("nivel").notNull(),
  paiId: integer("pai_id"),
  tipo: text("tipo").notNull().default("SAIDA"),    // SAIDA · ENTRADA
  categoria: text("categoria"),                      // categoria-ponte do caixa/DRE/orçamento (contas analíticas)
  tipoEconomico: text("tipo_economico").notNull().default("OPEX"), // OPEX · CAPEX · DIVIDA · TRANSFERENCIA · ADIANTAMENTO · RECEITA
  comportamento: text("comportamento").notNull().default("FIXO"),  // FIXO · VARIAVEL
  recorrencia: text("recorrencia").notNull().default("RECORRENTE"), // RECORRENTE · EVENTUAL
  controlavel: boolean("controlavel").notNull().default(true),
  custo: text("custo").notNull().default("INDIRETO"),               // DIRETO (da turma) · INDIRETO (compartilhado)
  indice: text("indice").notNull().default("IPCA"),                 // IPCA · DISSIDIO · MENSALIDADE · NENHUM
  driver: text("driver").notNull().default("NENHUM"),               // ALUNOS · RECEITA · NENHUM
  centroPadrao: text("centro_padrao").notNull().default("UNIDADE"), // UNIDADE · CORPORATIVO
  generica: boolean("generica").notNull().default(false),
  palavras: text("palavras"),
  descricao: text("descricao"),
  ativo: boolean("ativo").notNull().default(true),
  ordem: integer("ordem").notNull().default(0),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const costCenters = pgTable("cost_centers", {
  id: serial("id").primaryKey(),
  codigo: text("codigo").notNull(),
  nome: text("nome").notNull(),
  tipo: text("tipo").notNull(),                      // UNIDADE · SEGMENTO · AREA · PROJETO · CORPORATIVO
  unitId: integer("unit_id"),                        // null = rede (corporativo ou área/projeto da rede)
  segmento: text("segmento"),
  responsavelUserId: integer("responsavel_user_id"), // dono do orçamento do centro
  inicio: date("inicio"), fim: date("fim"),          // projetos
  orcamento: numeric("orcamento", { precision: 14, scale: 2 }),
  ativo: boolean("ativo").notNull().default(true),
  obs: text("obs"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const classificationRules = pgTable("classification_rules", {
  id: serial("id").primaryKey(), padrao: text("padrao").notNull(), contaId: integer("conta_id").notNull(), costCenterId: integer("cost_center_id"), unitId: integer("unit_id"),
  ativo: boolean("ativo").notNull().default(true), usos: integer("usos").notNull().default(0), createdBy: integer("created_by"), createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const allocationRules = pgTable("allocation_rules", {
  id: serial("id").primaryKey(), nome: text("nome").notNull(), base: text("base").notNull(), percentuais: jsonb("percentuais"), desde: text("desde").notNull(),
  status: text("status").notNull().default("RASCUNHO"), motivo: text("motivo"), decisaoMotivo: text("decisao_motivo"), criadoPor: integer("criado_por"), aprovadoPor: integer("aprovado_por"), aprovadoEm: timestamp("aprovado_em"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const budgetHygiene = pgTable("budget_hygiene", {
  cashEntryId: integer("cash_entry_id").primaryKey(), decisao: text("decisao").notNull(), sinal: text("sinal"), motivo: text("motivo"), userId: integer("user_id"), userNome: text("user_nome"),
  decididoEm: timestamp("decidido_em").notNull().defaultNow(),
});
export const budgetPlans = pgTable("budget_plans", {
  ano: integer("ano").primaryKey(), params: jsonb("params").notNull(), status: text("status").notNull().default("RASCUNHO"), versaoAplicada: text("versao_aplicada"), resumo: jsonb("resumo"),
  aplicadoPor: integer("aplicado_por"), aplicadoEm: timestamp("aplicado_em"), updatedBy: integer("updated_by"), updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
