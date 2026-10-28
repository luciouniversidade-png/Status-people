# E2E — v30 · Benefícios, remuneração total, relatório sob medida e indicadores de capital humano.
# Benefícios: catálogo com regras (VT até 6% do salário — Lei 7.418; % pago pela escola; dependentes; carência; vínculo e jornada
# mínima), adesão com elegibilidade (exceção só com justificativa), cálculo de escola × desconto, bolsa de estudos para filho(a) aluno(a)
# (mensalidade da série × %; uma bolsa por aluno), alteração, recálculo pelos salários atuais, encerramento com motivo, aviso à pessoa,
# movimentações do mês, seção no pacote da folha e encerramento automático no desligamento; acesso só de RH/Direção. Remuneração total
# estimada no Meu espaço e na ficha (só quem vê salário). Relatório sob medida: fontes, colunas e filtros conforme o acesso (salário,
# dados pessoais, desempenho), escopo da unidade, tabela cruzada, métricas, CSV com carimbo e auditoria, parâmetros maliciosos ignorados,
# salvar/compartilhar/excluir. Indicadores novos sem falha no Painel Executivo. Dados fictícios.
# Uso: bash /tmp/withserver.sh python3 scripts/e2e_v30_beneficios_relatorios.py
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
HOJE = datetime.now(ZoneInfo("America/Campo_Grande")).date(); H = HOJE.isoformat(); MES = H[:7]
def d(n): return (HOJE + timedelta(days=n)).isoformat()
def val(sql): return float(psql(sql))

print("Preparação")
RH = login("rh@colegiostatus", "Status2026!"); r = RH.get(B + f"/api/setup?token={TOKEN}"); assert r.json()["ok"], r.text
U = {c: int(psql(f"SELECT id FROM units WHERE codigo='{c}'")) for c in ["CAR", "CUL"]}; CAR, CUL = U["CAR"], U["CUL"]; C1 = int(psql("SELECT id FROM companies ORDER BY id LIMIT 1"))
P = {n: int(psql(f"SELECT id FROM positions WHERE nome='{n}'")) for n in ["Professor", "Coordenador Pedagógico", "Diretor Geral (Sócio)"]}
def emp(nome, cargo, unit, gestor=None, salario=3000, admissao="2023-03-01", vinculo="CLT", sexo="F", jornada=480):
    return int(psql(f"INSERT INTO employees (nome, cpf, unit_id, position_id, vinculo, admissao, gestor_id, situacao, salario, company_id, jornada_min_dia, sexo, data_nascimento) VALUES ({q(nome)}, '00000000000', {unit}, {P[cargo]}, '{vinculo}', '{admissao}', {q(gestor)}, 'ATIVO', {salario}, {C1}, {jornada}, '{sexo}', '1988-05-10') RETURNING id"))
