# E2E — v31 · Desempenho e desenvolvimento.
# 360°: todos os pares do ciclo (autoavaliação, líder › liderado, pares) com progresso e situação; sugestão automática (mesmo gestor,
# mesma unidade, teto de convites por avaliador, um aviso por pessoa) e convite; inclusão à mão (só o RH, a direção da unidade ou o
# avaliador designado; sem duplicar, sem o próprio avaliado, sem o avaliador designado, só fontes ligadas no ciclo, teto); remoção só de
# quem não respondeu; relatório 360° (grupo abaixo do mínimo não aparece, pontos cegos e forças ocultas, comentários sem autor; o
# colaborador vê o próprio só depois de publicado).
# Metas: a meta que o colaborador cadastra é proposta (aviso ao gestor, pendência), devolução com motivo, nova proposta, aprovação em
# lote, meta aprovada só muda com o gestor, a gestão cadastra já aprovada; painel com cadastro e aprovação.
# Calibração: retrato de antes guardado na primeira calibração (modelo antigo e por critérios), Nine Box pré × pós, distribuição,
# movimentos com justificativa e filtros. PDI: engajamento por liderança (adesão, atraso, progresso; o gestor vê só a própria equipe),
# progresso geral e sugestões de área no painel (+ usar no plano). OKRs: desdobramento (pai do mesmo ciclo, sem ciclos), árvore e
# cartão no objetivo. Telas fixas (feedback e 1:1 para todos), parâmetros da v31.
# Dados fictícios. Uso: bash /tmp/withserver.sh python3 scripts/e2e_v31_desempenho.py
import re, json, subprocess, requests
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
def login(email, senha="senha12345"):
    s = mk(); html = s.get(B + "/login").text; aid = re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', html)[0]
    loc = post("/login", aid, {"email": email, "senha": senha}, s); assert loc.endswith("/"), (email, loc); return s
def erro(loc, trecho): assert "erro=" in loc and trecho in loc, (trecho, loc)
def okmsg(loc, trecho=""): assert "ok=" in loc and trecho in loc, (trecho, loc)
def q(v): return "NULL" if v is None else str(v) if isinstance(v, (int, float)) else "'" + str(v).replace("'", "''") + "'"
def j(v): return "'" + json.dumps(v, ensure_ascii=False).replace("'", "''") + "'::jsonb"
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
T = [emp(f"Professora Alfa {i} (fictícia)", "Professor", CAR, CA) for i in range(7)]; TB = [emp(f"Professor Beta {i} (fictício)", "Professor", CUL, CB) for i in range(2)]
aid_user = aid_of(page("/configuracoes", RH), "Criar acesso")
EM = {CA: "alfa@car", CB: "beta@cul", **{T[i]: f"t{i}@car" for i in range(6)}, TB[0]: "b0@cul"}
for eid, em in EM.items(): okmsg(post("/configuracoes", aid_user, {"modo": "auto", "employeeId": eid, "nome": "", "email": em, "senha": "senha12345", "atuacao": "LEITURA", "unitId": ""}, RH))
UID = {eid: int(psql(f"SELECT id FROM users WHERE email='{em}'")) for eid, em in EM.items()}
GA, GB, P0, P1 = login("alfa@car"), login("beta@cul"), login("t0@car"), login("t1@car")
CRIT = [{"id": "c1", "eixo": "RESULTADOS", "titulo": "Planejamento das aulas", "descricao": "Planos no prazo.", "peso": 1, "niveis": {}, "evidencia": "Planos", "naPermitido": False},
        {"id": "c2", "eixo": "RESULTADOS", "titulo": "Acompanhamento da aprendizagem", "descricao": "Recuperação registrada.", "peso": 1, "niveis": {}, "evidencia": "Registros", "naPermitido": False},
        {"id": "c3", "eixo": "ATITUDES", "titulo": "Colaboração com a equipe", "descricao": "Compartilha.", "peso": 1, "niveis": {}, "evidencia": "Reuniões", "naPermitido": False},
        {"id": "c4", "eixo": "ATITUDES", "titulo": "Comunicação respeitosa", "descricao": "Escuta.", "peso": 1, "niveis": {}, "evidencia": "Casos", "naPermitido": False}]
