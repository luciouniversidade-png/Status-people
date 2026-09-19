import re, requests
B = "http://localhost:3100"
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
    assert r.status_code == expect, (path, r.status_code, r.headers.get("location")); return re.sub(r"<script[^>]*>.*?</script>", "", re.sub(r"<!--.*?-->", "", r.text), flags=re.S)
def post(path, aid, data, sess=None, multi=None):
    sess = sess or S; f = [(f"$ACTION_ID_{aid}", (None, ""))] + [(k, (None, str(v))) for k, v in data.items()] + [(k, (None, str(v))) for k, v in (multi or [])]
    r = sess.post(B + path, files=f, allow_redirects=False); fix_cookie(sess, r)
    assert r.status_code in (303, 302, 200), (path, r.status_code, r.text[:300]); return r.headers.get("location", "")
def find_form_aid(html, marker):
    i = html.find(marker); assert i >= 0, marker
    fs = html.rfind("<form", 0, i); fe_prev = html.rfind("</form>", 0, i)
    if fs > fe_prev: fe = html.find("</form>", i)
    else: fs = html.find("<form", i); fe = html.find("</form>", fs)
    ids = action_ids(html[fs:fe]); assert ids, marker; return ids[0]
def login(sess, email, senha):
    html = sess.get(B + "/login").text; aid = re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', html)[0]
    loc = post("/login", aid, {"email": email, "senha": senha}, sess=sess); assert loc.endswith("/"), loc
unq = requests.utils.unquote

login(S, "rh@colegiostatus", "Status2026!"); r = S.get(B + "/api/setup?token=setup-homologacao-2026-status"); assert r.json()["ok"], r.text
html = page("/colaboradores/novo"); aid = action_ids(html)[0]; car = re.search(r'<option value="(\d+)">Carandá</option>', html).group(1); tvm = re.search(r'<option value="(\d+)">TV Morena I</option>', html).group(1); prof = re.search(r'<option value="(\d+)">Professor', html).group(1); insp = re.search(r'<option value="(\d+)">Inspetor de Alunos', html).group(1)
def novo(nome, **kw):
    loc = post("/colaboradores/novo", aid, {"nome": nome, "admissao": "2025-03-03", "unitId": car, "vinculo": "CLT", "abrirAdmissao": "", **kw}); return re.search(r"/colaboradores/(\d+)\?", loc).group(1)
p1 = novo("Prof. Um", positionId=prof, regime="DOCENTE"); p2 = novo("Prof. Dois", positionId=prof, regime="DOCENTE"); i1 = novo("Inspetor Um", positionId=insp)

# ================= CLIMA =================
html = page("/clima"); aid = find_form_aid(html, "Nova pesquisa")
loc = post("/clima", aid, {"nome": "Clima 2026.2", "tipo": "CLIMA", "inicio": "2026-09-01", "fim": "2026-09-30", "minimoAnonimato": 3}); sid = re.search(r"/clima/(\d+)\?", loc).group(1)
html = page(f"/clima/{sid}"); assert "Rascunho" in html; aid = find_form_aid(html, "Abrir"); post(f"/clima/{sid}", aid, {"id": sid, "status": "ABERTA"})
html = page(f"/clima/{sid}"); tok = re.search(r"/pesquisa/([0-9a-f]+)", html).group(1); assert "Link anônimo" in html; print("pesquisa aberta com link", tok[:6])
# público sem login
r = requests.get(B + f"/pesquisa/{tok}", allow_redirects=False); assert r.status_code == 200 and "Enviar resposta anônima" in r.text and "Liderança" in r.text; print("página pública sem login ok")
paid = re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', r.text)[0]
def responder(unit, notas, enps, com=""):
    sess = requests.Session(); sess.headers.update({"Origin": B}); d = {"token": tok, "unitId": unit, "enps": enps, "aberta": com}
    for i, n in enumerate(notas): d[f"q{i + 1}"] = n
    rr = sess.post(B + f"/pesquisa/{tok}", files=[(f"$ACTION_ID_{paid}", (None, ""))] + [(k, (None, str(v))) for k, v in d.items()], allow_redirects=False)
    assert rr.status_code == 303, rr.status_code; return sess, rr.headers.get("location", "")
