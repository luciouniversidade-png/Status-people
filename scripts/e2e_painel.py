# E2E — Painel do Colaborador e V2 do desempenho: escopo/IDOR, conflito de interesse, versão, lotação histórica,
# caminho inconclusivo, metas com regra, evidências com contraditório, PDI em 3 trilhas, fontes, docente, IA, exportação, TV, agentes.
import re, subprocess, requests
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
    assert r.status_code == expect, (path, r.status_code, r.headers.get("location")); return re.sub(r"<script[^>]*>.*?</script>", "", re.sub(r"<!--.*?-->", "", r.text), flags=re.S)
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

login(S, "rh@colegiostatus", "Status2026!"); r = S.get(B + f"/api/setup?token={TOKEN}"); assert r.json()["ok"], r.text
html = page("/colaboradores/novo"); aid = action_ids(html)[0]; car = re.search(r'<option value="(\d+)">Carandá</option>', html).group(1); cul = re.search(r'<option value="(\d+)">Cultura</option>', html).group(1)
def novo(nome, unit): return re.search(r"/colaboradores/(\d+)\?", post("/colaboradores/novo", aid, {"nome": nome, "admissao": "2024-02-01", "unitId": unit, "vinculo": "CLT", "abrirAdmissao": "", "jornadaMinDia": 528})).group(1)
P = novo("Prof Painel", car); G = novo("Coord Gestora", car); G2 = novo("Coord Outra", car); Q = novo("Prof Outro", car); X = novo("Prof Cultura", cul)
prof = psql("SELECT id FROM positions WHERE familia='PROFESSORES' ORDER BY id LIMIT 1"); coord = psql("SELECT id FROM positions WHERE familia='COORDENACAO' ORDER BY id LIMIT 1"); assert prof and coord, (prof, coord)
psql(f"UPDATE employees SET position_id={prof}, gestor_id={G} WHERE id={P}"); psql(f"UPDATE employees SET position_id={prof}, gestor_id={G2} WHERE id={Q}"); psql(f"UPDATE employees SET position_id={prof} WHERE id={X}"); psql(f"UPDATE employees SET position_id={coord} WHERE id IN ({G},{G2})")
html = page("/configuracoes"); aid_u = aid_of(html, "Criar acesso")
for nome, email, role, unit, emp in [("Gestora G", "g@car", "GESTOR", car, G), ("Gestora G2", "g2@car", "GESTOR", car, G2), ("Prof P", "p@car", "COLABORADOR", car, P), ("Prof Q", "q@car", "COLABORADOR", car, Q), ("Dir Cultura", "dir@cul", "DIRETOR_UNIDADE", cul, "")]:
    post("/configuracoes", aid_u, {"nome": nome, "email": email, "role": role, "unitId": unit, "employeeId": emp, "senha": "senha12345"})
SG, SG2, SP, SQ, SDC = mk(), mk(), mk(), mk(), mk()
for sess, em in [(SG, "g@car"), (SG2, "g2@car"), (SP, "p@car"), (SQ, "q@car"), (SDC, "dir@cul")]: login(sess, em, "senha12345")
uid = lambda email: psql(f"SELECT id FROM users WHERE email='{email}'")
uG, uG2, uP, uQ, uRH = uid("g@car"), uid("g2@car"), uid("p@car"), uid("q@car"), uid("rh@colegiostatus")
PAINEL = f"/colaboradores/{P}/painel"
print("== Acesso ao painel (servidor)")
assert "Acesso negado" in page(PAINEL, sess=SG2) and "Acesso negado" in page(PAINEL, sess=SDC) and "Acesso negado" in page(f"/colaboradores/{Q}/painel", sess=SP); ok("gestor de outra equipe, diretor de outra unidade e colega não abrem o painel")
assert "Prof Painel" in page(PAINEL, sess=SP) and "Prof Painel" in page(PAINEL, sess=SG); ok("próprio colaborador e gestor direto abrem o painel")
assert page("/meu-painel", expect=307, sess=SP) is not None; ok("/meu-painel leva ao próprio painel")

