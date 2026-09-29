/** Executado uma vez quando o servidor sobe: mantém o banco no esquema desta versão do sistema. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { autoAtualizarBanco } = await import("./lib/auto-migracao");
    await autoAtualizarBanco();
  }
}
