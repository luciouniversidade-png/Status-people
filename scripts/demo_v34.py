"""Dados de DEMONSTRAÇÃO da v34 — NUNCA rode em produção. Tudo fictício: pessoas "Demo Colaborador", CPFs inventados da faixa 9x
(gerados só para casar as páginas do PDF de demonstração), PDFs e fotos gerados aqui, nenhum documento real.
Roda com o servidor no ar, na base de treinamento da v33 (já atualizada para a v34). Quase tudo pela própria interface:
  1. assinatura eletrônica: política para a unidade Carandá (assinaturas, recusa respondida), aditivo para três pessoas;
  2. espelho do ponto de outubro liberado para assinatura (assinados, uma contestação aberta, o da Colaboradora Teste aguardando);
  3. folha por pessoa: holerites de outubro divididos e publicados; recibos de férias em prévia (continuação e página sem dono);
  4. cadastro: alteração de endereço e estado civil aguardando o RH; dependente aprovado; ficha de admissão enviada pelo link;
  5. autoatendimento: ajustes de ponto (aprovado e lançado; aguardando a gestora), atestados (aguardando e aceito), férias com
     abono e 13º, Fale com o RH, evolução salarial e parabéns;
  6. pesquisas internas (anônima com resultado e identificada aberta) e 10 semanas de termômetro de humor (só contadores);
  7. escalas: Portaria e Limpeza do Carandá (semana atual publicada, próxima em rascunho com alertas) e a equipe de apoio;
  8. estoque: almoxarifados e cozinha, itens com validade, EPI ligado, entradas, saídas, transferência, inventário e entrega com termo;
  9. reações nos comunicados.
Uso: python3 scripts/demo_v34.py   (servidor local em http://localhost:3100, banco local via psql)."""
import os, io, re, subprocess, json, random, requests
from datetime import datetime, timedelta, date
from zoneinfo import ZoneInfo
from reportlab.pdfgen import canvas
from PIL import Image, ImageDraw
B = os.environ.get("APP", "http://localhost:3100"); MAN = "/home/claude/trabalho/manual"
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
def page(path, sess): return re.sub(r"<script[^>]*>.*?</script>", "", sess.get(B + path).text, flags=re.S).replace("\xa0", " ").replace("&quot;", '"').replace("&amp;", "&")
# navegadores e IPs FICTÍCIOS nas evidências da assinatura (faixa 203.0.113.0/24, reservada para documentação — RFC 5737)
NAVEGADORES = ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1",
               "Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
               "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"]
def login(email, senha):
    s = mk(); k = sum(map(ord, email)); s.headers.update({"User-Agent": NAVEGADORES[k % 3], "X-Real-IP": f"203.0.113.{10 + k % 240}"}); html = s.get(B + "/login").text; aid = re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', html)[0]
    loc = post("/login", aid, {"email": email, "senha": senha}, s, show=False); assert loc.endswith("/"), (email, loc); return s
def ok(loc, trecho=""): assert "ok=" in loc and trecho in loc, loc; return loc
def q(v): return "NULL" if v is None else str(v) if isinstance(v, (int, float)) else "'" + str(v).replace("'", "''") + "'"
HOJE = datetime.now(ZoneInfo("America/Campo_Grande")).date(); H = HOJE.isoformat(); d = lambda n: (HOJE + timedelta(days=n)).isoformat()
def cpf(base9):
    n = [int(c) for c in base9]
    d1 = (sum(a * b for a, b in zip(n, range(10, 1, -1))) * 10) % 11 % 10; d2 = (sum(a * b for a, b in zip(n + [d1], range(11, 1, -1))) * 10) % 11 % 10; return "".join(map(str, n + [d1, d2]))
def fcpf(c): return f"{c[:3]}.{c[3:6]}.{c[6:9]}-{c[9:]}"
def pdf_paginas(textos):
    buf = io.BytesIO(); c = canvas.Canvas(buf)
    for linhas in textos:
        c.setFont("Helvetica-Bold", 12); c.drawString(60, 800, linhas[0]); c.setFont("Helvetica", 10); y = 776
        for l in linhas[1:]: c.drawString(60, y, l); y -= 16
        c.setFont("Helvetica-Oblique", 8); c.drawString(60, 40, "Documento ficticio de demonstracao do STATUS ONE - sem validade."); c.showPage()
    c.save(); return buf.getvalue()
def foto(titulo, linhas, nome):
    im = Image.new("RGB", (900, 620), (250, 250, 246)); g = ImageDraw.Draw(im)
    g.rectangle((20, 20, 880, 600), outline=(120, 130, 150), width=3); g.text((50, 50), titulo, fill=(20, 40, 80))
    for i, l in enumerate(linhas): g.text((50, 110 + 34 * i), l, fill=(40, 40, 40))
    g.text((50, 560), "DOCUMENTO FICTICIO DE DEMONSTRACAO", fill=(180, 40, 40))
    b = io.BytesIO(); im.save(b, "JPEG", quality=80); return (nome, b.getvalue(), "image/jpeg")
M_ANT = (HOJE.replace(day=1) - timedelta(days=1)).strftime("%Y-%m")

