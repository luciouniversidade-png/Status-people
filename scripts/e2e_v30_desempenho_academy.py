# E2E — v30 · Desempenho e Academy. Pesquisa de liderança (cada pessoa avalia o gestor direto, anônima: o gestor é obrigatório e
# validado, uma resposta por navegador, resultado só com o mínimo de respostas, o gestor vê só o próprio resultado e nunca os
# comentários; pontos de atenção e práticas sugeridas; card em Minha equipe; índice no Painel Executivo); calibração com referência
# (sem cota, soma 100%) e consistência entre avaliadores; Nine Box com as pessoas; metas ligadas a objetivos/KRs e painel de metas.
# Academy: custo e instrutor; inscrição aberta com aprovação do gestor direto (pendência, permissão, recusa com motivo, aviso),
# desistência; avaliação de reação só depois de concluir (pendência); certificado com código de conferência (a própria pessoa e a
# gestão; colega não abre); painel de aprendizagem (investimento, horas, ranking com mínimo de avaliações).
# Dados fictícios. Uso: bash /tmp/withserver.sh python3 scripts/e2e_v30_desempenho_academy.py
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
U = {c: int(psql(f"SELECT id FROM units WHERE codigo='{c}'")) for c in ["CAR", "CUL"]}; CAR, CUL = U["CAR"], U["CUL"]
P = {n: int(psql(f"SELECT id FROM positions WHERE nome='{n}'")) for n in ["Professor", "Coordenador Pedagógico", "Diretor Pedagógico"]}
def emp(nome, cargo, unit, gestor=None):
    return int(psql(f"INSERT INTO employees (nome, unit_id, position_id, vinculo, admissao, gestor_id, situacao, jornada_min_dia, sexo) VALUES ({q(nome)}, {unit}, {P[cargo]}, 'CLT', '2021-02-01', {q(gestor)}, 'ATIVO', 480, 'F') RETURNING id"))
EDIR = emp("Diretora Fictícia", "Diretor Pedagógico", CAR)
CA = emp("Coordenadora Alfa (fictícia)", "Coordenador Pedagógico", CAR, EDIR); CB = emp("Coordenador Beta (fictício)", "Coordenador Pedagógico", CUL, EDIR)
TA = [emp(f"Professora Alfa {i} (fictícia)", "Professor", CAR, CA) for i in range(7)]; TB = [emp(f"Professor Beta {i} (fictício)", "Professor", CUL, CB) for i in range(3)]
SEMG = emp("Professora Sem Gestor (fictícia)", "Professor", CAR)
aid_user = aid_of(page("/configuracoes", RH), "Criar acesso")
for eid, em in [(CA, "alfa@car"), (CB, "beta@cul"), (TA[0], "pa0@car"), (TA[1], "pa1@car"), (TB[0], "pb0@cul"), (SEMG, "semg@car")]:
    okmsg(post("/configuracoes", aid_user, {"modo": "auto", "employeeId": eid, "nome": "", "email": em, "senha": "senha12345", "atuacao": "LEITURA", "unitId": ""}, RH))
GA, GB, PA0, PA1, PB0, SG = [login(e) for e in ["alfa@car", "beta@cul", "pa0@car", "pa1@car", "pb0@cul", "semg@car"]]
UGA = int(psql("SELECT id FROM users WHERE email='alfa@car'"))
ok("duas coordenações fictícias (7 e 3 liderados), uma professora sem gestor; acessos pelo cargo")

print("Pesquisa de liderança")
h = page("/clima", RH); loc = post("/clima", aid_of(h, 'name="perguntas"'), {"nome": "Liderança · teste", "tipo": "LIDERANCA", "unitId": "", "inicio": d(-14), "fim": d(-1), "perguntas": "", "minimoAnonimato": "2"}, RH); okmsg(loc)
SID = int(re.search(r"/clima/(\d+)", loc).group(1)); assert psql(f"SELECT minimo_anonimato||'|'||jsonb_array_length(perguntas) FROM climate_surveys WHERE id={SID}") == "3|9"
TOK = psql(f"SELECT token FROM climate_surveys WHERE id={SID}")
h = page(f"/clima/{SID}", RH); okmsg(post(f"/clima/{SID}", aid_of(h, 'value="ABERTA"'), {"id": SID, "status": "ABERTA"}, RH))
def responder(g, notas, enps=9, com="", sess=None):
    s = sess or mk(); hp = s.get(B + f"/pesquisa/{TOK}").text.replace("\xa0", " "); data = {"token": TOK, "gestorId": g if g else "", "unitId": "", "regime": "", "enps": enps, "aberta": com}
    for i, n in enumerate(notas): data[f"l{i + 1}"] = n
    return post(f"/pesquisa/{TOK}", aid_public(hp, 'name="gestorId"'), data, s)
