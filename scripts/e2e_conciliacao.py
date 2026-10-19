"""v25 · Conciliação e recebimentos (T-026, T-033…T-035, T-039 · KPI-09/39 · CRQ-COB-V3-01…04, CRQ-FIN-V3-04).
Extrato OFX + relatório da Cielo contra as baixas do ActiveSoft: par automático, sugestão, família com 2 títulos num PIX,
boleto pelo total do dia, crédito sem baixa, PIX não identificado (triagem da secretaria), venda × título, repasse × banco,
taxa acima do contrato, venda sem título, baixa sem crédito, desfecho com evidência e alçada, estorno de baixa,
fechamento da competência com trava e reabertura, escalonamento 15/30 dias, permissões e exportação."""
import re, subprocess, requests
B = "http://localhost:3100"
def psql(q): return subprocess.run(["su", "postgres", "-c", f"/usr/lib/postgresql/16/bin/psql -h /tmp/pg -U status -d status_people -q -t -A -c \"{q}\""], capture_output=True, text=True).stdout.strip()
def mk(): s = requests.Session(); s.headers.update({"Origin": B}); return s
unq = requests.utils.unquote
def action_ids(html):
    i = html.find("<main"); body = html[i:] if i >= 0 else html
    return re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', body)
def fix_cookie(sess, r):
    m = re.search(r"rh_session=([^;]+)", r.headers.get("set-cookie", ""))
    if m: sess.headers["Cookie"] = f"rh_session={m.group(1)}"
def page(path, sess, expect=200):
    r = sess.get(B + path, allow_redirects=False); assert r.status_code == expect, (path, r.status_code, r.headers.get("location"))
    return re.sub(r"<script[^>]*>.*?</script>", "", re.sub(r"<!--.*?-->", "", r.text), flags=re.S)
def post(path, aid, data, sess, multi=None, arquivos=None):
    f = [(f"$ACTION_ID_{aid}", (None, ""))] + [(k, (None, str(v))) for k, v in data.items()] + [(k, (None, str(v))) for k, v in (multi or [])] + list(arquivos or [])
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
    post("/login", aid, {"email": email, "senha": senha}, s); return s

RH = login("rh@colegiostatus", "Status2026!"); r = RH.get(B + "/api/setup?token=setup-homologacao-2026-status"); assert r.json()["ok"], r.text
html = page("/configuracoes", RH); aid = aid_of(html, "Criar acesso"); car = re.search(r'<option value="(\d+)">Carandá</option>', html).group(1)
for nome, email, role, extra in [("Fin Status", "fin@status", "FINANCEIRO", {}), ("Diretora Geral", "dir@geral", "DIRECAO", {}), ("Secretaria Status", "sec@status", "COMERCIAL", {}), ("Gestor Teste", "ges@status", "GESTOR", {"unitId": car})]:
    post("/configuracoes", aid, {"nome": nome, "email": email, "role": role, "senha": "senha12345", **extra}, RH)
F = login("fin@status", "senha12345"); D = login("dir@geral", "senha12345"); SEC = login("sec@status", "senha12345"); G = login("ges@status", "senha12345")
SEC_ID = psql("SELECT id FROM users WHERE email='sec@status'"); FIN_ID = psql("SELECT id FROM users WHERE email='fin@status'")

# ---- famílias e títulos (baixas do ActiveSoft com a forma de pagamento)
html = page("/matriculas/alunos/novo", RH); aid = action_ids(html)[0]
for nome, resp in [("Ana Souza", "Carla Souza"), ("Bruno Lima", "Marcos Lima"), ("Caio Pereira", "Paula Pereira"), ("Clara Pereira", "Paula Pereira"), ("Davi Rocha", "Renata Rocha")]:
    post("/matriculas/alunos/novo", aid, {"nome": nome, "responsavel": resp, "alunoAtual": "1", "unitAtualId": car}, RH)
