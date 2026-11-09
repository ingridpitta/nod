import type { ResultadoPedirABot } from "../../src/contracts/ferramentas-nod.ts";
import type { Tx } from "../../src/shared/types.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { criarTrabalho } from "../../src/use-cases/trabalhos.ts";

/**
 * O turno de triagem que `pedir_a_bot` criou (ADR-099, I7 revista: o resultado agora tem a recusa por espera circular).
 * Recusado, o teste falha com a instrução que o bot leria.
 */
export function tarefaDoPedido(data: ResultadoPedirABot): string {
  if (!data.ok) throw new Error(`pedir_a_bot recusado (${data.erro}): ${data.instrucao}`);
  return data.tarefa_id;
}

/**
 * Transforma o pedido recém-feito no pedido de ANTES da ADR-099 (ADR-083, S7): uma task `colega` de quem recebe, com o
 * turno de delegação dentro dela e o handoff apontando para ela. Serve aos testes de compatibilidade — os pedidos já
 * abertos em produção seguem assim, e o varredor da ADR-084 continua cuidando deles. Devolve o id da task.
 */
export async function comoPedidoDeAntes(trx: Tx, deps: Deps, data: ResultadoPedirABot, o: { pessoaEsperando?: boolean } = {}): Promise<string> {
  const tarefaId = tarefaDoPedido(data);
  const tarefa = await deps.repos.turnos.buscar(tarefaId);
  const pedido = (await deps.repos.mensagens.listarDaConversa(tarefa?.conversaId ?? "", 50)).find((m) => m.turnoId === tarefaId && m.payload?.kind === "peer_pedido");
  if (!tarefa || !pedido) throw new Error("pedido sem turno ou sem peer_pedido");
  const { trabalho } = await criarTrabalho(deps, { agenteId: tarefa.agenteId, conversaId: tarefa.conversaId, titulo: pedido.texto.split("\n")[0] ?? "pedido", origem: "colega", pedidoPorAgenteId: pedido.autoria.autor_id, pessoaEsperando: o.pessoaEsperando ?? false });
  await trx`update turnos set trabalho_id = ${trabalho.id} where id = ${tarefaId}`;
  await trx`update mensagens set payload = payload || jsonb_build_object('trabalhoId', ${trabalho.id}::text) where kind = 'handoff' and payload->>'tarefaId' = ${tarefaId}`;
  return trabalho.id;
}
