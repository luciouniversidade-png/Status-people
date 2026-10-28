# E2E — v23 ONE Insights. Painel Executivo e base de indicadores (metas, comentários, assinatura, recálculo, exportação e o que cada
# perfil enxerga: salarial, privacidade, unidade), FP&A (planilha tudo ou nada, cópia do ano anterior com reajuste, explicação de desvio,
# projeção de caixa, exportação), Central de fluxos e SLA (escopo da unidade, LGPD só com protocolo, ausência sem o motivo, exportação),
# Minhas pendências (aprovador, responsável, comitê de ética sem conteúdo) e o lembrete diário (só números, um por dia, nunca no fim
# de semana), busca global (escopo por perfil e limite por minuto), mural de reconhecimento (validações, aplauso, moderação, aviso),
# Início personalizável e quadros/metas por perfil.
import re, subprocess, requests, json
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
B = "http://localhost:3100"; TOKEN = "setup-homologacao-2026-status"; RH_DIR = "/home/claude/rh"
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
def limpa(t): return re.sub(r"<script[^>]*>.*?</script>", "", re.sub(r"<!--.*?-->", "", t), flags=re.S).replace("\xa0", " ")
def page(path, expect=200, sess=None):
    sess = sess or S; r = sess.get(B + path, allow_redirects=False)
    assert r.status_code == expect, (path, r.status_code, r.headers.get("location"))
    return limpa(r.text)
def status(path, sess): return sess.get(B + path, allow_redirects=False).status_code
def destino(path, sess): r = sess.get(B + path, allow_redirects=False); return r.status_code, unq(r.headers.get("location", ""))
def post(path, aid, data, sess=None):
    sess = sess or S; f = [(f"$ACTION_ID_{aid}", (None, ""))]
    for k, v in data.items():
        for x in (v if isinstance(v, list) else [v]): f.append((k, (None, str(x))))
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
def busca(sess, q):
    r = sess.get(B + "/api/busca", params={"q": q}); assert r.status_code == 200, (q, r.status_code); return r.json()["resultados"]
def tem(res, grupo, texto=None): return any(x["grupo"] == grupo and (texto is None or texto in x["titulo"]) for x in res)
def h2(html, titulo): return re.search(r"<h2[^>]*>" + re.escape(titulo), html) is not None
def tsx(code):
    r = subprocess.run(["npx", "tsx", "-e", code], cwd=RH_DIR, capture_output=True, text=True, timeout=240)
    assert r.returncode == 0, r.stderr[-1500:]; return r.stdout.strip().splitlines()[-1]
HOJE = datetime.now(ZoneInfo("America/Campo_Grande")).date(); H = HOJE.isoformat(); ANO = HOJE.year
def d(n): return (HOJE + timedelta(days=n)).isoformat()

print("Preparação")
login(S, "rh@colegiostatus", "Status2026!"); assert S.get(B + f"/api/setup?token={TOKEN}").json()["ok"]
RH = psql("SELECT id FROM users WHERE email='rh@colegiostatus'"); CAR, CUL = (psql(f"SELECT id FROM units WHERE codigo='{c}'") for c in ["CAR", "CUL"])
psql(f"INSERT INTO employees (nome, unit_id, vinculo, admissao) VALUES ('Paulo Professor', {CAR}, 'CLT', '2023-02-01'), ('Bruna Brigadista', {CAR}, 'CLT', '2022-03-01'), ('Carla Cultura', {CUL}, 'CLT', '2021-05-03')")
EP, EB, EC = (psql(f"SELECT id FROM employees WHERE nome='{n}'") for n in ["Paulo Professor", "Bruna Brigadista", "Carla Cultura"])
html = page("/configuracoes"); aid_user = aid_of(html, "Criar acesso")
def criar_user(nome, email, role, unit="", emp=""):
    post("/configuracoes", aid_user, {"nome": nome, "email": email, "role": role, "unitId": unit, "employeeId": emp, "senha": "senha12345"}); u = psql(f"SELECT id FROM users WHERE email='{email}'"); assert u, email; return u
UDG = criar_user("Diretora Geral", "dg@rede", "DIRECAO"); UDIR = criar_user("Diretora Carandá", "dir@car", "DIRETOR_UNIDADE", CAR); UDCUL = criar_user("Diretor Cultura", "dir@cul", "DIRETOR_UNIDADE", CUL)
UCO = criar_user("Coord Carandá", "coord@car", "GESTOR", CAR); UFIN = criar_user("Financeiro", "fin@rede", "FINANCEIRO"); UCOM = criar_user("Comercial Carandá", "com@car", "COMERCIAL", CAR)
UOPS = criar_user("Operações", "ops@rede", "OPERACOES"); ULEI = criar_user("Conselho", "lei@rede", "LEITURA"); UB = criar_user("Bruna", "bruna@car", "COLABORADOR", "", EB); UP = criar_user("Paulo", "paulo@car", "COLABORADOR", "", EP)
DG, DIR, DCUL, CO, FI, CM, OP, LE, BR, PA = (mk() for _ in range(10))
for sess, em in [(DG, "dg@rede"), (DIR, "dir@car"), (DCUL, "dir@cul"), (CO, "coord@car"), (FI, "fin@rede"), (CM, "com@car"), (OP, "ops@rede"), (LE, "lei@rede"), (BR, "bruna@car"), (PA, "paulo@car")]: login(sess, em, "senha12345")
ok("Direção, diretores de duas unidades, coordenação, financeiro, comercial, operações, leitura e dois colaboradores")

