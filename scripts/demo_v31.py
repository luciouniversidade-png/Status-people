"""Dados de DEMONSTRAÇÃO da v31 — NUNCA rode em produção. Tudo fictício (e-mails em .exemplo, nomes "(fictício)/(fictícia)" ou "Demo").
Roda com o servidor no ar, na base de treinamento (a mesma da v30, já atualizada para a v31). O que faz — pela própria interface quando
é um fluxo do sistema, e por carga direta quando é histórico que levaria meses para existir:
  0. acessos de demonstração para a equipe do 360° (a equipe direta do gestor da Carandá) e para alguns líderes;
  1. 1:1: marcadas com temas e pauta compartilhada, uma registrada como realizada (com a próxima já marcada) e o histórico de conversas;
  2. feedback contínuo: livre, situação·comportamento·impacto, elogio (também no mural), sugestão, rascunho, pedido de feedback
     respondido e recusado, agradecimento — e um ano de histórico para os indicadores;
  3. 360°: pares sugeridos automaticamente e convidados, um par incluído à mão e as respostas (parte ainda pendente);
  4. metas: propostas pelo colaborador, uma aprovada e outra devolvida, e o cadastro da equipe;
  5. OKRs em desdobramento: objetivos das unidades que vêm dos objetivos da rede (até 3 níveis), com resultados-chave e metas ligadas;
  6. calibração: o retrato de antes nos ciclos encerrados (quem subiu e quem desceu, com justificativa);
  7. PDI: planos e ações nas equipes de vários líderes (adesão, atraso e progresso) e uma necessidade encaminhada para PDI.
Uso: python3 scripts/demo_v31.py   (servidor local em http://localhost:3100, banco local via psql)."""
import os, re, subprocess, random, json, requests
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
B = os.environ.get("APP", "http://localhost:3100")
def psql(q):
    r = subprocess.run(["su", "postgres", "-c", "/usr/lib/postgresql/16/bin/psql -h /tmp/pg -U status -d status_people -q -t -A -F '|' -v ON_ERROR_STOP=1"], input=q + ";", capture_output=True, text=True)
    if r.returncode != 0: raise SystemExit(f"SQL falhou: {r.stderr[:800]}\n{q[:600]}")
    return r.stdout.strip()
def rows(q): return [l.split("|") for l in psql(q).splitlines() if l]
def mk(): s = requests.Session(); s.headers.update({"Origin": B}); return s
def action_ids(html): i = html.find("<main"); return re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', html[i:] if i >= 0 else html)
def post(path, aid, data, sess, show=True):
    f = [(f"$ACTION_ID_{aid}", (None, ""))]
    for k, v in data.items():
        for x in (v if isinstance(v, list) else [v]): f.append((k, (None, str(x))))
    r = sess.post(B + path, files=f, allow_redirects=False); m = re.search(r"rh_session=([^;]+)", r.headers.get("set-cookie", ""))
    if m: sess.headers["Cookie"] = f"rh_session={m.group(1)}"
    loc = requests.utils.unquote(r.headers.get("location", "")).replace("\xa0", " ")
    if show: print("   ", path, "→", loc[:150])
    return loc
def aid_of(html, marker):
    i = html.find(marker); assert i >= 0, marker
    fs = html.rfind("<form", 0, i); fe_prev = html.rfind("</form>", 0, i)
    if fs > fe_prev: fe = html.find("</form>", i)
    else: fs = html.find("<form", i); fe = html.find("</form>", fs)
    return action_ids(html[fs:fe])[0]
def page(path, sess): return sess.get(B + path).text.replace("\xa0", " ")
def login(email, senha):
    s = mk(); html = s.get(B + "/login").text; aid = re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', html)[0]; post("/login", aid, {"email": email, "senha": senha}, s, False); return s
def ok(loc, trecho=""): assert "ok=" in loc and trecho in loc, loc; return loc
def q(v): return "NULL" if v is None else str(v) if isinstance(v, (int, float)) else "'" + str(v).replace("'", "''") + "'"
def j(v): return "'" + json.dumps(v, ensure_ascii=False).replace("'", "''") + "'::jsonb"
HOJE = datetime.now(ZoneInfo("America/Campo_Grande")).date(); d = lambda n: (HOJE + timedelta(days=n)).isoformat()
R = random.Random(31)
if psql("SELECT 1 FROM settings WHERE key='demo_v31'"): raise SystemExit("A demonstração da v31 já foi carregada nesta base.")

print("0) acessos de demonstração (a equipe do 360° e alguns líderes)")
HASH = psql("SELECT senha_hash FROM users WHERE email='fernanda.vidal@exemplo.com'")
equipe = [int(x) for (x,) in rows("SELECT e.id FROM perf_reviews r JOIN employees e ON e.id=r.employee_id WHERE r.cycle_id=4 AND NOT EXISTS (SELECT 1 FROM users u WHERE u.employee_id=e.id) ORDER BY e.id")]
lideres = [int(x) for (x,) in rows("SELECT id FROM employees WHERE id IN (22, 28, 53, 68, 89, 131) AND NOT EXISTS (SELECT 1 FROM users u WHERE u.employee_id=employees.id)")]
for eid in equipe + lideres:
    nome, unit, atu = rows(f"SELECT e.nome, e.unit_id, coalesce(p.acesso->>'atuacao', 'COLABORADOR') FROM employees e LEFT JOIN positions p ON p.id=e.position_id WHERE e.id={eid}")[0]
    num = re.sub(r"\D", "", nome) or str(eid); email = f"demo{num.zfill(3)}@exemplo.com" if "Demo" in nome else re.sub(r"[^a-z.]", "", nome.split(" (")[0].lower().replace(" ", ".")) + "@exemplo.com"
    role = atu if eid in lideres else "COLABORADOR"; uu = q(int(unit)) if role in ("GESTOR", "COLABORADOR", "DIRETOR_UNIDADE") else "NULL"
    psql(f"INSERT INTO users (email, nome, senha_hash, role, unit_id, employee_id, ativo, trocar_senha) VALUES ({q(email)}, {q(nome)}, {q(HASH)}, {q(role)}, {uu}, {eid}, true, false) ON CONFLICT DO NOTHING")