print("== Expectativas por cargo (versão, publicação, ciência)")
html = page("/desempenho/expectativas"); a = aid_of(html, "Criar rascunho")
erro(post("/desempenho/expectativas", a, {"titulo": "X", "familia": "PROFESSORES", "competencias": "Sem nível"}), "Competência inválida")
loc = post("/desempenho/expectativas", a, {"titulo": "Professor(a) — expectativas 2026", "familia": "PROFESSORES", "finalidade": "Conduzir a aprendizagem da turma", "responsabilidades": "Planejar aulas\nAvaliar a aprendizagem", "entregas": "Planejamento semanal", "competencias": "Planejamento didático | 4 | domínio do currículo\nGestão de sala | 3", "comportamentos": "Cumpre prazos combinados", "evidencias": "Diário de classe", "condicoes": "Material didático disponível"})
pid = re.search(r"/desempenho/expectativas/(\d+)", loc).group(1); html = page(f"/desempenho/expectativas/{pid}")
okmsg(post(f"/desempenho/expectativas/{pid}", aid_of(html, "Publicar como vigente"), {"id": pid}), "notificado")
html = page(f"{PAINEL}?aba=expectativas", sess=SP); assert "Planejamento didático" in html and "Li e registro ciência" in html
post(PAINEL, aid_of(html, "Li e registro ciência"), {"profileId": pid, "voltar": f"{PAINEL}?aba=expectativas", "comentario": "ok"}, sess=SP)
assert "Ciência registrada" in page(f"{PAINEL}?aba=expectativas", sess=SP) and re.search(r">1/\d+<", page("/desempenho/expectativas")); ok("perfil publicado, colaborador registra ciência, RH vê a contagem")
html = page(f"/desempenho/expectativas/{pid}"); loc = post(f"/desempenho/expectativas/{pid}", aid_of(html, "Nova versão"), {"id": pid}); pid2 = re.search(r"/desempenho/expectativas/(\d+)", loc).group(1); assert pid2 != pid and psql(f"SELECT status FROM role_profiles WHERE id={pid}") == "VIGENTE"; ok("nova versão nasce rascunho; a vigente continua valendo")

print("== Ciclo por critérios (modelo aprovado, fontes opcionais, piloto, snapshot)")
html = page("/desempenho"); post("/desempenho", aid_of(html, "Criar ciclo"), {"nome": "Ciclo Teste 2026", "inicio": "2026-08-01", "fim": "2026-12-15", "unitId": "", "competencias": "Planejamento", "descricao": ""})
cid = psql("SELECT max(id) FROM perf_cycles"); mid = psql("SELECT id FROM eval_models WHERE familia='PROFESSORES' ORDER BY id LIMIT 1"); C = f"/desempenho/ciclos/{cid}"
html = page(C); acfg = aid_of(html, "Salvar configuração")
assert mid and psql(f"SELECT status FROM eval_models WHERE id={mid}") == "RASCUNHO", "modelos sugeridos devem nascer em rascunho"
erro(post(C, acfg, {"cycleId": cid, "modelId": mid}), "aprovados")
M = f"/desempenho/modelos/{mid}"; html = page(M); amod = aid_of(html, "Finalidade da nota composta"); nomem = psql(f"SELECT nome FROM eval_models WHERE id={mid}")
mbase = {"id": mid, "nome": nomem, "familia": "PROFESSORES", "pesoResultados": "60", "pesoAtitudes": "40", "coberturaMinima": "50", "faixasMatriz": "2 / 3 / 4", "faixasFinal": "3 / 4", "status": "ATIVO"}
erro(post(M, amod, {**mbase, "notaComposta": "1"}), "finalidade")
okmsg(post(M, amod, {**mbase, "notaComposta": "1", "finalidade": "Apoiar devolutivas e o PDI; não usada para remuneração"}), "salvo"); ok("modelo sugerido nasce rascunho, não entra em ciclo; nota composta só com finalidade declarada")
okmsg(post(C, acfg, {"cycleId": cid, "modelId": mid, "prazoAvaliacao": "2026-11-30", "prazoFeedback": "2026-12-10", "familias": "PROFESSORES", "peso_GESTOR": "70", "peso_PAR": "30", "min_PAR": "3", "piloto": "1"}), "configurado")
assert psql(f"SELECT fontes->'PAR'->>'minimo' FROM perf_cycles WHERE id={cid}") == "3"; ok("fontes múltiplas opt-in configuradas (mínimo 3 por grupo)")
okmsg(post(C, aid_of(page(C), "Gerar avaliações por critérios"), {"cycleId": cid}), "gerada")
rid = psql(f"SELECT id FROM perf_reviews WHERE cycle_id={cid} AND employee_id={P}"); ridQ = psql(f"SELECT id FROM perf_reviews WHERE cycle_id={cid} AND employee_id={Q}")
assert psql(f"SELECT avaliador_user_id FROM perf_reviews WHERE id={rid}") == uG and psql(f"SELECT snapshot->>'unitId' FROM perf_reviews WHERE id={rid}") == car and psql(f"SELECT count(*) FROM perf_reviews WHERE cycle_id={cid} AND employee_id IN ({G},{G2})") == "0"; ok("avaliações geradas por família com snapshot de unidade/cargo/gestor")
crit = [l.split("|") for l in psql(f"SELECT c->>'id', c->>'eixo' FROM perf_cycles, jsonb_array_elements(criterios) c WHERE id={cid}").splitlines()]
RES = [c for c, e in crit if e == "RESULTADOS"]; ATI = [c for c, e in crit if e == "ATITUDES"]; TEC = [c for c, e in crit if e == "TECNICA"]; assert RES and ATI

