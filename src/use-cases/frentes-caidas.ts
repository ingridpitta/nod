import type { RuntimeEvent } from "../contracts/evento.ts";
import { decidirFrenteCaida, RETOMAR_ATE_MS, type PedidoParado } from "../domain/pedido-parado.ts";
import { motivoEmPortugues } from "../domain/redacao.ts";
import { log } from "../obs/log.ts";
import { autoriaAgente, evento } from "./autoria-evento.ts";
import { ADIAR_PEDIDO_IGNORADO_MS, JANELA_PEDIDOS_PARADOS_MS, retomar, type PedidosAdiados } from "./pedidos-parados.ts";
import type { Deps } from "./tipos.ts";
import { sincronizarTrabalho } from "./trabalhos.ts";

/** A regra que fecha o "Retomar" da frente quando o varredor desiste dela (ADR-099, I9). */
export const REGRA_FRENTE_CAIU = "regra:frente_caiu" as const;

export type SaidaFrentesCaidas = { retomadas: string[]; fechadas: string[] };

/**
 * Desiste da frente (definido em 2026-10-12, ADR-099 item 5, I9): o "Retomar" aberto fecha por regra e a frente relê os
 * fatos — sem decisão pendente e com o último turno interrompido, ela fica `falhou`, e a sincronização fecha o lote dela
 * (I3, fechar-lote.ts): o dono acorda na hora com o motivo e pergunta à pessoa como seguir (PERGUNTA_DA_QUEDA). Lote de
 * colega: a resposta a quem pediu sai quando a última frente acabar, com o motivo desta.
 */
async function desistir(deps: Deps, p: PedidoParado): Promise<RuntimeEvent[]> {
  const agora = deps.agora();
  const events: RuntimeEvent[] = [];
  if (p.cardRetomar?.aberto) {
    const fechada = await deps.repos.decisoes.fecharPorRegra(p.cardRetomar.id, { regra: REGRA_FRENTE_CAIU, regraVersao: 1, agora });
    if (fechada) {
      const autoria = autoriaAgente({ agenteId: fechada.agenteId, contaDeExecucao: deps.escopo.pessoaId, executor: "catcher", decididoPor: REGRA_FRENTE_CAIU });
      events.push(evento(deps.escopo, { kind: "decisao_decidida", autoria, agora, conversaId: fechada.conversaId, turnoId: fechada.turnoId, dados: { decisao_id: fechada.id, tipo: fechada.tipo, regra: REGRA_FRENTE_CAIU } }));
    }
  }
  const mudou = await sincronizarTrabalho(deps, p.trabalhoColegaId);
  return mudou.length > 0 ? [...events, ...mudou] : [];
}

/**
 * O varredor da ADR-084 para as frentes de lote (definido em 2026-10-12, ADR-099 itens 5 e 8, I9). A cada passada do
 * varredor de expiração, numa transação própria (varredor-expiracao.ts): a frente que caiu por infraestrutura é retomada
 * sozinha quando as máquinas voltam, até MAX_QUEDAS_POR_PEDIDO (3) e só nas últimas 2 h; na desistência ela fecha
 * `falhou`, o lote fecha e o dono pergunta. A regra é a do pedido parado (decidirFrenteCaida); `adiados` como lá (#218).
 * NOD-241: sem sinal de volta, a frente espera até 2 h desde o último sinal (não 30 min). A frente em espera entra em
 * `adiados` por ADIAR_PEDIDO_IGNORADO_MS: sem isso, até 20 frentes esperando ocupariam o `limit 20` da consulta e
 * segurariam as que já podem voltar. Custo: a frente em espera percebe o sinal em até 5 min, não 30 s.
 */
export async function cuidarDasFrentesCaidas(deps: Deps, o: { adiados?: PedidosAdiados } = {}): Promise<{ data: SaidaFrentesCaidas; events: RuntimeEvent[] }> {
  const agora = deps.agora();
  const saida: SaidaFrentesCaidas = { retomadas: [], fechadas: [] };
  const events: RuntimeEvent[] = [];
  if (o.adiados) for (const [id, ate] of o.adiados) if (ate <= agora) o.adiados.delete(id);
  const caidas = await deps.repos.frentes.frentesCaidas(agora - JANELA_PEDIDOS_PARADOS_MS, agora, o.adiados ? [...o.adiados.keys()] : []);
  for (const p of caidas) {
    const acao = decidirFrenteCaida(p, agora, motivoEmPortugues);
    if (acao.tipo === "esperar") {
      // NOD-241 (revisão): o adiamento não passa do limite das 2 h; a desistência sai na hora, não até 5 min depois.
      o.adiados?.set(p.tarefaId, p.quedaEm !== null ? Math.min(agora + ADIAR_PEDIDO_IGNORADO_MS, p.quedaEm + RETOMAR_ATE_MS + 1) : agora + ADIAR_PEDIDO_IGNORADO_MS);
      continue;
    }
    let r: RuntimeEvent[];
    if (acao.tipo === "retomar") {
      const frente = p.trabalhoColegaId ? await deps.repos.trabalhos.buscar(p.trabalhoColegaId) : null;
      r = await retomar(deps, p, acao, { titulo: frente?.titulo ?? "sem título" });
      if (r.length > 0) saida.retomadas.push(p.tarefaId);
    } else {
      r = await desistir(deps, p);
      if (r.length > 0) saida.fechadas.push(p.tarefaId);
    }
    events.push(...r);
    if (r.length === 0) o.adiados?.set(p.tarefaId, agora + ADIAR_PEDIDO_IGNORADO_MS);
    log("info", "frente_caida_tratada", { trabalho_id: p.tarefaId, acao: acao.tipo, quedas: p.quedas, motivo: acao.tipo === "desistir" ? acao.motivo : null, sem_efeito: r.length === 0 });
  }
  return { data: saida, events };
}
