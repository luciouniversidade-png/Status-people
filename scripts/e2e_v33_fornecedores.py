# E2E — v33 · Fornecedores: cadastro, homologação e gestão (SO-ARCH-SUP-001, adaptado ao STATUS ONE).
# Cobre os 10 cenários Gherkin da arquitetura (TC-SUP-001 a 010) e as integrações: migração 33.0 e cadastros anteriores (LEGADO até a
# data de transição), cadastro por etapas com dígito verificador, duplicidade exata/raiz/nome parecido e concorrente, filial, pessoa
# física com CPF mascarado (lista, CSV, busca e trilha), consulta cadastral só com fonte e data, homologação por criticidade com pareceres
# exigidos e segregação (quem envia não dá parecer; quem cadastra/envia não decide), controle otimista, revalidação pela criticidade,
# escopo por unidade (exceção formal com motivo em contas a pagar e contratos, aprovação independente), quarentena bancária com três
# pessoas, máscara e revelação registrada, conta de terceiro e Pix de outro titular, suspensão prospectiva (contas, contratos, chamados;
# aprovação de obrigação em curso só pela Direção com motivo) e corrida suspensão × lançamento, reativação supervisionada, documentos com
# hash, conferência e recusa, rotina diária (documento vencido em criticidade alta, homologação vencida, convites; aviso só com contagem),
# portal do fornecedor (token só como hash, escopo do convite, propostas sem autoaprovação, protocolo, limite, erro assinado, isolamento),
# scorecard explicável, ocorrências, importação com prévia, pendências, política em Configurações, busca, exportação e menu.
# Dados fictícios. Uso: bash /tmp/withserver.sh python3 scripts/e2e_v33_fornecedores.py
import re, json, hashlib, subprocess, requests, threading
from datetime import datetime, timedelta, date
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
    else: assert r.status_code == expect, (path, r.status_code, r.headers.get("location"), r.text[:300])
    return re.sub(r"<script[^>]*>.*?</script>", "", re.sub(r"<!--.*?-->", "", r.text), flags=re.S).replace("\xa0", " ")
def post(path, aid, data, sess, files=None):
    f = [(f"$ACTION_ID_{aid}", (None, ""))]
    for k, v in data.items():
        for x in (v if isinstance(v, list) else [v]): f.append((k, (None, str(x))))
    for k, v in (files or {}).items(): f.append((k, v))
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
def erro(loc, trecho): loc = loc.replace("\xa0", " "); assert "erro=" in loc and trecho in loc, (trecho, loc)
def okmsg(loc, trecho=""): loc = loc.replace("\xa0", " "); assert "ok=" in loc and trecho in loc, (trecho, loc)
def q(v): return "NULL" if v is None else str(v) if isinstance(v, (int, float)) else "'" + str(v).replace("'", "''") + "'"
HOJE = datetime.now(ZoneInfo("America/Campo_Grande")).date(); H = HOJE.isoformat()
def d(n): return (HOJE + timedelta(days=n)).isoformat()
def br(iso): return "/".join(reversed(iso.split("-")))
def meses(iso, m):
    """Soma meses como o Date do JavaScript (31/01 + 1 mês → 03/03)."""
    y, mo, dd = map(int, iso.split("-")); mo += m; y += (mo - 1) // 12; mo = (mo - 1) % 12 + 1
    return (date(y, mo, 1) + timedelta(days=dd - 1)).isoformat()
def cnpj(base8, filial="0001"):
    n = [int(c) for c in base8 + filial]
    def dv(ns, pesos): s = sum(a * b for a, b in zip(ns, pesos)); r = s % 11; return 0 if r < 2 else 11 - r
    d1 = dv(n, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]); d2 = dv(n + [d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]); return "".join(map(str, n + [d1, d2]))
def fmtc(c): return f"{c[:2]}.{c[2:5]}.{c[5:8]}/{c[8:12]}-{c[12:]}"
def cpf(base9):
    n = [int(c) for c in base9]
    d1 = (sum(a * b for a, b in zip(n, range(10, 1, -1))) * 10) % 11 % 10; d2 = (sum(a * b for a, b in zip(n + [d1], range(11, 1, -1))) * 10) % 11 % 10; return "".join(map(str, n + [d1, d2]))
def pdf(tag): return (f"arquivo-{tag}.pdf", f"%PDF-1.4\n% documento ficticio {tag}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n".encode(), "application/pdf")
FICHA = lambda i, aba="resumo": f"/operacoes/fornecedores/{i}?aba={aba}"

print("Preparação e migração 33.0")
RH = login("rh@colegiostatus", "Status2026!"); r = RH.get(B + f"/api/setup?token={TOKEN}"); assert r.json()["ok"], r.text
assert float(psql("SELECT value->>'versao' FROM settings WHERE key='banco'")) >= 33
assert psql("SELECT count(*) FROM information_schema.tables WHERE table_name LIKE 'supplier\\_%'") == "12", "doze tabelas novas do domínio de fornecedores"
legado_ate = psql("SELECT value->>'legadoAte' FROM settings WHERE key='fornecedores'"); assert legado_ate in (d(179), d(180), d(181)), legado_ate
assert psql("SELECT count(*) FROM settings WHERE key='v33_fornecedores'") == "1"
CAR = int(psql("SELECT id FROM units WHERE codigo='CAR'")); CUL = int(psql("SELECT id FROM units WHERE codigo='CUL'"))
html = page("/configuracoes", RH); aid_user = aid_of(html, "Criar acesso")
def criar_user(nome, email, role, unit="", emp=""):
    post("/configuracoes", aid_user, {"nome": nome, "email": email, "role": role, "unitId": unit, "employeeId": emp, "senha": "senha12345"}, RH); return int(psql(f"SELECT id FROM users WHERE email='{email}'"))
GEF = psql(f"INSERT INTO employees (nome, unit_id, vinculo, admissao) VALUES ('Gestora Manutenção (fictícia)', {CAR}, 'CLT', '2021-02-01') RETURNING id")
UDG = criar_user("Diretora Geral", "dg@rede", "DIRECAO"); UDG2 = criar_user("Diretor Adjunto", "dg2@rede", "DIRECAO"); UDG3 = criar_user("Diretora Administrativa", "dg3@rede", "DIRECAO")
UFS = criar_user("Financeiro Rede", "fin@rede", "FINANCEIRO"); UFS2 = criar_user("Tesouraria Rede", "fin2@rede", "FINANCEIRO"); UOP = criar_user("Operações Rede", "op@rede", "OPERACOES")
UDIR = criar_user("Diretora Carandá", "dir@car", "DIRETOR_UNIDADE", CAR); UGE = criar_user("Gestora Manutenção", "ges@car", "GESTOR", CAR, GEF); UCO = criar_user("Comercial Rede", "com@rede", "COMERCIAL")
DG, DG2, DG3, FS, FS2, OP, DIR, GE, CO = (login(e) for e in ["dg@rede", "dg2@rede", "dg3@rede", "fin@rede", "fin2@rede", "op@rede", "dir@car", "ges@car", "com@rede"])
def CONTA(c): return psql(f"SELECT id FROM chart_accounts WHERE codigo='{c}'")
CSERV = CONTA("3.3.03")
ok("migração 33.0: doze tabelas do domínio, transição dos cadastros anteriores em 180 dias, marca da versão")

print("Cadastro anterior (LEGADO) e transição")
LEG = int(psql("INSERT INTO suppliers (nome, servico, ativo) VALUES ('Gráfica Antiga (fictícia)', 'Impressos', true) RETURNING id"))
assert psql(f"SELECT status || '|' || origem FROM suppliers WHERE id={LEG}") == "LEGADO|LEGADO", "insert direto nasce como cadastro anterior"
hn = page("/financeiro/contas-a-pagar/nova", FS); AID_CP = aid_of(hn, "Salvar conta a pagar")
CPB = {"unitId": CAR, "contaId": CSERV, "categoria": "Serviços e terceiros", "tipoDocumento": "Nota fiscal", "emissao": H, "responsavelId": UFS, "recorrente": "0", "parcelas": "1", "intervalo": "MENSAL", "natureza": "OPERACAO", "boleto": "", "chaveNfe": "", "parcelasJson": ""}
NUM = [0]
def cp(sess, sup, valor="800,00", unit=CAR, motivo="", extra=None):
    NUM[0] += 1; dados = {**CPB, "unitId": unit, "supplierId": sup, "numeroDocumento": f"V33-{NUM[0]}", "descricao": f"Serviço de teste v33 nº {NUM[0]}", "valor": valor, "primeiroVencimento": d(10 + NUM[0]), "excecaoMotivo": motivo, **(extra or {})}
    if sess is DG or sess is DG2: dados["responsavelId"] = UDG if sess is DG else UDG2
    return post("/financeiro/contas-a-pagar/nova", AID_CP, dados, sess)
