"""Dados de DEMONSTRAÇÃO da v33 — NUNCA rode em produção. Tudo fictício: empresas inventadas, CNPJs da faixa 9x (ainda não atribuída
pela Receita), contatos em domínios .example (reservados), contas e agências inventadas.
Roda com o servidor no ar, na base de treinamento da v32 (já atualizada para a v33). Quase tudo pela própria interface, como a equipe faria:
  1. um cadastro anterior (Limpa Bem) vira fornecedor homologado: CNPJ, etapas, documentos, pareceres, decisão e avaliação;
  2. criticidade alta homologada com contingência e três pareceres (Sabor & Saúde, com contrato e avaliação);
  3. homologação pronta para a decisão da Direção (Rota Segura) e outra aguardando parecer (pessoa física, CPF mascarado);
  4. documento exigível vencido em criticidade alta → em revalidação pela rotina (Vigia Total), com recusa e pendência;
  5. homologado com restrição e escopo por unidade, contrato com exceção e ocorrência aberta (Brilho);
  6. conta em uso e troca de conta em quarentena — pedida, conferida e aguardando a terceira pessoa (Frio Polar);
  7. rascunho incompleto (EduTech, dados pessoais), suspensão (Dedetiza MS), importação com prévia;
  8. portal do fornecedor: convite, atualização de cadastro, conta e documento enviados pelo próprio fornecedor (Papel & Cia);
  9. contas a pagar com exceção de fornecedor (fora do escopo e fornecedor novo no lançamento).
Uso: python3 scripts/demo_v33.py   (servidor local em http://localhost:3100, banco local via psql)."""
import os, re, subprocess, json, requests
from datetime import datetime, timedelta, date
from zoneinfo import ZoneInfo
B = os.environ.get("APP", "http://localhost:3100")
SAIDA_TOKEN = os.environ.get("TOKEN_FORNECEDOR", "/home/claude/trabalho/manual/token_fornecedor.txt")
def psql(q):
    r = subprocess.run(["su", "postgres", "-c", "/usr/lib/postgresql/16/bin/psql -h /tmp/pg -U status -d status_people -q -t -A -F '|' -v ON_ERROR_STOP=1"], input=q + ";", capture_output=True, text=True)
    if r.returncode != 0: raise SystemExit(f"SQL falhou: {r.stderr[:800]}\n{q[:600]}")
    return r.stdout.strip()
def mk(): s = requests.Session(); s.headers.update({"Origin": B}); return s
def action_ids(html): i = html.find("<main"); return re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', html[i:] if i >= 0 else html)
def post(path, aid, data, sess, files=None, show=True):
    f = [(f"$ACTION_ID_{aid}", (None, ""))]
    for k, v in data.items():
        for x in (v if isinstance(v, list) else [v]): f.append((k, (None, str(x))))
    for k, v in (files or {}).items(): f.append((k, v))
    r = sess.post(B + path, files=f, allow_redirects=False); m = re.search(r"rh_session=([^;]+)", r.headers.get("set-cookie", ""))
    if m: sess.headers["Cookie"] = f"rh_session={m.group(1)}"
    loc = requests.utils.unquote(r.headers.get("location", "")).replace("\xa0", " ").replace("+", " ")
    if show: print("   ", path[:60], "→", loc[:150])
    return loc
def aid_of(html, marker):
    i = html.find(marker); assert i >= 0, marker
    fs = html.rfind("<form", 0, i); fe_prev = html.rfind("</form>", 0, i)
    if fs > fe_prev: fe = html.find("</form>", i)
    else: fs = html.find("<form", i); fe = html.find("</form>", fs)
    return action_ids(html[fs:fe])[0]
def page(path, sess): return re.sub(r"<script[^>]*>.*?</script>", "", sess.get(B + path).text, flags=re.S).replace("\xa0", " ")
def login(email, senha):
    s = mk(); html = s.get(B + "/login").text; aid = re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', html)[0]
    loc = post("/login", aid, {"email": email, "senha": senha}, s, show=False); assert loc.endswith("/"), (email, loc); return s
def ok(loc, trecho=""): assert "ok=" in loc and trecho in loc, loc; return loc
HOJE = datetime.now(ZoneInfo("America/Campo_Grande")).date(); d = lambda n: (HOJE + timedelta(days=n)).isoformat()
def cnpj(base8, filial="0001"):
    n = [int(c) for c in base8 + filial]
    def dv(ns, pesos): t = sum(a * b for a, b in zip(ns, pesos)); r = t % 11; return 0 if r < 2 else 11 - r
    d1 = dv(n, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]); d2 = dv(n + [d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]); return "".join(map(str, n + [d1, d2]))
def fmtc(c): return f"{c[:2]}.{c[2:5]}.{c[5:8]}/{c[8:12]}-{c[12:]}"
def cpf(base9):
    n = [int(c) for c in base9]
    d1 = (sum(a * b for a, b in zip(n, range(10, 1, -1))) * 10) % 11 % 10; d2 = (sum(a * b for a, b in zip(n + [d1], range(11, 1, -1))) * 10) % 11 % 10; return "".join(map(str, n + [d1, d2]))