print("== Metas com regra explícita")
html = page(f"{PAINEL}?aba=metas", sess=SG); ameta = aid_of(html, "Criar meta")
base = {"employeeId": P, "cycleId": cid, "titulo": "Devolutiva de atividades em até 7 dias", "tipo": "OPERACIONAL", "direcao": "MAIOR_MELHOR", "linhaBase": "70", "esperado": "90", "unidadeMedida": "%", "fonte": "Diário de classe", "participaAvaliacao": "1", "criterioId": RES[0]}
erro(post(PAINEL, ameta, base, sess=SG), "regra de interpretação")
okmsg(post(PAINEL, ameta, {**base, "regraInterpretacao": "% de atividades devolvidas em até 7 dias no mês"}, sess=SG)); gid = psql(f"SELECT max(id) FROM perf_goals WHERE employee_id={P}")
erro(post(f"/colaboradores/{Q}/painel", ameta, {**base, "employeeId": Q, "regraInterpretacao": "x"}, sess=SG), "equipe vinculada"); ok("regra obrigatória; gestor não cria meta fora da equipe (IDOR)")
okmsg(post(PAINEL, ameta, {**base, "titulo": "Testar nova sequência de leitura", "tipo": "EXPLORATORIA", "direcao": "MARCOS", "marcos": "Planejar\nAplicar\nRelatar", "regraInterpretacao": "Aprendizado registrado", "participaAvaliacao": ""}, sess=SG)); gex = psql(f"SELECT max(id) FROM perf_goals WHERE employee_id={P}")
html = page(f"{PAINEL}?aba=metas"); aconv = aid_of(html, "Tabela (avanço % até → nota)")
erro(post(PAINEL, aconv, {"id": gex, "conversao": "50:2; 999:4"}), "não são convertidas"); okmsg(post(PAINEL, aconv, {"id": gid, "conversao": "50:2; 99:3; 120:4; 999:5"}), "não é aplicada automaticamente"); ok("exploratória não vira nota; conversão aprovada no planejamento só sugere nota")

html = page(C); aav = aid_of(html, "Avançar para")
erro(post(C, aav, {"cycleId": cid, "fase": "AVALIACAO"}), "uma fase por vez")
post(C, aav, {"cycleId": cid, "fase": "ACOMPANHAMENTO"}); assert psql(f"SELECT congelado_em IS NOT NULL FROM eval_models WHERE id={mid}") == "t"
erro(post(M, amod, {**mbase, "notaComposta": "1", "finalidade": "x", "pesoResultados": "50", "pesoAtitudes": "50"}), "congelado"); ok("modelo congela ao sair do planejamento; mudança exige nova versão")
post(C, aav, {"cycleId": cid, "fase": "AVALIACAO"}); assert psql(f"SELECT fase FROM perf_cycles WHERE id={cid}") == "AVALIACAO"
erro(post(PAINEL, aconv, {"id": gid, "conversao": "50:2; 999:5"}), "antes do ciclo"); ok("fases avançam uma por vez; conversão fora do planejamento bloqueada")
html = page(f"{PAINEL}?aba=metas", sess=SP); loc = post(PAINEL, aid_of(html, "Atualizar andamento"), {"id": gid, "valorAtual": "85", "resultado": "Registro do mês"}, sess=SP); okmsg(loc, "Andamento registrado")
erro(post(PAINEL, ameta, {**base, "id": gid, "esperado": "95", "regraInterpretacao": "% em 7 dias"}, sess=SG), "justificativa")
okmsg(post(PAINEL, ameta, {**base, "id": gid, "esperado": "95", "regraInterpretacao": "% em 7 dias", "justificativa": "Nova diretriz da coordenação"}, sess=SG))
assert "alteração(ões) aprovada(s)" in page(f"{PAINEL}?aba=metas", sess=SP) and float(psql(f"SELECT original->>'esperado' FROM perf_goals WHERE id={gid}")) == 90; ok("alteração com ciclo em andamento exige justificativa e preserva a meta original")

print("== Acompanhamento contínuo")
html = page(f"{PAINEL}?aba=acompanhamento", sess=SP); ack = aid_of(html, "Registrar acompanhamento")
erro(post(PAINEL, ack, {"employeeId": P, "tipo": "ANDAMENTO"}, sess=SP), "nota não é necessária")
okmsg(post(PAINEL, ack, {"employeeId": P, "cycleId": cid, "tipo": "ANDAMENTO", "data": "2026-09-20", "avancou": "Concluí o planejamento do bimestre", "bloqueio": "Falta projetor na sala 3"}, sess=SP))
assert psql(f"SELECT count(*) FROM notifications WHERE user_id={uG} AND titulo LIKE 'Atualização de acompanhamento%'") == "1"; ok("colaborador registra andamento sem nota; bloqueio notifica o gestor")
okmsg(post(PAINEL, ack, {"employeeId": P, "cycleId": cid, "tipo": "REUNIAO", "data": "2026-09-10", "avancou": "Revisamos a meta", "compromissoGestor": "Providenciar projetor", "compromissoPrazo": "2026-09-01"}, sess=SG))
html = page(f"{PAINEL}?aba=acompanhamento", sess=SG); assert "vencido" in html; ckid = psql(f"SELECT max(id) FROM perf_checkins WHERE employee_id={P}")
post(PAINEL, aid_of(html, ">cumprido<"), {"id": ckid, "cumprido": "1"}, sess=SG); assert psql(f"SELECT compromisso_cumprido FROM perf_checkins WHERE id={ckid}") == "t"; ok("compromissos com prazo, vencimento e cumprimento registrados")

