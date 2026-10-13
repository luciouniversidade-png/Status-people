# E2E — Mapa de salas e reservas de espaços (v22): cadastro com capacidade (informada ou pela área), mapa sala × turno ligado às
# turmas de Matrículas (choque, vagas e alunos acima da capacidade, turmas sem sala), reservas sem conflito (inclusive com aulas fixas
# da grade), repetição semanal tudo-ou-nada, reservas simultâneas, cancelamento de série, escopo e permissões.
import re, subprocess, requests, threading
from datetime import datetime, timedelta
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
D = HOJE + timedelta(days=1)
while D.isoweekday() > 5: D += timedelta(days=1)
DI = D.isoformat(); W = D.isoweekday()

print("Preparação")
login(S, "rh@colegiostatus", "Status2026!"); r = S.get(B + f"/api/setup?token={TOKEN}"); assert r.json()["ok"], r.text
CAR, CUL = (psql(f"SELECT id FROM units WHERE codigo='{c}'") for c in ["CAR", "CUL"])
psql(f"INSERT INTO employees (nome, unit_id, vinculo, admissao, regime) VALUES ('Paula Professora', {CAR}, 'CLT', '2024-02-01', 'DOCENTE'), ('Edu Física', {CAR}, 'CLT', '2024-02-01', 'DOCENTE')")
PROF, EDU = (psql(f"SELECT id FROM employees WHERE nome='{n}'") for n in ["Paula Professora", "Edu Física"])
html = page("/configuracoes"); aid_user = aid_of(html, "Criar acesso")
def criar_user(nome, email, role, unit="", emp=""):
    post("/configuracoes", aid_user, {"nome": nome, "email": email, "role": role, "unitId": unit, "employeeId": emp, "senha": "senha12345"}); return psql(f"SELECT id FROM users WHERE email='{email}'")
criar_user("Operações", "ops@rede", "OPERACOES"); criar_user("Diretora Carandá", "dir@car", "DIRETOR_UNIDADE", CAR); criar_user("Gestor Cultura", "ges@cul", "GESTOR", CUL); criar_user("Paula", "paula@car", "COLABORADOR", "", PROF); criar_user("Leitura", "lei@rede", "LEITURA")
OP = mk(); login(OP, "ops@rede", "senha12345"); DS = mk(); login(DS, "dir@car", "senha12345"); GC = mk(); login(GC, "ges@cul", "senha12345"); PS = mk(); login(PS, "paula@car", "senha12345"); LS = mk(); login(LS, "lei@rede", "senha12345")
ok(f"perfis de operações, direção, gestão, professora (autoatendimento) e leitura; dia de teste {DI}")

print("Cadastro de espaços")
html = page("/operacoes/espacos/cadastro", sess=OP); aid_esp = aid_of(html, "Cadastrar espaço")
def esp(nome, tipo, cap="", area="", res="0", unit=CAR, sess=OP): return post("/operacoes/espacos/cadastro", aid_esp, {"unitId": unit, "nome": nome, "tipo": tipo, "capacidade": cap, "areaM2": area, "reservavel": res, "ativo": "1", "voltar": "/operacoes/espacos/cadastro"}, sess=sess)
for args in [("Sala 1", "SALA", "20"), ("Sala 2", "SALA", "", "24"), ("Sala 3", "SALA", "30"), ("Laboratório", "LABORATORIO", "30", "", "1"), ("Quadra", "QUADRA", "", "", "1"), ("Projetor 1", "EQUIPAMENTO", "1", "", "1")]: okmsg(esp(*args), "salvo")
okmsg(esp("Sala A", "SALA", "18", unit=CUL), "salvo")
erro(esp("sala 1", "SALA", "20"), "Já existe"); erro(esp("Sala 9", "SALA", "0"), "Capacidade"); erro(esp("Sala 9", "XYZ", "10"), "Tipo inválido"); erro(esp("Sala 9", "SALA", "10", sess=GC), "Sem acesso")
assert page("/operacoes/espacos/cadastro", expect=307, sess=PS) is not None
html = page("/operacoes/espacos/cadastro", sess=OP); assert "pela área" in html
S1, S2, S3, LAB, QUA, PRJ, SA = (psql(f"SELECT id FROM spaces WHERE nome='{n}'") for n in ["Sala 1", "Sala 2", "Sala 3", "Laboratório", "Quadra", "Projetor 1", "Sala A"])
ok("7 espaços; nome repetido, capacidade zero, tipo inválido e unidade fora do escopo recusados; capacidade da Sala 2 vem da área (24 m² ÷ 1,2)")

