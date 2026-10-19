# E2E — v25 · Despesas & fila de aprovação (T-029): lote C10 só para o normal (exceções: sem documento, acima do lote,
# orçamento estourado contando o comprometido), trilha item a item, "paga" só com o débito do extrato (mesmo valor, janela,
# sem reuso, competência fechada bloqueia), reclassificação do caixa com trilha, desfazer, programar (projeção de caixa),
# painel T-029 (treemap, estados, fila, a pagar, recorrentes), alerta no painel financeiro, permissões e parâmetros (só Direção).
import re, subprocess, requests
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
B = "http://localhost:3100"; TOKEN = "setup-homologacao-2026-status"
def psql(q): return subprocess.run(["su", "postgres", "-c", f"/usr/lib/postgresql/16/bin/psql -h /tmp/pg -U status -d status_people -q -t -A -c \"{q.replace(chr(34), chr(92) + chr(34))}\""], capture_output=True, text=True).stdout.strip()
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
    assert r.status_code == expect, (path, r.status_code, r.headers.get("location"))
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
def erro(loc, trecho): assert "erro=" in loc and trecho in loc, (trecho, loc)
def okmsg(loc, trecho=""): assert "ok=" in loc and trecho in loc, (trecho, loc)
HOJE = datetime.now(ZoneInfo("America/Campo_Grande")).date(); H = HOJE.isoformat(); ANO = H[:4]
def d(n): return (HOJE + timedelta(days=n)).isoformat()
def br(iso): return "/".join(reversed(iso.split("-")))
def debitos(h): return set(re.findall(r'value="(\d+)"', " ".join(re.findall(r'<input[^>]*name="lineId"[^>]*>', h))))
def no_lote(h): return set(re.findall(r'<input[^>]*form="lote"[^>]*value="(\d+)"', h))

print("Preparação")
RH = login("rh@colegiostatus", "Status2026!"); r = RH.get(B + f"/api/setup?token={TOKEN}"); assert r.json()["ok"], r.text
CAR = psql("SELECT id FROM units WHERE codigo='CAR'")
psql(f"INSERT INTO employees (nome, unit_id, vinculo, admissao) VALUES ('Carla Colaboradora', {CAR}, 'CLT', '2024-01-10')"); EC = psql("SELECT id FROM employees WHERE nome='Carla Colaboradora'")
html = page("/configuracoes", RH); aid_user = aid_of(html, "Criar acesso")
def criar_user(nome, email, role, unit="", emp=""):
    post("/configuracoes", aid_user, {"nome": nome, "email": email, "role": role, "unitId": unit, "employeeId": emp, "senha": "senha12345"}, RH); return psql(f"SELECT id FROM users WHERE email='{email}'")
UC = criar_user("Carla", "carla@car", "COLABORADOR", "", EC); UDIR = criar_user("Diretora Carandá", "dir@car", "DIRETOR_UNIDADE", CAR); UFIN = criar_user("Financeiro Rede", "fin@rede", "FINANCEIRO"); UDG = criar_user("Diretora Geral", "dg@rede", "DIRECAO")
CS = login("carla@car", "senha12345"); DS = login("dir@car", "senha12345"); FS = login("fin@rede", "senha12345"); DG = login("dg@rede", "senha12345")
psql(f"INSERT INTO budgets (ano, unit_id, tipo, categoria, valor_mensal) VALUES ({ANO}, {CAR}, 'SAIDA', 'Materiais e insumos', 1000), ({ANO}, {CAR}, 'SAIDA', 'Outras despesas', 5000)")
T = {c: psql(f"SELECT id FROM request_types WHERE codigo='{c}'") for c in ["REEMBOLSO", "COMPRA", "MATERIAL"]}
ok("colaboradora solicitante, diretora da unidade, financeiro e Direção; orçamento do mês: materiais R$ 1.000, outras despesas R$ 5.000")

