# E2E — Rotina diária e Command Center dos módulos v22: rematrícula (expira, aberto sem concluir, vencendo sem abrir), substituição
# (aulas sem professor hoje/amanhã, coberturas a confirmar), portaria (anonimização de visitantes, brigada, simulado, evento esquecido
# aberto), contratos (aviso prévio, marcos de vencimento, vencido, reajuste), licenças (vence/vencida), privacidade (pedidos e incidentes,
# sem dados pessoais), ética (só comitê, sem conteúdo), solicitações (etapa atrasada, devolvida), aparelhos de usuários desativados;
# rodar de novo não duplica; alertas no Command Center (sensíveis só para Direção/RH) e na TV (sem sensíveis).
import re, subprocess, requests, json
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
B = "http://localhost:3100"; TOKEN = "setup-homologacao-2026-status"
def psql(q): return subprocess.run(["su", "postgres", "-c", f"/usr/lib/postgresql/16/bin/psql -h /tmp/pg -U status -d status_people -q -t -A -c \"{q.replace(chr(34), chr(92) + chr(34))}\""], capture_output=True, text=True).stdout.strip()
def mk(): s = requests.Session(); s.headers.update({"Origin": B}); return s
S = mk(); unq = requests.utils.unquote; N = [0]
def ok(msg): N[0] += 1; print(f"  ✓ {msg}")
def action_ids(html):
    i = html.find("<main"); body = html[i:] if i >= 0 else html
    return re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', body)
def fix_cookie(sess, r):
    m = re.search(r"rh_session=([^;]+)", r.headers.get("set-cookie", ""))
    if m: sess.headers["Cookie"] = f"rh_session={m.group(1)}"
def page(path, expect=200, sess=None):
    sess = sess or S; r = sess.get(B + path, allow_redirects=False)
    assert r.status_code == expect, (path, r.status_code, r.headers.get("location"))
    return re.sub(r"<script[^>]*>.*?</script>", "", re.sub(r"<!--.*?-->", "", r.text), flags=re.S).replace("\xa0", " ")
def post(path, aid, data, sess=None):
    sess = sess or S; f = [(f"$ACTION_ID_{aid}", (None, ""))]
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
def login(sess, email, senha):
    html = sess.get(B + "/login").text; aid = re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', html)[0]
    loc = post("/login", aid, {"email": email, "senha": senha}, sess=sess); assert loc.endswith("/"), loc
HOJE = datetime.now(ZoneInfo("America/Campo_Grande")).date(); H = HOJE.isoformat()
def d(n): return (HOJE + timedelta(days=n)).isoformat()
def notifs(uid, like): return int(psql(f"SELECT count(*) FROM notifications WHERE user_id={uid} AND titulo LIKE '{like}'"))
def textos(uid): return psql(f"SELECT string_agg(titulo || ' :: ' || coalesce(texto,''), E'\\n' ORDER BY id) FROM notifications WHERE user_id={uid}")

print("Preparação")
login(S, "rh@colegiostatus", "Status2026!"); assert S.get(B + f"/api/setup?token={TOKEN}").json()["ok"]
RH = psql("SELECT id FROM users WHERE email='rh@colegiostatus'"); CAR, CUL = (psql(f"SELECT id FROM units WHERE codigo='{c}'") for c in ["CAR", "CUL"])
psql(f"INSERT INTO employees (nome, unit_id, vinculo, admissao) VALUES ('Paulo Professor', {CAR}, 'CLT', '2023-02-01'), ('Bruna Brigadista', {CAR}, 'CLT', '2022-03-01'), ('Ivo Inativo', {CAR}, 'CLT', '2022-03-01')")
EP, EB, EI = (psql(f"SELECT id FROM employees WHERE nome='{n}'") for n in ["Paulo Professor", "Bruna Brigadista", "Ivo Inativo"])
html = page("/configuracoes"); aid_user = aid_of(html, "Criar acesso")
def criar_user(nome, email, role, unit="", emp=""):
    post("/configuracoes", aid_user, {"nome": nome, "email": email, "role": role, "unitId": unit, "employeeId": emp, "senha": "senha12345"}); u = psql(f"SELECT id FROM users WHERE email='{email}'"); assert u, email; return u
