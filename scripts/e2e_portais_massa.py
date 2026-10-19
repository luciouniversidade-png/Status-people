# E2E — v25 · Portal do colaborador (T-104), portal do candidato (T-106), comunicação em massa com segundo aprovador e horário
# comercial (CRQ-COM-V3-01) e revisão de POP aberta por exceção repetida (CRQ-PRJ-V3-03).
import re, subprocess, requests, hashlib, json
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
B = "http://localhost:3100"; TOKEN = "setup-homologacao-2026-status"
def psql(q): return subprocess.run(["su", "postgres", "-c", f"/usr/lib/postgresql/16/bin/psql -h /tmp/pg -U status -d status_people -q -t -A -c \"{q.replace(chr(34), chr(92) + chr(34))}\""], capture_output=True, text=True).stdout.strip()
def mk(): s = requests.Session(); s.headers.update({"Origin": B}); return s
unq = requests.utils.unquote; N = [0]
def ok(msg): N[0] += 1; print(f"  ✓ {msg}")
def action_ids(html):
    i = html.find("<main"); body = html[i:] if i >= 0 else html
    return re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', body)
def fix_cookie(sess, r):
    for k in ("rh_session", "portal_cand"):
        m = re.search(rf"{k}=([^;]+)", r.headers.get("set-cookie", ""))
        if m:
            cur = dict(x.split("=", 1) for x in sess.headers.get("Cookie", "").split("; ") if "=" in x); cur[k] = m.group(1)
            sess.headers["Cookie"] = "; ".join(f"{a}={b}" for a, b in cur.items())
def page(path, sess, expect=200):
    r = sess.get(B + path, allow_redirects=False)
    assert r.status_code == expect, (path, r.status_code, r.headers.get("location"))
    return re.sub(r"<script[^>]*>.*?</script>", "", re.sub(r"<!--.*?-->", "", r.text), flags=re.S).replace("\xa0", " ")
def post(path, aid, data, sess, files=None):
    f = [(f"$ACTION_ID_{aid}", (None, ""))]
    for k, v in data.items():
        for x in (v if isinstance(v, list) else [v]): f.append((k, (None, str(x))))
    if files: f += files
    r = sess.post(B + path, files=f, allow_redirects=False); fix_cookie(sess, r)
    assert r.status_code in (303, 302, 200), (path, r.status_code, r.text[:300]); return unq(r.headers.get("location", ""))
def aid_of(html, marker):
    i = html.find(marker); assert i >= 0, marker
    fs = html.rfind("<form", 0, i); fe_prev = html.rfind("</form>", 0, i)
    if fs > fe_prev: fe = html.find("</form>", i)
    else: fs = html.find("<form", i); fe = html.find("</form>", fs)
    ids = action_ids(html[fs:fe]); assert ids, marker; return ids[0]
def login(email, senha):
    s = mk(); html = s.get(B + "/login").text; aid = re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', html)[0]
    loc = post("/login", aid, {"email": email, "senha": senha}, s); assert loc.endswith("/"), loc; return s
def erro(loc, trecho): assert "erro=" in loc and trecho in loc, (trecho, loc)
def okmsg(loc, trecho=""): assert "ok=" in loc and trecho in loc, (trecho, loc)
def setting(chave, patch): psql(f"INSERT INTO settings (key, value) VALUES ('{chave}', '{json.dumps(patch)}'::jsonb) ON CONFLICT (key) DO UPDATE SET value = settings.value || EXCLUDED.value")
HOJE = datetime.now(ZoneInfo("America/Campo_Grande")).date(); H = HOJE.isoformat()
def d(n): return (HOJE + timedelta(days=n)).isoformat()

