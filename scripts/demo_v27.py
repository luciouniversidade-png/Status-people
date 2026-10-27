"""Dados de DEMONSTRAÇÃO da v27 (contas a pagar e contratos com prazo) para testes e capturas — NUNCA rode em produção.
Roda depois do servidor no ar (banco migrado) e, de preferência, depois do demo_insights.py. Tudo fictício e marcado como “(demo)”.
Uso: python3 scripts/demo_v27.py   (servidor local em http://localhost:3100, banco de teste local via psql)."""
import re, subprocess, requests, json
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo
B = "http://localhost:3100"; TOKEN = "setup-homologacao-2026-status"
def psql(q): return subprocess.run(["su", "postgres", "-c", "/usr/lib/postgresql/16/bin/psql -h /tmp/pg -U status -d status_people -q -t -A -F '|' -v ON_ERROR_STOP=1"], input=q + ";", capture_output=True, text=True).stdout.strip()
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
HOJE = datetime.now(ZoneInfo("America/Campo_Grande")).date(); H = HOJE.isoformat()
def d(n): return (HOJE + timedelta(days=n)).isoformat()
def mes(n, dia):  # dia `dia` do mês deslocado n meses de hoje
    y, m = HOJE.year, HOJE.month + n
    while m < 1: m += 12; y -= 1
    while m > 12: m -= 12; y += 1
    return date(y, m, min(dia, 28 if m == 2 else 30)).isoformat()
def mod10(num):
    soma, peso = 0, 2
    for c in reversed(num): p = int(c) * peso; p = p // 10 + p % 10 if p > 9 else p; soma += p; peso = 1 if peso == 2 else 2
    r = soma % 10; return 0 if r == 0 else 10 - r
def mod11b(num):
    soma, peso = 0, 2
    for c in reversed(num): soma += int(c) * peso; peso = 2 if peso == 9 else peso + 1
    dv = 11 - soma % 11; return 1 if dv in (0, 10, 11) else dv
def boleto(banco, venc, centavos, livre):
    fator = 1000 + (date.fromisoformat(venc) - date(2025, 2, 22)).days; sem = f"{banco}9{fator:04d}{centavos:010d}{livre}"; cb = sem[:4] + str(mod11b(sem)) + sem[4:]
    c1, c2, c3 = cb[0:4] + cb[19:24], cb[24:34], cb[34:44]; return f"{c1}{mod10(c1)}{c2}{mod10(c2)}{c3}{mod10(c3)}{cb[4]}{cb[5:19]}"
def chave(k43):
    soma, peso = 0, 2
    for c in reversed(k43): soma += (ord(c) - 48) * peso; peso = 2 if peso == 9 else peso + 1
    r = soma % 11; return k43 + str(0 if r in (0, 1) else 11 - r)

RH = login("rh@colegiostatus", "Status2026!"); assert RH.get(B + f"/api/setup?token={TOKEN}").json()["ok"]
CAR = psql("SELECT id FROM units WHERE codigo='CAR'"); TVM1 = psql("SELECT id FROM units WHERE codigo='TVM1'") or CAR; ANO = H[:4]
# demonstração: cada unidade ligada à sua entidade (CNPJ) quando ainda não estiver
psql("UPDATE units SET company_id=(SELECT id FROM companies ORDER BY id LIMIT 1) WHERE company_id IS NULL AND codigo IN ('CAR','CUL')")
psql("UPDATE units SET company_id=(SELECT id FROM companies ORDER BY id OFFSET 1 LIMIT 1) WHERE company_id IS NULL AND codigo IN ('TVM1','TVM2')")
psql("UPDATE companies SET cnpj=CASE id WHEN (SELECT min(id) FROM companies) THEN '00.000.000/0001-00 (demo)' ELSE '11.111.111/0001-11 (demo)' END WHERE cnpj IS NULL OR cnpj=''")
html = page("/configuracoes", RH); aid_user = aid_of(html, "Criar acesso")
def user(nome, email, role, unit="", emp=""):
    if not psql(f"SELECT id FROM users WHERE email='{email}'"): post("/configuracoes", aid_user, {"nome": nome, "email": email, "role": role, "unitId": unit, "employeeId": emp, "senha": "senha12345"}, RH)
    return psql(f"SELECT id FROM users WHERE email='{email}'")
