"""Dados de DEMONSTRAÇÃO da v30 — NUNCA rode em produção. Tudo fictício (e-mails em .exemplo, nomes "(fictício)/(fictícia)").
Roda com o servidor no ar, na base de treinamento (a mesma da v29, já atualizada para a v30). O que faz — pela própria interface quando
é um fluxo do sistema, e por carga direta quando é histórico que levaria meses para existir:
  1. ficha completa: sexo (eSocial), ramal e e-mail institucional, CNPJ empregador, formação e qualificações (com 3 aguardando o RH),
     itens sob responsabilidade (chaves, notebooks, crachás) e o histórico funcional (promoções, transferências, mudanças de gestor);
  2. igualdade salarial: relatórios de transparência de 2026 registrados para o CNPJ com 100+ empregados;
  3. recrutamento: avaliadores com notas independentes, uma vaga pausada, publicação na página de vagas, propostas aceitas e
     recusadas (com motivo), a pesquisa de experiência do candidato e a satisfação do gestor aos 90 dias;
  4. desempenho: pesquisa de liderança (cada pessoa avalia o gestor direto, anônima), Nine Box com pessoas e metas ligadas aos OKRs;
  5. Academy: custo das turmas, treinamentos com inscrição aberta (um com aprovação do gestor), avaliações de reação e certificados;
  6. benefícios: catálogo com regras, adesões (dependentes, VT com desconto de até 6%, bolsa de estudos para filhos) e o recálculo;
  7. relatórios sob medida salvos e compartilhados.
Uso: python3 scripts/demo_v30.py   (servidor local em http://localhost:3100, banco local via psql)."""
import os, re, subprocess, random, requests
from datetime import date, datetime, timedelta
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
HOJE = datetime.now(ZoneInfo("America/Campo_Grande")).date(); d = lambda n: (HOJE + timedelta(days=n)).isoformat()
R = random.Random(30)
if psql("SELECT 1 FROM settings WHERE key='demo_v30'"): raise SystemExit("A demonstração da v30 já foi carregada nesta base.")

RH = login("rh.teste", "Homolog2026!"); DIR = login("direcao.teste", "Homolog2026!"); GES = login("gestor.caranda", "Homolog2026!"); COL = login("colaborador.caranda", "Homolog2026!"); OPS = login("operacoes.teste", "Homolog2026!")
pos = {n: int(i) for i, n in rows("SELECT id, nome FROM positions")}
emps = [dict(zip(["id", "nome", "unit", "pos", "fam", "vinculo", "situacao", "admissao", "gestor", "company", "salario"], r)) for r in rows("SELECT e.id, e.nome, e.unit_id, coalesce(e.position_id,0), coalesce(p.familia,''), e.vinculo, e.situacao, e.admissao, coalesce(e.gestor_id,0), coalesce(e.company_id,0), coalesce(e.salario,0) FROM employees e LEFT JOIN positions p ON p.id=e.position_id ORDER BY e.id")]
for e in emps:
    for k in ["id", "unit", "pos", "gestor", "company"]: e[k] = int(e[k])
    e["salario"] = float(e["salario"])
ativos = [e for e in emps if e["situacao"] != "DESLIGADO"]
UN = {int(i): c for i, c in rows("SELECT id, codigo FROM units")}

print("1) ficha completa: sexo, ramal, e-mail institucional e CNPJ")
sql = []
for e in emps:
    lider = e["fam"] in ("GESTAO", "COORDENACAO")
    pf = 0.78 if e["fam"] in ("PROFESSORES",) else 0.55 if lider else 0.5 if e["fam"] == "APOIO_OPERACIONAL" else 0.7
    if "(fictícia)" in e["nome"] or "Teste" in e["nome"] and "Cultura" in e["nome"]: sexo = "F"
    elif "(fictício)" in e["nome"]: sexo = "M"
    else: sexo = "F" if R.random() < pf else "M"
    if R.random() < 0.04: sexo = None
    base = re.sub(r"[^a-z0-9]+", ".", e["nome"].lower().replace("(fictícia)", "").replace("(fictício)", "").translate(str.maketrans("áàâãéêíóôõúç", "aaaaeeiooouc"))).strip(".")
    ramal = f"{e['unit']}{(e['id'] * 7) % 100:02d}" if e["fam"] not in ("APOIO_OPERACIONAL",) or R.random() < 0.3 else None
    comp = e["company"] or 1
    sql.append(f"UPDATE employees SET sexo={q(sexo)}, ramal={q(ramal)}, email_institucional={q(base + '@colegiostatus.exemplo')}, company_id={comp} WHERE id={e['id']}")
psql(";\n".join(sql))
psql("UPDATE employees SET salario=4180 WHERE id=128 AND salario IS NULL")  # colaborador de teste: salário fictício para a remuneração total
# a escola mais nova recebe o CNPJ próprio; a maior parte fica no CNPJ principal (100+ empregados → relatório de transparência obrigatório)
print("   ", psql("SELECT string_agg(c.nome || ': ' || n, ' · ') FROM (SELECT company_id, count(*) n FROM employees WHERE situacao <> 'DESLIGADO' GROUP BY 1) x JOIN companies c ON c.id=x.company_id"))

