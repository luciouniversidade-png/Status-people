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
html = page("/estrategia"); assert "Estratégia 2027" in html and "Encher as salas de 2027" in html and "Saúde financeira previsível" in html; print("painel + OKRs 2027 sugeridos ok")
html = page("/estrategia/okrs"); assert html.count("<tr") >= 6; oid = re.search(r'href="/estrategia/okrs/(\d+)">Saúde financeira previsível<', html).group(1)
# KR automático lê do sistema: inadimplência sem títulos = sem medição; criar título vencido → 100% inadimplência, KR desce
html = page(f"/estrategia/okrs/{oid}"); assert "lido do sistema" in html and "Inadimplência (90 dias)" in html; assert "—" in html; print("KR com fonte automática exibido ok")
car = psql("SELECT id FROM units WHERE nome='Carandá'").strip()
psql(f"INSERT INTO receivables (aluno_nome, unit_id, tipo, competencia, vencimento, valor, status) VALUES ('Dev', {car}, 'MENSALIDADE', '2026-08', '2026-08-10', 1000, 'ABERTO'), ('Pag', {car}, 'MENSALIDADE', '2026-08', '2026-08-10', 1000, 'PAGO')")
html = page(f"/estrategia/okrs/{oid}"); i = html.find("Inadimplência (90 dias)"); row = html[i:i + 1500]; assert ">50<" in row or "50</" in row, row[:600]; print("KR lido do sistema: inadimplência 50% ok")
assert psql("SELECT valor_atual FROM key_results WHERE titulo='Inadimplência (90 dias)'").strip() == "50.00"; print("valor gravado no KR ok")
# novo objetivo + KR manual + check-in → progresso
html = page("/estrategia/okrs"); aid = find_form_aid(html, "Novo objetivo")
loc = post("/estrategia/okrs", aid, {"ciclo": "2027", "titulo": "Formar 10 líderes internos", "pilar": "Pessoas e Cultura", "unitId": ""}); nid = re.search(r"/estrategia/okrs/(\d+)\?", loc).group(1)
html = page(f"/estrategia/okrs/{nid}"); aid = find_form_aid(html, "Novo resultado-chave")
loc = post(f"/estrategia/okrs/{nid}", aid, {"objectiveId": nid, "titulo": "Líderes formados", "valorInicial": 0, "valorMeta": 10, "metrica": "pessoas", "direcao": "SUBIR", "fonte": "", "prazo": "2027-12-15"}); assert "salvo" in unq(loc)
html = page(f"/estrategia/okrs/{nid}"); aid = find_form_aid(html, "Check-in"); kid = re.search(r'name="id" value="(\d+)"', html[html.find("Líderes formados"):]).group(1)
loc = post(f"/estrategia/okrs/{nid}", aid, {"id": kid, "objectiveId": nid, "data": "2026-09-16", "valor": 4, "confianca": 2, "comentario": "turma 1 concluída"}); assert "Check-in registrado" in unq(loc)
html = page(f"/estrategia/okrs/{nid}"); assert "40%" in html and "média" in html and "turma 1 concluída" in html; print("KR manual + check-in → 40% ok")
# KR descer: inicial 25 → meta 15, atual 20 = 50%
loc = post(f"/estrategia/okrs/{nid}", find_form_aid(page(f"/estrategia/okrs/{nid}"), "Novo resultado-chave"), {"objectiveId": nid, "titulo": "Saídas voluntárias", "valorInicial": 25, "valorMeta": 15, "valorAtual": 20, "metrica": "%", "direcao": "DESCER", "fonte": ""})
html = page(f"/estrategia/okrs/{nid}"); i = html.find("Saídas voluntárias"); assert "50%" in html[i:i + 1200]; print("KR de descida 50% ok")
# projeto ligado ao objetivo, marcos, status report vermelho, risco alto
html = page("/estrategia/projetos"); aid = find_form_aid(html, "Novo projeto")
loc = post("/estrategia/projetos", aid, {"nome": "Programa de Liderança 2027", "objectiveId": nid, "resultadoEsperado": "10 líderes formados", "status": "EM_ANDAMENTO", "prioridade": "ALTA", "orcamento": 20000, "inicio": "2026-09-01", "fim": "2027-06-30", "unitId": ""}); pid = re.search(r"/estrategia/projetos/(\d+)\?", loc).group(1)
html = page(f"/estrategia/projetos/{pid}"); aid = find_form_aid(html, "Novo marco")
post(f"/estrategia/projetos/{pid}", aid, {"projectId": pid, "titulo": "Selecionar turma", "prazo": "2026-09-01"}); post(f"/estrategia/projetos/{pid}", aid, {"projectId": pid, "titulo": "Módulo 1", "prazo": "2026-11-30"})
html = page(f"/estrategia/projetos/{pid}"); assert "1 atrasado(s)" in html; print("marco atrasado detectado ok")
aid = find_form_aid(html, 'aria-label="marco"'); mid = re.search(r'name="id" value="(\d+)"', html[html.find("Selecionar turma") - 500:]).group(1); post(f"/estrategia/projetos/{pid}", aid, {"id": mid, "projectId": pid})
html = page(f"/estrategia/projetos/{pid}"); assert "1/2" in html and "line-through" in html; print("marco concluído ok")
aid = find_form_aid(html, "Feito desde o último"); loc = post(f"/estrategia/projetos/{pid}", aid, {"projectId": pid, "data": "2026-09-16", "saude": "VERMELHO", "feito": "Turma selecionada", "proximo": "Contratar facilitador", "riscos": "Sem orçamento aprovado", "gasto": 25000, "status": "EM_ANDAMENTO"}); assert "Status report registrado" in unq(loc)
html = page(f"/estrategia/projetos/{pid}"); assert "Em risco" in html and "estourado" in html and "Contratar facilitador" in html; print("status report vermelho + orçamento estourado ok")
aid = find_form_aid(html, "Novo risco"); post(f"/estrategia/projetos/{pid}", aid, {"projectId": pid, "descricao": "Facilitador indisponível", "probabilidade": 3, "impacto": 3, "mitigacao": "Dois fornecedores"})
html = page(f"/estrategia/projetos/{pid}"); assert "alto" in html and "Dois fornecedores" in html; print("risco alto ok")
html = page("/estrategia"); assert "Programa de Liderança 2027" in html and "Em risco" in html and "Formar 10 líderes internos" in html; print("painel mostra projeto em risco e objetivo ok")
html = page(f"/estrategia/okrs/{nid}"); assert "Programa de Liderança 2027" in html; print("objetivo lista projeto ligado ok")
html = page("/command-center"); assert "Estratégia 2027" in html and "Programa de Liderança 2027" in html; print("command center com estratégia ok")
# gestor: faz check-in, não cria objetivo
html = page("/configuracoes"); aid = find_form_aid(html, "Criar acesso"); post("/configuracoes", aid, {"nome": "Gestor", "email": "g@car", "role": "GESTOR", "unitId": car, "senha": "senha12345"}); G = mk(); login(G, "g@car", "senha12345")
html = page("/estrategia/okrs", sess=G); assert "Novo objetivo" not in html; html = page(f"/estrategia/okrs/{nid}", sess=G); assert "Check-in" in html and "Novo resultado-chave" not in html; print("gestor: check-in sim, definir OKR não ok")
r = S.get(B + "/api/export/projetos"); assert r.status_code == 200 and "Programa de Liderança 2027" in r.text; print("export ok")
html = page("/auditoria?entidade=projects"); assert "status report" in html
print("\nALL ESTRATEGIA E2E CHECKS PASSED")
