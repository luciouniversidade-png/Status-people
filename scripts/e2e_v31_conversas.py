# E2E — v31 · Conversas: 1:1 marcadas e feedback contínuo.
# 1:1: convidado só da lista (equipe, gestor, colegas da unidade), validações de data/horário/título, temas filtrados pela lista
# configurada, conflito de horário, aviso SEM nomes ao convidado, confirmação, arquivo .ics só para as duas pessoas (RH e colegas: 404),
# pauta compartilhada (só o autor remove; o outro marca como conversado), detalhe privado, remarcar e cancelar (com motivo e aviso),
# registro como realizada (vira acompanhamento do painel e marca a próxima da série), cadência na lista de colegas e em Minha equipe,
# pendências (1:1 de hoje, falta registrar, equipe sem conversa em dia), indicadores por líder só para a gestão, rotina diária.
# Feedback: livre/SCI/elogio/sugestão, valores filtrados, Academy, visibilidade (privado: nem o gestor nem o RH veem no painel;
# compartilhado com o gestor: só o gestor direto; gestão: painel), quem não tem acesso ao ONE, para si mesmo, rascunho (só o autor),
# pedido de feedback (responder, recusar, cancelar) com pendências e avisos, ciência/agradecimento, elogio também no mural,
# indicadores só com contagens, limite diário.
# Dados fictícios. Uso: bash /tmp/withserver.sh python3 scripts/e2e_v31_conversas.py
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
def login(email, senha="senha12345"):
    s = mk(); html = s.get(B + "/login").text; aid = re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', html)[0]
    loc = post("/login", aid, {"email": email, "senha": senha}, s); assert loc.endswith("/"), (email, loc); return s
def erro(loc, trecho): assert "erro=" in loc and trecho in loc, (trecho, loc)
def okmsg(loc, trecho=""): assert "ok=" in loc and trecho in loc, (trecho, loc)
def q(v): return "NULL" if v is None else str(v) if isinstance(v, (int, float)) else "'" + str(v).replace("'", "''") + "'"
HOJE = datetime.now(ZoneInfo("America/Campo_Grande")).date(); H = HOJE.isoformat()
def d(n): return (HOJE + timedelta(days=n)).isoformat()
def dm(n): return (HOJE + timedelta(days=n)).strftime("%d/%m")

print("Preparação")
RH = login("rh@colegiostatus", "Status2026!"); r = RH.get(B + f"/api/setup?token={TOKEN}"); assert r.json()["ok"], r.text
assert float(psql("SELECT value->>'versao' FROM settings WHERE key='banco'")) >= 31  # 31.0 ou posterior
U = {c: int(psql(f"SELECT id FROM units WHERE codigo='{c}'")) for c in ["CAR", "CUL"]}; CAR, CUL = U["CAR"], U["CUL"]
P = {n: int(psql(f"SELECT id FROM positions WHERE nome='{n}'")) for n in ["Professor", "Coordenador Pedagógico", "Diretor Pedagógico"]}
def emp(nome, cargo, unit, gestor=None):
    return int(psql(f"INSERT INTO employees (nome, unit_id, position_id, vinculo, admissao, gestor_id, situacao, jornada_min_dia, sexo) VALUES ({q(nome)}, {unit}, {P[cargo]}, 'CLT', '2021-02-01', {q(gestor)}, 'ATIVO', 480, 'F') RETURNING id"))
EDIR = emp("Diretora Fictícia", "Diretor Pedagógico", CAR)
CA = emp("Coordenadora Alfa (fictícia)", "Coordenador Pedagógico", CAR, EDIR); CB = emp("Coordenador Beta (fictício)", "Coordenador Pedagógico", CUL, EDIR)
T = [emp(f"Professora Alfa {i} (fictícia)", "Professor", CAR, CA) for i in range(5)]; TX = emp("Professor Beta 0 (fictício)", "Professor", CUL, CB)
aid_user = aid_of(page("/configuracoes", RH), "Criar acesso")
for eid, em in [(CA, "alfa@car"), (CB, "beta@cul"), (T[0], "t0@car"), (T[1], "t1@car"), (T[2], "t2@car"), (TX, "tx@cul")]:
    okmsg(post("/configuracoes", aid_user, {"modo": "auto", "employeeId": eid, "nome": "", "email": em, "senha": "senha12345", "atuacao": "LEITURA", "unitId": ""}, RH))
