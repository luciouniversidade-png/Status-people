# E2E — v27 · Contas a pagar (estilo XFIN + catálogo de controladoria) e Contratos com prazo (RH).
# Contas a pagar: lançamento recorrente (servidor gera as parcelas) e parcelado (tabela editada), alçada, orçamento e dupla checagem,
# quem lança não aprova, boleto (linha digitável) e NF-e com DV conferido e sem duplicidade, sugestão de baixa pelo extrato e baixa em lote,
# juros/diferença, débito sem reuso, segregação aprovar × pagar, desfazer, competência fechada, retenção (contestação), programação + borderô,
# caixa projetado, editar/cancelar/estender, exportação, alertas, pendências, contrato, configurações e permissões;
# natureza da despesa (operação, investimento, extraordinária) e reserva mínima de caixa da rede.
# Contratos com prazo: experiência 45+45 (vencendo/vencido), estágio (TCE e limite de 2 anos), temporário (180+90), recomendação do gestor,
# decisão do RH, pendências, Minha equipe e fatores associados às saídas.
import re, subprocess, requests, json
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo
B = "http://localhost:3100"; TOKEN = "setup-homologacao-2026-status"
def psql(q): return subprocess.run(["su", "postgres", "-c", "/usr/lib/postgresql/16/bin/psql -h /tmp/pg -U status -d status_people -q -t -A -F '|' -v ON_ERROR_STOP=1"], input=q + ";", capture_output=True, text=True).stdout.strip()
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
def post(path, aid, data, sess, files=None):
    f = [(f"$ACTION_ID_{aid}", (None, ""))]
    for k, v in data.items():
        for x in (v if isinstance(v, list) else [v]): f.append((k, (None, str(x))))
    if files: f += files
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
HOJE = datetime.now(ZoneInfo("America/Campo_Grande")).date(); H = HOJE.isoformat()
def d(n): return (HOJE + timedelta(days=n)).isoformat()
# documentos: linha digitável de boleto bancário e chave de NF-e válidas (mesma aritmética da FEBRABAN/SEFAZ)
def mod10(num):
    soma, peso = 0, 2
    for c in reversed(num):
        p = int(c) * peso; p = p // 10 + p % 10 if p > 9 else p; soma += p; peso = 1 if peso == 2 else 2
    r = soma % 10; return 0 if r == 0 else 10 - r
def mod11b(num):
    soma, peso = 0, 2
    for c in reversed(num): soma += int(c) * peso; peso = 2 if peso == 9 else peso + 1
    dv = 11 - soma % 11; return 1 if dv in (0, 10, 11) else dv
def boleto(banco, venc, centavos, livre="1090000012345678901234567"):
    fator = 1000 + (date.fromisoformat(venc) - date(2025, 2, 22)).days; sem = f"{banco}9{fator:04d}{centavos:010d}{livre}"; cb = sem[:4] + str(mod11b(sem)) + sem[4:]
    c1, c2, c3 = cb[0:4] + cb[19:24], cb[24:34], cb[34:44]; return f"{c1}{mod10(c1)}{c2}{mod10(c2)}{c3}{mod10(c3)}{cb[4]}{cb[5:19]}"
def chave(k43):
    soma, peso = 0, 2
    for c in reversed(k43): soma += (ord(c) - 48) * peso; peso = 2 if peso == 9 else peso + 1
    r = soma % 11; return k43 + str(0 if r in (0, 1) else 11 - r)

print("Preparação")
RH = login("rh@colegiostatus", "Status2026!"); r = RH.get(B + f"/api/setup?token={TOKEN}"); assert r.json()["ok"], r.text
CAR = psql("SELECT id FROM units WHERE codigo='CAR'"); ANO = H[:4]
html = page("/configuracoes", RH); aid_user = aid_of(html, "Criar acesso")
def criar_user(nome, email, role, unit="", emp=""):
    post("/configuracoes", aid_user, {"nome": nome, "email": email, "role": role, "unitId": unit, "employeeId": emp, "senha": "senha12345"}, RH); return psql(f"SELECT id FROM users WHERE email='{email}'")
GE = psql(f"INSERT INTO employees (nome, unit_id, vinculo, admissao) VALUES ('Gestora Prazo Teste', {CAR}, 'CLT', '2020-02-03') RETURNING id")
UFIN = criar_user("Financeiro Rede", "fin@rede", "FINANCEIRO"); UDG = criar_user("Diretora Geral", "dg@rede", "DIRECAO"); UDG2 = criar_user("Diretor Adjunto", "dg2@rede", "DIRECAO")
UDIR = criar_user("Diretora Carandá", "dir@car", "DIRETOR_UNIDADE", CAR); UGE = criar_user("Gestora Prazo", "ges@car", "GESTOR", CAR, GE)
FS = login("fin@rede", "senha12345"); DG = login("dg@rede", "senha12345"); DG2 = login("dg2@rede", "senha12345"); DS = login("dir@car", "senha12345"); GS = login("ges@car", "senha12345")
psql(f"INSERT INTO budgets (ano, unit_id, tipo, categoria, valor_mensal) VALUES ({ANO}, {CAR}, 'SAIDA', 'Aluguel e condomínio', 20000), ({ANO}, {CAR}, 'SAIDA', 'Serviços e terceiros', 1000)")
def CONTA_PLANO(codigo): return psql(f"SELECT id FROM chart_accounts WHERE codigo='{codigo}'")  # v28 · o título nasce com a conta do plano (a categoria vem dela)
SUP = psql("INSERT INTO suppliers (nome, servico, ativo) VALUES ('Imobiliária Horizonte (fictícia)', 'Aluguel', true) RETURNING id")
SUP2 = psql("INSERT INTO suppliers (nome, servico, ativo) VALUES ('Manutenção Predial Alfa (fictícia)', 'Serviços', true) RETURNING id")
psql(f"INSERT INTO cash_balances (unit_id, mes, saldo_inicial) SELECT id, '{H[:7]}', 100000 FROM units")
ok("Financeiro, duas pessoas da Direção, direção da unidade e gestora; orçamento de aluguel (R$ 20 mil/mês) e serviços (R$ 1 mil/mês)")

