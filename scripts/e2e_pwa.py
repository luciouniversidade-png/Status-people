# E2E — ONE como app no celular (v22): manifesto, ícones, service worker e página sem conexão públicos; metadados de instalação;
# no navegador real (Chromium): registro do service worker, ativação das notificações pela tela Minha conta (assinatura salva no
# servidor), teste, aviso real de uma aprovação chegando ao "serviço de push" (HTTPS local) com criptografia aes128gcm e VAPID
# (conteúdo decifrado e conferido), preferência, assinatura expirada (410) apagada e desativação.
# Rodar com NODE_TLS_REJECT_UNAUTHORIZED=0 PUSH_HOSTS_EXTRA=localhost no servidor (o serviço de push de teste usa certificado próprio
# e endereço local; em produção só os serviços de push dos navegadores são aceitos).
import re, subprocess, requests, json, ssl, threading, os, tempfile, time, base64, hmac, hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from playwright.sync_api import sync_playwright
B = "http://localhost:3100"; TOKEN = "setup-homologacao-2026-status"
def psql(q): return subprocess.run(["su", "postgres", "-c", f"/usr/lib/postgresql/16/bin/psql -h /tmp/pg -U status -d status_people -q -t -A -c \"{q.replace(chr(34), chr(92) + chr(34))}\""], capture_output=True, text=True).stdout.strip()
N = [0]
def ok(msg): N[0] += 1; print(f"  ✓ {msg}")
def mk(): s = requests.Session(); s.headers.update({"Origin": B}); return s
def login(sess, email, senha):
    html = sess.get(B + "/login").text; aid = re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', html)[0]
    r = sess.post(B + "/login", files=[(f"$ACTION_ID_{aid}", (None, "")), ("email", (None, email)), ("senha", (None, senha))], allow_redirects=False)
    tok = re.search(r"rh_session=([^;]+)", r.headers["set-cookie"]).group(1); sess.headers["Cookie"] = f"rh_session={tok}"; return tok
b64u = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()
def aid_form(html, marker):
    i = html.find(marker); assert i >= 0, marker
    fs = html.rfind("<form", 0, i); fe = html.find("</form>", i); return re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', html[fs:fe])[0]
def chegou(path, n=1):
    for _ in range(40):
        if len([x for x in RECEBIDOS if x["path"] == path]) >= n: break
        time.sleep(0.25)
    return [x for x in RECEBIDOS if x["path"] == path]
def esperar(pg, texto, timeout=15000):
    try: pg.wait_for_selector(f"text={texto}", timeout=timeout)
    except Exception:
        print("    (tela do aparelho:", pg.evaluate("() => document.querySelector('[data-push-estado]')?.outerHTML"), ")"); raise

print("Arquivos do app (sem login)")
P = requests.Session()
m = P.get(B + "/manifest.webmanifest"); assert m.status_code == 200, m.status_code; man = json.loads(m.text)
assert man["display"] == "standalone" and man["start_url"].startswith("/") and man["theme_color"] == "#0b2545" and {i["sizes"] for i in man["icons"]} >= {"192x192", "512x512"} and any(i.get("purpose") == "maskable" for i in man["icons"])
sw = P.get(B + "/sw.js"); assert sw.status_code == 200 and "javascript" in sw.headers.get("content-type", "") and "showNotification" in sw.text and "notificationclick" in sw.text
for ic in ["icon-192.png", "icon-512.png", "maskable-512.png", "apple-touch-icon.png", "badge-96.png"]: r = P.get(B + f"/icons/{ic}"); assert r.status_code == 200 and r.headers["content-type"] == "image/png" and r.content[:4] == b"\x89PNG", ic
off = P.get(B + "/offline.html"); assert off.status_code == 200 and "Sem conexão" in off.text
lg = P.get(B + "/login").text
for tag in ['<link rel="manifest" href="/manifest.webmanifest"', 'name="theme-color" content="#0b2545"', 'rel="apple-touch-icon" href="/icons/apple-touch-icon.png"', 'name="apple-mobile-web-app-capable" content="yes"', 'name="mobile-web-app-capable" content="yes"', 'name="apple-mobile-web-app-title" content="STATUS ONE"', 'name="apple-mobile-web-app-status-bar-style" content="black"']: assert tag in lg, tag
assert "viewport-fit=cover" not in lg  # conteúdo nunca vai para baixo do entalhe/barra de status
ok("manifesto (standalone, ícones normal e adaptável, atalhos), service worker, ícones e página sem conexão abrem sem login; metadados de instalação no HTML")

