# E2E — Privacidade (LGPD) e canal de ética (v22): encarregado e prazos, portal do titular (pedido sem login, protocolo + código,
# acompanhamento com limite de tentativas), tratamento com identidade conferida, autorizações de imagem (registro, revogação avisa
# marketing, lista para fotos, versão do texto), incidentes (prazo em dias úteis com feriado, decisão de comunicar, registro imutável),
# canal de ética anônimo (impedimento automático de quem é citado, conversa com quem relatou, encerramento, regras e treinamento).
import re, subprocess, requests
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
B = "http://localhost:3100"; TOKEN = "setup-homologacao-2026-status"
def psql(q): return subprocess.run(["su", "postgres", "-c", f"/usr/lib/postgresql/16/bin/psql -h /tmp/pg -U status -d status_people -q -t -A -c \"{q.replace(chr(34), chr(92) + chr(34))}\""], capture_output=True, text=True)
def q(sqlq): return psql(sqlq).stdout.strip()
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
def post(path, aid, data, sess=None, files=None):
    sess = sess or S; f = [(f"$ACTION_ID_{aid}", (None, ""))]
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
def login(sess, email, senha):
    html = sess.get(B + "/login").text; aid = re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', html)[0]
    loc = post("/login", aid, {"email": email, "senha": senha}, sess=sess); assert loc.endswith("/"), loc
def erro(loc, trecho): assert "erro=" in loc and trecho in loc, (trecho, loc)
def okmsg(loc, trecho=""): assert "ok=" in loc and trecho in loc, (trecho, loc)
HOJE = datetime.now(ZoneInfo("America/Campo_Grande")).date(); H = HOJE.isoformat()
def d(n): return (HOJE + timedelta(days=n)).isoformat()

print("Preparação")
login(S, "rh@colegiostatus", "Status2026!"); r = S.get(B + f"/api/setup?token={TOKEN}"); assert r.json()["ok"], r.text
CAR, CUL = (q(f"SELECT id FROM units WHERE codigo='{c}'") for c in ["CAR", "CUL"]); RH = q("SELECT id FROM users WHERE email='rh@colegiostatus'")
q(f"INSERT INTO students (nome, aluno_atual, unit_atual_id, responsavel) VALUES ('Ana Priv', true, {CAR}, 'Mãe da Ana'), ('Bia Priv', true, {CUL}, 'Pai da Bia')")
ANA, BIA = (q(f"SELECT id FROM students WHERE nome='{n}'") for n in ["Ana Priv", "Bia Priv"])
html = page("/configuracoes"); aid_user = aid_of(html, "Criar acesso")
def criar_user(nome, email, role, unit=""):
    post("/configuracoes", aid_user, {"nome": nome, "email": email, "role": role, "unitId": unit, "senha": "senha12345"}); return q(f"SELECT id FROM users WHERE email='{email}'")
UDG = criar_user("Diretora Geral", "dg@rede", "DIRECAO"); UDIR = criar_user("Diretora Carandá", "dir@car", "DIRETOR_UNIDADE", CAR); UCOM = criar_user("Marketing e Atendimento", "mkt@rede", "COMERCIAL"); UGC = criar_user("Gestor Cultura", "ges@cul", "GESTOR", CUL)
UDPO = criar_user("Encarregada de Dados", "dpo@rede", "LEITURA"); UPAULO = criar_user("Paulo Souza Lima", "paulo@car", "GESTOR", CAR)
DG = mk(); login(DG, "dg@rede", "senha12345"); DS = mk(); login(DS, "dir@car", "senha12345"); MK = mk(); login(MK, "mkt@rede", "senha12345"); GC = mk(); login(GC, "ges@cul", "senha12345"); DPO = mk(); login(DPO, "dpo@rede", "senha12345"); PA = mk(); login(PA, "paulo@car", "senha12345")
ok("Direção, diretora de unidade, marketing/atendimento, gestor da Cultura, encarregada (perfil leitura) e Paulo (coordenação)")

print("Privacidade: encarregado e prazos")
h = page("/governanca/privacidade"); assert "Encarregado (DPO) não informado" in h; aid_cfg = aid_of(h, 'name="encarregadoNome"')
base = {"encarregadoNome": "Encarregada de Dados", "encarregadoEmail": "dpo@colegiostatus.com.br", "encarregadoTelefone": "67 3000-0000", "dpoUserId": UDPO, "prazoPedidoDias": 15, "prazoIncidenteDiasUteis": 3, "pequenoPorte": "0"}
erro(post("/governanca/privacidade", aid_cfg, {**base, "prazoPedidoDias": 20}), "1 a 15"); erro(post("/governanca/privacidade", aid_cfg, {**base, "encarregadoEmail": "x@"}), "E-mail"); erro(post("/governanca/privacidade", aid_cfg, base, sess=DS), "Só Direção/RH")
okmsg(post("/governanca/privacidade", aid_cfg, base), "salva")
assert "Pedidos em aberto" in page("/governanca/privacidade", sess=DPO) and "Esta área é da Direção" in page("/governanca/privacidade", sess=DS)
ok("encarregado e prazos com limites legais; o usuário do encarregado acessa a área mesmo com perfil leitura; diretora de unidade não")