UDG = criar_user("Diretora Geral", "dg@rede", "DIRECAO"); UDIR = criar_user("Diretora Carandá", "dir@car", "DIRETOR_UNIDADE", CAR); UCOORD = criar_user("Coord Carandá", "coord@car", "GESTOR", CAR)
UDCUL = criar_user("Diretor Cultura", "dir@cul", "DIRETOR_UNIDADE", CUL); UOPS = criar_user("Operações", "ops@rede", "OPERACOES"); UFIN = criar_user("Financeiro", "fin@rede", "FINANCEIRO")
UCOM = criar_user("Comercial Carandá", "com@car", "COMERCIAL", CAR); UB = criar_user("Bruna", "bruna@car", "COLABORADOR", "", EB); UI = criar_user("Ivo", "ivo@car", "COLABORADOR", "", EI)
ok("Direção, diretores de unidade, coordenação, operações, financeiro, comercial e colaboradores criados")

# Rematrícula
psql(f"INSERT INTO students (nome, aluno_atual, unit_atual_id, carteira_user_id) VALUES ('Ana Aberta', true, {CAR}, {UCOM}), ('Beto Vencido', true, {CAR}, NULL), ('Caio Calado', true, {CAR}, NULL)")
SA, SB, SC = (psql(f"SELECT id FROM students WHERE nome='{n}'") for n in ["Ana Aberta", "Beto Vencido", "Caio Calado"])
psql(f"INSERT INTO rematricula_links (student_id, ano, unit_id, token, expira_em, enviado_em, aberto_em) VALUES ({SA}, 2027, {CAR}, 'tok-ana-aberta-xxxxxxxxxxxx', '{d(20)}', now() - interval '5 days', now() - interval '3 days'), ({SB}, 2027, {CAR}, 'tok-beto-vencido-xxxxxxxxxx', '{d(-1)}', now() - interval '30 days', NULL), ({SC}, 2027, {CAR}, 'tok-caio-calado-xxxxxxxxxxx', '{d(2)}', now() - interval '20 days', NULL)")
# Substituição
psql(f"INSERT INTO cover_absences (employee_id, unit_id, data, motivo) VALUES ({EP}, {CAR}, '{H}', 'SAUDE'), ({EP}, {CAR}, '{d(1)}', 'SAUDE'), ({EP}, {CAR}, '{d(-2)}', 'SAUDE')")
A0, A1, A2 = (psql(f"SELECT id FROM cover_absences WHERE employee_id={EP} AND data='{x}'") for x in [H, d(1), d(-2)])
psql(f"INSERT INTO cover_assignments (absence_id, data, unit_id, turma, inicio, fim, ausente_employee_id, status) VALUES ({A0}, '{H}', {CAR}, '5º A', '07:30', '08:20', {EP}, 'ABERTA'), ({A0}, '{H}', {CAR}, '5º B', '08:20', '09:10', {EP}, 'CONVIDADO'), ({A1}, '{d(1)}', {CAR}, '5º A', '07:30', '08:20', {EP}, 'ABERTA'), ({A2}, '{d(-2)}', {CAR}, '5º A', '07:30', '08:20', {EP}, 'CONFIRMADA')")
# Portaria
psql(f"INSERT INTO visits (unit_id, nome, documento, entrada, saida) VALUES ({CAR}, 'Visitante Antigo', '123.456.789-00', now() - interval '200 days', now() - interval '200 days'), ({CAR}, 'Visitante Recente', '987.654.321-00', now() - interval '3 days', now() - interval '3 days')")
psql(f"INSERT INTO brigade_members (employee_id, unit_id, funcao, treinamento_em, validade) VALUES ({EB}, {CAR}, 'BRIGADISTA', '{d(-350)}', '{d(10)}')")
psql(f"INSERT INTO emergency_events (unit_id, tipo, cenario, status, inicio, created_by) VALUES ({CAR}, 'SIMULADO', 'INCENDIO', 'EM_ANDAMENTO', now() - interval '7 hours', {UDIR})")
EV = psql(f"SELECT id FROM emergency_events WHERE unit_id={CAR}")
# Contratos e licenças
psql("INSERT INTO suppliers (nome) VALUES ('Limpa Tudo Ltda'), ('Seg Vigilância'), ('Net Escola')")
F1, F2, F3 = (psql(f"SELECT id FROM suppliers WHERE nome='{n}'") for n in ["Limpa Tudo Ltda", "Seg Vigilância", "Net Escola"])
psql(f"INSERT INTO contracts (supplier_id, unit_id, objeto, inicio, fim, renovacao, aviso_previo_dias, responsavel_user_id) VALUES ({F1}, {CAR}, 'Limpeza', '{d(-325)}', '{d(40)}', 'AUTOMATICA', 30, {UOPS})")
psql(f"INSERT INTO contracts (supplier_id, unit_id, objeto, inicio, fim, renovacao, aviso_previo_dias) VALUES ({F2}, NULL, 'Vigilância', '{d(-370)}', '{d(-5)}', 'MANUAL', 30)")
psql(f"INSERT INTO contracts (supplier_id, unit_id, objeto, inicio, fim, renovacao, proximo_reajuste) VALUES ({F3}, {CUL}, 'Internet', '{d(-100)}', NULL, 'MANUAL', '{d(10)}')")
C1, C2, C3 = (psql(f"SELECT id FROM contracts WHERE supplier_id={f}") for f in [F1, F2, F3])
psql(f"INSERT INTO licenses (unit_id, tipo, numero, validade, antecedencia_dias, responsavel_user_id) VALUES ({CAR}, 'AVCB', 'AVCB-1', '{d(-1)}', 60, {UOPS}), ({CUL}, 'ALVARA_FUNCIONAMENTO', 'ALV-9', '{d(20)}', 60, NULL), ({CUL}, 'SANITARIA', 'SAN-1', '{d(200)}', 60, NULL)")
L1, L2 = (psql(f"SELECT id FROM licenses WHERE numero='{n}'") for n in ["AVCB-1", "ALV-9"])
# Privacidade
psql(f"INSERT INTO privacy_requests (protocolo, tipo, titular_nome, prazo) VALUES ('LGPD-T-0001', 'ACESSO', 'Mãe Sigilosa da Silva', '{d(2)}'), ('LGPD-T-0002', 'ELIMINACAO', 'Pai Sigiloso Souza', '{d(-1)}'), ('LGPD-T-0003', 'ACESSO', 'Titular Tranquilo', '{d(12)}')")
P1, P2 = (psql(f"SELECT id FROM privacy_requests WHERE protocolo='{p}'") for p in ["LGPD-T-0001", "LGPD-T-0002"])
psql(f"INSERT INTO privacy_incidents (codigo, titulo, descricao, ciencia_em, prazo_anpd, created_by) VALUES ('INC-T-01', 'Planilha de alunos enviada a grupo errado', 'Detalhe sigiloso do incidente', now() - interval '5 days', '{d(-1)}', {RH})")
I1 = psql("SELECT id FROM privacy_incidents WHERE codigo='INC-T-01'")
# Ética (comitê padrão = Direção)
psql(f"INSERT INTO ethics_reports (protocolo, codigo_hash, categoria, relato, status, prazo_triagem, prazo_conclusao) VALUES ('ET-TEST-0001', 'x', 'ASSEDIO_MORAL', 'Conteúdo sigiloso do relato sobre a pessoa X', 'RECEBIDA', '{d(-1)}', '{d(59)}')")
E1 = psql("SELECT id FROM ethics_reports WHERE protocolo='ET-TEST-0001'")
# Solicitações
TD = psql("SELECT id FROM request_types WHERE codigo='DECLARACAO'")
psql(f"INSERT INTO requests (numero, type_id, titulo, dados, solicitante_user_id, solicitante_nome, status, etapa_atual, etapas, prazo_etapa, unit_id) VALUES ('SOL-T-1', {TD}, 'Declaração — Bruna', '{{}}'::jsonb, {UB}, 'Bruna', 'EM_APROVACAO', 0, '[{{\"nome\": \"Secretaria / RH\", \"aprovadores\": [{RH}], \"decisao\": null, \"por\": null, \"porNome\": null, \"em\": null, \"obs\": null}}]'::jsonb, '{d(-1)}', {CAR})")
psql(f"INSERT INTO requests (numero, type_id, titulo, dados, solicitante_user_id, solicitante_nome, status, etapa_atual, etapas, prazo_etapa, unit_id, updated_at) VALUES ('SOL-T-2', {TD}, 'Declaração devolvida — Bruna', '{{}}'::jsonb, {UB}, 'Bruna', 'DEVOLVIDA', 0, '[{{\"nome\": \"Secretaria / RH\", \"aprovadores\": [{RH}], \"decisao\": \"DEVOLVIDA\", \"por\": {RH}, \"porNome\": \"RH\", \"em\": null, \"obs\": \"falta dado\"}}]'::jsonb, NULL, {CAR}, now() - interval '5 days')")
R1, R2 = (psql(f"SELECT id FROM requests WHERE numero='{n}'") for n in ["SOL-T-1", "SOL-T-2"])
# Aparelho de usuário desativado
psql(f"INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES ({UI}, 'https://fcm.googleapis.com/fcm/send/ivo-teste', 'x', 'y')"); psql(f"UPDATE users SET ativo=false WHERE id={UI}")
ok("cenário montado em todos os módulos v22")

