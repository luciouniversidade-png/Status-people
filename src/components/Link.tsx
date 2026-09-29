import NextLink from "next/link";
import type { ComponentProps } from "react";

/**
 * Link do sistema com prefetch DESLIGADO por padrão.
 * Todas as telas são dinâmicas (sessão + banco); o prefetch automático do Next.js chamaria o servidor
 * uma vez para cada link visível (o menu tem dezenas), multiplicando execuções e CPU na hospedagem.
 * A navegação continua igual: a tela é buscada no clique.
 */
export default function Link({ prefetch = false, ...props }: ComponentProps<typeof NextLink>) {
  return <NextLink prefetch={prefetch} {...props} />;
}