print("Portal do titular (sem login)")
P = mk(); hp = page("/privacidade", sess=P); assert "Encarregada de Dados" in hp and "dpo@colegiostatus.com.br" in hp; aid_ped = aid_of(hp, "Enviar pedido")
ped = {"tipo": "CONFIRMACAO_ACESSO", "titularNome": "Maria da Silva", "titularTipo": "RESPONSAVEL", "alunoNome": "Ana Priv", "email": "maria@exemplo.com", "descricao": "Quero saber quais dados de minha filha a escola guarda."}
erro(post("/privacidade", aid_ped, {**ped, "email": ""}, sess=P), "e-mail ou telefone")
post("/privacidade", aid_ped, {**ped, "site": "spam"}, sess=P); assert q("SELECT count(*) FROM privacy_requests") == "0"
loc = post("/privacidade", aid_ped, ped, sess=P); assert loc.endswith("enviado=1"), loc
hp = page("/privacidade?enviado=1", sess=P); m = re.search(r"Protocolo: <b>(LGPD-\d{4}-\d{4})</b><br/>Código: <b>([A-Z0-9-]+)</b>", hp); assert m, hp[hp.find("Pedido recebido"):][:400]
PROTO, COD = m.group(1), m.group(2)
row = q(f"SELECT canal || '|' || prazo || '|' || (codigo_hash IS NOT NULL) || '|' || status FROM privacy_requests WHERE protocolo='{PROTO}'"); assert row == f"PORTAL|{d(15)}|true|RECEBIDA", row
assert q(f"SELECT count(*) FROM notifications WHERE titulo='Pedido de titular (LGPD): {PROTO}' AND user_id IN ({RH},{UDG},{UDPO})") == "3"
ok("pedido pelo portal: contato obrigatório, robô ignorado, protocolo + código exibidos uma vez, prazo de 15 dias, Direção/RH/encarregada avisados")
P2 = mk(); ha = page("/privacidade/acompanhar", sess=P2); aid_ac = aid_of(ha, "Consultar")
erro(post("/privacidade/acompanhar", aid_ac, {"protocolo": PROTO, "codigo": "ERRADO"}, sess=P2), "não conferem")
loc = post("/privacidade/acompanhar", aid_ac, {"protocolo": PROTO.lower(), "codigo": COD.lower()}, sess=P2); assert "acompanhar?p=" in loc, loc
h2 = page(loc, sess=P2); assert "Recebido" in h2 and "Confirmação e acesso" in h2
assert "Situação" not in page(f"/privacidade/acompanhar?p={PROTO}", sess=mk())
for _ in range(4): post("/privacidade/acompanhar", aid_ac, {"protocolo": PROTO, "codigo": "X"}, sess=P2)
erro(post("/privacidade/acompanhar", aid_ac, {"protocolo": PROTO, "codigo": COD}, sess=P2), "Muitas tentativas")
ok("acompanhamento: código confere (sem diferenciar maiúsculas), consulta liberada só neste navegador, 5 erros bloqueiam por 15 minutos")

print("Tratamento do pedido")
PID = q(f"SELECT id FROM privacy_requests WHERE protocolo='{PROTO}'"); hd = page(f"/governanca/privacidade/pedidos/{PID}", sess=DPO); aid_up = aid_of(hd, 'name="identidade"')
erro(post(f"/governanca/privacidade/pedidos/{PID}", aid_up, {"id": PID, "status": "RESPONDIDA", "resposta": "curta"}, sess=DPO), "Escreva a resposta")
erro(post(f"/governanca/privacidade/pedidos/{PID}", aid_up, {"id": PID, "status": "RESPONDIDA", "resposta": "Enviamos por e-mail a relação completa dos dados."}, sess=DPO), "Confira a identidade")
okmsg(post(f"/governanca/privacidade/pedidos/{PID}", aid_up, {"id": PID, "status": "RESPONDIDA", "identidade": "1", "resposta": "Enviamos por e-mail a relação completa dos dados e as finalidades.", "nota": "RG conferido na secretaria"}, sess=DPO), "atualizado")
assert q(f"SELECT status || '|' || identidade_verificada || '|' || jsonb_array_length(historico) FROM privacy_requests WHERE id={PID}") == "RESPONDIDA|true|2"
h = page("/governanca/privacidade"); aid_pi = aid_of(h, 'name="recebidoEm"')
okmsg(post("/governanca/privacidade", aid_pi, {"tipo": "REVOGACAO_CONSENTIMENTO", "canal": "EMAIL", "titularNome": "Mãe da Ana", "titularTipo": "RESPONSAVEL", "alunoNome": "Ana Priv", "recebidoEm": d(-5), "descricao": "Revogo o uso de imagem"}), "registrado")
assert q("SELECT prazo FROM privacy_requests WHERE tipo='REVOGACAO_CONSENTIMENTO'") == d(10)
ok("responder exige texto e identidade conferida (acesso aos dados); histórico; pedido recebido por e-mail há 5 dias vence em 10")