if psql("SELECT 1 FROM settings WHERE key='demo_v34'"): raise SystemExit("A demonstração da v34 já foi carregada nesta base.")
assert float(psql("SELECT value->>'versao' FROM settings WHERE key='banco'")) >= 34, "a base ainda não foi atualizada para a v34 (suba o servidor primeiro)"
print("Pessoas fictícias da demonstração (logins de treinamento)")
RH = login("rh@colegiostatus", "Status2026!"); DIR = login("dir@geral", "senha12345"); GES = login("gestor.caranda", "Homolog2026!")
COL = login("colaborador.caranda", "Homolog2026!"); OPE = login("operacoes.teste", "Homolog2026!"); DU = login("du@caranda", "senha12345")
CAR, CUL = 1, 4; ECOL = 128; EGES = int(psql("SELECT employee_id FROM users WHERE email='gestor.caranda'"))
DEMOS = [tuple(x.split("|")) for x in psql("SELECT u.email, e.id FROM users u JOIN employees e ON e.id=u.employee_id WHERE u.ativo AND u.role='COLABORADOR' AND e.unit_id=1 AND u.email LIKE 'demo%' ORDER BY e.id LIMIT 12").splitlines()]
SD = {email: login(email, "senha12345") for email, _ in DEMOS[:8]}
EID = {email: int(e) for email, e in DEMOS}
NOME = lambda e: psql(f"SELECT nome FROM employees WHERE id={e}")
# CPFs fictícios (faixa 9x) só para casar as páginas do PDF de demonstração da folha
for i, (email, e) in enumerate(DEMOS + [("colaborador.caranda", str(ECOL)), ("gestor.caranda", str(EGES))]):
    psql(f"UPDATE employees SET cpf='{cpf(f'9{34:02d}{500 + i:03d}{i:03d}'[:9])}' WHERE id={e} AND (cpf IS NULL OR cpf='')")

print("1 · Assinatura eletrônica")
h = page("/documentos/assinaturas", RH); AENV = aid_of(h, "Enviar para assinatura")
POL = pdf_paginas([["Politica de uso do celular em sala - 2027", "Colegio Status - todas as unidades (texto ficticio de demonstracao)", "", "1. Objetivo: preservar a atencao das aulas e a privacidade de alunos e colegas.", "2. Em sala, o celular fica guardado, salvo uso pedagogico combinado com a coordenacao.", "3. Fotos e videos de alunos so com a autorizacao de imagem da familia (LGPD).", "4. Em caso de emergencia, a secretaria da unidade e o canal oficial."],
                   ["5. Descumprimento: conversa com a coordenacao e registro.", "6. Vigencia: ano letivo de 2027.", "", "Declaro que li e compreendi a politica."]])
loc = ok(post("/documentos/assinaturas", AENV, {"titulo": "Política de uso do celular em sala — 2027", "tipo": "POLITICA", "prazo": d(6), "modo": "UNIDADE", "unitId": CAR, "descricao": "Leia com atenção: vale para todas as turmas a partir de fevereiro."}, RH, {"arquivo": ("politica-celular-2027.pdf", POL, "application/pdf")}))
DOCPOL = int(re.search(r"/assinaturas/(\d+)", loc).group(1))
def assina(sess, rid, senha):
    hs = page(f"/eu/assinaturas/{rid}", sess); return post(f"/eu/assinaturas/{rid}", aid_of(hs, "Sua senha do ONE"), {"requestId": rid, "li": "1", "senha": senha}, sess)
def pedido(doc, e): return int(psql(f"SELECT id FROM sign_requests WHERE document_id={doc} AND employee_id={e}"))
for email in list(SD)[:6]: ok(assina(SD[email], pedido(DOCPOL, EID[email]), "senha12345"), "assinado")
ok(assina(COL, pedido(DOCPOL, ECOL), "Homolog2026!"), "assinado")
e7 = list(SD)[6]; hs = page(f"/eu/assinaturas/{pedido(DOCPOL, EID[e7])}", SD[e7])
ok(post(f"/eu/assinaturas/{pedido(DOCPOL, EID[e7])}", aid_of(hs, "Recusar"), {"requestId": pedido(DOCPOL, EID[e7]), "motivo": "Uso o celular para a chamada digital da turma: preciso de uma exceção."}, SD[e7]))
hd = page(f"/documentos/assinaturas/{DOCPOL}", RH)
ok(post(f"/documentos/assinaturas/{DOCPOL}", aid_of(hd, 'name="resolucao"'), {"requestId": pedido(DOCPOL, EID[e7]), "resolucao": "A chamada digital é uso pedagógico combinado com a coordenação: está previsto no item 2. Pode assinar.", "acao": "MANTER"}, RH))
ADT = pdf_paginas([["Aditivo ao contrato de trabalho - formacao continuada (ficticio)", "As partes ajustam a participacao em 8 horas mensais de formacao,", "computadas na jornada, aos sabados, conforme calendario da unidade."]])
loc = ok(post("/documentos/assinaturas", AENV, {"titulo": "Aditivo — formação continuada aos sábados", "tipo": "CONTRATO", "prazo": d(3), "modo": "PESSOAS", "pessoas": [EID[x] for x in list(SD)[:3]]}, RH, {"arquivo": ("aditivo-formacao.pdf", ADT, "application/pdf")}))
DOCADT = int(re.search(r"/assinaturas/(\d+)", loc).group(1)); ok(assina(SD[list(SD)[0]], pedido(DOCADT, EID[list(SD)[0]]), "senha12345"))

print("2 · Espelho do ponto de " + M_ANT)
# as pessoas fictícias de demonstração recebem o mesmo mês de marcações da Colaboradora Teste (para terem espelho a assinar)
for k, email in enumerate(list(SD)[:6]):
    psql(f"INSERT INTO timesheet_days (employee_id, data, esperado_min, trabalhado_min, status, marcacoes, obs, origem, updated_at) SELECT {EID[email]}, data, esperado_min, trabalhado_min, status, marcacoes, obs, origem, now() FROM timesheet_days t WHERE t.employee_id={ECOL} AND to_char(t.data, 'YYYY-MM')='{M_ANT}' AND NOT EXISTS (SELECT 1 FROM timesheet_days x WHERE x.employee_id={EID[email]} AND x.data=t.data)")
