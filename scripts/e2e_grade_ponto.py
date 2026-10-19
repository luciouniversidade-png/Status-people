# E2E — v25 · Grade docente com vigência (T-053 · CRQ-TMP-V3-01) e auditoria do ponto (T-050).
# Grade inicial; ajuste na grade em vigor vale a partir de hoje (nunca retroativo solto); vigência encerrada é só leitura; rascunho com
# validação (choque em outra unidade bloqueia, duração fora do padrão avisa), ativação (anterior fecha na véspera), comparador; início no
# passado só com justificativa e com mês aberto; CH pela grade (janela conta, almoço não, plantão conta) aplicada pelo RH a partir da vigência,
# recálculo dos dias lançados (mês fechado intacto); jornada que cobre mês fechado não muda. Auditoria: divergências tipificadas, lote só
# para o normal, devolver ao relógio + reimportação resolve, corrigir CH, atestado anexado (restrito), pendência no fechamento, CSV.
import re, subprocess, requests
from datetime import datetime, timedelta, date
from zoneinfo import ZoneInfo
B = "http://localhost:3100"; TOKEN = "setup-homologacao-2026-status"
def psql(q): return subprocess.run(["su", "postgres", "-c", f"/usr/lib/postgresql/16/bin/psql -h /tmp/pg -U status -d status_people -q -t -A -c \"{q.replace(chr(34), chr(92) + chr(34))}\""], capture_output=True, text=True).stdout.strip()
def mk(): s = requests.Session(); s.headers.update({"Origin": B}); return s
unq = requests.utils.unquote; N = [0]
def ok(msg): N[0] += 1; print(f"  ✓ {msg}")
def action_ids(html):
    i = html.find("<main"); body = html[i:] if i >= 0 else html
    return re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', body)
def fix_cookie(sess, r):
    m = re.search(r"rh_session=([^;]+)", r.headers.get("set-cookie", ""))
    if m: sess.headers["Cookie"] = f"rh_session={m.group(1)}"
def page(path, sess, expect=200):
    r = sess.get(B + path, allow_redirects=False)
    assert r.status_code == expect, (path, r.status_code, r.headers.get("location"))
    return re.sub(r"<script[^>]*>.*?</script>", "", re.sub(r"<!--.*?-->", "", r.text), flags=re.S).replace("\xa0", " ")
def post(path, aid, data, sess, files=None):
    f = [(f"$ACTION_ID_{aid}", (None, ""))]
    for k, v in data.items():
        for x in (v if isinstance(v, list) else [v]): f.append((k, (None, str(x))))
    if files: f += files
    r = sess.post(B + path, files=f, allow_redirects=False); fix_cookie(sess, r)
    assert r.status_code in (303, 302, 200), (path, r.status_code, r.text[:300]); return unq(r.headers.get("location", ""))
def aid_of(html, marker):
    i = html.find(marker); assert i >= 0, marker
    fs = html.rfind("<form", 0, i); fe_prev = html.rfind("</form>", 0, i)
    if fs > fe_prev: fe = html.find("</form>", i)
    else: fs = html.find("<form", i); fe = html.find("</form>", fs)
    ids = action_ids(html[fs:fe]); assert ids, marker; return ids[0]
def login(email, senha):
    s = mk(); html = s.get(B + "/login").text; aid = re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', html)[0]
    loc = post("/login", aid, {"email": email, "senha": senha}, s); assert loc.endswith("/"), loc; return s
def erro(loc, trecho): assert "erro=" in loc and trecho in loc, (trecho, loc)
def okmsg(loc, trecho=""): assert "ok=" in loc and trecho in loc, (trecho, loc)
HOJE = datetime.now(ZoneInfo("America/Campo_Grande")).date(); H = HOJE.isoformat()
def d(n): return (HOJE + timedelta(days=n)).isoformat()
def br(iso): return "/".join(reversed(iso.split("-")))
PROX = (HOJE.replace(day=28) + timedelta(days=4)).replace(day=1)  # 1º do mês que vem
INI_MES = HOJE.replace(day=1); MES_ANT = (INI_MES - timedelta(days=1)).strftime("%Y-%m"); MES = H[:7]
SEG = (HOJE + timedelta(days=(7 - HOJE.weekday()) % 7 or 7))  # próxima segunda (para dias da semana estáveis)

