import bcrypt from "bcryptjs";
import { sql } from "./index";

export const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS companies (id serial PRIMARY KEY, nome text NOT NULL, cnpj text);
CREATE TABLE IF NOT EXISTS units (id serial PRIMARY KEY, nome text NOT NULL, codigo text NOT NULL);
CREATE TABLE IF NOT EXISTS positions (id serial PRIMARY KEY, nome text NOT NULL, area text NOT NULL, parent_id integer, regulamentado boolean NOT NULL DEFAULT false, ordem integer NOT NULL DEFAULT 100);
CREATE TABLE IF NOT EXISTS employees (
  id serial PRIMARY KEY, nome text NOT NULL, cpf text, email text, telefone text, data_nascimento date, endereco text,
  company_id integer, unit_id integer NOT NULL, position_id integer, nivel text, gestor_id integer,
  vinculo text NOT NULL, admissao date NOT NULL, desligamento date, motivo_desligamento text,
  situacao text NOT NULL DEFAULT 'ATIVO', jornada_min_dia integer, turno text, salario numeric(12,2), obs text,
  created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS users (id serial PRIMARY KEY, email text NOT NULL UNIQUE, nome text NOT NULL, senha_hash text NOT NULL, role text NOT NULL, unit_id integer, employee_id integer, ativo boolean NOT NULL DEFAULT true, created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS leave_requests (id serial PRIMARY KEY, employee_id integer NOT NULL, tipo text NOT NULL, inicio date NOT NULL, fim date NOT NULL, dias integer NOT NULL, periodo_ref date, justificativa text, status text NOT NULL DEFAULT 'SOLICITADA', solicitado_por integer, aprovado_por integer, decidido_em timestamp, motivo_decisao text, created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS hour_entries (id serial PRIMARY KEY, employee_id integer NOT NULL, data date NOT NULL, minutos integer NOT NULL, tipo text NOT NULL, descricao text, status text NOT NULL DEFAULT 'PENDENTE', lancado_por integer, aprovado_por integer, created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS processes (id serial PRIMARY KEY, employee_id integer NOT NULL, tipo text NOT NULL, status text NOT NULL DEFAULT 'ABERTO', inicio date NOT NULL, prazo date, concluido_em timestamp, responsavel_user_id integer, obs text);
CREATE TABLE IF NOT EXISTS process_items (id serial PRIMARY KEY, process_id integer NOT NULL, titulo text NOT NULL, obrigatorio boolean NOT NULL DEFAULT true, concluido boolean NOT NULL DEFAULT false, concluido_em timestamp, concluido_por integer, ordem integer NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS documents (id serial PRIMARY KEY, employee_id integer NOT NULL, tipo text NOT NULL, nome text, link text, validade date, obrigatorio boolean NOT NULL DEFAULT true, recebido_em date, obs text);
CREATE TABLE IF NOT EXISTS audit_log (id serial PRIMARY KEY, at timestamp NOT NULL DEFAULT now(), user_id integer, user_nome text, acao text NOT NULL, entidade text NOT NULL, entidade_id integer, antes jsonb, depois jsonb);
CREATE TABLE IF NOT EXISTS settings (key text PRIMARY KEY, value jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS grades (id serial PRIMARY KEY, nome text NOT NULL, segmento text NOT NULL, ordem integer NOT NULL DEFAULT 100);
CREATE TABLE IF NOT EXISTS classes (id serial PRIMARY KEY, ano integer NOT NULL, unit_id integer NOT NULL, modalidade text NOT NULL DEFAULT 'REGULAR', grade_id integer, series_texto text, turno text NOT NULL, nome text NOT NULL, vagas integer NOT NULL, status text NOT NULL DEFAULT 'ABERTA', obs text);
CREATE TABLE IF NOT EXISTS students (id serial PRIMARY KEY, nome text NOT NULL, data_nascimento date, responsavel text, telefone text, email text, cpf_responsavel text, aluno_atual boolean NOT NULL DEFAULT false, unit_atual_id integer, serie_atual_id integer, origem text, obs text, created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS enrollments (id serial PRIMARY KEY, student_id integer NOT NULL, class_id integer NOT NULL, ano integer NOT NULL, modalidade text NOT NULL DEFAULT 'REGULAR', status text NOT NULL DEFAULT 'RESERVADA', reserva_ate date, contrato_assinado boolean NOT NULL DEFAULT false, financeiro_ok boolean NOT NULL DEFAULT false, confirmada_em timestamp, motivo_cancelamento text, excecao text, responsavel_user_id integer, obs text, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS waitlist (id serial PRIMARY KEY, student_id integer NOT NULL, ano integer NOT NULL, unit_id integer NOT NULL, grade_id integer NOT NULL, turno text, modalidade text NOT NULL DEFAULT 'REGULAR', status text NOT NULL DEFAULT 'AGUARDANDO', oferta_ate date, oferta_class_id integer, obs text, created_at timestamp NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS classes_unit_ano_idx ON classes(unit_id, ano);
CREATE INDEX IF NOT EXISTS enrollments_class_idx ON enrollments(class_id, status);
CREATE INDEX IF NOT EXISTS enrollments_student_idx ON enrollments(student_id, ano);
CREATE INDEX IF NOT EXISTS waitlist_idx ON waitlist(unit_id, grade_id, ano, status);
CREATE TABLE IF NOT EXISTS schedules (id serial PRIMARY KEY, employee_id integer NOT NULL, vigencia_inicio date NOT NULL, vigencia_fim date, seg integer NOT NULL DEFAULT 0, ter integer NOT NULL DEFAULT 0, qua integer NOT NULL DEFAULT 0, qui integer NOT NULL DEFAULT 0, sex integer NOT NULL DEFAULT 0, sab integer NOT NULL DEFAULT 0, dom integer NOT NULL DEFAULT 0, horarios text, obs text, created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS calendar_days (id serial PRIMARY KEY, data date NOT NULL, tipo text NOT NULL, descricao text, publico text NOT NULL DEFAULT 'TODOS', unit_id integer);
CREATE TABLE IF NOT EXISTS timesheet_days (id serial PRIMARY KEY, employee_id integer NOT NULL, data date NOT NULL, esperado_min integer NOT NULL DEFAULT 0, trabalhado_min integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'NORMAL', marcacoes text, obs text, origem text NOT NULL DEFAULT 'MANUAL', updated_by integer, updated_at timestamp NOT NULL DEFAULT now(), UNIQUE (employee_id, data));
CREATE TABLE IF NOT EXISTS import_batches (id serial PRIMARY KEY, tipo text NOT NULL, user_id integer, payload jsonb NOT NULL, status text NOT NULL DEFAULT 'PREVIA', created_at timestamp NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS schedules_emp_idx ON schedules(employee_id, vigencia_inicio);
CREATE INDEX IF NOT EXISTS calendar_data_idx ON calendar_days(data);
ALTER TABLE hour_entries ADD COLUMN IF NOT EXISTS timesheet_day_id integer;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS regime text NOT NULL DEFAULT 'ADMINISTRATIVO';
CREATE TABLE IF NOT EXISTS cases (id serial PRIMARY KEY, student_id integer, unit_id integer NOT NULL, contato_nome text, contato_telefone text, tipo text NOT NULL, categoria text, gravidade integer, canal text NOT NULL DEFAULT 'WHATSAPP', assunto text NOT NULL, descricao text, prioridade text NOT NULL DEFAULT 'NORMAL', status text NOT NULL DEFAULT 'ABERTO', responsavel_user_id integer, aberto_por integer, sla_ate timestamp, escalado_em timestamp, resolvido_em timestamp, fechado_em timestamp, causa_raiz text, acao_corretiva text, resultado text, motivo_saida text, checklist jsonb, satisfacao integer, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS case_events (id serial PRIMARY KEY, case_id integer NOT NULL, at timestamp NOT NULL DEFAULT now(), user_id integer, user_nome text, tipo text NOT NULL, texto text);
CREATE TABLE IF NOT EXISTS surveys (id serial PRIMARY KEY, tipo text NOT NULL, nota integer NOT NULL, comentario text, student_id integer, unit_id integer NOT NULL, case_id integer, canal text, data date NOT NULL, anonimo boolean NOT NULL DEFAULT false, created_by integer, created_at timestamp NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS cases_unit_status_idx ON cases(unit_id, status);
CREATE INDEX IF NOT EXISTS cases_student_idx ON cases(student_id);
CREATE INDEX IF NOT EXISTS case_events_case_idx ON case_events(case_id);
CREATE INDEX IF NOT EXISTS surveys_unit_data_idx ON surveys(unit_id, data);
ALTER TABLE students ADD COLUMN IF NOT EXISTS inadimplente boolean NOT NULL DEFAULT false;
ALTER TABLE students ADD COLUMN IF NOT EXISTS risco_obs text;
CREATE TABLE IF NOT EXISTS procedures (id serial PRIMARY KEY, codigo text NOT NULL, titulo text NOT NULL, area text NOT NULL, unit_id integer, owner_user_id integer, status text NOT NULL DEFAULT 'RASCUNHO', versao integer NOT NULL DEFAULT 1, objetivo text, escopo text, passos text, responsavel text, aprovador text, consultados text, informados text, indicadores text, link text, publicado_em timestamp, revisar_em date, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS procedure_versions (id serial PRIMARY KEY, procedure_id integer NOT NULL, versao integer NOT NULL, conteudo jsonb NOT NULL, notas text, publicado_por integer, publicado_em timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS procedure_acks (id serial PRIMARY KEY, procedure_id integer NOT NULL, versao integer NOT NULL, user_id integer NOT NULL, at timestamp NOT NULL DEFAULT now(), UNIQUE (procedure_id, versao, user_id));
CREATE TABLE IF NOT EXISTS exceptions (id serial PRIMARY KEY, procedure_id integer, regra text NOT NULL, motivo text NOT NULL, descricao text, impacto text, referencia text, unit_id integer, solicitante_user_id integer NOT NULL, aprovador_user_id integer, status text NOT NULL DEFAULT 'SOLICITADA', validade_ate date, decidido_em timestamp, motivo_decisao text, revisao_nota text, created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS controls (id serial PRIMARY KEY, titulo text NOT NULL, area text NOT NULL, procedure_id integer, unit_id integer, frequencia text NOT NULL DEFAULT 'MENSAL', responsavel_user_id integer, descricao text, ativo boolean NOT NULL DEFAULT true, proxima_em date, created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS control_runs (id serial PRIMARY KEY, control_id integer NOT NULL, data date NOT NULL, resultado text NOT NULL, evidencia text, obs text, user_id integer, created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS nonconformities (id serial PRIMARY KEY, titulo text NOT NULL, origem text NOT NULL, descricao text, procedure_id integer, control_id integer, case_id integer, unit_id integer, gravidade integer NOT NULL DEFAULT 2, causa_raiz text, acao_corretiva text, acao_preventiva text, responsavel_user_id integer, prazo date, status text NOT NULL DEFAULT 'ABERTA', eficacia_verificada boolean NOT NULL DEFAULT false, encerrada_em timestamp, created_by integer, created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS decisions (id serial PRIMARY KEY, data date NOT NULL, titulo text NOT NULL, area text NOT NULL, unit_id integer, contexto text, decisao text NOT NULL, alternativas text, consequencias text, responsavel_user_id integer, status text NOT NULL DEFAULT 'VIGENTE', revisar_em date, substituida_por integer, link text, created_at timestamp NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS procedures_area_idx ON procedures(area, status);
CREATE INDEX IF NOT EXISTS exceptions_status_idx ON exceptions(status, validade_ate);
CREATE INDEX IF NOT EXISTS ncs_status_idx ON nonconformities(status, prazo);
CREATE TABLE IF NOT EXISTS salary_grades (id serial PRIMARY KEY, codigo text NOT NULL, nome text, minimo numeric(12,2) NOT NULL, medio numeric(12,2) NOT NULL, maximo numeric(12,2) NOT NULL, pontos_min integer, pontos_max integer, ordem integer NOT NULL DEFAULT 100, vigencia_inicio date, obs text);
CREATE TABLE IF NOT EXISTS salary_history (id serial PRIMARY KEY, employee_id integer NOT NULL, data date NOT NULL, salario_anterior numeric(12,2), salario numeric(12,2) NOT NULL, motivo text NOT NULL, obs text, user_id integer, created_at timestamp NOT NULL DEFAULT now());
ALTER TABLE positions ADD COLUMN IF NOT EXISTS grade_id integer;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS pontos integer;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS avaliacao jsonb;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS descricao text;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS requisitos text;
CREATE TABLE IF NOT EXISTS perf_cycles (id serial PRIMARY KEY, nome text NOT NULL, inicio date NOT NULL, fim date NOT NULL, status text NOT NULL DEFAULT 'PLANEJADO', competencias jsonb NOT NULL, unit_id integer, descricao text, created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS perf_reviews (id serial PRIMARY KEY, cycle_id integer NOT NULL, employee_id integer NOT NULL, avaliador_user_id integer, status text NOT NULL DEFAULT 'PENDENTE', auto jsonb, gestor jsonb, nota_final numeric(4,2), potencial integer, desempenho_nivel integer, calibracao_nota text, pdi jsonb, concluida_em timestamp, updated_at timestamp NOT NULL DEFAULT now(), UNIQUE (cycle_id, employee_id));
CREATE TABLE IF NOT EXISTS perf_goals (id serial PRIMARY KEY, cycle_id integer NOT NULL, employee_id integer NOT NULL, titulo text NOT NULL, indicador text, meta text, resultado text, peso integer NOT NULL DEFAULT 1, atingimento integer, status text NOT NULL DEFAULT 'EM_ANDAMENTO', created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS perf_checkins (id serial PRIMARY KEY, employee_id integer NOT NULL, data date NOT NULL, user_id integer, temas text, combinados text, created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS requisitions (id serial PRIMARY KEY, titulo text NOT NULL, position_id integer, unit_id integer NOT NULL, quantidade integer NOT NULL DEFAULT 1, tipo text NOT NULL DEFAULT 'SUBSTITUICAO', justificativa text, requisitos text, regime text NOT NULL DEFAULT 'CLT', jornada text, faixa text, status text NOT NULL DEFAULT 'SOLICITADA', solicitante_user_id integer, aprovador_user_id integer, responsavel_user_id integer, prazo date, aberta_em date, fechada_em date, created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS candidates (id serial PRIMARY KEY, nome text NOT NULL, email text, telefone text, cidade text, curriculo_link text, origem text, formacao text, tags text, obs text, consentimento_lgpd boolean NOT NULL DEFAULT false, created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS applications (id serial PRIMARY KEY, requisition_id integer NOT NULL, candidate_id integer NOT NULL, etapa text NOT NULL DEFAULT 'TRIAGEM', scorecard jsonb, notas text, proposta_valor numeric(12,2), motivo_reprovacao text, employee_id integer, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now(), UNIQUE (requisition_id, candidate_id));
CREATE TABLE IF NOT EXISTS application_events (id serial PRIMARY KEY, application_id integer NOT NULL, at timestamp NOT NULL DEFAULT now(), user_nome text, texto text NOT NULL);
CREATE INDEX IF NOT EXISTS salary_history_emp_idx ON salary_history(employee_id, data);
CREATE INDEX IF NOT EXISTS perf_reviews_cycle_idx ON perf_reviews(cycle_id, status);
CREATE INDEX IF NOT EXISTS applications_req_idx ON applications(requisition_id, etapa);
CREATE TABLE IF NOT EXISTS climate_surveys (id serial PRIMARY KEY, nome text NOT NULL, tipo text NOT NULL DEFAULT 'CLIMA', inicio date NOT NULL, fim date NOT NULL, status text NOT NULL DEFAULT 'RASCUNHO', unit_id integer, perguntas jsonb NOT NULL, token text NOT NULL UNIQUE, minimo_anonimato integer NOT NULL DEFAULT 5, created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS climate_responses (id serial PRIMARY KEY, survey_id integer NOT NULL, unit_id integer, regime text, respostas jsonb NOT NULL, comentario text, at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS climate_actions (id serial PRIMARY KEY, survey_id integer NOT NULL, dimensao text, unit_id integer, acao text NOT NULL, responsavel_user_id integer, prazo date, status text NOT NULL DEFAULT 'PLANEJADA', created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS courses (id serial PRIMARY KEY, codigo text NOT NULL, titulo text NOT NULL, area text, descricao text, tipo text NOT NULL DEFAULT 'OPCIONAL', formato text NOT NULL DEFAULT 'ONLINE', carga_horas numeric(5,1), link text, procedure_id integer, validade_meses integer, para_todos boolean NOT NULL DEFAULT false, para_cargos jsonb, para_regime text, ativo boolean NOT NULL DEFAULT true, created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS training_progress (id serial PRIMARY KEY, course_id integer NOT NULL, employee_id integer NOT NULL, status text NOT NULL DEFAULT 'PENDENTE', inicio_em date, concluido_em date, valido_ate date, nota numeric(4,1), evidencia text, registrado_por integer, updated_at timestamp NOT NULL DEFAULT now(), UNIQUE (course_id, employee_id));
CREATE TABLE IF NOT EXISTS training_sessions (id serial PRIMARY KEY, course_id integer NOT NULL, data date NOT NULL, horario text, local text, instrutor text, unit_id integer, vagas integer, obs text, created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS session_attendance (id serial PRIMARY KEY, session_id integer NOT NULL, employee_id integer NOT NULL, presente boolean NOT NULL DEFAULT false, UNIQUE (session_id, employee_id));
CREATE TABLE IF NOT EXISTS training_needs (id serial PRIMARY KEY, employee_id integer, unit_id integer, descricao text NOT NULL, origem text NOT NULL DEFAULT 'GESTOR', prioridade text NOT NULL DEFAULT 'NORMAL', course_id integer, status text NOT NULL DEFAULT 'ABERTA', created_by integer, created_at timestamp NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS climate_resp_idx ON climate_responses(survey_id);
CREATE INDEX IF NOT EXISTS training_progress_emp_idx ON training_progress(employee_id);
CREATE TABLE IF NOT EXISTS critical_positions (id serial PRIMARY KEY, position_id integer NOT NULL, unit_id integer, titular_employee_id integer, criticidade integer NOT NULL DEFAULT 2, motivo text, risco_saida text NOT NULL DEFAULT 'MEDIO', contingencia text, created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS successors (id serial PRIMARY KEY, critical_position_id integer NOT NULL, employee_id integer NOT NULL, prontidao text NOT NULL DEFAULT 'EM_DESENVOLVIMENTO', plano text, ativo boolean NOT NULL DEFAULT true, created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS talent_reviews (id serial PRIMARY KEY, nome text NOT NULL, data date NOT NULL, status text NOT NULL DEFAULT 'PLANEJADO', participantes text, notas text, created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS talent_review_items (id serial PRIMARY KEY, review_id integer NOT NULL, employee_id integer NOT NULL, classificacao text NOT NULL DEFAULT 'SOLIDO', risco_perda text NOT NULL DEFAULT 'MEDIO', impacto_perda text NOT NULL DEFAULT 'MEDIO', acao text, responsavel_user_id integer, prazo date, status text NOT NULL DEFAULT 'PLANEJADA', created_at timestamp NOT NULL DEFAULT now(), UNIQUE (review_id, employee_id));
CREATE TABLE IF NOT EXISTS ai_log (id serial PRIMARY KEY, at timestamp NOT NULL DEFAULT now(), user_id integer, user_nome text, pergunta text NOT NULL, resposta text, modelo text, tokens_entrada integer, tokens_saida integer, erro text);
CREATE TABLE IF NOT EXISTS receivables (id serial PRIMARY KEY, external_id text, student_id integer, aluno_nome text NOT NULL, responsavel text, telefone text, unit_id integer NOT NULL, tipo text NOT NULL DEFAULT 'MENSALIDADE', competencia text, vencimento date NOT NULL, valor numeric(12,2) NOT NULL, valor_pago numeric(12,2), pago_em date, status text NOT NULL DEFAULT 'ABERTO', agreement_id integer, obs text, importado_em timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS receivables_ext_idx ON receivables(external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS receivables_status_idx ON receivables(status, vencimento);
CREATE TABLE IF NOT EXISTS collection_actions (id serial PRIMARY KEY, receivable_id integer, aluno_nome text NOT NULL, unit_id integer NOT NULL, etapa text NOT NULL, canal text, texto text, resultado text, user_id integer, user_nome text, at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS agreements (id serial PRIMARY KEY, aluno_nome text NOT NULL, student_id integer, unit_id integer NOT NULL, valor_original numeric(12,2) NOT NULL, valor_acordado numeric(12,2) NOT NULL, parcelas integer NOT NULL DEFAULT 1, primeira_parcela date NOT NULL, status text NOT NULL DEFAULT 'ATIVO', obs text, created_by integer, created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS agreement_installments (id serial PRIMARY KEY, agreement_id integer NOT NULL, numero integer NOT NULL, vencimento date NOT NULL, valor numeric(12,2) NOT NULL, pago_em date);
CREATE TABLE IF NOT EXISTS discounts (id serial PRIMARY KEY, student_id integer, aluno_nome text NOT NULL, unit_id integer NOT NULL, ano integer NOT NULL, tipo text NOT NULL, percentual numeric(5,2) NOT NULL, motivo text, validade_ate date, status text NOT NULL DEFAULT 'SOLICITADO', solicitante_user_id integer, aprovador_user_id integer, decidido_em timestamp, motivo_decisao text, created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS tuition_prices (id serial PRIMARY KEY, ano integer NOT NULL, unit_id integer NOT NULL, grade_id integer, modalidade text NOT NULL DEFAULT 'REGULAR', valor_mensal numeric(12,2) NOT NULL, parcelas integer NOT NULL DEFAULT 12, UNIQUE (ano, unit_id, grade_id, modalidade));
CREATE TABLE IF NOT EXISTS cash_entries (id serial PRIMARY KEY, unit_id integer NOT NULL, data date NOT NULL, tipo text NOT NULL, categoria text NOT NULL, forma text, descricao text, valor numeric(12,2) NOT NULL, contraparte text, hash text, importado_em timestamp NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS cash_entries_hash_idx ON cash_entries(hash) WHERE hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS cash_entries_unit_data_idx ON cash_entries(unit_id, data);
CREATE TABLE IF NOT EXISTS cash_balances (id serial PRIMARY KEY, unit_id integer NOT NULL, mes text NOT NULL, saldo_inicial numeric(12,2) NOT NULL, UNIQUE (unit_id, mes));
CREATE TABLE IF NOT EXISTS budgets (id serial PRIMARY KEY, ano integer NOT NULL, unit_id integer NOT NULL, tipo text NOT NULL DEFAULT 'SAIDA', categoria text NOT NULL, valor_mensal numeric(12,2) NOT NULL, UNIQUE (ano, unit_id, tipo, categoria));
CREATE TABLE IF NOT EXISTS health_snapshots (id serial PRIMARY KEY, data date NOT NULL, unit_id integer, geral integer NOT NULL, scores jsonb NOT NULL, created_at timestamp NOT NULL DEFAULT now());
ALTER TABLE health_snapshots DROP CONSTRAINT IF EXISTS health_snapshots_data_unit_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS health_snapshots_dia_idx ON health_snapshots(data, coalesce(unit_id, 0));
CREATE TABLE IF NOT EXISTS exec_pending (id serial PRIMARY KEY, titulo text NOT NULL, area text, descricao text, prazo date, responsavel_user_id integer, status text NOT NULL DEFAULT 'ABERTA', decision_id integer, created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS assets (id serial PRIMARY KEY, codigo text, nome text NOT NULL, categoria text NOT NULL DEFAULT 'OUTRO', unit_id integer NOT NULL, ambiente text, aquisicao date, valor numeric(12,2), fornecedor text, garantia_ate date, status text NOT NULL DEFAULT 'EM_USO', preventiva_dias integer, ultima_preventiva date, obs text, created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS work_orders (id serial PRIMARY KEY, tipo text NOT NULL DEFAULT 'CORRETIVA', titulo text NOT NULL, descricao text, unit_id integer NOT NULL, ambiente text, asset_id integer, prioridade text NOT NULL DEFAULT 'NORMAL', status text NOT NULL DEFAULT 'ABERTO', solicitante_user_id integer, responsavel_user_id integer, supplier_id integer, sla_ate timestamp, custo_previsto numeric(12,2), custo_real numeric(12,2), iniciado_em timestamp, concluido_em timestamp, evidencia text, avaliacao integer, inspection_id integer, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS work_order_events (id serial PRIMARY KEY, work_order_id integer NOT NULL, at timestamp NOT NULL DEFAULT now(), user_nome text, tipo text NOT NULL, texto text);
CREATE TABLE IF NOT EXISTS inspections (id serial PRIMARY KEY, unit_id integer NOT NULL, ambiente text NOT NULL, tipo text NOT NULL, data date NOT NULL, inspetor_user_id integer, itens jsonb NOT NULL, conformes integer NOT NULL DEFAULT 0, total integer NOT NULL DEFAULT 0, obs text, created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS suppliers (id serial PRIMARY KEY, nome text NOT NULL, servico text, telefone text, email text, contrato text, ativo boolean NOT NULL DEFAULT true, obs text);
CREATE INDEX IF NOT EXISTS work_orders_status_idx ON work_orders(status, unit_id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_ativo boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS backup_codes jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS trocar_senha boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS password_resets (id serial PRIMARY KEY, user_id integer NOT NULL, token_hash text, expira_em timestamp NOT NULL, usado_em timestamp, via_email boolean NOT NULL DEFAULT false, atendido_por integer, created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS objectives (id serial PRIMARY KEY, ciclo text NOT NULL, pilar text, titulo text NOT NULL, descricao text, owner_user_id integer, unit_id integer, status text NOT NULL DEFAULT 'ATIVO', ordem integer NOT NULL DEFAULT 0, created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS key_results (id serial PRIMARY KEY, objective_id integer NOT NULL, titulo text NOT NULL, metrica text, valor_inicial numeric(14,2) NOT NULL DEFAULT 0, valor_meta numeric(14,2) NOT NULL, valor_atual numeric(14,2), direcao text NOT NULL DEFAULT 'SUBIR', fonte text, owner_user_id integer, prazo date, confianca integer, atualizado_em timestamp);
CREATE TABLE IF NOT EXISTS kr_checkins (id serial PRIMARY KEY, key_result_id integer NOT NULL, data date NOT NULL, valor numeric(14,2), confianca integer, comentario text, user_id integer, user_nome text, created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS projects (id serial PRIMARY KEY, nome text NOT NULL, descricao text, objective_id integer, owner_user_id integer, unit_id integer, status text NOT NULL DEFAULT 'PLANEJADO', prioridade text NOT NULL DEFAULT 'NORMAL', inicio date, fim date, orcamento numeric(12,2), gasto numeric(12,2), saude text NOT NULL DEFAULT 'VERDE', resultado_esperado text, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS milestones (id serial PRIMARY KEY, project_id integer NOT NULL, titulo text NOT NULL, prazo date NOT NULL, responsavel_user_id integer, concluido_em date, ordem integer NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS project_updates (id serial PRIMARY KEY, project_id integer NOT NULL, data date NOT NULL, saude text NOT NULL, feito text, proximo text, riscos text, user_id integer, user_nome text, created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS project_risks (id serial PRIMARY KEY, project_id integer NOT NULL, descricao text NOT NULL, probabilidade integer NOT NULL DEFAULT 2, impacto integer NOT NULL DEFAULT 2, mitigacao text, status text NOT NULL DEFAULT 'ABERTO', created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS login_attempts (id serial PRIMARY KEY, email text NOT NULL, ip text, ok boolean NOT NULL, at timestamp NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS login_attempts_email_idx ON login_attempts(email, at);
CREATE INDEX IF NOT EXISTS employees_unit_idx ON employees(unit_id);
CREATE INDEX IF NOT EXISTS leave_emp_idx ON leave_requests(employee_id);
CREATE INDEX IF NOT EXISTS hour_emp_idx ON hour_entries(employee_id);
CREATE INDEX IF NOT EXISTS docs_emp_idx ON documents(employee_id);
CREATE INDEX IF NOT EXISTS audit_at_idx ON audit_log(at);
CREATE OR REPLACE FUNCTION audit_log_imutavel() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'audit_log é imutável: não é permitido alterar nem apagar registros'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_imutavel();
`;

// Estrutura vigente ditada em 16/07/2026 (22 cargos) + Professor e Pedagoga (corpo docente).
const POSITIONS: [string, string, string | null, boolean][] = [
  // nome, área, reporta a, regulamentado
  ["Diretor Geral (Sócio)", "Direção", null, false],
  ["Diretor Pedagógico", "Direção", "Diretor Geral (Sócio)", true],
  ["Diretora de Gente e Gestão", "Direção", "Diretor Geral (Sócio)", false],
  ["Gerente de Experiência e Crescimento", "Administrativa", "Diretora de Gente e Gestão", false],
  ["Gerente Financeiro", "Administrativa", "Diretora de Gente e Gestão", false],
  ["Coordenador Pedagógico", "Pedagógica", "Diretor Pedagógico", true],
  ["Coordenadora de RH", "Administrativa", "Diretora de Gente e Gestão", false],
  ["Coordenador de Infraestrutura e Manutenção", "Serviços", "Diretora de Gente e Gestão", false],
  ["Coordenadora de Eventos e Desenvolvimento Científico", "Pedagógica", "Diretor Pedagógico", false],
  ["Analista de Atendimento", "Administrativa", "Gerente de Experiência e Crescimento", false],
  ["Analista de Marketing", "Administrativa", "Gerente de Experiência e Crescimento", false],
  ["Auxiliar de Atendimento", "Administrativa", "Analista de Atendimento", false],
  ["Auxiliar Pedagógico", "Pedagógica", "Coordenador Pedagógico", false],
  ["Auxiliar Administrativo", "Administrativa", "Gerente Financeiro", false],
  ["Tesoureiro", "Administrativa", "Gerente Financeiro", false],
  ["Secretária", "Administrativa", "Diretora de Gente e Gestão", true],
  ["Psicóloga", "Pedagógica", "Diretor Pedagógico", true],
  ["Inspetor de Alunos", "Pedagógica", "Coordenador Pedagógico", false],
  ["Professor", "Pedagógica", "Coordenador Pedagógico", true],
  ["Pedagoga", "Pedagógica", "Coordenador Pedagógico", true],
  ["Técnico de Manutenção", "Serviços", "Coordenador de Infraestrutura e Manutenção", true],
  ["Zelador de Edifício", "Serviços", "Coordenador de Infraestrutura e Manutenção", true],
  ["Cozinheira", "Serviços", "Coordenador de Infraestrutura e Manutenção", true],
  ["Auxiliar de Cozinha", "Serviços", "Cozinheira", false],
  ["Auxiliar de Serviços Gerais", "Serviços", "Coordenador de Infraestrutura e Manutenção", false],
];

export const DEFAULT_SETTINGS = {
  alcadas: {
    ferias: ["RH", "DIRECAO", "DIRETOR_UNIDADE"],
    banco: ["RH", "DIRECAO", "DIRETOR_UNIDADE"],
    processos: ["RH", "DIRECAO"],
    matricula: ["RH", "DIRECAO", "DIRETOR_UNIDADE", "COMERCIAL"],   // quem confirma matrícula (com contrato + financeiro OK)
    excecaoCapacidade: ["DIRECAO"],                                  // quem autoriza matrícula acima da capacidade
    excecao: ["DIRECAO", "RH"],                                      // quem aprova exceções a POPs e regras
    pops: ["DIRECAO", "RH"],                                         // quem publica POPs e registra decisões
    vagas: ["DIRECAO", "RH"],                                        // quem aprova requisição de vaga
    remuneracao: ["DIRECAO", "RH"],                                  // quem altera faixas e salários
    calibracao: ["DIRECAO", "RH"],                                   // quem calibra e encerra ciclos de desempenho
    financeiro: ["DIRECAO", "FINANCEIRO"],                           // quem importa títulos, caixa e gerencia orçamento
  },
  estrategia: {
    cicloAtual: "2027",
    pilares: ["Pedagógico", "Comercial e Marca", "Pessoas e Cultura", "Financeiro", "Operações e Infraestrutura", "Governança e Tecnologia"],
    atualizacaoProjetoDias: 14, // projeto sem status report há mais de N dias vira alerta
  },
  seguranca: {
    exigir2FA: ["DIRECAO", "RH", "FINANCEIRO"], // perfis obrigados a ativar a verificação em duas etapas
  },
  operacoes: {
    slaHoras: { URGENTE: 4, ALTA: 24, NORMAL: 72, BAIXA: 240 },
    categoriasAtivo: ["Mobiliário", "TI e equipamentos", "Ar-condicionado", "Elétrico", "Hidráulico", "Predial (portas, janelas, pisos)", "Segurança (extintores, câmeras)", "Pedagógico e brinquedos", "Cozinha e refeitório", "Outro"],
    checklists: {
      "Sala de aula": ["Portas e fechaduras funcionando", "Janelas e cortinas", "Iluminação completa", "Ventiladores/ar-condicionado", "Tomadas e interruptores", "Mesas e cadeiras íntegras", "Lousa/quadro em condições", "Limpeza e lixeira", "Sem infiltração ou mofo", "Extintor sinalizado no corredor"],
      "Banheiro": ["Vasos e descargas", "Pias e torneiras sem vazamento", "Papel, sabonete e toalha", "Portas e trincos", "Limpeza e odor", "Piso seco e sem risco de queda", "Iluminação"],
      "Pátio e áreas externas": ["Piso sem buracos ou desníveis", "Brinquedos e quadra íntegros", "Muros, portões e cadeados", "Iluminação externa", "Caixas d'água tampadas", "Sem água parada", "Lixeiras e limpeza"],
      "Cozinha e refeitório": ["Higiene de superfícies", "Refrigeradores na temperatura", "Validade dos alimentos", "Gás e exaustão", "Extintor e saída livre", "Uniforme e EPI da equipe", "Controle de pragas em dia"],
      "Segurança predial": ["Extintores dentro da validade", "Rotas de fuga sinalizadas e livres", "Câmeras funcionando", "Alarme e cerca", "Quadro elétrico fechado e sinalizado", "Escadas com corrimão", "Kit de primeiros socorros completo"],
    },
    ambientesPadrao: ["Recepção", "Secretaria", "Coordenação", "Sala dos professores", "Pátio", "Quadra", "Refeitório", "Cozinha", "Banheiros", "Biblioteca", "Laboratório", "Corredores", "Estacionamento"],
  },
  commandCenter: {
    pesos: { pessoas: 20, processos: 15, matriculas: 25, atendimento: 20, financeiro: 20 },
    metaOcupacaoPct: 85,      // ocupação (matriculados + reservas) das vagas do ano letivo considerada saudável
    inadimplenciaAlertaPct: 4,
  },
  financeiro: {
    regua: [[3, "LEMBRETE", "WhatsApp"], [10, "CONTATO", "Telefone"], [20, "NEGOCIACAO", "Presencial/telefone"], [45, "AVISO_FORMAL", "Carta/e-mail"], [90, "JURIDICO", "Assessoria jurídica"]], // [dias de atraso, etapa, canal]
    alcadaDescontoPct: { COMERCIAL: 10, DIRETOR_UNIDADE: 20, FINANCEIRO: 30, DIRECAO: 100 }, // até quanto cada perfil aprova
    tiposDesconto: ["Bolsa social", "Irmãos", "Pontualidade", "Comercial / campanha", "Filho de colaborador", "Convênio", "Outro"],
    categoriasEntrada: ["Mensalidades", "Material e taxas", "Integral", "Eventos", "Outras receitas"],
    categoriasSaida: ["Pessoal", "Encargos e benefícios", "Aluguel e condomínio", "Serviços e terceiros", "Materiais e insumos", "Manutenção", "Marketing", "Impostos e taxas", "Financeiras", "Outras despesas"],
    encargosPct: 35, // estimativa de encargos sobre salários para custo de pessoal
  },
  remuneracao: {
    fatores: ["Complexidade das tarefas", "Autonomia e decisão", "Impacto no resultado", "Formação e experiência exigidas", "Liderança e relacionamento"],
    escalaFator: 5,
    dispersaoAlertaPct: 15, // diferença salarial entre pessoas do mesmo cargo e nível que dispara alerta de equidade
  },
  desempenho: {
    competencias: ["Compromisso com o aluno e a família", "Domínio técnico da função", "Trabalho em equipe e colaboração", "Comunicação", "Iniciativa e resolução de problemas", "Organização e cumprimento de prazos"],
    escala: 5,
    limiarAlto: 4.2,
    limiarMedio: 3.0,
    boxes: { "3-3": "Talento estratégico", "3-2": "Alto desempenho consistente", "3-1": "Especialista sólido", "2-3": "Alto potencial em desenvolvimento", "2-2": "Mantenedor confiável", "2-1": "Contribuidor estável", "1-3": "Enigma — investigar", "1-2": "Em desenvolvimento", "1-1": "Atenção — plano de melhoria" },
  },
  clima: {
    dimensoes: [
      ["Liderança", "Meu gestor me dá orientação clara e está disponível quando preciso."],
      ["Comunicação", "Recebo as informações de que preciso no tempo certo."],
      ["Reconhecimento", "Meu trabalho é reconhecido e valorizado."],
      ["Desenvolvimento", "Tenho oportunidades de aprender e crescer aqui."],
      ["Condições de trabalho", "Tenho os recursos e o ambiente adequados para fazer bem meu trabalho."],
      ["Propósito e cultura", "Sinto orgulho de fazer parte do Colégio Status e acredito no que fazemos pelos alunos."],
      ["Equilíbrio", "Consigo equilibrar trabalho e vida pessoal."],
      ["Relação com famílias e alunos", "Sinto-me apoiado(a) pela escola na relação com famílias e alunos."],
    ],
    minimoAnonimato: 5,
  },
  academy: {
    areas: ["Integração institucional", "Pedagógico", "Atendimento e relacionamento", "Segurança e saúde", "Sistemas e processos", "Liderança", "Desenvolvimento pessoal"],
    alertaVencimentoDias: 60,
  },
  analytics: {
    // pesos do People Health Score (parte de 100; cada indicador fora da meta desconta até o peso)
    pesos: { turnover: 20, absenteismo: 15, bancoHoras: 10, enps: 15, desempenho: 10, treinamento: 10, vagas: 10, clima: 10 },
    metas: { turnoverAnualPct: 15, absenteismoPct: 3, debitoMedioHoras: 10, enps: 30, desempenho: 3.5, treinamentoPct: 90, vagasAbertasPct: 5 },
    custoReposicaoSalarios: 3, // custo estimado de repor uma pessoa, em salários mensais
  },
  recrutamento: {
    etapas: ["TRIAGEM", "ENTREVISTA_RH", "TESTE", "ENTREVISTA_GESTOR", "PROPOSTA", "CONTRATADO"],
    criterios: ["Formação e requisitos", "Experiência relevante", "Aderência à cultura Status", "Comunicação", "Motivação e disponibilidade"],
    origens: ["INDICACAO", "SITE", "LINKEDIN", "BANCO_TALENTOS", "OUTRO"],
  },
  governanca: {
    areas: ["Atendimento e Comercial", "Matrículas e Secretaria", "Financeiro", "Pedagógico", "Pessoas e RH", "Operações e Infraestrutura", "Comunicação e Marketing", "Direção e Governança"],
    motivosExcecao: ["Caso excepcional da família", "Erro operacional a corrigir", "Prazo legal ou regulatório", "Decisão comercial pontual", "Indisponibilidade de sistema", "Situação de saúde ou emergência", "Outro"],
    revisaoPopMeses: 12,
    excecaoValidadeDias: 30,
  },
  matriculas: { anoLetivo: 2027, reservaDias: 3, ofertaFilaDias: 2 },
  atendimento: {
    slaHoras: { URGENTE: 4, ALTA: 24, NORMAL: 48, BAIXA: 120 },
    categorias: ["Pedagógico", "Atendimento e comunicação", "Financeiro", "Infraestrutura e limpeza", "Segurança", "Alimentação", "Transporte", "Convivência e disciplina", "Outro"],
    recovery: [
      "Ouvir a família sem interromper e registrar o relato com as palavras dela",
      "Reconhecer o problema e pedir desculpas pelo transtorno (sem justificar antes de ouvir)",
      "Dar uma primeira resposta dentro do SLA, com nome do responsável e prazo",
      "Resolver ou encaminhar a quem resolve, acompanhando até o fim",
      "Retornar à família informando o que foi feito",
      "Verificar a satisfação após a solução (CSAT)",
      "Registrar causa raiz e ação corretiva para o problema não se repetir",
    ],
    retencao: [
      "Acolher: agradecer o contato e ouvir o pedido de saída sem contra-argumentar",
      "Perguntar até chegar ao motivo real (o primeiro motivo raramente é o de fundo)",
      "Reconhecer o que falhou e pedir desculpas quando cabível",
      "Diagnosticar: financeiro, pedagógico, relacionamento, logística ou mudança de vida",
      "Propor solução concreta e reapresentar o que a família ganha permanecendo",
      "Envolver quem decide (coordenação/direção) com prazo combinado",
      "Retornar em até 48 h e registrar o desfecho: retida ou perdida, com motivo",
    ],
    riscoRematriculaApos: "2026-11-30", // a partir desta data, aluno atual sem reserva/matrícula 2027 conta como sinal de risco
  },
  admissao: [
    "Documentos pessoais recebidos (RG, CPF, comprovante de residência, CTPS digital)",
    "Exame admissional (ASO) realizado",
    "Contrato de trabalho assinado",
    "Ficha de registro e eSocial (enviar ao contador/DP)",
    "Cadastro no ponto e definição da carga horária diária",
    "E-mail institucional e acessos aos sistemas",
    "Crachá e uniforme entregues",
    "Integração institucional (cultura, regimento, POPs)",
    "Apresentação ao gestor e à equipe",
    "Treinamento inicial da função",
  ],
  desligamento: [
    "Comunicação formal / aviso prévio registrado",
    "Exame demissional realizado",
    "Devolução de crachá, chaves, equipamentos e materiais",
    "Revogação de acessos (e-mail, sistemas, ponto)",
    "Quitação do banco de horas verificada",
    "Documentos de rescisão enviados ao contador/DP",
    "Homologação / pagamento das verbas no prazo legal",
    "Comunicação à equipe e redistribuição de tarefas",
  ],
  documentos: [
    ["RG e CPF", true], ["Comprovante de residência", true], ["CTPS digital", true],
    ["Título de eleitor", false], ["Certificado de reservista", false], ["Comprovante de escolaridade / diploma", true],
    ["Registro profissional (quando regulamentado)", false], ["ASO admissional", true], ["Contrato de trabalho assinado", true],
    ["Dados bancários", true], ["Certidão de nascimento dos filhos", false], ["Foto 3x4", false],
  ],
};

const GRADES: [string, string][] = [
  ["Maternal", "Educação Infantil"], ["Jardim I", "Educação Infantil"], ["Jardim II", "Educação Infantil"], ["Jardim III", "Educação Infantil"], ["Pré-Escola", "Educação Infantil"],
  ["1º ano", "Fundamental I"], ["2º ano", "Fundamental I"], ["3º ano", "Fundamental I"], ["4º ano", "Fundamental I"], ["5º ano", "Fundamental I"],
  ["6º ano", "Fundamental II"], ["7º ano", "Fundamental II"], ["8º ano", "Fundamental II"], ["9º ano", "Fundamental II"],
  ["1ª série EM", "Ensino Médio"], ["2ª série EM", "Ensino Médio"], ["3ª série EM", "Ensino Médio"],
];
// Grade 2027 conforme quadros de capacidade de 11/08/2026. [unidade, modalidade, série|null, séries-texto, turno, nome, vagas]
type Turma = [string, "REGULAR" | "INTEGRAL", string | null, string | null, string, string, number];
const M = "Matutino", V = "Vespertino";
const reg = (u: string, serie: string, turno: string, nome: string, vagas: number): Turma => [u, "REGULAR", serie, null, turno, nome, vagas];
const integ = (u: string, series: string, turno: string, vagas: number): Turma => [u, "INTEGRAL", null, series, turno, `Integral ${series} · ${turno}`, vagas];
const TURMAS_2027: Turma[] = [
  // ---- Carandá — Regular 21 turmas / 398 vagas
  reg("CAR", "Maternal", M, "Maternal A", 15), reg("CAR", "Maternal", V, "Maternal B", 15),
  reg("CAR", "Jardim I", M, "Jardim I A", 18), reg("CAR", "Jardim I", V, "Jardim I B", 18),
  reg("CAR", "Jardim II", M, "Jardim II A", 18), reg("CAR", "Jardim II", V, "Jardim II B", 18),
  reg("CAR", "Jardim III", M, "Jardim III A", 18), reg("CAR", "Jardim III", V, "Jardim III B", 18),
  reg("CAR", "Pré-Escola", M, "Pré-Escola A", 18), reg("CAR", "Pré-Escola", V, "Pré-Escola B", 18),
  reg("CAR", "1º ano", M, "1º ano A", 22), reg("CAR", "1º ano", V, "1º ano B", 22),
  reg("CAR", "2º ano", M, "2º ano A", 22), reg("CAR", "2º ano", V, "2º ano B", 22),
  reg("CAR", "3º ano", M, "3º ano A", 22), reg("CAR", "3º ano", V, "3º ano B", 22),
  reg("CAR", "4º ano", M, "4º ano A", 22), reg("CAR", "4º ano", V, "4º ano B", 22),
  reg("CAR", "5º ano", V, "5º ano A", 16), reg("CAR", "6º ano", V, "6º ano A", 16), reg("CAR", "7º ano", V, "7º ano A", 16),
  // ---- Carandá — Integral 7 grupos / 126 vagas
  integ("CAR", "Maternal + Jardim I", M, 18), integ("CAR", "Jardim II + Jardim III", V, 18), integ("CAR", "Pré-Escola", M, 18),
  integ("CAR", "Pré-Escola + 1º ano", V, 18), integ("CAR", "2º + 3º ano", V, 18), integ("CAR", "4º + 5º ano", M, 18), integ("CAR", "6º + 7º ano", M, 18),
  // ---- TV Morena I — Regular 36 turmas / 866 vagas
  reg("TVM1", "Maternal", M, "Maternal A", 15), reg("TVM1", "Maternal", V, "Maternal B", 15),
  reg("TVM1", "Jardim I", M, "Jardim I A", 18), reg("TVM1", "Jardim I", V, "Jardim I B", 18),
  reg("TVM1", "Jardim II", M, "Jardim II A", 18), reg("TVM1", "Jardim II", V, "Jardim II B", 18),
  reg("TVM1", "Jardim III", M, "Jardim III A", 18), reg("TVM1", "Jardim III", V, "Jardim III B", 18),
  reg("TVM1", "Pré-Escola", M, "Pré-Escola A", 18), reg("TVM1", "Pré-Escola", M, "Pré-Escola B", 18), reg("TVM1", "Pré-Escola", V, "Pré-Escola C", 18),
  reg("TVM1", "1º ano", M, "1º ano A", 25), reg("TVM1", "1º ano", V, "1º ano B", 25),
  reg("TVM1", "2º ano", M, "2º ano A", 25), reg("TVM1", "2º ano", V, "2º ano B", 25),
  reg("TVM1", "3º ano", M, "3º ano A", 25), reg("TVM1", "3º ano", V, "3º ano B", 25), reg("TVM1", "3º ano", V, "3º ano C", 25),
  reg("TVM1", "4º ano", M, "4º ano A", 25), reg("TVM1", "4º ano", M, "4º ano B", 25), reg("TVM1", "4º ano", V, "4º ano C", 25),
  reg("TVM1", "5º ano", M, "5º ano A", 25), reg("TVM1", "5º ano", M, "5º ano B", 25), reg("TVM1", "5º ano", V, "5º ano C", 25),
  reg("TVM1", "6º ano", M, "6º ano A", 25), reg("TVM1", "6º ano", M, "6º ano B", 25), reg("TVM1", "6º ano", V, "6º ano C", 32),
  reg("TVM1", "7º ano", M, "7º ano A", 25), reg("TVM1", "7º ano", M, "7º ano B", 25), reg("TVM1", "7º ano", V, "7º ano C", 32),
  reg("TVM1", "8º ano", M, "8º ano A", 32), reg("TVM1", "8º ano", M, "8º ano B", 32), reg("TVM1", "8º ano", V, "8º ano C", 32),
  reg("TVM1", "9º ano", M, "9º ano A", 32), reg("TVM1", "9º ano", M, "9º ano B", 32), reg("TVM1", "9º ano", V, "9º ano C", 25),
  // ---- TV Morena I — Integral 7 grupos / 140 vagas
  integ("TVM1", "Maternal + Jardim I", M, 20), integ("TVM1", "Jardim II + Jardim III", V, 20), integ("TVM1", "Pré-Escola + 1º ano", V, 20),
  integ("TVM1", "2º + 3º ano", V, 20), integ("TVM1", "4º + 5º ano", V, 20), integ("TVM1", "6º + 7º ano", V, 20), integ("TVM1", "8º + 9º ano", V, 20),
  // ---- Cultura — Regular 11 turmas / 180 vagas (vagas por turma distribuídas; o documento fixa só o total)
  reg("CUL", "Maternal", M, "Maternal A", 15), reg("CUL", "Maternal", V, "Maternal B", 15),
  reg("CUL", "Jardim I", M, "Jardim I A", 16), reg("CUL", "Jardim I", V, "Jardim I B", 16),
  reg("CUL", "Jardim II", M, "Jardim II A", 16), reg("CUL", "Jardim II", V, "Jardim II B", 16),
  reg("CUL", "Jardim III", M, "Jardim III A", 16), reg("CUL", "Jardim III", V, "Jardim III B", 16),
  reg("CUL", "Pré-Escola", V, "Pré-Escola A", 18), reg("CUL", "1º ano", V, "1º ano A", 18), reg("CUL", "2º ano", V, "2º ano A", 18),
  // ---- Cultura — Integral 4 grupos / 60 vagas
  integ("CUL", "Maternal + Jardim I", V, 12), integ("CUL", "Jardim II + Jardim III", M, 15), integ("CUL", "Jardim II + Jardim III", V, 15), integ("CUL", "1º + 2º ano", M, 18),
  // ---- Ensino Médio — 6 turmas / 288 vagas (cadastradas na unidade TV Morena II; ajuste em Configurações se for outra)
  reg("TVM2", "1ª série EM", M, "1ª série A", 48), reg("TVM2", "1ª série EM", M, "1ª série B", 48),
  reg("TVM2", "2ª série EM", M, "2ª série A", 48), reg("TVM2", "2ª série EM", M, "2ª série B", 48),
  reg("TVM2", "3ª série EM", M, "3ª série A", 48), reg("TVM2", "3ª série EM", M, "3ª série B", 48),
];

// Calendário institucional 2026 (consenso das planilhas de banco de horas validadas)
const CALENDARIO_2026: [string, string, string, string][] = [
  // data, tipo, descrição, público
  ...Array.from({ length: 21 }, (_, i) => [`2026-01-${String(i + 1).padStart(2, "0")}`, "FERIAS_COLETIVAS", "Férias coletivas do corpo docente", "DOCENTE"] as [string, string, string, string]),
  ["2026-02-16", "NAO_LETIVO", "Carnaval — dia não letivo", "DOCENTE"], ["2026-02-17", "NAO_LETIVO", "Carnaval — dia não letivo", "DOCENTE"], ["2026-02-18", "NAO_LETIVO", "Quarta-feira de Cinzas — dia não letivo", "DOCENTE"],
  ["2026-02-16", "DISPENSA", "Carnaval — dispensa administrativa", "ADMINISTRATIVO"], ["2026-02-17", "DISPENSA", "Carnaval — dispensa administrativa", "ADMINISTRATIVO"],
  ["2026-04-03", "FERIADO", "Sexta-feira Santa", "TODOS"], ["2026-04-21", "FERIADO", "Tiradentes", "TODOS"], ["2026-05-01", "FERIADO", "Dia do Trabalho", "TODOS"],
  ["2026-06-04", "FERIADO", "Corpus Christi", "TODOS"], ["2026-06-13", "FERIADO", "Santo Antônio (padroeiro de Campo Grande)", "TODOS"],
  ...Array.from({ length: 12 }, (_, i) => [`2026-07-${String(13 + i).padStart(2, "0")}`, "RECESSO", "Recesso escolar de julho (desconta do banco)", "DOCENTE"] as [string, string, string, string]),
  ["2026-09-07", "FERIADO", "Independência", "TODOS"], ["2026-10-12", "FERIADO", "Nossa Senhora Aparecida", "TODOS"], ["2026-11-02", "FERIADO", "Finados", "TODOS"],
  ["2026-11-15", "FERIADO", "Proclamação da República", "TODOS"], ["2026-11-20", "FERIADO", "Consciência Negra", "TODOS"], ["2026-12-25", "FERIADO", "Natal", "TODOS"],
];

// POPs do Sistema Operacional Status (Vol. II) — cadastrados como rascunhos para receber o texto oficial
const POPS: [string, string, string][] = [
  ["POP-001", "Atendimento ao primeiro contato (SDR)", "Atendimento e Comercial"], ["POP-002", "Visita e diagnóstico da família", "Atendimento e Comercial"],
  ["POP-003", "Matrícula e reserva de vaga", "Matrículas e Secretaria"], ["POP-004", "Cobrança e negociação", "Financeiro"],
  ["POP-005", "Retenção e pedido de transferência", "Atendimento e Comercial"], ["POP-006", "Onboarding do colaborador", "Pessoas e RH"],
  ["POP-007", "Reclamações e Service Recovery", "Atendimento e Comercial"], ["POP-008", "Daily e rotina de gestão", "Direção e Governança"],
  ["POP-009", "Crise de reputação", "Comunicação e Marketing"],
];
// Decisões humanas pendentes do Adendo v3 do STATUS ONE (DOM-15 e governança) — a Direção decide, o sistema lembra
const DECISOES_PENDENTES: [string, string, string][] = [
  ["Nomear o DPO (encarregado de dados — LGPD)", "Direção e Governança", "Responsável formal por dados pessoais de alunos, famílias e colaboradores; atende a ANPD e titulares."],
  ["Nomear o AI Owner", "Direção e Governança", "Quem responde pelos agentes de IA (People AI e futuros): limites, revisão e desligamento."],
  ["Nomear o responsável por segurança da informação", "Direção e Governança", "Acessos, senhas, backup, resposta a incidentes."],
  ["Escolher o provedor de nuvem definitivo", "Sistemas e processos", "Hoje Railway/Neon; decidir onde o STATUS ONE vive nos próximos anos e o plano de backup."],
  ["Decidir sobre o Lakehouse e a camada de análise", "Sistemas e processos", "Manter os painéis no próprio sistema ou criar a camada analítica separada (Bloco 15)."],
  ["Decidir o motor de workflows e a mensageria", "Sistemas e processos", "n8n já existe para matrículas; definir o padrão de automações e fila de eventos."],
  ["Escolher os provedores de IA e o orçamento de IA", "Sistemas e processos", "Qual API, limites de custo e o que pode ou não ser enviado (hoje: só dados agregados)."],
  ["Definir as políticas de retenção e descarte de dados", "Direção e Governança", "Por quanto tempo guardar candidatos, alunos desligados, pesquisas, logs."],
  ["Aprovar o orçamento do DOM-15 (plataforma) para 2027", "Financeiro", "Hospedagem, IA, integrações (ActiveSoft, WhatsApp) e suporte."],
];
// OKRs 2027 sugeridos a partir do plano de capacidade e dos indicadores que o sistema já mede — a Direção edita, apaga ou substitui
export async function seedEstrategia() {
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM objectives`;
  if (n > 0) return [];
  const objs: [string, string, string, [string, string, number, number, string, string | null][]][] = [
    ["Comercial e Marca", "Encher as salas de 2027 com as famílias certas", "Chegar a 2027 com a rede ocupada e a base de famílias fiel.", [["Ocupação das vagas regulares 2027", "%", 0, 85, "SUBIR", "SISTEMA:matriculas.ocupacao"], ["NPS das famílias", "pontos", 0, 50, "SUBIR", "SISTEMA:atendimento.nps"], ["Famílias retidas entre os pedidos de saída", "%", 0, 70, "SUBIR", "SISTEMA:atendimento.retencao"]]],
    ["Financeiro", "Saúde financeira previsível", "Receber o que foi contratado e gastar dentro do orçamento.", [["Inadimplência (90 dias)", "%", 10, 4, "DESCER", "SISTEMA:financeiro.inadimplencia"], ["Títulos vencidos sem ação da régua", "títulos", 20, 0, "DESCER", "SISTEMA:financeiro.regua_pendente"]]],
    ["Pessoas e Cultura", "Uma equipe que fica e cresce", "Reduzir saídas, elevar o clima e formar quem lidera.", [["Turnover em 12 meses", "%", 25, 15, "DESCER", "SISTEMA:pessoas.turnover"], ["eNPS", "pontos", 0, 30, "SUBIR", "SISTEMA:pessoas.enps"], ["Treinamentos obrigatórios em dia", "%", 0, 90, "SUBIR", "SISTEMA:academy.conformidade"], ["Posições críticas com sucessor pronto", "%", 0, 70, "SUBIR", "SISTEMA:sucessao.bench"]]],
    ["Governança e Tecnologia", "Escola que roda por processo, não por pessoa", "POPs vivos, exceções controladas e o STATUS ONE em uso nas quatro unidades.", [["Process Health Score", "pontos", 50, 85, "SUBIR", "SISTEMA:governanca.process_health"], ["POPs vigentes com ciência de toda a equipe", "%", 0, 100, "SUBIR", "SISTEMA:governanca.ciencia"]]],
    ["Operações e Infraestrutura", "Prédios seguros e sem surpresa", "Manutenção preventiva em dia e chamados dentro do prazo.", [["Chamados dentro do SLA", "%", 60, 95, "SUBIR", "SISTEMA:operacoes.sla"], ["Conformidade média das vistorias", "%", 70, 95, "SUBIR", "SISTEMA:operacoes.vistorias"]]],
  ];
  let ordem = 0;
  for (const [pilar, titulo, descricao, krs] of objs) {
    const [o] = await sql<{ id: number }[]>`INSERT INTO objectives (ciclo, pilar, titulo, descricao, ordem) VALUES ('2027', ${pilar}, ${titulo}, ${descricao}, ${ordem++}) RETURNING id`;
    for (const [t, m, ini, meta, dir, fonte] of krs) await sql`INSERT INTO key_results (objective_id, titulo, metrica, valor_inicial, valor_meta, direcao, fonte, prazo) VALUES (${o.id}, ${t}, ${m}, ${ini}, ${meta}, ${dir}, ${fonte}, '2027-12-15')`;
  }
  return ["OKRs 2027 sugeridos carregados (edite em Estratégia)."];
}

export async function seedCommandCenter() {
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM exec_pending`;
  if (n > 0) return [];
  for (const [t, a, d] of DECISOES_PENDENTES) await sql`INSERT INTO exec_pending (titulo, area, descricao) VALUES (${t}, ${a}, ${d})`;
  return ["Decisões pendentes da Direção carregadas."];
}

export async function seedGovernanca() {
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM procedures`;
  if (n > 0) return [];
  for (const [codigo, titulo, area] of POPS) await sql`INSERT INTO procedures (codigo, titulo, area, status, objetivo) VALUES (${codigo}, ${titulo}, ${area}, 'RASCUNHO', 'Cole aqui o texto oficial do Sistema Operacional Status.')`;
  return ["POPs 001–009 cadastrados como rascunhos."];
}

export async function seedPonto() {
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM calendar_days`;
  if (n > 0) return [];
  for (const [data, tipo, desc, pub] of CALENDARIO_2026) await sql`INSERT INTO calendar_days (data, tipo, descricao, publico) VALUES (${data}, ${tipo}, ${desc}, ${pub})`;
  return ["Calendário institucional 2026 carregado."];
}

export async function seedMatriculas() {
  const log: string[] = [];
  const [{ g }] = await sql`SELECT count(*)::int AS g FROM grades`;
  if (g === 0) {
    for (const [i, [nome, seg]] of GRADES.entries()) await sql`INSERT INTO grades (nome, segmento, ordem) VALUES (${nome}, ${seg}, ${i})`;
    log.push("Séries cadastradas.");
  }
  const [{ c }] = await sql`SELECT count(*)::int AS c FROM classes`;
  if (c === 0) {
    const units = await sql<{ id: number; codigo: string }[]>`SELECT id, codigo FROM units`;
    const grades = await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM grades`;
    const uid = (cod: string) => units.find(u => u.codigo === cod)?.id;
    const gid = (nome: string | null) => (nome ? grades.find(x => x.nome === nome)?.id ?? null : null);
    let n = 0;
    for (const [u, mod, serie, seriesTexto, turno, nome, vagas] of TURMAS_2027) {
      const unitId = uid(u); if (!unitId) continue;
      await sql`INSERT INTO classes (ano, unit_id, modalidade, grade_id, series_texto, turno, nome, vagas) VALUES (2027, ${unitId}, ${mod}, ${gid(serie)}, ${seriesTexto}, ${turno}, ${nome}, ${vagas})`;
      n++;
    }
    log.push(`Grade 2027 carregada: ${n} turmas.`);
  }
  return log;
}

// Chaves estrangeiras (integridade referencial). Aplicadas de forma idempotente; RESTRICT protege contra apagar o que ainda é referenciado.
const FKS: [string, string, string, string][] = [
  // tabela, coluna, tabela referenciada, ação
  ["employees", "unit_id", "units", "RESTRICT"], ["employees", "position_id", "positions", "SET NULL"], ["employees", "company_id", "companies", "SET NULL"], ["employees", "gestor_id", "employees", "SET NULL"],
  ["users", "unit_id", "units", "SET NULL"], ["password_resets", "user_id", "users", "CASCADE"], ["users", "employee_id", "employees", "SET NULL"],
  ["leave_requests", "employee_id", "employees", "CASCADE"], ["hour_entries", "employee_id", "employees", "CASCADE"], ["processes", "employee_id", "employees", "CASCADE"], ["process_items", "process_id", "processes", "CASCADE"], ["documents", "employee_id", "employees", "CASCADE"],
  ["schedules", "employee_id", "employees", "CASCADE"], ["timesheet_days", "employee_id", "employees", "CASCADE"], ["salary_history", "employee_id", "employees", "CASCADE"], ["perf_reviews", "employee_id", "employees", "CASCADE"], ["perf_reviews", "cycle_id", "perf_cycles", "CASCADE"], ["perf_goals", "employee_id", "employees", "CASCADE"], ["perf_checkins", "employee_id", "employees", "CASCADE"], ["training_progress", "employee_id", "employees", "CASCADE"], ["training_progress", "course_id", "courses", "CASCADE"], ["session_attendance", "session_id", "training_sessions", "CASCADE"], ["training_sessions", "course_id", "courses", "CASCADE"],
  ["classes", "unit_id", "units", "RESTRICT"], ["classes", "grade_id", "grades", "SET NULL"], ["enrollments", "student_id", "students", "CASCADE"], ["enrollments", "class_id", "classes", "RESTRICT"], ["waitlist", "student_id", "students", "CASCADE"], ["waitlist", "unit_id", "units", "RESTRICT"], ["waitlist", "grade_id", "grades", "RESTRICT"],
  ["cases", "unit_id", "units", "RESTRICT"], ["cases", "student_id", "students", "SET NULL"], ["case_events", "case_id", "cases", "CASCADE"], ["surveys", "unit_id", "units", "RESTRICT"], ["surveys", "student_id", "students", "SET NULL"],
  ["procedure_versions", "procedure_id", "procedures", "CASCADE"], ["procedure_acks", "procedure_id", "procedures", "CASCADE"], ["procedure_acks", "user_id", "users", "CASCADE"], ["exceptions", "solicitante_user_id", "users", "RESTRICT"], ["controls", "procedure_id", "procedures", "SET NULL"], ["control_runs", "control_id", "controls", "CASCADE"],
  ["applications", "requisition_id", "requisitions", "CASCADE"], ["applications", "candidate_id", "candidates", "CASCADE"], ["application_events", "application_id", "applications", "CASCADE"], ["requisitions", "unit_id", "units", "RESTRICT"],
  ["climate_responses", "survey_id", "climate_surveys", "CASCADE"], ["climate_actions", "survey_id", "climate_surveys", "CASCADE"], ["successors", "critical_position_id", "critical_positions", "CASCADE"], ["successors", "employee_id", "employees", "CASCADE"], ["talent_review_items", "review_id", "talent_reviews", "CASCADE"], ["talent_review_items", "employee_id", "employees", "CASCADE"],
  ["receivables", "unit_id", "units", "RESTRICT"], ["collection_actions", "receivable_id", "receivables", "CASCADE"], ["agreement_installments", "agreement_id", "agreements", "CASCADE"], ["discounts", "unit_id", "units", "RESTRICT"], ["tuition_prices", "unit_id", "units", "RESTRICT"], ["cash_entries", "unit_id", "units", "RESTRICT"], ["budgets", "unit_id", "units", "RESTRICT"],
  ["key_results", "objective_id", "objectives", "CASCADE"], ["kr_checkins", "key_result_id", "key_results", "CASCADE"], ["projects", "objective_id", "objectives", "SET NULL"], ["milestones", "project_id", "projects", "CASCADE"], ["project_updates", "project_id", "projects", "CASCADE"], ["project_risks", "project_id", "projects", "CASCADE"],
  ["work_orders", "unit_id", "units", "RESTRICT"], ["work_orders", "asset_id", "assets", "SET NULL"], ["work_orders", "supplier_id", "suppliers", "SET NULL"], ["work_order_events", "work_order_id", "work_orders", "CASCADE"], ["inspections", "unit_id", "units", "RESTRICT"], ["assets", "unit_id", "units", "RESTRICT"],
];

export async function runMigrations() {
  await sql.unsafe(MIGRATION_SQL);
  for (const [t, c, ref, acao] of FKS) {
    const nome = `fk_${t}_${c}`;
    await sql.unsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${nome}') THEN
      IF NOT EXISTS (SELECT 1 FROM ${t} x LEFT JOIN ${ref} r ON r.id = x.${c} WHERE x.${c} IS NOT NULL AND r.id IS NULL) THEN
        ALTER TABLE ${t} ADD CONSTRAINT ${nome} FOREIGN KEY (${c}) REFERENCES ${ref}(id) ON DELETE ${acao};
      END IF; END IF; END $$;`);
  }
}

export async function seedBase(adminPassword: string) {
  const [{ count }] = await sql`SELECT count(*)::int AS count FROM units`;
  const log: string[] = [];
  if (count === 0) {
    await sql`INSERT INTO companies (nome, cnpj) VALUES
      ('Colégio Status LTDA', NULL), ('Sacre Educacional LTDA-ME', NULL), ('Centro Educacional Status EIRELI-ME', NULL)`;
    await sql`INSERT INTO units (nome, codigo) VALUES
      ('Carandá', 'CAR'), ('TV Morena I', 'TVM1'), ('TV Morena II', 'TVM2'), ('Cultura', 'CUL')`;
    const ids = new Map<string, number>();
    for (const [i, [nome, area, parent, reg]] of POSITIONS.entries()) {
      const [row] = await sql`INSERT INTO positions (nome, area, parent_id, regulamentado, ordem)
        VALUES (${nome}, ${area}, ${parent ? ids.get(parent) ?? null : null}, ${reg}, ${i}) RETURNING id`;
      ids.set(nome, row.id);
    }
    log.push("Empresas, unidades e cargos criados.");
  }
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM settings`;
  if (n === 0) {
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
      await sql`INSERT INTO settings (key, value) VALUES (${k}, ${JSON.stringify(v)}::jsonb)`;
    }
    log.push("Configurações padrão criadas.");
  }
  log.push(...(await seedMatriculas()));
  log.push(...(await seedPonto()));
  log.push(...(await seedGovernanca()));
  log.push(...(await seedCommandCenter()));
  log.push(...(await seedEstrategia()));
  const [{ u }] = await sql`SELECT count(*)::int AS u FROM users`;
  if (u === 0) {
    const hash = await bcrypt.hash(adminPassword, 10);
    await sql`INSERT INTO users (email, nome, senha_hash, role) VALUES ('rh@colegiostatus', 'RH Colégio Status', ${hash}, 'RH')`;
    log.push("Usuário inicial: rh@colegiostatus (perfil RH). Troque a senha no primeiro acesso.");
  }
  return log;
}
