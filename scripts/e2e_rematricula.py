# E2E — Rematrícula por link (v22): contrato versionado, links individuais e em lote com escopo, página pública em 2 etapas
# (dados + turma/Integral → contrato + consentimentos + aceite com CPF), evidência (versão, hash, IP), vaga com trava, recusa → pedido de saída,
# convite pelo WhatsApp registrado, cancelamento, série alterada, exportação e permissões.
import re, subprocess, requests, random
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
def d(n): return (HOJE + timedelta(days=n)).isoformat()
def cpf_gen(seed):
    random.seed(seed); n = [random.randint(0, 9) for _ in range(9)]
    for k in (9, 10):
        s = sum(n[i] * (k + 1 - i) for i in range(k)); r = (s * 10) % 11; n.append(0 if r == 10 else r)
    return "".join(map(str, n))
CPF_ANA, CPF_OUTRO, CPF_CAIO = cpf_gen(1), cpf_gen(2), cpf_gen(3)

print("Preparação")
login(S, "rh@colegiostatus", "Status2026!"); r = S.get(B + f"/api/setup?token={TOKEN}"); assert r.json()["ok"], r.text
CAR, TVM1, CUL = (psql(f"SELECT id FROM units WHERE codigo='{c}'") for c in ["CAR", "TVM1", "CUL"])
G = lambda nome: psql(f"SELECT id FROM grades WHERE nome='{nome}'")
html = page("/configuracoes"); aid_user = aid_of(html, "Criar acesso")
def criar_user(nome, email, role, unit=""):
    post("/configuracoes", aid_user, {"nome": nome, "email": email, "role": role, "unitId": unit, "senha": "senha12345"}); return psql(f"SELECT id FROM users WHERE email='{email}'")
DIR = criar_user("Diretora Carandá", "dir@car", "DIRETOR_UNIDADE", CAR); GES = criar_user("Gestor Cultura", "ges@cul", "GESTOR", CUL); COM = criar_user("Comercial Rede", "com@rede", "COMERCIAL"); FIN = criar_user("Financeiro Rede", "fin@rede", "FINANCEIRO")
DS = mk(); login(DS, "dir@car", "senha12345"); GS = mk(); login(GS, "ges@cul", "senha12345"); CS = mk(); login(CS, "com@rede", "senha12345"); FS = mk(); login(FS, "fin@rede", "senha12345")
alunos = [("Ana Rema", CAR, "4º ano", "Mãe da Ana", "67999990001"), ("Bruno Rema", CAR, "7º ano", "Pai do Bruno", "67999990002"), ("Caio Rema", CUL, "Jardim I", "Mãe do Caio", "67999990003"), ("Duda Rema", TVM1, "3ª série EM", "Mãe da Duda", "67999990004"), ("Eva Rema", CAR, None, "Pai da Eva", "67999990005"), ("Fábio Rema", CAR, "2º ano", "Mãe do Fábio", "67999990006")]
for nome, u, serie, resp, tel in alunos:
    psql(f"INSERT INTO students (nome, aluno_atual, unit_atual_id, serie_atual_id, responsavel, telefone, origem, carteira_user_id) VALUES ('{nome}', true, {u}, {G(serie) if serie else 'NULL'}, '{resp}', '{tel}', 'REMATRICULA', {DIR if u == CAR else 'NULL'})")
ANA, BRU, CAIO, DUDA, EVA, FAB = (psql(f"SELECT id FROM students WHERE nome='{n[0]}'") for n in alunos)
psql(f"UPDATE students SET cpf_responsavel='{CPF_ANA[:3]}.{CPF_ANA[3:6]}.{CPF_ANA[6:9]}-{CPF_ANA[9:]}' WHERE id={ANA}")
ok("6 alunos atuais: série seguinte na unidade (Ana), série só em outra unidade (Bruno), Integral (Caio), concluinte (Duda), sem série (Eva) e Fábio")

