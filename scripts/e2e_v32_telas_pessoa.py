# E2E — v32 · Telas por pessoa. O padrão continua sendo o cargo; sobre ele, cada pessoa pode ter telas a mais e a menos (com motivo
# e, se quiser, data de fim) — o ajuste guarda só a diferença e tudo o mais segue o cargo. Cobre: migração 32.0, editor da pessoa
# (catálogo da atuação com o que o cargo dá, “+ só desta pessoa” e “− tirada desta pessoa”), motivo obrigatório, substituição que soma por cima do ajuste, menu e bloqueio
# por endereço (a outra pessoa do mesmo cargo não muda), página “Tela fora do seu acesso” explicando o ajuste individual, mudança
# no cargo que acompanha, salvar igual ao cargo tira o ajuste, telas fora da atuação e fixas sem efeito, data de fim (inválida,
# vencida e retirada pela rotina diária, com aviso), pendência do ajuste que vence, cópia do ajuste de outra pessoa, ajuste em lote
# (acrescentar, retirar, voltar ao padrão nas telas marcadas ou em todas; sem efeito para quem já tem ou cuja atuação não tem; conta
# sem ficha fora), trava contra trancar o sistema, permissão (só RH e Direção), matriz (aba Telas por pessoa, quem vê cada tela,
# fora do padrão), selo na lista de usuários, cargo com as pessoas ajustadas e a trilha de auditoria.
# Dados fictícios. Uso: bash /tmp/withserver.sh python3 scripts/e2e_v32_telas_pessoa.py
import re, json, subprocess, requests
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
B = "http://localhost:3100"; TOKEN = "setup-homologacao-2026-status"
def psql(q):
    r = subprocess.run(["su", "postgres", "-c", "/usr/lib/postgresql/16/bin/psql -h /tmp/pg -U status -d status_people -q -t -A -F '|' -v ON_ERROR_STOP=1"], input=q + ";", capture_output=True, text=True)
    assert r.returncode == 0, (q[:300], r.stderr[:500]); return r.stdout.strip()
def mk(): s = requests.Session(); s.headers.update({"Origin": B}); return s
unq = requests.utils.unquote; N = [0]
def ok(msg): N[0] += 1; print(f"  ✓ {msg}")
def action_ids(html):
    i = html.find("<main"); body = html[i:] if i >= 0 else html
    return re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', body)
def fix_cookie(sess, r):
    m = re.search(r"rh_session=([^;]+)", r.headers.get("set-cookie", ""))
    if m: sess.headers["Cookie"] = f"rh_session={m.group(1)}"
def get(path, sess): return sess.get(B + path, allow_redirects=False)
def page(path, sess, expect=200):
    r = get(path, sess)
    if isinstance(expect, tuple): assert r.status_code in expect, (path, r.status_code, r.headers.get("location"))
    else: assert r.status_code == expect, (path, r.status_code, r.headers.get("location"))
    return re.sub(r"<script[^>]*>.*?</script>", "", re.sub(r"<!--.*?-->", "", r.text), flags=re.S).replace("\xa0", " ")
def loc_of(path, sess): r = get(path, sess); return r.status_code, unq(r.headers.get("location", ""))
def post(path, aid, data, sess):
    f = [(f"$ACTION_ID_{aid}", (None, ""))]
    for k, v in data.items():
        for x in (v if isinstance(v, list) else [v]): f.append((k, (None, str(x))))
    r = sess.post(B + path, files=f, allow_redirects=False); fix_cookie(sess, r)
    assert r.status_code in (303, 302, 200), (path, r.status_code, r.text[:300]); return unq(r.headers.get("location", "")).replace("\xa0", " ").replace("+", " ")
def aid_of(html, marker):
    i = html.find(marker); assert i >= 0, marker
    fs = html.rfind("<form", 0, i); fe_prev = html.rfind("</form>", 0, i)
    if fs > fe_prev: fe = html.find("</form>", i)
    else: fs = html.find("<form", i); fe = html.find("</form>", fs)
    ids = action_ids(html[fs:fe]); assert ids, marker; return ids[0]
