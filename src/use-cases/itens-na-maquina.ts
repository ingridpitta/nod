import { randomUUID } from "node:crypto";
import type { RuntimeEvent } from "../contracts/evento.ts";
import type { DesfechoItem } from "../contracts/motivos.ts";
import { argumentosComTextoFinal, assentarAprovacao } from "./decidir.ts";
import { PRAZO_DECISAO_MS } from "./pedir-a-pessoa.ts";
import { assuntoDoReciboAutomatico, textoAutomatico } from "./pedir-aprovacao.ts";
import { autoriaDoAgente } from "./registrar-negacao.ts";
import { REGRA_CARTAO_DISPENSADO, VERSAO_REGRA_CARTAO_DISPENSADO } from "../domain/decisoes.ts";
import { REGRAS_GRAVADAS_NA_AUTORIZACAO, registrarCliques } from "./trilha-decisoes.ts";
import type { Deps } from "./tipos.ts";

/**
 * Itens aprovados que rodam no gh do Mac da dona (ADR-048, revisão de 2026-09-24). O servidor nunca
 * disca a máquina (ADR-021): o app desktop da pessoa PUXA estes itens pela ponte, executa pelo gh dele
 * e relata o desfecho. Sem coluna nova: o estado "aguardando seu Mac" é derivado (decisão decidida +
 * item marcado + `destino.execucao = 'maquina'` + desfecho nulo), e expira como as decisões expiram.
 */
export type ItemParaAMaquina = { itemId: string; capacidade: string; argumentos: Record<string, unknown> };

/**
 * definido em 2026-09-24: o Mac tem o mesmo prazo que a pessoa teve para decidir (PRAZO_DECISAO_MS,
 * 24 h), contado de quando ela decidiu. Passou disso, o item vira `falhou_na_execucao` — nunca sai
 * depois de um dia como se fosse a decisão fresca.
 */
export const PRAZO_ITEM_NA_MAQUINA_MS = PRAZO_DECISAO_MS;

export async function itensParaAMaquina(deps: Deps): Promise<ItemParaAMaquina[]> {
  const agora = deps.agora();
  return (await deps.repos.itensAprovacao.pendentesNaMaquina())
    .filter((p) => agora - p.decididaEm < PRAZO_ITEM_NA_MAQUINA_MS)
    .map((p) => ({ itemId: p.item.id, capacidade: p.item.destino.ferramenta, argumentos: argumentosComTextoFinal(p.item) }));
}

/**
 * Grava o desfecho relatado (só se o item ainda estava aberto: o relato repetido não sobrescreve) e,
 * quando a decisão inteira terminou, fecha como fecharia no servidor: decisão da PESSOA → mensagem de
 * resultado + turno de retomada (assentarAprovacao); decisão por REGRA ("Sempre permitir", o turno
 * esperava no long-poll) → a fala "Fiz sem perguntar", sem retomada.
 */
export async function concluirItemNaMaquina(deps: Deps, input: { itemId: string; desfecho: Extract<DesfechoItem, "executado" | "falhou_na_execucao"> }): Promise<{ events: RuntimeEvent[] }> {
  const pendente = (await deps.repos.itensAprovacao.pendentesNaMaquina()).find((p) => p.item.id === input.itemId);
  if (!pendente) return { events: [] };
  const gravado = await deps.repos.itensAprovacao.registrarDesfechoSeAberto(input.itemId, input.desfecho);
  if (!gravado) return { events: [] };
  await registrarNaTrilha(deps, pendente.item.decisaoId, pendente.item.destino, input.desfecho);
  return fecharSeTerminou(deps, pendente.item.decisaoId, pendente.porRegra);
}

/**
 * NOD-70: o item do gh do Mac vai à trilha aqui, uma vez, quando ESTE relato (ou o varredor) gravou o desfecho.
 * - Decidido pela PESSOA: o clique, rodando, falhando ou vencendo (a trilha registra a autorização).
 * - Decidido por regra de lote (automático, revisor…): nada, já foi na autorização (registrarAutorizadosNaMaquina).
 * - Sem autorização (card parado ou dispensado que o Mac ainda roda, NOD-423): só o que o Mac relatou EXECUTADO, com a
 *   regra de quem fechou o card — nunca como clique.
 */