print("Preparação")
RH = login("rh@colegiostatus", "Status2026!"); r = RH.get(B + f"/api/setup?token={TOKEN}"); assert r.json()["ok"], r.text
CAR, CUL = (psql(f"SELECT id FROM units WHERE codigo='{c}'") for c in ["CAR", "CUL"])
for nome, un, reg in [("Ana Docente", CAR, "DOCENTE"), ("Bruno Docente", CAR, "DOCENTE"), ("Carol Docente", CAR, "DOCENTE"), ("Davi Duas Unidades", CUL, "DOCENTE"), ("Eva Secretaria", CAR, "ADMINISTRATIVO")]:
    psql(f"INSERT INTO employees (nome, unit_id, vinculo, admissao, regime) VALUES ('{nome}', {un}, 'CLT', '2024-01-10', '{reg}')")
E = {n.split()[0]: psql(f"SELECT id FROM employees WHERE nome LIKE '{n}%'") for n in ["Ana", "Bruno", "Carol", "Davi", "Eva"]}
html = page("/configuracoes", RH); aid_user = aid_of(html, "Criar acesso")
def criar_user(nome, email, role, unit="", emp=""):
    post("/configuracoes", aid_user, {"nome": nome, "email": email, "role": role, "unitId": unit, "employeeId": emp, "senha": "senha12345"}, RH); return psql(f"SELECT id FROM users WHERE email='{email}'")
criar_user("Coord Carandá", "coord@car", "GESTOR", CAR); criar_user("Diretora Carandá", "dir@car", "DIRETOR_UNIDADE", CAR); criar_user("Ana", "ana@car", "COLABORADOR", "", E["Ana"])
CO = login("coord@car", "senha12345"); DU = login("dir@car", "senha12345"); AN = login("ana@car", "senha12345")
psql(f"INSERT INTO schedules (employee_id, vigencia_inicio, seg, ter, qua, qui, sex, horarios) VALUES ({E['Ana']}, '2024-01-10', 528, 528, 528, 528, 528, '07:00–11:00 e 13:00–17:48'), ({E['Eva']}, '2024-01-10', 480, 480, 480, 480, 480, '08:00–12:00 e 13:00–17:00')")
ok("docentes em Carandá e um em Cultura, secretária administrativa; coordenação, diretora e autoatendimento")

print("Grade inicial e ajuste na grade em vigor")
h = page(f"/cobertura/grade?unidade={CAR}", CO); assert "Nenhuma vigência ainda" in h; aid_sal = aid_of(h, "Incluir aula")
def aula(sess, emp, un, dia, ini, fim, turma, disc="Matemática", extra=None, voltar=None):
    return post("/cobertura/grade", aid_sal, {"employeeId": emp, "unitId": un, "dia": dia, "inicio": ini, "fim": fim, "turma": turma, "disciplina": disc, **(extra or {}), "voltar": voltar or f"/cobertura/grade?unidade={un}"}, sess)
okmsg(aula(CO, E["Ana"], CAR, 1, "07:00", "07:50", "5º ano A")); okmsg(aula(CO, E["Ana"], CAR, 1, "08:40", "09:30", "5º ano B")); okmsg(aula(CO, E["Ana"], CAR, 2, "07:00", "07:50", "5º ano A"))
okmsg(aula(CO, E["Ana"], CAR, 2, "13:00", "13:50", "6º ano A")); okmsg(aula(CO, E["Ana"], CAR, 3, "15:00", "16:00", "PLANTÃO", "Plantão de dúvidas")); okmsg(aula(CO, E["Bruno"], CAR, 1, "07:00", "07:50", "4º ano A", "Português"))
V0 = psql(f"SELECT id FROM grade_versions WHERE unit_id={CAR}"); assert psql(f"SELECT origem || '|' || status || '|' || vigencia_inicio FROM grade_versions WHERE id={V0}") == f"INICIAL|ATIVA|{H}"
assert psql(f"SELECT count(*) FROM teacher_slots WHERE version_id={V0}") == "6"
erro(aula(CO, E["Bruno"], CAR, 1, "07:20", "08:10", "4º ano B"), "Choque de horário")
ok("primeira aula cria a grade inicial (vale a partir de hoje); 6 aulas; choque do professor barrado")
psql(f"UPDATE grade_versions SET vigencia_inicio='{d(-30)}' WHERE id={V0}")  # simula uma grade em vigor há 30 dias
SL = psql(f"SELECT id FROM teacher_slots WHERE version_id={V0} AND turma='4º ano A'")
h = page(f"/cobertura/grade?unidade={CAR}", CO); aid_sal = aid_of(h, "Incluir aula")
okmsg(post("/cobertura/grade", aid_sal, {"id": SL, "employeeId": E["Bruno"], "unitId": CAR, "dia": 1, "inicio": "07:00", "fim": "07:50", "turma": "4º ano A — Turma Azul", "disciplina": "Português", "voltar": f"/cobertura/grade?unidade={CAR}"}, CO), "Grade atualizada.")
assert psql(f"SELECT count(*) FROM grade_versions WHERE unit_id={CAR}") == "1" and psql(f"SELECT turma FROM teacher_slots WHERE id={SL}") == "4º ano A — Turma Azul"
loc = post("/cobertura/grade", aid_sal, {"id": SL, "employeeId": E["Bruno"], "unitId": CAR, "dia": 1, "inicio": "09:40", "fim": "10:30", "turma": "4º ano A — Turma Azul", "disciplina": "Português", "voltar": f"/cobertura/grade?unidade={CAR}"}, CO)
okmsg(loc, "a partir de hoje"); V1 = psql(f"SELECT id FROM grade_versions WHERE unit_id={CAR} AND origem='AJUSTE'")
assert psql(f"SELECT vigencia_fim FROM grade_versions WHERE id={V0}") == d(-1) and psql(f"SELECT vigencia_inicio || '|' || coalesce(vigencia_fim::text,'-') || '|' || copiada_de FROM grade_versions WHERE id={V1}") == f"{H}|-|{V0}"
assert psql(f"SELECT inicio FROM teacher_slots WHERE id={SL}") == "07:00" and psql(f"SELECT inicio FROM teacher_slots WHERE version_id={V1} AND employee_id={E['Bruno']}") == "09:40" and psql(f"SELECT count(*) FROM teacher_slots WHERE version_id={V1}") == "6"
ok("correção de turma edita direto; mudar horário na grade em vigor cria o ajuste a partir de hoje — a vigência anterior fecha ontem e guarda o horário antigo")
erro(post("/cobertura/grade", aid_sal, {"id": SL, "employeeId": E["Bruno"], "unitId": CAR, "dia": 1, "inicio": "10:40", "fim": "11:30", "turma": "X", "voltar": "/cobertura/grade"}, CO), "Vigência encerrada não se edita")
h = page(f"/cobertura/grade?unidade={CAR}&versao={V0}", CO); assert "Vigência encerrada: só leitura" in h and "Incluir aula" not in h
ok("vigência encerrada é só leitura (nem pela tela nem por chamada direta)")

