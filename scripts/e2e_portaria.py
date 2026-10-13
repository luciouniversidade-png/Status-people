# E2E — Portaria e segurança (v22): quem pode buscar (autorizados e restrições), saída antecipada com conferência (restrição bloqueia,
# fora da lista só com exceção da gestão), visitantes, brigada com validade, simulado de abandono (chamada por grupo, tempo de evacuação,
# falhas → plano de ação, encerramento), entrega às famílias na emergência, emergência real com alertas, escopo e permissões.
import re, subprocess, requests
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
def erro(loc, trecho): assert "erro=" in loc and trecho in loc, (trecho, loc)
def okmsg(loc, trecho=""): assert "ok=" in loc and trecho in loc, (trecho, loc)
HOJE = datetime.now(ZoneInfo("America/Campo_Grande")).date(); H = HOJE.isoformat()

print("Preparação")
login(S, "rh@colegiostatus", "Status2026!"); r = S.get(B + f"/api/setup?token={TOKEN}"); assert r.json()["ok"], r.text
CAR, CUL = (psql(f"SELECT id FROM units WHERE codigo='{c}'") for c in ["CAR", "CUL"]); G = lambda n: psql(f"SELECT id FROM grades WHERE nome='{n}'")
for nome, u, serie in [("Ana Porta", CAR, "4º ano"), ("Bruno Porta", CAR, "4º ano"), ("Lia Porta", CAR, "4º ano"), ("Caio Porta", CAR, "5º ano"), ("Davi Porta", CUL, "Jardim I")]:
    psql(f"INSERT INTO students (nome, aluno_atual, unit_atual_id, serie_atual_id, responsavel) VALUES ('{nome}', true, {u}, {G(serie)}, 'Resp. de {nome}')")
ANA, BRU, CAIO, DAVI = (psql(f"SELECT id FROM students WHERE nome='{n}'") for n in ["Ana Porta", "Bruno Porta", "Caio Porta", "Davi Porta"])
for nome in ["Bia Brigadista", "Rui Brigadista", "Sol Equipe"]: psql(f"INSERT INTO employees (nome, unit_id, vinculo, admissao) VALUES ('{nome}', {CAR}, 'CLT', '2023-01-10')")
BIA, RUI = (psql(f"SELECT id FROM employees WHERE nome='{n}'") for n in ["Bia Brigadista", "Rui Brigadista"])
html = page("/configuracoes"); aid_user = aid_of(html, "Criar acesso")
def criar_user(nome, email, role, unit=""):
    post("/configuracoes", aid_user, {"nome": nome, "email": email, "role": role, "unitId": unit, "senha": "senha12345"}); return psql(f"SELECT id FROM users WHERE email='{email}'")
UPOR = criar_user("Porteiro Rede", "por@rede", "OPERACOES"); UDIR = criar_user("Diretora Carandá", "dir@car", "DIRETOR_UNIDADE", CAR); UGES = criar_user("Coord Carandá", "coord@car", "GESTOR", CAR); UCOM = criar_user("Secretaria", "sec@rede", "COMERCIAL"); UGC = criar_user("Gestor Cultura", "ges@cul", "GESTOR", CUL); criar_user("Leitura", "lei@rede", "LEITURA")
PO = mk(); login(PO, "por@rede", "senha12345"); DS = mk(); login(DS, "dir@car", "senha12345"); GE = mk(); login(GE, "coord@car", "senha12345"); CO = mk(); login(CO, "sec@rede", "senha12345"); GC = mk(); login(GC, "ges@cul", "senha12345"); LS = mk(); login(LS, "lei@rede", "senha12345")
ok("alunos de Carandá e Cultura, equipe, portaria, direção, coordenação, secretaria, gestor da Cultura e leitura")

