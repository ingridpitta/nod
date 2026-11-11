/**
 * O diálogo de handoff (2026-11-10, decisão do Marlon: o confirm do Multica, board-view.tsx MUL-7420). Só tipos (EMENDA
 * 26): o que a tela mostra antes de soltar a tarefa numa coluna com responsável — quem pega, se começa, o run de quem
 * estava (rodando há quanto, ou na fila) e o texto que o próximo recebe.
 */
export type PreviaDoMoverDto = {
  /** A regra única (src/domain/acionamento.ts). */
  agenteId: string | null;
  passa: boolean;
  aciona: boolean;
  /** O responsável de antes e o de depois, pelo nome (null = ninguém). */
  deNome: string | null;
  paraNome: string | null;
  /** O trabalho vivo de quem estava (null = nada rodando nem na fila). */
  anterior: { agenteNome: string; estado: "rodando" | "fila"; desde: number } | null;
  /** O pedido que o próximo recebe (o mesmo texto que vai ao turno); null = ninguém começa. */
  texto: string | null;
};
