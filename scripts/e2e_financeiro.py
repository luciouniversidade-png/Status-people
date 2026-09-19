import re, subprocess, requests
B = "http://localhost:3100"
def psql(q): return subprocess.run(["su", "postgres", "-c", f"/usr/lib/postgresql/16/bin/psql -h /tmp/pg -U status -d status_people -q -t -c \"{q}\""], capture_output=True, text=True).stdout.strip()
def mk(): s = requests.Session(); s.headers.update({"Origin": B}); return s
S = mk()
def action_ids(html):
    i = html.find("<main"); body = html[i:] if i >= 0 else html
    return re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', body)
def fix_cookie(sess, r):
    m = re.search(r"rh_session=([^;]+)", r.headers.get("set-cookie", ""))
    if m: sess.headers["Cookie"] = f"rh_session={m.group(1)}"
def page(path, expect=200, sess=None):
    sess = sess or S; r = sess.get(B + path, allow_redirects=False)
    assert r.status_code == expect, (path, r.status_code, r.headers.get("location")); return re.sub(r"<script[^>]*>.*?</script>", "", re.sub(r"<!--.*?-->", "", r.text), flags=re.S)
def post(path, aid, data, sess=None, multi=None):
    sess = sess or S; f = [(f"$ACTION_ID_{aid}", (None, ""))] + [(k, (None, str(v))) for k, v in data.items()] + [(k, (None, str(v))) for k, v in (multi or [])]
    r = sess.post(B + path, files=f, allow_redirects=False); fix_cookie(sess, r)
    assert r.status_code in (303, 302, 200), (path, r.status_code, r.text[:300]); return r.headers.get("location", "")
def find_form_aid(html, marker):
    i = html.find(marker); assert i >= 0, marker
    fs = html.rfind("<form", 0, i); fe_prev = html.rfind("</form>", 0, i)
    if fs > fe_prev: fe = html.find("</form>", i)
    else: fs = html.find("<form", i); fe = html.find("</form>", fs)
    ids = action_ids(html[fs:fe]); assert ids, marker; return ids[0]
def login(sess, email, senha):
    html = sess.get(B + "/login").text; aid = re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', html)[0]
    loc = post("/login", aid, {"email": email, "senha": senha}, sess=sess); assert loc.endswith("/") or loc.endswith("/financeiro"), loc
unq = requests.utils.unquote

login(S, "rh@colegiostatus", "Status2026!"); r = S.get(B + "/api/setup?token=setup-homologacao-2026-status"); assert r.json()["ok"], r.text
# usuário financeiro + aluno matriculado 2027 para receita
html = page("/configuracoes"); aid = find_form_aid(html, "Criar acesso"); post("/configuracoes", aid, {"nome": "Fin Status", "email": "fin@status", "role": "FINANCEIRO", "senha": "senha12345"})
post("/configuracoes", aid, {"nome": "Diretora Geral", "email": "dir@geral", "role": "DIRECAO", "senha": "senha12345"})
F = mk(); login(F, "fin@status", "senha12345"); D = mk(); login(D, "dir@geral", "senha12345")
html = page("/matriculas/alunos/novo"); aid = action_ids(html)[0]; car = re.search(r'<option value="(\d+)">Carandá</option>', html).group(1)
loc = post("/matriculas/alunos/novo", aid, {"nome": "Ana Souza", "responsavel": "Carla", "alunoAtual": "1", "unitAtualId": car}); A = re.search(r"/matriculas/alunos/(\d+)\?", loc).group(1)
html = page(f"/matriculas/alunos/{A}"); aid = find_form_aid(html, "Reservar vaga / matricular"); turma = re.search(r'<option value="(\d+)">Carandá · 1º ano A · Matutino', html).group(1)
post(f"/matriculas/alunos/{A}", aid, {"studentId": A, "classId": turma, "voltar": f"/matriculas/alunos/{A}", "confirmarDireto": "1", "contrato": "1", "financeiro": "1"})