print("== Evidências com origem, visibilidade e contraditório")
html = page(f"{PAINEL}?aba=metas", sess=SG); aev = aid_of(html, "Registrar evidência")
okmsg(post(PAINEL, aev, {"employeeId": P, "cycleId": cid, "titulo": "Nota interna RESTRITA-XYZ", "natureza": "OBSERVACAO", "texto": "Registro restrito", "visibilidade": "GESTAO"}, sess=SG))
loc = post(PAINEL, aev, {"employeeId": P, "cycleId": cid, "titulo": "Observação de aula 12/09", "natureza": "OBSERVACAO", "dataFato": "2026-09-12", "texto": "Retomou conhecimentos prévios e checou entendimento", "criterios": [RES[0], ATI[0]], "fonte": "Registro de observação"}, sess=SG); okmsg(loc, "dupla contagem")
html = page(f"{PAINEL}?aba=metas", sess=SP); assert "RESTRITA-XYZ" not in html and "uso restrito da gestão" in html and "Observação de aula 12/09" in html; ok("evidência restrita não aparece ao colaborador; múltiplos critérios sinalizam dupla contagem")
evv = psql("SELECT id FROM eval_evidences WHERE titulo='Observação de aula 12/09'"); evr = psql("SELECT id FROM eval_evidences WHERE titulo LIKE 'Nota interna RESTRITA%'"); acont = aid_of(html, "Seu contraditório") if "Seu contraditório" in html else aid_of(html, "Contraditório")
erro(post(PAINEL, acont, {"id": evr, "texto": "tentativa"}, sess=SP), "não disponível"); okmsg(post(PAINEL, acont, {"id": evv, "texto": "A turma estava com metade dos alunos por causa da chuva"}, sess=SP))
assert psql(f"SELECT validacao FROM eval_evidences WHERE id={evv}") == "CONTESTADA"; ok("colaborador contesta evidência visível e não alcança a restrita")

