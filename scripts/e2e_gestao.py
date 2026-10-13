# E2E — Gestão estratégica v21: identidade versionada, mapa por perspectivas, biblioteca de indicadores (farol, sistema, calculado,
# importação), plano de ação 5W2H, rituais com pauta automática/ata/decisões/encaminhamentos, saúde estratégica explicável,
# marketing agregado (sem lead individual), relatório, Command Center, TV, rotina diária — com permissões e escopo (IDOR).
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
    return re.sub(r"<script[^>]*>.*?</script>", "", re.sub(r"<!--.*?-->", "", r.text), flags=re.S).replace("\xa0", " ").replace(" ", " ")
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
def aid_near(html, marker):
    i = html.find(marker); assert i >= 0, marker
    ids = list(re.finditer(r'\$ACTION_ID_([0-9a-f]+)', html[:i])); assert ids, marker; return ids[-1].group(1)
def login(sess, email, senha):
    html = sess.get(B + "/login").text; aid = re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', html)[0]
    loc = post("/login", aid, {"email": email, "senha": senha}, sess=sess); assert loc.endswith("/"), loc
def erro(loc, trecho): assert "erro=" in loc and trecho in loc, (trecho, loc)
def okmsg(loc, trecho=""): assert "ok=" in loc and trecho in loc, (trecho, loc)
def sub(html): m = re.search(r"<h1[^>]*>.*?</h1>\s*<p[^>]*>(.*?)</p>", html, re.S); return m.group(1) if m else ""
def nid(loc, rota): m = re.search(rf"/{rota}/(\d+)", loc); assert m, (rota, loc); return m.group(1)

HOJE = datetime.now(ZoneInfo("America/Campo_Grande")).date(); H = HOJE.isoformat(); PER = H[:7]; ANO = HOJE.year
def d(n): return (HOJE + timedelta(days=n)).isoformat()
def soma_mes(p, n): y, m = map(int, p.split("-")); t = y * 12 + (m - 1) + n; return f"{t // 12}-{t % 12 + 1:02d}"
PANT = soma_mes(PER, -1); PPROX = soma_mes(PER, 1)
def br(iso): return "/".join(reversed(iso.split("-")))

print("Preparação")
login(S, "rh@colegiostatus", "Status2026!"); r = S.get(B + f"/api/setup?token={TOKEN}"); assert r.json()["ok"], r.text
CAR = psql("SELECT id FROM units WHERE nome='Carandá'"); CUL = psql("SELECT id FROM units WHERE nome='Cultura'"); RH = psql("SELECT id FROM users WHERE email='rh@colegiostatus'")
html = page("/configuracoes"); aid_user = aid_of(html, "Criar acesso")
def criar_user(nome, email, role, unit=""):
    post("/configuracoes", aid_user, {"nome": nome, "email": email, "role": role, "unitId": unit, "senha": "senha12345"}); return psql(f"SELECT id FROM users WHERE email='{email}'")
DIR = criar_user("Diretora Carandá", "dir@car", "DIRETOR_UNIDADE", CAR); GES = criar_user("Gestor Cultura", "ges@cul", "GESTOR", CUL); COM = criar_user("Comercial Rede", "com@rede", "COMERCIAL"); FIN = criar_user("Financeiro Rede", "fin@rede", "FINANCEIRO"); LEI = criar_user("Leitura Rede", "lei@rede", "LEITURA")
DS = mk(); login(DS, "dir@car", "senha12345"); G = mk(); login(G, "ges@cul", "senha12345"); C = mk(); login(C, "com@rede", "senha12345"); F = mk(); login(F, "fin@rede", "senha12345"); L = mk(); login(L, "lei@rede", "senha12345")
ok("usuários de teste: diretora (Carandá), gestor (Cultura), comercial, financeiro, leitura")

print("Acesso por perfil")
for sess, nome in [(C, "comercial"), (F, "financeiro"), (L, "leitura")]:
    html = page("/estrategia", sess=sess); assert "Saúde estratégica" in html and "Estratégia 2027" in html, nome
    for p in ["/estrategia/indicadores", "/estrategia/acoes", "/estrategia/rituais", "/estrategia/marketing", "/estrategia/mapa", "/estrategia/identidade", "/estrategia/relatorio"]: page(p, sess=sess)
ok("comercial, financeiro e leitura abrem a Estratégia (o menu já mostrava; antes a página redirecionava)")
html = page("/estrategia"); assert "Estratégia 2027" in html and "Encher as salas de 2027" in html and "Saúde financeira previsível" in html and "Identidade institucional (missão, visão e valores) ainda não publicada" in html
assert all(x in html for x in ["Progresso dos OKRs", "Indicadores no alvo e com medição em dia", "Ações do plano em dia", "Rituais de gestão em dia", "sem base"]); ok("painel: saúde estratégica com componentes, OKRs 2027 e alerta de identidade não publicada")

assert psql("SELECT count(*) FROM indicators WHERE tipo='SISTEMA'") == "16"; r = S.get(B + f"/api/setup?token={TOKEN}"); assert r.json()["ok"] and psql("SELECT count(*) FROM indicators") == "16"
html = page("/estrategia/indicadores"); assert all(x in html for x in ["FIN-01", "Inadimplência 90 dias", "FAM-02", "PES-01", "APR-03"]); assert psql("SELECT count(DISTINCT perspectiva) FROM indicators") == "5"
ok("biblioteca inicial: 16 indicadores lidos do sistema nas 5 perspectivas, criada uma única vez")
print("Identidade institucional")
html = page("/estrategia/identidade"); assert "Rascunho — versão 1" in html and "Verdade" in html and "Nenhuma versão publicada" in html; ok("rascunho v1 com os valores do Colégio Status")
aid_pub = aid_of(html, "Publicar como vigente"); aid_sal = aid_of(html, 'name="missao"')
erro(post("/estrategia/identidade", aid_pub, {}), "missão e visão"); ok("publicar sem missão e visão é recusado")
IDT = {"missao": "Formar pessoas íntegras e competentes, em parceria com as famílias.", "visao": "Ser a escola de referência em Campo Grande até 2029.", "proposito": "", "propostaValor": "Acompanhamento próximo de cada aluno", "posicionamento": "Excelência com afeto", "horizonte": "2027–2029"}
okmsg(post("/estrategia/identidade", aid_sal, {**IDT, "valores": "Verdade | Diz o que pensa com respeito\nAfetividade |"}), "Rascunho salvo")
erro(post("/estrategia/identidade", aid_pub, {}), "faltam: Afetividade"); ok("valor sem prática observável bloqueia a publicação")
okmsg(post("/estrategia/identidade", aid_sal, {**IDT, "valores": "Verdade | Diz o que pensa com respeito\nAfetividade | Chama cada aluno pelo nome e conhece a família"}))
okmsg(post("/estrategia/identidade", aid_pub, {}), "publicada como vigente")
html = page("/estrategia/identidade"); assert "versão 1" in html and "Chama cada aluno pelo nome" in html and "Criar rascunho a partir da vigente" in html
assert "ainda não publicada" not in page("/estrategia"); ok("identidade publicada (v1) e alerta some do painel")
aid_nv = aid_of(html, "Criar rascunho a partir da vigente"); okmsg(post("/estrategia/identidade", aid_nv, {}), "Nova versão"); erro(post("/estrategia/identidade", aid_nv, {}), "Já existe um rascunho")
html = page("/estrategia/identidade"); assert "Rascunho — versão 2" in html and "Formar pessoas íntegras" in html
okmsg(post("/estrategia/identidade", aid_pub, {}), "arquivada"); html = page("/estrategia/identidade"); assert "versão 2" in html and "Versão 1 · vigente de" in html
assert psql("SELECT string_agg(versao || ':' || status, ',' ORDER BY versao) FROM strategy_identity") == "1:ARQUIVADO,2:VIGENTE"; ok("nova versão: rascunho copia a vigente; publicar arquiva a anterior (histórico)")
erro(post("/estrategia/identidade", aid_sal, IDT, sess=DS), "Direção/RH"); erro(post("/estrategia/identidade", aid_nv, {}, sess=C), "Sem permissão"); ok("diretora e comercial não alteram a identidade")