print("Preparação")
RH = login("rh@colegiostatus", "Status2026!"); r = RH.get(B + f"/api/setup?token={TOKEN}"); assert r.json()["ok"], r.text
CAR = psql("SELECT id FROM units WHERE codigo='CAR'")
for nome in ["Lia Professora", "Rui Auxiliar"]: psql(f"INSERT INTO employees (nome, unit_id, vinculo, admissao, regime, telefone, email) VALUES ('{nome}', {CAR}, 'CLT', '2023-03-01', 'DOCENTE', '67999990000', 'lia@exemplo.com')")
LIA, RUI = (psql(f"SELECT id FROM employees WHERE nome='{n}'") for n in ["Lia Professora", "Rui Auxiliar"])
psql(f"INSERT INTO schedules (employee_id, vigencia_inicio, seg, ter, qua, qui, sex, horarios) VALUES ({LIA}, '2023-03-01', 300, 300, 300, 300, 300, '07:00–12:00')")
psql(f"INSERT INTO hour_entries (employee_id, data, minutos, tipo, descricao, status) VALUES ({LIA}, '{d(-5)}', 90, 'EXTRA', 'Reunião de pais', 'APROVADO'), ({LIA}, '{d(-3)}', -20, 'ATRASO', 'Ponto', 'PENDENTE')")
html = page("/configuracoes", RH); aid_user = aid_of(html, "Criar acesso")
def criar_user(nome, email, role, unit="", emp=""):
    post("/configuracoes", aid_user, {"nome": nome, "email": email, "role": role, "unitId": unit, "employeeId": emp, "senha": "senha12345"}, RH); return psql(f"SELECT id FROM users WHERE email='{email}'")
ULIA = criar_user("Lia", "lia@car", "COLABORADOR", "", LIA); UDG = criar_user("Diretora Geral", "dg@rede", "DIRECAO"); USEC = criar_user("Secretaria", "sec@car", "COMERCIAL", CAR); UGES = criar_user("Gestor", "ges@car", "GESTOR", CAR)
LS = login("lia@car", "senha12345"); DG = login("dg@rede", "senha12345"); SEC = login("sec@car", "senha12345"); GE = login("ges@car", "senha12345")
RH_ID = psql("SELECT id FROM users WHERE email='rh@colegiostatus'")
ok("colaboradora com jornada e banco de horas, Direção, secretaria e gestor")

print("Portal do colaborador (T-104)")
r = LS.get(B + "/", allow_redirects=False); assert r.status_code in (302, 303, 307) and r.headers["location"].endswith("/eu"), r.headers.get("location")
he = page("/eu", LS)
for t in ["Olá, Lia", "Hoje", "Saldo do banco de horas", "+1h30", "1 lançamento(s) aguardando aprovação", "Férias disponíveis", "Meu espelho de ponto", "Minhas solicitações", "Documentos e ciências", "Holerites e comprovantes", "Meus dados de contato"]: assert t in he, t
aid_f = aid_of(he, 'name="tipo" value="FERIAS"')
erro(post("/eu", aid_f, {"employeeId": LIA, "tipo": "FERIAS", "inicio": d(40), "fim": d(42), "voltar": "/eu"}, LS), "5 dias")
loc = post("/eu", aid_f, {"employeeId": LIA, "tipo": "FERIAS", "inicio": d(40), "fim": d(49), "voltar": "/eu"}, LS); assert "erro=" not in loc, loc
assert psql(f"SELECT status || '|' || dias FROM leave_requests WHERE employee_id={LIA} AND tipo='FERIAS'") == "SOLICITADA|10"
erro(post("/eu", aid_f, {"employeeId": RUI, "tipo": "FOLGA_BANCO", "inicio": d(10), "fim": d(10), "voltar": "/eu"}, LS), "Sem acesso")
assert "Aguardando aprovação" in page("/eu", LS)
aid_c = aid_of(he, 'name="contatoEmergencia"')
erro(post("/eu", aid_c, {"telefone": "123", "email": "lia@exemplo.com"}, LS), "Telefone")
okmsg(post("/eu", aid_c, {"telefone": "(67) 98888-7777", "email": "lia.nova@exemplo.com", "endereco": "Rua Fictícia, 100", "contatoEmergencia": "Mãe — (67) 97777-0000"}, LS), "Contato atualizado")
assert psql(f"SELECT telefone || '|' || email || '|' || contato_emergencia FROM employees WHERE id={LIA}") == "(67) 98888-7777|lia.nova@exemplo.com|Mãe — (67) 97777-0000"
assert psql("SELECT count(*) FROM audit_log WHERE acao='atualizar o próprio contato (portal do colaborador)'") == "1"
psql(f"INSERT INTO timesheet_days (employee_id, data, esperado_min, trabalhado_min, status, marcacoes, origem) VALUES ({LIA}, '{d(-1) if HOJE.day > 1 else H}', 300, 320, 'NORMAL', '06:55 12:15', 'IMPORTACAO')")
csv = LS.get(B + f"/api/export/meu-espelho?mes={(d(-1) if HOJE.day > 1 else H)[:7]}").content.decode("utf-8-sig"); assert "Lia Professora" in csv and "06:55 12:15" in csv and "Rui" not in csv
assert RH.get(B + "/api/export/meu-espelho").status_code in (302, 303, 307, 403), "sem ficha de colaborador não exporta espelho"
ok("Meu espaço: saldo e pendentes do banco, espelho com marcações (CSV só do próprio), pedido de férias na alçada normal (regra dos 5 dias; ninguém pede pelo colega), contato atualizado com trilha")

