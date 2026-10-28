# E2E v24.1 — carga inicial: "Férias quitadas até" (ficha e planilha de colaboradores), histórico de férias por planilha,
# acessos de autoatendimento em lote (com senha temporária a qualquer momento) e turmas por planilha ou cópia de outro ano. Dados fictícios.
# Uso: bash /tmp/withserver.sh python3 scripts/e2e_carga.py
import re, subprocess, requests, datetime, time
from zoneinfo import ZoneInfo
VERSAO_ESQ = __import__("re").search(r'SCHEMA_VERSION = "([^"]+)"', open("src/lib/versao.ts").read()).group(1)  # versão do esquema exigida pelo código
B = "http://localhost:3100"
def psql(q): return subprocess.run(["su", "postgres", "-c", f"/usr/lib/postgresql/16/bin/psql -h /tmp/pg -U status -d status_people -q -t -A -c \"{q}\""], capture_output=True, text=True).stdout.strip()
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
def post(path, aid, data, sess=None, files=None):
    sess = sess or S; f = [(f"$ACTION_ID_{aid}", (None, ""))] + [(k, (None, str(v))) for k, v in data.items()] + list((files or {}).items())
    r = sess.post(B + path, files=f, allow_redirects=False); fix_cookie(sess, r)
    assert r.status_code in (303, 302, 200), (path, r.status_code, r.text[:300]); return requests.utils.unquote(r.headers.get("location", ""))
def find_form_aid(html, marker):
    i = html.find(marker); assert i >= 0, marker
    fs = html.rfind("<form", 0, i); fe_prev = html.rfind("</form>", 0, i)
    if fs > fe_prev: fe = html.find("</form>", i)
    else: fs = html.find("<form", i); fe = html.find("</form>", fs)
    ids = action_ids(html[fs:fe]); assert ids, marker; return ids[0]
def login(sess, email, senha):
    for _ in range(20):
        html = sess.get(B + "/login").text; aid = re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', html)[0]
        r = sess.post(B + "/login", files=[(f"$ACTION_ID_{aid}", (None, "")), ("email", (None, email)), ("senha", (None, senha))], allow_redirects=False)
        if "rh_session=" in r.headers.get("set-cookie", ""): fix_cookie(sess, r); return r.headers.get("location", "")
        time.sleep(1.5)
    raise SystemExit(f"login falhou: {email}")
n = 0
def ok(cond, msg):
    global n
    assert cond, msg
    n += 1; print("  ok", msg)

H = datetime.datetime.now(ZoneInfo("America/Campo_Grande")).date()
login(S, "rh@colegiostatus", "Status2026!"); TOKEN = [l.split("=", 1)[1].strip().strip('"') for l in open(".env") if l.startswith("SETUP_TOKEN=")][0]
assert S.get(B + f"/api/setup?token={TOKEN}").json()["ok"]
ok(psql("SELECT value->>'versao' FROM settings WHERE key='banco'") == VERSAO_ESQ, f"banco atualizado para o esquema {VERSAO_ESQ} (coluna ferias_quitadas_ate)")
unid = psql("SELECT nome FROM units ORDER BY id LIMIT 1")

# 1) planilha de colaboradores com a coluna nova
h = page("/colaboradores/importar"); aid = find_form_aid(h, "Importar")
csv = ("nome;unidade;admissao;email;ferias_quitadas_ate;nivel;gestor\n"
       f"Carga Teste Nova;{unid};01/03/2024;carga.nova@exemplo.com;;pleno;Carga Teste Antiga\n"   # gestor aparece depois: a ordem não importa
       f"Carga Teste Antiga;{unid};03/02/2015;carga.antiga@exemplo.com;02/02/2025;Sênior;\n"
       f"Carga Teste Sem Email;{unid};01/03/2024;;;;Gestor Que Não Existe\n"
       f"Carga Teste Data Ruim;{unid};01/03/2024;;31-02-2024;;\n")