print("Pedidos com e sem documento")
def abrir(tipo, campos, anexo=True):
    h = page(f"/solicitacoes/nova?tipo={T[tipo]}", CS); aid = aid_of(h, "Enviar para aprovação")
    loc = post("/solicitacoes/nova", aid, {"typeId": T[tipo], **campos}, CS); okmsg(loc, "enviada"); rid = re.search(r"/solicitacoes/(\d+)", loc).group(1)
    if anexo:
        hc = page(f"/solicitacoes/{rid}", CS); okmsg(post(f"/solicitacoes/{rid}", aid_of(hc, "Anexar"), {"entidade": "request", "entidadeId": rid, "voltar": f"/solicitacoes/{rid}"}, CS, files=[("arquivo", ("nota.pdf", b"%PDF-1.4 nota", "application/pdf"))]), "anexado")
    return rid
reemb = lambda v, desc: {"campo_descricao": desc, "campo_data": d(-1), "campo_valor": v, "campo_forma": "PIX"}
R1 = abrir("REEMBOLSO", reemb("180,00", "Táxi para a reunião na secretaria de educação"))
R2 = abrir("REEMBOLSO", reemb("95,00", "Lanche da reunião de pais"), anexo=False)
R3 = abrir("COMPRA", {"campo_item": "Kit de robótica", "campo_quantidade": "3", "campo_valor": "1.500,00", "campo_justificativa": "Clube de robótica do 2º semestre"})
R4 = abrir("MATERIAL", {"campo_itens": "Papel A4 (10 resmas)", "campo_destino": "Secretaria", "campo_prazo": d(5), "campo_valor": "300,00"})
R5 = abrir("REEMBOLSO", reemb("250,00", "Combustível da visita técnica"))
NUM = {r: psql(f"SELECT numero FROM requests WHERE id={r}") for r in [R1, R2, R3, R4, R5]}
ok("5 pedidos: reembolsos de R$ 180 e R$ 250 com nota, R$ 95 sem documento; compra de R$ 1.500; material de R$ 300")

print("Fila C10: lote só para o normal")
h = page("/solicitacoes?aba=aprovar", DS)
assert "Aprovar marcadas em lote" in h and "2</b> exceção(ões) da política" in h, "barra do lote"
marcadas = no_lote(h); assert marcadas == {R1, R4, R5}, marcadas
assert "Sem documento:" in h and "Acima do lote:" in h and "Orçamento estourado:" in h and "Abrir e decidir" in h, "exceções à vista"
loc = post("/solicitacoes", aid_of(h, "Aprovar marcadas em lote"), {"ids": [R1, R4, R5, R2]}, DS)
okmsg(loc, "3 aprovada(s) em lote"); assert "1 ficaram para decisão individual" in loc and NUM[R2] in loc and "sem documento" in loc, loc
st = dict(l.split("|") for l in psql(f"SELECT id, status || ':' || etapa_atual FROM requests WHERE id IN ({R1},{R2},{R4},{R5})").splitlines())
assert st == {R1: "EM_APROVACAO:1", R2: "EM_APROVACAO:0", R4: "APROVADA:0", R5: "EM_APROVACAO:1"}, st
assert psql(f"SELECT count(*) FROM request_events WHERE request_id IN ({R1},{R4},{R5}) AND tipo='APROVADA' AND texto LIKE '%(aprovação em lote)'") == "3"
assert psql("SELECT count(*) FROM audit_log WHERE acao='solicitação: aprovar (lote)'") == "3" and psql("SELECT count(*) FROM audit_log WHERE acao='aprovação em lote de solicitações'") == "1"
assert psql(f"SELECT etapas->0->>'obs' FROM requests WHERE id={R1}") == "aprovada em lote"
ok("lote aprovou as 3 normais (trilha item a item na linha do tempo e na auditoria); a sem documento ficou de fora mesmo marcada à força")
hd = page(f"/solicitacoes/{R2}", DS); assert "Exceção da política de despesas" in hd and "Sem documento" in hd; aid_dec = aid_of(hd, "Aprovar R$")
erro(post("/solicitacoes", aid_dec, {"id": R2, "decisao": "APROVAR", "rapido": "1", "voltar": "/solicitacoes?aba=aprovar"}, DS), "Exceção da política")
okmsg(post(f"/solicitacoes/{R2}", aid_dec, {"id": R2, "decisao": "APROVAR"}, DS))
hd = page(f"/solicitacoes/{R3}", DS); assert "Acima do lote" in hd and "Orçamento estourado" in hd and "R$ 300,00 já usados de R$ 1.000,00" in hd and "180%" in hd, "orçamento: R$ 300 comprometidos + R$ 1.500 de R$ 1.000"
okmsg(post(f"/solicitacoes/{R3}", aid_of(hd, "Aprovar R$"), {"id": R3, "decisao": "APROVAR"}, DS), "aprovada")
ok("atalho da lista recusa exceção; no item, a decisão é individual e a exceção aparece com o motivo (R$ 300 comprometidos + R$ 1.500 = 180% do orçado)")

