# E2E — Central de solicitações (v22): formulários por tipo, etapas com alçada por valor, aprovação pelo celular, devolução e reenvio
# (alçada recalculada), rejeição, ninguém aprova o próprio pedido, cancelamento, visibilidade e anexos; tipos configuráveis;
# contratos de fornecedores (vencimento, aviso prévio, reajuste, renovação, encerramento) e licenças/alvarás (matriz, validade, renovação).
import re, subprocess, requests
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
B = "http://localhost:3100"; TOKEN = "setup-homologacao-2026-status"
def psql(q): return subprocess.run(["su", "postgres", "-c", f"/usr/lib/postgresql/16/bin/psql -h /tmp/pg -U status -d status_people -q -t -A -c \"{q.replace(chr(34), chr(92) + chr(34))}\""], capture_output=True, text=True).stdout.strip()
def mk(): s = requests.Session(); s.headers.update({"Origin": B}); return s
S = mk(); unq = requests.utils.unquote; N = [0]
def ok(msg): N[0] += 1; print(f"  ✓ {msg}")
def action_ids(html):
    i = html.find("<main"); body = html[i:] if i >= 0 else html
    return re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', body)
def fix_cookie(sess, r):
    m = re.search(r"rh_session=([^;]+)", r.headers.get("set-cookie", ""))
    if m: sess.headers["Cookie"] = f"rh_session={m.group(1)}"
def page(path, expect=200, sess=None):
    sess = sess or S; r = sess.get(B + path, allow_redirects=False)
    assert r.status_code == expect, (path, r.status_code, r.headers.get("location"))
    return re.sub(r"<script[^>]*>.*?</script>", "", re.sub(r"<!--.*?-->", "", r.text), flags=re.S).replace("\xa0", " ")
def post(path, aid, data, sess=None, files=None):
    sess = sess or S; f = [(f"$ACTION_ID_{aid}", (None, ""))]
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
def login(sess, email, senha):
    html = sess.get(B + "/login").text; aid = re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', html)[0]
    loc = post("/login", aid, {"email": email, "senha": senha}, sess=sess); assert loc.endswith("/"), loc
def erro(loc, trecho): assert "erro=" in loc and trecho in loc, (trecho, loc)
def okmsg(loc, trecho=""): assert "ok=" in loc and trecho in loc, (trecho, loc)
HOJE = datetime.now(ZoneInfo("America/Campo_Grande")).date(); H = HOJE.isoformat()
def d(n): return (HOJE + timedelta(days=n)).isoformat()

print("Preparação")
login(S, "rh@colegiostatus", "Status2026!"); r = S.get(B + f"/api/setup?token={TOKEN}"); assert r.json()["ok"], r.text
CAR, CUL = (psql(f"SELECT id FROM units WHERE codigo='{c}'") for c in ["CAR", "CUL"])
psql(f"INSERT INTO employees (nome, unit_id, vinculo, admissao) VALUES ('Carla Colaboradora', {CAR}, 'CLT', '2024-01-10'), ('Davi Colega', {CAR}, 'CLT', '2024-01-10')")
EC, ED = (psql(f"SELECT id FROM employees WHERE nome='{n}'") for n in ["Carla Colaboradora", "Davi Colega"])
html = page("/configuracoes"); aid_user = aid_of(html, "Criar acesso")
def criar_user(nome, email, role, unit="", emp=""):
    post("/configuracoes", aid_user, {"nome": nome, "email": email, "role": role, "unitId": unit, "employeeId": emp, "senha": "senha12345"}); return psql(f"SELECT id FROM users WHERE email='{email}'")
