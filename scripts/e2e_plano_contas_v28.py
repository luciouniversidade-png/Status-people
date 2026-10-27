# E2E — v28 · Plano de contas gerencial, centros de custo, classificação, rateio e orçamento pelo histórico (catálogo
# “Plano de contas, centros de custo e orçamento”). Plano: árvore padrão (9 macrogrupos + receitas), subconta, categoria-ponte travada
# depois de usada, permissões. Classificação: fila com sugestões (histórico da contraparte, regra), aplicar as de confiança alta,
# classificar as marcadas com “lembrar” (regra), lançamento individual, regras (criar, duplicada, aplicar, desativar), competência
# fechada. Contas a pagar: conta obrigatória, transferência recusada, CAPEX vira investimento, centro corporativo padrão, baixa herda.
# DRE: saídas que não são despesa fora das linhas. Rateio: provisório por alunos, proposta (percentual que não soma 100 recusado),
# quem propõe não aprova, aprovação/rejeição, regra vigente pelo mês, exportação, escopo da unidade. Orçamento pelo histórico:
# higienização (duplicidade, estorno, investimento, pico, evento; transferências, principal de dívida e adiantamento fora sozinhos),
# decisões (normalizar só pico, voltar à sugestão, aceitar sugestões), parâmetros, projeção conferida conta a conta (mensalidade ×
# reajuste × alunos, dissídio a partir do mês, tributo pela receita, conta que começou no meio da base, resíduo sem conta, piso de
# títulos e contratos do ano), versões, aplicação pela Direção (substituir), orçado × realizado, exportação, pendências, alertas e configurações.
import re, subprocess, requests, csv, io, hashlib
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo
B = "http://localhost:3100"; TOKEN = "setup-homologacao-2026-status"
def psql(q): return subprocess.run(["su", "postgres", "-c", "/usr/lib/postgresql/16/bin/psql -h /tmp/pg -U status -d status_people -q -t -A -F '|' -v ON_ERROR_STOP=1"], input=q + ";", capture_output=True, text=True).stdout.strip()
def rodar(sql_txt):
    r = subprocess.run(["su", "postgres", "-c", "/usr/lib/postgresql/16/bin/psql -h /tmp/pg -U status -d status_people -q -v ON_ERROR_STOP=1"], input=sql_txt, capture_output=True, text=True); assert r.returncode == 0, r.stderr[-2000:]
def mk(): s = requests.Session(); s.headers.update({"Origin": B}); return s
unq = requests.utils.unquote; N = [0]
def ok(msg): N[0] += 1; print(f"  ✓ {msg}")
def action_ids(html):
    i = html.find("<main"); body = html[i:] if i >= 0 else html
    return re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', body)
def fix_cookie(sess, r):
    m = re.search(r"rh_session=([^;]+)", r.headers.get("set-cookie", ""))
    if m: sess.headers["Cookie"] = f"rh_session={m.group(1)}"
def page(path, sess, expect=200):
    r = sess.get(B + path, allow_redirects=False)
    if isinstance(expect, tuple): assert r.status_code in expect, (path, r.status_code)
    else: assert r.status_code == expect, (path, r.status_code, r.headers.get("location"))
    return re.sub(r"<script[^>]*>.*?</script>", "", re.sub(r"<!--.*?-->", "", r.text), flags=re.S).replace("\xa0", " ")
def post(path, aid, data, sess):
    f = [(f"$ACTION_ID_{aid}", (None, ""))]
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
def login(email, senha):
    s = mk(); html = s.get(B + "/login").text; aid = re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', html)[0]
    loc = post("/login", aid, {"email": email, "senha": senha}, s); assert loc.endswith("/"), loc; return s
def erro(loc, trecho): loc = loc.replace("\xa0", " "); assert "erro=" in loc and trecho in loc, (trecho, loc)
def okmsg(loc, trecho=""): loc = loc.replace("\xa0", " "); assert "ok=" in loc and trecho in loc, (trecho, loc)
def csv_rows(sess, path, skip_titulo=True):
    r = sess.get(B + path); assert r.status_code == 200, (path, r.status_code); t = r.content.decode("utf-8-sig")
    linhas = list(csv.reader(io.StringIO(t), delimiter=";")); return linhas[1:] if skip_titulo else linhas
def q(v): return "NULL" if v is None else str(v) if isinstance(v, (int, float)) else "'" + str(v).replace("'", "''") + "'"
HOJE = datetime.now(ZoneInfo("America/Campo_Grande")).date(); H = HOJE.isoformat(); ANO = HOJE.year + 1
def mes_off(n):
    y, m = HOJE.year, HOJE.month - n
    while m < 1: m += 12; y -= 1
    return date(y, m, 1)
BASE = [mes_off(n) for n in range(12, 0, -1)]; PRIOR = [mes_off(n) for n in range(24, 12, -1)]; FIM_BASE = BASE[-1].strftime("%Y-%m")
def dia(m, d): return date(m.year, m.month, d).isoformat()

print("Preparação")
RH = login("rh@colegiostatus", "Status2026!"); r = RH.get(B + f"/api/setup?token={TOKEN}"); assert r.json()["ok"], r.text
U = {c: int(psql(f"SELECT id FROM units WHERE codigo='{c}'")) for c in ["CAR", "TVM1", "TVM2", "CUL"]}; CAR, TVM1 = U["CAR"], U["TVM1"]
html = page("/configuracoes", RH); aid_user = aid_of(html, "Criar acesso")
def criar_user(nome, email, role, unit=""):
    post("/configuracoes", aid_user, {"nome": nome, "email": email, "role": role, "unitId": unit, "employeeId": "", "senha": "senha12345"}, RH); return psql(f"SELECT id FROM users WHERE email='{email}'")
