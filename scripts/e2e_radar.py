# E2E — Radar da família (v21): carteira por responsável, jornada configurável, interações com próximo passo, segmentos por regra,
# voz da família, indicação, exportação e rotina diária — com escopo por unidade (IDOR) e permissões.
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
    return re.sub(r"<script[^>]*>.*?</script>", "", re.sub(r"<!--.*?-->", "", r.text), flags=re.S).replace("\xa0", " ").replace(" ", " ")
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
def aid_near(html, marker):
    i = html.find(marker); assert i >= 0, marker
    ids = list(re.finditer(r'\$ACTION_ID_([0-9a-f]+)', html[:i])); assert ids, marker; return ids[-1].group(1)
def login(sess, email, senha):
    html = sess.get(B + "/login").text; aid = re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', html)[0]
    loc = post("/login", aid, {"email": email, "senha": senha}, sess=sess); assert loc.endswith("/"), loc
def erro(loc, trecho): assert "erro=" in loc and trecho in loc, (trecho, loc)
def okmsg(loc, trecho=""): assert "ok=" in loc and trecho in loc, (trecho, loc)
def sub(html): m = re.search(r"<h1[^>]*>.*?</h1>\s*<p[^>]*>(.*?)</p>", html, re.S); return m.group(1) if m else ""
def nid(loc, rota): m = re.search(rf"/{rota}/(\d+)", loc); assert m, (rota, loc); return m.group(1)

HOJE = datetime.now(ZoneInfo("America/Campo_Grande")).date(); H = HOJE.isoformat(); PER = H[:7]; ANO = HOJE.year
def d(n): return (HOJE + timedelta(days=n)).isoformat()
def soma_mes(p, n): y, m = map(int, p.split("-")); t = y * 12 + (m - 1) + n; return f"{t // 12}-{t % 12 + 1:02d}"
PANT = soma_mes(PER, -1); PPROX = soma_mes(PER, 1)
def br(iso): return "/".join(reversed(iso.split("-")))


print("Preparação")
login(S, "rh@colegiostatus", "Status2026!"); r = S.get(B + f"/api/setup?token={TOKEN}"); assert r.json()["ok"], r.text
psql("""INSERT INTO settings (key, value) VALUES ('atendimento', '{"riscoRematriculaApos": "2099-12-31"}'::jsonb) ON CONFLICT (key) DO UPDATE SET value = settings.value || EXCLUDED.value""")
CAR = psql("SELECT id FROM units WHERE nome='Carandá'"); CUL = psql("SELECT id FROM units WHERE nome='Cultura'"); RH = psql("SELECT id FROM users WHERE email='rh@colegiostatus'")
html = page("/configuracoes"); aid_user = aid_of(html, "Criar acesso")
def criar_user(nome, email, role, unit=""):
    post("/configuracoes", aid_user, {"nome": nome, "email": email, "role": role, "unitId": unit, "senha": "senha12345"}); return psql(f"SELECT id FROM users WHERE email='{email}'")
DIR = criar_user("Diretora Carandá", "dir@car", "DIRETOR_UNIDADE", CAR); GES = criar_user("Gestor Cultura", "ges@cul", "GESTOR", CUL); COM = criar_user("Comercial Rede", "com@rede", "COMERCIAL"); FIN = criar_user("Financeiro Rede", "fin@rede", "FINANCEIRO")
DS = mk(); login(DS, "dir@car", "senha12345"); G = mk(); login(G, "ges@cul", "senha12345"); C = mk(); login(C, "com@rede", "senha12345")
psql(f"INSERT INTO students (nome, aluno_atual, unit_atual_id, responsavel, telefone, origem) VALUES ('Ana Radar', true, {CAR}, 'Mãe da Ana', '67999990001', 'REMATRICULA'), ('Bruno Radar', true, {CAR}, 'Pai do Bruno', '67999990002', 'REMATRICULA'), ('Carla Radar', true, {CAR}, 'Mãe da Carla', '67999990003', 'REMATRICULA'), ('Davi Radar', true, {CUL}, 'Mãe do Davi', '67999990004', 'REMATRICULA')")
psql("INSERT INTO students (nome, aluno_atual) VALUES ('Candidata Indicada', false)")
ANA, BRU, CARLA, DAVI, CAND = (psql(f"SELECT id FROM students WHERE nome='{n}'") for n in ["Ana Radar", "Bruno Radar", "Carla Radar", "Davi Radar", "Candidata Indicada"])
psql(f"INSERT INTO enrollments (student_id, class_id, ano, status, confirmada_em) VALUES ({BRU}, 1, 2027, 'CONFIRMADA', now())")
ok("famílias: Ana, Bruno (rematriculado) e Carla em Carandá; Davi na Cultura; uma candidata")

