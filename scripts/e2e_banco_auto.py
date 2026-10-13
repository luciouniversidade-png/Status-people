# E2E — atualização automática na subida do servidor.
# Pré-passo (antes de subir o servidor): DROP TABLE ai_agents; DELETE FROM settings WHERE key='banco'.
import re, subprocess, requests
B = "http://localhost:3100"
def psql(q): return subprocess.run(["su", "postgres", "-c", f"/usr/lib/postgresql/16/bin/psql -h /tmp/pg -U status -d status_people -q -t -A -c \"{q}\""], capture_output=True, text=True).stdout.strip()
assert psql("SELECT to_regclass('ai_agents') IS NOT NULL") == "t", "tabela não recriada na subida"
assert psql("SELECT value->>'versao' FROM settings WHERE key='banco'") == "22.0"
s = requests.Session(); s.headers.update({"Origin": B}); h = s.get(B + "/login").text; aid = re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', h)[0]
r = s.post(B + "/login", files=[(f"$ACTION_ID_{aid}", (None, "")), ("email", (None, "rh@colegiostatus")), ("senha", (None, "Status2026!"))], allow_redirects=False)
s.headers["Cookie"] = "rh_session=" + re.search(r"rh_session=([^;]+)", r.headers["set-cookie"]).group(1)
assert s.get(B + "/governanca/agentes").status_code == 200 and "banco de dados está desatualizado" not in s.get(B + "/").text
print("  ✓ servidor sobe, percebe o banco atrás do código e aplica o esquema sozinho (sem /api/setup, sem botão)\n\nE2E Banco (automático): 1 verificação OK")