print("Contrato versionado")
html = page("/matriculas/rematricula"); assert "Contrato não publicado" in html
aid_ger = aid_of(html, "Gerar links para quem está sem link") if "Gerar links para" in html else None
assert aid_ger is None; ok("sem contrato publicado: painel avisa e não oferece geração de links")
html = page("/matriculas/rematricula/contrato"); assert "[RASCUNHO" in html and "Rascunho — versão 1" in html
aid_pub = aid_of(html, "Publicar versão 1"); aid_sal = aid_of(html, "Salvar rascunho"); CT = psql("SELECT id FROM contract_templates WHERE status='RASCUNHO'")
erro(post("/matriculas/rematricula/contrato", aid_pub, {"id": CT}), "aviso de rascunho")
TEXTO = "CONTRATO DE PRESTAÇÃO DE SERVIÇOS EDUCACIONAIS {ano}\\nContratante: {responsavel}. Aluno(a): {aluno}. Série {serie}, turma {turma}, turno {turno}{integral}, unidade {unidade}.\\nCláusula 1 — Objeto: serviços educacionais do ano letivo {ano}.\\nCláusula 2 — Valores conforme tabela vigente comunicada pelo financeiro."
TEXTO = TEXTO.replace("\\n", "\n")
erro(post("/matriculas/rematricula/contrato", aid_sal, {"id": CT, "ano": 2027, "titulo": "Contrato 2027", "texto": "curto"}), "texto completo")
erro(post("/matriculas/rematricula/contrato", aid_sal, {"id": CT, "ano": 2027, "titulo": "Contrato 2027", "texto": TEXTO}, sess=DS), "Direção/RH")
okmsg(post("/matriculas/rematricula/contrato", aid_sal, {"id": CT, "ano": 2027, "titulo": "Contrato 2027", "texto": TEXTO}), "Rascunho salvo")
okmsg(post("/matriculas/rematricula/contrato", aid_pub, {"id": CT}), "versão 1 publicado")
assert psql(f"SELECT status FROM contract_templates WHERE id={CT}") == "VIGENTE"
assert page("/matriculas/rematricula/contrato", expect=307, sess=DS) is not None
ok("rascunho com aviso não publica; texto curto recusado; diretora não edita; versão 1 publicada (vigente)")

print("Links individuais e em lote (escopo)")
html = page("/matriculas/rematricula"); assert "Contrato vigente" in html and "Sem link" in html
aid_um = aid_of(html, f'name="studentId" value="{ANA}"')
erro(post("/matriculas/rematricula", aid_um, {"studentId": ANA, "voltar": "/matriculas/rematricula"}, sess=GS), "Sem acesso")
okmsg(post("/matriculas/rematricula", aid_um, {"studentId": ANA, "voltar": "/matriculas/rematricula"}, sess=DS), "Link de rematrícula gerado")
okmsg(post("/matriculas/rematricula", aid_um, {"studentId": ANA, "voltar": "/matriculas/rematricula"}, sess=DS), "mesmo")
assert psql(f"SELECT count(*) FROM rematricula_links WHERE student_id={ANA}") == "1"
assert psql(f"SELECT g.nome FROM rematricula_links l JOIN grades g ON g.id=l.grade_id WHERE l.student_id={ANA}") == "5º ano"
erro(post("/matriculas/rematricula", aid_um, {"studentId": DUDA, "voltar": "/matriculas/rematricula"}), "última série")
erro(post("/matriculas/rematricula", aid_um, {"studentId": EVA, "voltar": "/matriculas/rematricula"}), "série atual")
ok("link individual: gestor de outra unidade barrado; repetido devolve o mesmo; série prevista = seguinte; concluinte e sem série recusados")
html = page(f"/matriculas/rematricula?unidade={CAR}"); aid_lote = aid_of(html, "Gerar links para quem está sem link")
loc = post("/matriculas/rematricula", aid_lote, {"unidade": CAR, "voltar": f"/matriculas/rematricula?unidade={CAR}"}, sess=DS); okmsg(loc, "2 link(s) gerado(s)"); assert "1 aluno(s) sem série" in loc, loc
assert psql(f"SELECT count(*) FROM rematricula_links WHERE student_id IN ({BRU},{FAB}) AND status='PENDENTE'") == "2" and psql(f"SELECT count(*) FROM rematricula_links WHERE student_id IN ({DUDA},{EVA},{CAIO})") == "0"
ok("lote da diretora: só Carandá; gera para Bruno e Fábio, pula quem já tem link, concluinte e sem série (informado)")
html = page("/matriculas/rematricula", sess=GS); assert "Caio Rema" in html and "Ana Rema" not in html; ok("gestor da Cultura só vê os alunos da Cultura")
okmsg(post("/matriculas/rematricula", aid_um, {"studentId": CAIO, "voltar": "/matriculas/rematricula"}, sess=GS), "gerado")
TA, TB, TC, TF = (psql(f"SELECT token FROM rematricula_links WHERE student_id={x} AND status='PENDENTE'") for x in (ANA, BRU, CAIO, FAB))
assert len(TA) >= 30 and TA != TB