psql("INSERT INTO request_types (codigo, nome, campos, etapas, prazo_dias) VALUES ('E2E_COMPRA', 'Compra de material', '[]', '[]', 2)"); TID = psql("SELECT id FROM request_types WHERE codigo='E2E_COMPRA'")
psql(f"INSERT INTO requests (numero, type_id, titulo, dados, unit_id, solicitante_user_id, solicitante_nome, status, etapa_atual, etapas, prazo_etapa) VALUES ('SOL-2026-9001', {TID}, 'Compra de kits de robótica', '{{}}', {CAR}, {UCO}, 'Coord Carandá', 'EM_APROVACAO', 0, '[{{\"nome\":\"Direção da unidade\",\"aprovadores\":[{UDIR}]}}]', '{d(-1)}'), ('SOL-2026-9002', {TID}, 'Pintura da quadra coberta', '{{}}', {CUL}, {UDCUL}, 'Diretor Cultura', 'EM_APROVACAO', 0, '[{{\"nome\":\"Direção geral\",\"aprovadores\":[{UDG}]}}]', '{d(2)}')")
psql(f"INSERT INTO cases (unit_id, tipo, canal, assunto, status, responsavel_user_id, sla_ate, created_at) VALUES ({CAR}, 'RECLAMACAO', 'WHATSAPP', 'Família pede reunião sobre adaptação', 'ABERTO', {UCO}, now() - interval '1 day', now() - interval '3 days'), ({CUL}, 'RECLAMACAO', 'WHATSAPP', 'Caso Cultura sigilo Zeta', 'ABERTO', {UDCUL}, now() + interval '2 days', now() - interval '1 day')")
psql(f"INSERT INTO work_orders (titulo, unit_id, status, solicitante_user_id, responsavel_user_id, sla_ate) VALUES ('Ar-condicionado da sala 3 pingando', {CAR}, 'ABERTO', {UCOM}, {UOPS}, now() - interval '2 hours'), ('Troca de lâmpadas do pátio', {CAR}, 'ABERTO', {UOPS}, {UOPS}, now() + interval '3 days')")
psql(f"INSERT INTO privacy_requests (protocolo, tipo, titular_nome, status, prazo, responsavel_user_id, descricao) VALUES ('LGPD-2026-0042', 'CORRECAO', 'Helena Titular Sigilosa', 'EM_ANALISE', '{d(-1)}', {RH}, 'Corrigir endereço Rua Secreta 77')")
psql(f"INSERT INTO ethics_reports (protocolo, codigo_hash, categoria, relato, status, responsavel_user_id, prazo_conclusao) VALUES ('ET-2026-0007', 'h1', 'ASSEDIO_MORAL', 'Relato sigiloso Omega sobre a coordenação', 'EM_APURACAO', {UDG}, '{d(10)}')")
psql(f"INSERT INTO ethics_reports (protocolo, codigo_hash, categoria, relato, status, prazo_triagem) VALUES ('ET-2026-0008', 'h2', 'FRAUDE', 'Relato sigiloso Sigma', 'RECEBIDA', '{d(-1)}')")
psql(f"INSERT INTO action_plans (titulo, unit_id, prazo, responsavel_user_id, status, origem) VALUES ('Revisar plano de evacuação', {CAR}, '{d(-2)}', {UCO}, 'EM_ANDAMENTO', 'MANUAL')")
psql(f"INSERT INTO leave_requests (employee_id, tipo, inicio, fim, dias, status, solicitado_por) VALUES ({EP}, 'AFASTAMENTO_SAUDE', '{d(5)}', '{d(9)}', 5, 'SOLICITADA', {RH})")
psql(f"INSERT INTO leave_requests (employee_id, tipo, inicio, fim, dias, status, solicitado_por, decidido_em) VALUES ({EP}, 'AFASTAMENTO_SAUDE', '{H}', '{H}', 1, 'APROVADA', {RH}, now())")
psql(f"INSERT INTO students (nome, aluno_atual, unit_atual_id) VALUES ('Lívia Aluna Carandá', true, {CAR}), ('Otávio Aluno Cultura', true, {CUL})")
ok("solicitações, casos, chamados, pedido LGPD, relatos de ética, ação, afastamento e alunos em duas unidades")

print("Painel Executivo e base de indicadores")
html = page("/executivo"); assert "Painel Executivo" in html and "Recalcular base" in html
assert int(psql("SELECT count(*) FROM kpi_series")) > 0 and psql("SELECT count(DISTINCT chave) FROM kpi_series") != "0"; ok("primeira visita monta a base (24 meses) e o painel abre para o RH")
for sess, quem in [(DG, "Direção"), (DIR, "direção da unidade"), (FI, "Financeiro"), (CM, "Comercial"), (OP, "Operações"), (LE, "Leitura"), (CO, "coordenação")]: assert status("/executivo", sess) == 200, quem
assert status("/executivo", BR) in (302, 303, 307) and status("/apresentacao", BR) in (302, 303, 307) and status("/executivo/indicador/pessoas.quadro", BR) in (302, 303, 307); ok("todos os perfis de gestão abrem o painel; o autoatendimento não")
assert status("/executivo/indicador/financeiro.receita", CO) == 404 and status("/executivo/indicador/pessoas.quadro", CO) == 200; ok("coordenação não vê indicadores financeiros")
assert status("/executivo/indicador/financeiro.custo_pessoal", DIR) == 404 and status("/executivo/indicador/financeiro.custo_pessoal", FI) == 200 and status("/executivo/indicador/financeiro.custo_pessoal", S) == 200; ok("custo de pessoal (salarial) só para Direção, RH e Financeiro")
assert status("/executivo/indicador/governanca.lgpd_prazo", LE) == 404 and status("/executivo/indicador/governanca.lgpd_prazo", DIR) == 404 and status("/executivo/indicador/governanca.lgpd_prazo", S) == 200; ok("indicador de privacidade só para quem trata LGPD (e nunca no escopo de unidade)")
assert status("/executivo/indicador/nao.existe", S) == 404; ok("indicador inexistente: 404")
r = DIR.get(B + f"/api/export/painel?unidade={CUL}"); assert r.status_code == 200 and "text/csv" in r.headers["content-type"]
linhas = [l.split(";") for l in r.text.lstrip("﻿").split("\r\n")]; cab = linhas[0]; esc = cab.index("escopo"); ch = cab.index("chave")
assert len(linhas) > 10 and all(l[esc] == "Carandá" for l in linhas[1:]) and not any(l[ch] == "financeiro.custo_pessoal" for l in linhas[1:]); ok("exportação do diretor: só a própria unidade (mesmo pedindo outra) e sem indicador salarial")
assert CO.get(B + "/api/export/indicador?chave=financeiro.custo_pessoal").status_code == 403 and BR.get(B + "/api/export/painel").status_code == 401; ok("série de indicador fora do perfil: 403; autoatendimento: 401")
r = S.get(B + "/api/export/indicador?chave=pessoas.quadro"); assert r.status_code == 200 and r.text.lstrip("﻿").startswith("indicador;chave;escopo;periodo"); ok("série histórica exportada em CSV")
assert "fórmula" in page("/executivo/dicionario").lower(); ok("dicionário dos indicadores")
assert status("/apresentacao", S) == 200 and status("/apresentacao", LE) == 200 and status(f"/apresentacao?s=3&unidade={CAR}", DIR) == 200; ok("modo apresentação abre para a gestão e a leitura")

