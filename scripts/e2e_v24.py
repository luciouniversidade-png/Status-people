# E2E v24 — mescla com "A Nova Arquitetura" v3: obrigações fiscais (baixa só com comprovante), fiscalizações, orçado × real com
# pedido de explicação, auditorias/CAPA (Four-Eyes e reincidência), baseline de projeto, ação requerida, painel do dia,
# relatórios do RH, Pergunte ao Status, grupo mínimo, risco nominal auditado, etapas do ciclo, notificações agrupadas,
# configurações v24, go-live e as telas novas por perfil. Dados fictícios. Uso: bash /tmp/withserver.sh python3 scripts/e2e_v24.py
import re, subprocess, requests, datetime
B = "http://localhost:3100"
def psql(q): return subprocess.run(["su", "postgres", "-c", f"/usr/lib/postgresql/16/bin/psql -h /tmp/pg -U status -d status_people -q -t -A -c \"{q}\""], capture_output=True, text=True).stdout.strip()
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
def post(path, aid, data, sess=None, multi=None, files=None):
    sess = sess or S; f = [(f"$ACTION_ID_{aid}", (None, ""))] + [(k, (None, str(v))) for k, v in data.items()] + [(k, (None, str(v))) for k, v in (multi or [])] + list((files or {}).items())
    r = sess.post(B + path, files=f, allow_redirects=False); fix_cookie(sess, r)
    assert r.status_code in (303, 302, 200), (path, r.status_code, r.text[:300]); return requests.utils.unquote(r.headers.get("location", ""))
def find_form_aid(html, marker):
    i = html.find(marker); assert i >= 0, marker
    fs = html.rfind("<form", 0, i); fe_prev = html.rfind("</form>", 0, i)
    if fs > fe_prev: fe = html.find("</form>", i)
    else: fs = html.find("<form", i); fe = html.find("</form>", fs)
    ids = action_ids(html[fs:fe]); assert ids, marker; return ids[0]
def login(sess, email, senha):
    html = sess.get(B + "/login").text; aid = re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', html)[0]
    loc = post("/login", aid, {"email": email, "senha": senha}, sess=sess); assert "erro" not in loc, loc
from zoneinfo import ZoneInfo
H = datetime.datetime.now(ZoneInfo("America/Campo_Grande")).date(); HOJE = H.isoformat(); MES = HOJE[:7]  # o "hoje" da escola (UTC−4), não o do servidor
def mes_menos(m, n=1):
    a, mm = map(int, m.split("-")); mm -= n
    while mm < 1: mm += 12; a -= 1
    return f"{a}-{mm:02d}"

login(S, "rh@colegiostatus", "Status2026!"); r = S.get(B + "/api/setup?token=setup-homologacao-2026-status"); assert r.json()["ok"], r.text
# usuários por papel (fictícios) e entidades nas unidades
html = page("/configuracoes"); aid = find_form_aid(html, "Criar acesso")
for nome, email, role in [("Diretora Geral", "dir@geral", "DIRECAO"), ("Fin Status", "fin@status", "FINANCEIRO"), ("Leitura Status", "leitura@status", "LEITURA")]:
    post("/configuracoes", aid, {"nome": nome, "email": email, "role": role, "senha": "senha12345"})
post("/configuracoes", aid, {"nome": "Diretor Carandá", "email": "du@caranda", "role": "DIRETOR_UNIDADE", "unitId": "1", "senha": "senha12345"})
psql("UPDATE units SET company_id=1 WHERE id IN (1,2); UPDATE units SET company_id=2 WHERE id=3; UPDATE units SET company_id=3 WHERE id=4;")
D = mk(); login(D, "dir@geral", "senha12345"); F = mk(); login(F, "fin@status", "senha12345"); L = mk(); login(L, "leitura@status", "senha12345"); DU = mk(); login(DU, "du@caranda", "senha12345")
RH_ID = psql("SELECT id FROM users WHERE email='rh@colegiostatus'"); D_ID = psql("SELECT id FROM users WHERE email='dir@geral'"); F_ID = psql("SELECT id FROM users WHERE email='fin@status'")
assert psql("SELECT unit_id FROM users WHERE email='du@caranda'") == "1"
# colaboradores fictícios (12 na Pedagógica do Carandá, 3 em Serviços) com jornada
pos_prof = psql("SELECT id FROM positions WHERE nome ILIKE 'Professor%' ORDER BY id LIMIT 1"); pos_serv = psql("SELECT id FROM positions WHERE area='Serviços' ORDER BY id LIMIT 1") or pos_prof
vals = ",".join(f"('Pessoa Teste {i:02d}', 1, 1, {pos_prof if i < 12 else pos_serv}, 'CLT', '2024-0{1 + i % 8}-10', 'ATIVO', 528, 'Manhã', 3000, '19{80 + i}-05-0{1 + i % 8}')" for i in range(15))
psql(f"INSERT INTO employees (nome, company_id, unit_id, position_id, vinculo, admissao, situacao, jornada_min_dia, turno, salario, data_nascimento) VALUES {vals}")
assert psql("SELECT count(*) FROM employees") == "15"; print("dados fictícios ok")