def form_of(html, marker):
    i = html.find(marker); assert i >= 0, marker
    fs = html.rfind("<form", 0, i); fe = html.find("</form>", i); return html[fs:fe]
def login(email, senha="senha12345"):
    s = mk(); html = s.get(B + "/login").text; aid = re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', html)[0]
    loc = post("/login", aid, {"email": email, "senha": senha}, s); assert loc.endswith("/"), (email, loc); return s
def erro(loc, trecho): assert "erro=" in loc and trecho in loc, (trecho, loc)
def okmsg(loc, trecho=""): assert "ok=" in loc and trecho in loc, (trecho, loc)
def menu(html):
    a = html.find("<aside"); b = html.find("</aside>", a); asd = html[a:b]; i = asd.find('class="hidden md:block"')
    return re.findall(r'<a [^>]*href="([^"]+)"', asd[i:] if i >= 0 else asd)
def q(v): return "NULL" if v is None else str(v) if isinstance(v, (int, float)) else "'" + str(v).replace("'", "''") + "'"
def caixas(html):
    """Caixas do editor da pessoa: chave → (marcada, o cargo dá)."""
    out = {}
    for tag in [t for t in re.findall(r'<input[^>]*>', html) if 'name="telas"' in t and 'data-base=' in t]:
        k = re.search(r'value="([^"]+)"', tag).group(1); out[k] = ("checked" in tag, 'data-base="1"' in tag)
    return out
def aj(uid):
    v = psql(f"SELECT coalesce(ajuste_telas::text, '') FROM users WHERE id={uid}"); return json.loads(v) if v else None
HOJE = datetime.now(ZoneInfo("America/Campo_Grande")).date(); H = HOJE.isoformat()
def d(n): return (HOJE + timedelta(days=n)).isoformat()

print("Preparação")
RH = login("rh@colegiostatus", "Status2026!"); r = RH.get(B + f"/api/setup?token={TOKEN}"); assert r.json()["ok"], r.text
assert float(psql("SELECT value->>'versao' FROM settings WHERE key='banco'")) >= 32 and psql("SELECT count(*) FROM information_schema.columns WHERE table_name='users' AND column_name='ajuste_telas'") == "1"
U = {c: int(psql(f"SELECT id FROM units WHERE codigo='{c}'")) for c in ["CAR", "CUL"]}; CAR, CUL = U["CAR"], U["CUL"]
P = {n: int(psql(f"SELECT id FROM positions WHERE nome='{n}'")) for n in ["Gerente Financeiro", "Auxiliar Administrativo", "Tesoureiro", "Professor", "Coordenadora de RH"]}
def emp(nome, cargo, unit, gestor=None):
    return int(psql(f"INSERT INTO employees (nome, unit_id, position_id, vinculo, admissao, gestor_id, situacao) VALUES ({q(nome)}, {unit}, {P[cargo]}, 'CLT', '2023-02-01', {q(gestor)}, 'ATIVO') RETURNING id"))
