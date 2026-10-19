# E2E — Substituição de professor (v22): grade horária (importação tudo-ou-nada, choques), ausências (coordenação, aviso do professor,
# afastamento aprovado), aulas a cobrir, sugestões (livre, disciplina, turno, equilíbrio), convite e aceite pelo professor, designação,
# solução sem professor, realizada → banco de horas, cancelamentos, dia não letivo, histórico, exportação, escopo e permissões.
import re, subprocess, requests
from datetime import datetime, timedelta, date
from zoneinfo import ZoneInfo
B = "http://localhost:3100"; TOKEN = "setup-homologacao-2026-status"
def psql(q): return subprocess.run(["su", "postgres", "-c", f"/usr/lib/postgresql/16/bin/psql -h /tmp/pg -U status -d status_people -q -t -A -c \"{q.replace(chr(34), chr(92) + chr(34))}\""], capture_output=True, text=True).stdout.strip()
def mk(): s = requests.Session(); s.headers.update({"Origin": B}); return s
S = mk(); unq = requests.utils.unquote; N = [0]
def ok(msg): N[0] += 1; print(f"  ✓ {msg}")
def action_ids(html):
    i = html.find("<main"); body = html[i:] if i >= 0 else html
    return re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', body)
def fix_cookie(sess, r):
    m = re.search(r"rh_session=([^;]+)", r.headers.get("set-cookie", ""))
    if m: sess.headers["Cookie"] = f"rh_session={m.group(1)}"
def page(path, expect=200, sess=None):
    sess = sess or S; r = sess.get(B + path, allow_redirects=False)
    assert r.status_code == expect, (path, r.status_code, r.headers.get("location"))
    return re.sub(r"<script[^>]*>.*?</script>", "", re.sub(r"<!--.*?-->", "", r.text), flags=re.S).replace("\xa0", " ")
def post(path, aid, data, sess=None):
    sess = sess or S; f = [(f"$ACTION_ID_{aid}", (None, ""))]
    for k, v in data.items():
        for x in (v if isinstance(v, list) else [v]): f.append((k, (None, str(x))))
    r = sess.post(B + path, files=f, allow_redirects=False); fix_cookie(sess, r)
    assert r.status_code in (303, 302, 200), (path, r.status_code, r.text[:300]); return unq(r.headers.get("location", ""))
def aid_of(html, marker):
    i = html.find(marker); assert i >= 0, marker
    fs = html.rfind("<form", 0, i); fe_prev = html.rfind("</form>", 0, i)
    if fs > fe_prev: fe = html.find("</form>", i)
    else: fs = html.find("<form", i); fe = html.find("</form>", fs)
    ids = action_ids(html[fs:fe]); assert ids, marker; return ids[0]
def login(sess, email, senha):
    html = sess.get(B + "/login").text; aid = re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', html)[0]
    loc = post("/login", aid, {"email": email, "senha": senha}, sess=sess); assert loc.endswith("/"), loc