print("Mapa estratégico")
html = page("/estrategia/mapa")
pos = [html.find(f'id="p-{k}"') for k in ["FINANCEIRA", "FAMILIAS", "PROCESSOS", "PESSOAS", "APRENDIZADO"]]; assert all(p > 0 for p in pos) and pos == sorted(pos), pos
def banda(html, k): i = html.find(f'id="p-{k}"'); j = html.find("<section", i + 10); return html[i:j if j > 0 else len(html)]
assert "Encher as salas de 2027" in banda(html, "FAMILIAS") and "posição sugerida pelo pilar Comercial e Marca" in banda(html, "FAMILIAS") and "Saúde financeira previsível" in banda(html, "FINANCEIRA") and "Uma equipe que fica e cresce" in banda(html, "PESSOAS")
ok("perspectivas na ordem do mapa; objetivos posicionados pela sugestão do pilar")
aid_p = aid_of(html, 'name="perspectiva"'); okmsg(post("/estrategia/mapa", aid_p, {"objectiveId": 4, "perspectiva": "APRENDIZADO", "voltar": "/estrategia/mapa"}), "posicionado")
html = page("/estrategia/mapa"); assert "Escola que roda por processo" in banda(html, "APRENDIZADO") and "Escola que roda por processo" not in banda(html, "PROCESSOS"); ok("perspectiva definida prevalece sobre a do pilar")
aid_l = aid_of(html, 'name="deObjectiveId"')
okmsg(post("/estrategia/mapa", aid_l, {"deObjectiveId": 3, "paraObjectiveId": 1}), "causa e efeito"); okmsg(post("/estrategia/mapa", aid_l, {"deObjectiveId": 1, "paraObjectiveId": 2}))
erro(post("/estrategia/mapa", aid_l, {"deObjectiveId": 1, "paraObjectiveId": 3}), "relação inversa"); erro(post("/estrategia/mapa", aid_l, {"deObjectiveId": 2, "paraObjectiveId": 3}), "ciclo"); erro(post("/estrategia/mapa", aid_l, {"deObjectiveId": 2, "paraObjectiveId": 2}), "diferentes")
ok("causa e efeito: relação inversa e ciclo indireto (A→B→C→A) recusados")
html = page("/estrategia/mapa"); assert "contribui para →" in html and "sustentado por ←" in html
erro(post("/estrategia/mapa", aid_l, {"deObjectiveId": 5, "paraObjectiveId": 1}, sess=DS), "Direção/RH"); erro(post("/estrategia/mapa", aid_p, {"objectiveId": 1, "perspectiva": "PROCESSOS"}, sess=DS), "Só Direção/RH"); ok("diretora não liga objetivos nem reposiciona objetivo da rede")
html = page("/estrategia/okrs/1"); assert "No mapa estratégico" in html and "Famílias e alunos" in html and "contribui para" in html and "sustentado por" in html; ok("objetivo mostra perspectiva e relações do mapa")
link = psql("SELECT id FROM objective_links WHERE de_objective_id=1 AND para_objective_id=2"); aid_d = aid_of(page("/estrategia/mapa"), 'aria-label="remover relação"')
okmsg(post("/estrategia/mapa", aid_d, {"id": link, "voltar": "/estrategia/mapa"}), "removida"); assert psql("SELECT count(*) FROM objective_links") == "1"; ok("relação removida")