TIT = """titulo;aluno;responsavel;unidade;tipo;competencia;vencimento;valor;pago_em;valor_pago;status;forma
T1;Ana Souza;Carla Souza;Carandá;Mensalidade;09/2026;10/09/2026;1.850,00;10/09/2026;1.850,00;pago;PIX
T2;Bruno Lima;Marcos Lima;Carandá;Mensalidade;09/2026;10/09/2026;1.620,00;09/09/2026;1.620,00;pago;Pix
T3;Caio Pereira;Paula Pereira;Carandá;Mensalidade;09/2026;10/09/2026;1.480,00;12/09/2026;1.480,00;pago;PIX
T4;Clara Pereira;Paula Pereira;Carandá;Mensalidade;09/2026;10/09/2026;1.480,00;12/09/2026;1.480,00;pago;PIX
T5;Davi Rocha;Renata Rocha;Carandá;Mensalidade;09/2026;10/09/2026;1.390,00;;;aberto;
T6;Ana Souza;Carla Souza;Carandá;Material;09/2026;20/09/2026;350,00;20/09/2026;350,00;pago;Boleto
T7;Bruno Lima;Marcos Lima;Carandá;Material;09/2026;20/09/2026;350,00;20/09/2026;350,00;pago;boleto bancário
T8;Davi Rocha;Renata Rocha;Carandá;Integral;09/2026;23/09/2026;900,00;23/09/2026;900,00;pago;Cartão de crédito
T9;Bruno Lima;Marcos Lima;Carandá;Integral;09/2026;22/09/2026;500,00;22/09/2026;500,00;pago;Cartão de débito
T10;Caio Pereira;Paula Pereira;Carandá;Integral;09/2026;25/09/2026;600,00;25/09/2026;600,00;pago;cartao
T11;Ana Souza;Carla Souza;Carandá;Taxa;09/2026;05/09/2026;200,00;05/09/2026;200,00;pago;PIX"""
html = page("/financeiro/importar", F); aid = action_ids(html)[0]
loc = post("/financeiro/importar", aid, {"csv": TIT}, F); assert "11 título(s) novo(s)" in loc, loc
assert psql("SELECT string_agg(external_id || ':' || coalesce(forma_pagamento,'-'), ',' ORDER BY id) FROM receivables") == "T1:PIX,T2:PIX,T3:PIX,T4:PIX,T5:-,T6:BOLETO,T7:BOLETO,T8:CARTAO,T9:CARTAO,T10:CARTAO,T11:PIX", "forma do título"
print("títulos com a forma de pagamento ok")

# ---- conta e extrato (OFX)
html = page("/financeiro/conciliacao?aba=contas", F); assert "Nenhuma conta cadastrada" in html
loc = post("/financeiro/conciliacao", aid_of(html, "Salvar conta"), {"apelido": "Banco Teste — movimento Carandá", "banco": "Banco Teste", "agencia": "1234", "conta": "56789-0", "unitId": car, "tipo": "CORRENTE", "ativo": "1"}, F); assert "Conta salva" in loc, loc
CONTA = psql("SELECT id FROM bank_accounts"); html = page("/financeiro/conciliacao?aba=contas", F); assert "••••7890" in html and "56789-0" not in html, "conta mascarada"
def ofx(itens): return "OFXHEADER:100\nDATA:OFXSGML\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>\n" + "".join(f"<STMTTRN>\n<TRNTYPE>{'CREDIT' if v > 0 else 'DEBIT'}\n<DTPOSTED>{d}120000\n<TRNAMT>{v:.2f}\n<FITID>{fid}\n<NAME>{nome}\n<MEMO>{memo}\n</STMTTRN>\n" for d, v, fid, nome, memo in itens) + "</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>"
EXTRATO = ofx([("20260910", 1850.00, "F1", "CARLA SOUZA", "PIX RECEBIDO"), ("20260911", 1620.00, "F2", "", "PIX RECEBIDO"), ("20260912", 2960.00, "F3", "PAULA PEREIRA", "PIX RECEBIDO"),
  ("20260915", 1390.00, "F4", "RENATA ROCHA", "PIX RECEBIDO"), ("20260918", 777.00, "F5", "JOAO XAVIER", "PIX RECEBIDO"), ("20260922", 700.00, "F6", "", "LIQUIDACAO COBRANCA"),
  ("20260923", 494.05, "F7", "", "CIELO VISA DEB"), ("20260927", 296.43, "F8", "", "CIELO MASTER DEB"), ("20260928", 5000.00, "F9", "", "TRANSF ENTRE CONTAS MESMA TITULARIDADE"), ("20260930", -45.00, "F10", "", "TARIFA PACOTE SERVICOS")])