UFIN = criar_user("Financeiro Rede", "fin@v28", "FINANCEIRO"); UDG = criar_user("Diretora Geral", "dg@v28", "DIRECAO"); UDG2 = criar_user("Diretor Adjunto", "dg2@v28", "DIRECAO"); UDIR = criar_user("Diretora Carandá", "dir@v28", "DIRETOR_UNIDADE", CAR)
FS, DG, DG2, DS = login("fin@v28", "senha12345"), login("dg@v28", "senha12345"), login("dg2@v28", "senha12345"), login("dir@v28", "senha12345")
hp = page("/financeiro/plano-de-contas?aba=centros", FS)  # cria os centros padrão
C = {l.split("|")[0]: int(l.split("|")[1]) for l in psql("SELECT codigo, id FROM chart_accounts").splitlines()}
CC = {l.split("|")[0]: int(l.split("|")[1]) for l in psql("SELECT codigo, id FROM cost_centers").splitlines()}
assert {"CORP", "CAR", "TVM1", "TVM2", "CUL"} <= set(CC), CC
assert psql("SELECT count(*) FROM chart_accounts WHERE nivel=1") == "10" and psql("SELECT count(*) FROM chart_accounts WHERE nivel=3") == "57"
psql(f"INSERT INTO students (nome, aluno_atual, unit_atual_id) SELECT 'Aluno V28 ' || g, true, CASE WHEN g <= 100 THEN {CAR} ELSE {TVM1} END FROM generate_series(1, 400) g")
# caixa de 24 meses (12 da base + 12 anteriores) por conta, com contrapartes; casos para a higienização; o mês corrente para a fila
E = []
def L(unit, data, tipo, cat, codigo, valor, cp, desc=None, centro="U"):
    cid = C[codigo] if codigo else None; c = None if not cid else CC["CORP"] if centro == "CORP" else CC[centro] if centro in CC else CC[{CAR: "CAR", TVM1: "TVM1"}[unit]]
    E.append((unit, data, tipo, cat, "TED" if tipo == "SAIDA" else "PIX", desc or cp, valor, cp, hashlib.md5(f"e2e28|{len(E)}".encode()).hexdigest(), cid, c))
for m in PRIOR + BASE:
    L(CAR, dia(m, 5), "ENTRADA", "Mensalidades", "R.1.01", 100000, "Mensalidades (teste)"); L(TVM1, dia(m, 5), "ENTRADA", "Mensalidades", "R.1.01", 200000, "Mensalidades (teste)")
    L(CAR, dia(m, 6), "SAIDA", "Pessoal", "1.1.01", 20000, "Folha docente (teste)"); L(TVM1, dia(m, 6), "SAIDA", "Pessoal", "1.1.01", 40000, "Folha docente (teste)")
    L(CAR, dia(m, 7), "SAIDA", "Aluguel e condomínio", "3.1.01", 10000, "Imobiliária Teste"); L(TVM1, dia(m, 7), "SAIDA", "Aluguel e condomínio", "3.1.01", 15000, "Imobiliária Teste")
    L(CAR, dia(m, 8), "SAIDA", "Impostos e taxas", "7.1.01", 5000, "Prefeitura — ISS (teste)")
    L(CAR, dia(m, 9), "SAIDA", "Serviços e terceiros", "4.1.01", 3000, "Contábil Teste", centro="CORP")
    L(CAR, dia(m, 12), "SAIDA", "Serviços e terceiros", "3.2.01", 1000, "Luz & Força Teste")
    L(CAR, dia(m, 13), "SAIDA", "Manutenção", "3.3.02", 1000, "Refrigeração Teste")
for m in BASE[8:]: L(CAR, dia(m, 14), "SAIDA", "Serviços e terceiros", "3.2.03", 500, "Fibra Teste")  # conta que começou no meio da base
L(CAR, dia(BASE[6], 10), "SAIDA", "Serviços e terceiros", "3.2.01", 1234.56, "Luz & Força Teste", "Fatura UC 1"); L(CAR, dia(BASE[6], 11), "SAIDA", "Serviços e terceiros", "3.2.01", 1234.56, "Luz & Força Teste", "Fatura UC 1 — manual")
L(CAR, dia(BASE[7], 3), "SAIDA", "Marketing", "5.1.02", 2000, "Gráfica Teste", "Banners"); L(CAR, dia(BASE[7], 8), "ENTRADA", "Outras receitas", "R.3.02", 2000, "Gráfica Teste", "ESTORNO pagamento em dobro")
L(CAR, dia(BASE[4], 20), "SAIDA", "Manutenção", "3.3.02", 30000, "Refrigeração Teste", "Troca do compressor")
L(CAR, dia(BASE[2], 15), "SAIDA", "Encargos e benefícios", "1.3.03", 15000, "Acordo trabalhista (teste)")
L(CAR, dia(BASE[9], 15), "SAIDA", "Materiais e insumos", "8.2.01", 7000, "Móveis Teste", "Carteiras novas")
L(CAR, dia(BASE[3], 16), "SAIDA", "Transferência entre unidades", "9.1.01", 50000, "Colégio — TVM1"); L(TVM1, dia(BASE[3], 16), "ENTRADA", "Transferência entre unidades", None, 50000, "Colégio — CAR")
L(CAR, dia(BASE[8], 17), "SAIDA", "Amortização de dívida", "9.2.01", 4000, "Banco Teste — principal", centro="CORP")
L(CAR, dia(BASE[5], 18), "SAIDA", "Adiantamentos", "9.3.01", 2500, "Editora Teste — sinal")
L(CAR, dia(BASE[11], 20), "SAIDA", "Serviços e terceiros", None, 800, "Concessionária Sem Histórico (teste)", "Conta diversa")  # resíduo sem conta na base
for cp, cat, v in [("Folha docente (teste)", "Pessoal", 1000), ("Imobiliária Teste", "Aluguel e condomínio", 500), ("Fornecedor Novo Teste", "Serviços e terceiros", 300), ("Papelaria Nova Teste", "Materiais e insumos", 250)]: L(CAR, H, "SAIDA", cat, None, v, cp)
L(CAR, H, "SAIDA", "Outras despesas", "4.3.01", 50000, "Despesas diversas (teste)")
cols = "unit_id, data, tipo, categoria, forma, descricao, valor, contraparte, hash, conta_id, cost_center_id, classificacao_origem"
rodar(f"INSERT INTO cash_entries ({cols}) VALUES " + ",".join(f"({x[0]}, '{x[1]}', '{x[2]}', {q(x[3])}, {q(x[4])}, {q(x[5])}, {x[6]}, {q(x[7])}, '{x[8]}', {q(x[9])}, {q(x[10])}, {q('MANUAL' if x[9] else None)})" for x in E) + ";")
# compromissos do ano do orçamento: aluguel reajustado (12 × R$ 12 mil) e segurança contratada (12 × R$ 3 mil, conta sem histórico)
for num, codigo, cat, v, desc in [(9001, "3.1.01", "Aluguel e condomínio", 12000, "Aluguel reajustado"), (9002, "3.3.04", "Serviços e terceiros", 3000, "Vigilância contratada")]:
    pid = psql(f"INSERT INTO payables (numero, unit_id, fornecedor_nome, categoria, emissao, descricao, recorrente, valor_total, parcelas, status, natureza, conta_id) VALUES ({num}, {CAR}, 'Fornecedor {num} (teste)', '{cat}', '{H}', '{desc}', true, {v * 12}, 12, 'ATIVO', 'OPERACAO', {C[codigo]}) RETURNING id")
    psql(f"INSERT INTO payable_installments (payable_id, parcela, emissao, vencimento, valor) SELECT {pid}, g, '{H}', make_date({ANO}, g, 10), {v} FROM generate_series(1, 12) g")