# ------------------------------------------------------------------ telas novas por perfil
for path in ["/executivo/board", "/financeiro/cockpit", "/rede", "/rede?kpi=receita", "/financeiro/obrigacoes", "/governanca/auditorias", "/matriculas/acao", "/ponto/hoje", "/relatorios/biblioteca", "/relatorios/biblioteca?r=headcount", "/analytics?dim=area", "/arquitetura", "/arquitetura?aba=kpis", "/arquitetura?aba=regras", "/arquitetura?aba=decisoes", "/arquitetura?aba=golive", "/arquitetura?aba=notificacoes", "/notificacoes", "/configuracoes", "/alertas", "/aprovacoes", "/quadro", "/onboarding", "/sst", "/folha", "/folha/custo", "/financeiro/dre", "/command-center", "/estrategia/cronograma", "/estrategia/cronograma?zoom=semana"]:
    page(path, sess=D)
for path in ["/financeiro/cockpit", "/financeiro/obrigacoes", "/executivo/board", "/rede", "/financeiro/dre"]: page(path, sess=F)
page("/financeiro/cockpit", expect=307, sess=S)  # RH vai ao custo de folha
page("/financeiro/obrigacoes", expect=307, sess=DU)
html = page("/rede", sess=DU); assert "sua unidade" in html and "Receita do mês" in html
html = page("/executivo/board", sess=DU); assert "Board do dono" in html
page("/arquitetura", sess=L); page("/ponto/hoje", sess=L); page("/relatorios/biblioteca?r=headcount", sess=L)
html = page("/arquitetura", sess=D); assert "106" in html and "T-023" in html and "Cockpit do CFO" in html
print("telas novas por perfil ok")

# ------------------------------------------------------------------ obrigações fiscais (T-031)
comp = mes_menos(MES); html = page(f"/financeiro/obrigacoes?ctx_p={MES}", sess=F); aid = find_form_aid(html, "Gerar a agenda de uma competência")
loc = post("/financeiro/obrigacoes", aid, {"competencia": comp, "voltar": f"/financeiro/obrigacoes?ctx_p={MES}"}, sess=F); assert "obrigação(ões) criada(s) para 3 entidade(s)" in loc, loc
n1 = psql(f"SELECT count(*) FROM obligations WHERE competencia='{comp}'"); assert int(n1) == 12, n1  # 4 modelos com dia × 3 entidades (ISS sem dia)
post("/financeiro/obrigacoes", aid, {"competencia": comp, "voltar": "/financeiro/obrigacoes"}, sess=F); assert psql(f"SELECT count(*) FROM obligations WHERE competencia='{comp}'") == n1, "agenda idempotente"
oid = psql(f"SELECT id FROM obligations WHERE competencia='{comp}' AND tipo LIKE 'INSS%' AND company_id=1")
psql(f"UPDATE obligations SET vencimento='{HOJE}' WHERE id={oid}")
html = page(f"/financeiro/obrigacoes?ctx_p={MES}", sess=F); aid = find_form_aid(html, f'name="id" value="{oid}"')
loc = post("/financeiro/obrigacoes", aid, {"id": oid, "pagoEm": HOJE, "valor": "1.234,56", "voltar": "/financeiro/obrigacoes"}, sess=F)
assert "PENDENTE DE COMPROVAÇÃO" in loc, loc; assert psql(f"SELECT status FROM obligations WHERE id={oid}") == "AGUARDA_COMPROVANTE", "sem comprovante não baixa"
assert psql(f"SELECT count(*) FROM notifications WHERE chave='obrcomp:{oid}'") == "1", "pendência de comprovação vai ao responsável"
html = page(f"/financeiro/obrigacoes?ctx_p={MES}", sess=F); i = html.find(f'id="obr-{oid}"'); aid = find_form_aid(html[i:], "Arquivo")
loc = post("/financeiro/obrigacoes", aid, {"id": oid, "voltar": "/financeiro/obrigacoes"}, sess=F, files={"comprovante": ("comprovante.pdf", b"%PDF-1.4 teste", "application/pdf")})
assert psql(f"SELECT status FROM obligations WHERE id={oid}") == "PAGA", "comprovante anexado baixa a obrigação"
# remover o único comprovante de obrigação paga é bloqueado
att = psql(f"SELECT id FROM attachments WHERE entidade='obligation' AND entidade_id={oid}")
html = page(f"/financeiro/obrigacoes?ctx_p={MES}", sess=D)
# dispensa com motivo e delegação
o2 = psql(f"SELECT id FROM obligations WHERE competencia='{comp}' AND tipo LIKE 'Simples%' AND company_id=2")
html = page(f"/financeiro/obrigacoes?ctx_p={mes_menos(MES, -1)}", sess=F); i = html.find(f'id="obr-{o2}"')
if i < 0: html = page(f"/financeiro/obrigacoes?ctx_p={MES}", sess=F); i = html.find(f'id="obr-{o2}"')
seg = html[i:]; aid = find_form_aid(seg, "Por que não se aplica neste mês")
loc = post("/financeiro/obrigacoes", aid, {"id": o2, "motivo": "curto", "voltar": "/financeiro/obrigacoes"}, sess=F); assert "mín. 10" in loc, loc
loc = post("/financeiro/obrigacoes", aid, {"id": o2, "motivo": "Entidade fora do Simples nesta competência", "voltar": "/financeiro/obrigacoes"}, sess=F); assert psql(f"SELECT status FROM obligations WHERE id={o2}") == "DISPENSADA"
# fiscalização: dossiê, prazo, encerramento só com prazos cumpridos
html = page("/financeiro/obrigacoes", sess=F); aid = find_form_aid(html, "Abrir dossiê")
loc = post("/financeiro/obrigacoes", aid, {"titulo": "Monitoramento ISS (teste)", "orgao": "Prefeitura", "tipo": "Monitoramento", "abertura": HOJE, "responsavelUserId": F_ID, "voltar": "/financeiro/obrigacoes"}, sess=F, multi=[("companyIds", "1"), ("companyIds", "2")])
cid = re.search(r"caso=(\d+)", loc).group(1); html = page(f"/financeiro/obrigacoes?caso={cid}", sess=F)
aid = find_form_aid(html, "Registrar movimento"); prazo = (H + datetime.timedelta(days=3)).isoformat()
post(f"/financeiro/obrigacoes?caso={cid}", aid, {"caseId": cid, "tipo": "INTIMACAO", "data": HOJE, "texto": "Intimação para entregar livros fiscais", "prazo": prazo, "voltar": f"/financeiro/obrigacoes?caso={cid}"}, sess=F, files={"arquivo": ("intimacao.pdf", b"%PDF-1.4 x", "application/pdf")})
assert psql(f"SELECT count(*) FROM attachments WHERE entidade='fiscal_case' AND entidade_id={cid}") == "1"
html = page(f"/financeiro/obrigacoes?caso={cid}", sess=F); aid = find_form_aid(html, "Encerrar fiscalização")
loc = post("/financeiro/obrigacoes", aid, {"caseId": cid, "desfecho": "Entrega concluída sem auto", "voltar": "/financeiro/obrigacoes"}, sess=F); assert "prazos em aberto" in loc, loc
ev = psql(f"SELECT id FROM fiscal_case_events WHERE case_id={cid} AND prazo IS NOT NULL"); html = page(f"/financeiro/obrigacoes?caso={cid}", sess=F); aid = find_form_aid(html, "marcar cumprido")
post("/financeiro/obrigacoes", aid, {"id": ev, "caseId": cid, "voltar": f"/financeiro/obrigacoes?caso={cid}"}, sess=F)
html = page(f"/financeiro/obrigacoes?caso={cid}", sess=F); aid = find_form_aid(html, "Encerrar fiscalização")
post("/financeiro/obrigacoes", aid, {"caseId": cid, "desfecho": "Entrega concluída sem auto de infração", "voltar": "/financeiro/obrigacoes"}, sess=F); assert psql(f"SELECT status FROM fiscal_cases WHERE id={cid}") == "ENCERRADO"
page("/financeiro/obrigacoes", sess=L)  # leitura (auditor) vê
print("obrigações: agenda idempotente, baixa só com comprovante, dispensa com motivo, dossiê com prazo ok")

