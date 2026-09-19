"""Auditoria automatizada de segurança — permissões, IDOR, dados sensíveis, setup, auditoria imutável, 2FA, concorrência, idempotência do ponto."""
import re, subprocess, requests, base64, hmac, hashlib, struct, time, threading
B = "http://localhost:3100"; TOKEN = "setup-homologacao-2026-status"
def psql(q): r = subprocess.run(["su", "postgres", "-c", f"/usr/lib/postgresql/16/bin/psql -h /tmp/pg -U status -d status_people -q -t -c \"{q.replace(chr(34), chr(92) + chr(34))}\""], capture_output=True, text=True); return (r.stdout + r.stderr).strip()
def mk(): s = requests.Session(); s.headers.update({"Origin": B}); return s
S = mk()
def action_ids(html):
    i = html.find("<main"); body = html[i:] if i >= 0 else html
    return re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', body)
def fix_cookie(sess, r):
    sc = r.headers.get("set-cookie", ""); jar = dict(x.split("=", 1) for x in sess.headers.get("Cookie", "").split("; ") if "=" in x)
    for nome in ("rh_session", "rh_pre2fa"):
        m = re.search(nome + r"=([^;]*)", sc)
        if m:
            if m.group(1): jar[nome] = m.group(1)
            else: jar.pop(nome, None)
    if jar: sess.headers["Cookie"] = "; ".join(f"{k}={v}" for k, v in jar.items())
def page(path, expect=200, sess=None):
    sess = sess or S; r = sess.get(B + path, allow_redirects=False)
    assert r.status_code == expect, (path, r.status_code, r.headers.get("location")); return re.sub(r"<script[^>]*>.*?</script>", "", re.sub(r"<!--.*?-->", "", r.text), flags=re.S)
def post(path, aid, data, sess=None, multi=None):
    sess = sess or S; f = [(f"$ACTION_ID_{aid}", (None, ""))] + [(k, (None, str(v))) for k, v in data.items()] + [(k, (None, str(v))) for k, v in (multi or [])]
    r = sess.post(B + path, files=f, allow_redirects=False); fix_cookie(sess, r)
    assert r.status_code in (303, 302, 200), (path, r.status_code, r.text[:300]); return r.headers.get("location", "")
def find_form_aid(html, marker):
    i = html.find(marker); assert i >= 0, marker
    fs = html.rfind("<form", 0, i); fe_prev = html.rfind("</form>", 0, i)
    if fs > fe_prev: fe = html.find("</form>", i)
    else: fs = html.find("<form", i); fe = html.find("</form>", fs)
    ids = action_ids(html[fs:fe]); assert ids, marker; return ids[0]
def login(sess, email, senha, expect_end="/"):
    html = sess.get(B + "/login").text; aid = re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', html)[0]
    loc = post("/login", aid, {"email": email, "senha": senha}, sess=sess); return loc
