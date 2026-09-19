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
def post(path, aid, data, sess=None):
    sess = sess or S; f = [(f"$ACTION_ID_{aid}", (None, ""))] + [(k, (None, str(v))) for k, v in data.items()]
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
unq = requests.utils.unquote; strip = lambda h: re.sub(r"<!--.*?-->", "", h)

login(S, "rh@colegiostatus", "Status2026!"); r = S.get(B + "/api/setup?token=setup-homologacao-2026-status"); assert r.json()["ok"], r.text
html = page("/colaboradores/novo"); aid = action_ids(html)[0]; car = re.search(r'<option value="(\d+)">Carandá</option>', html).group(1); prof = re.search(r'<option value="(\d+)">Professor', html).group(1); insp = re.search(r'<option value="(\d+)">Inspetor de Alunos', html).group(1)
def novo(nome, **kw):
    loc = post("/colaboradores/novo", aid, {"nome": nome, "admissao": "2025-03-03", "unitId": car, "vinculo": "CLT", "abrirAdmissao": "", **kw}); return re.search(r"/colaboradores/(\d+)\?", loc).group(1)
gestor_emp = novo("Gestora Pedagógica", positionId=insp, salario="4000")
a = novo("Prof. Alfa", positionId=prof, nivel="Pleno", salario="3000", gestorId=gestor_emp)
b = novo("Prof. Beta", positionId=prof, nivel="Pleno", salario="3900", gestorId=gestor_emp)   # 30% acima do Alfa, mesmo nível → alerta de equidade
c = novo("Prof. Gama", positionId=prof, nivel="Júnior", salario="2500", gestorId=gestor_emp)

# ================= CARGOS E SALÁRIOS =================
html = page("/cargos-salarios/faixas"); aid = find_form_aid(html, "Nova faixa")
for cod, mn, mx, pmin, pmax, o in [("G2", 2400, 3200, 6, 12, 2), ("G3", 3000, 4200, 13, 18, 3), ("G4", 4000, 5600, 19, 25, 4)]:
    loc = post("/cargos-salarios/faixas", aid, {"codigo": cod, "minimo": mn, "maximo": mx, "pontosMin": pmin, "pontosMax": pmax, "ordem": o}); assert "Faixa salva" in unq(loc), unq(loc)
html = strip(page("/cargos-salarios/faixas")); assert "G2" in html and "G4" in html and "33%" in html; print("faixas ok")
# avaliar cargo Professor: 5 fatores × 3 = 15 pontos → sugere G3
html = page(f"/cargos-salarios/{prof}"); aid = find_form_aid(html, "Avaliação do cargo e faixa")
g3 = re.search(r'<option value="(\d+)"[^>]*>G3', html).group(1)
loc = post(f"/cargos-salarios/{prof}", aid, {"id": prof, "f_0": 3, "f_1": 3, "f_2": 3, "f_3": 3, "f_4": 3, "gradeId": g3, "descricao": "Docência", "requisitos": "Licenciatura"}); assert "Cargo atualizado" in unq(loc), unq(loc)
html = strip(page(f"/cargos-salarios/{prof}")); assert "15" in html and "G3" in html; print("avaliação por pontos ok (15 → G3)")
html = page("/cargos-salarios"); assert "Equidade interna" in html and "30%" in html and "Professor" in html; print("alerta de equidade ok (30% no mesmo nível)")
assert "abaixo" in html  # Gama 2500 < mínimo 3000 da G3
# reajuste individual via ficha
html = page(f"/colaboradores/{c}"); aid = find_form_aid(html, "Remuneração")
loc = post(f"/colaboradores/{c}", aid, {"employeeId": c, "salario": 3000, "motivo": "ENQUADRAMENTO", "obs": "enquadrado no mínimo da G3"}); assert "histórico" in unq(loc), unq(loc)
html = page(f"/colaboradores/{c}"); assert "Enquadramento na faixa" in html and "R$" in html; print("reajuste individual com histórico ok")
# dissídio 5% nas faixas e salários
html = page("/cargos-salarios/faixas"); aid = find_form_aid(html, "Reajuste coletivo")
loc = post("/cargos-salarios/faixas", aid, {"pct": 5, "aplicarSalarios": "1", "confirmo": "1"}); assert "reajustadas em 5%" in unq(loc) and "salário(s) atualizados" in unq(loc), unq(loc)
html = page(f"/colaboradores/{a}"); assert "Dissídio" in html and "3.150,00" in html; print("dissídio ok (3000 → 3150)")
# gestor não acessa cargos e salários
html = page("/configuracoes"); aid = find_form_aid(html, "Criar acesso")
post("/configuracoes", aid, {"nome": "Gestora Pedagógica", "email": "gestora@car", "role": "GESTOR", "unitId": car, "employeeId": gestor_emp, "senha": "senha12345"})
post("/configuracoes", aid, {"nome": "Prof. Alfa", "email": "alfa@car", "role": "COLABORADOR", "employeeId": a, "senha": "senha12345"})
S2 = mk(); login(S2, "gestora@car", "senha12345"); r = S2.get(B + "/cargos-salarios", allow_redirects=False); assert r.status_code in (302, 303, 307); print("cargos e salários restrito a RH/Direção ok")

