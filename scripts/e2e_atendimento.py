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

login(S, "rh@colegiostatus", "Status2026!"); r = S.get(B + "/api/setup?token=setup-homologacao-2026-status"); assert r.json()["ok"], r.text

# ---- aluno atual (rematrícula) e candidato
html = page("/matriculas/alunos/novo"); aid = action_ids(html)[0]
car = re.search(r'<option value="(\d+)">Carandá</option>', html).group(1); serie = re.search(r'<option value="(\d+)">3º ano</option>', html).group(1)
loc = post("/matriculas/alunos/novo", aid, {"nome": "Ana Família", "responsavel": "Carla", "telefone": "67 9", "alunoAtual": "1", "unitAtualId": car, "serieAtualId": serie}); A = re.search(r"/matriculas/alunos/(\d+)\?", loc).group(1)
loc = post("/matriculas/alunos/novo", aid, {"nome": "Beto Família", "alunoAtual": "1", "unitAtualId": car, "serieAtualId": serie}); Bs = re.search(r"/matriculas/alunos/(\d+)\?", loc).group(1)

# ---- painel vazio
html = page("/atendimento"); assert "Atendimento e retenção" in html; print("painel ok")

# ---- reclamação grave (urgente, SLA 4h) com Service Recovery
html = page("/atendimento/casos"); aid = find_form_aid(html, "Novo atendimento")
loc = post("/atendimento/casos", aid, {"voltar": "/atendimento/casos", "studentId": A, "tipo": "RECLAMACAO", "canal": "WHATSAPP", "assunto": "Aluno voltou sem lanche", "descricao": "Mãe relatou que a criança não lanchou.", "categoria": "Alimentação", "gravidade": 3})
c1 = re.search(r"/atendimento/casos/(\d+)\?ok=", loc).group(1); print("caso reclamação", c1)
html = page(f"/atendimento/casos/{c1}"); assert "Urgente" in html and "Service Recovery" in html and "Ouvir a família" in html and "Alimentação" in html; print("prioridade automática + checklist ok")
aid = find_form_aid(html, 'aria-label="marcar"'); post(f"/atendimento/casos/{c1}", aid, {"id": c1, "idx": 0})
html = page(f"/atendimento/casos/{c1}"); assert "line-through" in html; print("checklist ok")
aid = find_form_aid(html, "Novo registro"); post(f"/atendimento/casos/{c1}", aid, {"id": c1, "texto": "Liguei para a mãe, pediu retorno amanhã", "tipoEvento": "CONTATO"})
html = page(f"/atendimento/casos/{c1}"); assert "contato com a família" in html and "Liguei para a mãe" in html; print("linha do tempo ok")
# resolver sem causa raiz → bloqueado; com causa raiz → ok + CSAT
aid = find_form_aid(html, "Mudar situação")
loc = post(f"/atendimento/casos/{c1}", aid, {"id": c1, "status": "RESOLVIDO"}); assert "causa raiz" in unq(loc), unq(loc); print("bloqueio sem causa raiz ok")
loc = post(f"/atendimento/casos/{c1}", aid, {"id": c1, "status": "FECHADO", "causaRaiz": "Falha na conferência da lancheira", "acaoCorretiva": "Checklist de saída do refeitório", "satisfacao": 4}); assert "Caso fechado" in unq(loc), unq(loc)
html = page(f"/atendimento/casos/{c1}"); assert "Falha na confer" in html and "Satisfação" in html; print("fechamento com causa raiz + CSAT ok")
html = page("/atendimento/pesquisas"); assert "CSAT" in html and 'label="4"' in html or ">4<" in html; print("CSAT registrado nas pesquisas ok")

# ---- SLA vencido → escalonamento automático
html = page("/atendimento/casos"); aid = find_form_aid(html, "Novo atendimento")
loc = post("/atendimento/casos", aid, {"voltar": "/atendimento/casos", "studentId": Bs, "tipo": "SOLICITACAO", "canal": "TELEFONE", "assunto": "Segunda via de boleto"}); c2 = re.search(r"/atendimento/casos/(\d+)\?", loc).group(1)
psql(f"UPDATE cases SET sla_ate = now() - interval '2 hours' WHERE id={c2}")
html = page("/atendimento/casos?filtro=ATRASADOS"); assert "Segunda via de boleto" in html and "escalado" in html; print("SLA vencido + escalonamento ok")
html = page(f"/atendimento/casos/{c2}"); assert "SLA vencido — caso escalado" in html