print("Indicadores")
html = page("/estrategia/indicadores"); aid_ind = aid_of(html, 'name="faixaMin"')
BASE = {"codigo": "", "descricao": "", "perspectiva": "", "area": "", "unitId": "", "unidadeMedida": "%", "direcao": "MAIOR_MELHOR", "meta": "", "alerta": "", "faixaMin": "", "faixaMax": "", "tipo": "MANUAL", "frequencia": "MENSAL", "fonte": "", "numeradorId": "", "denominadorId": "", "fator": "", "funil": "", "canal": "", "responsavelUserId": "", "objectiveId": "", "ordem": 0}
def ind(**kw): x = dict(BASE); x.update(kw); return x
erro(post("/estrategia/indicadores", aid_ind, ind(nome="Satisfação", meta=85, alerta=90)), "menor que a meta")
erro(post("/estrategia/indicadores", aid_ind, ind(nome="Inadimplência", direcao="MENOR_MELHOR", meta=4, alerta=3)), "maior que a meta")
erro(post("/estrategia/indicadores", aid_ind, ind(nome="Alunos por turma", direcao="FAIXA", faixaMin=22)), "mínimo e máximo")
erro(post("/estrategia/indicadores", aid_ind, ind(nome="X", meta="abc")), "número inválido")
erro(post("/estrategia/indicadores", aid_ind, ind(nome="Sem fonte", tipo="SISTEMA")), "métrica do sistema"); ok("configuração incoerente recusada (limite de atenção, faixa, número, fonte)")
I1 = nid(post("/estrategia/indicadores", aid_ind, ind(codigo="TST-FAM", nome="Satisfação nas reuniões de pais", perspectiva="FAMILIAS", area="Atendimento às famílias", meta=85, alerta=75, responsavelUserId=COM, objectiveId=1)), "estrategia/indicadores")
html = page(f"/estrategia/indicadores/{I1}"); assert "Sem medição" in sub(html) and "No alvo: ≥ 85%" in html; aid_med = aid_of(html, 'name="obs"')
okmsg(post(f"/estrategia/indicadores/{I1}", aid_med, {"indicatorId": I1, "periodo": PANT, "valor": 80, "obs": "reunião de setembro"}), "Medição registrada")
assert "Atenção" in sub(page(f"/estrategia/indicadores/{I1}")); ok("80 com meta 85 e atenção 75 → Atenção")
okmsg(post(f"/estrategia/indicadores/{I1}", aid_med, {"indicatorId": I1, "periodo": PER, "valor": 90, "obs": ""})); assert "No alvo" in sub(page(f"/estrategia/indicadores/{I1}"))
okmsg(post(f"/estrategia/indicadores/{I1}", aid_med, {"indicatorId": I1, "periodo": PER, "valor": 70, "obs": ""}), "corrigida"); assert "Fora do alvo" in sub(page(f"/estrategia/indicadores/{I1}"))
assert psql(f"SELECT count(*) FROM audit_log WHERE entidade='indicators' AND entidade_id={I1} AND acao='corrigir medição de indicador'") == "1"; ok("90 → No alvo; correção para 70 → Fora do alvo, valor anterior na auditoria")
erro(post(f"/estrategia/indicadores/{I1}", aid_med, {"indicatorId": I1, "periodo": PPROX, "valor": 1}), "mês futuro"); erro(post(f"/estrategia/indicadores/{I1}", aid_med, {"indicatorId": I1, "periodo": PER, "valor": "abc"}), "número inválido")
erro(post(f"/estrategia/indicadores/{I1}", aid_med, {"indicatorId": I1, "periodo": PER, "valor": 88}, sess=G), "Só o responsável"); okmsg(post(f"/estrategia/indicadores/{I1}", aid_med, {"indicatorId": I1, "periodo": PER, "valor": 88}, sess=C), "corrigida")
ok("mês futuro e texto recusados; só o responsável (ou Direção/RH) mede")
I_SIS = nid(post("/estrategia/indicadores", aid_ind, ind(codigo="TST-MAT", nome="Candidatos no mês", tipo="SISTEMA", fonte="matriculas.candidatos_mes", unidadeMedida="candidatos", perspectiva="FAMILIAS", area="Matrículas e marketing")), "estrategia/indicadores")
assert psql(f"SELECT count(*) FROM indicator_values WHERE indicator_id={I_SIS} AND origem='SISTEMA' AND periodo IN ('{PER}','{PANT}')") == "2"
erro(post(f"/estrategia/indicadores/{I1}", aid_med, {"indicatorId": I_SIS, "periodo": PER, "valor": 3}), "lido do sistema"); ok("indicador lido do sistema grava mês atual e anterior; não aceita medição manual")
I_INV = nid(post("/estrategia/indicadores", aid_ind, ind(codigo="TST-MKT", nome="Investimento total em captação", unidadeMedida="R$", direcao="MENOR_MELHOR", responsavelUserId=RH)), "estrategia/indicadores")
erro(post("/estrategia/indicadores", aid_ind, ind(nome="Custo por candidato", tipo="CALCULADO", numeradorId=I_INV, denominadorId=I_INV)), "diferentes")
I_CAL = nid(post("/estrategia/indicadores", aid_ind, ind(nome="Custo por candidato (calculado)", tipo="CALCULADO", numeradorId=I_INV, denominadorId=I_SIS, unidadeMedida="R$", direcao="MENOR_MELHOR", meta=150, alerta=200)), "estrategia/indicadores")
erro(post("/estrategia/indicadores", aid_ind, ind(nome="Y", tipo="CALCULADO", numeradorId=I_CAL, denominadorId=I_INV)), "medidos")
okmsg(post(f"/estrategia/indicadores/{I_INV}", aid_med, {"indicatorId": I_INV, "periodo": PER, "valor": 600, "obs": ""}))
html = page(f"/estrategia/indicadores/{I_CAL}"); assert "denominador zero" in html and "Sem medição" in sub(html); ok("calculado: 600 ÷ 0 candidatos = sem base (motivo na série), nunca zero ou infinito")
html = page("/estrategia/indicadores"); aid_imp = aid_of(html, 'name="csv"')
loc = post("/estrategia/indicadores", aid_imp, {"csv": f"indicador;período;valor\nTST-FAM;{PANT[5:]}/{PANT[:4]};81,5\nTST-FAM;{PANT};82\nNAOEXISTE;{PER};1\nTST-MAT;{PER};5"})
okmsg(loc, "2 medição(ões) importada(s)"); assert "2 linha(s) com erro" in loc and "NAOEXISTE" in loc and "TST-MAT" in loc
assert psql(f"SELECT valor::float FROM indicator_values WHERE indicator_id={I1} AND periodo='{PANT}'") == "82"; ok("importação: MM/AAAA e AAAA-MM, vírgula decimal, linhas inválidas apontadas")
loc = post("/estrategia/indicadores", aid_imp, {"csv": f"TST-FAM;{PER};90"}, sess=G); okmsg(loc, "0 medição(ões)"); assert "Só o responsável" in loc; ok("importação respeita quem pode medir")
okmsg(post("/estrategia/indicadores", aid_imp, {"csv": f"TST-MKT;{PANT};1.500\nTST-MKT;{PER};R$ 2.500,50"}), "2 medição(ões) importada(s)")
assert psql(f"SELECT string_agg(valor::float::text, ',' ORDER BY periodo) FROM indicator_values WHERE indicator_id={I_INV}") == "1500,2500.5"
okmsg(post("/estrategia/indicadores", aid_imp, {"csv": f"TST-MKT;{PER};600"})); ok("importação: 1.500 = mil e quinhentos; R$ 2.500,50 com centavos")
I_CAR = nid(post("/estrategia/indicadores", aid_ind, ind(nome="Ocupação Carandá", unitId=CAR, meta=90, alerta=80)), "estrategia/indicadores")
page(f"/estrategia/indicadores/{I_CAR}", expect=404, sess=G); assert "Ocupação Carandá" not in page("/estrategia/indicadores", sess=G) and "Satisfação nas reuniões de pais" in page("/estrategia/indicadores", sess=G)
assert "Editar indicador" in page(f"/estrategia/indicadores/{I_CAR}", sess=DS); ok("IDOR: indicador de Carandá invisível para o gestor da Cultura; diretora edita o da própria unidade")
erro(post("/estrategia/indicadores", aid_ind, ind(nome="Rede pela diretora"), sess=DS), "Direção/RH"); erro(post("/estrategia/indicadores", aid_ind, ind(nome="Do gestor", unitId=CUL), sess=G), "Direção/RH")
okmsg(post("/estrategia/indicadores", aid_ind, ind(nome="Evasão Carandá", unitId=CAR, direcao="MENOR_MELHOR", meta=2, alerta=3), sess=DS), "Indicador salvo"); ok("diretora cria indicador só da própria unidade; gestor não cria")
I_CUL = nid(post("/estrategia/indicadores", aid_ind, ind(nome="Ocupação Cultura", unitId=CUL, meta=90, alerta=80)), "estrategia/indicadores"); I_CARM = psql("SELECT id FROM indicators WHERE nome='Evasão Carandá'")
erro(post("/estrategia/indicadores", aid_ind, ind(nome="Espião", unitId=CAR, tipo="CALCULADO", numeradorId=I_CUL, denominadorId=I_CARM), sess=DS), "mesma unidade")
erro(post("/estrategia/indicadores", aid_ind, ind(nome="Rede com dado de unidade", tipo="CALCULADO", numeradorId=I_CUL, denominadorId=I_INV)), "mesma unidade")
erro(post("/estrategia/indicadores", aid_ind, ind(nome="Resp. de fora", unitId=CAR, responsavelUserId=GES), sess=DS), "atua em outra unidade")
ok("calculado só com indicadores da rede ou da mesma unidade; responsável de outra unidade recusado")
aid_at = aid_of(page(f"/estrategia/indicadores/{I_CAR}"), "Desativar indicador"); okmsg(post(f"/estrategia/indicadores/{I_CAR}", aid_at, {"id": I_CAR, "ativo": "0"}), "desativado")
assert "Ocupação Carandá" not in page("/estrategia/indicadores") and "Ocupação Carandá" in page("/estrategia/indicadores?inativos=1"); ok("desativar tira da lista (medições preservadas)")
r = S.get(B + "/api/export/indicadores"); assert r.status_code == 200 and "TST-FAM" in r.text and "Satisfação nas reuniões de pais" in r.text and "Ocupação Carandá" in r.text
assert "Ocupação Carandá" not in G.get(B + "/api/export/indicadores").text; ok("exportação de indicadores respeita o escopo")

