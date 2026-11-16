# E2E — v34 · Autoatendimento e documentos (referências MarQ HR e Sankhya Pessoas+): assinatura eletrônica com evidências (senha,
# 2FA, hash, IP e dispositivo; recusa, comprovante, cancelamento, limite de tentativas), espelho do ponto liberado após o fechamento
# (contestação e reenvio), divisão do PDF da folha por pessoa (CPF só na memória, continuação, nome, manual, substituição, descarte,
# acesso só do dono em qualquer perfil), alteração cadastral com comprovante e revisão campo a campo (trilha sem valores sensíveis),
# dependentes, ficha cadastral pelo link público (token só como hash, só o primeiro nome, aceite, limite de envios, expiração),
# ajuste de ponto (pares, aprovação do gestor direto, lançamento pelo RH), atestado sem CID (só RH; abono no espelho; alerta INSS),
# pesquisas internas anônimas e identificadas (mínimo, recorte, CSV), termômetro de humor só com contadores (mínimo e proteção contra
# diferença), escalas (alertas de descanso, folga e cobertura; publicação; escala vira jornada esperada; mudança avisada), estoque
# (validade FEFO, custo médio, transferência, inventário, baixa na entrega de EPI e termo assinado no ONE), reações nos comunicados,
# liderados em lote (ciclo bloqueado), parabéns, evolução salarial, férias com abono e 13º, tipos de pedido confidenciais, pendências,
# rotina, exportações, configurações e menu. Dados fictícios. Uso: bash /tmp/withserver.sh python3 scripts/e2e_v34_autoatendimento.py
import re, io, json, hashlib, subprocess, requests, base64, hmac, struct, time
from datetime import datetime, timedelta, date
from zoneinfo import ZoneInfo
from reportlab.pdfgen import canvas
from pypdf import PdfReader
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
    return re.sub(r"<script[^>]*>.*?</script>", "", re.sub(r"<!--.*?-->", "", r.text), flags=re.S).replace("\xa0", " ").replace("&quot;", '"').replace("&#x27;", "'").replace("&amp;", "&")
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
def cpf(base9):
    n = [int(c) for c in base9]
    d1 = (sum(a * b for a, b in zip(n, range(10, 1, -1))) * 10) % 11 % 10; d2 = (sum(a * b for a, b in zip(n + [d1], range(11, 1, -1))) * 10) % 11 % 10; return "".join(map(str, n + [d1, d2]))