EDG = emp("Diretor Fictício", "Diretor Geral (Sócio)", CAR, None, 15000, sexo="M"); CO = emp("Coordenadora Fictícia", "Coordenador Pedagógico", CAR, EDG, 6500)
E1 = emp("Professora Um (fictícia)", "Professor", CAR, CO, 3000); E2 = emp("Professor Dois (fictício)", "Professor", CAR, CO, 6000, "2022-01-10", sexo="M")
E3 = emp("Estagiária Três (fictícia)", "Professor", CAR, CO, 1200, vinculo="ESTAGIARIO", jornada=240); E4 = emp("Professora Quatro (fictícia)", "Professor", CAR, CO, 3200, d(-30))
E5 = emp("Professor Cinco (fictício)", "Professor", CUL, None, 3100, sexo="M")
aid_user = aid_of(page("/configuracoes", RH), "Criar acesso")
for eid, em in [(CO, "coord@car"), (E1, "e1@car")]: okmsg(post("/configuracoes", aid_user, {"modo": "auto", "employeeId": eid, "nome": "", "email": em, "senha": "senha12345", "atuacao": "LEITURA", "unitId": ""}, RH))
okmsg(post("/configuracoes", aid_user, {"modo": "direto", "employeeId": "0", "nome": "Diretora da Unidade (fictícia)", "email": "du@car", "senha": "senha12345", "atuacao": "DIRETOR_UNIDADE", "unitId": CAR}, RH))
okmsg(post("/configuracoes", aid_user, {"modo": "direto", "employeeId": "0", "nome": "Auditoria (fictícia)", "email": "leitura@x", "senha": "senha12345", "atuacao": "LEITURA", "unitId": ""}, RH))
GE, CL, DU, LE = login("coord@car"), login("e1@car"), login("du@car"), login("leitura@x")
UE1 = int(psql("SELECT id FROM users WHERE email='e1@car'"))
GR = int(psql("SELECT id FROM grades ORDER BY id LIMIT 1") or 0) or None
ST = int(psql(f"INSERT INTO students (nome, aluno_atual, unit_atual_id, serie_atual_id) VALUES ('Aluno Filho (fictício)', true, {CAR}, {q(GR)}) RETURNING id"))
psql(f"INSERT INTO tuition_prices (ano, unit_id, grade_id, modalidade, valor_mensal) VALUES ({HOJE.year + 1}, {CAR}, NULL, 'REGULAR', 2000)")
ok("fichas fictícias com salário (CLT, estágio, admissão recente, outra unidade), coordenação, colaboradora, direção da unidade e leitura; aluno e mensalidade para a bolsa")

print("Benefícios: catálogo e regras")
assert get("/beneficios", GE).status_code == 307 and get("/beneficios", CL).status_code == 307 and get("/beneficios", DU).status_code == 307
h = page("/beneficios", RH); aid_pl = aid_of(h, "Criar benefício")
base = {"fornecedor": "", "custoEmpresa": "", "custoEmpresaPct": "100", "custoDependente": "", "descontoColab": "", "descontoColabPct": "", "depPctEmpresa": "0", "carenciaDias": "0", "jornadaMinH": "", "obs": "", "ativo": "1"}
erro(post("/beneficios", aid_pl, {**base, "nome": "VT", "tipo": "VT"}, RH), "Dê um nome")
erro(post("/beneficios", aid_pl, {**base, "nome": "Vale-transporte", "tipo": "XX"}, RH), "Tipo inválido")
erro(post("/beneficios", aid_pl, {**base, "nome": "Vale-transporte", "tipo": "VT", "descontoColabPct": "8"}, RH), "no máximo 6%")
erro(post("/beneficios", aid_pl, {**base, "nome": "Plano X", "tipo": "SAUDE", "custoEmpresaPct": "120"}, RH), "0 a 100")
okmsg(post("/beneficios", aid_pl, {**base, "nome": "Vale-transporte", "tipo": "VT", "descontoColabPct": "6", "vinculos": ["CLT", "HORISTA", "TEMPORARIO"]}, RH), "Benefício criado")
okmsg(post("/beneficios", aid_pl, {**base, "nome": "Plano de saúde", "tipo": "SAUDE", "custoEmpresa": "480", "custoEmpresaPct": "70", "custoDependente": "410", "carenciaDias": "90", "vinculos": ["CLT"]}, RH))
okmsg(post("/beneficios", aid_pl, {**base, "nome": "Vale-alimentação", "tipo": "VA", "custoEmpresa": "650", "descontoColab": "20", "jornadaMinH": "6", "vinculos": ["CLT", "HORISTA"]}, RH))
okmsg(post("/beneficios", aid_pl, {**base, "nome": "Bolsa para filho(a)", "tipo": "BOLSA_DEPENDENTE", "carenciaDias": "180", "vinculos": ["CLT"]}, RH))
PL = {t: int(i) for i, t in [x.split("|") for x in psql("SELECT id, tipo FROM benefit_plans").split("\n")]}
assert psql(f"SELECT elegibilidade->'vinculos' FROM benefit_plans WHERE id={PL['VA']}") == '["CLT", "HORISTA"]' and psql(f"SELECT elegibilidade->>'jornadaMinDia' FROM benefit_plans WHERE id={PL['VA']}") == "360"
ok("benefícios só para RH/Direção; nome, tipo, % e o limite de 6% do VT validados; regras de vínculo, jornada mínima e carência gravadas")