R6 = abrir("MATERIAL", {"campo_itens": "Cartolina e cola", "campo_destino": "2º ano", "campo_prazo": d(3), "campo_valor": "150,00"})
h = page("/solicitacoes?aba=aprovar", DS); assert R6 not in no_lote(h), "comprometido conta no orçamento"
assert "R$ 1.800,00 já usados de R$ 1.000,00" in h, "aprovadas a pagar (R$ 1.500 + R$ 300) entram no comprometido"
ok("orçamento olha o comprometido: material de R$ 150 vira exceção porque R$ 1.800 já estão aprovados a pagar")

h = page("/solicitacoes?aba=aprovar", FS); marcadas = no_lote(h); assert marcadas == {R1, R5}, marcadas
okmsg(post("/solicitacoes", aid_of(h, "Aprovar marcadas em lote"), {"ids": [R1, R5]}, FS), "2 aprovada(s) em lote")
hd = page(f"/solicitacoes/{R2}", FS); okmsg(post(f"/solicitacoes/{R2}", aid_of(hd, "Aprovar R$"), {"id": R2, "decisao": "APROVAR"}, FS))
assert psql(f"SELECT string_agg(status, ',' ORDER BY id) FROM requests WHERE id IN ({R1},{R2},{R3},{R4},{R5})") == "APROVADA,APROVADA,APROVADA,APROVADA,APROVADA"
ok("etapa do Financeiro: lote para as normais, item a item para a exceção; as cinco aprovadas")

print("A pagar e programação")
h = page("/solicitacoes?aba=pagar", FS); assert "A pagar (5)" in h and h.count(">a pagar<") >= 5 and "Sem data programada" in h
assert "aba=pagar" not in page("/solicitacoes", CS), "colaboradora não vê a aba A pagar"
hd = page(f"/solicitacoes/{R3}", FS); aid_prog = aid_of(hd, "Programar")
erro(post(f"/solicitacoes/{R3}", aid_prog, {"id": R3, "data": d(-1)}, FS), "passado")
okmsg(post(f"/solicitacoes/{R3}", aid_prog, {"id": R3, "data": d(10)}, FS), "projeção de caixa"); assert psql(f"SELECT pagamento_previsto FROM requests WHERE id={R3}") == d(10)
erro(post(f"/solicitacoes/{R3}", aid_prog, {"id": R3, "data": d(12)}, CS), "Financeiro ou a Direção")
psql(f"INSERT INTO cash_balances (unit_id, mes, saldo_inicial) SELECT id, '{H[:7]}', 100000 FROM units")
hp = page("/financeiro/projecao", FS); assert "Despesas aprovadas a pagar: 6 (" not in hp and "Despesas aprovadas a pagar: 5 (" in hp and "1 com data programada" in hp, re.findall(r"Despesas aprovadas a pagar:[^.]*", hp)
ok("aba A pagar com as cinco; pagamento programado (nunca no passado, só Financeiro/Direção) entra na projeção de caixa")

