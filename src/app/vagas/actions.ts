"use server";
// v30 · Página pública de vagas (Trabalhe conosco): candidatura com consentimento, sem login. Desligada até o GO (Configurações → Recrutamento).
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { str, strOrNull, getSettings, hoje, addDays, auditComo } from "@/lib/utils";
import { erroAssinado } from "@/lib/aviso";
import { chaveOrigem, excedeu, registrarEnvio } from "@/lib/limite";
import { novoTokenPortal, hashToken } from "@/lib/portal-candidato";
import { notificar, usuariosPorPerfil } from "@/lib/comunicacao";

const ehRedirect = (e: unknown) => e instanceof Error && (e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT");
const norm = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const HORA = 3600 * 1000;

export async function candidatarPublico(fd: FormData) {
  const slug = str(fd, "slug"); const volta = `/vagas/${encodeURIComponent(slug)}`;
  try {
    const cfg = await getSettings(); const pag = cfg.recrutamento.paginaPublica as { ativa?: boolean; limitePorHora?: number };
    if (!pag?.ativa) throw new Error("A página de vagas não está disponível.");
    const [v] = await sql<{ id: number; titulo: string; unidade: string; unit_id: number; responsavel_user_id: number | null }[]>`SELECT r.id, r.titulo, u.nome AS unidade, r.unit_id, r.responsavel_user_id FROM requisitions r JOIN units u ON u.id=r.unit_id WHERE r.slug=${slug} AND r.publicar AND r.status='ABERTA'`;
    if (!v) throw new Error("Esta vaga não está mais aberta.");
    // robô que preenche o campo escondido: finge que deu certo e não grava nada
    if (str(fd, "site")) redirect(`${volta}?enviado=1`);
    const chave = await chaveOrigem("vagas"); const max = Math.max(1, Number(pag.limitePorHora) || 5);
    if (excedeu(chave, max, HORA)) throw new Error("Muitas candidaturas enviadas deste endereço na última hora. Tente de novo mais tarde.");
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM public_application_log WHERE at > now() - interval '1 hour'`; if (n >= 200) throw new Error("Recebemos muitas candidaturas agora. Tente de novo em alguns minutos.");
    const nome = str(fd, "nome").replace(/\s+/g, " "); const email = str(fd, "email").toLowerCase(); const cv = str(fd, "curriculo"); const link = strOrNull(fd, "link");
    if (nome.length < 5 || !nome.includes(" ")) throw new Error("Informe o nome completo.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Informe um e-mail válido.");
    if (cv.length < 80) throw new Error("Conte um pouco da sua trajetória (formação, experiências, o que você faz bem) — pelo menos algumas linhas.");
    if (link && !/^https?:\/\//i.test(link)) throw new Error("O link precisa começar com http:// ou https://.");
    if (str(fd, "consentimento") !== "1") throw new Error("Para se candidatar, autorize o uso dos seus dados neste processo seletivo.");
    // mesmo e-mail e mesmo nome: é a mesma pessoa (não sobrescreve nada do cadastro); e-mail igual com outro nome: cadastro novo (o RH une, se for o caso)
    const existentes = await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM candidates WHERE lower(email)=${email}`;
    let cid = existentes.find(c => norm(c.nome) === norm(nome))?.id ?? null;
    if (cid) { const [dup] = await sql<{ id: number }[]>`SELECT id FROM applications WHERE requisition_id=${v.id} AND candidate_id=${cid}`; if (dup) throw new Error("Você já se candidatou a esta vaga. Acompanhe pelo link que recebeu ao se candidatar."); }
    else { const [c] = await sql<{ id: number }[]>`INSERT INTO candidates (nome, email, telefone, cidade, curriculo_link, curriculo_texto, origem, consentimento_lgpd, obs) VALUES (${nome}, ${email}, ${strOrNull(fd, "telefone")}, ${strOrNull(fd, "cidade")}, ${link}, ${cv.slice(0, 20000)}, 'SITE', true, ${existentes.length ? "Candidatura pela página de vagas com e-mail já cadastrado em outro nome — confira se é a mesma pessoa." : null}) RETURNING id`; cid = c.id; }
    const [a] = await sql<{ id: number }[]>`INSERT INTO applications (requisition_id, candidate_id, etapa, etapa_desde) VALUES (${v.id}, ${cid}, 'TRIAGEM', now()) RETURNING id`;
    await sql`INSERT INTO application_events (application_id, user_nome, texto, origem) VALUES (${a.id}, 'Candidato (página de vagas)', ${cid && existentes.some(c => c.id === cid) ? "Candidatura pela página de vagas (cadastro já existente; currículo novo nas observações da candidatura)" : "Candidatura pela página de vagas"}, 'CANDIDATO')`;
    if (existentes.some(c => c.id === cid)) await sql`UPDATE applications SET notas=${`Currículo enviado pela página de vagas:\n${cv.slice(0, 4000)}`} WHERE id=${a.id}`;
    const token = novoTokenPortal(); const validade = Math.max(1, Math.min(120, Number(cfg.recrutamento.portal?.validadeDias ?? 30)));
    await sql`INSERT INTO candidate_portal_links (application_id, token_hash, expira_em, criado_por) VALUES (${a.id}, ${hashToken(token)}, ${addDays(hoje(), validade)}, NULL)`;
    await sql`INSERT INTO public_application_log (ip, requisition_id) VALUES (${chave}, ${v.id})`; registrarEnvio(chave, HORA);
    await auditComo("Candidato (página de vagas)", "candidatura pela página de vagas", "applications", a.id, null, { vaga: v.id });
    const dest = v.responsavel_user_id ? [v.responsavel_user_id] : await usuariosPorPerfil(["RH"]);
    await notificar(dest, "Nova candidatura pela página de vagas", `Vaga: ${v.titulo} (${v.unidade})`, `/recrutamento/vagas/${v.id}`, "ACAO");
    redirect(`/candidatura/${encodeURIComponent(token)}?ok=nova`);
  } catch (e) { if (ehRedirect(e)) throw e; redirect(`${volta}?${erroAssinado(e instanceof Error ? e.message : "Não foi possível enviar. Tente de novo.")}`); }
}