# ---- pedido de saída: protocolo de retenção; desfecho obrigatório
html = page(f"/matriculas/alunos/{A}"); aid = find_form_aid(html, "Novo atendimento")
loc = post(f"/matriculas/alunos/{A}", aid, {"voltar": f"/matriculas/alunos/{A}#atendimento", "studentId": A, "tipo": "SAIDA", "canal": "PRESENCIAL", "assunto": "Quer transferir para escola perto de casa"}); c3 = re.search(r"/atendimento/casos/(\d+)\?", loc).group(1)
html = page(f"/atendimento/casos/{c3}"); assert "Protocolo de retenção" in html and "Alta" in html; print("pedido de saída com protocolo ok")
html = page("/atendimento/risco"); assert "Ana Família" in html and "pedido de saída em aberto" in html and "Alto" in html; print("risco alto pela saída ok")
aid = find_form_aid(page(f"/atendimento/casos/{c3}"), "Mudar situação")
loc = post(f"/atendimento/casos/{c3}", aid, {"id": c3, "status": "FECHADO"}); assert "desfecho" in unq(loc), unq(loc)
loc = post(f"/atendimento/casos/{c3}", aid, {"id": c3, "status": "FECHADO", "resultado": "RETIDO", "nota": "Ofertamos transporte"}); assert "Caso fechado" in unq(loc), unq(loc); print("retenção com desfecho ok")
html = page("/atendimento"); assert "100%" in html; print("taxa de retenção 100% ok")

# ---- NPS: detrator gera risco; import CSV
html = page("/atendimento/pesquisas"); aid = find_form_aid(html, "Registrar resposta")
loc = post("/atendimento/pesquisas", aid, {"voltar": "/atendimento/pesquisas", "tipo": "NPS", "nota": 4, "studentId": Bs, "comentario": "Demora no atendimento"}); assert "Resposta registrada" in unq(loc), unq(loc)
loc = post("/atendimento/pesquisas", aid, {"voltar": "/atendimento/pesquisas", "tipo": "NPS", "nota": 10, "studentId": A})
html = page("/atendimento/pesquisas"); aid = find_form_aid(html, "Importar respostas")
loc = post("/atendimento/pesquisas", aid, {"csv": "tipo;nota;data;aluno;unidade;comentario\nNPS;9;05/09/2026;;Carandá;Ótima\nNPS;2;05/09/2026;Zé Ninguém;;ruim\nCSAT;5;05/09/2026;Ana Família;;top"}); msg = unq(loc); assert "2 resposta(s) importada(s)" in msg and "1 com erro" in msg, msg; print("import NPS ok")
html = page("/atendimento"); assert "NPS do mês" in html
html = page("/atendimento/risco"); assert "Beto Família" in html and "NPS detrator" in html and "SLA vencido" in html; print("risco por NPS + SLA ok")

# ---- inadimplência em lote + observação manual
html = page("/atendimento/risco"); aid = find_form_aid(html, "Inadimplência (do ActiveSoft)")
loc = post("/atendimento/risco", aid, {"csv": "Beto Família\nFulano Inexistente", "zerar": "1"}); msg = unq(loc); assert "1 aluno(s) marcado(s)" in msg and "Fulano" in msg, msg
html = page("/atendimento/risco"); assert "inadimplência registrada" in html; print("inadimplência ok")

# ---- perfil comercial acessa atendimento; exports
html = page("/configuracoes"); aid = find_form_aid(html, "Criar acesso")
post("/configuracoes", aid, {"nome": "Atendente", "email": "at@teste", "role": "COMERCIAL", "senha": "senha12345"})
S2 = mk(); login(S2, "at@teste", "senha12345"); html = page("/atendimento/casos", sess=S2); assert "Novo atendimento" in html; print("perfil comercial no atendimento ok")
for t in ["casos", "pesquisas", "risco"]:
    r = S.get(B + f"/api/export/{t}"); assert r.status_code == 200 and r.text.startswith("\ufeff"), t
print("exports ok")
html = page("/auditoria?entidade=cases"); assert "abrir caso" in html and "mudar status" in html
print("\nALL ATENDIMENTO E2E CHECKS PASSED")