UFIN = user("Fernanda Financeiro (demo)", "fin@demo", "FINANCEIRO"); UDG = user("Diretora Geral (demo)", "dg@demo", "DIRECAO"); UDG2 = user("Diretor Adjunto (demo)", "dg2@demo", "DIRECAO")
FS, DG, DG2 = login("fin@demo", "senha12345"), login("dg@demo", "senha12345"), login("dg2@demo", "senha12345")
for cat, v in [("Aluguel e condomínio", 25000), ("Serviços e terceiros", 16000), ("Manutenção", 3000), ("Materiais e insumos", 4000), ("Marketing", 2000)]:
    psql(f"DELETE FROM budgets WHERE ano={ANO} AND unit_id={CAR} AND tipo='SAIDA' AND categoria='{cat}'"); psql(f"INSERT INTO budgets (ano, unit_id, tipo, categoria, valor_mensal) VALUES ({ANO}, {CAR}, 'SAIDA', '{cat}', {v})")
SUP = {n: psql(f"INSERT INTO suppliers (nome, servico, ativo) VALUES ('{n}', '{s}', true) RETURNING id") for n, s in [("Imobiliária Horizonte (demo)", "Locação"), ("Luz & Força Distribuidora (demo)", "Energia elétrica"), ("Fibra Rápida Internet (demo)", "Internet"),
    ("Brilho Total Limpeza (demo)", "Limpeza e conservação"), ("Águas da Cidade (demo)", "Água e esgoto"), ("Papelaria Ponto Azul (demo)", "Material de escritório"), ("Gráfica Traço Fino (demo)", "Gráfica"), ("Refrigeração Frio Bom (demo)", "Ar-condicionado")]}
psql(f"INSERT INTO contracts (supplier_id, unit_id, objeto, valor_mensal, inicio, fim, status, renovacao, aviso_previo_dias) VALUES ({SUP['Imobiliária Horizonte (demo)']}, {CAR}, 'Locação do prédio da unidade Carandá', 18500, '{mes(-3, 1)}', '{mes(33, 1)}', 'VIGENTE', 'MANUAL', 90)")
KTR = psql("SELECT id FROM contracts ORDER BY id DESC LIMIT 1")
psql(f"INSERT INTO cash_balances (unit_id, mes, saldo_inicial) SELECT u.id, '{H[:7]}', 420000 FROM units u WHERE NOT EXISTS (SELECT 1 FROM cash_balances c WHERE c.unit_id=u.id AND c.mes='{H[:7]}')")
AID = aid_of(page("/financeiro/contas-a-pagar/nova", FS), "Salvar conta a pagar")
def lancar(sess, **k):
    base = {"unitId": CAR, "tipoDocumento": "Boleto", "recorrente": "0", "parcelas": "1", "intervalo": "MENSAL", "ajustarDiaUtil": "1", "responsavelId": UFIN}
    if "conta" in k: k["contaId"] = psql(f"SELECT id FROM chart_accounts WHERE codigo='{k.pop('conta')}'")  # v28 · o título nasce com a conta do plano (a categoria vem dela)
    base.update(k); loc = post("/financeiro/contas-a-pagar/nova", AID, base, sess); assert "ok=" in loc, loc; return re.search(r"/contas-a-pagar/(\d+)", loc).group(1)
AID_DEC = None
def aprovar(pid, sess, motivo="Conferido com o contrato e o orçamento"):
    global AID_DEC
    if psql(f"SELECT status FROM payables WHERE id={pid}") != "AGUARDANDO_APROVACAO": return
    if not AID_DEC: AID_DEC = aid_of(page(f"/financeiro/contas-a-pagar/{pid}", sess), "Rejeitar")
    ok(post(f"/financeiro/contas-a-pagar/{pid}", AID_DEC, {"id": pid, "decisao": "APROVAR", "motivo": motivo}, sess))