C4 = int(psql(f"INSERT INTO perf_cycles (nome, inicio, fim, status, competencias, criterios, fase, nota_composta, faixas, cobertura_minima, fontes, peso_resultados, peso_atitudes) VALUES ('Ciclo 360 · teste', '{d(-60)}', '{d(60)}', 'ABERTO', '[]'::jsonb, {j(CRIT)}, 'AVALIACAO', true, {j({'matriz': [2, 3, 4], 'final': [3, 4]})}, 50, {j({'PAR': {'peso': 20, 'minimo': 3}, 'GESTOR': {'peso': 80, 'minimo': 1}})}, 50, 50) RETURNING id"))
RV = {e: int(psql(f"INSERT INTO perf_reviews (cycle_id, employee_id, avaliador_user_id, status, estado) VALUES ({C4}, {e}, {UID[CA]}, 'PENDENTE', 'RASCUNHO') RETURNING id")) for e in T}
ok("coordenação fictícia com 7 professoras (6 com acesso), ciclo por critérios com pares (mín. 3) e as avaliações geradas")

print("360° — participantes, sugestão automática e convites")
h = page(f"/desempenho/ciclos/{C4}/participantes", RH); assert "Autoavaliação" in h and "Líder › liderado" in h and "Pares no ciclo" in h and h.count("Não iniciada") >= 14
assert f"/desempenho/ciclos/{C4}/relatorio-360" in h and "Participantes (360°)" in h
psql("INSERT INTO settings (key, value) VALUES ('desempenho', '{\"paresSugeridos\": 3, \"maxConvitesPorAvaliador\": 3}'::jsonb) ON CONFLICT (key) DO UPDATE SET value = settings.value || EXCLUDED.value")
h = page(f"/desempenho/ciclos/{C4}/participantes?sugerir=1", RH); pares = sorted(set(re.findall(r'name="par"[^>]*value="([0-9:A-Z]+)"', h)))
assert pares and all(x.endswith(":PAR") for x in pares) and "mesmo gestor" in h, pares
carga = {}
for x in pares: carga[x.split(":")[1]] = carga.get(x.split(":")[1], 0) + 1
assert max(carga.values()) <= 3 and str(UID[CA]) not in carga, carga
for x in pares: rid, uid, _ = x.split(":"); assert psql(f"SELECT employee_id FROM perf_reviews WHERE id={rid}") != psql(f"SELECT employee_id FROM users WHERE id={uid}")
okmsg(post(f"/desempenho/ciclos/{C4}/participantes", aid_of(h, 'name="par"'), {"cycleId": C4, "par": pares}, RH), f"{len(pares)} convite(s)")
assert int(psql(f"SELECT count(*) FROM review_raters rr JOIN perf_reviews r ON r.id=rr.review_id WHERE r.cycle_id={C4} AND rr.grupo='PAR'")) == len(pares)
uid0 = list(carga.keys())[0]; assert psql(f"SELECT count(*) FROM notifications WHERE user_id={uid0} AND chave LIKE 'rater-lote:{C4}:{uid0}:%'") == "1"
erro(post(f"/desempenho/ciclos/{C4}/participantes", aid_of(h, 'name="par"'), {"cycleId": C4, "par": ["999:999:PAR"]}, RH), "Marque ao menos um par sugerido")
ok("todos os pares com progresso e situação; sugestão só com colegas da unidade (nunca o próprio nem o avaliador designado), teto de convites respeitado, um aviso por pessoa com a quantidade")