psql(f"INSERT INTO timesheet_locks (unit_id, mes, status, fechado_por_nome, fechado_em) VALUES ({CAR}, '{M_ANT}', 'FECHADO', 'RH Colégio Status', now() - interval '2 days') ON CONFLICT (unit_id, mes) DO UPDATE SET status='FECHADO', fechado_por_nome=EXCLUDED.fechado_por_nome, fechado_em=EXCLUDED.fechado_em")
hp = page(f"/ponto?mes={M_ANT}", RH); ok(post(f"/ponto?mes={M_ANT}", aid_of(hp, "Liberar espelhos para assinatura"), {"unitId": CAR, "mes": M_ANT, "voltar": f"/ponto?mes={M_ANT}"}, RH), "liberado")
esp = lambda e: int(psql(f"SELECT r.id FROM sign_requests r JOIN sign_documents d ON d.id=r.document_id WHERE d.tipo='ESPELHO' AND d.competencia='{M_ANT}' AND r.employee_id={e} ORDER BY r.id DESC LIMIT 1") or 0)
for email in list(SD)[:5]:
    if esp(EID[email]): ok(assina(SD[email], esp(EID[email]), "senha12345"))
e6 = list(SD)[5]
if esp(EID[e6]):
    hs = page(f"/eu/assinaturas/{esp(EID[e6])}", SD[e6]); ok(post(f"/eu/assinaturas/{esp(EID[e6])}", aid_of(hs, "Contestar"), {"requestId": esp(EID[e6]), "motivo": "No dia 14 saí às 17:30 (reunião de pais), não às 16:30. Peço a correção da saída."}, SD[e6]))

print("3 · Folha por pessoa")
pessoas = [(ECOL, NOME(ECOL))] + [(EID[x], NOME(EID[x])) for x in list(EID)[:9]]
cpfs = {e: psql(f"SELECT cpf FROM employees WHERE id={e}") for e, _ in pessoas}
pags = []
for i, (e, n) in enumerate(pessoas):
    pags.append([f"Recibo de pagamento de salario - competencia {M_ANT[5:]}/{M_ANT[:4]}", "Empregador: Colegio Status (dados ficticios de demonstracao)", f"Nome: {n}", f"CPF: {fcpf(cpfs[e]) if i % 2 == 0 else cpfs[e]}", "Salario base ......... 3.200,00", "INSS ................... 268,00", "Liquido ............. 2.932,00"])
    if i == 2: pags.append(["(continuacao) Detalhamento de horas e adicionais", "Horas extras 50% ..... 2h00", "Adicional noturno ..... 0h00"])
h = page("/folha/dividir", RH); AP = aid_of(h, "Ler o PDF")
loc = ok(post("/folha/dividir", AP, {"tipo": "HOLERITES", "competencia": M_ANT, "companyId": 1}, RH, {"arquivo": (f"holerites-{M_ANT}.pdf", pdf_paginas(pags), "application/pdf")}))
SPH = int(re.search(r"/dividir/(\d+)", loc).group(1)); hv = page(f"/folha/dividir/{SPH}", RH)
ok(post(f"/folha/dividir/{SPH}", aid_of(hv, "documento(s) no Meu espaço"), {"id": SPH, "conferi": "1"}, RH), "publicados")
for email in list(SD)[:4]:
    a = psql(f"SELECT attachment_id FROM payroll_docs WHERE split_id={SPH} AND employee_id={EID[email]}")
    if a: SD[email].get(B + f"/api/anexos/{a}")
fer = [[f"Aviso e recibo de ferias (ficticio) - {M_ANT}", f"Nome: {pessoas[1][1]}", f"CPF: {fcpf(cpfs[pessoas[1][0]])}", "Periodo de gozo: 20 dias + 10 dias de abono"], ["(continuacao) Calculo: ferias + 1/3 + abono pecuniario"], ["Aviso e recibo de ferias (ficticio)", "Nome: Pessoa que nao esta na equipe", "CPF: 934.999.111-00"], [f"Aviso e recibo de ferias (ficticio) - {M_ANT}", f"Nome: {pessoas[3][1].upper()}", "Periodo de gozo: 15 dias"]]
ok(post("/folha/dividir", AP, {"tipo": "RECIBO_FERIAS", "competencia": M_ANT, "companyId": 1}, RH, {"arquivo": (f"ferias-{M_ANT}.pdf", pdf_paginas(fer), "application/pdf")}))

print("4 · Cadastro, dependentes e ficha pelo link")
hd = page("/eu/dados", COL)
ok(post("/eu/dados", aid_of(hd, "Enviar ao RH"), {"cep": "79002-110", "logradouro": "Rua das Paineiras (fictícia)", "numero": "450", "complemento": "apto 12", "bairro": "Jardim dos Estados", "cidade": "Campo Grande", "uf": "MS", "estado_civil": "CASADO", "doc0Tipo": "Comprovante de residência", "doc1Tipo": "Certidão (estado civil)", "obs": "Mudei em outubro e me casei em setembro."}, COL,
   {"doc0": foto("CONTA DE LUZ (FICTICIA)", ["Cliente: Colaborador Teste", "Rua das Paineiras, 450 - apto 12", "Referencia: outubro"], "conta-luz.jpg"), "doc1": foto("CERTIDAO DE CASAMENTO (FICTICIA)", ["Registro civil - demonstracao"], "certidao.jpg")}), "CAD-")