print("Mapa de salas × turno")
C = lambda nome, unit=CAR: psql(f"SELECT id FROM classes WHERE ano=2027 AND unit_id={unit} AND nome='{nome}'")
MA, MB, J1A, A1A, A1B = C("Maternal A"), C("Maternal B"), C("Jardim I A"), C("1º ano A"), C("1º ano B")
html = page(f"/operacoes/espacos?unidade={CAR}", sess=OP); aid_sala = aid_of(html, "Ligar"); total_car = int(psql(f"SELECT count(*) FROM classes WHERE ano=2027 AND unit_id={CAR}"))
assert f"Turmas de 2027 sem sala ({total_car})" in html
V = f"/operacoes/espacos?unidade={CAR}"
okmsg(post("/operacoes/espacos", aid_sala, {"classId": MA, "spaceId": S1, "voltar": V}, sess=OP), "Maternal A → Sala 1")
okmsg(post("/operacoes/espacos", aid_sala, {"classId": MB, "spaceId": S1, "voltar": V}, sess=OP), "Maternal B → Sala 1")
erro(post("/operacoes/espacos", aid_sala, {"classId": J1A, "spaceId": S1, "voltar": V}, sess=OP), "já está com a turma Maternal A no turno matutino")
erro(post("/operacoes/espacos", aid_sala, {"classId": J1A, "spaceId": SA, "voltar": V}, sess=OP), "mesma unidade")
erro(post("/operacoes/espacos", aid_sala, {"classId": J1A, "spaceId": PRJ, "voltar": V}, sess=OP), "Equipamento")
erro(post("/operacoes/espacos", aid_sala, {"classId": J1A, "spaceId": S3, "voltar": V}, sess=GC), "Sem acesso")
okmsg(post("/operacoes/espacos", aid_sala, {"classId": A1A, "spaceId": S2, "voltar": V}, sess=DS), "1º ano A → Sala 2")
html = page(V, sess=OP); assert "1º ano A: 22 vagas ofertadas para 20 lugares" in html and f"Turmas de 2027 sem sala ({total_car - 3})" in html
ht = page(f"/matriculas/turmas/{A1A}", sess=DS); assert "sala <b>Sala 2</b> (cabem 20)" in ht and "A turma tem 22 vagas, mas a sala Sala 2 comporta 20 aluno(s) (pela área)" in ht, ht[ht.find("<main"):][:1500]
assert "sem sala definida" in page(f"/matriculas/turmas/{A1B}", sess=DS)
psql("INSERT INTO students (nome) SELECT 'Lot ' || g FROM generate_series(1, 21) g"); psql(f"INSERT INTO enrollments (student_id, class_id, ano, status, confirmada_em) SELECT id, {A1A}, 2027, 'CONFIRMADA', now() FROM students WHERE nome LIKE 'Lot %'")
html = page(V, sess=OP); assert "1º ano A: 21 alunos para 20 lugares" in html
psql(f"UPDATE classes SET space_id={S3} WHERE id={J1A}"); psql(f"UPDATE classes SET space_id={S3} WHERE id={A1B}")
html = page(V, sess=OP); assert "Matutino: 2 turmas na mesma sala" not in html  # Jardim I A (M) e 1º ano B (V) não chocam
psql(f"UPDATE classes SET space_id={S3} WHERE id={C('Jardim II A')}"); html = page(V, sess=OP); assert "Matutino: 2 turmas na mesma sala (Jardim I A, Jardim II A)" in html
ok("mapa: mesma sala em turnos diferentes ok; a página da turma mostra a sala e avisa vagas acima da capacidade; choque no turno, sala de outra unidade, equipamento e gestor de fora recusados; alertas de vagas e de alunos acima da capacidade e de choque gravado por fora")