print("360° — inclusão e remoção à mão")
h = page(f"/desempenho/ciclos/{C4}/participantes", GA); aidp = aid_of(h, 'placeholder="Ex.: dividem a coordenação do 6º ano"'); assert "Adicionar um novo par avaliador" in h and "⇄" in h
livre = int(psql(f"SELECT u.id FROM users u WHERE u.employee_id = ANY(ARRAY[{','.join(map(str, T[:6]))}]) AND u.id NOT IN (SELECT rr.user_id FROM review_raters rr WHERE rr.review_id={RV[T[6]]}) ORDER BY u.id LIMIT 1"))
# a sugestão encheu todo mundo até o teto (3): libera uma vaga de quem vai ser incluído à mão
conv = psql(f"SELECT x.id FROM review_raters x JOIN perf_reviews r ON r.id=x.review_id WHERE r.cycle_id={C4} AND x.user_id={livre} ORDER BY x.id").split()
if len(conv) >= 3: psql(f"DELETE FROM review_raters WHERE id IN ({','.join(conv[:len(conv) - 2])})")
erro(post(f"/desempenho/ciclos/{C4}/participantes", aidp, {"cycleId": C4, "userId": UID[T[0]], "reviewId": RV[T[0]], "grupo": "PAR"}, GA), "não é par de si mesmo")
erro(post(f"/desempenho/ciclos/{C4}/participantes", aidp, {"cycleId": C4, "userId": UID[CA], "reviewId": RV[T[6]], "grupo": "PAR"}, GA), "já é o avaliador designado")
erro(post(f"/desempenho/ciclos/{C4}/participantes", aidp, {"cycleId": C4, "userId": livre, "reviewId": RV[T[6]], "grupo": "LIDERADO"}, GA), "não tem essa fonte habilitada")
okmsg(post(f"/desempenho/ciclos/{C4}/participantes", aidp, {"cycleId": C4, "userId": livre, "reviewId": RV[T[6]], "grupo": "PAR", "motivo": "Dividem o projeto de leitura"}, GA), "Par incluído")
erro(post(f"/desempenho/ciclos/{C4}/participantes", aidp, {"cycleId": C4, "userId": livre, "reviewId": RV[T[6]], "grupo": "PAR"}, GA), "já está convidado")
cheio = psql(f"SELECT x.user_id FROM review_raters x JOIN perf_reviews r ON r.id=x.review_id WHERE r.cycle_id={C4} GROUP BY 1 HAVING count(*) >= 3 LIMIT 1")
if cheio:
    alvo = psql(f"SELECT id FROM perf_reviews WHERE cycle_id={C4} AND employee_id <> (SELECT employee_id FROM users WHERE id={cheio}) AND id NOT IN (SELECT review_id FROM review_raters WHERE user_id={cheio}) LIMIT 1")
    erro(post(f"/desempenho/ciclos/{C4}/participantes", aidp, {"cycleId": C4, "userId": cheio, "reviewId": alvo, "grupo": "PAR"}, GA), "teto 3")
erro(post(f"/desempenho/ciclos/{C4}/participantes", aidp, {"cycleId": C4, "userId": livre, "reviewId": RV[T[6]], "grupo": "PAR"}, P1), "Só o RH, a direção da unidade ou o avaliador designado")
x1 = int(psql(f"SELECT id FROM review_raters WHERE review_id={RV[T[6]]} AND user_id={livre}"))
h = page(f"/desempenho/ciclos/{C4}/participantes?q=Alfa+6", GA); aidrm = aid_of(h, 'name="raterId"')
okmsg(post(f"/desempenho/ciclos/{C4}/participantes", aidrm, {"cycleId": C4, "raterId": x1}, GA), "Par removido"); assert psql(f"SELECT count(*) FROM review_raters WHERE id={x1}") == "0"
x2 = int(psql(f"SELECT rr.id FROM review_raters rr WHERE rr.review_id={RV[T[0]]} LIMIT 1")); psql(f"UPDATE review_raters SET status='RESPONDIDO', notas={j({'c1': {'nota': 4}})} WHERE id={x2}")
erro(post(f"/desempenho/ciclos/{C4}/participantes", aidrm, {"cycleId": C4, "raterId": x2}, GA), "Quem já respondeu não sai")
h = page(f"/desempenho/ciclos/{C4}/participantes?relacao=PAR&situacao=ENVIADA", RH); assert "Enviada" in h and "Pares avaliador › avaliado (1)" in h
ok("inclusão com ⇄ (sem o próprio, sem o avaliador designado, só fontes do ciclo, sem duplicar, teto; colega não inclui); remoção só de quem não respondeu; filtros por relação e situação")

print("360° — relatório")
psql(f"DELETE FROM review_raters WHERE review_id={RV[T[0]]}")
for i, (uid, notas, com) in enumerate([(UID[T[1]], [2, 3, 2, 4], "Poderia compartilhar mais o planejamento."), (UID[T[2]], [3, 3, 2, 4], "Muito cuidadosa com os alunos."), (UID[T[3]], [2, 2, 3, 5], None)]):
    psql(f"INSERT INTO review_raters (review_id, user_id, grupo, motivo, status, notas, comentario, respondido_em) VALUES ({RV[T[0]]}, {uid}, 'PAR', 'teste', 'RESPONDIDO', {j({c['id']: {'nota': n} for c, n in zip(CRIT, notas)})}, {q(com)}, now())")