print("Jornada (configuração relativa a hoje)")
html = page("/atendimento/radar"); aid_jor = aid_of(html, 'name="jornada"')
def ddmm(iso): return f"{iso[8:10]}/{iso[5:7]}"
E1, E2, E3 = d(-40), d(-5), d(5); MESMO_ANO = all(x[:4] == str(ANO) for x in (E1, E2, E3))
J = f"Boas-vindas | {ddmm(E1)}\nConversa de rematrícula | {ddmm(E2)}\nPesquisa do 2º semestre | {ddmm(E3)}\nAcompanhamento livre"
erro(post("/atendimento/radar", aid_jor, {"jornada": "Boas-vindas | 31/02", "semContatoDias": 60, "avisoEtapaDias": 15, "voltar": "/atendimento/radar"}), "inexistente")
erro(post("/atendimento/radar", aid_jor, {"jornada": "Boas-vindas | 13/2026", "semContatoDias": 60, "avisoEtapaDias": 15, "voltar": "/atendimento/radar"}), "Prazo inválido")
erro(post("/atendimento/radar", aid_jor, {"jornada": J, "semContatoDias": 3, "avisoEtapaDias": 15, "voltar": "/atendimento/radar"}), "entre 7 e 365")
erro(post("/atendimento/radar", aid_jor, {"jornada": J, "semContatoDias": "abc", "avisoEtapaDias": 15, "voltar": "/atendimento/radar"}), "entre 7 e 365")
erro(post("/atendimento/radar", aid_jor, {"jornada": J, "semContatoDias": 60, "avisoEtapaDias": 15, "voltar": "/atendimento/radar"}, sess=DS), "Direção/RH")
okmsg(post("/atendimento/radar", aid_jor, {"jornada": J, "semContatoDias": 60, "avisoEtapaDias": 15, "voltar": "/atendimento/radar"}), "4 etapa(s)")
chaves = psql("SELECT string_agg(e->>'chave', ',' ORDER BY ord) FROM settings, jsonb_array_elements(value->'jornada') WITH ORDINALITY AS t(e, ord) WHERE key='atendimento'")
assert chaves == "BOAS_VINDAS,CONVERSA_DE_REMATRICULA,PESQUISA_DO_2_SEMESTRE,ACOMPANHAMENTO_LIVRE", chaves; ok("jornada configurada por linhas “Nome | DD/MM”; data inexistente, prazo inválido e limites fora da faixa recusados; diretora não configura")

print("Radar e carteira")
html = page("/atendimento/radar?visao=todas"); assert all(n in html for n in ["Ana Radar", "Bruno Radar", "Carla Radar", "Davi Radar"]) and "Candidata Indicada" not in html
assert "Famílias ativas" in html and "Precisa de atenção hoje" in html; ok("radar lista só famílias da rede (candidato fora)")
html_g = page("/atendimento/radar?visao=todas", sess=G); assert "Davi Radar" in html_g and "Ana Radar" not in html_g; ok("escopo: gestor da Cultura só vê as famílias da Cultura")
aid_cart = aid_of(html, 'name="studentIds"')
V = "/atendimento/radar?visao=todas"
erro(post("/atendimento/radar", aid_cart, {"studentIds": [ANA, BRU], "userId": GES, "voltar": V}), "atua em outra unidade")
erro(post("/atendimento/radar", aid_cart, {"studentIds": [CAND], "userId": DIR, "voltar": V}), "é candidato")
erro(post("/atendimento/radar", aid_cart, {"studentIds": [ANA], "userId": GES, "voltar": V}, sess=G), "não é da sua unidade")
erro(post("/atendimento/radar", aid_cart, {"studentIds": [ANA], "userId": DIR, "voltar": V}, sess=C), "distribuída pela")
erro(post("/atendimento/radar", aid_cart, {"studentIds": [ANA], "userId": FIN, "voltar": V}), "perfil de atendimento")
erro(post("/atendimento/radar", aid_cart, {"userId": DIR, "voltar": V}), "Marque ao menos")
ok("carteira: responsável de outra unidade, candidato, gestor fora do escopo, comercial, perfil sem atendimento e lista vazia recusados")
okmsg(post("/atendimento/radar", aid_cart, {"studentIds": [ANA, BRU], "userId": DIR, "voltar": V}), "2 família(s) na carteira de Diretora Carandá")
assert psql(f"SELECT count(*) FROM notifications WHERE user_id={DIR} AND titulo='Famílias na sua carteira'") == "1"
okmsg(post("/atendimento/radar", aid_cart, {"studentIds": [ANA], "userId": DIR, "voltar": V}), "Nada mudou")
okmsg(post("/atendimento/radar", aid_cart, {"studentIds": [CARLA], "userId": COM, "voltar": V}), "na carteira de Comercial Rede")
html = page("/atendimento/radar?visao=todas&carteira=me", sess=DS); assert "Ana Radar" in html and "Bruno Radar" in html and "Carla Radar" not in html
html = page("/atendimento/radar?visao=todas&carteira=SEM"); assert "Davi Radar" in html and "Ana Radar" not in html
ok("distribuição em lote com aviso ao responsável; filtros “minha carteira” e “sem responsável”")
okmsg(post("/atendimento/radar", aid_cart, {"studentIds": [CARLA], "userId": "", "voltar": V}), "sem responsável"); okmsg(post("/atendimento/radar", aid_cart, {"studentIds": [CARLA], "userId": COM, "voltar": V}))
assert psql(f"SELECT count(*) FROM audit_log WHERE entidade='students' AND entidade_id={CARLA} AND acao='carteira da família'") == "3"; ok("retirar da carteira e devolver; cada mudança na auditoria")
erro(post("/atendimento/radar", aid_cart, {"studentIds": [CARLA, DAVI], "userId": DIR, "voltar": V}), "atua em outra unidade")
assert psql(f"SELECT carteira_user_id FROM students WHERE id={CARLA}") == COM; ok("distribuição em lote é tudo ou nada: uma família inválida não muda as outras")

