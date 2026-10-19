"""Dados de DEMONSTRAÇÃO para testes e capturas da v23 (ONE Insights) — NUNCA rode em produção.
Gera 24 meses de histórico fictício e coerente (pessoas, ponto, clima, desempenho, matrículas, NPS, casos, caixa, títulos,
orçamento, chamados, vistorias, OKRs, plano de ação, projetos, rituais, não conformidades, LGPD e aprovações) num banco de teste.
Uso: python3 scripts/demo_insights.py   (banco de teste local, via psql; tudo marcado como "Demo")."""
import random, subprocess, sys, json, hashlib
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

PSQL = ["su", "postgres", "-c"]
def psql(q):
    r = subprocess.run(PSQL + [f"/usr/lib/postgresql/16/bin/psql -h /tmp/pg -U status -d status_people -q -t -A -F'|' -c \"{q}\""], capture_output=True, text=True)
    return r.stdout.strip()
def rodar_sql(texto):
    r = subprocess.run(PSQL + ["/usr/lib/postgresql/16/bin/psql -h /tmp/pg -U status -d status_people -q -v ON_ERROR_STOP=1"], input=texto, capture_output=True, text=True)
    if r.returncode != 0: print(r.stderr[-3000:]); sys.exit(1)

if psql("SELECT count(*) FROM employees WHERE nome LIKE 'Demo %'") not in ("", "0"): print("Dados de demonstração já carregados."); sys.exit(0)
random.seed(23)
HOJE = datetime.now(ZoneInfo("America/Campo_Grande")).date()
INI = date(HOJE.year - 2, HOJE.month, 1)  # 24 meses completos + mês corrente
def meses(de, ate):
    y, m = de.year, de.month
    while (y, m) <= (ate.year, ate.month):
        yield date(y, m, 1); m += 1
        if m > 12: y, m = y + 1, 1
def fim_mes(d): return (date(d.year + (d.month == 12), d.month % 12 + 1, 1) - timedelta(days=1))
def q(v):
    if v is None: return "NULL"
    if isinstance(v, bool): return "true" if v else "false"
    if isinstance(v, (int, float)): return repr(round(v, 2)) if isinstance(v, float) else str(v)
    if isinstance(v, (date, datetime)): return f"'{v.isoformat(sep=' ') if isinstance(v, datetime) else v.isoformat()}'"
    return "'" + str(v).replace("'", "''") + "'"
OUT = ["BEGIN;"]
def insert(tabela, cols, linhas, retorno=None):
    for i in range(0, len(linhas), 800):
        lote = linhas[i:i + 800]
        OUT.append(f"INSERT INTO {tabela} ({', '.join(cols)}) VALUES " + ", ".join("(" + ", ".join(q(x) for x in l) + ")" for l in lote) + ";")
def rnd_data(a, b):
    if b <= a: return a
    return a + timedelta(days=random.randint(0, (b - a).days))
def rnd_ts(d, h0=8, h1=18): return datetime(d.year, d.month, d.day, random.randint(h0, h1 - 1), random.randint(0, 59))

UNITS = {c: int(psql(f"SELECT id FROM units WHERE codigo='{c}'")) for c in ["CAR", "TVM1", "TVM2", "CUL"]}
ANO = int(psql("SELECT coalesce((SELECT (value->>'anoLetivo')::int FROM settings WHERE key='matriculas'), 2027)") or 2027)
PESO = {"CAR": 0.25, "TVM1": 0.40, "TVM2": 0.20, "CUL": 0.15}
ADMIN = int(psql("SELECT id FROM users WHERE email='rh@colegiostatus'"))
PROF = int(psql("SELECT id FROM positions WHERE nome='Professor'"))
OUTROS_CARGOS = [int(x) for x in psql("SELECT id FROM positions WHERE nome <> 'Professor' ORDER BY id").split("\n") if x]
def unidade():
    r = random.random(); acc = 0
    for c, p in PESO.items():
        acc += p
        if r <= acc: return c
    return "CUL"

# ------------------------------------------------------------------ Pessoas
emps = []  # (idx, unidade, admissao, desligamento, regime, salario)
for i in range(1, 113):
    u = unidade(); regime = "DOCENTE" if random.random() < 0.5 else "ADMINISTRATIVO"
    adm = rnd_data(date(2011, 2, 1), HOJE - timedelta(days=20)) if random.random() < 0.7 else rnd_data(INI - timedelta(days=200), HOJE - timedelta(days=15))
    desl = None
    if random.random() < 0.2:
        d = rnd_data(max(adm + timedelta(days=90), INI), HOJE - timedelta(days=3))
        if d > adm + timedelta(days=60): desl = d
    sal = round(random.uniform(2600, 9800) if regime == "DOCENTE" else random.uniform(1900, 8800), 2)
    emps.append((i, u, adm, desl, regime, sal))
insert("employees", ["nome", "unit_id", "vinculo", "admissao", "desligamento", "motivo_desligamento", "situacao", "jornada_min_dia", "turno", "salario", "position_id", "regime", "data_nascimento", "email"],
       [(f"Demo Colaborador {i:03d}", UNITS[u], "CLT", adm, desl, "Pedido de demissão" if desl else None, "DESLIGADO" if desl else "ATIVO", 480, random.choice(["Matutino", "Vespertino", "Integral"]), sal, PROF if regime == "DOCENTE" else random.choice(OUTROS_CARGOS), regime, rnd_data(date(1964, 1, 1), date(2003, 12, 31)), f"demo{i:03d}@colegiostatus") for i, u, adm, desl, regime, sal in emps])
OUT.append("CREATE TEMP TABLE demo_emp AS SELECT id, (regexp_replace(nome, '\\D', '', 'g'))::int AS idx FROM employees WHERE nome LIKE 'Demo Colaborador %';")
def eid(i): return f"(SELECT id FROM demo_emp WHERE idx={i})"
# dissídio de março do ano corrente
hist = [(i, sal) for i, u, adm, desl, regime, sal in emps if adm < date(HOJE.year, 3, 1) and not desl]
for i, sal in hist: OUT.append(f"INSERT INTO salary_history (employee_id, data, salario_anterior, salario, motivo) VALUES ({eid(i)}, '{HOJE.year}-03-01', {round(sal / 1.055, 2)}, {sal}, 'Dissídio {HOJE.year}');")