print(f"   {len(equipe)} acessos na equipe da Carandá e {len(lideres)} de líderes (senha de demonstração)")
UID = {int(e): int(u) for u, e in rows("SELECT id, employee_id FROM users WHERE employee_id IS NOT NULL AND ativo")}
NOME = {int(i): n for i, n in rows("SELECT id, nome FROM employees")}
UNOME = {int(i): n for i, n in rows("SELECT id, nome FROM users")}

RH = login("rh.teste", "Homolog2026!"); GES = login("gestor.caranda", "Homolog2026!"); COL = login("colaborador.caranda", "Homolog2026!")
P36 = login("demo021@exemplo.com", "senha12345"); P47 = login("demo032@exemplo.com", "senha12345")
GES_EMP = 87; COL_EMP = 128; GES_UID = UID[87]; COL_UID = UID[128]

print("1) 1:1 — marcar com temas, pauta compartilhada, registrar como realizada e o histórico")
h = page("/um-a-um", GES); aid = aid_of(h, 'placeholder="Ex.: 1:1 quinzenal"')
loc = post("/um-a-um", aid, {"voltar": "/um-a-um", "employeeId": COL_EMP, "data": d(1), "inicio": "10:25", "fim": "11:25", "titulo": "1:1 quinzenal", "temas": ["Checkpoint de PDI", "Feedback"], "recorrencia": "QUINZENAL", "pauta": "Rever o plano de recuperação do 7º B"}, GES)
assert "marcada=" in loc, loc; ID_COL = int(re.search(r"marcada=(\d+)", loc).group(1))
for emp, dia, ini, fim, tit, temas in [(47, 2, "14:00", "14:45", "1:1 mensal", ["Resultados", "Planejamento de trabalho"]), (52, 6, "09:30", "10:15", "Conversa de carreira", ["Carreira", "Desenvolvimento de competências"]), (58, 9, "16:00", "16:40", "1:1 quinzenal", ["Alinhamento de expectativas"])]:
    loc = post("/um-a-um", aid, {"voltar": "/um-a-um", "employeeId": emp, "data": d(dia), "inicio": ini, "fim": fim, "titulo": tit, "temas": temas, "recorrencia": "QUINZENAL" if "quinzenal" in tit else "MENSAL"}, GES); assert "marcada=" in loc, loc
h = page(f"/um-a-um/{ID_COL}", COL); aidp = aid_of(h, 'name="texto"')
for t in ["Quero falar da carga de correção no fim do bimestre", "Interesse no curso de Comunicação não violenta"]: post(f"/um-a-um/{ID_COL}", aidp, {"id": ID_COL, "texto": t}, COL)
h = page(f"/um-a-um/{ID_COL}", GES); post(f"/um-a-um/{ID_COL}", aid_of(h, 'name="texto"'), {"id": ID_COL, "texto": "Combinar a observação de aula de novembro"}, GES)
psql(f"""UPDATE one_on_ones SET pauta=(SELECT jsonb_agg(jsonb_set(x, '{{em}}', to_jsonb(to_char('{d(-1)} 19:30'::timestamp + (o * interval '9 minutes'), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))) ORDER BY o) FROM jsonb_array_elements(pauta) WITH ORDINALITY AS t(x, o)) WHERE id={ID_COL}""")
# uma 1:1 de hoje, registrada como realizada (vira acompanhamento) e com a próxima já marcada
loc = post("/um-a-um", aid, {"voltar": "/um-a-um", "employeeId": 36, "data": d(0), "inicio": "07:30", "fim": "08:00", "titulo": "1:1 mensal", "temas": ["Resultados", "Checkpoint de PDI"], "recorrencia": "MENSAL", "pauta": "Fechamento das notas do 3º bimestre"}, GES)
ID_HOJE = int(re.search(r"marcada=(\d+)", loc).group(1)); h = page(f"/um-a-um/{ID_HOJE}", GES)
ok(post(f"/um-a-um/{ID_HOJE}", aid_of(h, 'name="combinados"'), {"id": ID_HOJE, "combinados": "Notas do 3º bimestre lançadas até sexta; plano de recuperação do 8º A revisado junto com a coordenação.", "compromissoGestor": "Liberar 2 horas da reunião pedagógica para a recuperação", "compromissoColaborador": "Enviar o plano revisado até quarta", "compromissoPrazo": d(5), "marcarProxima": "1", "proximaData": d(28), "levarPauta": "1"}, GES), "registrada")
# histórico: conversas realizadas (com o acompanhamento registrado), algumas canceladas e duas que faltam registrar
COMBINADOS = ["Seguir o plano do bimestre; rever a recuperação na próxima conversa.", "Priorizar as devolutivas atrasadas do 6º ano até sexta.", "Inscrever-se no treinamento de comunicação com as famílias.", "Testar a rotina de planejamento semanal com a coordenação.", "Revisar as metas do semestre — duas ficam, uma muda.", "Combinar a observação de aula para o próximo mês.", "Organizar a reunião de pais junto com a secretaria.", "Registrar as evidências do projeto de leitura no painel."]
TEMAS = ["Checkpoint de PDI", "Feedback", "Resultados", "Planejamento de trabalho", "Alinhamento de expectativas", "Carreira", "Devolutiva", "Desenvolvimento de competências"]
def realizada(org_emp, emp, dias, titulo="1:1 quinzenal"):
    org = UID.get(org_emp); data = d(-dias); tm = R.sample(TEMAS, 2); comb = R.choice(COMBINADOS); ini = R.choice(["08:00", "09:30", "10:30", "14:00", "15:30", "16:30"]); fim = f"{int(ini[:2]) + 1:02d}{ini[2:]}" if ini[:2] != "16" else "17:10"
    ck = psql(f"INSERT INTO perf_checkins (employee_id, data, user_id, temas, combinados, tipo, avancou, pauta_colaborador) VALUES ({emp}, {q(data)}, {org}, {q(titulo + ' · ' + ', '.join(tm))}, {q(comb)}, 'REUNIAO', {q(comb)}, NULL) RETURNING id")
    psql(f"INSERT INTO one_on_ones (organizador_user_id, organizador_nome, organizador_employee_id, employee_id, data, inicio, fim, titulo, temas, recorrencia, status, pauta, checkin_id, realizada_em, created_at) VALUES ({org}, {q(NOME[org_emp])}, {org_emp}, {emp}, {q(data)}, {q(ini)}, {q(fim)}, {q(titulo)}, {j(tm)}, 'QUINZENAL', 'REALIZADA', {j([{'id': f'h{emp}{dias}', 'texto': R.choice(['Rotina da turma', 'Plano do bimestre', 'Recuperação paralela', 'Projeto de leitura', 'Reunião de pais']), 'autor': NOME[org_emp], 'autorId': org, 'em': data + 'T12:00:00Z', 'feito': True}])}, {ck}, {q(data + ' 18:00')}, {q(data + ' 08:00')})")
