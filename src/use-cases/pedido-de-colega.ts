import type { Mensagem } from "../contracts/mensagem.ts";
import type { OrigemTrabalho } from "../contracts/trabalho.ts";
import type { OrigemTurno, Turno } from "../contracts/turno.ts";
import { pessoaEsperaOPedido } from "../domain/triagem.ts";
import { delegacaoDoTurno, rotinaDoTurno } from "./apoio-l7.ts";
import type { Deps } from "./tipos.ts";

/**
 * Quem pediu o quê (definido em 2026-10-12, ADR-099, issue I7 revista). O pedido de colega entra como um turno de triagem
 * do dono (`delegacao`, sem trabalho); o lote de frentes que o dono abre nesse turno fica ligado a ele
 * (`lotes_de_frentes.aberto_por_turno_id`). Para saber se um lote é de colega e a quem devolver o resultado, a I3 chama
 * `pedidoDeColegaDoTurno(deps, turnoQueAbriuOLote)`: o critério é o MESMO de `entregarRespostaPeer` (a raiz da cadeia de
 * retomadas, origem `delegacao` ou `peer`, e a fala de outro bot ligada a ela — o `peer_pedido`). É o mesmo critério do
 * `destinoDoLote` da I3 (#280, src/domain/retorno-do-lote.ts): a raiz pela cadeia de retomadas, `delegacao` ou `peer`.
 */
export type PedidoDeColega = {
  /** A raiz do pedido: o turno `delegacao` (ou `peer`, legado) que a entrega usa como `tarefaId`. */
  tarefa: Turno;
  /** A fala de quem pediu, ligada à tarefa (o `peer_pedido`; no legado, uma fala de texto de outro bot). */
  pergunta: Mensagem;
  remetenteAgenteId: string;
  /** Onde quem pediu espera a resposta e o turno dele que pediu (do `peer_pedido`); null no legado. */
  conversaOrigemId: string | null;
  turnoOrigemId: string | null;
};

/**
 * A pergunta da tarefa: a mensagem de TEXTO de outro agente ligada a ela. A resposta `peer_ask` (kind próprio, ligada à
 * continuação) nunca conta — senão a continuação responderia a si mesma em laço (revisão da ADR-047).
 */
export async function perguntaDaTarefa(deps: Pick<Deps, "repos">, tarefa: Turno): Promise<Mensagem | null> {
  const mensagens = await deps.repos.mensagens.listarDaConversa(tarefa.conversaId, 500);
  return mensagens.find((m) => m.turnoId === tarefa.id && m.kind === "texto" && m.autoria.autor_tipo === "agente" && m.autoria.autor_id !== tarefa.agenteId) ?? null;
}

/** Este turno atende o pedido de um colega? Devolve quem pediu e a tarefa; null = não é pedido de colega. */
export async function pedidoDeColegaDoTurno(deps: Pick<Deps, "repos">, turno: Turno): Promise<PedidoDeColega | null> {
  const tarefa = turno.origem === "peer" ? turno : await delegacaoDoTurno(deps.repos, turno);
  if (!tarefa) return null;
  const pergunta = await perguntaDaTarefa(deps, tarefa);
  if (!pergunta) return null;
  const origem = pergunta.payload?.kind === "peer_pedido" ? pergunta.payload : null;
  return { tarefa, pergunta, remetenteAgenteId: pergunta.autoria.autor_id, conversaOrigemId: origem?.conversaOrigemId ?? null, turnoOrigemId: origem?.turnoOrigemId ?? null };
}

/**
 * De onde vêm as frentes que um turno do dono abre, fora de trabalho (ADR-099): da pessoa (a conversa), de um colega (a
 * triagem do pedido) ou de uma rotina (a triagem de "rodar <rotina>"). Decide a origem do trabalho (a ADR-085 segura no Mac
 * apertado o que vem de colega ou de rotina), o turno da frente (modo e catálogo: a frente de colega é `delegacao`, sem
 * criar rotina, como a task de colega de antes; a de rotina, `rotina`) e quem pediu.
 */
export type OrigemDasFrentes = {
  origem: OrigemTrabalho;
  turnoOrigem: OrigemTurno;
  rotinaId: string | null;
  pedidoPorAgenteId: string | null;
  pedidoPorNome: string | null;
  pessoaEsperando: boolean;
};

export async function origemDasFrentes(deps: Pick<Deps, "repos">, turno: Turno): Promise<OrigemDasFrentes> {
  const colega = await pedidoDeColegaDoTurno(deps, turno);
  if (colega) {
    const deQuemPediu = colega.turnoOrigemId ? await deps.repos.turnos.buscar(colega.turnoOrigemId) : null;
    const nome = (await deps.repos.agentes.buscar(colega.remetenteAgenteId))?.nome ?? null;
    return { origem: "colega", turnoOrigem: "delegacao", rotinaId: null, pedidoPorAgenteId: colega.remetenteAgenteId, pedidoPorNome: nome, pessoaEsperando: pessoaEsperaOPedido(deQuemPediu) };
  }
  const rotina = turno.origem === "rotina" || turno.origem === "retomada" ? await rotinaDoTurno(deps.repos, turno.id) : null;
  // NOD-272: a frente aberta pelo "Testar agora" nasce com a pessoa esperando (o portão do Mac não a segura).
  if (rotina) return { origem: "rotina", turnoOrigem: "rotina", rotinaId: rotina.rotina.id, pedidoPorAgenteId: null, pedidoPorNome: null, pessoaEsperando: rotina.turnoDisparado.pessoaEsperando === true };
  return { origem: "pessoa", turnoOrigem: "conversa", rotinaId: null, pedidoPorAgenteId: null, pedidoPorNome: null, pessoaEsperando: false };
}
