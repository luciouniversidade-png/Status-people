"""Dados de DEMONSTRAÇÃO da v29 (acesso pelo cargo) — NUNCA rode em produção. Tudo fictício, com "(fictício)/(fictícia)" no nome.
Roda com o servidor no ar, numa base de homologação que tenha os cargos do organograma (Gerente Financeiro, Tesoureiro, Analista de
Atendimento) — como a base do treinamento. O que faz, pela própria interface (como o RH faria):
  1. cria o cargo "Auxiliar Financeiro" (reporta ao Gerente Financeiro) já com a atuação Financeiro;
  2. configura o acesso dos cargos: o auxiliar vê 23 telas, não aprova nada e concede descontos até 5%; o gerente vê todas as telas,
     aprova títulos/orçamento, contas a pagar, baixa manual, férias e banco de horas (da equipe) e concede até 40%;
  3. cria quatro fichas fictícias (gerente, auxiliar — com a gerente como gestora direta —, tesoureiro e uma analista de atendimento
     que trabalha na cobrança) e o login de cada uma pela ficha ("Novo acesso": escolher a pessoa — o acesso vem do cargo);
  4. registra uma substituição temporária (o tesoureiro cobre a gerente nas férias) e uma exceção individual (a analista, com motivo);
  5. o reembolso de despesa passa a ter a etapa "cargo Gerente Financeiro"; um comunicado vai só para o cargo Tesoureiro;
  6. o auxiliar pede um desconto de 8% (acima da alçada dele) e um período de férias (que só a gestora direta aprova).
Uso: python3 scripts/demo_v29.py   (servidor local em http://localhost:3100, banco local via psql). Variável RH_SENHA para a senha do RH."""
import os, re, subprocess, requests
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
B = os.environ.get("APP", "http://localhost:3100")
def psql(q): return subprocess.run(["su", "postgres", "-c", "/usr/lib/postgresql/16/bin/psql -h /tmp/pg -U status -d status_people -q -t -A -F '|' -v ON_ERROR_STOP=1"], input=q + ";", capture_output=True, text=True).stdout.strip()
def mk(): s = requests.Session(); s.headers.update({"Origin": B}); return s
def action_ids(html): i = html.find("<main"); return re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', html[i:] if i >= 0 else html)
def post(path, aid, data, sess):
    f = [(f"$ACTION_ID_{aid}", (None, ""))]
    for k, v in data.items():
        for x in (v if isinstance(v, list) else [v]): f.append((k, (None, str(x))))
    r = sess.post(B + path, files=f, allow_redirects=False); m = re.search(r"rh_session=([^;]+)", r.headers.get("set-cookie", ""))
    if m: sess.headers["Cookie"] = f"rh_session={m.group(1)}"
    loc = requests.utils.unquote(r.headers.get("location", "")).replace("\xa0", " "); print("   ", path, "→", loc[:150]); return loc
def aid_of(html, marker):
    i = html.find(marker); assert i >= 0, marker
    fs = html.rfind("<form", 0, i); fe_prev = html.rfind("</form>", 0, i)
    if fs > fe_prev: fe = html.find("</form>", i)
    else: fs = html.find("<form", i); fe = html.find("</form>", fs)
    return action_ids(html[fs:fe])[0]
def page(path, sess): return sess.get(B + path).text.replace("\xa0", " ")
def login(email, senha):
    s = mk(); html = s.get(B + "/login").text; aid = re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', html)[0]; post("/login", aid, {"email": email, "senha": senha}, s); return s
def ok(loc, trecho=""): assert "ok=" in loc and trecho in loc, loc; return loc
def q(v): return "NULL" if v is None else str(v) if isinstance(v, (int, float)) else "'" + str(v).replace("'", "''") + "'"
HOJE = datetime.now(ZoneInfo("America/Campo_Grande")).date(); d = lambda n: (HOJE + timedelta(days=n)).isoformat()
SENHA = "senha12345"

RH = login("rh@colegiostatus", os.environ.get("RH_SENHA", "Status2026!"))
cargo = lambda nome: psql(f"SELECT id FROM positions WHERE nome={q(nome)} ORDER BY id LIMIT 1")
GER, TES, ANA = cargo("Gerente Financeiro"), cargo("Tesoureiro"), cargo("Analista de Atendimento")
if not (GER and TES and ANA): raise SystemExit("A base precisa dos cargos Gerente Financeiro, Tesoureiro e Analista de Atendimento (organograma da homologação).")
U = {c: psql(f"SELECT id FROM units WHERE codigo='{c}'") for c in ["CAR", "TVM1"]}

