/**
 * O time de bots (definido em 2026-11-02, NOD-437): uma entidade da pessoa com nome, posição na barra e recolhido. Os
 * membros continuam em `agentes.secao` (o nome do time); o time casa com eles pela chave do nome (src/domain/times.ts).
 * O "Sem time" é a linha de nome '' — não se renomeia nem se exclui, mas tem posição e recolhido.
 */
export type Time = {
  id: string;
  /** '' = Sem time. */
  nome: string;
  posicao: number;
  recolhido: boolean;
};

/** O que GET /times devolve: os times da pessoa na ordem da barra (o Sem time incluso, `semTime: true`). */
export type TimeNaLista = Time & { semTime: boolean };

/** O nome que a tela e as mensagens dão ao Sem time; também reservado (não vira time). */
export const NOME_SEM_TIME = "Sem time";

/** Teto do nome do time (o mesmo de agentes.secao). */
export const TETO_NOME_TIME = 60;