GA, GB, P0, P1, P2, PX = [login(e) for e in ["alfa@car", "beta@cul", "t0@car", "t1@car", "t2@car", "tx@cul"]]
UID = {e: int(psql(f"SELECT id FROM users WHERE email='{e}'")) for e in ["alfa@car", "t0@car", "t1@car", "t2@car", "tx@cul", "beta@cul"]}
ok("coordenação fictícia com 5 liderados (2 sem acesso ao ONE), outra unidade e acessos pelo cargo")

print("1:1 — marcar")
h = page("/um-a-um", GA); assert "Professora Alfa 0 (fictícia)" in h and "sua equipe" in h and "Professora Alfa 3 (fictícia)" in h and "sem acesso ao ONE" in h
aid = aid_of(h, 'placeholder="Ex.: 1:1 quinzenal"'); base = {"voltar": "/um-a-um", "titulo": "1:1 quinzenal", "recorrencia": "QUINZENAL"}
erro(post("/um-a-um", aid, {**base, "employeeId": T[0], "data": d(-1), "inicio": "10:00", "fim": "10:45"}, GA), "A data já passou")
erro(post("/um-a-um", aid, {**base, "employeeId": T[0], "data": d(2), "inicio": "10:45", "fim": "10:00"}, GA), "O término vem depois do início")
erro(post("/um-a-um", aid, {**base, "employeeId": T[0], "data": d(2), "inicio": "10:00", "fim": "10:45", "titulo": "x"}, GA), "Dê um título")
erro(post("/um-a-um", aid, {**base, "employeeId": TX, "data": d(2), "inicio": "10:00", "fim": "10:45"}, GA), "Escolha o convidado na lista")
loc = post("/um-a-um", aid, {**base, "employeeId": T[0], "data": d(2), "inicio": "10:00", "fim": "10:45", "temas": ["Feedback", "Carreira", "Tema inventado"], "pauta": "Ponto inicial da coordenação"}, GA)
assert "marcada=" in loc, loc; ID = int(re.search(r"marcada=(\d+)", loc).group(1))
assert psql(f"SELECT temas::text||'|'||jsonb_array_length(pauta)||'|'||status||'|'||recorrencia FROM one_on_ones WHERE id={ID}") == '["Feedback", "Carreira"]|1|MARCADA|QUINZENAL'
nt = psql(f"SELECT titulo||'|'||coalesce(texto,'') FROM notifications WHERE user_id={UID['t0@car']} AND chave='1a1:{ID}'"); assert nt.startswith(f"Nova 1:1 marcada para {dm(2)} às 10:00") and "Alfa" not in nt, nt
erro(post("/um-a-um", aid, {**base, "employeeId": T[1], "data": d(2), "inicio": "10:30", "fim": "11:00"}, GA), "Já há uma 1:1 marcada nesse horário")
h = page(f"/um-a-um?marcada={ID}", GA); assert "1:1 marcada" in h and "Professora Alfa 0 (fictícia)" in h and "Carreira" in h and f"/api/um-a-um/{ID}/ics" in h
ok("validações (data passada, horário, título, convidado fora da lista), temas só da lista, conflito de horário, aviso sem nomes e confirmação")