print("1) cargo novo com a atuação")
AUX = cargo("Auxiliar Financeiro")
if not AUX:
    h = page("/configuracoes", RH); ok(post("/configuracoes", aid_of(h, "Atuação no sistema"), {"nome": "Auxiliar Financeiro", "area": "Administrativa", "parentId": GER, "ordem": "60", "atuacao": "FINANCEIRO", "formacaoExigida": "", "documentoFormacao": ""}, RH))
    AUX = cargo("Auxiliar Financeiro")

print("2) acesso dos cargos")
TELAS_AUX = ["/alertas", "/reconhecimento", "/financeiro", "/financeiro/inadimplencia", "/financeiro/recebimentos", "/financeiro/conciliacao", "/financeiro/divergencias", "/financeiro/despesas", "/financeiro/contas-a-pagar",
             "/financeiro/descontos", "/financeiro/obrigacoes", "/estrategia/acoes", "/comunicacao/comunicados", "/comunicacao/mensagens", "/comunicacao/modelos", "/matriculas/alunos", "/governanca/pops", "/solicitacoes"]
h = page(f"/configuracoes/acessos/cargo/{AUX}", RH)
ok(post(f"/configuracoes/acessos/cargo/{AUX}", aid_of(h, "Salvar o acesso do cargo"), {"id": AUX, "atuacao": "FINANCEIRO", "telas": TELAS_AUX, "descontoPct": "5"}, RH))
h = page(f"/configuracoes/acessos/cargo/{GER}", RH); todas = [re.search(r'value="([^"]+)"', x).group(1) for x in re.findall(r'<input[^>]*name="telas"[^>]*>', h)]
ok(post(f"/configuracoes/acessos/cargo/{GER}", aid_of(h, "Salvar o acesso do cargo"), {"id": GER, "atuacao": "FINANCEIRO", "telas": todas, "aprova": ["financeiro", "contasPagar", "baixaManual", "ferias", "banco"], "descontoPct": "40"}, RH))

print("3) fichas fictícias e logins pela ficha")
def ficha(nome, pos, unit, gestor, email, admissao):
    eid = psql(f"SELECT id FROM employees WHERE nome={q(nome)}")
    if not eid: eid = psql(f"INSERT INTO employees (nome, unit_id, position_id, vinculo, admissao, gestor_id, email, situacao, jornada_min_dia) VALUES ({q(nome)}, {unit}, {pos}, 'CLT', {q(admissao)}, {q(gestor)}, {q(email)}, 'ATIVO', 480) RETURNING id")
    return eid
EJ = ficha("Juliana Prado Moraes (fictícia)", GER, U["CAR"], None, "juliana.moraes@exemplo.com", "2017-09-09")
ED = ficha("Diego Santana Lima (fictício)", AUX, U["TVM1"], EJ, "diego.lima@exemplo.com", "2018-03-01")
ET = ficha("Rafael Teixeira Campos (fictício)", TES, U["TVM1"], EJ, "rafael.campos@exemplo.com", "2019-05-06")
EA = ficha("Bianca Rocha Prado (fictícia)", ANA, U["CAR"], EJ, "bianca.prado@exemplo.com", "2022-02-14")
def novo_acesso(emp, nome, email):
    uid = psql(f"SELECT id FROM users WHERE employee_id={emp}")
    if uid: return uid
    h = page("/configuracoes", RH)
    ok(post("/configuracoes", aid_of(h, "Criar acesso"), {"modo": "auto", "employeeId": emp, "nome": nome, "email": email, "atuacao": "LEITURA", "unitId": "", "senha": SENHA}, RH), "Acesso salvo")
    return psql(f"SELECT id FROM users WHERE employee_id={emp}")
UJ = novo_acesso(EJ, "Juliana Prado Moraes (fictícia)", "juliana.moraes@exemplo.com"); UD = novo_acesso(ED, "Diego Santana Lima (fictício)", "diego.lima@exemplo.com")
UT = novo_acesso(ET, "Rafael Teixeira Campos (fictício)", "rafael.campos@exemplo.com"); UA = novo_acesso(EA, "Bianca Rocha Prado (fictícia)", "bianca.prado@exemplo.com")

print("4) substituição temporária e exceção individual")
h = page(f"/configuracoes/acessos/usuario/{UT}", RH)
if "Registrar substituição" in h:
    ok(post(f"/configuracoes/acessos/usuario/{UT}", aid_of(h, "Registrar substituição"), {"id": UT, "positionId": GER, "ate": d(21), "motivo": "Cobre a Gerente Financeira nas férias dela"}, RH))