print("Pago só com o débito do extrato")
h = page("/financeiro/conciliacao?aba=contas", FS)
okmsg(post("/financeiro/conciliacao", aid_of(h, "Salvar conta"), {"apelido": "Banco Teste — Carandá", "banco": "Banco Teste", "agencia": "1234", "conta": "11111-1", "unitId": CAR, "tipo": "CORRENTE", "ativo": "1"}, FS), "Conta salva")
CONTA = psql("SELECT id FROM bank_accounts")
def ofx(itens): return "OFXHEADER:100\nDATA:OFXSGML\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>\n" + "".join(f"<STMTTRN>\n<TRNTYPE>{'CREDIT' if v > 0 else 'DEBIT'}\n<DTPOSTED>{dt.replace('-', '')}120000\n<TRNAMT>{v:.2f}\n<FITID>{fid}\n<NAME>{nome}\n<MEMO>{memo}\n</STMTTRN>\n" for dt, v, fid, nome, memo in itens) + "</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>"
EXT = ofx([(H, -180.00, "D1", "CARLA COLABORADORA", "PIX ENVIADO"), (H, -300.00, "D2", "PAPELARIA CENTRAL (FICTICIA)", "PAG FORNECEDOR"), (d(-40), -250.00, "D3", "", "PIX ENVIADO"), (H, -95.00, "D4", "CARLA COLABORADORA", "PIX ENVIADO"), (H, -1500.00, "D5", "ROBOTICA DEMO LTDA", "TED ENVIADA")])
h = page("/financeiro/conciliacao?aba=contas", FS); loc = post("/financeiro/conciliacao", aid_of(h, 'name="contaId"'), {"contaId": CONTA, "csv": EXT, "lancarCaixa": "1"}, FS); assert "5 lançamento(s) novo(s)" in loc, loc
L = dict(l.split("|") for l in psql("SELECT documento, id FROM bank_lines").splitlines())
assert psql(f"SELECT categoria FROM cash_entries WHERE bank_line_id={L['D2']}") == "Outras despesas"
hd = page(f"/solicitacoes/{R4}", FS); assert "Registrar pagamento" in hd and debitos(hd) == {L["D2"]}, ("só débitos do mesmo valor", debitos(hd))
aid_pag = aid_of(hd, "Registrar pagamento")
okmsg(post(f"/solicitacoes/{R4}", aid_pag, {"id": R4, "lineId": L["D2"]}, FS), "débito conciliado")
assert psql(f"SELECT pago_em || '|' || pagamento_line_id || '|' || pago_por FROM requests WHERE id={R4}") == f"{H}|{L['D2']}|{UFIN}"
assert psql(f"SELECT status || '|' || request_id || '|' || classe FROM bank_lines WHERE id={L['D2']}") == f"CONCILIADO|{R4}|DESPESA"
ce = psql(f"SELECT categoria || '|' || (reclassificado_em IS NOT NULL) || '|' || descricao FROM cash_entries WHERE bank_line_id={L['D2']}"); assert ce.startswith(f"Materiais e insumos|true|{NUM[R4]} · "), ce
assert psql("SELECT count(*) FROM audit_log WHERE acao='reclassificar lançamento de caixa'") == "1" and psql(f"SELECT count(*) FROM request_events WHERE request_id={R4} AND tipo='PAGA'") == "1"
assert psql(f"SELECT count(*) FROM notifications WHERE user_id={UC} AND titulo LIKE 'Pago:%'") == "1"
hd = page(f"/solicitacoes/{R4}", CS); assert "Paga em" in hd and "(conciliado)" in hd and "Pagou" in hd
assert ">paga<" in page("/solicitacoes?aba=minhas", CS)
ok("pagamento com o débito de R$ 300 (mesmo valor): linha conciliada e vinculada, caixa reclassificado para Materiais com trilha, solicitante avisada")
hd = page(f"/solicitacoes/{R1}", FS); aid_pag = aid_of(hd, "Registrar pagamento")
erro(post(f"/solicitacoes/{R1}", aid_pag, {"id": R1, "lineId": L["D2"]}, FS), "já pagou outra solicitação")
erro(post(f"/solicitacoes/{R1}", aid_pag, {"id": R1, "lineId": L["D4"]}, FS), "não bate")
erro(post(f"/solicitacoes/{R1}", aid_pag, {"id": R1, "lineId": L["D1"]}, CS), "Financeiro ou pela Direção")
assert psql("SELECT count(*) FROM audit_log WHERE acao='acesso negado: registrar pagamento de solicitação'") == "1"
okmsg(post(f"/solicitacoes/{R1}", aid_pag, {"id": R1, "lineId": L["D1"]}, FS))
assert "Nenhum débito de R$ 250,00 no extrato depois da aprovação" in page(f"/solicitacoes/{R5}", FS), "débito de 40 dias atrás fora da janela"
ok("débito reutilizado, valor diferente e perfil errado recusados (com trilha); débito antigo fora da janela não é oferecido")
COMP = psql(f"SELECT company_id FROM units WHERE id={CAR}") or "NULL"
psql(f"INSERT INTO recon_closings (competencia, company_id, status, fechado_por) VALUES ('{H[:7]}', {COMP}, 'FECHADA', {UDG})")
hd = page(f"/solicitacoes/{R2}", FS); aid_pag = aid_of(hd, "Registrar pagamento")
erro(post(f"/solicitacoes/{R2}", aid_pag, {"id": R2, "lineId": L["D4"]}, FS), "fechada")
hd = page(f"/solicitacoes/{R4}", FS); erro(post(f"/solicitacoes/{R4}", aid_of(hd, "Desfazer"), {"id": R4, "motivo": "Lançado na conta errada"}, FS), "fechada")
psql("DELETE FROM recon_closings")
okmsg(post(f"/solicitacoes/{R2}", aid_pag, {"id": R2, "lineId": L["D4"]}, FS))
hd = page(f"/solicitacoes/{R4}", FS); aid_des = aid_of(hd, "Desfazer")
erro(post(f"/solicitacoes/{R4}", aid_des, {"id": R4, "motivo": "ops"}, FS), "motivo")
okmsg(post(f"/solicitacoes/{R4}", aid_des, {"id": R4, "motivo": "Débito era de outra compra"}, FS), "desfeito")
assert psql(f"SELECT coalesce(pago_em::text,'-') || '|' || coalesce(pagamento_line_id::text,'-') FROM requests WHERE id={R4}") == "-|-" and psql(f"SELECT status || '|' || coalesce(request_id::text,'-') FROM bank_lines WHERE id={L['D2']}") == "IGNORADO|-"
hd = page(f"/solicitacoes/{R4}", FS); okmsg(post(f"/solicitacoes/{R4}", aid_of(hd, "Registrar pagamento"), {"id": R4, "lineId": L["D2"]}, FS))
ok("competência fechada bloqueia pagar e desfazer; desfazer pede motivo e devolve o débito; pago de novo")

