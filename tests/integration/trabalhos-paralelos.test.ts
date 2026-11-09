import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { dispararRotina } from "../../src/use-cases/disparar-rotina.ts";
import { entregarRespostaPeer } from "../../src/use-cases/entregar-resposta-peer.ts";
import { pedirABot } from "../../src/use-cases/pedir-a-bot.ts";
import { criarTrabalho } from "../../src/use-cases/trabalhos.ts";
import { contexto, depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";
import { tarefaDoPedido } from "../helpers/pedido.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const JANELA = Date.parse("2026-10-07T08:00:00-03:00");
const AGORA = JANELA + 60_000;

describeIntegracao("trabalhos em paralelo pelos casos de uso de verdade (#192, critério 1; S7)", () => {
  it("um bot com uma rotina, um pedido de colega e uma task da pessoa: a task roda em paralelo; rotina e pedido entram nos bastidores do dono, e a fala da pessoa não espera a rotina (ADR-099, ADR-130)", async () => {
    await withRollback(MARLON, async (trx) => {
      const dev = await agenteComConversa(trx, MARLON, { nome: "Dev" });
      const chico = await agenteComConversa(trx, MARLON, { nome: "Chico" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });

      const rotina = await repos.rotinas.criar({ agenteId: dev.agenteId, conversaId: dev.conversaId, cron: "0 8 * * *", fusoIana: "America/Sao_Paulo", instrucao: "Triagem do Slack", fonte: "Slack", entregavel: "resumo", limitesAprovacao: "nada", politicaSemDado: "silêncio", proximaExecucao: JANELA });
      const disparo = await dispararRotina(deps, { rotina: rotina!, instanteAgendado: JANELA, machineId: randomUUID(), executor: "catcher" });
      if (!("turno" in disparo.data)) throw new Error("rotina sem turno");

      const turnoChico = await repos.turnos.enfileirar({ executor: "catcher", conversaId: chico.conversaId, agenteId: chico.agenteId, origem: "conversa", prazoEm: AGORA + 1, profundidade: 0, entradaTexto: "peça ao Dev", entradaConfianca: "confiavel", modelo: "m" });
      // O turno do Chico já rodou (é dele o pedido); só a fila do Dev interessa aqui.
      await repos.turnos.assentar(turnoChico!.id, { estado: "concluido" });
      const pedido = await pedirABot(deps, { ...contexto(chico.agenteId, chico.conversaId, turnoChico?.id), agente: "Dev", pedido: "Revise o PR 481" });

      const daPessoa = (await criarTrabalho(deps, { agenteId: dev.agenteId, conversaId: dev.conversaId, titulo: "Dashboard de churn", origem: "pessoa" })).trabalho;
      await repos.turnos.enfileirar({ executor: "catcher", conversaId: dev.conversaId, agenteId: dev.agenteId, origem: "conversa", trabalhoId: daPessoa.id, prazoEm: AGORA + 1, profundidade: 0, entradaTexto: "monte o dashboard", entradaConfianca: "confiavel", modelo: "m" });

      // revisto em 2026-10-12 (ADR-099, I7 revista): a rotina e o pedido de colega entram na fila do dono (a conversa do
      // Dev, sem trabalho) — eram tasks paralelas (S7). A task da pessoa segue em paralelo; na fila do dono, um por vez.
      const primeiro = await repos.turnos.reivindicar({ machineId: randomUUID(), agora: AGORA });
      const segundo = await repos.turnos.reivindicar({ machineId: randomUUID(), agora: AGORA });
      expect(primeiro).toMatchObject({ agenteId: dev.agenteId, origem: "conversa", trabalhoId: daPessoa.id });
      expect(segundo).toMatchObject({ agenteId: dev.agenteId, origem: "rotina", trabalhoId: null, id: disparo.data.turno.id });
      expect(await repos.turnos.reivindicar({ machineId: randomUUID(), agora: AGORA })).toBeNull();
      expect(await repos.trabalhos.abertosDoAgente(dev.agenteId)).toMatchObject([{ id: daPessoa.id }]);

      // revisto em 2026-10-26 (ADR-130): a pessoa escreve enquanto a triagem da rotina roda e a fala dela sai na hora (a
      // faixa da pessoa); o pedido do Chico fica nos bastidores, atrás da rotina, até ela acabar.
      const fala = await repos.turnos.enfileirar({ executor: "catcher", conversaId: dev.conversaId, agenteId: dev.agenteId, origem: "conversa", prazoEm: AGORA + 1, profundidade: 0, entradaTexto: "e aí, como vai?", entradaConfianca: "confiavel", modelo: "m" });
      expect((await repos.turnos.reivindicar({ machineId: randomUUID(), agora: AGORA }))?.id).toBe(fala?.id);
      expect(await repos.turnos.reivindicar({ machineId: randomUUID(), agora: AGORA })).toBeNull();
      await repos.turnos.assentar(fala!.id, { estado: "concluido" });
      expect(await repos.turnos.reivindicar({ machineId: randomUUID(), agora: AGORA })).toBeNull();
      await repos.turnos.assentar(segundo!.id, { estado: "concluido" });
      const tarefa = await repos.turnos.buscar(tarefaDoPedido(pedido.data));
      expect((await repos.turnos.reivindicar({ machineId: randomUUID(), agora: AGORA }))?.id).toBe(tarefa?.id);

      // Quem pediu recebe a resposta numa continuação que segue no trabalho DELE (aqui, a conversa: null); a triagem
      // respondeu direto, sem task por trás.
      await repos.turnos.assentar(tarefa!.id, { estado: "concluido" });
      const entrega = await entregarRespostaPeer(deps, { tarefaId: tarefa!.id, texto: "Revisei: dois comentários." });
      if (!("mensagem" in entrega.data)) throw new Error("sem entrega");
      expect(entrega.data.continuacao.trabalhoId).toBeNull();
      expect(entrega.data.mensagem.payload).toMatchObject({ kind: "peer_ask", tarefaId: tarefa!.id });
      expect(entrega.data.mensagem.payload).not.toHaveProperty("trabalhoId");
    });
  });
});