print("Lançamento recorrente (aluguel 12 × R$ 1.500) — parcelas geradas no servidor, alçada")
hn = page("/financeiro/contas-a-pagar/nova", FS)
for k in ["Nova conta a pagar", "Linha digitável do boleto", "Chave de acesso da NF-e", "Responsável pela despesa", "Dia do primeiro vencimento", "Recorrente"]: assert k in hn, k
AID_CRIAR = aid_of(hn, "Salvar conta a pagar")
page("/financeiro/contas-a-pagar/nova", RH, expect=(303, 307)); page("/financeiro/contas-a-pagar", RH, expect=(303, 307))
base_aluguel = {"unitId": CAR, "supplierId": SUP, "contaId": CONTA_PLANO("3.1.01"), "categoria": "Aluguel e condomínio", "tipoDocumento": "Boleto", "numeroDocumento": "ALUG-2026", "emissao": d(-20), "responsavelId": UFIN, "descricao": "ALUGUEL", "recorrente": "1", "valor": "1.500,00", "parcelas": "12", "primeiroVencimento": d(-2), "intervalo": "MENSAL"}
loc = post("/financeiro/contas-a-pagar/nova", AID_CRIAR, base_aluguel, FS); okmsg(loc, "enviada para aprovação"); P1 = re.search(r"/contas-a-pagar/(\d+)", loc).group(1)
assert psql(f"SELECT count(*) || '|' || sum(valor) || '|' || min(competencia) FROM payable_installments WHERE payable_id={P1}") == f"12|18000.00|{d(-20)[:7]}"
assert psql(f"SELECT status || '|' || aprovacoes_necessarias || '|' || primeiro_vencimento || '|' || (company_id IS NOT DISTINCT FROM (SELECT company_id FROM units WHERE id={CAR})) FROM payables WHERE id={P1}") == f"AGUARDANDO_APROVACAO|1|{d(-2)}|true"
assert psql("SELECT count(*) FROM notifications WHERE titulo='Conta a pagar aguardando aprovação'") == "2", "as duas pessoas da Direção são avisadas"
# dia-âncora: o vencimento de cada mês segue o dia do 1º vencimento (limitado ao fim do mês)
dia = int(d(-2)[8:]); vencs = psql(f"SELECT string_agg(to_char(vencimento,'DD'), ',' ORDER BY parcela) FROM payable_installments WHERE payable_id={P1}").split(",")
assert all(int(v) == dia or int(v) >= 28 for v in vencs), vencs
ok("12 parcelas recorrentes de R$ 1.500 (R$ 18 mil) geradas no servidor, dia-âncora mantido, competência por parcela; acima da alçada → aguardando aprovação; Direção avisada")
hp = page(f"/financeiro/contas-a-pagar/{P1}", FS); assert "Aguardando aprovação" in hp and "Acima da alçada" in hp and "Você lançou este título: outra pessoa com a alçada decide" in hp
AID_DEC = aid_of(page(f"/financeiro/contas-a-pagar/{P1}", DG), "Rejeitar")
erro(post(f"/financeiro/contas-a-pagar/{P1}", AID_DEC, {"id": P1, "decisao": "APROVAR"}, FS), "alçada")
assert "Contas a pagar" in page("/pendencias", DG2) and "ALUGUEL" in page("/pendencias", DG2)
okmsg(post(f"/financeiro/contas-a-pagar/{P1}", AID_DEC, {"id": P1, "decisao": "APROVAR", "motivo": "Contrato de locação vigente"}, DG), "Aprovada")
assert psql(f"SELECT status || '|' || jsonb_array_length(aprovacoes) FROM payables WHERE id={P1}") == "ATIVO|1"
ok("Financeiro não aprova (alçada); aparece nas pendências da Direção; Diretora Geral aprova → em aberto")