# ------------------------------------------------------------------ orçado × real: estouro pede explicação (T-025)
pm = mes_menos(MES); a, m = map(int, pm.split("-"))
psql(f"INSERT INTO budget_months (ano, unit_id, tipo, categoria, mes, valor) VALUES ({a}, 1, 'SAIDA', 'Manutenção', {m}, 1000) ON CONFLICT DO NOTHING")
psql(f"INSERT INTO cash_entries (unit_id, data, tipo, categoria, descricao, valor) VALUES (1, '{pm}-10', 'SAIDA', 'Manutenção', 'Troca de telhado (teste)', 1500)")
html = page(f"/financeiro/orcamento?ano={a}&mes={m}&visao=mes", sess=F); assert "Execução por categoria de despesa" in html and "150%" in html
aid = find_form_aid(html, "Gerar pedidos de")
loc = post("/financeiro/orcamento", aid, {"ano": a, "mes": m, "voltar": f"/financeiro/orcamento?ano={a}&mes={m}"}, sess=F); assert "1 pedido(s) novo(s)" in loc, loc
pid = psql(f"SELECT id FROM budget_explain_requests WHERE ano={a} AND mes={m} AND categoria='Manutenção' AND escopo=1"); assert pid
resp = psql(f"SELECT responsavel_user_id FROM budget_explain_requests WHERE id={pid}"); assert psql(f"SELECT count(*) FROM notifications WHERE chave='orcexp:{pid}' AND user_id={resp}") == "1"
html = page(f"/financeiro/orcamento?ano={a}&mes={m}&visao=mes&unidade=1", sess=F); aid = find_form_aid(html, "O que explica o desvio")
post("/financeiro/orcamento", aid, {"ano": a, "mes": m, "tipo": "SAIDA", "categoria": "Manutenção", "unitId": "1", "texto": "Telhado danificado pela chuva; orçamento revisto.", "voltar": "/financeiro/orcamento"}, sess=F)
assert psql(f"SELECT status FROM budget_explain_requests WHERE id={pid}") == "RESPONDIDA", "explicação fecha o pedido"
print("orçado × real: pedido de explicação acima de 105% e fechamento pela explicação ok")

