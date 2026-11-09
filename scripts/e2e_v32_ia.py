# E2E — v32 · IA (opcional): porta única para a Claude API, bloco "IA (opcional) — ligar e testar" em Configurações e
# teste de conexão. Roda contra um PROVEDOR SIMULADO LOCAL (nada sai para a internet; nenhuma chave real):
#   AI_API_KEY=chave-de-teste-e2e AI_BASE_URL=http://127.0.0.1:39123 AI_WORKSPACE_ID=wrkspc_e2e \
#     bash /tmp/withserver.sh python3 scripts/e2e_v32_ia.py
# Cobre: bloco ligado (modelo padrão, workspace, endereço de teste; a chave nunca aparece na tela nem na trilha), teste de
# conexão (só a frase de teste vai ao provedor; cabeçalhos x-api-key, anthropic-version e anthropic-workspace-id; modelo e
# max_tokens), erros traduzidos com o caminho da correção (chave recusada, sem créditos, chave sem workspace, modelo
# inexistente, limite, instabilidade, resposta vazia), permissão (só Direção e RH testam), People AI e assistente
# estratégico de ponta a ponta com o provedor simulado (resposta gravada com o modelo; erro registrado) e trilha de auditoria.
import re, json, subprocess, threading, requests
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
B = "http://localhost:3100"; TOKEN = "setup-homologacao-2026-status"; CHAVE = "chave-de-teste-e2e"; PORTA = 39123
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
    r = get(path, sess); assert r.status_code == expect, (path, r.status_code, r.headers.get("location"))
    return re.sub(r"<script[^>]*>.*?</script>", "", re.sub(r"<!--.*?-->", "", r.text), flags=re.S).replace("\xa0", " ")
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
def login(email, senha="senha12345"):
    s = mk(); html = s.get(B + "/login").text; aid = re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', html)[0]
    loc = post("/login", aid, {"email": email, "senha": senha}, s); assert loc.endswith("/"), (email, loc); return s
def erro(loc, trecho): assert "erro=" in loc and trecho in loc, (trecho, loc)
def okmsg(loc, trecho=""): assert "ok=" in loc and trecho in loc, (trecho, loc)

