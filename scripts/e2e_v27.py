# v27 · e2e: movimentação e retenção, pontos quentes, minha equipe, clima favorável/neutro/desfavorável com comparação,
# qualidade da contratação e funil por vaga. Dados fictícios inseridos direto no banco de teste.
import re, subprocess, requests, json
B = "http://localhost:3100"
def psql(q): return subprocess.run(["su", "postgres", "-c", "/usr/lib/postgresql/16/bin/psql -h /tmp/pg -U status -d status_people -q -t -A -F '|' -v ON_ERROR_STOP=1"], input=q + ";", capture_output=True, text=True).stdout.strip()
S = requests.Session(); S.headers.update({"Origin": B})
def strip(h): return re.sub(r"<script[^>]*>.*?</script>", "", re.sub(r"<!--.*?-->", "", h), flags=re.S)
def page(path, expect=200, sess=None):
    r = (sess or S).get(B + path, allow_redirects=False); assert r.status_code == expect, (path, r.status_code, r.headers.get("location")); return strip(r.text)
def login(sess, email, senha):
    h = sess.get(B + "/login").text; aid = re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', h)[0]
    r = sess.post(B + "/login", files=[(f"$ACTION_ID_{aid}", (None, "")), ("email", (None, email)), ("senha", (None, senha))], allow_redirects=False)
    m = re.search(r"rh_session=([^;]+)", r.headers.get("set-cookie", "")); assert m, email; sess.headers["Cookie"] = f"rh_session={m.group(1)}"
login(S, "rh@colegiostatus", "Status2026!"); assert S.get(B + "/api/setup?token=setup-homologacao-2026-status").json()["ok"]
car = psql("SELECT id FROM units WHERE nome='Carandá'"); tv = psql("SELECT id FROM units ORDER BY id LIMIT 1 OFFSET 1") or car
def emp(nome, unit, adm, desl=None, motivo=None, gestor=None, nasc=None):
    return psql(f"INSERT INTO employees (nome, unit_id, vinculo, admissao, desligamento, motivo_desligamento, situacao, gestor_id, data_nascimento) VALUES ('{nome}', {unit}, 'CLT', {adm}, {desl or 'NULL'}, {repr(motivo) if motivo else 'NULL'}, '{'DESLIGADO' if desl else 'ATIVO'}', {gestor or 'NULL'}, {nasc or 'NULL'}) RETURNING id")
g1 = emp("Gestora Teste Retencao", car, "current_date - 2000")
g2 = emp("Gestor Teste Dois", car, "current_date - 1500")
eqs = [emp(f"Liderado {i}", car, f"current_date - {400 + i * 30}", gestor=g1, nasc="(date_trunc('month', current_date) + interval '3 days')::date" if i == 0 else None) for i in range(6)]
emp("Liderado do Dois", car, "current_date - 700", gestor=g2)
# saídas: período atual (2 no 1º ano, motivos) e período anterior
emp("Saiu Cedo Um", car, "current_date - 150", "current_date - 20", "Proposta melhor", g1)
emp("Saiu Cedo Dois", car, "current_date - 100", "current_date - 40", "Proposta melhor", g1)
emp("Saiu Veterano", car, "current_date - 3000", "current_date - 90", "Mudança de cidade", g2)
emp("Saiu Ano Passado", car, "current_date - 1200", "current_date - 500", "Mudança de cidade", g2)
# PDI atrasado para um liderado
pl = psql(f"INSERT INTO pdi_plans (employee_id, competencia, objetivo) VALUES ({eqs[0]}, 'Gestão de sala', 'Melhorar rotina') RETURNING id")
psql(f"INSERT INTO pdi_actions (plan_id, descricao, prazo, status) VALUES ({pl}, 'Curso de rotina', current_date - 10, 'EM_ANDAMENTO'), ({pl}, 'Leitura', current_date + 30, 'CONCLUIDA')")
# clima: duas pesquisas encerradas (anterior e atual) com dimensão Liderança caindo
perg = json.dumps([{"id": "q1", "dimensao": "Liderança", "texto": "Meu líder me ouve", "tipo": "ESCALA"}, {"id": "q2", "dimensao": "Reconhecimento", "texto": "Sou reconhecido", "tipo": "ESCALA"}])
sv1 = psql(f"INSERT INTO climate_surveys (nome, tipo, inicio, fim, status, perguntas, token, minimo_anonimato) VALUES ('Clima Teste 1', 'CLIMA', current_date - 400, current_date - 380, 'ENCERRADA', '{perg}'::jsonb, 'tk-v27-a', 3) RETURNING id")
sv2 = psql(f"INSERT INTO climate_surveys (nome, tipo, inicio, fim, status, perguntas, token, minimo_anonimato) VALUES ('Clima Teste 2', 'CLIMA', current_date - 30, current_date - 10, 'ENCERRADA', '{perg}'::jsonb, 'tk-v27-b', 3) RETURNING id")
for sv, notas in [(sv1, [(5, 4), (4, 4), (5, 3), (4, 5)]), (sv2, [(2, 4), (3, 4), (2, 5), (4, 3)])]:
    for a, b in notas: psql(f"INSERT INTO climate_responses (survey_id, unit_id, respostas) VALUES ({sv}, {car}, '{json.dumps({'q1': a, 'q2': b})}'::jsonb)")
