"""Cria os usuários fictícios de homologação (FASE 5) e alguns dados de exemplo em um ambiente de HOMOLOGAÇÃO.
Uso: python3 scripts/seed_homologacao.py https://SEU-ENDERECO-HOMOLOG rh@colegiostatus 'SENHA_ADMIN' [senha_dos_testes]
NUNCA rode em produção."""
import sys, re, requests
B, EMAIL, SENHA = sys.argv[1].rstrip("/"), sys.argv[2], sys.argv[3]; SENHA_TESTE = sys.argv[4] if len(sys.argv) > 4 else "Homolog2026!"
S = requests.Session(); S.headers.update({"Origin": B})
def action_ids(html): i = html.find("<main"); return re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', html[i:] if i >= 0 else html)
def post(path, aid, data):
    r = S.post(B + path, files=[(f"$ACTION_ID_{aid}", (None, ""))] + [(k, (None, str(v))) for k, v in data.items()], allow_redirects=False)
    m = re.search(r"rh_session=([^;]+)", r.headers.get("set-cookie", "")); m and S.headers.update({"Cookie": f"rh_session={m.group(1)}"}); return r.headers.get("location", "")
def find_form_aid(html, marker):
    i = html.find(marker); fs = html.rfind("<form", 0, i); fe_prev = html.rfind("</form>", 0, i)
    if fs <= fe_prev: fs = html.find("<form", i)
    return action_ids(html[fs:html.find("</form>", fs)])[0]
html = S.get(B + "/login").text; loc = post("/login", re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', html)[0], {"email": EMAIL, "senha": SENHA})
assert loc.endswith("/") or "2fa" in loc, f"login falhou: {loc}"
if "2fa" in loc: print("O admin tem 2FA ativo — rode com um usuário sem 2FA ou conclua o login no navegador e reutilize o cookie."); sys.exit(1)
html = S.get(B + "/colaboradores/novo").text; aid = action_ids(html)[0]
units = dict(re.findall(r'<option value="(\d+)">([^<]+)</option>', html.split('name="unitId"')[1].split("</select>")[0])); units = {v: k for k, v in units.items()}
prof = re.search(r'<option value="(\d+)">Professor', html).group(1)
car = units.get("Carandá") or list(units.values())[0]; cul = units.get("Cultura") or car
def novo(nome, unit, **kw):
    d = {"nome": nome, "admissao": "2025-02-03", "unitId": unit, "vinculo": "CLT", "abrirAdmissao": "", "positionId": prof, "jornadaMinDia": 528}; d.update(kw)
    return re.search(r"/colaboradores/(\d+)\?", post("/colaboradores/novo", aid, d)).group(1)
a = novo("Colaborador Teste Carandá", car); b = novo("Colaborador Teste Cultura", cul)
html = S.get(B + "/configuracoes").text; aid = find_form_aid(html, "Criar acesso")
perfis = [("direcao.teste", "DIRECAO", "", ""), ("rh.teste", "RH", "", ""), ("diretor.caranda", "DIRETOR_UNIDADE", car, ""), ("gestor.caranda", "GESTOR", car, ""), ("comercial.teste", "COMERCIAL", "", ""), ("financeiro.teste", "FINANCEIRO", "", ""), ("operacoes.teste", "OPERACOES", "", ""), ("colaborador.caranda", "COLABORADOR", car, a), ("colaborador.cultura", "COLABORADOR", cul, b), ("leitura.teste", "LEITURA", "", "")]
for email, role, unit, emp in perfis: post("/configuracoes", aid, {"nome": email.replace(".", " ").title(), "email": email, "role": role, "unitId": unit, "employeeId": emp, "senha": SENHA_TESTE})
print("Usuários de homologação criados (senha:", SENHA_TESTE + "):"); [print(f"  {e:24s} {r}") for e, r, *_ in perfis]
print("Colaboradores fictícios:", a, b)
print("\nEntregue cada login à pessoa da área correspondente e siga o roteiro da FASE 18. Os perfis Direção, RH e Financeiro serão obrigados a ativar o 2FA no primeiro acesso.")
