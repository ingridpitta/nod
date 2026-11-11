/**
 * O trabalho preso à etapa (definido em 2026-11-10, decisão do Marlon: o `stepMoved` do Multica, issueworkflow.go Brief;
 * ADR-142 §acionamento). Mover a tarefa para outra etapa não corta o turno vivo de quem trabalhava nela (a não ser que a
 * pessoa peça "Parar"): ele termina, mas fica na etapa em que começou. Se tentar mudar a coluna (mudar_tarefa com status,
 * terminei, devolver), o lote é recusado com o porquê; e ele não é cobrado por "sem saída" (ADR-155): a tarefa andou.
 */
import type { IdColuna } from "../contracts/quadro.ts";

export type MudancaDeColuna = { campo: string; para: string | null; autor: "pessoa" | "agente" | "regra"; autorAgenteId: string | null; criadoEm: number };

/**
 * A mudança que deixou o trabalho fora da etapa dele, ou null. Preso = a tarefa não está mais na coluna em que o trabalho
 * nasceu (`etapa`) e a última mudança de coluna depois disso foi da pessoa ou de outro bot. A do próprio bot (ele mesmo
 * andou com a tarefa) e a da regra (o merge que leva a Feito) não prendem ninguém.
 */
export function mudancaQuePrende(p: { etapa: IdColuna | null | undefined; statusAgora: IdColuna; desde: number; agenteId: string; historico: readonly MudancaDeColuna[] }): MudancaDeColuna | null {
  if (!p.etapa || p.statusAgora === p.etapa) return null;
  const ultima = [...p.historico].reverse().find((h) => h.campo === "status" && h.criadoEm >= p.desde);
  if (!ultima || ultima.autor === "regra") return null;
  if (ultima.autor === "agente" && ultima.autorAgenteId === p.agenteId) return null;
  return ultima;
}

/** A recusa do lote do trabalho preso que tenta mudar a coluna (texto do sistema, sem conteúdo de bot). */
export const recusaDaEtapaMovida = (quem: string, coluna: string): string =>
  `a tarefa foi movida por ${quem} para ${coluna} enquanto você trabalhava; não mude o status, comente se precisar (comentar)`;

/** O aviso que entra no turno vivo do trabalho preso (o próximo passo dele lê). */
export const avisoDaEtapaMovida = (titulo: string, quem: string, coluna: string): string =>
  `Aviso do quadro: a tarefa "${titulo}" foi movida por ${quem} para ${coluna} enquanto você trabalhava. Termine o que está fazendo; não mude o status (a mudança é recusada). Se precisar, comente na tarefa.`;
