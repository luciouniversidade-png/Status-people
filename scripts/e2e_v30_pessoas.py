# E2E — v30 · Ficha completa e estrutura: sexo (eSocial), ramal e e-mail institucional; histórico funcional (automático na edição da
# ficha, com data de vigência e promoção; lançamento manual de fato passado; exclusão só com motivo; admissão do sistema protegida);
# formação e qualificações (o colaborador propõe, o RH valida ou recusa com motivo; titulação docente); itens sob responsabilidade
# (Operações entrega sem ver a ficha; patrimônio não vai para duas pessoas; ciência do termo; extravio exige explicação; o
# desligamento só conclui com tudo devolvido e registra o desligamento no histórico); organograma de pessoas e “quem é quem” para
# todos (ficha só para quem pode); ficha de outra pessoa fechada para Comercial, Financeiro e Operações (abre a própria e a de quem
# responde a elas); igualdade salarial (Lei 14.611: grupo mínimo, diferença no mesmo cargo, relatório semestral do CNPJ com 100+
# empregados, plano de ação obrigatório quando há diferença, pendência do RH); composição da equipe (ponte do quadro, quadro numa
# data, titulação docente). Dados fictícios. Uso: bash /tmp/withserver.sh python3 scripts/e2e_v30_pessoas.py
import re, subprocess, requests
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
def post(path, aid, data, sess):
    f = [(f"$ACTION_ID_{aid}", (None, ""))]
    for k, v in data.items():
        for x in (v if isinstance(v, list) else [v]): f.append((k, (None, str(x))))
    r = sess.post(B + path, files=f, allow_redirects=False); fix_cookie(sess, r)
    assert r.status_code in (303, 302, 200), (path, r.status_code, r.text[:300]); return unq(r.headers.get("location", "")).replace("\xa0", " ")
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
def q(v): return "NULL" if v is None else str(v) if isinstance(v, (int, float)) else "'" + str(v).replace("'", "''") + "'"
HOJE = datetime.now(ZoneInfo("America/Campo_Grande")).date(); H = HOJE.isoformat()
def d(n): return (HOJE + timedelta(days=n)).isoformat()

print("Preparação")
RH = login("rh@colegiostatus", "Status2026!"); r = RH.get(B + f"/api/setup?token={TOKEN}"); assert r.json()["ok"], r.text
assert psql("SELECT value->>'versao' FROM settings WHERE key='banco'") == "30.0"
for t in ["employee_moves", "employee_qualifications", "employee_items", "pay_transparency_reports", "benefit_plans", "custom_reports", "interview_feedback", "training_enrollments"]: assert psql(f"SELECT to_regclass('{t}') IS NOT NULL") == "t", t
U = {c: int(psql(f"SELECT id FROM units WHERE codigo='{c}'")) for c in ["CAR", "CUL", "TVM1"]}; CAR, CUL, TVM1 = U["CAR"], U["CUL"], U["TVM1"]
P = {n: int(psql(f"SELECT id FROM positions WHERE nome='{n}'")) for n in ["Professor", "Coordenador Pedagógico", "Auxiliar Administrativo", "Gerente Financeiro", "Analista de Atendimento", "Técnico de Manutenção", "Diretor Geral (Sócio)", "Tesoureiro"]}
C1 = int(psql("SELECT id FROM companies ORDER BY id LIMIT 1"))
def emp(nome, cargo, unit, gestor=None, sexo=None, salario=None, admissao="2022-02-01", regime="ADMINISTRATIVO", company=None, vinculo="CLT", jornada=480):
    return int(psql(f"INSERT INTO employees (nome, unit_id, position_id, vinculo, admissao, gestor_id, situacao, sexo, salario, regime, company_id, jornada_min_dia) VALUES ({q(nome)}, {unit}, {P[cargo]}, {q(vinculo)}, '{admissao}', {q(gestor)}, 'ATIVO', {q(sexo)}, {q(salario)}, '{regime}', {q(company)}, {jornada}) RETURNING id"))