print("1:1 — agenda (.ics), pauta e privacidade")
r = P0.get(B + f"/api/um-a-um/{ID}/ics"); assert r.status_code == 200 and r.headers["content-type"].startswith("text/calendar") and "BEGIN:VEVENT" in r.text and re.search(r"DTSTART:\d{8}T\d{6}Z", r.text) and "SUMMARY:1:1 · 1:1 quinzenal" in r.text, r.text[:300]
assert "DTSTART:" + d(2).replace("-", "") + "T140000Z" in r.text   # 10:00 em Campo Grande = 14:00 UTC
assert P1.get(B + f"/api/um-a-um/{ID}/ics").status_code == 404 and RH.get(B + f"/api/um-a-um/{ID}/ics").status_code == 404
h = page(f"/um-a-um/{ID}", P0); okp = aid_of(h, 'name="texto"'); post(f"/um-a-um/{ID}", okp, {"id": ID, "texto": "Quero falar da carga de correção"}, P0)
pauta = psql(f"SELECT string_agg(x->>'id' || ':' || (x->>'autorId'), ',') FROM one_on_ones, jsonb_array_elements(pauta) x WHERE id={ID}").split(","); assert len(pauta) == 2
it_ga, it_p0 = pauta[0].split(":")[0], pauta[1].split(":")[0]
h = page(f"/um-a-um/{ID}", GA); aidm = aid_of(h, 'aria-label="Remover o ponto"')
erro(post(f"/um-a-um/{ID}", aidm, {"id": ID, "item": it_p0, "remover": "1"}, GA), "Só quem escreveu remove")
post(f"/um-a-um/{ID}", aidm, {"id": ID, "item": it_ga}, P0); assert psql(f"SELECT x->>'feito' FROM one_on_ones, jsonb_array_elements(pauta) x WHERE id={ID} AND x->>'id'='{it_ga}'") == "true"
assert psql(f"SELECT count(*) FROM notifications WHERE user_id={UID['alfa@car']} AND chave LIKE '1a1-pauta:{ID}:%'") == "1"
h = page(f"/um-a-um/{ID}", RH); assert "1:1 não encontrada" in h and "carga de correção" not in h
h = page(f"/um-a-um/{ID}", P1); assert "1:1 não encontrada" in h
ok(".ics só para as duas pessoas (horário em UTC); pauta compartilhada com aviso, só o autor remove, o outro marca como conversado; RH e colegas não abrem a 1:1")

