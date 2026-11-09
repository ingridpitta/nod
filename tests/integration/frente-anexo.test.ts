import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { abrirFrentes, mandarParaFrente } from "../../src/use-cases/frentes.ts";
import { pedirABot } from "../../src/use-cases/pedir-a-bot.ts";
import { contexto, depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { tarefaDoPedido } from "../helpers/pedido.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-285 (critério 6, decidido em 15/10): a frente é o próprio bot, então herda o arquivo da fala de origem (ao abrir e
 * no recado repassado). O pedido a colega não herda: outro bot, outros acessos (ADR-058).
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const AGORA = Date.parse("2026-10-15T15:00:00Z");

describeIntegracao("o anexo vai para a frente e não para o colega (NOD-285)", () => {
  it("abrir_frentes e mandar_para_frente levam entradaAnexos; pedir_a_bot não", async () => {
    await withRollback(MARLON, async (trx) => {
      const ada = await agenteComConversa(trx, MARLON, { nome: "Ada" });
      await agenteComConversa(trx, MARLON, { nome: "Gil" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
      const anexos = [randomUUID()];
      const dono = (await repos.turnos.enfileirar({ executor: "catcher", conversaId: ada.conversaId, agenteId: ada.agenteId, origem: "conversa", prazoEm: AGORA + 600_000, profundidade: 0, entradaTexto: "corrige o que está no print", entradaConfianca: "confiavel", modelo: "m", entradaAnexos: anexos }))!;
      const ctx = { turnoId: dono.id, agenteId: ada.agenteId, conversaId: ada.conversaId };

      const r = await abrirFrentes(deps, { ...ctx, frentes: [{ titulo: "Corrigir", pedido: "Corrija o erro do print." }] });
      if (!r.data.ok) throw new Error(`deveria abrir: ${r.data.instrucao}`);
      const frenteId = r.data.frentes[0]!.trabalho_id;
      expect((await repos.turnos.doTrabalho(frenteId))[0]?.entradaAnexos).toEqual(anexos);

      await mandarParaFrente(deps, { ...ctx, trabalho_id: frenteId, texto: "olha esse print também" });
      expect((await repos.turnos.doTrabalho(frenteId)).at(-1)?.entradaAnexos).toEqual(anexos);

      const pedido = await pedirABot(deps, { ...contexto(ada.agenteId, ada.conversaId, dono.id), agente: "Gil", pedido: "revisa o design do print" });
      expect((await repos.turnos.buscar(tarefaDoPedido(pedido.data)))?.entradaAnexos).toEqual([]);
    });
  });
});