print("Portal do candidato (T-106)")
psql(f"INSERT INTO requisitions (titulo, unit_id, status, responsavel_user_id, aberta_em) VALUES ('Professor(a) de Matemática — Demo', {CAR}, 'ABERTA', {RH_ID}, current_date)"); REQ = psql("SELECT id FROM requisitions WHERE titulo LIKE 'Professor(a) de Matemática%'")
psql("INSERT INTO candidates (nome, email, telefone, consentimento_lgpd) VALUES ('Candidata Demo Silva', 'candidata@exemplo.com', '67990000000', true)"); CAND = psql("SELECT id FROM candidates WHERE nome='Candidata Demo Silva'")
psql(f"INSERT INTO applications (requisition_id, candidate_id, etapa, notas, scorecard) VALUES ({REQ}, {CAND}, 'ENTREVISTA_RH', 'NOTA INTERNA SIGILOSA', '{{\"Comunicação\": 4}}'::jsonb)"); APP = psql(f"SELECT id FROM applications WHERE candidate_id={CAND}")
hc = page(f"/recrutamento/candidatos/{CAND}", RH); assert "Portal do candidato — Professor(a) de Matemática — Demo" in hc and "sem link" in hc
okmsg(post(f"/recrutamento/candidatos/{CAND}", aid_of(hc, "Gerar link"), {"applicationId": APP, "dias": "15", "voltar": f"/recrutamento/candidatos/{CAND}"}, RH), "Link gerado")
hc = page(f"/recrutamento/candidatos/{CAND}", RH); m = re.search(r"/candidatura/([A-Za-z0-9_-]{30,})", hc); assert m, "link exibido ao RH"; TK = m.group(1)
assert psql(f"SELECT token_hash FROM candidate_portal_links WHERE application_id={APP} AND status='ATIVO'") == hashlib.sha256(TK.encode()).hexdigest(), "só o hash no banco"
assert TK not in psql("SELECT string_agg(coalesce(depois::text,''), ' ') FROM audit_log"), "token fora da trilha"
PUB = requests.Session(); pc = page(f"/candidatura/{TK}", PUB)
assert "Olá, Candidata" in pc and "Professor(a) de Matemática — Demo" in pc and "Entrevista RH" in pc and "NOTA INTERNA" not in pc and "Comunicação" not in pc.split("Mensagens com o RH")[0]
assert psql(f"SELECT aberto_em IS NOT NULL FROM candidate_portal_links WHERE application_id={APP} AND status='ATIVO'") == "t"
assert "Link indisponível" in page("/candidatura/token-invalido-com-mais-de-vinte-caracteres", PUB)
ok("link pessoal (token só como hash, fora da trilha), aberto sem login; o candidato vê vaga e etapa — nada de notas internas ou scorecard; link inválido explica")
hc = page(f"/recrutamento/candidatos/{CAND}", RH)
okmsg(post(f"/recrutamento/candidatos/{CAND}", aid_of(hc, 'name="tipos"'), {"applicationId": APP, "tipos": ["Currículo atualizado", "CPF"], "voltar": f"/recrutamento/candidatos/{CAND}"}, RH), "2 documento(s) pedido(s)")
DOCS = dict(l.split("|") for l in psql(f"SELECT tipo, id FROM candidate_doc_requests WHERE application_id={APP}").splitlines())
pc = page(f"/candidatura/{TK}", PUB); aid_d = aid_of(pc, 'name="docId"')
pdf = [("arquivo", ("curriculo.pdf", b"%PDF-1.4 curriculo", "application/pdf"))]
loc = post(f"/candidatura/{TK}", aid_d, {"token": TK, "docId": DOCS["CPF"]}, PUB, files=[("arquivo", ("x.txt", b"texto", "text/plain"))]); assert "erro=" in loc and "PDF" in unq(loc), loc
okmsg(post(f"/candidatura/{TK}", aid_d, {"token": TK, "docId": DOCS["Currículo atualizado"]}, PUB, files=pdf))
assert psql(f"SELECT status FROM candidate_doc_requests WHERE id={DOCS['Currículo atualizado']}") == "ENVIADO"; AX = psql(f"SELECT id FROM attachments WHERE entidade='candidate_doc' AND entidade_id={DOCS['Currículo atualizado']}")
assert RH.get(B + f"/api/anexos/{AX}").status_code == 200 and GE.get(B + f"/api/anexos/{AX}").status_code == 403 and PUB.get(B + f"/api/anexos/{AX}", allow_redirects=False).status_code in (302, 303, 307)
assert psql(f"SELECT count(*) FROM notifications WHERE user_id={RH_ID} AND titulo='Documento enviado pelo portal do candidato'") == "1" and "Candidata" not in psql(f"SELECT texto FROM notifications WHERE user_id={RH_ID} AND titulo='Documento enviado pelo portal do candidato'")
hc = page(f"/recrutamento/candidatos/{CAND}", RH); aid_cf = aid_of(hc, "Pedir outro arquivo")
erro(post(f"/recrutamento/candidatos/{CAND}", aid_cf, {"docId": DOCS["Currículo atualizado"], "decisao": "RECUSADO", "voltar": f"/recrutamento/candidatos/{CAND}"}, RH), "o que precisa mudar")
okmsg(post(f"/recrutamento/candidatos/{CAND}", aid_cf, {"docId": DOCS["Currículo atualizado"], "decisao": "RECUSADO", "motivo": "Arquivo ilegível, envie em PDF nítido", "voltar": f"/recrutamento/candidatos/{CAND}"}, RH))
pc = page(f"/candidatura/{TK}", PUB); assert "O RH pediu outro arquivo: Arquivo ilegível" in pc
okmsg(post(f"/candidatura/{TK}", aid_d, {"token": TK, "docId": DOCS["Currículo atualizado"]}, PUB, files=pdf))
okmsg(post(f"/recrutamento/candidatos/{CAND}", aid_cf, {"docId": DOCS["Currículo atualizado"], "decisao": "ACEITO", "voltar": f"/recrutamento/candidatos/{CAND}"}, RH))
hv = page(f"/recrutamento/vagas/{REQ}", RH); assert "1 documento(s) aguardando o candidato" in hv
ok("documentos pedidos pelo RH, enviados no portal (só PDF/JPG/PNG), recusados com motivo e reenviados; arquivo restrito ao RH; aviso ao RH sem dado do candidato; pipeline mostra o que falta")
hc = page(f"/recrutamento/candidatos/{CAND}", RH); aid_h = aid_of(hc, 'name="duracao"')
erro(post(f"/recrutamento/candidatos/{CAND}", aid_h, {"applicationId": APP, "inicio": [f"{d(-1)}T10:00"], "duracao": "45", "voltar": f"/recrutamento/candidatos/{CAND}"}, RH), "já passou")
okmsg(post(f"/recrutamento/candidatos/{CAND}", aid_h, {"applicationId": APP, "inicio": [f"{d(3)}T10:00", f"{d(4)}T15:30"], "duracao": "45", "local": "Unidade Carandá — coordenação", "voltar": f"/recrutamento/candidatos/{CAND}"}, RH), "2 horário(s)")
pc = page(f"/candidatura/{TK}", PUB); assert "Escolha um dos horários" in pc and "2 horário(s) de entrevista oferecido(s)" in pc
S2 = psql(f"SELECT id FROM interview_slots WHERE application_id={APP} AND inicio::date='{d(4)}'")
okmsg(post(f"/candidatura/{TK}", aid_of(pc, "Confirmar horário"), {"token": TK, "slotId": S2}, PUB), "horario")
assert psql(f"SELECT string_agg(status, ',' ORDER BY inicio) FROM interview_slots WHERE application_id={APP}") == "DESCARTADO,ESCOLHIDO"
loc = post(f"/candidatura/{TK}", aid_of(pc, "Confirmar horário"), {"token": TK, "slotId": S2}, PUB); assert "erro=" in loc, loc
assert "Confirmada:" in page(f"/candidatura/{TK}", PUB) and "entrevista" in page(f"/recrutamento/vagas/{REQ}", RH)
ok("horários oferecidos (nunca no passado); o candidato escolhe um, os outros saem; não escolhe duas vezes; vaga mostra a entrevista marcada")
pc = page(f"/candidatura/{TK}", PUB); okmsg(post(f"/candidatura/{TK}", aid_of(pc, "Enviar mensagem"), {"token": TK, "texto": "Posso levar o portfólio impresso?"}, PUB), "msg")
hc = page(f"/recrutamento/candidatos/{CAND}", RH); assert "Posso levar o portfólio impresso?" in hc
okmsg(post(f"/recrutamento/candidatos/{CAND}", aid_of(hc, 'name="texto"'), {"applicationId": APP, "texto": "Pode sim, traga o portfólio.", "voltar": f"/recrutamento/candidatos/{CAND}"}, RH))
pc = page(f"/candidatura/{TK}", PUB); assert "Pode sim, traga o portfólio." in pc and "RH do Colégio Status" in pc
ok("conversa registrada nos dois lados (linha do tempo da candidatura)")
loc = post(f"/candidatura/{TK}", aid_of(pc, "Retirar"), {"token": TK}, PUB); assert "erro=" in loc, loc
okmsg(post(f"/candidatura/{TK}", aid_of(pc, "Pedir a exclusão"), {"token": TK}, PUB), "exclusao")
assert psql(f"SELECT tipo || '|' || titular_tipo || '|' || canal || '|' || identidade_verificada FROM privacy_requests WHERE titular_nome='Candidata Demo Silva'") == "ANONIMIZACAO_ELIMINACAO|CANDIDATO|PORTAL_CANDIDATO|true"
pc = page(f"/candidatura/{TK}", PUB); assert "Pedido de exclusão registrado" in pc
okmsg(post(f"/candidatura/{TK}", aid_of(pc, "Retirar"), {"token": TK, "confirmo": "1", "motivo": "Aceitei outra proposta"}, PUB), "retirada")
assert psql(f"SELECT etapa || '|' || (retirada_em IS NOT NULL) FROM applications WHERE id={APP}") == "DESISTIU|true" and "Candidatura retirada" in page(f"/candidatura/{TK}", PUB)
okmsg(post(f"/recrutamento/candidatos/{CAND}", aid_of(page(f"/recrutamento/candidatos/{CAND}", RH), "Revogar link"), {"applicationId": APP, "voltar": f"/recrutamento/candidatos/{CAND}"}, RH))
assert "Link indisponível" in page(f"/candidatura/{TK}", PUB)
ok("pedido de exclusão vira pedido de titular LGPD (identidade confirmada pelo link); retirada exige confirmação; link revogado deixa de abrir")