print("1:1 — remarcar, cancelar, registrar como realizada")
h = page(f"/um-a-um/{ID}", GA); assert "Disponível a partir do dia da conversa" in h
aidr = aid_of(h, "Remarcar e avisar"); okmsg(post(f"/um-a-um/{ID}", aidr, {"id": ID, "data": d(1), "inicio": "09:00", "fim": "09:30"}, GA), "remarcada")
assert psql(f"SELECT data::text||' '||inicio FROM one_on_ones WHERE id={ID}") == f"{d(1)} 09:00" and psql(f"SELECT count(*) FROM notifications WHERE user_id={UID['t0@car']} AND titulo LIKE '1:1 remarcada para {dm(1)} às 09:00%'") == "1"
h = page(f"/um-a-um/{ID}", P0); aidc = aid_of(h, "Cancelar a 1:1")
erro(post(f"/um-a-um/{ID}", aidc, {"id": ID, "motivo": "x"}, P0), "por que a 1:1 foi cancelada")
okmsg(post(f"/um-a-um/{ID}", aidc, {"id": ID, "motivo": "Conselho de classe no mesmo horário"}, P0), "cancelada"); assert psql(f"SELECT status FROM one_on_ones WHERE id={ID}") == "CANCELADA"
assert psql(f"SELECT count(*) FROM notifications WHERE user_id={UID['alfa@car']} AND chave='1a1-can:{ID}'") == "1"
loc = post("/um-a-um", aid, {**base, "employeeId": T[1], "data": H, "inicio": "07:00", "fim": "07:30", "recorrencia": "MENSAL", "temas": ["Resultados"], "pauta": "Fechamento do bimestre"}, GA); ID2 = int(re.search(r"marcada=(\d+)", loc).group(1))
h = page("/pendencias", GA); assert "Conversar às 07:00" in h
h = page(f"/um-a-um/{ID2}", GA); aidreg = aid_of(h, 'name="combinados"')
erro(post(f"/um-a-um/{ID2}", aidreg, {"id": ID2, "combinados": "ok"}, GA), "Registre o que foi combinado")
loc = post(f"/um-a-um/{ID2}", aidreg, {"id": ID2, "combinados": "Lançar as notas até sexta e revisar a recuperação do 8º A.", "compromissoGestor": "Liberar 2 horas na reunião", "compromissoColaborador": "Enviar o plano até quarta", "compromissoPrazo": d(5), "marcarProxima": "1", "proximaData": "", "levarPauta": "1"}, GA)
okmsg(loc, "a próxima já está marcada"); ID3 = int(re.search(r"/um-a-um/(\d+)", loc).group(1))
ck = psql(f"SELECT o.status||'|'||c.tipo||'|'||c.combinados||'|'||c.compromisso_colaborador||'|'||c.employee_id||'|'||c.pauta_colaborador FROM one_on_ones o JOIN perf_checkins c ON c.id=o.checkin_id WHERE o.id={ID2}")
assert ck.startswith(f"REALIZADA|REUNIAO|Lançar as notas até sexta e revisar a recuperação do 8º A.|Enviar o plano até quarta|{T[1]}|· Fechamento do bimestre"), ck
assert psql(f"SELECT data::text||'|'||anterior_id||'|'||status||'|'||recorrencia FROM one_on_ones WHERE id={ID3}") == f"{d(28)}|{ID2}|MARCADA|MENSAL"
h = page(f"/colaboradores/{T[1]}/painel?aba=acompanhamento", GA); assert "Lançar as notas até sexta" in h
h = page(f"/um-a-um/{ID3}", P1); assert "Conversas anteriores da série" in h and "Fechamento do bimestre" not in h.split("Pauta")[1][:200]
loc = post("/um-a-um", aid, {**base, "employeeId": T[2], "data": H, "inicio": "07:40", "fim": "08:00", "recorrencia": "NENHUMA", "temas": ["Carreira"], "pauta": "Assunto pessoal que fica entre os dois"}, GA); ID4 = int(re.search(r"marcada=(\d+)", loc).group(1))
h = page(f"/um-a-um/{ID4}", GA); assert 'name="levarPauta"' in h
okmsg(post(f"/um-a-um/{ID4}", aid_of(h, 'name="combinados"'), {"id": ID4, "combinados": "Seguir com o plano combinado na última conversa."}, GA), "registrada")
assert psql(f"SELECT coalesce(c.pauta_colaborador, 'NULO') FROM one_on_ones o JOIN perf_checkins c ON c.id=o.checkin_id WHERE o.id={ID4}") == "NULO"
assert "Assunto pessoal que fica entre os dois" not in page(f"/colaboradores/{T[2]}/painel?aba=acompanhamento", GA)
ok("remarcar e cancelar (com motivo) avisam a outra pessoa; realizada vira acompanhamento do painel (a pauta só vai junto se quem registra marcar) e já marca a próxima da série (mensal = 4 semanas)")