print("Interações, próximo passo e jornada")
html = page(f"/matriculas/alunos/{ANA}"); assert "Relacionamento e jornada da família" in html and "Diretora Carandá" in html and "Saudável" in html
aid_int = aid_of(html, 'name="proximoPasso"'); VA = f"/matriculas/alunos/{ANA}#relacionamento"
I = {"studentId": ANA, "voltar": VA, "data": d(-5), "tipo": "LIGACAO", "canal": "WHATSAPP", "resumo": "", "percepcao": "", "etapa": "", "proximoPasso": "", "proximoEm": ""}
def it(**kw): x = dict(I); x.update(kw); return x
erro(post(f"/matriculas/alunos/{ANA}", aid_int, it()), "Resuma"); erro(post(f"/matriculas/alunos/{ANA}", aid_int, it(resumo="x", data=d(1))), "data futura")
erro(post(f"/matriculas/alunos/{ANA}", aid_int, it(resumo="x", proximoPasso="Retornar")), "data do próximo passo"); erro(post(f"/matriculas/alunos/{ANA}", aid_int, it(resumo="x", proximoEm=d(1))), "Descreva o próximo passo")
erro(post(f"/matriculas/alunos/{ANA}", aid_int, it(resumo="x", proximoPasso="Retornar", proximoEm=d(-6))), "antes da interação"); erro(post(f"/matriculas/alunos/{ANA}", aid_int, it(resumo="x", tipo="FOFOCA")), "inválido")
erro(post(f"/matriculas/alunos/{ANA}", aid_int, it(resumo="x", etapa="NAO_EXISTE")), "Etapa da jornada inválida")
erro(post(f"/matriculas/alunos/{ANA}", aid_int, it(resumo="Tentativa fora do escopo"), sess=G), "não é da sua unidade")
FS = mk(); login(FS, "fin@rede", "senha12345"); erro(post(f"/matriculas/alunos/{ANA}", aid_int, it(resumo="x"), sess=FS), "Seu perfil não registra")
erro(post(f"/matriculas/alunos/{ANA}", aid_int, it(studentId=CAND, resumo="Candidato não entra no radar")), "já estudam na rede")
assert psql(f"SELECT count(*) FROM family_contacts WHERE student_id IN ({ANA}, {CAND})") == "0"; ok("interação: resumo, data, próximo passo com data, tipo, etapa, escopo e só famílias da rede validados")
okmsg(post(f"/matriculas/alunos/{ANA}", aid_int, it(resumo="Mãe pediu retorno sobre troca de turma", percepcao="NEGATIVA", etapa="BOAS_VINDAS", proximoPasso="Retornar sobre a troca de turma", proximoEm=d(-1))), "Etapa “Boas-vindas” cumprida")
assert psql(f"SELECT count(*) FROM notifications WHERE user_id={DIR} AND titulo='Interação com percepção negativa'") == "1" and psql(f"SELECT concluida_em FROM family_journey WHERE student_id={ANA} AND etapa='BOAS_VINDAS'") == d(-5)
ok("interação registrada: etapa cumprida na data da conversa; percepção negativa avisa a responsável da carteira")
html = page("/atendimento/radar"); i = html.find("Ana Radar"); assert i > 0 and "próximo passo vencido" in html[i:i + 1500]; assert "Ana Radar" in page("/atendimento/radar?visao=atencao")
html = page(f"/matriculas/alunos/{ANA}"); assert "Atenção" in html and "Próximo passo vencido em" in html and "Mãe pediu retorno sobre troca de turma" in html; ok("próximo passo vencido → precisa de atenção hoje; segmento Atenção na ficha")
html_g = page(f"/matriculas/alunos/{ANA}", sess=G); assert "Relacionamento e jornada da família" not in html_g and "Mãe pediu retorno sobre troca de turma" not in html_g; ok("ficha de aluno de outra unidade não mostra o relacionamento (conversas, percepção, carteira)")
aid_et = aid_of(html, ">Cumprida<")
erro(post(f"/matriculas/alunos/{ANA}", aid_et, {"studentId": ANA, "etapa": "BOAS_VINDAS", "voltar": VA}), "já está cumprida")
okmsg(post(f"/matriculas/alunos/{ANA}", aid_et, {"studentId": ANA, "etapa": "ACOMPANHAMENTO_LIVRE", "voltar": VA}), "cumprida")
erro(post(f"/matriculas/alunos/{ANA}", aid_et, {"studentId": ANA, "etapa": "ACOMPANHAMENTO_LIVRE", "ano": ANO, "desfazer": "1", "voltar": VA}, sess=C), "Desfazer etapa é da Direção")
erro(post(f"/matriculas/alunos/{ANA}", aid_et, {"studentId": ANA, "etapa": "ACOMPANHAMENTO_LIVRE", "ano": ANO, "desfazer": "1", "voltar": VA}, sess=G), "não é da sua unidade")
okmsg(post(f"/matriculas/alunos/{ANA}", aid_et, {"studentId": ANA, "etapa": "ACOMPANHAMENTO_LIVRE", "ano": ANO, "desfazer": "1", "voltar": VA}, sess=DS), "desmarcada")
assert psql(f"SELECT count(*) FROM family_journey WHERE student_id={ANA}") == "1"; ok("etapa: duplicada recusada; desfazer só Direção/RH/diretor da unidade (com auditoria)")
okmsg(post(f"/matriculas/alunos/{ANA}", aid_int, it(data=H, resumo="Retorno dado: troca de turma aprovada", percepcao="POSITIVA")), "Interação registrada")
assert "Ana Radar" not in page("/atendimento/radar")[page("/atendimento/radar").find("Precisa de atenção hoje ("):]; ok("nova interação sem próximo passo encerra o passo vencido")