hp = mk().get(B + f"/pesquisa/{TOK}").text; assert "Coordenadora Alfa" in hp and "Coordenador Beta" in hp and "Professora Alfa 1" not in hp.split('name="gestorId"')[1].split("</select>")[0]
assert "Escolha quem é o seu gestor direto" in responder(None, [5] * 7)
assert "Gestor inválido" in responder(TA[2], [5] * 7)
s1 = mk(); assert "obrigado=1" in responder(CA, [5, 5, 4, 2, 2, 5, 5], 10, "Reuniões curtas ajudam muito", s1); assert "já enviou" in responder(CA, [5] * 7, 9, "", s1)
for notas in [[5, 4, 4, 2, 1, 4, 5], [4, 4, 5, 2, 2, 5, 4], [5, 5, 5, 3, 2, 4, 5], [4, 5, 4, 2, 3, 5, 5]]: assert "obrigado=1" in responder(CA, notas, 8)
for notas in [[4, 4, 4, 4, 4, 4, 4], [5, 5, 5, 5, 5, 5, 5]]: assert "obrigado=1" in responder(CB, notas, 9, "Comentário do Beta")
assert psql(f"SELECT count(*) FILTER (WHERE gestor_id={CA})||'|'||count(*) FILTER (WHERE gestor_id={CB}) FROM climate_responses WHERE survey_id={SID}") == "5|2"
cols = psql("SELECT string_agg(column_name, ',') FROM information_schema.columns WHERE table_name='climate_responses'"); assert "user" not in cols and "employee" not in cols, cols
h = page(f"/clima/{SID}", RH); okmsg(post(f"/clima/{SID}", aid_of(h, 'value="ENCERRADA"'), {"id": SID, "status": "ENCERRADA"}, RH))
h = page(f"/clima/{SID}", RH); assert "Coordenadora Alfa" in h and "menos de 3 respostas — protegido" in h and "Pontos de atenção" in h and "Apoio ao desenvolvimento" in h and "Reuniões curtas ajudam muito" in h
h = page(f"/clima/{SID}", GA); assert "Coordenadora Alfa" in h and "menos de 3 respostas — protegido" not in h and "Reuniões curtas ajudam muito" not in h and "Comentário do Beta" not in h  # (o nome do Beta só aparece na lista de responsáveis do plano de ação)
h = page(f"/clima/{SID}", GB); assert "menos de 3 respostas — protegido" in h and "Comentário do Beta" not in h and "Reuniões curtas ajudam muito" not in h and ">79%<" not in h
assert get(f"/clima/{SID}", PA0).status_code in (307, 404)
h = page("/equipe", GA); assert "Liderança na visão da equipe" in h and "Reuniões curtas ajudam muito" not in h and "comentário(s) da equipe ficam com o RH" in h
psql("DELETE FROM settings WHERE key='kpi_base'"); page("/executivo", RH); assert psql("SELECT value->'falhas' FROM settings WHERE key='kpi_base'") == "[]"
v = psql(f"SELECT round((sum(num)/sum(den)*100)::numeric) FROM kpi_series WHERE chave='pessoas.lideranca' AND periodo='{d(-1)[:7]}'")
assert v and 40 <= int(v) <= 100, v
ok("gestor obrigatório e validado (só quem tem equipe), uma resposta por navegador, nenhuma identificação de quem respondeu; mínimo de 3 (protegido abaixo); RH vê todos e os comentários, cada gestor só a própria linha e nunca comentários; colaborador fora; card em Minha equipe; índice de liderança calculado no Painel Executivo sem falhas")