n1 = 0
for org_emp, frac_dia, frac_atras in [(87, 0.62, 0.2), (133, 0.6, 0.2), (68, 0.7, 0.15), (131, 0.35, 0.3), (28, 0.25, 0.3), (22, 0.5, 0.2)]:
    if org_emp not in UID: continue
    lids = [int(x) for (x,) in rows(f"SELECT id FROM employees WHERE gestor_id={org_emp} AND situacao IN ('ATIVO','FERIAS','AFASTADO') AND id NOT IN ({COL_EMP}, 36, 47, 52, 58) ORDER BY id")]
    R.shuffle(lids); a = int(len(lids) * frac_dia); b = int(len(lids) * frac_atras)
    for i, emp in enumerate(lids[:a]): realizada(org_emp, emp, R.randint(2, 26)); realizada(org_emp, emp, R.randint(30, 60)) if i % 2 == 0 else None; n1 += 1
    for emp in lids[a:a + b]: realizada(org_emp, emp, R.randint(48, 85)); n1 += 1
realizada(87, COL_EMP, 13); realizada(87, COL_EMP, 27); realizada(87, 36, 29); realizada(87, 47, 31); realizada(87, 52, 70)
for emp, dias, (pg, pc) in [(57, 3, ("Fechamento das notas do bimestre", "Pedido de apoio com a turma do 7º A")), (60, 6, ("Plano de recuperação da turma", "Horário da reunião de pais"))]:
    pauta = [{"id": f"g{emp}", "texto": pg, "autor": UNOME[GES_UID], "autorId": GES_UID, "em": d(-dias - 2) + "T14:00:00Z", "feito": True}] + ([{"id": f"c{emp}", "texto": pc, "autor": UNOME[UID[emp]] if emp in UID else NOME[emp], "autorId": UID[emp], "em": d(-dias - 1) + "T19:30:00Z", "feito": False}] if emp in UID else [])
    psql(f"INSERT INTO one_on_ones (organizador_user_id, organizador_nome, organizador_employee_id, employee_id, data, inicio, fim, titulo, temas, recorrencia, pauta, created_at) VALUES ({GES_UID}, {q(NOME[87])}, 87, {emp}, {q(d(-dias))}, '15:00', '15:45', '1:1 quinzenal', {j(['Resultados'])}, 'QUINZENAL', {j(pauta)}, {q(d(-dias - 7) + ' 09:00')})")
for emp, dias, mot in [(70, 9, "Reunião extraordinária de pais no mesmo horário"), (84, 16, "Professor em formação externa — remarcar na volta")]:
    psql(f"INSERT INTO one_on_ones (organizador_user_id, organizador_nome, organizador_employee_id, employee_id, data, inicio, fim, titulo, temas, status, motivo_cancelamento, created_at) VALUES ({GES_UID}, {q(NOME[87])}, 87, {emp}, {q(d(-dias))}, '10:00', '10:45', '1:1 mensal', {j(['Feedback'])}, 'CANCELADA', {q(mot)}, {q(d(-dias - 5) + ' 09:00')})")
print(f"   1:1 marcadas pela interface, 1 registrada com a próxima marcada; histórico de {n1} conversas")