print("Serviço de push de teste (HTTPS local)")
tmp = tempfile.mkdtemp(); cert, key = os.path.join(tmp, "c.pem"), os.path.join(tmp, "k.pem")
subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1", "-subj", "/CN=localhost"], capture_output=True, check=True)
RECEBIDOS = []
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        n = int(self.headers.get("content-length", "0")); corpo = self.rfile.read(n)
        RECEBIDOS.append({"path": self.path, "headers": dict(self.headers), "body": corpo})
        self.send_response(410 if self.path.endswith("/gone") else 201); self.end_headers()
srv = HTTPServer(("127.0.0.1", 9443), H); ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); ctx.load_cert_chain(cert, key); srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
threading.Thread(target=srv.serve_forever, daemon=True).start()
# chaves do "aparelho" (como o navegador gera ao assinar)
ua_priv = ec.generate_private_key(ec.SECP256R1()); ua_pub = ua_priv.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint); auth = os.urandom(16)
P256, AUTH = b64u(ua_pub), b64u(auth)
def hk(salt, ikm, info, n): prk = hmac.new(salt, ikm, hashlib.sha256).digest(); return hmac.new(prk, info + b"\x01", hashlib.sha256).digest()[:n]
def decifra(body):
    """RFC 8188/8291 — aes128gcm de um registro."""
    salt, rs, idlen = body[:16], int.from_bytes(body[16:20], "big"), body[20]; as_pub = body[21:21 + idlen]; ct = body[21 + idlen:]
    sec = ua_priv.exchange(ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), as_pub))
    ikm = hk(auth, sec, b"WebPush: info\x00" + ua_pub + as_pub, 32)
    cek = hk(salt, ikm, b"Content-Encoding: aes128gcm\x00", 16); nonce = hk(salt, ikm, b"Content-Encoding: nonce\x00", 12)
    pt = AESGCM(cek).decrypt(nonce, ct, None); i = pt.rstrip(b"\x00"); assert i.endswith(b"\x02"); return json.loads(i[:-1])
ok("serviço de push local no ar e chaves do aparelho geradas")

print("Ativar no navegador (Minha conta)")
S = mk(); tok = login(S, "rh@colegiostatus", "Status2026!"); assert S.get(B + f"/api/setup?token={TOKEN}").json()["ok"]
RH = psql("SELECT id FROM users WHERE email='rh@colegiostatus'")
# O Chromium de teste não alcança um serviço de push de verdade: a assinatura é simulada (e persiste entre recargas, como no aparelho)
INIT = "(() => { const fake = { endpoint: 'https://localhost:9443/push/ok', keys: { p256dh: '%s', auth: '%s' } };" % (P256, AUTH) + \
  " const sub = () => ({ endpoint: fake.endpoint, toJSON() { return fake; }, unsubscribe: async () => { localStorage.removeItem('fakeSub'); return true; } });" + \
  " PushManager.prototype.subscribe = async function () { localStorage.setItem('fakeSub', '1'); return sub(); };" + \
  " PushManager.prototype.getSubscription = async function () { return localStorage.getItem('fakeSub') ? sub() : null; }; })();"