DIRG = emp("Diretor Geral Fictício", "Diretor Geral (Sócio)", CAR, None, "M", 15000)
COORD = emp("Coordenadora Fictícia", "Coordenador Pedagógico", CAR, DIRG, "F", 6200)
PROF = emp("Professora Fictícia", "Professor", CAR, COORD, "F", 4200, regime="DOCENTE")
PROF2 = emp("Professor Fictício", "Professor", CAR, COORD, "M", 4000, regime="DOCENTE")
GER = emp("Gerente Financeira Fictícia", "Gerente Financeiro", CAR, DIRG, "F", 7000)
AUX = emp("Tesoureiro Fictício", "Tesoureiro", CAR, GER, "M", 2400)
ATD = emp("Atendente Fictícia", "Analista de Atendimento", CUL, DIRG, "F", 2800)
TEC = emp("Técnico Fictício", "Técnico de Manutenção", CAR, DIRG, "M", 3100)
psql("SELECT 1"); from_html = page("/configuracoes", RH); aid_user = aid_of(from_html, "Criar acesso")
def acesso(eid, email):
    okmsg(post("/configuracoes", aid_user, {"modo": "auto", "employeeId": eid, "nome": "", "email": email, "senha": "senha12345", "atuacao": "LEITURA", "unitId": ""}, RH)); return int(psql(f"SELECT id FROM users WHERE email='{email}'"))
for eid, em in [(COORD, "coord@car"), (PROF, "prof@car"), (PROF2, "prof2@car"), (GER, "ger@fin"), (AUX, "aux@fin"), (ATD, "atd@cul"), (TEC, "tec@ops")]: acesso(eid, em)
assert psql("SELECT string_agg(email||':'||role, ',' ORDER BY email) FROM users WHERE email LIKE '%@car' OR email LIKE '%@fin' OR email LIKE '%@cul' OR email LIKE '%@ops'") == "atd@cul:COMERCIAL,aux@fin:FINANCEIRO,coord@car:GESTOR,ger@fin:FINANCEIRO,prof2@car:COLABORADOR,prof@car:COLABORADOR,tec@ops:OPERACOES"
CO, PR, PR2, GE, AX, AT, TC = [login(e) for e in ["coord@car", "prof@car", "prof2@car", "ger@fin", "aux@fin", "atd@cul", "tec@ops"]]
ok("base nova na v30 (esquema 30.0, tabelas novas); fichas fictícias e acessos pelo cargo: coordenação (GESTOR), professores, financeiro, atendimento e manutenção (OPERACOES)")