print("2) feedback contínuo")
h = page("/feedback/novo", COL); aidf = aid_of(h, 'name="visibilidade"')
loc = post("/feedback/novo", aidf, {"voltar": "/feedback/novo", "employeeId": 36, "formato": "LIVRE", "assunto": "Condução da reunião de planejamento", "texto": "Na reunião de planejamento de terça, você trouxe os dados das turmas e propôs dividir as tarefas por série. Terminamos no horário e cada professor saiu sabendo o que fazer — foi a reunião mais produtiva do bimestre. Para a próxima, vale mandar a pauta um dia antes.", "valores": ["Confiança", "Aprendizagem"], "courseId": 6, "visibilidade": "PRIVADO", "acao": "enviar"}, COL)
assert "enviado=" in loc, loc
h = page(f"/feedback/novo?para={COL_EMP}", GES); aidg = aid_of(h, 'name="visibilidade"')
loc = post("/feedback/novo", aidg, {"voltar": "/feedback/novo", "employeeId": COL_EMP, "formato": "ELOGIO", "assunto": "Feira de ciências do 7º ano", "texto": "A organização da feira de ciências foi impecável: os grupos apresentaram no tempo, as famílias receberam o roteiro com antecedência e os alunos com mais dificuldade tiveram papel de destaque. Obrigado pelo cuidado com cada detalhe.", "valores": ["Afetividade", "Criatividade"], "visibilidade": "GESTAO", "mural": "1", "acao": "enviar"}, GES); assert "enviado=" in loc, loc
h = page("/feedback/novo", P47); aid47 = aid_of(h, 'name="visibilidade"')
loc = post("/feedback/novo", aid47, {"voltar": "/feedback/novo", "employeeId": COL_EMP, "formato": "SCI", "assunto": "Atendimento à família do Pedro", "situacao": "No atendimento à mãe do Pedro (7º B), na sexta à tarde, com a coordenação presente.", "comportamento": "Você ouviu tudo sem interromper, mostrou as atividades dele e combinou um retorno por escrito em uma semana.", "impacto": "A família saiu tranquila e voltou a responder os comunicados; o Pedro entregou as duas atividades atrasadas.", "valores": ["Verdade", "Confiança"], "visibilidade": "GESTOR", "acao": "enviar"}, P47); assert "enviado=" in loc, loc
loc = post("/feedback/novo", aidg, {"voltar": "/feedback/novo", "employeeId": COL_EMP, "formato": "SUGESTAO", "assunto": "Recuperação paralela", "texto": "Para o 4º bimestre, sugiro montar a recuperação por habilidade (e não por nota): os alunos que erraram frações juntos, os de interpretação juntos. Testa com o 7º B e me conta como foi na próxima 1:1.", "courseId": 5, "visibilidade": "GESTAO", "acao": "enviar"}, GES); assert "enviado=" in loc, loc
ok(post("/feedback/novo", aidf, {"voltar": "/feedback/novo", "employeeId": 52, "formato": "SUGESTAO", "assunto": "Uso do laboratório", "texto": "Rascunho: pensar em como sugerir o agendamento do laboratório com mais antecedência…", "acao": "rascunho"}, COL), "Rascunho")
h = page("/feedback?aba=pedidos", COL); aidq = aid_of(h, 'name="assunto"')
ok(post("/feedback?aba=pedidos", aidq, {"para": [36, 47, 52], "assunto": "a condução da reunião de pais do 6º ano", "mensagem": "Queria saber o que funcionou e o que posso mudar na próxima.", "prazo": d(6)}, COL), "Pedido enviado")
pid36, pid47 = [int(rows(f"SELECT id FROM feedback_requests WHERE para_employee_id={e} AND solicitante_employee_id={COL_EMP} ORDER BY id DESC LIMIT 1")[0][0]) for e in (36, 47)]
h = page(f"/feedback/novo?pedido={pid36}", P36); loc = post("/feedback/novo", aid_of(h, 'name="visibilidade"'), {"voltar": f"/feedback/novo?pedido={pid36}", "pedidoId": pid36, "employeeId": COL_EMP, "formato": "SUGESTAO", "assunto": "a condução da reunião de pais do 6º ano", "texto": "Você abriu a reunião com os combinados do bimestre e isso deu segurança às famílias. Na próxima, deixe 10 minutos para perguntas no fim — algumas mães ficaram com dúvidas sobre a recuperação e não houve tempo.", "valores": ["Verdade"], "visibilidade": "PRIVADO", "acao": "enviar"}, P36); assert "enviado=" in loc, loc
h = page("/feedback?aba=pedidos", P47); ok(post("/feedback?aba=pedidos", aid_of(h, 'placeholder="Ex.: não acompanhei esse trabalho de perto"'), {"id": pid47, "motivo": "Não participei dessa reunião — posso dar feedback sobre o conselho de classe."}, P47), "recusado")
h = page("/feedback?aba=recebidos", COL); ok(post("/feedback?aba=recebidos", aid_of(h, "Agradecer</button>") if "Agradecer</button>" in h else aid_of(h, 'name="agradecer"'), {"id": int(rows(f"SELECT id FROM feedbacks WHERE employee_id={COL_EMP} AND formato='ELOGIO' ORDER BY id DESC LIMIT 1")[0][0]), "agradecer": "1"}, COL), "Registrado")
# um ano de histórico (contagens para os indicadores; conteúdo genérico de demonstração)
autores = [(u, e) for e, u in UID.items()]; todos = [int(x) for (x,) in rows("SELECT id FROM employees WHERE situacao IN ('ATIVO','FERIAS','AFASTADO')")]
TXT = {"LIVRE": "Obrigado pela parceria na semana de provas — a organização das salas fez diferença para os alunos.", "ELOGIO": "A apresentação do projeto para as famílias foi clara e acolhedora. Parabéns pelo cuidado.", "SUGESTAO": "Na próxima reunião, vale mandar a pauta antes para todos chegarem preparados.", "SCI": None}
n2 = 0
for i in range(150):
    u, e = R.choice(autores); para = R.choice(todos)
    if para == e: continue
    fmt = R.choices(["ELOGIO", "LIVRE", "SUGESTAO", "SCI"], [5, 3, 2, 2])[0]; dias = int(R.triangular(1, 360, 40)); vis = R.choices(["PRIVADO", "GESTOR", "GESTAO"], [6, 2, 2])[0]
    sci = fmt == "SCI"; psql(f"INSERT INTO feedbacks (employee_id, tipo, data, situacao, comportamento, impacto, autor_user_id, autor_nome, formato, assunto, texto, valores, status, visibilidade, autor_employee_id, enviado_em, ciencia_em, created_at) VALUES ({para}, {q('RECONHECIMENTO' if fmt == 'ELOGIO' else 'DESENVOLVIMENTO')}, {q(d(-dias))}, {q('Na reunião de área da semana passada.' if sci else None)}, {q('Você organizou a divisão das tarefas e cobrou os prazos com respeito.' if sci else None)}, {q('Fechamos o plano no prazo.' if sci else None)}, {u}, {q(NOME.get(e, 'Colega'))}, {q(fmt)}, {q(R.choice(['Semana de provas', 'Projeto de leitura', 'Reunião de pais', 'Atendimento às famílias', 'Conselho de classe', None]))}, {q(TXT[fmt])}, {j(R.sample(['Verdade', 'Afetividade', 'Motivação', 'Criatividade', 'Segurança', 'Aprendizagem', 'Confiança'], R.randint(0, 2)))}, 'ENVIADO', {q(vis)}, {e}, {q(d(-dias) + ' 15:00')}, {q(d(-dias + 1) + ' 09:00') if dias > 3 else 'NULL'}, {q(d(-dias) + ' 15:00')})"); n2 += 1