print("2) formação e qualificações (titulação docente)")
cursos_lic = ["Pedagogia", "Letras — Português", "Letras — Inglês", "Matemática", "História", "Geografia", "Ciências Biológicas", "Educação Física", "Química", "Física", "Artes Visuais"]
inst = ["Universidade Federal (fictícia)", "Universidade Católica (fictícia)", "Centro Universitário (fictício)", "Faculdade de Educação (fictícia)"]
sql = []
for e in ativos:
    ano = R.randint(1998, 2019)
    if e["fam"] == "PROFESSORES":
        if R.random() < 0.86: sql.append(f"INSERT INTO employee_qualifications (employee_id, tipo, curso, instituicao, conclusao, status, criado_por) VALUES ({e['id']}, 'LICENCIATURA', {q(R.choice(cursos_lic))}, {q(R.choice(inst))}, '{ano}-12-15', 'VALIDADA', 1)")
        else: sql.append(f"INSERT INTO employee_qualifications (employee_id, tipo, curso, instituicao, conclusao, status, criado_por) VALUES ({e['id']}, 'BACHARELADO', {q(R.choice(['Administração', 'Engenharia Civil', 'Psicologia', 'Comunicação Social']))}, {q(R.choice(inst))}, '{ano}-12-15', 'VALIDADA', 1)")
        if R.random() < 0.55: sql.append(f"INSERT INTO employee_qualifications (employee_id, tipo, curso, instituicao, conclusao, carga_horas, status, criado_por) VALUES ({e['id']}, 'ESPECIALIZACAO', {q(R.choice(['Psicopedagogia', 'Alfabetização e Letramento', 'Educação Especial e Inclusiva', 'Metodologias Ativas', 'Neuroeducação']))}, {q(R.choice(inst))}, '{min(ano + R.randint(2, 6), 2025)}-07-10', 360, 'VALIDADA', 1)")
        if R.random() < 0.08: sql.append(f"INSERT INTO employee_qualifications (employee_id, tipo, curso, instituicao, conclusao, status, criado_por) VALUES ({e['id']}, 'MESTRADO', 'Mestrado em Educação', {q(R.choice(inst))}, '{min(ano + 7, 2025)}-03-20', 'VALIDADA', 1)")
    elif e["fam"] in ("COORDENACAO", "GESTAO"):
        tq, cq = R.choice([('LICENCIATURA', 'Pedagogia'), ('LICENCIATURA', 'Letras — Português'), ('BACHARELADO', 'Administração'), ('BACHARELADO', 'Psicologia')])
        sql.append(f"INSERT INTO employee_qualifications (employee_id, tipo, curso, instituicao, conclusao, status, criado_por) VALUES ({e['id']}, {q(tq)}, {q(cq)}, {q(R.choice(inst))}, '{ano}-12-15', 'VALIDADA', 1)")
        tq2, cq2 = R.choice([('ESPECIALIZACAO', 'Gestão Escolar'), ('ESPECIALIZACAO', 'Gestão de Pessoas'), ('MBA', 'MBA em Gestão Educacional'), ('MESTRADO', 'Mestrado em Educação')])
        sql.append(f"INSERT INTO employee_qualifications (employee_id, tipo, curso, instituicao, conclusao, status, criado_por) VALUES ({e['id']}, {q(tq2)}, {q(cq2)}, {q(R.choice(inst))}, '{min(ano + 5, 2024)}-06-30', 'VALIDADA', 1)")
    elif e["fam"] in ("ATENDIMENTO_COMERCIAL", "SECRETARIA"):
        sql.append(f"INSERT INTO employee_qualifications (employee_id, tipo, curso, instituicao, conclusao, status, criado_por) VALUES ({e['id']}, {q((par := R.choice([('BACHARELADO', 'Administração'), ('TECNOLOGO', 'Gestão Comercial'), ('BACHARELADO', 'Marketing'), ('ENSINO_MEDIO', 'Ensino médio')]))[0])}, {q(par[1])}, {q(R.choice(inst))}, '{ano}-12-15', 'VALIDADA', 1)")
    else:
        sql.append(f"INSERT INTO employee_qualifications (employee_id, tipo, curso, instituicao, conclusao, status, criado_por) VALUES ({e['id']}, {q((par := R.choice([('ENSINO_MEDIO', 'Ensino médio'), ('TECNICO', 'Técnico em Edificações'), ('TECNICO', 'Técnico em Nutrição'), ('ENSINO_MEDIO', 'Ensino médio')]))[0])}, {q(par[1])}, NULL, '{ano}-12-15', 'VALIDADA', 1)")
    if e["fam"] in ("PROFESSORES", "COORDENACAO") and R.random() < 0.12: sql.append(f"INSERT INTO employee_qualifications (employee_id, tipo, curso, instituicao, status, em_andamento, criado_por) VALUES ({e['id']}, 'MESTRADO', 'Mestrado em Educação (em andamento)', {q(R.choice(inst))}, 'VALIDADA', true, 1)")
    if R.random() < 0.18: sql.append(f"INSERT INTO employee_qualifications (employee_id, tipo, curso, instituicao, conclusao, carga_horas, status, criado_por) VALUES ({e['id']}, {q((par := R.choice([('IDIOMA', 'Inglês — nível avançado'), ('CURSO_LIVRE', 'Primeiros socorros (Cruz Vermelha)'), ('CERTIFICACAO', 'Google for Education'), ('CURSO_LIVRE', 'Libras básico')]))[0])}, {q(par[1])}, NULL, '{R.randint(2019, 2025)}-{R.randint(1, 12):02d}-10', {R.choice([20, 40, 60, 120])}, 'VALIDADA', 1)")
psql(";\n".join(sql))
# três propostas do próprio colaborador aguardando o RH (uma pela interface, pelo Meu espaço)
h = page("/eu", COL); ok(post("/eu", aid_of(h, 'name="curso"'), {"employeeId": 128, "voltar": "/eu#formacao", "tipo": "ESPECIALIZACAO", "curso": "Alfabetização e Letramento", "instituicao": "Faculdade de Educação (fictícia)", "area": "Educação infantil", "conclusao": "2026-07-30", "cargaHoras": "420"}, COL))
pend = [e for e in ativos if e["fam"] == "PROFESSORES" and e["id"] not in (128,)][:2]
for e, (t, c) in zip(pend, [("ESPECIALIZACAO", "Educação Especial e Inclusiva"), ("CERTIFICACAO", "Libras — intermediário")]):
    psql(f"INSERT INTO employee_qualifications (employee_id, tipo, curso, instituicao, conclusao, carga_horas, status, criado_por, created_at) VALUES ({e['id']}, '{t}', {q(c)}, 'Centro Universitário (fictício)', '{d(-40)}', 180, 'PENDENTE', NULL, now() - interval '{R.randint(2, 9)} days')")
print("   ", psql("SELECT count(*) || ' registro(s) · ' || count(*) FILTER (WHERE status='PENDENTE') || ' aguardando o RH' FROM employee_qualifications"))

print("3) itens sob responsabilidade")
tipos_item = [("CHAVE", "Chave da sala {n}"), ("NOTEBOOK", "Notebook Dell Latitude"), ("CRACHA", "Crachá de acesso"), ("UNIFORME", "Kit uniforme (3 camisetas)"), ("CHAVE", "Chave do laboratório"), ("TABLET", "Tablet para chamada")]
sql = []
for i, e in enumerate([x for x in ativos if x["situacao"] == "ATIVO"][:60:3]):
    t, desc = tipos_item[i % len(tipos_item)]; desc = desc.format(n=R.randint(1, 24)); ent = d(-R.randint(20, 420))
    ciencia = "now() - interval '%d days'" % R.randint(1, 15) if R.random() < 0.75 else "NULL"
    devolver = q(d(-R.randint(3, 20))) if i == 4 else q(d(R.randint(30, 120))) if t in ("NOTEBOOK", "TABLET") else "NULL"
    sql.append(f"INSERT INTO employee_items (employee_id, tipo, descricao, identificacao, valor, entregue_em, entregue_por, ciencia_em, devolver_ate) VALUES ({e['id']}, '{t}', {q(desc)}, {q('SN-' + str(1000 + i * 37) if t in ('NOTEBOOK', 'TABLET') else None)}, {q(3500 if t == 'NOTEBOOK' else 1200 if t == 'TABLET' else None)}, '{ent}', 12, {ciencia}, {devolver})")