async function registrarNaTrilha(deps: Deps, decisaoId: string, destino: ItemDaMaquina["destino"], desfecho: DesfechoItem): Promise<void> {
  const decisao = await deps.repos.decisoes.buscar(decisaoId);
  if (!decisao?.desfecho) return;
  const d = decisao.desfecho;
  // Revisão 7: só as regras de lote já gravaram na autorização; o card fechado por outra (o Parar do trabalho) grava aqui.
  if (d.tipo === "decidida_por_regra" && REGRAS_GRAVADAS_NA_AUTORIZACAO.has(d.regra)) return;
  // A pessoa aprovou: o clique vale como autorização, rodando ou vencendo no Mac (a trilha registra a autorização).
  if (d.tipo === "decidida") return registrarCliques(deps, { agenteId: decisao.agenteId, turnoId: decisao.turnoId, itens: [{ destino, desfecho }] });
  // Revisões 9 e 10: sem autorização, a linha só existe porque o efeito saiu. O item que venceu, ou que o Mac relatou como
  // falha (o gh pode nem ter rodado), não é "Permitida". Revisão 8: nunca como clique; leva a regra de quem fechou o card.
  if (desfecho !== "executado") return;
  const quem = d.tipo === "decidida_por_regra" ? d : d.tipo === "dispensada" ? { regra: REGRA_CARTAO_DISPENSADO, regraVersao: VERSAO_REGRA_CARTAO_DISPENSADO } : null;
  if (!quem) return;
  await registrarCliques(deps, { agenteId: decisao.agenteId, turnoId: decisao.turnoId, itens: [{ destino, desfecho }] }, quem);
}

type ItemDaMaquina = Awaited<ReturnType<Deps["repos"]["itensAprovacao"]["pendentesNaMaquina"]>>[number]["item"];

async function fecharSeTerminou(deps: Deps, decisaoId: string, porRegra: boolean): Promise<{ events: RuntimeEvent[] }> {
  const itens = await deps.repos.itensAprovacao.listar(decisaoId);
  if (itens.some((i) => i.selecionado && i.desfecho === null && i.destino.execucao === "maquina")) return { events: [] };
  if (!porRegra) return { events: (await assentarAprovacao(deps, { decisaoId, desfechos: [] })).events ?? [] };
  const decisao = await deps.repos.decisoes.buscar(decisaoId);
  if (!decisao) return { events: [] };
  const agora = deps.agora();
  const autoria = autoriaDoAgente(deps.escopo, decisao.agenteId);
  const desfechos = itens.map((i) => ({ itemId: i.id, desfecho: i.desfecho ?? "falhou_na_execucao" }));
  const mensagem = await deps.repos.mensagens.criar({ conversaId: decisao.conversaId, turnoId: decisao.turnoId, kind: "resultado_aprovacao", assunto: assuntoDoReciboAutomatico(itens, desfechos), texto: textoAutomatico(itens, desfechos, decisao.desfecho?.tipo === "decidida_por_regra" ? decisao.desfecho.regra : undefined), confianca: "confiavel", autoria });
  return {
    events: [{ tenantId: deps.escopo.tenantId, id: randomUUID(), createdAt: agora, kind: "mensagem_criada", autoria, pessoaDestinoId: deps.escopo.pessoaId, conversaId: decisao.conversaId, turnoId: decisao.turnoId, dados: { decisao_id: decisao.id, mensagem_id: mensagem?.id ?? null, itens: itens.length, executados: itens.filter((i) => i.desfecho === "executado").length } }],
  };
}

/** Varredor (a cada volta, por pessoa): item que o Mac não buscou no prazo vira falha e a decisão fecha. */
export async function expirarItensNaMaquina(deps: Deps): Promise<{ expirados: number; events: RuntimeEvent[] }> {
  const agora = deps.agora();
  const vencidos = (await deps.repos.itensAprovacao.pendentesNaMaquina()).filter((p) => agora - p.decididaEm >= PRAZO_ITEM_NA_MAQUINA_MS);
  const events: RuntimeEvent[] = [];
  const fechar = new Map<string, boolean>();
  for (const v of vencidos) {
    if (!(await deps.repos.itensAprovacao.registrarDesfechoSeAberto(v.item.id, "falhou_na_execucao"))) continue;
    await registrarNaTrilha(deps, v.item.decisaoId, v.item.destino, "falhou_na_execucao");
    fechar.set(v.item.decisaoId, v.porRegra);
  }
  for (const [decisaoId, porRegra] of fechar) events.push(...(await fecharSeTerminou(deps, decisaoId, porRegra)).events);
  return { expirados: vencidos.length, events };
}