# ---------- provedor simulado (Claude API) ----------
ESTADO = {"modo": "ok"}; PEDIDOS = []
ERROS = {
    "chave": (401, {"type": "error", "error": {"type": "authentication_error", "message": "invalid x-api-key"}}),
    "credito": (400, {"type": "error", "error": {"type": "invalid_request_error", "message": "Your credit balance is too low to access the Claude API. Please go to Plans & Billing to upgrade or purchase credits."}}),
    "workspace": (400, {"type": "error", "error": {"type": "invalid_request_error", "message": "This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header with the ID of the workspace to use. Add the header, or use an API key that is scoped to a workspace."}}),
    "modelo": (404, {"type": "error", "error": {"type": "not_found_error", "message": "model: claude-sonnet-5-5"}}),
    "limite": (429, {"type": "error", "error": {"type": "rate_limit_error", "message": "Number of request tokens has exceeded your per-minute rate limit"}}),
    "instavel": (529, {"type": "error", "error": {"type": "overloaded_error", "message": "Overloaded"}}),
}
class Provedor(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        corpo = json.loads(self.rfile.read(int(self.headers.get("content-length", "0"))) or b"{}")
        PEDIDOS.append({"path": self.path, "headers": {k.lower(): v for k, v in self.headers.items()}, "corpo": corpo})
        modo = ESTADO["modo"]
        if modo in ERROS: st, j = ERROS[modo]
        else:
            sistema = str(corpo.get("system", "")); usuario = str(corpo["messages"][0]["content"])
            if "teste de conexão" in sistema: texto = "OK"
            elif "PERGUNTA:" in usuario: texto = "Fato: resposta simulada pelo teste e2e, sem dados reais. Confiança: baixa."
            else: texto = "Leitura executiva simulada pelo teste [E1]."
            st, j = 200, {"id": "msg_e2e", "type": "message", "role": "assistant", "model": corpo.get("model"), "content": ([] if modo == "vazio" else [{"type": "text", "text": texto}]), "usage": {"input_tokens": 42, "output_tokens": 7}}
        b = json.dumps(j).encode(); self.send_response(st); self.send_header("content-type", "application/json"); self.send_header("content-length", str(len(b))); self.end_headers(); self.wfile.write(b)
srv = ThreadingHTTPServer(("127.0.0.1", PORTA), Provedor); threading.Thread(target=srv.serve_forever, daemon=True).start()

print("Preparação")
RH = login("rh@colegiostatus", "Status2026!"); r = RH.get(B + f"/api/setup?token={TOKEN}"); assert r.json()["ok"], r.text
assert float(psql("SELECT value->>'versao' FROM settings WHERE key='banco'")) >= 32
h = page("/configuracoes", RH); aid_user = aid_of(h, "Criar acesso")
okmsg(post("/configuracoes", aid_user, {"modo": "auto", "employeeId": "0", "nome": "Leitor IA (fictício)", "email": "leitor@ia", "senha": "senha12345", "atuacao": "LEITURA", "unitId": ""}, RH))
LE = login("leitor@ia")
ok("esquema 32.0; provedor simulado local no ar; conta de consulta fictícia")

print("Configurações → IA (opcional): ligada, sem mostrar a chave")
h = page("/configuracoes", RH)
assert "IA (opcional) — ligar e testar" in h and 'href="#ia"' in h and "IA ligada." in h and "claude-sonnet-5-5" in h and "(padrão)" in h
assert "wrkspc_e2e" in h and "endereço de teste" in h and "http://127.0.0.1:39123" in h and CHAVE not in h
assert "Testar a IA agora" in h and "Onde a IA aparece" in h and "/estrategia/assistente" in h and "/analytics/assistente" in h
ok("bloco ligado: modelo padrão claude-sonnet-5-5, workspace e endereço de teste à vista; a chave nunca aparece")

print("Teste de conexão: só a frase de teste vai ao provedor")
aid_t = aid_of(h, "Testar a IA agora"); ESTADO["modo"] = "ok"; PEDIDOS.clear()
okmsg(post("/configuracoes", aid_t, {}, RH), "IA ligada e respondendo: modelo claude-sonnet-5-5")
assert len(PEDIDOS) == 1; p = PEDIDOS[0]; hd = p["headers"]; c = p["corpo"]
assert p["path"] == "/v1/messages" and hd.get("x-api-key") == CHAVE and hd.get("anthropic-version") == "2023-06-01" and hd.get("anthropic-workspace-id") == "wrkspc_e2e", hd
assert c["model"] == "claude-sonnet-5-5" and c["max_tokens"] == 5 and c["messages"] == [{"role": "user", "content": "Teste de conexão do STATUS ONE."}], c
assert not any(k in c for k in ("temperature", "top_p", "top_k")), c
h = page("/configuracoes", RH); assert "Último teste:" in h and "respondeu (claude-sonnet-5-5" in h
a = psql("SELECT depois::text FROM audit_log WHERE acao='teste da IA' ORDER BY id DESC LIMIT 1"); assert '"ok": true' in a and CHAVE not in a, a
ok("teste ok: cabeçalhos x-api-key, versão e workspace; modelo padrão e max_tokens 5; corpo só com a frase de teste; resultado e trilha sem a chave")

print("Erros do provedor viram o caminho da correção")
for modo, trecho in [("chave", "A chave de IA foi recusada"), ("credito", "Sem créditos na conta da API"), ("workspace", "não está presa a um workspace"),
                     ("modelo", "O modelo configurado (claude-sonnet-5-5) não existe"), ("limite", "Limite de uso da API"), ("instavel", "sobrecarregado ou instável"), ("vazio", "respondeu sem texto")]:
    ESTADO["modo"] = modo; loc = post("/configuracoes", aid_t, {}, RH); erro(loc, trecho); assert "Nada foi gerado nem simulado" in loc, loc
n = int(psql("SELECT count(*) FROM audit_log WHERE acao='teste da IA' AND depois->>'ok'='false'")); assert n == 7, n
assert CHAVE not in psql("SELECT string_agg(depois::text, ' ') FROM audit_log WHERE acao='teste da IA'")
h = page("/configuracoes", RH); assert "falhou" in h.split("Último teste:")[1][:400]
ok("chave recusada, sem créditos, chave sem workspace, modelo inexistente, limite, instabilidade e resposta vazia: cada um com o que fazer; falhas na trilha, sem a chave")

print("Permissão: só Direção e RH testam")
ESTADO["modo"] = "ok"; PEDIDOS.clear()
r = get("/configuracoes", LE); assert r.status_code in (302, 303, 307), r.status_code
erro(post("/configuracoes", aid_t, {}, LE), "Só Direção e RH testam a IA"); assert not PEDIDOS
ok("conta de consulta não abre Configurações nem dispara o teste (nada chega ao provedor)")

print("People AI de ponta a ponta com o provedor simulado")
h = page("/analytics/assistente", RH); assert "não está ligado" not in h
aid_p = aid_of(h, "O que você quer saber?"); PEDIDOS.clear()
loc = post("/analytics/assistente", aid_p, {"pergunta": "Onde está o maior risco de saída?"}, RH); assert "erro=" not in loc, loc
assert len(PEDIDOS) == 1; c = PEDIDOS[0]["corpo"]; u = c["messages"][0]["content"]
assert c["max_tokens"] == 1200 and "CONTEXTO (dados agregados e anonimizados" in u and "PERGUNTA: Onde está o maior risco de saída?" in u, u[:300]
assert psql("SELECT modelo||'|'||coalesce(erro,'') FROM ai_log ORDER BY id DESC LIMIT 1") == "claude-sonnet-5-5|"
assert "resposta simulada pelo teste e2e" in psql("SELECT resposta FROM ai_log ORDER BY id DESC LIMIT 1")
ESTADO["modo"] = "credito"; post("/analytics/assistente", aid_p, {"pergunta": "E na Cultura?"}, RH)
assert "Sem créditos na conta da API" in psql("SELECT erro FROM ai_log ORDER BY id DESC LIMIT 1")
ok("pergunta vai com o contexto agregado; resposta gravada com o modelo; sem créditos, o erro registrado diz o que fazer")

print("Assistente estratégico com o provedor simulado")
ESTADO["modo"] = "ok"; PEDIDOS.clear()
h = page("/estrategia/assistente", RH); assert "IA desligada nesta instalação" not in h and "IA ligada · modelo claude-sonnet-5-5" in h and "/configuracoes#ia" in h
nf = int(re.search(r"Fatos que serão enviados \((\d+)\)", h).group(1)); aid_e = aid_of(h, 'name="tarefa"')
loc = post("/estrategia/assistente", aid_e, {"tarefa": "LEITURA"}, RH)
if nf:
    okmsg(loc, "Rascunho gerado"); assert len(PEDIDOS) == 1 and PEDIDOS[0]["corpo"]["max_tokens"] == 900
    assert psql("SELECT modelo FROM strategy_ai_drafts ORDER BY id DESC LIMIT 1") == "claude-sonnet-5-5"
    ESTADO["modo"] = "chave"; erro(post("/estrategia/assistente", aid_e, {"tarefa": "LEITURA"}, RH), "A chave de IA foi recusada")
else:
    erro(loc, "Sem fatos no painel"); assert not PEDIDOS
ok(f"assistente ligado ({nf} fato(s) no painel): rascunho gravado com o modelo; chave recusada vira mensagem clara")

srv.shutdown()
print(f"\nOK — {N[0]} blocos da v32 (IA: ligar e testar) passaram.")