ok(f"{len(E)} lançamentos de teste em 24 meses (base {BASE[0]:%m/%Y}–{BASE[-1]:%m/%Y}), 400 alunos (100 Carandá, 300 TV Morena I), centros padrão e compromissos de {ANO}")

print("Plano de contas")
hp = page("/financeiro/plano-de-contas", FS)
for k in ["Pessoal", "Pedagógico", "Ocupação", "Administrativo", "Comercial", "Financeiro", "Tributário", "Investimentos", "Não despesa", "Receitas", "Saídas com conta"]: assert k in hp, k
AID_CONTA = aid_of(page(f"/financeiro/plano-de-contas?aba=plano&nova={C['2.1.03']}", FS), ">Criar</button>")
okmsg(post("/financeiro/plano-de-contas", AID_CONTA, {"paiId": C["2.1.03"], "nome": "Laboratório de ciências — reagentes", "categoria": "Materiais e insumos", "economico": "OPEX", "comportamento": "VARIAVEL", "recorrencia": "EVENTUAL", "custo": "DIRETO", "indice": "IPCA", "driver": "ALUNOS", "centro": "UNIDADE", "palavras": "reagente, vidraria"}, FS), "2.1.03.001")
assert psql("SELECT nivel || '|' || categoria FROM chart_accounts WHERE codigo='2.1.03.001'") == "4|Materiais e insumos"
erro(post("/financeiro/plano-de-contas", AID_CONTA, {"paiId": C["3.1.01"], "nome": "Aluguel — bloco B", "categoria": "Aluguel e condomínio"}, FS), "já tem lançamentos")
hed = page(f"/financeiro/plano-de-contas?aba=plano&editar={C['3.1.01']}", FS); AID_ED = aid_of(hed, ">Salvar conta</button>")
erro(post("/financeiro/plano-de-contas", AID_ED, {"id": C["3.1.01"], "nome": "Aluguel", "categoria": "Manutenção", "economico": "OPEX", "comportamento": "FIXO", "recorrencia": "RECORRENTE", "custo": "INDIRETO", "indice": "IPCA", "driver": "NENHUM", "centro": "UNIDADE", "ativo": "1"}, FS), "categoria-ponte não muda")
erro(post("/financeiro/plano-de-contas", AID_CONTA, {"paiId": C["2.1.03"], "nome": "Teste da unidade", "categoria": "Materiais e insumos"}, DS), "Direção e pelo Financeiro")
page("/financeiro/plano-de-contas", RH, expect=(303, 307)); assert RH.get(B + "/api/export/plano-de-contas").status_code == 403
pc = csv_rows(FS, "/api/export/plano-de-contas", skip_titulo=False); assert pc[0][:4] == ["codigo", "conta", "nivel", "analitica"] and any(x[0] == "2.1.03.001" for x in pc)
ok("árvore padrão com 9 macrogrupos e receitas; subconta 2.1.03.001 criada (o pai vira grupo); conta com lançamentos não ganha subconta; categoria-ponte usada não muda; direção da unidade só vê; RH sem acesso; CSV do plano")

