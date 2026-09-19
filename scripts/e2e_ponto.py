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
    assert r.status_code == expect, (path, r.status_code, r.headers.get("location")); return re.sub(r"<script[^>]*>.*?</script>", "", r.text, flags=re.S)
def post(path, aid, data, sess=None, files=None):
    sess = sess or S; f = [(f"$ACTION_ID_{aid}", (None, ""))]
    for k, v in data.items(): f.append((k, (None, str(v))))
    for k, v in (files or []): f.append((k, v))
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

login(S, "rh@colegiostatus", "Status2026!"); r = S.get(B + "/api/setup?token=setup-homologacao-2026-status"); assert r.json()["ok"], r.text; print("setup:", r.json()["mensagens"])

# ---- colaborador docente
html = page("/colaboradores/novo"); aid = action_ids(html)[0]
uid = re.search(r'<option value="(\d+)">Carandá</option>', html).group(1)
loc = post("/colaboradores/novo", aid, {"nome": "Maria Teste da Silva", "admissao": "2025-02-03", "unitId": uid, "vinculo": "CLT", "jornadaMinDia": 528, "regime": "DOCENTE"})
emp = re.search(r"/colaboradores/(\d+)\?ok=", loc).group(1); print("colaborador", emp)

# ---- jornada
html = page(f"/ponto/jornadas?colaborador={emp}"); aid = find_form_aid(html, "Salvar jornada")
loc = post("/ponto/jornadas", aid, {"employeeId": emp, "voltar": f"/ponto/jornadas?colaborador={emp}", "vigenciaInicio": "2026-01-01", "seg": "8:48", "ter": "8:48", "qua": "8:48", "qui": "8:48", "sex": "8:48", "sab": "0:00", "dom": "0:00"}); assert "Jornada salva" in unq(loc), unq(loc)
html = page(f"/ponto/jornadas?colaborador={emp}"); assert "vigente" in html and "44:00" in html; print("jornada ok (44h semanais)")

# ---- folha: calendário aplicado
html = page(f"/ponto/{emp}?mes=2026-09"); assert "Independência" in html and "Descanso semanal" in html; print("folha calculada com calendário ok")
aid = find_form_aid(html, "Preencher o mês com a jornada")
loc = post(f"/ponto/{emp}", aid, {"employeeId": emp, "mes": "2026-09"}); assert "Mês preenchido" in unq(loc) and "0 lançamento" in unq(loc), unq(loc); print("mês padrão fecha em zero ok")

# ---- editar dias: atestado, falta, hora extra
html = page(f"/ponto/{emp}?mes=2026-09"); aid = find_form_aid(html, "Salvar folha do mês")
data = {"employeeId": emp, "mes": "2026-09"}
for k, v in re.findall(r'name="e_(\d{8})" value="(\d+)"', html): data[f"e_{k}"] = v
for k, v in re.findall(r'name="t_(\d{8})" value="([^"]*)"', html): data[f"t_{k}"] = v
for k, blk in re.findall(r'<select name="s_(\d{8})"[^>]*>(.*?)</select>', html, flags=re.S):
    m = re.search(r'<option selected="" value="([A-Z_]+)"', blk) or re.search(r'<option value="([A-Z_]+)" selected=""', blk); data[f"s_{k}"] = m.group(1) if m else "NORMAL"
data["s_20260915"] = "ATESTADO"; data["s_20260916"] = "FALTA"; data["t_20260917"] = "9:48"
loc = post(f"/ponto/{emp}", aid, data); msg = unq(loc); assert "2 lançamento(s)" in msg and "−468 min" in msg, msg; print("falta + extra → 2 lançamentos, −468 min ok")
html = page(f"/colaboradores/{emp}"); assert "−7h48" in html and "Ponto 16/09/2026: Falta" in html; print("banco de horas integrado ok")
data["s_20260916"] = "NORMAL"; loc = post(f"/ponto/{emp}", aid, data); assert "+60 min" in unq(loc), unq(loc)
html = page(f"/colaboradores/{emp}"); assert "+1h00" in html; print("regeneração dos lançamentos ok")

# ---- calendário: novo feriado aparece na folha de outubro
html = page("/ponto/calendario?ano=2026"); assert "Consciência Negra" in html; aid = find_form_aid(html, "Adicionar dia ou período")
loc = post("/ponto/calendario", aid, {"data": "2026-10-28", "tipo": "PONTO_FACULTATIVO", "descricao": "Dia do Servidor (teste)", "publico": "TODOS"}); assert "Calendário atualizado" in unq(loc), unq(loc)
html = page(f"/ponto/{emp}?mes=2026-10"); assert "Dia do Servidor (teste)" in html; print("calendário ok")

# ---- importação de planilhas (prévia → aplicar)
html = page("/ponto/importar"); aid = action_ids(html)[0]
files = [("arquivos", ("MARIA TESTE DA SILVA_REVISADO_2026.xlsx", open("/tmp/MARIA TESTE DA SILVA_REVISADO_2026.xlsx", "rb").read(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")),
         ("arquivos", ("ARCIRLEY TESTE_REVISADO_2026.xlsx", open("/tmp/ARCIRLEY TESTE_REVISADO_2026.xlsx", "rb").read(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))]
loc = post("/ponto/importar", aid, {"ano": 2026}, files=files); m = re.search(r"lote=(\d+)", loc); assert m, loc; lote = m.group(1)
html = page(f"/ponto/importar?lote={lote}"); assert "−87h11" in html and "✓" in html and "≠" not in html and "sem correspondência automática" in html and "365" in html, "prévia"; print("prévia da importação ok (saldo bate com a planilha)")
aid = find_form_aid(html, "Aplicar importação")
loc = post("/ponto/importar", aid, {"lote": lote, "emp_0": emp, "emp_1": ""}); assert "1 planilha(s) aplicada(s) (365 dias), 1 pulada(s)" in unq(loc), unq(loc); print("importação aplicada ok")
html = page(f"/colaboradores/{emp}"); assert "−87h11" in html, "saldo após importação"; print("saldo final −87h11 ok")
html = page(f"/ponto/{emp}?mes=2026-07"); assert html.count("Recesso") >= 10; print("recesso lido ok")
html = page("/ponto?mes=2026-08"); assert "+0h49" in html; print("resumo mensal ok")
html = page(f"/ponto/importar?lote={lote}"); assert "aplicado" in html and "Aplicar importação" not in html
html = page("/auditoria?entidade=timesheet_days"); assert "salvar folha de ponto" in html
print("\nALL PONTO E2E CHECKS PASSED")