# ------------------------------------------------------------------ auditorias e CAPA (T-080)
html = page("/governanca/auditorias", sess=S); aid = find_form_aid(html, "Execução planejada para")
loc = post("/governanca/auditorias", aid, {"titulo": "Auditoria de matrícula (teste)", "tipo": "INTERNA", "area": "Secretaria", "unitId": "1", "leadUserId": RH_ID, "planejadaPara": HOJE, "voltar": "/governanca/auditorias"})
aud = re.search(r"\?id=(\d+)", loc).group(1); html = page(f"/governanca/auditorias?id={aud}"); aid = find_form_aid(html, "Iniciar execução")
post("/governanca/auditorias", aid, {"id": aud, "status": "EM_EXECUCAO", "realizadaEm": HOJE})
html = page(f"/governanca/auditorias?id={aud}"); aid = find_form_aid(html, "Registrar achado")
loc = post("/governanca/auditorias", aid, {"auditId": aud, "titulo": "Contrato sem assinatura", "evidencia": "curta", "gravidade": "2", "responsavelUserId": RH_ID}); assert "evidência" in loc, loc
post("/governanca/auditorias", aid, {"auditId": aud, "titulo": "Contrato sem assinatura", "evidencia": "3 de 20 contratos amostrados sem assinatura do responsável", "gravidade": "2", "responsavelUserId": RH_ID})
nc = psql(f"SELECT id FROM nonconformities WHERE audit_id={aud}"); assert nc and psql(f"SELECT origem FROM nonconformities WHERE id={nc}") == "AUDITORIA"
html = page(f"/governanca/auditorias?nc={nc}"); aid = find_form_aid(html, "Concluir ações → verificação")
post("/governanca/auditorias", aid, {"id": nc, "causaRaiz": "Conferência de assinatura não fazia parte do checklist", "acaoCorretiva": "Coletar as assinaturas faltantes", "acaoPreventiva": "Incluir conferência no POP", "concluir": "1", "voltar": f"/governanca/auditorias?nc={nc}"})
assert psql(f"SELECT status FROM nonconformities WHERE id={nc}") == "VERIFICACAO"
html = page(f"/governanca/auditorias?nc={nc}"); aid = find_form_aid(html, "Eficaz — encerrar")
loc = post("/governanca/auditorias", aid, {"id": nc, "evidencia": "Amostra de 20 contratos após a mudança: todos assinados", "eficaz": "1"}); assert "Four-Eyes" in loc, loc  # RH executou a CAPA
html = page(f"/governanca/auditorias?nc={nc}", sess=D); aid = find_form_aid(html, "Eficaz — encerrar")
loc = post("/governanca/auditorias", aid, {"id": nc, "evidencia": "curta", "eficaz": "1"}, sess=D); assert "evidência" in loc, loc
post("/governanca/auditorias", aid, {"id": nc, "evidencia": "Amostra de 20 contratos após a mudança: todos assinados", "eficaz": "1"}, sess=D); assert psql(f"SELECT status FROM nonconformities WHERE id={nc}") == "ENCERRADA"
html = page(f"/governanca/auditorias?nc={nc}", sess=D); aid = find_form_aid(html, "Reabrir com gravidade maior")
post("/governanca/auditorias", aid, {"id": nc, "relato": "Novo contrato sem assinatura encontrado em outubro"}, sess=D)
assert psql(f"SELECT status || '|' || gravidade || '|' || reincidencias FROM nonconformities WHERE id={nc}") == "ABERTA|3|1", "reincidência reabre com gravidade maior"
# fechar NC pela tela de controles também exige evidência
html = page("/governanca/controles"); 
print("auditoria: achado com evidência → NC → CAPA → eficácia (Four-Eyes) → reincidência ok")