ANA = emp("Ana Gerente (fictícia)", "Gerente Financeiro", CAR)
BETO = emp("Beto Auxiliar (fictício)", "Auxiliar Administrativo", CAR, ANA); BIA = emp("Bia Auxiliar (fictícia)", "Auxiliar Administrativo", CUL, ANA)
CAIO = emp("Caio Tesoureiro (fictício)", "Tesoureiro", CUL, ANA); DORA = emp("Dora Professora (fictícia)", "Professor", CAR); RITA = emp("Rita RH (fictícia)", "Coordenadora de RH", CAR)
h = page(f"/configuracoes/acessos/cargo/{P['Auxiliar Administrativo']}?atuacao=FINANCEIRO", RH); aid_cargo = aid_of(h, "Salvar o acesso do cargo")
TELAS_AUX = ["/financeiro", "/financeiro/recebimentos", "/financeiro/conciliacao", "/financeiro/despesas", "/financeiro/contas-a-pagar", "/financeiro/descontos", "/aprovacoes", "/alertas", "/solicitacoes", "/comunicacao/comunicados", "/governanca/pops"]
okmsg(post(f"/configuracoes/acessos/cargo/{P['Auxiliar Administrativo']}", aid_cargo, {"id": P["Auxiliar Administrativo"], "atuacao": "FINANCEIRO", "telas": TELAS_AUX, "seguePadrao": "1"}, RH), "Vale para")
h = page("/configuracoes", RH); aid_user = aid_of(h, "Criar acesso")
def novo(eid, email): okmsg(post("/configuracoes", aid_user, {"modo": "auto", "employeeId": eid, "nome": "", "email": email, "senha": "senha12345", "atuacao": "LEITURA", "unitId": ""}, RH)); return int(psql(f"SELECT id FROM users WHERE email='{email}'"))
UANA, UBETO, UBIA, UCAIO, UDORA, URITA = novo(ANA, "ana@fin"), novo(BETO, "beto@fin"), novo(BIA, "bia@fin"), novo(CAIO, "caio@fin"), novo(DORA, "dora@car"), novo(RITA, "rita@rh")
URH = int(psql("SELECT id FROM users WHERE email='rh@colegiostatus'"))
assert psql(f"SELECT role FROM users WHERE id={UBETO}") == "FINANCEIRO" and psql(f"SELECT role FROM users WHERE id={URITA}") == "RH"
ok("esquema 32.0 com o ajuste de telas; cargo Auxiliar Administrativo no Financeiro com 11 telas (sem DRE nem cockpit); fichas e acessos fictícios")

print("Editor da pessoa: o padrão é o cargo, o ajuste guarda só a diferença")
h = page(f"/configuracoes/acessos/usuario/{UBETO}", RH); assert "Telas desta pessoa — o padrão é o cargo" in h and "Tudo como o cargo" in h and "como o cargo" in h
cx = caixas(h); assert cx["/financeiro/recebimentos"] == (True, True) and cx["/financeiro/dre"] == (False, False) and cx["/financeiro/descontos"] == (True, True), cx
assert "/eu" not in cx and "/configuracoes" not in cx  # fixas não entram como caixa editável; tela de outra atuação não aparece
aid_tp = aid_of(h, "Salvar as telas desta pessoa")
marcadas = [k for k, (m, _) in cx.items() if m and k != "/financeiro/descontos"] + ["/financeiro/dre"]
erro(post(f"/configuracoes/acessos/usuario/{UBETO}", aid_tp, {"id": UBETO, "telas": marcadas, "motivo": "curto"}, RH), "motivo do ajuste")
okmsg(post(f"/configuracoes/acessos/usuario/{UBETO}", aid_tp, {"id": UBETO, "telas": marcadas, "motivo": "Apoia o fechamento do mês até dezembro", "ate": d(30)}, RH), "1 a mais e 1 a menos que o cargo")
a = aj(UBETO); assert a["mais"] == ["/financeiro/dre"] and a["menos"] == ["/financeiro/descontos"] and a["ate"] == d(30) and a["motivo"].startswith("Apoia o fechamento") and a["por"], a
BT = login("beto@fin"); m = menu(page("/financeiro", BT)); assert "/financeiro/dre" in m and "/financeiro/descontos" not in m and "/financeiro/recebimentos" in m, m
assert get("/financeiro/dre", BT).status_code == 200
st, lc = loc_of("/financeiro/descontos", BT); assert st in (302, 303, 307) and lc.startswith("/sem-acesso"), (st, lc)
hs = page(lc, BT); assert "foi retirada do <b>seu</b> acesso por um ajuste individual" in hs and "Auxiliar Administrativo" in hs
BI = login("bia@fin"); st, lc = loc_of("/financeiro/dre", BI); assert st in (302, 303, 307) and lc.startswith("/sem-acesso"), (st, lc)
assert get("/financeiro/descontos", BI).status_code == 200 and "não faz parte do acesso" in page(lc, BI)
h = page(f"/configuracoes/acessos/usuario/{UBETO}", RH); assert "Ajuste em vigor" in h and "+ só desta pessoa" in h and "Retiradas desta pessoa" in h and "Apoia o fechamento do mês" in h
ok("caixas com o que o cargo dá; sem motivo recusado; Beto passa a ver a DRE e deixa de ver Descontos (menu e endereço), com a explicação do ajuste individual; Bia, do mesmo cargo, não muda")