html = page(f"/executivo/metas?ano={ANO}&editar=pessoas.turnover&unidade=0#editar"); aid_meta = aid_of(html, "Salvar meta")
loc = post("/executivo/metas", aid_meta, {"chave": "pessoas.turnover", "ano": ANO, "unidade": 0, "meta": "12", "alerta": "15", "voltar": f"/executivo/metas?ano={ANO}"}); assert "ok=Meta salva" in loc, loc
assert psql(f"SELECT meta::float || '|' || alerta::float FROM kpi_targets WHERE chave='pessoas.turnover' AND ano={ANO} AND unit_id=0") == "12|15"; ok("RH define meta e limite de atenção da rede")
loc = post("/executivo/metas", aid_meta, {"chave": "financeiro.receita", "ano": ANO, "unidade": 0, "meta": "1000000"}); assert "erro=Sem permissão" in loc, loc
loc = post("/executivo/metas", aid_meta, {"chave": "financeiro.inadimplencia", "ano": ANO, "unidade": 0, "meta": "4,5", "alerta": "6"}, sess=FI); assert "ok=" in loc, loc
assert psql(f"SELECT meta::float FROM kpi_targets WHERE chave='financeiro.inadimplencia' AND ano={ANO}") == "4.5"; ok("Financeiro define metas financeiras; RH não (número no padrão brasileiro)")
assert "erro=Sem permissão" in post("/executivo/metas", aid_meta, {"chave": "pessoas.turnover", "ano": ANO, "unidade": CAR, "meta": "10"}, sess=DIR)
assert "erro=Percentuais vão de 0 a 100" in post("/executivo/metas", aid_meta, {"chave": "pessoas.turnover", "ano": ANO, "unidade": 0, "meta": "120"})
assert "erro=Este indicador é de acompanhamento" in post("/executivo/metas", aid_meta, {"chave": "pessoas.quadro", "ano": ANO, "unidade": 0, "meta": "100"})
assert "erro=" in post("/executivo/metas", aid_meta, {"chave": "pessoas.turnover", "ano": ANO, "unidade": 0, "meta": "12", "alerta": "10"}); ok("metas recusadas: direção da unidade, percentual acima de 100, indicador de acompanhamento e limite do lado errado")
assert "erro=" in post("/executivo/metas", aid_meta, {"chave": "pessoas.turnover", "ano": ANO, "unidade": 0, "meta": "9"}, sess=LE) and psql(f"SELECT meta::float FROM kpi_targets WHERE chave='pessoas.turnover' AND ano={ANO} AND unit_id=0") == "12"; ok("leitura não altera metas")
html = page(f"/executivo/indicador/pessoas.turnover?periodo={ANO}-01"); aid_rm = aid_of(html, ">Remover<")
assert "ok=Meta removida" in post("/executivo/indicador/pessoas.turnover", aid_rm, {"chave": "pessoas.turnover", "ano": ANO, "unidade": 0}) and psql(f"SELECT count(*) FROM kpi_targets WHERE chave='pessoas.turnover'") == "0"; ok("meta removida (volta a valer a padrão)")

PER = psql("SELECT to_char((date_trunc('month', now() AT TIME ZONE 'America/Campo_Grande') - interval '1 month'), 'YYYY-MM')")
html = page(f"/executivo/indicador/pessoas.quadro?periodo={PER}", sess=CO); aid_com = aid_of(html, "Registrar comentário")
loc = post("/executivo/indicador/pessoas.quadro", aid_com, {"chave": "pessoas.quadro", "periodo": PER, "unidade": CUL, "texto": "Duas admissões previstas para novembro.", "voltar": "/executivo/indicador/pessoas.quadro"}, sess=CO); assert "ok=Comentário registrado" in loc, loc
assert psql(f"SELECT unit_id FROM kpi_comments WHERE texto LIKE 'Duas admissões%'") == CAR; ok("comentário da coordenação fica na própria unidade (mesmo pedindo outra)")
assert "erro=Seu acesso não registra comentários" in post("/executivo/indicador/pessoas.quadro", aid_com, {"chave": "pessoas.quadro", "periodo": PER, "texto": "Comentário da leitura"}, sess=LE)
assert "erro=Escreva o comentário" in post("/executivo/indicador/pessoas.quadro", aid_com, {"chave": "pessoas.quadro", "periodo": PER, "texto": "ok"}, sess=CO)
assert "erro=Sem acesso a este indicador" in post("/executivo/indicador/pessoas.quadro", aid_com, {"chave": "financeiro.receita", "periodo": PER, "texto": "Receita caiu muito"}, sess=CO); ok("comentários recusados: leitura, texto curto e indicador fora do perfil")
CID = psql("SELECT id FROM kpi_comments WHERE texto LIKE 'Duas admissões%'")
assert "Duas admissões previstas" in page(f"/executivo/indicador/pessoas.quadro?periodo={PER}", sess=CO)
html = page(f"/executivo/indicador/pessoas.quadro?periodo={PER}", sess=CO); aid_rmc = aid_of(html, ">remover<")
assert "erro=Só quem escreveu" in post("/executivo/indicador/pessoas.quadro", aid_rmc, {"id": CID}, sess=DIR)
assert "ok=Comentário removido" in post("/executivo/indicador/pessoas.quadro", aid_rmc, {"id": CID}, sess=CO) and psql(f"SELECT count(*) FROM kpi_comments WHERE id={CID}") == "0"; ok("comentário só sai por quem escreveu (ou pela Direção)")