# ================= DESEMPENHO =================
html = page("/desempenho"); aid = find_form_aid(html, "Novo ciclo")
loc = post("/desempenho", aid, {"nome": "Ciclo 2026.2", "inicio": "2026-09-01", "fim": "2026-12-15"}); cid = re.search(r"/desempenho/ciclos/(\d+)\?", loc).group(1); print("ciclo", cid)
html = page(f"/desempenho/ciclos/{cid}"); aid = find_form_aid(html, "Gerar avaliações")
loc = post(f"/desempenho/ciclos/{cid}", aid, {"cycleId": cid}); assert "avaliação(ões) gerada(s)" in unq(loc) and "Ciclo aberto" in unq(loc), unq(loc)
html = page(f"/desempenho/ciclos/{cid}"); assert "Prof. Alfa" in html and "Gestora Pedagógica" in html; print("avaliações geradas ok")
# colaborador faz autoavaliação
S3 = mk(); login(S3, "alfa@car", "senha12345"); html = page("/desempenho/minha", sess=S3); assert "fazer autoavaliação" in html
rid = re.search(r'/desempenho/avaliacoes/(\d+)"', html).group(1); html = page(f"/desempenho/avaliacoes/{rid}", sess=S3); aid = find_form_aid(html, "Minha autoavaliação")
loc = post(f"/desempenho/avaliacoes/{rid}", aid, {"id": rid, "voltar": f"/desempenho/avaliacoes/{rid}", "a_0": 4, "a_1": 4, "a_2": 5, "a_3": 3, "a_4": 4, "a_5": 4, "realizacoes": "Projeto de leitura"}, sess=S3); assert "Autoavaliação registrada" in unq(loc), unq(loc)
html = page(f"/desempenho/avaliacoes/{rid}", sess=S3); assert "Avaliação do gestor" not in html; print("autoavaliação ok (colaborador não vê form do gestor)")
# gestora avalia (aparece na lista dela)
html = page("/desempenho", sess=S2); assert "Avaliações que aguardam você" in html and "Prof. Alfa" in html
html = page(f"/desempenho/avaliacoes/{rid}", sess=S2); aid = find_form_aid(html, "Avaliação do gestor")
loc = post(f"/desempenho/avaliacoes/{rid}", aid, {"id": rid, "g_0": 5, "g_1": 4, "g_2": 5, "g_3": 4, "g_4": 4, "g_5": 5, "potencial": 3, "pontosFortes": "Relação com famílias", "melhorias": "Registro de notas", "pdi_1": "Curso de avaliação formativa", "pdiPrazo_1": "2027-03-31", "pdi_2": "Acompanhar coordenação", "pdiPrazo_2": ""}, sess=S2); assert "Avaliação do gestor registrada" in unq(loc), unq(loc)
html = strip(page(f"/desempenho/avaliacoes/{rid}", sess=S2)); assert "4.5" in html and "Talento estratégico" in html and "Curso de avaliação formativa" in html; print("avaliação do gestor ok (média 4.5, alto × alto)")
# colaborador marca item do PDI
html = page(f"/desempenho/avaliacoes/{rid}", sess=S3); aid = find_form_aid(html, 'aria-label="pdi"'); post(f"/desempenho/avaliacoes/{rid}", aid, {"id": rid, "idx": 0, "voltar": f"/desempenho/avaliacoes/{rid}"}, sess=S3)
html = page(f"/desempenho/avaliacoes/{rid}", sess=S3); assert "line-through" in html; print("PDI ok")
# encerrar exige todas avaliadas → bloqueia; calibração; encerra depois de avaliar todos
html = page(f"/desempenho/ciclos/{cid}"); aid = find_form_aid(html, "Iniciar calibração")
loc = post(f"/desempenho/ciclos/{cid}", aid, {"cycleId": cid, "status": "ENCERRADO"}); assert "sem nota do gestor" in unq(loc), unq(loc); print("encerramento bloqueado com pendências ok")
post(f"/desempenho/ciclos/{cid}", aid, {"cycleId": cid, "status": "CALIBRACAO"})
html = page(f"/desempenho/avaliacoes/{rid}"); aid = find_form_aid(html, "Calibração")
loc = post(f"/desempenho/avaliacoes/{rid}", aid, {"id": rid, "voltar": f"/desempenho/avaliacoes/{rid}", "desempenhoNivel": 3, "potencial": 2, "nota": "comparado com pares"}); assert "Calibração registrada" in unq(loc), unq(loc)
html = strip(page(f"/desempenho/ciclos/{cid}")); assert "Calibrada" in html and "Alto desempenho consistente" in html; print("calibração ok (Nine Box atualizado)")
# avaliar os demais como RH e encerrar
for rr in re.findall(r'href="/desempenho/avaliacoes/(\d+)"', page(f"/desempenho/ciclos/{cid}")):
    h2 = page(f"/desempenho/avaliacoes/{rr}")
    if "Avaliação do gestor" in h2 and "Pendente" in h2 or ("Avaliação do gestor" in h2 and 'name="g_0"' in h2 and "Nota final" in h2 and "—</dd>" in h2):
        a2 = find_form_aid(h2, "Avaliação do gestor"); post(f"/desempenho/avaliacoes/{rr}", a2, {"id": rr, "g_0": 3, "g_1": 3, "g_2": 3, "g_3": 3, "g_4": 3, "g_5": 3, "potencial": 2})
