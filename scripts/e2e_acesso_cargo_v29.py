# E2E — v29 · Acesso pelo cargo. O cargo define a atuação (como a pessoa age nas telas e o alcance), as telas que ela vê e o que ela
# aprova; o usuário com ficha herda do cargo (sem perfil escolhido à mão). Cobre: migração (cargos com atuação, acessos antigos
# preservados), editor do cargo (telas, aprovações, alçada de desconto, cópia), criação pela ficha (e conta sem ficha), menu e
# bloqueio por endereço (tela, subpágina, dono da rota, API e exportação), painel financeiro sem os números de telas ocultas,
# auxiliar × gerente financeiro (DRE, cockpit, contas a pagar, desconto), liderança fora da área de pessoas (aprova só a própria
# equipe; Minha equipe), troca de cargo na ficha muda o acesso na próxima tela, exceção individual com motivo, substituição
# temporária com fim automático, desligamento encerra o login, compatibilidade com o formulário antigo (campo "role"), trava contra
# trancar o sistema, comunicado por cargo, etapa de aprovação por cargo, matriz de acesso, “o que a pessoa vê”, rotina diária e
# trilha de auditoria. Dados fictícios. Uso: bash /tmp/withserver.sh python3 scripts/e2e_acesso_cargo_v29.py
import re, subprocess, requests
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
B = "http://localhost:3100"; TOKEN = "setup-homologacao-2026-status"
def psql(q): return subprocess.run(["su", "postgres", "-c", "/usr/lib/postgresql/16/bin/psql -h /tmp/pg -U status -d status_people -q -t -A -F '|' -v ON_ERROR_STOP=1"], input=q + ";", capture_output=True, text=True).stdout.strip()
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
    assert r.status_code in (303, 302, 200), (path, r.status_code, r.text[:300]); return unq(r.headers.get("location", ""))
def aid_of(html, marker):
    i = html.find(marker); assert i >= 0, marker
    fs = html.rfind("<form", 0, i); fe_prev = html.rfind("</form>", 0, i)
    if fs > fe_prev: fe = html.find("</form>", i)
    else: fs = html.find("<form", i); fe = html.find("</form>", fs)
    ids = action_ids(html[fs:fe]); assert ids, marker; return ids[0]
def login(email, senha="senha12345"):
    s = mk(); html = s.get(B + "/login").text; aid = re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', html)[0]
    loc = post("/login", aid, {"email": email, "senha": senha}, s); assert loc.endswith("/"), (email, loc); return s
def erro(loc, trecho): loc = loc.replace("\xa0", " "); assert "erro=" in loc and trecho in loc, (trecho, loc)
def okmsg(loc, trecho=""): loc = loc.replace("\xa0", " "); assert "ok=" in loc and trecho in loc, (trecho, loc)
def menu(html):
    a = html.find("<aside"); b = html.find("</aside>", a); asd = html[a:b]; i = asd.find('class="hidden md:block"')
    return re.findall(r'<a [^>]*href="([^"]+)"', asd[i:] if i >= 0 else asd)
def q(v): return "NULL" if v is None else str(v) if isinstance(v, (int, float)) else "'" + str(v).replace("'", "''") + "'"
HOJE = datetime.now(ZoneInfo("America/Campo_Grande")).date(); H = HOJE.isoformat()
def d(n): return (HOJE + timedelta(days=n)).isoformat()