print("Classificação: fila, sugestões, regras e lançamento")
hf = page("/financeiro/plano-de-contas?aba=classificacao", FS)
for k in ["Folha docente (teste)", "Imobiliária Teste", "Fornecedor Novo Teste", "Concessionária Sem Histórico (teste)", "confiança alta"]: assert k in hf, k
okmsg(post("/financeiro/plano-de-contas", aid_of(hf, "sugestões de confiança alta"), {"voltar": "/financeiro/plano-de-contas?aba=classificacao"}, FS), "2 lançamento(s) classificado(s)")
assert psql(f"SELECT string_agg(a.codigo || ':' || c.classificacao_origem, ',' ORDER BY a.codigo) FROM cash_entries c JOIN chart_accounts a ON a.id=c.conta_id WHERE c.data='{H}' AND c.contraparte IN ('Folha docente (teste)', 'Imobiliária Teste')") == "1.1.01:SUGESTAO,3.1.01:SUGESTAO"
NOVO = psql("SELECT id FROM cash_entries WHERE contraparte='Fornecedor Novo Teste'")
hf = page("/financeiro/plano-de-contas?aba=classificacao", FS); AID_SEL = aid_of(hf, "Classificar as marcadas")
okmsg(post("/financeiro/plano-de-contas", AID_SEL, {"ids": NOVO, "modo": "CONTA", "contaId": C["3.3.04"], "centroId": CC["CAR"], "lembrar": "1", "voltar": "/financeiro/plano-de-contas?aba=classificacao"}, FS), "1 regra(s) criada(s)")
assert psql(f"SELECT a.codigo FROM cash_entries c JOIN chart_accounts a ON a.id=c.conta_id WHERE c.id={NOVO}") == "3.3.04" and psql("SELECT count(*) FROM classification_rules WHERE lower(padrao)='fornecedor novo teste' AND ativo") == "1"
PAP = psql("SELECT id FROM cash_entries WHERE contraparte='Papelaria Nova Teste'")
hl = page(f"/financeiro/lancamentos/{PAP}", FS); assert "Conta do plano e centro de custo" in hl
okmsg(post(f"/financeiro/lancamentos/{PAP}", aid_of(hl, ">Classificar</button>"), {"id": PAP, "contaId": C["4.2.01"], "centroId": CC["CAR"], "motivo": "Papel A4", "lembrar": "1", "voltar": f"/financeiro/lancamentos/{PAP}"}, FS), "classificado")
assert psql(f"SELECT classificacao_origem || '|' || (cost_center_id={CC['CAR']}) FROM cash_entries WHERE id={PAP}") == "MANUAL|true"
hr = page("/financeiro/plano-de-contas?aba=regras", FS); AID_REG = aid_of(hr, "Criar regra")
erro(post("/financeiro/plano-de-contas", AID_REG, {"padrao": "ab", "contaId": C["3.2.01"]}, FS), "3 letras")
okmsg(post("/financeiro/plano-de-contas", AID_REG, {"padrao": "Concessionária Sem Histórico", "contaId": C["3.2.02"], "centroId": CC["CAR"]}, FS), "Regra criada")
erro(post("/financeiro/plano-de-contas", AID_REG, {"padrao": "concessionária sem histórico", "contaId": C["3.2.02"]}, FS), "Já existe")
hf = page("/financeiro/plano-de-contas?aba=classificacao", FS); assert "Concessionária Sem Histórico (teste)" in hf and "regra" in hf.lower()
RES = psql("SELECT id FROM cash_entries WHERE contraparte='Concessionária Sem Histórico (teste)'")
RID = psql("SELECT id FROM classification_rules WHERE padrao='Concessionária Sem Histórico'")
okmsg(post("/financeiro/plano-de-contas", aid_of(page("/financeiro/plano-de-contas?aba=regras", FS), "Desativar"), {"id": RID}, FS), "desativada")
hr = page("/financeiro/plano-de-contas?aba=regras", FS); okmsg(post("/financeiro/plano-de-contas", aid_of(hr, "Aplicar aos lançamentos sem conta"), {"dias": "365"}, FS), "Nenhum lançamento")
assert psql(f"SELECT conta_id IS NULL FROM cash_entries WHERE id={RES}") == "t", "o resíduo continua sem conta (regra desativada)"
# competência fechada: detalhar dentro da mesma categoria pode; trocar a categoria não
psql(f"INSERT INTO recon_closings (competencia, company_id, recebido, conciliado, explicado, status, pct, fechado_por, fechado_em) VALUES ('{H[:7]}', NULL, 0, 0, 0, 'FECHADA', 100, {UDG}, now())")
GEN = psql("SELECT id FROM cash_entries WHERE contraparte='Despesas diversas (teste)'")
hl = page(f"/financeiro/lancamentos/{GEN}", FS); AID_CL = aid_of(hl, ">Classificar</button>")
erro(post(f"/financeiro/lancamentos/{GEN}", AID_CL, {"id": GEN, "contaId": C["3.3.01"], "voltar": f"/financeiro/lancamentos/{GEN}"}, FS), "Competência fechada")
okmsg(post(f"/financeiro/lancamentos/{GEN}", AID_CL, {"id": GEN, "contaId": C["4.2.02"], "voltar": f"/financeiro/lancamentos/{GEN}"}, FS), "classificado")
psql(f"UPDATE cash_entries SET conta_id={C['4.3.01']} WHERE id={GEN}"); psql(f"DELETE FROM recon_closings WHERE competencia='{H[:7]}'")
assert "Despesas diversas (teste)" not in page("/financeiro/plano-de-contas?aba=classificacao", FS)
hg = page("/financeiro/plano-de-contas?aba=classificacao&generica=1", FS); assert "Despesas diversas (teste)" in hg and "hoje em 4.3.01" in hg and "Sem conta ou em genérica" in hg, "a fila também revisa o que está na conta genérica"
ok("fila com sugestões; confiança alta (histórico da contraparte) aplicada em lote; marcadas com conta + “lembrar” criam regra; lançamento classificado na própria tela (com centro e regra); regra curta e duplicada recusadas, desativada não age; competência fechada: muda a conta dentro da categoria, não troca a categoria; a fila também traz o que está na conta genérica")