print("Parcelado com tabela editada, boleto e NF-e; orçamento; duplicidades")
NFE = chave(f"50{H[2:4]}{H[5:7]}12345678000195550010000123451" + "12345678")
BOL = boleto("341", d(-1), 33334)
parcelas = [{"parcela": 1, "emissao": d(-5), "vencimento": d(-1), "competencia": d(-5)[:7], "valor": 333.34}, {"parcela": 2, "emissao": d(-5), "vencimento": d(29), "competencia": d(-5)[:7], "valor": 333.33}, {"parcela": 3, "emissao": d(-5), "vencimento": d(59), "competencia": d(-5)[:7], "valor": 333.33}]
base_serv = {"unitId": CAR, "supplierId": SUP2, "contaId": CONTA_PLANO("3.3.03"), "categoria": "Serviços e terceiros", "tipoDocumento": "Nota fiscal", "numeroDocumento": "12345", "emissao": d(-5), "responsavelId": UFIN, "descricao": "Manutenção do ar-condicionado", "recorrente": "0", "valor": "1.000,00", "parcelas": "3", "primeiroVencimento": d(-1), "intervalo": "MENSAL", "boleto": BOL, "chaveNfe": NFE, "parcelasJson": json.dumps(parcelas)}
errado = [dict(x) for x in parcelas]; errado[2]["valor"] = 300
erro(post("/financeiro/contas-a-pagar/nova", AID_CRIAR, {**base_serv, "parcelasJson": json.dumps(errado)}, FS), "não bate com o valor total")
erro(post("/financeiro/contas-a-pagar/nova", AID_CRIAR, {**base_serv, "boleto": BOL[:-1] + str((int(BOL[-1]) + 1) % 10)}, FS), "Boleto:")
erro(post("/financeiro/contas-a-pagar/nova", AID_CRIAR, {**base_serv, "boleto": boleto("341", d(-1), 50000)}, FS), "O boleto é de R$ 500,00")
erro(post("/financeiro/contas-a-pagar/nova", AID_CRIAR, {**base_serv, "chaveNfe": NFE[:-1] + str((int(NFE[-1]) + 1) % 10)}, FS), "Chave da NF-e")
loc = post("/financeiro/contas-a-pagar/nova", AID_CRIAR, base_serv, FS); okmsg(loc, "lançada com 3 parcela"); P2 = re.search(r"/contas-a-pagar/(\d+)", loc).group(1)
assert psql(f"SELECT string_agg(valor::text, ',' ORDER BY parcela) FROM payable_installments WHERE payable_id={P2}") == "333.34,333.33,333.33"
assert psql(f"SELECT status || '|' || chave_nfe FROM payables WHERE id={P2}") == f"ATIVO|{NFE}" and psql(f"SELECT codigo_barras IS NOT NULL FROM payable_installments WHERE payable_id={P2} AND parcela=1") == "t"
erro(post("/financeiro/contas-a-pagar/nova", AID_CRIAR, {**base_serv, "numeroDocumento": "99999", "chaveNfe": ""}, FS), "Este boleto já está em")
erro(post("/financeiro/contas-a-pagar/nova", AID_CRIAR, {**base_serv, "numeroDocumento": "99999", "boleto": ""}, FS), "Esta NF-e já está lançada")
erro(post("/financeiro/contas-a-pagar/nova", AID_CRIAR, {**base_serv, "boleto": "", "chaveNfe": ""}, FS), "Parece duplicado")
hd = page(f"/financeiro/contas-a-pagar/{P2}", FS); assert "NF-e nº 12.345 série 1" in hd and "12.345.678/0001-95" in hd and "✓ Itaú" in hd and "Ações da parcela 1/3" in hd
ok("tabela editada (333,34 + 333,33 + 333,33) com boleto Itaú e NF-e conferidos; soma errada, DV errado, valor do boleto diferente, boleto/NF-e/documento repetidos → recusados")
loc = post("/financeiro/contas-a-pagar/nova", AID_CRIAR, {**base_serv, "numeroDocumento": "777", "boleto": "", "chaveNfe": "", "descricao": "Pintura emergencial", "valor": "1.200,00", "parcelas": "1", "primeiroVencimento": H, "emissao": H, "parcelasJson": ""}, FS)
okmsg(loc, "estoura o orçado"); P3 = re.search(r"/contas-a-pagar/(\d+)", loc).group(1)
assert "passa do orçado" in page(f"/financeiro/contas-a-pagar/{P3}", FS)
erro(post("/financeiro/contas-a-pagar/nova", AID_CRIAR, {**base_serv, "unitId": "", "numeroDocumento": "888", "boleto": "", "chaveNfe": "", "parcelasJson": ""}, FS), "entidade")
ok("R$ 1.200 de serviços num mês com R$ 1.000 orçados → aprovação (estoura o orçado, mesmo abaixo da alçada); conta da rede exige a entidade (CNPJ)")

