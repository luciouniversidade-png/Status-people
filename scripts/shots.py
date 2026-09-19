import sys, os, re, requests
import gi
gi.require_version("Gtk", "3.0"); gi.require_version("WebKit2", "4.1")
import cairo  # noqa: F401  (registra o conversor cairo.Surface)
from gi.repository import Gtk, WebKit2, GLib

B = "http://localhost:3100"
WIDTH = int(os.environ.get("SHOT_W", "1280")); HEIGHT = int(os.environ.get("SHOT_H", "1600"))

# login por HTTP para obter o cookie, depois injeta no WebKit
S = requests.Session(); S.headers.update({"Origin": B})
html = S.get(B + "/login").text
aid = re.findall(r'name="\$ACTION_ID_([0-9a-f]+)"', html)[0]
r = S.post(B + "/login", files={f"$ACTION_ID_{aid}": (None, ""), "email": (None, sys.argv[1]), "senha": (None, sys.argv[2])}, allow_redirects=False)
tok = re.search(r"rh_session=([^;]+)", r.headers.get("set-cookie", "")).group(1)

paths = sys.argv[3:]
ctx = WebKit2.WebContext.get_default()
cm = ctx.get_cookie_manager()
cookie = __import__("gi.repository.Soup", fromlist=["Soup"]).Cookie.new("rh_session", tok, "localhost", "/", -1)
cm.add_cookie(cookie, None, None, None)

win = Gtk.OffscreenWindow(); view = WebKit2.WebView.new_with_context(ctx)
view.set_size_request(WIDTH, HEIGHT); win.add(view); win.show_all()
queue = list(paths)

def snap():
    def done(v, res, path):
        try:
            surf = v.get_snapshot_finish(res)
            out = "/home/claude/rh/shots/" + re.sub(r"[^a-z0-9]+", "_", path.strip("/") or "inicio") + ".png"
            surf.write_to_png(out); print("saved", out)
        except Exception as e:
            print("erro", path, e)
        nxt()
    view.get_snapshot(WebKit2.SnapshotRegion.VISIBLE if os.environ.get("SHOT_VISIBLE") else WebKit2.SnapshotRegion.FULL_DOCUMENT, WebKit2.SnapshotOptions.NONE, None, done, current[0])
    return False

current = [None]
def on_load(v, ev):
    if ev == WebKit2.LoadEvent.FINISHED:
        js = os.environ.get("SHOT_JS")
        if js: v.run_javascript(js, None, None, None)
        GLib.timeout_add(int(os.environ.get("SHOT_DELAY", "900")), snap)

def nxt():
    if not queue: Gtk.main_quit(); return
    current[0] = queue.pop(0); view.load_uri(B + current[0])

view.connect("load-changed", on_load)
os.makedirs("/home/claude/rh/shots", exist_ok=True)
nxt(); Gtk.main()