print("Adesões: elegibilidade, cálculo, bolsa, alteração, recálculo e encerramento")
h = page("/beneficios?aba=adesoes", RH); aid_ad = aid_of(h, "Registrar adesão</button>")
def aderir(emp_, plano, sess=RH, **kw):
    return post("/beneficios?aba=adesoes", aid_ad, {"voltar": "/beneficios?aba=adesoes", "employeeId": emp_, "planId": PL[plano], "inicio": kw.pop("inicio", H), "dependentes": kw.pop("dependentes", "0"), "valor": kw.pop("valor", ""), "aluno": kw.pop("aluno", ""), "bolsaPct": kw.pop("bolsaPct", ""), "valorEmpresa": kw.pop("valorEmpresa", ""), "valorColab": kw.pop("valorColab", ""), "obs": kw.pop("obs", ""), **kw}, sess)
erro(aderir(E1, "VT", GE), "RH ou pela Direção")
erro(aderir(E4, "SAUDE"), "carência até")
erro(aderir(E4, "SAUDE", excecao="1", obs="curta"), "justificativa")
okmsg(aderir(E4, "SAUDE", excecao="1", obs="Portabilidade de carência do plano anterior"), "Adesão registrada")
assert psql(f"SELECT obs FROM benefit_enrollments WHERE employee_id={E4}").startswith("EXCEÇÃO À REGRA (carência até")
erro(aderir(E3, "VA"), "vínculo ESTAGIARIO fora da regra")
erro(aderir(E1, "VT"), "custo mensal do transporte")
okmsg(aderir(E1, "VT", valor="250"))
assert psql(f"SELECT valor_empresa||'|'||valor_colab FROM benefit_enrollments WHERE employee_id={E1} AND plan_id={PL['VT']}") == "70.00|180.00"
erro(aderir(E2, "VT", valor="400", valorColab="500"), "acima de 6%")
okmsg(aderir(E1, "SAUDE", dependentes="2"))
assert psql(f"SELECT valor_empresa||'|'||valor_colab FROM benefit_enrollments WHERE employee_id={E1} AND plan_id={PL['SAUDE']}") == "336.00|964.00"
erro(aderir(E1, "SAUDE"), "já tem este benefício ativo")
erro(aderir(E2, "BOLSA_DEPENDENTE", bolsaPct="50"), "Escolha o(a) aluno(a)")
okmsg(aderir(E2, "BOLSA_DEPENDENTE", aluno=f"Aluno Filho (fictício) · Carandá (#{ST})", bolsaPct="50"))
assert psql(f"SELECT valor_empresa||'|'||valor_colab||'|'||student_id||'|'||bolsa_pct FROM benefit_enrollments WHERE employee_id={E2} AND plan_id={PL['BOLSA_DEPENDENTE']}") == f"1000.00|0.00|{ST}|50.00"
erro(aderir(EDG, "BOLSA_DEPENDENTE", aluno=f"Aluno Filho (fictício) (#{ST})", bolsaPct="100"), "já tem bolsa ativa")
assert psql(f"SELECT count(*) FROM notifications WHERE user_id={UE1} AND link='/eu#beneficios'") == "2"
h = page("/beneficios?aba=adesoes", RH); A_SA = int(psql(f"SELECT id FROM benefit_enrollments WHERE employee_id={E1} AND plan_id={PL['SAUDE']}"))
okmsg(post("/beneficios?aba=adesoes", aid_of(h, 'name="valorColab" type="number" step="0.01" min={0} placeholder="recalcula"') if False else aid_of(h, 'placeholder="recalcula"'), {"id": A_SA, "voltar": "/beneficios?aba=adesoes", "dependentes": "1"}, RH), "Adesão atualizada")
assert psql(f"SELECT valor_colab FROM benefit_enrollments WHERE id={A_SA}") == "554.00"
psql(f"UPDATE employees SET salario=5000 WHERE id={E1}")
okmsg(post("/beneficios?aba=adesoes", aid_of(h, "Recalcular pelos salários atuais"), {"planId": ""}, RH), "recalculada")
assert psql(f"SELECT valor_empresa||'|'||valor_colab FROM benefit_enrollments WHERE employee_id={E1} AND plan_id={PL['VT']}") == "0.00|250.00"
okmsg(post("/beneficios?aba=adesoes", aid_of(h, "Recalcular pelos salários atuais"), {"planId": ""}, RH), "Nada mudou")
A_E4 = int(psql(f"SELECT id FROM benefit_enrollments WHERE employee_id={E4}")); aid_enc = aid_of(h, 'name="fim"')
erro(post("/beneficios?aba=adesoes", aid_enc, {"id": A_E4, "voltar": "/beneficios?aba=adesoes", "fim": H, "motivo": ""}, RH), "motivo")
erro(post("/beneficios?aba=adesoes", aid_enc, {"id": A_E4, "voltar": "/beneficios?aba=adesoes", "fim": d(-400), "motivo": "Pediu"}, RH), "antes do início")
okmsg(post("/beneficios?aba=adesoes", aid_enc, {"id": A_E4, "voltar": "/beneficios?aba=adesoes", "fim": H, "motivo": "Pediu o cancelamento"}, RH), "encerrado")
erro(post("/beneficios?aba=adesoes", aid_enc, {"id": A_E4, "voltar": "/beneficios?aba=adesoes", "fim": H, "motivo": "De novo"}, RH), "já encerrada")
h = page("/beneficios?aba=mes", RH); assert "Adesões no mês" in h and "Professora Um" in h and "encerramento" in h
h = page("/beneficios?aba=elegiveis", RH); assert "elegível(is) sem adesão" in h and "em carência" in h
h = page("/beneficios?aba=custo", RH); assert "Por benefício — custo mensal" in h
ok("elegibilidade (carência, vínculo) com exceção só justificada e registrada; VT: escola paga o que passa de 6% do salário, desconto acima do limite recusado; saúde com dependentes pagos pela pessoa; adesão duplicada recusada; bolsa pela mensalidade × % com o aluno (uma por aluno); aviso à pessoa; alteração recalcula; recálculo após aumento de salário (e nada a mudar na segunda vez); encerramento com motivo e data válida; mês, elegíveis e custo")

