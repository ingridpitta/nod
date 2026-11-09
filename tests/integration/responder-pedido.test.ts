import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { Tx } from "../../src/shared/types.ts";
import { chamarFerramenta } from "../../src/use-cases/chamar-ferramenta.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { entregarRespostaPeer } from "../../src/use-cases/entregar-resposta-peer.ts";
import { pedirABot } from "../../src/use-cases/pedir-a-bot.ts";
import { cuidarDosPedidosParados } from "../../src/use-cases/pedidos-parados.ts";
import { responderPedido } from "../../src/use-cases/responder-pedido.ts";
import { contexto, depsSobre } from "../helpers/deps-l7.ts";
import { useCasesDeTeste } from "../helpers/deps-l6.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { tarefaDoPedido } from "../helpers/pedido.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-262 (emenda à ADR-047): a Vera pede algo ao Tuca; o pedido fica na fila do Tuca (turno `delegacao` pendente). A
 * pessoa resolve o assunto com o Tuca na conversa dele, e ele fecha o pedido dali com responder_pedido: a resposta vai à
 * Vera pelo caminho de sempre e o turno do pedido sai da fila como absorvido, sem rodar de novo.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const AGORA = Date.parse("2026-10-15T15:00:00Z");

async function montar(trx: Tx, o: { confiancaTuca?: "confiavel" | "nao_confiavel" } = {}) {
  const vera = await agenteComConversa(trx, MARLON, { nome: "Vera" });
  const tuca = await agenteComConversa(trx, MARLON, { nome: "Tuca" });
  const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
  for (const a of [vera, tuca]) await repos.agentes.atualizarPerfil(a.agenteId, { confirmado: true });
  const turnoVera = await repos.turnos.enfileirar({ executor: "catcher", conversaId: vera.conversaId, agenteId: vera.agenteId, origem: "conversa", prazoEm: AGORA + 600_000, profundidade: 0, entradaTexto: "pergunte ao Tuca o status do PR 42", entradaConfianca: "confiavel", modelo: "m" });
  const r = await pedirABot(deps, { ...contexto(vera.agenteId, vera.conversaId, turnoVera!.id), agente: "Tuca", pedido: "qual o status do PR 42?" });
  const tarefaId = tarefaDoPedido(r.data);
  // A pessoa fala com o Tuca na conversa dele, antes de o turno do pedido rodar.
  const turnoTuca = await repos.turnos.enfileirar({ executor: "catcher", conversaId: tuca.conversaId, agenteId: tuca.agenteId, origem: "conversa", prazoEm: AGORA + 600_000, profundidade: 0, entradaTexto: "Tuca, o PR 42 já foi aprovado, avisa a Vera", entradaConfianca: o.confiancaTuca ?? "confiavel", modelo: "m" });
  return { vera, tuca, deps, repos, turnoVera: turnoVera!, turnoTuca: turnoTuca!, tarefaId };
}