html = page("/financeiro/conciliacao?aba=contas", F); aid = aid_of(html, 'name="contaId"')
loc = post("/financeiro/conciliacao", aid, {"contaId": CONTA, "csv": EXTRATO, "lancarCaixa": "1"}, F); assert "10 lançamento(s) novo(s)" in loc and "10 lançado(s) no fluxo de caixa" in loc, loc
loc = post("/financeiro/conciliacao", aid, {"contaId": CONTA, "csv": EXTRATO, "lancarCaixa": "1"}, F); assert "0 lançamento(s) novo(s), 10 repetido(s)" in loc, loc
st = dict(l.split("|") for l in psql("SELECT documento, status FROM bank_lines").splitlines())
assert st == {"F1": "CONCILIADO", "F2": "SUGERIDO", "F3": "CONCILIADO", "F4": "SEM_BAIXA", "F5": "NAO_IDENTIFICADO", "F6": "CONCILIADO", "F7": "SEM_PAR", "F8": "SEM_PAR", "F9": "IGNORADO", "F10": "IGNORADO"}, st
assert psql("SELECT string_agg(r.external_id, ',' ORDER BY r.external_id) FROM recon_matches m JOIN receivables r ON r.id=m.receivable_id JOIN bank_lines l ON l.id=m.bank_line_id WHERE l.documento='F3' AND m.status='CONFIRMADO'") == "T3,T4", "irmãos num PIX"
assert psql("SELECT string_agg(r.external_id, ',' ORDER BY r.external_id) FROM recon_matches m JOIN receivables r ON r.id=m.receivable_id JOIN bank_lines l ON l.id=m.bank_line_id WHERE l.documento='F6' AND m.status='CONFIRMADO'") == "T6,T7", "boletos do dia"
conf = int(psql("SELECT confianca FROM recon_matches m JOIN bank_lines l ON l.id=m.bank_line_id WHERE l.documento='F2'")); assert 50 <= conf < 90, conf
iss = dict(l.split("|") for l in psql("SELECT tipo || ':' || coalesce(dono_user_id::text,'-'), count(*) FROM recon_issues GROUP BY 1").splitlines())
assert iss.get(f"SEM_BAIXA:{SEC_ID}") == "1" and iss.get(f"NAO_IDENTIFICADO:{SEC_ID}") == "1" and iss.get(f"SEM_PAR_BAIXA:{FIN_ID}") == "1" and iss.get(f"SEM_PAR_REPASSE:{FIN_ID}") == "2", iss
assert psql("SELECT categoria FROM cash_entries WHERE descricao LIKE 'TARIFA%'") == "Financeiras" and psql("SELECT tipo FROM cash_entries WHERE descricao LIKE 'TRANSF%'") == "TRANSFERENCIA", "categorias sugeridas no caixa"
print("extrato OFX: par automático, sugestão, irmãos num PIX, boletos do dia, sem baixa, não identificado, transferência e tarifa ok")