html = page("/executivo", sess=DIR); aid_ass = aid_of(html, "Receber o resumo toda segunda")
assert "ok=Pronto" in post("/executivo", aid_ass, {"ativo": "1", "unidade": CUL, "voltar": "/executivo"}, sess=DIR) and psql(f"SELECT ativo || '|' || unit_id FROM kpi_subscriptions WHERE user_id={UDIR}") == f"true|{CAR}"
assert "✓ Resumo semanal assinado" in page("/executivo", sess=DIR); assert "erro=" in post("/executivo", aid_ass, {"ativo": "1"}, sess=BR)
assert "ok=Assinatura do resumo semanal cancelada" in post("/executivo", aid_ass, {"ativo": "0", "voltar": "/executivo"}, sess=DIR) and psql(f"SELECT ativo FROM kpi_subscriptions WHERE user_id={UDIR}") == "f"; ok("assinatura do resumo semanal: só a própria unidade; autoatendimento não assina; cancelar funciona")
aid_rec = aid_of(page("/executivo"), "Recalcular base")
assert "erro=Só Direção e RH recalculam" in post("/executivo", aid_rec, {"voltar": "/executivo"}, sess=FI)
assert "ok=Base" in post("/executivo", aid_rec, {"voltar": "/executivo"}); ok("recalcular a base: só Direção e RH")

print("FP&A — orçado × realizado e caixa projetado")
html = page(f"/financeiro/orcamento/planilha?ano={ANO}&unidade={CAR}", sess=FI); aid_pl = aid_of(html, "Salvar orçamento")
cat = re.search(r'name="c_ENTRADA_0" value="([^"]+)"', html).group(1)
loc = post("/financeiro/orcamento/planilha", aid_pl, {"ano": ANO, "unitId": CAR, "c_ENTRADA_0": cat, "v_ENTRADA_0_1": "10.000,00", "v_ENTRADA_0_2": "abc"}, sess=FI)
assert "erro=Valor inválido" in loc and psql(f"SELECT count(*) FROM budget_months WHERE ano={ANO} AND unit_id={CAR}") == "0"; ok("planilha com um valor inválido não grava nada (tudo ou nada)")
assert "erro=Categoria fora da lista" in post("/financeiro/orcamento/planilha", aid_pl, {"ano": ANO, "unitId": CAR, "c_ENTRADA_0": "Inventada", "v_ENTRADA_0_1": "10"}, sess=FI)
loc = post("/financeiro/orcamento/planilha", aid_pl, {"ano": ANO, "unitId": CAR, "c_ENTRADA_0": cat, "v_ENTRADA_0_1": "10.000,00", "v_ENTRADA_0_2": "12500,5", "v_ENTRADA_0_3": ""}, sess=FI)
assert "ok=Orçamento salvo: 2 mês" in loc, loc; assert psql(f"SELECT string_agg(mes || '=' || valor::float, ',' ORDER BY mes) FROM budget_months WHERE ano={ANO} AND unit_id={CAR}") == "1=10000,2=12500.5"; ok("planilha mês a mês grava os meses preenchidos (célula vazia = sem orçamento)")
assert "erro=Só Direção e Financeiro" in post("/financeiro/orcamento/planilha", aid_pl, {"ano": ANO, "unitId": CAR, "c_ENTRADA_0": cat, "v_ENTRADA_0_1": "1"}, sess=DIR); ok("direção da unidade não edita o orçamento (alçada financeira)")
html = page(f"/financeiro/orcamento/planilha?ano={ANO + 1}&unidade={CAR}", sess=FI); aid_cp = aid_of(html, "Criar orçamento mês a mês")
assert "ok=Orçamento" in post("/financeiro/orcamento/planilha", aid_cp, {"ano": ANO + 1, "unitId": CAR, "fonte": "ORCADO", "reajuste": "10"}, sess=FI)
assert psql(f"SELECT string_agg(mes || '=' || valor::float, ',' ORDER BY mes) FROM budget_months WHERE ano={ANO + 1} AND unit_id={CAR}") == "1=11000,2=13750.55"; ok("orçamento do ano seguinte copiado com reajuste de 10%, mês a mês")
assert "erro=Já existe orçamento" in post("/financeiro/orcamento/planilha", aid_cp, {"ano": ANO + 1, "unitId": CAR, "fonte": "ORCADO", "reajuste": "0"}, sess=FI)
assert "erro=Reajuste entre" in post("/financeiro/orcamento/planilha", aid_cp, {"ano": ANO + 1, "unitId": CAR, "fonte": "ORCADO", "reajuste": "500", "substituir": "1"}, sess=FI); ok("cópia não sobrescreve sem confirmação e recusa reajuste absurdo")
html = page(f"/financeiro/orcamento?ano={ANO}&mes=2&unidade={CAR}", sess=FI); assert cat in html
aid_ex = aid_of(html, "Registrar explicação")
assert "ok=Explicação registrada" in post("/financeiro/orcamento", aid_ex, {"ano": ANO, "mes": 2, "tipo": "ENTRADA", "categoria": cat, "unitId": CAR, "texto": "Rematrícula antecipada concentrou receita em janeiro.", "voltar": f"/financeiro/orcamento?ano={ANO}&mes=2&unidade={CAR}"}, sess=FI)
assert psql(f"SELECT count(*) FROM budget_comments WHERE ano={ANO} AND mes=2 AND unit_id={CAR}") == "1"
assert "erro=Só Direção, Financeiro e direção da unidade" in post("/financeiro/orcamento", aid_ex, {"ano": ANO, "mes": 2, "tipo": "ENTRADA", "categoria": cat, "texto": "Explicação do RH"}); ok("explicação de desvio registrada; RH não explica desvios")
assert status("/financeiro/orcamento", CO) in (302, 303, 307) and status("/financeiro/projecao", CO) in (302, 303, 307) and status("/financeiro/projecao", FI) == 200 and status(f"/financeiro/projecao?unidade={CAR}", DIR) == 200; ok("FP&A e caixa projetado: Direção, Financeiro, direção da unidade e RH")
r = FI.get(B + f"/api/export/fpa?ano={ANO}&mes=2&unidade={CAR}"); assert r.status_code == 200 and r.text.lstrip("﻿").startswith("ano;mes_referencia;tipo;categoria") and cat in r.text
assert CO.get(B + "/api/export/fpa").status_code == 403; ok("orçado × realizado exportado; coordenação não exporta")