ALUG = lancar(DG, supplierId=SUP["Imobiliária Horizonte (demo)"], contractId=KTR, conta="3.1.01", categoria="Aluguel e condomínio", numeroDocumento="CT-2026/014", emissao=mes(-3, 1), descricao="ALUGUEL — prédio Carandá", recorrente="1", valor="18.500,00", parcelas="12", primeiroVencimento=mes(-3, 10), responsavelId=UDG)
aprovar(ALUG, DG2, "Contrato de locação vigente; dupla checagem")
ENER = lancar(FS, supplierId=SUP["Luz & Força Distribuidora (demo)"], conta="3.2.01", categoria="Serviços e terceiros", numeroDocumento="UC 7781203", emissao=mes(-3, 1), descricao="Energia elétrica — Carandá", recorrente="1", valor="4.286,40", parcelas="12", primeiroVencimento=mes(-3, 15)); aprovar(ENER, DG)
NET = lancar(FS, supplierId=SUP["Fibra Rápida Internet (demo)"], conta="3.2.03", categoria="Serviços e terceiros", numeroDocumento="CLI-55120", emissao=mes(-3, 1), descricao="Internet 1 Gbps — Carandá", recorrente="1", valor="899,90", parcelas="12", primeiroVencimento=mes(-3, 5)); aprovar(NET, DG)
LIMP = lancar(FS, supplierId=SUP["Brilho Total Limpeza (demo)"], conta="3.3.03", categoria="Serviços e terceiros", numeroDocumento="CT-LIMP-08", emissao=mes(-3, 1), descricao="Limpeza e conservação — Carandá", recorrente="1", valor="6.200,00", parcelas="12", primeiroVencimento=mes(-3, 20)); aprovar(LIMP, DG)
AGUA = lancar(FS, supplierId=SUP["Águas da Cidade (demo)"], conta="3.2.02", categoria="Serviços e terceiros", numeroDocumento="MAT 30017", emissao=mes(-3, 1), descricao="Água e esgoto — Carandá", recorrente="1", valor="1.148,75", parcelas="12", primeiroVencimento=mes(-3, 12)); aprovar(AGUA, DG)
NFE = chave(f"50{mes(-1, 1)[2:4]}{mes(-1, 1)[5:7]}" + "31452780000144" + "55" + "001" + "000004512" + "1" + "40391827")
PAP = lancar(FS, supplierId=SUP["Papelaria Ponto Azul (demo)"], conta="4.2.01", categoria="Materiais e insumos", tipoDocumento="Nota fiscal", numeroDocumento="4512", chaveNfe=NFE, emissao=mes(-1, 3), descricao="Material de escritório e papel A4 (2º semestre)", valor="2.700,00", parcelas="3", primeiroVencimento=mes(-1, 18)); aprovar(PAP, DG)
REFR = lancar(FS, supplierId=SUP["Refrigeração Frio Bom (demo)"], conta="3.3.02", categoria="Manutenção", numeroDocumento="OS-2231", emissao=d(-4), descricao="Manutenção preventiva dos ar-condicionados (12 aparelhos)", valor="3.800,00", primeiroVencimento=d(6)); aprovar(REFR, DG, "Preventiva semestral: acima do orçado do mês, mas evita troca de compressor")
GRAF = lancar(FS, supplierId=SUP["Gráfica Traço Fino (demo)"], conta="5.1.02", categoria="Marketing", tipoDocumento="Nota fiscal", numeroDocumento="2290", emissao=d(-2), descricao="Material impresso da campanha de matrículas 2027", valor="4.800,00", parcelas="2", primeiroVencimento=d(8))
TELH = lancar(DG, supplierId="novo", fornecedorNovo="Construtora Telhado Bom (demo)", cadastrar="1", conta="8.1.01", categoria="Manutenção", natureza="INVESTIMENTO", numeroDocumento="ORC-118", emissao=d(-1), descricao="Reforma do telhado do bloco B", valor="128.000,00", parcelas="4", primeiroVencimento=d(35), responsavelId=UDG)
PROJ = lancar(FS, supplierId="novo", fornecedorNovo="Tecno Sala Equipamentos (demo)", cadastrar="1", conta="8.2.02", categoria="Materiais e insumos", natureza="INVESTIMENTO", tipoDocumento="Nota fiscal", numeroDocumento="NF 8812", emissao=mes(-1, 20), descricao="Projetores para 6 salas do Fundamental", valor="9.600,00", parcelas="3", primeiroVencimento=mes(-1, 25)); aprovar(PROJ, DG, "Previsto no plano de investimentos 2026 (salas do Fundamental)")
PORT = lancar(FS, supplierId="novo", fornecedorNovo="Serralheria Portão Forte (demo)", cadastrar="1", conta="3.3.01", categoria="Manutenção", natureza="EXTRAORDINARIA", tipoDocumento="Recibo", numeroDocumento="OS-77", emissao=d(-3), descricao="Conserto emergencial do portão da entrada", valor="1.350,00", primeiroVencimento=d(4)); aprovar(PORT, DG, "Portão travado na entrada dos alunos: conserto no mesmo dia")