print("Convite pelo WhatsApp (registrado em Mensagens)")
html = page("/matriculas/rematricula"); LA = psql(f"SELECT id FROM rematricula_links WHERE student_id={ANA}")
aid_wa = aid_of(html, f'name="id" value="{LA}"')
loc = post("/matriculas/rematricula", aid_wa, {"id": LA, "voltar": "/matriculas/rematricula"}, sess=CS)
assert loc.startswith("https://wa.me/5567999990001?text=") and f"/rematricula/{TA}" in loc and "Ana Rema" in loc, loc
assert psql(f"SELECT count(*) FROM messages WHERE entidade='rematricula' AND entidade_id={LA}") == "1" and psql(f"SELECT enviado_em IS NOT NULL FROM rematricula_links WHERE id={LA}") == "t"
assert TA not in psql(f"SELECT texto FROM messages WHERE entidade='rematricula' AND entidade_id={LA}") and "link individual, não guardado" in psql(f"SELECT texto FROM messages WHERE entidade='rematricula' AND entidade_id={LA}")
ok("convite: mensagem registrada, link marcado como enviado e WhatsApp aberto com o texto e o endereço do link")
assert "Copiado" not in html and f"/rematricula/{TA}" in html; ok("painel mostra o endereço para copiar")

print("Página pública — etapa 1 (dados e turma)")
P = mk()  # família: sem login
h1 = page(f"/rematricula/{TA}", sess=P); assert "Rematrícula 2027 de Ana Rema" in h1 and "5º ano" in h1 and "5º ano A" in h1 and "Vespertino" in h1
assert psql(f"SELECT aberto_em IS NOT NULL FROM rematricula_links WHERE id={LA}") == "t"
for ua in ["WhatsApp/2.23.20.0 A", "TelegramBot (like TwitterBot)", "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"]: assert requests.get(B + f"/rematricula/{TB}", headers={"User-Agent": ua}).status_code == 200
assert psql(f"SELECT aberto_em IS NULL FROM rematricula_links WHERE token='{TB}'") == "t"
ok("família abre sem login; série prevista e turmas da unidade; abertura registrada (pré-visualização do WhatsApp/Telegram não conta como aberto)")
assert "Link inválido" in page("/rematricula/token-que-nao-existe", sess=P); ok("token inexistente: link inválido")
aid_esc = aid_of(h1, "Continuar para o contrato"); C5A = psql("SELECT id FROM classes WHERE ano=2027 AND nome='5º ano A' AND unit_id=" + CAR)
base = {"token": TA, "responsavel": "Maria Souza Ana", "telefone": "(67) 99999-0011", "email": "maria@exemplo.com", "classId": C5A}
erro(post(f"/rematricula/{TA}", aid_esc, {**base, "responsavel": "Maria"}, sess=P), "nome completo")
erro(post(f"/rematricula/{TA}", aid_esc, {**base, "telefone": "123"}, sess=P), "DDD")
erro(post(f"/rematricula/{TA}", aid_esc, {**base, "classId": ""}, sess=P), "Escolha a turma")
C8 = psql("SELECT id FROM classes WHERE ano=2027 AND nome='8º ano A' AND unit_id=" + TVM1)
erro(post(f"/rematricula/{TA}", aid_esc, {**base, "classId": C8}, sess=P), "indisponível")
loc = post(f"/rematricula/{TA}", aid_esc, base, sess=P); assert loc.endswith("etapa=contrato"), loc
ok("etapa 1: nome completo, telefone com DDD e turma obrigatórios; turma de outra série recusada; escolha guardada")

