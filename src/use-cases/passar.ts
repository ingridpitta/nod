import type { RuntimeEvent } from "../contracts/evento.ts";
import type { MotivoPasse } from "../contracts/motivos.ts";
import type { CasoNod } from "../contracts/servicos.ts";
import { redigir } from "../domain/redacao.ts";
import { agenteVisivel, autoriaAgente, evento, fecharRodadaSeAssentou, rodadaDaSala } from "./apoio-l7.ts";
import type { Deps } from "./tipos.ts";

const MOTIVO_HUMANO: Record<MotivoPasse, string> = {
  passei_sem_nada_a_dizer: "sem nada a acrescentar",
  negado_fail_closed: "negado por fail-closed",
  ausente_offline: "ausente/offline",
  cota_esgotada: "cota esgotada",
};

/**
 * Ferramenta `passar` (sala): passe como CAMPO tipado, nunca regex sobre o texto (GRUPO.passe-tipado).
 * Grava a mensagem kind 'passe' com o motivo do enum e, se a rodada fechou com este passe
 * (assentamento por contagem no domínio), escreve o desfecho como mensagem de sistema. Fora de uma
 * sala o passe é só registrado. O remetente vem do token (ContextoFerramenta), nunca do corpo.
 */
export const passar: CasoNod<Deps, "passar"> = async (deps, input) => {
  const agente = await agenteVisivel(deps.repos, input.agenteId);
  const sala = await deps.repos.salas.buscarPorConversa(input.conversaId);
  const antes = sala ? (await rodadaDaSala(deps.repos, input.conversaId)).desfecho : "em_andamento";
  const autoria = autoriaAgente(agente.id, deps.escopo.pessoaId);
  const mensagem = await deps.repos.mensagens.criar({
    conversaId: input.conversaId,
    turnoId: input.turnoId,
    autoria,
    kind: "passe",
    texto: redigir("passe", deps.agora(), { agente: agente.nome, motivo: MOTIVO_HUMANO[input.motivo] }),
    payload: { kind: "passe", motivo: input.motivo },
    confianca: "confiavel",
  });
  const events: RuntimeEvent[] = mensagem
    ? [evento(deps, "mensagem_criada", autoria, { mensagemId: mensagem.id, kind: "passe", motivo: input.motivo }, { conversaId: input.conversaId, turnoId: input.turnoId })]
    : [];
  if (sala) await fecharRodadaSeAssentou(deps, input.conversaId, antes);
  return { data: { ok: true }, events };
};