print("Central de fluxos e SLA")
html = page("/fluxos"); assert "Leitura da central" in html and "Em andamento" in html
lista = page("/fluxos?aba=lista&dias=90&sit=ABERTOS")
assert "SOL-2026-9001" in lista and "Pedido LGPD-2026-0042" in lista and "Helena" not in lista and "Rua Secreta" not in lista; ok("RH vê os processos da rede; pedido LGPD aparece só pelo protocolo")
assert "Paulo Professor · Afastamento ou licença" in lista and "AFASTAMENTO_SAUDE" not in lista; ok("afastamento aparece sem o motivo (a central mede prazo, não motivo)")
ld = page(f"/fluxos?aba=lista&sit=ABERTOS&unidade={CUL}", sess=DIR); assert "SOL-2026-9001" in ld and "Família pede reunião" in ld and "Caso Cultura sigilo Zeta" not in ld and "SOL-2026-9002" not in ld; ok("diretora do Carandá: só a própria unidade, mesmo pedindo outra")
assert "Pedido LGPD-2026-0042" not in ld and "Pedido LGPD-2026-0042" not in page("/fluxos?aba=lista&sit=ABERTOS", sess=CO); ok("pedidos LGPD só para quem trata privacidade")
assert status("/fluxos", BR) in (302, 303, 307) and status("/fluxos", OP) == 200 and status("/fluxos?aba=aprovacoes", S) == 200 and status("/fluxos?aba=ncs", S) == 200; ok("autoatendimento fora; abas de aprovações e auditoria abrem")
r = S.get(B + "/api/export/fluxos?dias=90"); assert r.status_code == 200 and "Pedido LGPD-2026-0042" in r.text and "Helena" not in r.text and "AFASTAMENTO_SAUDE" not in r.text
r = DIR.get(B + f"/api/export/fluxos?unidade={CUL}"); assert r.status_code == 200 and "Caso Cultura sigilo Zeta" not in r.text and "SOL-2026-9001" in r.text
assert BR.get(B + "/api/export/fluxos").status_code == 401; ok("exportação da central: sem dados do titular, no escopo do perfil; autoatendimento 401")

print("Minhas pendências")
p = page("/pendencias", sess=DIR); assert "SOL-2026-9001" in p and "Decidir" in p and "SOL-2026-9002" not in p; ok("aprovadora vê a solicitação a decidir (e não a de outra unidade)")
p = page("/pendencias", sess=CO); assert "Família pede reunião sobre adaptação" in p and "Revisar plano de evacuação" in p and "SOL-2026-9001" not in p; ok("coordenação vê o caso e a ação sob sua responsabilidade")
p = page("/pendencias", sess=OP); assert "Ar-condicionado da sala 3 pingando" in p and "Resolver" in p; ok("operações vê o chamado a resolver")
p = page("/pendencias"); assert "Pedido LGPD-2026-0042" in p and "Helena" not in p and "Rua Secreta" not in p; ok("pedido LGPD na caixa do responsável, só com protocolo")
p = page("/pendencias", sess=DG); assert "Relato ET-2026-0007" in p and "1 relato sem responsável" in p and "Omega" not in p and "Sigma" not in p and "ASSEDIO" not in p; ok("comitê de ética vê protocolo e contagem, nunca o conteúdo")
p = page("/pendencias", sess=CO); assert "ET-2026" not in p and "relato sem responsável" not in p; ok("fora do comitê, nada do canal de ética")
p = page("/pendencias?sit=urgentes", sess=CO); assert "Família pede reunião" in p; assert status("/pendencias", BR) == 200 and status("/pendencias", LE) == 200; ok("filtro de urgentes; autoatendimento e leitura têm a própria caixa")

print("Rotina diária e lembrete")
j = requests.get(B + f"/api/tarefas?token={TOKEN}").json(); assert j["ok"] and "v23" in j and j["v23"]["falhas"] == [], j.get("v23")
n_hoje = int(psql(f"SELECT count(*) FROM notifications WHERE chave='pend:{H}'"))
if HOJE.weekday() < 5:
    assert int(psql(f"SELECT count(*) FROM notifications WHERE user_id={UDIR} AND chave='pend:{H}'")) == 1
    requests.get(B + f"/api/tarefas?token={TOKEN}"); assert int(psql(f"SELECT count(*) FROM notifications WHERE chave='pend:{H}'")) == n_hoje; ok("dia útil: lembrete enviado uma vez (rodar de novo não duplica)")
else:
    assert n_hoje == 0; ok("fim de semana: nenhum lembrete de pendências")
