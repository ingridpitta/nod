import type { RuntimeEvent } from "../contracts/evento.ts";
import type { CasoNod } from "../contracts/servicos.ts";
import { autoriaAgente, evento } from "./apoio-l7.ts";
import type { Deps } from "./tipos.ts";

/**
 * Ferramenta `sem_novidade` (rotina): o agente consultou a fonte e nada mudou. Diferente de
 * `passar` — que é de sala e ESCREVE uma mensagem kind 'passe' para os outros bots verem a vez
 * passar —, aqui o ponto é justamente não escrever nada: marca o turno e sai.
 *
 * A marca é um CAMPO tipado no turno (Regra 9, domain/rotina-texto.ts: nenhum parser de intenção
 * sobre o texto do modelo). Quem lê são os dois pontos que hoje escrevem a cada execução:
 * assentar-turno.ts (não grava a fala) e disparar-rotina.ts (desfecho 'sem_novidade', sem marcador).
 *
 * Nenhuma mensagem é criada aqui, de propósito: a execução aparece só no histórico da rotina.
 */
export const semNovidade: CasoNod<Deps, "sem_novidade"> = async (deps, input) => {
  await deps.repos.turnos.marcarSemNovidade(input.turnoId, input.motivo);
  const autoria = autoriaAgente(input.agenteId, deps.escopo.pessoaId);
  const events: RuntimeEvent[] = [evento(deps, "rotina_sem_novidade", autoria, { motivo: input.motivo }, { conversaId: input.conversaId, turnoId: input.turnoId })];
  return { data: { ok: true }, events };
};