print("Rascunho, validação, ativação e comparador")
psql(f"INSERT INTO grade_versions (unit_id, nome, vigencia_inicio, status, origem, ativada_em) VALUES ({CUL}, 'Grade Cultura', '{d(-40)}', 'ATIVA', 'MANUAL', now())"); VC = psql(f"SELECT id FROM grade_versions WHERE unit_id={CUL}")
psql(f"INSERT INTO teacher_slots (employee_id, unit_id, dia_semana, inicio, fim, turno, turma, disciplina, version_id) VALUES ({E['Davi']}, {CUL}, 1, '07:00', '07:50', 'Matutino', 'Jardim II', 'Música', {VC})")
h = page(f"/cobertura/grade?unidade={CAR}", CO); aid_nv = aid_of(h, 'name="base"')
okmsg(post("/cobertura/grade", aid_nv, {"unitId": CAR, "nome": "Grade do mês que vem", "inicio": PROX.isoformat(), "base": "VIGENTE"}, CO), "Rascunho criado")
V2 = psql(f"SELECT id FROM grade_versions WHERE unit_id={CAR} AND status='RASCUNHO'"); assert psql(f"SELECT count(*) FROM teacher_slots WHERE version_id={V2}") == "6" and psql(f"SELECT copiada_de FROM grade_versions WHERE id={V2}") == V1
erro(post("/cobertura/grade", aid_nv, {"unitId": CAR, "nome": "Outra", "inicio": PROX.isoformat(), "base": "VIGENTE"}, CO), "Já existe um rascunho")
h = page(f"/cobertura/grade?unidade={CAR}&versao={V2}", CO); aid_sal = aid_of(h, "Incluir aula")
erro(post("/cobertura/grade", aid_sal, {"versaoId": V2, "employeeId": E["Davi"], "unitId": CAR, "dia": 1, "inicio": "07:20", "fim": "08:10", "turma": "1º ano A", "voltar": f"/cobertura/grade?unidade={CAR}&versao={V2}"}, CO), "em outra unidade")
okmsg(post("/cobertura/grade", aid_sal, {"versaoId": V2, "employeeId": E["Davi"], "unitId": CAR, "dia": 1, "inicio": "09:00", "fim": "09:50", "turma": "1º ano A", "disciplina": "Música", "voltar": f"/cobertura/grade?unidade={CAR}&versao={V2}"}, CO))
okmsg(post("/cobertura/grade", aid_sal, {"versaoId": V2, "employeeId": E["Carol"], "unitId": CAR, "dia": 4, "inicio": "10:00", "fim": "10:35", "turma": "3º ano A", "disciplina": "Inglês", "voltar": f"/cobertura/grade?unidade={CAR}&versao={V2}"}, CO))
assert psql(f"SELECT count(*) FROM teacher_slots WHERE version_id={V1} AND employee_id={E['Davi']}") == "0", "rascunho não mexe na grade em vigor"
psql(f"INSERT INTO teacher_slots (employee_id, unit_id, dia_semana, inicio, fim, turno, turma, version_id) VALUES ({E['Ana']}, {CAR}, 1, '07:10', '08:00', 'Matutino', '5º ano C', {V2})")
h = page(f"/cobertura/grade?unidade={CAR}&versao={V2}", CO); assert "Bloqueia:" in h and "fora das durações" in h and "Ativar vigência" not in h
CHOQUE = psql(f"SELECT id FROM teacher_slots WHERE version_id={V2} AND turma='5º ano C'")
okmsg(post("/cobertura/grade", aid_of(h, "Remover"), {"id": CHOQUE, "voltar": f"/cobertura/grade?unidade={CAR}&versao={V2}"}, CO))
h = page(f"/cobertura/grade?unidade={CAR}&versao={V2}", CO); assert "Bloqueia:" not in h and "Aviso:" in h; aid_at = aid_of(h, "Ativar vigência")
loc = post("/cobertura/grade", aid_at, {"versaoId": V2}, CO); okmsg(loc, "Vigência ativada"); assert f"/cobertura/grade/ch?versao={V2}" in loc
assert psql(f"SELECT vigencia_fim FROM grade_versions WHERE id={V1}") == (PROX - timedelta(days=1)).isoformat() and psql(f"SELECT status FROM grade_versions WHERE id={V2}") == "ATIVA"
assert psql("SELECT count(*) FROM notifications n JOIN users u ON u.id=n.user_id WHERE u.role='RH' AND n.titulo LIKE 'Grade nova em%'") != "0"
hc = page(f"/cobertura/grade/comparar?a={V1}&b={V2}", CO); assert "Davi Duas Unidades" in hc and "entrou" in hc and "Carol Docente" in hc and "→" in hc
ok("rascunho copia a grade em vigor; choque com aula de outra unidade bloqueia; duração fora do padrão avisa; com bloqueio não ativa; ativado, a anterior termina na véspera; RH avisado; comparador mostra o que entrou e a CH antes → depois")