print("Contas a pagar com a conta do plano")
hn = page("/financeiro/contas-a-pagar/nova", FS); assert "Conta do plano de contas" in hn and "Centro de custo" in hn; AID_CP = aid_of(hn, "Salvar conta a pagar")
cp = {"unitId": CAR, "supplierId": "novo", "fornecedorNovo": "Fornecedor CP V28 (teste)", "cadastrar": "1", "tipoDocumento": "Boleto", "numeroDocumento": "V28-1", "emissao": H, "responsavelId": UFIN, "descricao": "Serviço de teste", "recorrente": "0", "valor": "300,00", "parcelas": "1", "primeiroVencimento": H, "intervalo": "MENSAL", "natureza": "OPERACAO"}
erro(post("/financeiro/contas-a-pagar/nova", AID_CP, cp, FS), "Escolha a conta do plano")
erro(post("/financeiro/contas-a-pagar/nova", AID_CP, {**cp, "contaId": C["9.1.01"]}, FS), "Transferência entre contas não é conta a pagar")
erro(post("/financeiro/contas-a-pagar/nova", AID_CP, {**cp, "contaId": C["1.1"]}, FS), "é um grupo")
loc = post("/financeiro/contas-a-pagar/nova", AID_CP, {**cp, "contaId": C["4.1.03"], "numeroDocumento": "V28-2", "supplierId": "novo", "fornecedorNovo": "Sistemas CP V28 (teste)"}, FS); okmsg(loc); P1 = re.search(r"/contas-a-pagar/(\d+)", loc).group(1)
assert psql(f"SELECT categoria || '|' || (cost_center_id={CC['CORP']}) || '|' || natureza FROM payables WHERE id={P1}") == "Serviços e terceiros|true|OPERACAO", "categoria vem da conta; conta corporativa → centro corporativo"
loc = post("/financeiro/contas-a-pagar/nova", AID_CP, {**cp, "contaId": C["8.2.02"], "numeroDocumento": "V28-3", "valor": "900,00", "supplierId": "novo", "fornecedorNovo": "Tecno CP V28 (teste)"}, FS); P2 = re.search(r"/contas-a-pagar/(\d+)", loc).group(1)
assert psql(f"SELECT natureza || '|' || categoria FROM payables WHERE id={P2}") == "INVESTIMENTO|Materiais e insumos", "CAPEX vira investimento"
hd = page(f"/financeiro/contas-a-pagar/{P1}", FS); assert "Conta do plano" in hd and "4.1.03" in hd and "Corporativo" in hd
ok("conta do plano obrigatória (categoria vem dela); transferência e grupo recusados; conta corporativa leva ao centro corporativo; CAPEX vira investimento; título mostra conta e centro")

print("DRE: saídas que não são despesa")
hdre = page(f"/financeiro/dre?ctx_p={BASE[8]:%Y-%m}", FS); assert "Saídas que não são despesa" in hdre, "principal de dívida fora das linhas da DRE"
ok("principal de empréstimo e adiantamentos ficam fora das linhas da DRE, numa linha de memória")

print("Rateio do corporativo e resultado por unidade")
hra = page(f"/financeiro/rateio?visao=mes&ctx_p={FIM_BASE}", FS); assert "provisoriamente" in hra and "Resultado por unidade" in hra
rows = {x[0]: x for x in csv_rows(FS, f"/api/export/resultado-rateio?periodo={FIM_BASE}&visao=mes")}; cab = csv_rows(FS, f"/api/export/resultado-rateio?periodo={FIM_BASE}&visao=mes")[0]
iR = cab.index("rateio_corporativo"); assert rows["Carandá"][iR] == "750" and rows["TV Morena I"][iR] == "2250", (rows["Carandá"], rows["TV Morena I"])
AID_RR = aid_of(hra, "Enviar para a Direção")
erro(post("/financeiro/rateio", AID_RR, {"nome": "Percentual errado", "base": "PERCENTUAL", "desde": f"{BASE[0]:%Y-%m}", "motivo": "Teste de soma diferente de cem", f"pct_{CAR}": "40", f"pct_{TVM1}": "50"}, FS), "precisam somar 100%")
okmsg(post("/financeiro/rateio", AID_RR, {"nome": "Corporativo por alunos", "base": "ALUNOS", "desde": f"{BASE[0]:%Y-%m}", "motivo": "Alunos representam o consumo do corporativo"}, FS), "Direção")
R1 = psql("SELECT id FROM allocation_rules ORDER BY id DESC LIMIT 1")
assert psql("SELECT count(*) FROM notifications WHERE titulo='Regra de rateio para aprovar'") == "2", "as duas pessoas da Direção são avisadas"
assert "regra(s) de rateio aguardando a Direção" in page("/pendencias", DG)
erro(post("/financeiro/rateio", aid_of(page("/financeiro/rateio", DG), ">Aprovar</button>"), {"id": R1, "decisao": "APROVAR"}, FS), "Só a Direção")
okmsg(post("/financeiro/rateio", aid_of(page("/financeiro/rateio", DG), ">Aprovar</button>"), {"id": R1, "decisao": "APROVAR", "motivo": "ok"}, DG), "aprovada")
loc = post("/financeiro/rateio", aid_of(page("/financeiro/rateio", DG), "Enviar para a Direção"), {"nome": "Percentual fixo", "base": "PERCENTUAL", "desde": FIM_BASE, "motivo": "Acordo entre as unidades para o rateio", f"pct_{CAR}": "40", f"pct_{TVM1}": "60"}, DG); okmsg(loc)
R2 = psql("SELECT id FROM allocation_rules ORDER BY id DESC LIMIT 1")
erro(post("/financeiro/rateio", aid_of(page("/financeiro/rateio", DG), ">Aprovar</button>"), {"id": R2, "decisao": "APROVAR", "motivo": "x"}, DG), "Quem propôs a regra não a aprova")
erro(post("/financeiro/rateio", aid_of(page("/financeiro/rateio", DG2), ">Aprovar</button>"), {"id": R2, "decisao": "REJEITAR"}, DG2), "Diga por que")
okmsg(post("/financeiro/rateio", aid_of(page("/financeiro/rateio", DG2), ">Aprovar</button>"), {"id": R2, "decisao": "APROVAR", "motivo": "Acordo registrado em ata"}, DG2), "aprovada")
rows = {x[0]: x for x in csv_rows(FS, f"/api/export/resultado-rateio?periodo={FIM_BASE}&visao=mes")}
assert rows["Carandá"][iR] == "1200" and rows["TV Morena I"][iR] == "1800", "a regra mais recente aprovada vale a partir do mês dela"
rows = {x[0]: x for x in csv_rows(FS, f"/api/export/resultado-rateio?periodo={BASE[-2]:%Y-%m}&visao=mes")}; assert rows["Carandá"][iR] == "750", "antes dela, a regra por alunos"
hra = page(f"/financeiro/rateio?visao=mes&ctx_p={FIM_BASE}", DS); assert "Carandá" in hra and "Propor nova regra" not in hra
assert {x[0] for x in csv_rows(DS, f"/api/export/resultado-rateio?periodo={FIM_BASE}&visao=mes")[1:]} == {"Carandá"}
ok("sem regra aprovada: rateio provisório por alunos (R$ 3 mil → 750 / 2.250); percentual que não soma 100 recusado; Direção avisada e com pendência; Financeiro não aprova; quem propõe não aprova; rejeição pede motivo; regra vigente pelo mês (40/60 desde o fim da base, alunos antes); direção da unidade vê só a sua linha")