print("Autorizações de imagem")
F_REDES, F_DIV = (q(f"SELECT id FROM consent_purposes WHERE codigo='{c}'") for c in ["IMAGEM_REDES", "DIVULGACAO_RESULTADOS"])
ha = page(f"/matriculas/alunos/{ANA}", sess=MK); assert "Autorizações de imagem e divulgação" in ha; aid_con = aid_of(ha, "Registrar autorização ou revogação")
V = f"/matriculas/alunos/{ANA}"
okmsg(post(V, aid_con, {"studentId": ANA, "purposeId": F_REDES, "status": "CONCEDIDO", "titularNome": "Mãe da Ana Souza", "voltar": V}, sess=MK), "registrada")
erro(post(V, aid_con, {"studentId": ANA, "purposeId": F_DIV, "status": "REVOGADO", "titularNome": "Mãe da Ana Souza", "voltar": V}, sess=MK), "Só se revoga")
erro(post(V, aid_con, {"studentId": ANA, "purposeId": F_REDES, "status": "CONCEDIDO", "titularNome": "Mãe", "voltar": V}, sess=MK), "Nome completo")
erro(post(V, aid_con, {"studentId": ANA, "purposeId": F_REDES, "status": "CONCEDIDO", "titularNome": "Mãe da Ana Souza", "voltar": V}, sess=GC), "Sem acesso")
lc = page(f"/governanca/privacidade/consentimentos?finalidade={F_REDES}&so=COM", sess=MK); assert "Ana Priv" in lc and "Bia Priv" not in lc
okmsg(post(V, aid_con, {"studentId": ANA, "purposeId": F_REDES, "status": "REVOGADO", "titularNome": "Mãe da Ana Souza", "origem": "PEDIDO_TITULAR", "voltar": V}, sess=MK), "marketing e direção avisados")
assert q(f"SELECT count(DISTINCT user_id) FROM notifications WHERE titulo='Autorização revogada: Ana Priv' AND tipo='ALERTA' AND user_id IN ({UCOM},{UDIR},{UDG})") == "3"
lc = page(f"/governanca/privacidade/consentimentos?finalidade={F_REDES}&so=SEM", sess=MK); assert "2 aluno(s) sem autorização" in lc and "Ana Priv" in lc and "Bia Priv" in lc
assert q(f"SELECT string_agg(status, ',' ORDER BY id) FROM consents WHERE student_id={ANA}") == "CONCEDIDO,REVOGADO"
h = page("/governanca/privacidade"); aid_fin = aid_of(h, "Salvar finalidade")
okmsg(post("/governanca/privacidade", aid_fin, {"id": F_REDES, "titulo": "Imagem e voz nas redes sociais e no site", "texto": "Autorizo o uso da imagem e da voz do(a) aluno(a) no site e nas redes sociais oficiais, sem fins comerciais. Posso revogar quando quiser.", "ativo": "1", "naRematricula": "1", "ordem": 0}), "versão 2")
okmsg(post(V, aid_con, {"studentId": ANA, "purposeId": F_REDES, "status": "CONCEDIDO", "titularNome": "Mãe da Ana Souza", "voltar": V}, sess=MK), "registrada")
assert q(f"SELECT versao FROM consents WHERE student_id={ANA} ORDER BY id DESC LIMIT 1") == "2"
ok("autorização registrada pela secretaria (com escopo); só se revoga o que foi autorizado; revogação avisa marketing, diretora e Direção; lista para fotos; novo texto = nova versão")