psql(";\n".join(sql))
# devolvidos (histórico) e dois pela tela de Operações
psql(f"UPDATE employee_items SET status='DEVOLVIDO', devolvido_em='{d(-30)}', recebido_por=12, condicao='Em bom estado' WHERE id IN (SELECT id FROM employee_items ORDER BY id LIMIT 2)")
h = page("/operacoes/itens", OPS)
alvo = next(e for e in ativos if e["unit"] == 1 and e["fam"] == "PROFESSORES" and e["id"] != 128)
ok(post("/operacoes/itens", aid_of(h, "Registrar entrega</button>"), {"voltar": "/operacoes/itens", "employeeId": alvo["id"], "tipo": "CHAVE", "entregueEm": d(-2), "descricao": "Chave do armário da sala 7", "identificacao": "", "valor": "", "assetId": "", "devolverAte": "", "obs": ""}, OPS))
ok(post("/operacoes/itens", aid_of(h, "Registrar entrega</button>"), {"voltar": "/operacoes/itens", "employeeId": 128, "tipo": "NOTEBOOK", "entregueEm": d(-1), "descricao": "Notebook para o laboratório de informática", "identificacao": "SN-2210", "valor": "3800", "assetId": "", "devolverAte": d(60), "obs": "Uso em sala"}, OPS))
print("   ", psql("SELECT count(*) || ' item(ns) com colaboradores · ' || count(*) FILTER (WHERE ciencia_em IS NULL) || ' sem ciência' FROM employee_items WHERE status='COM_COLABORADOR'"))

print("4) histórico funcional (promoções, transferências e gestor)")
prof = pos["Professor"]; coord = pos["Coordenador Pedagógico"]
promovidos = [e for e in ativos if e["pos"] == coord][:4]
for i, e in enumerate(promovidos):
    data = d(-R.randint(120, 520))
    if data < e["admissao"]: data = (date.fromisoformat(e["admissao"]) + timedelta(days=200)).isoformat()
    if data > d(-30): continue
    psql(f"INSERT INTO employee_moves (employee_id, data, tipo, motivo, de, para, origem, user_nome) VALUES ({e['id']}, '{data}', 'PROMOCAO', 'Promoção para a coordenação', {q('{\"positionId\": %d}' % prof)}::jsonb, {q('{\"positionId\": %d}' % coord)}::jsonb, 'FICHA', 'RH Teste')")
    if e["salario"]: psql(f"INSERT INTO salary_history (employee_id, data, salario_anterior, salario, motivo, obs) VALUES ({e['id']}, '{data}', {round(e['salario'] * 0.82, 2)}, {e['salario']}, 'PROMOCAO', 'Promoção para Coordenador Pedagógico')")
outros_prof = [e for e in ativos if e["pos"] == prof and e["situacao"] == "ATIVO"]
for e in R.sample(outros_prof, 3):
    de = R.choice([u for u in UN if u != e["unit"]]); data = d(-R.randint(60, 300))
    if data <= e["admissao"]: continue
    psql(f"INSERT INTO employee_moves (employee_id, data, tipo, motivo, de, para, origem, user_nome) VALUES ({e['id']}, '{data}', 'TRANSFERENCIA', 'Remanejamento de turmas 2026', {q('{\"unitId\": %d}' % de)}::jsonb, {q('{\"unitId\": %d}' % e['unit'])}::jsonb, 'FICHA', 'RH Teste')")
for e in R.sample([x for x in outros_prof if x["gestor"]], 2):
    data = d(-R.randint(40, 200))
    if data <= e["admissao"]: continue
    psql(f"INSERT INTO employee_moves (employee_id, data, tipo, motivo, de, para, origem, user_nome) VALUES ({e['id']}, '{data}', 'MUDANCA_GESTOR', 'Nova coordenação do segmento', {q('{\"gestorId\": %d}' % 22)}::jsonb, {q('{\"gestorId\": %d}' % e['gestor'])}::jsonb, 'FICHA', 'RH Teste')")
# um lançamento manual pela ficha (afastamento longo já encerrado não é movimentação; aqui: mudança de jornada combinada)
alvo_j = next(e for e in ativos if e["fam"] == "APOIO_OPERACIONAL" and e["situacao"] == "ATIVO" and e["admissao"] < d(-200))
h = page(f"/colaboradores/{alvo_j['id']}", RH)
ok(post(f"/colaboradores/{alvo_j['id']}", aid_of(h, "Para fatos de antes do sistema"), {"employeeId": alvo_j["id"], "tipo": "MUDANCA_JORNADA", "data": d(-75), "descricao": "Jornada de 6 h para 8 h (turno integral)", "motivo": "Ampliação do integral", "obs": ""}, RH))
# a coordenadora da TV Morena I (fictícia): um fato de antes do sistema, lançado pela ficha (a promoção veio do histórico salarial)
h = page("/colaboradores/133", RH)
ok(post("/colaboradores/133", aid_of(h, "Para fatos de antes do sistema"), {"employeeId": 133, "tipo": "MUDANCA_JORNADA", "data": "2026-02-02", "descricao": "20 h → 40 h semanais (manhã e tarde)", "motivo": "Ampliação da carga horária na grade de 2026", "obs": ""}, RH))
print("   ", psql("SELECT string_agg(tipo || ' ' || n, ' · ') FROM (SELECT tipo, count(*) n FROM employee_moves GROUP BY 1 ORDER BY 1) x"))

print("5) igualdade salarial: relatórios de transparência (CNPJ com 100+ empregados)")
h = page("/analytics/igualdade", RH)
for sem, pub in [(1, "2026-03-25"), (2, "2026-09-26")]:
    ok(post("/analytics/igualdade", aid_of(h, 'name="semestre"'), {"companyId": 1, "ano": 2026, "semestre": sem, "publicadoEm": pub, "onde": "Site da escola e mural dos funcionários", "link": "", "diferencaPct": "3.8" if sem == 1 else "2.9", "planoAcao": "Revisão das faixas de Coordenação e dos critérios de promoção; acompanhamento semestral com a Direção.", "planoPrazo": "2026-12-31", "obs": "Relatório do Ministério do Trabalho baixado no Portal Emprega Brasil (dados fictícios de demonstração)."}, RH), "Relatório registrado")