print("Ficha: campos novos, admissão no histórico e movimentação na edição")
h = page("/colaboradores/novo", RH); aid_novo = aid_of(h, 'name="emailInstitucional"')
loc = post("/colaboradores/novo", aid_novo, {"nome": "Nova Secretária Fictícia", "admissao": d(-200), "unitId": CAR, "positionId": P["Auxiliar Administrativo"], "vinculo": "CLT", "regime": "ADMINISTRATIVO", "gestorId": DIRG, "sexo": "F", "ramal": "2104", "emailInstitucional": "secretaria.car@colegiostatus.exemplo", "noDiretorio": "1", "jornadaMinDia": "480", "companyId": C1}, RH)
NOVA = int(re.search(r"/colaboradores/(\d+)", loc).group(1))
assert psql(f"SELECT sexo||'|'||ramal||'|'||email_institucional||'|'||no_diretorio FROM employees WHERE id={NOVA}") == "F|2104|secretaria.car@colegiostatus.exemplo|true"
assert psql(f"SELECT tipo||'|'||data||'|'||origem FROM employee_moves WHERE employee_id={NOVA}") == f"ADMISSAO|{d(-200)}|FICHA"
h = page(f"/colaboradores/{NOVA}", RH); assert "Histórico funcional (1)" in h and "Admissão" in h and "Auxiliar Administrativo · Carandá" in h and "Ramal" in h and "2104" in h and "Sexo (eSocial)" in h
# edição: mudou cargo e unidade com data de vigência e promoção
h = page(f"/colaboradores/{NOVA}/editar", RH); aid_ed = aid_of(h, 'name="movData"')
base_form = {"id": NOVA, "nome": "Nova Secretária Fictícia", "admissao": d(-200), "unitId": CAR, "positionId": P["Auxiliar Administrativo"], "vinculo": "CLT", "regime": "ADMINISTRATIVO", "gestorId": DIRG, "sexo": "F", "ramal": "2104", "emailInstitucional": "secretaria.car@colegiostatus.exemplo", "noDiretorio": "1", "jornadaMinDia": "480", "companyId": C1}
loc = post(f"/colaboradores/{NOVA}/editar", aid_ed, {**base_form, "unitId": CUL, "movData": d(-300)}, RH); assert "anterior à admissão" in loc, loc
assert psql(f"SELECT unit_id FROM employees WHERE id={NOVA}") == str(CAR)
loc = post(f"/colaboradores/{NOVA}/editar", aid_ed, {**base_form, "positionId": P["Analista de Atendimento"], "unitId": CUL, "movData": d(-30), "movMotivo": "Mérito e desempenho", "movPromocao": "1"}, RH); assert "ok=" in loc, loc
mv = psql(f"SELECT tipo||'|'||data||'|'||(de->>'positionId')||'|'||(para->>'positionId')||'|'||(de->>'unitId')||'|'||(para->>'unitId')||'|'||coalesce(motivo,'') FROM employee_moves WHERE employee_id={NOVA} AND tipo <> 'ADMISSAO'")
assert mv == f"PROMOCAO|{d(-30)}|{P['Auxiliar Administrativo']}|{P['Analista de Atendimento']}|{CAR}|{CUL}|Mérito e desempenho", mv
loc = post(f"/colaboradores/{NOVA}/editar", aid_ed, {**base_form, "positionId": P["Analista de Atendimento"], "unitId": CUL, "gestorId": GER, "movData": d(-5)}, RH)
assert psql(f"SELECT tipo FROM employee_moves WHERE employee_id={NOVA} ORDER BY id DESC LIMIT 1") == "MUDANCA_GESTOR"
loc = post(f"/colaboradores/{NOVA}/editar", aid_ed, {**base_form, "positionId": P["Analista de Atendimento"], "unitId": CUL, "gestorId": GER, "movData": d(-5), "ramal": "3001"}, RH)
assert psql(f"SELECT count(*) FROM employee_moves WHERE employee_id={NOVA}") == "3"  # ramal não é movimentação
h = page(f"/colaboradores/{NOVA}", RH); assert "Promoção" in h and "Cargo: Auxiliar Administrativo → Analista de Atendimento" in h and "Unidade: Carandá → Cultura" in h and "Mudança de gestor" in h
# admissão gravada como retrato da ficha de hoje (como na atualização v30): a tela mostra o estado de antes da promoção
psql(f"UPDATE employee_moves SET origem='SISTEMA', para = para || jsonb_build_object('positionId', {P['Analista de Atendimento']}, 'cargo', 'Analista de Atendimento', 'unitId', {CUL}, 'unidade', 'Cultura') WHERE employee_id={NOVA} AND tipo='ADMISSAO'")
h = page(f"/colaboradores/{NOVA}", RH); assert "Auxiliar Administrativo · Carandá" in h
ok("cadastro com sexo, ramal e e-mail institucional; a admissão abre o histórico; a edição registra a movimentação na data de vigência (promoção marcada, cargo + unidade num evento; gestor em outro); data antes da admissão recusada; ramal não é movimentação; a ficha mostra os nomes de → para")

print("Histórico: lançamento manual e exclusão")
h = page(f"/colaboradores/{NOVA}", RH); aid_man = aid_of(h, "Para fatos de antes do sistema")
erro(post(f"/colaboradores/{NOVA}", aid_man, {"employeeId": NOVA, "tipo": "MUDANCA_JORNADA", "data": d(5), "descricao": "6 h → 8 h"}, RH), "Movimentação futura")
erro(post(f"/colaboradores/{NOVA}", aid_man, {"employeeId": NOVA, "tipo": "MUDANCA_JORNADA", "data": d(-400), "descricao": "6 h → 8 h"}, RH), "anterior à admissão")
erro(post(f"/colaboradores/{NOVA}", aid_man, {"employeeId": NOVA, "tipo": "ADMISSAO", "data": d(-100), "descricao": "Admissão"}, RH), "Escolha o tipo")
erro(post(f"/colaboradores/{NOVA}", aid_man, {"employeeId": NOVA, "tipo": "MUDANCA_JORNADA", "data": d(-100), "descricao": "x"}, RH), "Descreva")
okmsg(post(f"/colaboradores/{NOVA}", aid_man, {"employeeId": NOVA, "tipo": "MUDANCA_JORNADA", "data": d(-100), "descricao": "Jornada de 6 h para 8 h", "motivo": "Reestruturação"}, RH), "histórico funcional")
MAN = int(psql(f"SELECT id FROM employee_moves WHERE employee_id={NOVA} AND origem='MANUAL'"))
h = page(f"/colaboradores/{NOVA}", RH); aid_ex = aid_of(h, "Por que sai do histórico?")
ADM = int(psql(f"SELECT id FROM employee_moves WHERE employee_id={NOVA} AND tipo='ADMISSAO'"))
erro(post(f"/colaboradores/{NOVA}", aid_ex, {"id": ADM, "employeeId": NOVA, "motivo": "teste de exclusão"}, RH), "acompanham a ficha")
erro(post(f"/colaboradores/{NOVA}", aid_ex, {"id": MAN, "employeeId": NOVA, "motivo": "x"}, RH), "por que")
okmsg(post(f"/colaboradores/{NOVA}", aid_ex, {"id": MAN, "employeeId": NOVA, "motivo": "Lançado na pessoa errada"}, RH))
assert psql(f"SELECT count(*) FROM employee_moves WHERE id={MAN}") == "0" and psql(f"SELECT count(*) FROM audit_log WHERE acao='excluir movimentação' AND entidade_id={MAN}") == "1"
erro(post(f"/colaboradores/{NOVA}", aid_man, {"employeeId": NOVA, "tipo": "MUDANCA_JORNADA", "data": d(-100), "descricao": "Jornada de 6 h para 8 h"}, CO), "Só RH e Direção")
ok("fato passado: data futura, antes da admissão, tipo do sistema e descrição curta recusados; admissão do sistema não sai; exclusão só com motivo e auditada; coordenação não lança")