UC = criar_user("Carla", "carla@car", "COLABORADOR", "", EC); UD2 = criar_user("Davi", "davi@car", "COLABORADOR", "", ED); UDIR = criar_user("Diretora Carandá", "dir@car", "DIRETOR_UNIDADE", CAR); UFIN = criar_user("Financeiro Rede", "fin@rede", "FINANCEIRO")
UDG = criar_user("Diretora Geral", "dg@rede", "DIRECAO"); UDC = criar_user("Diretor Cultura", "dir@cul", "DIRETOR_UNIDADE", CUL); UOPS = criar_user("Operações Rede", "ops@rede", "OPERACOES")
CS = mk(); login(CS, "carla@car", "senha12345"); DV = mk(); login(DV, "davi@car", "senha12345"); DS = mk(); login(DS, "dir@car", "senha12345"); FS = mk(); login(FS, "fin@rede", "senha12345"); DG = mk(); login(DG, "dg@rede", "senha12345"); DC = mk(); login(DC, "dir@cul", "senha12345"); OP = mk(); login(OP, "ops@rede", "senha12345")
TREE = psql("SELECT id FROM request_types WHERE codigo='REEMBOLSO'"); TCOMP = psql("SELECT id FROM request_types WHERE codigo='COMPRA'")
ok("colaboradora e colega (autoatendimento), diretoras, financeiro, Direção e operações; 5 tipos de solicitação já cadastrados")

print("Abrir solicitação (formulário do tipo)")
h = page("/solicitacoes/nova", sess=CS); assert "Reembolso de despesa" in h and "Pedido de compra" in h
h = page(f"/solicitacoes/nova?tipo={TREE}", sess=CS); aid_ab = aid_of(h, "Enviar para aprovação")
ped = {"typeId": TREE, "campo_descricao": "Material de papelaria para a feira de ciências", "campo_data": d(-2), "campo_valor": "1.500,50", "campo_forma": "PIX"}
erro(post("/solicitacoes/nova", aid_ab, {**ped, "campo_descricao": ""}, sess=CS), "Preencha"); erro(post("/solicitacoes/nova", aid_ab, {**ped, "campo_valor": "abc"}, sess=CS), "número inválido"); erro(post("/solicitacoes/nova", aid_ab, {**ped, "campo_forma": "Cheque"}, sess=CS), "escolha uma das opções")
loc = post("/solicitacoes/nova", aid_ab, ped, sess=CS); okmsg(loc, "enviada"); R1 = re.search(r"/solicitacoes/(\d+)", loc).group(1)
row = psql(f"SELECT numero || '|' || valor || '|' || unit_id || '|' || jsonb_array_length(etapas) || '|' || (etapas->0->'aprovadores')::text || '|' || (etapas->1->'aprovadores')::text || '|' || (etapas->2->'aprovadores')::text FROM requests WHERE id={R1}")
assert row == f"SOL-{H[:4]}-0001|1500.50|{CAR}|3|[{UDIR}]|[{UFIN}]|[{UDG}]", row
assert psql(f"SELECT count(*) FROM notifications WHERE user_id={UDIR} AND titulo LIKE 'Aprovar:%'") == "1"
loc = post("/solicitacoes/nova", aid_ab, {**ped, "campo_valor": "200"}, sess=CS); R2 = re.search(r"/solicitacoes/(\d+)", loc).group(1)
assert psql(f"SELECT jsonb_array_length(etapas) FROM requests WHERE id={R2}") == "2"
ok("reembolso: obrigatórios, número e opções validados; R$ 1.500,50 passa por diretora → financeiro → Direção (acima de R$ 1.000); R$ 200 só duas etapas; unidade da ficha; aprovador avisado")