print("Incidente de dados")
h = page("/governanca/privacidade"); aid_inc = aid_of(h, 'name="cienciaEm"')
erro(post("/governanca/privacidade", aid_inc, {"titulo": "Planilha enviada ao e-mail errado"}, sess=DPO), "ciência")
erro(post("/governanca/privacidade", aid_inc, {"titulo": "Planilha enviada ao e-mail errado", "cienciaEm": f"{d(2)}T10:00"}, sess=DPO), "futuro")
loc = post("/governanca/privacidade", aid_inc, {"titulo": "Planilha enviada ao e-mail errado", "cienciaEm": "2026-09-04T10:00", "unitId": CAR, "titulares": 30, "categorias": ["Dados cadastrais de alunos", "Dados de responsáveis"], "criancas": "1", "medidas": "Pedido de exclusão ao destinatário"}, sess=DPO)
IID = re.search(r"/incidentes/(\d+)", loc).group(1)
assert q(f"SELECT ciencia_em::text FROM privacy_incidents WHERE id={IID}") == "2026-09-04 14:00:00"  # 10:00 em Campo Grande = 14:00 UTC
assert q("SELECT count(*) FROM notifications WHERE titulo LIKE '%Planilha enviada%' OR texto LIKE '%Planilha enviada%'") == "0"
assert q(f"SELECT string_agg(user_id::text, ',' ORDER BY user_id) FROM notifications WHERE titulo LIKE 'Incidente de dados registrado:%' AND link='/governanca/privacidade/incidentes/{IID}'") == ",".join(sorted([RH, UDG], key=int))
assert q(f"SELECT prazo_anpd || '|' || codigo FROM privacy_incidents WHERE id={IID}") == f"2026-09-10|INC-{H[:4]}-0001", "prazo: 3 dias úteis pulando o feriado de 07/09"
hi = page(f"/governanca/privacidade/incidentes/{IID}", sess=DPO); assert "Prazo vencido" in hi and "04/09/2026, 10:00" in hi, "ciência exibida no horário da escola"; aid_ui = aid_of(hi, 'name="justificativa"')
erro(post(f"/governanca/privacidade/incidentes/{IID}", aid_ui, {"id": IID, "risco": "BAIXO", "comunicar": "0", "justificativa": "curta"}, sess=DPO), "justificativa")
erro(post(f"/governanca/privacidade/incidentes/{IID}", aid_ui, {"id": IID, "risco": "RELEVANTE", "comunicar": "0", "justificativa": "Destinatário confirmou a exclusão sem abrir o arquivo."}, sess=DPO), "obrigatória")
erro(post(f"/governanca/privacidade/incidentes/{IID}", aid_ui, {"id": IID, "status": "ENCERRADO"}, sess=DPO), "avaliação de risco")
okmsg(post(f"/governanca/privacidade/incidentes/{IID}", aid_ui, {"id": IID, "risco": "RELEVANTE", "comunicar": "1", "comunicadoTitularesEm": f"{d(-1)}T09:00"}, sess=DPO), "atualizado")
erro(post(f"/governanca/privacidade/incidentes/{IID}", aid_ui, {"id": IID, "status": "ENCERRADO"}, sess=DPO), "ANPD foi comunicada")
okmsg(post(f"/governanca/privacidade/incidentes/{IID}", aid_ui, {"id": IID, "comunicadoAnpdEm": f"{d(-1)}T15:00", "status": "ENCERRADO", "causa": "Autocompletar do e-mail"}, sess=DPO), "atualizado")
erro(post(f"/governanca/privacidade/incidentes/{IID}", aid_ui, {"id": IID, "nota": "x"}, sess=DPO), "encerrado")
assert "Registro protegido" in psql(f"DELETE FROM privacy_incidents WHERE id={IID}").stderr
q("UPDATE settings SET value = value || '{\"pequenoPorte\": true}'::jsonb WHERE key='privacidade'")
loc = post("/governanca/privacidade", aid_inc, {"titulo": "Notebook da secretaria furtado", "cienciaEm": "2026-09-04T10:00"}, sess=DPO); I2 = re.search(r"/incidentes/(\d+)", loc).group(1)
assert q(f"SELECT prazo_anpd FROM privacy_incidents WHERE id={I2}") == "2026-09-15"
ok("incidente: horário da ciência guardado em UTC e exibido como digitado; aviso sem o conteúdo, para os perfis de privacidade; prazo de 3 dias úteis pula fim de semana e feriado (em dobro para pequeno porte); não comunicar exige justificativa e é proibido com risco relevante; encerrar exige avaliação e comunicação registradas; registro não pode ser apagado")

print("Canal de ética: comitê")
h = page("/governanca/etica", sess=DG); aid_ce = aid_of(h, 'name="prazoTriagemDias"')
erro(post("/governanca/etica", aid_ce, {"comite": [UDG, RH, UPAULO], "prazoTriagemDias": 5, "prazoConclusaoDias": 60}), "Só a Direção")
erro(post("/governanca/etica", aid_ce, {"comite": [UDG, UDPO], "prazoTriagemDias": 5, "prazoConclusaoDias": 60}, sess=DG), "usuários ativos de gestão")
okmsg(post("/governanca/etica", aid_ce, {"comite": [UDG, RH, UPAULO], "prazoTriagemDias": 5, "prazoConclusaoDias": 60}, sess=DG), "salvos")
assert page("/governanca/etica", expect=307, sess=DS) is not None
ok("comitê definido só pela Direção, só com usuários de gestão; quem não é do comitê nem Direção/RH não acessa")