with sync_playwright() as p:
    br = p.chromium.launch(channel="chromium"); cx = br.new_context(viewport={"width": 390, "height": 844}, user_agent="Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36")
    cx.add_cookies([{"name": "rh_session", "value": tok, "domain": "localhost", "path": "/"}]); cx.grant_permissions(["notifications"], origin=B); cx.add_init_script(INIT)
    pg = cx.new_page(); pg.goto(B + "/conta"); pg.wait_for_selector("text=App no celular e notificações")
    pg.wait_for_function("navigator.serviceWorker && navigator.serviceWorker.getRegistration().then(r => !!r && !!r.active)", timeout=20000)
    ok("service worker registrado e ativo no navegador")
    pg.get_by_role("button", name="Ativar notificações neste aparelho").click(); esperar(pg, "Ativas neste aparelho")
    row = psql(f"SELECT endpoint || '|' || p256dh || '|' || auth || '|' || tipos FROM push_subscriptions WHERE user_id={RH}"); assert row == f"https://localhost:9443/push/ok|{P256}|{AUTH}|ACAO_ALERTA", row
    ok("“Ativar” pede permissão, assina e salva o aparelho no servidor (preferência padrão: só ação e alertas)")
    pg.get_by_role("button", name="Testar").click(); esperar(pg, "Enviamos uma notificação de teste")
    t = [r for r in RECEBIDOS if r["path"] == "/push/ok"]; assert len(t) == 1, RECEBIDOS
    h = {k.lower(): v for k, v in t[0]["headers"].items()}; assert h["content-encoding"] == "aes128gcm" and h["authorization"].startswith("vapid t=") and "k=" in h["authorization"] and int(h["ttl"]) > 0 and h.get("urgency") == "high"
    msg = decifra(t[0]["body"]); assert msg["titulo"] == "STATUS ONE: teste" and msg["link"] == "/conta" and msg["tipo"] == "ALERTA", msg
    ok("teste chega ao serviço de push: aes128gcm + VAPID; conteúdo decifrado com as chaves do aparelho confere")
    # aviso real: uma colaboradora pede declaração (aprovação: Secretaria/RH) → o RH recebe no celular
    psql("INSERT INTO employees (nome, unit_id, vinculo, admissao) SELECT 'Carla Push', id, 'CLT', '2024-01-10' FROM units WHERE codigo='CAR'")
    EC = psql("SELECT id FROM employees WHERE nome='Carla Push'"); html = S.get(B + "/configuracoes").text; i = html.find("Criar acesso"); assert i > 0
    fs = html.rfind("<form", 0, i); fe = html.find("</form>", i); aidu = re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', html[fs:fe])[0]
    r = S.post(B + "/configuracoes", files=[(f"$ACTION_ID_{aidu}", (None, "")), ("nome", (None, "Carla")), ("email", (None, "carla@push")), ("role", (None, "COLABORADOR")), ("unitId", (None, "")), ("employeeId", (None, EC)), ("senha", (None, "senha12345"))], allow_redirects=False)
    assert psql("SELECT role FROM users WHERE email='carla@push'") == "COLABORADOR", r.headers.get("location")
    C = mk(); login(C, "carla@push", "senha12345"); TD = psql("SELECT id FROM request_types WHERE codigo='DECLARACAO'")
    hn = C.get(B + f"/solicitacoes/nova?tipo={TD}").text; aid = re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', hn[hn.find("<main"):])[0]
    r = C.post(B + "/solicitacoes/nova", files=[(f"$ACTION_ID_{aid}", (None, "")), ("typeId", (None, TD)), ("campo_tipo", (None, "Vínculo empregatício")), ("campo_finalidade", (None, "Banco")), ("campo_prazo", (None, "2030-01-01"))], allow_redirects=False)
    assert "ok=" in requests.utils.unquote(r.headers.get("location", "")), r.headers
    reais = chegou("/push/ok", 2); assert len(reais) == 2, len(reais)
    m2 = decifra(reais[1]["body"]); assert m2["titulo"].startswith("Aprovar: Declaração") and m2["tipo"] == "ACAO" and m2["link"].startswith("/solicitacoes/"), m2
    ok("aviso real (aprovação de declaração pedida pela colaboradora) chega cifrado ao celular do RH, com o link da solicitação")
    # a colaboradora quer todos os avisos: a aprovação (informativa) chega a ela; desativada, não recebe mais nada
    UC = psql("SELECT id FROM users WHERE email='carla@push'"); RQ = re.search(r"/solicitacoes/(\d+)", m2["link"]).group(1)
    psql(f"INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, tipos) VALUES ({UC}, 'https://localhost:9443/push/carla', '{P256}', '{AUTH}', 'TODOS')")
    hd = S.get(B + f"/solicitacoes/{RQ}").text; aid_dec = aid_form(hd, 'value="APROVAR"')
    r = S.post(B + f"/solicitacoes/{RQ}", files=[(f"$ACTION_ID_{aid_dec}", (None, "")), ("id", (None, RQ)), ("decisao", (None, "APROVAR"))], allow_redirects=False); assert "ok=" in requests.utils.unquote(r.headers.get("location", "")), r.headers
    cc = chegou("/push/carla"); assert len(cc) == 1 and decifra(cc[0]["body"])["titulo"].startswith("Aprovada: Declaração"), cc
    psql(f"UPDATE users SET ativo=false WHERE id={UC}"); hd = S.get(B + f"/solicitacoes/{RQ}").text; aid_com = aid_form(hd, "Comentar")
    S.post(B + f"/solicitacoes/{RQ}", files=[(f"$ACTION_ID_{aid_com}", (None, "")), ("id", (None, RQ)), ("texto", (None, "Declaração pronta na secretaria."))], allow_redirects=False)
    assert psql(f"SELECT count(*) FROM notifications WHERE user_id={UC} AND titulo LIKE 'Comentário em%'") == "1"; time.sleep(2); assert len(chegou("/push/carla")) == 1
    ok("com “todos os avisos”, a decisão chega à solicitante; usuário desativado não recebe mais no celular (o aviso fica só no sistema)")
    pg.reload(); esperar(pg, "Ativas neste aparelho"); pg.select_option("select[aria-label='Quais avisos']", "TODOS"); esperar(pg, "Preferência salva")
    assert psql(f"SELECT tipos FROM push_subscriptions WHERE user_id={RH}") == "TODOS"
    psql(f"UPDATE push_subscriptions SET endpoint='https://localhost:9443/push/gone' WHERE user_id={RH}")
    pg.get_by_role("button", name="Testar").click(); esperar(pg, "Nenhum aparelho recebeu")
    assert psql(f"SELECT count(*) FROM push_subscriptions WHERE user_id={RH}") == "0"
    ok("preferência “todos os avisos” salva; assinatura expirada (410) é apagada no envio")
    psql(f"INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES ({RH}, 'https://localhost:9443/push/ok', '{P256}', '{AUTH}')")
    pg.reload(); esperar(pg, "Ativas neste aparelho"); pg.get_by_role("button", name="Desativar").click(); esperar(pg, "Notificações desativadas")
    assert psql(f"SELECT count(*) FROM push_subscriptions WHERE user_id={RH}") == "0"
    ok("“Desativar” remove a assinatura do servidor")
    # endereço fora dos serviços de push conhecidos é recusado (o servidor nunca envia para um endereço qualquer)
    pg.evaluate("() => localStorage.removeItem('fakeSub')")
    pg.add_init_script("PushManager.prototype.subscribe = async function () { localStorage.setItem('fakeSub', '1'); const f = { endpoint: 'https://evil.example.com/coleta', keys: { p256dh: '%s', auth: '%s' } }; return { endpoint: f.endpoint, toJSON() { return f; }, unsubscribe: async () => true }; };" % (P256, AUTH))
    pg.reload(); esperar(pg, "Ativar notificações neste aparelho"); pg.get_by_role("button", name="Ativar notificações neste aparelho").click(); esperar(pg, "serviço de notificação não reconhecido")
    assert psql(f"SELECT count(*) FROM push_subscriptions WHERE user_id={RH}") == "0"
    ok("endereço de push fora dos serviços dos navegadores é recusado")
    br.close()
    # navegador novo: ativa; lista de aparelhos; sair do sistema desliga os avisos neste aparelho; ao voltar, aparece desligado até ativar
    br = p.chromium.launch(channel="chromium"); cx = br.new_context(viewport={"width": 390, "height": 844}, user_agent="Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36")
    cx.add_cookies([{"name": "rh_session", "value": tok, "domain": "localhost", "path": "/"}]); cx.grant_permissions(["notifications"], origin=B); cx.add_init_script(INIT)
    pg = cx.new_page(); pg.goto(B + "/conta"); esperar(pg, "Ativar notificações neste aparelho"); pg.get_by_role("button", name="Ativar notificações neste aparelho").click(); esperar(pg, "Ativas neste aparelho")
    psql(f"INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent) VALUES ({RH}, 'https://localhost:9443/push/velho', '{P256}', '{AUTH}', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1')")
    pg.reload(); esperar(pg, "Aparelhos que recebem os seus avisos"); txt = pg.inner_text("main")
    assert "Android · Chrome(este aparelho)" in txt.replace("Chrome (este", "Chrome(este") and "iPhone/iPad · Safari" in txt and txt.count("Remover") == 1, txt[-700:]
    pg.get_by_role("button", name="Remover").click(); esperar(pg, "Aparelho removido")
    assert psql(f"SELECT string_agg(endpoint, ',') FROM push_subscriptions WHERE user_id={RH}") == "https://localhost:9443/push/ok"
    ok("lista de aparelhos: marca “este aparelho” e remove outro (celular trocado ou perdido)")
    pg.locator("details summary").first.click(); pg.get_by_role("button", name="Sair").first.click(); pg.wait_for_url("**/login**")
    assert psql(f"SELECT count(*) FROM push_subscriptions WHERE user_id={RH}") == "0"
    tok2 = login(mk(), "rh@colegiostatus", "Status2026!"); cx.add_cookies([{"name": "rh_session", "value": tok2, "domain": "localhost", "path": "/"}])
    pg.goto(B + "/conta"); esperar(pg, "Ativar notificações neste aparelho"); pg.get_by_role("button", name="Ativar notificações neste aparelho").click(); esperar(pg, "Ativas neste aparelho")
    assert psql(f"SELECT count(*) FROM push_subscriptions WHERE user_id={RH}") == "1"
    ok("“Sair” desliga os avisos neste aparelho; ao entrar de novo aparece desligado até a pessoa ativar")
    br.close()