for e, para, ass, dias, st in [(36, 47, "a apresentação no conselho de classe", 20, "RESPONDIDO"), (52, 36, "o uso do laboratório de ciências", 12, "PENDENTE"), (57, 52, "a organização da feira cultural", 40, "RESPONDIDO"), (60, 58, "a comunicação com as famílias", 8, "PENDENTE")]:
    if e in UID and para in UID: psql(f"INSERT INTO feedback_requests (solicitante_user_id, solicitante_employee_id, solicitante_nome, para_user_id, para_employee_id, assunto, prazo, status, respondido_em, created_at) VALUES ({UID[e]}, {e}, {q(NOME[e])}, {UID[para]}, {para}, {q(ass)}, {q(d(-dias + 7))}, {q(st)}, {q(d(-dias + 3)) if st == 'RESPONDIDO' else 'NULL'}, {q(d(-dias))})")
print(f"   feedbacks pela interface (livre, elogio no mural, SCI, sugestão, rascunho, pedido respondido e recusado) + {n2} de histórico")

print("3) 360°: pares sugeridos, convidados, um incluído à mão e as respostas")
h = page("/desempenho/ciclos/4/participantes?sugerir=1", RH); aids = aid_of(h, 'name="par"'); pares = sorted(set(re.findall(r'name="par"[^>]*value="([0-9:A-Z]+)"', h)))
ok(post("/desempenho/ciclos/4/participantes", aids, {"cycleId": 4, "par": pares}, RH), "convite")
h = page("/desempenho/ciclos/4/participantes", GES); aidm = aid_of(h, 'placeholder="Ex.: dividem a coordenação do 6º ano"')
rv128 = int(rows(f"SELECT id FROM perf_reviews WHERE cycle_id=4 AND employee_id={COL_EMP}")[0][0]); ja = {int(x) for (x,) in rows(f"SELECT user_id FROM review_raters WHERE review_id={rv128}")}
extra = next(UID[e] for e in [70, 84, 94, 112, 122, 123, 60, 58] if e in UID and UID[e] not in ja)
ok(post("/desempenho/ciclos/4/participantes", aidm, {"cycleId": 4, "userId": extra, "reviewId": rv128, "grupo": "PAR", "motivo": "Dividem a coordenação do projeto de leitura do 7º ano"}, GES), "Par inclu")
crit = [c for c in json.loads(psql("SELECT criterios FROM perf_cycles WHERE id=4")) if c["eixo"] != "TECNICA"]
raters = rows("SELECT rr.id, rr.review_id, r.employee_id FROM review_raters rr JOIN perf_reviews r ON r.id=rr.review_id WHERE r.cycle_id=4 ORDER BY rr.id")
COMENT = ["Sempre disponível para trocar materiais e ideias.", "Poderia compartilhar mais o planejamento com a equipe.", "Muito cuidadosa com os alunos que têm mais dificuldade.", "Às vezes chega às reuniões sem o material combinado.", "Referência no atendimento às famílias.", "Ajuda os professores novos a se situarem."]
resp = 0; usados_por = {}
for rid, rev, emp in raters:
    emp = int(emp)
    if emp != COL_EMP and R.random() < 0.3: continue
    base = 3.1 if emp == COL_EMP else R.choice([3.0, 3.5, 4.0])
    notas = {c["id"]: ({"naoObservado": True} if R.random() < 0.08 else {"nota": max(1, min(5, round(R.gauss(base, 0.7))))}) for c in crit}
    usados = usados_por.setdefault(rev, set()); livres = [c for c in COMENT if c not in usados]; cm = R.choice(livres) if livres and R.random() < 0.6 else None
    if cm: usados.add(cm)
    psql(f"UPDATE review_raters SET status='RESPONDIDO', notas={j(notas)}, comentario={q(cm)}, respondido_em={q(d(-R.randint(1, 9)) + ' 17:00')} WHERE id={rid}"); resp += 1
for rev, emp in rows("SELECT id, employee_id FROM perf_reviews WHERE cycle_id=4 AND auto_criterios IS NULL ORDER BY id"):
    if R.random() < 0.55: continue
    notas = {c["id"]: {"nota": R.choice([3, 4, 4, 5]), "evidencia": None} for c in crit}; parc = R.random() < 0.3
    if parc: notas = dict(list(notas.items())[:R.randint(2, 5)])
    psql(f"UPDATE perf_reviews SET auto_criterios={j({'notas': notas, 'comentario': None, **({} if parc else {'em': d(-R.randint(2, 15)) + 'T12:00:00Z'})})} WHERE id={rev}")