print("Formação: o colaborador propõe, o RH valida")
h = page("/eu", PR); aid_q = aid_of(h, 'name="curso"')
okmsg(post("/eu", aid_q, {"employeeId": PROF, "voltar": "/eu#formacao", "tipo": "LICENCIATURA", "curso": "Pedagogia", "instituicao": "Universidade Fictícia", "conclusao": "2015-12-10"}, PR), "o RH valida")
okmsg(post("/eu", aid_q, {"employeeId": PROF, "voltar": "/eu#formacao", "tipo": "ESPECIALIZACAO", "curso": "Psicopedagogia", "instituicao": "Faculdade Fictícia", "conclusao": "2019-07-01", "cargaHoras": "360"}, PR))
erro(post("/eu", aid_q, {"employeeId": PROF2, "voltar": "/eu#formacao", "tipo": "MESTRADO", "curso": "Mestrado alheio", "conclusao": "2019-07-01"}, PR), "")
assert psql(f"SELECT count(*) FROM employee_qualifications WHERE employee_id={PROF2}") == "0"
assert psql(f"SELECT string_agg(status, ',') FROM employee_qualifications WHERE employee_id={PROF}") == "PENDENTE,PENDENTE"
assert "Validar" in page("/pendencias", RH) and "aguardando validação" in page("/analytics/composicao", RH)
QL, QE = [int(x) for x in psql(f"SELECT id FROM employee_qualifications WHERE employee_id={PROF} ORDER BY id").split("\n")]
h = page(f"/colaboradores/{PROF}", RH); aid_v = aid_of(h, 'name="decisao" value="VALIDADA"')
erro(post(f"/colaboradores/{PROF}", aid_v, {"id": QE, "employeeId": PROF, "decisao": "RECUSADA", "motivo": ""}, RH), "motivo")
okmsg(post(f"/colaboradores/{PROF}", aid_v, {"id": QL, "employeeId": PROF, "decisao": "VALIDADA"}, RH))
okmsg(post(f"/colaboradores/{PROF}", aid_v, {"id": QE, "employeeId": PROF, "decisao": "RECUSADA", "motivo": "Falta o certificado digitalizado"}, RH))
erro(post(f"/colaboradores/{PROF}", aid_v, {"id": QE, "employeeId": PROF, "decisao": "VALIDADA"}, RH), "já decidida")
erro(post(f"/colaboradores/{PROF}", aid_v, {"id": QL, "employeeId": PROF, "decisao": "VALIDADA"}, CO), "Só RH e Direção")
h = page("/eu", PR); assert "Minha formação · Licenciatura" in h and "Falta o certificado digitalizado" in h
# RH registra já validada (sem passar pela fila)
h = page(f"/colaboradores/{PROF2}", RH); okmsg(post(f"/colaboradores/{PROF2}", aid_of(h, 'name="curso"'), {"employeeId": PROF2, "voltar": f"/colaboradores/{PROF2}#formacao", "tipo": "BACHARELADO", "curso": "Engenharia", "conclusao": "2010-12-10"}, RH))
assert psql(f"SELECT status FROM employee_qualifications WHERE employee_id={PROF2}") == "VALIDADA"
hc = page("/analytics/composicao", RH); assert "Titulação do corpo docente — 2 professor(es)" in hc and "Com licenciatura" in hc
ok("o colaborador propõe a formação (aguardando o RH, pendência “Validar”), não lança para outra pessoa; RH valida ou recusa com motivo (uma vez só; coordenação não valida); o colaborador vê a titulação e o motivo; lançada pelo RH já entra validada; titulação docente na composição")