# ---- relatório da Cielo: venda × título, repasse × banco, taxa acima do contrato, venda sem título
CIELO = """data_venda;data_pagamento;bandeira;produto;parcelas;parcela;nsu;autorizacao;valor_bruto;taxa;valor_liquido;antecipacao;unidade
22/09/2026;23/09/2026;Visa;Débito;1;1;111;A1;500,00;5,95;494,05;não;Carandá
23/09/2026;23/10/2026;Visa;Crédito à vista;1;1;222;A2;900,00;22,41;877,59;não;Carandá
25/09/2026;26/10/2026;Visa;Crédito à vista;1;1;333;A3;600,00;18,00;582,00;não;Carandá
26/09/2026;27/09/2026;Mastercard;Débito;1;1;444;A4;300,00;3,57;296,43;não;Carandá"""
html = page("/financeiro/conciliacao?aba=contas", F); aid = aid_of(html, "Importar relatório da Cielo")
loc = post("/financeiro/conciliacao", aid, {"csv": CIELO, "unitId": car}, F); assert "4 venda(s) nova(s)" in loc and "3 venda(s) casada(s)" in loc and "2 repasse(s) conciliado(s)" in loc, loc
v = dict(l.split("|") for l in psql("SELECT nsu, status || '/' || repasse FROM card_sales").splitlines()); assert v == {"111": "CASADA/CREDITADA", "222": "CASADA/A_RECEBER", "333": "CASADA/A_RECEBER", "444": "PENDENTE/CREDITADA"}, v
assert psql("SELECT string_agg(documento || ':' || status, ',' ORDER BY documento) FROM bank_lines WHERE documento IN ('F7','F8')") == "F7:CONCILIADO,F8:CONCILIADO"
assert psql("SELECT count(*) FROM recon_issues WHERE tipo='SEM_PAR_REPASSE' AND status='RESOLVIDA' AND desfecho='CONCILIADO_AUTO'") == "2", "repasse sem vendas resolvido sozinho"
taxa = psql("SELECT valor || '|' || descricao FROM recon_issues WHERE tipo='TAXA'"); assert taxa.startswith("3.06|") and "3,00%" in taxa and "2,49%" in taxa, taxa
assert psql("SELECT count(*) FROM recon_issues WHERE tipo='VENDA_SEM_TITULO' AND status='ABERTA'") == "1"
assert psql("SELECT count(*) FROM receivables WHERE external_id IN ('T8','T9','T10') AND conciliado_em IS NOT NULL") == "3"
html = page("/financeiro/conciliacao?aba=cartao&ctx_p=2026-09", F); assert "Taxa praticada × contratada" in html and "3,06" in html; print("Cielo: venda × título, repasses, taxa acima do contrato (R$ 3,06) e venda sem título ok")

# ---- confirmar sugestão; secretaria só faz triagem
html = page("/financeiro/conciliacao?aba=pix&ctx_p=2026-09&situacao=sugeridos", F); assert "sugestão" in html
grupo = psql("SELECT grupo FROM recon_matches m JOIN bank_lines l ON l.id=m.bank_line_id WHERE l.documento='F2' AND m.status='SUGERIDO'")
loc = post("/financeiro/conciliacao", aid_of(html, f'value="{grupo}"'), {"grupo": grupo, "voltar": "/financeiro/conciliacao"}, F); assert "Par confirmado" in loc, loc
assert psql("SELECT status FROM bank_lines WHERE documento='F2'") == "CONCILIADO" and psql("SELECT metodo FROM recon_matches WHERE grupo='" + grupo + "'") == "HUMANO"
r = SEC.get(B + "/financeiro/conciliacao?aba=pix", allow_redirects=False); assert r.status_code == 200 and "Triagem de pagadores" in r.text and "Confirmar em lote" not in r.text
html = page("/financeiro/conciliacao?aba=triagem", SEC); assert "JOAO XAVIER" in html and "Título em aberto de Davi Rocha" in html
lid = psql("SELECT id FROM bank_lines WHERE documento='F5'"); did = psql("SELECT id FROM students WHERE nome='Davi Rocha'")
loc = post("/financeiro/conciliacao", aid_of(html, 'name="aluno"'), {"lineId": lid, "aluno": f"Davi Rocha — Carandá (#{did})", "voltar": "/financeiro/conciliacao?aba=triagem"}, SEC); assert "não há título com esse valor" in loc, loc
assert psql("SELECT status FROM bank_lines WHERE documento='F5'") == "SEM_PAR" and psql("SELECT desfecho FROM recon_issues WHERE tipo='NAO_IDENTIFICADO'") == "IDENTIFICADO" and psql("SELECT count(*) FROM recon_issues WHERE tipo='SEM_PAR_CREDITO' AND status='ABERTA'") == "1"
html = page("/financeiro/conciliacao?aba=contas", SEC); assert "Salvar conta" not in html and "Importar relatório" not in html
print("confirmação de sugestão e triagem pela secretaria ok")

