"use client";

/** Erro em uma tela: mensagem clara, código para o suporte e caminho de correção (sem a página branca padrão). */
export default function ErroTela({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto mt-6 max-w-xl rounded-lg border border-red-200 bg-white p-5 shadow-sm" role="alert">
      <h1 className="text-lg font-semibold text-navy">Esta tela não pôde ser carregada</h1>
      <p className="mt-2 text-sm text-slate-700">O problema foi registrado no servidor{error.digest ? <> (código <span className="font-mono">{error.digest}</span>)</> : null}. Nenhum dado foi alterado.</p>
      <p className="mt-2 text-sm text-slate-700">Se começou logo depois de uma atualização do sistema, o banco de dados ainda não recebeu as mudanças da nova versão. A Direção ou o RH deve abrir <a className="font-medium text-acao underline" href="/configuracoes/banco">Configurações → Banco de dados</a> e tocar em <b>Aplicar atualizações do banco</b>.</p>
      <div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => reset()} className="rounded-md bg-navy px-3 py-2 text-sm font-medium text-white">Tentar de novo</button><a href="/" className="rounded-md border border-line px-3 py-2 text-sm">Ir para o início</a></div>
    </div>
  );
}