for uid in [UID[T[4]], UID[T[5]]]: psql(f"INSERT INTO review_raters (review_id, user_id, grupo, motivo, status, notas, comentario, respondido_em) VALUES ({RV[T[1]]}, {uid}, 'PAR', 'teste', 'RESPONDIDO', {j({c['id']: {'nota': 3} for c in CRIT})}, 'Comentário que não pode aparecer', now()) ON CONFLICT (review_id, user_id) DO UPDATE SET status='RESPONDIDO', notas=EXCLUDED.notas, comentario=EXCLUDED.comentario")
psql(f"UPDATE perf_reviews SET auto_criterios={j({'notas': {c['id']: {'nota': n} for c, n in zip(CRIT, [4, 4, 4, 3])}, 'em': H + 'T12:00:00Z'})}, notas_criterios={j({c['id']: {'nota': n, 'evidencia': 'Registro do acompanhamento do bimestre com datas.'} for c, n in zip(CRIT, [3, 3, 3, 4])})} WHERE id={RV[T[0]]}")
h = page(f"/desempenho/ciclos/{C4}/relatorio-360?avaliado={RV[T[0]]}", RH)
assert "Professora Alfa 0 (fictícia) — critério a critério" in h and "ponto cego" in h and "Poderia compartilhar mais o planejamento." in h and "Comentário que não pode aparecer" not in h and "2 resp." in h and "teste" not in h.split("Comentários dos grupos")[1][:800]
linha = next(t for t in h.split("<tr")[1:] if "Colaboração com a equipe" in t); assert "ponto cego" in linha and "2,3" in linha, re.sub(r"<[^>]+>", " ", linha)[:300]
h = page(f"/desempenho/ciclos/{C4}/relatorio-360", P0); assert "Professora Alfa 0 (fictícia) — critério a critério" not in h and "Poderia compartilhar" not in h
psql(f"UPDATE perf_reviews SET estado='PUBLICADA', status='CONCLUIDA' WHERE id={RV[T[0]]}")
h = page(f"/desempenho/ciclos/{C4}/relatorio-360", P0); assert "Professora Alfa 0 (fictícia) — critério a critério" in h and "Professora Alfa 1" not in h and "Poderia compartilhar" in h
psql(f"UPDATE perf_reviews SET estado='RASCUNHO', status='PENDENTE' WHERE id={RV[T[0]]}")
h = page(f"/desempenho/ciclos/{C4}/relatorio-360", GB); assert "Professora Alfa" not in h
ok("relatório por critério: auto × gestor × pares (grupo com menos de 3 respostas não aparece), pontos cegos, comentários sem autor; colaborador só o próprio e só publicado; outra unidade não vê")

