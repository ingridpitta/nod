import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { pedirABot } from "../../src/use-cases/pedir-a-bot.ts";
import { criarTrabalho, sincronizarTrabalho, trabalhosParaDto } from "../../src/use-cases/trabalhos.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";
import { comoPedidoDeAntes, tarefaDoPedido } from "../helpers/pedido.ts";

/**
 * Tempo da task (protótipo "Nod — tempo da task", aprovado em 2026-10-08): o TrabalhoDto traz quem a task espera (o pedido
 * a colega mais antigo sem volta) e quanto os turnos de fato trabalharam (Raio-X: começo → último sinal).
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };

describeIntegracao("tempo da task (2026-10-08)", () => {
  it("esperando o colega até a task dele acabar; o tempo trabalhado soma os turnos com Raio-X", async () => {
    await withRollback(MARLON, async (trx) => {
      const ada = await agenteComConversa(trx, MARLON, { nome: "Ada" });
      const dev = await agenteComConversa(trx, MARLON, { nome: "Dev" });
      const { deps, repos } = depsSobre(trx, MARLON);
      for (const a of [ada, dev]) await repos.agentes.atualizarPerfil(a.agenteId, { confirmado: true });
      const w = (await criarTrabalho(deps, { agenteId: ada.agenteId, conversaId: ada.conversaId, titulo: "Resumo do time", origem: "pessoa" })).trabalho;
      const t = await repos.turnos.enfileirar({ executor: "catcher", conversaId: ada.conversaId, agenteId: ada.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "faça", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", trabalhoId: w.id });
      if (!t) throw new Error("turno");
      await repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() });
      const { data } = await pedirABot(deps, { turnoId: t.id, agenteId: ada.agenteId, conversaId: ada.conversaId, agente: "Dev", pedido: "revise o PR 42" });
      // ADR-099 (I7 revista): o pedido de antes (task de colega), que ainda existe em produção e é o que tem task a mostrar.
      await comoPedidoDeAntes(trx, deps, data);
      await repos.turnos.assentar(t.id, { estado: "concluido" });
      // 21 min de trabalho no turno da Ada (o Raio-X guarda o começo e o último sinal).
      await trx`insert into turno_raio_x (tenant_id, owner_id, turno_id, composicao, criado_em, atualizado_em)
        values (${MARLON.tenantId}, ${MARLON.pessoaId}, ${t.id}, '{}'::jsonb, now() - interval '30 minutes', now() - interval '9 minutes')`;
      await sincronizarTrabalho(deps, w.id);

      const [dto] = await trabalhosParaDto(deps, [(await repos.trabalhos.buscar(w.id))!]);
      expect(dto?.estado).toBe("rodando");
      expect(dto?.turnoVivoId).toBeNull();
      const tarefa = await repos.turnos.buscar(tarefaDoPedido(data));
      expect(dto?.esperandoColega).toMatchObject({ nome: "Dev", trabalhoId: tarefa?.trabalhoId });
      expect(Math.round((dto?.trabalhouMs ?? 0) / 60_000)).toBe(21);

      // A task do Dev falhou: a Ada não espera mais ninguém (o varredor da ADR-084 a avisa).
      await repos.turnos.interromper(tarefaDoPedido(data), "trabalho_incompleto");
      await sincronizarTrabalho(deps, tarefa!.trabalhoId!);
      const [depois] = await trabalhosParaDto(deps, [(await repos.trabalhos.buscar(w.id))!]);
      expect(depois?.esperandoColega).toBeNull();
    });
  });
});