print("Itens sob responsabilidade (Operações sem ver a ficha) e o desligamento")
AST = int(psql(f"INSERT INTO assets (unit_id, codigo, nome, categoria, status) VALUES ({CAR}, 'CAR-NB-01', 'Notebook fictício', 'TI', 'EM_USO') RETURNING id"))
h = page("/operacoes/itens", TC); assert "Itens com colaboradores" in h and "Sem acesso aos dados pessoais" in h and f'href="/colaboradores/{PROF}' not in h
aid_ent = aid_of(h, "Registrar entrega</button>")
okmsg(post("/operacoes/itens", aid_ent, {"voltar": "/operacoes/itens", "employeeId": PROF, "tipo": "NOTEBOOK", "entregueEm": d(-3), "descricao": "Notebook da sala de informática", "identificacao": "SN-1", "valor": "3500", "assetId": AST, "devolverAte": d(-1), "obs": ""}, TC), "Item registrado")
erro(post("/operacoes/itens", aid_ent, {"voltar": "/operacoes/itens", "employeeId": PROF2, "tipo": "NOTEBOOK", "entregueEm": d(-1), "descricao": "Outro", "assetId": AST}, TC), "já está com Professora Fictícia")
okmsg(post("/operacoes/itens", aid_ent, {"voltar": "/operacoes/itens", "employeeId": PROF2, "tipo": "CHAVE", "entregueEm": d(-1), "descricao": "Chave da sala 3"}, TC))
erro(post("/operacoes/itens", aid_ent, {"voltar": "/operacoes/itens", "employeeId": PROF2, "tipo": "FOGUETE", "descricao": "?"}, TC), "tipo")
erro(post("/operacoes/itens", aid_ent, {"voltar": "/operacoes/itens", "employeeId": PROF2, "tipo": "CHAVE", "descricao": "Chave"}, AX), "Sem permissão")
assert get("/operacoes/itens", PR).status_code == 307 and get("/operacoes/itens", AT).status_code == 307
h = page("/operacoes/itens", TC); assert "Devolução atrasada" in h and ">1<" in h.split("Devolução atrasada")[1][:200]
assert "Dar ciência" in page("/pendencias", PR); h = page("/eu", PR); aid_ci = aid_of(h, "Dar ciência</button>")
IT = int(psql(f"SELECT id FROM employee_items WHERE employee_id={PROF}"))
erro(post("/eu", aid_ci, {"id": int(psql(f"SELECT id FROM employee_items WHERE employee_id={PROF2}"))}, PR), "não encontrado")
okmsg(post("/eu", aid_ci, {"id": IT}, PR), "Ciência registrada"); assert psql(f"SELECT ciencia_em IS NOT NULL FROM employee_items WHERE id={IT}") == "t"
# desligamento de PROF: travado pelo item
h = page(f"/colaboradores/{PROF}", RH); loc = post(f"/colaboradores/{PROF}", aid_of(h, 'name="desligamento"'), {"id": PROF, "desligamento": d(0), "motivo": "Pedido da colaboradora"}, RH)
PID = int(re.search(r"/processos/(\d+)", loc).group(1)); psql(f"UPDATE process_items SET concluido=true, concluido_em=now() WHERE process_id={PID}")
hp = page(f"/processos/{PID}", RH); assert "Itens a devolver" in hp and "Notebook da sala de informática" in hp; aid_conc = aid_of(hp, "Concluir desligamento")
erro(post(f"/processos/{PID}", aid_conc, {"processId": PID}, RH), "item(ns) com o colaborador")
h = page("/operacoes/itens", TC); aid_dev = aid_of(h, 'name="condicao"')
erro(post("/operacoes/itens", aid_dev, {"id": IT, "employeeId": PROF, "voltar": "/operacoes/itens", "status": "EXTRAVIADO", "data": d(0), "obs": ""}, TC), "Explique")
okmsg(post("/operacoes/itens", aid_dev, {"id": IT, "employeeId": PROF, "voltar": "/operacoes/itens", "status": "DEVOLVIDO", "data": d(0), "condicao": "Em bom estado"}, TC), "Devolução registrada")
erro(post("/operacoes/itens", aid_dev, {"id": IT, "employeeId": PROF, "voltar": "/operacoes/itens", "status": "DEVOLVIDO", "data": d(0)}, TC), "já devolvido")
assert psql(f"SELECT status||'|'||recebido_por FROM employee_items WHERE id={IT}") == "DEVOLVIDO|" + psql("SELECT id FROM users WHERE email='tec@ops'")
okmsg(post(f"/processos/{PID}", aid_conc, {"processId": PID}, RH))
assert psql(f"SELECT situacao FROM employees WHERE id={PROF}") == "DESLIGADO" and psql(f"SELECT count(*) FROM employee_moves WHERE employee_id={PROF} AND tipo='DESLIGAMENTO'") == "1"
ok("Operações entrega (patrimônio não vai para duas pessoas; tipo inválido e financeiro recusados), sem link para a ficha; atraso de devolução sinalizado; a pessoa dá ciência pelo Meu espaço (só do próprio item; pendência “Dar ciência”); o desligamento trava com item pendente, o extravio exige explicação, a devolução libera e o histórico registra o desligamento")