print("Página pública — etapa 2 (contrato, consentimentos, aceite)")
h2 = page(f"/rematricula/{TA}?etapa=contrato", sess=P)
assert "Contratante: Maria Souza Ana. Aluno(a): Ana Rema. Série 5º ano, turma 5º ano A, turno Vespertino, unidade Carandá." in h2, h2[h2.find("Contratante"):h2.find("Contratante") + 200]
assert "Imagem e voz nas redes sociais" in h2 and "não interfere na matrícula" in h2 and len(re.findall(r'name="consent_\d+"', h2)) == 3 and 'checked=""' not in h2[h2.find("Autorizações opcionais"):h2.find("Aceite eletrônico")]
HASH = re.search(r'name="hash" value="([0-9a-f]{64})"', h2).group(1); aid_ac = aid_of(h2, "Aceitar e concluir a rematrícula")
FINS = psql("SELECT string_agg(id::text, ',' ORDER BY ordem) FROM consent_purposes").split(","); F_REDES = psql("SELECT id FROM consent_purposes WHERE codigo='IMAGEM_REDES'")
ok("contrato com as variáveis da escolha; 3 autorizações opcionais em destaque, desmarcadas")
ac = {"token": TA, "hash": HASH, "assinatura": "Maria Souza Ana", "cpf": CPF_ANA, "aceito": "1", f"consent_{F_REDES}": "1"}
erro(post(f"/rematricula/{TA}", aid_ac, {**ac, "aceito": ""}, sess=P), "leu e aceita")
erro(post(f"/rematricula/{TA}", aid_ac, {**ac, "cpf": "111.111.111-11"}, sess=P), "CPF inválido")
erro(post(f"/rematricula/{TA}", aid_ac, {**ac, "assinatura": "Maria"}, sess=P), "nome completo")
erro(post(f"/rematricula/{TA}", aid_ac, {**ac, "hash": "0" * 64}, sess=P), "atualizado")
erro(post(f"/rematricula/{TA}", aid_ac, {**ac, "cpf": CPF_OUTRO}, sess=P), "não confere")
assert psql(f"SELECT count(*) FROM login_attempts WHERE email='REMATRICULA:{LA}' AND NOT ok") == "1" and psql(f"SELECT status FROM rematricula_links WHERE id={LA}") == "PENDENTE"
# o formulário de login não alcança a chave do limite (antes, 5 logins com "rematricula:<id>" bloqueavam o link da família)
for em in [f"rematricula:{LA}", f"REMATRICULA:{LA}"] * 3:
    hl = mk().get(B + "/login").text; aidl = re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', hl)[0]; mk().post(B + "/login", files=[(f"$ACTION_ID_{aidl}", (None, "")), ("email", (None, em)), ("senha", (None, "x"))], headers={"Origin": B}, allow_redirects=False)
assert psql(f"SELECT count(*) FROM login_attempts WHERE email IN ('rematricula:{LA}', 'REMATRICULA:{LA}') AND NOT ok") == "1"
ok("aceite exige marcar, CPF válido, assinatura completa e o mesmo texto exibido; CPF diferente do cadastro recusado e contado; tentativas de login não bloqueiam o link")
loc = post(f"/rematricula/{TA}", aid_ac, ac, sess=P); assert loc.endswith("concluida=1"), loc
row = psql(f"SELECT status, contrato_versao, contrato_hash, aceite->>'nome', aceite->>'cpfFinal', (aceite->>'ip') IS NOT NULL, contrato_texto LIKE '%5º ano A%' FROM rematricula_links WHERE id={LA}").split("|")
assert row[:5] == ["CONCLUIDA", "1", HASH, "Maria Souza Ana", CPF_ANA[-2:]] and row[5:] == ["t", "t"], row
en = psql(f"SELECT e.status, c.nome, e.contrato_assinado, e.financeiro_ok, e.reserva_ate FROM enrollments e JOIN classes c ON c.id=e.class_id WHERE e.student_id={ANA} AND e.ano=2027").split("|")
assert en == ["RESERVADA", "5º ano A", "t", "f", d(30)], en
assert psql(f"SELECT responsavel || '|' || telefone || '|' || email FROM students WHERE id={ANA}") == "Maria Souza Ana|(67) 99999-0011|maria@exemplo.com"
assert psql(f"SELECT string_agg(cp.codigo || ':' || c.status, ',' ORDER BY cp.ordem) FROM consents c JOIN consent_purposes cp ON cp.id=c.purpose_id WHERE c.student_id={ANA}") == "IMAGEM_REDES:CONCEDIDO,IMAGEM_MATERIAIS:NEGADO,DIVULGACAO_RESULTADOS:NEGADO"
assert psql(f"SELECT count(*) FROM family_contacts WHERE student_id={ANA} AND resumo LIKE 'Rematrícula 2027 concluída pelo link%'") == "1"
assert psql(f"SELECT count(*) FROM notifications WHERE chave='remconc:{LA}'") == psql(f"SELECT count(DISTINCT u) FROM (VALUES ({DIR}),({COM})) v(u)")
assert psql(f"SELECT count(*) FROM audit_log WHERE entidade='rematricula_links' AND entidade_id={LA} AND user_nome LIKE 'Família%'") == "1"
ok("concluída: reserva com contrato aceito (falta o financeiro) por 30 dias, dados atualizados, consentimentos (concedido/negado), interação no radar, aviso à carteira e ao comercial, auditoria")
h3 = page(f"/rematricula/{TA}", sess=P); assert "Rematrícula concluída" in h3 and "5º ano A" in h3 and "Ver o contrato aceito" in h3
erro(post(f"/rematricula/{TA}", aid_ac, ac, sess=P), "já foi concluída"); ok("comprovante para a família; reenvio do aceite recusado (sem duplicar)")
html = page("/matriculas/rematricula?situacao=RESERVADA"); assert "Ana Rema" in html and "contrato ✓" in html and ">Aceite<" in html
assert psql(f"SELECT count(*) FROM enrollments WHERE student_id={ANA}") == "1"; ok("painel: Ana em reserva com contrato aceito e evidência do aceite")

