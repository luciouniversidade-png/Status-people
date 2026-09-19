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
html = page("/configuracoes"); aid = find_form_aid(html, "Criar acesso"); car = re.search(r'<option value="(\d+)">Carandá</option>', html).group(1)
post("/configuracoes", aid, {"nome": "Zelador", "email": "ops@status", "role": "OPERACOES", "senha": "senha12345"}); O = mk(); login(O, "ops@status", "senha12345")
html = page("/colaboradores/novo"); aid2 = action_ids(html)[0]; loc = post("/colaboradores/novo", aid2, {"nome": "Prof. Chamado", "admissao": "2025-02-01", "unitId": car, "vinculo": "CLT", "abrirAdmissao": ""}); emp = re.search(r"/colaboradores/(\d+)\?", loc).group(1)
post("/configuracoes", aid, {"nome": "Prof. Chamado", "email": "prof@car", "role": "COLABORADOR", "employeeId": emp, "unitId": car, "senha": "senha12345"}); P = mk(); login(P, "prof@car", "senha12345")

# ---- ativos + fornecedor
html = page("/operacoes/ativos", sess=O); aid = find_form_aid(html, "Novo ativo")
loc = post("/operacoes/ativos", aid, {"nome": "Ar-condicionado Sala 5", "categoria": "Ar-condicionado", "unitId": car, "ambiente": "Sala 5", "aquisicao": "2024-03-01", "valor": 3200, "garantiaAte": "2026-10-20", "preventivaDias": 90, "ultimaPreventiva": "2026-05-01", "codigo": "PAT-0101"}, sess=O); assert "Ativo salvo" in unq(loc), unq(loc)
html = page("/operacoes/ativos", sess=O); aid = find_form_aid(html, "Importar inventário"); loc = post("/operacoes/ativos", aid, {"unitId": car, "csv": "patrimonio;nome;categoria;ambiente;valor\nPAT-0102;Projetor Sala 3;TI e equipamentos;Sala 3;2.500,00\n;Extintor corredor;Segurança (extintores, câmeras);Corredor;"}, sess=O); assert "2 ativo(s)" in unq(loc), unq(loc); print("ativos ok")
html = page("/operacoes/fornecedores", sess=O); aid = find_form_aid(html, "Novo fornecedor"); loc = post("/operacoes/fornecedores", aid, {"nome": "Frio Bom Refrigeração", "servico": "Ar-condicionado", "telefone": "67 9"}, sess=O); assert "Fornecedor salvo" in unq(loc)
# ---- painel: preventiva vencida (última 01/05 + 90d = 30/07) e garantia vencendo
html = page("/operacoes", sess=O); assert "Ar-condicionado Sala 5" in html and "Preventivas vencidas" in html and "Garantias vencendo" in html; print("preventiva vencida + garantia detectadas ok")
aid = find_form_aid(html, "Abrir preventiva"); assetId = re.search(r'name="assetId" value="(\d+)"', html).group(1); loc = post("/operacoes", aid, {"assetId": assetId}, sess=O); prev = re.search(r"/operacoes/chamados/(\d+)\?", loc).group(1)
html = page(f"/operacoes/chamados/{prev}", sess=O); assert "Preventiva" in html and "Em manutenção" in page("/operacoes/ativos", sess=O); print("preventiva aberta, ativo em manutenção ok")
# ---- colaborador abre chamado (só na própria unidade), acompanha; não vê os dos outros
html = page("/operacoes/chamados", sess=P); aid = find_form_aid(html, "O que precisa ser feito"); loc = post("/operacoes/chamados", aid, {"voltar": "/operacoes/chamados", "titulo": "Tomada da sala 5 soltando faísca", "tipo": "CORRETIVA", "prioridade": "URGENTE", "unitId": car, "ambiente": "Sala 5", "descricao": "Perigo"}, sess=P); cid = re.search(r"/operacoes/chamados/(\d+)\?", loc).group(1)
html = page("/operacoes/chamados", sess=P); assert "Tomada da sala 5" in html and "Preventiva: Ar-condicionado" not in html; print("colaborador abre chamado e vê só os seus ok")
html = page(f"/operacoes/chamados/{cid}", sess=P); assert "Acompanhar" in html and "Atualizar" not in html
r2 = P.get(B + f"/operacoes/chamados/{prev}", allow_redirects=False); assert r2.status_code == 404; print("colaborador não acessa chamado alheio ok")
# ---- SLA urgente 4h; operações executa e conclui com custo; avaliação
html = page("/operacoes/chamados", sess=O); assert "Urgente" in html and "Tomada da sala 5" in html
psql(f"UPDATE work_orders SET sla_ate = now() - interval '1 hour' WHERE id={cid}"); html = page("/operacoes/chamados?filtro=ATRASADOS", sess=O); assert "Tomada da sala 5" in html; print("SLA vencido listado ok")
html = page(f"/operacoes/chamados/{cid}", sess=O); aid = find_form_aid(html, "Atualizar"); fid = re.search(r'<option value="(\d+)">Frio Bom', html).group(1)
post(f"/operacoes/chamados/{cid}", aid, {"id": cid, "status": "EM_EXECUCAO", "supplierId": fid, "nota": "Eletricista a caminho"}, sess=O)
loc = post(f"/operacoes/chamados/{cid}", aid, {"id": cid, "status": "CONCLUIDO", "custoReal": 180.5, "evidencia": "NF 123", "nota": "Tomada trocada"}, sess=O); assert "concluído" in unq(loc)
html = page(f"/operacoes/chamados/{cid}", sess=P); assert "Como foi o atendimento?" in html; aid = find_form_aid(html, "Como foi o atendimento?"); post(f"/operacoes/chamados/{cid}", aid, {"id": cid, "avaliacao": 5}, sess=P)
html = page(f"/operacoes/chamados/{cid}", sess=O); assert "180,50" in html and "5 / 5" in html and "Frio Bom" in html; print("execução, conclusão com custo, avaliação ok")
html = page("/operacoes/fornecedores", sess=O); assert "180,50" in html and "5" in html
# preventiva concluída atualiza última preventiva
html = page(f"/operacoes/chamados/{prev}", sess=O); aid = find_form_aid(html, "Atualizar"); post(f"/operacoes/chamados/{prev}", aid, {"id": prev, "status": "CONCLUIDO", "custoReal": 250}, sess=O)
html = page("/operacoes/ativos", sess=O); assert "Em uso" in html and psql(f"SELECT ultima_preventiva FROM assets WHERE id={assetId}") == psql("SELECT (now() AT TIME ZONE 'America/Campo_Grande')::date"); print("preventiva concluída atualiza o ativo ok")
# ---- vistoria com checklist → chamados automáticos
html = page("/operacoes/vistorias?tipo=Sala+de+aula", sess=O); aid = find_form_aid(html, "Registrar vistoria")
d = {"tipo": "Sala de aula", "unitId": car, "data": "2026-09-14", "ambiente": "Sala 7", "abrirChamados": "1", "obs_0": "porta empena", "obs_9": "sem sinalização"}
for i in range(10): 
    if i not in (0, 9): d[f"ok_{i}"] = "1"
loc = post("/operacoes/vistorias", aid, d, sess=O); msg = unq(loc); assert "8/10 conformes" in msg and "2 chamado(s)" in msg, msg
html = page("/operacoes/vistorias", sess=O); assert "Sala 7" in html and "80%" in html and "Portas e fechaduras" in html
html = page("/operacoes/chamados", sess=O); assert "Sala 7: Portas e fechaduras funcionando" in html and "Sala 7: Extintor" in html; print("vistoria → chamados automáticos ok (extintor = alta)")
assert "Alta" in html
# ---- painel + exports
html = page("/operacoes", sess=O); assert "Chamados abertos" in html and "Custo no mês" in html and "430,50" in html; print("painel com custo do mês ok")
for t in ["chamados", "ativos", "vistorias"]:
    rr = O.get(B + f"/api/export/{t}"); assert rr.status_code == 200 and rr.text.startswith("\ufeff"), t
print("exports ok")
r3 = O.get(B + "/", allow_redirects=False); assert r3.headers.get("location", "").endswith("/operacoes"); print("perfil operações direcionado ok")
html = page("/auditoria?entidade=work_orders"); assert "abrir chamado" in html
print("\nALL OPERACOES E2E CHECKS PASSED")