print("Rotina diária")
QN = "SELECT count(*) FROM notifications"; n0 = int(psql(QN))
j = requests.get(B + f"/api/tarefas?token={TOKEN}").json(); assert j["ok"] and "v22" in j and j["v22"]["falhas"] == [], j.get("v22")
v = j["v22"]; n1 = int(psql(QN)); assert n1 > n0
assert v["rematricula"]["expirados"] == 1 and psql(f"SELECT status FROM rematricula_links WHERE student_id={SB}") == "EXPIRADA" and psql(f"SELECT status FROM rematricula_links WHERE student_id={SA}") == "PENDENTE"
assert notifs(UCOM, "Rematrícula aberta e não concluída: Ana Aberta") == 1 and notifs(UCOM, "Link de rematrícula vence sem ser aberto: Caio Calado") == 1
assert psql(f"SELECT link FROM notifications WHERE user_id={UCOM} AND titulo LIKE 'Rematrícula aberta%'") == f"/matriculas/alunos/{SA}#rematricula"
ok("rematrícula: link vencido expira; aberto há dias sem concluir e vencendo sem abrir avisam a carteira/comercial da unidade")
for u in [UCOORD, UDIR]: assert notifs(u, "2 aula(s) sem professor hoje — Carandá") == 1 and notifs(u, "1 aula(s) sem professor amanhã — Carandá") == 1 and notifs(u, "1 cobertura(s) a confirmar — Carandá") == 1, textos(u)
assert notifs(UDCUL, "%sem professor%") == 0 and psql(f"SELECT tipo FROM notifications WHERE user_id={UCOORD} AND titulo LIKE '%sem professor hoje%'") == "ALERTA"
ok("substituição: aulas sem professor hoje (alerta) e amanhã, e coberturas a confirmar — só para coordenação e direção da unidade")
assert psql(f"SELECT nome || '|' || coalesce(documento,'∅') || '|' || (anonimizado_em IS NOT NULL) FROM visits WHERE entrada < now() - interval '100 days'") == "Visitante (dados apagados)|∅|true"
assert psql("SELECT nome || '|' || documento FROM visits WHERE entrada > now() - interval '100 days'") == "Visitante Recente|987.654.321-00" and v["portaria"]["visitasAnonimizadas"] == 1
for u in [UDIR, UOPS, UB]: assert notifs(u, "Treinamento de brigada vence em breve: Bruna Brigadista") == 1, (u, textos(u))
assert notifs(UDCUL, "Treinamento de brigada%") == 0
for u in [UDIR, UOPS, UDG]: assert notifs(u, "Brigada abaixo do mínimo — Carandá") == 1, (u, textos(u))
assert notifs(UDIR, "Simulado de abandono pendente — Carandá") == 1 and notifs(UDCUL, "Simulado de abandono pendente — Cultura") == 1 and notifs(UDCUL, "Simulado de abandono pendente — Carandá") == 0
assert notifs(UDIR, "Simulado ainda aberto — Carandá") == 1 and psql(f"SELECT link FROM notifications WHERE user_id={UDIR} AND titulo LIKE 'Simulado ainda aberto%'") == f"/operacoes/seguranca/emergencias/{EV}"
ok("portaria: visitante além do prazo de guarda tem os dados apagados (o registro fica); brigada vencendo (inclui a própria brigadista), abaixo do mínimo, sem simulado e simulado esquecido aberto")
for u in [UOPS, UFIN, UDIR]: assert notifs(u, "Prazo para avisar a não renovação: Limpa Tudo Ltda — Limpeza") == 1 and notifs(u, "Contrato vence em 40 dia(s): Limpa Tudo Ltda — Limpeza") == 1, (u, textos(u))
assert notifs(UFIN, "Contrato vencido: Seg Vigilância — Vigilância") == 1 and notifs(UDIR, "Contrato vencido%") == 0
assert notifs(UDCUL, "Reajuste de contrato em %Net Escola — Internet") == 1 and notifs(UDIR, "Reajuste%") == 0
ok("contratos: prazo do aviso prévio (renovação automática), marco de vencimento, vencido (financeiro) e reajuste — diretor(a) só da própria unidade")
assert notifs(UOPS, "Licença vencida: AVCB — Corpo de Bombeiros — Carandá") == 1 and notifs(UDIR, "Licença vencida: AVCB%") == 1 and notifs(UDCUL, "Licença vencida%") == 0
assert notifs(UDCUL, "Licença vence em 20 dia(s): Alvará de localização e funcionamento — Cultura") == 1 and notifs(UDCUL, "%Licença sanitária%") == 0
ok("licenças: vencida (alerta) e vencendo pela antecedência — responsável, operações e diretor(a) da unidade")
for u in [UDG, RH]:
    assert notifs(u, "Pedido de titular vence em %: LGPD-T-0001") == 1 and notifs(u, "Pedido de titular com prazo vencido: LGPD-T-0002") == 1 and notifs(u, "%LGPD-T-0003%") == 0, textos(u)
    assert notifs(u, "Incidente INC-T-01: prazo de comunicação à ANPD vencido") == 1