print("Outra unidade, turma que lota no meio do caminho")
hb = page(f"/rematricula/{TB}", sess=P); assert "A unidade atual não oferece 8º ano" in hb and "TV Morena I" in hb
aid_eb = aid_of(hb, "Continuar para o contrato"); C8A, C8B = (psql(f"SELECT id FROM classes WHERE ano=2027 AND nome='8º ano {x}' AND unit_id={TVM1}") for x in "AB")
post(f"/rematricula/{TB}", aid_eb, {"token": TB, "responsavel": "Pai do Bruno Silva", "telefone": "67999990002", "classId": C8A}, sess=P)
hb2 = page(f"/rematricula/{TB}?etapa=contrato", sess=P); HB = re.search(r'name="hash" value="([0-9a-f]{64})"', hb2).group(1); aid_ab = aid_of(hb2, "Aceitar e concluir")
VAGAS = int(psql(f"SELECT vagas FROM classes WHERE id={C8A}"))
psql(f"INSERT INTO students (nome) SELECT 'Lotação ' || g FROM generate_series(1, {VAGAS}) g")
psql(f"INSERT INTO enrollments (student_id, class_id, ano, status, confirmada_em) SELECT id, {C8A}, 2027, 'CONFIRMADA', now() FROM students WHERE nome LIKE 'Lotação %'")
erro(post(f"/rematricula/{TB}", aid_ab, {"token": TB, "hash": HB, "assinatura": "Pai do Bruno Silva", "cpf": CPF_OUTRO, "aceito": "1"}, sess=P), "acabou de lotar")
assert psql(f"SELECT status FROM rematricula_links WHERE student_id={BRU}") == "PENDENTE" and psql(f"SELECT count(*) FROM enrollments WHERE student_id={BRU}") == "0"
assert "sem vaga" in page(f"/rematricula/{TB}", sess=P); post(f"/rematricula/{TB}", aid_eb, {"token": TB, "responsavel": "Pai do Bruno Silva", "telefone": "67999990002", "classId": C8B}, sess=P)
hb2 = page(f"/rematricula/{TB}?etapa=contrato", sess=P); HB = re.search(r'name="hash" value="([0-9a-f]{64})"', hb2).group(1)
assert post(f"/rematricula/{TB}", aid_ab, {"token": TB, "hash": HB, "assinatura": "Pai do Bruno Silva", "cpf": CPF_OUTRO, "aceito": "1"}, sess=P).endswith("concluida=1")
assert psql(f"SELECT c.nome FROM enrollments e JOIN classes c ON c.id=e.class_id WHERE e.student_id={BRU}") == "8º ano B" and psql(f"SELECT cpf_responsavel FROM students WHERE id={BRU}") == CPF_OUTRO
ok("série só oferecida em outra unidade: opções da rede; turma lotou entre as etapas → recusa sem efeito parcial; outra turma conclui e grava o CPF que faltava")

