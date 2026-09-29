import re, subprocess, requests, io
B = "http://localhost:3100"; TOKEN = "setup-homologacao-2026-status"
def psql(q): return subprocess.run(["su", "postgres", "-c", f"/usr/lib/postgresql/16/bin/psql -h /tmp/pg -U status -d status_people -q -t -c \"{q.replace(chr(34), chr(92) + chr(34))}\""], capture_output=True, text=True).stdout.strip()
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
def post(path, aid, data, sess=None, files=None):
    sess = sess or S; f = [(f"$ACTION_ID_{aid}", (None, ""))] + [(k, (None, str(v))) for k, v in data.items()] + (files or [])
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

login(S, "rh@colegiostatus", "Status2026!"); r = S.get(B + f"/api/setup?token={TOKEN}"); assert r.json()["ok"], r.text
html = page("/colaboradores/novo"); aid = action_ids(html)[0]; car = re.search(r'<option value="(\d+)">Carandá</option>', html).group(1); cul = re.search(r'<option value="(\d+)">Cultura</option>', html).group(1)
def novo(nome, unit): return re.search(r"/colaboradores/(\d+)\?", post("/colaboradores/novo", aid, {"nome": nome, "admissao": "2025-03-03", "unitId": unit, "vinculo": "CLT", "abrirAdmissao": "", "jornadaMinDia": 528})).group(1)
A = novo("Colab Carandá", car); Bc = novo("Colab Cultura", cul)
html = page("/configuracoes"); aid_u = find_form_aid(html, "Criar acesso")
post("/configuracoes", aid_u, {"nome": "Diretor Car", "email": "dir@car", "role": "DIRETOR_UNIDADE", "unitId": car, "senha": "senha12345"}); post("/configuracoes", aid_u, {"nome": "Colab A", "email": "colab@car", "role": "COLABORADOR", "unitId": car, "employeeId": A, "senha": "senha12345"}); post("/configuracoes", aid_u, {"nome": "Colab B", "email": "colab@cul", "role": "COLABORADOR", "unitId": cul, "employeeId": Bc, "senha": "senha12345"})
D = mk(); login(D, "dir@car", "senha12345"); CA = mk(); login(CA, "colab@car", "senha12345"); CB = mk(); login(CB, "colab@cul", "senha12345")

# ===== Comunicados com ciência + notificação
html = page("/comunicacao/comunicados"); aid = find_form_aid(html, "Novo comunicado")
loc = post("/comunicacao/comunicados", aid, {"titulo": "Reunião pedagógica dia 30", "texto": "Todos às 18h no auditório.", "publico": "TODOS", "requerCiencia": "1", "fixado": "1"}); assert "publicado" in unq(loc)
html = page("/comunicacao/comunicados", sess=CA); assert "Reunião pedagógica dia 30" in html and "Li e estou ciente" in html and "aguardando sua ciência" in html
html = page("/notificacoes", sess=CA); assert "Comunicado: Reunião pedagógica" in html; hh = page(f"/colaboradores/{A}", sess=CA); assert "🔔" in hh and "1</span>" in hh; print("comunicado + notificação + sino ok")
hh = page("/comunicacao/comunicados", sess=CA); aid = find_form_aid(hh, "Li e estou ciente"); k = hh.find("Li e estou ciente"); cid = re.findall(r'name="id" value="(\d+)"', hh[:k])[-1]
post("/comunicacao/comunicados", aid, {"id": cid}, sess=CA); html = page("/comunicacao/comunicados", sess=CA); assert "você deu ciência" in html
html = page("/comunicacao/comunicados"); assert re.search(r"1/\d+ cientes", html); print("ciência registrada e contada ok")
# comunicado só para Cultura: colaborador de Carandá não vê
loc = post("/comunicacao/comunicados", find_form_aid(page("/comunicacao/comunicados"), "Novo comunicado"), {"titulo": "Só Cultura", "texto": "x", "publico": "UNIDADE", "unitId": cul}); assert "Só Cultura" not in page("/comunicacao/comunicados", sess=CA) and "Só Cultura" in page("/comunicacao/comunicados", sess=CB); print("comunicado por unidade respeita escopo ok")