print("Comunicação em massa (CRQ-COM-V3-01)")
setting("comunicacao", {"massaMinDestinatarios": 3, "horarioComercial": {"inicio": "00:00", "fim": "23:59", "dias": [0, 1, 2, 3, 4, 5, 6]}})
hc = page("/comunicacao/comunicados", RH); aid_pub = aid_of(hc, 'name="requerCiencia"')
okmsg(post("/comunicacao/comunicados", aid_pub, {"titulo": "Reunião geral de planejamento", "texto": "Sábado, 8h, auditório.", "publico": "TODOS"}, RH), "comunicação em massa")
CM = psql("SELECT id FROM announcements WHERE titulo='Reunião geral de planejamento'"); assert psql(f"SELECT status FROM announcements WHERE id={CM}") == "AGUARDANDO_APROVACAO"
assert "Reunião geral de planejamento" not in page("/comunicacao/comunicados", LS) and psql(f"SELECT count(*) FROM notifications WHERE titulo='Comunicado: Reunião geral de planejamento'") == "0"
hc = page("/comunicacao/comunicados", RH); assert "Você é o autor" in hc
aid_dec = aid_of(page("/comunicacao/comunicados", DG), "Aprovar e publicar")
erro(post("/comunicacao/comunicados", aid_dec, {"id": CM, "decisao": "APROVAR"}, RH), "Quem escreveu")
erro(post("/comunicacao/comunicados", aid_dec, {"id": CM, "decisao": "APROVAR"}, SEC), "Direção ou RH")
okmsg(post("/comunicacao/comunicados", aid_dec, {"id": CM, "decisao": "APROVAR"}, DG), "publicado para")
assert psql(f"SELECT status || '|' || aprovado_por FROM announcements WHERE id={CM}") == f"PUBLICADO|{UDG}" and int(psql(f"SELECT count(*) FROM notifications WHERE titulo='Comunicado: Reunião geral de planejamento'")) >= 3
assert "Reunião geral de planejamento" in page("/comunicacao/comunicados", LS)
setting("comunicacao", {"horarioComercial": {"inicio": "07:00", "fim": "19:00", "dias": []}})
okmsg(post("/comunicacao/comunicados", aid_pub, {"titulo": "Aviso de manutenção", "texto": "Sem internet na sexta.", "publico": "TODOS"}, RH)); CM2 = psql("SELECT id FROM announcements WHERE titulo='Aviso de manutenção'")
okmsg(post("/comunicacao/comunicados", aid_dec, {"id": CM2, "decisao": "APROVAR"}, DG), "Fora do horário comercial")
assert psql(f"SELECT status FROM announcements WHERE id={CM2}") == "AGENDADO" and "Aviso de manutenção" not in page("/comunicacao/comunicados", LS)
setting("comunicacao", {"horarioComercial": {"inicio": "00:00", "fim": "23:59", "dias": [0, 1, 2, 3, 4, 5, 6]}}); psql(f"UPDATE announcements SET disparo_em=now() - interval '1 minute' WHERE id={CM2}")
r = requests.get(B + f"/api/tarefas?token={TOKEN}"); assert r.json()["ok"], r.text[:300]
assert psql(f"SELECT status FROM announcements WHERE id={CM2}") == "PUBLICADO"
okmsg(post("/comunicacao/comunicados", aid_pub, {"titulo": "Rascunho ruim", "texto": "x", "publico": "TODOS"}, RH)); CM3 = psql("SELECT id FROM announcements WHERE titulo='Rascunho ruim'")
hd = page("/comunicacao/comunicados", DG); erro(post("/comunicacao/comunicados", aid_dec, {"id": CM3, "decisao": "REJEITAR", "motivo": "ok"}, DG), "motivo")
okmsg(post("/comunicacao/comunicados", aid_dec, {"id": CM3, "decisao": "REJEITAR", "motivo": "Texto incompleto"}, DG), "rejeitado")
ok("comunicado para muita gente aguarda o segundo aprovador (nunca o autor, só Direção/RH); aprovado em horário comercial publica e notifica; fora dele agenda e a rotina publica na janela; rejeição com motivo avisa o autor")
psql("INSERT INTO message_templates (codigo, titulo, categoria, canal, texto, ativo) VALUES ('REUNIAO_PAIS', 'Convite reunião de pais', 'PEDAGOGICO', 'WHATSAPP', 'Olá, {responsavel}! Convidamos para a reunião de pais de {aluno} ({turma}). {assinatura}', true), ('INATIVO', 'Modelo antigo', 'GERAL', 'WHATSAPP', 'x', false)")
TPL, TPLX = (psql(f"SELECT id FROM message_templates WHERE codigo='{c}'") for c in ["REUNIAO_PAIS", "INATIVO"])
psql(f"INSERT INTO students (nome, responsavel, telefone, aluno_atual, unit_atual_id) VALUES ('Aluno Demo Um', 'Responsável Demo A', '(67) 99111-0001', true, {CAR}), ('Aluno Demo Dois', 'Responsável Demo A', '67991110001', true, {CAR}), ('Aluno Demo Três', 'Responsável Demo B', '(67) 99111-0003', true, {CAR}), ('Aluno Demo Quatro', 'Responsável Demo C', NULL, true, {CAR})")
hm = page(f"/comunicacao/massa?ver=1&canal=WHATSAPP&publico=FAMILIAS&modelo={TPL}", SEC)
assert "<b>2</b> destinatário(s)" in hm and "1 sem contato ficam de fora" in hm and "Olá, Responsável Demo A! Convidamos para a reunião de pais de Aluno Demo" in hm
aid_cc = aid_of(hm, "Enviar para aprovação")
erro(post("/comunicacao/massa", aid_cc, {"canal": "WHATSAPP", "publico": "FAMILIAS", "templateId": ""}, SEC), "modelo aprovado")
erro(post("/comunicacao/massa", aid_cc, {"canal": "WHATSAPP", "publico": "FAMILIAS", "templateId": TPLX}, SEC), "modelo aprovado")
loc = post("/comunicacao/massa", aid_cc, {"canal": "WHATSAPP", "publico": "FAMILIAS", "templateId": TPL, "titulo": "Reunião de pais — outubro"}, SEC); okmsg(loc, "Nada sai antes disso")
CP = re.search(r"/comunicacao/massa/(\d+)", loc).group(1); assert psql(f"SELECT status || '|' || total FROM message_campaigns WHERE id={CP}") == "AGUARDANDO_APROVACAO|2" and psql(f"SELECT count(*) FROM messages WHERE campaign_id={CP}") == "0"
hp = page(f"/comunicacao/massa/{CP}", RH); aid_cd = aid_of(hp, "Aprovar envio para")
erro(post(f"/comunicacao/massa/{CP}", aid_cd, {"id": CP, "decisao": "APROVAR"}, SEC), "Direção ou RH")
okmsg(post(f"/comunicacao/massa/{CP}", aid_cd, {"id": CP, "decisao": "APROVAR"}, RH), "Aprovado e disparado: 2 destinatário(s)")
assert psql(f"SELECT status || '|' || registradas FROM message_campaigns WHERE id={CP}") == "DISPARADA|2" and psql(f"SELECT count(*) FROM messages WHERE campaign_id={CP} AND status='REGISTRADA'") == "2"
hp = page(f"/comunicacao/massa/{CP}", SEC); assert "abrir WhatsApp" in hp and "a enviar pelo link" in hp
assert "Responsável Demo A! Convidamos para a reunião de pais de Aluno Demo" in psql(f"SELECT texto FROM messages WHERE campaign_id={CP} ORDER BY id LIMIT 1")
ok("envio em massa: prévia (irmãos com o mesmo contato recebem uma vez, sem contato fica de fora), só com modelo aprovado e ativo, aprovação de outra pessoa; disparado vira histórico com link de envio (sem API do WhatsApp)")