print("Metas — proposta, devolução, aprovação")
h = page(f"/colaboradores/{T[0]}/painel?aba=metas&ciclo={C4}", P0); assert "Propor meta" in h; aidm = aid_of(h, "Regra de interpretação (obrigatória)")
meta = {"voltar": f"/colaboradores/{T[0]}/painel?aba=metas&ciclo={C4}", "employeeId": T[0], "cycleId": C4, "titulo": "Devolutiva de 100% das atividades em 7 dias", "tipo": "MELHORIA", "direcao": "MAIOR_MELHOR", "indicador": "% no prazo", "unidadeMedida": "%", "peso": 1, "linhaBase": 70, "esperado": 100, "prazo": d(40), "regraInterpretacao": "Conta a data registrada no diário."}
okmsg(post(f"/colaboradores/{T[0]}/painel", aidm, meta, P0), "Meta proposta"); G1 = int(psql(f"SELECT id FROM perf_goals WHERE employee_id={T[0]} AND cycle_id={C4}"))
assert psql(f"SELECT aprovacao||'|'||proposta_por FROM perf_goals WHERE id={G1}") == f"PROPOSTA|{UID[T[0]]}"
assert psql(f"SELECT count(*) FROM notifications WHERE user_id={UID[CA]} AND titulo='Meta proposta aguardando a sua aprovação'") == "1"
h = page("/pendencias", GA); assert "meta proposta pela equipe" in h
h = page(f"/desempenho/metas?ciclo={C4}", GA); assert "Aguardando aprovação (1)" in h and "Devolutiva de 100% das atividades em 7 dias" in h and "Cadastro de metas" in h and "Aprovação de metas" in h
aidd = aid_of(h, 'name="motivo"')
erro(post("/desempenho/metas", aidd, {"id": G1, "decisao": "DEVOLVER", "motivo": "curto", "voltar": f"/desempenho/metas?ciclo={C4}#aprovacao"}, GA), "diga o que ajustar")
erro(post("/desempenho/metas", aidd, {"id": G1, "decisao": "DEVOLVER", "motivo": "Meta boa; ajuste a linha de base com o dado de setembro.", "voltar": "/desempenho/metas"}, P1), "Sem permissão")
okmsg(post("/desempenho/metas", aidd, {"id": G1, "decisao": "DEVOLVER", "motivo": "Meta boa; ajuste a linha de base com o dado de setembro.", "voltar": f"/desempenho/metas?ciclo={C4}#aprovacao"}, GA), "devolvida")
assert psql(f"SELECT aprovacao||'|'||aprovacao_motivo FROM perf_goals WHERE id={G1}") == "DEVOLVIDA|Meta boa; ajuste a linha de base com o dado de setembro."
h = page(f"/colaboradores/{T[0]}/painel?aba=metas&ciclo={C4}", P0); assert "devolvida para ajuste" in h and "O que ajustar: Meta boa" in h and "Editar proposta" in h
assert "Ajustar e propor de novo" in page("/pendencias", P0)
okmsg(post(f"/colaboradores/{T[0]}/painel", aidm, {**meta, "id": G1, "linhaBase": 64}, P0), "Meta proposta"); assert psql(f"SELECT aprovacao||'|'||linha_base::int FROM perf_goals WHERE id={G1}") == "PROPOSTA|64"
okmsg(post(f"/colaboradores/{T[0]}/painel", aidm, {**meta, "titulo": "Ler 1 livro de didática com aplicação", "tipo": "APRENDIZAGEM", "linhaBase": 0, "esperado": 1}, P0), "Meta proposta"); G2 = int(psql(f"SELECT max(id) FROM perf_goals WHERE employee_id={T[0]}"))
h = page(f"/desempenho/metas?ciclo={C4}", GA); okmsg(post("/desempenho/metas", aid_of(h, 'id="lote-metas"'), {"ids": [G1, G2], "voltar": f"/desempenho/metas?ciclo={C4}#aprovacao"}, GA), "2 meta(s) aprovada(s)")
assert psql(f"SELECT string_agg(aprovacao||':'||aprovacao_por, ',' ORDER BY id) FROM perf_goals WHERE id IN ({G1},{G2})") == f"APROVADA:{UID[CA]},APROVADA:{UID[CA]}"
erro(post(f"/colaboradores/{T[0]}/painel", aidm, {**meta, "id": G1}, P0), "Meta aprovada só muda com o gestor")
h = page(f"/colaboradores/{T[1]}/painel?aba=metas&ciclo={C4}", GA); okmsg(post(f"/colaboradores/{T[1]}/painel", aid_of(h, "Regra de interpretação (obrigatória)"), {**meta, "voltar": f"/colaboradores/{T[1]}/painel?aba=metas&ciclo={C4}", "employeeId": T[1], "titulo": "Planejamento semanal até sexta"}, GA), "Meta salva")
assert psql(f"SELECT aprovacao FROM perf_goals WHERE employee_id={T[1]} AND cycle_id={C4}") == "APROVADA"
h = page(f"/desempenho/metas?ciclo={C4}", RH); assert "Aguardando aprovação (0)" in h and "Pessoas no ciclo" in h and "Com todas aprovadas" in h
ok("proposta do colaborador (aviso e pendência do gestor), devolução com motivo (pendência do colaborador), nova proposta, aprovação em lote, aprovada só muda com o gestor, gestão cadastra já aprovada; painel de cadastro e aprovação")