print("Aprovação em etapas, devolução e reenvio")
hd = page(f"/solicitacoes/{R1}", sess=DS); aid_dec = aid_of(hd, "Aprovar R$")
erro(post(f"/solicitacoes/{R1}", aid_dec, {"id": R1, "decisao": "APROVAR"}, sess=FS), "não está com você")
okmsg(post(f"/solicitacoes/{R1}", aid_dec, {"id": R1, "decisao": "APROVAR"}, sess=DS), "seguiu para “Financeiro”")
assert psql(f"SELECT etapa_atual || '|' || status || '|' || (etapas->0->>'decisao') FROM requests WHERE id={R1}") == "1|EM_APROVACAO|APROVADA" and psql(f"SELECT count(*) FROM notifications WHERE user_id={UFIN} AND titulo LIKE 'Aprovar:%'") == "1"
erro(post(f"/solicitacoes/{R1}", aid_dec, {"id": R1, "decisao": "DEVOLVER"}, sess=FS), "ajustado")
okmsg(post(f"/solicitacoes/{R1}", aid_dec, {"id": R1, "decisao": "DEVOLVER", "obs": "Falta a nota fiscal e o valor está acima do orçado"}, sess=FS), "Devolvida")
assert psql(f"SELECT status FROM requests WHERE id={R1}") == "DEVOLVIDA" and psql(f"SELECT count(*) FROM notifications WHERE user_id={UC} AND titulo LIKE 'Devolvida%'") == "1"
hc = page(f"/solicitacoes/{R1}", sess=CS); assert "Ajustar e reenviar" in hc; aid_re = aid_of(hc, "Reenviar")
erro(post(f"/solicitacoes/{R1}", aid_re, {"id": R1, "campo_descricao": "x", "campo_data": d(-2), "campo_valor": "900", "campo_forma": "PIX"}, sess=DV), "Só quem abriu")
okmsg(post(f"/solicitacoes/{R1}", aid_re, {"id": R1, "campo_descricao": "Material de papelaria (com nota)", "campo_data": d(-2), "campo_valor": "900", "campo_forma": "PIX", "obs": "Nota anexada; valor corrigido"}, sess=CS), "Reenviada")
assert psql(f"SELECT status || '|' || etapa_atual || '|' || jsonb_array_length(etapas) || '|' || valor FROM requests WHERE id={R1}") == "EM_APROVACAO|0|2|900.00"
okmsg(post(f"/solicitacoes/{R1}", aid_dec, {"id": R1, "decisao": "APROVAR"}, sess=DS), "seguiu"); okmsg(post(f"/solicitacoes/{R1}", aid_dec, {"id": R1, "decisao": "APROVAR", "voltar": "/solicitacoes?aba=aprovar"}, sess=FS), "aprovada (última etapa)")
assert psql(f"SELECT status || '|' || (concluida_em IS NOT NULL) FROM requests WHERE id={R1}") == "APROVADA|true" and psql(f"SELECT count(*) FROM notifications WHERE user_id={UC} AND titulo LIKE 'Aprovada:%'") == "1"
hc = page(f"/solicitacoes/{R1}", sess=CS); assert "O Financeiro registra o pagamento com o débito do extrato" in hc and "Devolveu" in hc and "Reenviou" in hc
ok("etapa fora da vez barrada; aprovação passa adiante; devolução exige o ajuste e avisa a solicitante; reenvio recalcula a alçada (R$ 900 → sem Direção) e recomeça; aprovação final avisa")

print("Ninguém aprova o próprio pedido; rejeição; cancelamento")
h = page(f"/solicitacoes/nova?tipo={TCOMP}", sess=DS); aid_ab2 = aid_of(h, "Enviar para aprovação")
loc = post("/solicitacoes/nova", aid_ab2, {"typeId": TCOMP, "campo_item": "Ventiladores", "campo_quantidade": "4", "campo_valor": "1200", "campo_justificativa": "Salas sem ventilação"}, sess=DS); R3 = re.search(r"/solicitacoes/(\d+)", loc).group(1)
assert psql(f"SELECT (etapas->0->'aprovadores')::text FROM requests WHERE id={R3}") == f"[{UDG}]"
hd = page(f"/solicitacoes/{R3}", sess=DG); aid_d3 = aid_of(hd, "Aprovar R$")
erro(post(f"/solicitacoes/{R3}", aid_d3, {"id": R3, "decisao": "APROVAR"}, sess=DS), "própria")
erro(post(f"/solicitacoes/{R3}", aid_d3, {"id": R3, "decisao": "REJEITAR"}, sess=DG), "motivo")
okmsg(post(f"/solicitacoes/{R3}", aid_d3, {"id": R3, "decisao": "REJEITAR", "obs": "Sem orçamento neste trimestre"}, sess=DG), "rejeitada")
hc = page(f"/solicitacoes/{R2}", sess=CS); aid_can = aid_of(hc, "Cancelar solicitação")
erro(post(f"/solicitacoes/{R2}", aid_can, {"id": R2}, sess=DV), "Só quem abriu"); okmsg(post(f"/solicitacoes/{R2}", aid_can, {"id": R2, "obs": "comprei com verba da unidade"}, sess=CS), "cancelada")
erro(post(f"/solicitacoes/{R3}", aid_d3, {"id": R3, "decisao": "APROVAR"}, sess=DG), "não está com você")
ok("diretora que pede: etapa “diretor(a) da unidade” vai para a Direção; não aprova a si mesma; rejeição com motivo; só quem abriu cancela; decidida não volta")

