/**
 * NOD-430 (definido em 2026-11-02): o que a pessoa vê do quadro mexido pela conversa. Saiu de `quadro.ts` na revisão 3
 * do PR #627, que chegava ao teto de 200 linhas dos contratos (EMENDA 26).
 */

/**
 * A Atividade da tarefa aberta (os lotes que a tocaram); `quem` = "Você", "Você, pela Ada" ou o nome do bot.
 * `campos` (2026-11-10): o que o lote mudou na prioridade, no prazo e nas labels da tarefa (a linha do tempo mostra como
 * eventos discretos); ausente = nada disso (ou a foto do lote é de antes desses campos).
 */
export type AtividadeTarefa = { loteId: string; resumo: string; quem: string; criadoEm: number; campos?: MudancaDeCampo[] };

/** Uma mudança de campo da tarefa num lote: a prioridade (ids), o prazo (AAAA-MM-DD; null = sem) ou as labels (ids). */
export type MudancaDeCampo =
  | { campo: "prioridade"; de: string; para: string }
  | { campo: "prazo"; de: string | null; para: string | null }
  | { campo: "labels"; postas: string[]; tiradas: string[] };

/** `[codigo](link)` na resposta do gerir_quadro abre o quadro do anfitrião com a tarefa aberta. */
export type LinkDeTarefa = { tarefa_id: string; codigo: string; titulo: string; link: string };