print("Relato anônimo")
E = mk(); he = page("/etica", sess=E); assert "não registramos seu endereço de rede" in he; aid_rel = aid_of(he, "Enviar relato")
rel = {"categoria": "ASSEDIO_MORAL", "relato": "Na reunião de sexta, o coordenador humilhou uma professora na frente da equipe, com gritos e ameaças de demissão.", "envolvidos": "Paulo Lima (coordenação)", "unitId": CAR, "relacao": "COLABORADOR"}
erro(post("/etica", aid_rel, {**rel, "relato": "curto"}, sess=E), "Descreva"); erro(post("/etica", aid_rel, {**rel, "identificar": "1", "nome": "X"}, sess=E), "nome e um contato")
post("/etica", aid_rel, {**rel, "site": "http://spam"}, sess=E); assert q("SELECT count(*) FROM ethics_reports") == "0"
assert post("/etica", aid_rel, rel, sess=E).endswith("enviado=1")
he = page("/etica?enviado=1", sess=E); m = re.search(r"Protocolo: <b>(ET-[A-Z0-9-]+)</b><br/>Código: <b>([A-Z0-9-]+)</b>", he); assert m; EP, EC = m.group(1), m.group(2)
EID = q(f"SELECT id FROM ethics_reports WHERE protocolo='{EP}'")
assert q(f"SELECT impedidos::text || '|' || anonimo || '|' || prazo_triagem || '|' || prazo_conclusao FROM ethics_reports WHERE id={EID}") == f"[{UPAULO}]|true|{d(5)}|{d(60)}"
assert q(f"SELECT string_agg(user_id::text, ',' ORDER BY user_id) FROM notifications WHERE chave='etica:{EID}'") == ",".join(sorted([RH, UDG], key=int)) and q("SELECT count(*) FROM notifications WHERE texto LIKE '%humilhou%'") == "0"
assert q(f"SELECT count(*) FROM audit_log WHERE entidade='ethics_reports' AND (depois::text LIKE '%humilhou%' OR antes::text LIKE '%humilhou%')") == "0"
ok("relato anônimo com protocolo e código; Paulo (citado como “Paulo Lima”) fica impedido; aviso ao comitê sem o conteúdo; auditoria sem o texto; prazos de triagem e conclusão")
hp = page("/governanca/etica", sess=PA); assert EP not in hp; page(f"/governanca/etica/{EID}", expect=404, sess=PA)
hr = page(f"/governanca/etica/{EID}"); assert "humilhou" in hr and "Paulo Lima (coordenação)" in hr
assert q(f"SELECT count(*) FROM audit_log WHERE acao='ver relato do canal de ética' AND entidade_id={EID} AND user_id={RH}") == "1"
ok("Paulo não vê nem abre o relato (404); o RH abre e o acesso fica auditado")

print("Apuração, conversa e encerramento")
aid_tr = aid_of(hr, 'name="gravidade"')
erro(post(f"/governanca/etica/{EID}", aid_tr, {"id": EID, "status": "EM_APURACAO", "gravidade": 3, "responsavelUserId": UPAULO}), "não estar impedido")
okmsg(post(f"/governanca/etica/{EID}", aid_tr, {"id": EID, "status": "EM_APURACAO", "gravidade": 3, "responsavelUserId": UDG}), "atualizado")
aid_msg = aid_of(hr, 'name="interna"')
okmsg(post(f"/governanca/etica/{EID}", aid_msg, {"id": EID, "interna": "0", "texto": "Recebemos seu relato. Pode informar a data exata da reunião?"}), "Registrado")
okmsg(post(f"/governanca/etica/{EID}", aid_msg, {"id": EID, "interna": "1", "texto": "Ouvir testemunhas da reunião de sexta."}), "Registrado")
E2 = mk(); ha = page("/etica/acompanhar", sess=E2); aid_eac = aid_of(ha, "Consultar")
loc = post("/etica/acompanhar", aid_eac, {"protocolo": EP, "codigo": EC}, sess=E2); he2 = page(loc, sess=E2)
assert "Pode informar a data exata" in he2 and "Ouvir testemunhas" not in he2 and "Em apuração" in he2
aid_den = aid_of(he2, "Enviar mensagem"); assert "ok=1" in post("/etica/acompanhar", aid_den, {"protocolo": EP, "texto": "Foi na sexta, dia 2, às 17h."}, sess=E2)
assert q(f"SELECT count(*) FROM notifications WHERE user_id={UDG} AND titulo='Nova mensagem no canal de ética'") == "1"
erro(post("/etica/acompanhar", aid_den, {"protocolo": EP, "texto": "outra"}, sess=mk()), "Sessão expirada")
ok("triagem com responsável não impedido; mensagem ao denunciante (nota interna fica oculta); resposta anônima avisa o responsável; sem a sessão do código não se escreve")
aid_imp = aid_of(hr, "declarar-me impedido"); assert "marcar impedido" not in hr  # RH não marca colegas
erro(post(f"/governanca/etica/{EID}", aid_imp, {"id": EID, "userId": UDG}), "Só a Direção marca outra pessoa")
okmsg(post(f"/governanca/etica/{EID}", aid_imp, {"id": EID, "userId": UDG}, sess=DG), "declarou impedido")
page(f"/governanca/etica/{EID}", expect=404, sess=DG); assert q(f"SELECT responsavel_user_id IS NULL FROM ethics_reports WHERE id={EID}") == "t"
erro(post(f"/governanca/etica/{EID}", aid_imp, {"id": EID, "userId": RH}), "Não sobraria ninguém")
erro(post(f"/governanca/etica/{EID}", aid_imp, {"id": EID, "userId": UDG, "desfazer": "1"}), "Só a Direção")
hr = page(f"/governanca/etica/{EID}"); aid_enc = aid_of(hr, "Concluir apuração")
erro(post(f"/governanca/etica/{EID}", aid_enc, {"id": EID, "conclusao": "Apuração concluída com oitiva de 3 testemunhas."}), "resultado")
okmsg(post(f"/governanca/etica/{EID}", aid_enc, {"id": EID, "resultado": "PROCEDENTE", "conclusao": "Apuração concluída com oitiva de 3 testemunhas; conduta confirmada.", "medidas": "Advertência formal e acompanhamento", "retorno": "Seu relato foi apurado e as medidas cabíveis foram adotadas. Obrigado."}), "encerrado")
he2 = page(loc, sess=E2); assert "Concluído" in he2 and "medidas cabíveis" in he2 and "Enviar mensagem" not in he2
ok("cada um se declara impedido (membro não marca colegas); impedimento tira a Direção do caso (e da responsabilidade); ninguém fica sem tratar o relato; só a Direção desfaz; conclusão com resultado e retorno a quem relatou")

