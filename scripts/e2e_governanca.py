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
    assert r.status_code == expect, (path, r.status_code, r.headers.get("location")); return re.sub(r"<script[^>]*>.*?</script>", "", r.text, flags=re.S)
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
strip = lambda h: re.sub(r"<!--.*?-->", "", h)

login(S, "rh@colegiostatus", "Status2026!"); r = S.get(B + "/api/setup?token=setup-homologacao-2026-status"); assert r.json()["ok"], r.text

# ---- POPs seed + painel
html = page("/governanca/pops"); assert "POP-001" in html and "POP-009" in html and "Rascunho" in html; print("POPs seed ok (9 rascunhos)")
html = page("/governanca"); assert "Process Health" in html
pid = re.search(r'href="/governanca/pops/(\d+)">Matrícula e reserva de vaga<', html if "Matrícula e reserva" in html else page("/governanca/pops")).group(1)

# ---- publicar sem passos → bloqueado; editar + publicar → vigente v1; ciência
html = page(f"/governanca/pops/{pid}"); aid = find_form_aid(html, "Publicação")
loc = post(f"/governanca/pops/{pid}", aid, {"id": pid}); assert "sem passos" in unq(loc), unq(loc); print("bloqueio: publicar sem passos ok")
aid = find_form_aid(html, "Editar conteúdo"); rh_uid = re.search(r'name="ownerUserId"[^>]*>.*?<option value="(\d+)">RH Colégio Status</option>', html, flags=re.S).group(1)
loc = post(f"/governanca/pops/{pid}", aid, {"id": pid, "codigo": "POP-003", "titulo": "Matrícula e reserva de vaga", "area": "Matrículas e Secretaria", "ownerUserId": rh_uid, "objetivo": "Garantir reserva com prazo", "passos": "1. Conferir vaga no painel\n2. Reservar com prazo\n3. Contrato e financeiro\n4. Confirmar", "responsavel": "Secretaria", "aprovador": "Diretor de unidade"}); assert "POP salvo" in unq(loc), unq(loc)
html = page(f"/governanca/pops/{pid}"); aid = find_form_aid(html, "Publicação")
loc = post(f"/governanca/pops/{pid}", aid, {"id": pid, "notas": "primeira versão"}); assert "publicado como vigente" in unq(loc), unq(loc)
html = page(f"/governanca/pops/{pid}"); assert "Vigente" in html and "Li e entendi" in html and "Conferir vaga" in html; print("publicação v1 ok")
aid = find_form_aid(html, "Li e entendi"); loc = post(f"/governanca/pops/{pid}", aid, {"id": pid}); assert "Ciência registrada" in unq(loc)
html = page(f"/governanca/pops/{pid}"); assert "Você já deu ciência" in html; print("ciência ok")
# nova versão → v2, ciência zera
aid = find_form_aid(html, "Publicação"); loc = post(f"/governanca/pops/{pid}", aid, {"id": pid, "notas": "ajuste no prazo"}); html = strip(page(f"/governanca/pops/{pid}")); assert "v2" in html and "Li e entendi" in html; print("versão 2 ok (ciência reiniciada)")

# ---- colaborador vê a biblioteca e dá ciência; não acessa gestão
html = page("/colaboradores/novo"); aid = action_ids(html)[0]; uid = re.search(r'<option value="(\d+)">Carandá</option>', html).group(1)
loc = post("/colaboradores/novo", aid, {"nome": "Colab Teste", "admissao": "2026-01-05", "unitId": uid, "vinculo": "CLT", "abrirAdmissao": ""}); emp = re.search(r"/colaboradores/(\d+)\?", loc).group(1)
html = page("/configuracoes"); aid = find_form_aid(html, "Criar acesso")
post("/configuracoes", aid, {"nome": "Colab Teste", "email": "colab@teste", "role": "COLABORADOR", "employeeId": emp, "senha": "senha12345"})
S2 = mk(); login(S2, "colab@teste", "senha12345")
html = page("/governanca/pops", sess=S2); assert "POP-003" in html and "Novo POP" not in html
r = S2.get(B + "/governanca/excecoes", allow_redirects=False); assert r.status_code in (302, 303, 307)
html = page(f"/governanca/pops/{pid}", sess=S2); aid = find_form_aid(html, "Li e entendi"); loc = post(f"/governanca/pops/{pid}", aid, {"id": pid}, sess=S2); assert "Ciência registrada" in unq(loc)
html = page(f"/governanca/pops/{pid}"); assert "Colab Teste" in html; print("colaborador: biblioteca + ciência ok; gestão bloqueada ok")

# ---- exceções: solicitar (gestor), aprovar (RH) — quem solicita não aprova; recorrência
post("/configuracoes", find_form_aid(page("/configuracoes"), "Criar acesso"), {"nome": "Gestor Car", "email": "gestor@car", "role": "GESTOR", "unitId": uid, "senha": "senha12345"})
S3 = mk(); login(S3, "gestor@car", "senha12345")
html = page("/governanca/excecoes", sess=S3); aid = find_form_aid(html, "Solicitar exceção")
for i in range(3):
    loc = post("/governanca/excecoes", aid, {"voltar": "/governanca/excecoes", "regra": "Desconto acima da alçada", "procedureId": pid, "motivo": "Decisão comercial pontual", "referencia": f"Família {i}", "descricao": "irmãos", "unitId": uid}, sess=S3); assert "enviada para aprovação" in unq(loc), unq(loc)