e1 = list(SD)[1]; hd1 = page("/eu/dados", SD[e1])
ok(post("/eu/dados", aid_of(hd1, "dep0Nome"), {"dep0Nome": "Miguel Demo (fictício)", "dep0Parentesco": "FILHO", "dep0Nascimento": "2019-08-21", "dep0Irrf": "1", "dep0Sf": "1", "doc0Tipo": "Certidão de nascimento"}, SD[e1], {"doc0": foto("CERTIDAO DE NASCIMENTO (FICTICIA)", ["Miguel Demo"], "certidao-nascimento.jpg")}), "DEP-")
PD = int(psql(f"SELECT max(id) FROM employee_change_requests WHERE employee_id={EID[e1]} AND tipo='DEPENDENTE'")); hr = page(f"/colaboradores/alteracoes/{PD}", RH)
ok(post(f"/colaboradores/alteracoes/{PD}", aid_of(hr, "Aplicar decisão"), {"id": PD, "d_0": "APROVADO"}, RH))
ENOVA = int(psql(f"INSERT INTO employees (nome, unit_id, vinculo, admissao, situacao, sexo, company_id, jornada_min_dia) VALUES ('Nina Prado (fictícia)', {CAR}, 'CLT', '{d(10)}', 'EM_ADMISSAO', 'F', 1, 480) RETURNING id"))
hf = page(f"/colaboradores/{ENOVA}", RH); loc = post(f"/colaboradores/{ENOVA}", aid_of(hf, "Gerar link"), {"employeeId": ENOVA}, RH)
TOKADM = re.search(r"convite=([A-Za-z0-9_-]+)", loc).group(1); open(os.path.join(MAN, "token_admissao.txt"), "w").write(TOKADM)
pub = mk(); hp = page(f"/admissao/{TOKADM}", pub); aadm = aid_of(hp, "Enviar ao RH")
campos = [("token", TOKADM), ("aceite", "1"), ("data_nascimento", "1996-04-12"), ("sexo", "F"), ("estado_civil", "SOLTEIRO"), ("raca_cor", "NAO_INFORMADO"), ("escolaridade", "SUP"), ("nacionalidade", "Brasileira"), ("naturalidade", "Campo Grande/MS"), ("rg", "0012345"), ("rg_orgao", "SSP/MS"), ("pis", "12312312312"),
          ("cep", "79010-200"), ("logradouro", "Avenida Fictícia"), ("numero", "1000"), ("bairro", "Centro"), ("cidade", "Campo Grande"), ("uf", "MS"), ("telefone", "(67) 90000-0000"), ("email", "nina.prado@exemplo.com"), ("contato_emergencia", "Mãe — (67) 90000-0001"),
          ("banco_codigo", "Banco Fictício 000"), ("banco_agencia", "0001"), ("banco_conta", "00012-3"), ("banco_tipo", "SALARIO"), ("vale_transporte", "SIM"), ("vt_obs", "Linha 080 ida e volta"), ("doc0Tipo", "Documento com foto (RG ou CNH)"), ("doc1Tipo", "Comprovante de residência")]
r = pub.post(B + f"/admissao/{TOKADM}", files=[(f"$ACTION_ID_{aadm}", (None, ""))] + [(k, (None, v)) for k, v in campos] + [("doc0", foto("RG (FICTICIO)", ["Nina Prado"], "rg.jpg")), ("doc1", foto("CONTA DE AGUA (FICTICIA)", ["Avenida Ficticia, 1000"], "agua.jpg"))], allow_redirects=False)
print("    ficha pelo link →", requests.utils.unquote(r.headers.get("location", ""))[:120])

print("5 · Ajuste de ponto, atestados, férias com abono, Fale com o RH, evolução salarial e parabéns")
dias_uteis = [d(-k) for k in range(1, 12) if (HOJE - timedelta(days=k)).isoweekday() < 6]
hm = page("/eu", COL); AAJ = aid_of(hm, 'name="marcacoes"'); AAT = aid_of(hm, 'name="horas"')
ok(post("/eu", AAJ, {"data": dias_uteis[3], "tipo": "ESQUECIMENTO", "marcacoes": "07:28 11:31 13:02 17:20", "motivo": "Esqueci de marcar a volta do almoço (estava na reunião de pais)."}, COL))
ok(post("/eu", AAJ, {"data": dias_uteis[1], "tipo": "EXTERNO", "marcacoes": "07:30 12:00 13:00 16:48", "motivo": "Acompanhei a turma na visita ao museu (saída de campo)."}, COL))
AJ1 = int(psql(f"SELECT id FROM timesheet_adjust_requests WHERE employee_id={ECOL} AND data='{dias_uteis[3]}'")); hg = page("/ponto/ajustes", GES)
ok(post("/ponto/ajustes", aid_of(hg, f'name="id" value="{AJ1}"'), {"id": AJ1, "decisao": "APROVAR", "resposta": "Confirmo: estava comigo na reunião."}, GES))
hl = page("/ponto/ajustes?aba=lancar", RH); ok(post("/ponto/ajustes", aid_of(hl, "Lançar no espelho do ONE"), {"id": AJ1}, RH))
AJ2 = int(psql(f"SELECT id FROM timesheet_adjust_requests WHERE employee_id={ECOL} AND data='{dias_uteis[1]}'")); hg = page("/ponto/ajustes", GES)
ok(post("/ponto/ajustes", aid_of(hg, f'name="id" value="{AJ2}"'), {"id": AJ2, "decisao": "APROVAR", "resposta": "Saída de campo autorizada pela coordenação."}, GES))  # aprovado, ainda sem lançar: aparece em "Para lançar (RH)"
e2, e4 = list(SD)[2], list(SD)[4]; psql(f"UPDATE employees SET gestor_id={EGES} WHERE id IN ({EID[e2]}, {EID[e4]})")  # equipe da gestora de demonstração
hm4 = page("/eu", SD[e4]); ok(post("/eu", aid_of(hm4, 'name="marcacoes"'), {"data": dias_uteis[2], "tipo": "ESQUECIMENTO", "marcacoes": "07:00 11:00 12:00 16:00", "motivo": "Esqueci de marcar a entrada: cheguei junto com a van da manhã."}, SD[e4]))
hm2 = page("/eu", SD[e2]); ok(post("/eu", aid_of(hm2, 'name="marcacoes"'), {"data": dias_uteis[0], "tipo": "RELOGIO", "marcacoes": "06:58 11:00 12:30 15:18", "motivo": "O relógio da portaria ficou sem energia de manhã."}, SD[e2]))
ok(post("/eu", AAT, {"tipo": "DIAS", "inicio": dias_uteis[2], "fim": dias_uteis[2], "obs": "Consulta e repouso de 1 dia."}, COL, {"arquivo": foto("ATESTADO MEDICO (FICTICIO)", ["Atesto para os devidos fins que o(a) paciente", "necessita de 1 (um) dia de repouso.", "Dr(a). Demonstracao - CRM 00000/MS"], "atestado.jpg")}), "Atestado enviado")
e3 = list(SD)[3]; hm3 = page("/eu", SD[e3]); ok(post("/eu", aid_of(hm3, 'name="horas"'), {"tipo": "HORAS", "inicio": dias_uteis[4], "horas": "08:00 às 10:30", "obs": "Exame de rotina."}, SD[e3], {"arquivo": foto("DECLARACAO DE COMPARECIMENTO (FICTICIA)", ["Compareceu das 08:00 as 10:30"], "declaracao.jpg")}))
MC3 = int(psql(f"SELECT max(id) FROM medical_certificates WHERE employee_id={EID[e3]}")); ha = page("/ponto/atestados", RH)
ok(post("/ponto/atestados", aid_of(ha, f'name="id" value="{MC3}"'), {"id": MC3, "decisao": "ACEITAR", "resposta": "Recebido, obrigado."}, RH))
for quem, sf, ef in [("colaborador.caranda", COL, ECOL)] + [(x, SD[x], EID[x]) for x in SD]:  # o primeiro com 30 dias de saldo no período
    hf = page("/eu", sf); r = post("/eu", aid_of(hf, 'name="abonoDias"'), {"employeeId": ef, "tipo": "FERIAS", "inicio": d(50), "fim": d(69), "abonoDias": 10, "adiantar13": "1", "voltar": "/eu", "justificativa": "Férias de janeiro com a família."}, sf, show=False)
    if "ok=" in r: print("    férias 20 + 10 vendidos + 13º junto →", quem); break