html = page(f"/desempenho/ciclos/{cid}"); aid = find_form_aid(html, "Encerrar ciclo"); loc = post(f"/desempenho/ciclos/{cid}", aid, {"cycleId": cid, "status": "ENCERRADO"}); assert "Fase do ciclo atualizada" in unq(loc), unq(loc)
html = page(f"/desempenho/ciclos/{cid}"); assert "Encerrado" in html and "Concluída" in html; print("ciclo encerrado ok")
html = page("/desempenho/minha", sess=S3); assert "4.5" in strip(html); print("colaborador vê nota após encerramento ok")
r = S.get(B + f"/api/export/desempenho?ciclo={cid}"); assert r.status_code == 200 and "nota_final" in r.text

# ================= RECRUTAMENTO =================
html = page("/recrutamento", sess=S2); aid = find_form_aid(html, "Solicitar vaga")
loc = post("/recrutamento", aid, {"titulo": "Professor de Matemática", "positionId": prof, "unitId": car, "quantidade": 1, "tipo": "SUBSTITUICAO", "regime": "CLT", "justificativa": "saída da Prof. X", "faixa": "G3"}, sess=S2); vid = re.search(r"/recrutamento/vagas/(\d+)\?", loc).group(1); assert "aprovação" in unq(loc), unq(loc)
html = page(f"/recrutamento/vagas/{vid}", sess=S2); assert "Aprovar e abrir" not in html
html = page(f"/recrutamento/vagas/{vid}"); aid = find_form_aid(html, "Aprovar e abrir"); loc = post(f"/recrutamento/vagas/{vid}", aid, {"id": vid, "decisao": "ABERTA"}); assert "aberta para seleção" in unq(loc), unq(loc); print("requisição aprovada ok")
html = page(f"/recrutamento/vagas/{vid}"); aid = find_form_aid(html, "Novo candidato nesta vaga")
for nome, org in [("Cand. Um", "SITE"), ("Cand. Dois", "INDICACAO")]:
    loc = post(f"/recrutamento/vagas/{vid}", aid, {"requisitionId": vid, "nome": nome, "telefone": "67 9", "origem": org, "consentimentoLgpd": "1"}); assert "incluído na vaga" in unq(loc), unq(loc)