print("== Avaliação: autoavaliação, rascunho oculto, versão, cobertura, fontes, calibração e publicação")
html = page(f"{PAINEL}?aba=avaliacoes", sess=SP); okmsg(post(PAINEL, aid_of(html, "Salvar autoavaliação"), {"id": rid, **{f"a_{c}": "5" for c in RES + ATI}}, sess=SP), "perspectiva separada")
AV = f"/desempenho/avaliacoes/{rid}"; html = page(AV, sess=SG); asal = aid_of(html, "Enviar avaliação"); v = psql(f"SELECT versao FROM perf_reviews WHERE id={rid}")
notas_pouca = {**{f"n_{c}": "4" for c in RES}, **{f"n_{c}": "NO" for c in ATI}, **{f"ev_{c}": "EVID-GESTOR-XYZ entregas conferidas no diário" for c in RES}}
erro(post(AV, asal, {"id": rid, "versao": v, "enviar": "1", **notas_pouca}, sess=SG), "Base insuficiente em Atitudes"); ok("não observado reduz cobertura e bloqueia o envio (não vira zero)")
post(AV, asal, {"id": rid, "versao": v, "enviar": "0", **notas_pouca}, sess=SG); erro(post(AV, asal, {"id": rid, "versao": v, "enviar": "0", **notas_pouca}, sess=SG), "alterada por outra pessoa"); ok("concorrência otimista: versão antiga é recusada")
html = page(AV, sess=SP); assert "EVID-GESTOR-XYZ" not in html and "em andamento" in html; erro(post(AV, asal, {"id": rid, "versao": psql(f"SELECT versao FROM perf_reviews WHERE id={rid}"), "enviar": "0", **notas_pouca}, sess=SG2), "avaliador designado"); ok("colaborador não vê o rascunho do gestor; outro gestor não edita")
html = page(AV); aconv = aid_of(html, "Oportunidade de observação")
erro(post(AV, aconv, {"reviewId": rid, "userId": uP, "grupo": "PAR", "motivo": "x"}), "fonte de si mesmo"); okmsg(post(AV, aconv, {"reviewId": rid, "userId": uQ, "grupo": "PAR", "motivo": "Planejam juntos no 5º ano"}))
assert "contribuição(ões) de avaliação" in page(f"/colaboradores/{Q}/painel", sess=SQ) and psql(f"SELECT link FROM notifications WHERE user_id={uQ} AND titulo LIKE 'Você foi convidado%'") == "/contribuicoes"
html = page("/contribuicoes", sess=SQ); assert "Contribuição sobre Prof Painel" in html; rrid = psql(f"SELECT id FROM review_raters WHERE review_id={rid} AND user_id={uQ}")
okmsg(post("/contribuicoes", aid_of(html, "Contribuição sobre"), {"raterId": rrid, f"f_{ATI[0]}": "4", f"f_{RES[0]}": "NO", "comentario": "Colega colaborativo"}, sess=SQ), "mínimo de respondentes")
assert "protegido (1/3)" in page(AV); ok("fonte convidada responde; grupo abaixo do mínimo fica protegido")
v = psql(f"SELECT versao FROM perf_reviews WHERE id={rid}"); completo = {**{f"n_{c}": "4" for c in RES}, **{f"n_{c}": "3" for c in ATI}, **{f"n_{c}": "3" for c in TEC}, **{f"ev_{c}": "Fato observado e registrado no diário de classe" for c in RES + ATI}}
okmsg(post(AV, asal, {"id": rid, "versao": v, "enviar": "1", **completo}, sess=SG), "enviada")
html = page(AV); acal = aid_of(html, "Registrar calibração"); v = psql(f"SELECT versao FROM perf_reviews WHERE id={rid}")
erro(post(AV, acal, {"id": rid, "versao": v, "justificativa": "x", "evidenciaCalibracao": "y", **completo}, sess=SG), "Calibrar exige")
okmsg(post(AV, acal, {"id": rid, "versao": v, "justificativa": "Alinhamento com a rubrica", "evidenciaCalibracao": "Diário mostra devolutivas em dia", **{**completo, f"n_{RES[0]}": "5"}}), "notas originais preservadas")
assert psql(f"SELECT notas_originais->'{RES[0]}'->>'nota' FROM perf_reviews WHERE id={rid}") == "4"; ok("gestor não calibra; calibração exige justificativa+evidência e preserva o original")
apub = aid_near(page(AV), "Publicar como está"); post(C, aav, {"cycleId": cid, "fase": "CALIBRACAO"})
erro(post(AV, apub, {"id": rid}, sess=SG), "Publicar exige"); okmsg(post(AV, apub, {"id": rid}), "publicada")
calcN = psql(f"SELECT calc->>'R' FROM perf_reviews WHERE id={rid}"); assert calcN and psql(f"SELECT estado FROM perf_reviews WHERE id={rid}") == "PUBLICADA"; ok("somente a alçada publica; resultado publicado com memória de cálculo")
html = page(f"{PAINEL}?aba=avaliacoes", sess=SP); assert "Resultados" in html and "Ciclo Teste 2026" in html
post(PAINEL, aid_of(html, "Registrar ciência"), {"id": rid, "texto": "Discordo do critério de pontualidade", "contestar": "1"}, sess=SP); assert psql(f"SELECT estado FROM perf_reviews WHERE id={rid}") == "CONTESTADA"; ok("colaborador vê o resultado publicado e contesta")
auto5 = psql(f"SELECT auto_criterios->'notas'->'{ATI[0]}'->>'nota' FROM perf_reviews WHERE id={rid}"); assert auto5 == "5" and psql(f"SELECT calc->>'A' FROM perf_reviews WHERE id={rid}") != "5.00"; ok("autoavaliação registrada à parte, sem entrar no cálculo")

print("== Caminho inconclusivo (sem base suficiente)")
AVQ = f"/desempenho/avaliacoes/{ridQ}"; vq = psql(f"SELECT versao FROM perf_reviews WHERE id={ridQ}")
tudo_no = {f"n_{c}": "NO" for c in RES + ATI}
post(AVQ, asal, {"id": ridQ, "versao": vq, "enviar": "0", **tudo_no}, sess=SG2)
html = page(AVQ); ainc = aid_of(html, "Encerrar sem nota"); erro(post(AVQ, ainc, {"id": ridQ, "justificativa": ""}), "Justifique")
okmsg(post(AVQ, ainc, {"id": ridQ, "justificativa": "Gestora assumiu a equipe há 3 semanas; sem observação suficiente"}), "sem nota final")
assert psql(f"SELECT estado FROM perf_reviews WHERE id={ridQ}") == "INCONCLUSIVA" and "sem nota" in page(f"/colaboradores/{Q}/painel?aba=avaliacoes", sess=SQ); ok("sem base: encerra como inconclusiva, sem nota, visível ao colaborador")