print("6) recrutamento: avaliadores, pausa, publicação, propostas, experiência e satisfação do gestor")
# etapa desde (para o quadro de candidatos)
psql("UPDATE applications SET etapa_desde=created_at WHERE etapa_desde IS NULL AND etapa NOT IN ('REPROVADO','DESISTIU','CONTRATADO')")
psql(f"UPDATE applications SET etapa_desde='{d(-38)} 10:00' WHERE id=2; UPDATE applications SET etapa_desde='{d(-20)} 09:00' WHERE id=3; UPDATE applications SET etapa_desde='{d(-14)} 15:00' WHERE id=6; UPDATE applications SET etapa_desde='{d(-6)} 11:00', proposta_enviada_em='{d(-6)} 11:00' WHERE id=4")
# propostas do histórico: contratados aceitaram; duas desistências recusaram a proposta (com motivo)
psql("UPDATE applications a SET proposta_enviada_em=(e.admissao - 21)::timestamp + interval '10 hours', proposta_resposta='ACEITA', proposta_resposta_em=(e.admissao - 18)::timestamp + interval '16 hours' FROM employees e WHERE e.id=a.employee_id AND a.etapa='CONTRATADO'")
recusas = rows("SELECT a.id, r.aberta_em FROM applications a JOIN requisitions r ON r.id=a.requisition_id WHERE a.etapa='DESISTIU' ORDER BY r.aberta_em DESC, a.id LIMIT 3")  # as mais recentes: aparecem nos indicadores de 12 meses
for (aid_, ab), mot in zip(recusas, ["Salário ou benefícios", "Aceitou outra proposta", "Horário ou jornada"]):
    psql(f"UPDATE applications SET proposta_enviada_em='{ab}'::date + 25, proposta_resposta='RECUSADA', proposta_resposta_em='{ab}'::date + 28, proposta_motivo={q(mot)} WHERE id={aid_}")
# avaliadores com notas independentes (vaga 14 · TV Morena II)
h = page("/recrutamento/vagas/14", RH); conv = aid_of(h, 'name="avaliadores"')
uid = {e: int(psql(f"SELECT id FROM users WHERE email='{e}'")) for e in ["rh.teste", "direcao.teste", "rh@colegiostatus"]}
ok(post("/recrutamento/vagas/14", conv, {"applicationId": 9, "etapa": "", "prazo": d(2), "avaliadores": [uid["rh.teste"], uid["direcao.teste"]]}, RH))
ok(post("/recrutamento/vagas/14", conv, {"applicationId": 52, "etapa": "", "prazo": d(-1), "avaliadores": [uid["rh.teste"], uid["rh@colegiostatus"]]}, RH))
ok(post("/recrutamento/vagas/14", conv, {"applicationId": 6, "etapa": "", "prazo": d(1), "avaliadores": [uid["direcao.teste"], uid["rh.teste"]]}, RH))
fb = {(int(a), int(u)): int(i) for i, a, u in rows("SELECT id, application_id, avaliador_user_id FROM interview_feedback")}
def avaliar(sess, fid, notas, rec, fortes, atencao):
    h = page(f"/recrutamento/avaliar/{fid}", sess); data = {"id": fid, "recomendacao": rec, "pontosFortes": fortes, "pontosAtencao": atencao}
    for i, n in enumerate(notas): data[f"sc_{i}"] = n
    ok(post(f"/recrutamento/avaliar/{fid}", aid_of(h, 'name="recomendacao"'), data, sess))
avaliar(RH, fb[(9, uid["rh.teste"])], [5, 4, 5, 4, 5], "SIM", "Boa didática na aula-teste; domínio do conteúdo do 6º ano.", "Pouca experiência com turmas grandes.")
avaliar(DIR, fb[(9, uid["direcao.teste"])], [4, 4, 5, 5, 4], "FORTE_SIM", "Postura alinhada aos valores; comunicação clara com famílias.", "")
avaliar(RH, fb[(52, uid["rh.teste"])], [4, 3, 4, 4, 3], "SIM", "Formação sólida em Letras — Inglês.", "Disponibilidade só no matutino.")
avaliar(DIR, fb[(6, uid["direcao.teste"])], [5, 5, 4, 5, 5], "FORTE_SIM", "Experiência com Cambridge; liderança de projeto bilíngue.", "")
avaliar(RH, fb[(6, uid["rh.teste"])], [3, 4, 2, 3, 3], "NAO", "Experiência relevante.", "Pouca aderência ao jeito Status de acolher as famílias (diverge da Direção).")
psql(f"UPDATE interview_feedback SET convidado_em=now() - interval '6 days' WHERE application_id=52")
# vaga pausada (Psicóloga · TV Morena I) e publicação na página de vagas
h = page("/recrutamento/vagas/16", RH); ok(post("/recrutamento/vagas/16", aid_of(h, "Pausada, a vaga sai da página de vagas"), {"id": 16, "motivo": "Revisão do perfil com a coordenação pedagógica (inclusão)"}, RH))
psql(f"UPDATE requisitions SET pausada_em='{d(-8)}' WHERE id=16")
for rid, desc in [(9, "Professor(a) de Educação Infantil para turmas de 4 e 5 anos no período vespertino. Licenciatura em Pedagogia, experiência com rotina e projetos na Educação Infantil e boa comunicação com as famílias. Jornada de 30 h semanais na unidade TV Morena I."),
                  (17, "Professor(a) de Inglês para o Ensino Fundamental II (6º ao 9º ano). Licenciatura em Letras — Inglês, nível avançado comprovado e vivência com metodologias ativas. Jornada de 24 h semanais, com projetos bilíngues na unidade TV Morena I.")]:
    h = page(f"/recrutamento/vagas/{rid}", RH); ok(post(f"/recrutamento/vagas/{rid}", aid_of(h, 'name="descricaoPublica"'), {"id": rid, "descricaoPublica": desc, "publicar": "1"}, RH))
# (a página pública fica desligada até o GO: as vagas publicadas começam sem visualizações)
# pesquisa de experiência do candidato (anônima, só com o processo encerrado)
exp = [("CONTRATADO", 5, 5, 5, 10, "Processo claro e rápido; recebi retorno em todas as etapas."), ("CONTRATADO", 5, 4, 5, 9, None), ("REPROVADO", 4, 4, 5, 8, "Mesmo sem ser aprovada, recebi retorno com cuidado."),
       ("REPROVADO", 3, 2, 4, 6, "Demorou para eu saber o resultado da entrevista."), ("REPROVADO", 4, 3, 5, 7, None), ("CONTRATADO", 5, 5, 5, 10, None), ("REPROVADO", 2, 2, 3, 4, "Ninguém me avisou que a vaga tinha sido preenchida."),
       ("CONTRATADO", 4, 4, 5, 9, "Gostei da aula-teste com devolutiva."), ("REPROVADO", 4, 4, 4, 8, None)]