loc = post("/colaboradores/importar", aid, {"csv": csv})
ok("3 colaborador(es) importado(s)" in loc and "ferias_quitadas_ate" in loc, f"importação: 3 linhas boas e a data inválida de quitação listada ({loc[:140]})")
ok("gestor \"Gestor Que Não Existe\" não encontrado" in loc, "gestor desconhecido vira aviso da linha (a pessoa é importada sem gestor)")
ok(psql("SELECT n.nivel||'|'||g.nome FROM employees n JOIN employees g ON g.id=n.gestor_id WHERE n.nome='Carga Teste Nova'") == "Pleno|Carga Teste Antiga", "nível e gestor direto pela planilha (gestor numa linha posterior)")
ant = psql("SELECT id||'|'||ferias_quitadas_ate FROM employees WHERE nome='Carga Teste Antiga'").split("|")
ok(ant[1] == "2025-02-02", "ferias_quitadas_ate gravada a partir da planilha (DD/MM/AAAA)")
h = page(f"/colaboradores/{ant[0]}")
ok(h.count("Quitado") >= 10 or h.count("quitado") >= 10, "ficha: os dez períodos encerrados até 02/02/2025 aparecem quitados")
ok("Vencido" not in h.split("Lançamentos do banco")[0], "ficha: nenhum período antigo como vencido")

# 2) campo na edição do cadastro
h = page(f"/colaboradores/{ant[0]}/editar"); ok('name="feriasQuitadasAte"' in h, "campo “Férias quitadas até (carga inicial)” na edição da ficha")

# 3) histórico de férias por planilha
nova = psql("SELECT id FROM employees WHERE nome='Carga Teste Nova'")
h = page("/ferias/importar"); aid = find_form_aid(h, "Importar histórico")
csv = ("nome;inicio;fim;dias;unidade\n"
       f"Carga Teste Antiga;10/03/2025;29/03/2025;30;{unid}\n"      # 20 gozados + 10 de abono → período 2025/2026 quitado
       f"Carga Teste Nova;05/03/2025;19/03/2025;;\n"                  # período 2024/2025 só começou em 01/03/2024 → ok, 15 dias
       f"Carga Teste Nova;05/03/2025;19/03/2025;;\n"                  # repetida → ignorada
       f"Carga Teste Nova;10/03/2025;12/03/2025;;\n"                  # sobreposta → erro da linha
       f"Carga Teste Nova;{(H + datetime.timedelta(days=20)).strftime('%d/%m/%Y')};{(H + datetime.timedelta(days=30)).strftime('%d/%m/%Y')};;\n"  # futura → erro
       "Ninguém Com Este Nome;01/02/2025;10/02/2025;;\n")
loc = post("/ferias/importar", aid, {"csv": csv})
ok("2 férias do histórico importada(s), 1 repetida(s) ignorada(s)" in loc, f"histórico: 2 importadas, 1 repetida ({loc[:120]})")
ok("sobreposto" in loc and "não são histórico" in loc and "não encontrado" in loc, "histórico: sobreposição, férias futuras e nome desconhecido aparecem como erro da linha")
r = psql(f"SELECT status||'|'||periodo_ref||'|'||dias||'|'||justificativa FROM leave_requests WHERE employee_id={ant[0]}")
ok(r == "APROVADA|2025-02-03|30|Histórico importado da planilha", f"férias do histórico entram aprovadas no período certo, com os dias informados ({r})")
r = psql(f"SELECT periodo_ref||'|'||dias FROM leave_requests WHERE employee_id={nova}")
ok(r == "2024-03-01|15", f"sem a coluna dias, contam os dias corridos ({r})")
h = page(f"/colaboradores/{ant[0]}"); ok("Vencido" not in h.split("Lançamentos do banco")[0], "ficha da pessoa antiga: tudo quitado depois do histórico")
ok(psql(f"SELECT count(*) FROM notifications WHERE titulo ILIKE '%férias%' AND created_at > now() - interval '2 minutes'") == "0", "histórico não dispara notificações nem e-mails de aprovação")
h = page("/ferias"); ok("Importar histórico" in h, "atalho “Importar histórico” na tela de férias")