for rev, in rows("SELECT id FROM perf_reviews WHERE cycle_id=4 AND estado='RASCUNHO' AND employee_id<>128 ORDER BY id LIMIT 4"):
    notas = {c["id"]: {"nota": R.choice([3, 4]), "evidencia": "Registro de acompanhamento do bimestre."} for c in crit[:R.randint(2, 6)]}; psql(f"UPDATE perf_reviews SET notas_criterios={j(notas)} WHERE id={rev}")
print(f"   {len(pares)} convites sugeridos + 1 à mão; {resp} respostas")

print("4) metas: propostas pelo colaborador, aprovação e devolução")
h = page(f"/colaboradores/{COL_EMP}/painel?aba=metas&ciclo=4", COL); aidmeta = aid_of(h, 'Regra de interpretação (obrigatória)')
for tit, ind, base, esp, regra in [("Devolutiva de 100% das atividades em até 7 dias", "% de atividades devolvidas no prazo", 70, 100, "Conta a data da devolutiva registrada no diário; atividades de recuperação entram."), ("Ler e aplicar 2 livros de didática da matemática", "livros lidos com aplicação registrada", 0, 2, "Conta só com a aplicação registrada no planejamento (evidência).")]:
    ok(post(f"/colaboradores/{COL_EMP}/painel", aidmeta, {"voltar": f"/colaboradores/{COL_EMP}/painel?aba=metas&ciclo=4", "employeeId": COL_EMP, "cycleId": 4, "titulo": tit, "tipo": "MELHORIA" if base else "APRENDIZAGEM", "direcao": "MAIOR_MELHOR", "indicador": ind, "unidadeMedida": "%" if base else "livros", "peso": 1, "linhaBase": base, "esperado": esp, "prazo": d(40), "regraInterpretacao": regra}, COL), "proposta")
m1, m2 = [int(x) for (x,) in rows(f"SELECT id FROM perf_goals WHERE employee_id={COL_EMP} AND aprovacao='PROPOSTA' ORDER BY id")]
h = page("/desempenho/metas?ciclo=4", GES); aidd = aid_of(h, 'name="motivo"')
ok(post("/desempenho/metas", aidd, {"id": m2, "decisao": "DEVOLVER", "voltar": "/desempenho/metas?ciclo=4#aprovacao", "motivo": "Boa ideia, mas 2 livros no bimestre é pouco tempo: proponha 1 livro com a aplicação em duas aulas observadas."}, GES), "devolvida")
# o cadastro da equipe: metas para mais pessoas (algumas propostas aguardando o gestor)
sem = [int(x) for (x,) in rows("SELECT r.employee_id FROM perf_reviews r WHERE r.cycle_id=4 AND NOT EXISTS (SELECT 1 FROM perf_goals g WHERE g.cycle_id=4 AND g.employee_id=r.employee_id) ORDER BY r.employee_id")]
METAS = [("Planejamento semanal entregue até sexta", "planejamentos no prazo (%)", 80, 100), ("Alunos em recuperação com plano registrado", "% de alunos com plano", 60, 100), ("Devolutiva das atividades em até 7 dias", "% no prazo", 75, 95), ("Participação nas formações de sábado", "formações com presença", 2, 4)]
for i, emp in enumerate(sem[:9]):
    for k in range(R.choice([1, 2])):
        t, ind, b, e2 = METAS[(i + k) % 4]; prop = i in (1, 4, 7) and k == 0
        psql(f"INSERT INTO perf_goals (cycle_id, employee_id, titulo, indicador, meta, peso, status, tipo, unidade_medida, linha_base, esperado, direcao, prazo, regra_interpretacao, aprovacao, proposta_por, aprovacao_por, aprovacao_em, created_at) VALUES (4, {emp}, {q(t)}, {q(ind)}, {q(str(e2))}, 1, 'EM_ANDAMENTO', 'OPERACIONAL', '%', {b}, {e2}, 'MAIOR_MELHOR', {q(d(45))}, 'Lido pelo registro no diário de classe.', {q('PROPOSTA' if prop else 'APROVADA')}, {UID.get(emp, 'NULL') if prop else 'NULL'}, {'NULL' if prop else GES_UID}, {'NULL' if prop else q(d(-20))}, {q(d(-R.randint(3, 12)))})")
print("   2 propostas pela interface (1 devolvida com comentário) + metas da equipe")

print("5) OKRs em desdobramento (rede → unidade → área)")
h = page("/estrategia/okrs", RH); aido = aid_of(h, "Criar objetivo</button>"); pilar = re.search(r'<select name="pilar"[^>]*>\s*<option[^>]*>([^<]+)</option>', h); pilar = pilar.group(1) if pilar else ""
def objetivo(titulo, desc, unit, pai, dono):
    pp = psql(f"SELECT coalesce(pilar, '') FROM objectives WHERE id={pai}") or pilar
    loc = post("/estrategia/okrs", aido, {"ciclo": "2027", "titulo": titulo, "descricao": desc, "pilar": pp, "unitId": unit or "", "ownerUserId": dono, "parentId": pai}, RH); m = re.search(r"/estrategia/okrs/(\d+)", loc); assert m, loc; return int(m.group(1))
def kr(oid, titulo, ini, meta, atual, metrica, dono):
    hh = page(f"/estrategia/okrs/{oid}", RH); post(f"/estrategia/okrs/{oid}", aid_of(hh, 'placeholder="Ex.: Inadimplência abaixo de 4%"'), {"objectiveId": oid, "titulo": titulo, "valorInicial": ini, "valorMeta": meta, "metrica": metrica, "direcao": "SUBIR", "ownerUserId": dono, "prazo": "2027-02-28"}, RH, False)
    psql(f"UPDATE key_results SET valor_atual={atual}, confianca={R.choice([2, 3])}, atualizado_em=now() WHERE objective_id={oid} AND titulo={q(titulo)}")