print("Baixa pelo extrato: sugestão, lote, juros, sem reuso, segregação, desfazer, competência")
h = page("/financeiro/conciliacao?aba=contas", FS)
okmsg(post("/financeiro/conciliacao", aid_of(h, "Salvar conta"), {"apelido": "Banco Teste — Carandá", "banco": "Banco Teste", "agencia": "1234", "conta": "11111-1", "unitId": CAR, "tipo": "CORRENTE", "ativo": "1"}, FS), "Conta salva")
CONTA = psql("SELECT id FROM bank_accounts ORDER BY id DESC LIMIT 1")
def ofx(itens): return "OFXHEADER:100\nDATA:OFXSGML\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>\n" + "".join(f"<STMTTRN>\n<TRNTYPE>{'CREDIT' if v > 0 else 'DEBIT'}\n<DTPOSTED>{dt.replace('-', '')}120000\n<TRNAMT>{v:.2f}\n<FITID>{fid}\n<NAME>{nome}\n<MEMO>{memo}\n</STMTTRN>\n" for dt, v, fid, nome, memo in itens) + "</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>"
EXT = ofx([(d(-1), -333.34, "CP1", "MANUTENCAO PREDIAL ALFA", "PAG BOLETO"), (H, -1530.00, "CP2", "IMOBILIARIA HORIZONTE", "PAG BOLETO"), (H, -1200.00, "CP3", "PINTURA", "PIX ENVIADO")])
h = page("/financeiro/conciliacao?aba=contas", FS); loc = post("/financeiro/conciliacao", aid_of(h, 'name="contaId"'), {"contaId": CONTA, "csv": EXT, "lancarCaixa": "1"}, FS); assert "3 lançamento(s) novo(s)" in loc, loc
L = dict(l.split("|") for l in psql("SELECT documento, id FROM bank_lines WHERE documento LIKE 'CP%'").splitlines())
I = lambda pid, n: psql(f"SELECT id FROM payable_installments WHERE payable_id={pid} AND parcela={n}")
hp = page("/financeiro/contas-a-pagar", FS); assert "Débitos do extrato que batem com parcelas (1)" in hp and "Confirmar as baixas marcadas (1)" in hp, "só o par exato e único é sugerido"
okmsg(post("/financeiro/contas-a-pagar", aid_of(hp, "Confirmar as baixas marcadas"), {"par": f"{I(P2, 1)}:{L['CP1']}", "voltar": "/financeiro/contas-a-pagar"}, FS), "1 baixa(s) confirmada(s)")
assert psql(f"SELECT status || '|' || pago_em || '|' || valor_pago FROM payable_installments WHERE id={I(P2, 1)}") == f"PAGA|{d(-1)}|333.34"
assert psql(f"SELECT status || '|' || payable_installment_id || '|' || classe FROM bank_lines WHERE id={L['CP1']}") == f"CONCILIADO|{I(P2, 1)}|DESPESA"
assert psql(f"SELECT categoria FROM cash_entries WHERE bank_line_id={L['CP1']}") == "Serviços e terceiros", "caixa reclassificado para o plano do título"
ok("débito de R$ 333,34 sugerido como par único e confirmado em lote: parcela paga, débito conciliado e vinculado, caixa reclassificado para Serviços e terceiros")
hd = page(f"/financeiro/contas-a-pagar/{P1}", FS); AID_BAIXA = aid_of(hd, "Registrar baixa com o débito")
assert "diferença R$ 30,00" in hd, "débito com valor diferente aparece como candidato"
erro(post(f"/financeiro/contas-a-pagar/{P1}", AID_BAIXA, {"id": I(P1, 1), "lineId": L["CP2"], "voltar": f"/financeiro/contas-a-pagar/{P1}"}, DG), "Segregação de funções")
erro(post(f"/financeiro/contas-a-pagar/{P1}", AID_BAIXA, {"id": I(P1, 1), "lineId": L["CP2"], "voltar": f"/financeiro/contas-a-pagar/{P1}"}, FS), "diferença de R$ 30,00 — informe juros/multa")
okmsg(post(f"/financeiro/contas-a-pagar/{P1}", AID_BAIXA, {"id": I(P1, 1), "lineId": L["CP2"], "juros": "30,00", "voltar": f"/financeiro/contas-a-pagar/{P1}"}, FS), "débito conciliado")
assert psql(f"SELECT valor_pago || '|' || juros FROM payable_installments WHERE id={I(P1, 1)}") == "1530.00|30.00"
erro(post(f"/financeiro/contas-a-pagar/{P1}", AID_BAIXA, {"id": I(P1, 2), "lineId": L["CP2"], "voltar": "/"}, FS), "já pagou outra parcela")
erro(post(f"/financeiro/contas-a-pagar/{P3}", AID_BAIXA, {"id": I(P3, 1), "lineId": L["CP3"], "voltar": "/"}, FS), "aguarda aprovação")
ok("quem aprovou não paga (segregação); diferença de R$ 30 exige juros; com juros fecha; débito não é reutilizado; título aguardando aprovação não é baixado")
hd = page(f"/financeiro/contas-a-pagar/{P1}?p={I(P1, 1)}", FS); AID_DESF = aid_of(hd, "Desfazer baixa")
erro(post(f"/financeiro/contas-a-pagar/{P1}", AID_DESF, {"id": I(P1, 1), "motivo": "x", "voltar": "/"}, FS), "motivo")
COMP = psql(f"SELECT coalesce(company_id::text, 'NULL') FROM units WHERE id={CAR}")
psql(f"INSERT INTO recon_closings (competencia, company_id, status, fechado_por) VALUES ('{H[:7]}', {COMP}, 'FECHADA', {UDG})")
erro(post(f"/financeiro/contas-a-pagar/{P1}", AID_DESF, {"id": I(P1, 1), "motivo": "Débito lançado na parcela errada", "voltar": "/"}, FS), "fechada")
psql("DELETE FROM recon_closings")
okmsg(post(f"/financeiro/contas-a-pagar/{P1}", AID_DESF, {"id": I(P1, 1), "motivo": "Débito lançado na parcela errada", "voltar": "/"}, FS), "desfeita")
assert psql(f"SELECT status || '|' || coalesce(payable_installment_id::text,'-') FROM bank_lines WHERE id={L['CP2']}") == "IGNORADO|-" and psql(f"SELECT status FROM payable_installments WHERE id={I(P1, 1)}") == "A_PAGAR"
okmsg(post(f"/financeiro/contas-a-pagar/{P1}", AID_BAIXA, {"id": I(P1, 1), "lineId": L["CP2"], "juros": "30,00", "voltar": "/"}, FS))
ok("desfazer pede motivo e respeita a competência fechada; devolve o débito; baixa refeita")