print("Vigência com início no passado e mês fechado")
hcu = page(f"/cobertura/grade?unidade={CUL}", RH); aid_nv2 = aid_of(hcu, 'name="base"')
RETRO = INI_MES.isoformat() if HOJE.day > 1 else d(0)
okmsg(post("/cobertura/grade", aid_nv2, {"unitId": CUL, "nome": "Grade corrigida", "inicio": RETRO, "base": "VIGENTE"}, RH)); VR = psql(f"SELECT id FROM grade_versions WHERE unit_id={CUL} AND status='RASCUNHO'")
hv = page(f"/cobertura/grade?unidade={CUL}&versao={VR}", RH)
if RETRO < H:
    aid_at = aid_of(hv, "Ativar vigência"); erro(post("/cobertura/grade", aid_at, {"versaoId": VR}, RH), "justifique")
    okmsg(post("/cobertura/grade", aid_at, {"versaoId": VR, "justificativa": "Grade de outubro chegou atrasada da coordenação"}, RH), "Vigência ativada")
    assert psql(f"SELECT justificativa FROM grade_versions WHERE id={VR}") == "Grade de outubro chegou atrasada da coordenação" and psql(f"SELECT vigencia_fim FROM grade_versions WHERE id={VC}") == (INI_MES - timedelta(days=1)).isoformat()
psql(f"INSERT INTO timesheet_locks (unit_id, mes, status, fechado_por_nome) VALUES ({CUL}, '{MES_ANT}', 'FECHADO', 'RH')")
hcu = page(f"/cobertura/grade?unidade={CUL}", RH); aid_nv2 = aid_of(hcu, 'name="base"')
okmsg(post("/cobertura/grade", aid_nv2, {"unitId": CUL, "nome": "No mês fechado", "inicio": f"{MES_ANT}-15", "base": "VIGENTE"}, RH)); VF = psql(f"SELECT id FROM grade_versions WHERE unit_id={CUL} AND status='RASCUNHO'")
hv = page(f"/cobertura/grade?unidade={CUL}&versao={VF}", RH); loc = post("/cobertura/grade", aid_of(hv, "Ativar vigência"), {"versaoId": VF, "justificativa": "Tentativa dentro do mês fechado"}, RH)
erro(loc, "está fechado"); okmsg(post("/cobertura/grade", aid_of(hv, "Descartar rascunho"), {"versaoId": VF}, RH), "descartado")
assert psql(f"SELECT status FROM grade_versions WHERE id={VF}") == "DESCARTADA" and psql(f"SELECT count(*) FROM teacher_slots WHERE version_id={VF}") == "0"
ok("início no passado exige justificativa (e encerra a anterior na véspera); dentro de mês fechado não ativa; rascunho descartado some sem deixar aulas")