def status(path, sess): return sess.get(B + path, allow_redirects=False).status_code
def totp(secret_b32, t=None):
    key = base64.b32decode(secret_b32 + "=" * (-len(secret_b32) % 8)); counter = int((t or time.time()) // 30)
    h = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest(); o = h[-1] & 15; return str((struct.unpack(">I", h[o:o + 4])[0] & 0x7fffffff) % 1000000).zfill(6)
unq = requests.utils.unquote

# ===== 0. setup: pública só na 1ª vez; depois exige token + sessão RH/Direção; token curto/errado = 403
assert login(S, "rh@colegiostatus", "Status2026!").endswith("/")
r = S.get(B + f"/api/setup?token={TOKEN}"); assert r.json()["ok"], r.text
r = requests.get(B + f"/api/setup?token={TOKEN}"); assert r.status_code == 403 and "já instalado" in r.text; print("setup sem sessão bloqueado ok")
r = S.get(B + "/api/setup?token=errado"); assert r.status_code == 403; print("setup com token errado bloqueado ok")
r = requests.get(B + "/colaboradores", allow_redirects=False); assert r.status_code in (302, 307) and "/login" in r.headers.get("location", ""); print("acesso sem login redireciona ok")

# ===== 1. usuários fictícios por perfil (FASE 5)
html = page("/colaboradores/novo"); aid = action_ids(html)[0]; car = re.search(r'<option value="(\d+)">Carandá</option>', html).group(1); cul = re.search(r'<option value="(\d+)">Cultura</option>', html).group(1); prof = re.search(r'<option value="(\d+)">Professor', html).group(1)
def novo(nome, unit, **kw):
    d = {"nome": nome, "admissao": "2025-03-03", "unitId": unit, "vinculo": "CLT", "abrirAdmissao": "", "positionId": prof, "salario": "5000", "cpf": "111.222.333-44", "jornadaMinDia": 528}; d.update(kw)
    return re.search(r"/colaboradores/(\d+)\?", post("/colaboradores/novo", aid, d)).group(1)
A = novo("Colab A Carandá", car); Bc = novo("Colab B Cultura", cul)
html = page("/configuracoes"); aid = find_form_aid(html, "Criar acesso")
perfis = [("admin.teste", "DIRECAO", "", ""), ("diretor.car", "DIRETOR_UNIDADE", car, ""), ("gestor.car", "GESTOR", car, ""), ("comercial", "COMERCIAL", "", ""), ("financeiro", "FINANCEIRO", "", ""), ("operacoes", "OPERACOES", "", ""), ("colab.a", "COLABORADOR", car, A), ("colab.b", "COLABORADOR", cul, Bc), ("leitura", "LEITURA", "", "")]
for email, role, unit, emp in perfis: post("/configuracoes", aid, {"nome": email, "email": email, "role": role, "unitId": unit, "employeeId": emp, "senha": "senha12345"})
sess = {}
for email, *_ in perfis: sess[email] = mk(); assert login(sess[email], email, "senha12345").endswith("/"), email
print("9 perfis de teste criados e logados ok")

# ===== 2. bloqueio por tentativas
X = mk()
for i in range(5): assert login(X, "gestor.car", "errada").endswith("erro=1")
assert login(X, "gestor.car", "senha12345").endswith("erro=bloqueado"); print("5 tentativas → bloqueio ok")
psql("TRUNCATE login_attempts")

# ===== 3. escopo por unidade e IDOR (FASE 6)
D = sess["diretor.car"]; G = sess["gestor.car"]; CA = sess["colab.a"]; CB = sess["colab.b"]; CO = sess["comercial"]; F = sess["financeiro"]; O = sess["operacoes"]; L = sess["leitura"]
assert status(f"/colaboradores/{A}", D) == 200 and status(f"/colaboradores/{Bc}", D) == 404; print("diretor Carandá não vê colaborador de Cultura ok")
assert status(f"/colaboradores/{Bc}", CA) == 404 and status(f"/colaboradores/{A}", CB) == 404 and status(f"/colaboradores/{A}", CA) == 200; print("colaborador não vê ficha de outro (IDOR por URL) ok")
# IDOR por server action: colab A tenta lançar horas para B usando a action da própria ficha
html = page(f"/colaboradores/{A}", sess=CA); aid_h = find_form_aid(html, "Novo lançamento") if "Novo lançamento" in html else None
if aid_h:
    loc = post(f"/colaboradores/{A}", aid_h, {"employeeId": Bc, "data": "2026-09-10", "tipo": "EXTRA", "minutos": 60, "voltar": f"/colaboradores/{A}"}, sess=CA); assert "erro=" in loc, loc
    assert psql(f"SELECT count(*) FROM hour_entries WHERE employee_id={Bc}") == "0"; print("IDOR por server action (banco de horas) bloqueado ok")
# gestor tenta editar salário via action de edição da ficha
html = page(f"/colaboradores/{A}", sess=G); assert "Salário" not in html and "111.222" not in html; print("gestor não vê salário/CPF na ficha ok")
r = G.get(B + "/api/export/colaboradores"); assert r.status_code == 200 and "salario" not in r.text.splitlines()[0] and "111.222" not in r.text; print("export do gestor sem salário/CPF ok")
r = G.get(B + "/api/export/tabela-salarial"); assert r.status_code == 403
r = CA.get(B + "/api/export/colaboradores"); assert r.status_code in (401, 403); print("colaborador sem exportações ok")
for path in ["/cargos-salarios", "/analytics", "/command-center", "/configuracoes", "/auditoria", "/financeiro", "/sucessao"]:
    for nome, s2 in [("colab.a", CA), ("gestor.car", G)]:
        st = status(path, s2); assert st in (302, 303, 307, 404), (path, nome, st)
print("colaborador/gestor bloqueados em telas de direção ok")
assert status("/financeiro/descontos", CO) == 200 and status("/financeiro/caixa", CO) in (302, 303, 307) and status("/financeiro", CO) in (302, 303, 307); print("comercial só acessa descontos no financeiro ok")
assert CO.get(B + "/api/export/caixa").status_code == 403 and CO.get(B + "/api/export/inadimplencia").status_code == 403; print("comercial sem exports financeiros ok")
assert status("/cargos-salarios", F) in (302, 303, 307) and status("/financeiro", F) == 200 and status("/operacoes", O) == 200 and status("/financeiro", O) in (302, 303, 307); print("financeiro e operações nos seus módulos ok")
assert status("/colaboradores", L) == 200 and "Novo colaborador" not in page("/colaboradores", sess=L); print("leitura sem ações de escrita ok")
# reserva de vaga por colaborador (sem permissão) via action
html = page("/matriculas/alunos/novo"); aid_al = action_ids(html)[0]; st_id = re.search(r"/matriculas/alunos/(\d+)\?", post("/matriculas/alunos/novo", aid_al, {"nome": "Aluno IDOR"})).group(1)
r = CA.get(B + f"/matriculas/alunos/{st_id}", allow_redirects=False); assert r.status_code in (302, 303, 307); print("colaborador sem acesso a alunos ok")

# ===== 4. dados sensíveis em mensagens de erro / AI (FASE 7)
html = page("/analytics/assistente", sess=sess["admin.teste"]); ctx = html.split("O que o assistente enxerga")[1]; assert "Colab A" not in ctx and "salario&quot;" not in ctx and "111.222" not in ctx and "outros (cargos com menos de 3 pessoas)" in ctx; print("contexto de IA sem nome/salário individual/CPF (cargos pequenos agregados) ok")
html = page("/auditoria"); assert "111.222" not in html and "5000" not in html.replace("R$", ""), "auditoria não deve expor CPF/salário em claro"; print("auditoria sem CPF/salário em claro ok")

# ===== 5. auditoria imutável no banco (FASE 13)
assert "imutável" in psql("UPDATE audit_log SET acao='x' WHERE id=(SELECT max(id) FROM audit_log)"); assert "imutável" in psql("DELETE FROM audit_log WHERE id=(SELECT max(id) FROM audit_log)"); print("audit_log imutável (UPDATE/DELETE bloqueados no banco) ok")

# ===== 6. 2FA (FASE 15): ativação, login em duas etapas, código de recuperação, obrigatoriedade
AD = sess["admin.teste"]; html = page("/conta/2fa", sess=AD); secret = re.search(r'<code class="[^"]*">([A-Z2-7]+)</code>', html).group(1); assert "<svg" in html
aid2 = find_form_aid(html, "Digite o código do aplicativo"); loc = post("/conta/2fa", aid2, {"codigo": "000000"}, sess=AD); assert "inválido" in unq(loc)
loc = post("/conta/2fa", aid2, {"codigo": totp(secret)}, sess=AD); assert "codigos=" in loc; codes = unq(loc.split("codigos=")[1]).split(" "); assert len(codes) == 8; print("2FA ativado com QR + 8 códigos de recuperação ok")
AD2 = mk(); loc = login(AD2, "admin.teste", "senha12345"); assert loc.endswith("/login/2fa"), loc; assert status("/", AD2) in (302, 303, 307); print("login com 2FA exige segunda etapa ok")
html = AD2.get(B + "/login/2fa").text; aid3 = re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', html)[0]
loc = post("/login/2fa", aid3, {"codigo": "123456"}, sess=AD2); assert "erro" in loc; loc = post("/login/2fa", aid3, {"codigo": totp(secret)}, sess=AD2); assert loc.endswith("/"); assert status("/", AD2) == 200; print("código correto libera sessão ok")
AD3 = mk(); login(AD3, "admin.teste", "senha12345"); html = AD3.get(B + "/login/2fa").text; aid4 = re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', html)[0]
loc = post("/login/2fa", aid4, {"codigo": codes[0]}, sess=AD3); assert loc.endswith("/") and status("/", AD3) == 200
AD4 = mk(); login(AD4, "admin.teste", "senha12345"); html = AD4.get(B + "/login/2fa").text; aid5 = re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', html)[0]; loc = post("/login/2fa", aid5, {"codigo": codes[0]}, sess=AD4); assert "erro" in loc; print("código de recuperação funciona uma vez só ok")
psql("""UPDATE settings SET value='{"exigir2FA": ["FINANCEIRO"]}'::jsonb WHERE key='seguranca'""")
r = F.get(B + "/financeiro", allow_redirects=False); assert r.headers.get("location", "").endswith("/conta/2fa") and status("/conta/2fa", F) == 200; print("perfil obrigado a ativar 2FA é levado à configuração ok")
psql("""UPDATE settings SET value='{"exigir2FA": []}'::jsonb WHERE key='seguranca'""")
html = page("/configuracoes"); assert "Redefinir verificação em duas etapas" in html; aid6 = find_form_aid(html, "Redefinir verificação em duas etapas"); uid = psql("SELECT id FROM users WHERE email='admin.teste'").strip(); post("/configuracoes", aid6, {"id": uid}); assert psql(f"SELECT totp_ativo FROM users WHERE id={uid}").strip() == "f"; print("RH redefine 2FA de quem perdeu o celular ok")

# ===== 7. concorrência na última vaga (FASE 9): 20 reservas simultâneas × 5 rodadas
html = page("/matriculas/turmas"); aid_t = find_form_aid(html, "Nova turma"); g5 = re.search(r'<option value="(\d+)">5º ano</option>', html).group(1)
alunos = [re.search(r"/matriculas/alunos/(\d+)\?", post("/matriculas/alunos/novo", aid_al, {"nome": f"Concorrente {i}"})).group(1) for i in range(20)]
for rodada in range(5):
    post("/matriculas/turmas", aid_t, {"ano": 2027, "unitId": car, "modalidade": "REGULAR", "gradeId": g5, "turno": "Matutino", "nome": f"Concorrência {rodada}", "vagas": 1, "status": "ABERTA"})
    html = page("/matriculas/turmas"); tid = re.search(rf'href="/matriculas/turmas/(\d+)">Concorrência {rodada}<', html).group(1); html = page(f"/matriculas/turmas/{tid}"); aid_r = find_form_aid(html, "Reservar vaga / matricular")
    resultados = []; lock = threading.Lock()
    def tenta(st):
        try:
            s3 = mk(); s3.headers["Cookie"] = S.headers["Cookie"]; r3 = s3.post(B + f"/matriculas/turmas/{tid}", files=[(f"$ACTION_ID_{aid_r}", (None, "")), ("studentId", (None, str(st))), ("classId", (None, str(tid))), ("voltar", (None, f"/matriculas/turmas/{tid}"))], allow_redirects=False, timeout=60)
            loc = r3.headers.get("location", ""); res = "ok" if "ok=" in loc else ("erro:" + unq(loc.split("erro=")[1])[:60] if "erro=" in loc else f"http{r3.status_code}")
        except Exception as e: res = f"exc:{type(e).__name__}"
        with lock: resultados.append(res)
    ts = [threading.Thread(target=tenta, args=(st,)) for st in alunos]; [t.start() for t in ts]; [t.join() for t in ts]
    n_ok = resultados.count("ok"); n_db = int(psql(f"SELECT count(*) FROM enrollments WHERE class_id={tid} AND status IN ('RESERVADA','CONFIRMADA')").strip()); assert n_db == 1 and n_ok <= 1, (rodada, n_ok, n_db, resultados)
    if n_ok != 1: print("  aviso: respostas", {k: resultados.count(k) for k in set(resultados)})
print("concorrência: 5 rodadas × 20 reservas simultâneas → sempre 1 vaga ocupada ok")

# ===== 8. idempotência do ponto (FASE 10): salvar 3× não triplica
html = page(f"/ponto/{A}?mes=2026-09"); aid_p = find_form_aid(html, "Salvar folha do mês")
d = {"employeeId": A, "mes": "2026-09"}
for k, v in re.findall(r'name="e_(\d{8})" value="(\d+)"', html): d[f"e_{k}"] = v
for k, v in re.findall(r'name="t_(\d{8})" value="([^"]*)"', html): d[f"t_{k}"] = v
for k, blk in re.findall(r'<select name="s_(\d{8})"[^>]*>(.*?)</select>', html, flags=re.S): m = re.search(r'selected="" value="([A-Z_]+)"', blk) or re.search(r'value="([A-Z_]+)" selected=""', blk); d[f"s_{k}"] = m.group(1) if m else "NORMAL"
d["s_20260916"] = "FALTA"; d["t_20260917"] = "9:48"
for i in range(3): post(f"/ponto/{A}", aid_p, d)
saldo = psql(f"SELECT coalesce(sum(minutos),0) FROM hour_entries WHERE employee_id={A}").strip(); assert saldo == "-468", saldo; print("ponto salvo 3× → saldo único (−468) ok")

# ===== 9. sessão: usuário desativado perde acesso; logout invalida
html = page("/configuracoes"); i = html.find("gestor.car"); fs = html.rfind("<form", 0, html.find("Salvar", i)); aid_u = re.search(r'name="\$ACTION_ID_([0-9a-f]+)"', html[fs:]).group(1); uid_g = re.search(r'name="id" value="(\d+)"', html[fs:]).group(1)
post("/configuracoes", aid_u, {"id": uid_g, "nome": "gestor.car", "email": "gestor.car", "role": "GESTOR", "unitId": car, "ativo": "0"}); assert status("/colaboradores", G) in (302, 303, 307); print("usuário desativado perde acesso imediato ok")
# ===== 10. Esqueci minha senha (sem e-mail configurado → RH gera senha temporária → troca obrigatória)
X2 = mk(); html = X2.get(B + "/login").text; assert "Esqueci minha senha" in html
html = X2.get(B + "/login/esqueci").text; aid_e = re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', html)[0]
loc = post("/login/esqueci", aid_e, {"email": "colab.b"}, sess=X2); assert loc.endswith("ok=rh"), loc
loc = post("/login/esqueci", aid_e, {"email": "naoexiste@x"}, sess=X2); assert loc.endswith("ok=rh"), loc; print("pedido de nova senha registrado (resposta neutra) ok")
html = page("/configuracoes"); assert "pediu nova senha" in html; aid_t = find_form_aid(html, "Gerar senha temporária"); uid_b = psql("SELECT id FROM users WHERE email='colab.b'").strip()
loc = post("/configuracoes", aid_t, {"id": uid_b}); temp = re.search(r"Senha temporária: ([A-Z]{4}-\d{4})", unq(loc)).group(1); print("RH gerou senha temporária ok")
CB2 = mk(); assert login(CB2, "colab.b", "senha12345").endswith("erro=1"); assert login(CB2, "colab.b", temp).endswith("/")
r = CB2.get(B + f"/colaboradores/{Bc}", allow_redirects=False); assert r.status_code in (302, 303, 307) and "/conta" in r.headers.get("location", ""); print("senha temporária obriga troca antes de navegar ok")
html = page("/conta?trocar=1", sess=CB2); assert "senha temporária" in html; aid_c = find_form_aid(html, "Senha atual")
loc = post("/conta", aid_c, {"atual": temp, "nova": "novaSenha2026"}, sess=CB2); assert "Senha alterada" in unq(loc)
assert status(f"/colaboradores/{Bc}", CB2) == 200; print("após trocar a senha, navega normalmente ok")
# link por token (simula e-mail): cria token direto e redefine
import hashlib as _h; tok = "abc123def456abc123def456abc123def456abc123def456"; psql(f"INSERT INTO password_resets (user_id, token_hash, expira_em, via_email) VALUES ({uid_b}, '{_h.sha256(tok.encode()).hexdigest()}', now() + interval '1 hour', true)")
X3 = mk(); html = X3.get(B + f"/login/redefinir?token={tok}").text; aid_r2 = re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', html)[0]
loc = post("/login/redefinir", aid_r2, {"token": tok, "nova": "outraSenha2026", "confirma": "outraSenha2026"}, sess=X3); assert "Senha alterada" in unq(loc), loc
loc = post("/login/redefinir", aid_r2, {"token": tok, "nova": "outraSenha2026", "confirma": "outraSenha2026"}, sess=X3); assert "inválido ou expirado" in unq(loc); print("link de redefinição: funciona uma vez e expira ok")
CB3 = mk(); assert login(CB3, "colab.b", "outraSenha2026").endswith("/"); print("login com a senha redefinida ok")
print("\nALL SEGURANCA E2E CHECKS PASSED (incl. redefinição de senha)")