assert "Sigilos" not in textos(UDG) and "Planilha de alunos" not in textos(UDG) and notifs(UDIR, "%titular%") == 0 and notifs(UFIN, "Incidente%") == 0
ok("privacidade: pedidos perto do prazo/vencidos e incidente com prazo da ANPD — Direção/RH (e DPO), sem nome de titular nem descrição")
assert notifs(UDG, "Canal de ética: triagem atrasada (ET-TEST-0001)") == 1 and notifs(RH, "Canal de ética%") == 0 and "pessoa X" not in textos(UDG) and "ASSEDIO" not in textos(UDG)
ok("ética: prazo de triagem vencido avisa só o comitê (Direção por padrão), sem categoria nem conteúdo")
assert notifs(RH, "Aprovação atrasada: Declaração — Bruna") == 1 and notifs(UB, "Solicitação aguardando seu ajuste: Declaração devolvida — Bruna") == 1
ok("solicitações: etapa atrasada avisa os aprovadores; devolvida há dias lembra a solicitante")
assert psql(f"SELECT count(*) FROM push_subscriptions WHERE user_id={UI}") == "0" and v["aparelhosRemovidos"] == 1
ok("aparelhos de usuários desativados saem das notificações no celular")
j2 = requests.get(B + f"/api/tarefas?token={TOKEN}").json(); assert j2["ok"] and j2["v22"]["falhas"] == []; assert int(psql(QN)) == n1, (n1, psql(QN))
ok(f"rodar a rotina de novo no mesmo dia não duplica ({n1 - n0} avisos)")