print("Proteção de criança, arquivamento, relatório, regras e treinamento")
post("/etica", aid_rel, {"categoria": "PROTECAO_ALUNO", "relato": "Uma aluna do 3º ano chega com marcas no braço e disse que apanha em casa.", "relacao": "COLABORADOR"}, sess=E)
E2ID = q("SELECT id FROM ethics_reports WHERE categoria='PROTECAO_ALUNO'"); h = page(f"/governanca/etica/{E2ID}", sess=PA); assert "Conselho Tutelar" in h and "ECA, art. 13" in h
aid_arq = aid_of(h, "Arquivar (fora do escopo)")
erro(post(f"/governanca/etica/{E2ID}", aid_arq, {"id": E2ID, "arquivar": "1", "conclusao": "x"}, sess=PA), "por que o relato é arquivado")
hrel = page("/governanca/etica", sess=DG); assert "Assédio moral" in hrel and "Proteção de crianças e adolescentes" in hrel and "humilhou" not in hrel
aid_reg = aid_of(hrel, "Publicar com ciência obrigatória"); okmsg(post("/governanca/etica", aid_reg, {"o": "comunicado", "texto": "Regras de conduta: não toleramos assédio sexual, assédio moral, discriminação ou violência. Relate pelo canal de ética, de forma anônima se preferir. É proibida a retaliação."}, sess=DG), "ciência obrigatória")
assert q("SELECT requer_ciencia || '|' || (texto LIKE '%/etica%') FROM announcements WHERE titulo='Regras de conduta e canal de ética'") == "true|true"
hrel = page("/governanca/etica", sess=DG); aid_cur = aid_of(hrel, "Criar treinamento anual no Academy"); okmsg(post("/governanca/etica", aid_cur, {"o": "curso"}, sess=DG), "Treinamento anual")
assert q("SELECT tipo || '|' || validade_meses || '|' || para_todos FROM courses WHERE codigo='ETICA-ASSEDIO'") == "OBRIGATORIO|12|true"
erro(post("/governanca/etica", aid_cur, {"o": "curso"}, sess=DG), "já existe")
assert "Registro protegido" in psql(f"DELETE FROM ethics_reports WHERE id={EID}").stderr
erro(post(f"/governanca/etica/{EID}", aid_tr, {"id": EID, "status": "EM_APURACAO"}, sess=PA), "impedido")
ok("relato de proteção à criança traz o dever de comunicar o Conselho Tutelar; arquivamento exige motivo; relatório agregado sem conteúdo; regras com ciência e treinamento anual (Lei 14.457/2022); relato não pode ser apagado; impedido não age")