def pid(loc): return int(re.search(r"/contas-a-pagar/(\d+)", loc).group(1))
loc = cp(FS, LEG); okmsg(loc, "lançada"); assert psql(f"SELECT coalesce(excecao_fornecedor, '-') || '|' || status FROM payables WHERE id={pid(loc)}") == "-|ATIVO", "cadastro anterior vale até a data de transição"
psql(f"UPDATE settings SET value = value || '{{\"legadoAte\": \"{d(-1)}\"}}'::jsonb WHERE key='fornecedores'")
erro(cp(FS, LEG), "fora do prazo de transição")
psql(f"UPDATE settings SET value = value || '{{\"legadoAte\": \"{legado_ate}\"}}'::jsonb WHERE key='fornecedores'")
hl0 = page(FICHA(LEG, "cadastro"), DG); assert "Sem CNPJ/CPF" in hl0 and "Incluir o CNPJ/CPF" in hl0
okmsg(post(FICHA(LEG, "cadastro"), aid_of(hl0, "Incluir o documento do estabelecimento principal"), {"id": LEG, "tipoDoc": "CNPJ", "documento": cnpj("95111000"), "razaoSocial": "Gráfica Antiga Impressos Ltda (fictícia)", "cidade": "Campo Grande", "uf": "MS"}, DG), "Documento principal incluído")
assert psql(f"SELECT e.matriz || '|' || s.tipo || '|' || s.status FROM supplier_establishments e JOIN suppliers s ON s.id=e.supplier_id WHERE e.supplier_id={LEG}") == "true|PJ|LEGADO"
ok("cadastro anterior (insert direto) nasce LEGADO e vale para novos lançamentos até a data de transição; depois dela, só com exceção; o primeiro CNPJ incluído vira o estabelecimento principal")

print("TC-SUP-001 · Cadastro, dígito verificador e duplicidade (inclusive concorrente)")
hn = page("/operacoes/fornecedores/novo", OP); AID_NOVO = aid_of(hn, 'name="razaoSocial"')
CA = cnpj("91222333")
def novo(sess, doc, razao, fantasia="", cat="Limpeza e conservação", tipo="PJ", extra=None): return post("/operacoes/fornecedores/novo", AID_NOVO, {"tipo": tipo, "documento": doc, "categoria": cat, "razaoSocial": razao, "nomeFantasia": fantasia, **(extra or {})}, sess)
def fid(loc): return int(re.search(r"/fornecedores/(\d+)", loc).group(1))
erro(novo(OP, CA[:-1] + str((int(CA[-1]) + 1) % 10), "Limpeza Horizonte Serviços Ltda (fictícia)"), "CNPJ inválido")
loc = novo(OP, fmtc(CA), "Limpeza Horizonte Serviços Ltda (fictícia)", "Limpeza Horizonte"); okmsg(loc, "Rascunho criado"); A = fid(loc)
assert psql(f"SELECT s.status || '|' || s.origem || '|' || s.criticidade || '|' || (s.criado_por={UOP}) || '|' || e.documento || '|' || e.matriz FROM suppliers s JOIN supplier_establishments e ON e.supplier_id=s.id WHERE s.id={A}") == f"RASCUNHO|INTERNO|MEDIA|true|{CA}|true"
erro(novo(DG, CA, "Outra Razão (fictícia)"), "já está cadastrado")
erro(novo(DG, cnpj("91222333", "0002"), "Filial Qualquer (fictícia)"), "Mesmo CNPJ raiz")
erro(novo(DG, cnpj("92121212"), "Limpeza Horizonte Servicos Ltda (ficticia)"), "Nome muito parecido")
loc = novo(DG, cnpj("92121212"), "Limpeza Horizonte Servicos Ltda (ficticia)", extra={"naoDuplicado": "1"}); okmsg(loc); A2 = fid(loc)
CC = cnpj("94555666"); res = {}
def corrida(nome, sess, razao): res[nome] = novo(sess, CC, razao, extra={"naoDuplicado": "1"})
ts = [threading.Thread(target=corrida, args=("op", OP, "Corrida Um Serviços (fictícia)")), threading.Thread(target=corrida, args=("dg", DG, "Corrida Dois Comércio (fictícia)"))]
[t.start() for t in ts]; [t.join() for t in ts]
assert psql(f"SELECT count(*) FROM supplier_establishments WHERE documento='{CC}' AND ativo") == "1", "só um estabelecimento ativo com o CNPJ"
assert sum("ok=" in v for v in res.values()) == 1 and sum("erro=" in v for v in res.values()) == 1, res
assert any(("já está cadastrado" in v or "Já existe fornecedor ativo com este documento" in v) for v in res.values() if "erro=" in v), res
h = page(FICHA(A, "cadastro"), OP); aid_est = aid_of(h, "Incluir estabelecimento (filial, outro CNPJ)")
okmsg(post(FICHA(A, "cadastro"), aid_est, {"id": A, "tipoDoc": "CNPJ", "documento": cnpj("91222333", "0002"), "razaoSocial": "Limpeza Horizonte Serviços Ltda — filial (fictícia)", "cidade": "Campo Grande", "uf": "ms"}, OP), "Estabelecimento incluído")
erro(novo(DG, cnpj("91222333", "0002"), "Mais Uma (fictícia)", extra={"outroFornecedor": "1", "naoDuplicado": "1"}), "já está cadastrado")
ok("CNPJ com dígito verificador; duplicata exata bloqueada; mesmo CNPJ raiz e nome parecido pedem confirmação; filial na ficha; duas transações simultâneas → um só estabelecimento ativo e um conflito tratável")

print("Pessoa física: CPF mascarado em lista, CSV, busca e trilha")
CP_ = cpf("529982247"); loc = novo(OP, CP_, "Marcos Eletricista Autônomo (fictício)", cat="Manutenção predial e elétrica", tipo="PF"); okmsg(loc); PF = fid(loc)
mask = f"***.{CP_[3:6]}.{CP_[6:9]}-**"; full = f"{CP_[:3]}.{CP_[3:6]}.{CP_[6:9]}-{CP_[9:]}"
hl = page("/operacoes/fornecedores?aba=lista", OP); assert mask in hl and full not in hl and CP_ not in hl
hf = page(FICHA(PF, "cadastro"), OP); assert mask in hf and full not in hf and CP_ not in hf
csvt = FS.get(B + "/api/export/fornecedores").content.decode("utf-8-sig"); assert mask in csvt and CP_ not in csvt and full not in csvt
assert '"Fornecedores"' not in FS.get(B + f"/api/busca?q={CP_}").text, "CPF não é chave de busca"
assert psql(f"SELECT count(*) FROM audit_log WHERE coalesce(depois::text, '') LIKE '%{CP_}%' OR coalesce(antes::text, '') LIKE '%{CP_}%'") == "0", "CPF inteiro nunca vai para a trilha"
ok("pessoa física: CPF válido, mascarado na lista, na ficha, no CSV e na trilha; nunca vira chave de busca")

print("TC-SUP-009 · Consulta cadastral só com fonte e data; etapas do cadastro")
h = page(FICHA(A), OP); assert "Situação cadastral sem consulta no último ano" in h, "sem consulta, o risco diz isso (não inventa situação)"
assert psql(f"SELECT situacao_cadastral FROM supplier_establishments WHERE supplier_id={A} AND matriz") == "NAO_CONSULTADA"
h = page(FICHA(A, "cadastro"), OP); aid_cons = aid_of(h, 'name="fonte"')
estA = psql(f"SELECT id FROM supplier_establishments WHERE supplier_id={A} AND matriz")
erro(post(FICHA(A, "cadastro"), aid_cons, {"id": A, "estabId": estA, "situacao": "ATIVA", "fonte": "", "data": H}, OP), "Informe a fonte")
erro(post(FICHA(A, "cadastro"), aid_cons, {"id": A, "estabId": estA, "situacao": "NAO_CONSULTADA", "fonte": "gov.br", "data": H}, OP), "Escolha a situação")
okmsg(post(FICHA(A, "cadastro"), aid_cons, {"id": A, "estabId": estA, "situacao": "ATIVA", "fonte": "gov.br — comprovante de inscrição e situação cadastral", "data": H}, OP), "situação ativa")
assert psql(f"SELECT situacao_cadastral || '|' || situacao_por || '|' || situacao_em FROM supplier_establishments WHERE id={estA}") == f"ATIVA|Operações Rede|{H}"
aid_env = aid_of(page(FICHA(A, "homologacao"), OP), "Enviar para homologação")
erro(post(FICHA(A, "homologacao"), aid_env, {"id": A}, OP), "contato com e-mail ou telefone")
h = page(FICHA(A, "cadastro"), OP); aid_ct = aid_of(h, "Novo contato")
erro(post(FICHA(A, "cadastro"), aid_ct, {"id": A, "nome": "Sônia Horizonte", "finalidade": "PRINCIPAL"}, OP), "e-mail ou telefone")
okmsg(post(FICHA(A, "cadastro"), aid_ct, {"id": A, "nome": "Sônia Horizonte", "finalidade": "PRINCIPAL", "email": "sonia@limpezahorizonte.example", "telefone": "(67) 3333-0101", "principal": "1"}, OP), "Contato salvo")
okmsg(post(FICHA(A, "cadastro"), aid_ct, {"id": A, "nome": "Caio Cobrança", "finalidade": "FINANCEIRO", "email": "cobranca@limpezahorizonte.example"}, OP), "Contato salvo")
aid_pg = aid_of(page(FICHA(A, "financeiro"), OP), "Salvar condições")
erro(post(FICHA(A, "financeiro"), aid_pg, {"id": A, "formaPagamento": "PIX", "prazoDias": "30", "descontoPct": "2", "descontoDias": "40"}, OP), "desconto")
okmsg(post(FICHA(A, "financeiro"), aid_pg, {"id": A, "formaPagamento": "PIX", "prazoDias": "30", "descontoPct": "2", "descontoDias": "10", "contaId": CSERV}, OP), "Condições salvas: Pix, 30 dia(s), 2% em 10 dia(s)")
ok("situação cadastral só com fonte, data e quem consultou (sem consulta = fator de risco, nunca situação inventada); contato exige e-mail ou telefone; condição 2/10 líquido 30 com conta do plano sugerida")