print("Plano de ação (5W2H)")
html = page("/estrategia/acoes"); aid_ac = aid_of(html, 'name="porque"')
AC = {"titulo": "", "porque": "", "responsavelUserId": "", "unitId": "", "inicio": "", "prazo": "", "local": "", "como": "", "custoPrevisto": "", "origem": "", "objectiveId": "", "indicatorId": "", "projectId": "", "voltar": "/estrategia/acoes"}
def acao(**kw): x = dict(AC); x.update(kw); return x
erro(post("/estrategia/acoes", aid_ac, acao(titulo="Ligar", prazo=d(5))), "responsável"); erro(post("/estrategia/acoes", aid_ac, acao(titulo="Ligar", responsavelUserId=DIR)), "prazo")
erro(post("/estrategia/acoes", aid_ac, acao(titulo="Ligar", responsavelUserId=DIR, prazo=d(5), inicio=d(6))), "início"); erro(post("/estrategia/acoes", aid_ac, acao(titulo="Ligar", responsavelUserId=DIR, prazo=d(5), custoPrevisto=-1)), "negativo")
ok("o quê, quem e quando obrigatórios; início ≤ prazo; custo não negativo")
okmsg(post("/estrategia/acoes", aid_ac, acao(titulo="Ligar para as famílias sem rematrícula", porque="Rematrícula abaixo da meta", responsavelUserId=DIR, unitId=CAR, prazo=d(-3), como="Lista do radar", custoPrevisto=0, indicatorId=I1, objectiveId=1)), "Ação criada")
A1 = psql("SELECT max(id) FROM action_plans"); assert psql(f"SELECT count(*) FROM notifications WHERE user_id={DIR} AND chave='acao:{A1}'") == "1"
html = page("/estrategia/acoes"); assert "Vencida há 3 dia(s)" in html; assert "1 vencida(s) · 0 bloqueada(s)" in page("/estrategia"); ok("ação vencida há 3 dias; responsável notificado")
aid_mv = aid_near(html, 'name="para"')
erro(post("/estrategia/acoes", aid_mv, {"id": A1, "para": "BLOQUEADA", "bloqueio": "", "voltar": "/estrategia/acoes"}, sess=DS), "o que falta")
okmsg(post("/estrategia/acoes", aid_mv, {"id": A1, "para": "BLOQUEADA", "bloqueio": "Aguardando lista do financeiro", "voltar": "/estrategia/acoes"}, sess=DS), "não como atraso")
assert psql(f"SELECT count(*) FROM notifications WHERE user_id={RH} AND chave LIKE 'acaobq:{A1}:%'") == "1"
html = page("/estrategia"); assert "0 vencida(s) · 1 bloqueada(s)" in html and "1 ação(ões) bloqueada(s) aguardando apoio" in html; ok("bloqueio exige motivo, avisa quem criou e sai da conta de atraso")
erro(post("/estrategia/acoes", aid_mv, {"id": A1, "para": "DESBLOQUEAR"}, sess=C), "Só o responsável")
okmsg(post("/estrategia/acoes", aid_mv, {"id": A1, "para": "DESBLOQUEAR"}, sess=DS), "retomada"); erro(post("/estrategia/acoes", aid_mv, {"id": A1, "para": "CONCLUIR", "evidencia": ""}, sess=DS), "evidência")
okmsg(post("/estrategia/acoes", aid_mv, {"id": A1, "para": "CONCLUIR", "evidencia": "12 famílias contatadas; 9 rematricularam", "custoReal": 0}, sess=DS), "não comprova")
erro(post("/estrategia/acoes", aid_mv, {"id": A1, "para": "CANCELAR", "justificativa": "x"}, sess=DS), "já está encerrada")
html = page(f"/estrategia/acoes/{A1}"); assert "12 famílias contatadas" in html and "Bloqueada (aguardando apoio)" in html and "Concluída" in html; ok("retomar → concluir com evidência; histórico com as transições; encerrada não muda")
page(f"/estrategia/acoes/{A1}", expect=404, sess=G); assert "Ligar para as famílias sem rematrícula" not in page("/estrategia/acoes?situacao=TODAS", sess=G)
erro(post("/estrategia/acoes", aid_ac, acao(titulo="Em outra unidade", responsavelUserId=GES, prazo=d(10), unitId=CAR), sess=G), "apenas na sua unidade")
okmsg(post("/estrategia/acoes", aid_ac, acao(titulo="Revisar escala do recreio", responsavelUserId=GES, prazo=d(10)), sess=G), "Ação criada"); A2 = psql("SELECT max(id) FROM action_plans"); assert psql(f"SELECT unit_id FROM action_plans WHERE id={A2}") == CUL
ok("IDOR: ação de Carandá invisível ao gestor da Cultura; gestor cria só na própria unidade (padrão = a dele)")
html = page(f"/estrategia/acoes/{A2}", sess=G); aid_ed = aid_of(html, 'name="porque"')
okmsg(post(f"/estrategia/acoes/{A2}", aid_ed, acao(id=A2, titulo="Revisar escala do recreio", responsavelUserId=GES, prazo=d(20), voltar=f"/estrategia/acoes/{A2}"), sess=G), "atualizada")
assert f"prazo {br(d(10))} → {br(d(20))}" in page(f"/estrategia/acoes/{A2}", sess=G); ok("mudança de prazo fica no histórico da ação")
okmsg(post("/estrategia/acoes", aid_ac, acao(titulo="Padronizar o kit de boas-vindas da rede", responsavelUserId=GES, prazo=d(15))), "Ação criada"); A4 = psql("SELECT max(id) FROM action_plans"); assert psql(f"SELECT unit_id IS NULL FROM action_plans WHERE id={A4}") == "t"
html = page(f"/estrategia/acoes/{A4}", sess=G); assert re.search(r'<option value=""[^>]*>Rede</option>', html)
okmsg(post(f"/estrategia/acoes/{A4}", aid_ed, acao(id=A4, titulo="Padronizar o kit de boas-vindas da rede", responsavelUserId=GES, prazo=d(16), unitId="", voltar=f"/estrategia/acoes/{A4}"), sess=G), "atualizada")
assert psql(f"SELECT unit_id IS NULL FROM action_plans WHERE id={A4}") == "t"; erro(post(f"/estrategia/acoes/{A4}", aid_ed, acao(id=A4, titulo="x", responsavelUserId=GES, prazo=d(16), unitId=CAR), sess=G), "apenas na sua unidade")
ok("gestor responsável por ação da rede edita sem tirá-la da rede; não a move para outra unidade")
I_CAR2 = nid(post("/estrategia/indicadores", aid_ind, ind(nome="Frequência das turmas Carandá", unitId=CAR, meta=95, alerta=90)), "estrategia/indicadores")
erro(post("/estrategia/acoes", aid_ac, acao(titulo="Vínculo indevido", responsavelUserId=GES, prazo=d(5), indicatorId=I_CAR2), sess=G), "outra unidade")
erro(post("/estrategia/acoes", aid_ac, acao(titulo="Responsável de outra unidade", responsavelUserId=GES, prazo=d(5), unitId=CAR)), "atua em outra unidade")
erro(post("/estrategia/acoes", aid_ac, acao(titulo="Responsável só leitura", responsavelUserId=LEI, prazo=d(5))), "pessoa ativa da equipe")
erro(post("/estrategia/acoes", aid_ac, acao(titulo="Rede ligada a indicador de unidade", responsavelUserId=RH, prazo=d(5), indicatorId=I_CAR2)), "outra unidade")
ok("ação: indicador/objetivo/projeto só da rede ou da mesma unidade; responsável ativo, da equipe e da unidade certa")
r = S.get(B + "/api/export/acoes"); assert "Ligar para as famílias sem rematrícula" in r.text and "Concluída" in r.text; assert "Ligar para as famílias" not in G.get(B + "/api/export/acoes").text; ok("exportação do plano respeita o escopo")

