# E2E — v30 · Recrutamento: avaliadores com notas independentes (convite, pendência, sigilo até enviar — também na vaga e no convite
# de outra pessoa —, validações, consolidado, “precisa de decisão”, cancelamento); vaga pausada (não move candidato, não convida, sai do
# quadro e da página pública; ao retomar, o prazo cresce pelos dias em pausa); página pública de vagas (só a Direção liga; publicação
# exige descrição; robô do campo escondido; consentimento; currículo mínimo; duplicidade; mesmo e-mail com outro nome vira cadastro
# novo; limite por hora); proposta enviada/aceita/recusada com motivo obrigatório; pesquisa de experiência do candidato no portal
# (só com o processo encerrado, uma vez, anonimato mínimo nos indicadores); satisfação do gestor aos 90 dias (pendência e permissão);
# quadro de candidatos, saúde das vagas, projeção e índice de qualidade da contratação. Dados fictícios.
# Uso: bash /tmp/withserver.sh python3 scripts/e2e_v30_recrutamento.py
import re, subprocess, hashlib, secrets, requests
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
def post(path, aid, data, sess, ip=None):
    f = [(f"$ACTION_ID_{aid}", (None, ""))]
    for k, v in data.items():
        for x in (v if isinstance(v, list) else [v]): f.append((k, (None, str(x))))
    r = sess.post(B + path, files=f, allow_redirects=False, headers={"X-Forwarded-For": ip} if ip else None); fix_cookie(sess, r)
    assert r.status_code in (303, 302, 200), (path, r.status_code, r.text[:300]); return unq(r.headers.get("location", "")).replace("\xa0", " ").replace("+", " ")
def aid_of(html, marker):
    i = html.find(marker); assert i >= 0, marker
    fs = html.rfind("<form", 0, i); fe_prev = html.rfind("</form>", 0, i)
    if fs > fe_prev: fe = html.find("</form>", i)
    else: fs = html.find("<form", i); fe = html.find("</form>", fs)
    ids = action_ids(html[fs:fe]); assert ids, marker; return ids[0]
def aid_public(html, marker):
    i = html.find(marker); assert i >= 0, marker; fs = html.rfind("<form", 0, i); fe = html.find("</form>", i)
    return re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', html[fs:fe])[0]
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
CAR = int(psql("SELECT id FROM units WHERE codigo='CAR'")); P = {n: int(psql(f"SELECT id FROM positions WHERE nome='{n}'")) for n in ["Professor", "Coordenador Pedagógico", "Diretor Pedagógico"]}
def emp(nome, cargo, gestor=None, admissao="2021-02-01"):
    return int(psql(f"INSERT INTO employees (nome, unit_id, position_id, vinculo, admissao, gestor_id, situacao, jornada_min_dia) VALUES ({q(nome)}, {CAR}, {P[cargo]}, 'CLT', '{admissao}', {q(gestor)}, 'ATIVO', 480) RETURNING id"))
EDIR = emp("Diretora Pedagógica Fictícia", "Diretor Pedagógico"); ECO = emp("Coordenador Fictício", "Coordenador Pedagógico", EDIR); EPR = emp("Professora Fictícia", "Professor", ECO)
aid_user = aid_of(page("/configuracoes", RH), "Criar acesso")
for eid, em in [(EDIR, "dir@car"), (ECO, "coord@car"), (EPR, "prof@car")]: okmsg(post("/configuracoes", aid_user, {"modo": "auto", "employeeId": eid, "nome": "", "email": em, "senha": "senha12345", "atuacao": "LEITURA", "unitId": ""}, RH))
assert psql("SELECT string_agg(role, ',' ORDER BY email) FROM users WHERE email IN ('dir@car','coord@car','prof@car')") == "GESTOR,DIRECAO,COLABORADOR"
DI, CO, PR = login("dir@car"), login("coord@car"), login("prof@car")
URH, UDI, UCO, UPR = [int(psql(f"SELECT id FROM users WHERE email='{e}'")) for e in ["rh@colegiostatus", "dir@car", "coord@car", "prof@car"]]
RID = int(psql(f"INSERT INTO requisitions (titulo, position_id, unit_id, quantidade, tipo, requisitos, regime, status, solicitante_user_id, responsavel_user_id, prazo, aberta_em, created_at) VALUES ('Professor de Matemática', {P['Professor']}, {CAR}, 1, 'SUBSTITUICAO', 'Licenciatura em Matemática: licenciatura, matemática', 'CLT', 'ABERTA', {UCO}, {URH}, '{d(15)}', '{d(-20)}', now() - interval '20 days') RETURNING id"))
def cand(nome, etapa, dias, email=None):
    c = int(psql(f"INSERT INTO candidates (nome, email, origem, consentimento_lgpd, curriculo_texto) VALUES ({q(nome)}, {q(email)}, 'INDICACAO', true, 'Licenciatura em Matemática; 6 anos em sala de aula.') RETURNING id"))
    return int(psql(f"INSERT INTO applications (requisition_id, candidate_id, etapa, etapa_desde, created_at) VALUES ({RID}, {c}, '{etapa}', now() - interval '{dias} days', now() - interval '{dias} days') RETURNING id"))
