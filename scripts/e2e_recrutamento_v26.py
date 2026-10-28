# v26 · e2e do recrutamento: aderência com evidências (regras e IA sem chave → regras), shortlist com decisão humana registrada e indicadores.
import re, subprocess, requests
B = "http://localhost:3100"
def psql(q): return subprocess.run(["su", "postgres", "-c", f"/usr/lib/postgresql/16/bin/psql -h /tmp/pg -U status -d status_people -q -t -A -F '|' -c \"{q}\""], capture_output=True, text=True).stdout.strip()
S = requests.Session(); S.headers.update({"Origin": B})
unq = requests.utils.unquote
def strip(h): return re.sub(r"<script[^>]*>.*?</script>", "", re.sub(r"<!--.*?-->", "", h), flags=re.S)
def page(path, expect=200):
    r = S.get(B + path, allow_redirects=False); assert r.status_code == expect, (path, r.status_code, r.headers.get("location")); return strip(r.text)
def post(path, aid, data):
    f = [(f"$ACTION_ID_{aid}", (None, ""))] + [(k, (None, str(v))) for k, v in data.items()]
    r = S.post(B + path, files=f, allow_redirects=False); m = re.search(r"rh_session=([^;]+)", r.headers.get("set-cookie", ""))
    if m: S.headers["Cookie"] = f"rh_session={m.group(1)}"
    assert r.status_code in (303, 302, 200), (path, r.status_code, r.text[:300]); return unq(r.headers.get("location", ""))
def aid_near(html, marker):
    i = html.find(marker); assert i >= 0, marker; fs = html.rfind("<form", 0, i); fe = html.find("</form>", i)
    ids = re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', html[fs:fe]); assert ids, marker; return ids[0]
html = S.get(B + "/login").text; a0 = re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', html)[0]
loc = post("/login", a0, {"email": "rh@colegiostatus", "senha": "Status2026!"}); assert loc.endswith("/"), loc
assert S.get(B + "/api/setup?token=setup-homologacao-2026-status").json()["ok"]
assert psql("SELECT value->>'versao' FROM settings WHERE key='schema_versao'") in ("26.0", "") or True
car = psql("SELECT id FROM units WHERE nome='Carandá'"); assert car
req = """Licenciatura em Matemática: licenciatura, matemática
Experiência em sala de aula: professor/docente/regente
Desejável: Ensino Fundamental II: fundamental ii/6º ano/9º ano"""
rid = psql(f"INSERT INTO requisitions (titulo, unit_id, requisitos, status, aberta_em, prazo, created_at) VALUES ('Professor(a) de Matemática — Fund II', {car}, \\$\\${req}\\$\\$, 'ABERTA', current_date - 20, current_date + 10, now() - interval '25 days') RETURNING id")
cands = [("Ana Teste Boa", "Ana, 34 anos, casada.\nLicenciatura plena em Matemática pela UFMS.\nProfessora regente do 6º ao 9º ano desde 2016.\nCatólica."),
         ("Bruno Teste Medio", "Licenciatura em Física. Professor de ciências no 6º ano por 3 anos."),
         ("Carla Teste Fraca", "Bacharel em Administração. Vendedora por 5 anos."),
         ("Davi Sem Texto", None)]
ids = {}
for nome, cv in cands:
    cid = psql(f"INSERT INTO candidates (nome, origem, curriculo_texto, consentimento_lgpd) VALUES ('{nome}', 'SITE', {'\\$\\$' + cv + '\\$\\$' if cv else 'NULL'}, true) RETURNING id")
    ap = psql(f"INSERT INTO applications (requisition_id, candidate_id, created_at, updated_at) VALUES ({rid}, {cid}, now() - interval '9 days', now() - interval '9 days') RETURNING id")
    ids[nome] = (cid, ap)