print("Calibração — pré × pós (modelo antigo e por critérios)")
C2 = int(psql("INSERT INTO perf_cycles (nome, inicio, fim, status, competencias) VALUES ('Ciclo antigo · teste', '2025-08-01', '2025-12-12', 'CALIBRACAO', '[\"Comunicação\"]'::jsonb) RETURNING id"))
R2 = {e: int(psql(f"INSERT INTO perf_reviews (cycle_id, employee_id, avaliador_user_id, status, nota_final, desempenho_nivel, potencial) VALUES ({C2}, {e}, {UID[CA]}, 'AVALIADA', 3.4, 2, 2) RETURNING id")) for e in T[:4]}
h = page(f"/desempenho/ciclos/{C2}", RH); aidc = aid_of(h, 'name="desempenhoNivel"')
okmsg(post(f"/desempenho/ciclos/{C2}", aidc, {"id": R2[T[0]], "voltar": f"/desempenho/ciclos/{C2}", "desempenhoNivel": 3, "potencial": 2, "nota": "Evidências do projeto de leitura"}, RH), "Calibração registrada")
okmsg(post(f"/desempenho/ciclos/{C2}", aidc, {"id": R2[T[0]], "voltar": f"/desempenho/ciclos/{C2}", "desempenhoNivel": 3, "potencial": 3, "nota": "Revisto na segunda rodada"}, RH), "Calibração registrada")
okmsg(post(f"/desempenho/ciclos/{C2}", aidc, {"id": R2[T[1]], "voltar": f"/desempenho/ciclos/{C2}", "desempenhoNivel": 1, "potencial": 2, "nota": "Sem evidência de resultados"}, RH), "Calibração registrada")
pre = json.loads(psql(f"SELECT pre_calibracao FROM perf_reviews WHERE id={R2[T[0]]}")); assert pre["nivel"] == 2 and pre["potencial"] == 2 and pre["nota"] == 3.4, pre
h = page(f"/desempenho/ciclos/{C2}?nb=mov", RH); assert "Movimentos (2)" in h and "2 mudaram de quadrante na calibração (1 subiram, 1 desceram)" in re.sub(r"<[^>]+>", "", h)
lm = next(t for t in h.split("<tr")[1:] if "Professora Alfa 0" in t); assert "Mantenedor confiável" in lm and "Talento estratégico" in lm and "↑ subiu" in lm and "Revisto na segunda rodada" in lm
h = page(f"/desempenho/ciclos/{C2}?nb=pre", RH); assert "pré-calibração" in h and h.count('title="Professora Alfa') >= 4
h = page(f"/desempenho/ciclos/{C2}?nb=dist", RH); assert "Talento estratégico" in h and "Pré-calibração" in h and "Quadrantes vazios antes e depois ficam fora da tabela" in h
h = page(f"/desempenho/ciclos/{C2}?nb=mov&nbUnidade=Cultura", RH); assert "Ninguém mudou de quadrante na calibração" in h
# por critérios: o retrato de antes é a nota, as atitudes e os resultados que chegaram ao comitê
RC = RV[T[2]]; psql(f"UPDATE perf_cycles SET fase='CALIBRACAO' WHERE id={C4}")
psql(f"UPDATE perf_reviews SET estado='ENVIADA', status='AVALIADA', enviada_em=now(), notas_criterios={j({c['id']: {'nota': 3, 'evidencia': 'Registro do acompanhamento do bimestre com datas.'} for c in CRIT})}, calc={j({'N': 3.0, 'R': 3.0, 'A': 3.0})} WHERE id={RC}")
h = page(f"/desempenho/avaliacoes/{RC}", RH); aidk = aid_of(h, 'name="evidenciaCalibracao"'); ver = psql(f"SELECT versao FROM perf_reviews WHERE id={RC}")
okmsg(post(f"/desempenho/avaliacoes/{RC}", aidk, {"id": RC, "versao": ver, "n_c1": 4, "n_c2": 4, "n_c3": 3, "n_c4": 3, "justificativa": "Comitê alinhou a régua entre as unidades.", "evidenciaCalibracao": "Planos e registros conferidos pelo comitê."}, RH), "notas originais preservadas")
pre = json.loads(psql(f"SELECT pre_calibracao FROM perf_reviews WHERE id={RC}")); assert float(pre["N"]) == 3.0 and float(pre["R"]) == 3.0 and float(pre["A"]) == 3.0, pre
assert float(psql(f"SELECT calc->>'R' FROM perf_reviews WHERE id={RC}")) == 4.0
h = page(f"/desempenho/ciclos/{C4}?nb=mov", RH); assert "Quadro de talentos — atitudes × resultados" in h and "Professora Alfa 2" in h and "Resultados 3–3,9 · Atitudes 3–3,9" in h and "Resultados 4–5 · Atitudes 3–3,9" in h
ok("retrato de antes guardado só na primeira calibração (modelo antigo: nível, potencial e nota; por critérios: nota, atitudes e resultados); Nine Box pré × pós, distribuição, movimentos com justificativa e quem subiu/desceu; filtros")

