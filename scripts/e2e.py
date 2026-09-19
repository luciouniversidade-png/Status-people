import re, sys, requests
B = "http://localhost:3100"
S = requests.Session()
S.max_redirects = 10
S.headers.update({"Origin": B})

def page(path, expect=200):
    r = S.get(B + path, allow_redirects=False)
    assert r.status_code == expect, (path, r.status_code, r.headers.get("location"))
    return re.sub(r"<script[^>]*>.*?</script>", "", r.text, flags=re.S)

def action_ids(html):
    # ignora os formulários de "Sair" do menu lateral (ficam antes de <main)
    i = html.find("<main"); body = html[i:] if i >= 0 else html
    return re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', body)

def fix_cookie(sess, r):
    # o cookie de sessão é Secure (produção); no teste local em http, reinsere sem a flag
    sc = r.headers.get("set-cookie", "")
    m = re.search(r"rh_session=([^;]+)", sc)
    if m: sess.headers["Cookie"] = f"rh_session={m.group(1)}"

def post(path, aid, data, follow=True, sess=None):
    sess = sess or S
    files = {f"$ACTION_ID_{aid}": (None, "")}
    for k, v in data.items():
        files[k] = (None, str(v))
    r = sess.post(B + path, files=files, allow_redirects=False)
    fix_cookie(sess, r)
    loc = r.headers.get("location", "")
    if r.status_code not in (303, 302, 200):
        print(r.text[:500]); raise AssertionError((path, r.status_code))
    return loc

def find_form_aid(html, marker):
    """action id of the form that contains `marker` text (searches the closest preceding ACTION_ID)."""
    i = html.find(marker); assert i >= 0, marker
    # find the enclosing <form ...> start, then its ACTION_ID input
    fs = html.rfind("<form", 0, i); fe = html.find("</form>", i)
    ids = action_ids(html[fs:fe]); assert ids, ("no action id near", marker)
    return ids[0]

# ---- setup (tabelas) + login
html = page("/login"); aid = action_ids(html)[0]
loc = post("/login", aid, {"email": "rh@colegiostatus", "senha": "Status2026!"})
assert loc.endswith("/"), loc
print("login ok ->", loc)
assert "rh_session" in S.headers.get("Cookie", "")
r = S.get(B + "/api/setup?token=setup-homologacao-2026-status"); assert r.json()["ok"], r.text
html = page("/"); assert "Colaboradores ativos" in html; print("dashboard ok")

# ---- create employee (with admission process)
html = page("/colaboradores/novo"); aid = action_ids(html)[0]
uid = re.search(r'<option value="(\d+)">Carandá</option>', html).group(1)
pid = re.search(r'<option value="(\d+)">Professor', html).group(1)
loc = post("/colaboradores/novo", aid, {"nome": "Maria Teste da Silva", "admissao": "2024-02-05", "unitId": uid, "positionId": pid, "vinculo": "CLT", "jornadaMinDia": 528, "salario": "4500.00", "abrirAdmissao": "1", "email": "maria@teste"})
m = re.search(r"/colaboradores/(\d+)\?ok=", loc); assert m, loc
emp = m.group(1); print("employee created", emp)
html = page(f"/colaboradores/{emp}"); assert "Em admissão" in html and "R$" in html and "Período aquisitivo" in html; print("ficha ok")

# ---- leave request (férias) + approval
aid = find_form_aid(html, "Nova solicitação")
loc = post(f"/colaboradores/{emp}", aid, {"employeeId": emp, "voltar": f"/colaboradores/{emp}", "tipo": "FERIAS", "inicio": "2026-10-05", "fim": "2026-10-19", "justificativa": "teste"})
assert "ok=" in loc, loc; print("leave requested")
html = page(f"/colaboradores/{emp}")
assert "Aguardando aprova" in html
aid = find_form_aid(html, 'value="APROVADA"')
loc = post(f"/colaboradores/{emp}", aid, {"id": re.search(r'name="id" value="(\d+)"/><input type="hidden" name="voltar"', html).group(1), "voltar": f"/colaboradores/{emp}", "decisao": "APROVADA"})
assert "ok=" in loc, loc
html = page(f"/colaboradores/{emp}"); assert ">Aprovada<" in html and ">15<" in html; print("leave approved, saldo 15 usados ok")
# conflicting request must fail
aid = find_form_aid(html, "Nova solicitação")
loc = post(f"/colaboradores/{emp}", aid, {"employeeId": emp, "voltar": f"/colaboradores/{emp}", "tipo": "FERIAS", "inicio": "2026-10-10", "fim": "2026-10-20"})
assert "erro=" in loc and "neste per" in requests.utils.unquote(loc), loc; print("conflict rejected ok")