print("Anexos restritos")
hi = page(f"/governanca/privacidade/pedidos/{PID}", sess=DPO); aid_anx = aid_of(hi, "Anexar")
arq = [("arquivo", ("doc.pdf", b"%PDF-1.4 teste", "application/pdf"))]
okmsg(post(f"/governanca/privacidade/pedidos/{PID}", aid_anx, {"entidade": "privacy_request", "entidadeId": PID, "voltar": f"/governanca/privacidade/pedidos/{PID}"}, sess=DPO, files=arq), "anexado")
AX = q("SELECT id FROM attachments WHERE entidade='privacy_request'")
assert DPO.get(B + f"/api/anexos/{AX}").status_code == 200 and MK.get(B + f"/api/anexos/{AX}").status_code == 403 and DS.get(B + f"/api/anexos/{AX}").status_code == 403
erro(post(f"/governanca/privacidade/pedidos/{PID}", aid_anx, {"entidade": "privacy_request", "entidadeId": PID, "voltar": "/"}, sess=MK, files=arq), "Sem acesso")
erro(post(f"/governanca/privacidade/pedidos/{PID}", aid_anx, {"entidade": "ethics_report", "entidadeId": EID, "voltar": "/"}, sess=PA, files=arq), "Sem acesso")
erro(post(f"/governanca/privacidade/pedidos/{PID}", aid_anx, {"entidade": "privacy_incident", "entidadeId": IID, "voltar": "/"}, sess=DPO, files=arq), "encerrado")
ok("anexo de pedido de titular só para a privacidade (marketing e diretora: 403); impedido não anexa em relato; incidente encerrado não recebe anexo")