print("Semana da equipe (ponto) em Minha equipe")
dow = HOJE.weekday(); seg = HOJE - timedelta(days=dow); dias = [(seg + timedelta(days=i)).isoformat() for i in range(5)]
psql(f"INSERT INTO timesheet_days (employee_id, data, esperado_min, trabalhado_min, status) VALUES ({TA[0]}, '{dias[0]}', 480, 480, 'NORMAL'), ({TA[1]}, '{dias[0]}', 480, 0, 'FALTA'), ({TA[2]}, '{dias[0]}', 480, 0, 'ATESTADO'), ({TA[3]}, '{dias[0]}', 480, 390, 'NORMAL')")
psql(f"INSERT INTO hour_entries (employee_id, data, minutos, tipo, status) VALUES ({TA[0]}, '{dias[0]}', 120, 'EXTRA', 'APROVADO'), ({TA[0]}, '{(seg - timedelta(days=7)).isoformat()}', 90, 'EXTRA', 'APROVADO'), ({TA[1]}, '{dias[0]}', 60, 'EXTRA', 'PENDENTE')")
h = page("/equipe", GA); assert "Semana da equipe" in h and "Horas extras aprovadas — 8 semanas" in h and 'title="falta"' in h and 'title="ausência justificada"' in h and 'title="atestado (abonado)"' not in h and "1 lançamento(s) do banco aguardando decisão" in h and "1 falta(s) na semana" in h
h = page(f"/equipe?gestor={CA}", RH); assert 'title="atestado (abonado)"' in h
assert "Semana da equipe" not in page("/equipe", GB) or 'title="falta"' not in page("/equipe", GB)
# navegação entre semanas (a semana sem espelho importado oferece a última importada)
seg2 = seg - timedelta(days=14); psql(f"INSERT INTO timesheet_days (employee_id, data, esperado_min, trabalhado_min, status) VALUES ({TA[0]}, '{seg2.isoformat()}', 480, 480, 'NORMAL') ON CONFLICT DO NOTHING")
h = page(f"/equipe?semana={(seg2 + timedelta(days=2)).isoformat()}", GA); assert f"Semana da equipe — {seg2.strftime('%d/%m/%Y')}" in h and "próxima semana →" in h and "esta semana" in h
h = page(f"/equipe?semana={(seg + timedelta(days=21)).isoformat()}", GA); assert f"Semana da equipe — {seg.strftime('%d/%m/%Y')}" in h and "próxima semana →" not in h  # semana futura volta para a atual
h = page(f"/equipe?semana={(seg - timedelta(days=7)).isoformat()}", GA); assert "ainda não foi importado" in h and f"Ver a semana de {seg2.strftime('%d/%m/%Y')}" in h
ok("semana da equipe para a gestora: jornada cumprida, abaixo do previsto, falta e ausência justificada (o motivo de saúde só o RH vê), horas extras aprovadas em 8 semanas e o que aguarda decisão; outra coordenação não vê esta equipe")

print("Calibração com referência, consistência e Nine Box")
CY = int(psql(f"INSERT INTO perf_cycles (nome, inicio, fim, status, competencias, fase) VALUES ('Ciclo fictício', '{d(-120)}', '{d(-5)}', 'ENCERRADO', '[]'::jsonb, 'CONCLUSAO') RETURNING id"))
UGB = int(psql("SELECT id FROM users WHERE email='beta@cul'"))
for i, e in enumerate(TA[:6]): psql(f"INSERT INTO perf_reviews (cycle_id, employee_id, avaliador_user_id, status, nota_final, desempenho_nivel, potencial) VALUES ({CY}, {e}, {UGA}, 'CONCLUIDA', {4.6 - i * 0.05}, 3, {1 + i % 3})")
for i, e in enumerate([TA[6]] + TB + [SEMG, CA]): psql(f"INSERT INTO perf_reviews (cycle_id, employee_id, avaliador_user_id, status, nota_final, desempenho_nivel, potencial) VALUES ({CY}, {e}, {UGB}, 'CONCLUIDA', {2.6 + i * 0.05}, 1, 2)")
h = page(f"/desempenho/ciclos/{CY}", RH); assert "Calibração — distribuição real × referência" in h and "nenhuma cota é aplicada" in h and "avalia acima da média — conversar" in h and "avalia abaixo da média — conversar" in h and "Nine Box com as pessoas — 12" in h
assert h.count(f'href="/desempenho/avaliacoes/') >= 12 and 'title="Professora Alfa 0 (fictícia)"' in h
assert "Calibração — distribuição real" not in page(f"/desempenho/ciclos/{CY}", GA)
hc = page("/configuracoes", RH); aid_cal = aid_of(hc, 'name="refDestaque"')
erro(post("/configuracoes", aid_cal, {"secao": "calibracao", "refDestaque": "20", "refConsistente": "70", "refPrioritario": "20", "consMin": "5", "consDelta": "0.5", "metaDias": "30"}, RH), "soma 100%")
okmsg(post("/configuracoes", aid_cal, {"secao": "calibracao", "refDestaque": "20", "refConsistente": "65", "refPrioritario": "15", "consMin": "5", "consDelta": "0.5", "metaDias": "30"}, RH), "não é cota")
assert "ref. 20%" in page(f"/desempenho/ciclos/{CY}", RH)
ok("distribuição real × referência (sem cota; referência precisa somar 100%), consistência: quem avalia acima e abaixo da média aparece para a conversa; Nine Box com as iniciais (nome no título, link para a avaliação); coordenação não vê a calibração do ciclo")