print("Segmentos, saída e voz da família")
psql(f"INSERT INTO cases (student_id, unit_id, tipo, canal, assunto, status, prioridade, sla_ate) VALUES ({CARLA}, {CAR}, 'SAIDA', 'TELEFONE', 'Mudança de cidade', 'ABERTO', 'ALTA', now() + interval '2 days')")
html = page("/atendimento/radar"); i = html.find("Carla Radar"); assert i > 0 and "pedido de saída em aberto" in html[i:i + 1500]
assert "Carla Radar" in page("/atendimento/radar?visao=risco") and "Bruno Radar" in page("/atendimento/radar?visao=saudaveis") and "Davi Radar" in page("/atendimento/radar?visao=saudaveis")
psql(f"INSERT INTO surveys (tipo, nota, data, unit_id, student_id, comentario, anonimo) VALUES ('NPS', 10, '{H}', {CAR}, {BRU}, 'Equipe muito atenciosa', false), ('NPS', 3, '{H}', {CAR}, {CARLA}, 'Comentário anônimo', true)")
html = page("/atendimento/radar"); assert "Equipe muito atenciosa" in html and "Comentário anônimo" not in html; ok("saída aberta → risco; voz da família só com pesquisa identificada (anônima nunca aparece)")
r = S.get(B + "/api/export/radar"); assert r.status_code == 200 and "Ana Radar" in r.text and "Diretora Carandá" in r.text and "Risco" in r.text
assert "Ana Radar" not in G.get(B + "/api/export/radar").text and "Davi Radar" in G.get(B + "/api/export/radar").text; ok("exportação do radar respeita o escopo")