print("Quem pode buscar")
h = page(f"/matriculas/alunos/{ANA}", sess=CO); aid_aut = aid_of(h, 'name="restricaoObs"') if 'name="restricaoObs"' in h else aid_of(h, "Incluir pessoa")
assert 'name="restricaoObs"' not in h; ok("secretaria não vê a opção de restrição")
V = f"/matriculas/alunos/{ANA}"
okmsg(post(V, aid_aut, {"studentId": ANA, "nome": "Maria Avó Silva", "parentesco": "avó", "documento": "RG 1234567", "tipo": "AUTORIZADO", "voltar": V}, sess=CO), "atualizada")
erro(post(V, aid_aut, {"studentId": ANA, "nome": "João Pai Souza", "tipo": "PROIBIDO", "restricaoObs": "x", "voltar": V}, sess=CO), "coordenação ou direção")
erro(post(V, aid_aut, {"studentId": ANA, "nome": "João Pai Souza", "tipo": "PROIBIDO", "voltar": V}, sess=GE), "base da restrição")
okmsg(post(V, aid_aut, {"studentId": ANA, "nome": "João Pai Souza", "tipo": "PROIBIDO", "documento": "CPF 111.222.333-44", "restricaoObs": "Medida protetiva — processo 0801234-55", "voltar": V}, sess=GE), "atualizada")
erro(post(V, aid_aut, {"studentId": ANA, "nome": "maria avó silva", "tipo": "AUTORIZADO", "voltar": V}, sess=CO), "já está na lista")
erro(post(V, aid_aut, {"studentId": ANA, "nome": "Zé", "tipo": "AUTORIZADO", "voltar": V}, sess=CO), "nome completo")
erro(post(V, aid_aut, {"studentId": ANA, "nome": "Outra Pessoa Lima", "tipo": "AUTORIZADO", "voltar": V}, sess=GC), "Sem acesso")
hp = page(V, sess=PO); assert "NÃO entregar: João Pai Souza" in hp and "Medida protetiva" not in hp
hg = page(V, sess=GE); assert "Medida protetiva — processo 0801234-55" in hg
ok("secretaria autoriza; restrição só pela coordenação/direção e com base registrada; duplicado, nome incompleto e outra unidade recusados; portaria vê o alerta sem o detalhe")

print("Saída antecipada com conferência")
h = page(f"/operacoes/seguranca?unidade={CAR}&q=Porta", sess=PO); assert "Ana Porta" in h and "Bruno Porta" in h and "Davi Porta" not in h
h = page(f"/operacoes/seguranca?unidade={CAR}&studentId={ANA}", sess=PO); assert "NÃO ENTREGAR a:" in h and "João Pai Souza" in h and "Maria Avó Silva" in h and "Medida protetiva" not in h
aid_ret = aid_of(h, ">Entregar<"); VP = f"/operacoes/seguranca?unidade={CAR}"
MARIA = psql(f"SELECT id FROM pickup_authorizations WHERE nome='Maria Avó Silva'")
erro(post(VP, aid_ret, {"studentId": ANA, "retiradoPor": "joão pai souza", "voltar": VP}, sess=PO), "BLOQUEADA")
assert psql(f"SELECT status FROM early_departures WHERE student_id={ANA}") == "BLOQUEADA" and psql(f"SELECT count(*) FROM notifications WHERE titulo='Retirada BLOQUEADA: Ana Porta' AND tipo='ALERTA' AND user_id IN ({UDIR},{UGES})") == "2"
erro(post(VP, aid_ret, {"studentId": ANA, "retiradoPor": "Fulano Qualquer Nome", "documento": "111.222.333-44", "voltar": VP}, sess=GE), "BLOQUEADA")
erro(post(VP, aid_ret, {"studentId": ANA, "retiradoPor": "João Pai Souza", "excecao": "a mãe autorizou por telefone agora", "voltar": VP}, sess=DS), "BLOQUEADA")
ok("restrição bloqueia pelo nome (sem acento/maiúscula) ou pelo documento — inclusive para a direção; tentativa registrada e alerta à gestão da unidade")
okmsg(post(VP, aid_ret, {"studentId": ANA, "authorizationId": MARIA, "avisado": "1", "motivo": "consulta médica", "voltar": VP}, sess=PO), "liberado(a) com Maria Avó Silva")
erro(post(VP, aid_ret, {"studentId": ANA, "authorizationId": MARIA, "voltar": VP}, sess=PO), "já saiu hoje")
erro(post(VP, aid_ret, {"studentId": BRU, "retiradoPor": "Tia Joana Lima", "voltar": VP}, sess=PO), "só a coordenação ou a direção liberam")
erro(post(VP, aid_ret, {"studentId": BRU, "retiradoPor": "Tia Joana Lima", "excecao": "ok", "voltar": VP}, sess=GE), "justificativa")
okmsg(post(VP, aid_ret, {"studentId": BRU, "retiradoPor": "Tia Joana Lima", "excecao": "Mãe confirmou por telefone às 10h12 com a coordenação", "voltar": VP}, sess=GE), "exceção registrada")
assert psql(f"SELECT status || '|' || (autorizado_por={UGES}) FROM early_departures WHERE student_id={BRU}") == "LIBERADA|true"
erro(post(VP, aid_ret, {"studentId": DAVI, "retiradoPor": "Mãe do Davi Lima", "voltar": VP}, sess=GE), "Sem acesso")
psql(f"INSERT INTO pickup_authorizations (student_id, nome, tipo, validade) VALUES ({CAIO}, 'Vizinha Antiga Rosa', 'AUTORIZADO', '{(HOJE - timedelta(days=1)).isoformat()}')")
erro(post(VP, aid_ret, {"studentId": CAIO, "retiradoPor": "Vizinha Antiga Rosa", "voltar": VP}, sess=PO), "fora da lista")
h = page(VP, sess=PO); assert "Saídas de hoje (5)" in h and "Liberada por exceção" in h and h.count("Bloqueada") >= 3
ok("autorizado sai com um toque (uma saída por dia); fora da lista só com exceção justificada da gestão; autorização vencida não vale; aluno de outra unidade barrado; lista do dia")