print("Visibilidade, lista de aprovação no celular e anexos")
page(f"/solicitacoes/{R1}", expect=404, sess=DC); page(f"/solicitacoes/{R1}", expect=404, sess=DV); assert "Material de papelaria" in page(f"/solicitacoes/{R1}", sess=FS)
loc = post("/solicitacoes/nova", aid_ab, {**ped, "campo_valor": "50"}, sess=CS); R4 = re.search(r"/solicitacoes/(\d+)", loc).group(1)
hl = page("/solicitacoes?aba=aprovar", sess=DS); mn = hl[hl.find("<main"):hl.find("</main>")]; assert "Para eu aprovar (1)" in mn and "R$ 50,00" in mn and "Sem documento:" in mn and ">Aprovar<" not in mn and "Abrir e decidir" in mn, "v25: despesa sem comprovante não tem atalho"
hc = page(f"/solicitacoes/{R4}", sess=CS); aid_anx = aid_of(hc, "Anexar")
okmsg(post(f"/solicitacoes/{R4}", aid_anx, {"entidade": "request", "entidadeId": R4, "voltar": f"/solicitacoes/{R4}"}, sess=CS, files=[("arquivo", ("nota.pdf", b"%PDF-1.4 nota", "application/pdf"))]), "anexado")
hl = page("/solicitacoes?aba=aprovar", sess=DS); aid_l = aid_of(hl, ">Aprovar<")
okmsg(post("/solicitacoes?aba=aprovar", aid_l, {"id": R4, "decisao": "APROVAR", "rapido": "1", "voltar": "/solicitacoes?aba=aprovar"}, sess=DS), "seguiu")
assert "Nada aguardando sua aprovação" in page("/solicitacoes?aba=aprovar", sess=DS)
AX = psql(f"SELECT id FROM attachments WHERE entidade='request' AND entidade_id={R4}")
assert CS.get(B + f"/api/anexos/{AX}").status_code == 200 and FS.get(B + f"/api/anexos/{AX}").status_code == 200 and DV.get(B + f"/api/anexos/{AX}").status_code == 403 and DC.get(B + f"/api/anexos/{AX}").status_code == 403
ok("diretor de outra unidade e colega não abrem; financeiro (aprovador) vê; lista “para eu aprovar” com um toque; comprovante anexado pela solicitante e visível só aos envolvidos")

