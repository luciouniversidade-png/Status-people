import { sql } from "@/db";
import { SCHEMA_VERSION } from "@/lib/versao";

/**
 * Na subida do servidor (cada nova instância): se o banco estiver atrás do código, aplica o esquema e os dados-base.
 * Uma instância por vez (trava consultiva de transação no Postgres, compatível com pooler). Instalação nova continua pelo /api/setup. Nunca derruba o servidor.
 * Para desligar: AUTO_MIGRAR=0.
 */
export async function autoAtualizarBanco() {
  if (process.env.AUTO_MIGRAR === "0" || !process.env.DATABASE_URL) return;
  try {
    const inst = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM users`.then(r => r[0]?.n ?? 0).catch(() => 0); if (!inst) return;
    const versao = await sql<{ value: { versao?: string } }[]>`SELECT value FROM settings WHERE key='banco'`.then(r => r[0]?.value?.versao ?? null).catch(() => null);
    if (versao === SCHEMA_VERSION) return;
    // Trava de transação (funciona também com o pooler do Neon/PgBouncer): só uma instância aplica por vez; as outras seguem atendendo.
    await sql.begin(async tx => {
      const [{ ok }] = await tx<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(2026092902) AS ok`; if (!ok) return;
      const { runMigrations, seedBase } = await import("@/db/setup"); const r = await runMigrations();
      try { await seedBase(process.env.ADMIN_PASSWORD ?? ""); } catch { /* dados-base opcionais */ }
      console.log(`[STATUS ONE] banco atualizado automaticamente para o esquema ${r.versao}: ${r.aplicadas} instruções, ${r.falhas.length} pendência(s)`);
    });
  } catch (e) { console.error("[STATUS ONE] atualização automática do banco não concluída:", e instanceof Error ? e.message : e); }
}