print("Visitantes")
h = page(VP, sess=PO); aid_vis = aid_of(h, "Registrar entrada")
erro(post(VP, aid_vis, {"unitId": CAR, "tipo": "PRESTADOR", "nome": "Jo", "voltar": VP}, sess=PO), "nome")
okmsg(post(VP, aid_vis, {"unitId": CAR, "tipo": "PRESTADOR", "nome": "Técnico do Ar Silva", "documento": "RG 998877", "empresa": "Clima Frio", "visitado": "Manutenção", "voltar": VP}, sess=PO), "Entrada registrada")
erro(post(VP, aid_vis, {"unitId": CAR, "tipo": "VISITANTE", "nome": "Visitante Teste", "voltar": VP}, sess=LS), "não opera")
h = page(VP, sess=PO); assert "Visitantes na escola agora (1)" in h and "Técnico do Ar Silva" in h and "•••877" in h and "998877" not in h
VID = psql("SELECT id FROM visits WHERE nome='Técnico do Ar Silva'")
ok("entrada de prestador (documento mascarado na tela); leitura não registra")

print("Brigada")
h = page("/operacoes/seguranca/brigada", sess=PO); aid_bri = aid_of(h, "Incluir na brigada")
erro(post("/operacoes/seguranca/brigada", aid_bri, {"employeeId": BIA, "funcao": "BRIGADISTA", "treinamentoEm": (HOJE + timedelta(days=3)).isoformat()}, sess=PO), "futuro")
okmsg(post("/operacoes/seguranca/brigada", aid_bri, {"employeeId": BIA, "funcao": "LIDER", "treinamentoEm": (HOJE - timedelta(days=400)).isoformat()}, sess=PO), "atualizada")
okmsg(post("/operacoes/seguranca/brigada", aid_bri, {"employeeId": RUI, "funcao": "BRIGADISTA", "treinamentoEm": (HOJE - timedelta(days=30)).isoformat()}, sess=PO), "atualizada")
erro(post("/operacoes/seguranca/brigada", aid_bri, {"employeeId": RUI, "funcao": "BRIGADISTA"}, sess=PO), "Já está na brigada")
h = page("/operacoes/seguranca/brigada", sess=PO); assert "Treinamento vencido" in h and "Treinamento válido" in h and "abaixo do mínimo (2)" in h
BID = psql(f"SELECT id FROM brigade_members WHERE employee_id={RUI}")
erro(post("/operacoes/seguranca/brigada", aid_bri, {"id": BID, "employeeId": RUI, "unitId": psql("SELECT id FROM units WHERE codigo='CUL'"), "funcao": "BRIGADISTA", "ativo": "0"}, sess=GC), "Sem acesso")
assert psql(f"SELECT ativo || '|' || unit_id FROM brigade_members WHERE id={BID}") == f"true|{CAR}"
ok("brigadista com validade automática de 12 meses: Bia vencida, Rui válido; Carandá abaixo do mínimo; treinamento no futuro e duplicado recusados; gestor de outra unidade não edita nem move brigadista pelo id")