print("Revisão de POP por exceção repetida (CRQ-PRJ-V3-03)")
psql(f"INSERT INTO procedures (codigo, titulo, area, owner_user_id, status, versao, passos, publicado_em) VALUES ('POP-FIN-07', 'Desconto por pagamento antecipado', 'Financeiro', {RH_ID}, 'VIGENTE', 1, '1. Conferir', now())"); POP = psql("SELECT id FROM procedures WHERE codigo='POP-FIN-07'")
for k in range(3): psql(f"INSERT INTO exceptions (procedure_id, regra, motivo, solicitante_user_id, unit_id) VALUES ({POP}, 'POP-FIN-07 Desconto por pagamento antecipado', 'Caso excepcional da família', {USEC}, {CAR})")
EX = psql(f"SELECT string_agg(id::text, ',' ORDER BY id) FROM exceptions WHERE procedure_id={POP}").split(",")
he = page("/governanca/excecoes", DG); aid_ex = aid_of(he, ">Aprovar<")
for i, x in enumerate(EX):
    okmsg(post("/governanca/excecoes", aid_ex, {"id": x, "decisao": "APROVADA"}, DG))
    assert psql(f"SELECT count(*) FROM procedure_reviews WHERE procedure_id={POP} AND status='ABERTA'") == ("1" if i == 2 else "0")
