import type { EstadoExecucao, VoltaDoTrabalho } from "../contracts/quadro-execucoes.ts";
import { estadoDaExecucao, terminada } from "../domain/quadro-execucoes.ts";
import type { Deps } from "./tipos.ts";

/** ADA-232: o trabalho atual de uma tarefa como o card e o zelador o leem. */
export type SituacaoDoTrabalho = { estado: EstadoExecucao; vivo: boolean; volta: (VoltaDoTrabalho & { turnoId: string | null }) | null };

/**
 * ADA-232 (ADR-155): o trabalho atual de cada tarefa — vivo (fila, rodando, esperando) e a volta que ele espera (hora
 * marcada, CI, comando de fundo). O zelador não cobra a tarefa que tem trabalho vivo ou volta; o card mostra a linha.
 */
export async function situacaoDasTarefas(deps: Pick<Deps, "repos">, tarefaIds: readonly string[]): Promise<Map<string, SituacaoDoTrabalho>> {
  const atuais = (await deps.repos.quadroExecucoes.atuaisDasTarefas(tarefaIds)).filter((e) => e.canceladaEm === null);
  const raizes = atuais.map((e) => e.turnoId);
  const desfechos = await deps.repos.quadroExecucoes.desfechos(raizes);
  const voltas = await deps.repos.quadroExecucoes.voltasDasCadeias(raizes);
  const r = new Map<string, SituacaoDoTrabalho>();
  for (const e of atuais) {
    const estado = estadoDaExecucao(e, desfechos.get(e.turnoId));
    r.set(e.tarefaId, { estado, vivo: !terminada(estado), volta: voltas.get(e.turnoId) ?? null });
  }
  return r;
}