print("Simulado de abandono")
h = page("/operacoes/seguranca/emergencias", sess=PO); aid_ini = aid_of(h, "Iniciar e abrir a chamada")
loc = post("/operacoes/seguranca/emergencias", aid_ini, {"unitId": CAR, "tipo": "SIMULADO", "cenario": "Incêndio", "pontosEncontro": "Quadra"}, sess=PO); EV = re.search(r"/emergencias/(\d+)", loc).group(1)
grupos = psql(f"SELECT string_agg(grupo || ':' || esperado, ',' ORDER BY ordem) FROM emergency_checks WHERE event_id={EV}")
assert grupos == "4º ano:1,5º ano:1,Equipe da unidade:3,Visitantes e prestadores presentes:1", grupos  # Ana e Bruno já saíram mais cedo
assert psql(f"SELECT count(*) FROM notifications WHERE titulo LIKE 'Simulado de abandono em Carandá' AND user_id IN ({UDIR},{UGES})") == "2"
erro(post("/operacoes/seguranca/emergencias", aid_ini, {"unitId": CAR, "tipo": "SIMULADO", "cenario": "Incêndio"}, sess=PO), "em andamento")
hv = page(f"/operacoes/seguranca/emergencias/{EV}", sess=PO); aid_cham = aid_of(hv, "Todos presentes e seguros"); aid_cont = aid_of(hv, "Salvar contagem")
C4, C5, CEQ, CVI = (psql(f"SELECT id FROM emergency_checks WHERE event_id={EV} AND grupo='{g}'") for g in ["4º ano", "5º ano", "Equipe da unidade", "Visitantes e prestadores presentes"])
EVP = f"/operacoes/seguranca/emergencias/{EV}"
post(EVP, aid_cham, {"id": C4, "todos": "1"}, sess=PO); post(EVP, aid_cham, {"id": CEQ, "todos": "1"}, sess=DS)
erro(post(EVP, aid_cont, {"id": C5, "presentes": ""}, sess=PO), "quantos estão presentes"); erro(post(EVP, aid_cont, {"id": C5, "presentes": "-1"}, sess=PO), "inteiros")
post(EVP, aid_cont, {"id": C5, "presentes": "0", "naoLocalizados": "1", "responsavel": "Prof. Lia"}, sess=PO)
assert psql(f"SELECT evacuacao_em IS NULL FROM emergency_events WHERE id={EV}") == "t"
post(EVP, aid_cham, {"id": CVI, "todos": "1"}, sess=PO)
assert psql(f"SELECT evacuacao_em IS NOT NULL AND tempo_evacuacao_seg >= 0 FROM emergency_events WHERE id={EV}") == "t" and psql(f"SELECT status FROM emergency_checks WHERE id={C5}") == "OCORRENCIA"
hv = page(EVP, sess=PO); aid_grp = aid_of(hv, "Incluir na chamada")
post(EVP, aid_grp, {"eventId": EV, "grupo": "Turma do contraturno", "esperado": "5"}, sess=PO)
assert psql(f"SELECT evacuacao_em IS NULL FROM emergency_events WHERE id={EV}") == "t"; CNT = psql(f"SELECT id FROM emergency_checks WHERE event_id={EV} AND grupo='Turma do contraturno'"); post(EVP, aid_cham, {"id": CNT, "todos": "1"}, sess=PO)
assert psql(f"SELECT tempo_evacuacao_seg IS NOT NULL FROM emergency_events WHERE id={EV}") == "t"
ok("simulado: grupos por série atual (sem quem já saiu mais cedo) + equipe + visitantes; um evento por vez; chamada rápida e por contagem (validada); tempo de evacuação gravado no último grupo e refeito quando entra grupo novo")
hv = page(EVP, sess=PO); aid_fal = aid_of(hv, "Registrar falha")
erro(post(EVP, aid_fal, {"eventId": EV, "descricao": "Alarme não foi ouvido no bloco B", "gravidade": "ALTA", "criarAcao": "1", "responsavelUserId": UGC, "prazo": (HOJE + timedelta(days=15)).isoformat()}, sess=PO), "Responsável inválido")
erro(post(EVP, aid_fal, {"eventId": EV, "descricao": "Alarme não foi ouvido no bloco B", "gravidade": "ALTA", "criarAcao": "1"}, sess=PO), "responsável e prazo")
okmsg(post(EVP, aid_fal, {"eventId": EV, "descricao": "Alarme não foi ouvido no bloco B", "gravidade": "ALTA", "criarAcao": "1", "responsavelUserId": UDIR, "prazo": (HOJE + timedelta(days=15)).isoformat()}, sess=PO), "ação criada")
okmsg(post(EVP, aid_fal, {"eventId": EV, "descricao": "Porta de saída emperrada", "gravidade": "MEDIA", "criarAcao": "0"}, sess=PO), "Falha registrada")
ac = psql(f"SELECT a.unit_id || '|' || a.responsavel_user_id || '|' || a.origem || '|' || a.status FROM emergency_failures f JOIN action_plans a ON a.id=f.action_plan_id WHERE f.event_id={EV}")
assert ac == f"{CAR}|{UDIR}|Simulado #{EV}|A_FAZER", ac
ok("falhas: com ação corretiva no plano de ação (responsável da unidade e prazo) ou só registradas")
hv = page(f"{EVP}?studentId={CAIO}", sess=PO); assert "Caio Porta" in hv; aid_ent = aid_of(hv, "Conferir e registrar")
erro(post(EVP, aid_ent, {"studentId": DAVI, "eventId": EV, "retiradoPor": "Mãe do Davi Lima", "voltar": EVP}, sess=PO), "outra unidade")
okmsg(post(EVP, aid_ent, {"studentId": CAIO, "eventId": EV, "retiradoPor": "Pai do Caio Mendes", "excecao": "Responsável legal conferido pelo documento no ponto de encontro", "voltar": EVP}, sess=DS), "liberado")
assert psql(f"SELECT emergency_event_id FROM early_departures WHERE student_id={CAIO} AND status='LIBERADA'") == EV
hv = page(EVP, sess=PO); aid_enc = aid_of(hv, "Encerrar simulado")
erro(post(EVP, aid_enc, {"eventId": EV}, sess=PO), "não localizada")
okmsg(post(EVP, aid_enc, {"eventId": EV, "justificativa": "Aluno do 5º ano estava na enfermaria com a inspetora — localizado às 10h20"}, sess=PO), "encerrado")
assert psql(f"SELECT status FROM emergency_events WHERE id={EV}") == "ENCERRADO"
erro(post(EVP, aid_cham, {"id": C4, "todos": "1"}, sess=PO), "encerrado")
h = page("/operacoes/seguranca/emergencias", sess=PO); assert "Incêndio" in h and ("dentro da meta" in h or "acima da meta" in h)
ok("entrega à família na emergência com a mesma conferência (outra unidade barrada); encerramento exige desfecho dos não localizados; evento encerrado não aceita chamada")