# ---- hour bank
aid = find_form_aid(html, "Novo lançamento")
loc = post(f"/colaboradores/{emp}", aid, {"employeeId": emp, "voltar": f"/colaboradores/{emp}", "data": "2026-09-01", "tipo": "EXTRA", "horas": 2, "minutos": 30, "sinal": "+", "descricao": "sábado letivo"})
assert "ok=" in loc, loc
loc = post(f"/colaboradores/{emp}", aid, {"employeeId": emp, "voltar": f"/colaboradores/{emp}", "data": "2026-09-02", "tipo": "ATRASO", "horas": 0, "minutos": 45, "sinal": "+"})
html = page(f"/colaboradores/{emp}"); assert "+1h45" in html, "saldo esperado +1h45"; print("hour bank saldo ok (+1h45)")

# ---- documents: mark received + add with validade
aid = find_form_aid(html, "Recebido hoje")
docid = re.search(r'name="docId" value="(\d+)"', html[html.find("Recebido hoje")-400:html.find("Recebido hoje")]).group(1)
loc = post(f"/colaboradores/{emp}", aid, {"docId": docid, "employeeId": emp}); print("doc received", loc[-20:])
aid = find_form_aid(html, "Adicionar documento")
loc = post(f"/colaboradores/{emp}", aid, {"employeeId": emp, "tipo": "ASO periódico", "validade": "2026-09-20", "recebidoEm": "2025-09-20", "obrigatorio": "1"})
html = page(f"/colaboradores/{emp}"); assert "ASO periódico" in html and "Vence em 30 dias" in html; print("documents ok")
html = page("/documentos"); assert "ASO periódico" in html; print("documents overview ok")

# ---- process: complete admission checklist -> ATIVO
html = page("/processos"); m = re.search(r'href="/processos/(\d+)"', html); pr = m.group(1)
html = page(f"/processos/{pr}")
aid = find_form_aid(html, 'aria-label="Concluir item"')
for item in re.findall(r'name="itemId" value="(\d+)"', html):
    post(f"/processos/{pr}", aid, {"processId": pr, "itemId": item})
html = page(f"/processos/{pr}"); assert "Reabrir item" in html
aid = find_form_aid(html, "Ao concluir, o colaborador")
loc = post(f"/processos/{pr}", aid, {"processId": pr}); assert "ok=" in loc, loc
html = page(f"/colaboradores/{emp}"); assert ">Ativo<" in html or "Em férias" in html; print("admission concluded -> ativo")

# ---- termination flow
aid = find_form_aid(html, "Iniciar desligamento")
loc = post(f"/colaboradores/{emp}", aid, {"id": emp, "desligamento": "2026-09-30", "motivo": "teste"})
m = re.search(r"/processos/(\d+)", loc); assert m, loc; pr2 = m.group(1); print("termination process", pr2)
html = page(f"/processos/{pr2}"); aid = find_form_aid(html, "Ao concluir, o v")
loc = post(f"/processos/{pr2}", aid, {"processId": pr2}); assert "erro=" in loc, "should block with pending items"; print("termination blocked with pending items ok")

# ---- CSV import
html = page("/colaboradores/importar"); aid = action_ids(html)[0]
csv = "nome;unidade;cargo;empresa;vinculo;admissao;jornada_min_dia\nJoão Import;TVM1;Inspetor de Alunos;Colégio Status LTDA;CLT;03/08/2026;528\nAna Import;Cultura;Cargo Inexistente;;HORISTA;2026-02-01;\nErro Linha;Unidade X;;;;2026-01-01;"
loc = post("/colaboradores/importar", aid, {"csv": csv}); msg = requests.utils.unquote(loc)
assert "2 colaborador(es)" in msg and "1 linha(s) com erro" in msg, msg; print("csv import ok:", msg[:80])