print("Endurecimento: impedimento recalculado, limite de envios e páginas públicas")
UGILDA = criar_user("Gilda Gomes", "gilda@car", "GESTOR", CAR); GI = mk(); login(GI, "gilda@car", "senha12345")
E3 = mk(); E3.headers["X-Forwarded-For"] = "198.51.100.20"; he3 = page("/etica", sess=E3); aid_rel3 = aid_of(he3, "Enviar relato")
assert post("/etica", aid_rel3, {"categoria": "CONFLITO_INTERESSE", "relato": "A coordenadora favorece a empresa do marido nas compras de material da unidade há meses.", "envolvidos": "Gilda Gomes", "relacao": "COLABORADOR"}, sess=E3).endswith("enviado=1")
G3 = q("SELECT id FROM ethics_reports WHERE categoria='CONFLITO_INTERESSE'"); assert q(f"SELECT impedidos::text FROM ethics_reports WHERE id={G3}") == "[]"
okmsg(post("/governanca/etica", aid_ce, {"comite": [UDG, RH, UPAULO, UGILDA], "prazoTriagemDias": 5, "prazoConclusaoDias": 60}, sess=DG), "salvos")
page(f"/governanca/etica/{G3}", expect=404, sess=GI); hg = page("/governanca/etica", sess=GI); assert q(f"SELECT protocolo FROM ethics_reports WHERE id={G3}") not in hg
hd = page(f"/governanca/etica/{G3}", sess=DG); aid_des = aid_of(hd, ">desfazer<")
okmsg(post(f"/governanca/etica/{G3}", aid_des, {"id": G3, "userId": UGILDA, "desfazer": "1"}, sess=DG), "desfeito")
assert q(f"SELECT liberados::text FROM ethics_reports WHERE id={G3}") == f"[{UGILDA}]"; page(f"/governanca/etica/{G3}", sess=GI)
okmsg(post(f"/governanca/etica/{G3}", aid_imp, {"id": G3, "userId": UGILDA}, sess=DG), "Impedimento registrado"); page(f"/governanca/etica/{G3}", expect=404, sess=GI)
ok("quem entra no comitê depois e é citado no relato fica impedido na hora (recalculado a cada acesso); só a Direção libera (homônimo) e pode impedir de novo")
E4 = mk(); E4.headers["X-Forwarded-For"] = "203.0.113.77"; aid_rel4 = aid_of(page("/etica", sess=E4), "Enviar relato")
for k in range(5): assert post("/etica", aid_rel4, {"categoria": "OUTRO", "relato": f"Relato número {k} enviado em sequência para testar o limite de envios do canal.", "relacao": "OUTRO"}, sess=E4).endswith("enviado=1")
erro(post("/etica", aid_rel4, {"categoria": "OUTRO", "relato": "Sexto relato da mesma origem na mesma hora deve ser segurado pelo limite.", "relacao": "OUTRO"}, sess=E4), "vários relatos")
E5 = mk(); E5.headers["X-Forwarded-For"] = "203.0.113.88"; assert post("/etica", aid_rel4, {"categoria": "OUTRO", "relato": "Outra origem continua conseguindo relatar normalmente pelo canal de ética.", "relacao": "OUTRO"}, sess=E5).endswith("enviado=1")
assert q("SELECT count(*) FROM ethics_reports WHERE relato LIKE 'Sexto relato%'") == "0" and q("SELECT count(*) FROM login_attempts WHERE email LIKE '%203.0.113%'") == "0"
ok("canal de ética: até 5 relatos por hora da mesma origem (contados só em memória, nada gravado); outra origem segue normal")
E6 = mk(); E6.headers["X-Forwarded-For"] = "203.0.113.120"; aid6 = aid_of(page("/etica", sess=E6), "Enviar relato")
assert post("/etica", aid6, {"categoria": "SEGURANCA", "relato": "A escada dos fundos está sem corrimão há semanas e um aluno já caiu ali.", "relacao": "COLABORADOR"}, sess=E6).endswith("enviado=1")
m6 = re.search(r"Protocolo: <b>(ET-[A-Z0-9-]+)</b><br/>Código: <b>([A-Z0-9-]+)</b>", page("/etica?enviado=1", sess=E6)); P6, C6 = m6.group(1), m6.group(2); I6 = q(f"SELECT id FROM ethics_reports WHERE protocolo='{P6}'")
loc6 = post("/etica/acompanhar", aid_eac, {"protocolo": P6, "codigo": C6}, sess=E6); h6 = page(loc6, sess=E6); aid_m6 = aid_of(h6, "Enviar mensagem")
for k in range(10): assert "ok=1" in post("/etica/acompanhar", aid_m6, {"protocolo": P6, "texto": f"Complemento número {k}."}, sess=E6)
erro(post("/etica/acompanhar", aid_m6, {"protocolo": P6, "texto": "Mais um complemento."}, sess=E6), "várias mensagens")
nm = q(f"SELECT count(*) || '|' || count(DISTINCT user_id) FROM notifications WHERE link='/governanca/etica/{I6}' AND titulo='Nova mensagem no canal de ética'").split("|"); assert int(nm[1]) >= 1 and int(nm[0]) <= 2 * int(nm[1]), nm
hr6 = page(f"/governanca/etica/{I6}", sess=DG); aid_tr6 = aid_of(hr6, 'name="gravidade"')
okmsg(post(f"/governanca/etica/{I6}", aid_tr6, {"id": I6, "status": "RECEBIDA", "responsavelUserId": UDG}, sess=DG), "atualizado"); okmsg(post(f"/governanca/etica/{I6}", aid_tr6, {"id": I6, "status": "RECEBIDA", "responsavelUserId": ""}, sess=DG), "atualizado")
assert q(f"SELECT responsavel_user_id IS NULL FROM ethics_reports WHERE id={I6}") == "t"
erro(post(f"/governanca/etica/{E2ID}", aid_imp, {"id": E2ID, "userId": UDG}, sess=PA), "Só a Direção marca")
UHUGO = criar_user("Hugo Henrique", "hugo@car", "GESTOR", CAR); HU = mk(); login(HU, "hugo@car", "senha12345")
okmsg(post("/governanca/etica", aid_ce, {"comite": [UDG, RH, UPAULO, UGILDA, UHUGO], "prazoTriagemDias": 5, "prazoConclusaoDias": 60}, sess=DG), "salvos"); page("/governanca/etica", sess=HU)
q(f"UPDATE users SET role='COLABORADOR' WHERE id={UHUGO}"); page("/governanca/etica", expect=307, sess=HU); page(f"/governanca/etica/{I6}", expect=404, sess=HU)
ok("quem relatou manda até 10 mensagens por hora (um aviso por hora no celular); “—” limpa o responsável; membro do comitê não impede colegas; quem perde o perfil de gestão sai do comitê na hora")
hx = page("/etica?enviado=1", sess=E5); assert "Protocolo: <b>ET-" in hx; aid_lim = aid_of(hx, "Anotei")
assert post("/etica", aid_lim, {}, sess=E5) == "/etica"; assert "Protocolo: <b>ET-" not in page("/etica?enviado=1", sess=E5)
falso = page("/etica?erro=Ligue%20para%200800-000-000%20e%20informe%20seus%20dados", sess=mk()); assert "Ligue para" not in falso and "Não foi possível concluir" in falso
assert "Não foi possível concluir" in page("/privacidade?erro=%25", sess=mk()) and "Não foi possível concluir" in page("/etica/acompanhar?erro=%25E0%25A4%25A", sess=mk())
P6 = mk(); P6.headers["X-Forwarded-For"] = "203.0.113.99"; aid_pp = aid_of(page("/privacidade", sess=P6), "Enviar pedido")
for k in range(5): assert post("/privacidade", aid_pp, {"tipo": "CONFIRMACAO_ACESSO", "titularNome": f"Titular Teste {k}", "titularTipo": "RESPONSAVEL", "email": f"t{k}@exemplo.com", "descricao": "Quero saber quais dados meus a escola guarda."}, sess=P6).endswith("enviado=1")
erro(post("/privacidade", aid_pp, {"tipo": "CONFIRMACAO_ACESSO", "titularNome": "Titular Seis", "titularTipo": "RESPONSAVEL", "email": "t6@exemplo.com", "descricao": "Quero saber quais dados meus a escola guarda."}, sess=P6), "vários pedidos")
ok("comprovante sai da tela com “Anotei”; mensagem de erro forjada na URL nunca aparece (nem quebra a página); portal LGPD também limita envios por origem")

print(f"\nE2E Privacidade e canal de ética: {N[0]} verificações OK")