print("Substituição soma por cima do ajuste")
gf = psql(f"SELECT coalesce(acesso->>'telas', '') FROM positions WHERE id={P['Gerente Financeiro']}")
assert gf in ("", "null") or "/financeiro/descontos" in gf, gf  # a gerente vê Descontos pelo cargo
h = page(f"/configuracoes/acessos/usuario/{UBETO}", RH); aid_s = aid_of(h, "Registrar substituição")
okmsg(post(f"/configuracoes/acessos/usuario/{UBETO}", aid_s, {"id": UBETO, "positionId": P["Gerente Financeiro"], "ate": d(5), "motivo": "férias da gerente (teste)"}, RH), "volta sozinho")
m = menu(page("/financeiro", BT)); assert "/financeiro/descontos" in m and "/financeiro/dre" in m, m  # quem cobre a gerente vê as telas dela — mesmo a retirada só dele
assert get("/financeiro/descontos", BT).status_code == 200
a2 = aj(UBETO); assert a2["mais"] == ["/financeiro/dre"] and a2["menos"] == ["/financeiro/descontos"], a2  # o ajuste continua guardado, sem mudança
h = page(f"/configuracoes/acessos/usuario/{UBETO}", RH); assert "enquanto durar a substituição, vê pelo cargo substituído: Descontos e bolsas" in h
cx = caixas(h); assert cx["/financeiro/descontos"] == (False, True) and cx["/financeiro/dre"] == (True, False), cx  # o editor mostra o acesso de sempre (sem a substituição)
okmsg(post(f"/configuracoes/acessos/usuario/{UBETO}", aid_of(h, "Encerrar agora"), {"id": UBETO}, RH), "")
st, lc = loc_of("/financeiro/descontos", BT); assert st in (302, 303, 307) and lc.startswith("/sem-acesso"), (st, lc)
assert "/financeiro/dre" in menu(page("/financeiro", BT))
ok("durante a substituição, as telas do cargo substituído somam por cima do ajuste (Descontos volta enquanto durar); o editor mostra o acesso de sempre; encerrada a substituição, o ajuste volta a valer inteiro")

print("O resto continua seguindo o cargo")
okmsg(post(f"/configuracoes/acessos/cargo/{P['Auxiliar Administrativo']}", aid_cargo, {"id": P["Auxiliar Administrativo"], "atuacao": "FINANCEIRO", "telas": TELAS_AUX + ["/financeiro/caixa"], "seguePadrao": "1"}, RH))
m = menu(page("/financeiro", BT)); assert "/financeiro/caixa" in m and "/financeiro/dre" in m and "/financeiro/descontos" not in m, m
assert "/financeiro/caixa" in menu(page("/financeiro", BI))
hc = page(f"/configuracoes/acessos/cargo/{P['Auxiliar Administrativo']}", RH); assert "telas desta pessoa:" in hc and "ver e ajustar em lote" in hc
ok("o cargo ganha o Caixa e Beto ganha também (a DRE a mais e Descontos a menos continuam); o cargo mostra quem tem ajuste")