print("Rituais de gestão")
html = page("/estrategia/rituais"); aid_mod = aid_of(html, 'name="modelo"')
R1 = nid(post("/estrategia/rituais", aid_mod, {"modelo": "SEMANAL_COORDENACAO", "unitId": "", "proximaData": d(-10)}), "estrategia/rituais")
assert "Ritual “Reunião semanal de coordenação” atrasado" in page("/estrategia"); ok("ritual criado do modelo; 10 dias sem reunião → alerta de atraso")
erro(post("/estrategia/rituais", aid_mod, {"modelo": "MENSAL_COMITE", "unitId": "", "proximaData": H}, sess=C), "Direção/RH")
html = page(f"/estrategia/rituais/{R1}"); aid_rit = aid_of(html, 'name="pautaPadrao"')
RIT = {"id": R1, "nome": "Reunião semanal de coordenação", "finalidade": "Rotina pedagógica", "tipo": "SEMANAL", "duracaoMin": 60, "unitId": "", "proximaData": d(-10), "donoUserId": RH, "participantes": [RH, GES], "pautaPadrao": "Agenda da semana", "indicadores": [I1], "objetivos": [1], "ativo": "1"}
okmsg(post(f"/estrategia/rituais/{R1}", aid_rit, RIT), "Ritual salvo")
html = page(f"/estrategia/rituais/{R1}"); assert "Pauta automática" in html and "Satisfação nas reuniões de pais" in html and "Objetivo: Encher as salas de 2027" in html and "Agenda da semana" in html; ok("pauta automática: indicadores, objetivos e pauta padrão")
aid_reg = aid_of(html, 'name="enc_titulo_0"')
RG = {"ritualId": R1, "data": H, "status": "REALIZADA", "cancelMotivo": "", "presentes": [RH, GES], "pauta": "Pauta", "ata": "", "decisoes": "", "areaDecisao": "Direção e Governança"}
for k in range(6): RG.update({f"enc_titulo_{k}": "", f"enc_resp_{k}": "", f"enc_prazo_{k}": ""})
def reg(**kw): x = dict(RG); x.update(kw); return x
erro(post(f"/estrategia/rituais/{R1}", aid_reg, reg(data=d(1))), "data futura"); erro(post(f"/estrategia/rituais/{R1}", aid_reg, reg(status="CANCELADA", data=d(-3))), "motivo")
erro(post(f"/estrategia/rituais/{R1}", aid_reg, reg(enc_titulo_0="Enviar lista", enc_resp_0=GES)), "responsável e prazo")
assert psql(f"SELECT count(*) FROM ritual_meetings WHERE ritual_id={R1}") == "0"; ok("reunião futura, cancelamento sem motivo e encaminhamento sem prazo recusados — nada gravado pela metade")
loc = post(f"/estrategia/rituais/{R1}", aid_reg, reg(decisoes="Adotar a lista do radar nas ligações\nRevisar a pauta em novembro", enc_titulo_0="Enviar lista de famílias", enc_resp_0=GES, enc_prazo_0=d(7), ata="Discutimos a rematrícula"))
okmsg(loc, "2 decisão(ões) no Decision Log"); assert "1 encaminhamento(s)" in loc; M1 = nid(loc, "estrategia/reunioes")
assert psql(f"SELECT count(*) FROM decisions WHERE ritual_meeting_id={M1}") == "2" and psql(f"SELECT count(*) FROM action_plans WHERE ritual_meeting_id={M1} AND responsavel_user_id={GES}") == "1" and psql(f"SELECT proxima_data FROM rituals WHERE id={R1}") == d(7)
assert "Satisfação nas reuniões de pais" in psql(f"SELECT indicadores_snapshot::text FROM ritual_meetings WHERE id={M1}")
html = page(f"/estrategia/reunioes/{M1}"); assert "Adotar a lista do radar" in html and "Enviar lista de famílias" in html and "Indicadores na data da reunião" in html; ok("reunião: decisões no Decision Log, encaminhamento no plano, foto dos indicadores, próxima data pela cadência")
erro(post(f"/estrategia/rituais/{R1}", aid_reg, reg()), "Já existe um registro")
assert "Ritual “Reunião semanal de coordenação” atrasado" not in page("/estrategia"); ok("registro em dia tira o alerta; data repetida recusada")
M2 = nid(post(f"/estrategia/rituais/{R1}", aid_reg, reg(data=d(-1))), "estrategia/reunioes"); psql(f"UPDATE ritual_meetings SET data='{d(-5)}' WHERE id={M2}")
assert "1 reunião(ões) de ritual sem ata registrada" in page("/estrategia")
html = page(f"/estrategia/reunioes/{M2}"); aid_ata = aid_of(html, 'placeholder="O que foi discutido')
erro(post(f"/estrategia/reunioes/{M2}", aid_ata, {"id": M2, "ata": ""}), "Escreva a ata"); okmsg(post(f"/estrategia/reunioes/{M2}", aid_ata, {"id": M2, "ata": "Ata registrada depois"}), "Ata registrada")
assert "sem ata registrada" not in page("/estrategia"); ok("ata pendente vira alerta e some ao registrar")
html = page(f"/estrategia/reunioes/{M1}"); aid_dec = aid_of(html, 'name="revisarEm"')
okmsg(post(f"/estrategia/reunioes/{M1}", aid_dec, {"meetingId": M1, "titulo": "Contratar monitor do recreio", "decisao": "Contratar 1 monitor para o recreio", "contexto": "", "alternativas": "", "area": "Pessoas e RH", "revisarEm": d(20), "responsavelUserId": RH}), "Decision Log")
html = page(f"/estrategia/rituais/{R1}"); assert "Encaminhamentos em aberto" in html and "Enviar lista de famílias" in html and "Decisões com revisão prevista" in html and "Contratar monitor do recreio" in html; ok("próxima pauta traz encaminhamentos abertos e decisões a revisar")
erro(post(f"/estrategia/rituais/{R1}", aid_reg, reg(data=d(-2)), sess=C), "Só o dono, os participantes")
okmsg(post(f"/estrategia/rituais/{R1}", aid_reg, reg(data=d(-2), status="CANCELADA", cancelMotivo="Feriado"), sess=G), "Cancelamento registrado"); ok("participante registra (cancelamento com motivo); quem não participa não registra")
aid_mod_d = aid_of(page("/estrategia/rituais", sess=DS), 'name="modelo"')
R2 = nid(post("/estrategia/rituais", aid_mod_d, {"modelo": "DIARIA_UNIDADE", "unitId": "", "proximaData": H}, sess=DS), "estrategia/rituais"); assert psql(f"SELECT unit_id FROM rituals WHERE id={R2}") == CAR
erro(post("/estrategia/rituais", aid_mod_d, {"modelo": "DIARIA_UNIDADE", "unitId": CUL, "proximaData": H}, sess=DS), "apenas na sua unidade")
page(f"/estrategia/rituais/{R2}", expect=404, sess=G); page(f"/estrategia/reunioes/{M1}", sess=G); ok("IDOR: ritual de Carandá invisível ao gestor da Cultura; diretora cria só na unidade dela")
psql(f"UPDATE rituals SET indicadores = '[{I1}, {I_CAR2}]'::jsonb WHERE id={R1}")
assert "Frequência das turmas Carandá" in page(f"/estrategia/rituais/{R1}") and "Frequência das turmas Carandá" not in page(f"/estrategia/rituais/{R1}", sess=G)
erro(post(f"/estrategia/rituais/{R1}", aid_reg, reg(data=d(-3), presentes=[RH, LEI])), "só o dono e os participantes")
prox_antes = psql(f"SELECT proxima_data FROM rituals WHERE id={R1}"); M3 = nid(post(f"/estrategia/rituais/{R1}", aid_reg, reg(data=d(-3))), "estrategia/reunioes")
assert psql(f"SELECT proxima_data FROM rituals WHERE id={R1}") == prox_antes, "próxima data voltou no tempo"
assert "Frequência das turmas Carandá" in page(f"/estrategia/reunioes/{M3}") and "Frequência das turmas Carandá" not in page(f"/estrategia/reunioes/{M3}", sess=G)
ok("ritual da rede: pauta e foto dos indicadores mostram a cada um só o seu escopo; presentes fora da lista recusados; reunião antiga não volta a próxima data")
psql(f"UPDATE rituals SET indicadores = '[{I1}]'::jsonb WHERE id={R1}"); psql(f"DELETE FROM ritual_meetings WHERE id={M3}")
psql(f"UPDATE rituals SET created_at = now() - interval '100 days' WHERE id={R1}")
html = page("/estrategia/rituais"); i = html.find(">Reunião semanal de coordenação</a>"); assert i > 0 and "17%" in html[i:i + 2500] and "2/12" in html[i:i + 2500], html[i:i + 2500]; ok("aderência semanal: 2 realizadas de 12 esperadas em 90 dias = 17%")