# ponto: dias úteis dos últimos 13 meses
ponto = []; ini_ponto = date(HOJE.year - 1, HOJE.month, 1) - timedelta(days=31)
for i, u, adm, desl, regime, sal in emps:
    risco = random.choice([0.008, 0.012, 0.02, 0.03, 0.05])
    d = max(ini_ponto, adm)
    fim = min(HOJE - timedelta(days=1), desl - timedelta(days=1) if desl else HOJE)
    while d <= fim:
        if d.weekday() < 5:
            p = risco + (0.015 if d.weekday() == 0 else 0.01 if d.weekday() == 4 else 0) + (0.01 if d.month in (6, 7) else 0)
            r = random.random(); st = "FALTA" if r < p else "ATESTADO" if r < p + 0.01 else "NORMAL"
            ponto.append((i, d, 480, 0 if st != "NORMAL" else 480 + random.choice([0, 0, 0, 10, -5, 20]), st, "IMPORTACAO"))
        d += timedelta(days=1)
OUT.append("CREATE TEMP TABLE demo_ponto (idx int, data date, esperado int, trabalhado int, status text, origem text);")
insert("demo_ponto", ["idx", "data", "esperado", "trabalhado", "status", "origem"], ponto)
OUT.append("INSERT INTO timesheet_days (employee_id, data, esperado_min, trabalhado_min, status, origem) SELECT e.id, p.data, p.esperado, p.trabalhado, p.status, p.origem FROM demo_ponto p JOIN demo_emp e ON e.idx=p.idx ON CONFLICT DO NOTHING;")
# banco de horas
horas = []
for i, u, adm, desl, regime, sal in emps:
    for m in meses(max(INI, adm), HOJE):
        if desl and m > desl: break
        if random.random() < 0.35:
            for _ in range(random.randint(1, 3)): horas.append((i, rnd_data(m, min(fim_mes(m), HOJE)), random.choice([30, 60, 90, 120, 180]), "EXTRA", "APROVADO"))
        if random.random() < 0.25: horas.append((i, rnd_data(m, min(fim_mes(m), HOJE)), -random.choice([15, 30, 45, 60]), "ATRASO", "APROVADO"))
OUT.append("CREATE TEMP TABLE demo_horas (idx int, data date, minutos int, tipo text, status text);")
insert("demo_horas", ["idx", "data", "minutos", "tipo", "status"], horas)
OUT.append(f"INSERT INTO hour_entries (employee_id, data, minutos, tipo, status, descricao, lancado_por) SELECT e.id, h.data, h.minutos, h.tipo, h.status, 'Demo', {ADMIN} FROM demo_horas h JOIN demo_emp e ON e.idx=h.idx;")
# férias, folgas e afastamentos (últimos 12 meses e próximos 3)
ativos_demo = [e for e in emps if not e[3]]
for k in range(70):
    e = random.choice(ativos_demo); tipo = random.choices(["FERIAS", "FOLGA_BANCO", "AFASTAMENTO_SAUDE", "LICENCA"], [60, 25, 10, 5])[0]
    ini = rnd_data(HOJE - timedelta(days=330), HOJE + timedelta(days=80)); dur = {"FERIAS": random.choice([10, 15, 20, 30]), "FOLGA_BANCO": 1, "AFASTAMENTO_SAUDE": random.randint(2, 15), "LICENCA": random.randint(5, 20)}[tipo]
    fim = ini + timedelta(days=dur - 1); st = "SOLICITADA" if ini > HOJE and random.random() < 0.35 else "APROVADA"
    OUT.append(f"INSERT INTO leave_requests (employee_id, tipo, inicio, fim, dias, status, solicitado_por, aprovado_por, decidido_em, created_at) VALUES ({eid(e[0])}, '{tipo}', '{ini}', '{fim}', {dur}, '{st}', {ADMIN}, {ADMIN if st == 'APROVADA' else 'NULL'}, {q(rnd_ts(ini - timedelta(days=10)) if st == 'APROVADA' else None)}, '{ini - timedelta(days=20)}');")
# clima: três pesquisas encerradas
for k, (fim, prom, detr) in enumerate([(date(HOJE.year - 1, 5, 29), 0.42, 0.24), (date(HOJE.year - 1, 11, 27), 0.47, 0.2), (date(HOJE.year, 5, 28), 0.53, 0.16)]):
    if fim > HOJE: continue
    tok = hashlib.md5(f"clima{k}".encode()).hexdigest()
    OUT.append(f"INSERT INTO climate_surveys (nome, tipo, inicio, fim, status, perguntas, token, minimo_anonimato) VALUES ('Demo Clima {fim:%m/%Y}', 'CLIMA', '{fim - timedelta(days=14)}', '{fim}', 'ENCERRADA', '[]'::jsonb, '{tok}', 5);")
    resp = []
    for c in UNITS:
        for _ in range(int(80 * PESO[c]) + random.randint(-2, 3)):
            r = random.random(); n = random.choice([9, 10]) if r < prom else random.choice([0, 3, 5, 6]) if r < prom + detr else random.choice([7, 8])
            resp.append((c, n))
    for c, n in resp: OUT.append(f"INSERT INTO climate_responses (survey_id, unit_id, regime, respostas, at) VALUES ((SELECT id FROM climate_surveys WHERE token='{tok}'), {UNITS[c]}, NULL, '{json.dumps({'enps': n})}'::jsonb, '{fim}');")