print("== DISC não altera nota")
antes = psql(f"SELECT calc::text FROM perf_reviews WHERE id={rid}"); html = page(PAINEL)
post(PAINEL, aid_of(html, "Registrar instrumento"), {"employeeId": P, "instrumento": "DISC Fornecedor X", "data": "2026-05-10", "escala": "0–100 por fator", "d": "70", "i": "40", "s": "30", "c": "60", "limitacoes": "Autorrelato"})
assert psql(f"SELECT calc::text FROM perf_reviews WHERE id={rid}") == antes and "não altera nota" in page(PAINEL); ok("perfil comportamental registrado sem mexer na avaliação")

print("== PDI: execução, aplicação e resultado; espera institucional não é atraso")
html = page(f"{PAINEL}?aba=pdi", sess=SG); apdi = aid_of(html, "Criar e validar")
okmsg(post(PAINEL, apdi, {"employeeId": P, "natureza": "LACUNA", "competencia": "Gestão de sala", "objetivo": "Reduzir interrupções", "acaoDescricao": "Observar aula de colega", "acaoPrazo": "2026-09-01", "acaoApoio": "Coordenação organiza horário"}, sess=SG), "validado")
plid = psql(f"SELECT max(id) FROM pdi_plans WHERE employee_id={P}"); acid = psql(f"SELECT id FROM pdi_actions WHERE plan_id={plid}")
html = page(f"{PAINEL}?aba=pdi", sess=SP); amov = aid_of(html, "O que falta / de quem depende")
okmsg(post(PAINEL, amov, {"id": acid, "para": "AGUARDANDO_APOIO", "bloqueio": "Sem professor substituto no horário"}, sess=SP), "não conta como atraso")
html = page(f"{PAINEL}?aba=pdi", sess=SP); i = html.find("Observar aula de colega"); assert "· atrasada" not in html[i:i + 1500]; ok("ação vencida em espera por apoio institucional não aparece como atrasada")
post(PAINEL, amov, {"id": acid, "para": "RETOMAR"}, sess=SP); post(PAINEL, amov, {"id": acid, "para": "CONCLUIR", "evidencia": "Observei 2 aulas e apliquei a rotina de entrada"}, sess=SP)
erro(post(PAINEL, amov, {"id": acid, "para": "VALIDAR"}, sess=SP), "Só a gestão valida"); okmsg(post(PAINEL, amov, {"id": acid, "para": "VALIDAR"}, sess=SG), "não comprova"); ok("conclusão com evidência aguarda validação da gestão")
aapl = aid_of(page(f"{PAINEL}?aba=pdi", sess=SP), "Como foi aplicada"); erro(post(PAINEL, aapl, {"planId": plid, "aplicacaoStatus": "APLICADA"}, sess=SP), "evidência de aplicação")
okmsg(post(PAINEL, aapl, {"planId": plid, "aplicacaoStatus": "APLICADA", "aplicacaoEvidencia": "Rotina de entrada aplicada em 3 turmas"}, sess=SP))
okmsg(post(PAINEL, aid_of(page(f"{PAINEL}?aba=pdi", sess=SG), "O que foi observado"), {"planId": plid, "resultadoStatus": "MELHORA_OBSERVADA", "resultadoObservado": "Menos interrupções nas aulas observadas"}, sess=SG), "não prova")
assert psql(f"SELECT aplicacao_status||'/'||resultado_status FROM pdi_plans WHERE id={plid}") == "APLICADA/MELHORA_OBSERVADA"; ok("aplicação e resultado registrados separadamente da execução")
for k in range(2): okmsg(post(PAINEL, apdi, {"employeeId": P, "natureza": "LACUNA", "competencia": f"Prioridade {k}", "objetivo": "x", "acaoDescricao": f"Ação atrasada {k}", "acaoPrazo": "2026-08-15"}, sess=SG))
erro(post(PAINEL, apdi, {"employeeId": P, "natureza": "LACUNA", "competencia": "Quarta", "objetivo": "x"}, sess=SG), "Limite de 3"); ok("limite configurável de prioridades ativas")
erro(post(PAINEL, apdi, {"employeeId": P, "tipo": "MELHORIA_FORMAL", "competencia": "Pontualidade", "objetivo": "x"}, sess=SG), "Plano formal")
okmsg(post(PAINEL, apdi, {"employeeId": P, "tipo": "MELHORIA_FORMAL", "natureza": "LACUNA", "competencia": "Pontualidade nas entregas", "objetivo": "Entregar planejamentos no prazo", "expectativas": "100% dos planejamentos até sexta", "prazoFinal": "2026-11-30", "acaoDescricao": "Checagem semanal", "acaoApoio": "Coordenação revisa às quintas"}), "manifestar")
pf = psql(f"SELECT max(id) FROM pdi_plans WHERE employee_id={P} AND tipo='MELHORIA_FORMAL'"); okmsg(post(PAINEL, aid_of(page(f"{PAINEL}?aba=pdi", sess=SP), "Sua manifestação sobre o plano"), {"planId": pf, "texto": "Concordo e peço apoio na organização"}, sess=SP)); ok("plano formal é fluxo próprio (RH/Direção) com manifestação do colaborador")