print("Homologação por criticidade com segregação (TC-SUP-006 · auditoria)")
loc = post(FICHA(A, "homologacao"), aid_env, {"id": A}, OP); okmsg(loc, "conferência documental, parecer financeiro")
assert psql(f"SELECT s.status || '|' || h.tipo || '|' || h.fase || '|' || h.criticidade || '|' || (h.risco->>'nivel' IS NOT NULL) FROM suppliers s JOIN supplier_homologations h ON h.supplier_id=s.id WHERE s.id={A}") == "EM_ANALISE|INICIAL|ANALISE|MEDIA|true"
erro(post(FICHA(A, "homologacao"), aid_env, {"id": A}, OP), "já tem uma homologação em andamento")
h = page(FICHA(A, "homologacao"), OP); assert "Você enviou este cadastro" in h
aid_par = aid_of(page(FICHA(A, "homologacao"), FS), "Registrar parecer")
erro(post(FICHA(A, "homologacao"), aid_par, {"id": A, "etapa": "DOCUMENTAL", "resultado": "FAVORAVEL", "parecer": "Conferi os documentos do cadastro."}, OP), "quem enviou o cadastro não dá parecer")
assert psql(f"SELECT count(*) FROM audit_log WHERE entidade='suppliers' AND entidade_id={A} AND acao='tentativa bloqueada: parecer no próprio envio'") == "1"
erro(post(FICHA(A, "homologacao"), aid_par, {"id": A, "etapa": "TECNICO", "resultado": "FAVORAVEL", "parecer": "Visita técnica feita."}, FS), "não é da sua atuação")
okmsg(post(FICHA(A, "homologacao"), aid_par, {"id": A, "etapa": "FINANCEIRO", "resultado": "FAVORAVEL", "parecer": "Sem restrição financeira; prazo 30 dias compatível."}, FS), "Faltam: conferência documental")
okmsg(post(FICHA(A, "homologacao"), aid_par, {"id": A, "etapa": "DOCUMENTAL", "resultado": "FAVORAVEL", "parecer": "Cartão CNPJ conferido no gov.br; contrato social ok."}, DG2), "pronta para a decisão")
assert psql(f"SELECT fase FROM supplier_homologations WHERE supplier_id={A} AND fase IN ('ANALISE','APROVACAO')") == "APROVACAO"
hdec = page(FICHA(A, "homologacao"), DG); aid_dec = aid_of(hdec, "Registrar decisão"); versao = int(psql(f"SELECT versao FROM suppliers WHERE id={A}"))
erro(post(FICHA(A, "homologacao"), aid_dec, {"id": A, "versao": versao, "decisao": "HOMOLOGADO", "justificativa": "Tudo certo."}, OP), "Homologam: Direção")
erro(post(FICHA(A, "homologacao"), aid_dec, {"id": A, "versao": versao - 1, "decisao": "HOMOLOGADO", "justificativa": "Pareceres favoráveis e documentos em dia."}, DG), "Outra pessoa alterou")
erro(post(FICHA(A, "homologacao"), aid_dec, {"id": A, "versao": versao, "decisao": "CONDICIONAL", "justificativa": "Pareceres favoráveis e documentos em dia."}, DG), "o que está autorizado")
erro(post(FICHA(A, "homologacao"), aid_dec, {"id": A, "versao": versao, "decisao": "HOMOLOGADO", "justificativa": "Pareceres favoráveis.", "risco": "ALTO"}, DG), "Para revisar o risco calculado")
REVAL = meses(H, 12)
loc = post(FICHA(A, "homologacao"), aid_dec, {"id": A, "versao": versao, "decisao": "HOMOLOGADO", "justificativa": "Pareceres favoráveis e documentos em dia."}, DG); okmsg(loc, f"homologado até {br(REVAL)}")
assert psql(f"SELECT status || '|' || ativo || '|' || revalidar_em || '|' || homologado_por FROM suppliers WHERE id={A}") == f"HOMOLOGADO|true|{REVAL}|Diretora Geral"
erro(post(FICHA(A, "homologacao"), aid_dec, {"id": A, "versao": versao + 1, "decisao": "HOMOLOGADO", "justificativa": "De novo, por engano."}, DG), "Não há homologação em andamento")
reg = psql(f"SELECT decidido_nome || '|' || justificativa || '|' || regra || '|' || vigencia_ate || '|' || (risco->>'nivel') FROM supplier_homologations WHERE supplier_id={A} AND fase='DECIDIDO'")
assert reg.startswith("Diretora Geral|Pareceres favoráveis e documentos em dia.|SUP-POL-2026.11|" + REVAL), reg
aud = json.loads(psql(f"SELECT depois::text FROM audit_log WHERE entidade='suppliers' AND entidade_id={A} AND acao='homologação decidida'"))
assert aud["decisao"] == "HOMOLOGADO" and aud["regra"] == "SUP-POL-2026.11" and aud["escopo"] == "rede" and aud["revalidarEm"] == REVAL and "calculado" in aud["risco"], aud
assert psql(f"SELECT user_nome FROM audit_log WHERE entidade='suppliers' AND entidade_id={A} AND acao='homologação decidida'") == "Diretora Geral"
hh = page(FICHA(A, "historico"), DG); assert "homologação decidida" in hh and "enviado para homologação" in hh and "parecer de homologação" in hh
ok("criticidade média pede conferência documental + parecer financeiro; quem envia não dá parecer (tentativa na trilha); decisão só da Direção, com controle otimista, justificativa e revisão de risco motivada; revalidação em 12 meses; auditor encontra ator, motivo, regra, data, escopo e resultado")