URL = f"/financeiro/orcamento/historico?ano={ANO}"
page(URL, RH, expect=(303, 307))
print("Orçamento pelo histórico: parâmetros")
hpj = page(URL + "&etapa=projetar", FS); AID_P = aid_of(hpj, "Salvar e recalcular")
par = {"ano": ANO, "etapa": "projetar", "fimBase": FIM_BASE, "ipcaPct": "0", "dissidioPct": "5", "mesDissidio": "3", "reajusteMensalidadePct": "10", "mesReajusteMensalidade": "1", "nivelIpcaPct": "0", "nivelDissidioPct": "0", "nivelMensalidadePct": "0",
       "mesesFerias": ["1", "7"], "fatorFerias": "0,6", "outlierFator": "3", "outlierMinimo": "1.000", "eventoMinimo": "5.000", "usarContratos": "1", f"alunos_{CAR}": "110", f"alunos_{TVM1}": "300", f"alunos_{U['TVM2']}": "", f"alunos_{U['CUL']}": "",
       "otimista_alunosPct": "3", "otimista_ipcaPp": "0", "otimista_dissidioPp": "0", "otimista_mensalidadePp": "1", "estresse_alunosPct": "-10", "estresse_ipcaPp": "0", "estresse_dissidioPp": "1", "estresse_mensalidadePp": "-5"}
erro(post("/financeiro/orcamento/historico", AID_P, {**par, "fimBase": f"{ANO}-01"}, FS), "A base precisa terminar antes")
erro(post("/financeiro/orcamento/historico", AID_P, {**par, "ipcaPct": "abc"}, FS), "IPCA")
okmsg(post("/financeiro/orcamento/historico", AID_P, par, FS), "Parâmetros")
assert psql(f"SELECT (params->'alunosAlvo'->>'{CAR}') || '|' || (params->>'mesDissidio') FROM budget_plans WHERE ano={ANO}") == "110|3"
def memoria(versao="BASE", sess=FS, unidade=None):
    rs = csv_rows(sess, f"/api/export/orcamento-historico?ano={ANO}&versao={versao}" + (f"&unidade={unidade}" if unidade else "")); cab = rs[0]
    return cab, [dict(zip(cab, x)) for x in rs[1:]]
def total(linhas, unidade, conta):
    xs = [x for x in linhas if x["unidade"] == unidade and (x["conta"] or "").startswith(conta + " ") or (x["unidade"] == unidade and conta == x["categoria"] and not x["conta"])]
    return round(sum(float(x[f"total_{ANO}"]) for x in xs), 2)
ok("parâmetros do ano validados (base antes do ano, número) e salvos; alunos por unidade e mês do dissídio guardados")

print("Orçamento pelo histórico: higienização")
hh = page(URL + "&situacao=todos", FS)
for k in ["Higienizar a base", "Provável duplicidade", "Estorno ou devolução", "Investimento (CAPEX)", "Fora do padrão", "Evento de conta eventual", "Movimento interno", "Não é despesa"]: assert k in hh, k
ID = lambda desc: psql(f"SELECT id FROM cash_entries WHERE descricao={q(desc)}")
DUP, EST_S, EST_E, PICO, RESC, MOV = ID("Fatura UC 1 — manual"), ID("Banners"), ID("ESTORNO pagamento em dobro"), ID("Troca do compressor"), ID("Acordo trabalhista (teste)"), ID("Carteiras novas")
for i in [DUP, EST_S, EST_E, PICO, RESC, MOV]: assert f'name="id" value="{i}"' in hh, i
assert f'name="id" value="{ID("Fatura UC 1")}"' not in hh, "o original da duplicidade fica"
AID_S = aid_of(hh, ">Tirar da base</button>")
base_d = {"ano": ANO, "etapa": "higienizar"}
erro(post("/financeiro/orcamento/historico", AID_S, {**base_d, "id": DUP, f"sinal_{DUP}": "DUPLICADO", "decisao": "NORMALIZAR"}, FS), "só para lançamentos fora do padrão")
erro(post("/financeiro/orcamento/historico", AID_S, {**base_d, "id": DUP, f"sinal_{DUP}": "DUPLICADO", "decisao": "FORA"}, DS), "Só Direção e Financeiro")
okmsg(post("/financeiro/orcamento/historico", AID_S, {**base_d, "id": MOV, f"sinal_{MOV}": "INVESTIMENTO", "decisao": "MANTER", "motivo": "teste"}, FS), "mantidos")
cab, M = memoria(); assert total(M, "Carandá", "8.2.01") == 7000, "investimento mantido entra na base (IPCA 0)"
okmsg(post("/financeiro/orcamento/historico", AID_S, {**base_d, "id": MOV, "decisao": "SUGESTAO"}, FS), "de volta à sugestão")
okmsg(post("/financeiro/orcamento/historico", AID_S, {**base_d, "id": RESC, f"sinal_{RESC}": "EVENTO", "decisao": "FORA", "motivo": "Acordo de processo antigo"}, FS), "fora da base")
okmsg(post("/financeiro/orcamento/historico", aid_of(page(URL + "&sinal=ESTORNO", FS), "sugestões pendentes"), {"ano": ANO, "etapa": "higienizar", "sinal": "ESTORNO"}, FS), "2 sugestão")
assert psql(f"SELECT string_agg(decisao, ',') FROM budget_hygiene WHERE cash_entry_id IN ({EST_S}, {EST_E})") == "FORA,FORA"
ok("sinais: duplicidade (só a cópia), estorno (os dois lados), investimento, pico e evento; transferências, principal e adiantamento fora sozinhos; normalizar só pico; direção da unidade não decide; manter/voltar à sugestão muda a base; aceitar as sugestões de um tipo")