for i, (des, p_, c_, r_, rec, com) in enumerate(exp):
    psql(f"INSERT INTO candidate_experience (unit_id, desfecho, nota_processo, nota_clareza, nota_respeito, recomendaria, comentario, created_at) VALUES ({R.choice([2, 3, 4])}, '{des}', {p_}, {c_}, {r_}, {rec}, {q(com)}, date_trunc('week', now() - interval '{12 + i * 17} days'))")
psql("UPDATE applications SET experiencia_em=now() - interval '20 days' WHERE id IN (SELECT id FROM applications WHERE etapa IN ('CONTRATADO','REPROVADO') ORDER BY id LIMIT 9)")
# satisfação do gestor aos 90 dias: login da coordenadora da TV Morena I (fictícia) e as respostas dos gestores
psql(f"UPDATE employees SET admissao='{d(-93)}' WHERE id=140")  # a contratação mais recente completa 90 dias (pendência da gestora)
def novo_acesso(emp, nome, email):
    u = psql(f"SELECT id FROM users WHERE employee_id={emp}")
    if u: return int(u)
    h = page("/configuracoes", RH)
    ok(post("/configuracoes", aid_of(h, "Criar acesso"), {"modo": "auto", "employeeId": emp, "nome": nome, "email": email, "atuacao": "LEITURA", "unitId": "", "senha": "senha12345"}, RH), "Acesso salvo")
    return int(psql(f"SELECT id FROM users WHERE employee_id={emp}"))
UF = novo_acesso(133, "Fernanda Rocha Vidal (fictícia)", "fernanda.vidal@exemplo.com"); FER = login("fernanda.vidal@exemplo.com", "senha12345")
hf = [(14, 133, 5, True, "Excelente com a turma do 1º ano; famílias elogiam."), (33, 133, 4, True, None), (10, None, 5, True, "Coordenação firme e acolhedora."), (25, None, 4, True, None), (49, None, 3, True, "Precisa de apoio com a rotina da cozinha."), (22, None, 4, True, None), (21, None, 3, False, "Pontualidade abaixo do esperado no 1º trimestre."), (42, None, 4, True, None), (46, None, 3, True, "Bom técnico; precisou de apoio na manutenção preventiva.")]
for app, gest, nota, contr, com in hf:
    if gest == 133:
        h = page(f"/recrutamento/contratacao/{app}", FER); ok(post(f"/recrutamento/contratacao/{app}", aid_of(h, 'name="nota"'), {"applicationId": app, "nota": nota, "contrataria": "1" if contr else "0", "comentario": com or ""}, FER))
    else:
        psql(f"INSERT INTO hire_feedback (employee_id, application_id, requisition_id, gestor_user_id, nota, contrataria, comentario, respondido_em) SELECT a.employee_id, a.id, a.requisition_id, {uid['rh.teste']}, {nota}, {str(contr).lower()}, {q(com)}, e.admissao + 95 FROM applications a JOIN employees e ON e.id=a.employee_id WHERE a.id={app} ON CONFLICT (employee_id) DO NOTHING")

print("7) pesquisa de liderança (cada pessoa avalia o gestor direto — anônima)")
h = page("/clima", RH); loc = ok(post("/clima", aid_of(h, 'name="perguntas"'), {"nome": "Liderança 2026 · 2º semestre", "tipo": "LIDERANCA", "unitId": "", "inicio": d(-24), "fim": d(-10), "perguntas": "", "minimoAnonimato": "5"}, RH))
sid = int(re.search(r"/clima/(\d+)", loc).group(1)); tok = psql(f"SELECT token FROM climate_surveys WHERE id={sid}")
h = page(f"/clima/{sid}", RH); ok(post(f"/clima/{sid}", aid_of(h, 'value="ABERTA"'), {"id": sid, "status": "ABERTA"}, RH))
perfil = {87: [0.86, 0.80, 0.78, 0.84, 0.70, 0.82, 0.90], 133: [0.75, 0.45, 0.40, 0.70, 0.66, 0.62, 0.80], 131: [0.80, 0.72, 0.66, 0.76, 0.58, 0.74, 0.86], 28: [0.7] * 7}
qtd = {87: 9, 133: 8, 131: 6, 28: 2}
coment = {87: ["Continuar com as reuniões curtas de segunda.", "Começar a dar retorno das observações de aula mais rápido."], 133: ["Precisamos de mais feedback individual — só ouço quando algo dá errado.", "Reconhecer quem cobre as faltas dos colegas.", "Parar de mudar a escala sem avisar."], 131: ["Gosto da abertura para sugerir projetos."], 28: []}
gunit = {87: 1, 133: 2, 131: 3, 28: 4}
for g, n in qtd.items():
    for k in range(n):
        s = mk(); hp = page(f"/pesquisa/{tok}", s); data = {"token": tok, "gestorId": g, "unitId": gunit[g], "regime": ""}
        for i, p in enumerate(perfil[g]):
            fav = R.random() < p; data[f"l{i + 1}"] = R.choice([4, 5]) if fav else R.choice([2, 3, 3, 1])
        data["enps"] = R.choice([9, 10, 10, 8]) if R.random() < sum(perfil[g]) / 7 else R.choice([5, 6, 7])
        data["aberta"] = coment[g][k] if k < len(coment[g]) else ""
        post(f"/pesquisa/{tok}", aid_of(hp, 'name="gestorId"'), data, s, False)
h = page(f"/clima/{sid}", RH); ok(post(f"/clima/{sid}", aid_of(h, 'value="ENCERRADA"'), {"id": sid, "status": "ENCERRADA"}, RH))
print("   ", psql(f"SELECT count(*) || ' respostas · ' || count(DISTINCT gestor_id) || ' gestores avaliados' FROM climate_responses WHERE survey_id={sid}"))

print("8) Nine Box com pessoas e metas ligadas aos OKRs")
# quem avaliou no ciclo 2025: o gestor direto (com login); sem login, a direção da unidade (Carandá) ou a Direção — e a direção da
# unidade é mais rigorosa que a média (o exemplo da conversa de calibração; as notas abaixo e o nível de desempenho saem daí)
psql("""UPDATE perf_reviews r SET avaliador_user_id = coalesce((SELECT u.id FROM users u WHERE u.employee_id=e.gestor_id AND u.ativo ORDER BY u.id LIMIT 1),
  CASE WHEN e.unit_id=1 THEN (SELECT id FROM users WHERE email='du@caranda') ELSE (SELECT id FROM users WHERE email='direcao.teste') END)
  FROM employees e WHERE e.id=r.employee_id AND r.cycle_id=2 AND r.avaliador_user_id IS NULL""")