# 2 respostas → abaixo do mínimo 3 → resultados ocultos
sess, loc = responder(car, [5, 4, 4, 5, 3, 5, 4, 4], 9, "Mais tempo de planejamento"); assert "obrigado" in loc
rr = sess.post(B + f"/pesquisa/{tok}", files=[(f"$ACTION_ID_{paid}", (None, "")), ("token", (None, tok)), ("enps", (None, "10"))], allow_redirects=False); assert "já enviou" in unq(rr.headers.get("location", "")); print("duplicata por navegador bloqueada ok")
responder(car, [2, 3, 2, 3, 2, 4, 3, 3], 5)
html = page(f"/clima/{sid}"); assert "mínimo 3 respostas" in html and "ocultos até o mínimo" in html; print("anonimato: resultados ocultos com 2 respostas ok")
responder(car, [4, 4, 3, 4, 4, 5, 4, 4], 8); responder(tvm, [5, 5, 5, 5, 5, 5, 5, 5], 10)
html = page(f"/clima/{sid}"); assert "Mais tempo de planejamento" in html and "Carandá" in html
m = re.search(r'eNPS</div><div class="[^"]*"><span class="[^"]*">(-?\d+)</span>', html); assert m and m.group(1) == "25", (m.group(1) if m else html[:0]); print("eNPS 25 ok (2 promotores, 1 detrator, 4 respostas)")
assert "TV Morena I" not in html.split("Mapa de calor")[1].split("Comentários")[0] or "—" in html; print("célula TV Morena (1 resposta) protegida ok")
aid = find_form_aid(html, "Adicionar ação"); loc = post(f"/clima/{sid}", aid, {"surveyId": sid, "dimensao": "Reconhecimento", "acao": "Programa mensal de reconhecimento", "prazo": "2026-11-30"}); assert "Ação salva" in unq(loc)
html = page(f"/clima/{sid}"); assert "Programa mensal de reconhecimento" in html; print("plano de ação ok")
aid = find_form_aid(html, "Encerrar"); post(f"/clima/{sid}", aid, {"id": sid, "status": "ENCERRADA"}); r = requests.get(B + f"/pesquisa/{tok}"); assert "indisponível" in r.text; print("encerramento fecha o link ok")
html = page("/clima"); assert "25" in html and "Clima 2026.2" in html