print("TC-SUP-002 · Homologação por escopo (unidade) em contas a pagar e contratos")
CU = cnpj("97888999"); loc = novo(FS, CU, "Frio Certo Refrigeração Ltda (fictícia)", "Frio Certo", cat="Ar-condicionado e refrigeração"); okmsg(loc); U = fid(loc)
aid_cob = aid_of(page(FICHA(U, "cadastro"), FS), "Salvar cobertura")
erro(post(FICHA(U, "cadastro"), aid_cob, {"id": U, "abrangencia": "UNIDADES"}, FS), "Marque ao menos uma unidade")
okmsg(post(FICHA(U, "cadastro"), aid_cob, {"id": U, "abrangencia": "UNIDADES", "units": [CAR], "capacidade": "Atendimento em até 4 horas em Campo Grande"}, FS), "1 unidade(s)")
psql(f"UPDATE suppliers SET status='HOMOLOGADO', homologado_em=now(), homologado_por='Diretora Geral', revalidar_em='{d(365)}' WHERE id={U}")
loc = cp(FS, U, unit=CUL); erro(loc, "Fora do escopo homologado")
loc = cp(FS, U, unit=CUL, motivo="Técnico da unidade Cultura de férias; conserto urgente"); okmsg(loc, "enviada para aprovação"); P1 = pid(loc)
r1 = psql(f"SELECT status || '|' || aprovacoes_necessarias || '|' || jsonb_array_length(aprovacoes) || '|' || (motivos_aprovacao::text LIKE '%FORNECEDOR%') || '|' || (excecao_fornecedor LIKE '%exceção registrada por Financeiro Rede: Técnico da unidade Cultura%') FROM payables WHERE id={P1}")
assert r1 == "AGUARDANDO_APROVACAO|1|0|true|true", r1
assert psql(f"SELECT count(*) FROM audit_log WHERE entidade='suppliers' AND entidade_id={U} AND acao='exceção de fornecedor em conta a pagar'") == "1"
loc = cp(FS, U, unit=CAR); okmsg(loc, "lançada com 1 parcela"); assert psql(f"SELECT status || '|' || coalesce(excecao_fornecedor, '-') FROM payables WHERE id={pid(loc)}") == "ATIVO|-"
loc = cp(DG, U, unit=CUL, motivo="Única empresa com a peça do equipamento em estoque"); P2 = pid(loc)
assert psql(f"SELECT status || '|' || aprovacoes_necessarias || '|' || jsonb_array_length(aprovacoes) FROM payables WHERE id={P2}") == "AGUARDANDO_APROVACAO|1|0", "quem registrou a exceção não libera sozinho"
AID_DEC = aid_of(page(f"/financeiro/contas-a-pagar/{P2}", DG2), "Rejeitar")
erro(post(f"/financeiro/contas-a-pagar/{P2}", AID_DEC, {"id": P2, "decisao": "APROVAR"}, DG), "Quem lançou não aprova")
okmsg(post(f"/financeiro/contas-a-pagar/{P2}", AID_DEC, {"id": P2, "decisao": "APROVAR"}, DG2), "Aprovada")
hp = page(f"/financeiro/contas-a-pagar/{P2}", FS); assert "Exceção de fornecedor:" in hp and "Única empresa com a peça" in hp
hk = page("/operacoes/contratos", DG); AID_CT = aid_of(hk, "Cadastrar contrato")
KB = {"supplierId": U, "objeto": "Manutenção preventiva dos aparelhos de ar (fictício)", "unitId": CUL, "inicio": H, "fim": d(365), "renovacao": "MANUAL", "avisoPrevioDias": "30", "valorMensal": "900,00"}
erro(post("/operacoes/contratos", AID_CT, KB, DG), "Fora do escopo homologado")
loc = post("/operacoes/contratos", AID_CT, {**KB, "excecaoMotivo": "Contrato-ponte até a homologação para a Cultura"}, DG); okmsg(loc, "Contrato salvo"); K1 = int(re.search(r"/contratos/(\d+)", loc).group(1))
assert "exceção registrada por Diretora Geral" in psql(f"SELECT excecao_fornecedor FROM contracts WHERE id={K1}")
assert "Exceção de fornecedor:" in page(f"/operacoes/contratos/{K1}", DG)
assert psql(f"SELECT abrangencia || '|' || string_agg(unit_id::text, ',') FROM suppliers s JOIN supplier_units u ON u.supplier_id=s.id WHERE s.id={U} GROUP BY abrangencia") == f"UNIDADES|{CAR}", "a homologação de Carandá fica preservada"
ok("fora da unidade homologada: lançamento e contrato só com exceção formal (motivo + nome), que vai para a aprovação de outra pessoa; dentro dela, segue normal; o escopo da homologação fica intacto")

print("TC-SUP-003 · Alteração bancária em quarentena, máscara e revelação registrada")
aid_pc = aid_of(page(FICHA(A, "financeiro"), FS), "Enviar para quarentena")
BANCO = {"id": A, "bancoCodigo": "341", "agencia": "1234", "conta": "56789-0", "tipoConta": "CORRENTE", "titularNome": "Limpeza Horizonte Serviços Ltda (fictícia)", "titularDoc": fmtc(CA), "evidencia": "Carta em papel timbrado assinada pela sócia, recebida no e-mail do cadastro"}
erro(post(FICHA(A, "financeiro"), aid_pc, {**BANCO, "evidencia": "ok"}, FS), "Descreva a evidência")
erro(post(FICHA(A, "financeiro"), aid_pc, {**BANCO, "pixTipo": "CNPJ", "pixChave": cnpj("99000111")}, FS), "chave Pix (CNPJ/CPF) é de outro titular")
okmsg(post(FICHA(A, "financeiro"), aid_pc, BANCO, FS), "quarentena")
assert psql(f"SELECT c.status || '|' || a.status || '|' || c.solicitante_user_id FROM supplier_bank_changes c JOIN supplier_bank_accounts a ON a.id=c.account_id WHERE c.supplier_id={A}") == f"AGUARDANDO_CONFERENCIA|PROPOSTA|{UFS}"
erro(post(FICHA(A, "financeiro"), aid_pc, {**BANCO, "conta": "11111-1"}, FS), "Já há uma alteração bancária em andamento")
MUD = psql(f"SELECT id FROM supplier_bank_changes WHERE supplier_id={A}")
aid_conf = aid_of(page(FICHA(A, "financeiro"), FS2), "Registrar conferência")
erro(post(FICHA(A, "financeiro"), aid_conf, {"id": A, "mudancaId": MUD, "resultado": "CONFIRMADA", "canal": "Liguei para o telefone do cadastro anterior"}, FS), "quem pediu a alteração não confere")
assert psql(f"SELECT count(*) FROM audit_log WHERE entidade_id={A} AND acao='tentativa bloqueada: conferir a própria alteração bancária'") == "1"
okmsg(post(FICHA(A, "financeiro"), aid_conf, {"id": A, "mudancaId": MUD, "resultado": "CONFIRMADA", "canal": "Liguei no (67) 3333-0101, telefone do cadastro, e falei com a sócia Sônia"}, FS2), "terceira pessoa")
erro(post(FICHA(A, "financeiro"), aid_conf, {"id": A, "mudancaId": MUD, "resultado": "CONFIRMADA", "canal": "Liguei de novo para confirmar"}, FS2), "não está aguardando conferência")
aid_apr = aid_of(page(FICHA(A, "financeiro"), DG), "Aprovar e colocar em uso")
erro(post(FICHA(A, "financeiro"), aid_apr, {"id": A, "mudancaId": MUD}, FS2), "Aprovam a troca de conta")
okmsg(post(FICHA(A, "financeiro"), aid_apr, {"id": A, "mudancaId": MUD}, DG), "nova conta está em uso")
assert psql(f"SELECT a.status || '|' || a.versao || '|' || c.status || '|' || c.aprovacao_nome FROM supplier_bank_changes c JOIN supplier_bank_accounts a ON a.id=c.account_id WHERE c.id={MUD}") == "EM_USO|1|APROVADA|Diretora Geral"
hfin = page(FICHA(A, "financeiro"), FS); assert "•••9-0" in hfin and "56789-0" not in hfin and "Mostrar dados completos" in hfin
hop = page(FICHA(A, "financeiro") + "&rev=9999999999999.forjado", OP); assert "56789-0" not in hop and "Mostrar dados completos" not in hop
loc = post(FICHA(A, "financeiro"), aid_of(hfin, "Mostrar dados completos"), {"id": A}, FS); okmsg(loc, "5 minutos"); rev = re.search(r"rev=([^&]+)", loc).group(1)
assert "56789-0" in page(FICHA(A, "financeiro") + f"&rev={rev}", FS) and "56789-0" not in page(FICHA(A, "financeiro") + f"&rev={rev}", FS2), "a revelação vale só para quem pediu"
assert psql(f"SELECT count(*) FROM audit_log WHERE entidade_id={A} AND acao='ver dados bancários completos' AND user_nome='Financeiro Rede'") == "1"
assert psql("SELECT count(*) FROM audit_log WHERE coalesce(depois::text,'') LIKE '%56789%'") == "0", "conta completa nunca vai para a trilha"
# segregação na aprovação com três pessoas da Direção (U)
aid_pcU = aid_of(page(FICHA(U, "financeiro"), DG), "Enviar para quarentena")
BU = {"id": U, "bancoCodigo": "001", "agencia": "4321", "conta": "98765-4", "tipoConta": "CORRENTE", "titularNome": "Holding Frio (fictícia)", "titularDoc": fmtc(cnpj("99000111")), "evidencia": "Pedido formal do fornecedor por carta assinada"}
erro(post(FICHA(U, "financeiro"), aid_pcU, BU, DG), "Conta de terceiro só com a confirmação marcada")
okmsg(post(FICHA(U, "financeiro"), aid_pcU, {**BU, "terceiro": "1"}, DG), "quarentena")
MU = psql(f"SELECT id FROM supplier_bank_changes WHERE supplier_id={U}")
assert "Alteração bancária em aberto (quarentena)" in page(FICHA(U), DG)
okmsg(post(FICHA(U, "financeiro"), aid_of(page(FICHA(U, "financeiro"), DG2), "Registrar conferência"), {"id": U, "mudancaId": MU, "resultado": "CONFIRMADA", "canal": "Liguei para o gerente da conta no telefone já cadastrado"}, DG2), "terceira pessoa")
aid_aprU = aid_of(page(FICHA(U, "financeiro"), DG3), "Aprovar e colocar em uso")
erro(post(FICHA(U, "financeiro"), aid_aprU, {"id": U, "mudancaId": MU}, DG), "quem pediu ou conferiu a alteração não aprova")
erro(post(FICHA(U, "financeiro"), aid_aprU, {"id": U, "mudancaId": MU}, DG2), "quem pediu ou conferiu a alteração não aprova")
assert psql(f"SELECT count(*) FROM audit_log WHERE entidade_id={U} AND acao='tentativa bloqueada: aprovar alteração bancária que pediu ou conferiu'") == "2"
okmsg(post(FICHA(U, "financeiro"), aid_aprU, {"id": U, "mudancaId": MU}, DG3), "em uso")
assert "Conta bancária em nome de terceiro em uso" in page(FICHA(U), DG)
ok("conta nova em quarentena até a conferência por canal conhecido e a aprovação de uma terceira pessoa (quem pediu ou conferiu não aprova; tentativas na trilha); uma alteração aberta por vez; Pix de outro titular e conta de terceiro sem confirmação recusados; máscara, revelação por 5 minutos só para quem pediu e registrada; conta completa nunca na trilha")