psql("UPDATE perf_reviews SET nota_final=greatest(1, nota_final - 0.35) WHERE cycle_id=2 AND avaliador_user_id=(SELECT id FROM users WHERE email='du@caranda') AND nota_final IS NOT NULL")
psql("UPDATE perf_reviews SET desempenho_nivel=CASE WHEN nota_final >= 4.2 THEN 3 WHEN nota_final >= 3.2 THEN 2 ELSE 1 END WHERE cycle_id=2 AND nota_final IS NOT NULL AND desempenho_nivel IS NULL")
for rid, in rows("SELECT id FROM perf_reviews WHERE cycle_id=2 AND potencial IS NULL ORDER BY id"):
    psql(f"UPDATE perf_reviews SET potencial={R.choices([1, 2, 3], [0.25, 0.5, 0.25])[0]} WHERE id={rid}")
metas = [int(x[0]) for x in rows("SELECT id FROM perf_goals ORDER BY id")]
for i, m in enumerate(metas):
    if i < 3: psql(f"UPDATE perf_goals SET objective_id=3, key_result_id={6 + i}, atualizada_em=now() - interval '{R.randint(2, 20)} days' WHERE id={m}")
    elif i < 5: psql(f"UPDATE perf_goals SET objective_id={1 if i == 3 else 4}, atualizada_em=now() - interval '{R.randint(5, 25)} days' WHERE id={m}")
    elif i < 8: psql(f"UPDATE perf_goals SET atualizada_em=now() - interval '{R.randint(35, 80)} days' WHERE id={m}")

print("9) Academy: custo, inscrições abertas, reação e certificados")
psql("UPDATE courses SET instrutor='Corpo de Bombeiros — instrutor credenciado (fictício)' WHERE codigo='NR-23'; UPDATE courses SET instrutor='Enfermeira do trabalho (fictícia)' WHERE codigo='PRIM-01'; UPDATE courses SET custo=0, instrutor='Encarregado de dados (DPO)' WHERE codigo='LGPD-01'")
psql(f"INSERT INTO training_sessions (course_id, data, horario, local, instrutor, unit_id, vagas, custo) VALUES ((SELECT id FROM courses WHERE codigo='NR-23'), '2026-08-12', '08:00–17:00', 'Auditório Carandá', 'Corpo de Bombeiros (fictício)', 1, 30, 1800), ((SELECT id FROM courses WHERE codigo='PRIM-01'), '2026-09-20', '08:00–12:00', 'Sala de reuniões TV Morena I', 'Enfermeira do trabalho (fictícia)', 2, 25, 1200), ((SELECT id FROM courses WHERE codigo='NR-23'), '2026-03-14', '08:00–17:00', 'Auditório TV Morena II', 'Corpo de Bombeiros (fictício)', 3, 30, 1650)")
psql(f"INSERT INTO courses (codigo, titulo, area, descricao, tipo, formato, carga_horas, ativo, custo, instrutor, inscricao_aberta, exige_aprovacao) VALUES ('CNV-01', 'Comunicação não violenta com as famílias', 'Atendimento', 'Escuta, acolhimento e conversas difíceis com responsáveis — com simulações.', 'OPCIONAL', 'PRESENCIAL', 6, true, 0, 'Consultoria Escuta Ativa (fictícia)', true, true), ('EXC-01', 'Planilhas para a rotina administrativa', 'Administrativo', 'Fórmulas, filtros e tabelas dinâmicas para o dia a dia da secretaria e do financeiro.', 'OPCIONAL', 'ONLINE', 4, true, 49, 'Plataforma online (fictícia)', true, false)")
psql(f"INSERT INTO training_sessions (course_id, data, horario, local, instrutor, unit_id, vagas, custo) VALUES ((SELECT id FROM courses WHERE codigo='CNV-01'), '{d(21)}', '13:30–19:30', 'Auditório Carandá', 'Consultoria Escuta Ativa (fictícia)', 1, 25, 2400), ((SELECT id FROM courses WHERE codigo='CNV-01'), '{d(35)}', '08:00–14:00', 'Auditório TV Morena I', 'Consultoria Escuta Ativa (fictícia)', 2, 25, 2400)")
psql("UPDATE training_progress SET inicio_em = concluido_em - (3 + (id % 23)) WHERE status='CONCLUIDO' AND inicio_em IS NULL AND concluido_em IS NOT NULL")
psql("UPDATE training_progress SET inicio_em = current_date - (5 + (id % 30)) WHERE status='EM_ANDAMENTO' AND inicio_em IS NULL")
media = {"NR-23": 4.5, "LGPD-01": 3.9, "POP-003": 3.4, "PRIM-01": 4.7, "ATD-02": 4.2}
comentarios = {"NR-23": ["Prática com extintor foi o melhor momento.", "Poderia ser em dois dias."], "LGPD-01": ["Muito teórico; exemplos da escola ajudariam."], "PRIM-01": ["Excelente! Aprendi a manobra de Heimlich."], "ATD-02": ["Vou usar o roteiro de escuta na rematrícula."], "POP-003": []}
for pid, cid, eid, cod, conc in rows("SELECT p.id, p.course_id, p.employee_id, c.codigo, p.concluido_em FROM training_progress p JOIN courses c ON c.id=p.course_id WHERE p.status='CONCLUIDO' AND c.formato <> 'POP' AND p.employee_id <> 128 ORDER BY p.id"):
    if R.random() > 0.7: continue
    base = media.get(cod, 4.0); nota = max(1, min(5, round(R.gauss(base, 0.7)))); com = R.choice(comentarios.get(cod, []) + [None, None, None])
    psql(f"INSERT INTO training_feedback (course_id, employee_id, nota, aplicavel, comentario, created_at) VALUES ({cid}, {eid}, {nota}, {max(1, min(5, nota + R.choice([-1, 0, 0, 1])))}, {q(com)}, '{conc}'::date + {R.randint(0, 6)}) ON CONFLICT DO NOTHING")