def pdf(tipo, quem):
    texto = f"Documento ficticio de demonstracao - {tipo} - {quem}".encode("latin-1", "replace").decode("latin-1")
    corpo = f"BT /F1 11 Tf 40 780 Td ({texto}) Tj ET".encode("latin-1", "replace")
    objs = [b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>", b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
            b"<< /Length " + str(len(corpo)).encode() + b" >>\nstream\n" + corpo + b"\nendstream", b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    out = b"%PDF-1.4\n"; pos = []
    for i, o in enumerate(objs): pos.append(len(out)); out += f"{i + 1} 0 obj\n".encode() + o + b"\nendobj\n"
    x = len(out); out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode() + b"".join(f"{p:010d} 00000 n \n".encode() for p in pos)
    out += f"trailer << /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{x}\n%%EOF\n".encode()
    nome = re.sub(r"[^a-z0-9]+", "-", f"{tipo}-{quem}".lower().encode("ascii", "ignore").decode())[:60] + ".pdf"
    return (nome, out, "application/pdf")
FICHA = lambda i, aba="resumo": f"/operacoes/fornecedores/{i}?aba={aba}"

if psql("SELECT 1 FROM settings WHERE key='demo_v33'"): raise SystemExit("A demonstração da v33 já foi carregada nesta base.")
assert float(psql("SELECT value->>'versao' FROM settings WHERE key='banco'")) >= 33, "a base ainda não foi atualizada para a v33 (suba o servidor primeiro)"
print("Pessoas fictícias da demonstração (logins de treinamento)")
OP = login("operacoes.teste", "Homolog2026!")          # Operações — cadastra e dá a conferência documental e o parecer técnico
FIN = login("fin@status", "senha12345")                # Financeiro — confere documentos e contas
JUL = login("juliana.moraes@exemplo.com", "senha12345")  # Gerente Financeira — parecer financeiro
DIE = login("diego.lima@exemplo.com", "senha12345")    # Auxiliar financeiro — propõe contas
PAU = login("paula.costa@exemplo.com", "senha12345")   # Auxiliar financeira — confere contas por canal conhecido
DG = login("dir@geral", "senha12345")                  # Diretora Geral — decide homologações, aprova trocas de conta e suspende
DT = login("direcao.teste", "Homolog2026!")            # Direção Teste — segunda pessoa da Direção
GES = login("gestor.caranda", "Homolog2026!")          # Coordenação — avalia e dá parecer técnico
DU = login("du@caranda", "senha12345")                 # Direção da unidade Carandá — parecer técnico
U = {c: int(psql(f"SELECT id FROM units WHERE codigo='{c}'")) for c in ["CAR", "TVM1", "TVM2", "CUL"]}
UOP = int(psql("SELECT id FROM users WHERE email='operacoes.teste'"))
A = {}  # ids de ação, descobertos uma vez
def aid(nome, html, marcador):
    if nome not in A: A[nome] = aid_of(html, marcador)
    return A[nome]

def novo(sess, tipo, doc, razao, fantasia, cat, extra=None):
    h = page("/operacoes/fornecedores/novo", sess)
    loc = ok(post("/operacoes/fornecedores/novo", aid("novo", h, 'name="razaoSocial"'), {"tipo": tipo, "documento": doc, "categoria": cat, "razaoSocial": razao, "nomeFantasia": fantasia, **(extra or {})}, sess), "Rascunho criado")
    return int(re.search(r"/fornecedores/(\d+)", loc).group(1))
def identificacao(sess, fid, nome, cat, fatores=(), resp=UOP, crit=""):
    h = page(FICHA(fid, "cadastro"), sess); ok(post(FICHA(fid, "cadastro"), aid("ident", h, "Salvar identificação"), {"id": fid, "nome": nome, "categoria": cat, "fatores": list(fatores), "criticidade": crit, "responsavelUserId": resp}, sess))
def endereco(sess, fid, logradouro, numero, bairro, cep, regime="SIMPLES", cnae=""):
    h = page(FICHA(fid, "cadastro"), sess); est = psql(f"SELECT id FROM supplier_establishments WHERE supplier_id={fid} AND matriz"); razao = psql(f"SELECT razao_social FROM supplier_establishments WHERE id={est}")
    ok(post(FICHA(fid, "cadastro"), aid("estab", h, 'name="estabId"'), {"id": fid, "estabId": est, "razaoSocial": razao, "regime": regime, "cnae": cnae, "cep": cep, "logradouro": logradouro, "numero": numero, "bairro": bairro, "cidade": "Campo Grande", "uf": "MS"}, sess))
def consulta(sess, fid, situacao="ATIVA", dias=-3):
    h = page(FICHA(fid, "cadastro"), sess); est = psql(f"SELECT id FROM supplier_establishments WHERE supplier_id={fid} AND matriz")
    ok(post(FICHA(fid, "cadastro"), aid("consulta", h, 'name="fonte"'), {"id": fid, "estabId": est, "situacao": situacao, "fonte": "gov.br — comprovante de inscrição e situação cadastral", "data": d(dias)}, sess))
def contato(sess, fid, nome, fin, email, tel="", cargo="", principal=False):
    h = page(FICHA(fid, "cadastro"), sess); dados = {"id": fid, "nome": nome, "finalidade": fin, "email": email, "telefone": tel, "cargo": cargo}
    if principal: dados["principal"] = "1"
    ok(post(FICHA(fid, "cadastro"), aid("contato", h, "Novo contato"), dados, sess))
def cobertura(sess, fid, unidades=None, capacidade="", contingencia=""):
    h = page(FICHA(fid, "cadastro"), sess)
    dados = {"id": fid, "abrangencia": "UNIDADES" if unidades else "REDE", "capacidade": capacidade, "contingencia": contingencia}
    if unidades: dados["units"] = [U[x] for x in unidades]
    ok(post(FICHA(fid, "cadastro"), aid("cobertura", h, "Salvar cobertura"), dados, sess))
def pagamento(sess, fid, forma, prazo, conta=None, desc="", desc_dias="", obs=""):
    h = page(FICHA(fid, "financeiro"), sess); cid = psql(f"SELECT id FROM chart_accounts WHERE codigo='{conta}'") if conta else ""
    ok(post(FICHA(fid, "financeiro"), aid("pagamento", h, "Salvar condições"), {"id": fid, "formaPagamento": forma, "prazoDias": prazo, "descontoPct": desc, "descontoDias": desc_dias, "contaId": cid, "condicaoObs": obs}, sess))
def documento(sess, fid, tipo, validade=None, numero="", emissao=None, quem=""):
    h = page(FICHA(fid, "documentos"), sess)
    ok(post(FICHA(fid, "documentos"), aid("doc", h, 'name="tipoOutro"'), {"id": fid, "tipo": tipo, "numero": numero, "emissao": emissao or d(-20), "validade": validade or ""}, sess, files={"arquivo": pdf(tipo, quem)}), "aguarda conferência")
def conferir_todos(sess, fid, recusar=None):
    for did, tipo in [r.split("|") for r in psql(f"SELECT id, tipo FROM supplier_documents WHERE supplier_id={fid} AND status='ENVIADO' ORDER BY id").splitlines() if r]:
        h = page(FICHA(fid, "documentos"), sess)
        if recusar and tipo == recusar[0]: ok(post(FICHA(fid, "documentos"), aid("conferir_doc", h, 'name="docId"'), {"id": fid, "docId": did, "resultado": "RECUSAR", "motivo": recusar[1]}, sess), "recusado")
        else: ok(post(FICHA(fid, "documentos"), aid("conferir_doc", h, 'name="docId"'), {"id": fid, "docId": did, "resultado": "CONFERIR"}, sess), "conferido")
def enviar(sess, fid):
    h = page(FICHA(fid, "homologacao"), sess); return ok(post(FICHA(fid, "homologacao"), aid("enviar", h, "Enviar para homologação"), {"id": fid}, sess), "Enviado")
def parecer(sess, fid, etapa, texto, resultado="FAVORAVEL"):
    h = page(FICHA(fid, "homologacao"), sess); return ok(post(FICHA(fid, "homologacao"), aid("parecer", h, "Registrar parecer"), {"id": fid, "etapa": etapa, "resultado": resultado, "parecer": texto}, sess))
def decidir(sess, fid, decisao, justificativa, restricoes="", ate=""):
    h = page(FICHA(fid, "homologacao"), sess); v = psql(f"SELECT versao FROM suppliers WHERE id={fid}")
    return ok(post(FICHA(fid, "homologacao"), aid("decidir", h, "Registrar decisão"), {"id": fid, "versao": v, "decisao": decisao, "justificativa": justificativa, "restricoes": restricoes, "restricaoAte": ate}, sess), "Decisão registrada")
def avaliar(sess, fid, periodo, notas, comentario=""):
    h = page(FICHA(fid, "desempenho"), sess); ok(post(FICHA(fid, "desempenho"), aid("avaliar", h, "Registrar avaliação"), {"id": fid, "periodo": periodo, **notas, "comentario": comentario}, sess), "Avaliação registrada")
def ocorrencia(sess, fid, natureza, sev, descricao, plano="", prazo="", data=None):
    h = page(FICHA(fid, "desempenho"), sess); ok(post(FICHA(fid, "desempenho"), aid("ocorrencia", h, 'name="natureza"'), {"id": fid, "data": data or d(-5), "natureza": natureza, "severidade": sev, "descricao": descricao, "plano": plano, "prazo": prazo}, sess), "Ocorrência registrada")
def conta_banco(sess, fid, banco, ag, conta, titular, doc, evidencia, pix_tipo="", pix=""):
    h = page(FICHA(fid, "financeiro"), sess); return ok(post(FICHA(fid, "financeiro"), aid("propor", h, "Enviar para quarentena"), {"id": fid, "bancoCodigo": banco, "agencia": ag, "conta": conta, "tipoConta": "CORRENTE", "titularNome": titular, "titularDoc": doc, "pixTipo": pix_tipo, "pixChave": pix, "evidencia": evidencia}, sess), "quarentena")
def conferir_conta(sess, fid, canal):
    m = psql(f"SELECT id FROM supplier_bank_changes WHERE supplier_id={fid} AND status='AGUARDANDO_CONFERENCIA'"); h = page(FICHA(fid, "financeiro"), sess)
    ok(post(FICHA(fid, "financeiro"), aid("conf_conta", h, "Registrar conferência"), {"id": fid, "mudancaId": m, "resultado": "CONFIRMADA", "canal": canal}, sess), "terceira pessoa")
def aprovar_conta(sess, fid):
    m = psql(f"SELECT id FROM supplier_bank_changes WHERE supplier_id={fid} AND status='AGUARDANDO_APROVACAO'"); h = page(FICHA(fid, "financeiro"), sess)
    ok(post(FICHA(fid, "financeiro"), aid("aprov_conta", h, "Aprovar e colocar em uso"), {"id": fid, "mudancaId": m}, sess), "em uso")
NOTAS = lambda q, p, a, c, f: {"qualidade": q, "pontualidade": p, "atendimento": a, "custo": c, "conformidade": f}
MEDIA_DOCS = ["Comprovante de inscrição e situação cadastral (CNPJ)", "Contrato social ou CCMEI", "CND federal (Receita/PGFN)", "CRF do FGTS", "CNDT (débitos trabalhistas)"]
ALTA_DOCS = MEDIA_DOCS + ["CND estadual", "CND municipal", "Alvará de funcionamento"]
SEM = f"{HOJE.year} · {'1º' if HOJE.month <= 6 else '2º'} semestre"

print("1) Cadastro anterior → homologado: Limpa Bem Serviços")
LIMPA = int(psql("SELECT id FROM suppliers WHERE nome='Limpa Bem Serviços'"))
h = page(FICHA(LIMPA, "cadastro"), OP)
ok(post(FICHA(LIMPA, "cadastro"), aid_of(h, "Incluir o documento do estabelecimento principal"), {"id": LIMPA, "tipoDoc": "CNPJ", "documento": fmtc(cnpj("90217455")), "razaoSocial": "Limpa Bem Serviços de Conservação Ltda", "nomeFantasia": "Limpa Bem", "cidade": "Campo Grande", "uf": "MS"}, OP), "Documento principal incluído")
identificacao(OP, LIMPA, "Limpa Bem Serviços", "Limpeza e conservação", ["acesso_fisico"])
endereco(OP, LIMPA, "Rua dos Ipês", "1250", "Jardim dos Estados", "79020-100", cnae="8121400")
consulta(FIN, LIMPA)
contato(OP, LIMPA, "Márcia Ferraz", "PRINCIPAL", "marcia@limpabem.example", "(67) 3000-0101", "Sócia-gerente", True)
contato(OP, LIMPA, "Setor de cobrança", "FINANCEIRO", "cobranca@limpabem.example", "(67) 3000-0102")
cobertura(OP, LIMPA, None, "Equipes fixas nas quatro unidades; reposição de faltas em até 2 horas", "Segunda empresa cotada para a reposição de emergência; estoque de material para 15 dias")
pagamento(FIN, LIMPA, "BOLETO", 30, "3.3.03", obs="Reajuste anual pelo IPCA em fevereiro")
for t, v in [(MEDIA_DOCS[0], None), (MEDIA_DOCS[1], None), (MEDIA_DOCS[2], d(150)), (MEDIA_DOCS[3], d(22)), (MEDIA_DOCS[4], d(160))]: documento(OP, LIMPA, t, v, quem="Limpa Bem")
conferir_todos(FIN, LIMPA)
conta_banco(DIE, LIMPA, "237", "3410", "128450-7", "Limpa Bem Serviços de Conservação Ltda", fmtc(cnpj("90217455")), "Carta em papel timbrado assinada pela sócia, entregue na Carandá")
conferir_conta(PAU, LIMPA, "Liguei para (67) 3000-0101, telefone do cadastro de 2024, e confirmei com a sócia Márcia")
aprovar_conta(DG, LIMPA)
enviar(OP, LIMPA)
parecer(FIN, LIMPA, "DOCUMENTAL", "Cartão CNPJ conferido no gov.br; certidões federais e trabalhista em dia; CRF vence em 3 semanas (pedir a nova).")
parecer(JUL, LIMPA, "FINANCEIRO", "Fornecedor há 3 anos, sem atraso de entrega; despesa líquida compatível com o contrato vigente.", "RESSALVA")
decidir(DG, LIMPA, "HOMOLOGADO", "Relação antiga, documentos em dia e conta conferida; renovar o CRF antes do vencimento.")
avaliar(GES, LIMPA, SEM, NOTAS(4, 4, 5, 3, 5), "Equipe pontual; reposição de faltas rápida. Custo acima da média do mercado.")

print("2) Criticidade alta homologada: Sabor & Saúde (cantina)")
SABOR = novo(OP, "PJ", fmtc(cnpj("90318566")), "Sabor & Saúde Alimentação Escolar Ltda", "Sabor & Saúde", "Alimentação e cantina")
identificacao(OP, SABOR, "Sabor & Saúde", "Alimentação e cantina", ["saude_seguranca", "continuidade", "acesso_fisico"])
endereco(OP, SABOR, "Av. Afonso Pena", "4100", "Centro", "79002-000", cnae="5620101")
consulta(FIN, SABOR)
contato(OP, SABOR, "Cláudio Menezes", "PRINCIPAL", "claudio@saborsaude.example", "(67) 3000-0201", "Nutricionista responsável", True)
contato(OP, SABOR, "Financeiro Sabor & Saúde", "FINANCEIRO", "financeiro@saborsaude.example", "(67) 3000-0202")
cobertura(OP, SABOR, None, "Cozinha central com 1.200 refeições/dia; entrega nas quatro unidades até 10h", "Cantina parceira (Bom Prato Escolar) cotada como alternativa; cardápio frio para 3 dias em estoque")
pagamento(FIN, SABOR, "BOLETO", 15, "3.3.03")
for t, v in [(ALTA_DOCS[0], None), (ALTA_DOCS[1], None), (ALTA_DOCS[2], d(120)), (ALTA_DOCS[3], d(80)), (ALTA_DOCS[4], d(150)), (ALTA_DOCS[5], d(90)), (ALTA_DOCS[6], d(60)), (ALTA_DOCS[7], d(300)),
             ("Licença sanitária (Vigilância Sanitária)", d(200)), ("Certificado de boas práticas na manipulação de alimentos", d(260))]: documento(OP, SABOR, t, v, quem="Sabor e Saude")
conferir_todos(FIN, SABOR)
enviar(OP, SABOR)
parecer(FIN, SABOR, "DOCUMENTAL", "Todas as certidões e a licença sanitária conferidas; boas práticas com responsável técnico.")
parecer(JUL, SABOR, "FINANCEIRO", "Preço por refeição dentro da média de três cotações; prazo de 15 dias aceito.")
parecer(GES, SABOR, "TECNICO", "Visita à cozinha central: fluxo de higienização e controle de temperatura em dia; cardápio validado pela nutrição.")
decidir(DG, SABOR, "HOMOLOGADO", "Três pareceres favoráveis; criticidade alta com plano de contingência e licença sanitária válida.")
h = page("/operacoes/contratos", DG)
ok(post("/operacoes/contratos", aid_of(h, "Cadastrar contrato"), {"supplierId": SABOR, "objeto": "Fornecimento de lanches e almoço escolar (fictício)", "unitId": "", "numero": "CT-2026-031", "inicio": d(-20), "fim": d(345), "renovacao": "MANUAL", "avisoPrevioDias": "60", "valorMensal": "18.400,00", "reajusteIndice": "IPCA"}, DG), "Contrato salvo")
avaliar(GES, SABOR, SEM, NOTAS(5, 4, 5, 4, 5), "Cardápio cumprido e boa aceitação dos alunos.")

print("3) Homologação pronta para decidir (Rota Segura) e pessoa física aguardando parecer")
ROTA = novo(OP, "PJ", fmtc(cnpj("90419677")), "Rota Segura Transporte Escolar Ltda", "Rota Segura", "Transporte escolar")
identificacao(OP, ROTA, "Rota Segura", "Transporte escolar", ["saude_seguranca", "continuidade"])
endereco(OP, ROTA, "Rua Rui Barbosa", "2890", "Centro", "79010-450", cnae="4924800")
consulta(FIN, ROTA)
contato(OP, ROTA, "Patrícia Lemos", "PRINCIPAL", "patricia@rotasegura.example", "(67) 3000-0301", "Diretora operacional", True)
cobertura(OP, ROTA, ["CAR", "TVM1"], "6 vans com monitora; rotas da manhã e da tarde", "Segunda frota cotada (Vai Bem Turismo) e plano de comunicação às famílias em caso de pane")
for t, v in [(ALTA_DOCS[0], None), (ALTA_DOCS[2], d(100)), (ALTA_DOCS[3], d(70)), (ALTA_DOCS[4], d(140)), ("Autorização municipal de transporte escolar", d(210)), ("Apólice de seguro de passageiros (APP)", d(180)), ("Laudo de vistoria do veículo", d(95))]: documento(OP, ROTA, t, v, quem="Rota Segura")
conferir_todos(FIN, ROTA)
enviar(OP, ROTA)
parecer(FIN, ROTA, "DOCUMENTAL", "Autorização municipal, apólice de passageiros e vistoria das vans conferidas; faltam o contrato social e a CND estadual (pedidos).", "RESSALVA")
parecer(JUL, ROTA, "FINANCEIRO", "Preço por aluno 8% abaixo da empresa atual; sem protesto ou restrição.")
parecer(DU, ROTA, "TECNICO", "Acompanhei a rota da manhã: monitora em todas as vans, cintos e cadeirinhas conforme a idade.")
PF = novo(OP, "PF", cpf("905114433"), "João Batista Pereira (fictício)", "João Eletricista", "Manutenção predial e elétrica")
identificacao(OP, PF, "João Eletricista", "Manutenção predial e elétrica", ["acesso_fisico"])
contato(OP, PF, "João Batista Pereira", "PRINCIPAL", "joao.eletricista@servicos.example", "(67) 3000-0401", "", True)
for t in ["Documento de identificação do prestador", "Inscrição municipal de autônomo (ISS)"]: documento(OP, PF, t, None, quem="Joao")
conferir_todos(FIN, PF)
enviar(OP, PF)
parecer(FIN, PF, "DOCUMENTAL", "Documento de identificação e inscrição municipal conferidos.")

print("4) Documento vencido em criticidade alta → em revalidação (Vigia Total)")
VIGIA = novo(OP, "PJ", fmtc(cnpj("90520788")), "Vigia Total Segurança Patrimonial Ltda", "Vigia Total", "Segurança e portaria")
identificacao(OP, VIGIA, "Vigia Total", "Segurança e portaria", ["saude_seguranca", "acesso_fisico"])
endereco(OP, VIGIA, "Rua 14 de Julho", "3300", "Centro", "79004-392", cnae="8011101")
consulta(FIN, VIGIA, dias=-200)
contato(OP, VIGIA, "Sargento Ramos (fictício)", "PRINCIPAL", "ramos@vigiatotal.example", "(67) 3000-0501", "Supervisor", True)
cobertura(OP, VIGIA, None, "Portaria 24h nas quatro unidades; ronda motorizada", "Empresa reserva com contrato-ponte de 30 dias; câmeras com gravação em nuvem")
for t, v in [(ALTA_DOCS[0], None), (ALTA_DOCS[1], None), (ALTA_DOCS[2], d(60)), (ALTA_DOCS[3], d(12)), (ALTA_DOCS[4], d(90)), (ALTA_DOCS[5], d(45)), (ALTA_DOCS[6], d(30)), (ALTA_DOCS[7], d(240)), ("Autorização de funcionamento (vigilância)", d(150))]: documento(OP, VIGIA, t, v, quem="Vigia Total")
conferir_todos(FIN, VIGIA)
enviar(OP, VIGIA)
parecer(FIN, VIGIA, "DOCUMENTAL", "Autorização da Polícia Federal e certidões conferidas.")
parecer(JUL, VIGIA, "FINANCEIRO", "Contrato dentro do orçamento de segurança.")
parecer(GES, VIGIA, "TECNICO", "Postos cobertos e livro de ocorrências em dia.")
decidir(DG, VIGIA, "HOMOLOGADO", "Pareceres favoráveis; autorização de funcionamento válida.")
# o tempo passa (demonstração): a CND municipal venceu ontem e a nova chegou ilegível
psql(f"UPDATE supplier_documents SET validade='{d(-1)}', emissao='{d(-181)}' WHERE supplier_id={VIGIA} AND tipo='CND municipal'")
documento(OP, VIGIA, "CND municipal", d(170), quem="Vigia Total nova")
conferir_todos(FIN, VIGIA, recusar=("CND municipal", "Arquivo ilegível: envie o PDF original emitido pela Prefeitura"))

print("5) Homologado com restrição e escopo por unidade (Brilho), contrato com exceção e ocorrência")
BRILHO = novo(OP, "PJ", fmtc(cnpj("90621899")), "Brilho Limpeza e Conservação Ltda", "Brilho Limpeza", "Limpeza e conservação")
identificacao(OP, BRILHO, "Brilho Limpeza", "Limpeza e conservação", ["acesso_fisico"])
endereco(OP, BRILHO, "Rua Pedro Celestino", "880", "Centro", "79002-371", cnae="8121400")
consulta(FIN, BRILHO)
contato(OP, BRILHO, "Renan Duarte", "PRINCIPAL", "renan@brilho.example", "(67) 3000-0601", "Comercial", True)
cobertura(OP, BRILHO, ["CAR", "TVM1"], "Equipe volante para limpeza pesada e pós-obra")
for t, v in [(MEDIA_DOCS[0], None), (MEDIA_DOCS[1], None), (MEDIA_DOCS[2], d(130)), (MEDIA_DOCS[3], d(40)), (MEDIA_DOCS[4], d(110))]: documento(OP, BRILHO, t, v, quem="Brilho")
conferir_todos(FIN, BRILHO)
enviar(OP, BRILHO)
parecer(FIN, BRILHO, "DOCUMENTAL", "Documentos da média criticidade conferidos.")
parecer(JUL, BRILHO, "FINANCEIRO", "Empresa nova no mercado; capital social baixo para contratos grandes.", "RESSALVA")
decidir(DG, BRILHO, "CONDICIONAL", "Boa proposta para limpeza pesada, mas empresa nova: começa com contratos pequenos.", "Autorizado: limpeza pesada e pós-obra em Carandá e TV Morena I. Vedado: contrato acima de R$ 10 mil/mês até a próxima revisão.", d(120))
h = page("/operacoes/contratos", DG)
ok(post("/operacoes/contratos", aid_of(h, "Cadastrar contrato"), {"supplierId": BRILHO, "objeto": "Limpeza pós-obra do laboratório da Cultura (fictício)", "unitId": U["CUL"], "inicio": d(-3), "fim": d(27), "renovacao": "MANUAL", "avisoPrevioDias": "0", "valorMensal": "4.800,00", "excecaoMotivo": "Obra do laboratório termina antes da revisão; a empresa já atende a Carandá e foi a única com equipe disponível"}, DG), "Contrato salvo")
ocorrencia(GES, BRILHO, "ATENDIMENTO", "MEDIA", "Equipe chegou 2 horas depois do combinado na limpeza da quadra.", "Confirmar a escala por mensagem na véspera", d(10))

print("6) Conta em uso e troca de conta em quarentena (Frio Polar)")
FRIO = novo(OP, "PJ", fmtc(cnpj("90722900")), "Frio Polar Climatização Ltda", "Frio Polar", "Ar-condicionado e refrigeração")
identificacao(OP, FRIO, "Frio Polar", "Ar-condicionado e refrigeração", ["acesso_fisico"])
endereco(OP, FRIO, "Rua Maracaju", "540", "Centro", "79002-212", cnae="4322302")
consulta(FIN, FRIO)
contato(OP, FRIO, "Eduardo Prates", "PRINCIPAL", "eduardo@friopolar.example", "(67) 3000-0701", "Técnico responsável", True)
cobertura(OP, FRIO, None, "Atendimento em até 4 horas; contrato de preventiva trimestral")
pagamento(FIN, FRIO, "PIX", 30, "3.3.03", "2", "10")
for t, v in [(MEDIA_DOCS[0], None), (MEDIA_DOCS[1], None), (MEDIA_DOCS[2], d(90)), (MEDIA_DOCS[3], d(60)), (MEDIA_DOCS[4], d(150)), ("Registro do responsável técnico (CREA/CFT) e ART", d(300))]: documento(OP, FRIO, t, v, quem="Frio Polar")
conferir_todos(FIN, FRIO)
conta_banco(DIE, FRIO, "756", "4012", "70123-4", "Frio Polar Climatização Ltda", fmtc(cnpj("90722900")), "Cartão do banco e contrato social apresentados na assinatura", "CNPJ", cnpj("90722900"))
conferir_conta(PAU, FRIO, "Liguei para (67) 3000-0701, do cadastro, e confirmei com o técnico responsável")
aprovar_conta(DG, FRIO)
enviar(OP, FRIO)
parecer(FIN, FRIO, "DOCUMENTAL", "Certidões e ART do responsável técnico conferidas.")
parecer(JUL, FRIO, "FINANCEIRO", "Condição 2% em 10 dias, líquido em 30; preço da preventiva compatível.")
decidir(DG, FRIO, "HOMOLOGADO", "Pareceres favoráveis; responsável técnico com ART.")
conta_banco(DIE, FRIO, "001", "2290", "45120-9", "Frio Polar Climatização Ltda", fmtc(cnpj("90722900")), "E-mail do técnico (endereço já cadastrado) pedindo a troca para o Banco do Brasil, com o comprovante da conta anexado")
conferir_conta(PAU, FRIO, "Liguei para (67) 3000-0701, número do cadastro (não o do e-mail), e o técnico Eduardo confirmou a troca")
avaliar(GES, FRIO, SEM, NOTAS(4, 5, 4, 4, 4))
wo = psql(f"SELECT id FROM work_orders WHERE unit_id={U['CAR']} AND status IN ('ABERTO','EM_EXECUCAO') AND supplier_id IS NULL ORDER BY id LIMIT 1")
if wo:
    h = page(f"/operacoes/chamados/{wo}", OP); ok(post(f"/operacoes/chamados/{wo}", aid_of(h, 'name="supplierId"'), {"id": wo, "supplierId": FRIO}, OP))

print("7) Rascunho incompleto (EduTech), suspensão (Dedetiza MS) e importação com prévia")
EDU = novo(FIN, "PJ", fmtc(cnpj("90823011")), "EduTech Sistemas Escolares Ltda", "EduTech Escolar", "Tecnologia e sistemas (dados pessoais)")
identificacao(FIN, EDU, "EduTech Escolar", "Tecnologia e sistemas (dados pessoais)", ["dados_pessoais", "tecnologia", "substituibilidade"], resp=int(psql("SELECT id FROM users WHERE email='fin@status'")))
contato(FIN, EDU, "Larissa Kato", "COMERCIAL", "larissa@edutech.example", "", "Executiva de contas")
DEDE = novo(OP, "PJ", fmtc(cnpj("91025233")), "Dedetiza MS Controle de Pragas Ltda", "Dedetiza MS", "Controle de pragas")
identificacao(OP, DEDE, "Dedetiza MS", "Controle de pragas", ["saude_seguranca"])
consulta(FIN, DEDE)
contato(OP, DEDE, "Rogério Sá", "PRINCIPAL", "rogerio@dedetizams.example", "(67) 3000-0901", "", True)
cobertura(OP, DEDE, None, "Aplicação trimestral nas quatro unidades", "Segunda empresa licenciada cotada; aplicação só em fins de semana")
for t, v in [(ALTA_DOCS[0], None), (ALTA_DOCS[2], d(90)), ("Licença sanitária e responsável técnico", d(200))]: documento(OP, DEDE, t, v, quem="Dedetiza")
conferir_todos(FIN, DEDE)
enviar(OP, DEDE)
parecer(FIN, DEDE, "DOCUMENTAL", "Licença sanitária e responsável técnico conferidos.")
parecer(JUL, DEDE, "FINANCEIRO", "Sem restrição.")
if psql(f"SELECT criticidade FROM suppliers WHERE id={DEDE}") == "ALTA": parecer(GES, DEDE, "TECNICO", "Produtos com registro na Anvisa.")
decidir(DG, DEDE, "HOMOLOGADO", "Documentos e pareceres em ordem.")
h = page(FICHA(DEDE), DG); ok(post(FICHA(DEDE), aid_of(h, "Suspensão prospectiva"), {"id": DEDE, "motivo": "Aplicação feita em dia letivo sem o aviso prévio às famílias; apuração em andamento"}, DG), "Suspenso")
ocorrencia(GES, DEDE, "SEGURANCA", "ALTA", "Aplicação de produto no refeitório em dia letivo, sem aviso prévio às famílias.", "Apuração pela Direção; nova aplicação só em fim de semana", d(15), d(-2))
hi = page("/operacoes/fornecedores?aba=importar", OP); AIMP = aid_of(hi, 'name="texto"')
lote1 = "\n".join(["documento;razao_social;nome_fantasia;categoria;email;telefone;cidade;uf",
                   f"{fmtc(cnpj('91126344'))};Gráfica Ipê Impressos Ltda;Gráfica Ipê;Papelaria e escritório;vendas@graficaipe.example;(67) 3000-1101;Campo Grande;MS",
                   f"{fmtc(cnpj('91227455'))};Uniformes Pantanal Confecções Ltda;Uniformes Pantanal;Uniformes;contato@uniformespantanal.example;(67) 3000-1201;Campo Grande;MS"])
ok(post("/operacoes/fornecedores?aba=importar", AIMP, {"texto": lote1}, OP), "Prévia pronta")
ok(post("/operacoes/fornecedores?aba=importar", aid_of(page("/operacoes/fornecedores?aba=importar", OP), "Confirmar e importar"), {}, OP), "importado")
lote2 = "\n".join(["documento;razao_social;nome_fantasia;categoria;email;telefone;cidade;uf",
                   f"{fmtc(cnpj('91328566'))};Livraria Saber Mais Ltda;Saber Mais;Material didático e livros;pedidos@sabermais.example;(67) 3000-1301;Campo Grande;MS",
                   f"{fmtc(cnpj('91328566'))[:-1]}{(int(cnpj('91328566')[-1]) + 1) % 10};Papelaria Digitada Errada Ltda;;Papelaria e escritório;;;;",
                   f"{fmtc(cnpj('90217455'))};Limpa Bem Serviços de Conservação Ltda;Limpa Bem;Limpeza e conservação;;;;"])
ok(post("/operacoes/fornecedores?aba=importar", AIMP, {"texto": lote2}, OP), "Prévia pronta")   # fica na prévia (sem confirmar), para a tela do manual

print("8) Portal do fornecedor (Papel & Cia)")
PAPEL = novo(OP, "PJ", fmtc(cnpj("90924122")), "Papel & Cia Papelaria Ltda", "Papel & Cia", "Papelaria e escritório")
identificacao(OP, PAPEL, "Papel & Cia", "Papelaria e escritório")
consulta(FIN, PAPEL)
contato(OP, PAPEL, "Vera Lúcia Couto", "PRINCIPAL", "vera@papelecia.example", "(67) 3000-0801", "Proprietária", True)
contato(OP, PAPEL, "Contas a receber", "FINANCEIRO", "receber@papelecia.example", "(67) 3000-0802")
pagamento(FIN, PAPEL, "BOLETO", 28, "4.2.01")
documento(OP, PAPEL, MEDIA_DOCS[0], None, quem="Papel e Cia"); conferir_todos(FIN, PAPEL)
enviar(OP, PAPEL)
parecer(FIN, PAPEL, "DOCUMENTAL", "Cartão CNPJ conferido; criticidade baixa.")
decidir(DG, PAPEL, "HOMOLOGADO", "Criticidade baixa, documentação conferida.")
h = page(FICHA(PAPEL, "portal"), OP)
loc = ok(post(FICHA(PAPEL, "portal"), aid_of(h, 'name="escopo"'), {"id": PAPEL, "email": "vera@papelecia.example", "dias": "7", "escopo": ["contatos", "banco", "documentos"]}, OP), "Copie o link agora")
TK = re.search(r"convite=([A-Za-z0-9_\-]+)", loc).group(1)
os.makedirs(os.path.dirname(SAIDA_TOKEN), exist_ok=True); open(SAIDA_TOKEN, "w").write(TK)
EXT = mk(); hp = page(f"/fornecedor/{TK}", EXT)
assert "Papel &amp; Cia Papelaria Ltda" in hp or "Papel & Cia Papelaria Ltda" in hp, "o portal deveria abrir para o próprio fornecedor"
loc = post(f"/fornecedor/{TK}", aid_of(hp, "Enviar atualização"), {"token": TK, "cep": "79010-010", "logradouro": "Rua Barão do Rio Branco", "numero": "1290", "complemento": "Loja 2", "bairro": "Centro", "cidade": "Campo Grande", "uf": "MS", "financeiroNome": "Contas a receber", "financeiroEmail": "financeiro@papelecia.example", "financeiroTelefone": "(67) 3000-0803"}, EXT)
assert "ok=cadastro" in loc, loc
loc = post(f"/fornecedor/{TK}", aid_of(hp, "Enviar dados bancários"), {"token": TK, "bancoCodigo": "748", "agencia": "0910", "conta": "33445-6", "tipoConta": "CORRENTE", "titularNome": "Papel & Cia Papelaria Ltda", "titularDoc": fmtc(cnpj("90924122")), "pixTipo": "CNPJ", "pixChave": cnpj("90924122"), "evidencia": "Abrimos conta na cooperativa em novembro"}, EXT)
assert "ok=banco" in loc, loc
loc = post(f"/fornecedor/{TK}", aid_of(hp, "Enviar documento"), {"token": TK, "tipo": MEDIA_DOCS[0], "numero": "", "validade": ""}, EXT, files={"arquivo": pdf("Comprovante atualizado", "Papel e Cia")})
assert "ok=documento" in loc, loc
page(f"/fornecedor/{TK}", EXT)

print("9) Contas a pagar com exceção de fornecedor")
hn = page("/financeiro/contas-a-pagar/nova", FIN); ACP = aid_of(hn, "Salvar conta a pagar"); UFIN = psql("SELECT id FROM users WHERE email='fin@status'")
base = {"contaId": psql("SELECT id FROM chart_accounts WHERE codigo='3.3.03'"), "categoria": "Serviços e terceiros", "tipoDocumento": "Nota fiscal", "emissao": d(-1), "responsavelId": UFIN, "recorrente": "0", "parcelas": "1", "intervalo": "MENSAL", "natureza": "OPERACAO", "boleto": "", "chaveNfe": "", "parcelasJson": ""}
ok(post("/financeiro/contas-a-pagar/nova", ACP, {**base, "unitId": U["CUL"], "supplierId": BRILHO, "numeroDocumento": "NF 3381", "descricao": "Limpeza pós-obra do laboratório — 1ª medição", "valor": "2.400,00", "primeiroVencimento": d(12), "excecaoMotivo": "Contrato-ponte da obra do laboratório (exceção registrada no contrato)"}, FIN), "enviada para aprovação")
ok(post("/financeiro/contas-a-pagar/nova", ACP, {**base, "unitId": U["CAR"], "supplierId": "novo", "fornecedorNovo": "Chaveiro 24 Horas Centro", "cadastrar": "1", "tipoDocumento": "Recibo", "numeroDocumento": "R-118", "descricao": "Troca do miolo da fechadura do portão principal", "valor": "380,00", "primeiroVencimento": d(5), "natureza": "EXTRAORDINARIA", "excecaoMotivo": "Portão principal sem trava às 18h; único chaveiro disponível no horário"}, FIN), "enviada para aprovação")

print("10) Rotina diária (vencimentos de fornecedores) e marca da demonstração")
tok = [l.split("=", 1)[1].strip().strip('"').strip("'") for l in open("/home/claude/rh/.env") if l.startswith("SETUP_TOKEN=")][0]
r = mk().get(B + f"/api/tarefas?token={tok}", timeout=600).json(); print("   rotina v33:", r.get("v33"))
psql("INSERT INTO settings (key, value) VALUES ('demo_v33', jsonb_build_object('em', now()::text)) ON CONFLICT (key) DO NOTHING")
print("Demonstração da v33 carregada:", psql("SELECT string_agg(status || ' ' || n, ' · ' ORDER BY status) FROM (SELECT status, count(*) AS n FROM suppliers GROUP BY status) x"))
