import { blocoPedidosAbertos, FUSO_PEDIDOS_ABERTOS, type PedidoAbertoNoPrompt } from "../domain/triagem.ts";
import { PRAZO_DECISAO_PADRAO_MS } from "./autoria-evento.ts";
import type { Deps } from "./tipos.ts";

/**
 * definido em 2026-10-12 (ADR-099 item 8, I7 revista): só os pedidos deste prazo para cá contam na espera circular — o
 * mesmo do varredor de pedidos parados (24 h). Um handoff mais velho sem resposta não segura ninguém. NOD-259: a mesma
 * janela vale para a guarda do pedido repetido e para a lista no prompt.
 */
export const JANELA_PEDIDOS_ABERTOS_MS = PRAZO_DECISAO_PADRAO_MS;

/**
 * Os pedidos que `agenteId` fez a colegas e ainda esperam resposta (NOD-259), com o nome de quem recebe, na mesma janela
 * da espera circular e da guarda do `pedir_a_bot`. Só os do handoff (a frente de um pedido é o mesmo pedido). `exceto`
 * tira tarefas que o chamador já sabe respondidas (a que está sendo entregue agora).
 *
 * definido em 2026-10-28 (NOD-362): `semPiso` lista só os handoffs da janela, sem o pedido mais velho que segue aberto
 * por esperar a cota (NOD-279). É o do prompt da rotina: um aviso, não uma guarda, e o disparo roda dentro do tick do
 * agendador. A guarda do pedir_a_bot (espera circular, pedido repetido) segue com a regra inteira.
 */
export async function pedidosAbertosDoBot(
  deps: Pick<Deps, "repos">, agenteId: string, agora: number, exceto: readonly string[] = [], opcoes: { semPiso?: boolean } = {},
): Promise<PedidoAbertoNoPrompt[]> {
  const abertos = (await deps.repos.pedidosDeColega.abertos(agora - JANELA_PEDIDOS_ABERTOS_MS, { de: agenteId, semPiso: opcoes.semPiso }))
    .filter((p) => p.de === agenteId && p.tarefaId !== null && !exceto.includes(p.tarefaId));
  if (abertos.length === 0) return [];
  const nomes = new Map<string, string>();
  for (const id of new Set(abertos.map((p) => p.para))) nomes.set(id, (await deps.repos.agentes.buscar(id))?.nome ?? "um colega");
  return abertos.map((p) => ({ alvoNome: nomes.get(p.para) ?? "um colega", criadoEm: p.criadoEm, texto: p.texto }));
}

/** O bloco do prompt (NOD-259) já com a quebra antes; vazio sem pedidos abertos. */
export async function notaPedidosAbertos(deps: Pick<Deps, "repos">, agenteId: string, agora: number, opcoes: { fusoIana?: string; exceto?: readonly string[] } = {}): Promise<string> {
  const bloco = blocoPedidosAbertos(await pedidosAbertosDoBot(deps, agenteId, agora, opcoes.exceto), agora, opcoes.fusoIana ?? FUSO_PEDIDOS_ABERTOS);
  return bloco ? `\n\n${bloco}` : "";
}