RHU = int(rows("SELECT id FROM users WHERE email='rh.teste'")[0][0]); DU = int(rows("SELECT id FROM users WHERE email='diretor.caranda'")[0][0]); FV = UID.get(133, RHU)
o11 = objetivo("Carandá cheia em 2027 com as famílias certas", "Desdobra o objetivo de matrículas da rede para a Carandá.", 1, 1, DU); kr(o11, "Ocupação das vagas de 2027 na Carandá", 0, 95, 81, "%", DU); kr(o11, "Rematrícula da Carandá", 0, 92, 88, "%", DU)
o12 = objetivo("TV Morena I: rematrícula de 92% por sala", "Cada sala com a meta de rematrícula e o plano das famílias em risco.", 2, 1, FV); kr(o12, "Rematrícula por sala (média)", 0, 92, 74, "%", FV)
o13 = objetivo("Cultura: abrir a 2ª turma do 6º ano", "Captação dirigida no entorno e indicação das famílias atuais.", 4, 1, RHU); kr(o13, "Matrículas no 6º ano para 2027", 0, 40, 22, "alunos", RHU)
o31 = objetivo("Carandá: equipe com PDI ativo e conversa em dia", "Desdobra “Uma equipe que fica e cresce” para a Carandá: desenvolvimento e acompanhamento de cada pessoa.", 1, 3, GES_UID); kr(o31, "Liderados com PDI ativo", 0, 80, 61, "%", GES_UID); kr(o31, "Liderados com 1:1 em dia", 0, 90, 64, "%", GES_UID)
o311 = objetivo("Fundamental II da Carandá: 1:1 quinzenal com todos os professores", "A coordenação conversa com cada professor a cada 15 dias e registra os combinados.", 1, o31, GES_UID); kr(o311, "Professores com 1:1 nos últimos 15 dias", 0, 100, 70, "%", GES_UID)
o41 = objetivo("Secretaria da Carandá: matrícula pelo POP em 100% dos casos", "Desdobra “Escola que roda por processo” para a secretaria da Carandá.", 1, 4, DU); kr(o41, "Matrículas conferidas no checklist do POP", 0, 100, 86, "%", DU)
psql(f"UPDATE perf_goals SET objective_id={o311}, key_result_id=NULL WHERE cycle_id=4 AND titulo LIKE 'Devolutiva%'")
psql(f"UPDATE perf_goals SET objective_id={o31}, key_result_id=NULL WHERE cycle_id=4 AND titulo LIKE 'Alunos em recuperação%' AND objective_id IS NULL")
psql(f"UPDATE perf_goals SET objective_id={o31} WHERE id={m1}")
print(f"   6 objetivos desdobrados (até 3 níveis) com resultados-chave; metas ligadas")

print("6) calibração: o retrato de antes nos ciclos encerrados")
JUST = ["Evidências do projeto de leitura não tinham sido consideradas pelo avaliador.", "Comitê alinhou a régua de ‘atende plenamente’ entre as unidades.", "Nota do gestor sem evidência no critério de resultados; ajustada pela média do ciclo.", "Desempenho alto, mas com metas coletivas — potencial revisto com a direção pedagógica.", "Comparação com os pares da mesma série: o avaliador foi mais rigoroso que os demais."]
rv2 = rows("SELECT id, desempenho_nivel, potencial, nota_final FROM perf_reviews WHERE cycle_id=2 AND desempenho_nivel IS NOT NULL AND potencial IS NOT NULL ORDER BY id")
R.shuffle(rv2); mv = 0
for i, (rid, nv, pt, nota) in enumerate(rv2[:14]):
    nv, pt = int(nv), int(pt)
    if i < 8: pnv, ppt = (max(1, nv - 1), pt) if i % 2 == 0 else (nv, max(1, pt - 1))   # subiu na calibração
    else: pnv, ppt = (min(3, nv + 1), pt) if i % 2 == 0 else (nv, min(3, pt + 1))         # desceu na calibração
    if (pnv, ppt) == (nv, pt): continue
    psql(f"UPDATE perf_reviews SET pre_calibracao={j({'nivel': pnv, 'potencial': ppt, 'nota': float(nota) if nota else None, 'por': 'Comitê de calibração 2025', 'em': '2025-12-05T14:00:00Z'})}, calibracao_nota={q(R.choice(JUST))}, status='CONCLUIDA' WHERE id={rid}")
    psql(f"INSERT INTO audit_log (at, user_id, user_nome, acao, entidade, entidade_id, antes, depois) VALUES ('2025-12-05 14:00', {RHU}, 'Comitê de calibração 2025', 'calibrar', 'perf_reviews', {rid}, {j({'desempenhoNivel': pnv, 'potencial': ppt})}, {j({'desempenhoNivel': nv, 'potencial': pt})})"); mv += 1
rv3 = rows("SELECT id, (calc->>'A')::float, (calc->>'R')::float, (calc->>'N') FROM perf_reviews WHERE cycle_id=3 AND pre_calibracao IS NULL AND calc->>'A' IS NOT NULL AND calc->>'R' IS NOT NULL ORDER BY id")
for i, (rid, a, r, n) in enumerate(rv3[:6]):
    a, r = float(a), float(r); da = -0.75 if i % 2 == 0 else 0.6; dr = 0.5 if i % 3 == 0 else -0.5
    psql(f"UPDATE perf_reviews SET pre_calibracao={j({'A': round(min(5, max(1, a + da)), 2), 'R': round(min(5, max(1, r + dr)), 2), 'N': None, 'por': 'Comitê de calibração 2026.1', 'em': '2026-07-02T14:00:00Z'})}, calibracao_justificativa=coalesce(calibracao_justificativa, {q(R.choice(JUST))}), calibrado_por=coalesce(calibrado_por, {RHU}) WHERE id={rid}"); mv += 1