# ---- divergências: desfecho tipificado, evidência e alçada
html = page("/financeiro/divergencias", SEC); assert "Taxa de cartão acima do contrato" not in html and "Crédito sem baixa no ActiveSoft" in html
tax = psql("SELECT id FROM recon_issues WHERE tipo='TAXA'"); h2 = page("/financeiro/divergencias", F); aidr = aid_of(h2, f"Resolver #{tax}")
loc = post("/financeiro/divergencias", aidr, {"id": tax, "desfecho": "IDENTIFICADO", "obs": "tentando fechar a taxa pela secretaria", "voltar": "/financeiro/divergencias"}, SEC); assert "não trata este tipo" in loc, loc
spb = psql("SELECT id FROM recon_issues WHERE tipo='SEM_PAR_BAIXA'"); aidr = aid_of(h2, f"Resolver #{spb}")
loc = post("/financeiro/divergencias", aidr, {"id": spb, "desfecho": "PERDA_ASSUMIDA", "obs": "taxa lançada em duplicidade, família não pagou", "voltar": "/financeiro/divergencias"}, F); assert "exige evidência anexada" in loc, loc
PDF = ("arquivo", ("aprovacao.pdf", b"%PDF-1.4\n% evidencia de teste\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF", "application/pdf"))
loc = post("/financeiro/divergencias", aidr, {"id": spb, "desfecho": "PERDA_ASSUMIDA", "obs": "taxa lançada em duplicidade, família não pagou", "voltar": "/financeiro/divergencias"}, F, arquivos=[PDF]); assert "resolvida com desfecho" in loc, loc
spc = psql("SELECT id FROM recon_issues WHERE tipo='SEM_PAR_CREDITO'"); aidr = aid_of(h2, f"Resolver #{spc}")
loc = post("/financeiro/divergencias", aidr, {"id": spc, "desfecho": "PERDA_ASSUMIDA", "obs": "valor devolvido? não — assumido", "voltar": "/financeiro/divergencias"}, F, arquivos=[PDF]); assert "só com a Direção" in loc, loc
loc = post("/financeiro/divergencias", aidr, {"id": spc, "desfecho": "ESTORNO", "obs": "PIX devolvido ao pagador pelo banco", "voltar": "/financeiro/divergencias"}, D, arquivos=[PDF]); assert "resolvida" in loc, loc
sbx = psql("SELECT id FROM recon_issues WHERE tipo='SEM_BAIXA'"); h3 = page("/financeiro/divergencias", SEC); aidr = aid_of(h3, f"Resolver #{sbx}")
loc = post("/financeiro/divergencias", aidr, {"id": sbx, "desfecho": "BAIXA_REGISTRADA", "obs": "baixa registrada no ActiveSoft em 16/09", "voltar": "/financeiro/divergencias"}, SEC); assert "resolvida" in loc, loc
assert int(psql("SELECT count(*) FROM audit_log WHERE acao='resolver pendência de conciliação'")) >= 3
print("divergências: desfecho tipificado, evidência obrigatória e alçada da perda ok")

