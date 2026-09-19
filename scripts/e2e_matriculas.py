import re, sys, subprocess, requests
B = "http://localhost:3100"
PSQL = ["su", "postgres", "-c", "/usr/lib/postgresql/16/bin/psql -h /tmp/pg -U status -d status_people -q -t -c \"{}\""]
def psql(q): return subprocess.run(["su", "postgres", "-c", f"/usr/lib/postgresql/16/bin/psql -h /tmp/pg -U status -d status_people -q -t -c \"{q}\""], capture_output=True, text=True).stdout.strip()

def mk(): s = requests.Session(); s.headers.update({"Origin": B}); return s
S = mk()
def action_ids(html):
    i = html.find("<main"); body = html[i:] if i >= 0 else html
    return re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', body)
def fix_cookie(sess, r):
    m = re.search(r"rh_session=([^;]+)", r.headers.get("set-cookie", ""))
    if m: sess.headers["Cookie"] = f"rh_session={m.group(1)}"
def page(path, expect=200, sess=None):
    sess = sess or S; r = sess.get(B + path, allow_redirects=False)
    assert r.status_code == expect, (path, r.status_code, r.headers.get("location")); return re.sub(r"<script[^>]*>.*?</script>", "", r.text, flags=re.S)
def post(path, aid, data, sess=None):
    sess = sess or S; files = {f"$ACTION_ID_{aid}": (None, "")}
    for k, v in data.items(): files[k] = (None, str(v))
    r = sess.post(B + path, files=files, allow_redirects=False); fix_cookie(sess, r)
    assert r.status_code in (303, 302, 200), (path, r.status_code, r.text[:300]); return r.headers.get("location", "")
def find_form_aid(html, marker, occurrence=0):
    i = -1
    for _ in range(occurrence + 1): i = html.find(marker, i + 1)
    assert i >= 0, marker
    fs = html.rfind("<form", 0, i); fe_prev = html.rfind("</form>", 0, i)
    if fs > fe_prev:  # marcador dentro de um form
        fe = html.find("</form>", i)
    else:             # marcador é um título: usa o primeiro form depois dele
        fs = html.find("<form", i); fe = html.find("</form>", fs)
    ids = action_ids(html[fs:fe]); assert ids, ("no action id near", marker); return ids[0]
def login(sess, email, senha):
    html = sess.get(B + "/login").text; aid = re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', html)[0]
    loc = post("/login", aid, {"email": email, "senha": senha}, sess=sess); assert loc.endswith("/"), loc
def unq(loc): return requests.utils.unquote(loc)

# ---- setup (cria tabelas novas e carrega grade 2027)
login(S, "rh@colegiostatus", "Status2026!"); r = S.get(B + "/api/setup?token=setup-homologacao-2026-status"); assert r.json()["ok"], r.text; print("setup:", r.json()["mensagens"])

# ---- painel e turmas
html = page("/matriculas"); assert "Painel de vagas 2027" in html and ">1732<" in html, "total regular 1732"; print("painel ok (1732 vagas regular)")
html = page("/matriculas/turmas"); n = len(re.findall(r'href="/matriculas/turmas/\d+"', html)); assert n == 92, n; print("turmas 2027 ok (92)")
html = page("/matriculas?modalidade=INTEGRAL"); assert ">326<" in html; print("integral 326 ok")

# ---- alunos
html = page("/matriculas/alunos/novo"); aid = action_ids(html)[0]
def novo_aluno(nome, **kw):
    loc = post("/matriculas/alunos/novo", aid, {"nome": nome, **kw}); m = re.search(r"/matriculas/alunos/(\d+)\?ok=", loc); assert m, loc; return m.group(1)
A = novo_aluno("Ana Teste", responsavel="Carla", telefone="67 9", dataNascimento="2020-05-10")
Bs = novo_aluno("Bruno Teste"); C = novo_aluno("Caio Teste"); D = novo_aluno("Duda Teste")
print("alunos criados", A, Bs, C, D)