print("Orçamento pelo histórico: projeção conferida")
cab, M = memoria()
for k in ["unidade", "conta", "base_limpa", "a_precos_de_hoje", "reajuste_medio_pct", "volume_fator", "piso_contratos", f"jan_{ANO}", f"dez_{ANO}", f"total_{ANO}", "avisos", "origem_do_piso"]: assert k in cab, k
esperado = {"R.1.01": 1452000, "1.1.01": 250000, "3.1.01": 144000, "7.1.01": 72600, "4.1.01": 36000, "3.2.03": 6000, "3.2.01": 13234.56, "3.3.02": 13000, "1.3.03": 0, "5.1.02": 0, "8.2.01": 0, "3.3.04": 36000, "R.3.02": 0}
for conta, v in esperado.items(): assert abs(total(M, "Carandá", conta) - v) < 0.05, (conta, total(M, "Carandá", conta), v)
assert abs(total(M, "Carandá", "Serviços e terceiros") - 800) < 0.05, "resíduo sem conta: só o mês em que existe (sem estimar)"
assert total(M, "TV Morena I", "R.1.01") == 2640000 and total(M, "TV Morena I", "1.1.01") == 500000 and total(M, "TV Morena I", "3.1.01") == 180000
mens = next(x for x in M if x["unidade"] == "Carandá" and x["conta"].startswith("R.1.01 ")); assert mens[f"jan_{ANO}"] == "121000" and mens["volume_fator"] == "1.1", mens
sal = next(x for x in M if x["unidade"] == "Carandá" and x["conta"].startswith("1.1.01 ")); assert sal[f"fev_{ANO}"] == "20000" and sal[f"mar_{ANO}"] == "21000", sal
alug = next(x for x in M if x["unidade"] == "Carandá" and x["conta"].startswith("3.1.01 ")); assert alug["piso_contratos"] == "24000" and "Fornecedor 9001" in alug["origem_do_piso"], alug
net = next(x for x in M if x["unidade"] == "Carandá" and x["conta"].startswith("3.2.03 ")); assert "8 mês(es) sem histórico estimados pela média" in net["avisos"], net
seg = next(x for x in M if x["unidade"] == "Carandá" and x["conta"].startswith("3.3.04 ")); assert "sem histórico" in seg["avisos"]
pico = next(x for x in M if x["unidade"] == "Carandá" and x["conta"].startswith("3.3.02 ")); assert pico["normalizado"] == "29000", pico
assert not any(x["categoria"] in ("Transferência entre unidades", "Amortização de dívida", "Adiantamentos") for x in M), "fora da base: transferências, principal e adiantamento"
_, MO = memoria("OTIMISTA"); assert abs(total(MO, "Carandá", "R.1.01") - 100000 * 12 * 1.11 * 113 / 100) < 0.05
_, ME = memoria("ESTRESSE"); assert abs(total(ME, "Carandá", "R.1.01") - 100000 * 12 * 1.05 * 99 / 100) < 0.05 and abs(total(ME, "Carandá", "1.1.01") - (40000 + 10 * 21200)) < 0.05
hpj = page(URL + "&etapa=projetar", FS)
for k in ["As três versões", "Mês a mês em", "Resultado nas três versões", "Memória por conta", "O que vai para o orçamento", "Parâmetros de", "Folha aceita (ref.)", "piso: títulos a pagar"]: assert k in hpj, k
_, MD = memoria(sess=DS); assert {x["unidade"] for x in MD} == {"Carandá"}, "direção da unidade exporta só a sua"
ok("parâmetros validados e salvos; mensalidade = base × reajuste 10% × alunos 110/100 (R$ 1.452.000); dissídio 5% a partir de março (R$ 250 mil); ISS segue a receita (× 1,21); internet que começou no meio da base estimada nos 8 meses sem histórico; resíduo sem conta não é estimado; aluguel sobe ao piso do título do ano (+R$ 24 mil) e a vigilância contratada entra sem histórico; pico normalizado pela mediana; fora: rescisão decidida, estorno, investimento, transferências e dívida; versões otimista e estresse conferidas")