# desempenho: ciclo encerrado em dezembro do ano anterior
OUT.append(f"INSERT INTO perf_cycles (nome, inicio, fim, status, competencias) VALUES ('Demo Ciclo {HOJE.year - 1}', '{HOJE.year - 1}-08-01', '{HOJE.year - 1}-12-12', 'ENCERRADO', '[]'::jsonb);")
for i, u, adm, desl, regime, sal in emps:
    if adm < date(HOJE.year - 1, 6, 1) and (not desl or desl > date(HOJE.year - 1, 12, 12)):
        OUT.append(f"INSERT INTO perf_reviews (cycle_id, employee_id, status, nota_final) VALUES ((SELECT id FROM perf_cycles WHERE nome='Demo Ciclo {HOJE.year - 1}'), {eid(i)}, 'CONCLUIDA', {round(random.triangular(2.4, 4.9, 3.8), 2)});")
# recrutamento
for k in range(18):
    ab = rnd_data(INI, HOJE - timedelta(days=10)); preenchida = random.random() < 0.75 and ab < HOJE - timedelta(days=40)
    fe = ab + timedelta(days=random.randint(18, 70)) if preenchida else None
    if fe and fe > HOJE: fe = None; preenchida = False
    OUT.append(f"INSERT INTO requisitions (titulo, unit_id, quantidade, status, aberta_em, fechada_em, position_id, tipo) VALUES ('Demo Vaga {k + 1}', {UNITS[unidade()]}, {random.choice([1, 1, 1, 2])}, '{'PREENCHIDA' if preenchida else 'ABERTA'}', '{ab}', {q(fe)}, {PROF if random.random() < 0.5 else random.choice(OUTROS_CARGOS)}, 'NOVA');")
# substituição de professores (últimos 6 meses)
docentes = [e for e in emps if e[4] == "DOCENTE" and not e[3]]
for m in meses(date(HOJE.year, HOJE.month, 1) - timedelta(days=170), HOJE):
    for _ in range(18):
        e = random.choice(docentes); d = rnd_data(m, min(fim_mes(m), HOJE))
        if d.weekday() >= 5: continue
        OUT.append(f"INSERT INTO cover_absences (employee_id, unit_id, data, motivo, status, registrado_por) VALUES ({eid(e[0])}, {UNITS[e[1]]}, '{d}', '{random.choice(['FALTA', 'ATESTADO', 'FORMACAO', 'OUTRO'])}', 'ATIVA', {ADMIN}) ON CONFLICT DO NOTHING;")
        for a in range(random.randint(2, 4)):
            r = random.random(); passado = d < HOJE
            st, sol = ("REALIZADA", None) if passado and r < 0.68 else ("SEM_PROFESSOR", random.choice(["ATIVIDADE_ORIENTADA", "JUNCAO", "DISPENSA"])) if r < 0.85 else ("CANCELADA", None) if r < 0.9 else ("CONFIRMADA", None)
            cob = random.choice(docentes)
            OUT.append(f"INSERT INTO cover_assignments (absence_id, data, unit_id, turma, inicio, fim, turno, ausente_employee_id, cobertura_employee_id, status, solucao, minutos) SELECT id, data, unit_id, 'Turma {a + 1}', '{7 + a}:00', '{7 + a}:50', 'Matutino', employee_id, {eid(cob[0]) if st in ('REALIZADA', 'CONFIRMADA') else 'NULL'}, '{st}', {q(sol)}, 50 FROM cover_absences WHERE employee_id={eid(e[0])} AND data='{d}' AND status='ATIVA';")

# ------------------------------------------------------------------ Matrículas e famílias
ALUNOS = {"CAR": 330, "TVM1": 700, "TVM2": 240, "CUL": 150}
GRADES = [int(x) for x in psql("SELECT id FROM grades ORDER BY ordem").split("\n") if x]
alunos = []
for c, n in ALUNOS.items():
    for k in range(n): alunos.append((c, f"Demo Aluno {c} {k + 1:04d}", random.choice(GRADES[:-1]), random.uniform(1150, 2350)))
insert("students", ["nome", "aluno_atual", "unit_atual_id", "serie_atual_id", "responsavel", "telefone", "origem", "created_at"],
       [(nome, True, UNITS[c], g, f"Responsável de {nome}", "6799" + str(random.randint(1000000, 9999999)), "REMATRICULA", datetime(2024, 1, 15, 9, 0)) for c, nome, g, v in alunos])
# candidatos de captação (sazonais: pico de agosto a novembro)
cands = []
for m in meses(INI, HOJE):
    n = {8: 70, 9: 85, 10: 80, 11: 60, 12: 35, 1: 40, 2: 25}.get(m.month, 18) + random.randint(-5, 5)
    for k in range(n):
        d = rnd_data(m, min(fim_mes(m), HOJE)); cands.append((f"Demo Candidato {m:%Y%m}-{k + 1:03d}", random.choice(["SITE", "INDICACAO", "REDES", "VISITA", "OUTRO", "INDICACAO", "SITE"]), rnd_ts(d), random.choice(list(UNITS))))
insert("students", ["nome", "aluno_atual", "responsavel", "telefone", "origem", "created_at"], [(n, False, f"Responsável de {n}", "6798" + str(random.randint(1000000, 9999999)), o, ts) for n, o, ts, c in cands])
OUT.append(f"CREATE TEMP TABLE demo_turmas AS SELECT c.id, c.unit_id, row_number() OVER (PARTITION BY c.unit_id ORDER BY c.id) AS k, count(*) OVER (PARTITION BY c.unit_id) AS n FROM classes c WHERE c.ano={ANO} AND c.modalidade='REGULAR';")
camp = date(HOJE.year, 8, 20) if HOJE >= date(HOJE.year, 9, 1) else HOJE - timedelta(days=45)
OUT.append("CREATE TEMP TABLE demo_mat (nome text, criado timestamp, status text, confirmada timestamp, reserva date, atualizado timestamp);")
mats = []
for c, nome, g, v in alunos:
    if random.random() < 0.74:
        cr = rnd_ts(rnd_data(camp, HOJE)); r = random.random()
        if r < 0.80: conf = cr + timedelta(days=random.randint(0, 9), hours=random.randint(0, 5)); st = "CONFIRMADA"
        else: conf = None; st = "RESERVADA"
        if conf and conf.date() > HOJE: conf = None; st = "RESERVADA"
        res = (cr + timedelta(days=30)).date()
        if st == "RESERVADA" and res < HOJE: st = "EXPIRADA"
        if random.random() < 0.025: st = "CANCELADA"
        mats.append((nome, cr, st, conf, res, cr + timedelta(days=random.randint(1, 20)) if st == "CANCELADA" else cr))
