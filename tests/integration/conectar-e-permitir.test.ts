import { expect, it } from "vitest";
import type { CapacidadeConector } from "../../src/contracts/conector.ts";
import { aoConectarApp } from "../../src/use-cases/ao-conectar-app.ts";
import { decidirAcesso } from "../../src/use-cases/decidir-acesso.ts";
import { pedirAcesso } from "../../src/use-cases/pedir-acesso.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * ADR-049 (2026-09-25) no Postgres: o login do ClickUp termina e os cards "Conecte o ClickUp" viram, na
 * mesma transação do Verificar, cards de permitir do nível pedido (a consulta usa `payload ? 'conectar'`);
 * Permitir com um grupo desmarcado concede só o resto.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const AGORA = Date.parse("2026-09-25T10:00:00-03:00");
const cap = (nome: string, readOnlyHint: boolean): CapacidadeConector => ({ nome, descricao: nome.toLowerCase(), schema: { type: "object" }, readOnlyHint });
const CLICKUP = [cap("CLICKUP_GET_TASKS", true), cap("CLICKUP_CREATE_TASK", false), cap("CLICKUP_UPDATE_TASK", false), cap("CLICKUP_DELETE_TASK", false)];

describeIntegracao("conectar e permitir no mesmo lugar (ADR-049)", () => {
  it("login feito: o card de conexão de escrita vira o de permitir sem apagar; Permitir sem 'Editar' concede ler e criar", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Milton" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
      const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: AGORA + 60_000, profundidade: 0, entradaTexto: "cria a tarefa", entradaConfianca: "confiavel", modelo: "m" });
      if (!turno) throw new Error("turno");
      const pedido = await pedirAcesso(deps, { agenteId, conversaId, turnoId: turno.id, conector: "clickup", capacidades: [], nivel: "escrita", nao_pedido: [], para: "Criar a tarefa do contrato" });
      expect((await repos.propostas.conexoesPendentes("clickup")).map((p) => p.id)).toEqual([pedido.data.proposta_id]);
      expect(await repos.propostas.conexoesPendentes("slack")).toEqual([]);

      const clickup = await repos.conectores.criar({ nome: "ClickUp", slug: "clickup", transporte: "http", url: "https://example.com/mcp", declaracao: "nao-toca" });
      if (!clickup) throw new Error("conector");
      await repos.conectores.registrarSonda(clickup.id, { ok: true, catalogo: CLICKUP, agora: AGORA });
      await repos.conectores.habilitar(clickup.id, true);

      expect((await aoConectarApp(deps, { slug: "clickup" })).data.cards).toBe(1);
      expect(await repos.propostas.conexoesPendentes("clickup")).toEqual([]);
      const novo = (await repos.propostas.pendentesDaConversa(conversaId)).find((p) => p.payload.kind === "acesso");
      expect(novo?.payload).toMatchObject({ capacidades: ["CLICKUP_GET_TASKS", "CLICKUP_CREATE_TASK", "CLICKUP_UPDATE_TASK"], nivel: "escrita", para: "Criar a tarefa do contrato" });
      if (!novo) throw new Error("card");
      expect(await repos.decisoes.buscar(novo.id)).toMatchObject({ tipo: "acesso", estado: "pendente" });

      const r = await decidirAcesso(deps, { decisaoId: novo.id, recusar: false, executor: "catcher", capacidades: ["CLICKUP_GET_TASKS", "CLICKUP_CREATE_TASK"] });
      expect(r.data.concessoes).toBe(2);
      expect((await repos.concessoes.doAgente(agenteId)).map((c) => c.capacidade).sort()).toEqual(["CLICKUP_CREATE_TASK", "CLICKUP_GET_TASKS"]);
    });
  });
});