print("Organograma, quem é quem e acesso à ficha")
h = page("/organograma", PR2); assert "Pessoas — quem responde a quem" in h and "Cargos e ocupação" not in h and "Coordenadora Fictícia" in h
h = page(f"/organograma?p={COORD}", PR2); assert "Quem é quem" in h and "Abrir ficha" not in h.split("Quem é quem")[1][:3000]
h = page(f"/organograma?p={PROF2}", PR2); assert "Abrir ficha" in h
h = page("/organograma?ver=cargos", CO); assert "Cargos e ocupação" in h
psql(f"UPDATE employees SET ramal='4410', no_diretorio=false WHERE id={TEC}"); h = page(f"/organograma?p={TEC}", PR2); assert "Contato fora do quem é quem" in h and "4410" not in h; assert "4410" in page(f"/organograma?p={TEC}", CO)
assert get(f"/colaboradores/{COORD}", AT).status_code == 404 and get(f"/colaboradores/{COORD}", AX).status_code == 404 and get(f"/colaboradores/{COORD}", TC).status_code == 404 and get(f"/colaboradores/{COORD}", PR2).status_code == 404
assert get(f"/colaboradores/{AUX}", GE).status_code == 200 and get(f"/colaboradores/{GER}", GE).status_code == 200 and get(f"/colaboradores/{GER}", AX).status_code == 404 and get(f"/colaboradores/{ATD}", AT).status_code == 200
assert get(f"/colaboradores/{PROF2}", CO).status_code == 200
ok("organograma de pessoas para todos (aba de cargos só para a gestão); “quem é quem” abre a ficha só de quem pode; quem pediu para ficar fora do diretório tem o contato oculto (a gestão vê); Comercial, Financeiro, Operações e professores não abrem a ficha de outra pessoa (a própria e a da equipe direta, sim)")