SEG = (HOJE + timedelta(days=(7 - HOJE.weekday()) % 7 or 7)).isoformat(); SAB = (HOJE + timedelta(days=(5 - HOJE.weekday()) % 7 or 7)).isoformat()
cmd = lambda dia: f'import("./src/lib/rotina-v23").then(async m => {{ const x = m.default ?? m; const r = await x.lembretePendencias("{dia}"); console.log(JSON.stringify(r)); process.exit(0); }})'
r1 = json.loads(tsx(cmd(SEG))); assert r1["avisados"] >= 4 and not r1["interrompido"], r1
txt = psql(f"SELECT texto FROM notifications WHERE user_id={UDIR} AND chave='pend:{SEG}'"); assert "vencida" in txt and "Solicitações" in txt and "robótica" not in txt and "SOL-2026" not in txt, txt
txt = psql(f"SELECT string_agg(texto, ' | ') FROM notifications WHERE chave='pend:{SEG}'"); assert "Helena" not in txt and "Omega" not in txt and "Sigma" not in txt and "LGPD-2026-0042" not in txt and "Família pede" not in txt, txt
assert psql(f"SELECT count(*) FROM notifications WHERE chave='pend:{SEG}' AND user_id IN ({ULEI}, {UB})") == "0"; ok("lembrete de segunda: números e módulos, sem conteúdo; leitura e quem não tem urgência ficam de fora")
r2 = json.loads(tsx(cmd(SEG))); assert r2["avisados"] == 0 and int(psql(f"SELECT count(*) FROM notifications WHERE chave='pend:{SEG}'")) == r1["avisados"]; ok("um lembrete por pessoa por dia")
assert json.loads(tsx(cmd(SAB)))["avisados"] == 0; ok("sábado e domingo sem lembrete")

print("Busca global")
r = requests.get(B + "/api/busca?q=Paulo", allow_redirects=False); assert r.status_code in (302, 307) and r.headers["location"].endswith("/login"); ok("busca exige sessão")
assert tem(busca(S, "paulo"), "Colaboradores", "Paulo Professor") and tem(busca(S, "LIVIA"), "Alunos e candidatos", "Lívia") and tem(busca(S, "conceicao de nada"), "Colaboradores") is False; ok("RH acha pessoas e alunos sem acento nem caixa")
rc = busca(DCUL, "Paulo"); assert not tem(rc, "Colaboradores", "Paulo") and tem(busca(DCUL, "carla"), "Colaboradores", "Carla Cultura") and not tem(busca(DCUL, "Lívia"), "Alunos e candidatos"); ok("diretor da Cultura não acha pessoas nem alunos do Carandá")
rb = busca(BR, "Paulo"); assert not tem(rb, "Colaboradores") and not tem(busca(BR, "Lívia"), "Alunos e candidatos"); ok("autoatendimento não busca pessoas nem alunos")
assert tem(busca(CM, "condicionado"), "Chamados", "Ar-condicionado") and not tem(busca(CM, "lâmpadas"), "Chamados") and tem(busca(OP, "lampadas"), "Chamados", "lâmpadas"); ok("chamados: quem não é de operações acha só os que abriu")
assert tem(busca(DIR, "robótica"), "Solicitações") and tem(busca(CO, "robotica"), "Solicitações") and not tem(busca(CM, "robótica"), "Solicitações") and not tem(busca(DCUL, "robótica"), "Solicitações"); ok("solicitações: quem pediu, quem aprova e a direção da unidade — mais ninguém")
assert tem(busca(CO, "Família pede"), "Casos das famílias") and not tem(busca(CO, "Zeta"), "Casos das famílias") and not tem(busca(OP, "Família pede"), "Casos das famílias"); ok("casos no escopo da unidade; operações não vê casos")
assert tem(busca(FI, "custo de pessoal"), "Indicadores") and not tem(busca(CO, "custo de pessoal"), "Indicadores"); ok("indicadores na busca seguem o perfil (salarial)")
assert busca(S, "a") == [] and busca(S, "%_") == []; assert all(x["href"].startswith("/") for x in busca(S, "Professor")); ok("termo curto não busca; links internos")
codes = [LE.get(B + "/api/busca", params={"q": f"teste {i}"}).status_code for i in range(62)]; assert 429 in codes and codes[0] == 200; ok("limite de buscas por minuto")