print("Integral no contraturno")
hc = page(f"/rematricula/{TC}", sess=P); assert "Jardim II" in hc and "Integral (opcional)" in hc and "Integral Jardim II + Jardim III · Matutino" in hc
aid_ec = aid_of(hc, "Continuar para o contrato")
CJA = psql(f"SELECT id FROM classes WHERE ano=2027 AND nome='Jardim II A' AND unit_id={CUL}"); IM = psql(f"SELECT id FROM classes WHERE ano=2027 AND modalidade='INTEGRAL' AND unit_id={CUL} AND series_texto='Jardim II + Jardim III' AND turno='Matutino'"); IV = psql(f"SELECT id FROM classes WHERE ano=2027 AND modalidade='INTEGRAL' AND unit_id={CUL} AND series_texto='Jardim II + Jardim III' AND turno='Vespertino'")
I_OUTRO = psql(f"SELECT id FROM classes WHERE ano=2027 AND modalidade='INTEGRAL' AND unit_id={CUL} AND series_texto='1º + 2º ano'")
bc = {"token": TC, "responsavel": "Mãe do Caio Lima", "telefone": "67999990003", "classId": CJA}
erro(post(f"/rematricula/{TC}", aid_ec, {**bc, "integralClassId": IM}, sess=P), "contraturno")
erro(post(f"/rematricula/{TC}", aid_ec, {**bc, "integralClassId": I_OUTRO}, sess=P), "Integral indisponível")
assert post(f"/rematricula/{TC}", aid_ec, {**bc, "integralClassId": IV}, sess=P).endswith("etapa=contrato")
hc2 = page(f"/rematricula/{TC}?etapa=contrato", sess=P); assert ", com Integral (Jardim II + Jardim III · Vespertino)" in hc2
HC = re.search(r'name="hash" value="([0-9a-f]{64})"', hc2).group(1); aid_ac2 = aid_of(hc2, "Aceitar e concluir")
assert post(f"/rematricula/{TC}", aid_ac2, {"token": TC, "hash": HC, "assinatura": "Mãe do Caio Lima", "cpf": CPF_CAIO, "aceito": "1"}, sess=P).endswith("concluida=1")
assert psql(f"SELECT string_agg(modalidade || ':' || status, ',' ORDER BY modalidade) FROM enrollments WHERE student_id={CAIO}") == "INTEGRAL:RESERVADA,REGULAR:RESERVADA"
assert psql(f"SELECT count(*) FROM consents WHERE student_id={CAIO} AND status='NEGADO'") == "3"
ok("Integral: grupo no mesmo turno recusado (contraturno), grupo de outra série recusado; regular + Integral reservados; sem autorizações = 3 negadas")

print("Recusa pela família → pedido de saída")
CPF_FAB = cpf_gen(4); psql(f"UPDATE students SET cpf_responsavel='{CPF_FAB}' WHERE id={FAB}")
hf = page(f"/rematricula/{TF}", sess=P); aid_rec = aid_of(hf, "Enviar resposta"); LF = psql(f"SELECT id FROM rematricula_links WHERE student_id={FAB}")
assert 'name="cpf"' in hf[hf.find("não vai continuar"):]
erro(post(f"/rematricula/{TF}", aid_rec, {"token": TF, "motivo": "Qualquer"}, sess=P), "motivo")
erro(post(f"/rematricula/{TF}", aid_rec, {"token": TF, "motivo": "Mudança de cidade"}, sess=P), "CPF informado não confere")
erro(post(f"/rematricula/{TF}", aid_rec, {"token": TF, "motivo": "Mudança de cidade", "cpf": CPF_OUTRO}, sess=P), "CPF informado não confere")
assert psql(f"SELECT status || '|' || (case_id IS NULL) FROM rematricula_links WHERE id={LF}") == "PENDENTE|true" and psql(f"SELECT count(*) FROM login_attempts WHERE email='REMATRICULA:{LF}' AND NOT ok") == "2"
assert post(f"/rematricula/{TF}", aid_rec, {"token": TF, "motivo": "Mudança de cidade", "obs": "Vamos para Dourados", "cpf": CPF_FAB}, sess=P).endswith("recusada=1")
cs = psql(f"SELECT c.id, c.tipo, c.prioridade, c.resultado, c.responsavel_user_id, jsonb_array_length(c.checklist), c.motivo_saida FROM cases c JOIN rematricula_links l ON l.case_id=c.id WHERE l.id={LF}").split("|")
assert cs[1:] == ["SAIDA", "ALTA", "EM_ANDAMENTO", DIR, "7", "Mudança de cidade"], cs
assert psql(f"SELECT status FROM rematricula_links WHERE id={LF}") == "RECUSADA" and psql(f"SELECT count(*) FROM notifications WHERE chave='remrecusa:{LF}' AND tipo='ALERTA'") == "1"
assert "Resposta recebida" in page(f"/rematricula/{TF}", sess=P)
html = page("/matriculas/rematricula?situacao=RECUSOU"); assert "Fábio Rema" in html and f"pedido de saída #{cs[0]}" in html
ok("recusa: com CPF no cadastro, só quem confirma o CPF recusa (errado conta tentativa); motivo da lista; pedido de saída com protocolo de retenção atribuído à carteira; alerta; painel liga ao caso")