print("Command Center e TV")
DG = mk(); login(DG, "dg@rede", "senha12345"); FS = mk(); login(FS, "fin@rede", "senha12345"); DS = mk(); login(DS, "dir@car", "senha12345")
cc = page("/command-center", sess=DG)
for t in ["Segurança: brigada abaixo do mínimo em", "Operações: 1 licença(s)/alvará(s) vencido(s)", "Operações: 1 licença(s)/alvará(s) vencendo", "Operações: 1 contrato(s) de fornecedor vencido(s)", "Operações: 1 contrato(s) com prazo de aviso ou vencimento próximo", "Pessoas: 2 aula(s) sem professor hoje", "Pessoas: 1 aula(s) sem professor amanhã", "Processos: 1 solicitação(ões) com aprovação atrasada", "Matrículas: 1 família(s) abriram a rematrícula e não concluíram", "Matrículas: 1 link(s) de rematrícula expiraram sem resposta", "Privacidade: 1 incidente(s) com prazo de comunicação à ANPD vencido", "Privacidade: 1 pedido(s) de titular com prazo vencido", "Privacidade: 1 pedido(s) de titular vencendo em até 3 dias", "Canal de ética: 1 relato(s) com prazo vencido", "Segurança: sem simulado de abandono há mais de"]:
    assert t in cc, t
psql(f"INSERT INTO emergency_events (unit_id, tipo, cenario, status, inicio) VALUES ({CUL}, 'REAL', 'EVACUACAO', 'EM_ANDAMENTO', now())")
cc = page("/command-center", sess=DG); assert "Segurança: emergência em andamento — Cultura" in cc
i_alto = cc.find("Segurança: emergência em andamento"); i_medio = cc.find("Pessoas: 1 aula(s) sem professor amanhã"); assert 0 < i_alto < i_medio
ok("Command Center (Direção): alertas de todos os módulos v22, emergência real no topo; privacidade e ética só como contagem")
cf = page("/command-center", sess=FS); assert "Operações: 1 contrato(s) de fornecedor vencido(s)" in cf and "Privacidade:" not in cf and "Canal de ética" not in cf
cd = page("/command-center", sess=DS); assert "Pessoas: 2 aula(s) sem professor hoje" in cd and "Operações: 1 licença(s)/alvará(s) vencido(s)" in cd and "licença(s)/alvará(s) vencendo" not in cd and "emergência em andamento — Cultura" not in cd and "Privacidade:" not in cd
tv = page("/tv?token=tv-teste-123", sess=mk()); assert "Canal de ética" not in tv and "Privacidade:" not in tv
ok("financeiro e diretora da unidade não veem privacidade/ética; diretora vê só a própria unidade; TV nunca mostra os sensíveis")
print(f"\nE2E Rotina e Command Center v22: {N[0]} verificações OK")