# o navegador renova a assinatura (pushsubscriptionchange): o service worker manda a nova; a antiga prova de quem é, mesmo sem sessão
J = {"Content-Type": "application/json", "Origin": B}; NOVA = {"endpoint": "https://localhost:9443/push/novo", "keys": {"p256dh": P256, "auth": AUTH}}
psql(f"UPDATE push_subscriptions SET tipos='TODOS' WHERE user_id={RH}")
assert requests.post(B + "/api/push", json={"antigo": "https://localhost:9443/push/inexistente", "sub": NOVA}, headers=J).status_code == 401
assert requests.post(B + "/api/push", json={"antigo": "https://localhost:9443/push/ok", "sub": NOVA}, headers={**J, "Origin": "https://evil.example.com"}).status_code == 403
assert requests.post(B + "/api/push", json={"antigo": "https://localhost:9443/push/ok", "sub": {**NOVA, "endpoint": "https://evil.example.com/x"}}, headers=J).status_code == 400
r = requests.post(B + "/api/push", json={"antigo": "https://localhost:9443/push/ok", "sub": NOVA}, headers=J); assert r.status_code == 200, r.text
assert psql(f"SELECT string_agg(endpoint || '|' || tipos, ',') FROM push_subscriptions WHERE user_id={RH}") == "https://localhost:9443/push/novo|TODOS"
G = mk(); G.headers["Cookie"] = f"rh_session={tok2}"; assert len(G.get(B + "/api/push").json()["publicKey"]) > 80 and requests.get(B + "/api/push", allow_redirects=False).status_code == 401
ok("renovação da assinatura pelo service worker: troca a antiga pela nova (mantém a preferência); recusa origem externa, endereço desconhecido e quem não prova a assinatura")
srv.shutdown()
print(f"\nE2E App no celular (PWA e push): {N[0]} verificações OK")
