import re, subprocess, requests
B = "http://localhost:3100"
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
unq = requests.utils.unquote

login(S, "rh@colegiostatus", "Status2026!"); r = S.get(B + "/api/setup?token=setup-homologacao-2026-status"); assert r.json()["ok"], r.text
html = page("/colaboradores/novo"); aid = action_ids(html)[0]; car = re.search(r'<option value="(\d+)">Carandá</option>', html).group(1); coord = re.search(r'<option value="(\d+)">Coordenador Pedagógico', html).group(1); prof = re.search(r'<option value="(\d+)">Professor', html).group(1); sec = re.search(r'<option value="(\d+)">Secretária', html).group(1)
def novo(nome, **kw):
    d = {"nome": nome, "admissao": "2023-02-01", "unitId": car, "vinculo": "CLT", "abrirAdmissao": ""}; d.update(kw)
    loc = post("/colaboradores/novo", aid, d); return re.search(r"/colaboradores/(\d+)\?", loc).group(1)
c1 = novo("Coord. Atual", positionId=coord, salario="6000"); p1 = novo("Prof. Sucessora", positionId=prof, salario="3200"); p2 = novo("Prof. Novo", positionId=prof, salario="2000", admissao="2026-08-01"); s1 = novo("Secretária Única", positionId=sec, salario="3000")
ex = novo("Ex Colab", positionId=prof); psql(f"UPDATE employees SET desligamento='2026-05-10', situacao='DESLIGADO' WHERE id={ex}")

# ================= SUCESSÃO =================
html = page("/sucessao"); assert "Bench strength" in html and "Secretária Única" in html; print("bus factor: ocupante único detectado ok")
aid = find_form_aid(html, "Mapear posição crítica")
loc = post("/sucessao", aid, {"positionId": coord, "unitId": car, "titularEmployeeId": c1, "criticidade": 3, "riscoSaida": "ALTO", "motivo": "único coordenador", "contingencia": "Diretora assume 30 dias"}); assert "Posição crítica salva" in unq(loc), unq(loc)
html = page("/sucessao"); assert "Coord. Atual" in html and "nenhum" in html and re.search(r'Posições sem sucessor</div><div class="[^"]*"><span class="[^"]*">1<', html); print("posição crítica sem sucessor ok")
aid = find_form_aid(html, "+ sucessor"); cp = re.search(r'name="criticalPositionId" value="(\d+)"', html).group(1)
loc = post("/sucessao", aid, {"criticalPositionId": cp, "employeeId": p1, "prontidao": "UM_DOIS_ANOS", "plano": "Pós em gestão escolar"}); assert "Sucessor salvo" in unq(loc)
html = page("/sucessao"); assert "Prof. Sucessora" in html and "Pronto em 1–2 anos" in html and ">0%<" in html
loc = post("/sucessao", aid, {"criticalPositionId": cp, "employeeId": s1, "prontidao": "PRONTO"}); html = page("/sucessao"); assert ">100%<" in html; print("bench strength 0% → 100% ok")
# talent review com sugestões do ciclo
html = page("/desempenho"); aid = find_form_aid(html, "Novo ciclo"); loc = post("/desempenho", aid, {"nome": "Ciclo TR", "inicio": "2026-03-01", "fim": "2026-06-30"}); cid = re.search(r"/desempenho/ciclos/(\d+)\?", loc).group(1)
html = page(f"/desempenho/ciclos/{cid}"); aid = find_form_aid(html, "Gerar avaliações"); post(f"/desempenho/ciclos/{cid}", aid, {"cycleId": cid})
html = page(f"/desempenho/ciclos/{cid}"); rid = re.search(r'href="/desempenho/avaliacoes/(\d+)"', html[html.find("Prof. Sucessora") - 400:]).group(1)
def avaliar(rr, nota, pot):
    hh = page(f"/desempenho/avaliacoes/{rr}"); aa = find_form_aid(hh, "Avaliação do gestor"); post(f"/desempenho/avaliacoes/{rr}", aa, {"id": rr, "g_0": nota, "g_1": nota, "g_2": nota, "g_3": nota, "g_4": nota, "g_5": nota, "potencial": pot})