FR = int(psql("SELECT id FROM request_types WHERE codigo='FALE_RH'")); hn = page(f"/solicitacoes/nova?tipo={FR}", COL)
post(f"/solicitacoes/nova?tipo={FR}", aid_of(hn, 'name="campo_assunto"'), {"typeId": FR, "titulo": "Dúvida sobre o vale-transporte", "campo_assunto": "Benefícios", "campo_mensagem": "Mudei de endereço: o vale-transporte muda a partir de quando?"}, COL)
psql(f"INSERT INTO salary_history (employee_id, data, salario_anterior, salario, motivo, obs) VALUES ({ECOL}, '2025-05-01', 3600, 3780, 'DISSIDIO', 'Demonstração'), ({ECOL}, '2026-02-01', 3780, 3950, 'DISSIDIO', 'Demonstração'), ({ECOL}, '2026-08-01', 3950, 4180, 'MERITO', 'Demonstração')")
EANIV = EID[list(EID)[8]]; psql(f"UPDATE employees SET data_nascimento = make_date(1991, extract(month FROM date '{H}')::int, extract(day FROM date '{H}')::int) WHERE id={EANIV}")
hm = page("/eu", COL); ok(post("/eu", aid_of(hm, f'name="employeeId" value="{EANIV}"'), {"employeeId": EANIV, "voltar": "/eu", "mensagem": "Feliz aniversário! Que o ano seja leve e cheio de conquistas. 🎂"}, COL))
for email in list(SD)[:3]:
    hx = page("/eu", SD[email])
    if f'name="employeeId" value="{EANIV}"' in hx: post("/eu", aid_of(hx, f'name="employeeId" value="{EANIV}"'), {"employeeId": EANIV, "voltar": "/eu", "mensagem": "Parabéns! 🎉"}, SD[email], show=False)

