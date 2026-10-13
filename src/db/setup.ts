import bcrypt from "bcryptjs";
import { sql } from "./index";
import { modeloInicial, FAMILIAS } from "../lib/avaliacao";
import { SCHEMA_VERSION } from "../lib/versao";

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
CREATE TABLE IF NOT EXISTS announcements (id serial PRIMARY KEY, titulo text NOT NULL, texto text NOT NULL, publico text NOT NULL DEFAULT 'TODOS', unit_id integer, role text, requer_ciencia boolean NOT NULL DEFAULT false, prazo_ciencia date, fixado boolean NOT NULL DEFAULT false, autor_user_id integer, autor_nome text, publicado_em timestamp NOT NULL DEFAULT now(), expira_em date);
CREATE TABLE IF NOT EXISTS announcement_acks (id serial PRIMARY KEY, announcement_id integer NOT NULL, user_id integer NOT NULL, at timestamp NOT NULL DEFAULT now(), UNIQUE (announcement_id, user_id));
CREATE TABLE IF NOT EXISTS message_templates (id serial PRIMARY KEY, codigo text NOT NULL UNIQUE, titulo text NOT NULL, categoria text NOT NULL DEFAULT 'GERAL', canal text NOT NULL DEFAULT 'WHATSAPP', texto text NOT NULL, ativo boolean NOT NULL DEFAULT true);
CREATE TABLE IF NOT EXISTS messages (id serial PRIMARY KEY, canal text NOT NULL DEFAULT 'WHATSAPP', destinatario_nome text NOT NULL, destinatario_contato text, student_id integer, employee_id integer, entidade text, entidade_id integer, template_id integer, texto text NOT NULL, status text NOT NULL DEFAULT 'REGISTRADA', agendada_para timestamp, enviada_em timestamp, provedor_id text, erro text, user_id integer, user_nome text, unit_id integer, created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS attachments (id serial PRIMARY KEY, entidade text NOT NULL, entidade_id integer NOT NULL, nome text NOT NULL, mime text NOT NULL, tamanho integer NOT NULL, dados bytea NOT NULL, descricao text, unit_id integer, user_id integer, user_nome text, created_at timestamp NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS attachments_ent_idx ON attachments(entidade, entidade_id);
CREATE TABLE IF NOT EXISTS notifications (id serial PRIMARY KEY, user_id integer NOT NULL, tipo text NOT NULL DEFAULT 'INFO', titulo text NOT NULL, texto text, link text, lida_em timestamp, chave text, created_at timestamp NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id, lida_em);
CREATE UNIQUE INDEX IF NOT EXISTS notifications_chave_idx ON notifications(user_id, chave) WHERE chave IS NOT NULL;
ALTER TABLE perf_cycles ADD COLUMN IF NOT EXISTS model_id integer; ALTER TABLE perf_cycles ADD COLUMN IF NOT EXISTS model_versao integer; ALTER TABLE perf_cycles ADD COLUMN IF NOT EXISTS criterios jsonb; ALTER TABLE perf_cycles ADD COLUMN IF NOT EXISTS peso_resultados integer NOT NULL DEFAULT 60; ALTER TABLE perf_cycles ADD COLUMN IF NOT EXISTS peso_atitudes integer NOT NULL DEFAULT 40; ALTER TABLE perf_cycles ADD COLUMN IF NOT EXISTS fase text NOT NULL DEFAULT 'PLANEJAMENTO'; ALTER TABLE perf_cycles ADD COLUMN IF NOT EXISTS prazo_avaliacao date; ALTER TABLE perf_cycles ADD COLUMN IF NOT EXISTS prazo_feedback date; ALTER TABLE perf_cycles ADD COLUMN IF NOT EXISTS familias jsonb;
ALTER TABLE perf_reviews ADD COLUMN IF NOT EXISTS estado text NOT NULL DEFAULT 'RASCUNHO'; ALTER TABLE perf_reviews ADD COLUMN IF NOT EXISTS notas_criterios jsonb; ALTER TABLE perf_reviews ADD COLUMN IF NOT EXISTS auto_criterios jsonb; ALTER TABLE perf_reviews ADD COLUMN IF NOT EXISTS calc jsonb; ALTER TABLE perf_reviews ADD COLUMN IF NOT EXISTS notas_originais jsonb; ALTER TABLE perf_reviews ADD COLUMN IF NOT EXISTS calibrado_por integer; ALTER TABLE perf_reviews ADD COLUMN IF NOT EXISTS calibracao_justificativa text; ALTER TABLE perf_reviews ADD COLUMN IF NOT EXISTS enviada_em timestamp; ALTER TABLE perf_reviews ADD COLUMN IF NOT EXISTS publicada_em timestamp; ALTER TABLE perf_reviews ADD COLUMN IF NOT EXISTS ciencia_em timestamp; ALTER TABLE perf_reviews ADD COLUMN IF NOT EXISTS comentario_colaborador text; ALTER TABLE perf_reviews ADD COLUMN IF NOT EXISTS contestacao text; ALTER TABLE perf_reviews ADD COLUMN IF NOT EXISTS contestacao_em timestamp; ALTER TABLE perf_reviews ADD COLUMN IF NOT EXISTS resposta_contestacao text; ALTER TABLE perf_reviews ADD COLUMN IF NOT EXISTS snapshot jsonb; ALTER TABLE perf_reviews ADD COLUMN IF NOT EXISTS versao integer NOT NULL DEFAULT 1;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'perf_reviews_unica_idx') THEN
    IF EXISTS (SELECT 1 FROM perf_reviews GROUP BY cycle_id, employee_id HAVING count(*) > 1) THEN
      CREATE INDEX IF NOT EXISTS perf_reviews_ciclo_colab_idx ON perf_reviews(cycle_id, employee_id);
    ELSE
      CREATE UNIQUE INDEX perf_reviews_unica_idx ON perf_reviews(cycle_id, employee_id);
    END IF;
  END IF;
END $$;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS familia text;
UPDATE positions SET familia = CASE WHEN familia IS NOT NULL THEN familia WHEN nome ILIKE '%professor%' OR nome ILIKE '%pedagog%' AND nome NOT ILIKE '%coordenador%' AND nome NOT ILIKE '%diretor%' THEN 'PROFESSORES' WHEN nome ILIKE '%coordenad%' THEN 'COORDENACAO' WHEN nome ILIKE '%secret%' THEN 'SECRETARIA' WHEN nome ILIKE '%atendimento%' OR nome ILIKE '%marketing%' OR nome ILIKE '%comercial%' THEN 'ATENDIMENTO_COMERCIAL' WHEN nome ILIKE '%diretor%' OR nome ILIKE '%gerente%' THEN 'GESTAO' ELSE 'APOIO_OPERACIONAL' END WHERE familia IS NULL;
CREATE TABLE IF NOT EXISTS eval_models (id serial PRIMARY KEY, nome text NOT NULL, familia text NOT NULL, versao integer NOT NULL DEFAULT 1, status text NOT NULL DEFAULT 'RASCUNHO', peso_resultados integer NOT NULL DEFAULT 60, peso_atitudes integer NOT NULL DEFAULT 40, criterios jsonb NOT NULL, congelado_em timestamp, created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS eval_evidences (id serial PRIMARY KEY, review_id integer NOT NULL, criterio_id text, tipo text NOT NULL DEFAULT 'TEXTO', titulo text NOT NULL, texto text, url text, attachment_id integer, user_id integer, user_nome text, created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS feedbacks (id serial PRIMARY KEY, employee_id integer NOT NULL, cycle_id integer, review_id integer, tipo text NOT NULL DEFAULT 'DESENVOLVIMENTO', data date NOT NULL, situacao text NOT NULL, comportamento text NOT NULL, impacto text, evidencia text, acordo text, autor_user_id integer, autor_nome text, ciencia_em timestamp, comentario_colaborador text, created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS pdi_plans (id serial PRIMARY KEY, employee_id integer NOT NULL, cycle_id integer, review_id integer, criterio_id text, competencia text NOT NULL, evidencia text, objetivo text NOT NULL, situacao_inicial text, meta text, indicador text, status text NOT NULL DEFAULT 'ATIVO', validado_por integer, validado_em timestamp, created_by integer, created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS pdi_actions (id serial PRIMARY KEY, plan_id integer NOT NULL, tipo text NOT NULL DEFAULT 'TREINAMENTO_INTERNO', descricao text NOT NULL, responsavel_user_id integer, apoio text, prazo date, exige_evidencia boolean NOT NULL DEFAULT true, status text NOT NULL DEFAULT 'NAO_INICIADA', evidencia text, course_id integer, concluida_em date, validada_por integer, validada_em timestamp, cancel_justificativa text, created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS pdi_checkins (id serial PRIMARY KEY, action_id integer NOT NULL, data date NOT NULL, texto text, obstaculo text, novo_prazo date, user_id integer, user_nome text, created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS behavior_profiles (id serial PRIMARY KEY, employee_id integer NOT NULL, instrumento text NOT NULL, fornecedor text, versao text, data date NOT NULL, responsavel_user_id integer, escala text, d numeric(6,2), i numeric(6,2), s numeric(6,2), c numeric(6,2), relatorio_url text, attachment_id integer, limitacoes text, obs text, created_at timestamp NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS pdi_plans_emp_idx ON pdi_plans(employee_id, status); CREATE INDEX IF NOT EXISTS feedbacks_emp_idx ON feedbacks(employee_id); CREATE INDEX IF NOT EXISTS perf_reviews_estado_idx ON perf_reviews(cycle_id, estado);
ALTER TABLE eval_models ADD COLUMN IF NOT EXISTS finalidade text; ALTER TABLE eval_models ADD COLUMN IF NOT EXISTS nota_composta boolean NOT NULL DEFAULT false; ALTER TABLE eval_models ADD COLUMN IF NOT EXISTS faixas jsonb; ALTER TABLE eval_models ADD COLUMN IF NOT EXISTS cobertura_minima integer NOT NULL DEFAULT 50;
ALTER TABLE perf_cycles ADD COLUMN IF NOT EXISTS nota_composta boolean NOT NULL DEFAULT false; ALTER TABLE perf_cycles ADD COLUMN IF NOT EXISTS faixas jsonb; ALTER TABLE perf_cycles ADD COLUMN IF NOT EXISTS cobertura_minima integer NOT NULL DEFAULT 50; ALTER TABLE perf_cycles ADD COLUMN IF NOT EXISTS fontes jsonb; ALTER TABLE perf_cycles ADD COLUMN IF NOT EXISTS piloto boolean NOT NULL DEFAULT false;
ALTER TABLE perf_reviews ADD COLUMN IF NOT EXISTS inconclusiva_justificativa text; ALTER TABLE perf_reviews ADD COLUMN IF NOT EXISTS inconclusiva_aprovada_por integer; ALTER TABLE perf_reviews ADD COLUMN IF NOT EXISTS aprovado_por integer; ALTER TABLE perf_reviews ADD COLUMN IF NOT EXISTS periodo_obs_inicio date; ALTER TABLE perf_reviews ADD COLUMN IF NOT EXISTS periodo_obs_fim date; ALTER TABLE perf_reviews ADD COLUMN IF NOT EXISTS calibracao_evidencia text; ALTER TABLE perf_reviews ADD COLUMN IF NOT EXISTS iniciada_em timestamp;
ALTER TABLE eval_evidences ALTER COLUMN review_id DROP NOT NULL;
ALTER TABLE eval_evidences ADD COLUMN IF NOT EXISTS employee_id integer;
ALTER TABLE eval_evidences ADD COLUMN IF NOT EXISTS cycle_id integer;
ALTER TABLE eval_evidences ADD COLUMN IF NOT EXISTS criterios jsonb;
ALTER TABLE eval_evidences ADD COLUMN IF NOT EXISTS natureza text NOT NULL DEFAULT 'REGISTRO';
ALTER TABLE eval_evidences ADD COLUMN IF NOT EXISTS data_fato date;
ALTER TABLE eval_evidences ADD COLUMN IF NOT EXISTS fonte text;
ALTER TABLE eval_evidences ADD COLUMN IF NOT EXISTS contexto text;
ALTER TABLE eval_evidences ADD COLUMN IF NOT EXISTS visibilidade text NOT NULL DEFAULT 'COLABORADOR';
ALTER TABLE eval_evidences ADD COLUMN IF NOT EXISTS validacao text NOT NULL DEFAULT 'NAO_VALIDADA';
ALTER TABLE eval_evidences ADD COLUMN IF NOT EXISTS limitacoes text;
ALTER TABLE eval_evidences ADD COLUMN IF NOT EXISTS contestacao text;
ALTER TABLE eval_evidences ADD COLUMN IF NOT EXISTS contestada_em timestamp;
ALTER TABLE eval_evidences ADD COLUMN IF NOT EXISTS complemento text;
ALTER TABLE eval_evidences ADD COLUMN IF NOT EXISTS origem_modulo text;
ALTER TABLE eval_evidences ADD COLUMN IF NOT EXISTS origem_ref text;
ALTER TABLE eval_evidences ADD COLUMN IF NOT EXISTS origem_atualizado_em timestamp;
ALTER TABLE perf_goals ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'OPERACIONAL';
ALTER TABLE perf_goals ADD COLUMN IF NOT EXISTS unidade_medida text;
ALTER TABLE perf_goals ADD COLUMN IF NOT EXISTS linha_base numeric(14,4);
ALTER TABLE perf_goals ADD COLUMN IF NOT EXISTS esperado numeric(14,4);
ALTER TABLE perf_goals ADD COLUMN IF NOT EXISTS direcao text NOT NULL DEFAULT 'MAIOR_MELHOR';
ALTER TABLE perf_goals ADD COLUMN IF NOT EXISTS faixa_min numeric(14,4);
ALTER TABLE perf_goals ADD COLUMN IF NOT EXISTS faixa_max numeric(14,4);
ALTER TABLE perf_goals ADD COLUMN IF NOT EXISTS prazo date;
ALTER TABLE perf_goals ADD COLUMN IF NOT EXISTS fonte text;
ALTER TABLE perf_goals ADD COLUMN IF NOT EXISTS responsavel_user_id integer;
ALTER TABLE perf_goals ADD COLUMN IF NOT EXISTS dependencias text;
ALTER TABLE perf_goals ADD COLUMN IF NOT EXISTS periodicidade text;
ALTER TABLE perf_goals ADD COLUMN IF NOT EXISTS regra_interpretacao text;
ALTER TABLE perf_goals ADD COLUMN IF NOT EXISTS participa_avaliacao boolean NOT NULL DEFAULT false;
ALTER TABLE perf_goals ADD COLUMN IF NOT EXISTS criterio_id text;
ALTER TABLE perf_goals ADD COLUMN IF NOT EXISTS conversao jsonb;
ALTER TABLE perf_goals ADD COLUMN IF NOT EXISTS conversao_aprovada_por integer;
ALTER TABLE perf_goals ADD COLUMN IF NOT EXISTS conversao_aprovada_em timestamp;
ALTER TABLE perf_goals ADD COLUMN IF NOT EXISTS valor_atual numeric(14,4);
ALTER TABLE perf_goals ADD COLUMN IF NOT EXISTS marcos jsonb;
ALTER TABLE perf_goals ADD COLUMN IF NOT EXISTS contribuicao text;
ALTER TABLE perf_goals ADD COLUMN IF NOT EXISTS original jsonb;
ALTER TABLE perf_goals ADD COLUMN IF NOT EXISTS alteracoes jsonb;
ALTER TABLE perf_checkins ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'REUNIAO';
ALTER TABLE perf_checkins ADD COLUMN IF NOT EXISTS cycle_id integer;
ALTER TABLE perf_checkins ADD COLUMN IF NOT EXISTS goal_id integer;
ALTER TABLE perf_checkins ADD COLUMN IF NOT EXISTS avancou text;
ALTER TABLE perf_checkins ADD COLUMN IF NOT EXISTS evidencia text;
ALTER TABLE perf_checkins ADD COLUMN IF NOT EXISTS bloqueio text;
ALTER TABLE perf_checkins ADD COLUMN IF NOT EXISTS apoio text;
ALTER TABLE perf_checkins ADD COLUMN IF NOT EXISTS proximo_compromisso text;
ALTER TABLE perf_checkins ADD COLUMN IF NOT EXISTS compromisso_gestor text;
ALTER TABLE perf_checkins ADD COLUMN IF NOT EXISTS compromisso_colaborador text;
ALTER TABLE perf_checkins ADD COLUMN IF NOT EXISTS compromisso_prazo date;
ALTER TABLE perf_checkins ADD COLUMN IF NOT EXISTS compromisso_cumprido boolean;
ALTER TABLE perf_checkins ADD COLUMN IF NOT EXISTS pauta_colaborador text;
ALTER TABLE pdi_plans ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'CRESCIMENTO';
ALTER TABLE pdi_plans ADD COLUMN IF NOT EXISTS natureza text NOT NULL DEFAULT 'LACUNA';
ALTER TABLE pdi_plans ADD COLUMN IF NOT EXISTS compartilhar boolean NOT NULL DEFAULT false;
ALTER TABLE pdi_plans ADD COLUMN IF NOT EXISTS aplicacao_status text NOT NULL DEFAULT 'PENDENTE';
ALTER TABLE pdi_plans ADD COLUMN IF NOT EXISTS aplicacao_evidencia text;
ALTER TABLE pdi_plans ADD COLUMN IF NOT EXISTS aplicacao_em date;
ALTER TABLE pdi_plans ADD COLUMN IF NOT EXISTS resultado_status text NOT NULL DEFAULT 'NAO_VERIFICADO';
ALTER TABLE pdi_plans ADD COLUMN IF NOT EXISTS resultado_observado text;
ALTER TABLE pdi_plans ADD COLUMN IF NOT EXISTS resultado_verificado_por integer;
ALTER TABLE pdi_plans ADD COLUMN IF NOT EXISTS resultado_verificado_em timestamp;
ALTER TABLE pdi_plans ADD COLUMN IF NOT EXISTS expectativas text;
ALTER TABLE pdi_plans ADD COLUMN IF NOT EXISTS prazo_final date;
ALTER TABLE pdi_plans ADD COLUMN IF NOT EXISTS manifestacao text;
ALTER TABLE pdi_plans ADD COLUMN IF NOT EXISTS manifestacao_em timestamp;
ALTER TABLE pdi_actions ADD COLUMN IF NOT EXISTS compromisso_colaborador text;
ALTER TABLE pdi_actions ADD COLUMN IF NOT EXISTS compromisso_gestor text;
ALTER TABLE pdi_actions ADD COLUMN IF NOT EXISTS recursos text;
ALTER TABLE pdi_actions ADD COLUMN IF NOT EXISTS tempo_previsto text;
ALTER TABLE pdi_actions ADD COLUMN IF NOT EXISTS forma_acompanhamento text;
ALTER TABLE pdi_actions ADD COLUMN IF NOT EXISTS bloqueio text;
ALTER TABLE pdi_actions ADD COLUMN IF NOT EXISTS bloqueio_desde date;
ALTER TABLE successors ADD COLUMN IF NOT EXISTS requisitos text;
ALTER TABLE successors ADD COLUMN IF NOT EXISTS evidencias text;
ALTER TABLE successors ADD COLUMN IF NOT EXISTS lacunas text;
ALTER TABLE successors ADD COLUMN IF NOT EXISTS experiencias text;
ALTER TABLE successors ADD COLUMN IF NOT EXISTS interesse_declarado text;
ALTER TABLE successors ADD COLUMN IF NOT EXISTS revisao_em date;
ALTER TABLE successors ADD COLUMN IF NOT EXISTS responsavel_user_id integer;
CREATE TABLE IF NOT EXISTS role_profiles (id serial PRIMARY KEY, position_id integer, familia text, nivel text, titulo text NOT NULL, versao integer NOT NULL DEFAULT 1, status text NOT NULL DEFAULT 'RASCUNHO', vigencia_inicio date, vigencia_fim date, finalidade text, responsabilidades jsonb, entregas jsonb, competencias jsonb, comportamentos jsonb, evidencias jsonb, condicoes jsonb, created_by integer, created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS role_profile_acks (id serial PRIMARY KEY, profile_id integer NOT NULL, employee_id integer NOT NULL, comentario text, at timestamp NOT NULL DEFAULT now(), UNIQUE (profile_id, employee_id));
ALTER TABLE positions ADD COLUMN IF NOT EXISTS formacao_exigida text;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS documento_formacao text;
CREATE TABLE IF NOT EXISTS ai_agents (id serial PRIMARY KEY, nome text NOT NULL, funcao text NOT NULL, area text, unit_id integer, position_id integer, dono_user_id integer, nivel text NOT NULL DEFAULT 'N1', ferramenta text, dados text, limites text, revisao_humana text, status text NOT NULL DEFAULT 'PILOTO', revisao_em date, created_by integer, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS dev_needs (id serial PRIMARY KEY, employee_id integer, unit_id integer, cycle_id integer, review_id integer, criterio_id text, origem text NOT NULL DEFAULT 'GESTAO', descricao text NOT NULL, hipotese text NOT NULL DEFAULT 'CONTEXTO', encaminhamento text NOT NULL, acao text, responsavel_user_id integer, prazo date, apoio text, evidencia_esperada text, verificacao text, status text NOT NULL DEFAULT 'ABERTO', ref_modulo text, ref_id integer, resultado_verificado text, created_by integer, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS teaching_observations (id serial PRIMARY KEY, employee_id integer NOT NULL, observador_user_id integer, unit_id integer, segmento text, turma_ref text, finalidade text NOT NULL DEFAULT 'FORMATIVA', pode_compor boolean NOT NULL DEFAULT false, data_planejada date, data_observacao date, foco_planejado text, rubrica jsonb, status text NOT NULL DEFAULT 'PLANEJADA', devolutiva text, foco_desenvolvimento text, aplicacao text, anterior_id integer, created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS rater_trainings (id serial PRIMARY KEY, titulo text NOT NULL, model_id integer, model_versao integer, versao integer NOT NULL DEFAULT 1, orientacoes text, casos jsonb NOT NULL, discussao text, status text NOT NULL DEFAULT 'ABERTO', created_by integer, created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS rater_training_responses (id serial PRIMARY KEY, training_id integer NOT NULL, user_id integer NOT NULL, caso_id text NOT NULL, notas jsonb NOT NULL, justificativa text, at timestamp NOT NULL DEFAULT now(), UNIQUE (training_id, user_id, caso_id));
CREATE TABLE IF NOT EXISTS career_interests (id serial PRIMARY KEY, employee_id integer NOT NULL, data date NOT NULL, interesses text, funcoes text, lideranca text NOT NULL DEFAULT 'NAO_INFORMADO', mobilidade text, obs text, registrado_por integer, created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS review_raters (id serial PRIMARY KEY, review_id integer NOT NULL, user_id integer NOT NULL, grupo text NOT NULL, motivo text, status text NOT NULL DEFAULT 'CONVIDADO', notas jsonb, comentario text, respondido_em timestamp, created_at timestamp NOT NULL DEFAULT now(), UNIQUE (review_id, user_id));
CREATE TABLE IF NOT EXISTS ai_drafts (id serial PRIMARY KEY, employee_id integer NOT NULL, review_id integer, tipo text NOT NULL, modelo text, config_versao text, fontes jsonb, texto text NOT NULL, alertas jsonb, status text NOT NULL DEFAULT 'RASCUNHO', aprovado_por integer, aprovado_em timestamp, created_by integer, created_at timestamp NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS dev_needs_emp_idx ON dev_needs(employee_id, status); CREATE INDEX IF NOT EXISTS eval_evid_emp_idx ON eval_evidences(employee_id, cycle_id); CREATE INDEX IF NOT EXISTS teach_obs_emp_idx ON teaching_observations(employee_id);
ALTER TABLE students ADD COLUMN IF NOT EXISTS carteira_user_id integer;
ALTER TABLE students ADD COLUMN IF NOT EXISTS indicado_por_id integer;
ALTER TABLE objectives ADD COLUMN IF NOT EXISTS perspectiva text;
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS ritual_meeting_id integer;
CREATE TABLE IF NOT EXISTS strategy_identity (id serial PRIMARY KEY, versao integer NOT NULL DEFAULT 1, status text NOT NULL DEFAULT 'RASCUNHO', missao text, visao text, proposito text, valores jsonb, proposta_valor text, posicionamento text, horizonte text, vigencia_inicio date, aprovado_por integer, aprovado_em timestamp, created_by integer, created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS objective_links (id serial PRIMARY KEY, de_objective_id integer NOT NULL, para_objective_id integer NOT NULL, created_at timestamp NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS objective_links_par_idx ON objective_links(de_objective_id, para_objective_id);
CREATE TABLE IF NOT EXISTS indicators (id serial PRIMARY KEY, codigo text, nome text NOT NULL, descricao text, perspectiva text, area text, unit_id integer, unidade_medida text, direcao text NOT NULL DEFAULT 'MAIOR_MELHOR', meta numeric(14,4), alerta numeric(14,4), faixa_min numeric(14,4), faixa_max numeric(14,4), tipo text NOT NULL DEFAULT 'MANUAL', fonte text, numerador_id integer, denominador_id integer, fator numeric(14,4), frequencia text NOT NULL DEFAULT 'MENSAL', funil text, canal text, objective_id integer, responsavel_user_id integer, ativo boolean NOT NULL DEFAULT true, ordem integer NOT NULL DEFAULT 0, created_by integer, created_at timestamp NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS indicators_unit_idx ON indicators(unit_id, ativo);
CREATE TABLE IF NOT EXISTS indicator_values (id serial PRIMARY KEY, indicator_id integer NOT NULL, periodo text NOT NULL, valor numeric(16,4), origem text NOT NULL DEFAULT 'MANUAL', obs text, user_id integer, user_nome text, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS indicator_values_periodo_idx ON indicator_values(indicator_id, periodo);
CREATE TABLE IF NOT EXISTS action_plans (id serial PRIMARY KEY, titulo text NOT NULL, porque text, unit_id integer, local text, inicio date, prazo date, responsavel_user_id integer, como text, custo_previsto numeric(12,2), custo_real numeric(12,2), status text NOT NULL DEFAULT 'A_FAZER', bloqueio text, bloqueio_desde date, evidencia text, concluida_em date, cancel_justificativa text, objective_id integer, indicator_id integer, project_id integer, ritual_meeting_id integer, origem text, created_by integer, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS action_plans_status_idx ON action_plans(status, prazo);
CREATE INDEX IF NOT EXISTS action_plans_resp_idx ON action_plans(responsavel_user_id);
CREATE TABLE IF NOT EXISTS rituals (id serial PRIMARY KEY, nome text NOT NULL, tipo text NOT NULL DEFAULT 'MENSAL', finalidade text, unit_id integer, dono_user_id integer, participantes jsonb, pauta_padrao text, indicadores jsonb, objetivos jsonb, duracao_min integer, proxima_data date, ativo boolean NOT NULL DEFAULT true, created_by integer, created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS ritual_meetings (id serial PRIMARY KEY, ritual_id integer NOT NULL, data date NOT NULL, status text NOT NULL DEFAULT 'REALIZADA', presentes jsonb, pauta text, ata text, indicadores_snapshot jsonb, cancel_motivo text, created_by integer, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS ritual_meetings_ritual_idx ON ritual_meetings(ritual_id, data);
CREATE TABLE IF NOT EXISTS family_contacts (id serial PRIMARY KEY, student_id integer NOT NULL, data date NOT NULL, canal text, tipo text NOT NULL DEFAULT 'CONTATO', etapa text, resumo text NOT NULL, percepcao text, proximo_passo text, proximo_em date, user_id integer, user_nome text, created_at timestamp NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS family_contacts_student_idx ON family_contacts(student_id, data);
CREATE TABLE IF NOT EXISTS family_journey (id serial PRIMARY KEY, student_id integer NOT NULL, ano integer NOT NULL, etapa text NOT NULL, concluida_em date NOT NULL, contact_id integer, user_id integer, obs text, created_at timestamp NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS family_journey_etapa_idx ON family_journey(student_id, ano, etapa);
CREATE TABLE IF NOT EXISTS strategy_ai_drafts (id serial PRIMARY KEY, tarefa text NOT NULL, unit_id integer, modelo text, config_versao text, fontes jsonb, texto text NOT NULL, alertas jsonb, status text NOT NULL DEFAULT 'RASCUNHO', aprovado_por integer, aprovado_em timestamp, created_by integer, created_at timestamp NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS students_carteira_idx ON students(carteira_user_id);
ALTER TABLE classes ADD COLUMN IF NOT EXISTS space_id integer;
CREATE TABLE IF NOT EXISTS rematricula_links (id serial PRIMARY KEY, student_id integer NOT NULL, ano integer NOT NULL, unit_id integer, grade_id integer, token text NOT NULL UNIQUE, status text NOT NULL DEFAULT 'PENDENTE', expira_em date NOT NULL, enviado_em timestamp, enviado_por integer, aberto_em timestamp, concluido_em timestamp, class_id integer, integral_class_id integer, enrollment_id integer, integral_enrollment_id integer, contrato_id integer, contrato_versao integer, contrato_hash text, contrato_texto text, aceite jsonb, dados_atualizados jsonb, rascunho jsonb, recusa_motivo text, recusa_obs text, case_id integer, cancel_motivo text, criado_por integer, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now());
ALTER TABLE rematricula_links ADD COLUMN IF NOT EXISTS rascunho jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS rematricula_links_pendente_idx ON rematricula_links(student_id, ano) WHERE status='PENDENTE';
CREATE INDEX IF NOT EXISTS rematricula_links_ano_idx ON rematricula_links(ano, status);
CREATE TABLE IF NOT EXISTS contract_templates (id serial PRIMARY KEY, ano integer NOT NULL, titulo text NOT NULL, versao integer NOT NULL DEFAULT 1, texto text NOT NULL, status text NOT NULL DEFAULT 'RASCUNHO', publicado_em timestamp, publicado_por integer, created_by integer, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS contract_templates_vigente_idx ON contract_templates(ano) WHERE status='VIGENTE';
CREATE TABLE IF NOT EXISTS teacher_slots (id serial PRIMARY KEY, employee_id integer NOT NULL, unit_id integer NOT NULL, dia_semana integer NOT NULL, inicio text NOT NULL, fim text NOT NULL, turno text NOT NULL, turma text NOT NULL, disciplina text, space_id integer, ativo boolean NOT NULL DEFAULT true, created_at timestamp NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS teacher_slots_emp_idx ON teacher_slots(employee_id, dia_semana);
CREATE INDEX IF NOT EXISTS teacher_slots_unit_idx ON teacher_slots(unit_id, dia_semana);
CREATE TABLE IF NOT EXISTS cover_absences (id serial PRIMARY KEY, employee_id integer NOT NULL, unit_id integer, data date NOT NULL, inicio text, fim text, motivo text NOT NULL, origem text NOT NULL DEFAULT 'COORDENACAO', leave_request_id integer, status text NOT NULL DEFAULT 'ATIVA', obs text, registrado_por integer, created_at timestamp NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS cover_absences_dia_idx ON cover_absences(employee_id, data) WHERE status='ATIVA';
CREATE TABLE IF NOT EXISTS cover_assignments (id serial PRIMARY KEY, absence_id integer NOT NULL, slot_id integer, data date NOT NULL, unit_id integer NOT NULL, turma text NOT NULL, disciplina text, inicio text NOT NULL, fim text NOT NULL, turno text, ausente_employee_id integer NOT NULL, cobertura_employee_id integer, status text NOT NULL DEFAULT 'ABERTA', solucao text, minutos integer NOT NULL DEFAULT 0, hour_entry_id integer, recusas jsonb, convidado_por integer, convidado_em timestamp, respondido_em timestamp, realizada_em timestamp, obs text, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS cover_assign_slot_dia_idx ON cover_assignments(slot_id, data) WHERE status <> 'CANCELADA';
CREATE INDEX IF NOT EXISTS cover_assign_dia_idx ON cover_assignments(data, unit_id);
CREATE INDEX IF NOT EXISTS cover_assign_cob_idx ON cover_assignments(cobertura_employee_id, data);
CREATE TABLE IF NOT EXISTS spaces (id serial PRIMARY KEY, unit_id integer NOT NULL, nome text NOT NULL, tipo text NOT NULL DEFAULT 'SALA', capacidade integer, area_m2 numeric(8,2), reservavel boolean NOT NULL DEFAULT false, ativo boolean NOT NULL DEFAULT true, obs text, created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS space_bookings (id serial PRIMARY KEY, space_id integer NOT NULL, unit_id integer NOT NULL, data date NOT NULL, inicio text NOT NULL, fim text NOT NULL, titulo text NOT NULL, turma text, grupo text, status text NOT NULL DEFAULT 'CONFIRMADA', solicitante_user_id integer, solicitante_nome text, cancel_motivo text, created_at timestamp NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS space_bookings_dia_idx ON space_bookings(space_id, data);
CREATE TABLE IF NOT EXISTS visits (id serial PRIMARY KEY, unit_id integer NOT NULL, tipo text NOT NULL DEFAULT 'VISITANTE', nome text NOT NULL, documento text, empresa text, motivo text, visitado text, cracha text, entrada timestamp NOT NULL DEFAULT now(), saida timestamp, registrado_por integer, saida_por integer, anonimizado_em timestamp, obs text);
CREATE INDEX IF NOT EXISTS visits_unit_idx ON visits(unit_id, entrada);
CREATE TABLE IF NOT EXISTS pickup_authorizations (id serial PRIMARY KEY, student_id integer NOT NULL, nome text NOT NULL, parentesco text, documento text, telefone text, tipo text NOT NULL DEFAULT 'AUTORIZADO', validade date, restricao_obs text, ativo boolean NOT NULL DEFAULT true, created_by integer, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS pickup_student_idx ON pickup_authorizations(student_id);
CREATE TABLE IF NOT EXISTS early_departures (id serial PRIMARY KEY, student_id integer NOT NULL, unit_id integer NOT NULL, data date NOT NULL, hora text NOT NULL, retirado_por text NOT NULL, documento text, authorization_id integer, status text NOT NULL DEFAULT 'LIBERADA', motivo text, excecao_justificativa text, autorizado_por integer, registrado_por integer, registrado_nome text, responsavel_avisado boolean NOT NULL DEFAULT false, emergency_event_id integer, created_at timestamp NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS early_dep_idx ON early_departures(unit_id, data);
CREATE TABLE IF NOT EXISTS brigade_members (id serial PRIMARY KEY, employee_id integer NOT NULL, unit_id integer NOT NULL, funcao text NOT NULL DEFAULT 'BRIGADISTA', turno text, treinamento_em date, validade date, ativo boolean NOT NULL DEFAULT true, obs text, created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS emergency_events (id serial PRIMARY KEY, unit_id integer NOT NULL, tipo text NOT NULL DEFAULT 'SIMULADO', cenario text NOT NULL, status text NOT NULL DEFAULT 'EM_ANDAMENTO', inicio timestamp NOT NULL DEFAULT now(), evacuacao_em timestamp, encerrado_em timestamp, tempo_evacuacao_seg integer, meta_seg integer, pontos_encontro text, observacoes text, coordenador_user_id integer, created_by integer, created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS emergency_checks (id serial PRIMARY KEY, event_id integer NOT NULL, grupo text NOT NULL, ordem integer NOT NULL DEFAULT 0, esperado integer, presentes integer, feridos integer NOT NULL DEFAULT 0, nao_localizados integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'PENDENTE', responsavel text, checado_em timestamp, checado_por text, obs text);
CREATE TABLE IF NOT EXISTS emergency_failures (id serial PRIMARY KEY, event_id integer NOT NULL, descricao text NOT NULL, gravidade text NOT NULL DEFAULT 'MEDIA', action_plan_id integer, created_by integer, created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS consent_purposes (id serial PRIMARY KEY, codigo text NOT NULL UNIQUE, titulo text NOT NULL, texto text NOT NULL, versao integer NOT NULL DEFAULT 1, ativo boolean NOT NULL DEFAULT true, na_rematricula boolean NOT NULL DEFAULT true, ordem integer NOT NULL DEFAULT 0, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS consents (id serial PRIMARY KEY, student_id integer NOT NULL, purpose_id integer NOT NULL, versao integer NOT NULL, status text NOT NULL, titular_nome text, origem text NOT NULL, evidencia jsonb, user_id integer, user_nome text, created_at timestamp NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS consents_student_idx ON consents(student_id, purpose_id, id);
CREATE TABLE IF NOT EXISTS privacy_requests (id serial PRIMARY KEY, protocolo text NOT NULL UNIQUE, codigo_hash text, tipo text NOT NULL, titular_nome text NOT NULL, titular_tipo text, aluno_nome text, contato_email text, contato_telefone text, descricao text, canal text NOT NULL DEFAULT 'PORTAL', student_id integer, employee_id integer, status text NOT NULL DEFAULT 'RECEBIDA', prazo date NOT NULL, identidade_verificada boolean NOT NULL DEFAULT false, responsavel_user_id integer, resposta text, respondida_em timestamp, historico jsonb, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS privacy_incidents (id serial PRIMARY KEY, codigo text NOT NULL UNIQUE, titulo text NOT NULL, descricao text, unit_id integer, detectado_em timestamp, ciencia_em timestamp NOT NULL, categorias_dados jsonb, titulares_estimados integer, envolve_criancas boolean NOT NULL DEFAULT false, dados_sensiveis boolean NOT NULL DEFAULT false, risco text NOT NULL DEFAULT 'EM_AVALIACAO', prazo_anpd date, comunicar boolean, justificativa_nao_comunicar text, comunicado_anpd_em timestamp, comunicado_titulares_em timestamp, medidas text, causa text, status text NOT NULL DEFAULT 'ABERTO', responsavel_user_id integer, historico jsonb, created_by integer, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now(), encerrado_em timestamp);
CREATE TABLE IF NOT EXISTS ethics_reports (id serial PRIMARY KEY, protocolo text NOT NULL UNIQUE, codigo_hash text NOT NULL, categoria text NOT NULL, relato text NOT NULL, envolvidos text, local text, quando text, testemunhas text, unit_id integer, relacao text, anonimo boolean NOT NULL DEFAULT true, contato jsonb, status text NOT NULL DEFAULT 'RECEBIDA', gravidade integer, prazo_triagem date, prazo_conclusao date, responsavel_user_id integer, impedidos jsonb, resultado text, conclusao text, medidas text, concluida_em timestamp, liberados jsonb, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now());
ALTER TABLE ethics_reports ADD COLUMN IF NOT EXISTS liberados jsonb;
CREATE TABLE IF NOT EXISTS ethics_messages (id serial PRIMARY KEY, report_id integer NOT NULL, autor text NOT NULL, texto text NOT NULL, user_id integer, user_nome text, created_at timestamp NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS ethics_messages_report_idx ON ethics_messages(report_id, id);
CREATE TABLE IF NOT EXISTS request_types (id serial PRIMARY KEY, codigo text NOT NULL UNIQUE, nome text NOT NULL, descricao text, campos jsonb NOT NULL, etapas jsonb NOT NULL, prazo_dias integer NOT NULL DEFAULT 2, perfis jsonb, ativo boolean NOT NULL DEFAULT true, ordem integer NOT NULL DEFAULT 0, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS requests (id serial PRIMARY KEY, numero text NOT NULL UNIQUE, type_id integer NOT NULL, titulo text NOT NULL, dados jsonb NOT NULL, valor numeric(12,2), unit_id integer, solicitante_user_id integer NOT NULL, solicitante_nome text, status text NOT NULL DEFAULT 'EM_APROVACAO', etapa_atual integer NOT NULL DEFAULT 0, etapas jsonb NOT NULL, prazo_etapa date, concluida_em timestamp, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS requests_status_idx ON requests(status, prazo_etapa);
CREATE TABLE IF NOT EXISTS request_events (id serial PRIMARY KEY, request_id integer NOT NULL, etapa integer, tipo text NOT NULL, texto text, user_id integer, user_nome text, created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS contracts (id serial PRIMARY KEY, supplier_id integer NOT NULL, unit_id integer, objeto text NOT NULL, numero text, valor_mensal numeric(12,2), valor_total numeric(14,2), inicio date NOT NULL, fim date, renovacao text NOT NULL DEFAULT 'MANUAL', aviso_previo_dias integer NOT NULL DEFAULT 30, reajuste_indice text, proximo_reajuste date, responsavel_user_id integer, status text NOT NULL DEFAULT 'VIGENTE', renovado_de integer, obs text, created_by integer, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS licenses (id serial PRIMARY KEY, unit_id integer NOT NULL, tipo text NOT NULL, nome text, orgao text, numero text, emissao date, validade date, antecedencia_dias integer NOT NULL DEFAULT 60, responsavel_user_id integer, status text NOT NULL DEFAULT 'ATIVA', renovado_de integer, obs text, created_by integer, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS push_subscriptions (id serial PRIMARY KEY, user_id integer NOT NULL, endpoint text NOT NULL UNIQUE, p256dh text NOT NULL, auth text NOT NULL, user_agent text, tipos text NOT NULL DEFAULT 'ACAO_ALERTA', falhas integer NOT NULL DEFAULT 0, ultimo_envio timestamp, created_at timestamp NOT NULL DEFAULT now());
CREATE OR REPLACE FUNCTION registro_sem_exclusao() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'Registro protegido: não pode ser apagado (guarda obrigatória)'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS privacy_incidents_no_delete ON privacy_incidents;
CREATE TRIGGER privacy_incidents_no_delete BEFORE DELETE ON privacy_incidents FOR EACH ROW EXECUTE FUNCTION registro_sem_exclusao();
DROP TRIGGER IF EXISTS ethics_reports_no_delete ON ethics_reports;
CREATE TRIGGER ethics_reports_no_delete BEFORE DELETE ON ethics_reports FOR EACH ROW EXECUTE FUNCTION registro_sem_exclusao();
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
    // Mapa estratégico: perspectivas (de cima para baixo) e perspectiva sugerida para cada pilar (o objetivo pode definir a sua)
    perspectivas: [
      { chave: "FINANCEIRA", nome: "Financeira", descricao: "Sustentabilidade: receita, inadimplência, custos e investimento" },
      { chave: "FAMILIAS", nome: "Famílias e alunos", descricao: "Valor percebido: aprendizagem, experiência, satisfação e permanência" },
      { chave: "PROCESSOS", nome: "Processos internos", descricao: "Como a escola opera: pedagógico, atendimento, matrículas e operações" },
      { chave: "PESSOAS", nome: "Pessoas e cultura", descricao: "Equipe, liderança, clima e desenvolvimento" },
      { chave: "APRENDIZADO", nome: "Aprendizado e inovação", descricao: "Tecnologia, dados, inovação e melhoria contínua" },
    ],
    perspectivaDoPilar: { "Financeiro": "FINANCEIRA", "Comercial e Marca": "FAMILIAS", "Pedagógico": "FAMILIAS", "Pessoas e Cultura": "PESSOAS", "Operações e Infraestrutura": "PROCESSOS", "Governança e Tecnologia": "PROCESSOS" } as Record<string, string>,
    // Saúde estratégica: pesos dos componentes (componente sem base sai do cálculo e o peso é redistribuído) e faixas [crítica < a ≤ atenção < b ≤ boa]
    pesosSaude: { okrs: 25, indicadores: 25, projetos: 15, acoes: 20, rituais: 15 } as Record<string, number>,
    faixasSaude: [50, 75] as [number, number],
    toleranciaRitualDias: 2,      // ritual atrasado = passou da data prevista há mais de N dias
    ataPendenteDias: 2,           // reunião realizada sem ata há mais de N dias vira alerta
    areasIndicador: ["Pedagógico", "Matrículas e marketing", "Atendimento às famílias", "Financeiro", "Pessoas", "Operações", "Governança"],
    modelosRituais: [
      { chave: "DIARIA_UNIDADE", nome: "Reunião de abertura do dia (unidade)", tipo: "DIARIO", duracaoMin: 15, finalidade: "Alinhar o dia: ocorrências, ausências e prioridades.", pauta: "Ocorrências do dia anterior\nAusências e substituições\nPrioridades do dia" },
      { chave: "SEMANAL_COORDENACAO", nome: "Reunião semanal de coordenação", tipo: "SEMANAL", duracaoMin: 60, finalidade: "Acompanhar a rotina pedagógica e os encaminhamentos da unidade.", pauta: "Encaminhamentos da semana anterior\nIndicadores da unidade\nFamílias que pedem atenção\nAgenda da semana" },
      { chave: "MENSAL_COMITE", nome: "Comitê mensal de gestão da rede", tipo: "MENSAL", duracaoMin: 120, finalidade: "Revisar indicadores, decidir prioridades e destravar bloqueios da rede.", pauta: "Saúde estratégica e indicadores fora do alvo\nMatrículas, rematrículas e retenção\nFinanceiro: inadimplência e caixa\nPessoas: movimentações e clima\nDecisões pendentes da Direção\nEncaminhamentos" },
      { chave: "TRIMESTRAL_ESTRATEGIA", nome: "Revisão trimestral da estratégia", tipo: "TRIMESTRAL", duracaoMin: 180, finalidade: "Revisar OKRs, projetos e prioridades do trimestre.", pauta: "Progresso e confiança dos OKRs\nProjetos em risco\nAjustes de prioridade\nDecisões e encaminhamentos" },
      { chave: "ANUAL_PLANEJAMENTO", nome: "Planejamento estratégico anual", tipo: "ANUAL", duracaoMin: 480, finalidade: "Revisar identidade, mapa estratégico e definir os OKRs do próximo ciclo.", pauta: "Leitura do ano: resultados e aprendizados\nIdentidade e posicionamento\nMapa estratégico e objetivos\nOKRs e projetos do próximo ciclo" },
    ],
  },
  comunicacao: {
    categoriasTemplate: ["COBRANCA", "MATRICULA", "ATENDIMENTO", "PEDAGOGICO", "RH", "GERAL"],
    assinatura: "Colégio Status",
    digestEmailHora: 7, // hora do resumo diário por e-mail (quando RESEND configurado e a rotina /api/tarefas é chamada)
  },
  plataforma: {
    anexoMaxMb: 8,
    anexoTipos: ["application/pdf", "image/jpeg", "image/png", "image/webp", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/msword", "application/vnd.ms-excel", "text/plain", "text/csv"],
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
    maxPrioridadesAtivas: 3,                 // PDIs de crescimento ativos por pessoa (configurável)
    checkinDias: { PROFESSORES: 30, COORDENACAO: 30, SECRETARIA: 45, ATENDIMENTO_COMERCIAL: 30, APOIO_OPERACIONAL: 60, GESTAO: 30, PADRAO: 45 } as Record<string, number>, // periodicidade de acompanhamento por família
    dimensoesDocentes: ["Clareza dos objetivos de aprendizagem", "Planejamento", "Estratégias de ensino", "Verificação da compreensão", "Qualidade das devolutivas", "Gestão do ambiente de aprendizagem", "Práticas inclusivas", "Comunicação profissional", "Uso pedagógico dos recursos disponíveis"], // sujeitas à homologação pedagógica
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
  // Rematrícula por link (v22): validade do link, prazo da reserva criada pelo aceite (até o financeiro confirmar) e texto do convite
  rematricula: {
    validadeLinkDias: 30,
    reservaDias: 30,
    integralContraturno: true,  // o Integral acontece no contraturno: só oferece grupos em turno diferente do regular escolhido
    lembreteAbertoDias: 2,      // família abriu o link e não concluiu há N dias: avisa quem cuida da família
    convite: "Olá, {responsavel}! A rematrícula de {aluno} para {ano} já está aberta. Pelo link abaixo você confere os dados, escolhe o turno e aceita o contrato em poucos minutos:\n{link}\nO link vale até {prazo}. Qualquer dúvida, fale com a secretaria da unidade {unidade}.",
  },
  // Substituição de professor (v22)
  substituicao: {
    creditarBanco: true,        // aula coberta e realizada vira crédito no banco de horas de quem cobriu
    creditoAprovado: false,     // false = o crédito entra pendente e segue o fluxo normal de aprovação do banco
    maxSugestoes: 6,
    janelaHistoricoDias: 30,    // equilíbrio: quem cobriu menos nos últimos N dias aparece antes
  },
  // Espaços (v22): parâmetro de área por aluno para a capacidade física sugerida das salas
  espacos: { m2PorAluno: 1.2 },
  // Portaria e segurança (v22)
  portaria: {
    perfis: ["DIRECAO", "RH", "DIRETOR_UNIDADE", "GESTOR", "OPERACOES", "COMERCIAL"], // quem opera a portaria e as saídas antecipadas
    retencaoVisitasDias: 180,   // depois disso nome e documento do visitante são anonimizados
    cenarios: ["Incêndio", "Vazamento de gás", "Ameaça externa (abrigo no local)", "Temporal ou alagamento", "Pane elétrica", "Outro"],
    metaEvacuacaoMin: 5,
    simuladoMeses: 6,           // unidade sem simulado de abandono há mais de N meses vira alerta
    brigadaMinimaPorUnidade: 2,
  },
  // Privacidade e LGPD (v22)
  privacidade: {
    perfis: ["DIRECAO", "RH"],  // quem trata pedidos de titulares, consentimentos e incidentes (além do encarregado)
    dpoUserId: null as number | null,
    encarregadoNome: "",
    encarregadoEmail: "",
    encarregadoTelefone: "",
    prazoPedidoDias: 15,        // LGPD art. 19, II: resposta completa em até 15 dias
    prazoIncidenteDiasUteis: 3, // Res. CD/ANPD nº 15/2024: comunicação em 3 dias úteis
    pequenoPorte: false,        // agente de pequeno porte tem prazo em dobro (Res. CD/ANPD nº 2/2022), salvo tratamento de alto risco
  },
  // Canal de ética (v22): comitê de triagem, prazos e textos do canal
  etica: {
    comite: [] as number[],     // usuários do comitê (vazio = Direção)
    prazoTriagemDias: 5,
    prazoConclusaoDias: 60,
    comunicadoId: null as number | null,
    cursoId: null as number | null,
  },
  // Contratos e licenças (v22): avisos antes do fim do contrato
  contratos: { avisos: [60, 30] as number[] },
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
    // Radar da família: jornada do ano (prazo DD/MM opcional), dias sem contato que pedem atenção e antecedência do aviso de etapa
    jornada: [
      { chave: "BOAS_VINDAS", nome: "Boas-vindas", ate: "02-28" },
      { chave: "CONVERSA_DE_ADAPTACAO", nome: "Conversa de adaptação", ate: "03-31" },
      { chave: "REUNIAO_DE_PAIS_1O_BIMESTRE", nome: "Reunião de pais do 1º bimestre", ate: "05-15" },
      { chave: "PESQUISA_DO_1O_SEMESTRE", nome: "Pesquisa de satisfação do 1º semestre", ate: "06-30" },
      { chave: "CONVERSA_DE_REMATRICULA", nome: "Conversa de rematrícula", ate: "09-30" },
      { chave: "PESQUISA_DO_2O_SEMESTRE", nome: "Pesquisa de satisfação do 2º semestre", ate: "11-30" },
    ] as { chave: string; nome: string; ate: string | null }[],
    semContatoDias: 60,
    avisoEtapaDias: 15,
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

const TEMPLATES: [string, string, string, string][] = [
  ["COB-LEMBRETE", "Lembrete de vencimento", "COBRANCA", "Olá, {responsavel}! Aqui é do {unidade}. Passando para lembrar que a mensalidade de {aluno} ({competencia}) no valor de {valor} venceu em {data}. Se já pagou, desconsidere. Precisando de uma nova via ou de conversar, é só responder por aqui. 😊"],
  ["COB-CONTATO", "Contato de cobrança", "COBRANCA", "Olá, {responsavel}. Identificamos títulos em aberto de {aluno} totalizando {valor}. Podemos combinar a melhor forma de regularizar? Temos opções de parcelamento. Aguardo seu retorno."],
  ["COB-ACORDO", "Confirmação de acordo", "COBRANCA", "Olá, {responsavel}! Confirmando o acordo de {aluno}: {valor} em {parcelas} parcela(s), primeira em {data}. Obrigado pela confiança."],
  ["MAT-RESERVA", "Reserva de vaga", "MATRICULA", "Olá, {responsavel}! A vaga de {aluno} na turma {turma} do {unidade} está reservada até {data}. Para confirmar, basta trazer os documentos e assinar o contrato. Qualquer dúvida, estamos aqui!"],
  ["MAT-FILA", "Vaga liberada para a lista de espera", "MATRICULA", "Boa notícia, {responsavel}! Abriu uma vaga para {aluno} na turma {turma} do {unidade}. Ela fica reservada para vocês até {data}. Podemos agendar a matrícula?"],
  ["ATD-RETORNO", "Retorno de atendimento", "ATENDIMENTO", "Olá, {responsavel}. Sobre o atendimento nº {protocolo}: {texto}. Ficamos à disposição."],
  ["ATD-REUNIAO", "Convite para reunião", "ATENDIMENTO", "Olá, {responsavel}! Gostaríamos de conversar sobre {aluno}. Podemos marcar para {data}? Se preferir outro horário, me avise."],
  ["PED-OCORRENCIA", "Comunicado pedagógico", "PEDAGOGICO", "Olá, {responsavel}. Hoje ({data}) registramos o seguinte sobre {aluno}: {texto}. Estamos acompanhando de perto e contamos com a parceria de vocês."],
  ["RH-CONVOCACAO", "Convocação de colaborador", "RH", "Olá, {nome}! Precisamos da sua presença em {data} para {texto}. Confirma, por favor?"],
  ["RH-ANIVERSARIO", "Aniversário", "RH", "Parabéns, {nome}! 🎉 A equipe do {unidade} deseja um ano cheio de saúde e realizações."],
  ["GER-AVISO", "Aviso geral", "GERAL", "Olá, {nome}. {texto}"],
];
/** Modelos sugeridos por família, como RASCUNHO: o RH revisa critérios, pesos e rubricas e aprova antes de usar em ciclos. Não habilita nota composta. */
export async function seedDesempenho() {
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM eval_models`; if (n) return [] as string[];
  for (const [fam, nome] of Object.entries(FAMILIAS)) {
    const crit = modeloInicial(fam).map((c, i) => ({ ...c, id: `c${i + 1}`, naPermitido: c.eixo !== "ATITUDES" }));
    await sql`INSERT INTO eval_models (nome, familia, criterios, nota_composta, cobertura_minima) VALUES (${`${nome} — modelo sugerido`}, ${fam}, ${JSON.stringify(crit)}::jsonb, false, 50)`;
  }
  return [`${Object.keys(FAMILIAS).length} modelos de avaliação sugeridos (rascunho, aguardando aprovação do RH)`];
}
/** Identidade institucional em rascunho com os valores da escola (sem inventar missão/visão: a Direção completa e publica). */
/** Biblioteca inicial de indicadores (v21): todos lidos do próprio sistema, um conjunto por perspectiva. Metas são sugestões editáveis. */
const INDICADORES_SUGERIDOS: [string, string, string, string, string, string, "MAIOR_MELHOR" | "MENOR_MELHOR", number, number][] = [
  ["FIN-01", "Inadimplência 90 dias", "financeiro.inadimplencia", "FINANCEIRA", "Financeiro", "%", "MENOR_MELHOR", 4, 6],
  ["FIN-02", "Ocupação das vagas regulares", "matriculas.ocupacao", "FINANCEIRA", "Matrículas e marketing", "%", "MAIOR_MELHOR", 90, 80],
  ["FAM-01", "NPS das famílias (mês)", "atendimento.nps", "FAMILIAS", "Atendimento às famílias", "pontos", "MAIOR_MELHOR", 70, 50],
  ["FAM-02", "Rematrícula para o próximo ano letivo", "matriculas.rematricula", "FAMILIAS", "Matrículas e marketing", "%", "MAIOR_MELHOR", 90, 80],
  ["FAM-03", "Retenção nos pedidos de saída (mês)", "atendimento.retencao", "FAMILIAS", "Atendimento às famílias", "%", "MAIOR_MELHOR", 50, 30],
  ["FAM-04", "Famílias com contato recente", "atendimento.contato_recente", "FAMILIAS", "Atendimento às famílias", "%", "MAIOR_MELHOR", 80, 60],
  ["PRO-01", "Jornada da família em dia", "atendimento.jornada", "PROCESSOS", "Atendimento às famílias", "%", "MAIOR_MELHOR", 90, 75],
  ["PRO-02", "Chamados dentro do SLA (90 dias)", "operacoes.sla", "PROCESSOS", "Operações", "%", "MAIOR_MELHOR", 90, 80],
  ["PRO-03", "Ações do plano em dia", "estrategia.acoes_em_dia", "PROCESSOS", "Governança", "%", "MAIOR_MELHOR", 85, 70],
  ["PRO-04", "Rituais de gestão em dia", "estrategia.rituais_em_dia", "PROCESSOS", "Governança", "%", "MAIOR_MELHOR", 90, 75],
  ["PES-01", "Turnover 12 meses", "pessoas.turnover", "PESSOAS", "Pessoas", "%", "MENOR_MELHOR", 12, 18],
  ["PES-02", "eNPS da equipe", "pessoas.enps", "PESSOAS", "Pessoas", "pontos", "MAIOR_MELHOR", 30, 10],
  ["PES-03", "Absenteísmo 90 dias", "pessoas.absenteismo", "PESSOAS", "Pessoas", "%", "MENOR_MELHOR", 3, 5],
  ["APR-01", "Treinamentos obrigatórios em dia", "academy.conformidade", "APRENDIZADO", "Pessoas", "%", "MAIOR_MELHOR", 95, 85],
  ["APR-02", "POPs vigentes com ciência de toda a equipe", "governanca.ciencia", "APRENDIZADO", "Governança", "%", "MAIOR_MELHOR", 90, 75],
  ["APR-03", "Posições críticas com sucessor pronto", "sucessao.bench", "APRENDIZADO", "Pessoas", "%", "MAIOR_MELHOR", 70, 50],
];
export async function seedGestao() {
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM strategy_identity`; if (n) return [] as string[];
  const valores = ["Verdade", "Afetividade", "Motivação", "Criatividade", "Segurança", "Aprendizagem", "Confiança"].map(nome => ({ nome, pratica: "" }));
  await sql`INSERT INTO strategy_identity (versao, status, valores) VALUES (1, 'RASCUNHO', ${JSON.stringify(valores)}::jsonb)`;
  const log = ["Identidade institucional criada em rascunho com os 7 valores (complete missão, visão e práticas e publique)."];
  // Só na primeira vez (junto com a identidade): quem apagar indicadores não os vê voltar.
  const [{ k }] = await sql<{ k: number }[]>`SELECT count(*)::int AS k FROM indicators`;
  if (!k) { let ordem = 0; for (const [codigo, nome, fonte, perspectiva, area, unidade, direcao, meta, alerta] of INDICADORES_SUGERIDOS) await sql`INSERT INTO indicators (codigo, nome, descricao, perspectiva, area, unidade_medida, direcao, meta, alerta, tipo, fonte, frequencia, ordem) VALUES (${codigo}, ${nome}, 'Lido automaticamente do sistema. Meta sugerida na instalação — ajuste à realidade da escola.', ${perspectiva}, ${area}, ${unidade}, ${direcao}, ${meta}, ${alerta}, 'SISTEMA', ${fonte}, 'MENSAL', ${ordem++})`;
    log.push(`${INDICADORES_SUGERIDOS.length} indicadores sugeridos, lidos do próprio sistema (um conjunto por perspectiva do mapa).`); }
  // Governança de IA: o assistente estratégico entra no inventário de agentes como piloto N1 (rascunho revisado pela Direção).
  const [ag] = await sql`SELECT 1 FROM ai_agents WHERE nome='Assistente estratégico'`;
  if (!ag) { await sql`INSERT INTO ai_agents (nome, funcao, area, nivel, ferramenta, dados, limites, revisao_humana, status) VALUES ('Assistente estratégico', 'Rascunhos de leitura executiva, pauta do comitê, prioridades da semana e lacunas de medição a partir do painel estratégico', 'Direção e Governança', 'N1', 'API de IA configurada em AI_API_KEY (sem a chave, nada é gerado nem simulado)', 'Fatos agregados do painel: indicadores, OKRs, projetos, ações, rituais, totais de famílias e de captação — sem nomes de famílias ou colaboradores', 'Não decide, não altera dados, não trata de pessoas; toda afirmação cita o fato de origem e as citações são conferidas', 'Rascunho; a Direção revisa e aprova (ou descarta) antes de qualquer uso', 'PILOTO')`; log.push("Assistente estratégico registrado no inventário de agentes de IA (piloto, N1)."); }
  return log;
}
// ======================= v22: cargas iniciais (só na primeira vez de cada tabela) =======================
/** Finalidades de consentimento (LGPD art. 14 §1º: específico e em destaque, por um dos pais ou responsável). Textos editáveis em Privacidade. */
const FINALIDADES: [string, string, string][] = [
  ["IMAGEM_REDES", "Imagem e voz nas redes sociais e no site", "Autorizo o Colégio Status a publicar fotos e vídeos com a imagem e a voz do(a) aluno(a), registrados em atividades escolares, no site e nas redes sociais oficiais da escola, sem finalidade comercial e sem cessão a terceiros. Posso revogar esta autorização a qualquer momento, sem nenhum prejuízo à matrícula."],
  ["IMAGEM_MATERIAIS", "Imagem em materiais impressos, murais e eventos", "Autorizo o uso da imagem do(a) aluno(a) em murais, materiais impressos, apresentações e eventos da escola. Posso revogar esta autorização a qualquer momento, sem nenhum prejuízo à matrícula."],
  ["DIVULGACAO_RESULTADOS", "Divulgação de conquistas e resultados", "Autorizo a divulgação do nome e de conquistas do(a) aluno(a) — premiações, olimpíadas, aprovações — nos canais institucionais da escola. Posso revogar esta autorização a qualquer momento, sem nenhum prejuízo à matrícula."],
];
type CampoSeed = { id: string; rotulo: string; tipo: string; obrigatorio: boolean; opcoes?: string[] };
type EtapaSeed = { nome: string; perfis: string[]; acimaDe?: number };
const c = (id: string, rotulo: string, tipo: string, obrigatorio = true, opcoes?: string[]): CampoSeed => ({ id, rotulo, tipo, obrigatorio, ...(opcoes ? { opcoes } : {}) });
const TIPOS_SOLICITACAO: [string, string, string, number, CampoSeed[], EtapaSeed[]][] = [
  ["REEMBOLSO", "Reembolso de despesa", "Despesa paga do próprio bolso a serviço da escola. Anexe o comprovante na solicitação.", 2,
    [c("descricao", "O que foi pago e por quê", "TEXTO_LONGO"), c("data", "Data da despesa", "DATA"), c("valor", "Valor (R$)", "VALOR"), c("forma", "Como prefere receber", "SELECAO", true, ["PIX", "Depósito em conta", "Junto do pagamento"])],
    [{ nome: "Diretor(a) da unidade", perfis: ["DIRETOR_UNIDADE"] }, { nome: "Financeiro", perfis: ["FINANCEIRO"] }, { nome: "Direção (acima de R$ 1.000)", perfis: ["DIRECAO"], acimaDe: 1000 }]],
  ["COMPRA", "Pedido de compra", "Itens ou serviços a comprar. A aprovação libera a compra; pagamento e nota seguem no financeiro.", 3,
    [c("item", "Item ou serviço", "TEXTO"), c("quantidade", "Quantidade", "NUMERO"), c("valor", "Valor estimado (R$)", "VALOR"), c("fornecedor", "Fornecedor sugerido", "TEXTO", false), c("justificativa", "Justificativa", "TEXTO_LONGO"), c("prazo", "Precisa até", "DATA", false)],
    [{ nome: "Diretor(a) da unidade", perfis: ["DIRETOR_UNIDADE"] }, { nome: "Direção (acima de R$ 2.000)", perfis: ["DIRECAO"], acimaDe: 2000 }]],
  ["PASSEIO", "Passeio ou evento", "Atividade fora da rotina. A autorização de cada família é feita na Agenda Eletrônica.", 3,
    [c("turmas", "Turmas", "TEXTO"), c("destino", "Destino ou atividade", "TEXTO"), c("data", "Data", "DATA"), c("horario", "Saída e retorno", "TEXTO"), c("alunos", "Número de alunos", "NUMERO"), c("valor", "Custo total estimado (R$)", "VALOR", false), c("transporte", "Transporte", "SELECAO", true, ["Ônibus contratado", "A pé", "Não se aplica"]), c("responsaveis", "Professores e acompanhantes", "TEXTO_LONGO")],
    [{ nome: "Coordenação", perfis: ["GESTOR"] }, { nome: "Diretor(a) da unidade", perfis: ["DIRETOR_UNIDADE"] }, { nome: "Direção", perfis: ["DIRECAO"] }]],
  ["DECLARACAO", "Declaração", "Declaração para colaborador (vínculo) ou para família (matrícula, frequência).", 2,
    [c("tipo", "Tipo de declaração", "SELECAO", true, ["Vínculo empregatício", "Matrícula de aluno", "Frequência de aluno", "Outra"]), c("finalidade", "Para quem e para quê", "TEXTO"), c("detalhes", "Detalhes", "TEXTO_LONGO", false), c("prazo", "Precisa até", "DATA")],
    [{ nome: "Secretaria / RH", perfis: ["RH", "COMERCIAL"] }]],
  ["MATERIAL", "Material pedagógico ou de expediente", "Pedido de material para turma ou setor.", 2,
    [c("itens", "Itens e quantidades", "TEXTO_LONGO"), c("destino", "Turma ou setor", "TEXTO"), c("prazo", "Precisa até", "DATA"), c("valor", "Valor estimado (R$)", "VALOR", false)],
    [{ nome: "Coordenação ou direção da unidade", perfis: ["GESTOR", "DIRETOR_UNIDADE"] }, { nome: "Direção (acima de R$ 500)", perfis: ["DIRECAO"], acimaDe: 500 }]],
];
export const MARCA_RASCUNHO_CONTRATO = "[RASCUNHO";
const CONTRATO_RASCUNHO = `CONTRATO DE PRESTAÇÃO DE SERVIÇOS EDUCACIONAIS — ANO LETIVO {ano}

[RASCUNHO — substitua todo este texto pelo contrato oficial revisado pela assessoria jurídica antes de publicar. Enquanto este aviso estiver no texto, a publicação é bloqueada.]

CONTRATANTE: {responsavel}, responsável financeiro pelo(a) aluno(a) {aluno}.
CONTRATADA: Colégio Status — unidade {unidade}.

OBJETO: prestação de serviços educacionais ao(à) aluno(a) {aluno} no ano letivo de {ano}, na série {serie}, turma {turma}, turno {turno}{integral}.

Variáveis disponíveis: {aluno} {responsavel} {serie} {turma} {turno} {unidade} {ano} {integral} {data}.`;
export async function seedV22() {
  const log: string[] = [];
  const [{ f }] = await sql<{ f: number }[]>`SELECT count(*)::int AS f FROM consent_purposes`;
  if (!f) { let ordem = 0; for (const [codigo, titulo, texto] of FINALIDADES) await sql`INSERT INTO consent_purposes (codigo, titulo, texto, ordem) VALUES (${codigo}, ${titulo}, ${texto}, ${ordem++})`; log.push("Finalidades de consentimento de imagem e divulgação cadastradas (edite os textos em Governança → Privacidade)."); }
  const [{ t }] = await sql<{ t: number }[]>`SELECT count(*)::int AS t FROM request_types`;
  if (!t) { let ordem = 0; for (const [codigo, nome, descricao, prazo, campos, etapas] of TIPOS_SOLICITACAO) await sql`INSERT INTO request_types (codigo, nome, descricao, campos, etapas, prazo_dias, ordem) VALUES (${codigo}, ${nome}, ${descricao}, ${JSON.stringify(campos)}::jsonb, ${JSON.stringify(etapas)}::jsonb, ${prazo}, ${ordem++})`; log.push("Tipos de solicitação com aprovação cadastrados (reembolso, compra, passeio, declaração, material)."); }
  const [{ k }] = await sql<{ k: number }[]>`SELECT count(*)::int AS k FROM contract_templates`;
  if (!k) { const [cfg] = await sql<{ value: { anoLetivo?: number } }[]>`SELECT value FROM settings WHERE key='matriculas'`; const ano = cfg?.value?.anoLetivo ?? DEFAULT_SETTINGS.matriculas.anoLetivo; await sql`INSERT INTO contract_templates (ano, titulo, versao, texto) VALUES (${ano}, ${`Contrato de prestação de serviços educacionais ${ano}`}, 1, ${CONTRATO_RASCUNHO})`; log.push(`Contrato ${ano} criado em rascunho (cole o texto oficial e publique antes de enviar os links de rematrícula).`); }
  return log;
}
export async function seedComunicacao() {
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM message_templates`;
  if (n > 0) return [];
  for (const [c, t, cat, txt] of TEMPLATES) await sql`INSERT INTO message_templates (codigo, titulo, categoria, texto) VALUES (${c}, ${t}, ${cat}, ${txt})`;
  return ["Modelos de mensagem carregados."];
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
  ["eval_evidences", "review_id", "perf_reviews", "CASCADE"], ["eval_evidences", "employee_id", "employees", "CASCADE"], ["feedbacks", "employee_id", "employees", "CASCADE"], ["pdi_plans", "employee_id", "employees", "CASCADE"], ["pdi_actions", "plan_id", "pdi_plans", "CASCADE"], ["pdi_checkins", "action_id", "pdi_actions", "CASCADE"], ["behavior_profiles", "employee_id", "employees", "CASCADE"], ["perf_cycles", "model_id", "eval_models", "SET NULL"],
  ["role_profile_acks", "profile_id", "role_profiles", "CASCADE"], ["role_profile_acks", "employee_id", "employees", "CASCADE"], ["dev_needs", "employee_id", "employees", "CASCADE"], ["teaching_observations", "employee_id", "employees", "CASCADE"], ["rater_training_responses", "training_id", "rater_trainings", "CASCADE"], ["career_interests", "employee_id", "employees", "CASCADE"], ["review_raters", "review_id", "perf_reviews", "CASCADE"], ["ai_drafts", "employee_id", "employees", "CASCADE"],
  ["objective_links", "de_objective_id", "objectives", "CASCADE"], ["objective_links", "para_objective_id", "objectives", "CASCADE"], ["indicator_values", "indicator_id", "indicators", "CASCADE"], ["indicators", "objective_id", "objectives", "SET NULL"], ["indicators", "numerador_id", "indicators", "SET NULL"], ["indicators", "denominador_id", "indicators", "SET NULL"], ["indicators", "responsavel_user_id", "users", "SET NULL"],
  ["action_plans", "objective_id", "objectives", "SET NULL"], ["action_plans", "indicator_id", "indicators", "SET NULL"], ["action_plans", "project_id", "projects", "SET NULL"], ["action_plans", "ritual_meeting_id", "ritual_meetings", "SET NULL"], ["action_plans", "responsavel_user_id", "users", "SET NULL"], ["rituals", "dono_user_id", "users", "SET NULL"], ["ritual_meetings", "ritual_id", "rituals", "CASCADE"], ["decisions", "ritual_meeting_id", "ritual_meetings", "SET NULL"],
  ["family_contacts", "student_id", "students", "CASCADE"], ["family_journey", "student_id", "students", "CASCADE"], ["strategy_ai_drafts", "unit_id", "units", "SET NULL"], ["strategy_ai_drafts", "aprovado_por", "users", "SET NULL"], ["strategy_ai_drafts", "created_by", "users", "SET NULL"], ["students", "carteira_user_id", "users", "SET NULL"], ["students", "indicado_por_id", "students", "SET NULL"],
  ["rematricula_links", "student_id", "students", "CASCADE"], ["rematricula_links", "grade_id", "grades", "SET NULL"], ["rematricula_links", "unit_id", "units", "SET NULL"], ["rematricula_links", "class_id", "classes", "SET NULL"], ["rematricula_links", "integral_class_id", "classes", "SET NULL"], ["rematricula_links", "enrollment_id", "enrollments", "SET NULL"], ["rematricula_links", "integral_enrollment_id", "enrollments", "SET NULL"], ["rematricula_links", "contrato_id", "contract_templates", "SET NULL"], ["rematricula_links", "case_id", "cases", "SET NULL"],
  ["teacher_slots", "employee_id", "employees", "CASCADE"], ["teacher_slots", "unit_id", "units", "RESTRICT"], ["teacher_slots", "space_id", "spaces", "SET NULL"], ["cover_absences", "employee_id", "employees", "CASCADE"], ["cover_absences", "leave_request_id", "leave_requests", "SET NULL"], ["cover_assignments", "absence_id", "cover_absences", "CASCADE"], ["cover_assignments", "slot_id", "teacher_slots", "SET NULL"], ["cover_assignments", "ausente_employee_id", "employees", "CASCADE"], ["cover_assignments", "cobertura_employee_id", "employees", "SET NULL"], ["cover_assignments", "hour_entry_id", "hour_entries", "SET NULL"],
  ["spaces", "unit_id", "units", "RESTRICT"], ["classes", "space_id", "spaces", "SET NULL"], ["space_bookings", "space_id", "spaces", "CASCADE"], ["visits", "unit_id", "units", "RESTRICT"], ["pickup_authorizations", "student_id", "students", "CASCADE"], ["early_departures", "student_id", "students", "CASCADE"], ["early_departures", "authorization_id", "pickup_authorizations", "SET NULL"], ["early_departures", "emergency_event_id", "emergency_events", "SET NULL"], ["brigade_members", "employee_id", "employees", "CASCADE"], ["emergency_events", "unit_id", "units", "RESTRICT"], ["emergency_checks", "event_id", "emergency_events", "CASCADE"], ["emergency_failures", "event_id", "emergency_events", "CASCADE"], ["emergency_failures", "action_plan_id", "action_plans", "SET NULL"],
  ["consents", "student_id", "students", "CASCADE"], ["consents", "purpose_id", "consent_purposes", "RESTRICT"], ["privacy_requests", "student_id", "students", "SET NULL"], ["privacy_requests", "employee_id", "employees", "SET NULL"], ["ethics_messages", "report_id", "ethics_reports", "CASCADE"], ["requests", "type_id", "request_types", "RESTRICT"], ["request_events", "request_id", "requests", "CASCADE"], ["contracts", "supplier_id", "suppliers", "RESTRICT"], ["licenses", "unit_id", "units", "RESTRICT"], ["push_subscriptions", "user_id", "users", "CASCADE"],
  // tabela, coluna, tabela referenciada, ação
  ["employees", "unit_id", "units", "RESTRICT"], ["employees", "position_id", "positions", "SET NULL"], ["employees", "company_id", "companies", "SET NULL"], ["employees", "gestor_id", "employees", "SET NULL"],
  ["users", "unit_id", "units", "SET NULL"], ["password_resets", "user_id", "users", "CASCADE"], ["announcement_acks", "announcement_id", "announcements", "CASCADE"], ["announcement_acks", "user_id", "users", "CASCADE"], ["notifications", "user_id", "users", "CASCADE"], ["messages", "template_id", "message_templates", "SET NULL"], ["users", "employee_id", "employees", "SET NULL"],
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

/** Divide o SQL em instruções, sem quebrar em ';' dentro de aspas simples, blocos $$ ou comentários. */
export function dividirSql(texto: string): string[] {
  const out: string[] = []; let atual = ""; let aspas = false; let dolar = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (!aspas && !dolar && texto.startsWith("--", i)) { const fim = texto.indexOf("\n", i); const j = fim < 0 ? texto.length : fim; atual += texto.slice(i, j); i = j - 1; continue; }
    if (!aspas && texto.startsWith("$$", i)) { dolar = !dolar; atual += "$$"; i++; continue; }
    if (!dolar && ch === "'") { aspas = !aspas; atual += ch; continue; }
    if (!aspas && !dolar && ch === ";") { if (atual.replace(/--[^\n]*/g, "").trim()) out.push(atual.trim()); atual = ""; continue; }
    atual += ch;
  }
  if (atual.replace(/--[^\n]*/g, "").trim()) out.push(atual.trim());
  return out;
}
export type RelatorioMigracao = { versao: string; em: string; aplicadas: number; falhas: { sql: string; erro: string }[] };
/**
 * Aplica o esquema instrução por instrução: uma falha (ex.: dado antigo incompatível com um índice novo) não impede as demais,
 * e tudo fica registrado em settings.banco para o diagnóstico em Configurações → Banco de dados. Todas as instruções são idempotentes.
 */
export async function runMigrations(): Promise<RelatorioMigracao> {
  const r: RelatorioMigracao = { versao: SCHEMA_VERSION, em: new Date().toISOString(), aplicadas: 0, falhas: [] };
  const rodar = async (st: string) => { try { await sql.unsafe(st); r.aplicadas++; } catch (e) { r.falhas.push({ sql: st.replace(/\s+/g, " ").slice(0, 400), erro: e instanceof Error ? e.message : String(e) }); } };
  for (const st of dividirSql(MIGRATION_SQL)) await rodar(st);
  for (const [t, c, ref, acao] of FKS) {
    const nome = `fk_${t}_${c}`;
    await rodar(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${nome}') THEN
      IF NOT EXISTS (SELECT 1 FROM ${t} x LEFT JOIN ${ref} r ON r.id = x.${c} WHERE x.${c} IS NOT NULL AND r.id IS NULL) THEN
        ALTER TABLE ${t} ADD CONSTRAINT ${nome} FOREIGN KEY (${c}) REFERENCES ${ref}(id) ON DELETE ${acao};
      END IF; END IF; END $$`);
  }
  try { await sql`INSERT INTO settings (key, value) VALUES ('banco', ${JSON.stringify(r)}::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`; } catch { /* instalação muito antiga sem settings: o relatório volta na resposta */ }
  return r;
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
  log.push(...(await seedComunicacao()));
  log.push(...(await seedDesempenho()));
  log.push(...(await seedGestao()));
  log.push(...(await seedV22()));
  const [{ u }] = await sql`SELECT count(*)::int AS u FROM users`;
  if (u === 0) {
    const hash = await bcrypt.hash(adminPassword, 10);
    await sql`INSERT INTO users (email, nome, senha_hash, role) VALUES ('rh@colegiostatus', 'RH Colégio Status', ${hash}, 'RH')`;
    log.push("Usuário inicial: rh@colegiostatus (perfil RH). Troque a senha no primeiro acesso.");
  }
  return log;
}