# ---- a baixa registrada na fonte chega pela reimportação; estorno de baixa desfaz o par
TIT2 = TIT.replace("T5;Davi Rocha;Renata Rocha;Carandá;Mensalidade;09/2026;10/09/2026;1.390,00;;;aberto;", "T5;Davi Rocha;Renata Rocha;Carandá;Mensalidade;09/2026;10/09/2026;1.390,00;15/09/2026;1.390,00;pago;PIX")
html = page("/financeiro/importar", F); loc = post("/financeiro/importar", action_ids(html)[0], {"csv": TIT2}, F); assert "11 atualizado(s)" in loc, loc
html = page("/financeiro/conciliacao?aba=contas", F); loc = post("/financeiro/conciliacao", aid_of(html, "Conciliar de novo"), {"competencia": "2026-09", "voltar": "/financeiro/conciliacao"}, F); assert "refeita" in loc, loc
assert psql("SELECT status FROM bank_lines WHERE documento='F4'") == "CONCILIADO", "baixa registrada → conciliado"
TIT3 = TIT2.replace("T1;Ana Souza;Carla Souza;Carandá;Mensalidade;09/2026;10/09/2026;1.850,00;10/09/2026;1.850,00;pago;PIX", "T1;Ana Souza;Carla Souza;Carandá;Mensalidade;09/2026;10/09/2026;1.850,00;;;aberto;")
html = page("/financeiro/importar", F); post("/financeiro/importar", action_ids(html)[0], {"csv": TIT3}, F)
assert psql("SELECT motivo_desfazer FROM recon_matches m JOIN receivables r ON r.id=m.receivable_id WHERE r.external_id='T1' AND m.status='DESFEITO'") == "Baixa estornada no ActiveSoft"
assert psql("SELECT status FROM bank_lines WHERE documento='F1'") == "PENDENTE"
html = page("/financeiro/importar", F); post("/financeiro/importar", action_ids(html)[0], {"csv": TIT2}, F)
html = page("/financeiro/conciliacao?aba=contas", F); post("/financeiro/conciliacao", aid_of(html, "Conciliar de novo"), {"competencia": "2026-09", "voltar": "/financeiro/conciliacao"}, F)
assert psql("SELECT status FROM bank_lines WHERE documento='F1'") == "CONCILIADO"
print("baixa registrada na fonte concilia; estorno desfaz o par e a volta concilia de novo ok")

# ---- fechamento da competência: bloqueado abaixo da meta, trava, reabertura só da Direção
html = page("/financeiro/recebimentos?ctx_p=2026-09", F); assert "Recebimentos do mês" in html and "Conciliado ÷ recebido" in html
rid = psql("SELECT id FROM receivables WHERE external_id='T2'"); psql(f"UPDATE receivables SET conciliado_em=NULL WHERE id={rid}")
loc = post("/financeiro/recebimentos", aid_of(html, "Fechar competência"), {"competencia": "2026-09", "companyId": "", "voltar": "/financeiro/recebimentos?ctx_p=2026-09"}, F); assert "Fechamento bloqueado" in loc and "abaixo da meta de 100%" in loc, loc
psql(f"UPDATE receivables SET conciliado_em=now() WHERE id={rid}")
html = page("/financeiro/recebimentos?ctx_p=2026-09", F); assert "Pode fechar" in html, "gate"
loc = post("/financeiro/recebimentos", aid_of(html, "Fechar competência"), {"competencia": "2026-09", "companyId": "", "voltar": "/financeiro/recebimentos?ctx_p=2026-09"}, F); assert "fechada" in loc, loc
assert psql("SELECT status || '|' || pct FROM recon_closings") == "FECHADA|100.00"
html = page("/financeiro/conciliacao?aba=contas", F); loc = post("/financeiro/conciliacao", aid_of(html, 'name="contaId"'), {"contaId": CONTA, "csv": ofx([("20260929", 123.45, "F11", "ALGUEM", "PIX RECEBIDO")])}, F); assert "1 em competência fechada" in loc, loc
html = page("/financeiro/caixa?mes=2026-09", F); loc = post("/financeiro/caixa", aid_of(html, "Lançamento manual"), {"unitId": car, "data": "2026-09-29", "tipo": "SAIDA", "categoria": "Manutenção", "valor": "100"}, F); assert "fechada" in loc, loc
fid = psql("SELECT id FROM recon_closings"); html = page("/financeiro/recebimentos?ctx_p=2026-09", D)
loc = post("/financeiro/recebimentos", aid_of(html, "Reabrir competência"), {"id": fid, "motivo": "teste de reabertura pelo financeiro", "voltar": "/financeiro/recebimentos"}, F); assert "Só a Direção" in loc, loc
loc = post("/financeiro/recebimentos", aid_of(html, "Reabrir competência"), {"id": fid, "motivo": "Extrato de 29/09 chegou depois do fechamento", "voltar": "/financeiro/recebimentos"}, D); assert "reaberta" in loc, loc
assert psql("SELECT status FROM recon_closings") == "REABERTA" and psql("SELECT count(*) FROM audit_log WHERE acao IN ('fechar competência do financeiro','reabrir competência do financeiro','fechamento de competência bloqueado')") == "3"
print("fechamento: bloqueio abaixo da meta, trava de extrato e caixa, reabertura só pela Direção ok")