# extrato do banco: débitos de cada parcela que venceu (um pago com juros; uma manual; uma vencida sem pagar; uma retida)
h = page("/financeiro/conciliacao?aba=contas", FS)
ok(post("/financeiro/conciliacao", aid_of(h, "Salvar conta"), {"apelido": "Banco Demo — Carandá", "banco": "Banco Demo", "agencia": "0001", "conta": "12345-6", "unitId": CAR, "tipo": "CORRENTE", "ativo": "1"}, FS))
CONTA = psql("SELECT id FROM bank_accounts ORDER BY id DESC LIMIT 1")
parc = [l.split("|") for l in psql(f"SELECT i.id, i.payable_id, i.parcela, i.vencimento, i.valor FROM payable_installments i JOIN payables p ON p.id=i.payable_id WHERE p.status='ATIVO' AND i.vencimento < '{H}' ORDER BY i.vencimento").splitlines()]
ENER_VENC = max((x for x in parc if x[1] == ENER), key=lambda x: x[3]); LIMP_ULT = max((x for x in parc if x[1] == LIMP), key=lambda x: x[3]); NET_ULT = max((x for x in parc if x[1] == NET), key=lambda x: x[3]); LIMP_PRI = min((x for x in parc if x[1] == LIMP), key=lambda x: x[3])
itens = []
for inst, pid, n, venc, valor in parc:
    if inst in (ENER_VENC[0], LIMP_ULT[0], LIMP_PRI[0]): continue
    v = float(valor) + (20.0 if inst == NET_ULT[0] else 0); dt = (date.fromisoformat(venc) + timedelta(days=3 if inst == NET_ULT[0] else 0)).isoformat()
    if dt > H: dt = H
    itens.append((dt, -v, f"DEMO{inst}", "PAGAMENTO FORNECEDOR", "PAG BOLETO"))
ofx = "OFXHEADER:100\nDATA:OFXSGML\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>\n" + "".join(f"<STMTTRN>\n<TRNTYPE>{'CREDIT' if v > 0 else 'DEBIT'}\n<DTPOSTED>{dt.replace('-', '')}120000\n<TRNAMT>{v:.2f}\n<FITID>{fid}\n<NAME>{nome}\n<MEMO>{memo}\n</STMTTRN>\n" for dt, v, fid, nome, memo in itens) + "</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>"
h = page("/financeiro/conciliacao?aba=contas", FS); loc = post("/financeiro/conciliacao", aid_of(h, 'name="contaId"'), {"contaId": CONTA, "csv": ofx, "lancarCaixa": "1"}, FS); assert "novo(s)" in loc, loc
# confirma os pares únicos pela tela de contas a pagar (como o Financeiro faria) — menos a internet do último mês (veio com juros)
hp = page("/financeiro/contas-a-pagar", FS); pares = re.findall(r'<input[^>]*name="par"[^>]*value="(\d+:\d+)"', hp)
ok(post("/financeiro/contas-a-pagar", aid_of(hp, "Confirmar as baixas marcadas"), {"par": pares, "voltar": "/financeiro/contas-a-pagar"}, FS))
linha_net = psql(f"SELECT id FROM bank_lines WHERE documento='DEMO{NET_ULT[0]}'")
hd = page(f"/financeiro/contas-a-pagar/{NET}", FS)
ok(post(f"/financeiro/contas-a-pagar/{NET}", aid_of(hd, "Registrar baixa com o débito"), {"id": NET_ULT[0], "lineId": linha_net, "juros": "20,00", "voltar": "/"}, FS))
ok(post(f"/financeiro/contas-a-pagar/{LIMP}", aid_of(hd, "Registrar baixa manual"), {"id": LIMP_PRI[0], "data": LIMP_PRI[3], "valorPago": "6.200,00", "forma": "Transferência", "motivo": "Pago pela conta antiga, encerrada antes da importação do extrato", "voltar": "/"}, FS))
ok(post(f"/financeiro/contas-a-pagar/{LIMP}", aid_of(hd, "Reter a parcela"), {"id": LIMP_ULT[0], "acao": "reter", "motivo": "Nota fiscal com valor divergente do contrato (cobrou 2 postos a mais)", "voltar": "/"}, FS))
# programação dos próximos dias + boleto do aluguel do mês que vem
prox = [l.split("|") for l in psql(f"SELECT i.id, i.payable_id, i.vencimento, i.valor FROM payable_installments i JOIN payables p ON p.id=i.payable_id WHERE p.status='ATIVO' AND i.status='A_PAGAR' AND NOT i.retida AND i.vencimento BETWEEN '{H}' AND '{d(20)}' ORDER BY i.vencimento").splitlines()]
hp = page("/financeiro/contas-a-pagar", FS); AIDP = aid_of(hp, "Programar as marcadas")
alug_prox = next((x for x in prox if x[1] == ALUG), None)
for x in prox[:4]: post("/financeiro/contas-a-pagar", AIDP, {"ids": x[0], "data": max(H, (date.fromisoformat(x[2]) - timedelta(days=1)).isoformat()), "contaId": CONTA, "voltar": "/"}, FS)
if alug_prox:
    hd = page(f"/financeiro/contas-a-pagar/{ALUG}", FS)
    ok(post(f"/financeiro/contas-a-pagar/{ALUG}", aid_of(hd, "Conferir e vincular"), {"id": alug_prox[0], "boleto": boleto("341", alug_prox[2], int(round(float(alug_prox[3]) * 100)), "1570000140392001234500001"), "voltar": "/"}, FS))