for rr in re.findall(r'href="/desempenho/avaliacoes/(\d+)"', page(f"/desempenho/ciclos/{cid}")):
    avaliar(rr, 5 if rr == rid else 3, 3 if rr == rid else 2)
html = page(f"/desempenho/ciclos/{cid}"); aid = find_form_aid(html, "Encerrar ciclo"); loc = post(f"/desempenho/ciclos/{cid}", aid, {"cycleId": cid, "status": "ENCERRADO"}); assert "atualizada" in unq(loc), unq(loc)
html = page("/sucessao"); aid = find_form_aid(html, 'placeholder="Talent Review 2026"'); loc = post("/sucessao", aid, {"nome": "Talent Review 2026", "data": "2026-09-20"}); tr = re.search(r"/sucessao/review/(\d+)\?", loc).group(1)
html = page(f"/sucessao/review/{tr}"); i = html.find("Prof. Sucessora"); blk = html[i:i + 3000]; assert "Talento-chave" in blk, "sugestão"; print("sugestão do talent review a partir do Nine Box ok")
aid = find_form_aid(html, "Classificar")
loc = post(f"/sucessao/review/{tr}", aid, {"reviewId": tr, "employeeId": p1, "classificacao": "TALENTO_CHAVE", "riscoPerda": "ALTO", "impactoPerda": "ALTO", "acao": "Promoção a coordenadora adjunta em 2027", "prazo": "2027-02-01"}); assert "Classificação salva" in unq(loc)
html = page(f"/sucessao/review/{tr}"); assert "Promoção a coordenadora adjunta" in html and re.search(r'Risco de perda alto</div><div class="[^"]*"><span class="[^"]*">1<', html); print("classificação + plano de retenção ok")
aid = find_form_aid(html, "Registrar como realizado"); post(f"/sucessao/review/{tr}", aid, {"id": tr, "notas": "Reunião com Direção"}); html = page(f"/sucessao/review/{tr}"); assert "Realizado" in html and "Reunião com Direção" in html

# ================= ANALYTICS =================
html = page("/analytics"); assert "People Health" in html and "Turnover 12 meses" in html and "turnover 12 meses" in html; print("people health com desconto por turnover ok")
assert "Prof. Novo" in html and "menos de 6 meses de casa" in html; print("risk center: sinais ok")
assert "Prof. Sucessora" in html and "talento estratégico" in html
assert "Folha mensal base" in html and "R$" in html; print("custo de pessoal ok (RH)")
html = page("/analytics?dissidio=5&novos=2"); assert "Folha projetada" in html; print("simulação de dissídio ok")
html = page("/configuracoes"); aid = find_form_aid(html, "Criar acesso"); post("/configuracoes", aid, {"nome": "Dir Car", "email": "dir@car", "role": "DIRETOR_UNIDADE", "unitId": car, "senha": "senha12345"})
S2 = mk(); login(S2, "dir@car", "senha12345"); html = page("/analytics", sess=S2); assert "Folha mensal base" not in html and "People Health" in html; print("diretor sem custo de pessoal ok")
r = S2.get(B + "/api/export/risco-pessoas"); assert r.status_code == 200 and "Prof. Novo" in r.text
html = page("/analytics/assistente"); ctx = html.split("O que o assistente enxerga")[1]; assert "não está ligado" in html and "people_health" in ctx and "Prof. Novo" not in ctx and "6000" not in ctx; print("contexto anonimizado ok")
aid = find_form_aid(html, "O que você quer saber?"); loc = post("/analytics/assistente", aid, {"pergunta": "Onde está o maior risco?"}); assert "resposta=" in loc, loc
html = page(loc); assert "AI_API_KEY" in html and "Onde está o maior risco?" in html; print("people AI sem chave: erro registrado, nada enviado ok")
html = page("/auditoria?entidade=ai_log"); assert "pergunta ao People AI" in html
print("\nALL SUCESSAO/ANALYTICS E2E CHECKS PASSED")