print("Remuneração total e pacote da folha")
h = page("/eu", CL); assert "Meus benefícios e remuneração total" in h and "por ano" in h and "Salário (12 meses)" in h and "R$ 60.000,00" in h
h = page(f"/colaboradores/{E1}", RH); assert "Benefícios e remuneração total" in h
assert "Benefícios e remuneração total" not in page(f"/colaboradores/{E1}", GE)
for u in (CAR, CUL): psql(f"INSERT INTO timesheet_locks (unit_id, mes, status, fechado_por_nome) VALUES ({u}, '{MES}', 'FECHADO', 'RH') ON CONFLICT DO NOTHING")
h = page(f"/folha?mes={MES}", RH); i = h.find(f'name="companyId" value="{C1}"'); assert i > 0
loc = post(f"/folha?mes={MES}", aid_of(h, f'name="companyId" value="{C1}"'), {"companyId": C1, "mes": MES, "voltar": f"/folha?mes={MES}"}, RH); okmsg(loc, "Pacote gerado")
CID = int(re.search(r"/folha/(\d+)", loc).group(1)); csv = RH.get(B + f"/api/folha/pacote/{CID}").text
sec = csv.split("## Benefícios (adesões, encerramentos e descontos)")[1].split("## Sem fonte")[0]; assert "Adesão" in sec and "Plano de saúde" in sec and "Vale-transporte" in sec, sec[:600]
assert "benefício(s) no mês" in page(f"/folha/{CID}", RH)
h = page(f"/colaboradores/{E2}", RH); loc = post(f"/colaboradores/{E2}", aid_of(h, 'name="desligamento"'), {"id": E2, "desligamento": H, "motivo": "Pedido"}, RH)
PID = int(re.search(r"/processos/(\d+)", loc).group(1)); psql(f"UPDATE process_items SET concluido=true WHERE process_id={PID}")
okmsg(post(f"/processos/{PID}", aid_of(page(f"/processos/{PID}", RH), "Concluir desligamento"), {"processId": PID}, RH))
assert psql(f"SELECT string_agg(status||':'||coalesce(motivo_fim,''), ',') FROM benefit_enrollments WHERE employee_id={E2}") == "ENCERRADO:Desligamento"
ok("remuneração total no Meu espaço (salário × 12, 13º, férias, FGTS, encargos e benefícios) e na ficha só para quem vê salário; pacote da folha com a seção de benefícios; desligamento encerra os benefícios ativos")