# ---- reserva na ficha (turma com vagas)
html = page(f"/matriculas/alunos/{A}"); aid = find_form_aid(html, "Reservar vaga / matricular")
mat_a = re.search(r'<option value="(\d+)">Carandá · Maternal A · Matutino \(15 livres\)</option>', html).group(1)
loc = post(f"/matriculas/alunos/{A}", aid, {"studentId": A, "classId": mat_a, "voltar": f"/matriculas/alunos/{A}", "prazoDias": 3}); assert "Vaga reservada" in unq(loc), unq(loc); print("reserva ok")
loc = post(f"/matriculas/alunos/{A}", aid, {"studentId": A, "classId": mat_a, "voltar": f"/matriculas/alunos/{A}", "prazoDias": 3}); assert "já tem reserva" in unq(loc), unq(loc); print("reserva duplicada bloqueada ok")
html = page("/matriculas"); assert ">1<" in html  # reservas ativas

# ---- turma pequena (1 vaga) para testar lotação e fila
html = page("/matriculas/turmas"); aid = find_form_aid(html, "Nova turma")
car = re.search(r'<option value="(\d+)">Carandá</option>', html).group(1); g5 = re.search(r'<option value="(\d+)">5º ano</option>', html).group(1)
loc = post("/matriculas/turmas", aid, {"ano": 2027, "unitId": car, "modalidade": "REGULAR", "gradeId": g5, "turno": "Matutino", "nome": "5º ano TESTE", "vagas": 1, "status": "ABERTA"}); assert "ok=" in loc, loc
html = page("/matriculas/turmas"); tid = re.search(r'href="/matriculas/turmas/(\d+)">5º ano TESTE<', html).group(1); print("turma teste", tid)
html = page(f"/matriculas/turmas/{tid}"); aid = find_form_aid(html, "Reservar vaga / matricular")
loc = post(f"/matriculas/turmas/{tid}", aid, {"studentId": Bs, "classId": tid, "voltar": f"/matriculas/turmas/{tid}"}); assert "Vaga reservada" in unq(loc), unq(loc)
loc = post(f"/matriculas/turmas/{tid}", aid, {"studentId": C, "classId": tid, "voltar": f"/matriculas/turmas/{tid}"}); assert "lotada" in unq(loc), unq(loc); print("lotação bloqueia ok")
loc = post(f"/matriculas/turmas/{tid}", aid, {"studentId": C, "classId": tid, "voltar": f"/matriculas/turmas/{tid}", "excecao": "teste"}); assert "exige autorização" in unq(loc), unq(loc); print("exceção sem alçada bloqueada ok (RH)")
html = page(f"/matriculas/turmas/{tid}"); assert "lotada" in html

# ---- fila: C entra; cancelar B → oferta automática a C; converter → reserva
html = page(f"/matriculas/alunos/{C}"); aid = find_form_aid(html, "Entrar na lista de espera")
loc = post(f"/matriculas/alunos/{C}", aid, {"studentId": C, "voltar": f"/matriculas/alunos/{C}", "ano": 2027, "unitId": car, "gradeId": g5, "turno": "Matutino", "modalidade": "REGULAR"}); assert "incluído na lista" in unq(loc), unq(loc); print("fila ok")
html = page(f"/matriculas/turmas/{tid}"); aid = find_form_aid(html, "Confirmar cancelamento")
eid_b = re.search(r'name="id" value="(\d+)"', html[html.find("Bruno Teste"):]).group(1)
loc = post(f"/matriculas/turmas/{tid}", aid, {"id": eid_b, "voltar": f"/matriculas/turmas/{tid}", "motivo": "Escolheu outra escola"}); assert "Reserva cancelada" in unq(loc) and "ofertada a Caio Teste" in unq(loc), unq(loc); print("cancelamento + oferta automática ok")
html = page("/matriculas/fila"); assert "Vaga ofertada" in html and "Caio Teste" in html
aid = find_form_aid(html, "Aceitou"); wid = re.search(r'name="id" value="(\d+)"', html[html.rfind("<form", 0, html.find("Aceitou")):]).group(1)
loc = post("/matriculas/fila", aid, {"id": wid, "voltar": "/matriculas/fila"}); assert "Reserva criada" in unq(loc), unq(loc); print("conversão da fila em reserva ok")