print("TC-SUP-004 · Suspensão prospectiva, obrigação em curso e corrida")
loc = cp(FS, A, valor="6.000,00"); PA = pid(loc); assert psql(f"SELECT status FROM payables WHERE id={PA}") == "AGUARDANDO_APROVACAO"
aid_sus = aid_of(page(FICHA(A), DG), "Suspensão prospectiva")
erro(post(FICHA(A), aid_sus, {"id": A, "motivo": "curto"}, DG), "motivo da suspensão")
okmsg(post(FICHA(A), aid_sus, {"id": A, "motivo": "Denúncia de cobrança indevida em apuração pela Direção"}, DG), "Suspenso")
assert psql(f"SELECT status || '|' || ativo FROM suppliers WHERE id={A}") == "SUSPENSO|false"
erro(cp(FS, A), "suspenso"); assert psql(f"SELECT count(*) FROM audit_log WHERE entidade_id={A} AND acao='tentativa bloqueada: lançar conta para fornecedor bloqueado'") == "1"
AID_DEC_A = aid_of(page(f"/financeiro/contas-a-pagar/{PA}", DG2), "Rejeitar")
erro(post(f"/financeiro/contas-a-pagar/{PA}", AID_DEC_A, {"id": PA, "decisao": "APROVAR"}, DG2), "só a Direção aprova, escrevendo o motivo")
okmsg(post(f"/financeiro/contas-a-pagar/{PA}", AID_DEC_A, {"id": PA, "decisao": "APROVAR", "motivo": "Serviço de outubro já prestado e medido; pagamento devido"}, DG2), "Aprovada")
assert psql(f"SELECT count(*) FROM payable_events WHERE payable_id={PA} AND texto LIKE 'Aprovação ciente da situação do fornecedor%'") == "1"
erro(post("/operacoes/contratos", AID_CT, {**KB, "supplierId": A, "unitId": CAR, "excecaoMotivo": "Tentativa de contratar mesmo suspenso"}, DG), "suspenso")
wo = psql(f"INSERT INTO work_orders (titulo, unit_id, prioridade, status, solicitante_user_id) VALUES ('Vazamento no banheiro (fictício)', {CAR}, 'NORMAL', 'ABERTO', {UOP}) RETURNING id")
aid_wo = aid_of(page(f"/operacoes/chamados/{wo}", OP), 'name="supplierId"')
erro(post(f"/operacoes/chamados/{wo}", aid_wo, {"id": wo, "supplierId": A}, OP), "suspenso")
okmsg(post(f"/operacoes/chamados/{wo}", aid_wo, {"id": wo, "supplierId": U}, OP))
assert psql(f"SELECT count(*) FROM work_order_events WHERE work_order_id={wo} AND texto LIKE 'Fornecedor: Frio Certo%'") == "1"
X = int(psql("INSERT INTO suppliers (nome, servico, ativo, status, abrangencia) VALUES ('Corrida Suspensão (fictícia)', 'Serviços', true, 'HOMOLOGADO', 'REDE') RETURNING id"))
aid_susX = aid_of(page(FICHA(X), DG), "Suspensão prospectiva"); corr = {}
t1 = threading.Thread(target=lambda: corr.__setitem__("s", post(FICHA(X), aid_susX, {"id": X, "motivo": "Suspensão em corrida com um lançamento"}, DG)))
t2 = threading.Thread(target=lambda: corr.__setitem__("c", cp(FS2, X)))
t1.start(); t2.start(); t1.join(); t2.join()
assert "ok=" in corr["s"], corr
assert psql(f"SELECT count(*) FROM payables WHERE supplier_id={X} AND created_at > (SELECT max(at) FROM audit_log WHERE entidade='suppliers' AND entidade_id={X} AND acao='fornecedor suspenso')") == "0", "nenhum título depois da suspensão confirmada"
assert ("ok=" in corr["c"]) or ("suspenso" in corr["c"]), corr
ok("suspensão bloqueia novas contas (tentativa na trilha), contratos e chamados; obrigação já lançada só a Direção aprova, com motivo registrado; corrida suspensão × lançamento sem título depois da suspensão")

print("SUP-RN-013 · Reativação supervisionada")
loc = post(FICHA(A, "homologacao"), aid_of(page(FICHA(A, "homologacao"), OP), "Enviar para homologação"), {"id": A}, OP); okmsg(loc, "reativação")
assert psql(f"SELECT status FROM suppliers WHERE id={A}") == "SUSPENSO", "segue suspenso durante a análise"
okmsg(post(FICHA(A, "homologacao"), aid_par, {"id": A, "etapa": "FINANCEIRO", "resultado": "FAVORAVEL", "parecer": "Cobrança indevida estornada; sem pendências."}, FS))
okmsg(post(FICHA(A, "homologacao"), aid_par, {"id": A, "etapa": "DOCUMENTAL", "resultado": "FAVORAVEL", "parecer": "Documentos revistos e em dia."}, DG3), "pronta para a decisão")
v = int(psql(f"SELECT versao FROM suppliers WHERE id={A}"))
okmsg(post(FICHA(A, "homologacao"), aid_dec, {"id": A, "versao": v, "decisao": "HOMOLOGADO", "justificativa": "Apuração concluída: estorno feito, relação mantida."}, DG2), "homologado")
assert psql(f"SELECT status || '|' || ativo FROM suppliers WHERE id={A}") == "HOMOLOGADO|true"
assert psql(f"SELECT depois->>'tipo' FROM audit_log WHERE entidade_id={A} AND acao='homologação decidida' ORDER BY id DESC LIMIT 1") == "REATIVACAO"
ok("reativação exige nova análise (pareceres) e nova decisão registrada; segue suspenso até lá")