A = cand("Ana Avaliada (fictícia)", "ENTREVISTA_RH", 4); Bp = cand("Bruno Parado (fictício)", "TRIAGEM", 10); C = cand("Clara Proposta (fictícia)", "PROPOSTA", 3, "clara@exemplo.com"); D = cand("Davi Contratado (fictício)", "TRIAGEM", 2)
ok("vaga aberta fictícia (responsável: RH; pediu: coordenação) com quatro candidaturas; Direção, coordenação e professora com acesso pelo cargo")

print("Avaliadores com notas independentes")
h = page(f"/recrutamento/vagas/{RID}", RH); aid_conv = aid_of(h, 'name="avaliadores"')
erro(post(f"/recrutamento/vagas/{RID}", aid_conv, {"applicationId": A, "avaliadores": [UCO]}, PR), "não convida")
erro(post(f"/recrutamento/vagas/{RID}", aid_conv, {"applicationId": A}, RH), "pelo menos um avaliador")
psql(f"UPDATE users SET ativo=false WHERE id={UPR}"); erro(post(f"/recrutamento/vagas/{RID}", aid_conv, {"applicationId": A, "avaliadores": [UPR]}, RH), "sem acesso ativo"); psql(f"UPDATE users SET ativo=true WHERE id={UPR}")
okmsg(post(f"/recrutamento/vagas/{RID}", aid_conv, {"applicationId": A, "prazo": d(2), "avaliadores": [UCO, UDI, URH]}, RH), "Avaliadores convidados")
F = {int(u): int(i) for i, u in [x.split("|") for x in psql(f"SELECT id, avaliador_user_id FROM interview_feedback WHERE application_id={A}").split("\n")]}
assert psql(f"SELECT count(*) FROM interview_feedback WHERE application_id={A} AND etapa='ENTREVISTA_RH'") == "3" and psql(f"SELECT count(*) FROM notifications WHERE user_id={UCO} AND link LIKE '/recrutamento/avaliar/%'") == "1"
assert "Dar as suas notas" in page("/pendencias", CO)
assert get(f"/recrutamento/avaliar/{F[UCO]}", PR).status_code == 404
h = page(f"/recrutamento/avaliar/{F[UDI]}", DI); aid_av = aid_of(h, 'name="recomendacao"'); assert "As notas dos outros avaliadores aparecem aqui depois que você enviar" in h
erro(post(f"/recrutamento/avaliar/{F[UDI]}", aid_av, {"id": F[UDI], "sc_0": 4, "pontosFortes": "Boa aula"}, DI), "recomendação")
erro(post(f"/recrutamento/avaliar/{F[UDI]}", aid_av, {"id": F[UDI], "recomendacao": "SIM", "pontosFortes": "Boa aula"}, DI), "pelo menos um critério")
erro(post(f"/recrutamento/avaliar/{F[UDI]}", aid_av, {"id": F[UDI], "recomendacao": "SIM", "sc_0": 4}, DI), "ponto forte ou de atenção")
erro(post(f"/recrutamento/avaliar/{F[UDI]}", aid_av, {"id": F[UCO], "recomendacao": "SIM", "sc_0": 4, "pontosFortes": "x"}, DI), "não é seu")
okmsg(post(f"/recrutamento/avaliar/{F[UDI]}", aid_av, {"id": F[UDI], "recomendacao": "FORTE_SIM", "sc_0": 5, "sc_1": 5, "sc_2": 5, "pontosFortes": "Domínio do conteúdo; ótima aula-teste"}, DI), "consolidado")
erro(post(f"/recrutamento/avaliar/{F[UDI]}", aid_av, {"id": F[UDI], "recomendacao": "SIM", "sc_0": 4, "pontosFortes": "de novo"}, DI), "já enviou")
# sigilo: a coordenação (gestão na unidade e convidada) não vê as notas da Direção — nem no próprio convite, nem no convite da Direção, nem na vaga
for fid in (F[UCO], F[UDI]): h = page(f"/recrutamento/avaliar/{fid}", CO); assert "Domínio do conteúdo" not in h and "Consolidado dos avaliadores" not in h and "Forte sim 1" not in h, fid
h = page(f"/recrutamento/vagas/{RID}", CO); assert "o consolidado aparece depois que você enviar" in h and "Forte sim 1" not in h
h = page(f"/recrutamento/vagas/{RID}", DI); assert "Forte sim 1" in h  # quem já enviou vê o consolidado
h = page(f"/recrutamento/avaliar/{F[UCO]}", CO); okmsg(post(f"/recrutamento/avaliar/{F[UCO]}", aid_of(h, 'name="recomendacao"'), {"id": F[UCO], "recomendacao": "NAO", "sc_0": 2, "sc_1": 3, "sc_2": 2, "pontosAtencao": "Pouca experiência com Fundamental II"}, CO))
h = page(f"/recrutamento/avaliar/{F[UCO]}", CO); assert "Domínio do conteúdo" in h and "Consolidado dos avaliadores — 2 de 3 enviaram" in h
h = page(f"/recrutamento/vagas/{RID}", RH); aid_canc = aid_of(h, ">cancelar</button>")
erro(post(f"/recrutamento/vagas/{RID}", aid_canc, {"id": F[URH]}, PR), "")
okmsg(post(f"/recrutamento/vagas/{RID}", aid_canc, {"id": F[URH]}, RH)); assert psql(f"SELECT cancelado_em IS NOT NULL FROM interview_feedback WHERE id={F[URH]}") == "t"
h = page(f"/recrutamento/vagas/{RID}", RH); assert "precisa de decisão" in h and "divergem em" in h
h = page("/recrutamento/quadro", RH); assert "precisa de decisão" in h and "Ana Avaliada" in h and "Bruno Parado" in h and "parado há" in h
ok("convite só pela gestão e para acesso ativo; pendência “Dar as suas notas”; convite de outra pessoa fechado para quem não é da gestão; recomendação, ao menos um critério e uma evidência obrigatórios; envio único; sigilo até enviar — no convite, no convite alheio e na vaga; consolidado e divergência depois; cancelamento; “precisa de decisão” na vaga e no quadro")