print("Preparação e migração")
RH = login("rh@colegiostatus", "Status2026!"); r = RH.get(B + f"/api/setup?token={TOKEN}"); assert r.json()["ok"], r.text
tot = int(psql("SELECT count(*) FROM positions")); comAcesso = int(psql("SELECT count(*) FROM positions WHERE acesso->>'atuacao' IS NOT NULL"))
assert tot >= 20 and comAcesso == tot, (tot, comAcesso); assert psql("SELECT value->>'cargos' FROM settings WHERE key='acesso_v29'") != ""
assert psql("SELECT acesso->>'atuacao' FROM positions WHERE nome='Professor'") == "COLABORADOR" and psql("SELECT acesso->>'atuacao' FROM positions WHERE nome='Gerente Financeiro'") == "FINANCEIRO" and psql("SELECT acesso->>'atuacao' FROM positions WHERE nome='Coordenador Pedagógico'") == "GESTOR"
assert psql("SELECT role||'|'||origem_acesso||'|'||array_to_string(aprova, ',') FROM users WHERE email='rh@colegiostatus'").startswith("RH|DIRETO|ferias,banco,processos")
ok(f"migração: {tot} cargos com atuação (Professor → autoatendimento, Gerente Financeiro → financeiro, Coordenador Pedagógico → coordenação); conta sem ficha mantém a atuação RH com as aprovações do padrão")
U = {c: int(psql(f"SELECT id FROM units WHERE codigo='{c}'")) for c in ["CAR", "CUL"]}; CAR, CUL = U["CAR"], U["CUL"]
P = {n: int(psql(f"SELECT id FROM positions WHERE nome='{n}'")) for n in ["Gerente Financeiro", "Auxiliar Administrativo", "Tesoureiro", "Professor", "Coordenador Pedagógico", "Secretária", "Diretor Geral (Sócio)"]}
def emp(nome, cargo, unit, gestor=None, email=None):
    return int(psql(f"INSERT INTO employees (nome, unit_id, position_id, vinculo, admissao, gestor_id, email, situacao) VALUES ({q(nome)}, {unit}, {P[cargo]}, 'CLT', '2023-02-01', {q(gestor)}, {q(email)}, 'ATIVO') RETURNING id"))
ANA = emp("Ana Gerente Financeira", "Gerente Financeiro", CAR)
BETO = emp("Beto Auxiliar", "Auxiliar Administrativo", CAR, ANA); CAIO = emp("Caio Tesoureiro", "Tesoureiro", CUL, ANA)
DORA = emp("Dora Professora", "Professor", CAR); EDU = emp("Edu Coordenador", "Coordenador Pedagógico", CAR)
SECR = emp("Sara Secretária", "Secretária", CAR, None, "sara.sec@exemplo.com"); PROF2 = emp("Paulo Professor", "Professor", CUL, None, "paulo.prof@exemplo.com")
ok("fichas fictícias: gerente financeira com auxiliar e tesoureiro na equipe, professora, coordenador, secretária e professor com e-mail")