# 4) acessos de autoatendimento em lote
h = page("/configuracoes"); aid = find_form_aid(h, "Criar acessos de quem ainda não tem")
antes = int(psql("SELECT count(*) FROM users"))
loc = post("/configuracoes", aid, {"unitId": ""})
criados = int(psql("SELECT count(*) FROM users")) - antes
ok(criados >= 2 and "acesso(s) criado(s) pelo cargo de cada ficha" in loc and "Carga Teste Sem Email" in loc, f"lote: {criados} acessos criados; quem não tem e-mail é listado ({loc[:160]})")
u = psql("SELECT role||'|'||trocar_senha||'|'||(employee_id IS NOT NULL)||'|'||(unit_id IS NOT NULL) FROM users WHERE email='carga.antiga@exemplo.com'")
ok(u == "COLABORADOR|true|true|true", f"acesso criado com perfil Colaborador, vinculado à ficha e à unidade, com troca de senha obrigatória ({u})")
loc = post("/configuracoes", aid, {"unitId": ""}); ok(loc.split("ok=")[-1].startswith("0 acesso"), "rodar de novo não duplica")
# senha temporária a qualquer momento (sem pedido pendente)
uid = psql("SELECT id FROM users WHERE email='carga.antiga@exemplo.com'")
h = page("/configuracoes"); i = h.find("carga.antiga@exemplo.com"); seg = h[i:i + 9000]; j = seg.find("Gerar senha temporária"); ok(i > 0 and j > 0 and f'name="id" value="{uid}"' in seg[:j], "botão “Gerar senha temporária” disponível no Editar do usuário")
aid_t = find_form_aid(h[i:], "Gerar senha temporária")
loc = post("/configuracoes", aid_t, {"id": uid}); m = re.search(r"Senha temporária: ([A-Z]{4}-\d{4})", loc)
ok(bool(m), "senha temporária gerada e mostrada uma vez")
C = mk(); dest = login(C, "carga.antiga@exemplo.com", m.group(1))
r = C.get(B + "/", allow_redirects=False); ok(r.status_code in (302, 303, 307) and "/conta" in r.headers.get("location", ""), "primeiro acesso leva à troca de senha")

# 5) turmas: importação por planilha e cópia da grade de um ano para o outro
h = page("/matriculas/turmas"); aid = find_form_aid(h, "Importar turmas")
serie = psql("SELECT nome FROM grades ORDER BY ordem LIMIT 1 OFFSET 8")
csv = ("unidade;serie;turno;nome;vagas;modalidade;series_grupo;ano\n"
       f"{unid};{serie};Matutino;Turma Carga A;30;;;2030\n"
       f"{unid};{serie};tarde;Turma Carga B;28;;;2030\n"
       f"{unid};;Integral;Integral Carga;20;Integral;1º + 2º ano;2030\n"
       f"{unid};Série Que Não Existe;Matutino;Turma Ruim;30;;;2030\n"
       f"{unid};{serie};Noturno;Turma Noite;30;;;2030\n")
loc = post("/matriculas/turmas", aid, {"csv": csv})
ok("3 turma(s) criada(s), 0 atualizada(s)" in loc and "não encontrada" in loc and "inválido" in loc, f"turmas: 3 criadas; série inexistente e turno inválido viram erro da linha ({loc[:150]})")
ok(psql("SELECT turno FROM classes WHERE nome='Turma Carga B' AND ano=2030") == "Vespertino", "turno “tarde” aceito como Vespertino")
ok(psql("SELECT modalidade||'|'||coalesce(series_texto,'') FROM classes WHERE nome='Integral Carga' AND ano=2030") == "INTEGRAL|1º + 2º ano", "turma Integral com o grupo de séries")
loc = post("/matriculas/turmas", aid, {"csv": "unidade;serie;turno;nome;vagas;ano\n" + f"{unid};{serie};Matutino;Turma Carga A;32;2030\n"})
ok("0 turma(s) criada(s), 1 atualizada(s)" in loc and psql("SELECT vagas FROM classes WHERE nome='Turma Carga A' AND ano=2030") == "32", "reimportar a mesma turma atualiza as vagas, sem duplicar")
h = page("/matriculas/turmas"); aid = find_form_aid(h, "Copiar turmas abertas")
loc = post("/matriculas/turmas", aid, {"de": "2030", "para": "2031"})
ok("3 turma(s) de 2031 criada(s) a partir de 2030" in loc and psql("SELECT count(*) FROM classes WHERE ano=2031") == "3", "copiar a grade de 2030 para 2031")
loc = post("/matriculas/turmas", aid, {"de": "2030", "para": "2031"}); ok("0 turma(s)" in loc and "já existia" in loc, "copiar de novo não duplica")
print(f"\nE2E carga inicial (v24.1): {n} verificações OK")