print("Metas ligadas à estratégia e painel de metas")
OBJ = int(psql("INSERT INTO objectives (ciclo, titulo, status) VALUES ('2027', 'Uma equipe que fica e cresce', 'ATIVO') RETURNING id")); KR = int(psql(f"INSERT INTO key_results (objective_id, titulo, valor_meta) VALUES ({OBJ}, 'Turnover abaixo de 12%', 12) RETURNING id"))
CY2 = int(psql(f"INSERT INTO perf_cycles (nome, inicio, fim, status, competencias, fase, criterios) VALUES ('Ciclo em andamento', '{d(-30)}', '{d(150)}', 'ABERTO', '[]'::jsonb, 'PLANEJAMENTO', '[]'::jsonb) RETURNING id"))
psql(f"INSERT INTO perf_reviews (cycle_id, employee_id, status) VALUES ({CY2}, {TA[0]}, 'PENDENTE'), ({CY2}, {TB[0]}, 'PENDENTE')")
h = page(f"/colaboradores/{TA[0]}/painel?ciclo={CY2}&aba=metas", GA); assert "Contribui para (estratégia, opcional)" in h; aid_meta = aid_of(h, 'name="contribuiPara"')
meta = {"employeeId": TA[0], "cycleId": CY2, "titulo": "Reduzir faltas da turma", "tipo": "OPERACIONAL", "direcao": "MENOR_MELHOR", "esperado": "5", "regraInterpretacao": "Faltas por aluno no bimestre", "voltar": f"/colaboradores/{TA[0]}/painel?aba=metas"}
okmsg(post(f"/colaboradores/{TA[0]}/painel", aid_meta, {**meta, "contribuiPara": f"k:{KR}"}, GA), "Meta salva")
assert psql(f"SELECT coalesce(objective_id::text,'-')||'|'||key_result_id FROM perf_goals WHERE employee_id={TA[0]}") == f"-|{KR}"
psql(f"INSERT INTO perf_goals (cycle_id, employee_id, titulo, objective_id, atualizada_em) VALUES ({CY2}, {TB[0]}, 'Projeto de leitura', {OBJ}, now() - interval '50 days')")
h = page("/desempenho/metas", RH); assert "Uma equipe que fica e cresce" in h and "Projeto de leitura" in h and "100%" in h.split("Ligadas à estratégia")[0][-400:] or "Ligadas à estratégia" in h
h = page("/desempenho/metas", GA); assert "sua equipe" in h and "Projeto de leitura" not in h and "Uma equipe que fica e cresce" in h
ok("meta ligada a um KR pelo painel do colaborador (gestora direta); painel de metas com alinhamento por objetivo e metas sem atualização; a coordenação vê só a própria equipe")