print("Cargo: telas, aprovações e alçada de desconto (auxiliar ≠ gerente)")
h = page(f"/configuracoes/acessos/cargo/{P['Auxiliar Administrativo']}", RH); assert "Autoatendimento" in h and "sugerida pelo nome do cargo" in h
assert psql(f"SELECT acesso->>'sugerida' FROM positions WHERE id={P['Auxiliar Administrativo']}") == "true" and "só sugerida pelo nome do cargo" in page("/configuracoes/acessos", RH)
h = page(f"/configuracoes/acessos/cargo/{P['Auxiliar Administrativo']}?atuacao=FINANCEIRO", RH); assert "Mostrando as telas e as aprovações padrão de" in h and "Nada muda até você salvar" in h
TODAS_FIN = [re.search(r'value="([^"]+)"', x).group(1) for x in re.findall(r'<input[^>]*name="telas"[^>]*>', h)]; assert "/financeiro/dre" in TODAS_FIN and "/financeiro/recebimentos" in TODAS_FIN and "/financeiro/cockpit" in TODAS_FIN
aid_cargo = aid_of(h, "Salvar o acesso do cargo")
TELAS_AUX = ["/financeiro", "/financeiro/recebimentos", "/financeiro/conciliacao", "/financeiro/despesas", "/financeiro/contas-a-pagar", "/financeiro/descontos", "/aprovacoes", "/alertas", "/solicitacoes", "/comunicacao/comunicados", "/governanca/pops"]
okmsg(post(f"/configuracoes/acessos/cargo/{P['Auxiliar Administrativo']}", aid_cargo, {"id": P["Auxiliar Administrativo"], "atuacao": "FINANCEIRO", "telas": TELAS_AUX, "descontoPct": "5"}, RH), "Vale para")
acc = psql(f"SELECT acesso->>'atuacao', jsonb_array_length(acesso->'telas'), acesso->'aprova'::text, acesso->>'descontoPct' FROM positions WHERE id={P['Auxiliar Administrativo']}").split("|")
assert acc[0] == "FINANCEIRO" and int(acc[1]) >= len(TELAS_AUX) and acc[2] == "[]" and acc[3] == "5", acc
assert psql(f"SELECT acesso->'telas' ? '/financeiro/dre' FROM positions WHERE id={P['Auxiliar Administrativo']}") == "f"
assert psql(f"SELECT acesso->>'sugerida' FROM positions WHERE id={P['Auxiliar Administrativo']}") == "false"
ok("auxiliar administrativo: atuação Financeiro com 11 telas marcadas (sem DRE, cockpit, orçamento), nenhuma aprovação e desconto até 5%; a atuação, antes só sugerida pelo nome, fica confirmada")
h = page(f"/configuracoes/acessos/cargo/{P['Gerente Financeiro']}", RH); aid_g = aid_of(h, "Salvar o acesso do cargo")
okmsg(post(f"/configuracoes/acessos/cargo/{P['Gerente Financeiro']}", aid_g, {"id": P["Gerente Financeiro"], "atuacao": "FINANCEIRO", "telas": TODAS_FIN, "aprova": ["financeiro", "baixaManual", "contasPagar", "ferias", "banco"], "descontoPct": "40"}, RH))
assert psql(f"SELECT acesso->'telas' IS NULL OR jsonb_typeof(acesso->'telas')='null', acesso->'aprova' ? 'contasPagar', acesso->>'descontoPct' FROM positions WHERE id={P['Gerente Financeiro']}") == "t|t|40"
ok("gerente financeiro: todas as telas (telas novas entram sozinhas), aprova contas a pagar, férias e banco da equipe, desconto até 40%")
erro(post(f"/configuracoes/acessos/cargo/{P['Tesoureiro']}", aid_g, {"id": P["Tesoureiro"], "atuacao": "FINANCEIRO", "telas": TODAS_FIN, "seguePadrao": "1", "descontoPct": "140"}, RH), "Alçada de desconto")
h = page(f"/configuracoes/acessos/cargo/{P['Tesoureiro']}", RH); aid_cp = aid_of(h, "Copiar atuação, telas e aprovações")
okmsg(post(f"/configuracoes/acessos/cargo/{P['Tesoureiro']}", aid_cp, {"id": P["Tesoureiro"], "origemId": P["Auxiliar Administrativo"]}, RH), "mesmo acesso de Auxiliar Administrativo")
assert psql(f"SELECT (acesso->'telas')::text = (SELECT acesso->'telas' FROM positions WHERE id={P['Auxiliar Administrativo']})::text FROM positions WHERE id={P['Tesoureiro']}") == "t"
okmsg(post(f"/configuracoes/acessos/cargo/{P['Tesoureiro']}", aid_g, {"id": P["Tesoureiro"], "atuacao": "FINANCEIRO", "telas": TELAS_AUX + ["/financeiro/caixa"], "seguePadrao": "1", "descontoPct": ""}, RH))
assert psql(f"SELECT acesso->'aprova', acesso->'descontoPct' FROM positions WHERE id={P['Tesoureiro']}") == "null|null"
ok("percentual inválido recusado; cópia de cargo (atuação, telas e aprovações); tesoureiro volta ao padrão da atuação nas aprovações e no desconto")

