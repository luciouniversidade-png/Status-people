# E2E — atualização do banco pelo próprio sistema: banco atrás do código, aviso, erro amigável, diagnóstico, botão e resiliência a falhas.
import re, subprocess, requests
VERSAO_ESQ = __import__("re").search(r'SCHEMA_VERSION = "([^"]+)"', open("src/lib/versao.ts").read()).group(1)  # versão do esquema exigida pelo código
B = "http://localhost:3100"; TOKEN = "setup-homologacao-2026-status"
def psql(q): return subprocess.run(["su", "postgres", "-c", f"/usr/lib/postgresql/16/bin/psql -h /tmp/pg -U status -d status_people -q -t -A -c \"{q.replace(chr(34), chr(92) + chr(34))}\""], capture_output=True, text=True).stdout.strip()
def mk(): s = requests.Session(); s.headers.update({"Origin": B}); return s
S = mk(); unq = requests.utils.unquote; N = [0]
def ok(m): N[0] += 1; print(f"  ✓ {m}")
def fix_cookie(sess, r):
    m = re.search(r"rh_session=([^;]+)", r.headers.get("set-cookie", ""))
    if m: sess.headers["Cookie"] = f"rh_session={m.group(1)}"
def html_of(path, sess=None): r = (sess or S).get(B + path, allow_redirects=False); return r.status_code, r.text
def post(path, aid, data, sess=None):
    sess = sess or S; f = [(f"$ACTION_ID_{aid}", (None, ""))] + [(k, (None, str(v))) for k, v in data.items()]
    r = sess.post(B + path, files=f, allow_redirects=False); fix_cookie(sess, r); return unq(r.headers.get("location", ""))
def aid_near(html, marker):
    i = html.find(marker); assert i >= 0, marker; ids = list(re.finditer(r'\$ACTION_ID_([0-9a-f]+)', html[:i])); assert ids, marker; return ids[-1].group(1)
def login(sess, email, senha):
    h = sess.get(B + "/login").text; aid = re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', h)[0]; loc = post("/login", aid, {"email": email, "senha": senha}, sess=sess); assert loc.endswith("/"), loc

login(S, "rh@colegiostatus", "Status2026!"); j = S.get(B + f"/api/setup?token={TOKEN}").json(); assert j["ok"] and j["versao"] == VERSAO_ESQ and j["falhas"] == [] and j["aplicadas"] > 250, j; ok(f"setup aplica {j['aplicadas']} instruções, uma a uma, e registra a versão do esquema")
st, h = html_of("/"); assert "banco de dados está desatualizado" not in h; st, h = html_of("/configuracoes/banco"); assert "Banco em dia" in h; ok("banco em dia: sem aviso, diagnóstico verde")
h = S.get(B + "/colaboradores/novo").text; aid = re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', h[h.find("<main"):])[0]; car = re.search(r'<option value="(\d+)">Carandá</option>', h).group(1)
E = re.search(r"/colaboradores/(\d+)\?", post("/colaboradores/novo", aid, {"nome": "Pessoa Teste", "admissao": "2024-02-01", "unitId": car, "vinculo": "CLT", "abrirAdmissao": "", "jornadaMinDia": 528})).group(1)
h = S.get(B + "/configuracoes").text; post("/configuracoes", aid_near(h, "Criar acesso"), {"nome": "Dir Car", "email": "dir@car", "role": "DIRETOR_UNIDADE", "unitId": car, "senha": "senha12345"})
SD = mk(); login(SD, "dir@car", "senha12345")

