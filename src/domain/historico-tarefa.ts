import type { AutorHistorico, ColunaQuadro, IdColuna, MudancaTarefa, TarefaQuadro } from "../contracts/quadro.ts";
import { colunaDeAndamento, colunaDoGrupoSemPassagem, grupoDe, normalizarNome, responsavelDe } from "./colunas.ts";

/**
 * definido em 2026-11-02 (NOD-416, ADR-144): o histórico da tarefa, puro. Cada lote compara três fotos da tarefa: a de
 * antes, a que o autor pediu (o fim dos passos dele) e a final (depois do motor: começar leva a Fazendo, o bot sem
 * conversa volta à espera, o limite da corrente segura). O que mudou do antes ao pedido é do autor; do pedido ao final, da
 * regra. A coluna que saiu leva as tarefas dela: essa mudança de status também é da regra.
 */

export type EstadoDaTarefa = Pick<TarefaQuadro, "status" | "agenteId">;

export function mudancasDaTarefa(p: {
  tarefaId: string;
  /** null = a tarefa nasceu neste lote. */
  antes: EstadoDaTarefa | null;
  pedido: EstadoDaTarefa;
  final: EstadoDaTarefa;
  autor: AutorHistorico;
  /** O status mudou porque a coluna saiu (remover/substituir colunas), não porque o autor pediu. */
  statusPorRegra?: boolean;
}): MudancaTarefa[] {
  const { tarefaId, antes, pedido, final, autor } = p;
  const regra: AutorHistorico = { tipo: "regra" };
  const m: MudancaTarefa[] = [];
  if (antes === null) {
    m.push({ tarefaId, campo: "criada", de: null, para: pedido.status, autor });
    if (pedido.agenteId !== null) m.push({ tarefaId, campo: "agente", de: null, para: pedido.agenteId, autor });
  } else {
    if (antes.status !== pedido.status) m.push({ tarefaId, campo: "status", de: antes.status, para: pedido.status, autor: p.statusPorRegra ? regra : autor });
    if (antes.agenteId !== pedido.agenteId) m.push({ tarefaId, campo: "agente", de: antes.agenteId, para: pedido.agenteId, autor });
  }
  if (pedido.status !== final.status) m.push({ tarefaId, campo: "status", de: pedido.status, para: final.status, autor: regra });
  if (pedido.agenteId !== final.agenteId) m.push({ tarefaId, campo: "agente", de: pedido.agenteId, para: final.agenteId, autor: regra });
  return m;
}

/**
 * A coluna da tarefa no quadro de destino: a mesma, se o destino a tem; senão a padrão do mesmo grupo (Backlog, Fazendo,
 * Feito, Cancelado). "Precisa de você" é fixa e existe em todo quadro. Revisão 7 do PR #623, a regra da main
 * (ADR-142): o mover não faz passagem. A coluna do destino com responsável (`responsavelDe`) que não é o da tarefa fica
 * de fora (a tarefa estaria na etapa de um bot sem ser dele, e sem ele acionado); cai na do mesmo grupo sem passagem.
 * Cair numa coluna que aciona (`acionaNaColuna`) não começa ninguém: quem aciona é o lote, e o mover não é lote.
 */
export function statusNoDestino(origem: readonly ColunaQuadro[], status: IdColuna, destino: readonly ColunaQuadro[], agenteId: string | null = null, turnoVivo = true): IdColuna {
  const livre = (id: IdColuna) => { const r = responsavelDe(destino, id); return r === null || r === agenteId; };
  if (destino.some((c) => c.id === status) && livre(status)) return status;
  const g = grupoDe(origem, status) ?? "nao_iniciado";
  if (g === "iniciado" && !turnoVivo) return andamentoSemExecucao(origem, status, destino) ?? colunaDoGrupoSemPassagem(destino, g, agenteId);
  return colunaDoGrupoSemPassagem(destino, g, agenteId);
}

/**
 * Revisão 8 do PR #623: a tarefa de Andamento sem turno vivo (nunca rodou, ou o turno acabou) que perde a coluna fica no
 * grupo Andamento (o critério da issue: "cai no grupo equivalente"), mas não na coluna de execução (Fazendo, ou a 1ª de
 * andamento da pessoa: `colunaDeAndamento`), onde pareceria rodando. A do destino com o mesmo nome primeiro; senão a 1ª de
 * Andamento fora a de execução, "Precisa de você" e Bloqueado, sem responsável (não aciona ninguém, nem o próprio).
 * null = não há: cai na de execução como antes, sem criar execução (o indicador vem do turno, que não está vivo).
 */
function andamentoSemExecucao(origem: readonly ColunaQuadro[], status: IdColuna, destino: readonly ColunaQuadro[]): IdColuna | null {
  const execucao = colunaDeAndamento(destino);
  const candidatas = destino.filter((c) => c.grupo === "iniciado" && c.id !== execucao && c.id !== "voce" && c.id !== "bloqueado" && !c.responsavel);
  const nome = origem.find((c) => c.id === status)?.nome;
  const mesmoNome = nome === undefined ? undefined : candidatas.find((c) => normalizarNome(c.nome) === normalizarNome(nome));
  return (mesmoNome ?? candidatas[0])?.id ?? null;
}
