import { PASSOS_POR_PAGINA, type PassosDoRunDto } from "../contracts/quadro-comentarios.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { ehUuid } from "./apoio-l7.ts";
import { experimentoLigado } from "./quadro.ts";
import type { CasoDeUso } from "./tipos.ts";

/**
 * ADR-165 (definido em 2026-11-10): os passos persistidos de um run da tarefa aberta, uma página por vez (seq > `depois`).
 * O run é um turno raiz que a tarefa mostra (runsDaTarefa): o de um trabalho da tarefa (quadro_execucoes) ou o que um
 * comentário dela acionou. Turno de outra tarefa, de outro bot ou invisível: 404, como a tarefa fora do quadro. Só lê.
 */
export const verPassosDoRun: CasoDeUso<{ agenteId: string; tarefaId: string; turnoId: string; depois: number | null }, PassosDoRunDto> = async (deps, input) => {
  if (!(await experimentoLigado(deps))) throw new ErroDeDominio("nao_permitido", { cause: "experimento quadro desligado" });
  // ADA-14: a tarefa de qualquer quadro deste bot (a mesma porta do verComentarios).
  const t0 = ehUuid(input.tarefaId) ? await deps.repos.quadros.tarefa(input.tarefaId) : null;
  const q = t0 ? await deps.repos.quadros.doBot(input.agenteId, t0.quadroId) : null;
  if (!q || !(await deps.repos.quadros.tarefas(q.id)).some((t) => t.id === input.tarefaId)) throw new ErroDeDominio("nao_encontrado", { cause: "tarefa fora do quadro" });
  if (!ehUuid(input.turnoId)) throw new ErroDeDominio("nao_encontrado", { cause: "turno malformado" });
  const doTrabalho = (await deps.repos.quadroExecucoes.daTarefa(input.tarefaId)).some((e) => e.turnoId === input.turnoId);
  if (!doTrabalho && (await deps.repos.quadroComentarios.threadDoTurno(input.tarefaId, input.turnoId)) === null) throw new ErroDeDominio("nao_encontrado", { cause: "run fora da tarefa" });
  return { data: await deps.repos.turnoPassos.daCadeia(input.turnoId, input.depois, PASSOS_POR_PAGINA) };
};