print("Tipos configuráveis")
h = page("/solicitacoes/tipos"); aid_t = aid_of(h, 'name="codigo"')
tp = {"nome": "Uso de veículo da escola", "prazoDias": 2, "ativo": "1", "campos": "Destino | texto | sim\nData | data | sim\nTurno | seleção | sim | Manhã; Tarde\nCusto estimado | valor (R$) | não", "etapas": "Operações | Operações\nDireção | dg@rede | acima de 300", "perfis": ["COLABORADOR"]}
erro(post("/solicitacoes/tipos", aid_t, {**tp, "campos": "Destino | cor | sim"}), "tipo “cor” inválido"); erro(post("/solicitacoes/tipos", aid_t, {**tp, "campos": "Turno | seleção | sim | Manhã"}), "pelo menos 2 opções")
erro(post("/solicitacoes/tipos", aid_t, {**tp, "etapas": "Aprovação | Tesouraria"}), "desconhecido"); erro(post("/solicitacoes/tipos", aid_t, {**tp, "etapas": "Aprovação | ninguem@x"}), "não encontrado")
erro(post("/solicitacoes/tipos", aid_t, tp, sess=DS), "Só Direção/RH")
okmsg(post("/solicitacoes/tipos", aid_t, tp), "4 campo(s), 2 etapa(s)")
TV = psql("SELECT id FROM request_types WHERE nome='Uso de veículo da escola'")
assert psql(f"SELECT (etapas->1->'usuarios')::text || '|' || (etapas->1->>'acimaDe') || '|' || perfis::text FROM request_types WHERE id={TV}") == f"[{UDG}]|300|[\"COLABORADOR\"]"
h = page(f"/solicitacoes/nova?tipo={TV}", sess=DS); assert "Nova solicitação" in h and "Uso de veículo" not in h[h.find("<main"):]
loc = post("/solicitacoes/nova", aid_ab, {"typeId": TV, "campo_destino": "Aeroporto", "campo_data": d(3), "campo_turno": "Manhã"}, sess=DS); erro(loc, "Seu perfil não abre")
loc = post("/solicitacoes/nova", aid_ab, {"typeId": TV, "campo_destino": "Museu", "campo_data": d(3), "campo_turno": "Tarde", "campo_custo_estimado": "450"}, sess=CS); RV = re.search(r"/solicitacoes/(\d+)", loc).group(1)
assert psql(f"SELECT jsonb_array_length(etapas) || '|' || (etapas->0->'aprovadores')::text FROM requests WHERE id={RV}") == f"2|[{UOPS}]"
ok("tipo novo pelo editor de linhas: tipo de campo, opções, perfis e e-mails validados; só Direção/RH configuram; perfil restrito; etapa por usuário nomeado acima de R$ 300")
csv = FS.get(B + "/api/export/solicitacoes").content.decode("utf-8-sig"); assert csv.splitlines()[0].startswith("numero;titulo;tipo") and "Aprovada" in csv and "Rejeitada" in csv
assert CS.get(B + "/api/export/solicitacoes").status_code == 401 and DV.get(B + "/api/export/solicitacoes").status_code == 401