print("Cancelar, alterar série, expiração")
okmsg(post("/matriculas/rematricula", aid_um, {"studentId": EVA, "gradeId": G("1º ano"), "voltar": "/matriculas/rematricula"}), "gerado")
LE = psql(f"SELECT id FROM rematricula_links WHERE student_id={EVA}"); TE = psql(f"SELECT token FROM rematricula_links WHERE id={LE}")
html = page("/matriculas/rematricula"); aid_ser = aid_of(html, "Alterar série"); aid_can = aid_of(html, "Cancelar link")
erro(post("/matriculas/rematricula", aid_ser, {"id": LE, "gradeId": G("2º ano"), "voltar": "/matriculas/rematricula"}, sess=GS), "Sem acesso")
okmsg(post("/matriculas/rematricula", aid_ser, {"id": LE, "gradeId": G("2º ano"), "motivo": "retenção", "voltar": "/matriculas/rematricula"}), "Série prevista alterada")
assert "2º ano" in page(f"/rematricula/{TE}", sess=P)
erro(post("/matriculas/rematricula", aid_can, {"id": LE, "motivo": "", "voltar": "/matriculas/rematricula"}), "motivo")
okmsg(post("/matriculas/rematricula", aid_can, {"id": LE, "motivo": "família pediu presencial", "voltar": "/matriculas/rematricula"}), "cancelado")
assert "Link expirado" in page(f"/rematricula/{TE}", sess=P)
okmsg(post("/matriculas/rematricula", aid_um, {"studentId": EVA, "gradeId": G("1º ano"), "voltar": "/matriculas/rematricula"}), "gerado")
TE2 = psql(f"SELECT token FROM rematricula_links WHERE student_id={EVA} AND status='PENDENTE'"); assert TE2 != TE
psql(f"UPDATE rematricula_links SET expira_em='{d(-1)}' WHERE token='{TE2}'"); assert "Link expirado" in page(f"/rematricula/{TE2}", sess=P)
ok("série prevista alterada (retenção) com escopo; cancelamento exige motivo e desativa o endereço; novo link com outro token; link vencido não abre")