print("Vaga pausada")
h = page(f"/recrutamento/vagas/{RID}", RH); aid_pa = aid_of(h, "Pausada, a vaga sai da página de vagas"); aid_mv = aid_of(h, f'name="id" value="{Bp}"')
erro(post(f"/recrutamento/vagas/{RID}", aid_pa, {"id": RID, "motivo": "Revisão do perfil"}, PR), "aprovação de vagas")
erro(post(f"/recrutamento/vagas/{RID}", aid_pa, {"id": RID, "motivo": "x"}, RH), "por que a vaga para")
okmsg(post(f"/recrutamento/vagas/{RID}", aid_pa, {"id": RID, "motivo": "Congelamento do orçamento até o fechamento do mês"}, RH), "Vaga pausada")
h = page(f"/recrutamento/vagas/{RID}", RH); assert "Pausada" in h and "Congelamento do orçamento" in h
erro(post(f"/recrutamento/vagas/{RID}", aid_mv, {"id": Bp, "etapa": "ENTREVISTA_RH"}, RH), "Vaga pausada")
erro(post(f"/recrutamento/vagas/{RID}", aid_conv, {"applicationId": Bp, "avaliadores": [UCO]}, RH), "não está aberta")
assert "Bruno Parado" not in page("/recrutamento/quadro", RH) and "Bruno Parado" in page("/recrutamento/quadro?pausadas=1", RH)
psql(f"UPDATE requisitions SET pausada_em='{d(-6)}' WHERE id={RID}"); prazo0 = psql(f"SELECT prazo FROM requisitions WHERE id={RID}")
h = page(f"/recrutamento/vagas/{RID}", RH); okmsg(post(f"/recrutamento/vagas/{RID}", aid_of(h, "Retomar"), {"id": RID}, RH), "prazo foi estendido")
assert psql(f"SELECT status||'|'||dias_pausada||'|'||(prazo - '{prazo0}'::date) FROM requisitions WHERE id={RID}") == "ABERTA|6|6"
ok("pausar exige permissão e motivo; pausada, não move candidato nem convida avaliador e sai do quadro (filtro “incluir pausadas”); ao retomar, o prazo cresce 6 dias e os dias em pausa ficam registrados")