print("1:1 — cadência, pendências, Minha equipe, indicadores e rotina")
psql(f"INSERT INTO perf_checkins (employee_id, data, user_id, temas, combinados, tipo) VALUES ({T[4]}, '{d(-50)}', {UID['alfa@car']}, 'Acompanhamento', 'ok', 'REUNIAO')")
psql(f"INSERT INTO one_on_ones (organizador_user_id, organizador_nome, employee_id, data, inicio, fim, titulo) VALUES ({UID['alfa@car']}, 'Coordenadora Alfa (fictícia)', {T[2]}, '{d(-2)}', '15:00', '15:30', '1:1 quinzenal')")
h = page("/um-a-um", GA)
def lin(nome): return next(t for t in h.split("<tr")[1:] if nome in t)
assert "atrasada (alvo 30 dias)" in lin("Professora Alfa 4 (fictícia)") and "nunca conversaram" in lin("Professora Alfa 3 (fictícia)") and "marcada" in lin("Professora Alfa 1 (fictícia)")
h = page("/pendencias", GA); assert "Registrar os combinados" in h and "sem conversa em dia" in h
h = page("/equipe", GA); assert "1:1" in h and f"/um-a-um?marcar={T[3]}" in h and "nunca · marcar" in h and "sem conversa (1:1) em dia" in h
h = page(f"/um-a-um?marcar={T[3]}", GA); assert re.search(rf'<option value="{T[3]}" selected', h) or f'value="{T[3]}" selected' in h
h = page("/um-a-um?aba=indicadores", RH); assert "Coordenadora Alfa (fictícia)" in h and "Conversa em dia por líder" in h and "carga de correção" not in h
h = page("/um-a-um?aba=indicadores", GA); assert "Coordenadora Alfa (fictícia)" in h and "Coordenador Beta" not in h
h = page("/um-a-um?aba=indicadores", P0); assert "Conversa em dia por líder" not in h and ">Indicadores<" not in h
h = page("/eu", P1); assert "Minhas 1:1" in h and f"{dm(28)} às 07:00" in h and "Pedir 1:1 ao meu gestor" in h
loc = post("/um-a-um", aid_of(page(f"/um-a-um?marcar={CA}", P1), 'placeholder="Ex.: 1:1 quinzenal"'), {**base, "employeeId": CA, "data": d(3), "inicio": "16:00", "fim": "16:30", "titulo": "Conversa de carreira"}, P1); assert "marcada=" in loc, loc
j = requests.get(B + f"/api/tarefas?token={TOKEN}").json(); assert j["ok"] and "v31" in j and j["v31"]["falhas"] == [], j.get("v31")
ok("cadência por colega (em dia, atrasada pelo alvo da família, nunca, marcada); pendências; Minha equipe com a coluna 1:1 e o atalho; indicadores só para a gestão (o gestor vê só a própria equipe); o liderado pede 1:1 ao gestor; rotina diária")