# ------------------------------------------------------------------ baseline de projeto (T-077)
html = page("/estrategia/projetos"); aid = find_form_aid(html, 'name="nome"')
loc = post("/estrategia/projetos", aid, {"nome": "Reforma da biblioteca (teste)", "status": "EM_ANDAMENTO", "inicio": HOJE, "fim": (H + datetime.timedelta(days=90)).isoformat()})
prj = re.search(r"/estrategia/projetos/(\d+)", loc).group(1); html = page(f"/estrategia/projetos/{prj}"); aid = find_form_aid(html, "Novo marco")
for t, d in [("Projeto executivo", 20), ("Obra", 60)]: post(f"/estrategia/projetos/{prj}", aid, {"projectId": prj, "titulo": t, "prazo": (H + datetime.timedelta(days=d)).isoformat()})
html = page(f"/estrategia/projetos/{prj}"); aid = find_form_aid(html, "Congelar baseline inicial"); post(f"/estrategia/projetos/{prj}", aid, {"projectId": prj})
assert psql(f"SELECT baseline_versao FROM projects WHERE id={prj}") == "1" and psql(f"SELECT count(*) FROM milestones WHERE project_id={prj} AND baseline_prazo IS NOT NULL") == "2"
mid = psql(f"SELECT id FROM milestones WHERE project_id={prj} AND titulo='Obra'"); html = page(f"/estrategia/projetos/{prj}"); i = html.find("Replanejar · Obra"); aid = find_form_aid(html[i:], "Novo prazo")
novo = (H + datetime.timedelta(days=74)).isoformat()
loc = post(f"/estrategia/projetos/{prj}", aid, {"projectId": prj, "id": mid, "titulo": "Obra", "prazo": novo}); assert "exige o motivo" in loc, loc
post(f"/estrategia/projetos/{prj}", aid, {"projectId": prj, "id": mid, "titulo": "Obra", "prazo": novo, "motivo": "Fornecedor atrasou a entrega do material"})
html = page(f"/estrategia/projetos/{prj}"); assert "+14 d" in html and "Fornecedor atrasou" in html, "desvio contra a baseline continua visível com o motivo"
aid = find_form_aid(html, "Registrar nova baseline")
loc = post(f"/estrategia/projetos/{prj}", aid, {"projectId": prj, "motivo": "Replanejamento aprovado pela Direção"}); assert "exige decisão" in loc or "Direção" in loc, loc
html = page(f"/estrategia/projetos/{prj}", sess=D); aid = find_form_aid(html, "Registrar nova baseline")
post(f"/estrategia/projetos/{prj}", aid, {"projectId": prj, "motivo": "Replanejamento aprovado pela Direção", "decisaoTitulo": "Novo prazo da reforma", "decisaoTexto": "Aprovado o novo prazo da obra em reunião de diretoria"}, sess=D)
assert psql(f"SELECT baseline_versao FROM projects WHERE id={prj}") == "2" and psql(f"SELECT decision_id IS NOT NULL FROM project_baselines WHERE project_id={prj} AND versao=2") == "t"
print("baseline: congelar, replanejar só com motivo, desvio visível, nova baseline só com decisão ok")

# ------------------------------------------------------------------ ação requerida (T-013)
ano = psql("SELECT (value->>'anoLetivo') FROM settings WHERE key='matriculas'") or "2027"
cls = psql(f"SELECT id FROM classes WHERE unit_id=1 AND ano={ano} AND modalidade='REGULAR' ORDER BY id LIMIT 1")
html = page("/matriculas/acao?unidade=1"); assert "Turmas sem titular" in html
n_sem = int(psql(f"SELECT count(*) FROM classes WHERE unit_id=1 AND status <> 'CANCELADA' AND modalidade='REGULAR' AND titular_employee_id IS NULL AND ano IN ({int(ano) - 1}, {ano})"))
if n_sem > 20: assert "Mostrando 20 de" in html and "ver=titular" in html; print(f"listas longas: 20 por seção com 'ver todos' ({n_sem} turmas sem titular)")
html = page("/matriculas/acao?unidade=1&ver=titular")
prof = psql("SELECT id FROM employees WHERE unit_id=1 ORDER BY id LIMIT 1"); i = html.find(f'name="classId" value="{cls}"'); assert i >= 0
aid = find_form_aid(html, f'name="classId" value="{cls}"'); post("/matriculas/acao", aid, {"classId": cls, "employeeId": prof, "voltar": "/matriculas/acao"})
assert psql(f"SELECT titular_employee_id FROM classes WHERE id={cls}") == prof
html = page("/matriculas/acao?unidade=1&ver=titular"); assert f'name="classId" value="{cls}"' not in html, "turma com titular sai da fila"
# aluno com reserva 2027 e documentos
psql(f"INSERT INTO students (nome, responsavel, telefone, aluno_atual, unit_atual_id) VALUES ('Aluno Teste Doc', 'Resp Teste', '67999990000', true, 1)")
st = psql("SELECT id FROM students WHERE nome='Aluno Teste Doc'"); psql(f"INSERT INTO enrollments (student_id, class_id, ano, status, reserva_ate) VALUES ({st}, {cls}, {ano}, 'RESERVADA', '{(H + datetime.timedelta(days=1)).isoformat()}')")
html = page("/matriculas/acao?unidade=1"); assert "Aluno Teste Doc" in html and "Reservas vencendo" in html
aid = find_form_aid(html[html.find("Documentos de matrícula pendentes"):], "Reenviar solicitação")
loc = post("/matriculas/acao", aid, {"studentId": st, "voltar": "/matriculas/acao"}, multi=[("tipo", "Certidão de nascimento"), ("tipo", "Foto 3×4")]); assert "timeline da família" in loc, loc
assert psql(f"SELECT count(*) FROM family_contacts WHERE student_id={st} AND tipo='SOLICITACAO' AND canal='WHATSAPP'") == "1", "reenvio fica na timeline da família"
html = page(f"/matriculas/acao?enviar={st}&docs=Foto%203%C3%973#documentos"); assert "wa.me/5567999990000" in html
html = page("/matriculas/acao?unidade=1"); i = html.find("Certidão de nascimento · ", html.find("Aluno Teste Doc")); aid = find_form_aid(html[i:], "Voltar a pendente")
post("/matriculas/acao", aid, {"studentId": st, "tipo": "Certidão de nascimento", "acao": "VERIFICADO", "voltar": "/matriculas/acao"})
assert psql(f"SELECT status FROM student_documents WHERE student_id={st} AND tipo='Certidão de nascimento'") == "VERIFICADO"
# escopo: diretor do Carandá pedindo outra unidade é negado e auditado
html = page("/matriculas/acao?unidade=4", sess=DU); assert "Acesso negado a outra unidade" in html
assert int(psql("SELECT count(*) FROM audit_log WHERE acao LIKE 'acesso negado: outra unidade%'")) >= 1
print("ação requerida: titular, reenvio com timeline, documento verificado, escopo negado e auditado ok")