def fcpf(c): return f"{c[:3]}.{c[3:6]}.{c[6:9]}-{c[9:]}"
def totp(secret_b32, t=None):
    key = base64.b32decode(secret_b32 + "=" * (-len(secret_b32) % 8)); counter = int((t or time.time()) // 30)
    h = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest(); o = h[-1] & 15; return str((struct.unpack(">I", h[o:o + 4])[0] & 0x7fffffff) % 1000000).zfill(6)
def pdf_paginas(textos):
    """PDF de verdade (texto pesquisável), uma página por item; cada item é uma lista de linhas."""
    buf = io.BytesIO(); c = canvas.Canvas(buf)
    for linhas in textos:
        y = 800
        for l in linhas: c.drawString(60, y, l); y -= 18
        c.showPage()
    c.save(); return buf.getvalue()
def arq_pdf(nome, linhas): return (nome, pdf_paginas([linhas]), "application/pdf")
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
def foto(nome="foto.png"): return (nome, PNG, "image/png")
def paginas_pdf(b): return len(PdfReader(io.BytesIO(b)).pages)
def texto_pdf(b): return "\n".join(p.extract_text() or "" for p in PdfReader(io.BytesIO(b)).pages)
def notif(uid, trecho): return int(psql(f"SELECT count(*) FROM notifications WHERE user_id={uid} AND (titulo ILIKE {q('%' + trecho + '%')} OR coalesce(texto,'') ILIKE {q('%' + trecho + '%')})"))
def mes_ant():
    p = (HOJE.replace(day=1) - timedelta(days=1)); return p.strftime("%Y-%m")

print("Preparação e migração 34.0")
RH = login("rh@colegiostatus", "Status2026!"); r = RH.get(B + f"/api/setup?token={TOKEN}"); assert r.json()["ok"], r.text
assert float(psql("SELECT value->>'versao' FROM settings WHERE key='banco'")) >= 34
novas = ["sign_documents", "sign_requests", "pdf_splits", "employee_dependents", "employee_change_requests", "admission_invites", "timesheet_adjust_requests", "medical_certificates", "custom_surveys", "custom_survey_responses", "custom_survey_marks", "mood_counts", "mood_factor_counts", "mood_marks", "shift_types", "shift_teams", "shift_team_members", "shift_assignments", "shift_publications", "shift_changes", "stock_locations", "stock_items", "stock_levels", "stock_lots", "stock_moves", "announcement_reactions", "birthday_wishes"]
assert psql(f"SELECT count(*) FROM information_schema.tables WHERE table_name IN ({','.join(q(t) for t in novas)})") == str(len(novas)), "27 tabelas novas"
assert psql("SELECT count(*) FROM settings WHERE key='v34_autoatendimento'") == "1"
assert psql("SELECT string_agg(codigo || ':' || confidencial, ',' ORDER BY codigo) FROM request_types WHERE codigo IN ('FALE_RH','ALT_JORNADA','BENEFICIO','MOVIMENTACAO')") == "ALT_JORNADA:true,BENEFICIO:true,FALE_RH:true,MOVIMENTACAO:true"
assert psql("SELECT count(*) FROM shift_types") == "4"
assert psql("SELECT is_nullable FROM information_schema.columns WHERE table_name='payroll_docs' AND column_name='cycle_id'") == "YES"
assert psql("SELECT count(*) FROM information_schema.columns WHERE table_name='mood_counts' AND column_name IN ('user_id','employee_id')") == "0", "o termômetro não tem coluna de pessoa"
CAR = int(psql("SELECT id FROM units WHERE codigo='CAR'")); CUL = int(psql("SELECT id FROM units WHERE codigo='CUL'"))
EMP = int(psql("INSERT INTO companies (nome, cnpj) VALUES ('Empresa Fictícia v34 Ltda', '95340000000191') RETURNING id"))
html = page("/configuracoes", RH); aid_user = aid_of(html, "Criar acesso")
def criar_user(nome, email, role, unit="", emp=""):
    post("/configuracoes", aid_user, {"nome": nome, "email": email, "role": role, "unitId": unit, "employeeId": emp, "senha": "senha12345"}, RH); return int(psql(f"SELECT id FROM users WHERE email='{email}'"))
CPFS = {}
def emp(nome, unit=CAR, gestor=None, nasc=None, salario=3200, sit="ATIVO", base9=None):
    c = cpf(base9) if base9 else None
    i = int(psql(f"INSERT INTO employees (nome, cpf, unit_id, vinculo, admissao, gestor_id, situacao, sexo, salario, regime, company_id, jornada_min_dia, data_nascimento) VALUES ({q(nome)}, {q(c)}, {unit}, 'CLT', '2022-03-01', {q(gestor)}, '{sit}', 'F', {salario}, 'ADMINISTRATIVO', {EMP}, 480, {q(nasc)}) RETURNING id"))
    CPFS[i] = c; return i
EG = emp("Gestora Apoio Fictícia", base9="934100001")
EA = emp("Ana Lima Fictícia", gestor=EG, base9="934100002"); EB = emp("Bruno Costa Fictício", gestor=EG, base9="934100003"); EC = emp("Carla Souza Fictícia", gestor=EG, base9="934100004")
ED = emp("Davi Rocha Fictício", unit=CUL, base9="934100005"); EN = emp("Nina Admissão Fictícia", sit="EM_ADMISSAO", base9="934100006")
UDG = criar_user("Direção Geral v34", "dg34@rede", "DIRECAO"); UFS = criar_user("Financeiro v34", "fin34@rede", "FINANCEIRO"); UOP = criar_user("Operações v34", "op34@rede", "OPERACOES")
UDIRC = criar_user("Diretora Cultura v34", "dir34@cul", "DIRETOR_UNIDADE", CUL)
UG = criar_user("Gestora Apoio", "ges34@car", "GESTOR", CAR, EG)
UA = criar_user("Ana Lima", "ana34@car", "COLABORADOR", CAR, EA); UB = criar_user("Bruno Costa", "bruno34@car", "COLABORADOR", CAR, EB); UC = criar_user("Carla Souza", "carla34@car", "COLABORADOR", CAR, EC)
UD = criar_user("Davi Rocha", "davi34@cul", "COLABORADOR", CUL, ED)
DG, FS, OP, DIRC, G, A, Bs, C, D = (login(e) for e in ["dg34@rede", "fin34@rede", "op34@rede", "dir34@cul", "ges34@car", "ana34@car", "bruno34@car", "carla34@car", "davi34@cul"])
ok("migração 34.0: 27 tabelas, tipos de pedido confidenciais, turnos-padrão, payroll_docs sem ciclo obrigatório e termômetro sem coluna de pessoa")

print("Assinatura eletrônica (documento, senha, 2FA, hash, recusa, comprovante, cancelamento)")
h = page("/documentos/assinaturas", RH); AID_ENV = aid_of(h, "Enviar para assinatura")
POL = pdf_paginas([["Politica de uso do celular em sala - 2027 (ficticia)", "Paragrafo 1: guardar o celular durante a aula."], ["Paragrafo 2: uso pedagogico com autorizacao."]])
erro(post("/documentos/assinaturas", AID_ENV, {"titulo": "Política sem arquivo", "tipo": "POLITICA", "modo": "PESSOAS", "pessoas": [EA]}, RH), "Escolha o PDF")
erro(post("/documentos/assinaturas", AID_ENV, {"titulo": "Política em imagem", "tipo": "POLITICA", "modo": "PESSOAS", "pessoas": [EA]}, RH, {"arquivo": foto()}), "PDF")
h_ges = page("/documentos/assinaturas", G, (302, 303, 307))
loc = post("/documentos/assinaturas", AID_ENV, {"titulo": "Política de uso do celular 2027", "tipo": "POLITICA", "prazo": d(5), "modo": "PESSOAS", "pessoas": [EA, EB, EC], "descricao": "Leia com atenção."}, RH, {"arquivo": ("politica.pdf", POL, "application/pdf")})
okmsg(loc, "3 pessoa(s)"); DOC = int(re.search(r"/assinaturas/(\d+)", loc).group(1))
assert psql(f"SELECT hash FROM sign_documents WHERE id={DOC}") == hashlib.sha256(POL).hexdigest(), "hash do arquivo guardado"
assert psql(f"SELECT paginas FROM sign_documents WHERE id={DOC}") == "2"
assert notif(UA, "Documento para assinar") == 1 and notif(UA, "Leia") == 0, "aviso sem o conteúdo"
RA = int(psql(f"SELECT id FROM sign_requests WHERE document_id={DOC} AND employee_id={EA}")); RB = int(psql(f"SELECT id FROM sign_requests WHERE document_id={DOC} AND employee_id={EB}")); RC = int(psql(f"SELECT id FROM sign_requests WHERE document_id={DOC} AND employee_id={EC}"))
ha = page("/eu/assinaturas", A); assert "Política de uso do celular 2027" in ha
page(f"/eu/assinaturas/{RB}", A, 404)
assert get(f"/api/assinaturas/{DOC}", D).status_code == 403, "quem não está no documento não abre"
assert get(f"/api/assinaturas/{DOC}", A).content == POL, "a pessoa abre o arquivo idêntico ao enviado"
hs = page(f"/eu/assinaturas/{RA}", A); AID_ASS = aid_of(hs, "Sua senha do ONE"); AID_REC = aid_of(hs, "Recusar")
erro(post(f"/eu/assinaturas/{RA}", AID_ASS, {"requestId": RA, "senha": "senha12345"}, A), "Marque que leu")
erro(post(f"/eu/assinaturas/{RA}", AID_ASS, {"requestId": RA, "li": "1", "senha": "errada"}, A), "Senha incorreta")
assert psql(f"SELECT status FROM sign_requests WHERE id={RA}") == "PENDENTE"
okmsg(post(f"/eu/assinaturas/{RA}", AID_ASS, {"requestId": RA, "li": "1", "senha": "senha12345"}, A), "assinado")
row = psql(f"SELECT status || '|' || metodo || '|' || (hash_conferido = (SELECT hash FROM sign_documents WHERE id={DOC})) || '|' || (ip IS NOT NULL) || '|' || (evidencia->>'cpf' LIKE '***%') FROM sign_requests WHERE id={RA}")
assert row == "ASSINADO|SENHA|true|true|true", row
assert CPFS[EA] not in psql(f"SELECT evidencia::text FROM sign_requests WHERE id={RA}"), "evidência guarda o CPF mascarado"
erro(post(f"/eu/assinaturas/{RA}", AID_ASS, {"requestId": RA, "li": "1", "senha": "senha12345"}, A), "já assinou")
# 2FA: com a verificação em duas etapas ativa, a assinatura exige o código
SEC = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"; psql(f"UPDATE users SET totp_ativo=true, totp_secret='{SEC}' WHERE id={UC}")
hc = page(f"/eu/assinaturas/{RC}", C); assert "Código do aplicativo autenticador" in hc; AID_ASSC = aid_of(hc, "Sua senha do ONE")
erro(post(f"/eu/assinaturas/{RC}", AID_ASSC, {"requestId": RC, "li": "1", "senha": "senha12345", "codigo": "000000"}, C), "duas etapas")
okmsg(post(f"/eu/assinaturas/{RC}", AID_ASSC, {"requestId": RC, "li": "1", "senha": "senha12345", "codigo": totp(SEC)}, C))
assert psql(f"SELECT metodo FROM sign_requests WHERE id={RC}") == "SENHA+2FA"
psql(f"UPDATE users SET totp_ativo=false, totp_secret=NULL WHERE id={UC}")
# recusa com motivo → RH responde; documento conclui quando ninguém mais falta
hb = page(f"/eu/assinaturas/{RB}", Bs); AID_RECB = aid_of(hb, "Recusar")
erro(post(f"/eu/assinaturas/{RB}", AID_RECB, {"requestId": RB, "motivo": "curto"}, Bs), "motivo")
okmsg(post(f"/eu/assinaturas/{RB}", AID_RECB, {"requestId": RB, "motivo": "Discordo do parágrafo 2 sobre o uso pedagógico."}, Bs), "Recusa registrada")
assert psql(f"SELECT status FROM sign_documents WHERE id={DOC}") == "CONCLUIDO", "sem pendentes, o documento conclui"
hd = page(f"/documentos/assinaturas/{DOC}", RH); assert "Discordo do parágrafo 2" in hd and "Recusas para responder (1)" in hd
AID_RES = aid_of(hd, 'name="resolucao"')
erro(post(f"/documentos/assinaturas/{DOC}", AID_RES, {"requestId": RB, "resolucao": "ok", "acao": "MANTER"}, RH), "mínimo 10")
okmsg(post(f"/documentos/assinaturas/{DOC}", AID_RES, {"requestId": RB, "resolucao": "Conversamos com o Bruno; a regra fica mantida neste ano.", "acao": "MANTER"}, RH))
assert "Resposta do RH" in page("/eu/assinaturas", Bs)
# comprovante: original + página de evidências; a pessoa recebe só a própria linha
rc = get(f"/api/assinaturas/{DOC}?modo=comprovante", RH); assert rc.headers["content-type"] == "application/pdf"
assert paginas_pdf(rc.content) == 3; tx = texto_pdf(rc.content); assert "COMPROVANTE" in tx and hashlib.sha256(POL).hexdigest()[:20] in tx.replace("\n", "") and "Bruno" in tx and CPFS[EA] not in tx
ra2 = get(f"/api/assinaturas/{DOC}?modo=comprovante", A); ta = texto_pdf(ra2.content); assert "Ana" in ta and "Bruno" not in ta, "comprovante da pessoa traz só ela"
# arquivo adulterado: nada é assinado
loc = post("/documentos/assinaturas", AID_ENV, {"titulo": "Aditivo de jornada (fictício)", "tipo": "CONTRATO", "modo": "PESSOAS", "pessoas": [EA, EB]}, RH, {"arquivo": arq_pdf("aditivo.pdf", ["Aditivo ficticio"])})
DOC2 = int(re.search(r"/assinaturas/(\d+)", loc).group(1)); RA2 = int(psql(f"SELECT id FROM sign_requests WHERE document_id={DOC2} AND employee_id={EA}"))
psql(f"UPDATE attachments SET dados = dados || '\\x00'::bytea WHERE id=(SELECT attachment_id FROM sign_documents WHERE id={DOC2})")
erro(post(f"/eu/assinaturas/{RA2}", aid_of(page(f"/eu/assinaturas/{RA2}", A), "Sua senha do ONE"), {"requestId": RA2, "li": "1", "senha": "senha12345"}, A), "não confere")
assert psql(f"SELECT status FROM sign_requests WHERE id={RA2}") == "PENDENTE"
assert int(psql("SELECT count(*) FROM audit_log WHERE acao='hash divergente ao assinar'")) >= 1
# limite de tentativas com senha errada (5 em 15 minutos)
hb2 = page(f"/eu/assinaturas/{int(psql(f'SELECT id FROM sign_requests WHERE document_id={DOC2} AND employee_id={EB}'))}", Bs); RB2 = int(psql(f"SELECT id FROM sign_requests WHERE document_id={DOC2} AND employee_id={EB}")); AIDB2 = aid_of(hb2, "Sua senha do ONE")
for _ in range(5): erro(post(f"/eu/assinaturas/{RB2}", AIDB2, {"requestId": RB2, "li": "1", "senha": "x"}, Bs), "Senha incorreta")
erro(post(f"/eu/assinaturas/{RB2}", AIDB2, {"requestId": RB2, "li": "1", "senha": "senha12345"}, Bs), "Muitas tentativas")
# lembrar e cancelar
hd2 = page(f"/documentos/assinaturas/{DOC2}", RH); okmsg(post(f"/documentos/assinaturas/{DOC2}", aid_of(hd2, "Lembrar quem falta"), {"id": DOC2}, RH), "Lembrete")
erro(post(f"/documentos/assinaturas/{DOC2}", aid_of(hd2, 'name="motivo"'), {"id": DOC2, "motivo": "curto"}, RH), "motivo")
okmsg(post(f"/documentos/assinaturas/{DOC2}", aid_of(hd2, 'name="motivo"'), {"id": DOC2, "motivo": "Arquivo errado: será reenviado corrigido."}, RH), "cancelado")
assert psql(f"SELECT string_agg(DISTINCT status, ',') FROM sign_requests WHERE document_id={DOC2}") == "CANCELADO"
csv = get("/api/export/assinaturas", RH).text; assert "Política de uso do celular 2027" in csv and CPFS[EA] not in csv and "***" in csv
ok("assinatura: PDF obrigatório e hash SHA-256; só RH/Direção enviam; a pessoa vê só o seu; senha (e 2FA) no ato; evidência com IP, método e CPF mascarado; arquivo adulterado bloqueia; 5 tentativas; recusa com motivo e resposta; comprovante com página de evidências (o da pessoa só com ela); lembrete, cancelamento e CSV mascarado")

print("Espelho do ponto: liberar após o fechamento, assinar, contestar e reenviar")
M = mes_ant(); ini = f"{M}-01"; fim = (date(int(M[:4]), int(M[5:]), 1) + timedelta(days=40)).replace(day=1) - timedelta(days=1)
for e in (EA, EB):
    psql(f"INSERT INTO timesheet_days (employee_id, data, esperado_min, trabalhado_min, status, marcacoes, origem) SELECT {e}, g::date, 480, 500, 'NORMAL', '07:30 11:30 13:00 17:20', 'IMPORTADO' FROM generate_series('{ini}'::date, '{fim.isoformat()}'::date, '1 day') g WHERE extract(isodow FROM g) < 6 ON CONFLICT DO NOTHING")
    psql(f"UPDATE timesheet_days SET status='FALTA', trabalhado_min=0, marcacoes=NULL WHERE employee_id={e} AND data=(SELECT min(data) FROM timesheet_days WHERE employee_id={e} AND data BETWEEN '{ini}' AND '{fim.isoformat()}')")
psql(f"INSERT INTO timesheet_locks (unit_id, mes, status) VALUES ({CAR}, '{M}', 'ABERTO') ON CONFLICT DO NOTHING")
psql(f"UPDATE timesheet_locks SET status='FECHADO', fechado_por_nome='RH', fechado_em=now() WHERE unit_id={CAR} AND mes='{M}'")
hp = page(f"/ponto?mes={M}", RH); AID_LIB = aid_of(hp, "Liberar espelhos para assinatura")
psql(f"UPDATE timesheet_locks SET status='REABERTO' WHERE unit_id={CAR} AND mes='{M}'")
erro(post(f"/ponto?mes={M}", AID_LIB, {"unitId": CAR, "mes": M, "voltar": f"/ponto?mes={M}"}, RH), "Feche o ponto")
psql(f"UPDATE timesheet_locks SET status='FECHADO' WHERE unit_id={CAR} AND mes='{M}'")
erro(post(f"/ponto?mes={M}", AID_LIB, {"unitId": CAR, "mes": M, "voltar": f"/ponto?mes={M}"}, G), "Liberam")
okmsg(post(f"/ponto?mes={M}", AID_LIB, {"unitId": CAR, "mes": M, "voltar": f"/ponto?mes={M}"}, RH), "espelho(s) liberado(s)")
assert psql(f"SELECT count(DISTINCT r.employee_id) FROM sign_requests r JOIN sign_documents d ON d.id=r.document_id WHERE d.tipo='ESPELHO' AND d.competencia='{M}' AND r.employee_id IN ({EA},{EB})") == "2"
okmsg(post(f"/ponto?mes={M}", AID_LIB, {"unitId": CAR, "mes": M, "voltar": f"/ponto?mes={M}"}, RH), "Nenhum espelho novo")
EA_ESP = int(psql(f"SELECT r.id FROM sign_requests r JOIN sign_documents d ON d.id=r.document_id WHERE d.tipo='ESPELHO' AND d.competencia='{M}' AND r.employee_id={EA}"))
DOC_ESP = int(psql(f"SELECT document_id FROM sign_requests WHERE id={EA_ESP}"))
pe = get(f"/api/assinaturas/{DOC_ESP}", A).content; te = texto_pdf(pe); assert "ESPELHO DO PONTO" in te and "Ana Lima" in te and CPFS[EA] not in te and "Totais do m" in te
he = page(f"/eu/assinaturas/{EA_ESP}", A); assert "Horas a mais" in he and "Faltas" in he and "1 dia(s)" in he
assert "Conferir e assinar o espelho" in page(f"/eu?mes={M}", A)
okmsg(post(f"/eu/assinaturas/{EA_ESP}", aid_of(he, "Conteste") if "Conteste" in he else aid_of(he, "Contestar"), {"requestId": EA_ESP, "motivo": "Dia 10 eu estava em curso externo autorizado, não foi falta."}, A), "Contestação enviada")
assert psql(f"SELECT status FROM sign_requests WHERE id={EA_ESP}") == "CONTESTADO" and notif(int(psql("SELECT id FROM users WHERE email='rh@colegiostatus'")), "contestado") >= 1
hde = page(f"/documentos/assinaturas/{DOC_ESP}", RH); okmsg(post(f"/documentos/assinaturas/{DOC_ESP}", aid_of(hde, 'name="resolucao"'), {"requestId": EA_ESP, "resolucao": "Curso confirmado: dia 10 corrigido no relógio e reimportado.", "acao": "REENVIAR"}, RH), "espelho revisado")
assert psql(f"SELECT count(*) FROM sign_documents WHERE tipo='ESPELHO' AND competencia='{M}' AND titulo LIKE '%(revisado)%'") == "1"
psql(f"UPDATE timesheet_locks SET status='REABERTO' WHERE unit_id={CAR} AND mes='{M}'")
ok("espelho: só com o mês fechado e por RH/Direção/direção da unidade; um por pessoa (sem duplicar); PDF com marcações e totais e CPF mascarado; totais no Meu espaço; contestação com motivo, resposta e reenvio do espelho revisado")

print("Divisão do PDF da folha por pessoa")
AP = mes_ant()
FOLHA = pdf_paginas([
  ["HOLERITE - competencia " + AP, "Empresa Ficticia v34 Ltda", f"Nome: Ana Lima Ficticia   CPF: {fcpf(CPFS[EA])}", "Salario base 3.200,00"],
  ["(continuacao) Descontos: INSS 280,00", "Liquido 2.920,00"],
  ["HOLERITE - competencia " + AP, "Nome: BRUNO COSTA FICTICIO", "Salario base 3.200,00"],
  ["HOLERITE - competencia " + AP, f"CPF: {fcpf(cpf('934199999'))}", "Nome: Pessoa de Fora"],
  ["HOLERITE - competencia " + AP, f"CPF {CPFS[EC][:3]} {CPFS[EC][3:6]} {CPFS[EC][6:9]} {CPFS[EC][9:]}", "Carla"],
  ["HOLERITE - competencia " + AP, f"Nome: Gestora Apoio Ficticia  CPF {fcpf(CPFS[EG])}"],
])
hdv = page("/folha/dividir", RH); AID_PREV = aid_of(hdv, "Ler o PDF")
assert get("/folha/dividir", G).status_code in (302, 303, 307)
erro(post("/folha/dividir", AID_PREV, {"tipo": "HOLERITES", "competencia": AP, "companyId": EMP}, RH, {"arquivo": foto()}), "PDF")
loc = post("/folha/dividir", AID_PREV, {"tipo": "HOLERITES", "competencia": AP, "companyId": EMP}, RH, {"arquivo": ("folha.pdf", FOLHA, "application/pdf")})
okmsg(loc, "6 página(s) lidas"); SP = int(re.search(r"/dividir/(\d+)", loc).group(1))
res = json.loads(psql(f"SELECT resultado::text FROM pdf_splits WHERE id={SP}"))
pg = {p["pagina"]: p for p in res["paginas"]}
assert (pg[1]["employeeId"], pg[1]["por"]) == (EA, "CPF") and (pg[2]["employeeId"], pg[2]["por"]) == (EA, "CONTINUACAO"), pg
assert (pg[3]["employeeId"], pg[3]["por"]) == (EB, "NOME") and pg[4]["employeeId"] is None and (pg[5]["employeeId"], pg[5]["por"]) == (EC, "CPF") and pg[6]["employeeId"] == EG, pg
dump = psql(f"SELECT resultado::text FROM pdf_splits WHERE id={SP}"); assert all(CPFS[e] not in dump for e in (EA, EC, EG)) and cpf("934199999") not in dump, "a prévia não guarda CPF"
hv = page(f"/folha/dividir/{SP}", RH); assert "Página a página" in hv and "Pessoa de Fora" not in hv
erro(post(f"/folha/dividir/{SP}", aid_of(hv, "Publicar 4 documento(s)"), {"id": SP}, RH), "Marque que conferiu")
AID_AJ = aid_of(hv, 'aria-label="Dono da página 4"')
erro(post(f"/folha/dividir/{SP}", AID_AJ, {"id": SP, "pagina": 4, "employeeId": EN}, RH), "não está na equipe")
okmsg(post(f"/folha/dividir/{SP}", AID_AJ, {"id": SP, "pagina": 4, "employeeId": EB}, RH))
hv = page(f"/folha/dividir/{SP}", RH)
okmsg(post(f"/folha/dividir/{SP}", aid_of(hv, "Publicar 4 documento(s)"), {"id": SP, "conferi": "1"}, RH), "4 documento(s) publicados")
assert psql(f"SELECT count(*) FROM payroll_docs WHERE split_id={SP}") == "4"
docA = psql(f"SELECT attachment_id FROM payroll_docs WHERE split_id={SP} AND employee_id={EA}"); docB = psql(f"SELECT attachment_id FROM payroll_docs WHERE split_id={SP} AND employee_id={EB}"); docG = psql(f"SELECT attachment_id FROM payroll_docs WHERE split_id={SP} AND employee_id={EG}")
ra = get(f"/api/anexos/{docA}", A); assert ra.status_code == 200 and paginas_pdf(ra.content) == 2 and "continuacao" in texto_pdf(ra.content)
assert paginas_pdf(get(f"/api/anexos/{docB}", Bs).content) == 2, "Bruno: página do nome + a escolhida pelo RH"
assert get(f"/api/anexos/{docA}", Bs).status_code == 403 and get(f"/api/anexos/{docA}", G).status_code == 403 and get(f"/api/anexos/{docA}", FS).status_code == 403
assert get(f"/api/anexos/{docG}", G).status_code == 200, "gestora (perfil de equipe) abre o próprio holerite"
assert notif(UA, "Holerite disponível") == 1 and notif(UA, "2.920") == 0
md = page("/eu/documentos", A); assert "Holerite" in md and "ainda não aberto" not in md and "Meus documentos" in md
assert "Abertos pela pessoa" in page(f"/folha/dividir/{SP}", RH)
# nova divisão da mesma competência substitui; descarte apaga o original
loc = post("/folha/dividir", AID_PREV, {"tipo": "HOLERITES", "competencia": AP, "companyId": EMP}, RH, {"arquivo": ("folha2.pdf", pdf_paginas([[f"Ana Lima Ficticia CPF {fcpf(CPFS[EA])} versao corrigida"]]), "application/pdf")})
SP2 = int(re.search(r"/dividir/(\d+)", loc).group(1)); hv2 = page(f"/folha/dividir/{SP2}", RH)
okmsg(post(f"/folha/dividir/{SP2}", aid_of(hv2, "Publicar 1 documento(s)"), {"id": SP2}, RH), "substituído")
assert psql(f"SELECT count(*) FROM payroll_docs WHERE employee_id={EA} AND tipo='HOLERITES' AND competencia='{AP}'") == "1"
loc = post("/folha/dividir", AID_PREV, {"tipo": "INFORME_RENDIMENTOS", "ano": str(HOJE.year - 1)}, RH, {"arquivo": ("informes.pdf", pdf_paginas([[f"Informe {fcpf(CPFS[EB])}"]]), "application/pdf")})
SP3 = int(re.search(r"/dividir/(\d+)", loc).group(1)); att3 = psql(f"SELECT attachment_id FROM pdf_splits WHERE id={SP3}")
hv3 = page(f"/folha/dividir/{SP3}", RH); okmsg(post(f"/folha/dividir/{SP3}", aid_of(hv3, "Descartar"), {"id": SP3}, RH), "apagado")
assert psql(f"SELECT count(*) FROM attachments WHERE id={att3}") == "0" and psql(f"SELECT status FROM pdf_splits WHERE id={SP3}") == "DESCARTADO"
ok("divisão: dono pelo CPF (com ou sem pontuação), continuação, nome completo e escolha manual; CPF nunca na prévia; conferência obrigatória; um PDF por pessoa (páginas certas); só o dono abre — inclusive gestor; aviso sem valores; substituição e descarte apagando o original")

print("Alteração cadastral com comprovante, dependentes e trilha sem valores")
hd = page("/eu/dados", A); AID_CAD = aid_of(hd, "Enviar ao RH"); AID_DEP = aid_of(hd, "dep0Nome")
erro(post("/eu/dados", AID_CAD, {"cep": "79002-000"}, A), "comprovante")
erro(post("/eu/dados", AID_CAD, {"cep": "123"}, A), "CEP")
loc = post("/eu/dados", AID_CAD, {"cep": "79.002-000", "logradouro": "Rua das Acácias Fictícia", "numero": "123", "bairro": "Centro", "cidade": "Campo Grande", "uf": "MS", "banco_codigo": "Banco Fictício 999", "banco_agencia": "1234", "banco_conta": "99887-6", "banco_tipo": "CORRENTE", "nome_social": "Aninha", "doc0Tipo": "Comprovante de residência"}, A, {"doc0": foto("conta-luz.png")})
okmsg(loc, "CAD-"); PC = int(psql(f"SELECT id FROM employee_change_requests WHERE employee_id={EA} ORDER BY id DESC LIMIT 1"))
assert psql(f"SELECT jsonb_array_length(campos) || '|' || jsonb_array_length(documentos) FROM employee_change_requests WHERE id={PC}") == "11|1"
trilha = psql(f"SELECT coalesce(string_agg(depois::text, ' '), '') FROM audit_log WHERE entidade='employees' AND entidade_id={EA}")
assert "Acácias" not in trilha and "99887" not in trilha and "banco_conta" in trilha, "a trilha registra quais campos, não os valores"
att_cad = int(psql(f"SELECT (documentos->0->>'attachmentId')::int FROM employee_change_requests WHERE id={PC}"))
assert get(f"/api/anexos/{att_cad}", A).status_code == 200 and get(f"/api/anexos/{att_cad}", Bs).status_code == 403 and get(f"/api/anexos/{att_cad}", G).status_code == 403 and get(f"/api/anexos/{att_cad}", RH).status_code == 200
assert get("/colaboradores/alteracoes", G).status_code in (302, 303, 307)
hr = page(f"/colaboradores/alteracoes/{PC}", RH); AID_DEC = aid_of(hr, "Aplicar decisão")
dec = {"id": PC, **{f"c_{k}": "APROVADO" for k in ["cep", "logradouro", "numero", "bairro", "cidade", "uf", "nome_social"]}, **{f"c_{k}": "RECUSADO" for k in ["banco_codigo", "banco_agencia", "banco_conta", "banco_tipo"]}}
erro(post(f"/colaboradores/alteracoes/{PC}", AID_DEC, dec, RH), "motivo")
okmsg(post(f"/colaboradores/alteracoes/{PC}", AID_DEC, {**dec, "motivo": "Comprovante bancário não enviado: mande o print da conta no seu nome."}, RH), "em parte")
assert psql(f"SELECT cep || '|' || logradouro || '|' || nome_social || '|' || coalesce(banco_conta, '-') || '|' || (endereco LIKE '%Acácias%') FROM employees WHERE id={EA}") == "79002-000|Rua das Acácias Fictícia|Aninha|-|true"
assert psql(f"SELECT status FROM employee_change_requests WHERE id={PC}") == "PARCIAL" and notif(UA, "pedido de alteração cadastral") == 1
md = page("/eu/dados", A); assert "Comprovante bancário não enviado" in md and "aplicado" in md
# dependentes
erro(post("/eu/dados", AID_DEP, {"dep0Nome": "Lia Lima Fictícia", "dep0Parentesco": "FILHO", "dep0Nascimento": "2019-05-10", "dep0Cpf": cpf("934177777"), "dep0Irrf": "1", "dep0Sf": "1"}, A), "documento do dependente")
okmsg(post("/eu/dados", AID_DEP, {"dep0Nome": "Lia Lima Fictícia", "dep0Parentesco": "FILHO", "dep0Nascimento": "2019-05-10", "dep0Cpf": cpf("934177777"), "dep0Irrf": "1", "dep0Sf": "1", "doc0Tipo": "Certidão de nascimento"}, A, {"doc0": foto("certidao.png")}), "DEP-")
PD = int(psql(f"SELECT id FROM employee_change_requests WHERE employee_id={EA} AND tipo='DEPENDENTE' ORDER BY id DESC LIMIT 1"))
hr = page(f"/colaboradores/alteracoes/{PD}", RH); assert cpf("934177777") not in hr and "***" in hr
okmsg(post(f"/colaboradores/alteracoes/{PD}", aid_of(hr, "Aplicar decisão"), {"id": PD, "d_0": "APROVADO"}, RH), "aplicado")
assert psql(f"SELECT nome || '|' || cpf || '|' || irrf || '|' || salario_familia FROM employee_dependents WHERE employee_id={EA}") == f"Lia Lima Fictícia|{cpf('934177777')}|true|true"
assert cpf("934177777") not in psql(f"SELECT dependentes::text FROM employee_change_requests WHERE id={PD}"), "o CPF sai do pedido depois da decisão"
DEPID = int(psql(f"SELECT id FROM employee_dependents WHERE employee_id={EA}"))
md = page("/eu/dados", A); okmsg(post("/eu/dados", aid_of(md, f'name="dependentId" value="{DEPID}"'), {"dependentId": DEPID, "motivo": "Teste de exclusão"}, A), "DEP-")
PX = int(psql(f"SELECT id FROM employee_change_requests WHERE employee_id={EA} ORDER BY id DESC LIMIT 1")); hr = page(f"/colaboradores/alteracoes/{PX}", RH)
okmsg(post(f"/colaboradores/alteracoes/{PX}", aid_of(hr, "Aplicar decisão"), {"id": PX, "d_0": "APROVADO"}, RH))
assert psql(f"SELECT ativo || '|' || motivo_fim FROM employee_dependents WHERE id={DEPID}") == "false|Teste de exclusão"
# limite de pedidos abertos
for i in range(3): okmsg(post("/eu/dados", AID_CAD, {"escolaridade": ["MEDIO", "SUP_INC", "SUP"][i], "doc0Tipo": "Comprovante de escolaridade"}, Bs, {"doc0": foto()}))
erro(post("/eu/dados", AID_CAD, {"escolaridade": "POS", "doc0Tipo": "Comprovante de escolaridade"}, Bs, {"doc0": foto()}), "aguardando o RH")
mb = page("/eu/dados", Bs); okmsg(post("/eu/dados", aid_of(mb, "Cancelar pedido"), {"id": int(psql(f"SELECT id FROM employee_change_requests WHERE employee_id={EB} AND status='PENDENTE' ORDER BY id LIMIT 1"))}, Bs), "cancelado")
assert "/colaboradores/alteracoes" in page("/pendencias", RH)
ok("cadastro: só o que mudou vira pedido; comprovante obrigatório (endereço, conta, estado civil, escolaridade); anexo só do RH e da pessoa; decisão campo a campo com motivo; endereço composto na ficha; dependente com documento (CPF sai do pedido); exclusão; limite de pedidos abertos e cancelamento; trilha sem valores")

print("Ficha cadastral pelo link público (admissão)")
hf = page(f"/colaboradores/{EN}", RH); AID_LINK = aid_of(hf, "Gerar link")
rg = get(f"/colaboradores/{EA}", G); assert rg.status_code != 200 or "Ficha cadastral pelo link" not in rg.text, "gestor não vê o bloco de cadastro do RH"
loc = post(f"/colaboradores/{EN}", AID_LINK, {"employeeId": EN}, RH); assert "convite=" in loc; TK = re.search(r"convite=([A-Za-z0-9_-]+)", loc).group(1)
assert psql(f"SELECT count(*) FROM admission_invites WHERE token_hash LIKE '%{TK[:10]}%'") == "0" and psql(f"SELECT count(*) FROM admission_invites WHERE employee_id={EN} AND estado='ATIVO'") == "1", "só o hash do token"
hfl = page(f"/colaboradores/{EN}?convite={TK}", RH); assert f"/admissao/{TK}" in hfl
pub = mk(); hp = page(f"/admissao/{TK}", pub); assert "Olá, Nina!" in hp and "Admissão Fictícia" not in hp and CPFS[EN] not in hp
assert "Link indisponível" in page("/admissao/" + "x" * 30, pub)
AID_ADM = aid_of(hp, "Enviar ao RH")
r = pub.post(B + f"/admissao/{TK}", files=[(f"$ACTION_ID_{AID_ADM}", (None, "")), ("token", (None, TK)), ("rg", (None, "1234567"))], allow_redirects=False); assert "as=" in r.headers["location"] and "aviso" in unq(r.headers["location"]).replace("+", " ")
dados = [("token", TK), ("aceite", "1"), ("rg", "1234567"), ("rg_orgao", "SSP/MS"), ("pis", "12345678901"), ("estado_civil", "SOLTEIRO"), ("raca_cor", "NAO_INFORMADO"), ("cep", "79010-100"), ("cidade", "Campo Grande"), ("uf", "MS"), ("telefone", "(67) 99999-0000"), ("banco_conta", "12345-6"), ("vale_transporte", "SIM"), ("dep0Nome", "Teo Filho Fictício"), ("dep0Parentesco", "FILHO"), ("dep0Nascimento", "2020-01-15"), ("doc0Tipo", "Documento com foto (RG ou CNH)")]
r = pub.post(B + f"/admissao/{TK}", files=[(f"$ACTION_ID_{AID_ADM}", (None, ""))] + [(k, (None, v)) for k, v in dados] + [("doc0", foto("rg.png"))], allow_redirects=False)
assert "ok=1" in r.headers["location"] and "ADM-" in r.headers["location"], r.headers["location"]
PA = int(psql(f"SELECT id FROM employee_change_requests WHERE employee_id={EN} AND tipo='ADMISSAO'")); assert psql(f"SELECT envios FROM admission_invites WHERE employee_id={EN} AND estado='ATIVO'") == "1"
assert "1234567" not in psql(f"SELECT coalesce(string_agg(depois::text, ' '),'') FROM audit_log WHERE entidade='employees' AND entidade_id={EN}")
assert "Você já enviou a ficha" in page(f"/admissao/{TK}", pub)
hr = page(f"/colaboradores/alteracoes/{PA}", RH); campos = json.loads(psql(f"SELECT campos::text FROM employee_change_requests WHERE id={PA}"))
okmsg(post(f"/colaboradores/alteracoes/{PA}", aid_of(hr, "Aplicar decisão"), {"id": PA, **{f"c_{c['campo']}": "APROVADO" for c in campos}, "d_0": "APROVADO"}, RH), "aplicado")
assert psql(f"SELECT rg || '|' || pis || '|' || vale_transporte FROM employees WHERE id={EN}") == "1234567|12345678901|true"
assert psql(f"SELECT estado FROM admission_invites WHERE employee_id={EN} ORDER BY id DESC LIMIT 1") == "CONCLUIDO" and "Link indisponível" in page(f"/admissao/{TK}", pub)
loc = post(f"/colaboradores/{EN}", AID_LINK, {"employeeId": EN}, RH); TK2 = re.search(r"convite=([A-Za-z0-9_-]+)", loc).group(1)
psql(f"UPDATE admission_invites SET expira_em='{d(-1)}' WHERE employee_id={EN} AND estado='ATIVO'"); assert "não está mais ativo" in page(f"/admissao/{TK2}", pub)
ok("ficha pelo link: token só como hash e mostrado uma vez; página pública com o primeiro nome (sem dados da ficha); aceite de privacidade com erro assinado; pedido ADM com documentos e dependente; trilha sem valores; aplicação conclui o link; expiração")

print("Ajuste de ponto e atestado pelo Meu espaço")
psql(f"UPDATE employees SET gestor_id={EG} WHERE id IN ({EA},{EB},{EC})")
ontem = d(-1) if (HOJE - timedelta(days=1)).isoweekday() < 6 else d(-3)
hm = page("/eu", A); AID_AJP = aid_of(hm, 'name="marcacoes"'); AID_AT = aid_of(hm, 'name="horas"')
erro(post("/eu", AID_AJP, {"data": ontem, "tipo": "ESQUECIMENTO", "marcacoes": "07:30 11:30 13:00", "motivo": "Esqueci a saída."}, A), "pares")
erro(post("/eu", AID_AJP, {"data": d(1), "tipo": "ESQUECIMENTO", "marcacoes": "07:30 11:30", "motivo": "Futuro."}, A), "já passou")
okmsg(post("/eu", AID_AJP, {"data": ontem, "tipo": "ESQUECIMENTO", "marcacoes": "7:30, 11:30; 13:00 17h18", "motivo": "Esqueci de marcar a saída."}, A), "ajuste enviado")
erro(post("/eu", AID_AJP, {"data": ontem, "tipo": "ESQUECIMENTO", "marcacoes": "07:30 11:30", "motivo": "Duplicado."}, A), "Já há um pedido")
AJ = int(psql(f"SELECT id FROM timesheet_adjust_requests WHERE employee_id={EA}")); assert psql(f"SELECT marcacoes FROM timesheet_adjust_requests WHERE id={AJ}") == "07:30 11:30 13:00 17:18"
assert notif(UG, "Ajuste de ponto para aprovar") == 1
hb = page("/ponto/ajustes", Bs, (200,)); assert "Ana Lima" not in hb, "colaborador sem equipe não vê pedidos alheios"
hg = page("/ponto/ajustes", G); assert "Ana Lima" in hg; AID_DAJ = aid_of(hg, f'name="id" value="{AJ}"')
erro(post("/ponto/ajustes", AID_DAJ, {"id": AJ, "decisao": "RECUSAR", "resposta": ""}, G), "motivo")
okmsg(post("/ponto/ajustes", AID_DAJ, {"id": AJ, "decisao": "APROVAR", "resposta": "Ok, confirmado."}, G), "RH lança")
assert psql(f"SELECT status || '|' || aprovado_nome FROM timesheet_adjust_requests WHERE id={AJ}") == "APROVADO|Gestora Apoio"
hl = page("/ponto/ajustes?aba=lancar", RH); okmsg(post("/ponto/ajustes", aid_of(hl, "Lançar no espelho do ONE"), {"id": AJ}, RH), "Lançado")
assert psql(f"SELECT trabalhado_min || '|' || status || '|' || marcacoes || '|' || origem FROM timesheet_days WHERE employee_id={EA} AND data='{ontem}'") == "498|NORMAL|07:30 11:30 13:00 17:18|AJUSTE"
okmsg(post("/eu", AID_AJP, {"data": ontem, "tipo": "ERRO", "marcacoes": "08:00 12:00", "motivo": "Teste para o gestor da Cultura."}, Bs))
AJB = int(psql(f"SELECT id FROM timesheet_adjust_requests WHERE employee_id={EB} AND status='PENDENTE'"))
hd = page("/ponto/ajustes", DIRC); assert "Bruno" not in hd, "direção de outra unidade não vê"
# atestado: só RH; sem CID; abono do dia importado como falta; alerta do 16º dia
dia_at = d(-5) if (HOJE - timedelta(days=5)).isoweekday() < 6 else d(-6)
psql(f"INSERT INTO timesheet_days (employee_id, data, esperado_min, trabalhado_min, status, origem) VALUES ({EA}, '{dia_at}', 480, 0, 'FALTA', 'IMPORTADO') ON CONFLICT (employee_id, data) DO UPDATE SET status='FALTA', trabalhado_min=0")
erro(post("/eu", AID_AT, {"tipo": "DIAS", "inicio": dia_at, "fim": dia_at}, A), "foto do atestado")
erro(post("/eu", AID_AT, {"tipo": "HORAS", "inicio": dia_at}, A, {"arquivo": foto()}), "horário")
okmsg(post("/eu", AID_AT, {"tipo": "DIAS", "inicio": dia_at, "fim": dia_at, "obs": "Consulta e repouso"}, A, {"arquivo": foto("atestado.png")}), "Atestado enviado")
MC = int(psql(f"SELECT id FROM medical_certificates WHERE employee_id={EA}")); att_mc = psql(f"SELECT attachment_id FROM medical_certificates WHERE id={MC}")
assert psql("SELECT count(*) FROM information_schema.columns WHERE table_name='medical_certificates' AND column_name IN ('cid','cid10','cid_10','diagnostico')") == "0", "não há onde guardar CID"
assert get(f"/api/anexos/{att_mc}", G).status_code == 403 and get(f"/api/anexos/{att_mc}", A).status_code == 200 and get(f"/api/anexos/{att_mc}", RH).status_code == 200
assert get("/ponto/atestados", G).status_code in (302, 303, 307)
psql(f"INSERT INTO medical_certificates (employee_id, tipo, inicio, fim, dias, status) VALUES ({EA}, 'DIAS', '{d(-41)}', '{d(-27)}', 15, 'ACEITO')")
ha = page("/ponto/atestados", RH); assert "16º dia" in ha
okmsg(post("/ponto/atestados", aid_of(ha, f'name="id" value="{MC}"'), {"id": MC, "decisao": "ACEITAR", "abonar": "1"}, RH), "INSS")
assert psql(f"SELECT status FROM timesheet_days WHERE employee_id={EA} AND data='{dia_at}'") == "ATESTADO"
assert psql(f"SELECT tipo || '|' || status FROM leave_requests WHERE id=(SELECT leave_request_id FROM medical_certificates WHERE id={MC})") == "AFASTAMENTO_SAUDE|APROVADA"
assert "Atestado" in page("/eu", A) and "Aceito" in page("/eu", A)
ok("ajuste: marcações em pares e em ordem (formatos livres), sem futuro nem duplicado; aprova o gestor direto (não colegas nem outra unidade); RH lança no espelho com horas recalculadas; atestado com foto, sem CID, só RH vê; aceito vira afastamento e abona o dia importado; alerta do 16º dia (INSS)")

print("Pesquisas internas (anônima e identificada)")
hpq = page("/clima/pesquisas", RH); AID_PQ = aid_of(hpq, "Salvar rascunho")
erro(post("/clima/pesquisas", AID_PQ, {"titulo": "Pesquisa ruim", "perguntas": "XYZ | pergunta", "fim": d(10), "publico": "TODOS", "minimo": 3}, RH), "ESCALA, UNICA")
erro(post("/clima/pesquisas", AID_PQ, {"titulo": "Pesquisa ruim", "perguntas": "UNICA | Escolha uma opção | só uma", "fim": d(10), "publico": "TODOS", "minimo": 3}, RH), "de 2 a 12")
loc = post("/clima/pesquisas", AID_PQ, {"titulo": "Formação continuada 2027 (anônima)", "perguntas": "ESCALA | Recebo as informações de que preciso.\nUNICA | Melhor turno | Manhã; Tarde\nMULTIPLA | Temas | Avaliação; Inclusão; Tecnologia\nTEXTO | O que melhorar?", "inicio": H, "fim": d(10), "publico": "UNIDADE", "unitId": CAR, "minimo": 3}, RH)
PQ = int(re.search(r"/pesquisas/(\d+)", loc).group(1)); hq = page(f"/clima/pesquisas/{PQ}", RH)
okmsg(post(f"/clima/pesquisas/{PQ}", aid_of(hq, "Abrir e avisar o público"), {"id": PQ, "acao": "ABRIR"}, RH), "avisada")
assert notif(UA, "Nova pesquisa") == 1 and notif(UD, "Nova pesquisa") == 0, "só o público (Carandá)"
page(f"/eu/pesquisas/{PQ}", D, 404)
hr = page(f"/eu/pesquisas/{PQ}", A); AID_RP = aid_of(hr, "Enviar respostas")
erro(post(f"/eu/pesquisas/{PQ}", AID_RP, {"id": PQ, "q2": "Manhã"}, A), "Responda")
okmsg(post(f"/eu/pesquisas/{PQ}", AID_RP, {"id": PQ, "q1": 4, "q2": "Manhã", "q3": ["Inclusão", "Tecnologia"], "q4": "Mais formação prática."}, A))
erro(post(f"/eu/pesquisas/{PQ}", AID_RP, {"id": PQ, "q1": 5, "q2": "Tarde"}, A), "já respondeu")
okmsg(post(f"/eu/pesquisas/{PQ}", aid_of(page(f"/eu/pesquisas/{PQ}", Bs), "Enviar respostas"), {"id": PQ, "q1": 2, "q2": "Tarde", "q3": "Avaliação"}, Bs))
assert "aguardando 1 resposta" in page(f"/clima/pesquisas/{PQ}", RH)
okmsg(post(f"/eu/pesquisas/{PQ}", aid_of(page(f"/eu/pesquisas/{PQ}", C), "Enviar respostas"), {"id": PQ, "q1": 5, "q2": "Manhã", "q3": "Inclusão"}, C))
hq = page(f"/clima/pesquisas/{PQ}", RH); assert "Mais formação prática." in hq and "Média" in hq and "3,67" in hq
assert psql(f"SELECT count(*) FROM custom_survey_responses WHERE survey_id={PQ} AND (user_id IS NOT NULL OR employee_id IS NOT NULL OR respondido_em IS NOT NULL)") == "0", "anônima não guarda quem nem quando"
csv = get(f"/api/export/pesquisa-interna?id={PQ}", RH).text; assert "só o agregado" in csv and "Ana" not in csv
loc = post("/clima/pesquisas", AID_PQ, {"titulo": "Inscrição na formação (identificada)", "perguntas": "UNICA | Vai participar? | Sim; Não", "inicio": H, "fim": d(5), "publico": "TODOS", "minimo": 5, "identificada": "1"}, RH)
PQ2 = int(re.search(r"/pesquisas/(\d+)", loc).group(1)); okmsg(post(f"/clima/pesquisas/{PQ2}", aid_of(page(f"/clima/pesquisas/{PQ2}", RH), "Abrir e avisar o público"), {"id": PQ2, "acao": "ABRIR"}, RH))
assert "o RH verá o seu nome" in page(f"/eu/pesquisas/{PQ2}", A)
okmsg(post(f"/eu/pesquisas/{PQ2}", aid_of(page(f"/eu/pesquisas/{PQ2}", A), "Enviar respostas"), {"id": PQ2, "q1": "Sim"}, A))
csv2 = get(f"/api/export/pesquisa-interna?id={PQ2}", RH).text; assert "Ana Lima Fictícia" in csv2 and "Sim" in csv2
assert get(f"/clima/pesquisas/{PQ}", G).status_code in (302, 303, 307)
ok("pesquisas: validação das perguntas; público por unidade; obrigatórias; uma resposta por pessoa; anônima sem quem/quando e resultado só com o mínimo (CSV só agregado); identificada avisa a pessoa e exporta com nome; só RH/Direção")

print("Termômetro de humor (contadores, mínimo e proteção contra diferença)")
hm = page("/eu", A); assert "Como foi a sua semana?" in hm; AID_HU = aid_of(hm, 'name="nota"')
okmsg(post("/eu", AID_HU, {"voltar": "/eu", "nota": 2, "fatores": ["Carga de trabalho", "Prazos", "Inventado"]}, A), "anônima")
erro(post("/eu", AID_HU, {"voltar": "/eu", "nota": 5}, A), "já respondeu")
SEM = psql(f"SELECT (date '{H}' - ((extract(isodow from date '{H}')::int + 6) % 7))::text")
assert psql(f"SELECT sum(n) FROM mood_counts WHERE semana='{SEM}'") == "1" and psql(f"SELECT count(*) FROM mood_factor_counts WHERE semana='{SEM}' AND fator='Inventado'") == "0"
assert psql(f"SELECT count(*) FROM audit_log WHERE acao ILIKE '%humor%' OR entidade ILIKE 'mood%'") == "0", "sem trilha"
assert "Como foi a sua semana?" not in page("/eu", A)
hh = page(f"/clima/humor?semana={SEM}", RH); assert "menos de 5 respostas" in hh
# completa o grupo: equipe da gestora com 5 respostas; o resto da unidade com 2 → equipe oculta por diferença
psql(f"INSERT INTO mood_counts (semana, unit_id, gestor_id, nota, n) VALUES ('{SEM}', {CAR}, {EG}, 4, 4) ON CONFLICT (semana, unit_id, gestor_id, nota) DO UPDATE SET n = mood_counts.n + 4")
psql(f"INSERT INTO mood_counts (semana, unit_id, gestor_id, nota, n) VALUES ('{SEM}', {CAR}, 0, 3, 2)")
hu = page(f"/clima/humor?semana={SEM}", RH); assert re.search(r"Carandá.*?3,[0-9]", hu, re.S), "unidade com 7 respostas aparece"
hl = page(f"/clima/humor?semana={SEM}&por=lideranca", RH); assert "o resto da unidade tem poucas respostas" in hl
psql(f"UPDATE mood_counts SET n=5 WHERE semana='{SEM}' AND unit_id={CAR} AND gestor_id=0")
hl = page(f"/clima/humor?semana={SEM}&por=lideranca", RH); assert "Equipe de Gestora Apoio" in hl and "o resto da unidade tem poucas respostas" not in hl
hg = page(f"/clima/humor?semana={SEM}", G); assert "Você vê só a sua equipe" in hg
assert get("/clima/humor", A).status_code in (302, 303, 307)
ok("termômetro: uma vez por semana, fatores da lista; só contadores (sem pessoa, sem trilha); grupo só com o mínimo; equipe oculta quando o resto da unidade é pequeno; gestor vê a própria equipe; colaborador não vê")

print("Escalas das equipes de apoio")
T = {r.split("|")[0]: int(r.split("|")[1]) for r in psql("SELECT sigla || '|' || id FROM shift_types").splitlines()}
he = page("/ponto/escalas?aba=equipes", RH); AID_EQ = aid_of(he, "Salvar equipe")
loc = post("/ponto/escalas", AID_EQ, {"nome": "Portaria Carandá (fictícia)", "unitId": CAR, "responsavelUserId": "", "membros": [EA, EB], "cobTurno": [T["N"], ""], "cobMin": [1, ""]}, RH)
TEAM = int(psql("SELECT id FROM shift_teams WHERE nome='Portaria Carandá (fictícia)'"))
SEG = psql(f"SELECT (date '{d(7)}' - ((extract(isodow from date '{d(7)}')::int + 6) % 7))::text"); dias = [(date.fromisoformat(SEG) + timedelta(days=i)).isoformat() for i in range(7)]
hg = page(f"/ponto/escalas?equipe={TEAM}&semana={SEG}", RH); AID_GR = aid_of(hg, "Salvar escala")
erro(post(f"/ponto/escalas?equipe={TEAM}&semana={SEG}", aid_of(page(f"/ponto/escalas?equipe={TEAM}&semana={SEG}", RH), "Salvar escala"), {"teamId": TEAM, "semana": SEG}, G), "não monta")
grade = {"teamId": TEAM, "semana": SEG, f"c_{EA}_{dias[0]}": T["N"], f"c_{EA}_{dias[1]}": T["M"], f"c_{EA}_{dias[2]}": "F"}
for x in dias: grade[f"c_{EB}_{x}"] = T["C"]
okmsg(post(f"/ponto/escalas?equipe={TEAM}&semana={SEG}", AID_GR, grade, RH), "Escala salva")
hg = page(f"/ponto/escalas?equipe={TEAM}&semana={SEG}", RH)
assert "de descanso entre N e M" in hg and "7 dias seguidos sem folga" in hg and "0 de 1 pessoa(s) no turno N" in hg, "alertas"
# a cobertura mínima vale nos dias da equipe: de segunda a sexta, o fim de semana não gera alerta (e volta a gerar com "todos os dias")
SAB = f"sáb {dias[5][8:]}/{dias[5][5:7]}: 0 de 1 pessoa(s) no turno N"; QUA = f"qua {dias[2][8:]}/{dias[2][5:7]}: 0 de 1 pessoa(s) no turno N"
assert SAB in hg and QUA in hg, "por padrão a cobertura vale todos os dias"
equipe_cob = lambda dd: post("/ponto/escalas", AID_EQ, {"id": TEAM, "nome": "Portaria Carandá (fictícia)", "unitId": CAR, "responsavelUserId": "", "membros": [EA, EB], "cobTurno": [T["N"], ""], "cobMin": [1, ""], "coberturaDias": dd}, RH)
okmsg(equipe_cob("SEG_SEX"), "Equipe salva"); hg2 = page(f"/ponto/escalas?equipe={TEAM}&semana={SEG}", RH); assert SAB not in hg2 and QUA in hg2, "segunda a sexta: sábado sem alerta"
assert "(segunda a sexta)" in page("/ponto/escalas?aba=equipes", RH)
okmsg(equipe_cob("TODOS"), "Equipe salva"); hg = page(f"/ponto/escalas?equipe={TEAM}&semana={SEG}", RH); assert SAB in hg
okmsg(post(f"/ponto/escalas?equipe={TEAM}&semana={SEG}", aid_of(hg, "Publicar e avisar a equipe"), {"teamId": TEAM, "semana": SEG}, RH), "Semana publicada")
assert notif(UA, "Escala publicada") == 1
hm = page(f"/eu", A); assert "Minha escala" in hm or dias[0] > d(13)
grade2 = dict(grade); grade2[f"c_{EA}_{dias[1]}"] = "F"; grade2["motivo"] = "Troca a pedido"
okmsg(post(f"/ponto/escalas?equipe={TEAM}&semana={SEG}", aid_of(page(f"/ponto/escalas?equipe={TEAM}&semana={SEG}", RH), "Salvar escala"), grade2, RH), "avisada")
assert psql(f"SELECT count(*) FROM shift_changes WHERE team_id={TEAM} AND employee_id={EA} AND motivo='Troca a pedido'") == "1" and notif(UA, "Sua escala mudou") == 1
hn = page(f"/ponto/escalas?equipe={TEAM}&semana={dias[6]}", RH)
nxt = (date.fromisoformat(SEG) + timedelta(days=7)).isoformat()
okmsg(post(f"/ponto/escalas?equipe={TEAM}&semana={nxt}", aid_of(page(f"/ponto/escalas?equipe={TEAM}&semana={nxt}", RH), "Copiar semana anterior"), {"teamId": TEAM, "semana": nxt}, RH), "copiado")
assert int(psql(f"SELECT count(*) FROM shift_assignments WHERE team_id={TEAM} AND data >= '{nxt}'")) >= 9
okmsg(post(f"/ponto/escalas?equipe={TEAM}&semana={nxt}", aid_of(page(f"/ponto/escalas?equipe={TEAM}&semana={nxt}", RH), "Aplicar padrão"), {"teamId": TEAM, "semana": nxt, "padrao": "12x36", "turnoId": T["N"], "employeeId": EA, "comeca": "1"}, RH), "Padrão aplicado")
assert psql(f"SELECT string_agg(CASE WHEN folga THEN 'F' ELSE 'T' END, '' ORDER BY data) FROM shift_assignments WHERE team_id={TEAM} AND employee_id={EA} AND data >= '{nxt}'") == "TFTFTFT"
# jornada esperada: publica a semana atual com o noturno para Ana e confere o espelho calculado
SEG0 = psql(f"SELECT (date '{H}' - ((extract(isodow from date '{H}')::int + 6) % 7))::text")
psql(f"INSERT INTO shift_assignments (team_id, employee_id, data, shift_type_id, folga) VALUES ({TEAM}, {EA}, '{SEG0}', {T['N']}, false) ON CONFLICT (team_id, employee_id, data) DO UPDATE SET shift_type_id=EXCLUDED.shift_type_id, folga=false")
psql(f"INSERT INTO shift_publications (team_id, semana) VALUES ({TEAM}, '{SEG0}') ON CONFLICT DO NOTHING")
psql(f"DELETE FROM timesheet_days WHERE employee_id={EA} AND data='{SEG0}'")
espe = get(f"/api/export/meu-espelho?mes={SEG0[:7]}", A).text
assert re.search(r"660|11:00|11h", espe), espe[:500]
ok("escalas: equipe com cobertura; só quem monta edita; alertas de descanso (11 h), 7 dias sem folga e cobertura; publicar avisa; mudança depois de publicada registra motivo e avisa; copiar semana; padrão 12x36; escala publicada vira a jornada esperada no espelho")

print("Estoque e EPIs (validade, custo médio, transferência, inventário, baixa na entrega e termo assinado)")
hi = page("/operacoes/estoque?aba=itens", OP); AID_LOC = aid_of(hi, 'placeholder="ex.: Almoxarifado, Cozinha, Limpeza"')
okmsg(post("/operacoes/estoque", AID_LOC, {"unitId": CAR, "nome": "Almoxarifado Carandá"}, OP)); okmsg(post("/operacoes/estoque", AID_LOC, {"unitId": CAR, "nome": "Cozinha Carandá"}, OP))
L1 = int(psql("SELECT id FROM stock_locations WHERE nome='Almoxarifado Carandá'")); L2 = int(psql("SELECT id FROM stock_locations WHERE nome='Cozinha Carandá'"))
hs = page("/sst/conformidade", RH); okmsg(post("/sst/conformidade", aid_of(hs, 'name="caValidade"'), {"nome": "Luva nitrílica (fictícia)", "ca": "12345", "troca": 30, "caValidade": d(20)}, RH))
EPI = int(psql("SELECT id FROM epi_items WHERE nome='Luva nitrílica (fictícia)'"))
hi = page("/operacoes/estoque?aba=itens", OP); AID_IT = aid_of(hi, "Salvar item")
okmsg(post("/operacoes/estoque", AID_IT, {"nome": "Detergente neutro 5 L (fictício)", "categoria": "Limpeza", "um": "galão", "minimo": "4", "validade": "1", "locais": [L1, L2]}, OP))
okmsg(post("/operacoes/estoque", AID_IT, {"nome": "Luva nitrílica par (fictícia)", "categoria": "EPI", "um": "par", "minimo": "10", "epiId": EPI, "locais": [L1]}, OP))
DET = int(psql("SELECT id FROM stock_items WHERE nome LIKE 'Detergente%'")); LUV = int(psql("SELECT id FROM stock_items WHERE nome LIKE 'Luva nitrílica par%'"))
hmv = page("/operacoes/estoque?aba=movimentar", OP); AID_MV = aid_of(hmv, 'name="quantidade"')
mv = lambda sess, **k: post("/operacoes/estoque", AID_MV, {"voltar": "/operacoes/estoque?aba=movimentar", **k}, sess)
erro(mv(OP, tipo="ENTRADA", itemId=DET, locationId=L1, quantidade=10, custo="5,00"), "informe a validade")
okmsg(mv(OP, tipo="ENTRADA", itemId=DET, locationId=L1, quantidade=10, custo="5,00", validade=d(60), lote="A1"))
okmsg(mv(OP, tipo="ENTRADA", itemId=DET, locationId=L1, quantidade=10, custo="7,00", validade=d(15), lote="B2"))
assert psql(f"SELECT custo_medio::numeric(10,2) FROM stock_items WHERE id={DET}") == "6.00", "custo médio ponderado"
erro(mv(OP, tipo="SAIDA", itemId=DET, locationId=L1, quantidade=25), "Saldo insuficiente")
okmsg(mv(OP, tipo="SAIDA", itemId=DET, locationId=L1, quantidade=12, motivo="Requisição da limpeza"))
assert psql(f"SELECT string_agg(lote || ':' || saldo::int, ',' ORDER BY lote) FROM stock_lots WHERE item_id={DET} AND location_id={L1}") == "A1:8,B2:0", "sai primeiro o que vence primeiro"
okmsg(mv(OP, tipo="TRANSFERENCIA", itemId=DET, locationId=L1, destinoId=L2, quantidade=3))
assert psql(f"SELECT string_agg(location_id || ':' || saldo::int, ',' ORDER BY location_id) FROM stock_levels WHERE item_id={DET}") == f"{L1}:5,{L2}:3"
assert psql(f"SELECT string_agg(tipo || '|' || sinal, ',' ORDER BY id) FROM (SELECT * FROM stock_moves WHERE item_id={DET} ORDER BY id DESC LIMIT 2) x") == "TRANSFERENCIA|-1,TRANSF_ENTRADA|1", "as duas pontas da transferência"
erro(mv(OP, tipo="PERDA", itemId=DET, locationId=L2, quantidade=1), "Explique")
erro(mv(DIRC, tipo="ENTRADA", itemId=DET, locationId=L1, quantidade=1, custo="1", validade=d(30)), "outra unidade")
hinv = page(f"/operacoes/estoque?aba=inventario&local={L1}", OP); okmsg(post("/operacoes/estoque", aid_of(hinv, "Registrar contagem"), {"locationId": L1, f"q_{DET}": "4", "motivo": "Inventário mensal"}, OP), "1 item")
assert psql(f"SELECT tipo || '|' || sinal || '|' || quantidade::int FROM stock_moves WHERE item_id={DET} ORDER BY id DESC LIMIT 1") == "AJUSTE|-1|1"
okmsg(mv(OP, tipo="ENTRADA", itemId=LUV, locationId=L1, quantidade=12, custo="2,50"))
hs = page("/sst/conformidade", RH); AID_ENT = aid_of(hs, 'name="termoModo"')
okmsg(post("/sst/conformidade", AID_ENT, {"employeeId": EC, "epiId": EPI, "data": H, "quantidade": 3, "termoModo": "ONE", "locationId": L1}, RH), "Baixa feita")
assert psql(f"SELECT saldo::int FROM stock_levels WHERE item_id={LUV} AND location_id={L1}") == "9" and psql(f"SELECT tipo || '|' || (epi_delivery_id IS NOT NULL) || '|' || employee_id FROM stock_moves WHERE item_id={LUV} ORDER BY id DESC LIMIT 1") == f"ENTREGA_EPI|true|{EC}"
DLV = int(psql(f"SELECT id FROM epi_deliveries WHERE employee_id={EC} ORDER BY id DESC LIMIT 1")); RT = int(psql(f"SELECT sign_request_id FROM epi_deliveries WHERE id={DLV}"))
assert psql(f"SELECT d.tipo FROM sign_requests r JOIN sign_documents d ON d.id=r.document_id WHERE r.id={RT}") == "TERMO_EPI"
ht = page(f"/eu/assinaturas/{RT}", C); okmsg(post(f"/eu/assinaturas/{RT}", aid_of(ht, "Sua senha do ONE"), {"requestId": RT, "li": "1", "senha": "senha12345"}, C), "assinado")
assert psql(f"SELECT termo_assinado FROM epi_deliveries WHERE id={DLV}") == "t"
tt = texto_pdf(get(f"/api/assinaturas/{psql(f'SELECT document_id FROM sign_requests WHERE id={RT}')}", C).content); assert "TERMO DE ENTREGA" in tt and "12345" in tt and CPFS[EC] not in tt
psql(f"INSERT INTO stock_lots (item_id, location_id, lote, validade, saldo) VALUES ({DET}, {L2}, 'C3', '{d(-1)}', 1)")
hpn = page("/operacoes/estoque", OP); assert "Abaixo do mínimo" in hpn and "vencido em" in hpn and "CA vence" in hpn
assert "abaixo do mínimo" in page("/pendencias", OP)
csv = get("/api/export/estoque", OP).text; assert "Detergente neutro" in csv and "sim" in csv
ok("estoque: validade obrigatória no item que controla; custo médio ponderado; saldo nunca negativo; FEFO; transferência; perda com motivo; escopo por unidade; inventário vira ajuste; EPI ligado: baixa na entrega e termo gerado e assinado no ONE (CPF mascarado); painel com mínimo, validade e CA; pendência e CSV")

print("Reações, liderados em lote, parabéns, evolução salarial, férias com abono, pedidos confidenciais")
hc = page("/comunicacao/comunicados", RH); AID_COM = aid_of(hc, 'name="titulo"')
post("/comunicacao/comunicados", AID_COM, {"titulo": "Comunicado de teste v34", "texto": "Texto do comunicado fictício.", "publico": "TODOS"}, RH)
AN = int(psql("SELECT id FROM announcements WHERE titulo='Comunicado de teste v34'")); psql(f"UPDATE announcements SET status='PUBLICADO', publicado_em=coalesce(publicado_em, now()) WHERE id={AN}")
hca = page("/comunicacao/comunicados", A); AID_RX = aid_of(hca, 'value="👍"')
post("/comunicacao/comunicados", AID_RX, {"id": AN, "emoji": "👍"}, A); post("/comunicacao/comunicados", AID_RX, {"id": AN, "emoji": "👍"}, Bs); post("/comunicacao/comunicados", AID_RX, {"id": AN, "emoji": "💣"}, A)
assert psql(f"SELECT count(*) FROM announcement_reactions WHERE announcement_id={AN}") == "2"
post("/comunicacao/comunicados", AID_RX, {"id": AN, "emoji": "👍"}, A); assert psql(f"SELECT count(*) FROM announcement_reactions WHERE announcement_id={AN}") == "1", "segundo toque desmarca"
# liderados em lote (com ciclo bloqueado)
EX = emp("Xavier Coordenador Fictício", gestor=EG); EY = emp("Yara Liderada Fictícia", gestor=EX)
ho = page(f"/organograma?p={EG}", RH); AID_MOV = aid_of(ho, 'name="novoGestor"')
erro(post("/organograma", AID_MOV, {"gestorAtual": EG, "liderados": [EX], "novoGestor": EY, "data": H}, RH), "círculo")
erro(post("/organograma", AID_MOV, {"gestorAtual": EG, "liderados": [EA, EB], "novoGestor": EX, "data": H}, G), "Só RH e Direção")
okmsg(post("/organograma", AID_MOV, {"gestorAtual": EG, "liderados": [EA, EB], "novoGestor": EX, "data": H, "motivo": "Reestruturação da portaria"}, RH), "2 pessoa(s)")
assert psql(f"SELECT count(*) FROM employees WHERE gestor_id={EX} AND id IN ({EA},{EB})") == "2" and int(psql(f"SELECT count(*) FROM employee_moves WHERE employee_id IN ({EA},{EB}) AND tipo='MUDANCA_GESTOR'")) >= 2
assert notif(UA, "Seu gestor direto mudou") == 1
# parabéns
psql(f"UPDATE employees SET data_nascimento = make_date(1990, extract(month FROM date '{H}')::int, extract(day FROM date '{H}')::int) WHERE id={EC}")
hm = page("/eu", A); assert "Aniversariantes da sua unidade" in hm; AID_PB = aid_of(hm, f'name="employeeId" value="{EC}"')
okmsg(post("/eu", AID_PB, {"employeeId": EC, "voltar": "/eu", "mensagem": "Feliz aniversário, Carla!"}, A), "Parabéns enviados")
erro(post("/eu", AID_PB, {"employeeId": EC, "voltar": "/eu"}, A), "já deu parabéns")
erro(post("/eu", AID_PB, {"employeeId": EB, "voltar": "/eu"}, A), "Pessoa não encontrada")
assert notif(UC, "Parabéns") == 1 and "Feliz aniversário, Carla!" in page("/eu", C)
# evolução salarial (só a pessoa; valores escondidos até abrir)
psql(f"INSERT INTO salary_history (employee_id, data, salario_anterior, salario, motivo) VALUES ({EA}, '2024-03-01', 3000, 3200, 'MERITO')")
hm = page("/eu", A); assert "Minha evolução salarial" in hm and "+6,7%" in hm
hcf = page("/configuracoes", RH); AID_V34 = aid_of(hcf, 'name="termometroAtivo"')
base_cfg = {"prazoDias": 7, "espelhoPrazoDias": 5, "lembreteDiasAntes": 2, "conviteDias": 7, "maxEnviosAdmissao": 3, "maxPedidosAbertos": 3, "permitirAjustePonto": "1", "permitirAtestado": "1", "mostrarAniversariantes": "1", "ajustePontoDiasMax": 35, "termometroAtivo": "1", "minimoGrupo": 5, "alertaMedia": "2,5", "fatores": "Carga de trabalho\nPrazos\nLiderança", "interjornadaHoras": 11, "jornadaMaxHoras": 10, "diasAvisoPublicacao": 2, "exigirFolgaSemanal": "1", "alertaValidadeDias": 30, "alertaCaDias": 60, "categorias": "Limpeza\nEPI\nOutros"}
erro(post("/configuracoes", AID_V34, {**base_cfg, "minimoGrupo": 1}, RH), "Mínimo do grupo")
erro(post("/configuracoes", AID_V34, {**base_cfg, "categorias": "EPI\nOutros"}, RH), "Categoria em uso")
okmsg(post("/configuracoes", AID_V34, {**base_cfg, "categorias": "Limpeza\nEPI\nCozinha e refeitório\nOutros"}, RH), "v34 salvos")
assert "Minha evolução salarial" not in page("/eu", A), "desligada nas configurações"
okmsg(post("/configuracoes", AID_V34, {**base_cfg, "categorias": "Limpeza\nEPI\nOutros", "mostrarEvolucaoSalarial": "1", "permitirAtestado": ""}, RH))
erro(post("/eu", AID_AT, {"tipo": "DIAS", "inicio": d(-1)}, A, {"arquivo": foto()}), "desligado")
# férias com abono (até 10) e 13º junto
psql(f"UPDATE employees SET admissao='2023-01-02' WHERE id={EB}")
hm = page("/eu", Bs); AID_FER = aid_of(hm, 'name="abonoDias"')
erro(post("/eu", AID_FER, {"employeeId": EB, "tipo": "FERIAS", "inicio": d(30), "fim": d(54), "abonoDias": 10}, Bs), "passam do saldo")
okmsg(post("/eu", AID_FER, {"employeeId": EB, "tipo": "FERIAS", "inicio": d(30), "fim": d(49), "abonoDias": 10, "adiantar13": "1"}, Bs))
assert psql(f"SELECT dias || '|' || abono_dias || '|' || adiantar_13 FROM leave_requests WHERE employee_id={EB} AND tipo='FERIAS' ORDER BY id DESC LIMIT 1") == "20|10|true"
assert "10 vendido(s)" in page("/ferias?status=SOLICITADA", RH)
# pedido confidencial: Fale com o RH
FR = int(psql("SELECT id FROM request_types WHERE codigo='FALE_RH'")); hn = page(f"/solicitacoes/nova?tipo={FR}", A)
post(f"/solicitacoes/nova?tipo={FR}", aid_of(hn, 'name="campo_assunto"'), {"typeId": FR, "titulo": "Dúvida pessoal", "campo_assunto": "Assunto pessoal", "campo_mensagem": "Mensagem confidencial de teste."}, A)
RQ = psql(f"SELECT id FROM requests WHERE type_id={FR} ORDER BY id DESC LIMIT 1"); assert RQ, "pedido aberto"
assert get(f"/solicitacoes/{RQ}", FS).status_code == 404 and "Dúvida pessoal" not in page("/solicitacoes?aba=todas", FS) and get(f"/solicitacoes/{RQ}", RH).status_code == 200 and get(f"/solicitacoes/{RQ}", A).status_code == 200
ok("reações (marca/desmarca, emoji fora da lista ignorado); liderados em lote com ciclo bloqueado e movimentação no histórico; parabéns na janela, um por ano; evolução salarial (liga/desliga); parâmetros validados; férias com abono até o saldo e 13º; Fale com o RH confidencial (fora do Financeiro)")

print("Pendências, rotina, menu e exportações")
pa = page("/pendencias", A); assert "Conferir e assinar o espelho" in pa, "espelho revisado aguarda a Ana"
rt = mk().get(B + f"/api/tarefas?token={TOKEN}").json(); assert rt["ok"], rt; v34 = rt["v34"]; assert not v34["falhas"], v34
psql(f"UPDATE admission_invites SET expira_em='{d(-3)}', estado='ATIVO' WHERE id=(SELECT max(id) FROM admission_invites)"); psql(f"UPDATE custom_surveys SET fim='{d(-1)}' WHERE id={PQ2}")
v34b = mk().get(B + f"/api/tarefas?token={TOKEN}").json()["v34"]; assert v34b["convitesExpirados"] >= 1 and v34b["pesquisasEncerradas"] == 1, v34b
menu_rh = page("/", RH)
for t in ["Assinatura eletrônica", "Dividir PDF da folha por pessoa", "Alterações cadastrais", "Ajustes de ponto (pedidos)", "Atestados recebidos", "Escalas das equipes", "Pesquisas internas", "Termômetro de humor", "Estoque e EPIs"]: assert t in menu_rh, t
menu_col = page("/eu", A)
for t in ["Meus documentos", "Documentos para assinar", "Meus dados e dependentes"]: assert t in menu_col, t
for t in ["alteracoes-cadastrais", "ajustes-ponto", "atestados", "humor"]:
    r = get(f"/api/export/{t}", RH); assert r.status_code == 200 and r.text.strip(), t
assert get("/api/export/atestados", G).status_code == 403 and get("/api/export/alteracoes-cadastrais", A).status_code in (401, 403, 302, 307)
assert CPFS[EA] not in get("/api/export/alteracoes-cadastrais", RH).text
ok("pendências; rotina (lembretes, convites expirados, pesquisas encerradas, estoque e escalas) sem falhas; menu com as telas novas (RH e colaborador); CSVs com acesso por perfil e sem CPF")
print(f"\nOK — {N[0]} blocos verificados.")
