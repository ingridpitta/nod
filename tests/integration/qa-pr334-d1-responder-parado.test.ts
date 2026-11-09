import { expect, it } from "vitest";
import type { Tx } from "../../src/shared/types.ts";
import { entregarRespostaPeer } from "../../src/use-cases/entregar-resposta-peer.ts";
import { pedirABot } from "../../src/use-cases/pedir-a-bot.ts";
import { responderPedido } from "../../src/use-cases/responder-pedido.ts";
import { contexto, depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { tarefaDoPedido } from "../helpers/pedido.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * QA do PR #334 (Teodora, 2026-10-16): NOD-256 F1.1 x NOD-262 (responder_pedido, veio da main no merge 5c2815b).
 * A Vera pediu algo ao Tuca e depois foi parada pela pessoa (o turno que pediu termina `parado_pela_pessoa`), mas o
 * pedido ainda está pendente na fila do Tuca. A pessoa resolve o assunto com o Tuca e ele fecha com responder_pedido.
 * Esperado (CA1 da NOD-256): a resposta fica registrada como peer_ask na Vera, sem continuação, e o pedido sai da fila.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const AGORA = Date.parse("2026-10-16T05:00:00Z");

async function montar(trx: Tx) {
  const vera = await agenteComConversa(trx, MARLON, { nome: "Vera" });
  const tuca = await agenteComConversa(trx, MARLON, { nome: "Tuca" });
  const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
  for (const a of [vera, tuca]) await repos.agentes.atualizarPerfil(a.agenteId, { confirmado: true });
  const turnoVera = (await repos.turnos.enfileirar({ executor: "catcher", conversaId: vera.conversaId, agenteId: vera.agenteId, origem: "conversa", prazoEm: AGORA + 600_000, profundidade: 0, entradaTexto: "pergunte ao Tuca o status do PR 42", entradaConfianca: "confiavel", modelo: "m" }))!;
  const r = await pedirABot(deps, { ...contexto(vera.agenteId, vera.conversaId, turnoVera.id), agente: "Tuca", pedido: "qual o status do PR 42?" });
  const tarefaId = tarefaDoPedido(r.data);
  const turnoTuca = (await repos.turnos.enfileirar({ executor: "catcher", conversaId: tuca.conversaId, agenteId: tuca.agenteId, origem: "conversa", prazoEm: AGORA + 600_000, profundidade: 0, entradaTexto: "Tuca, o PR 42 já foi aprovado, avisa a Vera", entradaConfianca: "confiavel", modelo: "m" }))!;
  // A Vera foi parada pela pessoa depois de pedir (como no CA1 de tests/integration/parar-delegacoes.test.ts).
  await trx`update turnos set estado = 'interrompido', motivo_interrupcao = 'parado_pela_pessoa' where id = ${turnoVera.id}`;
  return { vera, tuca, deps, repos, turnoVera, turnoTuca, tarefaId };
}

describeIntegracao("QA PR #334: responder_pedido para quem foi parado", () => {
  it("controle: pelo caminho do turno do pedido, a resposta vira peer_ask sem continuação (quem_pediu_parado)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const r = await entregarRespostaPeer(m.deps, { tarefaId: m.tarefaId, texto: "PR 42 aprovado." });
      expect(r.data).toEqual({ ignorado: "quem_pediu_parado" });
      expect((await m.repos.mensagens.listarDaConversa(m.vera.conversaId)).filter((x) => x.kind === "peer_ask")).toHaveLength(1);
    });
  });

  it("responder_pedido: a resposta é registrada na Vera, sem continuação, e o pedido sai da fila do Tuca", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const r = await responderPedido(m.deps, { ...contexto(m.tuca.agenteId, m.tuca.conversaId, m.turnoTuca.id), tarefa_id: m.tarefaId, texto: "PR 42 aprovado; falta o merge." });
      const asks = (await m.repos.mensagens.listarDaConversa(m.vera.conversaId)).filter((x) => x.kind === "peer_ask");
      const pedido = await m.repos.turnos.buscar(m.tarefaId);
      expect(r.data).toMatchObject({ ok: true });
      expect(asks).toHaveLength(1);
      // A tela da Vera só vê a peer_ask pelo evento: o caso de uso tem de repassar o da entrega.
      expect(r.events?.some((e) => e.kind === "mensagem_criada" && e.conversaId === m.vera.conversaId)).toBe(true);
      expect(pedido).toMatchObject({ estado: "interrompido", motivoInterrupcao: "absorvido" });
      expect((await m.repos.turnos.listarDaConversa(m.vera.conversaId)).filter((t) => t.origem === "retomada")).toEqual([]);
    });
  });
});