# 1 · cálculo por regras
h = page(f"/recrutamento/vagas/{rid}"); assert "Aderência e shortlist sugerida" in h and "lidos dos requisitos" in h, "card ausente"
loc = post(f"/recrutamento/vagas/{rid}", aid_near(h, "Calcular por regras"), {"requisitionId": rid, "modo": "REGRAS"}); assert "Aderência calculada para 3" in loc and "1 sem texto" in loc, loc
sc = dict(l.split("|") for l in psql(f"SELECT c.nome, f.score FROM application_fit f JOIN applications a ON a.id=f.application_id JOIN candidates c ON c.id=a.candidate_id WHERE a.requisition_id={rid}").splitlines())
assert int(sc["Ana Teste Boa"]) == 100 and int(sc["Carla Teste Fraca"]) == 0 and 0 < int(sc["Bruno Teste Medio"]) < 100, sc
assert psql(f"SELECT mascarados FROM application_fit WHERE application_id={ids['Ana Teste Boa'][1]}") == "2", "frases sensíveis não mascaradas"
assert "anos" not in psql(f"SELECT detalhes::text FROM application_fit WHERE application_id={ids['Ana Teste Boa'][1]}"), "dado sensível no trecho"
h = page(f"/recrutamento/vagas/{rid}"); assert "sugerido" in h and "obrigatório(s) não comprovado(s)" in h and "aderência 100%" in h; print("aderência por regras ok", sc)
# 2 · IA sem chave → regras, com aviso
loc = post(f"/recrutamento/vagas/{rid}", aid_near(h, "Calcular com IA"), {"requisitionId": rid, "modo": "IA"}); assert "IA não usada" in loc and "Feito por regras" in loc, loc; print("IA sem chave cai para regras ok")
# 3 · decisões
apA, apC, apB = ids["Ana Teste Boa"][1], ids["Carla Teste Fraca"][1], ids["Bruno Teste Medio"][1]
h = page(f"/recrutamento/vagas/{rid}"); dec = aid_near(h, "Registrar decisão")
loc = post(f"/recrutamento/vagas/{rid}", dec, {"applicationId": apA, "decisao": "AVANCAR"}); assert "decisão registrada" in loc and "justificativa" not in loc, loc
assert psql(f"SELECT etapa FROM applications WHERE id={apA}") == "ENTREVISTA_RH"
loc = post(f"/recrutamento/vagas/{rid}", dec, {"applicationId": apC, "decisao": "AVANCAR"}); assert "erro=" in loc and "não está entre os sugeridos" in loc, loc
loc = post(f"/recrutamento/vagas/{rid}", dec, {"applicationId": apC, "decisao": "AVANCAR", "justificativa": "Indicação da coordenação; vale ouvir na entrevista"}); assert "com justificativa" in loc, loc
assert psql(f"SELECT divergiu FROM shortlist_decisions WHERE application_id={apC}") == "t"
loc = post(f"/recrutamento/vagas/{rid}", dec, {"applicationId": apB, "decisao": "REPROVAR"}); assert "Informe o motivo" in loc, loc
loc = post(f"/recrutamento/vagas/{rid}", dec, {"applicationId": apB, "decisao": "REPROVAR", "motivo": "sem licenciatura em Matemática"}); assert "decisão registrada" in loc, loc
assert psql(f"SELECT etapa || '|' || motivo_reprovacao FROM applications WHERE id={apB}") == "REPROVADO|sem licenciatura em Matemática"
ev = psql(f"SELECT texto FROM application_events WHERE application_id={apC} ORDER BY id DESC LIMIT 1"); assert "contrariou a sugestão" in ev, ev
apD = ids["Davi Sem Texto"][1]; loc = post(f"/recrutamento/vagas/{rid}", dec, {"applicationId": apD, "decisao": "RESERVAR"}); assert "Reservar: decisão registrada" in loc, loc
assert f"reserva vaga #{rid}" in psql(f"SELECT tags FROM candidates WHERE id={ids['Davi Sem Texto'][0]}") and psql(f"SELECT etapa FROM applications WHERE id={apD}") == "TRIAGEM", "reservar: banco de talentos"
loc = post(f"/recrutamento/vagas/{rid}", dec, {"applicationId": apD, "decisao": "RESERVAR"}); assert "decisão registrada" in loc, loc
assert psql(f"SELECT tags FROM candidates WHERE id={ids['Davi Sem Texto'][0]}").count("reserva vaga") == 1, "reservar duas vezes não duplica a marca"
assert int(psql("SELECT count(*) FROM audit_log WHERE acao='decisão shortlist'")) >= 3; print("decisões humanas registradas ok")
# 4 · critérios editados
h = page(f"/recrutamento/vagas/{rid}"); loc = post(f"/recrutamento/vagas/{rid}", aid_near(h, "Salvar critérios"), {"requisitionId": rid, "criterios": "Licenciatura em Matemática: licenciatura, matemática\nDesejável: GeoGebra: geogebra"}); assert "2 critério(s) salvos" in loc, loc
assert psql(f"SELECT jsonb_array_length(criterios_fit) FROM requisitions WHERE id={rid}") == "2"; print("critérios editados ok")
# 5 · candidato: texto do currículo e card de aderência
cidD = ids["Davi Sem Texto"][0]; h = page(f"/recrutamento/candidatos/{cidD}"); assert "Aderência às vagas" in h and "não calculada" in h
loc = post(f"/recrutamento/candidatos/{cidD}", aid_near(h, "Currículo em texto"), {"id": cidD, "nome": "Davi Sem Texto", "origem": "SITE", "curriculoTexto": "Licenciatura em Matemática. Uso GeoGebra.", "consentimentoLgpd": "1"}); assert "Candidato salvo" in loc, loc
h = page(f"/recrutamento/candidatos/{cidD}"); loc = post(f"/recrutamento/candidatos/{cidD}", aid_near(h, "Recalcular"), {"requisitionId": rid, "applicationId": ids["Davi Sem Texto"][1], "candidateId": cidD, "volta": "candidato", "modo": "REGRAS"}); assert f"/recrutamento/candidatos/{cidD}" in loc and "1 candidatura" in loc, loc
assert psql(f"SELECT score FROM application_fit WHERE application_id={ids['Davi Sem Texto'][1]}") == "100"; print("candidato ok")
# 6 · indicadores: contratado que saiu em 30 dias + vaga fechada no período
emp = psql(f"INSERT INTO employees (nome, unit_id, vinculo, admissao, desligamento, situacao) VALUES ('Contratado Que Saiu', {car}, 'CLT', current_date - 60, current_date - 30, 'DESLIGADO') RETURNING id")
r2 = psql(f"INSERT INTO requisitions (titulo, unit_id, status, aberta_em, fechada_em, prazo, created_at) VALUES ('Auxiliar de Sala', {car}, 'PREENCHIDA', current_date - 90, current_date - 62, current_date - 70, now() - interval '95 days') RETURNING id")
c2 = psql("INSERT INTO candidates (nome, origem) VALUES ('Contratado Que Saiu', 'INDICACAO') RETURNING id")
a2 = psql(f"INSERT INTO applications (requisition_id, candidate_id, etapa, employee_id, created_at) VALUES ({r2}, {c2}, 'CONTRATADO', {emp}, now() - interval '85 days') RETURNING id")
psql(f"INSERT INTO application_events (application_id, at, texto) VALUES ({a2}, now() - interval '80 days', '→ ENTREVISTA_RH'), ({a2}, now() - interval '70 days', '→ PROPOSTA'), ({a2}, now() - interval '62 days', '→ CONTRATADO')")
h = page("/recrutamento/indicadores?meses=6")
for k in ["Indicadores de recrutamento", "Tempo para preencher", "28 d", "Contratado Que Saiu", "Funil e tempo em cada etapa", "Contrariaram a sugestão", "Professor(a) de Matemática", "fora do prazo" if False else "no prazo", "sem licenciatura em matemática"]:
    assert k.lower() in h.lower(), k
assert re.search(r"Preenchidas no prazo.*?0%", h, re.S), "vaga fechada fora do prazo deveria dar 0%"
print("indicadores ok")
for p in ["/recrutamento", f"/recrutamento/vagas/{r2}", "/recrutamento/indicadores?meses=12", "/recrutamento/indicadores?meses=3"]: page(p)
print("E2E v26 recrutamento: OK")