print("Retenção, programação, boleto da parcela, borderô e caixa projetado")
hd = page(f"/financeiro/contas-a-pagar/{P1}", FS); AID_RET = aid_of(hd, "Reter a parcela")
okmsg(post(f"/financeiro/contas-a-pagar/{P1}", AID_RET, {"id": I(P1, 3), "acao": "reter", "motivo": "Cobrança de condomínio em duplicidade", "voltar": "/"}, FS), "retida")
hp = page("/financeiro/contas-a-pagar?sit=abertas", FS); AID_PROG = aid_of(hp, "Programar as marcadas")
DP = d(3)
erro(post("/financeiro/contas-a-pagar", AID_PROG, {"ids": [I(P1, 2)], "data": d(-1), "voltar": "/financeiro/contas-a-pagar"}, FS), "passado")
loc = post("/financeiro/contas-a-pagar", AID_PROG, {"ids": [I(P1, 2), I(P1, 3), I(P3, 1)], "data": DP, "contaId": CONTA, "voltar": "/financeiro/contas-a-pagar"}, FS); okmsg(loc, "1 parcela(s) programada(s)"); assert "2 ficaram de fora" in loc, loc
erro(post(f"/financeiro/contas-a-pagar/{P1}", AID_BAIXA, {"id": I(P1, 3), "lineId": L["CP3"], "voltar": "/"}, FS), "retida")
okmsg(post(f"/financeiro/contas-a-pagar/{P1}", AID_RET, {"id": I(P1, 3), "acao": "liberar", "motivo": "Imobiliária corrigiu o boleto"}, FS), "liberada")
assert psql(f"SELECT programado_para || '|' || conta_programada_id FROM payable_installments WHERE id={I(P1, 2)}") == f"{DP}|{CONTA}"
V2 = psql(f"SELECT vencimento FROM payable_installments WHERE id={I(P1, 2)}")
hd = page(f"/financeiro/contas-a-pagar/{P1}", FS); AID_BOL = aid_of(hd, "Conferir e vincular")
erro(post(f"/financeiro/contas-a-pagar/{P1}", AID_BOL, {"id": I(P1, 2), "boleto": boleto("001", V2, 150100), "voltar": "/"}, FS), "O boleto é de R$ 1.501,00")
BOL2 = boleto("001", V2, 150000, "2220000099999999999999999"); BOL2F = f"{BOL2[0:5]}.{BOL2[5:10]} {BOL2[10:15]}.{BOL2[15:21]} {BOL2[21:26]}.{BOL2[26:32]} {BOL2[32]} {BOL2[33:]}"
okmsg(post(f"/financeiro/contas-a-pagar/{P1}", AID_BOL, {"id": I(P1, 2), "boleto": BOL2, "voltar": "/"}, FS), "Boleto conferido")
hpp = page("/financeiro/contas-a-pagar?aba=programacao", FS); assert "Borderô (CSV)" in hpp and "ALUGUEL" in hpp and "boleto ✓" in hpp
csv = FS.get(B + f"/api/export/contas-a-pagar-bordero?data={DP}").content.decode("utf-8-sig"); assert "Borderô de pagamentos" in csv and "CP-0001;2/12" in csv and BOL2F in csv and "Banco Teste" in csv, csv[:400]
hproj = page("/financeiro/projecao", FS); assert "Contas a pagar:" in hproj and "parcela(s)" in hproj, re.findall(r"Contas a pagar:[^.]*", hproj)
ok("retida fica fora da programação e da baixa até liberar; programação recusa passado e ignora não aprovadas; boleto da parcela conferido (valor diferente recusado); borderô com linha digitável; caixa projetado com as parcelas")

print("Dupla checagem, rejeição, alteração, extensão, cancelamento")
AID_CRIAR_DG = aid_of(page("/financeiro/contas-a-pagar/nova", DG), "Salvar conta a pagar")
loc = post("/financeiro/contas-a-pagar/nova", AID_CRIAR_DG, {**base_serv, "supplierId": "novo", "fornecedorNovo": "Construtora Telhado Bom (fictícia)", "cadastrar": "1", "contaId": CONTA_PLANO("3.3.01"), "categoria": "Manutenção", "numeroDocumento": "OBRA-1", "descricao": "Reforma do telhado", "valor": "120.000,00", "parcelas": "1", "primeiroVencimento": d(30), "emissao": H, "boleto": "", "chaveNfe": "", "parcelasJson": "", "responsavelId": UDG}, DG)
okmsg(loc, "dupla checagem"); P4 = re.search(r"/contas-a-pagar/(\d+)", loc).group(1)
assert psql(f"SELECT status || '|' || aprovacoes_necessarias || '|' || jsonb_array_length(aprovacoes) FROM payables WHERE id={P4}") == "AGUARDANDO_APROVACAO|2|1"
assert psql("SELECT count(*) FROM suppliers WHERE nome='Construtora Telhado Bom (fictícia)'") == "1"
erro(post(f"/financeiro/contas-a-pagar/{P4}", AID_DEC, {"id": P4, "decisao": "APROVAR"}, DG), "Quem lançou não aprova")
okmsg(post(f"/financeiro/contas-a-pagar/{P4}", AID_DEC, {"id": P4, "decisao": "APROVAR", "motivo": "Orçamento de obra aprovado em reunião"}, DG2), "Aprovada")
assert psql(f"SELECT status || '|' || jsonb_array_length(aprovacoes) FROM payables WHERE id={P4}") == "ATIVO|2"
loc = post("/financeiro/contas-a-pagar/nova", AID_CRIAR, {**base_serv, "contaId": CONTA_PLANO("5.1.01"), "categoria": "Marketing", "numeroDocumento": "MKT-1", "descricao": "Campanha de matrículas", "valor": "6.000,00", "parcelas": "1", "primeiroVencimento": d(10), "emissao": H, "boleto": "", "chaveNfe": "", "parcelasJson": ""}, FS); P5 = re.search(r"/contas-a-pagar/(\d+)", loc).group(1)
erro(post(f"/financeiro/contas-a-pagar/{P5}", AID_DEC, {"id": P5, "decisao": "REJEITAR"}, DG), "motivo")
okmsg(post(f"/financeiro/contas-a-pagar/{P5}", AID_DEC, {"id": P5, "decisao": "REJEITAR", "motivo": "Campanha adiada para janeiro"}, DG), "Rejeitada")
assert psql(f"SELECT p.status || '|' || i.status FROM payables p JOIN payable_installments i ON i.payable_id=p.id WHERE p.id={P5}") == "REJEITADO|CANCELADA"
ok("R$ 120 mil: dupla checagem (quem lançou conta como 1ª aprovação e não aprova de novo; a 2ª pessoa completa); rejeição exige motivo e cancela as parcelas")
hd = page(f"/financeiro/contas-a-pagar/{P1}", FS); AID_EDIT = aid_of(hd, "Salvar alteração")
erro(post(f"/financeiro/contas-a-pagar/{P1}", AID_EDIT, {"id": I(P1, 5), "vencimento": psql(f"SELECT vencimento FROM payable_installments WHERE id={I(P1, 5)}"), "valor": "1.800,00", "motivo": "Reajuste antecipado"}, FS), "é com quem tem a alçada")
okmsg(post(f"/financeiro/contas-a-pagar/{P2}", AID_EDIT, {"id": I(P2, 2), "vencimento": d(31), "valor": "333,33", "competencia": d(31)[:7], "motivo": "Fornecedor mudou o vencimento"}, FS), "alterada")
assert psql(f"SELECT vencimento || '|' || competencia FROM payable_installments WHERE id={I(P2, 2)}") == f"{d(31)}|{d(31)[:7]}"
AID_EXT = aid_of(hd, "Estender")
erro(post(f"/financeiro/contas-a-pagar/{P1}", AID_EXT, {"id": P1, "n": "6", "valor": "1.500,00"}, FS), "Estender pede quem tem a alçada")
okmsg(post(f"/financeiro/contas-a-pagar/{P1}", AID_EXT, {"id": P1, "n": "6", "valor": "1.575,00"}, DG), "+6 parcela(s)")
assert psql(f"SELECT parcelas || '|' || (SELECT count(*) FROM payable_installments WHERE payable_id={P1}) || '|' || (SELECT valor FROM payable_installments WHERE payable_id={P1} AND parcela=18) FROM payables WHERE id={P1}") == "18|18|1575.00"
AID_CANC = aid_of(hd, "Cancelar parcela")
okmsg(post(f"/financeiro/contas-a-pagar/{P2}", AID_CANC, {"id": I(P2, 3), "motivo": "Serviço reduzido", "voltar": f"/financeiro/contas-a-pagar/{P2}"}, FS), "cancelada")
AID_CT = aid_of(hd, "Cancelar título")
okmsg(post(f"/financeiro/contas-a-pagar/{P2}", AID_CT, {"id": P2, "motivo": "Contrato encerrado"}, FS), "cancelado")
assert psql(f"SELECT status FROM payables WHERE id={P2}") == "CANCELADO" and psql(f"SELECT string_agg(status, ',' ORDER BY parcela) FROM payable_installments WHERE payable_id={P2}") == "PAGA,CANCELADA,CANCELADA"
ok("aumento de parcela acima da alçada só com quem aprova; vencimento/competência alterados com motivo; recorrência estendida (+6 com reajuste) só pela alçada; parcela e título cancelados mantendo a paga no histórico")