print("6 · Pesquisas internas e termômetro de humor")
h = page("/clima/pesquisas", RH); APQ = aid_of(h, "Salvar rascunho")
loc = ok(post("/clima/pesquisas", APQ, {"titulo": "Formação continuada 2027 — o que você precisa?", "descricao": "Anônima: ajude a montar o plano de formação do ano que vem.", "perguntas": "ESCALA | As formações deste ano ajudaram no meu trabalho em sala.\nESCALA | Tenho tempo na jornada para aplicar o que aprendo.\nUNICA | Melhor horário para a formação | Sábado de manhã; Contraturno na semana; On-line, no meu ritmo\nMULTIPLA | Temas que você quer em 2027 | Avaliação e recuperação; Inclusão e neurodiversidade; Tecnologia em sala; Gestão de conflitos; Alfabetização\nTEXTO | O que podemos melhorar?", "inicio": d(-9), "fim": d(5), "publico": "TODOS", "minimo": 5}, RH))
PQ = int(re.search(r"/pesquisas/(\d+)", loc).group(1)); ok(post(f"/clima/pesquisas/{PQ}", aid_of(page(f"/clima/pesquisas/{PQ}", RH), "Abrir e avisar o público"), {"id": PQ, "acao": "ABRIR"}, RH))
random.seed(34); temas = ["Avaliação e recuperação", "Inclusão e neurodiversidade", "Tecnologia em sala", "Gestão de conflitos", "Alfabetização"]
coment = ["Mais exemplos práticos de sala, menos teoria.", "Formação no sábado cansa: prefiro no contraturno.", "Gostaria de trocar experiências entre as unidades.", "Precisamos de apoio para os alunos com laudo.", "Tempo para planejar depois da formação."]
resp_users = [x for x in psql("SELECT u.id || ':' || e.unit_id FROM users u JOIN employees e ON e.id=u.employee_id WHERE u.ativo AND u.role='COLABORADOR' AND u.email LIKE 'demo%' ORDER BY u.id LIMIT 31").splitlines()]
for k, x in enumerate(resp_users):
    uid, un = x.split(":"); r = {"q1": random.choice([3, 4, 4, 5, 5, 2]), "q2": random.choice([2, 3, 3, 4, 2]), "q3": random.choice(["Sábado de manhã", "Contraturno na semana", "Contraturno na semana", "On-line, no meu ritmo"]), "q4": random.sample(temas, random.choice([1, 2, 3]))}
    if k % 4 == 0: r["q5"] = coment[(k // 4) % len(coment)]
    psql(f"INSERT INTO custom_survey_marks (survey_id, user_id) VALUES ({PQ}, {uid}) ON CONFLICT DO NOTHING"); psql(f"INSERT INTO custom_survey_responses (survey_id, unit_id, respostas) VALUES ({PQ}, {un}, {q(json.dumps(r, ensure_ascii=False))}::jsonb)")
loc = ok(post("/clima/pesquisas", APQ, {"titulo": "Confraternização de fim de ano — presença (identificada)", "perguntas": "UNICA | Você vai à confraternização de 12/12? | Sim; Não; Ainda não sei\nUNICA | Restrição alimentar? * | Nenhuma; Vegetariana; Sem glúten; Sem lactose; Outra\nTEXTO | Observação para a organização", "inicio": H, "fim": d(12), "publico": "UNIDADE", "unitId": CAR, "minimo": 5, "identificada": "1"}, RH))
PQ2 = int(re.search(r"/pesquisas/(\d+)", loc).group(1)); ok(post(f"/clima/pesquisas/{PQ2}", aid_of(page(f"/clima/pesquisas/{PQ2}", RH), "Abrir e avisar o público"), {"id": PQ2, "acao": "ABRIR"}, RH))
for email in list(SD)[:5]: ok(post(f"/eu/pesquisas/{PQ2}", aid_of(page(f"/eu/pesquisas/{PQ2}", SD[email]), "Enviar respostas"), {"id": PQ2, "q1": random.choice(["Sim", "Sim", "Não", "Ainda não sei"]), "q2": random.choice(["Nenhuma", "Vegetariana", "Nenhuma"])}, SD[email], show=False))
# termômetro: 10 semanas de contadores por unidade e liderança (nunca respostas individuais)
gestores = {int(r.split("|")[0]): int(r.split("|")[1]) for r in psql("SELECT e.unit_id, coalesce(min(e.gestor_id),0) FROM employees e WHERE e.situacao='ATIVO' AND e.gestor_id IS NOT NULL GROUP BY 1").splitlines()}
seg = HOJE - timedelta(days=HOJE.weekday())
for w in range(1, 11):
    sem = (seg - timedelta(days=7 * w)).isoformat()
    for un, base in [(1, 3.9), (2, 3.6), (3, 3.3), (4, 3.8)]:
        tendencia = base - (0.6 if (un == 3 and w <= 2) else 0) + (0.1 if w % 3 == 0 else 0)
        for g, n in [(gestores.get(un, 0), random.randint(6, 10)), (0, random.randint(3, 7))]:
            for _ in range(n):
                nota = max(1, min(5, round(random.gauss(tendencia, 0.9)))); psql(f"INSERT INTO mood_counts (semana, unit_id, gestor_id, nota, n) VALUES ('{sem}', {un}, {g}, {nota}, 1) ON CONFLICT (semana, unit_id, gestor_id, nota) DO UPDATE SET n = mood_counts.n + 1")
                if nota <= 2: psql(f"INSERT INTO mood_factor_counts (semana, unit_id, gestor_id, nota, fator, n) VALUES ('{sem}', {un}, {g}, {nota}, {q(random.choice(['Carga de trabalho', 'Prazos', 'Carga de trabalho', 'Estrutura e recursos', 'Relação com colegas']))}, 1) ON CONFLICT (semana, unit_id, gestor_id, nota, fator) DO UPDATE SET n = mood_factor_counts.n + 1")
for email in list(SD)[:4]:
    hx = page("/eu", SD[email])
    if 'name="nota"' in hx: post("/eu", aid_of(hx, 'name="nota"'), {"voltar": "/eu", "nota": random.choice([3, 4, 5]), "fatores": ["Clima da equipe"]}, SD[email], show=False)

print("7 · Escalas")
T = {r.split("|")[0]: int(r.split("|")[1]) for r in psql("SELECT sigla || '|' || id FROM shift_types").splitlines()}
he = page("/ponto/escalas?aba=equipes", RH); AEQ = aid_of(he, "Salvar equipe")
port = [EID[x] for x in list(EID)[4:8]]; limp = [EID[x] for x in list(EID)[8:12]]
# cargos de apoio para quem entra nas equipes (a base de treinamento só tinha professores nessas fichas de demonstração)
PPORT = psql("SELECT id FROM positions WHERE nome='Porteiro(a)'") or psql("INSERT INTO positions (nome, area, parent_id, regulamentado, ordem, grade_id, pontos, avaliacao, descricao, requisitos, familia, formacao_exigida, documento_formacao, aso_meses, epis, acesso) SELECT 'Porteiro(a)', area, parent_id, regulamentado, ordem, grade_id, pontos, avaliacao, 'Controle de acesso, portaria e ronda (cargo de demonstração).', requisitos, familia, formacao_exigida, documento_formacao, aso_meses, epis, acesso FROM positions WHERE nome='Zelador de Edifício' RETURNING id")
PSG = psql("SELECT id FROM positions WHERE nome='Auxiliar de Serviços Gerais'")
psql(f"UPDATE employees SET position_id={PPORT} WHERE id IN ({','.join(map(str, port))})"); psql(f"UPDATE employees SET position_id={PSG} WHERE id IN ({','.join(map(str, limp))})")
post("/ponto/escalas", AEQ, {"nome": "Portaria Carandá", "unitId": CAR, "responsavelUserId": psql("SELECT id FROM users WHERE email='operacoes.teste'"), "membros": port, "cobTurno": [T["M"], T["T"], T["N"]], "cobMin": [1, 1, 1]}, RH)
post("/ponto/escalas", AEQ, {"nome": "Limpeza e apoio Carandá", "unitId": CAR, "responsavelUserId": "", "membros": limp, "cobTurno": [T["C"]], "cobMin": [2], "coberturaDias": "SEG_SEX"}, RH)
TP = int(psql("SELECT id FROM shift_teams WHERE nome='Portaria Carandá'")); TL = int(psql("SELECT id FROM shift_teams WHERE nome='Limpeza e apoio Carandá'"))
S0 = (HOJE - timedelta(days=HOJE.weekday())).isoformat(); S1 = (date.fromisoformat(S0) + timedelta(days=7)).isoformat()
def grade(team, semana, sess, cells, motivo=None):
    hg = page(f"/ponto/escalas?equipe={team}&semana={semana}", sess); dados = {"teamId": team, "semana": semana, **cells}
    if motivo: dados["motivo"] = motivo
    return post(f"/ponto/escalas?equipe={team}&semana={semana}", aid_of(hg, "Salvar escala"), dados, sess)
dias0 = [(date.fromisoformat(S0) + timedelta(days=i)).isoformat() for i in range(7)]; dias1 = [(date.fromisoformat(S1) + timedelta(days=i)).isoformat() for i in range(7)]
c0 = {}
for i, x in enumerate(dias0):
    c0[f"c_{port[0]}_{x}"] = T["M"] if i < 5 else "F"; c0[f"c_{port[1]}_{x}"] = T["T"] if i < 5 else "F"
    c0[f"c_{port[2]}_{x}"] = T["N"] if i % 2 == 0 else "F"; c0[f"c_{port[3]}_{x}"] = T["N"] if i % 2 == 1 else "F"
ok(grade(TP, S0, OPE, c0)); hg = page(f"/ponto/escalas?equipe={TP}&semana={S0}", OPE); ok(post(f"/ponto/escalas?equipe={TP}&semana={S0}", aid_of(hg, "Publicar e avisar a equipe"), {"teamId": TP, "semana": S0}, OPE))
c1 = {}
for i, x in enumerate(dias1):
    c1[f"c_{port[0]}_{x}"] = T["M"] if i < 5 else "F"; c1[f"c_{port[1]}_{x}"] = T["T"] if i not in (5,) else "F"
    c1[f"c_{port[2]}_{x}"] = T["N"] if i % 2 == 0 else "F"; c1[f"c_{port[3]}_{x}"] = T["M"] if i == 1 else (T["N"] if i % 2 == 1 else "F")
c1[f"c_{port[2]}_{dias1[1]}"] = T["M"]
ok(grade(TP, S1, OPE, c1))
cl = {}
for i, x in enumerate(dias0):
    for k, e in enumerate(limp): cl[f"c_{e}_{x}"] = T["C"] if (i < 5 and not (k == 2 and i == 2)) else "F"
ok(grade(TL, S0, RH, cl)); hg = page(f"/ponto/escalas?equipe={TL}&semana={S0}", RH); ok(post(f"/ponto/escalas?equipe={TL}&semana={S0}", aid_of(hg, "Publicar e avisar a equipe"), {"teamId": TL, "semana": S0}, RH))
cl2 = {f"c_{limp[0]}_{dias0[3]}": "F", f"c_{limp[1]}_{dias0[3]}": T["C"]}
for k, v in cl.items(): cl2.setdefault(k, v)
cl2[f"c_{limp[0]}_{dias0[3]}"] = "F"; ok(grade(TL, S0, RH, cl2, "Troca de folga a pedido da colaboradora"))
# a semana seguinte da limpeza já publicada (a pessoa vê os próximos dias em Minha escala); sábado de manhã em rodízio
cl3 = {}
for i, x in enumerate(dias1):
    for k, e in enumerate(limp): cl3[f"c_{e}_{x}"] = T["C"] if i < 5 else (T["M"] if (i == 5 and k == 1) else "F")
ok(grade(TL, S1, RH, cl3)); hg = page(f"/ponto/escalas?equipe={TL}&semana={S1}", RH); ok(post(f"/ponto/escalas?equipe={TL}&semana={S1}", aid_of(hg, "Publicar e avisar a equipe"), {"teamId": TL, "semana": S1}, RH))

print("8 · Estoque e EPIs")
hs = page("/sst/conformidade", RH); AEPI = aid_of(hs, 'name="caValidade"')
for nome, ca, troca, val in [("Luva nitrílica (cozinha e limpeza)", "39.880", 30, d(48)), ("Avental impermeável (cozinha)", "15.204", 180, d(400)), ("Bota de segurança (manutenção)", "40.377", 365, d(-12))]:
    post("/sst/conformidade", AEPI, {"nome": nome, "ca": ca, "troca": troca, "caValidade": val}, RH, show=False)
LUVA = int(psql("SELECT id FROM epi_items WHERE nome LIKE 'Luva nitrílica%'"))
hi = page("/operacoes/estoque?aba=itens", OPE); ALOC = aid_of(hi, 'placeholder="ex.: Almoxarifado, Cozinha, Limpeza"')
for un, nome in [(CAR, "Almoxarifado"), (CAR, "Cozinha"), (CUL, "Almoxarifado")]: post("/operacoes/estoque", ALOC, {"unitId": un, "nome": nome}, OPE, show=False)
L = {f"{r.split('|')[1]}|{r.split('|')[2]}": int(r.split("|")[0]) for r in psql("SELECT l.id || '|' || l.unit_id || '|' || l.nome FROM stock_locations l").splitlines()}
LA, LC, LU = L[f"{CAR}|Almoxarifado"], L[f"{CAR}|Cozinha"], L[f"{CUL}|Almoxarifado"]
hi = page("/operacoes/estoque?aba=itens", OPE); AIT = aid_of(hi, "Salvar item")
itens = [("Detergente neutro 5 L", "Limpeza", "galão", 4, True, None, [LA, LU]), ("Álcool 70% 1 L", "Limpeza", "un", 12, True, None, [LA, LU]), ("Papel toalha interfolhado (fardo)", "Limpeza", "fardo", 6, False, None, [LA, LU]),
         ("Arroz tipo 1 — 5 kg", "Cozinha e refeitório", "pct", 8, True, None, [LC]), ("Feijão carioca — 1 kg", "Cozinha e refeitório", "pct", 15, True, None, [LC]), ("Luva nitrílica (par)", "EPI", "par", 20, False, LUVA, [LA, LC]),
         ("Papel A4 (resma)", "Expediente", "un", 10, False, None, [LA, LU]), ("Cola branca 1 kg", "Pedagógico", "un", 5, False, None, [LA])]
for nome, cat, um, mn, val, epi, locs in itens:
    post("/operacoes/estoque", AIT, {"nome": nome, "categoria": cat, "um": um, "minimo": mn, **({"validade": "1"} if val else {}), **({"epiId": epi} if epi else {}), "locais": locs}, OPE, show=False)
I = {r.split("|")[1]: int(r.split("|")[0]) for r in psql("SELECT id || '|' || nome FROM stock_items").splitlines()}
hmv = page("/operacoes/estoque?aba=movimentar", OPE); AMV = aid_of(hmv, 'name="quantidade"')
def mv(**k): return post("/operacoes/estoque", AMV, {"voltar": "/operacoes/estoque?aba=movimentar", **k}, OPE, show=False)
for it, loc, qt, custo, val, lote in [("Detergente neutro 5 L", LA, 10, "38,90", d(300), "DN-2611"), ("Detergente neutro 5 L", LU, 6, "39,50", d(280), "DN-2611"), ("Álcool 70% 1 L", LA, 24, "8,40", d(25), "AL-0925"), ("Álcool 70% 1 L", LU, 12, "8,40", d(210), "AL-1126"),
                                      ("Papel toalha interfolhado (fardo)", LA, 8, "64,00", "", ""), ("Papel toalha interfolhado (fardo)", LU, 3, "64,00", "", ""), ("Arroz tipo 1 — 5 kg", LC, 20, "27,90", d(160), "AR-11"), ("Feijão carioca — 1 kg", LC, 30, "7,80", d(9), "FJ-08"),
                                      ("Luva nitrílica (par)", LA, 60, "2,35", "", ""), ("Papel A4 (resma)", LA, 25, "26,50", "", ""), ("Papel A4 (resma)", LU, 6, "26,50", "", ""), ("Cola branca 1 kg", LA, 4, "18,00", "", "")]:
    mv(tipo="ENTRADA", itemId=I[it], locationId=loc, quantidade=qt, custo=custo, validade=val, lote=lote, motivo="Compra do mês (nota fictícia)")
for it, loc, qt, mot in [("Detergente neutro 5 L", LA, 7, "Requisição da limpeza"), ("Álcool 70% 1 L", LA, 9, "Reposição das salas"), ("Papel toalha interfolhado (fardo)", LA, 5, "Banheiros"), ("Arroz tipo 1 — 5 kg", LC, 6, "Cardápio da semana"), ("Feijão carioca — 1 kg", LC, 10, "Cardápio da semana"), ("Papel A4 (resma)", LA, 18, "Provas do 3º bimestre")]:
    mv(tipo="SAIDA", itemId=I[it], locationId=loc, quantidade=qt, motivo=mot)
mv(tipo="TRANSFERENCIA", itemId=I["Luva nitrílica (par)"], locationId=LA, destinoId=LC, quantidade=12, motivo="Cozinha")
mv(tipo="PERDA", itemId=I["Feijão carioca — 1 kg"], locationId=LC, quantidade=1, motivo="Embalagem rasgada")
hinv = page(f"/operacoes/estoque?aba=inventario&local={LA}", OPE); post("/operacoes/estoque", aid_of(hinv, "Registrar contagem"), {"locationId": LA, f"q_{I['Cola branca 1 kg']}": "3", f"q_{I['Papel A4 (resma)']}": "7", "motivo": f"Inventário de {HOJE.strftime('%d/%m/%Y')}"}, OPE)
hs = page("/sst/conformidade", RH); AENT = aid_of(hs, 'name="termoModo"')
for e in [EID[list(EID)[8]], EID[list(EID)[9]]]: post("/sst/conformidade", AENT, {"employeeId": e, "epiId": LUVA, "data": H, "quantidade": 2, "termoModo": "ONE", "locationId": LC}, RH)
post("/sst/conformidade", AENT, {"employeeId": ECOL, "epiId": LUVA, "data": d(-20), "quantidade": 1, "termoModo": "PAPEL", "locationId": LA}, RH)

print("9 · Reações nos comunicados")
for an in psql("SELECT id FROM announcements WHERE status='PUBLICADO' ORDER BY publicado_em DESC LIMIT 3").splitlines():
    for k, (email, _) in enumerate(DEMOS[:9]):
        uid = psql(f"SELECT id FROM users WHERE email='{email}'"); psql(f"INSERT INTO announcement_reactions (announcement_id, user_id, emoji) VALUES ({an}, {uid}, {q(['👍', '👍', '❤️', '👏', '🎉', '👍', '😮', '👏', '❤️'][k])}) ON CONFLICT DO NOTHING")

psql(f"INSERT INTO settings (key, value) VALUES ('demo_v34', {q(json.dumps({'em': datetime.now().isoformat(), 'politica': DOCPOL, 'holerites': SPH, 'pesquisa': PQ, 'portaria': TP}))}::jsonb)")
print("Demonstração da v34 carregada.")