print("Saúde estratégica e parâmetros")
html = page("/estrategia"); bloco = html[html.find("Saúde estratégica"):html.find("O que pede atenção")]
score = int(re.search(r'text-4xl font-semibold tabular-nums[^"]*">(\d+)<', bloco).group(1))
comps = re.findall(r'>(\d+)%</div><div class="text-\[11px\] text-slate-500">peso (\d+)', bloco)
assert comps, bloco[:500]; esperado = sum(int(v) * int(p) for v, p in comps) / sum(int(p) for _, p in comps)
assert abs(score - esperado) <= 1, (score, esperado, comps); ok(f"saúde estratégica {score} = média ponderada dos componentes com base ({len(comps)} de 5)")
html = page("/configuracoes"); aid_pe = aid_of(html, 'name="faixaBoa"')
pilares = ["Pedagógico", "Comercial e Marca", "Pessoas e Cultura", "Financeiro", "Operações e Infraestrutura", "Governança e Tecnologia"]; mapa = ["FAMILIAS", "FAMILIAS", "PESSOAS", "FINANCEIRA", "PROCESSOS", "PROCESSOS"]
PE = {"cicloAtual": "2027", "pilares": "\n".join(pilares), "atualizacaoProjetoDias": 14, "areasIndicador": "Pedagógico\nMatrículas e marketing\nAtendimento às famílias\nFinanceiro\nPessoas\nOperações\nGovernança", "peso_okrs": 25, "peso_indicadores": 25, "peso_projetos": 15, "peso_acoes": 20, "peso_rituais": 15, "faixaAtencao": 50, "faixaBoa": 75, "toleranciaRitualDias": 2, "ataPendenteDias": 2}
for i, (pl, ch) in enumerate(zip(pilares, mapa)): PE[f"mapaPilar_{i}"] = pl; PE[f"mapa_{i}"] = ch
erro(post("/configuracoes", aid_pe, {**PE, "peso_okrs": 0, "peso_indicadores": 0, "peso_projetos": 0, "peso_acoes": 0, "peso_rituais": 0}), "Ao menos um componente")
erro(post("/configuracoes", aid_pe, {**PE, "faixaAtencao": 80, "faixaBoa": 70}), "faixa boa"); erro(post("/configuracoes", aid_pe, PE, sess=DS), "Direção/RH")
okmsg(post("/configuracoes", aid_pe, {**PE, "peso_okrs": 0}), "Parâmetros da estratégia salvos")
html = page("/estrategia"); assert "peso 0 · fora do cálculo" in html; okmsg(post("/configuracoes", aid_pe, PE)); ok("pesos e faixas configuráveis e validados; componente com peso 0 sai do cálculo")

