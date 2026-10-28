import Link from "@/components/Link";
import { MenuLinks } from "@/components/MenuLinks";
import { RegistrarSW } from "@/components/RegistrarSW";
import { redirect } from "next/navigation";
import { requireSession, requireActiveUser, destroySession, getSession } from "@/lib/auth";
import { esquecerAparelho } from "@/lib/push";
import { getSettings } from "@/lib/utils";
import { naoLidas } from "@/lib/comunicacao";
import { sql } from "@/db";
import { SCHEMA_VERSION } from "@/lib/versao";
import { atualizarBanco } from "./configuracoes/banco/actions";
import { ehComite } from "@/lib/etica";
import { podePrivacidade } from "@/lib/privacidade";
import { BuscaGlobal } from "@/components/BuscaGlobal";
import { MenuInferior } from "@/components/MenuInferior";
import { escopoDo } from "@/lib/alertas";
import { montarMenu } from "@/lib/menu";
import { filtrarMenu, rotuloAtuacao } from "@/lib/acesso";

async function sair() { "use server"; const atual = await getSession(); await esquecerAparelho(atual?.id ?? null); await destroySession(); redirect("/login"); }

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession(); const u = await requireActiveUser(s);
  const cfg2 = await getSettings(); const { headers } = await import("next/headers"); const path = (await headers()).get("x-pathname") ?? "";
  if (u.trocarSenha && !path.startsWith("/conta")) redirect("/conta?trocar=1");
  if (cfg2.seguranca.exigir2FA.includes(s.role) && !u.totpAtivo && !path.startsWith("/conta/2fa") && !u.trocarSenha) redirect("/conta/2fa");
  let nNotif = 0; try { nNotif = await naoLidas(s.id); } catch { nNotif = 0; }
  // Banco atrás do código (atualização publicada sem aplicar o esquema): aviso só para quem pode corrigir
  let banco: "ok" | "desatualizado" | "incompleto" = "ok";
  if (["DIRECAO", "RH"].includes(s.role)) { try { const [b] = await sql<{ value: { versao?: string; falhas?: unknown[] } }[]>`SELECT value FROM settings WHERE key='banco'`; banco = !b || b.value?.versao !== SCHEMA_VERSION ? "desatualizado" : (b.value.falhas ?? []).length ? "incompleto" : "ok"; } catch { banco = "desatualizado"; } }
  const Sino = ({ cls }: { cls: string }) => <Link href="/notificacoes" aria-label="Notificações" className={cls}><span aria-hidden>🔔</span>{nNotif > 0 && <span className="rounded-full bg-erro px-1.5 text-[10px] font-semibold text-white">{nNotif > 99 ? "99+" : nNotif}</span>}</Link>;
  // v22: canal de ética só para o comitê (e Direção/RH); privacidade para Direção/RH/encarregado
  let membroEtica = false, gestorPriv = false; try { membroEtica = await ehComite(s); gestorPriv = await podePrivacidade(s); } catch { /* banco antigo */ }
  // v29: menu da atuação, sem as telas que o cargo não marcou
  // v29: quem é gestor direto de alguém (em qualquer área) tem “Minha equipe”
  let temEquipe = false; if (s.employeeId) { try { const [t] = await sql<{ ok: boolean }[]>`SELECT EXISTS (SELECT 1 FROM employees WHERE gestor_id=${s.employeeId} AND situacao IN ('ATIVO','FERIAS','AFASTADO','EM_ADMISSAO')) AS ok`; temEquipe = !!t?.ok; } catch { temEquipe = false; } }
  const m = montarMenu(s, { nNotif, membroEtica, gestorPriv, temEquipe }); const { grupos, inferior } = filtrarMenu(m.grupos, m.inferior, s);
  let nAlertas = 0; if (s.role !== "COLABORADOR") { try { const [a] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM alerts WHERE status='ABERTO' AND severidade='ALTO' AND dono_user_id=${s.id} AND escopo=${escopoDo(s)}`; /* mesmo recorte da Central (rede ou a unidade do perfil) */ nAlertas = a?.n ?? 0; } catch { nAlertas = 0; } }
  const paginasBusca = [...new Map(grupos.flatMap(([g, items]) => items.map(([href, label]) => [href, { href, titulo: label.replace(/ \(\d+\)$/, ""), grupo: g }] as const))).values()];
  const ATIVO = "bg-white/15 font-medium text-white shadow-[inset_3px_0_0_rgb(125,211,252)]";
  const links = (cls: string, rolar = false) => <MenuLinks grupos={grupos} cls={cls} ativoCls={ATIVO} rolar={rolar} />;
  return (
    <div className="min-h-screen md:grid md:grid-cols-[248px_minmax(0,1fr)]">
      <RegistrarSW />
      <aside className="sticky top-0 z-20 bg-navy text-white md:h-screen md:self-start md:overflow-y-auto md:overflow-x-hidden md:overscroll-contain md:[scrollbar-color:rgba(255,255,255,0.25)_transparent] md:[scrollbar-width:thin]">
        <div className="absolute right-[6.25rem] top-3 z-10 md:hidden"><BuscaGlobal paginas={paginasBusca} variante="icone" atalho={false} /></div>
        {/* Celular: cabeçalho com botão Menu que abre a lista completa */}
        <details id="menu-celular" className="md:hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 [&::-webkit-details-marker]:hidden">
            <span>
              <span className="block text-[11px] text-sky-200">Colégio Status</span>
              <span className="block text-lg font-semibold leading-tight">STATUS ONE</span>
            </span>
            <span className="rounded-md border border-sky-300/50 px-3 py-1.5 text-sm">☰ Menu</span>
          </summary>
          <nav className="flex flex-col gap-0.5 border-t border-white/10 px-2 pb-20 pt-2">
            {links("rounded-md px-3 py-2.5 text-sm text-sky-100 hover:bg-navy-700 hover:text-white")}
            <div className="mt-2 flex items-center justify-between border-t border-white/10 px-3 pt-3 text-xs text-sky-200">
              <span><span className="font-medium text-white">{s.nome}</span> · {s.cargo ?? rotuloAtuacao(s.role)}</span>
              <span className="flex items-center gap-2"><Sino cls="inline-flex items-center gap-1 rounded border border-sky-300/40 px-2 py-1 text-xs" /><form action={sair}><button className="rounded border border-sky-300/40 px-2 py-1 text-xs">Sair</button></form></span>
            </div>
          </nav>
        </details>
        {/* Computador: barra lateral fixa */}
        <div className="hidden md:block">
          {/* marca e busca ficam fixas no topo enquanto o menu rola */}
          <div className="sticky top-0 z-10 bg-navy pb-3 shadow-[0_6px_8px_-6px_rgba(0,0,0,0.35)]">
            <div className="px-4 py-4">
              <div className="text-[11px] text-sky-200">Colégio Status</div>
              <div className="text-lg font-semibold leading-tight">STATUS ONE</div>
            </div>
            <div className="px-3"><BuscaGlobal paginas={paginasBusca} /></div>
          </div>
          <nav className="flex flex-col gap-1 px-3 pb-3">
            {links("rounded-md px-3 py-2 text-sm leading-snug text-sky-100 hover:bg-navy-700 hover:text-white", true)}
          </nav>
          <div className="border-t border-white/10 px-4 py-4 text-xs text-sky-200">
            <div className="font-medium text-white">{s.nome}</div>
            <div>{s.cargo ?? rotuloAtuacao(s.role)}</div>{s.substituicao && <div className="mt-0.5 text-[11px] text-amber-200">substituindo {s.substituicao.cargo} até {s.substituicao.ate.split("-").reverse().join("/")}</div>}
            <div className="mt-3 flex items-center gap-2"><form action={sair}><button className="rounded border border-sky-300/40 px-2 py-1 text-xs hover:bg-navy-700">Sair</button></form><Sino cls="inline-flex items-center gap-1 rounded border border-sky-300/40 px-2 py-1 text-xs hover:bg-navy-700" /></div>
          </div>
        </div>
      </aside>
      <main className="min-w-0 pb-16 md:pb-0">{banco !== "ok" && !path.startsWith("/configuracoes/banco") && <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><span className="min-w-0 flex-1">{banco === "desatualizado" ? `O banco de dados está desatualizado em relação a esta versão do sistema (esquema ${SCHEMA_VERSION}). Algumas telas podem dar erro até a atualização.` : "A última atualização do banco terminou com pendências. Veja o diagnóstico."}</span>{banco === "desatualizado" && <form action={atualizarBanco}><button className="rounded-md bg-navy px-3 py-1.5 text-xs font-medium text-white">Atualizar banco agora</button></form>}<Link className="text-xs font-medium underline" href="/configuracoes/banco">Ver diagnóstico</Link></div>}{children}</main>
      <MenuInferior itens={inferior} alertas={nAlertas} />
    </div>
  );
}