# ===== Modelos + mensagem WhatsApp (sem API → link wa.me) e por e-mail (sem Resend → falha registrada)
html = page("/comunicacao/modelos"); assert "COB-LEMBRETE" in html and "{valor}" in html
html = page("/comunicacao/mensagens"); aid = find_form_aid(html, "Nova mensagem")
loc = post("/comunicacao/mensagens", aid, {"voltar": "/comunicacao/mensagens", "canal": "WHATSAPP", "destinatarioNome": "Carla Souza", "destinatarioContato": "(67) 99999-1234", "texto": "Olá, {responsavel}! Teste de {unidade}.", "enviar": "1"}); assert "abra o link do WhatsApp" in unq(loc), unq(loc)
html = page(unq(loc)); assert "https://wa.me/5567999991234?text=" in html and "Ol%C3%A1%2C%20Carla%20Souza" in html and "Registrada" in html; print("mensagem WhatsApp → link wa.me com texto preenchido ok")
aid_m = find_form_aid(html, "Marcar como enviada"); mid = re.search(r'name="id" value="(\d+)"', html[html.find("Marcar como enviada") - 400:]).group(1); post("/comunicacao/mensagens", aid_m, {"id": mid, "voltar": "/comunicacao/mensagens"}); assert psql(f"SELECT status FROM messages WHERE id={mid}") == "ENVIADA"; print("marcar como enviada ok")
loc = post("/comunicacao/mensagens", aid, {"voltar": "/comunicacao/mensagens", "canal": "EMAIL", "destinatarioNome": "Fam", "destinatarioContato": "fam@exemplo.com", "texto": "Oi", "enviar": "1"}); assert "não configurado" in unq(loc); assert psql("SELECT status FROM messages ORDER BY id DESC LIMIT 1") == "FALHOU"; print("e-mail sem serviço → falha registrada ok")
# cobrança pela inadimplência com variáveis
psql(f"INSERT INTO receivables (aluno_nome, responsavel, telefone, unit_id, tipo, competencia, vencimento, valor, status) VALUES ('Aluno Dev', 'Pai Dev', '67 98888-0000', {car}, 'MENSALIDADE', '2026-08', '2026-08-10', 1850, 'ABERTO')")
html = page("/financeiro/inadimplencia"); assert "WhatsApp" in html; aid = find_form_aid(html, "Cobrança — Aluno Dev"); i = html.find("Cobrança — Aluno Dev"); assert "1.850,00" in html[i:i + 6000] and "Aluno Dev" in html[i:i + 6000] and "Identificamos títulos em aberto" in html[i:i + 6000]
loc = post("/financeiro/inadimplencia", aid, {"voltar": "/financeiro/inadimplencia", "canal": "WHATSAPP", "destinatarioNome": "Pai Dev", "destinatarioContato": "67 98888-0000", "texto": "Olá {responsavel}, mensalidade de {aluno} no valor de {valor}", "vars": '{"aluno":"Aluno Dev","valor":"R$ 1.850,00"}', "entidade": "receivable", "enviar": "1"}); assert "msg=" in loc
assert "Aluno Dev" in psql("SELECT texto FROM messages ORDER BY id DESC LIMIT 1") and "Pai Dev" in psql("SELECT destinatario_nome FROM messages ORDER BY id DESC LIMIT 1"); print("cobrança por WhatsApp a partir da inadimplência ok")