print("Contratos de fornecedores")
psql("INSERT INTO suppliers (nome, servico) VALUES ('Clima Frio Ltda', 'Ar-condicionado'), ('Limpa Tudo SA', 'Limpeza')"); SUP1, SUP2 = (psql(f"SELECT id FROM suppliers WHERE nome='{n}'") for n in ["Clima Frio Ltda", "Limpa Tudo SA"])
h = page("/operacoes/contratos", sess=OP); aid_c = aid_of(h, "Cadastrar contrato")
ct = {"supplierId": SUP1, "objeto": "Manutenção preventiva do ar-condicionado", "inicio": "2025-11-01", "fim": d(20), "renovacao": "MANUAL", "avisoPrevioDias": 30, "valorMensal": "2.400,00", "reajusteIndice": "IPCA", "proximoReajuste": d(10)}
erro(post("/operacoes/contratos", aid_c, {**ct, "fim": "2025-01-01"}, sess=OP), "anterior ao início"); erro(post("/operacoes/contratos", aid_c, {**ct, "avisoPrevioDias": 400}, sess=OP), "Aviso prévio")
erro(post("/operacoes/contratos", aid_c, {**ct, "unitId": CUL}, sess=DS), "Sem acesso"); erro(post("/operacoes/contratos", aid_c, {**ct, "valorMensal": "dois mil"}, sess=OP), "valor inválido"); erro(post("/operacoes/contratos", aid_c, ct, sess=CS), "Sem permissão")
loc = post("/operacoes/contratos", aid_c, ct, sess=OP); okmsg(loc, "salvo"); K1 = re.search(r"/contratos/(\d+)", loc).group(1)
loc = post("/operacoes/contratos", aid_c, {**ct, "supplierId": SUP2, "objeto": "Limpeza terceirizada", "fim": d(45), "valorMensal": "8000", "proximoReajuste": ""}, sess=OP); K2 = re.search(r"/contratos/(\d+)", loc).group(1)
loc = post("/operacoes/contratos", aid_c, {**ct, "objeto": "Locação de bebedouros", "fim": d(-3), "proximoReajuste": "", "unitId": CAR}, sess=DS); K3 = re.search(r"/contratos/(\d+)", loc).group(1)
h = page("/operacoes/contratos", sess=OP)
assert "vence em 20 dia(s)" in h and "reajuste em 10 dia(s)" in h and "prazo para avisar a não renovação termina em 15 dia(s)" in h and "vence em 45 dia(s)" in h and "vencido há 3 dia(s)" in h
assert "R$ 12.800,00" in h
ok("contratos: datas, aviso prévio e valor validados; diretora só na própria unidade; alertas de fim (20 e 45 dias), do prazo para avisar a não renovação, de reajuste e de vencido; valor mensal comprometido")
hk = page(f"/operacoes/contratos/{K1}", sess=OP); aid_ren = aid_of(hk, "Renovar contrato")
erro(post(f"/operacoes/contratos/{K1}", aid_ren, {"id": K1, "inicio": d(21), "fim": d(21)}, sess=OP), "novo fim")
loc = post(f"/operacoes/contratos/{K1}", aid_ren, {"id": K1, "fim": d(386), "valorMensal": "2.520,00"}, sess=OP); okmsg(loc, "renovado"); K1b = re.search(r"/contratos/(\d+)", loc).group(1)
assert psql(f"SELECT status FROM contracts WHERE id={K1}") == "ENCERRADO" and psql(f"SELECT inicio || '|' || renovado_de || '|' || valor_mensal FROM contracts WHERE id={K1b}") == f"{d(21)}|{K1}|2520.00"
hk = page(f"/operacoes/contratos/{K3}", sess=DS); aid_enc = aid_of(hk, 'name="motivo"')
erro(post(f"/operacoes/contratos/{K3}", aid_enc, {"id": K3, "status": "ENCERRADO", "motivo": "x"}, sess=DS), "motivo")
okmsg(post(f"/operacoes/contratos/{K3}", aid_enc, {"id": K3, "status": "ENCERRADO", "motivo": "Não renovado: bebedouros próprios"}, sess=DS), "encerrado")
page(f"/operacoes/contratos/{K2}", sess=DC); page(f"/operacoes/contratos/{K3}", expect=404, sess=DC)
csv = OP.get(B + "/api/export/contratos").content.decode("utf-8-sig"); assert "Limpeza terceirizada" in csv and "vence em 45 dia(s)" in csv
ok("renovação cria novo período a partir do fim (valor reajustado) e encerra o anterior; encerramento com motivo; contrato de outra unidade não abre; CSV com alertas")

print("Licenças, alvarás e laudos")
h = page("/operacoes/licencas", sess=OP); aid_l = aid_of(h, 'name="dispensar"')
def lic(tipo, validade, unit=CAR, sess=OP, **kw): return post("/operacoes/licencas", aid_l, {"unitId": unit, "tipo": tipo, "orgao": "Órgão", "validade": validade, "antecedenciaDias": 60, **kw}, sess=sess)
erro(lic("AVCB", d(30), emissao=d(40)), "anterior à emissão"); erro(lic("XYZ", d(30)), "Escolha o tipo"); erro(lic("AVCB", d(30), sess=FS), "Sem permissão"); erro(lic("AVCB", d(30), unit=CUL, sess=DS), "Sem acesso")
loc = lic("AVCB", d(30)); okmsg(loc, "salvo"); L1 = re.search(r"/licencas/(\d+)", loc).group(1)
lic("ALVARA_FUNCIONAMENTO", d(-1)); lic("SANITARIA", d(200), sess=DS)
erro(lic("SPDA", "", unit=CUL, dispensar="1"), "não se aplica"); okmsg(lic("SPDA", "", unit=CUL, dispensar="1", obs="Prédio sem exigência de SPDA (laudo de 2025)"), "salvo")
h = page("/operacoes/licencas", sess=OP); mat = h[h.find("Matriz por unidade"):h.find("Cadastrar documento")]
assert "Vence em breve" in mat and "Vencida" in mat and "Em dia" in mat and "Não se aplica" in mat and "Não cadastrada" in mat
hl = page(f"/operacoes/licencas/{L1}", sess=OP); aid_rl = aid_of(hl, "Registrar renovação")
erro(post(f"/operacoes/licencas/{L1}", aid_rl, {"id": L1, "validade": d(-5)}, sess=OP), "futura")
loc = post(f"/operacoes/licencas/{L1}", aid_rl, {"id": L1, "validade": d(365), "numero": "AVCB 2026/123"}, sess=OP); okmsg(loc, "Renovada"); L1b = re.search(r"/licencas/(\d+)", loc).group(1)
assert psql(f"SELECT status FROM licenses WHERE id={L1}") == "SUBSTITUIDA" and psql(f"SELECT renovado_de FROM licenses WHERE id={L1b}") == L1
assert "Substituído (histórico)" in page(f"/operacoes/licencas/{L1}", sess=OP)
csv = OP.get(B + "/api/export/licencas").content.decode("utf-8-sig"); assert "AVCB — Corpo de Bombeiros" in csv and "Não cadastrada" in csv and "Vencida" in csv
page(f"/operacoes/licencas/{L1b}", expect=404, sess=DC)
ok("licenças: datas validadas; financeiro sem acesso; diretora só na unidade; matriz com vencida, vence em breve, em dia, não se aplica (justificado) e lacunas; renovação cria novo registro e guarda o histórico; CSV com lacunas")