print("Feedback — mandar, visibilidade e privacidade")
cur = psql("SELECT id FROM courses WHERE ativo ORDER BY id LIMIT 1"); val = psql("SELECT coalesce((SELECT x->>'nome' FROM strategy_identity, jsonb_array_elements(valores) x ORDER BY (status='VIGENTE') DESC, versao DESC LIMIT 1), '')")
h = page("/feedback/novo", P0); aidf = aid_of(h, 'name="visibilidade"')
assert "Escreva aqui seu feedback. Não se esqueça de fornecer o contexto e as consequências do comportamento em questão." in h and "Recomende um conteúdo da Academy" in h and "Conecte seu feedback a valores" in h
TXT = "Na reunião de planejamento de terça você trouxe os dados das turmas — terminamos no horário e todos saíram com tarefas claras."
loc = post("/feedback/novo", aidf, {"voltar": "/feedback/novo", "employeeId": T[1], "formato": "LIVRE", "assunto": "Condução da reunião de planejamento", "texto": TXT, "valores": [v for v in [val, "Valor inventado"] if v], "courseId": cur or "", "visibilidade": "PRIVADO", "acao": "enviar"}, P0)
assert "enviado=" in loc, loc; F1 = int(re.search(r"enviado=(\d+)", loc).group(1))
row = psql(f"SELECT status||'|'||visibilidade||'|'||formato||'|'||valores::text||'|'||coalesce(course_id::text,'')||'|'||autor_employee_id FROM feedbacks WHERE id={F1}")
assert row.startswith("ENVIADO|PRIVADO|LIVRE|") and "Valor inventado" not in row and row.endswith(f"|{T[0]}"), row
nt = psql(f"SELECT titulo||'|'||coalesce(texto,'') FROM notifications WHERE user_id={UID['t1@car']} AND chave='fb:{F1}'"); assert nt == "Você recebeu um feedback|", nt
h = page(f"/feedback?enviado={F1}", P0); assert "Feedback enviado" in h and "Para Professora Alfa 1 (fictícia)" in h and "Assunto: Condução da reunião de planejamento" in h
h = page("/feedback?aba=recebidos", P1); assert TXT[:40] in h and "de Professora Alfa 0 (fictícia)" in h
for s in [GA, RH]: assert TXT[:40] not in page(f"/colaboradores/{T[1]}/painel?aba=feedbacks", s)
loc = post("/feedback/novo", aidf, {"voltar": "/feedback/novo", "employeeId": T[1], "formato": "SCI", "assunto": "Atendimento à família", "situacao": "No atendimento à mãe do Pedro, sexta à tarde.", "comportamento": "Você ouviu sem interromper e combinou um retorno por escrito.", "impacto": "A família voltou a responder.", "visibilidade": "GESTOR", "acao": "enviar"}, P0); assert "enviado=" in loc, loc
assert "Você ouviu sem interromper" in page(f"/colaboradores/{T[1]}/painel?aba=feedbacks", GA) and "Você ouviu sem interromper" not in page(f"/colaboradores/{T[1]}/painel?aba=feedbacks", RH)
assert psql(f"SELECT count(*) FROM notifications WHERE user_id={UID['alfa@car']} AND titulo LIKE 'Um feedback sobre alguém da sua equipe%'") == "1"
erro(post("/feedback/novo", aidf, {"voltar": "/feedback/novo", "employeeId": T[1], "formato": "SCI", "situacao": "curta", "comportamento": "", "acao": "enviar"}, P0), "Descreva a situação e o comportamento")
erro(post("/feedback/novo", aidf, {"voltar": "/feedback/novo", "employeeId": T[1], "formato": "LIVRE", "texto": "Valeu!", "acao": "enviar"}, P0), "pelo menos 20 caracteres")
erro(post("/feedback/novo", aidf, {"voltar": "/feedback/novo", "employeeId": T[0], "formato": "LIVRE", "texto": TXT, "acao": "enviar"}, P0), "para você mesmo")
erro(post("/feedback/novo", aidf, {"voltar": "/feedback/novo", "employeeId": T[3], "formato": "LIVRE", "texto": TXT, "acao": "enviar"}, P0), "ainda não tem acesso ao ONE")
erro(post("/feedback/novo", aidf, {"voltar": "/feedback/novo", "employeeId": TX, "formato": "LIVRE", "texto": TXT, "acao": "enviar"}, P0), "Escolha a pessoa na lista de colegas")
h = page(f"/feedback/novo?para={T[3]}", GA); assert "Registrar no painel do colaborador (gestão vê)" in h
loc = post("/feedback/novo", aid_of(h, 'name="visibilidade"'), {"voltar": "/feedback/novo", "employeeId": T[3], "formato": "ELOGIO", "assunto": "Feira de ciências", "texto": "A organização da feira foi impecável: grupos no horário e famílias com o roteiro antes. Obrigada pelo cuidado.", "visibilidade": "GESTAO", "mural": "1", "acao": "enviar"}, GA)
assert "enviado=" in loc, loc; F3 = int(re.search(r"enviado=(\d+)", loc).group(1))
assert psql(f"SELECT f.visibilidade||'|'||(r.id IS NOT NULL)||'|'||r.para_employee_id FROM feedbacks f LEFT JOIN recognitions r ON r.id=f.recognition_id WHERE f.id={F3}") == f"GESTAO|true|{T[3]}"
assert "A organização da feira foi impecável" in page(f"/colaboradores/{T[3]}/painel?aba=feedbacks", RH) and "A organização da feira" in page("/reconhecimento", P2)
ok("livre com valores (só os da escola) e Academy; aviso sem nomes; privado: nem o gestor nem o RH veem no painel; compartilhado: só o gestor direto (com aviso de contagem); validações (SCI, tamanho, si mesmo, sem acesso, fora da lista); gestão registra no painel quem não tem acesso; elogio também no mural")