print("Emergência real e permissões")
h = page("/operacoes/seguranca/emergencias", sess=GC); aid_ini2 = aid_of(h, "Iniciar e abrir a chamada")
loc = post("/operacoes/seguranca/emergencias", aid_ini2, {"tipo": "REAL", "cenario": "Vazamento de gás"}, sess=GC); EV2 = re.search(r"/emergencias/(\d+)", loc).group(1)
assert psql(f"SELECT unit_id || '|' || tipo FROM emergency_events WHERE id={EV2}") == f"{CUL}|REAL"
assert psql(f"SELECT count(DISTINCT user_id) FROM notifications WHERE titulo='EMERGÊNCIA em Cultura: Vazamento de gás' AND tipo='ALERTA'") == psql("SELECT count(*) FROM users WHERE ativo AND (role IN ('DIRECAO','RH','OPERACOES') OR (role IN ('DIRETOR_UNIDADE','GESTOR') AND unit_id=" + CUL + "))")
page(f"/operacoes/seguranca/emergencias/{EV2}", expect=404, sess=GE)
CG = psql(f"SELECT id FROM emergency_checks WHERE event_id={EV2} ORDER BY ordem LIMIT 1"); hv2 = page(f"/operacoes/seguranca/emergencias/{EV2}", sess=GC)
post(f"/operacoes/seguranca/emergencias/{EV2}", aid_of(hv2, "Salvar contagem"), {"id": CG, "presentes": "0", "naoLocalizados": "1"}, sess=GC)
assert psql("SELECT count(*) FROM notifications WHERE titulo LIKE 'NÃO LOCALIZADOS:%' AND tipo='ALERTA'") != "0"
hc = page(f"/operacoes/seguranca?unidade={CUL}", sess=GC); assert "EMERGÊNCIA EM ANDAMENTO" in hc
hl = page(VP, sess=LS); assert "Registrar entrada" not in hl
assert page("/operacoes/seguranca", expect=307, sess=mk()) is not None
ok("emergência real avisa direção, RH, operações e a gestão da unidade; não localizado gera alerta; portaria destaca o evento; outra unidade não abre (404); leitura sem formulários")

print(f"\nE2E Portaria e segurança: {N[0]} verificações OK")