assert psql(f"SELECT jsonb_array_length(evidencias) || '|' || dono_user_id || '|' || (prazo = current_date + 30) FROM procedure_reviews WHERE procedure_id={POP}") == f"3|{RH_ID}|true"
assert psql(f"SELECT count(*) FROM notifications WHERE user_id={RH_ID} AND titulo LIKE 'Revisão de POP aberta: POP-FIN-07%'") == "1"
hpop = page(f"/governanca/pops/{POP}", RH); assert "Revisão aberta por exceção repetida" in hpop
assert "Revisões de POP por exceção repetida" in page("/governanca/excecoes", RH)
okmsg(post(f"/governanca/pops/{POP}", aid_of(hpop, "Publicar nova versão"), {"id": POP, "notas": "Desconto antecipado agora tem regra para casos de família"}, RH))
assert psql(f"SELECT status || '|' || desfecho || '|' || versao_publicada FROM procedure_reviews WHERE procedure_id={POP}") == "CONCLUIDA|NOVA_VERSAO|2"
psql(f"INSERT INTO exceptions (regra, motivo, solicitante_user_id, status, aprovador_user_id) VALUES ('Prazo de matrícula', 'Prazo legal ou regulatório', {USEC}, 'APROVADA', {UDG}), ('Prazo de matrícula', 'Prazo legal ou regulatório', {USEC}, 'APROVADA', {UDG}), ('prazo de matrícula ', 'Prazo legal ou regulatório', {USEC}, 'APROVADA', {UDG})")
r = requests.get(B + f"/api/tarefas?token={TOKEN}"); assert r.json()["ok"], r.text[:300]
RV = psql("SELECT id FROM procedure_reviews WHERE procedure_id IS NULL AND status='ABERTA'"); assert RV, "rotina abre a revisão de regra sem POP"
he = page("/governanca/excecoes", RH); aid_cr = aid_of(he, 'name="desfecho"')
erro(post("/governanca/excecoes", aid_cr, {"id": RV, "desfecho": "MANTIDO", "obs": "curto", "voltar": "/governanca/excecoes"}, RH), "Justifique")
okmsg(post("/governanca/excecoes", aid_cr, {"id": RV, "desfecho": "VIROU_REGRA", "obs": "Prorrogação legal virou regra no calendário de matrícula", "voltar": "/governanca/excecoes"}, RH), "concluída")
ok("três exceções iguais aprovadas abrem a revisão do POP (evidências, dono, prazo de 30 dias, aviso); nova versão publicada fecha a revisão; regra sem POP entra pela rotina; concluir sem mudar exige justificativa")

print("Parâmetros da comunicação em massa (só a Direção)")
hc = page("/configuracoes", DG); aid_m = aid_of(hc, 'name="minimo"')
dados_m = {"secao": "massa", "minimo": "25", "inicio": "08:00", "fim": "18:00", "dias": ["1", "2", "3", "4", "5"], "aprovadores": ["DIRECAO"]}
erro(post("/configuracoes", aid_m, dados_m, RH), "só a Direção")
erro(post("/configuracoes", aid_m, {**dados_m, "fim": "07:00"}, DG), "depois do início")
okmsg(post("/configuracoes", aid_m, dados_m, DG), "comunicação em massa salvas")
assert psql("SELECT (value->>'massaMinDestinatarios') || '|' || (value->'aprovadoresMassa')::text || '|' || (value->'horarioComercial')::text FROM settings WHERE key='comunicacao'") == '25|["DIRECAO"]|{"fim": "18:00", "dias": [1, 2, 3, 4, 5], "inicio": "08:00"}'
ok("comunicação em massa: a partir de quantas pessoas, quem aprova e o horário de disparo — só a Direção altera, com validação")

print(f"\ne2e_portais_massa: todas as verificações OK ({N[0]} blocos)")