# ===== Anexos: upload, download com escopo, remoção
pdf = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"
html = page(f"/colaboradores/{A}"); aid = find_form_aid(html, "Anexar")
loc = post(f"/colaboradores/{A}", aid, {"entidade": "employee", "entidadeId": A, "voltar": f"/colaboradores/{A}", "descricao": "Contrato assinado"}, files=[("arquivo", ("contrato.pdf", pdf, "application/pdf"))]); assert "anexado" in unq(loc), unq(loc)
html = page(f"/colaboradores/{A}"); assert "contrato.pdf" in html and "Contrato assinado" in html; anexo = re.search(r'href="/api/anexos/(\d+)"', html).group(1)
r = S.get(B + f"/api/anexos/{anexo}"); assert r.status_code == 200 and r.content == pdf and r.headers["content-type"].startswith("application/pdf"); print("anexo enviado e baixado ok")
r = CB.get(B + f"/api/anexos/{anexo}"); assert r.status_code == 403; r = D.get(B + f"/api/anexos/{anexo}"); assert r.status_code == 200; print("anexo: colaborador de outra unidade bloqueado, diretor da unidade acessa ok")
r = requests.get(B + f"/api/anexos/{anexo}", allow_redirects=False); assert r.status_code in (401, 307, 302), r.status_code
loc = post(f"/colaboradores/{A}", aid, {"entidade": "employee", "entidadeId": A, "voltar": f"/colaboradores/{A}"}, files=[("arquivo", ("virus.exe", b"MZ...", "application/x-msdownload"))]); assert "Tipo não permitido" in unq(loc); print("tipo de arquivo bloqueado ok")
loc = post(f"/colaboradores/{A}", aid, {"entidade": "employee", "entidadeId": A, "voltar": f"/colaboradores/{A}"}, files=[("arquivo", ("grande.pdf", b"%PDF" + b"0" * (9 * 1048576), "application/pdf"))]); assert "acima de 8 MB" in unq(loc); print("limite de tamanho ok")
html = page(f"/colaboradores/{A}"); aid_r = find_form_aid(html, "remover"); post(f"/colaboradores/{A}", aid_r, {"id": anexo, "voltar": f"/colaboradores/{A}"}); assert "contrato.pdf" not in page(f"/colaboradores/{A}"); print("anexo removido ok")
# colaborador anexa só na própria ficha
html = page(f"/colaboradores/{A}", sess=CA); aid = find_form_aid(html, "Anexar"); loc = post(f"/colaboradores/{A}", aid, {"entidade": "employee", "entidadeId": A, "voltar": f"/colaboradores/{A}"}, files=[("arquivo", ("cert.pdf", pdf, "application/pdf"))], sess=CA); assert "anexado" in unq(loc)
loc = post(f"/colaboradores/{A}", aid, {"entidade": "employee", "entidadeId": Bc, "voltar": f"/colaboradores/{A}"}, files=[("arquivo", ("x.pdf", pdf, "application/pdf"))], sess=CA); assert "erro=" in loc; print("colaborador anexa só na própria ficha ok")

# ===== Notificações por eventos: chamado urgente → diretor da unidade; férias → RH/diretor; rotina diária; marcar lidas
html = page("/operacoes/chamados", sess=CA); aid = find_form_aid(html, "O que precisa ser feito"); post("/operacoes/chamados", aid, {"voltar": "/operacoes/chamados", "titulo": "Fio exposto", "tipo": "CORRETIVA", "prioridade": "URGENTE", "unitId": car}, sess=CA)
html = page("/notificacoes", sess=D); assert "URGENTE · Novo chamado" in html; print("chamado urgente notifica o diretor da unidade ok")
html = page(f"/colaboradores/{A}", sess=CA); aid = find_form_aid(html, "Nova solicitação")
post(f"/colaboradores/{A}", aid, {"employeeId": A, "voltar": f"/colaboradores/{A}", "tipo": "FERIAS", "inicio": "2026-11-03", "fim": "2026-11-12"}, sess=CA); assert "férias/afastamento aguardando" in page("/notificacoes"); print("pedido de férias notifica aprovadores ok")
r = requests.get(B + f"/api/tarefas?token={TOKEN}"); assert r.json()["ok"], r.text; n1 = int(psql("SELECT count(*) FROM notifications")); r2 = requests.get(B + f"/api/tarefas?token={TOKEN}"); assert r2.json()["ok"]; n2 = int(psql("SELECT count(*) FROM notifications")); assert n1 == n2 and r.json()["alertas"] >= 1, (n1, n2, r.json()); print("rotina diária roda e é idempotente ok:", r.json()["alertas"], "alerta(s)")
assert requests.get(B + "/api/tarefas?token=errado").status_code == 403
html = page("/notificacoes"); aid = find_form_aid(html, "Marcar todas como lidas"); post("/notificacoes", aid, {}); assert psql("SELECT count(*) FROM notifications WHERE user_id=(SELECT id FROM users WHERE email='rh@colegiostatus') AND lida_em IS NULL") == "0"; print("marcar todas como lidas ok")
html = page("/auditoria?entidade=attachments"); assert "anexar arquivo" in html
print("\nALL COMUNICACAO/ANEXOS/NOTIFICACOES E2E CHECKS PASSED")