print("Página pública de vagas")
h = page(f"/recrutamento/vagas/{RID}", RH); aid_pub = aid_of(h, 'name="descricaoPublica"')
erro(post(f"/recrutamento/vagas/{RID}", aid_pub, {"id": RID, "publicar": "1", "descricaoPublica": "curta"}, RH), "descrição pública")
okmsg(post(f"/recrutamento/vagas/{RID}", aid_pub, {"id": RID, "publicar": "1", "descricaoPublica": "Professor(a) de Matemática para o Fundamental II, com licenciatura e experiência em sala de aula. Jornada de 30 h semanais."}, RH), "ainda está desligada")
SLUG = psql(f"SELECT slug FROM requisitions WHERE id={RID}"); assert SLUG.endswith(f"-{RID}") and "matematica" in SLUG
anon = mk(); assert "Página de vagas indisponível" in anon.get(B + "/vagas").text
hc = page("/configuracoes", RH); aid_cfg = aid_of(hc, 'name="paginaAtiva"')
cfgrec = {"secao": "recrutamento", "paginaTitulo": "Trabalhe no Colégio Status", "paginaTexto": "Vagas abertas (fictício)", "paginaLimite": "3", "avaliacaoPrazo": "3", "satisfacaoDias": "90", "minExp": "5", "candPorVaga": "3", "motivosRecusa": "Salário abaixo da expectativa\nAceitou outra proposta\nHorário incompatível"}
erro(post("/configuracoes", aid_cfg, {**cfgrec, "paginaAtiva": "1"}, RH), "decisão da Direção")
okmsg(post("/configuracoes", aid_of(page("/configuracoes", DI), 'name="paginaAtiva"'), {**cfgrec, "paginaAtiva": "1"}, DI), "Página pública de vagas ligada")
h = anon.get(B + "/vagas").text; assert "Professor de Matemática" in h and SLUG in h
v0 = int(psql(f"SELECT visualizacoes FROM requisitions WHERE id={RID}")); hv = anon.get(B + f"/vagas/{SLUG}").text.replace("\xa0", " ")
assert int(psql(f"SELECT visualizacoes FROM requisitions WHERE id={RID}")) == v0 + 1 and "Licenciatura" not in hv.split("Sua trajetória")[0][-50:]
aid_cand = aid_public(hv, 'name="consentimento"'); CV = "Sou licenciada em Matemática pela universidade estadual, com seis anos de experiência no Fundamental II e projetos de robótica."
def cand_pub(nome, email, extra=None, ip="10.0.0.9"): return post(f"/vagas/{SLUG}", aid_cand, {"slug": SLUG, "nome": nome, "email": email, "curriculo": CV, "consentimento": "1", **(extra or {})}, mk(), ip)
n0 = int(psql("SELECT count(*) FROM applications"))
loc = cand_pub("Robô Spam", "spam@exemplo.com", {"site": "http://spam"}); assert "enviado=1" in loc and int(psql("SELECT count(*) FROM applications")) == n0
loc = post(f"/vagas/{SLUG}", aid_cand, {"slug": SLUG, "nome": "Paula Pública", "email": "paula@exemplo.com", "curriculo": CV}, mk(), "10.0.0.9"); assert "erro=" in loc and "autorize" in loc, loc
loc = cand_pub("Paula Pública", "paula@exemplo.com", {"curriculo": "curto"}); assert "trajetória" in loc, loc
loc = cand_pub("Paula", "paula@exemplo.com"); assert "nome completo" in loc, loc
loc = cand_pub("Paula Pública", "paula@exemplo.com"); assert loc.startswith("/candidatura/") and "ok=nova" in loc, loc
TOKP = loc.split("/candidatura/")[1].split("?")[0]
row = psql(f"SELECT c.origem||'|'||c.consentimento_lgpd||'|'||a.etapa FROM applications a JOIN candidates c ON c.id=a.candidate_id WHERE c.email='paula@exemplo.com'"); assert row == "SITE|true|TRIAGEM", row
assert "Paula Pública" in page("/recrutamento/quadro", RH) and psql(f"SELECT count(*) FROM notifications WHERE user_id={URH} AND titulo='Nova candidatura pela página de vagas'") == "1"
loc = cand_pub("Paula Pública", "paula@exemplo.com"); assert "já se candidatou" in loc, loc
loc = cand_pub("Paula Pereira Outra", "paula@exemplo.com"); assert "ok=nova" in loc and psql("SELECT count(*) FROM candidates WHERE email='paula@exemplo.com'") == "2"
loc = cand_pub("Quarta Pessoa", "quarta@exemplo.com"); assert "ok=nova" in loc, loc
loc = cand_pub("Quinta Pessoa", "quinta@exemplo.com"); assert "Muitas candidaturas" in loc, loc
loc = cand_pub("Quinta Pessoa", "quinta@exemplo.com", ip="10.0.0.77"); assert "ok=nova" in loc, loc
assert anon.get(B + f"/candidatura/{TOKP}").status_code == 200
ok("só a Direção liga a página; publicação exige descrição; lista e página da vaga com contador; robô do campo escondido descartado; consentimento, nome completo e trajetória obrigatórios; candidatura vira TRIAGEM (origem site, consentimento) com portal e aviso ao responsável; duplicada recusada; mesmo e-mail com outro nome é cadastro novo; limite por hora por origem")

