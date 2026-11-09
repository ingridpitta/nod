import { expect, it } from "vitest";
import { pedirAcesso } from "../../../src/use-cases/pedir-acesso.ts";
import { confirmarProposta } from "../../../src/use-cases/confirmar-proposta.ts";
import { criarAgente } from "../../../src/use-cases/criar-agente.ts";
import { depsEmMemoria } from "../../helpers/deps-l6.ts";

it("pedido tipado de app ausente cria card de conexão sem inventar capacidades ou conceder acesso", async () => {
  const { deps, banco } = depsEmMemoria();
  const { data: bot } = await criarAgente(deps, { dono: "pessoa", interativo: true });
  const ctx = { agenteId: bot.agente.id, conversaId: bot.conversa.id, turnoId: "turno" };
  const r = await pedirAcesso(deps, { ...ctx, conector: "slack", capacidades: [], nivel: "escrita", nao_pedido: ["apagar mensagens"] });
  expect(banco.propostas[0]?.payload).toMatchObject({ kind: "acesso", conector: "slack", conectar: true, capacidades: [] });
  expect(banco.concessoes).toHaveLength(0);
  await expect(confirmarProposta(deps, { propostaId: r.data.proposta_id })).rejects.toMatchObject({ codigo: "estado_invalido" });
  expect(banco.propostas[0]?.estado).toBe("pendente");
  await expect(pedirAcesso(deps, { ...ctx, conector: "inventado", capacidades: [], nivel: "leitura", nao_pedido: [] })).rejects.toMatchObject({ codigo: "entrada_invalida" });
});

// revisão do PR #68: com [] as capacidades são iguais; sem comparar o nível, a escrita virava o card de leitura.
it("no mesmo turno, pedido de leitura e depois de escrita do mesmo app viram DOIS cards", async () => {
  const { deps } = depsEmMemoria();
  const { data: bot } = await criarAgente(deps, { dono: "pessoa", interativo: true });
  const ctx = { agenteId: bot.agente.id, conversaId: bot.conversa.id, turnoId: "turno" };
  const ler = await pedirAcesso(deps, { ...ctx, conector: "clickup", capacidades: [], nivel: "leitura", nao_pedido: [] });
  const escrever = await pedirAcesso(deps, { ...ctx, conector: "clickup", capacidades: [], nivel: "escrita", nao_pedido: [] });
  const deNovo = await pedirAcesso(deps, { ...ctx, conector: "clickup", capacidades: [], nivel: "escrita", nao_pedido: [] });
  expect(escrever.data.proposta_id).not.toBe(ler.data.proposta_id);
  expect(deNovo.data.proposta_id).toBe(escrever.data.proposta_id);
});