print("Academy: custo, inscrição com aprovação do gestor, reação, certificado e painel")
h = page("/academy", RH); aid_cur = aid_of(h, 'name="inscricaoAberta"')
loc = post("/academy", aid_cur, {"codigo": "CNV-01", "titulo": "Comunicação não violenta", "tipo": "OPCIONAL", "formato": "PRESENCIAL", "cargaHoras": "6", "custo": "0", "instrutor": "Consultoria fictícia", "inscricaoAberta": "1", "exigeAprovacao": "1"}, RH); okmsg(loc, "Treinamento salvo")
CNV = int(re.search(r"/academy/cursos/(\d+)", loc).group(1)); assert psql(f"SELECT instrutor||'|'||inscricao_aberta||'|'||exige_aprovacao FROM courses WHERE id={CNV}") == "Consultoria fictícia|true|true"
loc = post("/academy", aid_cur, {"codigo": "EXC-01", "titulo": "Planilhas", "tipo": "OPCIONAL", "formato": "ONLINE", "cargaHoras": "4", "custo": "49", "inscricaoAberta": "1"}, RH); EXC = int(re.search(r"/academy/cursos/(\d+)", loc).group(1))
loc = post("/academy", aid_cur, {"codigo": "FECH-01", "titulo": "Fechado", "tipo": "OPCIONAL", "formato": "ONLINE", "cargaHoras": "2"}, RH); FEC = int(re.search(r"/academy/cursos/(\d+)", loc).group(1))
h = page(f"/academy/cursos/{CNV}", RH); okmsg(post(f"/academy/cursos/{CNV}", aid_of(h, 'name="vagas"'), {"courseId": CNV, "data": d(-3), "horario": "13:30–19:30", "local": "Auditório", "instrutor": "Consultoria fictícia", "unitId": CAR, "vagas": "25", "custo": "2400"}, RH))
assert psql(f"SELECT custo FROM training_sessions WHERE course_id={CNV}") == "2400.00"
h = page("/academy/minha", PA0); assert "Inscrições abertas" in h and "Pedir inscrição" in h and "Inscrever-me" in h and "Fechado" not in h.split("Inscrições abertas")[1]
aid_ins = aid_of(h, "Pedir inscrição")
erro(post("/academy/minha", aid_ins, {"courseId": FEC}, PA0), "não está com inscrição aberta")
okmsg(post("/academy/minha", aid_ins, {"courseId": CNV}, PA0), "Inscrição registrada")
erro(post("/academy/minha", aid_ins, {"courseId": CNV}, PA0), "já está inscrito")
okmsg(post("/academy/minha", aid_ins, {"courseId": CNV}, PA1)); okmsg(post("/academy/minha", aid_ins, {"courseId": CNV}, SG)); okmsg(post("/academy/minha", aid_ins, {"courseId": EXC}, PB0))
st = dict(x.split("|") for x in psql(f"SELECT employee_id||'|'||status FROM training_enrollments WHERE course_id={CNV}").split("\n"))
assert st[str(TA[0])] == "AGUARDANDO_APROVACAO" and st[str(TA[1])] == "AGUARDANDO_APROVACAO" and st[str(SEMG)] == "INSCRITO" and psql(f"SELECT status FROM training_enrollments WHERE course_id={EXC}") == "INSCRITO"
assert psql(f"SELECT count(*) FROM notifications WHERE user_id={UGA} AND link='/academy/aprovar'") == "2" and "Aprovar a inscrição" in page("/pendencias", GA) and "Aprovar a inscrição" not in page("/pendencias", GB)
h = page("/academy/aprovar", GA); assert "Professora Alfa 0" in h and "Professora Alfa 1" in h; aid_dec = aid_of(h, 'name="decisao" value="INSCRITO"')
I0 = int(psql(f"SELECT id FROM training_enrollments WHERE course_id={CNV} AND employee_id={TA[0]}")); I1 = int(psql(f"SELECT id FROM training_enrollments WHERE course_id={CNV} AND employee_id={TA[1]}"))
assert "Professora Alfa" not in page("/academy/aprovar", GB)
erro(post("/academy/aprovar", aid_dec, {"id": I0, "decisao": "INSCRITO"}, GB), "gestor direto")
erro(post("/academy/aprovar", aid_dec, {"id": I0, "decisao": "INSCRITO"}, PA1), "gestor direto")
erro(post("/academy/aprovar", aid_dec, {"id": I1, "decisao": "RECUSADA", "motivo": ""}, GA), "motivo")
okmsg(post("/academy/aprovar", aid_dec, {"id": I0, "decisao": "INSCRITO"}, GA), "aprovada"); okmsg(post("/academy/aprovar", aid_dec, {"id": I1, "decisao": "RECUSADA", "motivo": "Semana do conselho de classe"}, GA), "recusada")
erro(post("/academy/aprovar", aid_dec, {"id": I0, "decisao": "RECUSADA", "motivo": "mudei de ideia"}, GA), "já decidida")
assert psql(f"SELECT count(*) FROM notifications WHERE link='/academy/minha#inscricoes'") == "2" and "Semana do conselho de classe" in page("/academy/minha", PA1)
h = page("/academy/minha", PA0); okmsg(post("/academy/minha", aid_of(h, "Cancelar inscrição"), {"courseId": CNV, "motivo": "Agenda"}, PA0), "cancelada"); assert psql(f"SELECT status FROM training_enrollments WHERE id={I0}") == "DESISTIU"
ok("treinamento com custo, instrutor e inscrição aberta (com e sem aprovação), turma com custo; inscrição fechada recusada, duplicada recusada; com gestor direto aguarda a aprovação (aviso e pendência só dele), sem gestor entra direto; outro gestor e colega não decidem; recusa com motivo visível ao colaborador; decisão única; desistência")
h = page("/academy/minha", PA0); assert "Nada para avaliar agora" in h
aid_av = None
psql(f"INSERT INTO training_progress (course_id, employee_id, status, inicio_em, concluido_em) VALUES ({CNV}, {TA[0]}, 'CONCLUIDO', '{d(-10)}', '{d(-2)}'), ({CNV}, {TA[1]}, 'EM_ANDAMENTO', '{d(-3)}', NULL)")
assert "Avaliar o treinamento" in page("/pendencias", PA0)
h = page("/academy/minha", PA0); aid_av = aid_of(h, f'id="reacao{CNV}"')
erro(post("/academy/minha", aid_av, {"courseId": CNV, "nota": "9"}, PA0), "1 a 5")
erro(post("/academy/minha", aid_av, {"courseId": CNV, "nota": "5"}, PA1), "depois de concluir")
okmsg(post("/academy/minha", aid_av, {"courseId": CNV, "nota": "5", "aplicavel": "4", "comentario": "Muito prático"}, PA0), "Obrigado")
assert psql(f"SELECT nota||'|'||aplicavel FROM training_feedback WHERE course_id={CNV} AND employee_id={TA[0]}") == "5|4" and "Avaliar o treinamento" not in page("/pendencias", PA0)
PG = int(psql(f"SELECT id FROM training_progress WHERE course_id={CNV} AND employee_id={TA[0]}"))
h = page(f"/academy/certificado/{PG}", PA0); assert "Certificado de conclusão" in h and "Professora Alfa 0 (fictícia)" in h and "Comunicação não violenta" in h
cod = psql(f"SELECT certificado FROM training_progress WHERE id={PG}"); assert len(cod) == 10 and cod in h and cod in page(f"/academy/certificado/{PG}", GA)
assert get(f"/academy/certificado/{PG}", PA1).status_code == 404 and get(f"/academy/certificado/{PG}", GB).status_code == 404
h = page(f"/academy/cursos/{CNV}", RH); assert cod in h and f"/academy/certificado/{PG}" in h and "Inscrições (" in h and "R$ 2.400,00" in h  # o RH confere o código na lista de participantes; vê as inscrições e o custo da turma
PG2 = int(psql(f"SELECT id FROM training_progress WHERE course_id={CNV} AND employee_id={TA[1]}")); assert get(f"/academy/certificado/{PG2}", PA1).status_code == 404
h = page("/academy/painel", RH); assert "Painel de aprendizagem" in h and "R$ 2.400" in h and "Nenhum treinamento com 3 avaliações" in h and "Aguardando o gestor" in h
assert get("/academy/painel", PA0).status_code == 307
ok("reação só depois de concluir (pendência some ao responder; nota 1–5); certificado com código de conferência estável para a pessoa e a gestora (colega, outra unidade e quem não concluiu: não abre); painel com investimento da turma, ranking com mínimo de avaliações e inscrições; professor fora do painel")
print(f"OK — {N[0]} blocos verificados")