# o colaborador de teste concluiu dois treinamentos: avalia um pela tela (o outro fica para avaliar) e baixa o certificado
psql(f"INSERT INTO training_progress (course_id, employee_id, status, inicio_em, concluido_em, registrado_por) VALUES ((SELECT id FROM courses WHERE codigo='ATD-02'), 128, 'CONCLUIDO', '{d(-12)}', '{d(-6)}', 1), ((SELECT id FROM courses WHERE codigo='LGPD-01'), 128, 'CONCLUIDO', '{d(-5)}', '{d(-3)}', 1) ON CONFLICT (course_id, employee_id) DO UPDATE SET status='CONCLUIDO', inicio_em=EXCLUDED.inicio_em, concluido_em=EXCLUDED.concluido_em")
atd = psql("SELECT id FROM courses WHERE codigo='ATD-02'")
h = page("/academy/minha", COL); ok(post("/academy/minha", aid_of(h, f'id="reacao{atd}"'), {"courseId": atd, "nota": 5, "aplicavel": 5, "comentario": "O roteiro de escuta ajudou nas conversas de rematrícula."}, COL))
cnv = psql("SELECT id FROM courses WHERE codigo='CNV-01'"); h = page("/academy/minha", COL); ok(post("/academy/minha", aid_of(h, "Pedir inscrição"), {"courseId": cnv, "sessionId": psql(f"SELECT id FROM training_sessions WHERE course_id={cnv} ORDER BY data LIMIT 1")}, COL))
equipe87 = [e for e in ativos if e["gestor"] == 87 and e["id"] != 128][:5]
for i, e in enumerate(equipe87):
    st = ["AGUARDANDO_APROVACAO", "AGUARDANDO_APROVACAO", "INSCRITO", "RECUSADA", "DESISTIU"][i]
    psql(f"INSERT INTO training_enrollments (course_id, employee_id, status, motivo, decidido_por, decidido_em, created_at) VALUES ({cnv}, {e['id']}, '{st}', {q('Semana de conselho de classe — fica para a próxima turma.' if st == 'RECUSADA' else None)}, {9 if st in ('INSCRITO', 'RECUSADA') else 'NULL'}, {'now()' if st in ('INSCRITO', 'RECUSADA') else 'NULL'}, now() - interval '{i + 1} days') ON CONFLICT DO NOTHING")
exc = psql("SELECT id FROM courses WHERE codigo='EXC-01'")
for e in [x for x in ativos if x["fam"] in ("SECRETARIA", "ATENDIMENTO_COMERCIAL")][:4]: psql(f"INSERT INTO training_enrollments (course_id, employee_id, status) VALUES ({exc}, {e['id']}, 'INSCRITO') ON CONFLICT DO NOTHING")
h = page("/academy/aprovar", GES); ins = psql(f"SELECT t.id FROM training_enrollments t WHERE t.status='AGUARDANDO_APROVACAO' AND t.employee_id={equipe87[0]['id']}")
ok(post("/academy/aprovar", aid_of(h, f'name="id" value="{ins}"'), {"id": ins, "decisao": "INSCRITO"}, GES), "aprovada")
print("   ", psql("SELECT string_agg(status || ' ' || n, ' · ') FROM (SELECT status, count(*) n FROM training_enrollments GROUP BY 1) x"), "·", psql("SELECT count(*) FROM training_feedback"), "avaliações de reação")

print("10) benefícios: catálogo, adesões, bolsas e recálculo")
h = page("/beneficios", RH); cp = aid_of(h, "Criar benefício")
planos = [
    {"nome": "Vale-transporte", "tipo": "VT", "fornecedor": "Consórcio de transporte (fictício)", "custoEmpresa": "", "custoEmpresaPct": "100", "custoDependente": "", "descontoColab": "", "descontoColabPct": "6", "depPctEmpresa": "0", "carenciaDias": "0", "vinculos": ["CLT", "HORISTA", "TEMPORARIO"], "jornadaMinH": "", "obs": "Opcional: quem não usa assina a declaração de recusa (fica na ficha)."},
    {"nome": "Vale-alimentação", "tipo": "VA", "fornecedor": "Cartão alimentação (fictício)", "custoEmpresa": "650", "custoEmpresaPct": "100", "custoDependente": "", "descontoColab": "20", "descontoColabPct": "", "depPctEmpresa": "0", "carenciaDias": "0", "vinculos": ["CLT", "HORISTA", "TEMPORARIO"], "jornadaMinH": "4", "obs": "Pela convenção coletiva; crédito no 1º dia útil."},
    {"nome": "Plano de saúde — enfermaria", "tipo": "SAUDE", "fornecedor": "Operadora de saúde (fictícia)", "custoEmpresa": "480", "custoEmpresaPct": "70", "custoDependente": "410", "descontoColab": "", "descontoColabPct": "", "depPctEmpresa": "0", "carenciaDias": "90", "vinculos": ["CLT"], "jornadaMinH": "", "obs": "Dependentes: cônjuge e filhos até 24 anos, pagos pelo colaborador."},
    {"nome": "Plano odontológico", "tipo": "ODONTO", "fornecedor": "Operadora odontológica (fictícia)", "custoEmpresa": "32", "custoEmpresaPct": "100", "custoDependente": "28", "descontoColab": "", "descontoColabPct": "", "depPctEmpresa": "50", "carenciaDias": "0", "vinculos": ["CLT", "HORISTA"], "jornadaMinH": "", "obs": ""},
    {"nome": "Seguro de vida em grupo", "tipo": "VIDA", "fornecedor": "Seguradora (fictícia)", "custoEmpresa": "14", "custoEmpresaPct": "100", "custoDependente": "", "descontoColab": "", "descontoColabPct": "", "depPctEmpresa": "0", "carenciaDias": "0", "vinculos": [], "jornadaMinH": "", "obs": "Capital segurado de 24 salários."},
    {"nome": "Bolsa de estudos para filho(a)", "tipo": "BOLSA_DEPENDENTE", "fornecedor": "", "custoEmpresa": "", "custoEmpresaPct": "100", "custoDependente": "", "descontoColab": "", "descontoColabPct": "", "depPctEmpresa": "0", "carenciaDias": "180", "vinculos": ["CLT"], "jornadaMinH": "", "obs": "50% a 100% da mensalidade conforme a política de bolsas; renova a cada ano letivo."},
]
for p in planos: ok(post("/beneficios", cp, {**p, "ativo": "1"}, RH), "Benefício criado")
PL = {t: int(i) for i, t in rows("SELECT id, tipo FROM benefit_plans")}
elegiveis = [e for e in ativos if e["situacao"] != "EM_ADMISSAO" and e["vinculo"] in ("CLT", "HORISTA", "TEMPORARIO")]
sql = []
for e in elegiveis:
    ini = max(e["admissao"], "2025-01-01")
    sql.append(f"INSERT INTO benefit_enrollments (plan_id, employee_id, inicio, valor_empresa, valor_colab, criado_por) VALUES ({PL['VA']}, {e['id']}, '{ini}', 0, 0, 1)")
    sql.append(f"INSERT INTO benefit_enrollments (plan_id, employee_id, inicio, valor_empresa, valor_colab, criado_por) VALUES ({PL['VIDA']}, {e['id']}, '{ini}', 0, 0, 1)")
    if R.random() < 0.42: sql.append(f"INSERT INTO benefit_enrollments (plan_id, employee_id, inicio, valor_empresa, valor_colab, criado_por) VALUES ({PL['VT']}, {e['id']}, '{ini}', {R.choice([176, 198, 220, 242, 264, 308])}, 0, 1)")
    adm = date.fromisoformat(e["admissao"])
    if e["vinculo"] == "CLT" and (HOJE - adm).days > 120 and R.random() < 0.55: sql.append(f"INSERT INTO benefit_enrollments (plan_id, employee_id, inicio, dependentes, valor_empresa, valor_colab, criado_por) VALUES ({PL['SAUDE']}, {e['id']}, '{max((adm + timedelta(days=90)).isoformat(), '2025-01-01')}', {R.choices([0, 1, 2, 3], [0.45, 0.3, 0.2, 0.05])[0]}, 0, 0, 1)")
    if R.random() < 0.35: sql.append(f"INSERT INTO benefit_enrollments (plan_id, employee_id, inicio, dependentes, valor_empresa, valor_colab, criado_por) VALUES ({PL['ODONTO']}, {e['id']}, '{ini}', {R.choice([0, 0, 1, 2])}, 0, 0, 1)")