print("Mural de reconhecimento")
html = page("/reconhecimento", sess=BR); aid_rc = aid_of(html, "Publicar no mural")
sel = re.search(r'<select[^>]*name="para".*?</select>', html, re.S).group(0); assert f'value="{EP}"' in sel and f'value="{EC}"' not in sel and f'value="{EB}"' not in sel; ok("colaborador reconhece colegas da própria unidade (e não a si mesmo)")
assert "erro=Reconheça um colega" in post("/reconhecimento", aid_rc, {"para": EB, "valor": "", "mensagem": "Eu mesma fiz um ótimo trabalho hoje."}, sess=BR)
assert "erro=Escolha um colega da lista" in post("/reconhecimento", aid_rc, {"para": EC, "valor": "", "mensagem": "Obrigada pela ajuda com a feira de ciências!"}, sess=BR)
assert "erro=Conte o que a pessoa fez" in post("/reconhecimento", aid_rc, {"para": EP, "valor": "", "mensagem": "Valeu!"}, sess=BR)
assert "erro=Escolha um dos valores" in post("/reconhecimento", aid_rc, {"para": EP, "valor": "Valor inventado", "mensagem": "Obrigada pela ajuda com a feira de ciências!"}, sess=BR)
assert "erro=Seu acesso só lê o mural" in post("/reconhecimento", aid_rc, {"para": EP, "valor": "", "mensagem": "Parabéns pela organização da feira!"}, sess=LE); ok("recusados: a si mesmo, outra unidade, mensagem curta, valor fora da lista e perfil de leitura")
assert "ok=Reconhecimento publicado" in post("/reconhecimento", aid_rc, {"para": EP, "valor": "", "mensagem": "Obrigada pela ajuda com a feira de ciências, Paulo!"}, sess=BR)
RID = psql(f"SELECT id FROM recognitions WHERE de_user_id={UB}"); assert psql(f"SELECT count(*) FROM notifications WHERE user_id={UP} AND chave='recon:{RID}'") == "1" and "feira de ciências" in page("/reconhecimento", sess=PA); ok("publicado no mural e Paulo é avisado")
html = page("/reconhecimento", sess=CO); aid_ap = aid_of(html, 'aria-label="Aplaudir"')
post("/reconhecimento", aid_ap, {"id": RID, "voltar": "/reconhecimento"}, sess=CO); assert psql(f"SELECT count(*) FROM recognition_reactions WHERE recognition_id={RID}") == "1"
post("/reconhecimento", aid_ap, {"id": RID, "voltar": "/reconhecimento"}, sess=CO); assert psql(f"SELECT count(*) FROM recognition_reactions WHERE recognition_id={RID}") == "0"
assert "erro=Seu acesso só lê o mural" in post("/reconhecimento", aid_ap, {"id": RID}, sess=LE) and 'aria-label="Aplaudir"' not in page("/reconhecimento", sess=LE); ok("aplauso liga e desliga; leitura não aplaude")
html = page("/reconhecimento"); aid_mod = aid_of(html, ">Ocultar<")
assert "erro=Só Direção e RH moderam" in post("/reconhecimento", aid_mod, {"id": RID, "acao": "ocultar", "motivo": "Mensagem inadequada"}, sess=CO)
assert "erro=Informe o motivo" in post("/reconhecimento", aid_mod, {"id": RID, "acao": "ocultar", "motivo": ""})
assert "ok=Recado ocultado" in post("/reconhecimento", aid_mod, {"id": RID, "acao": "ocultar", "motivo": "Pedido do colaborador"}) and psql(f"SELECT status FROM recognitions WHERE id={RID}") == "OCULTO"
assert "feira de ciências" not in page("/reconhecimento", sess=PA) and "oculto do mural" in page("/reconhecimento"); assert "erro=" in post("/reconhecimento", aid_ap, {"id": RID}, sess=CO); ok("moderação só Direção e RH, com motivo; oculto some do mural e não recebe aplauso")
psql(f"INSERT INTO recognitions (de_user_id, de_nome, para_employee_id, mensagem, unit_id) SELECT {UB}, 'Bruna', {EP}, 'Recado de carga número ' || g, {CAR} FROM generate_series(1, 9) g")
assert "erro=Você já publicou 10 reconhecimentos" in post("/reconhecimento", aid_rc, {"para": EP, "valor": "", "mensagem": "Mais um obrigado pela parceria de sempre!"}, sess=BR); ok("limite de 10 reconhecimentos por pessoa em 24 horas")

print("Início personalizável")
html = page("/"); assert h2(html, "Minhas pendências") and h2(html, "Mural de reconhecimento") and h2(html, "Últimas ações registradas") and "Colaboradores ativos" in html; ok("Início do RH com pendências, indicadores, pessoas, mural e auditoria")
html = page("/inicio/personalizar"); aid_ini = aid_of(html, "Salvar o meu Início")
loc = post("/inicio/personalizar", aid_ini, {"bloco_pendencias": "1", "ordem_pendencias": "2", "bloco_comunicados": "1", "ordem_comunicados": "1", "atalho": ["fluxos", "reconhecer"], "kpi": ["pessoas.quadro", "nao.existe"]}); assert "ok=Início atualizado" in loc, loc
pref = json.loads(psql(f"SELECT json_build_object('i', inicio, 'a', atalhos) FROM user_prefs WHERE user_id={RH}"))
assert pref["i"]["blocos"] == ["comunicados", "pendencias"] and sorted(pref["a"]) == ["fluxos", "reconhecer"] and pref["i"]["kpis"] == ["pessoas.quadro"], pref
html = page("/"); assert h2(html, "Comunicados") and not h2(html, "Mural de reconhecimento") and not h2(html, "Últimas ações registradas") and html.find(">Comunicados<") < html.find("Minhas pendências ("); ok("blocos e ordem escolhidos; indicador inexistente descartado")
assert "erro=Escolha até 8 atalhos" in post("/inicio/personalizar", aid_ini, {"bloco_pendencias": "1", "atalho": ["pendencias", "solicitacao", "chamado", "espaco", "cobertura", "reconhecer", "executivo", "apresentar", "fluxos"]}); ok("até 8 atalhos")
aid_rst = aid_of(page("/inicio/personalizar"), "Restaurar o padrão da atuação"); assert "ok=Início de volta ao padrão" in post("/inicio/personalizar", aid_rst, {}); assert psql(f"SELECT count(*) FROM user_prefs WHERE user_id={RH}") == "0" and h2(page("/"), "Mural de reconhecimento"); ok("restaurar volta ao padrão do perfil")
st, lo = destino("/", CM); assert st in (302, 303, 307) and lo.endswith("/matriculas"), (st, lo)
post("/inicio/personalizar", aid_ini, {"paginaInicial": "inicio", "bloco_pendencias": "1", "kpi": ["financeiro.receita", "matriculas.rematricula"], "atalho": ["vagas", "colaborador"]}, sess=CM)
pref = json.loads(psql(f"SELECT json_build_object('i', inicio, 'a', atalhos) FROM user_prefs WHERE user_id={UCOM}")); assert pref["i"]["kpis"] == ["matriculas.rematricula"] and pref["a"] == ["vagas"] and pref["i"]["paginaInicial"] == "inicio", pref
assert status("/", CM) == 200; ok("Comercial entra no módulo por padrão e pode optar pelo Início (só indicadores e atalhos do perfil)")
st, lo = destino("/", BR); assert st in (302, 303, 307) and lo.endswith("/eu"), (st, lo)
post("/inicio/personalizar", aid_ini, {"paginaInicial": "inicio", "bloco_pendencias": "1", "bloco_pessoas": "1", "bloco_auditoria": "1", "bloco_mural": "1"}, sess=BR)
assert json.loads(psql(f"SELECT inicio FROM user_prefs WHERE user_id={UB}"))["blocos"] == ["pendencias", "mural"]; html = page("/", sess=BR); assert h2(html, "Mural de reconhecimento") and "Colaboradores ativos" not in html; ok("autoatendimento: Início opcional, sem blocos de gestão (mesmo forçando o formulário)")
for papel, sess in [("financeiro", FI), ("operações", OP)]: st, lo = destino("/", sess); assert st in (302, 303, 307), papel
ok("Financeiro e Operações continuam entrando no próprio módulo")