print("Igual ao cargo tira o ajuste; telas fora da atuação e fixas não entram")
cx = caixas(page(f"/configuracoes/acessos/usuario/{UBETO}", RH)); base = [k for k, (_, b) in cx.items() if b]
okmsg(post(f"/configuracoes/acessos/usuario/{UBETO}", aid_tp, {"id": UBETO, "telas": base, "motivo": "Volta ao combinado do cargo"}, RH), "volta a seguir o cargo em tudo")
assert aj(UBETO) is None and int(psql(f"SELECT count(*) FROM audit_log WHERE acao='ajuste de telas retirado' AND entidade_id={UBETO}")) == 1
fora = [k for k in ["/configuracoes", "/recrutamento", "/desempenho", "/clima", "/colaboradores", "/folha"] if k not in cx]; assert len(fora) >= 3, fora
okmsg(post(f"/configuracoes/acessos/usuario/{UBETO}", aid_tp, {"id": UBETO, "telas": base + fora, "motivo": "Tentativa com telas de outra área"}, RH), "Nada mudou")
assert aj(UBETO) is None and get("/eu", BT).status_code == 200
ok("salvar exatamente o que o cargo dá tira o ajuste (e registra); telas de outra atuação ficam sem efeito; as telas fixas não saem")

print("Data de fim: inválida, vencida e retirada pela rotina")
erro(post(f"/configuracoes/acessos/usuario/{UBETO}", aid_tp, {"id": UBETO, "telas": base + ["/financeiro/dre"], "motivo": "Apoia o fechamento do mês", "ate": d(-1)}, RH), "Data de fim")
erro(post(f"/configuracoes/acessos/usuario/{UBETO}", aid_tp, {"id": UBETO, "telas": base + ["/financeiro/dre"], "motivo": "Apoia o fechamento do mês", "ate": d(400)}, RH), "no máximo 1 ano")
okmsg(post(f"/configuracoes/acessos/usuario/{UBETO}", aid_tp, {"id": UBETO, "telas": base + ["/financeiro/dre"], "motivo": "Apoia o fechamento do mês", "ate": H}, RH), "até")
assert "/financeiro/dre" in menu(page("/financeiro", BT))
psql(f"UPDATE users SET ajuste_telas = jsonb_set(ajuste_telas, '{{ate}}', to_jsonb('{d(-1)}'::text)) WHERE id={UBETO}")
assert "/financeiro/dre" not in menu(page("/financeiro", BT)) and "Ajuste vencido em" in page(f"/configuracoes/acessos/usuario/{UBETO}", RH)
rr = RH.get(B + f"/api/tarefas?token={TOKEN}", timeout=600).json(); assert rr["ok"] and rr["v32"]["ajustesVencidos"] >= 1, rr.get("v32")
assert aj(UBETO) is None and int(psql(f"SELECT count(*) FROM audit_log WHERE acao='ajuste de telas vencido' AND entidade_id={UBETO}")) == 1
assert int(psql(f"SELECT count(*) FROM notifications WHERE user_id={URH} AND titulo LIKE '%ajuste(s) de telas por pessoa venceram hoje'")) == 1
okmsg(post(f"/configuracoes/acessos/usuario/{UBIA}", aid_tp, {"id": UBIA, "telas": [k for k, (m, _) in caixas(page(f"/configuracoes/acessos/usuario/{UBIA}", RH)).items() if m] + ["/financeiro/dre"], "motivo": "Cobre a conciliação na semana do fechamento", "ate": d(3)}, RH))
hp = page("/pendencias", RH); assert "Telas de Bia Auxiliar (fictícia) (+1 −0)" in hp and "Renovar ou deixar vencer" in hp
ok("data no passado ou além de 1 ano recusada; vencido não vale (menu volta ao cargo) e a rotina tira o ajuste, registra e avisa RH e Direção sem nomes; pendência do ajuste que vence em 3 dias")