print("== Necessidades e encaminhamentos; liderança")
html = page(f"{PAINEL}?aba=pdi", sess=SG); aenc = aid_of(html, "Como verificar o resultado")
encb = {"employeeId": P, "descricao": "Falta projetor na sala 3", "acao": "Instalar projetor", "responsavelUserId": uG, "prazo": "2026-10-10", "verificacao": "Projetor funcionando na próxima observação"}
erro(post(PAINEL, aenc, {**encb, "hipotese": "RECURSO", "encaminhamento": "PDI"}, sess=SG), "não vira PDI individual")
antes = psql("SELECT count(*) FROM work_orders"); okmsg(post(PAINEL, aenc, {**encb, "hipotese": "RECURSO", "encaminhamento": "INFRAESTRUTURA"}, sess=SG), "Chamado #"); assert int(psql("SELECT count(*) FROM work_orders")) == int(antes) + 1; ok("recurso vira chamado em Operações, não PDI")
html = page("/desempenho/lideranca", sess=SG); assert "Obrigações de gestão da equipe de" in html and "Expectativas alinhadas" in html and "Falta projetor" in html; ok("liderança: radar de obrigações e encaminhamentos no escopo")

print("== Desenvolvimento docente")
html = page(f"{PAINEL}?aba=docente", sess=SG); aobs = aid_of(html, "Pode compor a avaliação")
erro(post(PAINEL, aobs, {"employeeId": P, "finalidade": "FORMATIVA", "dataPlanejada": "2026-10-05", "turmaRef": "x" * 50}, sess=SG), "rótulo da turma")
okmsg(post(PAINEL, aobs, {"employeeId": P, "finalidade": "FORMATIVA", "dataPlanejada": "2026-10-05", "turmaRef": "5º ano B", "focoPlanejado": "Checagem de entendimento"}, sess=SG)); oid = psql(f"SELECT max(id) FROM teaching_observations WHERE employee_id={P}")
assert psql(f"SELECT count(*) FROM notifications WHERE user_id={uP} AND titulo LIKE 'Observação de prática planejada%'") == "1"
html = page(f"{PAINEL}?aba=docente", sess=SG); okmsg(post(PAINEL, aid_of(html, "Registro da observação"), {"id": oid, "nv_0": "3", "rg_0": "Retomou conhecimentos prévios"}, sess=SG))
okmsg(post(PAINEL, aid_of(page(f"{PAINEL}?aba=docente", sess=SG), "Foco de desenvolvimento (escolhido em conjunto)"), {"id": oid, "devolutiva": "Boa retomada; ampliar perguntas abertas", "focoDesenvolvimento": "Perguntas abertas"}, sess=SG))
okmsg(post(PAINEL, aid_of(page(f"{PAINEL}?aba=docente", sess=SP), "Como o foco foi aplicado em aula"), {"id": oid, "aplicacao": "Usei 3 perguntas abertas por aula"}, sess=SP))
okmsg(post(PAINEL, aobs, {"employeeId": P, "anteriorId": oid, "finalidade": "FORMATIVA", "dataPlanejada": "2026-11-05"}, sess=SG)); oid2 = psql(f"SELECT max(id) FROM teaching_observations WHERE employee_id={P}")
okmsg(post(PAINEL, aid_of(page(f"{PAINEL}?aba=docente", sess=SG), "Registro da observação"), {"id": oid2, "nv_0": "4", "rg_0": "Perguntas abertas frequentes"}, sess=SG))
assert psql(f"SELECT status FROM teaching_observations WHERE id={oid}") == "REOBSERVADA"; ok("fluxo docente: planejar → observar → devolutiva/foco → aplicação → nova observação")

print("== Preparação de avaliadores, carreira")
html = page("/desempenho/treinamento"); atr = aid_of(html, "Formato: Título")  if "Formato: Título" in html else aid_of(html, "Casos (um por linha)")
erro(post("/desempenho/treinamento", atr, {"titulo": "T", "casos": "linha sem formato"}), "Caso inválido")
loc = post("/desempenho/treinamento", atr, {"titulo": "Calibração inicial", "casos": "Devolutivas :: 3 de 4 turmas com devolutiva em 7 dias :: 3 :: atende no essencial\nFamílias :: reclamações resolvidas em 48h :: 4 :: resolve com registro"}); tid = re.search(r"/desempenho/treinamento/(\d+)", loc).group(1)
T = f"/desempenho/treinamento/{tid}"; html = page(T, sess=SG); assert "Referência:" not in html; arc = aid_of(html, "Responder")
okmsg(post(T, arc, {"trainingId": tid, "casoId": "k1", "nota": "2", "justificativa": "Atraso relevante"}, sess=SG)); erro(post(T, arc, {"trainingId": tid, "casoId": "k1", "nota": "3", "justificativa": "mudei"}, sess=SG), "já registrada")
assert "Referência: <b>3</b>" in page(T, sess=SG); ok("avaliador responde sozinho, depois vê a referência; resposta não muda")
html = page(f"{PAINEL}?aba=carreira", sess=SP); okmsg(post(PAINEL, aid_of(html, "Liderar pessoas?"), {"lideranca": "NAO", "interesses": "Aprofundar alfabetização"}, sess=SP), "não é exigência")
assert "não tem interesse" in page(f"{PAINEL}?aba=carreira", sess=SG); ok("interesse de carreira declarado pelo próprio colaborador")