print("Painel T-029, alerta e permissões")
psql(f"INSERT INTO suppliers (nome, servico) VALUES ('Limpeza Demo (fictícia)', 'Limpeza')")
psql(f"INSERT INTO contracts (supplier_id, unit_id, objeto, valor_mensal, inicio, fim, renovacao, aviso_previo_dias) SELECT id, {CAR}, 'Limpeza e conservação', 2400, '2025-01-01', '{d(45)}', 'MANUAL', 30 FROM suppliers WHERE nome LIKE 'Limpeza Demo%'")
hp = page("/financeiro/despesas", FS)
for t in ["OPEX do mês por categoria", "Materiais e insumos", "Estados do mês: submetido → aprovado → pago", "Fila de aprovação (1)", "Orçamento estourado", "Aprovadas a pagar (2)", f"programado {br(d(10))}", "Contratos recorrentes — próximos vencimentos", "Limpeza Demo (fictícia)", "limite do aviso", "Regras da política"]:
    assert t in hp, t
assert "3 despesa(s)" in hp, "pagas no mês"
assert f"cat=Materiais%20e%20insumos" in hp or "cat=Materiais+e+insumos" in hp or "cat=Materiais e insumos" in hp, "drill do treemap"
r = CS.get(B + "/financeiro/despesas", allow_redirects=False); assert r.status_code in (303, 307) and "/solicitacoes" in r.headers.get("location", ""), r.status_code
assert psql("SELECT count(*) FROM audit_log WHERE acao='acesso negado: despesas e aprovações'") == "1"
assert "aguardando pagamento" in page("/financeiro", FS)
page("/financeiro/despesas", DS)
ok("tela T-029: treemap do OPEX com drill, estados, fila com exceção, a pagar com a data programada, contratos recorrentes; alerta no painel; colaboradora barrada com trilha")