print("TC-SUP-005 · Documentos, criticidade alta e rotina diária")
CK = cnpj("93444555"); loc = novo(OP, CK, "Sabor da Escola Alimentação Ltda (fictícia)", "Sabor da Escola", cat="Alimentação e cantina"); okmsg(loc); K = fid(loc)
assert psql(f"SELECT criticidade FROM suppliers WHERE id={K}") == "ALTA"
h = page(FICHA(K, "cadastro"), OP); okmsg(post(FICHA(K, "cadastro"), aid_of(h, "Novo contato"), {"id": K, "nome": "Rita Sabor", "finalidade": "PRINCIPAL", "email": "rita@sabor.example"}, OP))
aid_envK = aid_of(page(FICHA(K, "homologacao"), OP), "Enviar para homologação")
erro(post(FICHA(K, "homologacao"), aid_envK, {"id": K}, OP), "plano de contingência")
okmsg(post(FICHA(K, "cadastro"), aid_of(page(FICHA(K, "cadastro"), OP), "Salvar cobertura"), {"id": K, "abrangencia": "REDE", "contingencia": "Cantina parceira homologada como alternativa; estoque mínimo de 7 dias"}, OP))
okmsg(post(FICHA(K, "homologacao"), aid_envK, {"id": K}, OP), "parecer técnico")
okmsg(post(FICHA(K, "homologacao"), aid_par, {"id": K, "etapa": "DOCUMENTAL", "resultado": "FAVORAVEL", "parecer": "Licença sanitária e certidões conferidas."}, FS))
okmsg(post(FICHA(K, "homologacao"), aid_par, {"id": K, "etapa": "FINANCEIRO", "resultado": "RESSALVA", "parecer": "Capacidade financeira ok; acompanhar concentração."}, DG2))
okmsg(post(FICHA(K, "homologacao"), aid_par, {"id": K, "etapa": "TECNICO", "resultado": "FAVORAVEL", "parecer": "Visita à cozinha: boas práticas em dia."}, DIR), "pronta para a decisão")
v = int(psql(f"SELECT versao FROM suppliers WHERE id={K}"))
okmsg(post(FICHA(K, "homologacao"), aid_dec, {"id": K, "versao": v, "decisao": "HOMOLOGADO", "justificativa": "Três pareceres favoráveis; criticidade alta com contingência."}, DG), "homologado até " + br(meses(H, 6)))
aid_doc = aid_of(page(FICHA(K, "documentos"), OP), 'name="tipoOutro"')
erro(post(FICHA(K, "documentos"), aid_doc, {"id": K, "tipo": "CND federal (Receita/PGFN)", "validade": d(-2)}, OP, files={"arquivo": pdf("cnd-velha")}), "Documento já vencido")
okmsg(post(FICHA(K, "documentos"), aid_doc, {"id": K, "tipo": "CND federal (Receita/PGFN)", "numero": "CND-778", "validade": d(40)}, OP, files={"arquivo": pdf("cnd")}), "aguarda conferência")
erro(post(FICHA(K, "documentos"), aid_doc, {"id": K, "tipo": "CND federal (Receita/PGFN)", "validade": d(40)}, OP, files={"arquivo": pdf("cnd")}), "mesmo arquivo")
okmsg(post(FICHA(K, "documentos"), aid_doc, {"id": K, "tipo": "CRF do FGTS", "validade": d(20)}, OP, files={"arquivo": pdf("crf")}))
DCND = psql(f"SELECT id FROM supplier_documents WHERE supplier_id={K} AND tipo LIKE 'CND federal%'"); DCRF = psql(f"SELECT id FROM supplier_documents WHERE supplier_id={K} AND tipo='CRF do FGTS'")
hd = page(FICHA(K, "documentos"), FS); aid_cd = aid_of(hd, 'name="docId"')
okmsg(post(FICHA(K, "documentos"), aid_cd, {"id": K, "docId": DCND, "resultado": "CONFERIR"}, FS), "conferido")
erro(post(FICHA(K, "documentos"), aid_cd, {"id": K, "docId": DCRF, "resultado": "RECUSAR"}, FS), "motivo da recusa")
okmsg(post(FICHA(K, "documentos"), aid_cd, {"id": K, "docId": DCRF, "resultado": "RECUSAR", "motivo": "Arquivo ilegível"}, FS), "recusado")
ANX = psql(f"SELECT id FROM attachments WHERE entidade='supplier_document' AND entidade_id={DCND}")
assert OP.get(B + f"/api/anexos/{ANX}").status_code == 200 and CO.get(B + f"/api/anexos/{ANX}").status_code == 403
assert psql(f"SELECT status FROM suppliers WHERE id={K}") == "HOMOLOGADO"
psql(f"UPDATE supplier_documents SET validade='{d(-1)}' WHERE id={DCND}")
psql(f"INSERT INTO supplier_documents (supplier_id, tipo, validade, status, origem) VALUES ({A}, 'CND federal (Receita/PGFN)', '{d(-3)}', 'CONFERIDO', 'INTERNO')")
psql(f"UPDATE suppliers SET revalidar_em='{d(-1)}' WHERE id={U}")
psql(f"INSERT INTO supplier_invitations (supplier_id, token_hash, expira_em, criado_por_nome) VALUES ({LEG}, 'hash-de-teste-expirado', '{d(-1)}', 'teste')")
rt = mk().get(B + f"/api/tarefas?token={TOKEN}").json(); assert rt["ok"], rt; v33 = rt["v33"]
assert v33["documentosAlta"] == 1 and v33["revalidacao"] == 1 and v33["convitesExpirados"] == 1, v33
assert psql(f"SELECT status || '|' || (status_motivo LIKE 'Documento exigível vencido (criticidade alta): CND federal%') || '|' || status_por FROM suppliers WHERE id={K}") == "VENCIDO|true|Rotina diária"
assert psql(f"SELECT status FROM suppliers WHERE id={A}") == "HOMOLOGADO", "criticidade média: só pendência e risco"
assert "1 documento(s) exigível(is) vencido(s)" in page(FICHA(A), DG)
assert psql(f"SELECT status || '|' || (status_motivo LIKE 'Homologação venceu%') FROM suppliers WHERE id={U}") == "VENCIDO|true"
assert psql(f"SELECT count(*) FROM audit_log WHERE acao='fornecedor em revalidação (rotina)' AND user_nome='sistema'") == "2"
nt = psql(f"SELECT titulo || '|' || coalesce(texto, '') FROM notifications WHERE user_id={UDG} AND chave='forn-revalida:{H}'")
assert nt.startswith("2 fornecedor(es) entraram em revalidação hoje") and "Sabor" not in nt and "Frio" not in nt, nt
rt2 = mk().get(B + f"/api/tarefas?token={TOKEN}").json()["v33"]; assert rt2["documentosAlta"] == 0 and rt2["revalidacao"] == 0 and rt2["convitesExpirados"] == 0, rt2
erro(cp(FS, K), "só com exceção registrada")
ok("criticidade alta: contingência e três pareceres, revalidação em 6 meses; documento com hash (sem repetição), conferido ou recusado com motivo, arquivo só para quem trabalha com fornecedores; rotina: vencido em alta → em revalidação, em média só pendência e risco, homologação vencida → revalidação, convite vencido expira; aviso só com contagem; rotina idempotente")