h = page(f"/configuracoes/acessos/usuario/{UA}?atuacao=FINANCEIRO", RH)
if "Registrar exceção" in h:
    ok(post(f"/configuracoes/acessos/usuario/{UA}", aid_of(h, "Registrar exceção"), {"id": UA, "atuacao": "FINANCEIRO", "descontoPct": "5", "motivo": "Atua na cobrança da Carandá, na equipe do financeiro, embora o cargo seja de atendimento.",
        "telas": ["/alertas", "/reconhecimento", "/financeiro", "/financeiro/inadimplencia", "/financeiro/recebimentos", "/financeiro/descontos", "/comunicacao/comunicados", "/comunicacao/mensagens", "/comunicacao/modelos", "/matriculas/alunos", "/governanca/pops", "/solicitacoes"]}, RH))

print("5) etapa de solicitação e comunicado pelo cargo")
tipo = psql("SELECT id FROM request_types WHERE codigo='REEMBOLSO'")
if tipo and "cargos" not in psql(f"SELECT etapas::text FROM request_types WHERE id={tipo}"):
    import html as _h
    h = RH.get(B + "/solicitacoes/tipos").text; aid = aid_of(h, 'name="codigo"'); i = h.find(f'name="id" value="{tipo}"'); bl = h[i:h.find("</form>", i)]
    val = lambda n: _h.unescape(re.search(r'name="%s"[^>]*value="([^"]*)"' % n, bl).group(1)) if re.search(r'name="%s"[^>]*value="' % n, bl) else ""
    campos = _h.unescape(re.search(r'<textarea[^>]*name="campos"[^>]*>(.*?)</textarea>', bl, flags=re.S).group(1))
    ok(post("/solicitacoes/tipos", aid, {"id": tipo, "nome": val("nome"), "prazoDias": val("prazoDias") or "2", "ativo": "1", "descricao": val("descricao"), "campos": campos,
        "etapas": "Diretor(a) da unidade | Direção da unidade\nGerente financeiro | cargo Gerente Financeiro\nDireção (acima de R$ 1.000) | Direção | acima de 1000"}, RH))
if psql("SELECT count(*) FROM announcements WHERE titulo='Fechamento do caixa do mês (demonstração)'") == "0":
    h = page("/comunicacao/comunicados", RH)
    ok(post("/comunicacao/comunicados", aid_of(h, 'name="positionId"'), {"titulo": "Fechamento do caixa do mês (demonstração)", "texto": "Conferência do caixa e dos recebimentos do mês até o dia 5. Dúvidas com a Gerente Financeira.", "publico": "CARGO", "positionId": TES, "unitId": "", "role": "", "requerCiencia": "1", "prazoCiencia": d(7), "expiraEm": d(30)}, RH))

print("6) o auxiliar pede um desconto acima da alçada dele e um período de férias")
DI = login("diego.lima@exemplo.com", SENHA)
if psql("SELECT count(*) FROM discounts WHERE motivo LIKE '%(demonstração v29)%'") == "0":
    h = page("/financeiro/descontos", DI); aluno = psql("SELECT min(id) FROM students")
    tp = re.search(r'name="tipo"[^>]*>\s*<option[^>]*>([^<]+)</option>', h).group(1)
    ok(post("/financeiro/descontos", aid_of(h, 'name="percentual"'), {"studentId": aluno, "alunoNome": "" if aluno else "Aluno fictício", "unitId": "" if aluno else U["CAR"], "tipo": tp, "percentual": "8", "ano": str(HOJE.year + 1), "validadeAte": f"{HOJE.year + 1}-12-31", "motivo": "Irmãos matriculados na rede (demonstração v29)"}, DI))
if psql(f"SELECT count(*) FROM leave_requests WHERE employee_id={ED}") == "0":
    h = page(f"/colaboradores/{ED}", DI)
    if "Nova solicitação" in h:
        post(f"/colaboradores/{ED}", aid_of(h, "Nova solicitação"), {"employeeId": ED, "voltar": f"/colaboradores/{ED}", "tipo": "FERIAS", "inicio": d(60), "fim": d(74)}, DI)

print("\nPronto. Logins de demonstração (senha senha12345): juliana.moraes@exemplo.com (gerente), diego.lima@exemplo.com (auxiliar),"
      " rafael.campos@exemplo.com (tesoureiro em substituição), bianca.prado@exemplo.com (exceção). Veja Configurações → Acesso por cargo.")