print("Copiar o ajuste de outra pessoa")
h = page(f"/configuracoes/acessos/usuario/{UBETO}", RH); aid_cp = aid_of(h, "Copiar o ajuste")
erro(post(f"/configuracoes/acessos/usuario/{UBETO}", aid_cp, {"id": UBETO, "origemId": UCAIO}, RH), "não tem ajuste de telas para copiar")
okmsg(post(f"/configuracoes/acessos/usuario/{UBETO}", aid_cp, {"id": UBETO, "origemId": UBIA}, RH), "recebeu o ajuste de Bia Auxiliar")
a = aj(UBETO); assert a["mais"] == ["/financeiro/dre"] and a["menos"] == [] and a["motivo"].startswith("Mesmo ajuste de Bia Auxiliar") and a["ate"] == d(3), a
ok("cópia recalculada sobre o cargo de quem recebe, com a origem no motivo e a mesma data de fim; sem ajuste na origem, recusada")

print("Ajuste em lote: várias pessoas e várias telas")
h = page(f"/configuracoes/acessos?aba=pessoas&cargo={P['Auxiliar Administrativo']}", RH); assert "Ajuste em lote — várias pessoas e várias telas de uma vez" in h and "Beto Auxiliar (fictício)" in h and "Bia Auxiliar (fictícia)" in h
assert "Caio Tesoureiro" not in form_of(h, "Aplicar às pessoas marcadas")  # filtro por cargo
aid_l = aid_of(h, "Aplicar às pessoas marcadas"); V = f"/configuracoes/acessos?aba=pessoas&cargo={P['Auxiliar Administrativo']}"
erro(post(V, aid_l, {"voltar": V, "acao": "ACRESCENTAR", "telas": ["/financeiro/cockpit"], "motivo": "Fechamento do mês"}, RH), "Marque as pessoas")
erro(post(V, aid_l, {"voltar": V, "users": [UBETO], "acao": "ACRESCENTAR", "motivo": "Fechamento do mês"}, RH), "Marque as telas")
erro(post(V, aid_l, {"voltar": V, "users": [UBETO], "acao": "ACRESCENTAR", "telas": ["/financeiro/cockpit"], "motivo": "curto"}, RH), "motivo do ajuste")
loc = post(V, aid_l, {"voltar": V, "users": [UBETO, UBIA, UCAIO, UDORA], "acao": "ACRESCENTAR", "telas": ["/financeiro/dre", "/financeiro/cockpit"], "motivo": "Auxiliares acompanham o resultado do mês"}, RH)
okmsg(loc, "Ajuste em lote aplicado a 2 pessoa(s)"); assert "sem efeito" in loc and loc.startswith(V), loc
assert sorted(aj(UBETO)["mais"]) == ["/financeiro/cockpit", "/financeiro/dre"] and sorted(aj(UBIA)["mais"]) == ["/financeiro/cockpit", "/financeiro/dre"] and aj(UCAIO) is None and aj(UDORA) is None
assert "antes: Mesmo ajuste de Bia" in aj(UBETO)["motivo"]
okmsg(post(V, aid_l, {"voltar": V, "users": [UBETO, UBIA], "acao": "RETIRAR", "telas": ["/financeiro/descontos"], "motivo": "Descontos ficam com a gerente"}, RH), "2 tela(s) retirada(s)")
assert aj(UBETO)["menos"] == ["/financeiro/descontos"] and get("/financeiro/descontos", BI).status_code in (302, 303, 307)
okmsg(post(V, aid_l, {"voltar": V, "users": [UBETO], "acao": "PADRAO", "telas": ["/financeiro/cockpit"]}, RH), "1 volta(s) ao padrão do cargo")
assert aj(UBETO)["mais"] == ["/financeiro/dre"] and aj(UBETO)["menos"] == ["/financeiro/descontos"]
okmsg(post(V, aid_l, {"voltar": V, "users": [URH, UBIA], "acao": "ACRESCENTAR", "telas": ["/financeiro/orcamento"], "motivo": "Orçamento do próximo ano"}, RH), "Contas sem ficha ficaram de fora")
okmsg(post(V, aid_l, {"voltar": V, "users": [UBETO, UBIA], "acao": "PADRAO"}, RH), "2 volta(s) ao padrão do cargo")
assert aj(UBETO) is None and aj(UBIA) is None and get("/financeiro/descontos", BI).status_code == 200
assert int(psql("SELECT count(*) FROM audit_log WHERE acao='ajuste de telas em lote'")) == 5
ok("lote: sem pessoas, sem telas ou sem motivo recusado; acrescentar só onde muda (o tesoureiro já via e a professora não tem a tela: sem efeito); retirar; voltar ao padrão em telas marcadas e em todas; conta sem ficha fica de fora; motivo anterior preservado; trilha do lote")