print("Feedback — rascunho, pedidos, ciência e indicadores")
okmsg(post("/feedback/novo", aidf, {"voltar": "/feedback/novo", "employeeId": T[2], "formato": "SUGESTAO", "assunto": "Laboratório", "texto": "Rascunho: pensar em como sugerir…", "acao": "rascunho"}, P0), "Rascunho salvo")
RID = int(psql(f"SELECT id FROM feedbacks WHERE autor_user_id={UID['t0@car']} AND status='RASCUNHO'"))
assert "Rascunho: pensar" not in page("/feedback?aba=recebidos", P2) and psql(f"SELECT count(*) FROM notifications WHERE user_id={UID['t2@car']} AND chave='fb:{RID}'") == "0"
assert "Laboratório" in page("/feedback?aba=rascunhos", P0) and "Rascunho: pensar" not in page(f"/colaboradores/{T[2]}/painel?aba=feedbacks", GA)
h = page(f"/feedback/novo?rascunho={RID}", P0); assert "Rascunho: pensar" in h and "Laboratório" in h
loc = post("/feedback/novo", aid_of(h, 'name="visibilidade"'), {"voltar": f"/feedback/novo?rascunho={RID}", "id": RID, "employeeId": T[2], "formato": "SUGESTAO", "assunto": "Laboratório", "texto": "Para a próxima feira, agende o laboratório com uma semana de antecedência — assim a turma da tarde também usa.", "visibilidade": "PRIVADO", "acao": "enviar"}, P0)
assert f"enviado={RID}" in loc, loc; assert psql(f"SELECT status FROM feedbacks WHERE id={RID}") == "ENVIADO"
erro(post("/feedback/novo", aidf, {"voltar": "/feedback/novo", "id": RID, "employeeId": T[2], "formato": "LIVRE", "texto": TXT, "acao": "enviar"}, P1), "Rascunho não encontrado")
h = page("/feedback?aba=pedidos", P2); aidq = aid_of(h, 'name="assunto"'); assert "Professora Alfa 3" not in h.split('name="para"')[1].split("</select>")[0]
erro(post("/feedback?aba=pedidos", aidq, {"para": [T[0], T[1]], "assunto": "x"}, P2), "Diga sobre o que você quer feedback")
okmsg(post("/feedback?aba=pedidos", aidq, {"para": [T[0], T[1]], "assunto": "a condução da reunião de pais", "mensagem": "O que posso mudar?", "prazo": d(5)}, P2), "Pedido enviado a 2")
okmsg(post("/feedback?aba=pedidos", aidq, {"para": [T[0], T[1]], "assunto": "a condução da reunião de pais", "prazo": d(5)}, P2), "já estavam abertos")
Q0 = int(psql(f"SELECT id FROM feedback_requests WHERE para_user_id={UID['t0@car']}")); Q1 = int(psql(f"SELECT id FROM feedback_requests WHERE para_user_id={UID['t1@car']}"))
assert psql(f"SELECT titulo FROM notifications WHERE user_id={UID['t0@car']} AND chave='fbq:{Q0}'") == "Pediram um feedback seu"
h = page("/pendencias", P0); assert "Responder ao pedido" in h and "a condução da reunião de pais" in h
h = page(f"/feedback/novo?pedido={Q0}", P0); assert "Respondendo a um pedido" in h and "O que posso mudar?" in h
loc = post("/feedback/novo", aid_of(h, 'name="visibilidade"'), {"voltar": f"/feedback/novo?pedido={Q0}", "pedidoId": Q0, "employeeId": T[2], "formato": "LIVRE", "texto": "Você abriu com os combinados do bimestre; deixe 10 minutos para perguntas no fim — faltou tempo.", "visibilidade": "PRIVADO", "acao": "enviar"}, P0)
F4 = int(re.search(r"enviado=(\d+)", loc).group(1)); assert psql(f"SELECT r.status||'|'||r.feedback_id||'|'||f.request_id||'|'||f.employee_id FROM feedback_requests r JOIN feedbacks f ON f.id=r.feedback_id WHERE r.id={Q0}") == f"RESPONDIDO|{F4}|{Q0}|{T[2]}"
erro(post("/feedback/novo", aid_of(h, 'name="visibilidade"'), {"voltar": f"/feedback/novo?pedido={Q0}", "pedidoId": Q0, "employeeId": T[2], "formato": "LIVRE", "texto": TXT, "acao": "enviar"}, P0), "já foi respondido")
assert psql(f"SELECT count(*) FROM notifications WHERE user_id={UID['t2@car']} AND chave='fbp:{Q0}'") == "1"
h = page("/feedback?aba=pedidos", P1); okmsg(post("/feedback?aba=pedidos", aid_of(h, 'placeholder="Ex.: não acompanhei esse trabalho de perto"'), {"id": Q1, "motivo": "Não estive na reunião"}, P1), "recusado")
assert psql(f"SELECT status||'|'||motivo_recusa FROM feedback_requests WHERE id={Q1}") == "RECUSADO|Não estive na reunião"
okmsg(post("/feedback?aba=pedidos", aidq, {"para": [T[0]], "assunto": "o projeto de leitura", "prazo": d(4)}, P2)); Q2 = int(psql(f"SELECT max(id) FROM feedback_requests WHERE solicitante_user_id={UID['t2@car']}"))
h = page("/feedback?aba=pedidos", P2); okmsg(post("/feedback?aba=pedidos", aid_of(h, ">Cancelar</button>"), {"id": Q2}, P2), "cancelado"); assert psql(f"SELECT status FROM feedback_requests WHERE id={Q2}") == "CANCELADO"
h = page("/feedback?aba=recebidos", P1); aidg = aid_of(h, "Agradecer</button>")
okmsg(post("/feedback?aba=recebidos", aidg, {"id": F1, "agradecer": "1"}, P1)); assert psql(f"SELECT (ciencia_em IS NOT NULL)||'|'||(agradecido_em IS NOT NULL) FROM feedbacks WHERE id={F1}") == "true|true"
assert psql(f"SELECT count(*) FROM notifications WHERE user_id={UID['t0@car']} AND titulo='Agradeceram o seu feedback'") == "1"
okmsg(post("/feedback?aba=recebidos", aidg, {"id": F1, "comentario": "Obrigada! Vou mandar a pauta antes."}, P1)); assert psql(f"SELECT comentario_colaborador FROM feedbacks WHERE id={F1}") == "Obrigada! Vou mandar a pauta antes."
erro(post("/feedback?aba=recebidos", aidg, {"id": F1, "agradecer": "1"}, P2), "Feedback não encontrado")
h = page("/feedback?aba=enviados", P0); assert "🙏 agradeceu" in h and "Obrigada! Vou mandar a pauta antes." in h
h = page("/feedback?aba=indicadores", RH); assert "Receberam feedback (90 dias)" in h and "Carandá" in h and TXT[:30] not in h and "Feedbacks enviados por mês" in h
assert "Receberam feedback (90 dias)" not in page("/feedback?aba=indicadores", P0)
psql("UPDATE settings SET value = jsonb_set(coalesce(value, '{}'::jsonb), '{feedbackLimiteDia}', '3') WHERE key='conversas'") if psql("SELECT count(*) FROM settings WHERE key='conversas'") == "1" else psql("INSERT INTO settings (key, value) VALUES ('conversas', '{\"feedbackLimiteDia\": 3}'::jsonb)")
erro(post("/feedback/novo", aidf, {"voltar": "/feedback/novo", "employeeId": T[1], "formato": "LIVRE", "texto": TXT, "acao": "enviar"}, P0), "Limite diário")
ok("rascunho só do autor (e só ele continua); pedido com pendência e aviso, resposta liga o feedback ao pedido (não responde duas vezes), recusa com motivo, cancelamento; ciência, agradecimento e comentário avisam o autor; indicadores só com contagens e só para a gestão; limite diário")

print(f"\nOK — {N[0]} blocos da v31 (conversas) passaram.")