print("Nova versão do contrato no meio do caminho")
psql(f"INSERT INTO students (nome, aluno_atual, unit_atual_id, serie_atual_id, responsavel, telefone) VALUES ('Gabi Rema', true, {CAR}, {G('1º ano')}, 'Mãe da Gabi', '67999990007')"); GABI = psql("SELECT id FROM students WHERE nome='Gabi Rema'")
okmsg(post("/matriculas/rematricula", aid_um, {"studentId": GABI, "voltar": "/matriculas/rematricula"}), "gerado"); TG = psql(f"SELECT token FROM rematricula_links WHERE student_id={GABI}")
hg = page(f"/rematricula/{TG}", sess=P); C2A = psql(f"SELECT id FROM classes WHERE ano=2027 AND nome='2º ano A' AND unit_id={CAR}")
post(f"/rematricula/{TG}", aid_of(hg, "Continuar para o contrato"), {"token": TG, "responsavel": "Mãe da Gabi Costa", "telefone": "67999990007", "classId": C2A}, sess=P)
hg2 = page(f"/rematricula/{TG}?etapa=contrato", sess=P); HG = re.search(r'name="hash" value="([0-9a-f]{64})"', hg2).group(1); aid_g = aid_of(hg2, "Aceitar e concluir")
html = page("/matriculas/rematricula/contrato"); okmsg(post("/matriculas/rematricula/contrato", aid_of(html, "Criar nova versão"), {"id": CT}), "Versão 2")
html = page("/matriculas/rematricula/contrato"); CT2 = psql("SELECT id FROM contract_templates WHERE status='RASCUNHO'")
okmsg(post("/matriculas/rematricula/contrato", aid_of(html, "Salvar rascunho"), {"id": CT2, "ano": 2027, "titulo": "Contrato 2027", "texto": TEXTO + "\nCláusula 3 — Nova cláusula."}), "salvo")
html = page("/matriculas/rematricula/contrato"); okmsg(post("/matriculas/rematricula/contrato", aid_of(html, "Publicar versão 2"), {"id": CT2}), "versão 2 publicado")
assert psql("SELECT string_agg(versao || ':' || status, ',' ORDER BY versao) FROM contract_templates") == "1:ARQUIVADO,2:VIGENTE"
erro(post(f"/rematricula/{TG}", aid_g, {"token": TG, "hash": HG, "assinatura": "Mãe da Gabi Costa", "cpf": cpf_gen(9), "aceito": "1"}, sess=P), "atualizado")
hg3 = page(f"/rematricula/{TG}?etapa=contrato", sess=P); assert "Cláusula 3" in hg3 and "versão 2" in hg3
assert psql(f"SELECT contrato_versao FROM rematricula_links WHERE student_id={ANA}") == "1"
ok("contrato republicado: a família que estava lendo a versão 1 precisa aceitar a 2; aceites anteriores continuam na versão 1")

print("Permissões, configuração e exportação")
html = page("/matriculas/rematricula", sess=FS); assert "Ana Rema" in html and "Gerar link" not in html and ">WhatsApp<" not in html; ok("financeiro vê o painel sem ações")
html = page("/matriculas/rematricula"); aid_cfg = aid_of(html, "Salvar configuração")
erro(post("/matriculas/rematricula", aid_cfg, {"validadeLinkDias": 30, "reservaDias": 30, "lembreteAbertoDias": 2, "integralContraturno": "1", "convite": "Olá sem link"}), "{link}")
erro(post("/matriculas/rematricula", aid_cfg, {"validadeLinkDias": 0, "reservaDias": 30, "lembreteAbertoDias": 2, "integralContraturno": "1", "convite": "{link}"}), "Validade")
erro(post("/matriculas/rematricula", aid_cfg, {"validadeLinkDias": 20, "reservaDias": 30, "lembreteAbertoDias": 2, "integralContraturno": "1", "convite": "{link}"}, sess=DS), "Direção/RH")
okmsg(post("/matriculas/rematricula", aid_cfg, {"validadeLinkDias": 20, "reservaDias": 15, "lembreteAbertoDias": 3, "integralContraturno": "1", "convite": "Oi {responsavel}, rematrícula de {aluno}: {link}"}), "salva")
assert psql("SELECT value->>'validadeLinkDias' || '|' || (value->>'reservaDias') FROM settings WHERE key='rematricula'") == "20|15"
ok("configuração: convite precisa de {link}; limites; só Direção/RH")
csv = S.get(B + "/api/export/rematricula").content.decode("utf-8-sig")
assert csv.splitlines()[0].startswith("aluno;unidade;serie_atual;serie_prevista") and csv.splitlines()[0].split(";")[-1] == "link" and "Ana Rema" in csv and "Reserva (aguardando confirmação)" in csv and f"/rematricula/{TG}" in csv
csvf = FS.get(B + "/api/export/rematricula").content.decode("utf-8-sig"); assert "link" not in csvf.splitlines()[0].split(";") and "/rematricula/" not in csvf
csvd = DS.get(B + "/api/export/rematricula").content.decode("utf-8-sig"); assert "Caio Rema" not in csvd and "Ana Rema" in csvd
ok("CSV com link só para quem envia; escopo da diretora respeitado")
h = page(f"/matriculas/alunos/{GABI}"); assert "Rematrícula 2027" in h and "Link ativo" in h and f"/rematricula/{TG}" in h; ok("ficha do aluno mostra o link e permite enviar")

print(f"\nE2E Rematrícula: {N[0]} verificações OK")