for n, o, ts, c in cands:
    if ts.date() >= HOJE - timedelta(days=170) and random.random() < 0.32:
        cr = ts + timedelta(days=random.randint(3, 35))
        if cr.date() > HOJE: continue
        st = "CONFIRMADA" if random.random() < 0.72 else "RESERVADA"; conf = cr + timedelta(days=random.randint(0, 6)) if st == "CONFIRMADA" else None
        if conf and conf.date() > HOJE: conf = None; st = "RESERVADA"
        res = (cr + timedelta(days=3)).date()
        if st == "RESERVADA" and res < HOJE: st = "EXPIRADA"
        mats.append((n, cr, st, conf, res, cr))
insert("demo_mat", ["nome", "criado", "status", "confirmada", "reserva"], [(a, b, c, d, e) for a, b, c, d, e, f in mats])
OUT.append(f"""INSERT INTO enrollments (student_id, class_id, ano, modalidade, status, reserva_ate, contrato_assinado, financeiro_ok, confirmada_em, created_at, updated_at)
  SELECT st.id, t.id, {ANO}, 'REGULAR', dm.status, dm.reserva, dm.status='CONFIRMADA', dm.status='CONFIRMADA', dm.confirmada, dm.criado, coalesce(dm.confirmada, dm.criado)
  FROM demo_mat dm JOIN students st ON st.nome=dm.nome JOIN LATERAL (SELECT id FROM demo_turmas t WHERE t.unit_id=coalesce(st.unit_atual_id, (SELECT u.id FROM units u ORDER BY md5(st.nome) LIMIT 1)) AND t.k = 1 + (abs(hashtext(st.nome)) % t.n)) t ON true;""")
OUT.append("UPDATE enrollments SET updated_at = created_at + interval '9 days' WHERE status='CANCELADA' AND student_id IN (SELECT id FROM students WHERE nome LIKE 'Demo %');")
# lista de espera
for n, o, ts, c in cands[-40:-15]:
    OUT.append(f"INSERT INTO waitlist (student_id, ano, unit_id, grade_id, turno, modalidade, status, created_at) SELECT id, {ANO}, {UNITS[c]}, {random.choice(GRADES)}, NULL, 'REGULAR', 'AGUARDANDO', '{ts}' FROM students WHERE nome={q(n)} AND NOT EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id=students.id);")
# NPS das famílias (melhora ao longo do tempo)
nps = []
for idx, m in enumerate(meses(INI, HOJE)):
    t = idx / 24
    for c in UNITS:
        for _ in range(int(70 * PESO[c]) + random.randint(-3, 3)):
            r = random.random(); prom = 0.5 + 0.13 * t + (0.04 if c == "CAR" else -0.03 if c == "CUL" else 0); detr = 0.17 - 0.07 * t
            n = random.choice([9, 10]) if r < prom else random.choice([2, 4, 5, 6]) if r < prom + detr else random.choice([7, 8])
            nps.append(("NPS", n, UNITS[c], rnd_data(m, min(fim_mes(m), HOJE)), random.choice(["WHATSAPP", "EMAIL", "PORTAL"]), True))
insert("surveys", ["tipo", "nota", "unit_id", "data", "canal", "anonimo"], nps)
# casos de atendimento
SLA = {"URGENTE": 4, "ALTA": 24, "NORMAL": 48, "BAIXA": 120}
casos = []
for m in meses(INI, HOJE):
    for _ in range(32 + random.randint(-6, 8)):
        c = unidade(); tipo = random.choices(["RECLAMACAO", "SOLICITACAO", "DUVIDA", "ELOGIO", "FINANCEIRO", "PEDAGOGICO", "SAIDA"], [24, 26, 18, 8, 10, 9, 5])[0]
        pr = random.choices(list(SLA), [5, 20, 60, 15])[0]; cr = rnd_ts(rnd_data(m, min(fim_mes(m), HOJE)))
        sla = cr + timedelta(hours=SLA[pr]); fechado = cr + timedelta(hours=random.choice([2, 6, 20, 30, 44, 60, 90, 130])) if random.random() < 0.9 else None
        if fechado and fechado.date() > HOJE: fechado = None
        res = ("RETIDO" if random.random() < 0.46 else "PERDIDO") if tipo == "SAIDA" and fechado else None
        casos.append((None, UNITS[c], tipo, "Atendimento e comunicação", f"Demo caso {tipo.lower()}", "FECHADO" if fechado else "EM_ATENDIMENTO", pr, sla, cr, fechado, fechado, res, cr))
insert("cases", ["student_id", "unit_id", "tipo", "categoria", "assunto", "status", "prioridade", "sla_ate", "created_at", "resolvido_em", "fechado_em", "resultado", "updated_at"], casos)