print("Marketing e captação (agregado, sem lead individual)")
html = page("/estrategia/marketing"); assert "nenhum lead individual" in html and "Criar indicadores de investimento" in html; aid_ci = aid_of(html, "Criar indicadores de investimento")
erro(post("/estrategia/marketing", aid_ci, {"responsavelUserId": COM}, sess=C), "Direção/RH")
okmsg(post("/estrategia/marketing", aid_ci, {"responsavelUserId": COM}), "5 indicador(es)"); okmsg(post("/estrategia/marketing", aid_ci, {"responsavelUserId": COM}), "já existiam"); ok("um indicador de investimento por canal, sem duplicar")
psql("INSERT INTO students (nome, origem, aluno_atual) VALUES ('Cand Site 1','SITE',false),('Cand Site 2','SITE',false),('Cand Site 3','SITE',false),('Cand Ind 1','INDICACAO',false),('Cand Ind 2','INDICACAO',false),('Cand Sem Origem',NULL,false)")
psql(f"INSERT INTO students (nome, origem, aluno_atual, unit_atual_id) VALUES ('Aluno Rematricula','REMATRICULA',true,{CAR}),('Aluno Importado',NULL,true,{CAR})")
psql("INSERT INTO enrollments (student_id, class_id, ano, status, confirmada_em) SELECT id, 1, 2027, 'CONFIRMADA', now() FROM students WHERE nome IN ('Cand Site 1','Aluno Rematricula')")
psql(f"INSERT INTO enrollments (student_id, class_id, ano, status, reserva_ate) SELECT id, 2, 2027, 'RESERVADA', '{d(10)}' FROM students WHERE nome='Cand Ind 1'")
inv = {c: psql(f"SELECT id FROM indicators WHERE funil='INVESTIMENTO' AND canal='{c}'") for c in ["INDICACAO", "SITE", "REDES", "VISITA", "OUTRO"]}
html = page("/estrategia/marketing", sess=C); aid_inv = aid_of(html, 'name="inv_')
D = {"periodo": PER, "obs": ""}; D.update({f"inv_{v}": "" for v in inv.values()})
erro(post("/estrategia/marketing", aid_inv, D, sess=C), "Preencha"); erro(post("/estrategia/marketing", aid_inv, {**D, f"inv_{inv['SITE']}": -5}, sess=C), "negativo")
erro(post("/estrategia/marketing", aid_inv, {**D, "periodo": PPROX, f"inv_{inv['SITE']}": 300}, sess=C), "mês futuro")
okmsg(post("/estrategia/marketing", aid_inv, {**D, f"inv_{inv['SITE']}": 300, f"inv_{inv['INDICACAO']}": 0}, sess=C), "2 investimento(s)")
assert psql(f"SELECT count(*) FROM indicator_values WHERE indicator_id={inv['REDES']}") == "0"; ok("comercial registra investimento do mês; vazio não vira zero; negativo e mês futuro recusados")
psql(f"UPDATE indicators SET responsavel_user_id={FIN} WHERE id={inv['REDES']}"); html = page("/estrategia/marketing", sess=F); aid_inv_f = aid_of(html, 'name="inv_')
erro(post("/estrategia/marketing", aid_inv_f, {**D, f"inv_{inv['REDES']}": 120, f"inv_{inv['SITE']}": 999}, sess=F), "Só o responsável")
assert psql(f"SELECT count(*) FROM indicator_values WHERE indicator_id={inv['REDES']}") == "0" and psql(f"SELECT valor::int FROM indicator_values WHERE indicator_id={inv['SITE']} AND periodo='{PER}'") == "300"
psql(f"UPDATE indicators SET responsavel_user_id={COM} WHERE id={inv['REDES']}"); ok("investimentos: tudo ou nada — um canal sem permissão impede gravar os outros")
html = page(f"/estrategia/marketing?mes={PER}")
tab = html[html.find("Por canal"):html.find("Últimos 6 meses")]
site = tab[tab.find(">Site<"):]; site = site[:site.find("</tr>")]; indi = tab[tab.find(">Indicação<"):]; indi = indi[:indi.find("</tr>")]
assert "R$ 300,00" in site and "R$ 100,00" in site and "33,3%" in site, site
assert "R$ 0,00" in indi and "sem base" in indi, indi
topo = html[:html.find("Por canal")]; assert "R$ 300,00" in topo and "R$ 50,00" in topo and "16,7%" in topo and "50%" in topo, topo[-3000:]
ok("Site: R$ 300 ÷ 3 candidatos = R$ 100 (CPL), ÷ 1 matrícula = R$ 300 (CAC); Indicação: CAC sem base; rede: CPL R$ 50, conversão 16,7%, reserva→matrícula 50%")
assert "Aluno Rematricula" not in html and "Cand Site 1" not in html; ok("rematrícula e alunos importados fora do funil; nenhum nome de candidato na tela")
assert "registrado só para a rede" in page("/estrategia/marketing", sess=DS); ok("visão da unidade não divide o gasto da rede pelos candidatos da unidade")
aid_up = aid_of(page("/estrategia/indicadores"), "Atualizar agora"); okmsg(post("/estrategia/indicadores", aid_up, {}), "leitura(s) do sistema")
assert psql(f"SELECT valor::int FROM indicator_values WHERE indicator_id={I_SIS} AND periodo='{PER}'") == "6"
html = page(f"/estrategia/indicadores/{I_CAL}"); assert "R$ 100,00" in html and "No alvo" in sub(html); ok("indicador do sistema lê 6 candidatos; calculado = 600 ÷ 6 = R$ 100 (no alvo ≤ 150)")

