"""Dados de DEMONSTRAÇÃO da v32 — NUNCA rode em produção. Tudo fictício (pessoas "(fictício)/(fictícia)" ou "Demo").
Roda com o servidor no ar, na base de treinamento da v31 (já atualizada para a v32). Tudo pela própria interface, como o RH faria:
  0. uma segunda auxiliar financeira fictícia (o auxiliar dos exemplos da v29 continua só com o acesso do cargo);
  1. telas por pessoa: a nova auxiliar passa a ver a DRE e o caixa projetado e deixa de ver descontos (com motivo e data de fim);
  2. cópia: o tesoureiro recebe o mesmo ajuste (só o que muda para o cargo dele — descontos ficam com a gerente);
  3. ajuste em lote: os gerentes de experiência e crescimento deixam de ver a portaria (fica com a recepção de cada unidade);
  4. um ajuste que vence em poucos dias (cobertura de férias), para a pendência de renovar ou deixar vencer.
Uso: python3 scripts/demo_v32.py   (servidor local em http://localhost:3100, banco local via psql)."""
import os, re, subprocess, json, requests
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
B = os.environ.get("APP", "http://localhost:3100")
def psql(q):
    r = subprocess.run(["su", "postgres", "-c", "/usr/lib/postgresql/16/bin/psql -h /tmp/pg -U status -d status_people -q -t -A -F '|' -v ON_ERROR_STOP=1"], input=q + ";", capture_output=True, text=True)
    if r.returncode != 0: raise SystemExit(f"SQL falhou: {r.stderr[:800]}\n{q[:600]}")
    return r.stdout.strip()
def rows(q): return [l.split("|") for l in psql(q).splitlines() if l]
def mk(): s = requests.Session(); s.headers.update({"Origin": B}); return s
def action_ids(html): i = html.find("<main"); return re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', html[i:] if i >= 0 else html)
def post(path, aid, data, sess, show=True):
    f = [(f"$ACTION_ID_{aid}", (None, ""))]
    for k, v in data.items():
        for x in (v if isinstance(v, list) else [v]): f.append((k, (None, str(x))))
    r = sess.post(B + path, files=f, allow_redirects=False); m = re.search(r"rh_session=([^;]+)", r.headers.get("set-cookie", ""))
    if m: sess.headers["Cookie"] = f"rh_session={m.group(1)}"
    loc = requests.utils.unquote(r.headers.get("location", "")).replace("\xa0", " ")
    if show: print("   ", path, "→", loc[:170])
    return loc
def aid_of(html, marker):
    i = html.find(marker); assert i >= 0, marker
    fs = html.rfind("<form", 0, i); fe_prev = html.rfind("</form>", 0, i)
    if fs > fe_prev: fe = html.find("</form>", i)
    else: fs = html.find("<form", i); fe = html.find("</form>", fs)
    return action_ids(html[fs:fe])[0]
def page(path, sess): return sess.get(B + path).text.replace("\xa0", " ")
def login(email, senha):
    s = mk(); html = s.get(B + "/login").text; aid = re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', html)[0]; post("/login", aid, {"email": email, "senha": senha}, s, False); return s
def ok(loc, trecho=""): assert "ok=" in loc and trecho in loc, loc; return loc
def caixas(html):
    out = {}
    for tag in [t for t in re.findall(r"<input[^>]*>", html) if 'name="telas"' in t and "data-base=" in t]:
        out[re.search(r'value="([^"]+)"', tag).group(1)] = ("checked" in tag, 'data-base="1"' in tag)
    return out
HOJE = datetime.now(ZoneInfo("America/Campo_Grande")).date(); d = lambda n: (HOJE + timedelta(days=n)).isoformat()
if psql("SELECT 1 FROM settings WHERE key='demo_v32'"): raise SystemExit("A demonstração da v32 já foi carregada nesta base.")
RH = login("rh.teste", "Homolog2026!")