print(f"   {mv} avaliações com o retrato de antes (subiram e desceram, com justificativa)")

print("7) PDI nas equipes (adesão, atraso, progresso) e uma necessidade encaminhada para PDI")
COMP = ["Gestão da sala de aula", "Devolutivas aos alunos", "Planejamento por habilidades", "Comunicação com as famílias", "Uso de dados de aprendizagem", "Avaliação formativa", "Organização e prazos", "Trabalho em equipe"]
ACOES = [("CURSO", "Concluir o treinamento da Academy sobre o tema"), ("OBSERVACAO", "Observar a aula de um colega de referência"), ("MENTORIA", "Encontros quinzenais com a coordenação"), ("PROJETO", "Aplicar a prática em uma turma e registrar o resultado"), ("LEITURA", "Ler e discutir um capítulo com a área")]
n7 = 0
for g_emp, frac_val, frac_prop in [(87, 0.55, 0.1), (133, 0.75, 0.05), (68, 0.85, 0.0), (131, 0.4, 0.1), (28, 0.3, 0.1), (22, 0.5, 0.1), (53, 0.5, 0.0)]:
    lids = [int(x) for (x,) in rows(f"SELECT id FROM employees e WHERE gestor_id={g_emp} AND situacao IN ('ATIVO','FERIAS','AFASTADO') AND NOT EXISTS (SELECT 1 FROM pdi_plans p WHERE p.employee_id=e.id) ORDER BY id")]
    R.shuffle(lids); a = int(len(lids) * frac_val); b = int(len(lids) * frac_prop); gu = UID.get(g_emp, RHU)
    for k, emp in enumerate(lids[:a + b]):
        prop = k >= a; comp = R.choice(COMP)
        pid = psql(f"INSERT INTO pdi_plans (employee_id, cycle_id, competencia, objetivo, situacao_inicial, meta, status, validado_por, validado_em, tipo, natureza, created_by, created_at) VALUES ({emp}, 4, {q(comp)}, {q('Desenvolver ' + comp.lower() + ' com prática registrada')}, 'Observado no acompanhamento do semestre.', 'Prática aplicada em sala com evidência', 'ATIVO', {'NULL' if prop else gu}, {'NULL' if prop else q(d(-R.randint(20, 80)))}, 'CRESCIMENTO', 'LACUNA', {gu}, {q(d(-R.randint(25, 90)))}) RETURNING id")
        for t, desc in R.sample(ACOES, R.randint(2, 4)):
            st = R.choices(["CONCLUIDA", "EM_ANDAMENTO", "NAO_INICIADA", "AGUARDANDO_VALIDACAO"], [4, 3, 2, 1])[0]; prazo = d(R.randint(-25, 50))
            psql(f"INSERT INTO pdi_actions (plan_id, tipo, descricao, responsavel_user_id, prazo, status, concluida_em, evidencia, created_at) VALUES ({pid}, {q(t)}, {q(desc)}, {gu}, {q(prazo)}, {q(st)}, {q(d(-R.randint(1, 20))) if st == 'CONCLUIDA' else 'NULL'}, {q('Registro da prática no planejamento.') if st in ('CONCLUIDA', 'AGUARDANDO_VALIDACAO') else 'NULL'}, {q(d(-30))})")
        n7 += 1
psql(f"INSERT INTO dev_needs (employee_id, unit_id, cycle_id, origem, descricao, hipotese, encaminhamento, acao, responsavel_user_id, prazo, status, created_by) VALUES ({COL_EMP}, 1, 4, 'FEEDBACK', 'Organizar a recuperação paralela por habilidade', 'ORIENTACAO', 'PDI', 'Montar o plano com a coordenação', {GES_UID}, {q(d(30))}, 'ABERTO', {GES_UID})")
print(f"   {n7} planos de desenvolvimento nas equipes")

# o que foi feito pela interface agora fica com horário comercial de ontem (as telas do manual não mostram madrugada)
ONT = d(-1)
psql(f"UPDATE feedbacks SET enviado_em = '{ONT} 18:10'::timestamp + (id % 17) * interval '7 minutes', created_at = '{ONT} 18:00'::timestamp + (id % 17) * interval '7 minutes', data = '{ONT}' WHERE created_at::date >= current_date - 1 AND created_at > now() - interval '3 hours'")
psql(f"UPDATE feedbacks SET ciencia_em = '{ONT} 21:40'::timestamp WHERE ciencia_em > now() - interval '3 hours'")
psql(f"UPDATE feedback_requests SET created_at = '{ONT} 17:30'::timestamp + (id % 5) * interval '3 minutes', respondido_em = CASE WHEN respondido_em IS NOT NULL THEN '{ONT} 20:15'::timestamp ELSE NULL END WHERE created_at > now() - interval '3 hours'")
psql(f"UPDATE one_on_ones SET created_at = '{ONT} 16:00'::timestamp + (id % 9) * interval '5 minutes', updated_at = '{ONT} 19:00'::timestamp WHERE created_at > now() - interval '3 hours'")
psql(f"UPDATE perf_goals SET created_at = '{ONT} 17:00'::timestamp + (id % 9) * interval '4 minutes' WHERE created_at > now() - interval '3 hours'")
psql("INSERT INTO settings (key, value) VALUES ('demo_v31', " + j({"em": datetime.now().isoformat()}) + ") ON CONFLICT (key) DO NOTHING")
print("Demonstração da v31 carregada.")