print("TC-SUP-007 · Portal do fornecedor (propostas sem autoaprovação, isolamento)")
hpo = page(FICHA(A, "portal"), OP); aid_cv = aid_of(hpo, 'name="escopo"')
erro(post(FICHA(A, "portal"), aid_cv, {"id": A, "email": "sonia@limpezahorizonte.example", "dias": "7"}, OP), "Marque o que o fornecedor pode atualizar")
loc = post(FICHA(A, "portal"), aid_cv, {"id": A, "email": "sonia@limpezahorizonte.example", "dias": "7", "escopo": ["contatos", "banco", "documentos"]}, OP); okmsg(loc, "Copie o link agora")
TK = re.search(r"convite=([A-Za-z0-9_\-]+)", loc).group(1)
assert psql(f"SELECT count(*) FROM supplier_invitations WHERE token_hash='{TK}'") == "0" and psql(f"SELECT count(*) FROM supplier_invitations WHERE token_hash='{hashlib.sha256(TK.encode()).hexdigest()}' AND estado='ATIVO'") == "1", "o link fica só como hash"
assert f"/fornecedor/{TK}" in page(FICHA(A, "portal") + f"&convite={TK}", OP) and TK not in page(FICHA(A, "portal"), OP)
EXT = mk(); hp = page(f"/fornecedor/{TK}", EXT)
assert "Limpeza Horizonte Serviços Ltda (fictícia)" in hp and "Frio Certo" not in hp and "Sabor da Escola" not in hp and "risco" not in hp.lower() and "avalia" not in hp.lower() and "nunca pede troca de conta bancária" in hp
assert psql(f"SELECT aberto_em IS NOT NULL FROM supplier_invitations WHERE supplier_id={A} AND estado='ATIVO'") == "t"
assert "Link inválido" in page("/fornecedor/token-que-nao-existe-de-jeito-nenhum", EXT)
forj = page(f"/fornecedor/{TK}?erro=Ligue%20para%20(67)%2099999-0000%20e%20passe%20o%20Pix", EXT); assert "Ligue para (67) 99999-0000" not in forj and "Não foi possível concluir" in forj
AID_PCAD = aid_of(hp, "Enviar atualização"); AID_PBAN = aid_of(hp, "Enviar dados bancários"); AID_PDOC = aid_of(hp, "Enviar documento")
loc = post(f"/fornecedor/{TK}", AID_PCAD, {"token": TK, "supplierId": U, "cep": "79002-000", "logradouro": "Rua das Flores", "numero": "100", "bairro": "Centro", "cidade": "Campo Grande", "uf": "ms", "principalNome": "Sônia Horizonte", "principalEmail": "sonia@limpezahorizonte.example", "principalTelefone": "(67) 3333-0101", "financeiroNome": "Caio Cobrança", "financeiroEmail": "novo.financeiro@limpezahorizonte.example"}, EXT)
assert "ok=cadastro" in loc and re.search(r"protocolo=FOR-\d{4}-0001", loc), loc
assert psql(f"SELECT supplier_id || '|' || status || '|' || origem || '|' || jsonb_array_length(campos) FROM supplier_change_requests") == f"{A}|PENDENTE|PORTAL|7", "pedido só do próprio fornecedor (id do formulário ignorado)"
assert psql(f"SELECT email FROM supplier_contacts WHERE supplier_id={A} AND finalidade='FINANCEIRO'") == "cobranca@limpezahorizonte.example", "nada vale antes da revisão"
assert psql(f"SELECT count(*) FROM supplier_change_requests WHERE supplier_id={U}") == "0"
loc = post(f"/fornecedor/{TK}", AID_PCAD, {"token": TK, "principalNome": "Sônia Horizonte", "principalEmail": "sonia@limpezahorizonte.example", "principalTelefone": "(67) 3333-0101", "financeiroNome": "Caio Cobrança", "financeiroEmail": "cobranca@limpezahorizonte.example"}, EXT); assert "erro=" in loc and "Nada mudou" in loc, loc
for i in range(2): assert "ok=cadastro" in post(f"/fornecedor/{TK}", AID_PCAD, {"token": TK, "complemento": f"Sala {i + 1}"}, EXT)
loc = post(f"/fornecedor/{TK}", AID_PCAD, {"token": TK, "complemento": "Sala 9"}, EXT); assert "erro=" in loc and "aguardando revisão" in loc, loc
loc = post(f"/fornecedor/{TK}", AID_PBAN, {"token": TK, "bancoCodigo": "237", "agencia": "0001", "conta": "22222-2", "tipoConta": "CORRENTE", "titularNome": "Limpeza Horizonte Serviços Ltda (fictícia)", "titularDoc": fmtc(CA), "evidencia": "Mudamos de banco"}, EXT); assert "ok=banco" in loc, loc
assert psql(f"SELECT origem || '|' || status || '|' || solicitante_nome || '|' || (solicitante_user_id IS NULL) FROM supplier_bank_changes WHERE supplier_id={A} AND status='AGUARDANDO_CONFERENCIA'") == "PORTAL|AGUARDANDO_CONFERENCIA|Fornecedor (portal)|true"
assert psql(f"SELECT conta FROM supplier_bank_accounts WHERE supplier_id={A} AND status='EM_USO'") == "56789-0", "conta anterior segue valendo"
loc = post(f"/fornecedor/{TK}", AID_PDOC, {"token": TK, "tipo": "Documento que não existe", "validade": d(60)}, EXT, files={"arquivo": pdf("portal-x")}); assert "erro=" in loc, loc
loc = post(f"/fornecedor/{TK}", AID_PDOC, {"token": TK, "tipo": "CND federal (Receita/PGFN)", "validade": d(170)}, EXT, files={"arquivo": pdf("portal-cnd")}); assert "ok=documento" in loc, loc
assert psql(f"SELECT origem || '|' || status || '|' || enviado_por_nome FROM supplier_documents WHERE supplier_id={A} AND origem='PORTAL'") == "PORTAL|ENVIADO|Fornecedor (portal)"
assert psql(f"SELECT envios FROM supplier_invitations WHERE supplier_id={A} AND estado='ATIVO'") == "5"
hpp = page(FICHA(A, "portal"), OP); RQ = psql(f"SELECT id FROM supplier_change_requests WHERE supplier_id={A} ORDER BY id LIMIT 1")
aid_alt = aid_of(hpp, f'name="alteracaoId" value="{RQ}"')
campos = json.loads(psql(f"SELECT campos::text FROM supplier_change_requests WHERE id={RQ}")); idx = [i for i, c in enumerate(campos) if c["alvo"] == "contato:FINANCEIRO" and c["campo"] == "email"]
okmsg(post(FICHA(A, "portal"), aid_alt, {"id": A, "alteracaoId": RQ, "decisao": "APLICAR", "aplicar": idx}, OP), "aplicada (1 campo(s))")
assert psql(f"SELECT status FROM supplier_change_requests WHERE id={RQ}") == "PARCIAL" and psql(f"SELECT email FROM supplier_contacts WHERE supplier_id={A} AND finalidade='FINANCEIRO'") == "novo.financeiro@limpezahorizonte.example"
assert psql(f"SELECT cidade IS NULL FROM supplier_establishments WHERE supplier_id={A} AND matriz") == "t", "o que não foi marcado não muda"
RQ2 = psql(f"SELECT id FROM supplier_change_requests WHERE supplier_id={A} AND status='PENDENTE' ORDER BY id LIMIT 1")
erro(post(FICHA(A, "portal"), aid_of(page(FICHA(A, "portal"), OP), f'name="alteracaoId" value="{RQ2}"'), {"id": A, "alteracaoId": RQ2, "decisao": "RECUSAR"}, OP), "motivo")
okmsg(post(FICHA(A, "portal"), aid_of(page(FICHA(A, "portal"), OP), f'name="alteracaoId" value="{RQ2}"'), {"id": A, "alteracaoId": RQ2, "decisao": "RECUSAR", "motivo": "Sala não confere com o contrato"}, OP), "recusada")
assert "não aplicado: Sala não confere com o contrato" in page(f"/fornecedor/{TK}", EXT)
okmsg(post(FICHA(A, "portal"), aid_of(page(FICHA(A, "portal"), OP), "Cancelar convite"), {"id": A}, OP), "deixou de funcionar")
assert "não está mais ativo" in page(f"/fornecedor/{TK}", EXT)
loc = post(f"/fornecedor/{TK}", AID_PCAD, {"token": TK, "complemento": "Sala 3"}, EXT); assert "erro=" in loc, loc
loc = post(FICHA(K, "portal"), aid_of(page(FICHA(K, "portal"), OP), 'name="escopo"'), {"id": K, "dias": "3", "escopo": ["documentos"]}, OP); TK2 = re.search(r"convite=([A-Za-z0-9_\-]+)", loc).group(1)
hp2 = page(f"/fornecedor/{TK2}", EXT); assert "Enviar dados bancários" not in hp2 and "Enviar atualização" not in hp2 and "Enviar documento" in hp2 and "Sabor da Escola" in hp2
loc = post(f"/fornecedor/{TK2}", AID_PBAN, {"token": TK2, "bancoCodigo": "237", "agencia": "0001", "conta": "33333-3", "titularNome": "X", "titularDoc": fmtc(CK)}, EXT); assert "erro=" in loc, loc
assert psql(f"SELECT count(*) FROM supplier_bank_changes WHERE supplier_id={K}") == "0"
ok("convite com escopo e prazo, guardado só como hash e mostrado uma vez; portal mostra só os próprios dados (sem risco, avaliações ou outros fornecedores) e aviso antifraude; cadastro vira pedido com protocolo revisado campo a campo (parcial/recusado com motivo visível ao fornecedor), conta vai para a quarentena, documento para conferência; id forjado ignorado; limite de pedidos; erro forjado não aparece; convite cancelado ou sem a parte → recusado")

print("TC-SUP-010 · Scorecard explicável e ocorrências")
hdes = page(FICHA(A, "desempenho"), GE); aid_av = aid_of(hdes, "Registrar avaliação")
NOTAS = {"qualidade": 4, "pontualidade": 4, "atendimento": 4, "custo": 4, "conformidade": 4}
okmsg(post(FICHA(A, "desempenho"), aid_av, {"id": A, "periodo": "2026 · 2º semestre", **NOTAS}, GE), "nota 7,5 de 10 — amostra pequena")
erro(post(FICHA(A, "desempenho"), aid_av, {"id": A, "periodo": "2026 · 2º semestre", **NOTAS, "pontualidade": 1}, GE), "Nota baixa pede comentário")
assert psql(f"SELECT nota || '|' || (pesos->>'qualidade') || '|' || avaliador_nome FROM supplier_evaluations WHERE supplier_id={A}") == "7.5|30|Gestora Manutenção"
hdes = page(FICHA(A, "desempenho"), GE); assert "Fórmula:" in hdes and "peso 30%" in hdes and "Amostra:" in hdes and "Amostra pequena" in hdes
okmsg(post(FICHA(A, "desempenho"), aid_of(hdes, 'name="natureza"'), {"id": A, "natureza": "COBRANCA", "severidade": "ALTA", "descricao": "Boleto em duplicidade enviado em novembro", "plano": "Estorno e conferência mensal", "prazo": d(5)}, GE), "Ocorrência registrada")
assert "1 ocorrência(s) grave(s) em aberto" in page(FICHA(A), DG)
OC = psql(f"SELECT id FROM supplier_occurrences WHERE supplier_id={A}")
okmsg(post(FICHA(A, "desempenho"), aid_of(page(FICHA(A, "desempenho"), GE), 'name="ocorrenciaId"'), {"id": A, "ocorrenciaId": OC, "fechamento": "Estorno feito e conferido pelo financeiro"}, GE), "fechada")
ok("nota 0–10 pela fórmula com pesos, período, amostra e aviso de amostra pequena à vista; nota baixa pede comentário; ocorrência grave pesa no risco e fecha com o que foi feito")