# ---- other pages render
for p in ["/organograma", "/ferias", "/banco-de-horas", "/auditoria", "/configuracoes", "/conta", "/processos?tipo=DESLIGAMENTO"]:
    page(p)
print("pages ok")

# ---- create a scoped user (Gestor TV Morena I) and check scope
html = page("/configuracoes"); aid = find_form_aid(html, "Criar acesso")
tv1 = re.search(r'<option value="(\d+)">TV Morena I</option>', html).group(1)
loc = post("/configuracoes", aid, {"nome": "Gestor TV1", "email": "gestor@tv1", "role": "GESTOR", "unitId": tv1, "senha": "senha12345"}); assert "ok=" in loc, loc
S2 = requests.Session(); S2.headers.update({"Origin": B}); html = S2.get(B + "/login").text; aid = action_ids(html)[0]
loc = post("/login", aid, {"email": "gestor@tv1", "senha": "senha12345"}, sess=S2); assert loc.endswith("/"), loc
html = S2.get(B + "/colaboradores").text; assert "João Import" in html and "Maria Teste" not in html; print("unit scope ok")
r = S2.get(B + f"/colaboradores/{emp}", allow_redirects=False); assert r.status_code == 404; print("cross-unit ficha blocked (404) ok")
r = S2.get(B + "/configuracoes", allow_redirects=False); assert r.status_code in (302, 303, 307); print("config blocked for gestor ok")
html = S2.get(B + "/colaboradores/" + re.search(r'href="/colaboradores/(\d+)"', html).group(1)).text; assert "Salário base" not in html and ">CPF<" not in html; print("salary hidden for gestor ok")

html = page("/auditoria"); assert "criar" in html and "aprovar" in html; print("audit ok")

# ---- exports
for t in ["colaboradores", "banco", "ferias"]:
    r = S.get(B + f"/api/export/{t}", allow_redirects=False); assert r.status_code == 200 and r.text.startswith("\ufeffnome;"), (t, r.status_code, r.text[:40])
assert "cpf;salario" in S.get(B + "/api/export/colaboradores").text.splitlines()[0]
assert "cpf" not in S2.get(B + "/api/export/colaboradores").text.splitlines()[0]; print("exports ok (salary only for RH)")

# ---- import saldos do banco
html = page("/banco-de-horas/importar"); aid = action_ids(html)[0]
loc = post("/banco-de-horas/importar", aid, {"data": "2026-08-31", "csv": "nome;saldo\nJoão Import;-4215\nAna Import;16:05\nNinguém Aqui;10\nMaria Teste da Silva;0"})
msg = requests.utils.unquote(loc); assert "2 saldo(s) importado(s), 1 pulado(s)" in msg and "1 linha(s) com erro" in msg, msg
loc = post("/banco-de-horas/importar", aid, {"data": "2026-08-31", "csv": "nome;saldo\nJoão Import;-4215"}); assert "0 saldo(s) importado(s), 1 pulado(s)" in requests.utils.unquote(loc); print("saldos import ok (idempotente)")
html = page("/banco-de-horas"); assert "−70h15" in html and "+16h05" in html; print("saldos visíveis ok")

# ---- férias a vencer: colaborador admitido há 2 anos sem férias
html = page("/colaboradores/novo"); aid = action_ids(html)[0]
loc = post("/colaboradores/novo", aid, {"nome": "Carlos Antigo", "admissao": "2024-01-10", "unitId": uid, "vinculo": "CLT"})
html = page("/ferias"); assert "Carlos Antigo" in html and "Vencido" in html; print("alerta férias vencidas ok")
html = page("/"); assert "risco de férias em dobro" in html