print("CH pela grade a partir da vigência")
hch = page(f"/cobertura/grade/ch?versao={V2}", RH)
linha = lambda nome: hch[hch.find(nome):hch.find("</tr>", hch.find(nome))]
assert "2h30 · 1h40 · 1h · — · — · —" in linha("Ana Docente") and "5h10" in linha("Ana Docente") and "8h48 · 8h48" in linha("Ana Docente"), linha("Ana Docente")[:600]
assert "2h50" in linha("Davi Duas Unidades") and "inclui aulas em outra unidade" in linha("Davi Duas Unidades"), "Davi: 07:00 (Cultura) a 09:50 (Carandá), janela conta"
page(f"/cobertura/grade/ch?versao={V2}", CO, expect=404)
aid_ch = aid_of(hch, "Aplicar a CH a partir de")
erro(post("/cobertura/grade/ch", aid_ch, {"versaoId": V2, "emp": [E["Ana"]]}, CO), "aplicada pelo RH")
okmsg(post("/cobertura/grade/ch", aid_ch, {"versaoId": V2, "emp": [E["Ana"], E["Bruno"]]}, RH), "aplicada a 2 professor(es)")
assert psql(f"SELECT coalesce(vigencia_fim::text,'-') FROM schedules WHERE employee_id={E['Ana']} AND vigencia_inicio='2024-01-10'") == (PROX - timedelta(days=1)).isoformat()
assert psql(f"SELECT seg || '|' || ter || '|' || qua || '|' || qui || '|' || sex FROM schedules WHERE employee_id={E['Ana']} AND vigencia_inicio='{PROX.isoformat()}'") == "150|100|60|0|0"
assert psql(f"SELECT horarios FROM schedules WHERE employee_id={E['Ana']} AND vigencia_inicio='{PROX.isoformat()}'").startswith("Seg 07:00–09:30 · Ter 07:00–07:50 e 13:00–13:50")
assert psql(f"SELECT jornada_min_dia FROM employees WHERE id={E['Ana']}") == "62" and psql(f"SELECT count(*) FROM schedules WHERE employee_id={E['Carol']}") == "0"
assert psql(f"SELECT ch_aplicada_em IS NOT NULL FROM grade_versions WHERE id={V2}") == "t" and psql("SELECT count(*) FROM audit_log WHERE acao='aplicar CH da grade'") == "2"
ok("CH pela grade: janela conta (seg 07:00–09:30), almoço não (ter 50 + 50 min), plantão conta; aulas em duas unidades somam; só RH/Direção/diretora aplicam, só a quem marcar; a jornada anterior termina na véspera da vigência")
mondays = [x for x in (INI_MES + timedelta(days=k) for k in range(31)) if x.month == INI_MES.month and x < HOJE and x.weekday() == 0 and x.isoformat() >= RETRO]
if RETRO < H and mondays:
    hch2 = page(f"/cobertura/grade/ch?versao={VR}", RH); okmsg(post("/cobertura/grade/ch", aid_of(hch2, "Aplicar a CH a partir de"), {"versaoId": VR, "emp": [E["Davi"]]}, RH), "aplicada a 1")
    for m in mondays: psql(f"INSERT INTO timesheet_days (employee_id, data, esperado_min, trabalhado_min, status, origem) VALUES ({E['Davi']}, '{m.isoformat()}', 528, 528, 'NORMAL', 'IMPORTACAO')")
    psql(f"INSERT INTO timesheet_locks (unit_id, mes, status, fechado_por_nome) VALUES ({CUL}, '{MES}', 'FECHADO', 'RH')")
    hch2 = page(f"/cobertura/grade/ch?versao={VR}", RH); aid_rc = aid_of(hch2, "Recalcular CH dos dias lançados")
    okmsg(post("/cobertura/grade/ch", aid_rc, {"versaoId": VR}, RH), "em mês fechado ficaram intactos"); assert psql(f"SELECT DISTINCT esperado_min FROM timesheet_days WHERE employee_id={E['Davi']}") == "528"
    psql(f"DELETE FROM timesheet_locks WHERE unit_id={CUL} AND mes='{MES}'")
    okmsg(post("/cobertura/grade/ch", aid_rc, {"versaoId": VR}, RH), f"{len(mondays)} dia(s) recalculado(s) em 1 professor(es)")
    assert psql(f"SELECT DISTINCT esperado_min FROM timesheet_days WHERE employee_id={E['Davi']}") == "50" and psql(f"SELECT count(*) FROM hour_entries WHERE employee_id={E['Davi']} AND minutos=478") == str(len(mondays))
    ok("recálculo dos dias já lançados com a CH da vigência: mês fechado fica intacto; aberto, a CH e o banco de horas do dia são refeitos")