print("Painel, exportação, alertas, pendências, contrato, configurações e permissões")
hp = page("/financeiro/contas-a-pagar", FS)
for k in ["Vencidas sem baixa", "Aging — vencidas × a vencer", "Orçado × pago × a pagar", "Despesa por competência", "Indicadores de contas a pagar (12 meses)", "Pagas até o vencimento", "Programação de pagamentos", "Fornecedores"]: assert k in hp, k
hf = page("/financeiro/contas-a-pagar?aba=fornecedores", FS); assert "Imobiliária Horizonte (fictícia)" in hf and "Pago em 12 meses" in hf
ht = page("/financeiro/contas-a-pagar?aba=titulos", FS); assert "Reforma do telhado" in ht and "Campanha de matrículas" in ht
csv = FS.get(B + "/api/export/contas-a-pagar?sit=todas").content.decode("utf-8-sig"); assert "titulo;parcela;fornecedor" in csv and "débito do extrato" in csv and NFE in csv, csv[:300]
assert RH.get(B + "/api/export/contas-a-pagar").status_code == 403
psql(f"UPDATE payable_installments SET vencimento='{d(-3)}' WHERE payable_id={P4}")
hcc = page("/command-center", DG); assert "contas a pagar vencida" in hcc.lower(), "alertas de contas a pagar no Command Center"
hpe = page("/pendencias", FS); assert "Contas a pagar" in hpe
hds = page("/financeiro/contas-a-pagar", DS); assert "Nova conta a pagar" not in hds and "ALUGUEL" in hds
erro(post("/financeiro/contas-a-pagar/nova", AID_CRIAR, base_aluguel, DS), "Financeiro ou pela Direção")
KTR = psql(f"INSERT INTO contracts (supplier_id, unit_id, objeto, valor_mensal, inicio, status) VALUES ({SUP}, {CAR}, 'Locação do prédio anexo', 2300, '{d(-100)}', 'VIGENTE') RETURNING id")
hk = page(f"/operacoes/contratos/{KTR}", FS); assert "Contas a pagar deste contrato" in hk and "Gerar contas a pagar" in hk
hn = page(f"/financeiro/contas-a-pagar/nova?contrato={KTR}", FS); assert "Pré-preenchido do contrato" in hn and "2.300,00" in hn
hcfg = page("/configuracoes", DG); assert "Contas a pagar — alçada, dupla checagem" in hcfg
AID_CFG = aid_of(hcfg, "Alçada a partir de (R$)")
erro(post("/configuracoes", AID_CFG, {"secao": "contas", "alcada": "6000", "dupla": "100000", "alerta": "3", "janela": "10", "aprovadores": "DIRECAO", "tipos": "Boleto\nPIX", "feriados": "13/06\n26/08\n11/10"}, FS), "Direção")
okmsg(post("/configuracoes", AID_CFG, {"secao": "contas", "alcada": "6.000", "dupla": "100000", "alerta": "3", "janela": "10", "aprovadores": "DIRECAO", "manual": ["DIRECAO", "FINANCEIRO"], "orcamento": "1", "segregar": "1", "diaUtil": "1", "carnaval": "1", "corpus": "1", "tipos": "Boleto\nPIX\nTransferência\nDinheiro\nNota fiscal", "feriados": "13/06\n26/08\n11/10"}, DG), "contas a pagar salvas")
assert psql("SELECT value->>'alcadaValor' FROM settings WHERE key='contasPagar'") == "6000"
ok("painel com aging, orçado × pago × a pagar, competência, indicadores, títulos e fornecedores; CSV completo (RH sem acesso); alertas e pendências; direção da unidade só vê; contrato gera título; regras salvas só pela Direção")

