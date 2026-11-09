import type { Proposta } from "../contracts/conversa.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import { autoriaPessoa, evento, PRAZO_DECISAO_PADRAO_MS } from "./autoria-evento.ts";
import { enfileirarRetomada } from "./enfileirar-retomada.ts";
import type { Deps } from "./tipos.ts";

/**
 * definido em 2026-09-28 (ADR-050): confirmar o perfil retoma o turno que o propôs, como conceder um
 * acesso retoma a tarefa (retomar-apos-acesso.ts). Antes o card virava uma linha de sistema e o bot
 * ficava calado até a pessoa escrever — no caso da Teodora, o que faltava era justamente a pergunta
 * "pauso as rotinas delas?", que só faz sentido depois de ela assumir o trabalho.
 * Sem turno de origem (proposta anterior), turno de outro agente ou execução bloqueada: nada.
 */
export async function retomarAposPerfil(deps: Deps, proposta: Proposta, rotinas: number): Promise<RuntimeEvent[]> {
  const p = proposta.payload;
  if (p.kind !== "perfil" || !p.turnoId) return [];
  const original = await deps.repos.turnos.buscar(p.turnoId);
  if (!original || original.agenteId !== proposta.agenteId || original.conversaId !== proposta.conversaId) return [];
  if (await deps.repos.agentes.execucaoBloqueada(original.id)) return [];
  const agora = deps.agora();
  const { turno, nova } = await enfileirarRetomada(deps, {
    original,
    prazoEm: agora + PRAZO_DECISAO_PADRAO_MS,
    entradaTexto: [
      rotinas > 0 ? `A pessoa confirmou o seu perfil ${rotinas === 1 ? "e a rotina proposta junto" : `e as ${rotinas} rotinas propostas junto`}. Já vale: as rotinas estão ativas e os acessos que elas declararam foram liberados nos apps conectados.` : "A pessoa confirmou o seu perfil. Já vale.",
      "Continue a conversa em poucas linhas: diga o que acontece a seguir (por exemplo, quando chega a primeira entrega). Não repita o que já disse nem a proposta.",
      "Se o que você assumiu repete o trabalho de colegas, pergunte com pedir_a_pessoa se deve pausar as rotinas deles, para nada chegar em dobro, com as opções prontas. Não pause nada sem ela pedir.",
    ].join("\n"),
    reenvios: original.reenvios + 1,
  });
  return nova && turno ? [evento(deps.escopo, { kind: "turno_criado", autoria: autoriaPessoa(deps.escopo), agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { origem: "retomada", retoma_turno_id: original.id, proposta_id: proposta.id } })] : [];
}