print("Permissões, importação, inline em contas a pagar, pendências, política, busca, exportação e menu")
assert get("/operacoes/fornecedores", CO).status_code in (302, 303, 307) and "/sem-acesso" in get("/operacoes/fornecedores", CO).headers.get("location", "")
assert CO.get(B + "/api/export/fornecedores").status_code == 403
assert get("/operacoes/fornecedores/novo", GE).status_code in (302, 303, 307); erro(post("/operacoes/fornecedores/novo", AID_NOVO, {"tipo": "PJ", "documento": cnpj("96000111"), "categoria": "Outros", "razaoSocial": "Gestor Não Cadastra (fictícia)"}, GE), "Cadastram fornecedores")
erro(post(FICHA(U, "cadastro"), aid_of(page(FICHA(U, "cadastro"), DIR), "Salvar cobertura"), {"id": U, "abrangencia": "UNIDADES", "units": [CAR, CUL]}, DIR), "só a própria unidade")
hi = page("/operacoes/fornecedores?aba=importar", OP); AID_IMP = aid_of(hi, 'name="texto"')
CI = cnpj("98111222"); texto = "\n".join(["documento;razao_social;nome_fantasia;categoria;email;telefone;cidade;uf", f"{fmtc(CI)};Papelaria Ponto Final Ltda (fictícia);Ponto Final;Papelaria e escritório;vendas@pontofinal.example;(67) 3000-0000;Campo Grande;MS", "11.111.111/1111-11;CNPJ Errado (fictícia);;Outros;;;;", f"{CA};Repetida do Cadastro (fictícia);;Outros;;;;", f"{fmtc(CI)};Papelaria Ponto Final Ltda (fictícia);;Papelaria e escritório;;;;"])
okmsg(post("/operacoes/fornecedores?aba=importar", AID_IMP, {"texto": texto}, OP), "1 linha(s) entram como rascunho, 3 ficam de fora")
assert psql("SELECT count(*) FROM settings WHERE key LIKE 'forn_import_%'") == "1"
okmsg(post("/operacoes/fornecedores?aba=importar", aid_of(page("/operacoes/fornecedores?aba=importar", OP), "Confirmar e importar"), {}, OP), "1 fornecedor(es) importado(s)")
assert psql(f"SELECT s.status || '|' || s.origem || '|' || s.criticidade FROM suppliers s JOIN supplier_establishments e ON e.supplier_id=s.id WHERE e.documento='{CI}'") == "RASCUNHO|IMPORTACAO|BAIXA" and psql("SELECT count(*) FROM settings WHERE key LIKE 'forn_import_%'") == "0"
loc = cp(FS, "novo", extra={"fornecedorNovo": "Chaveiro Rápido (fictício)", "cadastrar": "1"}); okmsg(loc, "enviada para aprovação"); PN = pid(loc)
assert psql("SELECT status || '|' || origem || '|' || ativo FROM suppliers WHERE nome='Chaveiro Rápido (fictício)'") == "RASCUNHO|CONTAS_A_PAGAR|true"
assert "novo, cadastrado no lançamento" in psql(f"SELECT excecao_fornecedor FROM payables WHERE id={PN}")
erro(cp(FS, "novo", extra={"fornecedorNovo": "chaveiro rapido (ficticio)", "cadastrar": "1"}), "já está no cadastro de fornecedores")
erro(cp(FS, "novo", extra={"fornecedorNovo": "Corrida Suspensão (fictícia)", "cadastrar": "1"}), "está suspenso no cadastro")
loc = cp(FS, "novo", extra={"fornecedorNovo": "Taxista Avulso (fictício)", "cadastrar": ""}); okmsg(loc); assert "sem cadastro (só o nome no título)" in psql(f"SELECT excecao_fornecedor FROM payables WHERE id={pid(loc)}")
assert psql("SELECT count(*) FROM suppliers WHERE nome='Taxista Avulso (fictício)'") == "0"
# pendências: decisão (DG2), conferência bancária (FS2 — o pedido veio do portal), portal e documentos (OP)
okmsg(post(FICHA(A2, "cadastro"), aid_of(page(FICHA(A2, "cadastro"), DG), "Novo contato"), {"id": A2, "nome": "Contato A2", "finalidade": "PRINCIPAL", "telefone": "(67) 3000-1111"}, DG))
okmsg(post(FICHA(A2, "homologacao"), aid_of(page(FICHA(A2, "homologacao"), DG), "Enviar para homologação"), {"id": A2}, DG))
okmsg(post(FICHA(A2, "homologacao"), aid_par, {"id": A2, "etapa": "DOCUMENTAL", "resultado": "FAVORAVEL", "parecer": "Documentos conferidos no gov.br."}, OP))
okmsg(post(FICHA(A2, "homologacao"), aid_par, {"id": A2, "etapa": "FINANCEIRO", "resultado": "FAVORAVEL", "parecer": "Sem restrições financeiras."}, FS), "pronta para a decisão")
pd2 = page("/pendencias", DG2); assert "Decidir homologação" in pd2 and "Limpeza Horizonte Servicos Ltda (ficticia)" in pd2
assert "Decidir homologação" not in page("/pendencias", DG) or "Limpeza Horizonte Servicos" not in page("/pendencias", DG), "quem cadastrou/enviou não recebe a decisão"
pf2 = page("/pendencias", FS2); assert "alteração(ões) bancária(s) em quarentena" in pf2
po = page("/pendencias", OP); assert "documento(s) de fornecedor para conferir" in po and "cadastro(s) anterior(es) à v33 para revisar" in po and "fornecedor(es) para revalidar" in po
hc = page("/configuracoes", RH); AID_POL = aid_of(hc, "Salvar política")
base_pol = {"categorias": "Limpeza e conservação | média\nAlimentação e cantina | alta\nOutros | baixa\nPapelaria e escritório | baixa\nManutenção predial e elétrica | média\nAr-condicionado e refrigeração | média", "docBAIXA": "Comprovante de inscrição e situação cadastral (CNPJ)", "docMEDIA": "Comprovante de inscrição e situação cadastral (CNPJ)\nCND federal (Receita/PGFN)", "docALTA": "Comprovante de inscrição e situação cadastral (CNPJ)\nCND federal (Receita/PGFN)\nAlvará de funcionamento", "docPF": "Documento de identificação do prestador", "extras": "Alimentação e cantina | Licença sanitária (Vigilância Sanitária)", "revALTA": "6", "revMEDIA": "12", "revBAIXA": "24", "alerta": "30", "convite": "7", "concentracao": "15", "pQualidade": "30", "pPontualidade": "25", "pAtendimento": "20", "pCusto": "15", "pConformidade": "10", "legadoAte": legado_ate, "vencidoBloqueiaAlta": "1", "excecaoExigeAprovacao": "1"}
erro(post("/configuracoes", AID_POL, {**base_pol, "pCusto": "5"}, RH), "precisam somar 100")
erro(post("/configuracoes", AID_POL, {**base_pol, "categorias": "Limpeza | urgente\nOutros | baixa\nX | alta"}, RH), "use “Nome | alta”")
erro(post("/configuracoes", AID_POL, {**base_pol, "extras": "Categoria Inexistente | Documento"}, RH), "não está na lista de categorias")
okmsg(post("/configuracoes", AID_POL, base_pol, RH), "Política de fornecedores salva")
assert psql("SELECT jsonb_array_length(value->'categorias') || '|' || (value->'pesos'->>'custo') FROM settings WHERE key='fornecedores'") == "6|15"
assert psql("SELECT count(*) FROM audit_log WHERE acao='editar política de fornecedores'") == "1"
bs = DG.get(B + "/api/busca?q=91222333").json(); assert any(x["grupo"] == "Fornecedores" and x["href"] == f"/operacoes/fornecedores/{A}" for x in bs["resultados"]), bs
assert CO.get(B + "/api/busca?q=Limpeza").json().get("resultados", []) == [] or all(x["grupo"] != "Fornecedores" for x in CO.get(B + "/api/busca?q=Limpeza").json()["resultados"])
cf = FS.get(B + "/api/export/fornecedores").content.decode("utf-8-sig"); co_ = OP.get(B + "/api/export/fornecedores").content.decode("utf-8-sig")
assert "despesa_liquida_12m" in cf.splitlines()[0] and "despesa_liquida_12m" not in co_.splitlines()[0] and "Limpeza Horizonte" in cf and "56789" not in cf and "98765" not in cf
mf = page("/financeiro", FS); assert 'href="/operacoes/fornecedores"' in mf
ok("comercial fora (tela, CSV e busca); gestor avalia mas não cadastra; direção da unidade autoriza só a própria; importação com prévia (dígito, repetição no cadastro e na planilha) → rascunhos; novo fornecedor no lançamento vira rascunho com exceção (nome repetido ou suspenso recusado; sem cadastro também registrado); pendências por papel e segregação; política validada e auditada; busca por CNPJ; CSV sem dados bancários e com valores só para o financeiro; Fornecedores no menu do Financeiro")

print(f"\nTOTAL: {N[0]} blocos ok — v33 Fornecedores")