print("Natureza da despesa e reserva mínima de caixa (catálogo de controladoria)")
hcfg = page("/configuracoes", DG); assert "Natureza que sempre passa pela aprovação" in hcfg and "Reserva mínima de caixa da rede" in hcfg
okmsg(post("/configuracoes", AID_CFG, {"secao": "contas", "alcada": "6.000", "dupla": "100000", "alerta": "3", "janela": "10", "aprovadores": "DIRECAO", "manual": ["DIRECAO", "FINANCEIRO"], "naturezas": ["INVESTIMENTO", "XYZ"], "orcamento": "1", "segregar": "1", "diaUtil": "1", "carnaval": "1", "corpus": "1", "tipos": "Boleto\nPIX\nTransferência\nDinheiro\nNota fiscal", "feriados": "13/06\n26/08\n11/10"}, DG), "contas a pagar salvas")
assert psql("SELECT value->>'naturezaSempreAprova' FROM settings WHERE key='contasPagar'") == '["INVESTIMENTO"]'
ENT = psql("SELECT id FROM companies ORDER BY id LIMIT 1"); assert ENT
hn = page("/financeiro/contas-a-pagar/nova", FS); assert "Natureza" in hn and "Operação do dia a dia" in hn and "Investimento" in hn and "Extraordinária" in hn
base_inv = {"unitId": "", "companyId": ENT, "supplierId": SUP2, "contaId": CONTA_PLANO("3.3.01"), "categoria": "Manutenção", "tipoDocumento": "Nota fiscal", "numeroDocumento": "INV-77", "emissao": H, "responsavelId": UFIN, "descricao": "Projetores para as salas", "recorrente": "0", "valor": "2.000,00", "parcelas": "2", "primeiroVencimento": d(20), "intervalo": "MENSAL"}
erro(post("/financeiro/contas-a-pagar/nova", AID_CRIAR, {**base_inv, "natureza": "LUXO"}, FS), "natureza")
loc = post("/financeiro/contas-a-pagar/nova", AID_CRIAR, {**base_inv, "natureza": "INVESTIMENTO"}, FS); okmsg(loc, "enviada para aprovação"); PINV = re.search(r"/contas-a-pagar/(\d+)", loc).group(1)
assert psql(f"SELECT natureza || '|' || status || '|' || (motivos_aprovacao->0->>'codigo') FROM payables WHERE id={PINV}") == "INVESTIMENTO|AGUARDANDO_APROVACAO|NATUREZA", "R$ 2 mil fica abaixo da alçada, mas investimento sempre passa pela aprovação"
hp = page(f"/financeiro/contas-a-pagar/{PINV}", FS); assert "Natureza da despesa:" in hp and "Investimento: sempre passa pela aprovação" in hp and "o que fica para a escola" in hp and "(investimento)" in hp
loc = post("/financeiro/contas-a-pagar/nova", AID_CRIAR, {**base_inv, "numeroDocumento": "OP-78", "descricao": "Material de limpeza do mês", "valor": "1.200,00", "primeiroVencimento": d(21), "natureza": "OPERACAO"}, FS); okmsg(loc, "já entra no caixa projetado"); POP = re.search(r"/contas-a-pagar/(\d+)", loc).group(1)
assert psql(f"SELECT natureza || '|' || status FROM payables WHERE id={POP}") == "OPERACAO|ATIVO", "operação abaixo da alçada nasce aprovada"
hv = page("/financeiro/contas-a-pagar?nat=INVESTIMENTO&sit=todas", FS); assert "Natureza da despesa" in hv and "Projetores para as salas" in hv and "Material de limpeza do mês" not in hv and "aguardando aprovação" in hv
assert "· investimento" in page("/financeiro/contas-a-pagar?aba=titulos&nat=INVESTIMENTO", FS)
csv = FS.get(B + "/api/export/contas-a-pagar?sit=todas&nat=INVESTIMENTO").text; assert "natureza" in csv.splitlines()[0] and "investimento" in csv and "Material de limpeza" not in csv
assert re.search(r'<option[^>]*value="INVESTIMENTO"[^>]*selected', page(f"/financeiro/contas-a-pagar/nova?de={PINV}", FS)), "copiar mantém a natureza"
okmsg(post(f"/financeiro/contas-a-pagar/{PINV}", AID_DEC, {"id": PINV, "decisao": "APROVAR", "motivo": "Projetores previstos no plano de investimentos"}, DG), "Aprovada")
assert psql(f"SELECT status FROM payables WHERE id={PINV}") == "ATIVO"
ok("natureza obrigatória e válida; investimento sempre passa pela aprovação (configurável), operação abaixo da alçada nasce aprovada; filtro, cartão, etiqueta, CSV e cópia levam a natureza")
AID_INS = aid_of(hcfg, "Salvar parâmetros do Insights")
ins = {"toleranciaPct": "10", "resumoSemanal": "1", "lembretePendencias": "1", "riscoPct": "25", "prazoDecisaoDias": "2", "prazoFeriasDias": "3", "cenarioPessimistaPct": "85", "cenarioOtimistaPct": "100"}
erro(post("/configuracoes", AID_INS, {**ins, "reservaMinima": "-5"}, DG), "Reserva mínima")
okmsg(post("/configuracoes", AID_INS, {**ins, "reservaMinima": "900000000"}, DG), "Insights")
assert psql("SELECT value->>'reservaMinima' FROM settings WHERE key='fpa'") == "900000000"
hpj = page("/financeiro/projecao", FS); assert "abaixo da reserva mínima de" in hpj and "Contas a pagar → Programação" in hpj and "Reserva mínima" in hpj
assert "abaixo da reserva mínima de" not in page(f"/financeiro/projecao?unidade={CAR}", FS), "a reserva é da rede: a visão da unidade não usa"
assert "caixa projetado abaixo da reserva mínima" in page("/command-center", DG).lower()
okmsg(post("/configuracoes", AID_INS, {**ins, "reservaMinima": "0"}, DG), "Insights")
assert "abaixo da reserva mínima de" not in page("/financeiro/projecao", FS) and "caixa projetado abaixo da reserva mínima" not in page("/command-center", DG).lower()
hck = page("/financeiro/cockpit", FS); assert "parcela(s) a vencer em 30 dias" in hck and "contas a pagar aprovadas + orçado" in hck, "tesouraria do cockpit usa contas a pagar como fonte"
ok("reserva mínima de caixa: caixa projetado da rede avisa e leva à programação de pagamentos; Command Center alerta; 0 desliga; visão da unidade não usa; tesouraria do cockpit com contas a pagar como fonte")