print("Reservas sem conflito")
html = page(f"/operacoes/espacos/reservas?espaco={LAB}", sess=PS); aid_res = aid_of(html, ">Reservar<")
RV = "/operacoes/espacos/reservas"
def reserva(sess, sp, data, ini, fim, titulo="Aula prática", sem=0): return post(RV, aid_res, {"spaceId": sp, "data": data, "inicio": ini, "fim": fim, "titulo": titulo, "repetirSemanas": sem, "voltar": RV}, sess=sess)
okmsg(reserva(PS, LAB, DI, "09:00", "10:40"), "Laboratório reservado")
erro(reserva(DS, LAB, DI, "10:00", "11:00"), "Conflito — nada foi reservado"); okmsg(reserva(DS, LAB, DI, "10:40", "11:30", "Feira de ciências"), "reservado")
erro(reserva(PS, LAB, (HOJE - timedelta(days=1)).isoformat(), "09:00", "10:00"), "passado"); erro(reserva(PS, LAB, DI, "11:00", "10:00"), "Horário inválido"); erro(reserva(PS, S1, DI, "09:00", "10:00"), "não está disponível")
erro(reserva(GC, LAB, DI, "13:00", "14:00"), "Sem acesso"); erro(reserva(LS, LAB, DI, "13:00", "14:00"), "somente leitura"); erro(reserva(PS, LAB, DI, "13:00", "14:00", ""), "para que")
psql(f"INSERT INTO teacher_slots (employee_id, unit_id, dia_semana, inicio, fim, turno, turma, disciplina, space_id) VALUES ({EDU}, {CAR}, {W}, '08:00', '08:50', 'Matutino', '5º ano A', 'Educação Física', {QUA})")
erro(reserva(DS, QUA, DI, "08:30", "09:00", "Ensaio"), "aula da grade 5º ano A · Educação Física")
erro(reserva(DS, QUA, DI, "08:40", "09:10", "Ensaio", 3), "nada foi reservado")
assert psql(f"SELECT count(*) FROM space_bookings WHERE space_id={QUA}") == "0"
okmsg(reserva(DS, QUA, DI, "14:00", "15:00", "Treino do time", 3), "e mais 3 semana(s)")
assert psql(f"SELECT count(*) || '|' || count(DISTINCT grupo) FROM space_bookings WHERE space_id={QUA}") == "4|1"
h = page(f"/operacoes/espacos/reservas?espaco={QUA}&semana={DI}", sess=PS); assert "Treino do time" in h and "aula fixa · Edu Física" in h
ok("reserva: conflito barrado, horário encostado permitido; passado, horário inválido, espaço sem reserva, outra unidade, leitura e sem finalidade recusados; aula fixa da grade conta como ocupação; repetição semanal tudo-ou-nada")

print("Reservas simultâneas (trava)")
DJ = (D + timedelta(days=14)).isoformat(); res = []
def tenta(sess, t): res.append(reserva(sess, PRJ, DJ, "07:00", "08:00", t))
t1 = threading.Thread(target=tenta, args=(PS, "Projeção A")); t2 = threading.Thread(target=tenta, args=(DS, "Projeção B")); t1.start(); t2.start(); t1.join(); t2.join()
assert sum("ok=" in x for x in res) == 1 and sum("Conflito" in x for x in res) == 1, res
assert psql(f"SELECT count(*) FROM space_bookings WHERE space_id={PRJ} AND data='{DJ}'") == "1"
# 10 pedidos ao mesmo tempo (mais que as 5 conexões do banco): ninguém fica preso esperando conexão; um só consegue
DK = (D + timedelta(days=21)).isoformat(); res = []; sess10 = []
for k in range(10): x = mk(); login(x, "paula@car", "senha12345"); sess10.append(x)
import time as _t; t0 = _t.time(); ths = [threading.Thread(target=lambda x=x, k=k: res.append(reserva(x, PRJ, DK, "09:00", "10:00", f"Projeção {k}"))) for k, x in enumerate(sess10)]
[t.start() for t in ths]; [t.join(timeout=60) for t in ths]
assert len(res) == 10 and _t.time() - t0 < 45, (len(res), _t.time() - t0)
assert sum("ok=" in x for x in res) == 1 and sum("Conflito" in x for x in res) == 9, res
assert psql(f"SELECT count(*) FROM space_bookings WHERE space_id={PRJ} AND data='{DK}'") == "1"
ok("duas pessoas reservando o mesmo projetor ao mesmo tempo: só uma consegue; 10 pedidos simultâneos terminam sem travar o sistema")

print("Cancelamentos")
h = page(RV, sess=PS); aid_can = aid_of(h, "Cancelar reserva")
RD = psql(f"SELECT id FROM space_bookings WHERE titulo='Feira de ciências'"); RP = psql(f"SELECT id FROM space_bookings WHERE titulo='Aula prática'")
erro(post(RV, aid_can, {"id": RD, "voltar": RV}, sess=PS), "Só quem reservou")
okmsg(post(RV, aid_can, {"id": RP, "motivo": "turma em prova", "voltar": RV}, sess=PS), "1 reserva(s) cancelada(s)")
SEG = psql(f"SELECT id FROM space_bookings WHERE space_id={QUA} ORDER BY data OFFSET 1 LIMIT 1")
okmsg(post(RV, aid_can, {"id": SEG, "serie": "1", "voltar": RV}, sess=DS), "3 reserva(s) cancelada(s)")
assert psql(f"SELECT count(*) FROM space_bookings WHERE space_id={QUA} AND status='CONFIRMADA'") == "1"
okmsg(post(RV, aid_can, {"id": RD, "voltar": RV}, sess=OP), "1 reserva(s)")
okmsg(reserva(PS, LAB, DI, "09:00", "10:00", "Remarcada"), "reservado")
ok("só quem reservou (ou operações) cancela; série semanal cancelada a partir da ocorrência escolhida; horário liberado pode ser reservado de novo")

print(f"\nE2E Mapa de salas e reservas: {N[0]} verificações OK")
