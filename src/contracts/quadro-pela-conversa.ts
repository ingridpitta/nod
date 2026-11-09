/**
 * NOD-430 (definido em 2026-11-02): o que a pessoa vê do quadro mexido pela conversa. Saiu de `quadro.ts` na revisão 3
 * do PR #627, que chegava ao teto de 200 linhas dos contratos (EMENDA 26).
 */

/** A Atividade da tarefa aberta (os lotes que a tocaram); `quem` = "Você", "Você, pela Ada" ou o nome do bot. */
export type AtividadeTarefa = { loteId: string; resumo: string; quem: string; criadoEm: number };

/** `[codigo](link)` na resposta do gerir_quadro abre o quadro do anfitrião com a tarefa aberta. */
export type LinkDeTarefa = { tarefa_id: string; codigo: string; titulo: string; link: string };