print("Auditoria do ponto")
ANT = date.fromisoformat(f"{MES_ANT}-01"); FER = set(psql(f"SELECT data FROM calendar_days WHERE data BETWEEN '{MES_ANT}-01' AND '{MES_ANT}-28'::date + 3").splitlines())
uteis = [x for x in (ANT + timedelta(days=k) for k in range(31)) if x.month == ANT.month and x.weekday() < 5 and x.isoformat() not in FER][:10]; sab = next(x for x in (ANT + timedelta(days=k) for k in range(31)) if x.weekday() == 5)
DIA = {"ok": uteis[0], "atraso": uteis[1], "saida": uteis[2], "tol": uteis[3], "he": uteis[4], "impar": uteis[5], "sem": uteis[6], "atest": uteis[7], "ch": uteis[8], "sab": sab}
lin = {"ok": (480, 480, "NORMAL", "08:00 12:00 13:00 17:00"), "atraso": (480, 440, "NORMAL", "08:40 12:00 13:00 17:00"), "saida": (480, 450, "NORMAL", "08:00 12:00 13:00 16:30"), "tol": (480, 485, "NORMAL", "07:58 12:00 13:00 17:03"),
       "he": (480, 540, "NORMAL", "08:00 12:00 13:00 18:00"), "impar": (480, 240, "NORMAL", "08:00 12:00 13:00"), "sem": (480, 0, "NORMAL", None), "atest": (0, 0, "ATESTADO", None), "ch": (420, 420, "NORMAL", "08:00 12:00 13:00 16:00"), "sab": (0, 120, "NORMAL", "08:00 10:00")}
for k, (esp, trab, st, marc) in lin.items():
    psql(f"INSERT INTO timesheet_days (employee_id, data, esperado_min, trabalhado_min, status, marcacoes, origem) VALUES ({E['Eva']}, '{DIA[k].isoformat()}', {esp}, {trab}, '{st}', {('NULL' if marc is None else repr(marc))}, 'IMPORTACAO')")
TD = {k: psql(f"SELECT id FROM timesheet_days WHERE employee_id={E['Eva']} AND data='{DIA[k].isoformat()}'") for k in DIA}
psql(f"INSERT INTO hour_entries (employee_id, data, minutos, tipo, descricao, status, timesheet_day_id) VALUES ({E['Eva']}, '{DIA['atraso'].isoformat()}', -40, 'ATRASO', 'Ponto (importado)', 'PENDENTE', {TD['atraso']})"); HE_ATR = psql(f"SELECT id FROM hour_entries WHERE timesheet_day_id={TD['atraso']}")
r = CO.get(B + f"/ponto/auditoria?mes={MES_ANT}", allow_redirects=False); assert r.status_code in (303, 307), r.status_code
assert psql("SELECT count(*) FROM audit_log WHERE acao='acesso negado: auditoria do ponto'") == "1"
ha = page(f"/ponto/auditoria?mes={MES_ANT}", RH); assert "Ainda não processada" in ha
okmsg(post("/ponto/auditoria", aid_of(ha, "Processar o mês"), {"mes": MES_ANT, "voltar": f"/ponto/auditoria?mes={MES_ANT}"}, RH), "9 divergência(s) nova(s)")
tipos = dict(l.split("|") for l in psql(f"SELECT data || ':' || tipo, minutos FROM timesheet_audit WHERE employee_id={E['Eva']}").splitlines())
esperado = {f"{DIA['atraso']}:ATRASO": "40", f"{DIA['saida']}:SAIDA_ANTECIPADA": "30", f"{DIA['he']}:HORA_EXTRA": "60", f"{DIA['impar']}:MARCACAO_IMPAR": "0", f"{DIA['impar']}:SAIDA_ANTECIPADA": "240",
            f"{DIA['sem']}:SEM_MARCACAO": "480", f"{DIA['atest']}:ATESTADO_SEM_DOC": "0", f"{DIA['ch']}:CH_DIVERGENTE": "-60", f"{DIA['sab']}:TRABALHO_SEM_ESCALA": "120"}