# ---- autoatendimento (COLABORADOR)
html = page("/configuracoes"); aid = find_form_aid(html, "Criar acesso")
joao = re.search(r'<option value="(\d+)">João Import</option>', html).group(1)
loc = post("/configuracoes", aid, {"nome": "João Import", "email": "joao@self", "role": "COLABORADOR", "employeeId": joao, "senha": "senha12345"}); assert "ok=" in loc, loc
S3 = requests.Session(); S3.headers.update({"Origin": B}); html = S3.get(B + "/login").text; aid = action_ids(html)[0]
loc = post("/login", aid, {"email": "joao@self", "senha": "senha12345"}, sess=S3)
r = S3.get(B + "/", allow_redirects=False); assert r.status_code in (302, 303, 307) and r.headers["location"].endswith(f"/colaboradores/{joao}"), (r.status_code, r.headers.get("location")); print("self-service redirect ok")
html = S3.get(B + f"/colaboradores/{joao}").text; assert "Nova solicitação" in html and ">Editar<" not in html and ">Desligar<" not in html and "Salário base" not in html
assert S3.get(B + f"/colaboradores/{emp}", allow_redirects=False).status_code == 404
assert S3.get(B + "/colaboradores", allow_redirects=False).status_code in (302, 303, 307)
assert S3.get(B + "/api/export/banco", allow_redirects=False).status_code == 401
aid = find_form_aid(html, "Nova solicitação")
loc = post(f"/colaboradores/{joao}", aid, {"employeeId": joao, "voltar": f"/colaboradores/{joao}", "tipo": "FOLGA_BANCO", "inicio": "2026-11-03", "fim": "2026-11-03"}, sess=S3); assert "ok=" in loc, loc
loc = post(f"/colaboradores/{joao}", aid, {"employeeId": emp, "voltar": f"/colaboradores/{joao}", "tipo": "FOLGA_BANCO", "inicio": "2026-11-04", "fim": "2026-11-04"}, sess=S3); assert "erro=" in loc, "não pode solicitar para outro"
print("self-service scope ok")

# ---- relatório mensal + export
html = page("/relatorios?mes=2026-09"); assert "Relatório mensal" in html and "Saldo inicial" in html; print("relatorio ok")
r = S.get(B + "/api/export/banco-mensal?mes=2026-09"); assert r.status_code == 200 and "saldo_final_min" in r.text.splitlines()[0]; print("export mensal ok")
html = page("/relatorios?mes=2026-08"); assert "Saldo importado" not in html  # só movimento; ok se renderiza

# ---- bloqueio por tentativas
S4 = requests.Session(); S4.headers.update({"Origin": B}); html = S4.get(B + "/login").text; aid = action_ids(html)[0]
for i in range(5):
    loc = post("/login", aid, {"email": "gestor@tv1", "senha": "errada"}, sess=S4); assert loc.endswith("erro=1"), loc
loc = post("/login", aid, {"email": "gestor@tv1", "senha": "senha12345"}, sess=S4); assert loc.endswith("erro=bloqueado"), loc; print("login throttle ok")

# ---- usuário desativado perde acesso
html = page("/configuracoes"); i = html.find("joao@self"); fs = html.rfind("<form", 0, html.find("Salvar", i)); aid = re.search(r'name="\$ACTION_ID_([0-9a-f]+)"', html[fs:]).group(1)
uid_joao = re.search(r'name="id" value="(\d+)"', html[fs:]).group(1)
loc = post("/configuracoes", aid, {"id": uid_joao, "nome": "João Import", "email": "joao@self", "role": "COLABORADOR", "employeeId": joao, "ativo": "0"}); assert "ok=" in loc, loc
r = S3.get(B + f"/colaboradores/{joao}", allow_redirects=False); assert r.status_code in (302, 303, 307) and "/api/sair?motivo=inativo" in r.headers.get("location", ""), (r.status_code, r.headers.get("location"))
r = S3.get(B + "/api/sair?motivo=inativo", allow_redirects=False); assert r.status_code in (302, 303, 307) and "erro=inativo" in r.headers.get("location", "") and "rh_session=;" in r.headers.get("set-cookie", "") or "Max-Age=0" in r.headers.get("set-cookie", ""); print("inactive user blocked ok")
print("\nALL E2E CHECKS PASSED")