def erro(loc, trecho): assert "erro=" in loc and trecho in loc, (trecho, loc)
def okmsg(loc, trecho=""): assert "ok=" in loc and trecho in loc, (trecho, loc)
HOJE = datetime.now(ZoneInfo("America/Campo_Grande")).date(); H = HOJE.isoformat()
DIAS = ["", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"]
feriados = set(psql("SELECT string_agg(data::text, ',') FROM calendar_days WHERE publico IN ('TODOS','DOCENTE') AND tipo IN ('FERIADO','NAO_LETIVO','RECESSO','FERIAS_COLETIVAS')").split(","))
D = HOJE + timedelta(days=1)
while D.isoweekday() > 5 or D.isoformat() in feriados: D += timedelta(days=1)
W = D.isoweekday(); DI = D.isoformat(); D2d = D + timedelta(days=7)
while D2d.isoformat() in feriados: D2d += timedelta(days=7)
D2 = D2d.isoformat()

print("Preparação")
login(S, "rh@colegiostatus", "Status2026!"); r = S.get(B + f"/api/setup?token={TOKEN}"); assert r.json()["ok"], r.text
CAR, CUL = (psql(f"SELECT id FROM units WHERE codigo='{c}'") for c in ["CAR", "CUL"])
for nome, u in [("Ana Matemática", CAR), ("Beto Matemática", CAR), ("Clara Português", CAR), ("Davi Cultura", CUL), ("Eli Ciências", CAR), ("Fábio Artes", CAR)]:
    psql(f"INSERT INTO employees (nome, unit_id, vinculo, admissao, regime, telefone) VALUES ('{nome}', {u}, 'CLT', '2024-02-01', 'DOCENTE', '6799990{len(nome):04d}')")
A, Bt, C, Dv, E, F = (psql(f"SELECT id FROM employees WHERE nome='{n}'") for n in ["Ana Matemática", "Beto Matemática", "Clara Português", "Davi Cultura", "Eli Ciências", "Fábio Artes"])
psql(f"UPDATE employees SET situacao='DESLIGADO', desligamento='{H}' WHERE id={F}")
psql(f"INSERT INTO leave_requests (employee_id, tipo, inicio, fim, dias, status) VALUES ({E}, 'FERIAS', '{(D - timedelta(days=2)).isoformat()}', '{(D + timedelta(days=2)).isoformat()}', 5, 'APROVADA')")
html = page("/configuracoes"); aid_user = aid_of(html, "Criar acesso")
def criar_user(nome, email, role, unit="", emp=""):
    post("/configuracoes", aid_user, {"nome": nome, "email": email, "role": role, "unitId": unit, "employeeId": emp, "senha": "senha12345"}); return psql(f"SELECT id FROM users WHERE email='{email}'")
COORD = criar_user("Coordenadora Carandá", "coord@car", "GESTOR", CAR); GCUL = criar_user("Gestor Cultura", "ges@cul", "GESTOR", CUL)
UB = criar_user("Beto", "beto@car", "COLABORADOR", "", Bt); UC = criar_user("Clara", "clara@car", "COLABORADOR", "", C); LEI = criar_user("Leitura", "lei@rede", "LEITURA")
CO = mk(); login(CO, "coord@car", "senha12345"); GC = mk(); login(GC, "ges@cul", "senha12345"); SB = mk(); login(SB, "beto@car", "senha12345"); SC = mk(); login(SC, "clara@car", "senha12345"); SL = mk(); login(SL, "lei@rede", "senha12345")
ok(f"professores de Carandá e Cultura; Eli em férias aprovadas; Fábio desligado; dia de teste {DI} ({DIAS[W]})")

print("Grade horária (importação)")
html = page("/cobertura/grade", sess=CO); aid_imp = aid_of(html, "Importar")
cab = "professor;unidade;dia;inicio;fim;turma;disciplina"
L = [f"Ana Matemática;Carandá;{DIAS[W]};07:00;07:50;5º ano A;Matemática", f"Ana Matemática;CAR;{W};08:00;08:50;5º ano B;Matemática",
     f"Beto Matemática;Carandá;{DIAS[W][:3]};07:00;07:50;4º ano A;Matemática", f"Beto Matemática;Carandá;{DIAS[W]};9:00;09:50;4º ano B;Matemática",
     f"Clara Português;Carandá;{DIAS[W]};10:00;10:50;3º ano A;Português", f"Eli Ciências;Carandá;{DIAS[W]};13:00;13:50;2º ano A;Ciências"]
def importar(sess, linhas, ignorar=(), confirmar=True):
    """v25: importação em 2 etapas — lê/valida e propõe o de-para; a coordenação confirma nome a nome (CRQ-TMP-V3-01)."""
    loc = post("/cobertura/grade", aid_imp, {"csv": "\n".join(linhas)}, sess=sess)
    if "erro=" in loc: return loc
    m = re.search(r"/cobertura/grade/importar/(\d+)", loc); assert m, loc
    hi = page(f"/cobertura/grade/importar/{m.group(1)}", sess=sess); aid_c = aid_of(hi, "Aplicar importação"); dados = {"batchId": m.group(1)}
    for sel in re.finditer(r'<select[^>]*name="dp_(\d+)"[^>]*>(.*?)</select>', hi, flags=re.S):
        i, ops = sel.group(1), sel.group(2)
        sug = re.search(r'<option[^>]*selected=""[^>]*value="(\d+)"|<option[^>]*value="(\d+)"[^>]*selected=""', ops)
        dados[f"dp_{i}"] = (sug.group(1) or sug.group(2)) if sug else ""
        if confirmar: dados[f"ok_{i}"] = "1"
    for i in ignorar: dados[f"dp_{i}"] = "0"
    return post(f"/cobertura/grade/importar/{m.group(1)}", aid_c, dados, sess=sess)
erro(importar(CO, [cab, *L, "Zé Ninguém;Carandá;Segunda;07:00;07:50;1º ano;Arte"]), "Confirme o de-para")
erro(post("/cobertura/grade", aid_imp, {"csv": "\n".join([cab, *L, f"Ana Matemática;Carandá;{DIAS[W]};07:30;08:20;5º ano C;Matemática"])}, sess=CO), "choque de horário")
erro(importar(CO, [cab, *L], confirmar=False), "Confirme o de-para")
erro(post("/cobertura/grade", aid_imp, {"csv": "\n".join([cab, f"Davi Cultura;Cultura;{DIAS[W]};07:00;07:50;Jardim II;Recreação"])}, sess=CO), "fora do seu escopo")
erro(post("/cobertura/grade", aid_imp, {"csv": "professor;dia\nAna;Segunda"}, sess=CO), "Cabeçalho")
assert psql("SELECT count(*) FROM teacher_slots") == "0"
okmsg(importar(CO, [cab, *L]), "6 aula(s) importada(s)")
okmsg(importar(GC, [cab, f"Davi Cultura;Cultura;{DIAS[W]};07:00;07:50;Jardim II;Recreação"]), "1 aula(s)")
assert psql("SELECT inicio || '|' || turno FROM teacher_slots WHERE turma='4º ano B'") == "09:00|Matutino" and psql("SELECT turno FROM teacher_slots WHERE turma='2º ano A'") == "Vespertino"
erro(importar(CO, [cab, L[0]]), "choque com a aula já cadastrada")
ok("importação tudo-ou-nada em 2 etapas: choque no arquivo, unidade fora do escopo e cabeçalho barram a leitura; professor sem par e de-para não confirmado barram a gravação; 6 + 1 aulas; turno derivado do horário")
html = page("/cobertura/grade", sess=CO); assert "Ana Matemática" in html and "Davi Cultura" not in html; aid_sal = aid_of(html, "Incluir aula")
erro(post("/cobertura/grade", aid_sal, {"employeeId": A, "unitId": CAR, "dia": W, "inicio": "07:20", "fim": "08:10", "turma": "X"}, sess=CO), "Choque de horário")
erro(post("/cobertura/grade", aid_sal, {"employeeId": A, "unitId": CAR, "dia": W, "inicio": "11:00", "fim": "10:00", "turma": "X"}, sess=CO), "Horário inválido")
erro(post("/cobertura/grade", aid_sal, {"employeeId": A, "unitId": CUL, "dia": W, "inicio": "11:00", "fim": "11:50", "turma": "X"}, sess=CO), "Sem acesso")
assert page("/cobertura/grade", expect=307, sess=SB) is not None
ok("grade: choque, horário invertido e unidade de outro escopo recusados; professor (autoatendimento) não acessa a grade da coordenação")

print("Ausências e aulas a cobrir")
h = page(f"/cobertura?data={DI}", sess=CO)
assert psql(f"SELECT origem || '|' || motivo FROM cover_absences WHERE employee_id={E} AND data='{DI}'") == "AFASTAMENTO|FERIAS"
assert psql(f"SELECT turma || '|' || status FROM cover_assignments WHERE ausente_employee_id={E}") == "2º ano A|ABERTA" and "afastamento aprovado" in h
ok("férias aprovadas viram ausência e a aula do dia entra no quadro sozinha")
aid_aus = aid_of(h, "Registrar e listar aulas a cobrir")
erro(post("/cobertura", aid_aus, {"employeeId": A, "de": DI, "motivo": "ATESTADO", "voltar": f"/cobertura?data={DI}"}, sess=GC), "Sem acesso")
erro(post("/cobertura", aid_aus, {"employeeId": A, "de": DI, "motivo": "XYZ", "voltar": f"/cobertura?data={DI}"}, sess=CO), "motivo")
erro(post("/cobertura", aid_aus, {"employeeId": A, "de": DI, "inicio": "09:00", "motivo": "FALTA", "voltar": f"/cobertura?data={DI}"}, sess=CO), "Período parcial")
okmsg(post("/cobertura", aid_aus, {"employeeId": A, "de": DI, "motivo": "ATESTADO", "obs": "atividade no armário", "voltar": f"/cobertura?data={DI}"}, sess=CO), "2 aula(s) a cobrir em 1 dia")
erro(post("/cobertura", aid_aus, {"employeeId": A, "de": DI, "motivo": "ATESTADO", "voltar": f"/cobertura?data={DI}"}, sess=CO), "já tem ausência")
h = page(f"/cobertura?data={DI}", sess=CO); assert h.count("Quem pode cobrir") >= 3 and "5º ano A" in h and "5º ano B" in h
ok("ausência registrada pela coordenação: 2 aulas da Ana; gestor da Cultura barrado; motivo e período parcial validados; sem duplicar")

print("Sugestões de quem cobre")
X5A = psql("SELECT id FROM cover_assignments WHERE turma='5º ano A'"); X5B = psql("SELECT id FROM cover_assignments WHERE turma='5º ano B'")
h = page(f"/cobertura?data={DI}&aula={X5A}", sess=CO); sug = h[h.find('id="sugestoes"'):h.find("Sem professor substituto")]
assert "Clara Português" in sug and "Beto Matemática" not in sug and "Eli Ciências" not in sug and "Davi Cultura" not in sug and "Fábio Artes" not in sug and "já está na escola neste turno" in sug, sug[:600]
h = page(f"/cobertura?data={DI}&aula={X5B}", sess=CO); sug = h[h.find('id="sugestoes"'):h.find("Sem professor substituto")]
assert sug.find("Beto Matemática") < sug.find("Clara Português") and "mesma disciplina (Matemática)" in sug and "melhor opção" in sug[:sug.find("Beto Matemática") + 20]
ok("07:00: só Clara (Beto tem aula, Eli em férias, Davi é de outra unidade, Fábio desligado); 08:00: Beto primeiro (mesma disciplina, já na escola)")

print("Convite, aceite e recusa pelo professor")
aid_conv = aid_of(h, "Convidar")
erro(post("/cobertura", aid_conv, {"id": X5A, "employeeId": Bt, "modo": "CONVITE", "voltar": "/cobertura"}, sess=CO), "aula própria")
erro(post("/cobertura", aid_conv, {"id": X5A, "employeeId": C, "modo": "CONVITE", "voltar": "/cobertura"}, sess=SB), "coordenação")
okmsg(post("/cobertura", aid_conv, {"id": X5B, "employeeId": Bt, "modo": "CONVITE", "voltar": "/cobertura"}, sess=CO), "Convite enviado")
okmsg(post("/cobertura", aid_conv, {"id": X5A, "employeeId": C, "modo": "CONVITE", "voltar": "/cobertura"}, sess=CO), "Convite enviado")
assert psql(f"SELECT count(*) FROM notifications WHERE user_id={UB} AND titulo='Convite para cobrir uma aula' AND tipo='ACAO'") == "1"
hb = page("/cobertura/minha", sess=SB); assert "Convites para responder (1)" in hb and "5º ano B" in hb and "no lugar de Ana Matemática" in hb
aid_resp = aid_of(hb, "Aceitar")
erro(post("/cobertura/minha", aid_resp, {"id": X5A, "resposta": "ACEITAR"}, sess=SB), "Convite não encontrado")
okmsg(post("/cobertura/minha", aid_resp, {"id": X5B, "resposta": "ACEITAR"}, sess=SB), "confirmada")
assert psql(f"SELECT status FROM cover_assignments WHERE id={X5B}") == "CONFIRMADA" and psql(f"SELECT count(*) FROM notifications WHERE user_id={COORD} AND titulo LIKE 'Beto%aceitou%'") == "1"
hc = page("/cobertura/minha", sess=SC); aid_rc = aid_of(hc, "Recusar")
okmsg(post("/cobertura/minha", aid_rc, {"id": X5A, "resposta": "RECUSAR", "motivo": "consulta médica"}, sess=SC), "Recusa registrada")
assert psql(f"SELECT status || '|' || (recusas->0->>'nome') || '|' || (recusas->0->>'motivo') FROM cover_assignments WHERE id={X5A}") == "ABERTA|Clara|consulta médica"
assert psql(f"SELECT count(*) FROM notifications WHERE user_id={COORD} AND titulo LIKE 'Clara recusou%' AND tipo='ALERTA'") == "1"
h = page(f"/cobertura?data={DI}", sess=CO); assert "recusou: Clara" in h
ok("convite só pela coordenação e para quem está livre; Beto aceita pelo celular (coordenação avisada); Clara recusa com motivo (volta a aberta, alerta)")

print("Sem professor, reabrir, designar")
h = page(f"/cobertura?data={DI}&aula={X5A}", sess=CO); aid_sem = aid_of(h, "Registrar solução")
erro(post("/cobertura", aid_sem, {"id": X5A, "solucao": "", "voltar": "/cobertura"}, sess=CO), "solução")
erro(post("/cobertura", aid_sem, {"id": X5A, "solucao": "OUTRA", "obs": "", "voltar": "/cobertura"}, sess=CO), "Descreva")
okmsg(post("/cobertura", aid_sem, {"id": X5A, "solucao": "ATIVIDADE_ORIENTADA", "obs": "inspetora Rita", "voltar": "/cobertura"}, sess=CO), "Solução registrada")
h = page(f"/cobertura?data={DI}", sess=CO); assert "Atividade orientada" in h and "inspetora Rita" in h; aid_reab = aid_of(h, "Reabrir")
okmsg(post("/cobertura", aid_reab, {"id": X5A, "voltar": "/cobertura"}, sess=CO), "reaberta")
h = page(f"/cobertura?data={DI}&aula={X5A}", sess=CO); aid_des = aid_of(h, "Designar")
okmsg(post("/cobertura", aid_des, {"id": X5A, "employeeId": C, "modo": "DESIGNAR", "voltar": "/cobertura"}, sess=CO), "designado")
assert psql(f"SELECT status FROM cover_assignments WHERE id={X5A}") == "CONFIRMADA"
X2A = psql("SELECT id FROM cover_assignments WHERE turma='2º ano A'"); h = page(f"/cobertura?data={DI}&aula={X2A}", sess=CO); sug = h[h.find('id="sugestoes"'):h.find("Sem professor substituto")]
assert "Beto Matemática" in sug and "Clara Português" in sug and "Ana Matemática" not in sug
ok("solução sem professor exige o tipo (e detalhe quando “outra”); reabrir; designação direta; à tarde Beto e Clara estão livres, Ana não (ausente)")

print("Realizada → banco de horas")
html = page(f"/cobertura?data={DI}", sess=CO)
assert ">Realizada<" not in html.replace("Realizadas", "")
psql(f"UPDATE cover_assignments SET data='{H}' WHERE id={X5B}")
html = page(f"/cobertura?data={H}", sess=CO); aid_real = aid_of(html, ">Realizada<") if ">Realizada<" in html else None
assert aid_real, "botão Realizada"
okmsg(post("/cobertura", aid_real, {"id": X5B, "voltar": "/cobertura"}, sess=CO), "50 min lançados no banco de horas (aguardando aprovação)")
he = psql(f"SELECT employee_id || '|' || minutos || '|' || tipo || '|' || status FROM hour_entries WHERE id=(SELECT hour_entry_id FROM cover_assignments WHERE id={X5B})")
assert he == f"{Bt}|50|EXTRA|PENDENTE", he
erro(post("/cobertura", aid_real, {"id": X5B, "voltar": "/cobertura"}, sess=CO), "cobertura confirmada")
erro(post("/cobertura", aid_real, {"id": X5A, "voltar": "/cobertura"}, sess=CO), "ainda não aconteceu")
ok("aula futura não é marcada realizada; realizada vira 50 min de hora extra pendente no banco de horas do Beto (uma vez só)")

print("Aviso de ausência pelo professor e cancelamentos")
hc = page("/cobertura/minha", sess=SC); aid_av = aid_of(hc, "Avisar a coordenação")
erro(post("/cobertura/minha", aid_av, {"de": (HOJE - timedelta(days=3)).isoformat(), "motivo": "FALTA"}, sess=SC), "passadas")
okmsg(post("/cobertura/minha", aid_av, {"de": D2, "motivo": "FORMACAO", "obs": "curso na SED"}, sess=SC), "1 aula(s) a cobrir")
assert psql(f"SELECT count(*) FROM notifications WHERE user_id={COORD} AND titulo='Clara Português avisou ausência' AND tipo='ALERTA'") == "1"
hc = page("/cobertura/minha", sess=SC); assert "Meus avisos de ausência" in hc; aid_cav = aid_of(hc, "Cancelar aviso")
okmsg(post("/cobertura/minha", aid_cav, {"id": psql(f"SELECT id FROM cover_absences WHERE employee_id={C} AND data='{D2}' AND status='ATIVA'"), "voltar": "/cobertura/minha"}, sess=SC), "cancelada")
assert psql(f"SELECT count(*) FROM cover_assignments WHERE ausente_employee_id={C} AND status <> 'CANCELADA'") == "0"
AB_E = psql(f"SELECT id FROM cover_absences WHERE employee_id={E} AND data='{DI}'")
h = page(f"/cobertura?data={DI}", sess=CO); aid_can = aid_of(h, "Cancelar ausência")
erro(post("/cobertura", aid_can, {"id": AB_E, "voltar": "/cobertura"}, sess=CO), "cancele o afastamento")
AB_A = psql(f"SELECT absence_id FROM cover_assignments WHERE id={X5A}")
okmsg(post("/cobertura", aid_can, {"id": AB_A, "motivo": "atestado era para outro dia", "voltar": "/cobertura"}, sess=CO), "Ausência cancelada")
assert psql(f"SELECT status FROM cover_assignments WHERE id={X5A}") == "CANCELADA" and psql(f"SELECT count(*) FROM notifications WHERE user_id={UC} AND titulo='Cobertura cancelada'") == "1"
psql(f"UPDATE leave_requests SET status='CANCELADA' WHERE employee_id={E}"); page(f"/cobertura?data={DI}", sess=CO)
assert psql(f"SELECT status FROM cover_absences WHERE id={AB_E}") == "CANCELADA" and psql(f"SELECT status FROM cover_assignments WHERE id={X2A}") == "CANCELADA"
ok("professor avisa ausência (só datas futuras; coordenação alertada) e cancela o aviso; ausência de afastamento só sai pelo afastamento; cancelamento avisa quem ia cobrir; férias canceladas desfazem as aulas")

print("Dia não letivo, histórico, exportação e permissões")
psql(f"INSERT INTO calendar_days (data, tipo, descricao, publico) VALUES ('{D2}', 'FERIADO', 'Feriado de teste', 'TODOS')")
okmsg(post("/cobertura", aid_aus, {"employeeId": A, "de": D2, "motivo": "FALTA", "voltar": "/cobertura"}, sess=CO), "sem aulas na grade")
assert "Dia sem aula para docentes" in page(f"/cobertura?data={D2}", sess=CO)
hh = page(f"/cobertura/historico?ini={(HOJE - timedelta(days=5)).isoformat()}&fim={DI}", sess=CO); assert "Beto Matemática" in hh[hh.find("Quem mais cobriu"):hh.find("Ausências")]
csv = CO.get(B + f"/api/export/coberturas?ini={(HOJE - timedelta(days=5)).isoformat()}&fim={DI}").content.decode("utf-8-sig")
assert csv.splitlines()[0].startswith("data;unidade;inicio;fim;turma") and "Beto Matemática" in csv and "Realizada" in csv
assert SC.get(B + "/api/export/coberturas").status_code == 401
assert page("/cobertura", expect=307, sess=SB) is not None
hl = page(f"/cobertura?data={DI}", sess=SL); assert "Registrar ausência" not in hl and "Quem pode cobrir" not in hl
html = page("/cobertura/grade", sess=CO); SL4B = psql("SELECT id FROM teacher_slots WHERE turma='5º ano B'"); aid_rem = aid_of(html, "Remover")
okmsg(post("/cobertura/grade", aid_rem, {"id": SL4B, "voltar": "/cobertura/grade"}, sess=CO), "retirada da grade")
assert psql(f"SELECT ativo FROM teacher_slots WHERE id={SL4B}") == "f"
ok("ausência em feriado não gera aulas; histórico e CSV; professor não exporta nem vê o quadro; leitura sem ações; aula com histórico é retirada (não apagada)")

print("Endurecimento: quem cobre, confirmação única, histórico protegido")
psql(f"INSERT INTO employees (nome, unit_id, vinculo, admissao, regime) VALUES ('Gabi Coordenação', {CAR}, 'CLT', '2023-02-01', 'ADMINISTRATIVO')"); G = psql("SELECT id FROM employees WHERE nome='Gabi Coordenação'")
UG = criar_user("Gabi", "gabi@car", "GESTOR", CAR, G); SG = mk(); login(SG, "gabi@car", "senha12345")
psql(f"INSERT INTO cover_absences (employee_id, unit_id, data, motivo) VALUES ({A}, {CAR}, '{H}', 'FALTA')"); ABH = psql(f"SELECT id FROM cover_absences WHERE employee_id={A} AND data='{H}' AND status='ATIVA'")
psql(f"INSERT INTO cover_assignments (absence_id, data, unit_id, turma, inicio, fim, ausente_employee_id, minutos) VALUES ({ABH}, '{H}', {CAR}, '9º ano Z', '15:00', '15:50', {A}, 50), ({ABH}, '{H}', {CAR}, '9º ano Y', '16:00', '16:50', {A}, 50)")
XZ, XY = (psql(f"SELECT id FROM cover_assignments WHERE turma='{t}'") for t in ["9º ano Z", "9º ano Y"])
erro(post("/cobertura", aid_conv, {"id": XZ, "employeeId": G, "modo": "DESIGNAR", "voltar": "/cobertura"}, sess=SG), "se designar")
erro(post("/cobertura", aid_conv, {"id": XZ, "employeeId": Dv, "modo": "DESIGNAR", "voltar": "/cobertura"}, sess=CO), "Sem acesso a este professor")
erro(post("/cobertura", aid_conv, {"id": XZ, "employeeId": F, "modo": "DESIGNAR", "voltar": "/cobertura"}, sess=CO), "desligado")
okmsg(post("/cobertura", aid_conv, {"id": XY, "employeeId": G, "modo": "DESIGNAR", "voltar": "/cobertura"}, sess=CO), "designado")
erro(post("/cobertura", aid_real, {"id": XY, "voltar": "/cobertura"}, sess=SG), "própria cobertura")
ok("ninguém se designa nem confirma a própria cobertura (vira crédito de horas); coordenação não designa professor de outra unidade nem desligado")
okmsg(post("/cobertura", aid_conv, {"id": XZ, "employeeId": Bt, "modo": "CONVITE", "voltar": "/cobertura"}, sess=CO), "Convite enviado")
okmsg(post("/cobertura", aid_conv, {"id": XZ, "employeeId": C, "modo": "CONVITE", "voltar": "/cobertura"}, sess=CO), "Convite enviado")
erro(post("/cobertura/minha", aid_resp, {"id": XZ, "resposta": "ACEITAR"}, sess=SB), "Convite não encontrado")
assert psql(f"SELECT status || '|' || cobertura_employee_id FROM cover_assignments WHERE id={XZ}") == f"CONVIDADO|{C}"
okmsg(post("/cobertura/minha", aid_resp, {"id": XZ, "resposta": "ACEITAR"}, sess=SC), "confirmada")
import threading as _th; ss = []
for k in range(4): x = mk(); login(x, "coord@car", "senha12345"); ss.append(x)
res = []; ths = [_th.Thread(target=lambda x=x: res.append(post("/cobertura", aid_real, {"id": XZ, "voltar": "/cobertura"}, sess=x))) for x in ss]; [t.start() for t in ths]; [t.join(timeout=60) for t in ths]
assert sum("ok=" in r for r in res) == 1 and len(res) == 4, res
assert psql(f"SELECT count(*) FROM hour_entries WHERE descricao LIKE 'Cobertura de aula: 9º ano Z%'") == "1"
ok("convite passado a outra pessoa não pode mais ser aceito por quem foi trocado; 4 cliques simultâneos em “Realizada” geram um único crédito de horas")
psql(f"INSERT INTO cover_absences (employee_id, unit_id, data, motivo, origem) VALUES ({C}, {CAR}, '{(HOJE - timedelta(days=1)).isoformat()}', 'FALTA', 'PROFESSOR')"); ABP = psql(f"SELECT id FROM cover_absences WHERE employee_id={C} AND origem='PROFESSOR' AND data < '{H}' AND status='ATIVA'")
erro(post("/cobertura/minha", aid_cav, {"id": ABP, "voltar": "/cobertura/minha"}, sess=SC), "já passou")
assert psql(f"SELECT status FROM cover_absences WHERE id={ABP}") == "ATIVA"
PAS = (HOJE - timedelta(days=14)); 
while PAS.isoweekday() != W: PAS -= timedelta(days=1)
psql(f"INSERT INTO leave_requests (employee_id, tipo, inicio, fim, dias, status) VALUES ({Bt}, 'LICENCA', '{PAS.isoformat()}', '{PAS.isoformat()}', 1, 'APROVADA')")
page(f"/cobertura?data={PAS.isoformat()}", sess=SL); page(f"/cobertura?data={PAS.isoformat()}", sess=CO)
assert psql(f"SELECT count(*) FROM cover_absences WHERE employee_id={Bt} AND data='{PAS.isoformat()}'") == "0"
erro(post("/cobertura/minha", aid_av, {"de": (HOJE - timedelta(days=1)).isoformat(), "ate": (HOJE + timedelta(days=1)).isoformat(), "motivo": "FALTA"}, sess=SC), "passadas")
psql(f"INSERT INTO cover_absences (employee_id, unit_id, data, motivo, origem) VALUES ({C}, {CAR}, '{H}', 'FALTA', 'PROFESSOR')"); ABT = psql(f"SELECT id FROM cover_absences WHERE employee_id={C} AND data='{H}' AND status='ATIVA'")
psql(f"INSERT INTO cover_assignments (absence_id, data, unit_id, turma, inicio, fim, ausente_employee_id, cobertura_employee_id, status, minutos) VALUES ({ABT}, '{H}', {CAR}, '1º ano W', '17:00', '17:50', {C}, {Bt}, 'CONFIRMADA', 50)")
erro(post("/cobertura/minha", aid_cav, {"id": ABT, "voltar": "/cobertura/minha"}, sess=SC), "colega cobrindo")
ok("professor não apaga ausência de dia que já passou nem a de hoje com colega já cobrindo; aviso não começa no passado; olhar um dia passado (leitura ou coordenação) não cria aulas a cobrir retroativas")

print(f"\nE2E Substituição de professor: {N[0]} verificações OK")