assert tipos == esperado, tipos
ok("divergências tipificadas: atraso (entrada 08:40), saída antecipada (16:30), hora extra, erro de marcação, dia sem marcação, atestado sem documento, CH do relógio ≠ jornada, trabalho no sábado; 5 min de diferença fica na tolerância")
hp = page(f"/ponto?mes={MES_ANT}", RH); assert "9 divergência(s) da auditoria em aberto" in hp
erro(post("/ponto", aid_of(hp, "Fechar com ressalva"), {"unitId": CAR, "mes": MES_ANT, "voltar": f"/ponto?mes={MES_ANT}"}, RH), "divergência(s) da auditoria do ponto em aberto")
ok("divergências abertas entram nas pendências do fechamento do mês")
DV = {f"{l.split('|')[0]}:{l.split('|')[1]}": l.split("|")[2] for l in psql(f"SELECT data, tipo, id FROM timesheet_audit WHERE employee_id={E['Eva']}").splitlines()}
gid = lambda k, t: DV[f"{DIA[k].isoformat()}:{t}"]
ha = page(f"/ponto/auditoria?mes={MES_ANT}", RH); assert "Aceitar marcadas em lote" in ha
loc = post("/ponto/auditoria", aid_of(ha, "Aceitar marcadas em lote"), {"ids": [gid("atraso", "ATRASO"), gid("saida", "SAIDA_ANTECIPADA"), gid("he", "HORA_EXTRA"), gid("impar", "MARCACAO_IMPAR")], "voltar": f"/ponto/auditoria?mes={MES_ANT}"}, RH)
okmsg(loc, "3 aceita(s) em lote"); assert "1 ficaram para decisão individual" in loc
assert psql(f"SELECT hour_entry_id FROM timesheet_audit WHERE id={gid('atraso', 'ATRASO')}") == HE_ATR, "aceite liga o lançamento do dia"
assert psql(f"SELECT minutos || '|' || status || '|' || lote FROM hour_entries WHERE id=(SELECT hour_entry_id FROM timesheet_audit WHERE id={gid('saida', 'SAIDA_ANTECIPADA')})") == "-30|PENDENTE|AUDITORIA"
assert psql(f"SELECT minutos FROM hour_entries WHERE id=(SELECT hour_entry_id FROM timesheet_audit WHERE id={gid('he', 'HORA_EXTRA')})") == "60"
ok("lote aceita só atraso, saída e hora extra (vira lançamento PENDENTE para aprovação, ligado ao do dia quando já existe); erro de marcação fica para decisão individual")
ha = page(f"/ponto/auditoria?mes={MES_ANT}", RH); aid_dec = aid_of(ha, 'name="acao" value="DEVOLVER"')
erro(post("/ponto/auditoria", aid_dec, {"id": gid("impar", "MARCACAO_IMPAR"), "acao": "DEVOLVER", "obs": "x"}, RH), "corrigido no relógio")
okmsg(post("/ponto/auditoria", aid_dec, {"id": gid("impar", "MARCACAO_IMPAR"), "acao": "DEVOLVER", "obs": "Faltou a batida de saída da tarde"}, RH), "Devolvida ao relógio")
psql(f"UPDATE timesheet_days SET marcacoes='08:00 12:00 13:00 17:00', trabalhado_min=480 WHERE id={TD['impar']}")
ha = page(f"/ponto/auditoria?mes={MES_ANT}", RH); okmsg(post("/ponto/auditoria", aid_of(ha, "Processar o mês"), {"mes": MES_ANT, "voltar": f"/ponto/auditoria?mes={MES_ANT}"}, RH), "2 resolvida(s) na reimportação")
assert psql(f"SELECT string_agg(status, ',' ORDER BY tipo) FROM timesheet_audit WHERE employee_id={E['Eva']} AND data='{DIA['impar']}'") == "RESOLVIDA,RESOLVIDA"
ok("devolver ao relógio pede o que corrigir; a reimportação corrigida resolve a marcação ímpar e o déficit do dia")
erro(post("/ponto/auditoria", aid_dec, {"id": gid("ch", "CH_DIVERGENTE"), "acao": "ACEITAR", "obs": "ok"}, RH), "Justifique")
erro(post("/ponto/auditoria", aid_dec, {"id": gid("ch", "CH_DIVERGENTE"), "acao": "DEVOLVER", "obs": "Corrigir"}, RH), "não se aplica")
okmsg(post("/ponto/auditoria", aid_dec, {"id": gid("ch", "CH_DIVERGENTE"), "acao": "CORRIGIR_CH"}, RH), "CH do dia corrigida")
assert psql(f"SELECT esperado_min FROM timesheet_days WHERE id={TD['ch']}") == "480" and psql(f"SELECT minutos FROM hour_entries WHERE timesheet_day_id={TD['ch']}") == "-60"
assert psql(f"SELECT status FROM timesheet_audit WHERE id={gid('ch', 'CH_DIVERGENTE')}") == "CORRIGIDA"
ok("CH divergente: manter exige justificativa; corrigir aplica a CH da jornada ao dia e refaz o banco de horas (−1h)")
erro(post("/ponto/auditoria", aid_of(ha, "Anexar"), {"id": gid("atest", "ATESTADO_SEM_DOC")}, DU, files=[("arquivo", ("atestado.pdf", b"%PDF-1.4 atestado", "application/pdf"))]), "RH ou pela Direção")
okmsg(post("/ponto/auditoria", aid_of(ha, "Anexar"), {"id": gid("atest", "ATESTADO_SEM_DOC"), "voltar": f"/ponto/auditoria?mes={MES_ANT}"}, RH, files=[("arquivo", ("atestado.pdf", b"%PDF-1.4 atestado", "application/pdf"))]), "Atestado anexado")
AX = psql(f"SELECT id FROM attachments WHERE entidade='timesheet_day' AND entidade_id={TD['atest']}"); assert AX and psql(f"SELECT status FROM timesheet_audit WHERE id={gid('atest', 'ATESTADO_SEM_DOC')}") == "ABONADA"
assert RH.get(B + f"/api/anexos/{AX}").status_code == 200 and DU.get(B + f"/api/anexos/{AX}").status_code == 403 and AN.get(B + f"/api/anexos/{AX}").status_code == 403
assert "atestado.pdf" not in psql(f"SELECT depois::text FROM audit_log WHERE acao='auditoria do ponto: anexar atestado'")
ok("atestado: só RH/Direção anexam; documento restrito (diretora e terceiros não baixam); trilha sem o nome do arquivo")
okmsg(post("/ponto/auditoria", aid_dec, {"id": gid("sem", "SEM_MARCACAO"), "acao": "DEVOLVER", "obs": "Sem batidas: confirmar presença"}, RH))
okmsg(post("/ponto/auditoria", aid_dec, {"id": gid("sab", "TRABALHO_SEM_ESCALA"), "acao": "ACEITAR", "obs": "Mutirão da feira"}, RH), "Aceita")
assert psql(f"SELECT minutos || '|' || status FROM hour_entries WHERE id=(SELECT hour_entry_id FROM timesheet_audit WHERE id={gid('sab', 'TRABALHO_SEM_ESCALA')})") == "120|PENDENTE"
csv = RH.get(B + f"/api/export/auditoria-ponto?mes={MES_ANT}").content.decode("utf-8-sig"); assert "colaborador" in csv.splitlines()[0] and "Eva Secretaria" in csv and "Atraso" in csv and "devolvida ao relógio" in csv
assert DU.get(B + f"/api/export/auditoria-ponto?mes={MES_ANT}").status_code == 200 and CO.get(B + f"/api/export/auditoria-ponto?mes={MES_ANT}").status_code in (302, 303, 307, 403)
ha = page(f"/ponto/auditoria?mes={MES_ANT}&situacao=todas", RH); assert "Resumo por colaborador" in ha and "Eva Secretaria" in ha
ok("trabalho sem jornada aceito vira crédito para aprovação; planilha da auditoria exportável (RH e diretora; coordenação não)")