html = page("/governanca/excecoes", sess=S3); assert "Decidir" not in html, "gestor sem alçada não vê decidir"
html = page("/governanca/excecoes"); assert html.count("Aguardando aprovação") >= 3; aid = find_form_aid(html, "Decidir")
ids = re.findall(r'<form[^>]*>.*?name="id" value="(\d+)".*?Aprovar', html, flags=re.S)[:3]
for eid in ids: loc = post("/governanca/excecoes", aid, {"id": eid, "decisao": "APROVADA", "nota": "ok"}); assert "aprovada" in unq(loc), unq(loc)
html = strip(page("/governanca")); assert "Desconto acima da alçada" in html and ">3<" in html; print("exceções aprovadas + recorrência detectada ok")
psql(f"UPDATE exceptions SET validade_ate = (now() AT TIME ZONE 'America/Campo_Grande')::date - 1 WHERE id={ids[0]}")
html = page("/governanca/excecoes"); assert "Expirada" in html; print("expiração automática ok")
aid = find_form_aid(html, "Encerrar como revisada"); loc = post("/governanca/excecoes", aid, {"id": ids[0], "decisao": "REVISADA", "nota": "incorporada ao POP-003 v3"}); assert "revisada" in unq(loc); print("revisão ok")
# própria exceção: RH solicita e tenta aprovar
aid = find_form_aid(page("/governanca/excecoes"), "Solicitar exceção"); loc = post("/governanca/excecoes", aid, {"voltar": "/governanca/excecoes", "regra": "Prazo de matrícula", "motivo": "Outro"}); mine = re.search(r"#(\d+)", unq(loc)).group(1)
html = page("/governanca/excecoes"); blk = html[html.find(f'<td class="px-3 py-2 align-top text-slate-500">{mine}</td>'):]; assert "Decidir" not in blk[:3000]; print("quem solicita não aprova ok")

# ---- controles + NC
html = page("/governanca/controles"); aid = find_form_aid(html, "Novo controle")
loc = post("/governanca/controles", aid, {"titulo": "Conferência semanal de reservas vencidas", "area": "Matrículas e Secretaria", "frequencia": "SEMANAL", "procedureId": pid, "unitId": uid, "proximaEm": "2026-09-01", "descricao": "Nenhuma reserva expirada sem tratamento"}); assert "Controle salvo" in unq(loc), unq(loc)
html = page("/governanca/controles"); assert "atrasado" in html; cid = re.search(r'name="controlId" value="(\d+)"', html).group(1); aid = find_form_aid(html, "Registrar")
loc = post("/governanca/controles", aid, {"controlId": cid, "data": "2026-09-11", "resultado": "NAO_CONFORME", "evidencia": "3 reservas vencidas sem contato", "obs": "faltou rotina", "abrirNc": "1", "gravidade": "2"}); msg = unq(loc); assert "Execução registrada" in msg and "Não conformidade #" in msg, msg
html = page("/governanca/controles"); assert "não conforme" in html and "18/09/2026" in html and "Não conformidade em: Conferência" in html; print("controle → NC automática ok (próxima em 7 dias)")
ncid = re.search(r"#(\d+)", msg).group(1)
aid = find_form_aid(html, "Tratar")
loc = post("/governanca/controles", aid, {"id": ncid, "titulo": "Não conformidade em: Conferência semanal de reservas vencidas", "origem": "CONTROLE", "gravidade": 2, "status": "ENCERRADA", "causaRaiz": "sem rotina diária", "acaoCorretiva": "alerta no painel"}); assert "eficácia" in unq(loc), unq(loc)
loc = post("/governanca/controles", aid, {"id": ncid, "titulo": "Não conformidade em: Conferência semanal de reservas vencidas", "origem": "CONTROLE", "gravidade": 2, "status": "ENCERRADA", "causaRaiz": "sem rotina diária", "acaoCorretiva": "alerta no painel", "acaoPreventiva": "POP-003 v3", "eficaciaVerificada": "1"}); assert "salva" in unq(loc), unq(loc)
html = page("/governanca/controles?nc=ENCERRADA"); assert "Encerrada" in html; print("NC com causa raiz + eficácia ok")

# ---- decisões
html = page("/governanca/decisoes"); aid = find_form_aid(html, "Registrar decisão")
loc = post("/governanca/decisoes", aid, {"data": "2026-09-11", "titulo": "Prazo padrão de reserva = 3 dias", "area": "Direção e Governança", "contexto": "Reservas longas travavam vagas", "decisao": "Reserva vale 3 dias corridos; prorrogação só por diretor", "alternativas": "5 dias; sem prazo", "consequencias": "Consultores precisam confirmar mais rápido", "revisarEm": "2026-12-01"}); assert "Decisão registrada" in unq(loc), unq(loc)
html = page("/governanca/decisoes"); assert "Prazo padrão de reserva" in html and "Vigente" in html
aid = find_form_aid(html, "Revogar"); did = re.search(r'name="id" value="(\d+)"', html[html.find("Prazo padrão"):]).group(1)
loc = post("/governanca/decisoes", aid, {"id": did, "status": "REVOGADA"}); html = page("/governanca/decisoes?status=REVOGADA"); assert "Revogada" in html; print("decisões ok")

# ---- painel e exports
html = page("/governanca"); assert "Process Health" in html and "POPs vigentes" in html
for t in ["pops", "excecoes", "ncs", "decisoes"]:
    r = S.get(B + f"/api/export/{t}"); assert r.status_code == 200 and r.text.startswith("\ufeff"), t
print("exports ok")
html = page("/auditoria?entidade=procedures"); assert "publicar" in html
print("\nALL GOVERNANCA E2E CHECKS PASSED")