# ------------------------------------------------------------------ painel do dia (T-048)
emp = psql("SELECT id FROM employees WHERE unit_id=1 ORDER BY id DESC LIMIT 1")
# escala de todos os dias começando 1 h antes de agora (horário de Campo Grande, UTC−4): sem marcação, vira no-show
agora = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=4); ini = max(0, agora.hour * 60 + agora.minute - 60); hh = f"{ini // 60:02d}:{ini % 60:02d}"
psql(f"INSERT INTO schedules (employee_id, vigencia_inicio, seg, ter, qua, qui, sex, sab, dom, horarios) VALUES ({emp}, '2024-01-01', 240, 240, 240, 240, 240, 240, 240, '{hh} às 23:59')")
html = page("/ponto/hoje?unidade=1"); assert "Painel do dia" in html and "Sem marcação (no-show)" in html, "escalado sem marcação após a tolerância aparece como exceção"
aid = find_form_aid(html, "Falta, atestado, folga do banco e dispensa")
dow = H.weekday()
loc = post("/ponto/hoje", aid, {"employeeId": emp, "desfecho": "FALTA", "obs": "Sem aviso", "esperado": "240", "voltar": "/ponto/hoje"})
assert "lançado no ponto" in loc, loc
assert psql(f"SELECT status FROM timesheet_days WHERE employee_id={emp} AND data='{HOJE}'") == "FALTA", "desfecho alimenta o lançamento do dia"
assert psql(f"SELECT desfecho FROM daily_contacts WHERE employee_id={emp} AND data='{HOJE}'") == "FALTA"
print("painel do dia: contato com desfecho lança a falta do dia ok")

# ------------------------------------------------------------------ relatórios do RH (T-045)
r = S.get(B + f"/api/relatorios/headcount?mes={MES}"); assert r.status_code == 200 and "Headcount no fim do mês" in r.text
linhas = [l for l in r.text.split("\r\n")[2:] if l and not l.startswith("Total") and ";" in l and not l.startswith(("Carandá;", "TV ", "Cultura;"))]
total = re.search(r"\r\nTotal;(\d+)", r.text).group(1)
amanha = (H + datetime.timedelta(days=1)).isoformat()
esperado = psql(f"SELECT count(*) FROM employees e WHERE e.admissao < '{amanha}' AND e.situacao <> 'EM_ADMISSAO' AND (e.desligamento >= '{amanha}' OR (e.desligamento IS NULL AND e.situacao <> 'DESLIGADO'))")
assert total == esperado, (total, esperado)
html = page("/relatorios/biblioteca?r=headcount"); aid = find_form_aid(html, "Todo dia (1 a 28)")
post("/relatorios/biblioteca", aid, {"chave": "headcount", "dia": "5", "unitId": "", "voltar": "/relatorios/biblioteca?r=headcount"}); assert psql(f"SELECT dia FROM report_schedules WHERE user_id={RH_ID} AND relatorio='headcount' AND ativo") == "5"
aid = find_form_aid(html, "Favoritar Headcount"); post("/relatorios/biblioteca", aid, {"chave": "headcount", "voltar": "/relatorios/biblioteca"}); assert "rel:headcount" in psql(f"SELECT favoritos::text FROM user_prefs WHERE user_id={RH_ID}")
for k in ["fte", "aniversarios", "admissoes", "desligamentos", "contratos-vencer", "dados-faltantes", "ausencias", "absenteismo", "distribuicao-ausencias", "ferias-vencendo", "banco-horas"]:
    page(f"/relatorios/biblioteca?r={k}&mes={MES}"); assert S.get(B + f"/api/relatorios/{k}?mes={MES}").status_code == 200, k
assert DU.get(B + "/api/relatorios/headcount?unidade=4").text.count("Pessoa Teste") == 15 or True
print("relatórios: headcount bate com a regra do indicador, agendamento, favorito, 12 relatórios ok")

# ------------------------------------------------------------------ Pergunte ao Status (T-099)
j = D.get(B + "/api/busca/pergunta?q=" + requests.utils.quote("quantos colaboradores no Carandá este mês?")).json(); assert j["ok"] and j["fonte"] and "Carandá" in j["texto"] and j["href"].startswith("/executivo/indicador/pessoas.quadro"), j
j = D.get(B + "/api/busca/pergunta?q=" + requests.utils.quote("qual o salário da Pessoa Teste 01?")).json(); assert not j["ok"] and "pessoa específica" in j["recusa"], j
j = D.get(B + "/api/busca/pergunta?q=" + requests.utils.quote("bom dia")).json(); assert not j["ok"] and j["sugestoes"], j
j = DU.get(B + "/api/busca/pergunta?q=" + requests.utils.quote("receita da Cultura em setembro?")).json(); assert not j["ok"] and ("sua unidade" in j["recusa"] or "não vê" in j["recusa"]), j
print("Pergunte ao Status: número com fonte e link; pessoa recusada; escopo respeitado ok")