print("Indicação (sem CRM: só o vínculo família → candidato)")
html = page(f"/matriculas/alunos/{CAND}"); assert "Indicação" in html and "familias-rede" in html; aid_ind = aid_of(html, 'name="indicadoPor"'); VC = f"/matriculas/alunos/{CAND}"
erro(post(VC, aid_ind, {"studentId": CAND, "voltar": VC, "indicadoPor": "Nome Que Não Existe"}), "não encontrada"); erro(post(VC, aid_ind, {"studentId": CAND, "voltar": VC, "indicadoPor": f"x (#{CAND})"}), "a si mesmo")
psql("INSERT INTO students (nome, aluno_atual) VALUES ('Outro Candidato', false)"); OUTRO = psql("SELECT id FROM students WHERE nome='Outro Candidato'")
erro(post(VC, aid_ind, {"studentId": CAND, "voltar": VC, "indicadoPor": f"Outro Candidato (#{OUTRO})"}), "entre os alunos da rede")
okmsg(post(VC, aid_ind, {"studentId": CAND, "voltar": VC, "indicadoPor": f"Ana Radar — Carandá (#{ANA})"}), "origem definida como Indicação")
assert psql(f"SELECT origem || ':' || indicado_por_id FROM students WHERE id={CAND}") == f"INDICACAO:{ANA}"
erro(post(VC, aid_ind, {"studentId": ANA, "voltar": VC, "indicadoPor": f"(#{CAND})"}), "entre os alunos da rede")
okmsg(post(VC, aid_ind, {"studentId": BRU, "voltar": VC, "indicadoPor": f"(#{ANA})"})); erro(post(VC, aid_ind, {"studentId": ANA, "voltar": VC, "indicadoPor": f"(#{BRU})"}), "recíproca")
okmsg(post(VC, aid_ind, {"studentId": BRU, "voltar": VC, "indicadoPor": ""}), "Indicação removida")
okmsg(post(VC, aid_ind, {"studentId": CAND, "voltar": VC, "indicadoPor": "Bruno Radar"}), "Indicação registrada"); okmsg(post(VC, aid_ind, {"studentId": CAND, "voltar": VC, "indicadoPor": f"Ana Radar — Carandá (#{ANA})"}))
assert "Indicou à escola" in page(f"/matriculas/alunos/{ANA}") and "Candidata Indicada" in page(f"/matriculas/alunos/{ANA}")
html = page("/atendimento/radar"); assert re.search(r"Indicações em " + str(ANO) + r".*?>1<", html, re.S); ok("indicação: nome exato ou lista; recíproca e a si mesmo recusadas; origem vira Indicação; ficha e radar contam")

print("Rotina diária")
if MESMO_ANO:
    r = requests.get(B + f"/api/tarefas?token={TOKEN}"); assert r.json()["ok"], r.text
    # passo vencido: cria um novo passo vencido para Bruno (carteira da diretora)
    psql(f"INSERT INTO family_contacts (student_id, data, tipo, resumo, proximo_passo, proximo_em, user_id, user_nome) VALUES ({BRU}, '{d(-3)}', 'LIGACAO', 'Combinou visita', 'Confirmar visita', '{d(-1)}', {RH}, 'RH')")
    r = requests.get(B + f"/api/tarefas?token={TOKEN}"); assert r.json()["ok"], r.text
    cid = psql(f"SELECT max(id) FROM family_contacts WHERE student_id={BRU}")
    assert psql(f"SELECT count(*) FROM notifications WHERE user_id={DIR} AND chave='passo:{cid}'") == "1"
    assert psql(f"SELECT texto FROM notifications WHERE user_id={DIR} AND chave='jornadaatraso:{DIR}:CONVERSA_DE_REMATRICULA:{ANO}'") == "2 família(s) da sua carteira ainda sem esta etapa."
    assert psql(f"SELECT count(*) FROM notifications WHERE user_id={DIR} AND chave='jornada:{DIR}:PESQUISA_DO_2_SEMESTRE:{ANO}'") == "1"
    assert psql(f"SELECT count(*) FROM notifications WHERE user_id={DIR} AND chave LIKE 'jornadaatraso:{DIR}:BOAS_VINDAS:%'") == "0"
    QJ = "SELECT count(*) FROM notifications WHERE chave LIKE 'passo:%' OR chave LIKE 'jornada%'"; n1 = psql(QJ); requests.get(B + f"/api/tarefas?token={TOKEN}"); assert psql(QJ) == n1
    ok("rotina: próximo passo vencido e jornada (atrasada há até 30 dias / próxima) avisam a responsável da carteira, sem repetir")
else: ok("rotina: verificação de datas da jornada pulada (virada de ano)")
html = page("/atendimento/radar"); assert re.search(r"Jornada " + str(ANO) + r" atrasada", html); ok("radar mostra jornada atrasada do ano")
print(f"\nALL RADAR E2E CHECKS PASSED ({N[0]} grupos)")