print("Quem vê contratos e licenças; anexos")
UGE = criar_user("Coord Carandá", "coord@car", "GESTOR", CAR); UCM = criar_user("Comercial", "com@rede", "COMERCIAL"); ULE = criar_user("Leitura", "lei@rede", "LEITURA")
GE = mk(); login(GE, "coord@car", "senha12345"); CM = mk(); login(CM, "com@rede", "senha12345"); LE = mk(); login(LE, "lei@rede", "senha12345")
for x in [GE, CM, CS]:
    for pth in ["/operacoes/contratos", f"/operacoes/contratos/{K2}", "/operacoes/licencas", f"/operacoes/licencas/{L1b}"]: page(pth, expect=307, sess=x)
page("/operacoes/licencas", expect=307, sess=FS); page("/operacoes/contratos", sess=FS)
hle = page("/operacoes/contratos", sess=LE); assert "Limpeza terceirizada" in hle and "Cadastrar contrato" not in hle; page("/operacoes/licencas", sess=LE)
hge = GE.get(B + "/operacoes/chamados").text; assert "Contratos de fornecedores" not in hge and "Licenças e alvarás" not in hge
hk = page(f"/operacoes/contratos/{K2}", sess=OP); aid_anx = aid_of(hk, 'name="arquivo"'); arq = [("arquivo", ("contrato.pdf", b"%PDF-1.4 teste", "application/pdf"))]
VK = f"/operacoes/contratos/{K2}"; dados = {"entidade": "contract", "entidadeId": K2, "voltar": VK}
okmsg(post(VK, aid_anx, dados, sess=OP, files=arq), "anexado"); AX = psql(f"SELECT id FROM attachments WHERE entidade='contract' AND entidade_id={K2}")
erro(post(VK, aid_anx, dados, sess=DS, files=arq), "Sem acesso"); erro(post(VK, aid_anx, dados, sess=LE, files=arq), "somente leitura"); erro(post(VK, aid_anx, dados, sess=GE, files=arq), "Sem acesso")
assert GE.get(B + f"/api/anexos/{AX}").status_code == 403 and CM.get(B + f"/api/anexos/{AX}").status_code == 403 and LE.get(B + f"/api/anexos/{AX}").status_code == 200 and DS.get(B + f"/api/anexos/{AX}").status_code == 200
assert psql(f"SELECT count(*) FROM attachments WHERE entidade='contract' AND entidade_id={K2}") == "1"
ok("contratos e licenças: coordenação, comercial e colaborador não abrem (nem no menu); financeiro vê contratos, não licenças; leitura só consulta; anexo do contrato da rede: diretora de unidade, leitura e coordenação não anexam; coordenação e comercial não baixam")

print(f"\nE2E Solicitações, contratos e licenças: {N[0]} verificações OK")