print("Orçamento pelo histórico: aplicação e governança")
if HOJE.month >= 10: assert f"Orçamento {ANO} ainda não aplicado" in page("/pendencias", FS) and f"Orçamento {ANO} ainda não aplicado" in page("/pendencias", DG)
hg = page(URL + "&etapa=governar", FS); assert "A Direção escolhe e aplica" in hg
hg = page(URL + "&etapa=governar", DG); AID_A = aid_of(hg, "Aplicar ao orçamento oficial"); assert "Tolerâncias e revisão mensal" in hg and "Banda saudável" in hg
erro(post("/financeiro/orcamento/historico", AID_A, {"ano": ANO, "etapa": "governar", "versao": "BASE", "motivo": "curto"}, DG), "mín. 10")
erro(post("/financeiro/orcamento/historico", AID_A, {"ano": ANO, "etapa": "governar", "versao": "BASE", "motivo": "Aprovado no comitê"}, FS), "Só a Direção")
okmsg(post("/financeiro/orcamento/historico", AID_A, {"ano": ANO, "etapa": "governar", "versao": "BASE", "motivo": "Versão base aprovada no comitê"}, DG), "aplicada")
bm = lambda tipo, cat, mes: psql(f"SELECT valor FROM budget_months WHERE ano={ANO} AND unit_id={CAR} AND tipo='{tipo}' AND categoria='{cat}' AND mes={mes}")
assert bm("SAIDA", "Pessoal", 2) == "20000.00" and bm("SAIDA", "Pessoal", 3) == "21000.00" and bm("ENTRADA", "Mensalidades", 1) == "121000.00" and bm("SAIDA", "Aluguel e condomínio", 1) == "12000.00" and bm("SAIDA", "Impostos e taxas", 1) == "6050.00"
assert psql(f"SELECT status || '|' || versao_aplicada || '|' || (resumo->>'celulas') FROM budget_plans WHERE ano={ANO}") == f"APLICADO|BASE|{psql(f'SELECT count(*) FROM budget_months WHERE ano={ANO}')}"
assert psql(f"SELECT count(*) FROM notifications WHERE titulo='Orçamento {ANO} aprovado'") != "0"
erro(post("/financeiro/orcamento/historico", AID_A, {"ano": ANO, "etapa": "governar", "versao": "ESTRESSE", "motivo": "Trocar pela versão estresse"}, DG), "substituir")
okmsg(post("/financeiro/orcamento/historico", AID_A, {"ano": ANO, "etapa": "governar", "versao": "ESTRESSE", "motivo": "Trocar pela versão estresse", "substituir": "1"}, DG), "estresse")
assert bm("SAIDA", "Pessoal", 3) == "21200.00" and bm("ENTRADA", "Mensalidades", 1) == str(round(100000 * 1.05 * 0.99, 2)) + "0"
ho = page(f"/financeiro/orcamento?ano={ANO}&unidade={CAR}", FS); assert "Orçamento pelo histórico" in ho
hg = page(URL + "&etapa=governar", DG); assert "Fotografia da aplicação" in hg and "versão estresse" in hg
assert f"Orçamento {ANO} ainda não aplicado" not in page("/pendencias", FS), "aplicado: a pendência sai"
audit = psql("SELECT count(*) FROM audit_log WHERE acao LIKE 'orçamento pelo histórico%'"); assert int(audit) >= 6, audit
ok("pendência até aplicar; Financeiro prepara, só a Direção aplica (com critério); orçamento mês a mês gravado por unidade e categoria (dissídio em março, mensalidade, piso, tributo); trocar de versão exige “substituir”; aviso às unidades; fotografia e trilha de auditoria")

print("Pendências, alertas, configurações e exportações")
hpe = page("/pendencias", FS); assert "saída(s) sem conta do plano" in hpe
hcc = page("/command-center", DG); assert "em conta genérica" in hcc, "alerta da conta genérica acima da meta"
hcfg = page("/configuracoes", RH); assert "Plano de contas, centros de custo e orçamento pelo histórico (v28)" in hcfg; AID_C = aid_of(hcfg, "Conta genérica: meta até")
erro(post("/configuracoes", AID_C, {"secao": "plano", "exigirConta": "1", "metaGenerica": "8", "janela": "120", "naoDespesa": "Amortização de dívida\nAdiantamentos"}, RH), "só a Direção")
hcfg = page("/configuracoes", DG); AID_C = aid_of(hcfg, "Conta genérica: meta até")
erro(post("/configuracoes", AID_C, {"secao": "plano", "exigirConta": "1", "metaGenerica": "8", "janela": "120", "naoDespesa": "Pessoal"}, DG), "não podem ficar fora")
okmsg(post("/configuracoes", AID_C, {"secao": "plano", "exigirConta": "1", "metaGenerica": "8", "janela": "120", "naoDespesa": "Amortização de dívida\nAdiantamentos"}, DG), "plano de contas")
assert psql("SELECT value->>'metaGenericaPct' FROM settings WHERE key='planoContas'") == "8"
AID_O = aid_of(page("/configuracoes", DG), "Evento a confirmar (R$)")
okmsg(post("/configuracoes", AID_O, {"secao": "orcamento", "ipca": "4,1", "dissidio": "6", "mesDissidio": "3", "mensalidade": "7", "mesMensalidade": "1", "ferias": "0,5", "outlier": "3", "outlierMin": "1.500", "evento": "8.000", "mesesFerias": ["1", "7", "12"], "contratos": "1"}, DG), "orçamento pelo histórico")
assert psql("SELECT (value->>'outlierMinimo') || '|' || (value->>'mesesFerias') FROM settings WHERE key='orcamentoHistorico'") == "1500|[1, 7, 12]"
lc = csv_rows(FS, f"/api/export/lancamentos-classificados?de={BASE[0]}&ate={H}"); assert lc[0][:6] == ["lancamento", "data", "unidade_pagadora", "tipo", "categoria", "conta"] and any(x[9] == "CORP · Corporativo (rede)" for x in lc[1:])
assert RH.get(B + f"/api/export/orcamento-historico?ano={ANO}").status_code == 403 and RH.get(B + "/api/export/resultado-rateio").status_code == 403
for k in ["Orçamento pelo histórico", "Plano de contas e custos", "Resultado por unidade (rateio)"]: assert k in page("/financeiro", FS), k
ok("pendência de saídas sem conta; alerta de conta genérica; configurações da v28 só pela Direção (não despesa não aceita Pessoal); exportações com conta, centro e unidade beneficiária; RH sem acesso; menu do Financeiro")
print(f"\nOK — {N[0]} blocos verificados.")