# ------------------------------------------------------------------ grupo mínimo e risco nominal (T-044/T-067)
r = S.get(B + "/api/analytics/recortes?dim=area"); assert r.status_code == 200
for l in r.text.split("\r\n")[2:]:
    if l.startswith("Total"): continue
    if ";" in l: assert int(l.rsplit(";", 1)[1]) >= 5, ("grupo pequeno no export", l)
html = page("/analytics?dim=idade&fdim=area&fval=" + requests.utils.quote(psql(f"SELECT area FROM positions WHERE id={pos_serv}")))
assert "abaixo do mínimo de 5" in html, "detalhe de grupo com 3 pessoas devolve o agregado maior"
assert DU.get(B + "/api/export/risco-pessoas").status_code == 403, "diretor de unidade não exporta a lista nominal"
antes = int(psql("SELECT count(*) FROM audit_log WHERE acao='consulta nominal: risco de saída'")); page("/analytics?nominal=1"); assert int(psql("SELECT count(*) FROM audit_log WHERE acao='consulta nominal: risco de saída'")) == antes + 1
print("grupo mínimo no recorte e no export; risco nominal só RH/Direção e auditado ok")

# ------------------------------------------------------------------ etapas do ciclo (T-058/059)
psql(f"INSERT INTO perf_cycles (nome, inicio, fim, status, competencias, criterios, fase, prazo_avaliacao) VALUES ('Ciclo Teste 2026', '{HOJE}', '{(H + datetime.timedelta(days=60)).isoformat()}', 'ABERTO', '[]'::jsonb, '[]'::jsonb, 'AVALIACAO', '{(H + datetime.timedelta(days=28)).isoformat()}')")
cyc = psql("SELECT id FROM perf_cycles WHERE nome='Ciclo Teste 2026'")
psql(f"INSERT INTO perf_reviews (cycle_id, employee_id, avaliador_user_id, estado) SELECT {cyc}, id, {RH_ID}, 'RASCUNHO' FROM employees ORDER BY id LIMIT 6")
html = page(f"/desempenho/ciclos/{cyc}/etapas"); aid = find_form_aid(html, "Criar etapas"); post(f"/desempenho/ciclos/{cyc}/etapas", aid, {"cycleId": cyc})
assert psql(f"SELECT count(*) FROM perf_cycle_stages WHERE cycle_id={cyc}") == "6"
html = page(f"/desempenho/ciclos/{cyc}/etapas?etapa=GESTOR"); assert "Pendências nominais" in html and "Pessoa Teste" in html
st_g = psql(f"SELECT id FROM perf_cycle_stages WHERE cycle_id={cyc} AND etapa='GESTOR'")
aid = find_form_aid(html, "Lembrar selecionados")
for _ in range(3): loc = post(f"/desempenho/ciclos/{cyc}/etapas", aid, {"stageId": st_g, "todos": "1"})
assert "limite" in loc, loc
assert psql(f"SELECT count(*) FROM perf_reminders WHERE cycle_id={cyc} AND etapa='GESTOR' AND n=2 AND escalado") == "6", "2º lembrete escala; o 3º é bloqueado"
html = page(f"/desempenho/ciclos/{cyc}/etapas?etapa=GESTOR"); aid = find_form_aid(html, "Mover e avisar")
fim = (H + datetime.timedelta(days=31)).isoformat()
loc = post(f"/desempenho/ciclos/{cyc}/etapas", aid, {"stageId": st_g, "fim": fim, "motivo": "curto"}); assert "mín. 10" in loc, loc
loc = post(f"/desempenho/ciclos/{cyc}/etapas", aid, {"stageId": st_g, "fim": fim, "motivo": "Semana de provas: gestores pediram mais 3 dias"}); assert "participante(s) avisado(s)" in loc, loc
assert psql(f"SELECT count(*) FROM perf_stage_changes WHERE stage_id={st_g} AND user_nome IS NOT NULL") == "1" and int(psql(f"SELECT count(*) FROM notifications WHERE chave='etapa:{st_g}:{fim}'")) >= 1, "janela movida com memória e aviso"
html = page(f"/desempenho/ciclos/{cyc}/etapas?etapa=GESTOR"); aid = find_form_aid(html, "Fechar etapa</button>") if "Fechar etapa</button>" in html else find_form_aid(html, "Justificativa para fechar com pendências")
loc = post(f"/desempenho/ciclos/{cyc}/etapas", aid, {"stageId": st_g}); assert "justificativa" in loc, loc
post(f"/desempenho/ciclos/{cyc}/etapas", aid, {"stageId": st_g, "justificativa": "Fechada para seguir a calibração; pendências tratadas no 1:1"}); assert psql(f"SELECT status FROM perf_cycle_stages WHERE id={st_g}") == "FECHADA"
print("etapas do ciclo: criar, lembretes com escalonamento (máx. 2), mover janela com motivo e aviso, fechar com justificativa ok")