print("Usuário pela ficha (sem perfil)")
html = page("/configuracoes", RH); assert "Perfil" not in re.sub(r"perfil por eixo|Perfil por eixo", "", html.split('id="usuarios"')[1].split('id="alcadas"')[0]); aid_user = aid_of(html, "Criar acesso")
erro(post("/configuracoes", aid_user, {"modo": "auto", "employeeId": "", "nome": "Sem Pessoa", "email": "sem@pessoa", "senha": "senha12345"}, RH), "Escolha a pessoa")
def novo(eid, nome, email): okmsg(post("/configuracoes", aid_user, {"modo": "auto", "employeeId": eid, "nome": nome, "email": email, "senha": "senha12345", "atuacao": "DIRECAO", "unitId": ""}, RH)); return int(psql(f"SELECT id FROM users WHERE email='{email}'"))
UBETO = novo(BETO, "Beto Auxiliar", "beto@fin"); UANA = novo(ANA, "Ana Gerente", "ana@fin"); UCAIO = novo(CAIO, "Caio Tesoureiro", "caio@fin"); UDORA = novo(DORA, "Dora Professora", "dora@car"); UEDU = novo(EDU, "Edu Coordenador", "edu@car")
assert psql(f"SELECT role||'|'||origem_acesso||'|'||coalesce(unit_id::text,'rede')||'|'||coalesce(array_to_string(aprova, ','),'')||'|'||desconto_pct::float FROM users WHERE id={UBETO}") == "FINANCEIRO|CARGO|rede||5"
assert psql(f"SELECT role||'|'||array_to_string(aprova, ',')||'|'||desconto_pct::float FROM users WHERE id={UANA}") == "FINANCEIRO|ferias,banco,financeiro,contasPagar,baixaManual|40"
assert psql(f"SELECT role||'|'||unit_id FROM users WHERE id={UDORA}") == f"COLABORADOR|{CAR}" and psql(f"SELECT role||'|'||unit_id FROM users WHERE id={UEDU}") == f"GESTOR|{CAR}"
erro(post("/configuracoes", aid_user, {"modo": "auto", "employeeId": BETO, "nome": "Beto 2", "email": "beto2@fin", "senha": "senha12345"}, RH), "já tem um acesso")
LIA = emp("Lia Atendente", "Secretária", CAR, None, "lia.atendente@exemplo.com")
loc = post("/configuracoes", aid_user, {"modo": "auto", "employeeId": LIA, "nome": "", "email": "", "senha": "", "atuacao": "LEITURA", "unitId": ""}, RH); okmsg(loc, "Senha temporária:")
TEMP = re.search(r"Senha temporária: ([A-Za-z0-9-]+)", loc).group(1)
assert psql("SELECT nome||'|'||trocar_senha::text||'|'||role FROM users WHERE email='lia.atendente@exemplo.com'") == "Lia Atendente|true|COMERCIAL"
SL = mk(); hl = SL.get(B + "/login").text; loc = post("/login", re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', hl)[0], {"email": "lia.atendente@exemplo.com", "senha": TEMP}, SL); assert "erro" not in loc, loc
erro(post("/configuracoes", aid_user, {"modo": "auto", "employeeId": DORA, "nome": "", "email": "", "senha": ""}, RH), "Informe o nome e o e-mail")
hp = page(f"/configuracoes/acessos/cargo/{P['Professor']}", RH); assert "Criar os acessos das 1 ficha(s) deste cargo" in hp
loc = post(f"/configuracoes/acessos/cargo/{P['Professor']}", aid_of(hp, "Criar os acessos das"), {"positionId": P["Professor"], "voltar": f"/configuracoes/acessos/cargo/{P['Professor']}", "unitId": ""}, RH)
assert loc.startswith(f"/configuracoes/acessos/cargo/{P['Professor']}?ok=") and "1 acesso(s) criado(s)" in loc, loc
assert psql("SELECT role||'|'||origem_acesso||'|'||trocar_senha::text FROM users WHERE email='paulo.prof@exemplo.com'") == "COLABORADOR|CARGO|true"
ok("acesso criado escolhendo só a pessoa: atuação, alcance, aprovações e desconto vêm do cargo (a atuação enviada é ignorada); nome e e-mail em branco vêm da ficha; sem senha, o sistema gera a temporária (troca obrigatória); lote do cargo pelo editor do cargo; sem pessoa recusado; uma ficha, um acesso")

print("Auxiliar financeiro: menu, bloqueio por endereço, API e exportação")
BT = login("beto@fin"); h = page("/financeiro/recebimentos", BT); m = menu(h)
assert "/financeiro/recebimentos" in m and "/financeiro/contas-a-pagar" in m and "/financeiro/dre" not in m and "/financeiro/cockpit" not in m and "/financeiro/orcamento" not in m and "/executivo/board" not in m and "/eu" in m, m
assert "Auxiliar Administrativo" in h
st, lc = loc_of("/financeiro/dre", BT); assert st in (302, 303, 307) and lc.startswith("/sem-acesso?t=/financeiro/dre"), (st, lc)
h = page("/sem-acesso?t=/financeiro/dre", BT); assert "DRE gerencial" in h and "não faz parte do acesso" in h and "Auxiliar Administrativo" in h
for p in ["/financeiro/cockpit", "/financeiro/orcamento/planilha", "/financeiro/lancamentos", "/financeiro/rateio", "/executivo/board"]:
    st, lc = loc_of(p, BT); assert st in (302, 303, 307) and lc.startswith("/sem-acesso"), (p, st, lc)
page("/financeiro/contas-a-pagar/nova", BT); page(f"/colaboradores/{BETO}", BT); page("/eu", BT); page("/conta", BT)
assert get("/api/financeiro/dre", BT).status_code == 403 and get("/api/financeiro/cockpit", BT).status_code == 403 and get("/api/export/fpa", BT).status_code == 403 and get("/api/export/recebimentos", BT).status_code == 200
h = page("/financeiro", BT); assert "Resultado no ano" not in h and "Inadimplência (90 dias)" not in h and "Orçamento e DRE" not in h and ">Recebimentos<" in h
ok("auxiliar vê recebimentos, conciliação, despesas e contas a pagar; DRE, cockpit, orçamento (e a planilha), lançamentos do caixa, rateio e board abrem a tela de sem acesso; API e CSV seguem a tela; o painel esconde resultado, inadimplência e o atalho do orçamento")
GE = login("ana@fin"); m = menu(page("/financeiro/dre", GE)); assert "/financeiro/dre" in m and "/financeiro/cockpit" in m and "/equipe" in m, m
assert get("/api/financeiro/dre", GE).status_code == 200; h = page("/financeiro", GE); assert "Resultado no ano" in h
h = page("/financeiro/contas-a-pagar", GE); assert "Gerente Financeiro" in h
ok("gerente vê DRE, cockpit, resultado e Minha equipe; a regra de contas a pagar cita quem aprova pelo cargo (Gerente Financeiro)")

print("Descontos pela alçada do cargo")
h = page("/financeiro/descontos", BT); assert "até 5% aprova na hora" in h and "Gerente Financeiro (40%)" in h
aid_d = aid_of(h, 'name="percentual"')
okmsg(post("/financeiro/descontos", aid_d, {"alunoNome": "Aluno Fictício Um", "unitId": CAR, "tipo": "Irmãos", "percentual": "4", "motivo": "irmão matriculado"}, BT), "concedido")
okmsg(post("/financeiro/descontos", aid_d, {"alunoNome": "Aluno Fictício Dois", "unitId": CAR, "tipo": "Bolsa social", "percentual": "30", "motivo": "renda familiar"}, BT), "enviado para aprovação")
DID = psql("SELECT id FROM discounts WHERE aluno_nome='Aluno Fictício Dois'"); assert psql(f"SELECT count(*) FROM notifications WHERE user_id={UANA} AND titulo LIKE 'Desconto de 30%%'") == "1"
h = page("/financeiro/descontos", GE); aid_dec = aid_of(h[h.find("Aluno Fictício Dois"):], 'value="APROVADO"')
okmsg(post("/financeiro/descontos", aid_dec, {"id": DID, "decisao": "APROVADO"}, GE)); assert psql(f"SELECT status FROM discounts WHERE id={DID}") == "APROVADO"
ok("auxiliar concede até 5% na hora; 30% vai para quem tem alçada maior (a gerente é avisada e aprova)")

print("Liderança fora da área de pessoas: só a própria equipe")
LC = int(psql(f"INSERT INTO leave_requests (employee_id, tipo, inicio, fim, dias, status, solicitado_por) VALUES ({CAIO}, 'FOLGA_BANCO', '{d(20)}', '{d(20)}', 1, 'SOLICITADA', {UCAIO}) RETURNING id"))
LD = int(psql(f"INSERT INTO leave_requests (employee_id, tipo, inicio, fim, dias, status, solicitado_por) VALUES ({DORA}, 'FOLGA_BANCO', '{d(21)}', '{d(21)}', 1, 'SOLICITADA', {UDORA}) RETURNING id"))
h = page("/aprovacoes?aba=ferias", GE); assert "Caio Tesoureiro" in h and "Dora Professora" not in h
aid_l = aid_of(h, "Aprovar os")
okmsg(post("/aprovacoes?aba=ferias", aid_l, {"aba": "ferias", "ids": [LC], "voltar": "/aprovacoes?aba=ferias"}, GE)); assert psql(f"SELECT status FROM leave_requests WHERE id={LC}") == "APROVADA"
erro(post("/aprovacoes?aba=ferias", aid_l, {"aba": "ferias", "ids": [LD], "voltar": "/aprovacoes?aba=ferias"}, GE), "")
assert psql(f"SELECT status FROM leave_requests WHERE id={LD}") == "SOLICITADA"
h = page("/equipe", GE); assert "Beto Auxiliar" in h and "Caio Tesoureiro" in h and "Equipe direta de Ana Gerente Financeira" in h
h = page("/aprovacoes?aba=ferias", RH); assert "Dora Professora" in h
ok("gerente financeira (atuação financeiro) aprova a folga do tesoureiro da equipe dela; a da professora nem aparece e o lote recusa; Minha equipe mostra a equipe direta; o RH continua vendo a rede")

print("Troca de cargo na ficha muda o acesso na próxima tela")
psql(f"UPDATE employees SET position_id={P['Professor']} WHERE id={BETO}")
st, lc = loc_of("/financeiro/recebimentos", BT); assert st in (302, 303, 307) and lc != "/login", (st, lc)
assert psql(f"SELECT role||'|'||unit_id FROM users WHERE id={UBETO}") == f"COLABORADOR|{CAR}"; m = menu(page("/eu", BT)); assert "/financeiro/recebimentos" not in m and "/eu" in m
psql(f"UPDATE employees SET position_id={P['Auxiliar Administrativo']} WHERE id={BETO}"); page("/financeiro/recebimentos", BT)
assert psql(f"SELECT role FROM users WHERE id={UBETO}") == "FINANCEIRO"
ok("promovido/rebaixado na ficha: sem novo login, o financeiro some e volta na próxima tela (atuação gravada para as consultas)")

print("Exceção individual (com motivo) e volta ao cargo")
h = page(f"/configuracoes/acessos/usuario/{UDORA}?atuacao=GESTOR", RH); assert "Autoatendimento" in h; aid_ex = aid_of(h, "Registrar exceção")
TELAS_G = [re.search(r'value="([^"]+)"', x).group(1) for x in re.findall(r'<input[^>]*name="telas"[^>]*>', h)]; assert "/colaboradores" in TELAS_G
erro(post(f"/configuracoes/acessos/usuario/{UDORA}", aid_ex, {"id": UDORA, "atuacao": "GESTOR", "telas": TELAS_G, "seguePadrao": "1", "motivo": "curto"}, RH), "motivo")
okmsg(post(f"/configuracoes/acessos/usuario/{UDORA}", aid_ex, {"id": UDORA, "atuacao": "GESTOR", "telas": TELAS_G, "seguePadrao": "1", "motivo": "Coordena o 5º ano até a contratação"}, RH), "Exceção registrada")
assert psql(f"SELECT role||'|'||origem_acesso||'|'||unit_id FROM users WHERE id={UDORA}") == f"GESTOR|EXCECAO|{CAR}"
DR = login("dora@car"); m = menu(page("/colaboradores", DR)); assert "/colaboradores" in m
h = page("/configuracoes/acessos?aba=fora", RH); assert "Dora Professora" in h and "Coordena o 5º ano" in h
h = page(f"/configuracoes/acessos/usuario/{UDORA}", RH); aid_v = aid_of(h, "Voltar ao acesso do cargo"); okmsg(post(f"/configuracoes/acessos/usuario/{UDORA}", aid_v, {"id": UDORA}, RH), "volta a ser o do cargo")
assert psql(f"SELECT role||'|'||origem_acesso FROM users WHERE id={UDORA}") == "COLABORADOR|CARGO"; st, lc = loc_of("/colaboradores", DR); assert st in (302, 303, 307)
ok("exceção sem motivo recusada; com motivo a professora atua como coordenação (destacada em Fora do padrão); voltar ao cargo devolve o autoatendimento")

print("Substituição temporária")
h = page(f"/configuracoes/acessos/usuario/{UCAIO}", RH); aid_s = aid_of(h, "Registrar substituição")
erro(post(f"/configuracoes/acessos/usuario/{UCAIO}", aid_s, {"id": UCAIO, "positionId": P["Gerente Financeiro"], "ate": d(-1), "motivo": "férias da gerente"}, RH), "data de fim")
okmsg(post(f"/configuracoes/acessos/usuario/{UCAIO}", aid_s, {"id": UCAIO, "positionId": P["Gerente Financeiro"], "ate": d(5), "motivo": "férias da gerente"}, RH), "volta sozinho")
assert psql(f"SELECT array_to_string(aprova, ',')||'|'||desconto_pct::float FROM users WHERE id={UCAIO}") == "ferias,banco,financeiro,contasPagar,baixaManual|40"
CA = login("caio@fin"); h = page("/financeiro/dre", CA); assert "substituindo Gerente Financeiro" in h
psql(f"UPDATE users SET substituicao = jsonb_set(substituicao, '{{ate}}', to_jsonb('{d(-1)}'::text)) WHERE id={UCAIO}")
st, lc = loc_of("/financeiro/dre", CA); assert st in (302, 303, 307) and lc.startswith("/sem-acesso"), (st, lc)
assert psql(f"SELECT coalesce(array_to_string(aprova, ','), '')||'|'||desconto_pct::float FROM users WHERE id={UCAIO}") == "financeiro,baixaManual|30"
ok("substituição com data passada recusada; durante a substituição o tesoureiro tem DRE, aprovações e desconto da gerente; no dia seguinte ao fim volta sozinho ao cargo")

print("Desligamento encerra o login")
psql(f"UPDATE employees SET situacao='DESLIGADO', desligamento='{H}' WHERE id={CAIO}")
st, lc = loc_of("/eu", CA); assert st in (302, 303, 307) and "motivo=desligado" in lc, (st, lc)
assert psql(f"SELECT ativo FROM users WHERE id={UCAIO}") == "f"
s2 = mk(); hl = s2.get(B + "/login").text; aidl = re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', hl)[0]; lc = post("/login", aidl, {"email": "caio@fin", "senha": "senha12345"}, s2); assert "erro=" in lc, lc
assert psql(f"SELECT count(*) FROM audit_log WHERE acao='acesso encerrado: ficha desligada' AND entidade_id={UCAIO}") == "1"
erro(post("/configuracoes", aid_user, {"modo": "auto", "id": UCAIO, "employeeId": CAIO, "nome": "Caio Tesoureiro", "email": "caio@fin", "ativo": "1"}, RH), "desligado")
ok("ficha desligada: a sessão aberta cai, o login é recusado, o acesso fica inativo com trilha e não dá para reativar enquanto a ficha estiver desligada")

print("Conta sem ficha e formulário antigo (campo role)")
okmsg(post("/configuracoes", aid_user, {"modo": "auto", "employeeId": "0", "nome": "Contabilidade Externa", "email": "contab@ext", "senha": "senha12345", "atuacao": "FINANCEIRO", "unitId": ""}, RH))
UCT = int(psql("SELECT id FROM users WHERE email='contab@ext'")); assert psql(f"SELECT role||'|'||origem_acesso FROM users WHERE id={UCT}") == "FINANCEIRO|DIRETO"
h = page(f"/configuracoes/acessos/usuario/{UCT}", RH); aid_ct = aid_of(h, "Salvar o acesso da conta")
okmsg(post(f"/configuracoes/acessos/usuario/{UCT}", aid_ct, {"id": UCT, "telas": ["/financeiro/dre", "/financeiro/obrigacoes", "/folha/custo"], "motivo": "contabilidade externa — consulta"}, RH))
CT = login("contab@ext"); m = menu(page("/financeiro/dre", CT)); assert "/financeiro/dre" in m and "/financeiro/recebimentos" not in m and "/financeiro/contas-a-pagar" not in m
assert psql(f"SELECT coalesce(array_to_string(aprova, ','), '') FROM users WHERE id={UCT}") == ""
# compatibilidade: scripts e formulário antigo mandam "role" — diferente do cargo vira exceção registrada
post("/configuracoes", aid_user, {"nome": "Sara Secretária", "email": "sara@car", "role": "GESTOR", "unitId": CAR, "employeeId": SECR, "senha": "senha12345"}, RH)
assert psql("SELECT role||'|'||origem_acesso FROM users WHERE email='sara@car'") == "GESTOR|EXCECAO" and "Definido no cadastro do acesso" in psql("SELECT acesso->>'motivo' FROM users WHERE email='sara@car'")
post("/configuracoes", aid_user, {"nome": "Leitura Antiga", "email": "leit@antigo", "role": "LEITURA", "unitId": "", "employeeId": "", "senha": "senha12345"}, RH)
assert psql("SELECT role||'|'||origem_acesso FROM users WHERE email='leit@antigo'") == "LEITURA|DIRETO"
ok("conta sem ficha (contabilidade) com atuação na conta e só 3 telas, sem aprovações; formulário antigo: perfil diferente do cargo vira exceção com motivo; sem ficha vira conta direta")

print("Trava: ninguém tranca o sistema")
h = page("/configuracoes/acessos/usuario/" + psql("SELECT id FROM users WHERE email='rh@colegiostatus'"), RH); aid_rh = aid_of(h, "Salvar o acesso da conta")
erro(post("/configuracoes/acessos/usuario/" + psql("SELECT id FROM users WHERE email='rh@colegiostatus'"), aid_rh, {"id": psql("SELECT id FROM users WHERE email='rh@colegiostatus'"), "telas": ["/colaboradores", "/ferias"]}, RH), "ninguém ativo conseguiria configurar")
ok("tirar Configurações e Acesso por cargo do último acesso que configura é recusado")

print("Comunicado por cargo e etapa de aprovação por cargo")
h = page("/comunicacao/comunicados", RH); aid_c = aid_of(h, "Publicar")
okmsg(post("/comunicacao/comunicados", aid_c, {"titulo": "Reunião dos professores", "texto": "Sexta, 17h, sala dos professores.", "publico": "CARGO", "positionId": P["Professor"], "requerCiencia": "1"}, RH))
assert psql(f"SELECT count(*) FROM notifications n WHERE n.titulo='Comunicado: Reunião dos professores' AND n.user_id={UDORA}") == "1" and psql(f"SELECT count(*) FROM notifications WHERE titulo='Comunicado: Reunião dos professores' AND user_id={UBETO}") == "0"
assert "Reunião dos professores" in page("/comunicacao/comunicados", DR) and "Reunião dos professores" not in page("/comunicacao/comunicados", BT) and "cargo Professor" in page("/comunicacao/comunicados", RH)
erro(post("/comunicacao/comunicados", aid_c, {"titulo": "Sem cargo", "texto": "x", "publico": "CARGO"}, RH), "Escolha o cargo")
h = page("/solicitacoes/tipos", RH); aid_t = aid_of(h, "Código (opcional)")
lc = post("/solicitacoes/tipos", aid_t, {"nome": "Compra de material de escritório", "descricao": "pedido simples", "campos": "Item | texto | sim\nValor | valor (R$) | sim", "etapas": "Gerência | cargo Gerente Financeiro\nDireção | Direção | acima de 2000", "prazoDias": "3"}, RH)
assert "erro=" not in lc, lc; assert "cargo Gerente Financeiro" in page("/solicitacoes/tipos", RH)
assert psql("SELECT etapas->0->'cargos'->>0 FROM request_types WHERE nome='Compra de material de escritório'") == str(P["Gerente Financeiro"])
erro(post("/solicitacoes/tipos", aid_t, {"nome": "Tipo errado", "campos": "Item | texto | sim", "etapas": "Gerência | cargo Inexistente", "prazoDias": "3"}, RH), "não encontrado")
ok("comunicado para o cargo Professor chega só aos professores (exige escolher o cargo); etapa de aprovação “cargo Gerente Financeiro” gravada pelo cargo; cargo inexistente recusado")

print("Matriz de acesso, “o que a pessoa vê”, rotina e trilha")
h = page("/configuracoes/acessos", RH); assert "Auxiliar Administrativo" in h and "Gerente Financeiro" in h and "Fichas sem acesso" in h
h = page("/configuracoes/acessos?aba=telas&grupo=Financeiro", RH); h = h[h.find("<main"):]; row = h[h.find("DRE gerencial"):h.find("</tr>", h.find("DRE gerencial"))]; assert "Gerente Financeiro" in row and "Auxiliar Administrativo" not in row
row = h[h.find("Recebimentos do mês"):h.find("</tr>", h.find("Recebimentos do mês"))]; assert "Auxiliar Administrativo" in row
h = page("/configuracoes/acessos?aba=aprovacoes", RH); aid_m = aid_of(h, "Salvar aprovações dos cargos")
dados = {f"c_{P['Secretária']}": "1", f"a_{P['Secretária']}_matricula": "1", f"a_{P['Secretária']}_excecaoCapacidade": "1", f"p_{P['Secretária']}": "15"}
okmsg(post("/configuracoes/acessos?aba=aprovacoes", aid_m, dados, RH), "1 cargo")
assert psql(f"SELECT (acesso->'aprova')::text||'|'||(acesso->>'descontoPct') FROM positions WHERE id={P['Secretária']}") == '["matricula", "excecaoCapacidade"]|15'
h = page(f"/configuracoes/acessos/usuario/{UANA}", RH); assert "Menu desta pessoa" in h and "DRE gerencial" in h and "Aprova conta a pagar" in h and "descontos até" in h
assert page(f"/colaboradores/{ANA}", RH).count("ver acesso") == 1
r = requests.get(B + f"/api/tarefas?token={TOKEN}"); assert r.status_code == 200 and "acessos" in r.json(), r.text[:300]
assert int(psql("SELECT count(*) FROM audit_log WHERE acao IN ('acesso do cargo','acesso do cargo (cópia)','exceção de acesso','acesso volta ao cargo','substituição de acesso','aprovações do cargo','acesso da conta sem ficha')")) >= 7
ok("matriz por cargo (quem vê cada tela, quem aprova o quê com alçada de desconto), “o que a pessoa vê” com aprovações, link na ficha, rotina diária recalcula e toda mudança fica na trilha")

print(f"\nOK — {N[0]} blocos verificados (v29 · acesso pelo cargo)")