print("== Exportação, lotação histórica, visão geral")
r = S.get(B + f"/api/export/avaliacoes?ciclo={cid}"); assert r.status_code == 200 and "Prof Painel" in r.text and "Prof Outro" in r.text and "motor oficial" in r.text
assert SP.get(B + f"/api/export/avaliacoes?ciclo={cid}").status_code == 401; t2 = SG2.get(B + f"/api/export/avaliacoes?ciclo={cid}").text; assert "Prof Outro" in t2 and "Prof Painel" not in t2; ok("CSV pelo motor oficial, com escopo (colaborador não exporta; gestor só a própria equipe)")
psql(f"UPDATE employees SET unit_id={cul} WHERE id={P}")
html = page(f"{PAINEL}?aba=avaliacoes", sess=SDC); assert "Ciclo Teste 2026" not in html and "Nenhuma avaliação publicada" in html; page(f"/desempenho/avaliacoes/{rid}", expect=404, sess=SDC)
psql(f"UPDATE employees SET unit_id={car} WHERE id={P}"); ok("mudança de lotação não abre acesso a avaliações históricas")
html = page(f"/desempenho?ciclo={cid}&lista=publicadas"); assert "Elegíveis" in html and "Prof Painel" in html and "Inconclusivas" in html; ok("visão geral com filtros, denominadores e lista")
html = page(C); assert "Critérios de avaliação do piloto" in html and "Cobertura de evidências" in html; ok("ciclo piloto mostra os critérios de avaliação do piloto")

print("== Agentes de IA, organograma, TV, formação exigida, rotina")
html = page("/governanca/agentes"); aag = aid_of(html, "Cadastrar em piloto")
ag = {"nome": "Agente de triagem de currículos", "funcao": "Resume currículos por requisitos da vaga", "area": "Pessoas", "positionId": prof, "nivel": "N1", "limites": "Não decide contratação; não contata candidatos"}
erro(post("/governanca/agentes", aag, ag), "dono humano"); erro(post("/governanca/agentes", aag, {**ag, "donoUserId": uRH, "nivel": "N3", "revisaoHumana": "RH semanal", "dadosSensiveis": "1"}), "N0 ou N1")
okmsg(post("/governanca/agentes", aag, {**ag, "donoUserId": uRH}), "piloto"); assert "🤖 Agente de triagem" in page("/organograma"); ok("agente exige dono e limites; dados sensíveis só N0/N1; aparece no organograma")
assert "Saúde geral" in page("/tv") and page("/tv", expect=307, sess=SP) is not None and page("/tv?token=errado", expect=307, sess=mk()) is not None and "Saúde geral" in page("/tv?token=tv-teste-123", sess=mk()); ok("Modo TV: gestão ou token de tela; colaborador e token errado barrados")
html = page("/configuracoes?aba=cargos"); acar = aid_of(html, "Formação exigida (se houver)"); nomep, areap = psql(f"SELECT nome||'|'||area FROM positions WHERE id={prof}").split("|")
erro(post("/configuracoes", acar, {"id": prof, "nome": nomep, "area": areap, "formacaoExigida": "Licenciatura", "documentoFormacao": ""}), "documento que comprova")
post("/configuracoes", acar, {"id": prof, "nome": nomep, "area": areap, "formacaoExigida": "Licenciatura", "documentoFormacao": "Diploma"})
html = page("/documentos"); assert "Formação exigida pelo cargo sem comprovante" in html and "Prof Painel" in html; ok("formação exigida por cargo gera pendência de comprovante")
psql(f"UPDATE positions SET formacao_exigida=NULL, documento_formacao=NULL WHERE id={prof}")
j = S.get(B + f"/api/tarefas?token={TOKEN}").json(); assert j.get("ok") and (j.get("desempenho") or {}).get("alertasDesempenho", 0) >= 1, j; ok("rotina diária gera alertas de desempenho (ações atrasadas, validações, compromissos)")
assert psql(f"SELECT count(*) FROM notifications WHERE user_id={uG} AND titulo='Ação de PDI passou do prazo'") != "0" and psql(f"SELECT count(*) FROM notifications WHERE titulo='Ação de PDI passou do prazo' AND texto='Observar aula de colega'") == "0"; ok("alerta de atraso não dispara para ação que esteve em espera institucional e foi concluída")
print(f"\nE2E Painel do Colaborador / V2: {N[0]} verificações OK")