print("Relatório sob medida")
h = page("/relatorios/montar", RH); assert all(f in h for f in ["Colaboradores", "Férias e ausências", "Treinamentos", "Movimentações (histórico funcional)", "Benefícios", "Desempenho (avaliações)"]) and "Salário-base" in h
h = page("/relatorios/montar?fonte=colaboradores&gerar=1&g=unidade&g2=vinculo&m=somar:salario&f_situacao=ATIVO", RH); assert "Carandá" in h and "Cultura" in h and "Estagiário" in h and "Soma de salário-base" in h
h = page("/relatorios/montar?fonte=beneficios&gerar=1&g=beneficio&m=somar:valor_empresa&f_status=ATIVO", RH); assert "Plano de saúde" in h and "Soma de a escola paga (mês)" in h
hg = page("/relatorios/montar", GE); assert "Salário-base" not in hg and "Sexo (eSocial)" not in hg and "Idade" not in hg and ">Benefícios<" not in hg and "Desempenho (avaliações)" not in hg
hg = page("/relatorios/montar?fonte=beneficios&gerar=1&c=nome&c=salario&g=&u=" + str(CUL), GE); assert "Professor Cinco" not in hg and "Salário-base" not in hg and "A escola paga" not in hg
hg = page("/relatorios/montar?fonte=colaboradores&gerar=1&c=nome&c=unidade&u=" + str(CUL), GE); assert "Professor Cinco" not in hg and "Professora Um" in hg
hd = page("/relatorios/montar?fonte=colaboradores&gerar=1&g=sexo", DU); assert "Feminino" in hd and "Salário-base" not in hd
for bad in ["c=nome%3BDROP%20TABLE%20employees&g=unidade)%3B--", "g=nome&m=somar:salario%3B--&f_situacao=ATIVO')%3B--", "fonte=desempenho&c=nota", "f_cargo=1%20OR%201%3D1&o=x"]:
    assert get(f"/relatorios/montar?fonte=colaboradores&gerar=1&{bad}", GE).status_code == 200