print("Parâmetros (só a Direção)")
hc = page("/configuracoes", DG); assert "Conciliação, despesas e ponto (v25)" in hc
ed0 = int(psql("SELECT count(*) FROM audit_log WHERE entidade='settings' AND acao='editar'"))
aid_d = aid_of(hc, 'name="loteAte"'); dados = {"secao": "despesas", "loteAte": "2000", "alerta": "5", "doc": "1", "orc": "1", "bloq": ["Marketing"], "cat_COMPRA": "Materiais e insumos", "cat_MATERIAL": "Materiais e insumos", "cat_REEMBOLSO": "Outras despesas", "cat_PASSEIO": "Serviços e terceiros", "cat_DECLARACAO": ""}
erro(post("/configuracoes", aid_d, dados, RH), "só a Direção")
okmsg(post("/configuracoes", aid_d, dados, DG), "Política de despesas salva")
assert psql("SELECT (value->>'loteAte') || '|' || (value->'categoriasBloqueadas')::text || '|' || (value->>'alertaPagamentoDias') FROM settings WHERE key='despesas'") == '2000|["Marketing"]|5'
aid_c = aid_of(hc, 'name="limiar"')
conc = {"secao": "conciliacao", "limiar": "92", "janela": "5", "janelaCartao": "2", "centavos": "0,05", "centavosMin": "3", "tolTaxa": "0,05", "meta": "100", "diaLimite": "10", "escGestor": "15", "escDirecao": "30", "alcadaPerda": "500",
        "taxas": "* | Débito | 1,19\n* | Crédito à vista | 2,49\n* | Crédito parcelado 2–6x | 2,99\n* | Crédito parcelado 7–12x | 3,49\nAMEX | Crédito à vista | 3,19", "palavras": "pix: PIX\ntarifa: TARIFA, CESTA"}
erro(post("/configuracoes", aid_c, {**conc, "taxas": "* | Crédito 13x | 4"}, DG), "Categoria")
erro(post("/configuracoes", aid_c, {**conc, "escDirecao": "10"}, DG), "depois da escala ao gestor")
okmsg(post("/configuracoes", aid_c, conc, DG), "Regras da conciliação salvas")
assert psql("SELECT (value->>'limiarAuto') || '|' || jsonb_array_length(value->'taxasCartao') || '|' || (value->'palavras'->'tarifa')::text FROM settings WHERE key='conciliacao'") == '92|5|["TARIFA", "CESTA"]'
assert int(psql("SELECT count(*) FROM audit_log WHERE entidade='settings' AND acao='editar'")) == ed0 + 2
ok("parâmetros de despesas e de conciliação: RH só consulta; a Direção altera com validação e trilha")

print(f"\ne2e_despesas: todas as verificações OK ({N[0]} blocos)")