# ------------------------------------------------------------------ Financeiro
ENT = ["Mensalidades", "Material e taxas", "Integral", "Eventos", "Outras receitas"]
SAI = ["Pessoal", "Encargos e benefícios", "Aluguel e condomínio", "Serviços e terceiros", "Materiais e insumos", "Manutenção", "Marketing", "Impostos e taxas", "Financeiras", "Outras despesas"]
caixa = []; saldo = {c: 280000.0 + 60000 * PESO[c] * 10 for c in UNITS}; saldos = []
func = {c: sum(1 for e in emps if e[1] == c) for c in UNITS}
for m in meses(INI, HOJE):
    ate = min(fim_mes(m), HOJE); parcial = (ate - m).days + 1; fr = parcial / ((fim_mes(m) - m).days + 1)
    for c in UNITS:
        saldos.append((UNITS[c], f"{m:%Y-%m}", round(saldo[c], 2)))
        reaj = 1.07 if m.year >= HOJE.year else 1.0
        rec = {"Mensalidades": ALUNOS[c] * 1520 * reaj * random.uniform(0.91, 0.97), "Material e taxas": ALUNOS[c] * (420 if m.month in (1, 2) else 25) * random.uniform(0.8, 1.1),
               "Integral": ALUNOS[c] * 0.12 * 950 * random.uniform(0.9, 1.05), "Eventos": ALUNOS[c] * (60 if m.month in (6, 11) else 3), "Outras receitas": random.uniform(1500, 6000)}
        pessoal = func[c] * 9300 * reaj * (2 if m.month == 12 else 1) * random.uniform(0.97, 1.03)
        des = {"Pessoal": pessoal, "Encargos e benefícios": pessoal * 0.35, "Aluguel e condomínio": {"CAR": 42000, "TVM1": 61000, "TVM2": 30000, "CUL": 24000}[c], "Serviços e terceiros": ALUNOS[c] * 55 * random.uniform(0.9, 1.15),
               "Materiais e insumos": ALUNOS[c] * (160 if m.month in (1, 2) else 38) * random.uniform(0.85, 1.15), "Manutenção": random.uniform(4000, 16000) * PESO[c] * 4, "Marketing": (28000 if m.month in (8, 9, 10) else 9000) * PESO[c] * random.uniform(0.8, 1.2),
               "Impostos e taxas": 0, "Financeiras": random.uniform(800, 3000), "Outras despesas": random.uniform(2000, 9000)}
        des["Impostos e taxas"] = sum(rec.values()) * 0.058
        for tipo, itens in (("ENTRADA", rec), ("SAIDA", des)):
            for cat, v in itens.items():
                val = round(v * fr, 2)
                if val <= 0: continue
                d = rnd_data(m, ate); h = hashlib.md5(f"{c}{m}{tipo}{cat}".encode()).hexdigest()
                caixa.append((UNITS[c], d, tipo, cat, "PIX" if tipo == "ENTRADA" else "TED", f"Demo {cat}", val, h))
                saldo[c] += val if tipo == "ENTRADA" else -val
insert("cash_entries", ["unit_id", "data", "tipo", "categoria", "forma", "descricao", "valor", "hash"], caixa)
insert("cash_balances", ["unit_id", "mes", "saldo_inicial"], saldos)
# orçamento do ano corrente (valor mensal fixo + meses especiais)
orc = []
for c in UNITS:
    base_ent = {"Mensalidades": ALUNOS[c] * 1520 * 1.07 * 0.95, "Material e taxas": ALUNOS[c] * 60, "Integral": ALUNOS[c] * 0.12 * 950, "Eventos": ALUNOS[c] * 12, "Outras receitas": 3500}
    pessoal = func[c] * 9300 * 1.07
    base_sai = {"Pessoal": pessoal, "Encargos e benefícios": pessoal * 0.35, "Aluguel e condomínio": {"CAR": 42000, "TVM1": 61000, "TVM2": 30000, "CUL": 24000}[c], "Serviços e terceiros": ALUNOS[c] * 52, "Materiais e insumos": ALUNOS[c] * 55,
                "Manutenção": 9000 * PESO[c] * 4, "Marketing": 13000 * PESO[c], "Impostos e taxas": sum(base_ent.values()) * 0.058, "Financeiras": 1800, "Outras despesas": 5000}
    for tipo, itens in (("ENTRADA", base_ent), ("SAIDA", base_sai)):
        for cat, v in itens.items(): orc.append((HOJE.year, UNITS[c], tipo, cat, round(v, 2)))
    for mes, cat, v in ((1, "Material e taxas", ALUNOS[c] * 400), (2, "Material e taxas", ALUNOS[c] * 380), (12, "Pessoal", pessoal * 2), (8, "Marketing", 30000 * PESO[c]), (9, "Marketing", 30000 * PESO[c])):
        OUT.append(f"INSERT INTO budget_months (ano, unit_id, tipo, categoria, mes, valor) VALUES ({HOJE.year}, {UNITS[c]}, '{'ENTRADA' if cat == 'Material e taxas' else 'SAIDA'}', '{cat}', {mes}, {round(v, 2)});")
insert("budgets", ["ano", "unit_id", "tipo", "categoria", "valor_mensal"], orc)
# títulos (mensalidades) dos alunos atuais: 24 meses
OUT.append("CREATE TEMP TABLE demo_tit (nome text, unit_id int, comp text, venc date, valor numeric, pago date, status text);")
tits = []
for c, nome, g, v in alunos:
    perfil = random.random()
    for m in meses(INI, HOJE + timedelta(days=92)):  # inclui os boletos já emitidos dos próximos 3 meses
        venc = date(m.year, m.month, 10); val = round(v * (1.07 if m.year >= HOJE.year else 1), 2)
        if venc > HOJE: tits.append((nome, UNITS[c], f"{m:%Y-%m}", venc, val, None, "ABERTO")); continue
        atraso = (HOJE - venc).days
        if perfil < 0.84: pago = venc - timedelta(days=random.randint(0, 6))
        elif perfil < 0.95: pago = venc + timedelta(days=random.randint(3, 45)) if random.random() < 0.6 else venc - timedelta(days=random.randint(0, 3))
        else: pago = None if random.random() < 0.4 else venc + timedelta(days=random.randint(10, 90))
        if pago and pago > HOJE: pago = None
        if pago is None and atraso < 0: pago = None
        tits.append((nome, UNITS[c], f"{m:%Y-%m}", venc, val, pago, "PAGO" if pago else "ABERTO"))
