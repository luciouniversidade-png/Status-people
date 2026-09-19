"""Teste de carga leve (FASE 17): N usuários simultâneos navegando pelas telas mais usadas durante T segundos.
Uso: python3 scripts/carga.py http://localhost:3100 rh@colegiostatus 'senha' 30 45   (30 usuários, 45 segundos)"""
import sys, re, time, threading, statistics, requests
B, EMAIL, SENHA = sys.argv[1], sys.argv[2], sys.argv[3]; N = int(sys.argv[4]) if len(sys.argv) > 4 else 30; T = int(sys.argv[5]) if len(sys.argv) > 5 else 60
ROTAS = ["/", "/colaboradores", "/matriculas", "/matriculas/alunos", "/atendimento", "/atendimento/casos", "/governanca/pops", "/ponto", "/financeiro", "/operacoes/chamados", "/command-center", "/analytics", "/academy/matriz"]
def login():
    s = requests.Session(); s.headers.update({"Origin": B}); html = s.get(B + "/login").text; aid = re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', html)[0]
    r = s.post(B + "/login", files=[(f"$ACTION_ID_{aid}", (None, "")), ("email", (None, EMAIL)), ("senha", (None, SENHA))], allow_redirects=False)
    m = re.search(r"rh_session=([^;]+)", r.headers.get("set-cookie", "")); assert m, "login falhou"; s.headers["Cookie"] = f"rh_session={m.group(1)}"; return s
tempos, erros, lock = [], [], threading.Lock(); fim = time.time() + T
def usuario(i):
    s = login(); k = i
    while time.time() < fim:
        rota = ROTAS[k % len(ROTAS)]; k += 1; t0 = time.time()
        try: r = s.get(B + rota, allow_redirects=False, timeout=30); ok = r.status_code in (200, 303, 307)
        except Exception as e: ok = False; r = None
        dt = (time.time() - t0) * 1000
        with lock: tempos.append((rota, dt)); (not ok) and erros.append((rota, r.status_code if r is not None else "exc"))
ts = [threading.Thread(target=usuario, args=(i,)) for i in range(N)]; t_ini = time.time(); [t.start() for t in ts]; [t.join() for t in ts]
dur = time.time() - t_ini; vals = sorted(d for _, d in tempos)
pct = lambda p: vals[min(len(vals) - 1, int(len(vals) * p))] if vals else 0
print(f"\n{N} usuários simultâneos · {T}s · {len(tempos)} requisições · {len(tempos)/dur:.1f} req/s · erros: {len(erros)}")
print(f"latência: p50 {pct(0.5):.0f} ms · p95 {pct(0.95):.0f} ms · p99 {pct(0.99):.0f} ms · máx {max(vals):.0f} ms")
por = {}
for rota, d in tempos: por.setdefault(rota, []).append(d)
for rota, ds in sorted(por.items(), key=lambda x: -statistics.median(x[1])): print(f"  {rota:28s} n={len(ds):4d}  p50 {statistics.median(ds):6.0f} ms  p95 {sorted(ds)[int(len(ds)*0.95)-1 if len(ds)>1 else 0]:6.0f} ms")
if erros: print("erros:", erros[:10])
print("\nCritério do roteiro: p95 < 2000 ms e 0 erros →", "OK" if pct(0.95) < 2000 and not erros else "REVISAR")