html = page(f"/recrutamento/vagas/{vid}"); assert "Cand. Um" in html and "Cand. Dois" in html and "mover / avaliar" in html; print("candidatos na triagem ok")
aid = find_form_aid(html, "mover / avaliar")
def app_id(nome):
    i = html.find(nome); return re.search(r'name="id" value="(\d+)"', html[i:]).group(1)
ap1, ap2 = app_id("Cand. Um"), app_id("Cand. Dois")
loc = post(f"/recrutamento/vagas/{vid}", aid, {"id": ap1, "etapa": "ENTREVISTA_RH", "sc_0": 4, "sc_1": 5, "notas": "boa entrevista"}); assert "movido para ENTREVISTA_RH" in unq(loc), unq(loc)
loc = post(f"/recrutamento/vagas/{vid}", aid, {"id": ap2, "etapa": "REPROVADO", "motivo": "sem licenciatura"})
html = page(f"/recrutamento/vagas/{vid}"); assert "scorecard 4.5" in html and "Reprovados e desistências (1)" in html; print("scorecard + reprovação ok")
loc = post(f"/recrutamento/vagas/{vid}", aid, {"id": ap1, "etapa": "PROPOSTA", "propostaValor": 3300})
loc = post(f"/recrutamento/vagas/{vid}", aid, {"id": ap1, "etapa": "CONTRATADO", "admissao": "2026-10-01"}); msg = unq(loc); assert "pré-cadastrado" in msg and "Vaga preenchida" in msg, msg; print("contratação → pré-cadastro + admissão + vaga preenchida ok")
html = page(f"/recrutamento/vagas/{vid}"); assert "Preenchida" in html and "ficha criada" in html
emp_new = re.search(r'href="/colaboradores/(\d+)"', html).group(1); html = page(f"/colaboradores/{emp_new}"); assert "Cand. Um" in html and "Em admissão" in html and "3.300,00" in html and "Admissão" in html; print("colaborador contratado com salário e processo ok")
html = page("/recrutamento"); assert "Preenchidas (90 dias)" in html and "Indicação" in html
html = page("/recrutamento/candidatos"); assert "Cand. Dois" in html and "Reprovado" in html
for t in ["tabela-salarial", "vagas"]:
    r = S.get(B + f"/api/export/{t}"); assert r.status_code == 200 and r.text.startswith("\ufeff"), t
r = S2.get(B + "/api/export/tabela-salarial"); assert r.status_code == 403; print("exports ok (tabela salarial protegida)")
html = page("/auditoria?entidade=perf_reviews"); assert "calibrar" in html
print("\nALL TALENTO E2E CHECKS PASSED")