insert("demo_tit", ["nome", "unit_id", "comp", "venc", "valor", "pago", "status"], tits)
OUT.append("INSERT INTO receivables (student_id, aluno_nome, responsavel, unit_id, tipo, competencia, vencimento, valor, valor_pago, pago_em, status, importado_em) SELECT st.id, t.nome, 'Responsável de ' || t.nome, t.unit_id, 'MENSALIDADE', t.comp, t.venc, t.valor, CASE WHEN t.status='PAGO' THEN t.valor END, t.pago, t.status, now() FROM demo_tit t JOIN students st ON st.nome=t.nome;")
# acordos de cobrança
for k in range(24):
    d = rnd_data(INI + timedelta(days=150), HOJE - timedelta(days=20)); c = unidade(); val = round(random.uniform(1800, 9000), 2); n = random.randint(3, 6)
    OUT.append(f"INSERT INTO agreements (aluno_nome, unit_id, valor_original, valor_acordado, parcelas, primeira_parcela, status, created_by, created_at) VALUES ('Demo Acordo {k + 1}', {UNITS[c]}, {val}, {round(val * 0.95, 2)}, {n}, '{d + timedelta(days=10)}', 'ATIVO', {ADMIN}, '{d}');")
    for p in range(n):
        venc = d + timedelta(days=10 + 30 * p); pago = venc + timedelta(days=random.randint(-3, 8)) if venc <= HOJE and random.random() < 0.85 else None
        if pago and pago > HOJE: pago = None
        OUT.append(f"INSERT INTO agreement_installments (agreement_id, numero, vencimento, valor, pago_em) VALUES ((SELECT id FROM agreements WHERE aluno_nome='Demo Acordo {k + 1}'), {p + 1}, '{venc}', {round(val * 0.95 / n, 2)}, {q(pago)});")

# ------------------------------------------------------------------ Operações
H_SLA = {"URGENTE": 4, "ALTA": 24, "NORMAL": 72, "BAIXA": 240}
ordens = []
for m in meses(INI, HOJE):
    for _ in range(40 + random.randint(-8, 10)):
        c = unidade(); pr = random.choices(list(H_SLA), [6, 22, 57, 15])[0]; cr = rnd_ts(rnd_data(m, min(fim_mes(m), HOJE)))
        sla = cr + timedelta(hours=H_SLA[pr]); r = random.random()
        dur = timedelta(hours=H_SLA[pr] * (random.uniform(0.2, 0.95) if r < 0.8 else random.uniform(1.1, 3)))
        conc = cr + dur if random.random() < 0.93 else None
        if conc and conc.date() >= HOJE: conc = None
        st = "CONCLUIDO" if conc else random.choice(["ABERTO", "EM_EXECUCAO", "AGUARDANDO"])
        if random.random() < 0.03: st, conc = "CANCELADO", None
        ordens.append((random.choice(["CORRETIVA", "PREVENTIVA", "TI", "LIMPEZA", "MELHORIA", "SEGURANCA"]), "Demo chamado", UNITS[c], pr, st, sla, cr, conc, round(random.uniform(0, 1800), 2) if conc and random.random() < 0.45 else None, cr))
insert("work_orders", ["tipo", "titulo", "unit_id", "prioridade", "status", "sla_ate", "created_at", "concluido_em", "custo_real", "updated_at"], ordens)
vist = []
for m in meses(INI, HOJE):
    for _ in range(7):
        c = unidade(); total = random.randint(7, 10); vist.append((UNITS[c], random.choice(["Sala de aula", "Banheiro", "Pátio e áreas externas", "Cozinha e refeitório", "Segurança predial"]), "ROTINA", rnd_data(m, min(fim_mes(m), HOJE)), "[]", total - random.choice([0, 0, 1, 1, 2, 3]), total))
OUT.append("CREATE TEMP TABLE demo_vist (unit_id int, ambiente text, tipo text, data date, itens text, conformes int, total int);")
insert("demo_vist", ["unit_id", "ambiente", "tipo", "data", "itens", "conformes", "total"], vist)
OUT.append(f"INSERT INTO inspections (unit_id, ambiente, tipo, data, itens, conformes, total, inspetor_user_id) SELECT unit_id, ambiente, tipo, data, itens::jsonb, conformes, total, {ADMIN} FROM demo_vist;")

# ------------------------------------------------------------------ Estratégia e governança
OUT.append(f"UPDATE objectives SET created_at='{HOJE.year}-01-20 10:00' WHERE created_at > '{HOJE.year}-01-20';")
for kr in [x for x in psql("SELECT id || ':' || valor_inicial || ':' || valor_meta FROM key_results").split("\n") if x]:
    kid, vi, vm = kr.split(":"); vi, vm = float(vi), float(vm); alvo = random.uniform(0.35, 0.95)
    for idx, m in enumerate(meses(date(HOJE.year, 2, 1), HOJE)):
        d = min(date(m.year, m.month, 25), HOJE - timedelta(days=1))
        if d < m: continue
        frac = min(1, alvo * (idx + 1) / max(1, HOJE.month - 1)) * random.uniform(0.85, 1.1)
        OUT.append(f"INSERT INTO kr_checkins (key_result_id, data, valor, confianca, comentario, user_id, user_nome) VALUES ({kid}, '{d}', {round(vi + (vm - vi) * frac, 1)}, {random.choice([1, 2, 2, 3])}, 'Demo check-in', {ADMIN}, 'RH Colégio Status');")
