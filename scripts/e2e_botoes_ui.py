"""Teste no navegador (cliques de verdade, com JavaScript ativo) dos botões que enviam nome/valor — Abrir/Encerrar pesquisa,
Aprovar férias. Cobre a falha do React 19 em formulários com campo chamado "id" (o nome/valor do botão sumia do envio).
Uso: python3 scripts/e2e_botoes_ui.py [http://localhost:3100] [email-rh senha-rh] [email-aprovador senha-aprovador]"""
import sys, re, time, datetime as dt, requests
from playwright.sync_api import sync_playwright
a = sys.argv[1:] + [None] * 5
B = a[0] or "http://localhost:3100"; RH = (a[1] or "rh@colegiostatus", a[2] or "Status2026!"); APROV = (a[3] or "dir@geral", a[4] or "senha12345")
def token(email, senha):
    for _ in range(20):  # banco novo: a primeira subida aplica as atualizações do banco antes de aceitar o login
        s = requests.Session(); s.headers.update({"Origin": B}); h = s.get(B + "/login").text; aid = re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', h)[0]
        r = s.post(B + "/login", files=[(f"$ACTION_ID_{aid}", (None, "")), ("email", (None, email)), ("senha", (None, senha))], allow_redirects=False)
        m = re.search(r"rh_session=([^;]+)", r.headers.get("set-cookie", ""))
        if m: return m.group(1)
        time.sleep(1.5)
    return None
falhas = []
def ok(cond, msg): print(("  ok  " if cond else "  FALHA ") + msg); cond or falhas.append(msg)
def clicar_e_esperar(pg, botao, timeout=20):
    antes = pg.url; botao.click(); fim = time.time() + timeout
    while time.time() < fim and (pg.url == antes or not re.search(r"[?&](ok|erro)=", pg.url)): pg.wait_for_timeout(150)
    pg.wait_for_load_state("networkidle"); return requests.utils.unquote(pg.url.split("?", 1)[-1]) if "?" in pg.url else ""
with sync_playwright() as pw:
    br = pw.chromium.launch(channel="chromium")
    def pagina(cred):
        t = token(*cred)
        if not t: return None, None
        cx = br.new_context(locale="pt-BR"); cx.add_cookies([{"name": "rh_session", "value": t, "domain": "localhost", "path": "/"}]); return cx, cx.new_page()
    # 1) pesquisa de clima: cria pelo formulário, abre e encerra pelos botões (formulário com campo "id" + botão name="status")
    cx, pg = pagina(RH)
    if not pg: raise SystemExit("login do RH falhou")
    nome = f"Pesquisa teste UI {dt.datetime.now():%H%M%S}"; hoje = dt.date.today()
    pg.goto(B + "/clima", wait_until="networkidle"); card = pg.locator("section", has=pg.locator("h2", has_text="Nova pesquisa")).first
    card.locator('[name="nome"]').fill(nome); card.locator('[name="inicio"]').fill(str(hoje)); card.locator('[name="fim"]').fill(str(hoje + dt.timedelta(days=7)))
    msg = clicar_e_esperar(pg, card.get_by_role("button", name="Criar")); ok(re.search(r"/clima/\d+", pg.url) is not None, f"Criar pesquisa → {msg[:70]}")
    msg = clicar_e_esperar(pg, pg.locator("main").get_by_role("button", name="Abrir", exact=True))
    ok("erro=" not in msg and "aberta" in msg.lower(), f"Abrir pesquisa → {msg[:80]}")
    enc = pg.locator("main").get_by_role("button", name=re.compile("^Encerrar"))
    try: enc.first.wait_for(state="visible", timeout=10000)  # a página recarrega depois do redirect (?ok=): espera o botão em vez de contar na hora
    except Exception: pass
    if enc.count():
        msg = clicar_e_esperar(pg, enc.first); ok("erro=" not in msg and "encerrada" in msg.lower(), f"Encerrar pesquisa → {msg[:80]}")
    else: ok(False, "botão Encerrar não apareceu depois de abrir")
    cx.close()
    # 2) férias: quem não pediu aprova a primeira solicitação pendente (formulário com campo "id" + botão name="decisao")
    cx, pg = pagina(APROV)
    if not pg: print(f"  —   aprovador {APROV[0]} não existe neste banco (passo das férias ignorado)")
    else:
        pg.goto(B + "/ferias?status=SOLICITADA", wait_until="networkidle")
        apr = pg.locator("main").get_by_role("button", name="Aprovar", exact=True)
        if apr.count():
            msg = clicar_e_esperar(pg, apr.first); ok("inválid" not in msg and "Escolha" not in msg, f"Aprovar férias → {msg[:100]}")
        else: print("  —   sem férias pendentes para aprovar (passo ignorado)")
        cx.close()
    br.close()
print("\nbotões no navegador:", "OK" if not falhas else f"{len(falhas)} FALHA(S)")
sys.exit(1 if falhas else 0)