print("== Banco atrás do código (como numa atualização publicada sem aplicar o esquema)")
psql("DROP TABLE IF EXISTS role_profile_acks, role_profiles, dev_needs, ai_agents, announcement_acks, announcements, message_templates CASCADE")
psql("ALTER TABLE positions DROP COLUMN formacao_exigida, DROP COLUMN documento_formacao"); psql("DELETE FROM settings WHERE key='banco'")
st, h = html_of("/"); assert "banco de dados está desatualizado" in h and "Atualizar banco agora" in h; ok("Direção/RH veem o aviso com o botão em qualquer tela")
st, h = html_of("/", sess=SD); assert "banco de dados está desatualizado" not in h; ok("outros perfis não veem o aviso técnico")
for p in ["/documentos", "/desempenho/expectativas", "/governanca/agentes", "/configuracoes"]:
    st, h = html_of(p); chunk = re.search(r'static/chunks/app/\(app\)/error-[0-9a-f]+\.js', h); assert st == 500 and chunk, (p, st)
    js = requests.get(B + "/_next/" + chunk.group(0)).text; assert "Esta tela n" in js and "Tentar de novo" in js and "digest" in h
ok("telas afetadas carregam a tela de erro do sistema (mensagem, código e caminho da correção), não a página branca padrão")
st, h = html_of("/configuracoes/banco"); assert "Atualização necessária" in h and "role_profiles" in h and "positions.formacao_exigida" in h and "Desempenho e Painel do Colaborador" in h and "Agentes de IA" in h; ok("diagnóstico lista o que falta, por área, comparando o código com o banco real")
loc = post("/", aid_near(html_of("/")[1], "Atualizar banco agora"), {}, sess=SD); assert "erro=" in loc and "Só Direção ou RH" in loc, loc; ok("só Direção/RH aplicam a atualização")
loc = post("/", aid_near(html_of("/")[1], "Atualizar banco agora"), {}); assert "ok=" in loc and "Banco atualizado" in loc, loc
st, h = html_of("/configuracoes/banco"); assert "Banco em dia" in h and psql("SELECT value->>'versao' FROM settings WHERE key='banco'") == VERSAO_ESQ
for p in ["/documentos", "/desempenho/expectativas", "/governanca/agentes", "/configuracoes"]:
    st, h = html_of(p); assert st == 200 and "Esta tela não pôde ser carregada" not in h, (p, st)
assert "banco de dados está desatualizado" not in html_of("/")[1] and psql("SELECT count(*) FROM audit_log WHERE acao='atualizar banco de dados'") == "1"; ok("um toque no botão recria o que faltava; telas voltam e a ação fica auditada")

print("== Uma instrução com problema não bloqueia as outras")
uid = psql("SELECT id FROM users WHERE email='rh@colegiostatus'"); psql("DROP INDEX IF EXISTS notifications_chave_idx"); psql(f"INSERT INTO notifications (user_id, titulo, chave) VALUES ({uid}, 'antiga', 'dup'), ({uid}, 'antiga', 'dup')")
psql("DROP TABLE ai_agents CASCADE"); psql("DELETE FROM settings WHERE key='banco'")
j = S.get(B + f"/api/setup?token={TOKEN}").json(); assert j["ok"] is False and len(j["falhas"]) == 1 and "notifications_chave_idx" in j["falhas"][0]["sql"], j
assert psql("SELECT to_regclass('ai_agents') IS NOT NULL") == "t"
ok("índice bloqueado por dado antigo duplicado vira pendência; todo o resto é aplicado (ai_agents recriada)")
st, h = html_of("/configuracoes/banco"); assert "Pendências da última atualização (1)" in h and "notifications_chave_idx" in h; assert "terminou com pendências" in html_of("/")[1]; ok("pendência aparece no diagnóstico e no aviso, com a instrução e o erro")
psql("DELETE FROM notifications WHERE id = (SELECT max(id) FROM notifications WHERE chave='dup')")
loc = post("/configuracoes/banco", aid_near(html_of("/configuracoes/banco")[1], "Aplicar"), {}); assert "Banco atualizado" in loc, loc; assert "Banco em dia" in html_of("/configuracoes/banco")[1]; ok("corrigido o dado, repetir a atualização zera as pendências")
print(f"\nE2E Banco de dados: {N[0]} verificações OK")