acoes = []
for k in range(95):
    cr = rnd_ts(rnd_data(INI + timedelta(days=120), HOJE - timedelta(days=2))); prazo = (cr + timedelta(days=random.randint(12, 60))).date(); r = random.random()
    if (HOJE - cr.date()).days > 75 and r >= 0.68 and random.random() < 0.85: r = random.uniform(0, 0.68)  # ação antiga quase sempre já foi concluída
    conc = rnd_data(cr.date() + timedelta(days=3), prazo + timedelta(days=random.choice([0, 0, 5, 20]))) if r < 0.68 else None
    if conc and conc > HOJE: conc = None
    st = "CONCLUIDA" if conc else "BLOQUEADA" if r > 0.94 else "EM_ANDAMENTO" if r > 0.8 else "A_FAZER"
    if random.random() < 0.03: st, conc = "CANCELADA", None
    acoes.append((f"Demo ação {k + 1}", random.choice([None, *UNITS.values()]), cr.date(), prazo, ADMIN, st, conc, "Aguardando fornecedor" if st == "BLOQUEADA" else None, (HOJE - timedelta(days=9)) if st == "BLOQUEADA" else None, cr, ADMIN, "MANUAL"))
insert("action_plans", ["titulo", "unit_id", "inicio", "prazo", "responsavel_user_id", "status", "concluida_em", "bloqueio", "bloqueio_desde", "created_at", "created_by", "origem"], acoes)
for k, (nome, st, saude) in enumerate([("Demo Novo site e captação digital", "EM_ANDAMENTO", "VERDE"), ("Demo Reforma do pátio TVM1", "EM_ANDAMENTO", "AMARELO"), ("Demo Implantação do ONE", "EM_ANDAMENTO", "VERDE"), ("Demo Programa de formação docente", "PLANEJADO", "VERDE"), ("Demo Laboratório maker", "EM_ANDAMENTO", "VERMELHO"), ("Demo Revisão de contratos", "CONCLUIDO", "VERDE")]):
    ini = rnd_data(INI + timedelta(days=200), HOJE - timedelta(days=150)); fim = ini + timedelta(days=random.randint(150, 330))
    OUT.append(f"INSERT INTO projects (nome, status, prioridade, saude, inicio, fim, owner_user_id, unit_id, objective_id, orcamento, gasto) VALUES ('{nome}', '{st}', '{random.choice(['ALTA', 'MEDIA', 'BAIXA'])}', '{saude}', '{ini}', '{fim}', {ADMIN}, {random.choice(['NULL', *map(str, UNITS.values())])}, (SELECT min(id) FROM objectives), {random.randint(20, 120) * 1000}, {random.randint(5, 90) * 1000});")
    for j in range(random.randint(4, 6)):
        pz = ini + timedelta(days=int((fim - ini).days * (j + 1) / 6)); conc = pz + timedelta(days=random.choice([-10, -3, 0, 4, 12, 25])) if pz < HOJE and random.random() < 0.85 else None
        if conc and conc > HOJE: conc = None
        OUT.append(f"INSERT INTO milestones (project_id, titulo, prazo, responsavel_user_id, concluido_em, ordem) VALUES ((SELECT id FROM projects WHERE nome='{nome}'), 'Marco {j + 1}', '{pz}', {ADMIN}, {q(conc)}, {j});")
for nome, tipo, u in [("Demo Comitê mensal da rede", "MENSAL", None), ("Demo Coordenação semanal Carandá", "SEMANAL", UNITS["CAR"]), ("Demo Coordenação semanal TV Morena I", "SEMANAL", UNITS["TVM1"])]:
    OUT.append(f"INSERT INTO rituals (nome, tipo, unit_id, dono_user_id, ativo, proxima_data, created_by, created_at) VALUES ('{nome}', '{tipo}', {q(u)}, {ADMIN}, true, '{HOJE + timedelta(days=5)}', {ADMIN}, '{INI}');")
    passo = 30 if tipo == "MENSAL" else 7; d = INI + timedelta(days=12)
    while d < HOJE:
        if random.random() < 0.88: OUT.append(f"INSERT INTO ritual_meetings (ritual_id, data, status, ata, created_by) VALUES ((SELECT id FROM rituals WHERE nome='{nome}'), '{d}', 'REALIZADA', 'Demo ata', {ADMIN});")
        d += timedelta(days=passo)
for m in meses(INI, HOJE):
    for semana in (3, 10, 17, 24):
        d = date(m.year, m.month, semana)
        if d > HOJE: continue
        t = (d - INI).days / 730
        for c, u in [(None, None), *UNITS.items()]:
            OUT.append(f"INSERT INTO health_snapshots (data, unit_id, geral, scores) VALUES ('{d}', {q(u)}, {int(62 + 14 * t + random.randint(-5, 5) + (4 if c == 'CAR' else -3 if c == 'CUL' else 0))}, '{{}}'::jsonb) ON CONFLICT DO NOTHING;")
for k in range(34):
    cr = rnd_ts(rnd_data(INI + timedelta(days=60), HOJE - timedelta(days=5))); prazo = (cr + timedelta(days=30)).date(); enc = cr + timedelta(days=random.randint(7, 55)) if random.random() < 0.72 else None
    if enc and enc.date() > HOJE: enc = None
    OUT.append(f"INSERT INTO nonconformities (titulo, origem, unit_id, gravidade, responsavel_user_id, prazo, status, encerrada_em, created_by, created_at) VALUES ('Demo NC {k + 1}', '{random.choice(['CONTROLE', 'RECLAMACAO', 'AUDITORIA'])}', {random.choice(list(UNITS.values()))}, {random.randint(1, 3)}, {ADMIN}, '{prazo}', '{'ENCERRADA' if enc else 'EM_TRATAMENTO'}', {q(enc)}, {ADMIN}, '{cr}');")
for k in range(40):
    cr = rnd_ts(rnd_data(INI, HOJE - timedelta(days=2))); dec = cr + timedelta(hours=random.randint(2, 60)); st = random.choices(["APROVADA", "REJEITADA", "EXPIRADA"], [65, 25, 10])[0]
    if dec.date() > HOJE: dec = cr
    OUT.append(f"INSERT INTO exceptions (regra, motivo, descricao, unit_id, solicitante_user_id, aprovador_user_id, status, decidido_em, created_at) VALUES ('Demo regra', 'Caso excepcional da família', 'Demo', {random.choice(list(UNITS.values()))}, {ADMIN}, {ADMIN}, '{st}', '{dec}', '{cr}');")