print("Proposta: aceita e recusada")
h = page(f"/recrutamento/vagas/{RID}", RH); aid_mc = aid_of(h, f'name="id" value="{C}"')
erro(post(f"/recrutamento/vagas/{RID}", aid_mc, {"id": C, "etapa": "DESISTIU"}, RH), "motivo da recusa")
okmsg(post(f"/recrutamento/vagas/{RID}", aid_mc, {"id": C, "etapa": "DESISTIU", "motivoRecusa": "Salário abaixo da expectativa"}, RH))
assert psql(f"SELECT proposta_resposta||'|'||proposta_motivo FROM applications WHERE id={C}") == "RECUSADA|Salário abaixo da expectativa"
aid_md = aid_of(h, f'name="id" value="{D}"'); okmsg(post(f"/recrutamento/vagas/{RID}", aid_md, {"id": D, "etapa": "PROPOSTA", "propostaValor": "4200"}, RH))
assert psql(f"SELECT proposta_enviada_em FROM applications WHERE id={D}") == H
loc = post(f"/recrutamento/vagas/{RID}", aid_md, {"id": D, "etapa": "CONTRATADO", "admissao": d(-95)}, RH); okmsg(loc, "pré-cadastrado")
EMPD = int(psql(f"SELECT employee_id FROM applications WHERE id={D}")); assert psql(f"SELECT proposta_resposta FROM applications WHERE id={D}") == "ACEITA" and psql(f"SELECT tipo FROM employee_moves WHERE employee_id={EMPD}") == "ADMISSAO"
h = page("/recrutamento/indicadores", RH); assert "Propostas" in h and "50%" in h and "Salário abaixo da expectativa" in h
ok("desistência na proposta exige o motivo (vira indicador); proposta registra o envio; contratação marca aceite, pré-cadastra e abre o histórico funcional; aceite de 50% e motivos nos indicadores")