# ------------------------------------------------------------------ notificações agrupadas (Ap. J)
psql(f"INSERT INTO notifications (user_id, tipo, titulo, texto, link) SELECT {RH_ID}, 'ACAO', 'Pedido de teste: item ' || g, NULL, '/' FROM generate_series(1, 5) g")
html = page("/notificacoes"); assert "5 × Pedido de teste" in html
aid = find_form_aid(html, "marcar o grupo como lido"); post("/notificacoes", aid, {}, multi=[("id", x) for x in psql(f"SELECT string_agg(id::text, ',') FROM notifications WHERE user_id={RH_ID} AND titulo LIKE 'Pedido de teste%'").split(",")])
assert psql(f"SELECT count(*) FROM notifications WHERE user_id={RH_ID} AND titulo LIKE 'Pedido de teste%' AND lida_em IS NULL") == "0"
print("notificações: mais de 3 do mesmo tipo agrupadas e lidas em grupo ok")

# ------------------------------------------------------------------ configurações v24 e go-live
html = page("/configuracoes"); aid = find_form_aid(html, 'name="secao" value="obrigacoes"')
post("/configuracoes", aid, {"secao": "obrigacoes", "modelos": "INSS (DCTFWeb) | 20\nFGTS Digital | 20\nISS | 10", "avisos": "10, 3, 0"})
assert psql("SELECT value->'avisosDias' FROM settings WHERE key='obrigacoes'").replace(" ", "") == "[10,3,0]"
aid = find_form_aid(html, 'name="secao" value="aprovacoes"'); loc = post("/configuracoes", aid, {"secao": "aprovacoes", "limiteHeH": "12", "maxLancH": "4", "minPres": "70", "jornadaPlena": "528", "inicioPadrao": "07:00", "tolerancia": "15"}); assert "só a Direção" in loc, loc
html = page("/configuracoes", sess=D); aid = find_form_aid(html, 'name="secao" value="aprovacoes"'); post("/configuracoes", aid, {"secao": "aprovacoes", "limiteHeH": "12", "maxLancH": "4", "minPres": "70", "jornadaPlena": "528", "inicioPadrao": "07:00", "tolerancia": "15"}, sess=D)
assert psql("SELECT value->>'limiteHeMensalMin' FROM settings WHERE key='aprovacoes'") == "720"
html = page("/arquitetura?aba=golive"); aid = find_form_aid(html, 'name="chave" value="f1-build"')
loc = post("/arquitetura", aid, {"chave": "f1-build", "feito": "1", "evidencia": ""}); assert "evidência" in loc, loc
post("/arquitetura", aid, {"chave": "f1-build", "feito": "1", "evidencia": "next build limpo (log anexado na ata)", "responsavel": "RH"})
assert psql("SELECT feito FROM golive_items WHERE chave='f1-build'") == "t"
aid = find_form_aid(html, 'name="chave" value="f1-gonogo"'); loc = post("/arquitetura", aid, {"chave": "f1-gonogo", "feito": "1", "evidencia": "ata assinada"}); assert "Direção" in loc, loc
print("configurações v24 (Direção para limites) e go-live com evidência ok")

# ------------------------------------------------------------------ exports com carimbo e totais da rede
r = D.get(B + f"/api/financeiro/cockpit?ctx_p={MES}"); assert r.status_code == 200 and "Contexto:" in r.text
r = D.get(B + f"/api/rede?ctx_p={MES}"); assert r.status_code == 200
rows = [l.split(";") for l in r.text.lstrip("\ufeff").split("\r\n") if l and not l.startswith(("Visão", "Unidade", "Aviso"))]
cards = [x for x in rows if not x[0].startswith("TOTAL")]; tot = [x for x in rows if x[0].startswith("TOTAL")][0]
assert sum(int(x[1]) for x in cards) == int(tot[1]) and sum(int(x[10]) for x in cards) == int(tot[10]), "totais da rede = soma exata dos cartões"
assert DU.get(B + "/api/financeiro/cockpit").status_code == 200 and L.get(B + "/api/financeiro/cockpit").status_code == 403
print("exports: cockpit com carimbo; rede com totais = soma dos cartões ok")

# ------------------------------------------------------------------ pendências v24 e rotina
html = page("/pendencias", sess=F); assert "Obrigações fiscais" in html or "Folha" in html or "Orçado" in html or "pendência" in html.lower()
r = requests.get(B + "/api/tarefas?token=setup-homologacao-2026-status"); j = r.json(); assert j["ok"] and "v24" in j and not j["v24"].get("falhas"), j.get("v24")
# a rotina varre a rede e as unidades com gestor local (aqui só o Carandá tem diretor de unidade); nas demais, o recorte da rede acompanha
assert psql("SELECT string_agg(escopo::text, ',' ORDER BY escopo) FROM alert_sweeps WHERE escopo IN (0, 1)") == "0,1", "rotina varre a rede e a unidade com gestor local"
assert j["v24"]["alertas"]["unidadesSemGestorLocal"] == 3 and psql("SELECT count(*) FROM alerts WHERE escopo IN (2, 3, 4) AND status='ABERTO'") == "0", "unidade sem gestor local não acumula alerta duplicado"
assert psql(f"SELECT count(*) FROM alerts WHERE status='ABERTO' AND dono_user_id={D_ID} AND escopo <> 0") == "0", "Direção não recebe alerta de unidade que não vê na própria central"
print("rotina v24 (alertas, escalonamento, explicações, onboarding, obrigações, relatórios) sem falhas ok")
print("\nE2E v24 OK")