print("Igualdade salarial e relatório de transparência")
assert get("/analytics/igualdade", CO).status_code == 307 and get("/analytics/igualdade", PR2).status_code in (307, 404)
for i in range(4): emp(f"Professora Extra {i} (fictícia)", "Professor", CAR, COORD, "F", 4300 + i * 10, regime="DOCENTE")
for i in range(2): emp(f"Professor Extra {i} (fictício)", "Professor", CAR, COORD, "M", 4100 + i * 10, regime="DOCENTE")
h = page("/analytics/igualdade", RH); assert "1 grupo(s) comparável(is)" in h and "Professor" in h and "grupo(s) pequeno(s)" in h and "valor da hora contratada" in h
psql(f"INSERT INTO employees (nome, unit_id, position_id, vinculo, admissao, situacao, sexo, salario, company_id, jornada_min_dia) SELECT 'Equipe fictícia '||g, {CUL}, {P['Professor']}, 'CLT', '2023-01-02', 'ATIVO', CASE WHEN g % 3 = 0 THEN 'M' ELSE 'F' END, 3000, {C1}, 480 FROM generate_series(1, 100) g")
assert "Publicar e registrar" in page("/pendencias", RH)
h = page("/analytics/igualdade", RH); aid_t = aid_of(h, 'name="semestre"')
erro(post("/analytics/igualdade", aid_t, {"companyId": C1, "ano": HOJE.year, "semestre": 1, "publicadoEm": "2026-03-20", "onde": ""}, RH), "onde o relatório foi publicado")
erro(post("/analytics/igualdade", aid_t, {"companyId": C1, "ano": HOJE.year, "semestre": 1, "publicadoEm": "2026-03-20", "onde": "Site", "link": "javascript:alert(1)"}, RH), "http")
erro(post("/analytics/igualdade", aid_t, {"companyId": C1, "ano": HOJE.year, "semestre": 1, "publicadoEm": "2026-03-20", "onde": "Site", "diferencaPct": "4,5", "planoAcao": ""}, RH), "plano de ação")
for sem in (1, 2): okmsg(post("/analytics/igualdade", aid_t, {"companyId": C1, "ano": HOJE.year, "semestre": sem, "publicadoEm": f"{HOJE.year}-0{3 if sem == 1 else 9}-20", "onde": "Site e mural", "link": "https://exemplo.com/transparencia", "diferencaPct": "4.5", "planoAcao": "Revisão das faixas", "planoPrazo": d(60)}, RH), "Relatório registrado")
assert psql(f"SELECT count(*), min(empregados) >= 100 FROM pay_transparency_reports WHERE company_id={C1}") == "2|t" and "Publicar e registrar" not in page("/pendencias", RH)
erro(post("/analytics/igualdade", aid_t, {"companyId": C1, "ano": HOJE.year, "semestre": 1, "publicadoEm": "2026-03-20", "onde": "Site"}, CO), "Só RH e Direção")
ok("igualdade só para quem vê salário; comparação no mesmo cargo pelo valor da hora com grupo mínimo (pequenos à parte); 100+ empregados no CNPJ abre a pendência do relatório semestral; publicação exige onde, link http(s) e plano de ação quando há diferença; registrado, a pendência some; coordenação não registra")

print("Composição da equipe")
assert get("/analytics/composicao", CO).status_code == 307
h = page("/analytics/composicao", RH); assert "Ponte do quadro" in h and "Promoção" in h and "Mulheres na liderança" in h and "Amplitude média de controle" in h
h = page(f"/analytics/composicao?em={d(-250)}", RH); assert "Quadro em" in h or "quadro em" in h.lower()
ok("composição da equipe para RH/Direção (coordenação não): ponte do quadro, movimentações (promoção), mulheres na liderança, amplitude e o quadro numa data")
print("Importação: sexo, ramal, e-mail institucional e quem é quem (cria e completa)")
h = page("/colaboradores/importar", RH); aid_imp = aid_of(h, 'name="csv"')
csv = ("Nome;Unidade;Admissão;Cargo;Sexo (eSocial);Ramal / telefone interno;E-mail institucional;No quem é quem\n"
       "Importada Vinte e Nove Fictícia;CAR;01/02/2026;Auxiliar Administrativo;Feminino;4501;Importada.V30@colegiostatus.exemplo;sim\n"
       "Nova Secretária Fictícia;CUL;;;F;4502;;não\n"
       "Sexo Errado Fictício;CAR;01/02/2026;;X;;;\n")
loc = post("/colaboradores/importar", aid_imp, {"csv": csv}, RH)
assert "1 colaborador(es) importado(s)" in loc and "1 ficha(s) existente(s) completada(s)" in loc and 'sexo "X" inválido' in loc, loc
assert psql("SELECT sexo||'|'||ramal||'|'||email_institucional||'|'||no_diretorio FROM employees WHERE nome='Importada Vinte e Nove Fictícia'") == "F|4501|importada.v30@colegiostatus.exemplo|true"
assert psql(f"SELECT sexo||'|'||ramal||'|'||no_diretorio||'|'||unit_id||'|'||admissao FROM employees WHERE id={NOVA}") == f"F|4502|false|{CUL}|{d(-200)}"  # só os campos da v30 mudaram
ok("importação com sexo, ramal, e-mail institucional e quem é quem: cria a ficha nova e completa a existente (só esses campos); sexo inválido recusado")
print(f"OK — {N[0]} blocos verificados")