print("Experiência do candidato (portal) e satisfação do gestor")
def portal(app):
    t = secrets.token_urlsafe(24); psql(f"INSERT INTO candidate_portal_links (application_id, token_hash, expira_em) VALUES ({app}, '{hashlib.sha256(t.encode()).hexdigest()}', '{d(30)}')"); return t
TC, TA = portal(C), portal(A); s_c = mk(); hc = s_c.get(B + f"/candidatura/{TC}").text.replace("\xa0", " "); assert 'name="recomendaria"' in hc
assert 'name="recomendaria"' not in mk().get(B + f"/candidatura/{TA}").text
aid_exp = aid_public(hc, 'name="recomendaria"')
loc = post(f"/candidatura/{TC}", aid_exp, {"token": TC, "processo": 4, "recomendaria": 8}, s_c); assert "três perguntas" in loc, loc
loc = post(f"/candidatura/{TC}", aid_exp, {"token": TA, "processo": 4, "clareza": 4, "respeito": 5, "recomendaria": 8}, mk()); assert "quando o processo termina" in loc, loc
loc = post(f"/candidatura/{TC}", aid_exp, {"token": TC, "processo": 4, "clareza": 3, "respeito": 5, "recomendaria": 8, "comentario": "Retorno rápido"}, s_c); assert "ok=experiencia" in loc, loc
loc = post(f"/candidatura/{TC}", aid_exp, {"token": TC, "processo": 5, "clareza": 5, "respeito": 5, "recomendaria": 10}, s_c); assert "já respondeu" in loc, loc
assert psql("SELECT requisition_id IS NULL, desfecho, extract(dow FROM created_at) FROM candidate_experience") == "t|DESISTIU|1"
h = page("/recrutamento/indicadores", RH); assert "o resultado aparece a partir de 5" in h
psql(f"INSERT INTO candidate_experience (unit_id, desfecho, nota_processo, nota_clareza, nota_respeito, recomendaria, created_at) SELECT {CAR}, 'REPROVADO', 4, 4, 5, 9, date_trunc('week', now()) FROM generate_series(1, 4)")
h = page("/recrutamento/indicadores", RH); assert "Recomendaria (NPS)" in h and "Retorno rápido" in h
psql(f"UPDATE employees SET situacao='ATIVO', gestor_id={ECO} WHERE id={EMPD}")
assert "Avaliar a contratação" in page("/pendencias", CO) and "Avaliar a contratação" not in page("/pendencias", PR)
assert get(f"/recrutamento/contratacao/{D}", PR).status_code == 404
h = page(f"/recrutamento/contratacao/{D}", CO); aid_hf = aid_of(h, 'name="nota"')
erro(post(f"/recrutamento/contratacao/{D}", aid_hf, {"applicationId": D, "nota": 4}, CO), "contrataria de novo")
okmsg(post(f"/recrutamento/contratacao/{D}", aid_hf, {"applicationId": D, "nota": 4, "contrataria": "1", "comentario": "Integrou bem à equipe"}, CO), "índice de qualidade")
assert psql(f"SELECT nota||'|'||contrataria FROM hire_feedback WHERE employee_id={EMPD}") == "4|true" and "Avaliar a contratação" not in page("/pendencias", CO)
h = page("/recrutamento/indicadores", RH); assert "Índice de qualidade da contratação" in h and "Davi Contratado" in h and "Saúde das vagas abertas" in h and "Próximo mês — projeção" in h
ok("pesquisa no portal só com processo encerrado (desistência incluída), três notas obrigatórias, uma vez; resposta sem a vaga e com a semana (anonimato); resultado só com 5+ respostas; satisfação do gestor aos 90 dias: pendência só do gestor direto, página fechada para outros, “contrataria” obrigatório, entra no índice; saúde e projeção nos indicadores")
print(f"OK — {N[0]} blocos verificados")
