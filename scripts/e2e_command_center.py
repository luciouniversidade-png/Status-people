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
html = page("/command-center"); assert "Health Geral" in html and "Decisões pendentes da Direção (9)" in html and "Nomear o DPO" in html; print("command center + 9 decisões pendentes ok")
for d in ["Pessoas", "Processos", "Matrículas", "Atendimento e retenção", "Financeiro"]: assert d in html
geral = int(re.search(r'Health Geral</div><div class="text-5xl font-semibold [^"]*">(\d+)</div>', html).group(1)); print("health geral inicial", geral)
assert "Por unidade" in html and "Carandá" in html
# criar um caso com SLA vencido e um título inadimplente → alertas e queda do health
html = page("/atendimento/casos"); aid = find_form_aid(html, "Novo atendimento"); car = re.search(r'<option value="(\d+)">Carandá</option>', html).group(1)
loc = post("/atendimento/casos", aid, {"voltar": "/atendimento/casos", "tipo": "RECLAMACAO", "canal": "WHATSAPP", "assunto": "Teste SLA", "contatoNome": "Fam", "unitId": car, "gravidade": 3}); cid = re.search(r"/atendimento/casos/(\d+)\?", loc).group(1)
psql(f"UPDATE cases SET sla_ate = now() - interval '3 hours' WHERE id={cid}")
html = page("/configuracoes"); aid = find_form_aid(html, "Criar acesso"); post("/configuracoes", aid, {"nome": "Fin", "email": "fin@s", "role": "FINANCEIRO", "senha": "senha12345"}); F = mk(); login(F, "fin@s", "senha12345") if False else None
psql(f"INSERT INTO receivables (aluno_nome, unit_id, tipo, competencia, vencimento, valor, status) VALUES ('Devedor Teste', {car}, 'MENSALIDADE', '2026-08', '2026-08-10', 1850, 'ABERTO'), ('Pagador Teste', {car}, 'MENSALIDADE', '2026-08', '2026-08-10', 1850, 'PAGO')")
html = page("/command-center"); g2 = int(re.search(r'Health Geral</div><div class="text-5xl font-semibold [^"]*">(\d+)</div>', html).group(1))
assert "SLA vencido" in html and "inadimplência" in html and g2 < geral, (geral, g2); print(f"alertas consolidados + health caiu ({geral} → {g2}) ok")
assert "alto" in html
# retrato diário registrado (idempotente)
assert psql("SELECT count(*) FROM health_snapshots WHERE unit_id IS NULL") == "1"; page("/command-center"); assert psql("SELECT count(*) FROM health_snapshots WHERE unit_id IS NULL") == "1"; print("snapshot diário idempotente ok")
# decidir pendência → Decision Log
aid = find_form_aid(html, "Decidir"); pid = re.search(r'name="id" value="(\d+)"', html[html.find("Nomear o DPO"):]).group(1)
loc = post("/command-center", aid, {"id": pid, "status": "DECIDIDA", "decisao": "DPO: Coordenadora de RH, a partir de 01/10/2026", "revisarEm": "2027-10-01"}); assert "Decision Log" in unq(loc), unq(loc)
html = page("/command-center"); assert "Decisões pendentes da Direção (8)" in html and "decisão #" in html
html = page("/governanca/decisoes"); assert "Nomear o DPO" in html and "Coordenadora de RH" in html; print("pendência decidida → Decision Log ok")
# adiar + nova pendência
html = page("/command-center"); aid = find_form_aid(html, "Decidir"); pid2 = re.search(r'name="id" value="(\d+)"', html[html.find("AI Owner"):]).group(1)
post("/command-center", aid, {"id": pid2, "status": "ADIADA", "prazo": "2026-12-15"}); html = page("/command-center"); assert "Adiada" in html and "15/12/2026" in html
aid = find_form_aid(html, "Nova decisão pendente"); loc = post("/command-center", aid, {"titulo": "Definir política de descontos 2027", "area": "Financeiro", "prazo": "2026-10-30"}); assert "salva" in unq(loc)
html = page("/command-center"); assert "Definir política de descontos 2027" in html; print("adiar + nova pendência ok")
# diretor de unidade vê só sua unidade
post("/configuracoes", find_form_aid(page("/configuracoes"), "Criar acesso"), {"nome": "Dir Car", "email": "dir@car", "role": "DIRETOR_UNIDADE", "unitId": car, "senha": "senha12345"})
D = mk(); login(D, "dir@car", "senha12345"); html = page("/command-center", sess=D); assert "Por unidade" not in html and "Health Geral" in html; print("diretor: recorte da unidade ok")
html = page("/auditoria?entidade=exec_pending"); assert "decidir pendência" in html
print("\nALL COMMAND CENTER E2E CHECKS PASSED")