# ---- confirmar matrícula (precisa contrato + financeiro)
html = page("/matriculas/reservas"); aid = find_form_aid(html, "Confirmar matrícula")
eid_c = re.search(r'name="id" value="(\d+)"', html[html.find("Caio Teste"):]).group(1)
loc = post("/matriculas/reservas", aid, {"id": eid_c, "voltar": "/matriculas/reservas", "contrato": "1"}); assert "financeiro OK" in unq(loc), unq(loc)
loc = post("/matriculas/reservas", aid, {"id": eid_c, "voltar": "/matriculas/reservas", "contrato": "1", "financeiro": "1"}); assert "Matrícula confirmada" in unq(loc), unq(loc); print("confirmação ok")
html = page(f"/matriculas/turmas/{tid}"); assert "Matriculada" in html

# ---- exceção com Direção
html = page("/configuracoes"); aid = find_form_aid(html, "Criar acesso")
loc = post("/configuracoes", aid, {"nome": "Diretora Geral", "email": "direcao@teste", "role": "DIRECAO", "senha": "senha12345"}); assert "ok=" in loc
S2 = mk(); login(S2, "direcao@teste", "senha12345")
html = page(f"/matriculas/turmas/{tid}", sess=S2); aid = find_form_aid(html, "Reservar vaga / matricular")
loc = post(f"/matriculas/turmas/{tid}", aid, {"studentId": D, "classId": tid, "voltar": f"/matriculas/turmas/{tid}", "excecao": "irmão na turma"}, sess=S2); assert "exceção registrada" in unq(loc), unq(loc); print("exceção de capacidade pela Direção ok")

# ---- expiração de reserva
psql(f"UPDATE enrollments SET reserva_ate = (now() AT TIME ZONE 'America/Campo_Grande')::date - 1 WHERE student_id={D} AND status='RESERVADA'")
html = page("/matriculas/reservas?status=EXPIRADA"); assert "Duda Teste" in html; print("expiração automática ok")

# ---- transferência
html = page("/matriculas/reservas?status=CONFIRMADA"); aid = find_form_aid(html, "Nova turma")
alvo = re.search(r'<option value="(\d+)">Carandá · 5º ano A · Vespertino \(16 livres\)</option>', html).group(1)
loc = post("/matriculas/reservas?status=CONFIRMADA", aid, {"id": eid_c, "voltar": "/matriculas/reservas?status=CONFIRMADA", "novaClassId": alvo}); assert "Transferido" in unq(loc), unq(loc); print("transferência ok")
html = page(f"/matriculas/turmas/{alvo}"); assert "Caio Teste" in html and "Matriculada" in html

# ---- COMERCIAL
html = page("/configuracoes"); aid = find_form_aid(html, "Criar acesso")
loc = post("/configuracoes", aid, {"nome": "Consultora", "email": "com@teste", "role": "COMERCIAL", "senha": "senha12345"}); assert "ok=" in loc
S3 = mk(); login(S3, "com@teste", "senha12345")
r = S3.get(B + "/", allow_redirects=False); assert r.headers.get("location", "").endswith("/matriculas"), r.headers.get("location")
r = S3.get(B + "/colaboradores", allow_redirects=False); assert r.status_code in (302, 303, 307)
html = page("/matriculas/turmas", sess=S3); assert "Nova turma" not in html
html = page(f"/matriculas/alunos/{A}", sess=S3); assert "Reservar vaga / matricular" in html; print("perfil comercial ok")

# ---- importação de alunos + exports
html = page("/matriculas/importar"); aid = action_ids(html)[0]
loc = post("/matriculas/importar", aid, {"csv": "nome;nascimento;responsavel;telefone;unidade;serie;aluno_atual\nErika Import;10/02/2018;Paula;67 8;Carandá;Jardim III;sim\nFábio Import;;;;;;\nAna Teste;10/05/2020;;;;;"}); msg = unq(loc)
assert "2 aluno(s) importado(s)" in msg and "1 linha(s) com erro" in msg, msg; print("import alunos ok")
for t in ["ocupacao", "matriculas"]:
    r = S.get(B + f"/api/export/{t}?ano=2027"); assert r.status_code == 200 and r.text.startswith("\ufeff"), t
print("exports ok")
html = page("/matriculas/alunos?situacao=CONFIRMADA"); assert "Caio Teste" in html and "Ana Teste" not in html
html = page("/auditoria?entidade=enrollments"); assert "matricular" in html and "transferir" in html
print("\nALL MATRICULAS E2E CHECKS PASSED")