print("Contratos com prazo (RH)")
E1 = psql(f"INSERT INTO employees (nome, unit_id, vinculo, admissao, gestor_id) VALUES ('Experiência Vencendo', {CAR}, 'CLT', '{d(-40)}', {GE}) RETURNING id")
E2 = psql(f"INSERT INTO employees (nome, unit_id, vinculo, admissao, gestor_id) VALUES ('Experiência Esquecida', {CAR}, 'CLT', '{d(-50)}', {GE}) RETURNING id")
E3 = psql(f"INSERT INTO employees (nome, unit_id, vinculo, admissao) VALUES ('Estagiária Teste', {CAR}, 'ESTAGIARIO', '{d(-700)}') RETURNING id")
E4 = psql(f"INSERT INTO employees (nome, unit_id, vinculo, admissao) VALUES ('Temporário Teste', {CAR}, 'TEMPORARIO', '{d(-175)}') RETURNING id")
hc = page("/contratos-prazo", RH)
for k in ["Contratos com prazo", "Experiência Vencendo", "Experiência Esquecida", "Estagiária Teste", "Temporário Teste", "Decidir agora", "Venceu sem decisão", "Sem término cadastrado", "Fim do 1º período (45 dias)"]: assert k in hc, k
hg = page("/contratos-prazo", GS); assert "Experiência Vencendo" in hg and "Estagiária Teste" not in hg, "gestora vê só a própria equipe"
assert "Recomendar" in page("/pendencias", GS) and "contrato(s) de experiência" in page("/equipe", GS)
AID_REC = aid_of(hg, "Registrar recomendação")
erro(post("/contratos-prazo", AID_REC, {"employeeId": E1, "tipo": "EXPERIENCIA", "etapa": "1", "recomendacao": "EFETIVAR", "motivo": "ok"}, GS), "mín. 10")
okmsg(post("/contratos-prazo", AID_REC, {"employeeId": E1, "tipo": "EXPERIENCIA", "etapa": "1", "recomendacao": "PRORROGAR", "motivo": "Boa adaptação, ainda aprendendo a rotina da secretaria"}, GS), "Recomendação registrada")
erro(post("/contratos-prazo", AID_REC, {"employeeId": E3, "tipo": "ESTAGIO", "etapa": "1", "recomendacao": "RENOVAR", "motivo": "Tentando recomendar fora da equipe"}, GS), "gestor direto")
AID_DECP = aid_of(hc, "Registrar decisão")
erro(post("/contratos-prazo", AID_DECP, {"employeeId": E1, "tipo": "EXPERIENCIA", "etapa": "1", "decisao": "PRORROGAR", "motivo": "Seguir"}, GS), "RH, da Direção")
okmsg(post("/contratos-prazo", AID_DECP, {"employeeId": E1, "tipo": "EXPERIENCIA", "etapa": "1", "decisao": "PRORROGAR", "motivo": "Seguindo a recomendação da gestora"}, RH), "Prorrogação registrada")
hc = page("/contratos-prazo", RH); assert "Fim da experiência (90 dias)" in hc
okmsg(post("/contratos-prazo", AID_DECP, {"employeeId": E2, "tipo": "EXPERIENCIA", "etapa": "1", "decisao": "EFETIVAR", "motivo": "Efetivação confirmada com a gestora"}, RH), "efetivar")
AID_TERM = aid_of(hc, "Salvar término")
erro(post("/contratos-prazo", AID_TERM, {"employeeId": E3, "termino": d(400)}, RH), "limite legal")
okmsg(post("/contratos-prazo", AID_TERM, {"employeeId": E3, "termino": d(10)}, RH), "Término cadastrado")
erro(post("/contratos-prazo", AID_DECP, {"employeeId": E3, "tipo": "ESTAGIO", "etapa": "1", "decisao": "RENOVAR", "novaData": d(400), "motivo": "Renovar por mais um ano"}, RH), "não passa de 24 meses")
okmsg(post("/contratos-prazo", AID_DECP, {"employeeId": E3, "tipo": "ESTAGIO", "etapa": "1", "decisao": "RENOVAR", "novaData": d(25), "motivo": "Renovar até o limite legal"}, RH))
okmsg(post("/contratos-prazo", AID_DECP, {"employeeId": E4, "tipo": "TEMPORARIO", "etapa": "1", "decisao": "PRORROGAR", "motivo": "Demanda de fim de ano"}, RH))
assert psql(f"SELECT termino_contrato FROM employees WHERE id={E4}") == d(-175 + 269), "prorrogação vai até 270 dias"
assert psql(f"SELECT count(*) FROM employment_terms WHERE decisao IS NOT NULL AND employee_id IN ({E1},{E2},{E3},{E4})") == "4"
assert psql("SELECT count(*) FROM audit_log WHERE acao='decidir contrato com prazo'") == "4"
hd = page("/contratos-prazo?sit=decididos", RH); assert "Prorrogar" in hd and "Efetivar" in hd and "Renovar o TCE" in hd
ok("experiência vencendo e esquecida, estágio sem término e temporário; gestora recomenda (só a própria equipe); RH decide com motivo; TCE e prorrogações dentro do limite legal; trilha na auditoria")
hr = page("/analytics/retencao?meses=12", RH); assert "Fatores associados às saídas" in hr
ok("retenção mostra os fatores associados às saídas (grupos com 5+ pessoas)")
print(f"E2E contas a pagar + contratos com prazo (v27): OK — {N[0]} blocos")
