import type { AnexoDaConversa } from "./anexo.ts";

/**
 * NOD-326: a Biblioteca da gaveta do bot — os arquivos e mídias que o bot anexou nesta conversa, do mais recente ao mais
 * antigo. Cada item é o anexo da conversa (as mesmas medidas, máquina e "sem bytes" da NOD-323) mais a fala onde ele está
 * e quando foi anexado (o servidor manda o instante; a web agrupa em Hoje / Últimos 7 dias / Mais antigos no fuso de quem vê).
 */
export type ItemDaBiblioteca = AnexoDaConversa & {
  mensagemId: string;
  /** ISO 8601 em UTC. */
  criadoEm: string;
};

export type PaginaDaBiblioteca = {
  itens: ItemDaBiblioteca[];
  /** O cursor opaco da próxima página (`?antes=`), ou null quando acabou. */
  proximo: string | null;
};

/** definido em 2026-10-24 (NOD-326, suposição 4 da spec): 60 por página, e o cliente não passa de 200. */
export const LIMITE_BIBLIOTECA = 60;
export const TETO_BIBLIOTECA = 200;