psql(f"INSERT INTO attachments (entidade, entidade_id, nome, mime, tamanho, dados, unit_id) SELECT 'payable', id, 'documento-demo.pdf', 'application/pdf', 9, '\\x255044462d312e34'::bytea, unit_id FROM payables WHERE id IN ({ALUG}, {ENER}, {NET}, {AGUA}, {PAP})")

# caixa projetado da rede com reserva mínima (Configurações → Insights): mostra a linha da reserva e o aviso
psql("INSERT INTO settings (key, value) VALUES ('fpa', '{\"reservaMinima\": 7500000}'::jsonb) ON CONFLICT (key) DO UPDATE SET value = settings.value || '{\"reservaMinima\": 7500000}'::jsonb")

# contratos com prazo (RH): experiência vencendo, esquecida, em curso, prorrogada; estágio sem término; temporário
GE = psql("SELECT id FROM employees WHERE situacao='ATIVO' AND unit_id=" + CAR + " ORDER BY admissao LIMIT 1") or psql(f"INSERT INTO employees (nome, unit_id, vinculo, admissao) VALUES ('Coordenação Demo', {CAR}, 'CLT', '2019-02-01') RETURNING id")
for nome, vinc, adm in [("Ana Beatriz Moura (demo)", "CLT", -40), ("Caio Henrique Lima (demo)", "CLT", -50), ("Juliana Prado (demo)", "CLT", -15), ("Rafael Nogueira (demo)", "HORISTA", -62), ("Letícia Campos (demo)", "ESTAGIARIO", -650), ("Marcos Vieira (demo)", "TEMPORARIO", -172)]:
    psql(f"INSERT INTO employees (nome, unit_id, vinculo, admissao, gestor_id) VALUES ('{nome}', {CAR}, '{vinc}', '{d(adm)}', {GE})")
rafa = psql("SELECT id FROM employees WHERE nome='Rafael Nogueira (demo)'"); ana = psql("SELECT id FROM employees WHERE nome='Ana Beatriz Moura (demo)'")
psql(f"INSERT INTO employment_terms (employee_id, tipo, etapa, vence_em, recomendacao, recomendacao_motivo, recomendado_por, recomendado_em, decisao, motivo, decidido_por, decidido_em) VALUES ({rafa}, 'EXPERIENCIA', 1, '{d(-62 + 44)}', 'PRORROGAR', 'Boa didática; precisa firmar a rotina de diários', {UDG}, now() - interval '20 days', 'PRORROGAR', 'Seguindo a recomendação da coordenação', (SELECT id FROM users WHERE email='rh@colegiostatus'), now() - interval '19 days')")
psql(f"INSERT INTO employment_terms (employee_id, tipo, etapa, vence_em, recomendacao, recomendacao_motivo, recomendado_por, recomendado_em) VALUES ({ana}, 'EXPERIENCIA', 1, '{d(4)}', 'EFETIVAR', 'Ótima adaptação à secretaria, pontual e cordial com as famílias', {UDG}, now() - interval '1 day')")
print("Demo v27 carregada:", {"aluguel": ALUG, "energia": ENER, "internet": NET, "limpeza": LIMP, "agua": AGUA, "papelaria": PAP, "refrigeracao": REFR, "grafica": GRAF, "telhado": TELH, "projetores": PROJ, "portao": PORT, "pares_confirmados": len(pares)})