print("PDI — engajamento por liderança e sugestões de área")
pa = int(psql(f"INSERT INTO pdi_plans (employee_id, cycle_id, competencia, objetivo, status, validado_por, validado_em, created_by) VALUES ({T[0]}, {C4}, 'Devolutivas aos alunos', 'Devolutivas com o próximo passo', 'ATIVO', {UID[CA]}, now(), {UID[CA]}) RETURNING id"))
psql(f"INSERT INTO pdi_actions (plan_id, tipo, descricao, prazo, status) VALUES ({pa}, 'CURSO', 'Curso de devolutivas', '{d(-20)}', 'CONCLUIDA'), ({pa}, 'OBSERVACAO', 'Observar a aula de um colega', '{d(-3)}', 'EM_ANDAMENTO')")
pb = int(psql(f"INSERT INTO pdi_plans (employee_id, cycle_id, competencia, objetivo, status, created_by) VALUES ({T[1]}, {C4}, 'Gestão da sala', 'Rotina de entrada', 'ATIVO', {UID[T[1]]}) RETURNING id"))
psql(f"INSERT INTO pdi_actions (plan_id, tipo, descricao, prazo, status) VALUES ({pb}, 'LEITURA', 'Ler um capítulo', '{d(10)}', 'NAO_INICIADA')")
h = page("/desempenho/pdi", GA); assert "Coordenadora Alfa (fictícia)" in h and "(1/7)" in h and "(1/2)" in h and "Coordenador Beta" not in h
def linha_de(nome): return next(t for t in h.split("<tr")[1:] if nome in t)
lp = linha_de("Professora Alfa 1 (fictícia)"); assert "Proposto" in lp and "plano aguardando validação" in lp
lp0 = linha_de("Professora Alfa 0 (fictícia)"); assert ">Sim<" in lp0 and "1 ação(ões) atrasada(s)" in lp0 and "50%" in lp0
h = page("/desempenho/pdi", RH); assert "Coordenadora Alfa (fictícia)" in h and "Adesão ao PDI" in h and "PDIs com atraso" in h
assert get("/desempenho/pdi", P0).status_code in (302, 303, 307)
assert "Validar o plano" in page("/pendencias", GA)
psql(f"INSERT INTO dev_needs (employee_id, unit_id, cycle_id, origem, descricao, hipotese, encaminhamento, acao, responsavel_user_id, prazo, status) VALUES ({T[3]}, {CAR}, {C4}, 'FEEDBACK', 'Organizar a recuperação por habilidade', 'ORIENTACAO', 'PDI', 'Montar o plano', {UID[CA]}, '{d(30)}', 'ABERTO')")
h = page(f"/colaboradores/{T[3]}/painel?aba=pdi", GA); assert "Progresso geral em PDI" in h and "Sugestões de área de desenvolvimento" in h and "Organizar a recuperação por habilidade" in h and "O perfil comportamental (DISC) não sugere área sozinho" in h
i = re.search(r'aba=pdi&amp;sug=(\d+)#novo-plano', h); assert i, "link + usar"
h = page(f"/colaboradores/{T[3]}/painel?aba=pdi&sug={i.group(1)}", GA); assert 'value="Organizar a recuperação por habilidade"' in h and "Novo plano — Organizar a recuperação por habilidade" in h
ok("engajamento por líder (adesão, PDIs com atraso, progresso; liderados com Sim/Não/Proposto e atenção); o gestor vê só a própria equipe; colaborador fora; pendência de validar; progresso geral e sugestões de área no painel com “+ usar no plano”")