print("Rotina diária, Command Center, TV e relatório")
okmsg(post("/estrategia/acoes", aid_ac, acao(titulo="Enviar fluxo de caixa ao comitê", responsavelUserId=FIN, prazo=d(-1))), "Ação criada"); A3 = psql("SELECT max(id) FROM action_plans")
R3 = nid(post("/estrategia/rituais", aid_mod, {"modelo": "MENSAL_COMITE", "unitId": "", "proximaData": d(-5)}), "estrategia/rituais")
r = requests.get(B + f"/api/tarefas?token={TOKEN}"); j = r.json(); assert j["ok"] and "gestao" in j and j["gestao"]["falhas"] == [], j
QG = "SELECT count(*) FROM notifications WHERE chave ~ '^(ritualhoje|ritualatraso|ata|acaovenc|acaoprazo|acaobloq7|indmed|passo|jornada|jornadaatraso):'"
n1 = psql(QG); assert int(n1) >= 4; r = requests.get(B + f"/api/tarefas?token={TOKEN}"); assert r.json()["ok"]; assert psql(QG) == n1; ok(f"rotina diária: {n1} aviso(s) da gestão; rodar de novo não duplica")
assert psql(f"SELECT count(*) FROM notifications WHERE user_id={FIN} AND chave='acaovenc:{A3}:{d(-1)}'") == "1"
assert psql(f"SELECT count(*) FROM notifications WHERE user_id={RH} AND chave='ritualatraso:{R3}:{d(-5)}'") == "1"
assert psql(f"SELECT count(*) FROM notifications WHERE user_id={DIR} AND chave='ritualhoje:{R2}:{H}'") == "1"
assert int(psql(f"SELECT count(*) FROM notifications WHERE user_id={COM} AND titulo LIKE 'Medição pendente:%'")) >= 3
assert psql(f"SELECT count(*) FROM indicator_values WHERE indicator_id={I_SIS} AND periodo='{PER}' AND origem='SISTEMA'") == "1"; ok("avisos: ação vencida, ritual atrasado, ritual hoje, medição pendente; leituras do sistema gravadas")
html = page("/command-center"); assert "Estratégia 2027" in html and "saúde estratégica" in html and "Indicadores no alvo" in html; ok("Command Center com saúde estratégica e alertas")
html = page("/tv"); assert "Estratégia 2027" in html and "saúde estratégica" in html and "rituais de gestão em dia" in html and "Satisfação nas reuniões" not in html; ok("TV com bloco de estratégia agregado (sem nomes)")
html = page(f"/estrategia/relatorio?mes={PER}"); assert all(x in html for x in ["Relatório executivo", "Resumo para a Direção", "Contratar monitor do recreio", "Reuniões de gestão", "Captação", "Satisfação nas reuniões de pais", "Imprimir"]); ok("relatório executivo do mês (decisões, reuniões, captação, indicadores)")
html = page("/auditoria?entidade=action_plans"); assert "situação da ação do plano" in html; ok("trilha de auditoria do plano de ação")

print("Assistente estratégico (IA como apoio)")
html = page("/estrategia/assistente"); assert "IA desligada nesta instalação" in html and "Fatos que serão enviados" in html and "[E1]" in html and "Saúde estratégica:" in html
fatos = html[html.find("Fatos que serão enviados"):]; assert "Satisfação nas reuniões de pais" in fatos and "Diretora Carandá" not in fatos and "Gestor Cultura" not in fatos and "Financeiro Rede" not in fatos and "Cand Site 1" not in fatos
assert "Ação do plano nº" in fatos and "Enviar fluxo de caixa ao comitê" not in fatos and "Aguardando lista" not in fatos
ok("assistente mostra exatamente os fatos enviados: números e títulos institucionais, sem nomes de pessoas nem texto livre das ações")
aid_ia = aid_of(html, 'name="tarefa"'); erro(post("/estrategia/assistente", aid_ia, {"tarefa": "LEITURA"}), "AI_API_KEY não configurada")
erro(post("/estrategia/assistente", aid_ia, {"tarefa": "LEITURA"}, sess=G), "Direção/RH e dos diretores"); erro(post("/estrategia/assistente", aid_ia, {"tarefa": "INVENTADA"}), "Escolha o que")
assert psql("SELECT count(*) FROM strategy_ai_drafts") == "0" and psql("SELECT count(*) FROM ai_agents WHERE nome='Assistente estratégico' AND nivel='N1' AND status='PILOTO'") == "1"
assert "Assistente estratégico" in page("/governanca/agentes"); ok("sem AI_API_KEY nada é gerado nem simulado; gestor não usa; assistente registrado no inventário de agentes (N1, piloto)")
psql(f"INSERT INTO strategy_ai_drafts (tarefa, unit_id, modelo, texto, alertas, created_by, fontes) VALUES ('PRIORIDADES', NULL, 'teste', 'Prioridade 1: destravar a ação bloqueada [E1].', '[]'::jsonb, {RH}, '[]'::jsonb)"); dr = psql("SELECT max(id) FROM strategy_ai_drafts")
html = page("/estrategia/assistente"); aid_dc = aid_of(html, 'name="decisao"'); assert "Rascunho — revisar" in html
erro(post("/estrategia/assistente", aid_dc, {"id": dr, "decisao": "APROVAR", "texto": "x"}, sess=DS), "outro escopo")
okmsg(post("/estrategia/assistente", aid_dc, {"id": dr, "decisao": "APROVAR", "texto": "Prioridade 1 (revisada): destravar a ação bloqueada [E1]."}), "não altera nenhum dado")
erro(post("/estrategia/assistente", aid_dc, {"id": dr, "decisao": "DESCARTAR"}), "já decidido")
assert psql(f"SELECT status || '|' || texto FROM strategy_ai_drafts WHERE id={dr}") == "APROVADO|Prioridade 1 (revisada): destravar a ação bloqueada [E1]."; ok("rascunho: aprovação com texto revisado (uma vez), escopo respeitado")

print(f"\nALL GESTAO E2E CHECKS PASSED ({N[0]} grupos)")
