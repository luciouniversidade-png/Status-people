"use client";

/** Erro fora das telas (layout geral): página mínima, sem depender do restante do sistema. */
export default function ErroGeral({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="pt-BR"><body style={{ fontFamily: "system-ui, sans-serif", padding: 24, color: "#0f172a" }}>
      <h1 style={{ fontSize: 20 }}>O sistema não pôde ser carregado</h1>
      <p>O problema foi registrado no servidor{error.digest ? ` (código ${error.digest})` : ""}. Nenhum dado foi alterado.</p>
      <p>Se começou logo depois de uma atualização, a Direção ou o RH deve abrir <a href="/configuracoes/banco">/configuracoes/banco</a> e aplicar as atualizações do banco.</p>
      <button type="button" onClick={() => reset()} style={{ padding: "8px 12px", marginRight: 8 }}>Tentar de novo</button><a href="/login">Ir para o login</a>
    </body></html>
  );
}