print("OKRs — desdobramento")
h = page("/estrategia/okrs", RH); aido = aid_of(h, "Criar objetivo</button>"); pil = re.search(r'<select[^>]*name="pilar"[^>]*>\s*<option[^>]*>([^<]+)</option>', h).group(1)
cic = psql("SELECT coalesce(value->>'cicloAtual', '') FROM settings WHERE key='estrategia'") or re.search(r'<input[^>]*name="ciclo"[^>]*value="([^"]+)"', h).group(1)
loc = post("/estrategia/okrs", aido, {"ciclo": cic, "titulo": "Uma equipe que fica e cresce (teste)", "pilar": pil, "unitId": "", "ownerUserId": UID[CA], "parentId": ""}, RH); O1 = int(re.search(r"/estrategia/okrs/(\d+)", loc).group(1))
loc = post("/estrategia/okrs", aido, {"ciclo": cic, "titulo": "Carandá: PDI ativo e conversa em dia (teste)", "pilar": pil, "unitId": CAR, "ownerUserId": UID[CA], "parentId": O1}, RH); O2 = int(re.search(r"/estrategia/okrs/(\d+)", loc).group(1))
loc = post("/estrategia/okrs", aido, {"ciclo": cic, "titulo": "Fundamental II: 1:1 quinzenal (teste)", "pilar": pil, "unitId": CAR, "ownerUserId": UID[CA], "parentId": O2}, RH); O3 = int(re.search(r"/estrategia/okrs/(\d+)", loc).group(1))
assert psql(f"SELECT string_agg(coalesce(parent_id::text, '-'), ',' ORDER BY id) FROM objectives WHERE id IN ({O1},{O2},{O3})") == f"-,{O1},{O2}"
erro(post("/estrategia/okrs", aido, {"ciclo": "1999", "titulo": "Outro ciclo (teste)", "pilar": pil, "unitId": "", "ownerUserId": UID[CA], "parentId": O1}, RH), "mesmo ciclo")
h = page(f"/estrategia/okrs/{O1}", RH); assert "Desdobramento" in h and "Fundamental II" not in h.split("Desdobramento")[1][:3000] and "Carandá: PDI ativo e conversa em dia (teste)" in h
aide = aid_of(h, ">Desdobra o objetivo<"); assert f'<option value="{O2}"' not in h.split(">Desdobra o objetivo<")[1].split("</select>")[0]
erro(post(f"/estrategia/okrs/{O1}", aide, {"id": O1, "ciclo": cic, "titulo": "Uma equipe que fica e cresce (teste)", "pilar": pil, "status": "ATIVO", "ownerUserId": UID[CA], "unitId": "", "ordem": 0, "parentId": O3}, RH), "não pode desdobrar a si mesmo")
h = page(f"/estrategia/okrs/{O3}", RH); assert "Desdobra:" in h and "Carandá: PDI ativo e conversa em dia (teste)" in h
h = page(f"/estrategia/okrs/desdobramento?ciclo={cic}", RH); i1, i2, i3 = h.find("Uma equipe que fica e cresce (teste)"), h.find("Carandá: PDI ativo e conversa em dia (teste)"), h.find("Fundamental II: 1:1 quinzenal (teste)")
assert 0 < i1 < i2 < i3 and "Objetivo desdobrado" in h and f'id="o{O3}"' in h
ok("objetivo-pai do mesmo ciclo, sem ciclos (a lista de pais exclui os descendentes e o servidor recusa); árvore rede → unidade → área; cartão no objetivo (de onde vem, para onde desce)")

print("Telas fixas e parâmetros da v31")
psql(f"UPDATE positions SET acesso = {j({'atuacao': 'COLABORADOR', 'telas': ['/eu'], 'aprova': None})} WHERE id={P['Professor']}")
P0b = login("t0@car"); assert get("/feedback", P0b).status_code == 200 and get("/um-a-um", P0b).status_code == 200 and "/sem-acesso" in get("/reconhecimento", P0b).headers.get("location", "")
psql(f"UPDATE positions SET acesso = {j({'atuacao': 'COLABORADOR', 'telas': None, 'aprova': None})} WHERE id={P['Professor']}")
h = page("/configuracoes", RH); aidv = aid_of(h, 'name="temas"'); assert "Conversas e desenvolvimento (v31)" in h
base = {"duracao": 45, "limite": 20, "prazo": 7, "pessoas": 5, "pares": 4, "teto": 6, "adesao": 80}
assert "erro=" in post("/configuracoes", aidv, {**base, "temas": "Carreira\nFeedback"}, RH)
okmsg(post("/configuracoes", aidv, {**base, "temas": "Carreira\nFeedback\nTema de teste v31"}, RH), "Parâmetros de conversas")
h = page("/um-a-um", GA); assert "Tema de teste v31" in h and 'value="10:45"' in h  # duração 45 min a partir das 10:00
erro(post("/configuracoes", aidv, {**base, "temas": "a\nb\nc"}, GA), "Só Direção e RH")
ok("feedback e 1:1 abrem para todos mesmo com a lista de telas do cargo reduzida; parâmetros (temas, duração, limites, pares, teto, adesão) só pela Direção e RH")

print(f"\nOK — {N[0]} blocos da v31 (desempenho) passaram.")