assert psql("SELECT to_regclass('employees') IS NOT NULL") == "t"
r = RH.get(B + "/api/relatorio-montar?fonte=colaboradores&gerar=1&c=nome&c=unidade&c=salario&f_situacao=ATIVO"); assert r.status_code == 200 and "text/csv" in r.headers["content-type"]
t = r.content.decode("utf-8-sig"); assert t.startswith("Relatório sob medida · Colaboradores;Rede") and "Filtros: Situação: Ativo" in t and "Professora Um (fictícia);Carandá;5000" in t
rg = GE.get(B + "/api/relatorio-montar?fonte=colaboradores&gerar=1&c=nome&c=salario"); tg = rg.content.decode("utf-8-sig"); assert rg.status_code == 200 and "Professor Cinco" not in tg and "5000" not in tg
assert psql("SELECT count(*) FROM audit_log WHERE acao='exportar relatório sob medida'") == "2"
assert CL.get(B + "/api/relatorio-montar?fonte=colaboradores").status_code == 403
QS = "fonte=colaboradores&gerar=1&g=unidade&g2=vinculo&f_situacao=ATIVO&graf=1"; h = page(f"/relatorios/montar?{QS}", RH); aid_sv = aid_of(h, 'name="qs"')
erro(post("/relatorios/montar", aid_sv, {"qs": QS, "nome": "Q"}, RH), "Dê um nome")
okmsg(post("/relatorios/montar", aid_sv, {"qs": QS, "nome": "Quadro por unidade e vínculo", "compartilhado": "1"}, RH), "Relatório salvo")
okmsg(post("/relatorios/montar", aid_sv, {"qs": "fonte=colaboradores&gerar=1&c=nome", "nome": "Meu rascunho de RH"}, RH))
hg = page("/relatorios/montar", GE); assert "Quadro por unidade e vínculo" in hg and "Meu rascunho de RH" not in hg
RID = int(psql("SELECT id FROM custom_reports WHERE nome='Quadro por unidade e vínculo'")); aid_ex = aid_of(page("/relatorios/montar", RH), ">excluir</button>")
erro(post("/relatorios/montar", aid_ex, {"id": RID}, GE), "Só quem criou")
okmsg(post("/relatorios/montar", aid_sv, {"qs": "fonte=colaboradores&gerar=1&c=nome&c=salario", "nome": "Equipe da coordenação"}, GE))
assert psql("SELECT definicao->>'qs' FROM custom_reports WHERE nome='Equipe da coordenação'").find("salario") == -1
erro(post("/relatorios/montar", aid_sv, {"qs": QS, "nome": "Leitura tenta salvar"}, LE), "não salva")
okmsg(post("/relatorios/montar", aid_ex, {"id": RID}, RH), "excluído"); assert psql(f"SELECT count(*) FROM custom_reports WHERE id={RID}") == "0"
ok("RH vê as seis fontes e o salário; tabela cruzada e soma; coordenação sem salário, dados pessoais, benefícios e desempenho, presa à unidade (URL e CSV); direção da unidade com dados pessoais e sem salário; parâmetros maliciosos ignorados (banco intacto); CSV com carimbo, filtros e auditoria; colaboradora sem acesso; salvar/compartilhar: nome obrigatório, o rascunho não compartilhado fica com o dono, coordenação não exclui o do RH, definição salva só com o que o acesso permite, leitura não salva")

print("Indicadores de capital humano no Painel Executivo")
psql("DELETE FROM settings WHERE key='kpi_base'"); h = page("/executivo?aba=pessoas", RH); assert psql("SELECT value->'falhas' FROM settings WHERE key='kpi_base'") == "[]"
for k in ["HCROI (retorno do custo de pessoal)", "Receita por colaborador", "Amplitude de controle", "Mulheres na liderança", "Qualidade da contratação", "Horas de treinamento por colaborador", "Promoções (12 meses)", "Aceite de propostas", "Índice de liderança"]: assert k in h, k
amp = psql(f"SELECT round((sum(num)/sum(den))::numeric, 2) FROM kpi_series WHERE chave='pessoas.amplitude' AND periodo='{MES}'"); assert amp == "2.00", amp  # coordenação + 3 professoras ativas com gestor ÷ 2 gestores (direção e coordenação)
ok("os nove indicadores novos aparecem no Painel Executivo e a base recalcula sem falhas; amplitude de controle confere com a estrutura")
print(f"OK — {N[0]} blocos verificados")