describeIntegracao("responder_pedido (NOD-262): o bot fecha da conversa o pedido de colega que já resolveu", () => {
  it("CA1: a peer_ask chega à Vera, o pedido sai da fila como absorvido pelo turno da conversa e a continuação da Vera segue; a segunda chamada é recusada", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      expect((await m.repos.turnos.delegacoesPendentesDoAgente(m.tuca.agenteId)).map((t) => t.id)).toEqual([m.tarefaId]);

      const r = await responderPedido(m.deps, { ...contexto(m.tuca.agenteId, m.tuca.conversaId, m.turnoTuca.id), tarefa_id: m.tarefaId, texto: "PR 42 aprovado; falta o merge." });
      expect(r.data).toMatchObject({ ok: true });
      expect(r.events?.map((e) => e.kind)).toContain("turno_interrompido");

      expect(await m.repos.turnos.buscar(m.tarefaId)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "absorvido", absorvidoPor: m.turnoTuca.id });
      expect(await m.repos.turnos.delegacoesPendentesDoAgente(m.tuca.agenteId)).toEqual([]);
      const askDaVera = (await m.repos.mensagens.listarDaConversa(m.vera.conversaId)).filter((x) => x.kind === "peer_ask");
      expect(askDaVera).toHaveLength(1);
      expect(askDaVera[0]).toMatchObject({ texto: expect.stringContaining("PR 42 aprovado; falta o merge."), payload: { kind: "peer_ask", agenteId: m.tuca.agenteId, tarefaId: m.tarefaId, delegada: true } });
      const continuacao = (await m.repos.turnos.listarDaConversa(m.vera.conversaId)).find((t) => t.origem === "retomada");
      expect(continuacao).toMatchObject({ agenteId: m.vera.agenteId, retomaTurnoId: m.turnoVera.id, estado: "pendente" });

      // De novo: o pedido já saiu da fila — nada muda.
      const outra = await responderPedido(m.deps, { ...contexto(m.tuca.agenteId, m.tuca.conversaId, m.turnoTuca.id), tarefa_id: m.tarefaId, texto: "de novo" });
      expect(outra.data).toMatchObject({ ok: false, erro: "ja_em_andamento" });
      expect((await m.repos.mensagens.listarDaConversa(m.vera.conversaId)).filter((x) => x.kind === "peer_ask")).toHaveLength(1);
    });
  });

  it("CA4: o plano da conversa do Tuca lista o pedido da Vera e traz responder_pedido; chamada pelo despacho, fecha o pedido, e o plano seguinte já não tem nem linha nem ferramenta", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const plano = (await emitirPlanoTurno(m.deps, { turnoId: m.turnoTuca.id, machineId: randomUUID(), executor: "catcher" })).data;
      expect(plano.catalogo.ferramentas.map((f) => f.nome)).toContain("responder_pedido");
      expect(plano.promptSistema).toContain(`"tarefa_id":"${m.tarefaId}","de":"Vera","pedido":"qual o status do PR 42?"`);
      // O turno do próprio pedido (delegação) não ganha a ferramenta.
      const planoDoPedido = (await emitirPlanoTurno(m.deps, { turnoId: m.tarefaId, machineId: randomUUID(), executor: "catcher" })).data;
      expect(planoDoPedido.catalogo.ferramentas.map((f) => f.nome)).not.toContain("responder_pedido");
      await trx`update turnos set estado = 'pendente', machine_id = null, lease_ate = null where id = ${m.tarefaId}`;

      const r = await chamarFerramenta({ ...m.deps, useCases: useCasesDeTeste() }, { turnoId: m.turnoTuca.id, agenteId: m.tuca.agenteId, nome: "responder_pedido", argumentos: { tarefa_id: m.tarefaId, texto: "PR 42 aprovado." }, plano });
      expect(r.data).toMatchObject({ ok: true });
      const seguinte = await m.repos.turnos.enfileirar({ executor: "catcher", conversaId: m.tuca.conversaId, agenteId: m.tuca.agenteId, origem: "conversa", prazoEm: AGORA + 600_000, profundidade: 0, entradaTexto: "valeu", entradaConfianca: "confiavel", modelo: "m" });
      const planoSeguinte = (await emitirPlanoTurno(m.deps, { turnoId: seguinte!.id, machineId: randomUUID(), executor: "catcher" })).data;
      expect(planoSeguinte.catalogo.ferramentas.map((f) => f.nome)).not.toContain("responder_pedido");
      expect(planoSeguinte.promptSistema).not.toContain("Pedidos de colegas para você");
    });
  });

  it("CA2: sem responder_pedido, o pedido segue pendente na fila e é entregue pelo turno dele, como sempre", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      expect(await m.repos.turnos.buscar(m.tarefaId)).toMatchObject({ estado: "pendente", absorvidoPor: null });
      const entrega = await entregarRespostaPeer(m.deps, { tarefaId: m.tarefaId, texto: "PR 42 aprovado." });
      expect("mensagem" in entrega.data).toBe(true);
    });
  });

  it("CA3: tarefa de outro bot, pedido já rodando e turno que não é a conversa com a pessoa são recusados sem gravar nada", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const estadoDe = async () => ({ tarefa: await m.repos.turnos.buscar(m.tarefaId), msgsVera: (await m.repos.mensagens.listarDaConversa(m.vera.conversaId)).length, turnosVera: (await m.repos.turnos.listarDaConversa(m.vera.conversaId)).length });
      const antes = await estadoDe();

      // A Vera, na conversa dela, tenta fechar um pedido que é do Tuca.
      expect((await responderPedido(m.deps, { ...contexto(m.vera.agenteId, m.vera.conversaId, m.turnoVera.id), tarefa_id: m.tarefaId, texto: "x" })).data).toMatchObject({ ok: false, erro: "pedido_nao_encontrado" });
      // O turno de um bot não serve a outro: o Tuca não chama pelo turno da Vera.
      expect((await responderPedido(m.deps, { ...contexto(m.tuca.agenteId, m.tuca.conversaId, m.turnoVera.id), tarefa_id: m.tarefaId, texto: "x" })).data).toMatchObject({ ok: false, erro: "fora_da_conversa" });
      // Um tarefa_id que não é delegação.
      expect((await responderPedido(m.deps, { ...contexto(m.tuca.agenteId, m.tuca.conversaId, m.turnoTuca.id), tarefa_id: m.turnoTuca.id, texto: "x" })).data).toMatchObject({ ok: false, erro: "pedido_nao_encontrado" });
      // O próprio turno do pedido não usa a ferramenta: ele responde ao assentar.
      expect((await responderPedido(m.deps, { ...contexto(m.tuca.agenteId, m.tuca.conversaId, m.tarefaId), tarefa_id: m.tarefaId, texto: "x" })).data).toMatchObject({ ok: false, erro: "fora_da_conversa" });
      expect(await estadoDe()).toEqual(antes);

      // O pedido já está rodando.
      await trx`update turnos set estado = 'despachando', lease_ate = now() + interval '5 minutes' where id = ${m.tarefaId}`;
      expect((await responderPedido(m.deps, { ...contexto(m.tuca.agenteId, m.tuca.conversaId, m.turnoTuca.id), tarefa_id: m.tarefaId, texto: "x" })).data).toMatchObject({ ok: false, erro: "ja_em_andamento" });
      expect((await m.repos.turnos.buscar(m.tarefaId))?.estado).toBe("despachando");
      expect((await m.repos.mensagens.listarDaConversa(m.vera.conversaId)).filter((x) => x.kind === "peer_ask")).toEqual([]);
    });
  });

  it("CA5: o varredor de pedidos parados não retoma nem avisa o pedido fechado pela conversa", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      expect((await responderPedido(m.deps, { ...contexto(m.tuca.agenteId, m.tuca.conversaId, m.turnoTuca.id), tarefa_id: m.tarefaId, texto: "PR 42 aprovado." })).data).toMatchObject({ ok: true });
      // Sem a marca, a conversa confiável não contamina a continuação.
      const continuacao = (await m.repos.turnos.listarDaConversa(m.vera.conversaId)).find((t) => t.origem === "retomada");
      expect(await m.repos.turnos.contaminado(continuacao!.id)).toBe(false);
      const { deps: depois } = depsSobre(trx, MARLON, { agora: () => AGORA + 3 * 3_600_000 });
      const r = await cuidarDosPedidosParados(depois);
      expect([...r.data.retomados, ...r.data.avisados, ...r.data.entregues]).not.toContain(m.tarefaId);
      expect((await m.repos.mensagens.listarDaConversa(m.vera.conversaId)).filter((x) => x.kind === "peer_ask")).toHaveLength(1);
      expect((await m.repos.turnos.buscar(m.tarefaId))?.estado).toBe("interrompido");
    });
  });

  it("ADR-062: a conversa que leu conteúdo de fora passa a marca à continuação de quem pediu", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx, { confiancaTuca: "nao_confiavel" });
      expect((await responderPedido(m.deps, { ...contexto(m.tuca.agenteId, m.tuca.conversaId, m.turnoTuca.id), tarefa_id: m.tarefaId, texto: "PR 42 aprovado." })).data).toMatchObject({ ok: true });
      const continuacao = (await m.repos.turnos.listarDaConversa(m.vera.conversaId)).find((t) => t.origem === "retomada");
      expect(await m.repos.turnos.contaminado(continuacao!.id)).toBe(true);
    });
  });
});