# 1 · movimentação e retenção
h = page("/analytics/retencao?meses=12")
for k in ["Movimentação e retenção", "Proposta melhor", "Mudança de cidade", "Saiu Cedo Um", "Quem saiu antes de completar 1 ano", "Gestora Teste Retencao", "Pontos quentes", "Liderança: 25% favorável", "1º ano", "pessoa(s) com ação de PDI atrasada", "Estrutura de liderança", "Desenvolvimento (PDI)"]:
    assert k in h, k
print("retenção e pontos quentes ok")
# 2 · minha equipe (RH escolhendo a gestora)
h = page(f"/equipe?gestor={g1}")
for k in ["Minha equipe", "Equipe direta de Gestora Teste Retencao", "Liderado 0", "Liderado 5", "PDI atrasada", "aniversário", "1 atrasada(s)", "sem PDI"]:
    assert k in h, k
assert "Liderado do Dois" not in h; print("minha equipe ok")
# 3 · clima com comparação
h = page(f"/clima/{sv2}")
for k in ["Favorável · neutro · desfavorável por dimensão", "comparado a “Clima Teste 1”", "-75 p.p.", "Fav. · neutro · desf."]:
    assert k in h, k
print("clima comparado ok")
# 4 · recrutamento: funil por vaga e qualidade da contratação
rid = psql(f"INSERT INTO requisitions (titulo, unit_id, status, aberta_em, created_at) VALUES ('Vaga Funil Teste', {car}, 'ABERTA', current_date - 15, now() - interval '15 days') RETURNING id")
for nome, etapa in [("Cand Funil A", "TRIAGEM"), ("Cand Funil B", "ENTREVISTA_RH"), ("Cand Funil C", "REPROVADO")]:
    c = psql(f"INSERT INTO candidates (nome, origem) VALUES ('{nome}', 'SITE') RETURNING id"); a = psql(f"INSERT INTO applications (requisition_id, candidate_id, etapa, created_at) VALUES ({rid}, {c}, '{etapa}', now() - interval '10 days') RETURNING id")
    if etapa != "TRIAGEM": psql(f"INSERT INTO application_events (application_id, at, texto) VALUES ({a}, now() - interval '6 days', '{'→ ENTREVISTA_RH' if etapa == 'ENTREVISTA_RH' else 'Reprovado (sem formação)'}')")
h = page(f"/recrutamento/vagas/{rid}"); assert "Funil desta vaga — 3 candidatura(s)" in h and "1 saíram" in h, "funil vaga"
ce = emp("Contratada Avaliada", car, "current_date - 200"); cy = psql("INSERT INTO perf_cycles (nome, inicio, fim, competencias) VALUES ('Ciclo Teste v27', current_date - 60, current_date - 5, '[]'::jsonb) RETURNING id")
psql(f"INSERT INTO perf_reviews (cycle_id, employee_id, status, nota_final) VALUES ({cy}, {ce}, 'CONCLUIDA', 4.2)")
r3 = psql(f"INSERT INTO requisitions (titulo, unit_id, status, aberta_em, fechada_em, created_at) VALUES ('Vaga Fechada Teste', {car}, 'PREENCHIDA', current_date - 240, current_date - 205, now() - interval '240 days') RETURNING id")
c3 = psql("INSERT INTO candidates (nome, origem) VALUES ('Contratada Avaliada', 'INDICACAO') RETURNING id")
psql(f"INSERT INTO applications (requisition_id, candidate_id, etapa, employee_id) VALUES ({r3}, {c3}, 'CONTRATADO', {ce})")
h = page("/recrutamento/indicadores?meses=12"); assert "Qualidade da contratação" in h and "4,20" in h, "qualidade da contratação"; print("recrutamento ok")
# 5 · navegação e permissões
for p in ["/analytics/retencao?meses=6", "/analytics/retencao?meses=24", "/equipe", "/analytics", f"/clima/{sv1}"]: page(p)
h = page("/"); assert "/equipe" in h and "/analytics/retencao" in h, "itens de menu"
print("E2E v27: OK")
