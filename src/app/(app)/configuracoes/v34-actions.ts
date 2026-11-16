"use server";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, can, assert } from "@/lib/auth";
import { audit, str, erroMsg, getSettings } from "@/lib/utils";

const n = (fd: FormData, k: string, min: number, max: number, rot: string) => { const v = Number(str(fd, k).replace(",", ".")); if (!Number.isFinite(v) || v < min || v > max) throw new Error(`${rot}: use um número entre ${min} e ${max}.`); return v; };
const linhas = (t: string) => [...new Set(t.split(/\r?\n/).map(x => x.replace(/\s+/g, " ").trim()).filter(Boolean))];
const grava = async (key: string, v: unknown) => sql`INSERT INTO settings (key, value) VALUES (${key}, ${JSON.stringify(v)}::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`;

/** Parâmetros da v34 (assinatura, cadastro, Meu espaço, termômetro, escalas, estoque). */
export async function salvarParametrosV34(fd: FormData) {
  const s = await requireSession();
  try {
    assert(can.configurar(s), "Só Direção e RH configuram."); const c = await getSettings();
    const assinaturas = { ...c.assinaturas, prazoDias: Math.round(n(fd, "prazoDias", 1, 60, "Prazo para assinar")), espelhoPrazoDias: Math.round(n(fd, "espelhoPrazoDias", 1, 30, "Prazo do espelho")), lembreteDiasAntes: Math.round(n(fd, "lembreteDiasAntes", 0, 15, "Lembrete")) };
    const cadastro = { ...c.cadastro, conviteDias: Math.round(n(fd, "conviteDias", 1, 30, "Validade do link")), maxEnviosAdmissao: Math.round(n(fd, "maxEnviosAdmissao", 1, 10, "Envios por link")), maxPedidosAbertos: Math.round(n(fd, "maxPedidosAbertos", 1, 10, "Pedidos abertos")) };
    const meuEspaco = { ...c.meuEspaco, permitirAjustePonto: str(fd, "permitirAjustePonto") === "1", permitirAtestado: str(fd, "permitirAtestado") === "1", mostrarEvolucaoSalarial: str(fd, "mostrarEvolucaoSalarial") === "1", mostrarAniversariantes: str(fd, "mostrarAniversariantes") === "1", ajustePontoDiasMax: Math.round(n(fd, "ajustePontoDiasMax", 1, 90, "Ajuste de ponto")) };
    const fatores = linhas(str(fd, "fatores")).map(f => f.slice(0, 40)); assert(fatores.length >= 2 && fatores.length <= 12, "Termômetro: de 2 a 12 fatores.");
    const termometro = { ...c.termometro, ativo: str(fd, "termometroAtivo") === "1", minimoGrupo: Math.round(n(fd, "minimoGrupo", 3, 30, "Mínimo do grupo")), alertaMedia: n(fd, "alertaMedia", 1, 5, "Alerta"), fatores };
    const escalas = { ...c.escalas, interjornadaHoras: n(fd, "interjornadaHoras", 8, 24, "Descanso entre jornadas"), jornadaMaxHoras: n(fd, "jornadaMaxHoras", 6, 13, "Turno longo"), diasAvisoPublicacao: Math.round(n(fd, "diasAvisoPublicacao", 0, 7, "Aviso de publicação")), exigirFolgaSemanal: str(fd, "exigirFolgaSemanal") === "1" };
    const categorias = linhas(str(fd, "categorias")).map(x => x.slice(0, 40)); assert(categorias.length >= 2 && categorias.length <= 30, "Estoque: de 2 a 30 categorias.");
    const usadas = (await sql<{ categoria: string }[]>`SELECT DISTINCT categoria FROM stock_items WHERE ativo`).map(r => r.categoria).filter(x => !categorias.includes(x));
    assert(!usadas.length, `Categoria em uso não pode sair da lista: ${usadas.join(", ")}.`);
    const estoque = { ...c.estoque, alertaValidadeDias: Math.round(n(fd, "alertaValidadeDias", 1, 180, "Validade de lote")), alertaCaDias: Math.round(n(fd, "alertaCaDias", 1, 365, "CA de EPI")), categorias };
    for (const [k, v] of Object.entries({ assinaturas, cadastro, meuEspaco, termometro, escalas, estoque })) await grava(k, v);
    await audit(s, "editar parâmetros da v34", "settings", null, null, { assinaturas, cadastro, meuEspaco, termometro: { ...termometro, fatores: fatores.length }, escalas, estoque: { ...estoque, categorias: categorias.length } });
  } catch (e) { redirect(`/configuracoes?erro=${erroMsg(e)}#v34`); }
  redirect(`/configuracoes?ok=${encodeURIComponent("Parâmetros da v34 salvos.")}#v34`);
}