for k in range(12):
    cr = rnd_ts(rnd_data(HOJE - timedelta(days=330), HOJE - timedelta(days=4))); prazo = (cr + timedelta(days=15)).date(); resp = cr + timedelta(days=random.choice([3, 6, 9, 12, 14, 18])) if random.random() < 0.85 else None
    if resp and resp.date() > HOJE: resp = None
    OUT.append(f"INSERT INTO privacy_requests (protocolo, tipo, titular_nome, titular_tipo, status, prazo, respondida_em, created_at) VALUES ('DEMO-{k + 1:04d}', 'CONFIRMACAO_ACESSO', 'Demo Titular', 'RESPONSAVEL', '{'CONCLUIDO' if resp else 'EM_ANALISE'}', '{prazo}', {q(resp)}, '{cr}');")
tipos = [(x.split(":")[0], int(x.split(":")[1]), int(x.split(":")[2])) for x in psql("SELECT id || ':' || prazo_dias || ':' || jsonb_array_length(etapas) FROM request_types").split("\n") if x]
for k in range(90):
    tid, pz, n = random.choice(tipos); cr = rnd_ts(rnd_data(HOJE - timedelta(days=360), HOJE - timedelta(days=1))); num = f"DEMO-{k + 1:05d}"
    OUT.append(f"INSERT INTO requests (numero, type_id, titulo, dados, valor, unit_id, solicitante_user_id, solicitante_nome, status, etapa_atual, etapas, prazo_etapa, created_at, updated_at) VALUES ('{num}', {tid}, 'Demo solicitação {k + 1}', '{{}}'::jsonb, {round(random.uniform(80, 3000), 2)}, {random.choice(list(UNITS.values()))}, {ADMIN}, 'RH Colégio Status', 'EM_APROVACAO', 0, '[]'::jsonb, '{(cr + timedelta(days=pz)).date()}', '{cr}', '{cr}');")
    OUT.append(f"INSERT INTO request_events (request_id, etapa, tipo, texto, user_id, user_nome, created_at) VALUES ((SELECT id FROM requests WHERE numero='{num}'), 0, 'CRIADA', 'Demo', {ADMIN}, 'RH Colégio Status', '{cr}');")
    t = cr; final = "EM_APROVACAO"
    for e in range(n):
        t = t + timedelta(days=random.choice([0, 1, 1, 2, 3, 4, 6]), hours=random.randint(1, 6))
        if t.date() >= HOJE: break
        dec = "APROVADA" if random.random() < 0.9 else "REJEITADA"
        OUT.append(f"INSERT INTO request_events (request_id, etapa, tipo, texto, user_id, user_nome, created_at) VALUES ((SELECT id FROM requests WHERE numero='{num}'), {e}, '{dec}', 'Demo', {ADMIN}, 'RH Colégio Status', '{t}');")
        if dec == "REJEITADA": final = "REJEITADA"; break
        if e == n - 1: final = "APROVADA"
    OUT.append(f"UPDATE requests SET status='{final}', concluida_em={q(t) if final != 'EM_APROVACAO' else 'NULL'}, updated_at='{t}' WHERE numero='{num}';")
# mural de reconhecimento (12 meses): recados entre colegas da mesma unidade, ligados aos valores da escola
VALORES = [v for v in psql("SELECT string_agg(t.x->>'nome', '|' ORDER BY t.o) FROM (SELECT valores FROM strategy_identity ORDER BY (status='VIGENTE') DESC, versao DESC LIMIT 1) s, jsonb_array_elements(s.valores) WITH ORDINALITY AS t(x, o)").split("|") if v]
ATIVOS = [(i, u) for i, u, adm, desl, regime, sal in emps if not desl]
FEITOS = ["cobriu a turma do 5º ano em cima da hora e ainda preparou uma atividade que as crianças adoraram", "organizou a feira de ciências com as famílias e deixou tudo pronto antes do horário",
          "acolheu uma família nova com toda a paciência e resolveu a matrícula no mesmo dia", "ficou depois do horário na semana da rematrícula para que nenhuma família saísse sem atendimento",
          "revisou o plano de evacuação e treinou a brigada da unidade para o simulado", "resolveu o vazamento da cozinha antes do recreio, sem parar a rotina das turmas",
          "ajudou a colega recém-chegada a entender o ponto e o fechamento do mês", "conduziu a reunião de pais com clareza e saiu com um plano combinado para a turma",
          "criou um projeto de leitura que encheu a biblioteca no intervalo", "deu um retorno cuidadoso a uma família insatisfeita e reconquistou a confiança dela"]
for k in range(64):
    de_i, u = random.choice(ATIVOS); colegas = [x for x in ATIVOS if x[1] == u and x[0] != de_i]
    if not colegas: continue
    para_i = random.choice(colegas)[0]; cr = rnd_ts(rnd_data(HOJE - timedelta(days=360), HOJE - timedelta(days=1))) + timedelta(hours=4)  # gravado em UTC
    valor = f"'{random.choice(VALORES)}'" if VALORES and random.random() < 0.9 else "NULL"
    msg = f"{random.choice(FEITOS).capitalize()}. {random.choice(['Muito obrigado!', 'Faz diferença para todos.', 'Exemplo para a equipe.', 'Valeu demais!'])}".replace("'", "''")
    OUT.append(f"INSERT INTO recognitions (de_user_id, de_nome, para_employee_id, valor, mensagem, unit_id, created_at) VALUES (NULL, 'Demo Colaborador {de_i:03d}', {eid(para_i)}, {valor}, '{msg}', {UNITS[u]}, '{cr}');")
OUT.append("COMMIT;")
rodar_sql("\n".join(OUT))
print(f"Dados de demonstração carregados: {len(emps)} colaboradores, {len(alunos)} alunos, {len(cands)} candidatos, {len(mats)} matrículas, {len(tits)} títulos, {len(caixa)} lançamentos de caixa, {len(ordens)} chamados.")