psql(";\n".join(sql))
h = page("/beneficios?aba=adesoes", RH); ok(post("/beneficios?aba=adesoes", aid_of(h, "Recalcular pelos salários atuais"), {"planId": ""}, RH))
# encerramentos do mês (aparecem nas movimentações do mês e no pacote da folha)
psql(f"UPDATE benefit_enrollments SET status='ENCERRADO', fim='{d(-9)}', motivo_fim='Passou a ir de carro — pediu o cancelamento do VT', encerrado_por=1 WHERE id IN (SELECT id FROM benefit_enrollments WHERE plan_id={PL['VT']} AND inicio < '{d(-60)}' ORDER BY id LIMIT 2)")
# adesões pela tela: VT de uma admissão recente e bolsas para filhos de professores (alunos reais da base de demonstração)
h = page("/beneficios?aba=adesoes", RH); ad = aid_of(h, "Registrar adesão</button>")
inicio_mes = f"{HOJE.isoformat()[:8]}01"
novo = next(e for e in elegiveis if e["admissao"] < inicio_mes and not psql(f"SELECT 1 FROM benefit_enrollments WHERE employee_id={e['id']} AND plan_id={PL['VT']}"))
ok(post("/beneficios?aba=adesoes", ad, {"voltar": "/beneficios?aba=adesoes", "employeeId": novo["id"], "planId": PL["VT"], "inicio": inicio_mes, "dependentes": "0", "valor": "286", "aluno": "", "bolsaPct": "", "valorEmpresa": "", "valorColab": "", "obs": "Ônibus 2 linhas (ida e volta)"}, RH), "Adesão registrada")
alunos = rows("SELECT id, nome FROM students WHERE aluno_atual ORDER BY id LIMIT 400")
pais = [e for e in elegiveis if e["fam"] in ("PROFESSORES", "COORDENACAO") and e["admissao"] < d(-400)][:3]
for e, (al_id, al_nome), pct in zip(pais, R.sample(alunos, 3), [50, 100, 50]):
    un = psql(f"SELECT coalesce(u.nome,'') FROM students s LEFT JOIN units u ON u.id=s.unit_atual_id WHERE s.id={al_id}")
    ok(post("/beneficios?aba=adesoes", ad, {"voltar": "/beneficios?aba=adesoes", "employeeId": e["id"], "planId": PL["BOLSA_DEPENDENTE"], "inicio": "2026-02-01", "dependentes": "0", "valor": "", "aluno": f"{al_nome}{' · ' + un if un else ''} (#{al_id})", "bolsaPct": pct, "valorEmpresa": "", "valorColab": "", "obs": "Política de bolsas para filhos de colaboradores"}, RH), "Adesão registrada")
# o colaborador de teste: plano de saúde e odontológico (com dependente; pela tela, como exceção registrada quando já há adesão) — aparece no Meu espaço
for t, extra in [("SAUDE", {"dependentes": "1", "valor": ""}), ("ODONTO", {"dependentes": "1", "valor": ""})]:
    if not psql(f"SELECT 1 FROM benefit_enrollments WHERE employee_id=128 AND plan_id={PL[t]} AND status='ATIVO'"):
        ok(post("/beneficios?aba=adesoes", ad, {"voltar": "/beneficios?aba=adesoes", "employeeId": 128, "planId": PL[t], "inicio": d(-40), "aluno": "", "bolsaPct": "", "valorEmpresa": "", "valorColab": "", "obs": "Portabilidade de carência do plano anterior (fictício)", "excecao": "1", **extra}, RH), "Adesão registrada")
print("   ", psql("SELECT count(*) FILTER (WHERE status='ATIVO') || ' adesões ativas · R$ ' || to_char(sum(valor_empresa) FILTER (WHERE status='ATIVO'), 'FM999G999D00') || '/mês pela escola' FROM benefit_enrollments"))

print("11) relatórios sob medida salvos")
h = page("/relatorios/montar", RH); sv = aid_of(h, 'name="qs"')
for nome, qs, comp in [("Docentes por titulação e unidade", f"fonte=colaboradores&gerar=1&f_situacao=ATIVO&f_situacao=FERIAS&f_situacao=AFASTADO&f_cargo={prof}&g=titulacao&g2=unidade&graf=1", "1"),
                       ("Quadro por unidade e vínculo", "fonte=colaboradores&gerar=1&f_situacao=ATIVO&f_situacao=FERIAS&f_situacao=AFASTADO&g=unidade&g2=vinculo&graf=1", "1"),
                       ("Férias aprovadas por mês", "fonte=ausencias&gerar=1&f_tipo=FERIAS&f_status=APROVADA&g=mes&m=somar:dias&o=rotulo&graf=1", "0"),
                       ("Benefícios: custo mensal por benefício e unidade", "fonte=beneficios&gerar=1&f_status=ATIVO&g=beneficio&g2=unidade&m=somar:valor_empresa&graf=1", "0")]:
    ok(post("/relatorios/montar", sv, {"qs": qs, "nome": nome, "compartilhado": comp}, RH), "Relatório salvo")

psql("DELETE FROM settings WHERE key='kpi_base'")  # o Painel Executivo recalcula os indicadores (inclusive os novos de capital humano) na próxima abertura
psql(f"INSERT INTO settings (key, value) VALUES ('demo_v30', '{{\"em\": \"{datetime.now().isoformat()}\"}}'::jsonb)")
print("OK — demonstração da v30 carregada (dados fictícios).")