print("Trava, permissão, matriz e listas")
okmsg(post(V, aid_l, {"voltar": V, "users": [UBETO], "acao": "ACRESCENTAR", "telas": ["/financeiro/dre"], "motivo": "Apoia o fechamento do mês"}, RH))
AN = login("ana@fin"); erro(post(f"/configuracoes/acessos/usuario/{UBIA}", aid_tp, {"id": UBIA, "telas": ["/financeiro"], "motivo": "Sem permissão para isso"}, AN), "Só Direção e RH")
hr = page(f"/configuracoes/acessos/usuario/{URITA}", RH); assert 'value="/configuracoes/acessos"' in hr
outros = psql(f"SELECT string_agg(id::text, ',') FROM users WHERE ativo AND role IN ('RH','DIRECAO') AND id<>{URITA}")
try:
    psql(f"UPDATE users SET ativo=false WHERE id IN ({outros})"); RI = login("rita@rh")
    hl = page("/configuracoes/acessos?aba=pessoas", RI); aid_r = aid_of(hl, "Aplicar às pessoas marcadas")
    erro(post("/configuracoes/acessos?aba=pessoas", aid_r, {"voltar": "/configuracoes/acessos?aba=pessoas", "users": [URITA], "acao": "RETIRAR", "telas": ["/configuracoes/acessos"], "motivo": "Teste da trava do sistema"}, RI), "ninguém ativo conseguiria configurar")
finally: psql(f"UPDATE users SET ativo=true WHERE id IN ({outros})")
assert aj(URITA) is None
h = page("/configuracoes/acessos", RH); assert "Telas por pessoa" in h and "ajustes sobre o cargo" in h
h = page("/configuracoes/acessos?aba=telas&grupo=Financeiro", RH); assert "Pessoas com ajuste" in h and "+ Beto Auxiliar (fictício)" in h
h = page("/configuracoes/acessos?aba=fora", RH); assert "Telas por pessoa (1)" in h and "Beto Auxiliar (fictício)" in h
h = page("/configuracoes/acessos?aba=pessoas", RH); assert "Telas por pessoa — ajustes sobre o cargo (1)" in h and "+ DRE" in h.split("Telas por pessoa — ajustes sobre o cargo")[1][:6000]
h = page("/configuracoes", RH); assert "telas +1 −0" in h
assert f'/configuracoes/acessos/usuario/{UBIA}#telas"' in h and "Ajustar telas" in h  # atalho direto para as telas da pessoa, na lista de usuários
assert f'/configuracoes/acessos/usuario/{URH}#telas"' not in h  # conta sem ficha não tem o ajuste
assert "Telas desta pessoa" not in page(f"/configuracoes/acessos/usuario/{URH}", RH)
n = int(psql("SELECT count(*) FROM audit_log WHERE acao LIKE 'ajuste de telas%'")); assert n >= 12, n
ok("só RH e Direção ajustam; a trava impede tirar Acesso por cargo do último acesso que configura; matriz (aba, + e − por tela, fora do padrão), selo e atalho “Ajustar telas” na lista de usuários, conta sem ficha sem o editor da pessoa; trilha completa")

print(f"\nOK — {N[0]} blocos da v32 (telas por pessoa) passaram.")