# ---- escalonamento 15/30 dias (rotina diária) e notificações sem dado pessoal
a1 = psql("SELECT id FROM recon_issues WHERE tipo='TAXA'"); a2 = psql("SELECT id FROM recon_issues WHERE tipo='VENDA_SEM_TITULO'")
psql(f"UPDATE recon_issues SET created_at=now() - interval '16 days' WHERE id={a1}"); psql(f"UPDATE recon_issues SET created_at=now() - interval '31 days' WHERE id={a2}")
r = requests.get(B + "/api/tarefas?token=setup-homologacao-2026-status"); assert r.json()["ok"], r.text[:300]
assert psql(f"SELECT escalonamento FROM recon_issues WHERE id={a1}") == "1" and psql(f"SELECT escalonamento FROM recon_issues WHERE id={a2}") == "2"
n15 = psql("SELECT titulo FROM notifications n JOIN users u ON u.id=n.user_id WHERE u.email='fin@status' AND n.titulo LIKE '%passaram de 15 dias%'"); n30 = psql("SELECT titulo FROM notifications n JOIN users u ON u.id=n.user_id WHERE u.email='dir@geral' AND n.titulo LIKE '%passaram de 30 dias%'")
assert n15 and n30 and "Rocha" not in n15 + n30 and "Pereira" not in n15 + n30, (n15, n30)
print("escalonamento 15 dias → gestor financeiro, 30 dias → Direção, sem nomes ok")

# ---- permissões, exportação e auditoria de negação
r = G.get(B + "/financeiro/conciliacao", allow_redirects=False); assert r.status_code in (302, 303, 307), r.status_code
r = G.get(B + "/financeiro/recebimentos", allow_redirects=False); assert r.status_code in (302, 303, 307)
assert int(psql("SELECT count(*) FROM audit_log WHERE acao LIKE 'acesso negado: %' AND user_nome='Gestor Teste'")) >= 2
r = F.get(B + "/api/export/divergencias?situacao=todas"); assert r.status_code == 200 and "tipo;origem;unidade" in r.text and "Taxa de cartão acima do contrato" in r.text
r = F.get(B + "/api/export/recebimentos?periodo=2026-09"); assert "TOTAL" in r.text
r = G.get(B + "/api/export/divergencias"); assert r.status_code == 403
html = page("/financeiro/lancamentos/" + psql("SELECT id FROM cash_entries WHERE descricao LIKE 'TARIFA%'"), F); assert "Banco Teste — movimento Carandá" in html and "Reclassificar" in html
tid = psql("SELECT id FROM cash_entries WHERE descricao LIKE 'TARIFA%'")
loc = post(f"/financeiro/lancamentos/{tid}", aid_of(html, "Reclassificar"), {"id": tid, "categoria": "Outras despesas", "motivo": "pacote de serviços entra como despesa administrativa"}, F); assert "reclassificado" in loc, loc
assert psql("SELECT categoria FROM cash_entries WHERE descricao LIKE 'TARIFA%'") == "Outras despesas" and psql("SELECT count(*) FROM audit_log WHERE acao='reclassificar lançamento de caixa'") == "1"
html = page("/arquitetura?aba=fichas&estado=FORA", D); assert "T-035" not in html and "T-016" in html
print("permissões, exportações, reclassificação com trilha e rastreabilidade ok")
print("e2e_conciliacao: todas as verificações OK")