# ---- importar títulos
html = page("/financeiro/importar", sess=F); aid = action_ids(html)[0]
csv = "titulo;aluno;responsavel;telefone;unidade;tipo;competencia;vencimento;valor;pago_em;valor_pago;status\n1001;Ana Souza;Carla;67 9;Carandá;Mensalidade;08/2026;10/08/2026;1.850,00;;;aberto\n1002;Ana Souza;Carla;67 9;Carandá;Mensalidade;07/2026;10/07/2026;1.850,00;;;aberto\n1003;Bruno Lima;Paulo;;TV Morena I;Mensalidade;08/2026;10/08/2026;1.900,00;09/08/2026;1.900,00;pago\n1004;Bruno Lima;Paulo;;TV Morena I;Mensalidade;09/2026;10/09/2026;1.900,00;;;aberto\n;Caio Sem Titulo;;;Cultura;Material;09/2026;01/09/2026;350,00;;;aberto"
loc = post("/financeiro/importar", aid, {"csv": csv}, sess=F); msg = unq(loc); assert "5 título(s) novo(s)" in msg, msg
loc = post("/financeiro/importar", aid, {"csv": csv}, sess=F); msg = unq(loc); assert "0 título(s) novo(s), 5 atualizado(s)" in msg, msg; print("importação idempotente ok")
# ---- inadimplência: aging + régua
html = page("/financeiro/inadimplencia", sess=F); assert "Ana Souza" in html and "Caio Sem Titulo" in html and "Bruno Lima" in html
assert "Aviso formal" in html or "Negociação" in html; assert "pendente" in html; print("aging + etapa da régua ok")
assert "R$" in html and "1–30 dias" in html
# registrar contato
aid = find_form_aid(html, "Registrar contato"); rid = re.search(r'name="receivableId" value="(\d+)"', html[html.find("Caio Sem Titulo"):]).group(1)
loc = post("/financeiro/inadimplencia", aid, {"receivableId": rid, "voltar": "/financeiro/inadimplencia", "etapa": "CONTATO", "canal": "WhatsApp", "resultado": "PROMESSA", "texto": "Paga dia 20"}, sess=F); assert "Contato de cobrança registrado" in unq(loc)
html = page("/financeiro/inadimplencia", sess=F); assert "Promessa de pagamento" in html; print("registro de cobrança ok")
# acordo: 2 títulos da Ana (3700) por 3000 = 19% desconto → FINANCEIRO (30%) pode; COMERCIAL não (não acessa); testar DIRETOR? RH alçada 0 → bloqueado
html = page("/financeiro/inadimplencia"); aid = find_form_aid(html, "Fechar acordo com estes títulos"); i = html.find("Ana Souza"); ids = re.findall(r'name="receivableId" value="(\d+)"', html[i:i + 40000])[:2]
loc = post("/financeiro/inadimplencia", aid, {"valorAcordado": 3000, "parcelas": 3, "primeiraParcela": "2026-10-10"}, multi=[("receivableId", ids[0]), ("receivableId", ids[1])]); assert "excede sua alçada" in unq(loc), unq(loc); print("alçada de desconto no acordo bloqueia RH ok")
html = page("/financeiro/inadimplencia", sess=F); aid = find_form_aid(html, "Fechar acordo com estes títulos")
loc = post("/financeiro/inadimplencia", aid, {"valorAcordado": 3000, "parcelas": 3, "primeiraParcela": "2026-10-10"}, multi=[("receivableId", ids[0]), ("receivableId", ids[1])], sess=F); assert "Acordo #" in unq(loc), unq(loc)
html = page("/financeiro/inadimplencia", sess=F); assert "Ana Souza" not in html.split("Acordos")[0] or "Negociado" in html; assert "0/3" in html; print("acordo criado, títulos negociados ok")
aid = find_form_aid(html, "baixar"); pids = re.findall(r'name="id" value="(\d+)"', html[html.find("parcelas"):])
for pid in pids[:3]: post("/financeiro/inadimplencia", aid, {"id": pid}, sess=F)
html = page("/financeiro/inadimplencia", sess=F); assert "Cumprido" in html and "3/3" in html; print("acordo cumprido → títulos pagos ok")
# ---- descontos com alçada
html = page("/financeiro/descontos", sess=F); aid = find_form_aid(html, "Conceder / solicitar desconto")
loc = post("/financeiro/descontos", aid, {"studentId": A, "tipo": "Irmãos", "percentual": 10, "motivo": "irmão na escola", "ano": 2027}, sess=F); assert "concedido" in unq(loc), unq(loc)
loc = post("/financeiro/descontos", aid, {"studentId": A, "tipo": "Bolsa social", "percentual": 50, "motivo": "bolsa", "ano": 2027}, sess=F); assert "aguardando" in unq(loc) or "enviado para aprovação" in unq(loc), unq(loc); print("desconto: 10% automático, 50% vai para aprovação ok")
html = page("/financeiro/descontos", sess=F); assert "Aprovar" not in html.split("Bolsa social")[1][:600]
html = page("/financeiro/descontos", sess=D); assert "Aprovar" in html; aid = find_form_aid(html, "Aprovar"); did = re.search(r'name="id" value="(\d+)"', html[html.find("Bolsa social"):]).group(1)
loc = post("/financeiro/descontos", aid, {"id": did, "decisao": "APROVADO"}, sess=D); assert "aprovado" in unq(loc); print("aprovação pela Direção ok")
# ---- receita: preço + previsto com desconto
html = page("/financeiro/receita", sess=F); aid = find_form_aid(html, "Cadastrar valor")
loc = post("/financeiro/receita", aid, {"ano": 2027, "unitId": car, "modalidade": "REGULAR", "valorMensal": 2000, "parcelas": 12, "todasSeries": "1"}, sess=F); assert "Valor salvo" in unq(loc)
html = page("/financeiro/receita", sess=F); assert "1.000,00" in html and "50" in html; print("receita prevista com desconto 50% ok (2000 → 1000)")
html = page("/financeiro/receita?ano=2026", sess=F); assert "08/2026" in html and "07/2026" in html; print("realizado por competência ok")
# ---- caixa
html = page("/financeiro/caixa?mes=2026-09", sess=F); aid = find_form_aid(html, "Importar extrato")
loc = post("/financeiro/caixa", aid, {"unitId": car, "csv": "data;tipo;categoria;forma;descricao;valor\n05/09/2026;entrada;Mensalidades;PIX;PIX recebido;1850,00\n06/09/2026;saida;Serviços e terceiros;TRANSFERENCIA;Limpeza;2.300,00\n07/09/2026;transferencia;Transferência interna;TRANSFERENCIA;Para TV Morena;500,00"}, sess=F); assert "3 lançamento(s)" in unq(loc), unq(loc)
loc = post("/financeiro/caixa", aid, {"unitId": car, "csv": "data;tipo;categoria;forma;descricao;valor\n05/09/2026;entrada;Mensalidades;PIX;PIX recebido;1850,00"}, sess=F); assert "1 repetido" in unq(loc); print("caixa importado, duplicata ignorada ok")
html = page("/financeiro/caixa?mes=2026-09", sess=F); aid = find_form_aid(html, "Saldo inicial do mês"); post("/financeiro/caixa", aid, {"mes": "2026-09", "unitId": car, "saldoInicial": 10000}, sess=F)
html = page("/financeiro/caixa?mes=2026-09", sess=F); assert "9.550,00" in html and "500,00" in html; print("saldo final 10000+1850−2300 = 9550 ok")
# ---- orçamento e DRE
html = page("/financeiro/orcamento?ano=2026", sess=F); aid = find_form_aid(html, "Orçamento mensal")
d = {"ano": 2026, "unitId": car, "c_ENTRADA_0": "Mensalidades", "b_ENTRADA_0": 1000, "c_SAIDA_3": "Serviços e terceiros", "b_SAIDA_3": 200}
loc = post("/financeiro/orcamento", aid, d, sess=F); assert "Orçamento salvo" in unq(loc)
html = page(f"/financeiro/orcamento?ano=2026&unidade={car}", sess=F); assert "DRE gerencial" in html and "Serviços e terceiros" in html and "%" in html and "Custo por aluno" in html; print("orçamento × realizado / DRE ok")
# ---- painel e permissões
html = page("/financeiro", sess=F); assert "Inadimplência" in html and "Alertas" in html and "Receita prevista" in html
rr = F.get(B + "/", allow_redirects=False); assert rr.status_code in (302, 303, 307) and rr.headers.get("location", "").endswith("/financeiro"), rr.headers.get("location"); print("perfil financeiro é levado ao financeiro ok")
for t in ["inadimplencia", "descontos", "caixa?mes=2026-09"]:
    rr = F.get(B + f"/api/export/{t}"); assert rr.status_code == 200 and rr.text.startswith("\ufeff"), t
print("exports ok")
html = page("/auditoria?entidade=agreements"); assert "acordo" in html
print("\nALL FINANCEIRO E2E CHECKS PASSED")
