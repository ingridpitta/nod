import type { EventoStream, TarefaDoBot } from "../../contracts/turno.ts";
import { reduzirTarefas, SEM_TAREFAS, type AcompanhamentoDeTarefas } from "../../domain/tarefas-do-bot.ts";

/**
 * A lista de tarefas de cada turno vivo (definido em 2026-09-28), igual nos dois caminhos do cartão de atividade: o
 * laço dentro do servidor publica o frame direto; o app do Mac manda como trecho vivo na renovação da ponte. Só guarda
 * turno que já tocou numa ferramenta de tarefa, e publica só quando a lista muda.
 */
export function criarAcompanhanteDeTarefas(publicar: (turnoId: string, tarefas: TarefaDoBot[]) => void) {
  const porTurno = new Map<string, AcompanhamentoDeTarefas>();
  return {
    evento(turnoId: string, ev: EventoStream): void {
      const antes = porTurno.get(turnoId) ?? SEM_TAREFAS;
      const r = reduzirTarefas(antes, ev);
      if (r.acompanhamento !== antes) porTurno.set(turnoId, r.acompanhamento);
      if (r.mudou) publicar(turnoId, r.acompanhamento.tarefas);
    },
    esquecer(turnoId: string): void {
      porTurno.delete(turnoId);
    },
  };
}