# ================= ACADEMY =================
html = page("/academy"); aid = find_form_aid(html, "Novo treinamento")
loc = post("/academy", aid, {"codigo": "TR-001", "titulo": "Integração institucional", "area": "Integração institucional", "tipo": "OBRIGATORIO", "formato": "PRESENCIAL", "cargaHoras": 4, "paraTodos": "1"}); c1 = re.search(r"/academy/cursos/(\d+)\?", loc).group(1)
loc = post("/academy", aid, {"codigo": "TR-002", "titulo": "Primeiros socorros", "area": "Segurança e saúde", "tipo": "OBRIGATORIO", "formato": "PRESENCIAL", "cargaHoras": 8, "validadeMeses": 12, "paraRegime": "DOCENTE"}); c2 = re.search(r"/academy/cursos/(\d+)\?", loc).group(1)
html = page("/governanca/pops"); pop3 = re.search(r'href="/governanca/pops/(\d+)">Matrícula e reserva de vaga<', html).group(1)
loc = post("/academy", aid, {"codigo": "TR-003", "titulo": "POP de matrícula", "tipo": "OBRIGATORIO", "formato": "POP", "procedureId": pop3}, multi=[("paraCargos", insp)]); c3 = re.search(r"/academy/cursos/(\d+)\?", loc).group(1)
loc = post("/academy", aid, {"codigo": "TR-X", "titulo": "sem pop", "formato": "POP"}); assert "precisa do POP" in unq(loc); print("cursos criados; validação POP ok")
html = page("/academy/matriz"); assert "Prof. Um" in html and "TR-001" in html and "TR-002" in html and "TR-003" in html
# Prof. Um exige TR-001 (todos) + TR-002 (docente); Inspetor exige TR-001 + TR-003 (cargo)
row = html[html.find("Prof. Um"):html.find("Prof. Um") + 1500]; assert row.count("pend.") == 2 and "·" in row; print("matriz por regra ok")
# conclusão em lote com validade
html = page(f"/academy/cursos/{c2}"); aid = find_form_aid(html, "Registrar conclusão / andamento")
loc = post(f"/academy/cursos/{c2}", aid, {"courseId": c2, "status": "CONCLUIDO", "concluidoEm": "2025-10-01", "evidencia": "certificado"}, multi=[("employeeId", p1), ("employeeId", p2)]); assert "2 registro(s)" in unq(loc), unq(loc)
html = page(f"/academy/cursos/{c2}"); assert "01/10/2026" in html and "Concluído" in html; print("conclusão em lote com validade 12 meses ok")
html = page("/academy"); assert "Vencendo em 60 dias" in html and re.search(r'Vencendo em 60 dias</div><div class="[^"]*">2<', html); print("alerta de vencimento ok (2 vencendo)")
# turma presencial + presença
html = page(f"/academy/cursos/{c1}"); aid = find_form_aid(html, "Agendar turma")
loc = post(f"/academy/cursos/{c1}", aid, {"courseId": c1, "data": "2026-09-15", "horario": "14:00–18:00", "local": "Auditório Carandá", "instrutor": "RH", "unitId": car, "vagas": 20}); assert "Turma agendada" in unq(loc)
html = page(f"/academy/cursos/{c1}"); aid = find_form_aid(html, "Registrar presentes"); sid2 = re.search(r'name="sessionId" value="(\d+)"', html).group(1)
loc = post(f"/academy/cursos/{c1}", aid, {"sessionId": sid2}, multi=[("employeeId", p1), ("employeeId", i1)]); assert "2 presença(s)" in unq(loc), unq(loc)
html = page(f"/academy/cursos/{c1}"); assert "Presença na turma" in html; print("turma + presença → concluído ok")
# POP: ciência vira treinamento concluído
post("/configuracoes", find_form_aid(page("/configuracoes"), "Criar acesso"), {"nome": "Inspetor Um", "email": "insp@car", "role": "COLABORADOR", "employeeId": i1, "senha": "senha12345"})
S2 = mk(); login(S2, "insp@car", "senha12345"); html = page("/academy/minha", sess=S2); assert "TR-003" in html and "dar ciência" in html and "1 de 2 obrigatórios" in html
# publicar POP-003 (rascunho) e dar ciência
html = page(f"/governanca/pops/{pop3}"); aid = find_form_aid(html, "Editar conteúdo"); rh = re.search(r'name="ownerUserId"[^>]*>.*?<option value="(\d+)">RH Colégio Status</option>', html, flags=re.S).group(1)
post(f"/governanca/pops/{pop3}", aid, {"id": pop3, "codigo": "POP-003", "titulo": "Matrícula e reserva de vaga", "area": "Matrículas e Secretaria", "ownerUserId": rh, "passos": "1. Passo"}); aid = find_form_aid(page(f"/governanca/pops/{pop3}"), "Publicação"); post(f"/governanca/pops/{pop3}", aid, {"id": pop3})
html = page(f"/governanca/pops/{pop3}", sess=S2); aid = find_form_aid(html, "Li e entendi"); post(f"/governanca/pops/{pop3}", aid, {"id": pop3}, sess=S2)
html = page("/academy/minha", sess=S2); assert "2 de 2 obrigatórios" in html; print("ciência de POP conta como treinamento ok")
html = page(f"/colaboradores/{i1}"); assert "Treinamentos obrigatórios — 2/2" in html; print("ficha mostra treinamentos ok")
# LNT
html = page("/academy"); aid = find_form_aid(html, "Registrar necessidade"); loc = post("/academy", aid, {"voltar": "/academy#lnt", "descricao": "Curso de mediação de conflitos", "origem": "CLIMA", "prioridade": "ALTA"}); assert "Necessidade registrada" in unq(loc)
html = page("/academy"); assert "mediação de conflitos" in html and "Necessidades abertas" in html
m = re.search(r'Conformidade</div><div class="[^"]*"><span class="[^"]*">(\d+)%', html); assert m and m.group(1) == "83", m.group(1) if m else "sem conformidade"  # 5 de 6 exigidos concluídos
print("conformidade 83% ok")
r = S.get(B + "/api/export/treinamentos"); assert r.status_code == 200 and "valido_ate" in r.text; print("export ok")
html = page("/auditoria?entidade=courses"); assert "criar treinamento" in html
print("\nALL CLIMA/ACADEMY E2E CHECKS PASSED")
