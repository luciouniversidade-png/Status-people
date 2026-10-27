"""Dados de DEMONSTRAÇÃO da v28 (plano de contas, centros de custo, rateio e orçamento pelo histórico) — NUNCA rode em produção.
Roda com o servidor no ar, depois do demo_insights.py e do demo_v27.py. Tudo fictício e marcado como “(demo)”.
O que faz: abre o caixa de demonstração (um lançamento por categoria e mês) em contas do plano com contrapartes fictícias e centros de
custo; deixa as saídas das últimas semanas sem conta (para a fila de classificação mostrar as sugestões); cria regras de classificação;
planta casos para a higienização (duplicidade, estorno, pico fora do padrão, rescisão, transferências entre unidades, principal de
empréstimo, adiantamento, gasto pago por uma unidade para outra); propõe e aprova o critério de rateio; prepara e aplica o orçamento do ano.
Uso: python3 scripts/demo_v28.py   (servidor local em http://localhost:3100, banco de teste local via psql)."""
import re, subprocess, requests, hashlib, random
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo
B = "http://localhost:3100"
def psql(q): return subprocess.run(["su", "postgres", "-c", "/usr/lib/postgresql/16/bin/psql -h /tmp/pg -U status -d status_people -q -t -A -F '|' -v ON_ERROR_STOP=1"], input=q + ";", capture_output=True, text=True).stdout.strip()
def rodar(sql_txt):
    r = subprocess.run(["su", "postgres", "-c", "/usr/lib/postgresql/16/bin/psql -h /tmp/pg -U status -d status_people -q -v ON_ERROR_STOP=1"], input=sql_txt, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr[-3000:]
def mk(): s = requests.Session(); s.headers.update({"Origin": B}); return s
def action_ids(html): i = html.find("<main"); return re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', html[i:] if i >= 0 else html)
def post(path, aid, data, sess):
    f = [(f"$ACTION_ID_{aid}", (None, ""))]
    for k, v in data.items():
        for x in (v if isinstance(v, list) else [v]): f.append((k, (None, str(x))))
    r = sess.post(B + path, files=f, allow_redirects=False); m = re.search(r"rh_session=([^;]+)", r.headers.get("set-cookie", ""))
    if m: sess.headers["Cookie"] = f"rh_session={m.group(1)}"
    return requests.utils.unquote(r.headers.get("location", "")).replace("\xa0", " ")
def aid_of(html, marker):
    i = html.find(marker); assert i >= 0, marker
    fs = html.rfind("<form", 0, i); fe_prev = html.rfind("</form>", 0, i)
    if fs > fe_prev: fe = html.find("</form>", i)
    else: fs = html.find("<form", i); fe = html.find("</form>", fs)
    return action_ids(html[fs:fe])[0]
def page(path, sess): return sess.get(B + path).text.replace("\xa0", " ")
def login(email, senha):
    s = mk(); html = s.get(B + "/login").text; aid = re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', html)[0]; post("/login", aid, {"email": email, "senha": senha}, s); return s
def ok(loc, trecho=""): assert "ok=" in loc and trecho in loc, loc; return loc
def q(v): return "NULL" if v is None else str(v) if isinstance(v, (int, float)) else "'" + str(v).replace("'", "''") + "'"
HOJE = datetime.now(ZoneInfo("America/Campo_Grande")).date(); H = HOJE.isoformat(); ANO_ORC = HOJE.year + 1
random.seed(28)

if psql("SELECT count(*) FROM cash_entries WHERE descricao LIKE 'Demo %'") in ("", "0"): raise SystemExit("Rode antes o demo_insights.py (caixa de demonstração).")
if psql("SELECT count(*) FROM cash_entries WHERE contraparte LIKE '%(demo)' AND conta_id IS NOT NULL") not in ("", "0"): raise SystemExit("Demo v28 já carregada.")
FS, DG, DG2 = login("fin@demo", "senha12345"), login("dg@demo", "senha12345"), login("dg2@demo", "senha12345")
page("/financeiro/plano-de-contas?aba=centros", FS)  # garante os centros de custo padrão (corporativo, unidades e segmentos)
UFIN = psql("SELECT id FROM users WHERE email='fin@demo'")
U = {c: int(psql(f"SELECT id FROM units WHERE codigo='{c}'")) for c in ["CAR", "TVM1", "TVM2", "CUL"]}; NOME = {v: k for k, v in U.items()}
CONTA = {l.split("|")[0]: int(l.split("|")[1]) for l in psql("SELECT codigo, id FROM chart_accounts").splitlines()}
CC = {l.split("|")[0]: int(l.split("|")[1]) for l in psql("SELECT codigo, id FROM cost_centers").splitlines()}
CORP_CONTAS = {r for r in psql("SELECT codigo FROM chart_accounts WHERE centro_padrao='CORPORATIVO'").splitlines()}
ALUGUEL = {"CAR": "Imobiliária Horizonte (demo)", "TVM1": "Morena Imóveis e Participações (demo)", "TVM2": "Condomínio Empresarial Afonso Pena (demo)", "CUL": "Espólio Ramos Locações (demo)"}
# categoria do caixa de demonstração → contas do plano (parte do valor, contraparte fictícia)
MAPA = {
    "Pessoal": [("1.1.01", .55, "Folha docente (demo)"), ("1.2.01", .25, "Folha administrativa e apoio (demo)"), ("1.2.02", .12, "Folha coordenação e direção (demo)"), ("1.2.03", .08, "Folha equipe corporativa (demo)")],
    "Encargos e benefícios": [("1.3.01", .68, "INSS e FGTS — guias da folha (demo)"), ("1.3.02", .32, "Benefícios VT, VA e saúde (demo)")],
    "Aluguel e condomínio": [("3.1.01", .88, None), ("3.1.02", .12, "Condomínio e IPTU (demo)")],
    "Serviços e terceiros": [("3.2.01", .30, "Luz & Força Distribuidora (demo)"), ("3.2.02", .08, "Águas da Cidade (demo)"), ("3.2.03", .05, "Fibra Rápida Internet (demo)"), ("3.3.03", .19, "Brilho Total Limpeza (demo)"), ("3.3.04", .11, "Vigilância Guarda Forte (demo)"),
                             ("2.3.01", .10, "Plataforma Bilíngue Aprender+ (demo)"), ("4.1.01", .07, "Contábil Exata Assessoria (demo)"), ("4.1.03", .10, "Sistema de Gestão Escolar (demo)")],
    "Materiais e insumos": [("2.1.01", .58, "Editora Saber Sistema de Ensino (demo)"), ("2.1.02", .27, "Distribuidora Arte & Escola (demo)"), ("4.2.01", .15, "Papelaria Ponto Azul (demo)")],
    "Manutenção": [("3.3.02", .55, "Refrigeração Frio Bom (demo)"), ("3.3.01", .45, "Manutenção Predial Alfa (demo)")],
    "Marketing": [("5.1.01", .72, "Agência Digital Matrículas (demo)"), ("5.1.02", .28, "Gráfica Traço Fino (demo)")],
    "Impostos e taxas": [("7.1.01", .40, "Prefeitura — ISS (demo)"), ("7.1.02", .52, "Receita Federal — PIS/COFINS (demo)"), ("7.2.01", .08, "Taxas e alvarás municipais (demo)")],
    "Financeiras": [("6.1.01", .35, "Banco Demo — tarifas (demo)"), ("6.1.02", .65, "Cielo — taxas de cartão (demo)")],
    "Outras despesas": [("2.2.01", .40, "Eventos pedagógicos (demo)"), ("4.2.02", .25, "Correios e cartório (demo)"), ("4.3.01", .35, "Despesas diversas (demo)")],
    "Mensalidades": [("R.1.01", 1, "Mensalidades — recebimentos (demo)")], "Integral": [("R.1.02", 1, "Período integral — recebimentos (demo)")], "Material e taxas": [("R.2.01", 1, "Material e taxas — recebimentos (demo)")],
    "Eventos": [("R.3.01", 1, "Eventos e festas — recebimentos (demo)")], "Outras receitas": [("R.3.02", 1, "Cantina e locação de espaço (demo)")],
}
SEM_CONTA_DESDE = (HOJE - timedelta(days=42)).isoformat()  # saídas recentes ficam sem conta: a fila mostra as sugestões
orig = [l.split("|") for l in psql("SELECT id, unit_id, data, tipo, categoria, forma, valor, hash FROM cash_entries WHERE descricao LIKE 'Demo %' ORDER BY id").splitlines()]
linhas = []; apagar = []
for id_, unit, data, tipo, cat, forma, valor, hsh in orig:
    partes = MAPA.get(cat)
    if not partes: continue
    apagar.append(id_); v = round(float(valor), 2); unit = int(unit); cod_u = NOME[unit]; acum = 0.0
    for i, (codigo, pct, cp) in enumerate(partes):
        parte = round(v * pct, 2) if i < len(partes) - 1 else round(v - acum, 2); acum += parte
        if parte <= 0: continue
        cp = cp or ALUGUEL[cod_u]; d = date.fromisoformat(data); dd = min(d + timedelta(days=i % 3), HOJE) if d + timedelta(days=i % 3) <= HOJE else d
        sem = tipo == "SAIDA" and dd.isoformat() >= SEM_CONTA_DESDE
        conta = None if sem else CONTA[codigo]
        centro = None if sem else (CC["CORP"] if codigo in CORP_CONTAS else (None if random.random() < 0.08 else CC[cod_u]))
        desc = f"{cp.replace(' (demo)', '')} — {cod_u}"
        linhas.append((unit, dd.isoformat(), tipo, cat, forma or ("PIX" if tipo == "ENTRADA" else "TED"), desc, parte, cp, hashlib.md5(f"{hsh}|{codigo}".encode()).hexdigest(), conta, centro))
cols = "unit_id, data, tipo, categoria, forma, descricao, valor, contraparte, hash, conta_id, cost_center_id, classificado_por, classificado_em, classificacao_origem"
sqls = ["BEGIN;", f"DELETE FROM cash_entries WHERE id IN ({','.join(apagar)});"]
for i in range(0, len(linhas), 500):
    sqls.append(f"INSERT INTO cash_entries ({cols}) VALUES " + ",".join(f"({x[0]}, '{x[1]}', '{x[2]}', {q(x[3])}, {q(x[4])}, {q(x[5])}, {x[6]}, {q(x[7])}, '{x[8]}', {q(x[9])}, {q(x[10])}, {UFIN if x[9] else 'NULL'}, {'now()' if x[9] else 'NULL'}, {q('REGRA' if x[9] else None)})" for x in linhas[i:i + 500]) + ";")
# casos para a higienização da base do orçamento (todos dentro da base: os 12 meses completos antes do mês atual)
def dia(meses_atras, d):
    y, m = HOJE.year, HOJE.month - meses_atras
    while m < 1: m += 12; y -= 1
    return date(y, m, min(d, 28)).isoformat()
extra = []
def lanc(unit, data, tipo, cat, codigo, valor, cp, desc, centro="U", forma="TED"):
    cid = CONTA[codigo] if codigo else None; c = None if not cid else (CC["CORP"] if centro == "CORP" else CC[centro] if centro in CC else CC[NOME[unit]])
    extra.append((unit, data, tipo, cat, forma, desc, valor, cp, hashlib.md5(f"v28|{unit}|{data}|{desc}|{valor}".encode()).hexdigest(), cid, c))
# duplicidade: a mesma fatura de energia lançada duas vezes (importação + lançamento manual)
lanc(U["TVM1"], dia(7, 14), "SAIDA", "Serviços e terceiros", "3.2.01", 6418.37, "Luz & Força Distribuidora (demo)", "Fatura de energia — UC 4410982")
lanc(U["TVM1"], dia(7, 15), "SAIDA", "Serviços e terceiros", "3.2.01", 6418.37, "Luz & Força Distribuidora (demo)", "Fatura de energia — UC 4410982 (lançamento manual)")
# estorno: pagamento em dobro à gráfica devolvido pelo fornecedor
lanc(U["CAR"], dia(5, 9), "SAIDA", "Marketing", "5.1.02", 3150.00, "Gráfica Traço Fino (demo)", "Banners da festa junina — NF 2210")
lanc(U["CAR"], dia(5, 16), "ENTRADA", "Outras receitas", "R.3.02", 3150.00, "Gráfica Traço Fino (demo)", "ESTORNO — devolução do pagamento em dobro NF 2210", forma="PIX")
# pico fora do padrão: troca de compressor do ar-condicionado central
lanc(U["CUL"], dia(4, 20), "SAIDA", "Manutenção", "3.3.02", 36800.00, "Refrigeração Frio Bom (demo)", "Troca do compressor do ar-condicionado central")
# eventos de contas eventuais: rescisão de acordo e honorários de uma causa
lanc(U["TVM2"], dia(6, 10), "SAIDA", "Encargos e benefícios", "1.3.03", 24300.00, "Acordo trabalhista — processo 0012/2025 (demo)", "Acordo trabalhista homologado")
lanc(U["TVM1"], dia(3, 5), "SAIDA", "Serviços e terceiros", "4.1.02", 9800.00, "Advocacia Lima & Souza (demo)", "Honorários — ação de cobrança coletiva", centro="CORP")
# transferências entre unidades (fora da base automaticamente)
for k, (de, para, v) in enumerate([("TVM1", "CAR", 150000.00), ("TVM1", "CUL", 90000.00), ("TVM2", "CUL", 40000.00)]):
    dt = dia(8 - 2 * k, 12)
    lanc(U[de], dt, "SAIDA", "Transferência entre unidades", "9.1.01", v, f"Colégio Status — {para} (demo)", f"Transferência para {para}")
    lanc(U[para], dt, "ENTRADA", "Transferência entre unidades", None, v, f"Colégio Status — {de} (demo)", f"Transferência recebida de {de}", forma="PIX")
# empréstimo de capital de giro: principal (não é despesa) e juros (despesa financeira)
for k in range(1, 12):
    lanc(U["TVM1"], dia(k, 18), "SAIDA", "Amortização de dívida", "9.2.01", 12500.00, "Banco Demo — capital de giro (demo)", f"Parcela {12 - k}/24 — principal", centro="CORP")
    lanc(U["TVM1"], dia(k, 18), "SAIDA", "Financeiras", "6.2.02", round(2900 - 90 * (12 - k), 2), "Banco Demo — capital de giro (demo)", f"Parcela {12 - k}/24 — juros", centro="CORP")
# adiantamento a fornecedor (não é despesa: vira custo quando a nota chega)
lanc(U["CAR"], dia(2, 3), "SAIDA", "Adiantamentos", "9.3.01", 8000.00, "Editora Saber Sistema de Ensino (demo)", "Sinal do material didático 2027")
# gasto pago pela TV Morena I em benefício da Carandá (o centro leva o custo para a unidade beneficiária)
lanc(U["TVM1"], dia(3, 22), "SAIDA", "Manutenção", "3.3.01", 4700.00, "Manutenção Predial Alfa (demo)", "Pintura das salas do 2º andar — Carandá", centro="CAR")
sqls.append(f"INSERT INTO cash_entries ({cols}) VALUES " + ",".join(f"({x[0]}, '{x[1]}', '{x[2]}', {q(x[3])}, {q(x[4])}, {q(x[5])}, {x[6]}, {q(x[7])}, '{x[8]}', {q(x[9])}, {q(x[10])}, {UFIN if x[9] else 'NULL'}, {'now()' if x[9] else 'NULL'}, {q('MANUAL' if x[9] else None)})" for x in extra) + ";")
# regras de classificação aprendidas (contraparte → conta)
for padrao, codigo, usos in [("luz & forca distribuidora", "3.2.01", 48), ("aguas da cidade", "3.2.02", 48), ("fibra rapida internet", "3.2.03", 47), ("brilho total limpeza", "3.3.03", 48), ("cielo", "6.1.02", 100), ("editora saber", "2.1.01", 52), ("contabil exata", "4.1.01", 100), ("agencia digital matriculas", "5.1.01", 61)]:
    sqls.append(f"INSERT INTO classification_rules (padrao, conta_id, cost_center_id, unit_id, ativo, usos, created_by) SELECT {q(padrao)}, {CONTA[codigo]}, NULL, NULL, true, {usos}, {UFIN} WHERE NOT EXISTS (SELECT 1 FROM classification_rules WHERE lower(padrao)={q(padrao)} AND ativo);")
sqls.append("COMMIT;")
rodar("\n".join(sqls))
print(f"Caixa aberto em contas: {len(apagar)} lançamentos de categoria → {len(linhas)} por conta; {len(extra)} casos para a higienização e o rateio")

# rateio: o Financeiro propõe, a Direção aprova; uma segunda proposta fica aguardando
h = page("/financeiro/rateio", FS); AID_R = aid_of(h, "Enviar para a Direção")
ok(post("/financeiro/rateio", AID_R, {"nome": f"Corporativo por alunos {HOJE.year}", "base": "ALUNOS", "desde": f"{HOJE.year}-01", "motivo": "Contabilidade, sistemas, mídia e equipe corporativa atendem cada família: alunos atuais representam o consumo"}, FS), "Direção")
RID = psql("SELECT id FROM allocation_rules ORDER BY id DESC LIMIT 1")
hd = page("/financeiro/rateio", DG); ok(post("/financeiro/rateio", aid_of(hd, ">Aprovar</button>"), {"id": RID, "decisao": "APROVAR", "motivo": "Critério simples e auditável; revisar no fechamento do ano"}, DG), "aprovada")
ok(post("/financeiro/rateio", AID_R, {"nome": f"Corporativo por receita {ANO_ORC}", "base": "RECEITA", "desde": f"{ANO_ORC}-01", "motivo": "Proposta para o próximo ano: quem fatura mais usa mais a estrutura comercial e de cobrança"}, FS), "Direção")

# orçamento do próximo ano pelo histórico: parâmetros (reajustes de janeiro, como os da demonstração), decisões da higienização e aplicação
hp = page(f"/financeiro/orcamento/historico?ano={ANO_ORC}&etapa=projetar", FS); AID_P = aid_of(hp, "Salvar e recalcular")
fim = (date(HOJE.year, HOJE.month, 1) - timedelta(days=1)).isoformat()[:7]
params = {"ano": ANO_ORC, "etapa": "projetar", "fimBase": fim, "ipcaPct": "4,2", "dissidioPct": "6", "mesDissidio": "1", "reajusteMensalidadePct": "6,5", "mesReajusteMensalidade": "1", "nivelIpcaPct": "4,8", "nivelDissidioPct": "7", "nivelMensalidadePct": "7",
          "mesesFerias": ["1", "7"], "fatorFerias": "0,6", "outlierFator": "3", "outlierMinimo": "1.000", "eventoMinimo": "5.000", "usarContratos": "1",
          "otimista_alunosPct": "3", "otimista_ipcaPp": "-1", "otimista_dissidioPp": "0", "otimista_mensalidadePp": "1", "estresse_alunosPct": "-5", "estresse_ipcaPp": "2", "estresse_dissidioPp": "1", "estresse_mensalidadePp": "-2"}
for c, u in U.items(): params[f"alunos_{u}"] = ""
ok(post(f"/financeiro/orcamento/historico", AID_P, params, FS), "Parâmetros")
hh = page(f"/financeiro/orcamento/historico?ano={ANO_ORC}&situacao=todos", FS); AID_S = aid_of(hh, "Tirar da base")
def sinal_de(desc): return psql(f"SELECT id FROM cash_entries WHERE descricao={q(desc)} ORDER BY id DESC LIMIT 1")
dup = sinal_de("Fatura de energia — UC 4410982 (lançamento manual)"); comp = sinal_de("Troca do compressor do ar-condicionado central"); resc = sinal_de("Acordo trabalhista homologado")
assert f'value="{dup}"' in hh and f'value="{comp}"' in hh and f'value="{resc}"' in hh, "os sinais plantados aparecem na higienização"
ok(post("/financeiro/orcamento/historico", AID_S, {"ano": ANO_ORC, "etapa": "higienizar", "id": dup, f"sinal_{dup}": "DUPLICADO", "decisao": "FORA", "motivo": "Mesma fatura lançada à mão depois da importação do extrato"}, FS))
ok(post("/financeiro/orcamento/historico", AID_S, {"ano": ANO_ORC, "etapa": "higienizar", "id": comp, f"sinal_{comp}": "FORA_DO_PADRAO", "decisao": "NORMALIZAR", "motivo": "Troca de compressor: manutenção corretiva pontual"}, FS))
ok(post("/financeiro/orcamento/historico", AID_S, {"ano": ANO_ORC, "etapa": "higienizar", "id": resc, f"sinal_{resc}": "EVENTO", "decisao": "FORA", "motivo": "Acordo de um processo antigo, não se repete"}, FS))
hg = page(f"/financeiro/orcamento/historico?ano={ANO_ORC}&etapa=governar", DG)
ok(post("/financeiro/orcamento/historico", aid_of(hg, "Aplicar ao orçamento"), {"ano": ANO_ORC, "etapa": "governar", "versao": "BASE", "motivo": "Versão base aprovada no comitê financeiro; estresse fica como referência de reserva de caixa", "substituir": "1"}, DG), "aplicada")
print("Demo v28 carregada:", {"regra_rateio": RID, "orcamento": ANO_ORC, "valores_mes_a_mes": psql(f"SELECT count(*) FROM budget_months WHERE ano={ANO_ORC}"),
      "saidas_sem_conta": psql("SELECT count(*) FROM cash_entries WHERE tipo='SAIDA' AND conta_id IS NULL"), "sinais_decididos": psql("SELECT count(*) FROM budget_hygiene")})