print("Quadros, cronograma, alinhamento e metas")
q = page("/atendimento/casos/quadro", sess=CO); assert "Família pede reunião" in q and "Caso Cultura sigilo Zeta" not in q and "vencido há" in q; ok("quadro de casos no escopo da unidade, com o prazo vencido no cartão")
q = page("/operacoes/chamados/quadro", sess=CM); assert "Ar-condicionado" in q and "lâmpadas do pátio" not in q; q = page("/operacoes/chamados/quadro", sess=OP); assert "Ar-condicionado" in q and "lâmpadas do pátio" in q; ok("quadro de chamados: só os próprios para quem não é de operações")
q = page("/estrategia/acoes/quadro", sess=CO); assert "Revisar plano de evacuação" in q; assert status("/estrategia/acoes/quadro", BR) in (302, 303, 307); ok("quadro do plano de ação")
for path in ["/estrategia/cronograma", "/estrategia/alinhamento", "/matriculas/metas", "/matriculas/rematricula/quadro", "/ferias/calendario"]: assert status(path, S) == 200, path
for path in ["/matriculas/metas", "/matriculas/rematricula/quadro"]: assert status(path, CM) == 200 and status(path, BR) in (302, 303, 307), path
ok("cronograma (Gantt), alinhamento, metas e previsão, quadro da rematrícula e calendário abrem; autoatendimento fora")
cg = page("/ferias/calendario", sess=CO); cr = page("/ferias/calendario")
assert "Paulo Professor" in cg and "Ausência" in cg and "Afastamento ou licença" not in cg and "Afastamento ou licença" in cr; ok("quem está fora: a coordenação vê \"Ausência\"; RH vê o tipo")

print("Configurações do Insights")
html = page("/configuracoes"); aid_cfg = aid_of(html, "Salvar parâmetros do Insights"); aid_mat = aid_of(html, "Prazo da oferta na fila")
base = {"toleranciaPct": "20", "riscoPct": "30", "prazoDecisaoDias": "3", "prazoFeriasDias": "4", "cenarioPessimistaPct": "90", "cenarioOtimistaPct": "80"}
assert "erro=" in post("/configuracoes", aid_cfg, base) and "pessimista" in unq(post("/configuracoes", aid_cfg, base))
assert "erro=" in post("/configuracoes", aid_cfg, {**base, "cenarioOtimistaPct": "95", "toleranciaPct": "80"})
assert "erro=" in post("/configuracoes", aid_cfg, {**base, "cenarioOtimistaPct": "95"}, sess=FI) and psql("SELECT count(*) FROM settings WHERE key='insights'") == "0"; ok("parâmetros recusados: cenário invertido, tolerância fora da faixa e perfil sem configuração")
assert "ok=Parâmetros do Insights salvos" in post("/configuracoes", aid_cfg, {**base, "cenarioOtimistaPct": "95", "resumoSemanal": "1"})
cfgs = {k: json.loads(psql(f"SELECT value FROM settings WHERE key='{k}'")) for k in ["insights", "fluxos", "fpa"]}
assert cfgs["insights"]["toleranciaPct"] == 20 and cfgs["insights"]["resumoSemanal"] is True and cfgs["insights"]["lembretePendencias"] is False and cfgs["insights"]["mesesHistorico"] == 24, cfgs
assert cfgs["fluxos"] == {"riscoPct": 30, "prazoDecisaoDias": 3, "prazoFeriasDias": 4} and cfgs["fpa"] == {"cenarioPessimistaPct": 90, "cenarioOtimistaPct": 95, "reservaMinima": 0}, cfgs  # v27: reserva mínima de caixa (0 = desligada)
assert psql(f"SELECT count(*) FROM audit_log WHERE entidade='settings' AND user_id={RH} AND depois ? 'insights' AND depois->'fluxos'->>'riscoPct' = '30'") == "1"; ok("farol, resumo, lembrete, prazos da central e cenários do caixa salvos (e auditados)")
SEG2 = (datetime.fromisoformat(SEG) + timedelta(days=7)).date().isoformat(); assert json.loads(tsx(cmd(SEG2)))["avisados"] == 0; ok("lembrete desligado nas configurações: ninguém é avisado")
assert status("/fluxos", S) == 200 and status("/executivo", S) == 200 and status("/financeiro/projecao", FI) == 200; ok("painel, central e caixa abrem com os parâmetros novos")
assert "ok=" in post("/configuracoes", aid_mat, {"anoLetivo": "2027", "reservaDias": "3", "ofertaFilaDias": "2", "fimCampanha": "2027-02-15", "metaRematriculaPct": "90"})
assert "ok=" in post("/configuracoes", aid_mat, {"anoLetivo": "2027", "reservaDias": "5", "ofertaFilaDias": "2"})
m = json.loads(psql("SELECT value FROM settings WHERE key='matriculas'")); assert m["fimCampanha"] == "2027-02-15" and m["metaRematriculaPct"] == 90 and m["reservaDias"] == 5, m
assert "erro=" in post("/configuracoes", aid_mat, {"anoLetivo": "2027", "reservaDias": "3", "ofertaFilaDias": "2", "fimCampanha": "15/02/2027"}) and "erro=" in post("/configuracoes", aid_mat, {"anoLetivo": "2027", "reservaDias": "3", "ofertaFilaDias": "2", "metaRematriculaPct": "150"})
assert status("/matriculas/metas", CM) == 200; ok("fim da campanha e meta de rematrícula salvos; salvar o formulário antigo não apaga os parâmetros novos")

print(f"\nE2E Insights v23: {N[0]} verificações OK")