print("Jornada que cobre mês fechado")
psql(f"INSERT INTO timesheet_locks (unit_id, mes, status, fechado_por_nome) VALUES ({CAR}, '{MES_ANT}', 'FECHADO', 'RH')")
hj = page(f"/ponto/jornadas?colaborador={E['Eva']}&q=", RH); aid_j = aid_of(hj, "Salvar jornada"); aid_x = aid_of(hj, ">excluir<")
JE = psql(f"SELECT id FROM schedules WHERE employee_id={E['Eva']}")
erro(post("/ponto/jornadas", aid_x, {"id": JE, "voltar": f"/ponto/jornadas?colaborador={E['Eva']}"}, RH), "está fechado")
dados_j = {"employeeId": E["Eva"], "seg": "8:00", "ter": "8:00", "qua": "8:00", "qui": "8:00", "sex": "8:00", "sab": "0:00", "dom": "0:00", "voltar": f"/ponto/jornadas?colaborador={E['Eva']}"}
erro(post("/ponto/jornadas", aid_j, {**dados_j, "vigenciaInicio": f"{MES_ANT}-20"}, RH), "está fechado")
okmsg(post("/ponto/jornadas", aid_j, {**dados_j, "vigenciaInicio": H}, RH), "Jornada salva")
ok("jornada que cobre mês fechado não é excluída nem recebe vigência dentro dele; a nova vigência a partir de hoje entra")

print(f"\ne2e_grade_ponto: todas as verificações OK ({N[0]} blocos)")