print("0) segunda auxiliar financeira (fictícia), com acesso criado pela ficha")
diego = rows("SELECT unit_id, position_id, gestor_id, company_id FROM employees WHERE email='diego.lima@exemplo.com'")[0]
pid = int(psql(f"INSERT INTO employees (nome, unit_id, position_id, vinculo, admissao, gestor_id, situacao, jornada_min_dia, sexo, email, company_id) VALUES ('Paula Andrade Costa (fictícia)', 3, {diego[1]}, 'CLT', '2022-03-14', {diego[2] or 'NULL'}, 'ATIVO', 480, 'F', 'paula.costa@exemplo.com', {diego[3] or 'NULL'}) RETURNING id"))
h = page("/configuracoes", RH)
ok(post("/configuracoes", aid_of(h, "Criar acesso"), {"modo": "auto", "employeeId": pid, "nome": "", "email": "paula.costa@exemplo.com", "senha": "senha12345", "atuacao": "LEITURA", "unitId": ""}, RH))
U = {e: int(psql(f"SELECT id FROM users WHERE email='{e}'")) for e in ["paula.costa@exemplo.com", "demo036@colegiostatus", "demo110@colegiostatus"]}

print("1) telas por pessoa: a auxiliar financeira (a mais e a menos que o cargo, com data de fim)")
uid = U["paula.costa@exemplo.com"]; h = page(f"/configuracoes/acessos/usuario/{uid}", RH); cx = caixas(h)
mais = [k for k in ["/financeiro/dre", "/financeiro/caixa"] if k in cx and not cx[k][1]]; menos = [k for k in ["/financeiro/descontos"] if k in cx and cx[k][1]]
assert mais and menos, (mais, menos)
marcadas = [k for k, (m, _) in cx.items() if m and k not in menos] + mais
fim = f"{HOJE.year}-12-18" if f"{HOJE.year}-12-18" > HOJE.isoformat() else d(45)
ok(post(f"/configuracoes/acessos/usuario/{uid}", aid_of(h, "Salvar as telas desta pessoa"), {"id": uid, "telas": marcadas, "motivo": "Apoia o fechamento do mês até a contratação do analista financeiro", "ate": fim}, RH), "salvas")

print("2) cópia do ajuste: o tesoureiro (só o que muda para o cargo dele)")
uid = U["demo036@colegiostatus"]; h = page(f"/configuracoes/acessos/usuario/{uid}", RH)
ok(post(f"/configuracoes/acessos/usuario/{uid}", aid_of(h, "Copiar o ajuste"), {"id": uid, "origemId": U["paula.costa@exemplo.com"]}, RH), "recebeu o ajuste")

print("3) ajuste em lote: gerentes de experiência e crescimento sem a portaria")
cargo = int(psql("SELECT id FROM positions WHERE nome='Gerente de Experiência e Crescimento'"))
V = f"/configuracoes/acessos?aba=pessoas&cargo={cargo}"; h = page(V, RH)
pessoas = sorted(set(re.findall(r'name="users" value="(\d+)"', h) + [m for m in re.findall(r'value="(\d+)"[^>]*name="users"', h)]))
telas_portaria = [k for k, l in re.findall(r'<input[^>]*value="([^"]+)"[^>]*/><span>([^<]+)</span>', h) if l.strip() == "Portaria e saídas"]
assert len(pessoas) >= 2 and telas_portaria, (pessoas, telas_portaria)
ok(post(V, aid_of(h, "Aplicar às pessoas marcadas"), {"voltar": V, "users": pessoas, "acao": "RETIRAR", "telas": telas_portaria, "motivo": "Portaria fica com a recepção de cada unidade"}, RH), "Ajuste em lote aplicado")

print("4) cobertura de férias que vence em poucos dias (pendência de renovar ou deixar vencer)")
uid = U["demo110@colegiostatus"]; h = page(f"/configuracoes/acessos/usuario/{uid}", RH); cx = caixas(h)
extra = [k for k in ["/financeiro/contas-a-pagar", "/financeiro/conciliacao", "/financeiro/despesas"] if k in cx and not cx[k][1]][:1]
if extra:
    ok(post(f"/configuracoes/acessos/usuario/{uid}", aid_of(h, "Salvar as telas desta pessoa"), {"id": uid, "telas": [k for k, (m, _) in cx.items() if m] + extra, "motivo": "Cobre as férias do tesoureiro na conciliação", "ate": d(5)}, RH), "salvas")
else: print("   (o cargo já dá essas telas — sem cobertura a registrar)")

psql("INSERT INTO settings (key, value) VALUES ('demo_v32', jsonb_build_object('em', now()::text)) ON CONFLICT (key) DO NOTHING")
print("Demonstração da v32 carregada:", psql("SELECT count(*) FROM users WHERE ajuste_telas IS NOT NULL"), "pessoa(s) com telas ajustadas.")
