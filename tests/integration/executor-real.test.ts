import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { criarTokenTurno } from "../../src/services/token-turno.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { enfileirarRetomada } from "../../src/use-cases/enfileirar-retomada.ts";
import { pedirABot } from "../../src/use-cases/pedir-a-bot.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";
import { tarefaDoPedido } from "../helpers/pedido.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const pronto = { estado: "pronto", versao: "teste", em: Date.now() } as const;

/**
 * NOD-206 (#200): o executor em que o turno roda só é decidido ao emitir o plano. O pedido de colega e a retomada
 * nasciam `catcher` pelo padrão do INSERT e nada corrigia a coluna; a retomada de um turno local comparava a sessão
 * com esse palpite e abria sessão nova, sem --resume (fere o ADR-066), e gastos/Raio-X atribuíam o turno ao catcher.
 */
describeIntegracao("o turno grava o executor em que de fato roda (NOD-206)", () => {
  it("pedir_a_bot: o pedido herda o executor de quem pede e o plano grava o real (local)", async () => {
    await withRollback(MARLON, async (trx) => {
      const vera = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const tuca = await agenteComConversa(trx, MARLON, { nome: "Tuca" });
      const agora = () => Date.now();
      const deps = depsSobre(vera.repos, MARLON, { services: servicosDeTeste({ agora, tokens: criarTokenTurno({ agora }) }), agora, trx });
      // O turno de quem pede nasce com o palpite `catcher` (ex.: enfileirado antes de o inventário do CLI chegar).
      const deQuemPede = await vera.repos.turnos.enfileirar({ conversaId: vera.conversaId, agenteId: vera.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "pergunte ao Tuca o status do PR 42", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", executor: "catcher" });
      await emitirPlanoTurno(deps, { turnoId: deQuemPede?.id ?? "", machineId: randomUUID(), executor: "local", harnesses: { "claude-cli": pronto } });
      const r = await pedirABot(deps, { turnoId: deQuemPede?.id ?? "", agenteId: vera.agenteId, conversaId: vera.conversaId, agente: "Tuca", pedido: "qual o status do PR 42?" });

      // Sem executor no enfileiramento do pedido: vem do turno de quem pede, que o plano já corrigiu para local.
      const pedido = await vera.repos.turnos.buscar(tarefaDoPedido(r.data));
      expect(pedido).toMatchObject({ agenteId: tuca.agenteId, origem: "delegacao", executor: "local" });

      // O plano é a fonte da verdade: mesmo com o palpite errado na linha, grava o executor em que o turno roda.
      await trx`update turnos set executor = 'catcher' where id = ${tarefaDoPedido(r.data)}`;
      await emitirPlanoTurno(deps, { turnoId: tarefaDoPedido(r.data), machineId: randomUUID(), executor: "local", harnesses: { "claude-cli": pronto } });
      const [linha] = await trx<{ executor: string; estado: string }[]>`select executor, estado from turnos where id = ${tarefaDoPedido(r.data)}`;
      expect(linha).toEqual({ executor: "local", estado: "pendente" });
    });
  });

  it("retomada pelo caminho real (enfileirarRetomada, sem executor) continua a sessão do turno local; de outro executor, sessão nova", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Dev 4" });
      await repos.agentes.atualizarPerfil(agenteId, { confirmado: true });
      const agora = () => Date.now();
      const deps = depsSobre(repos, MARLON, { services: servicosDeTeste({ agora, tokens: criarTokenTurno({ agora }) }), agora, trx });
      const plano = async (turnoId: string) => (await emitirPlanoTurno(deps, { turnoId, machineId: randomUUID(), executor: "local", harnesses: { "claude-cli": pronto } })).data;
      // Delegação fora de trabalho (o caminho da cadeia, ADR-066), nascida com o palpite antigo `catcher`.
      const delegacao = () => repos.turnos.enfileirar({ conversaId, agenteId, origem: "delegacao", prazoEm: Date.now() + 600_000, profundidade: 1, entradaTexto: "implementa a 86akr9u9u", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", sobProcuracaoDe: PESSOA_MARLON, executor: "catcher" });

      const pedido = await delegacao();
      if (!pedido) throw new Error("turno");
      await plano(pedido.id); // roda no local: a linha passa a dizer local
      const sessao = randomUUID();
      await repos.turnos.assentar(pedido.id, { estado: "concluido", sessaoCli: sessao });
      const original = await repos.turnos.buscar(pedido.id);
      expect(original?.executor).toBe("local");
      const { turno: retomada } = await enfileirarRetomada(deps, { original: original!, entradaTexto: "[nod] aprovado: siga", prazoEm: Date.now() + 600_000 });
      expect(retomada?.executor).toBe("local");
      const p = await plano(retomada?.id ?? "");
      expect(p.modoTurno).toBe("delegacao");
      expect(p.entrada.sessaoCli).toBe(sessao);

      // Turno que rodou mesmo no catcher (sessão que não existe no CLI real): a retomada local abre sessão nova.
      const doCatcher = await delegacao();
      await emitirPlanoTurno(deps, { turnoId: doCatcher?.id ?? "", machineId: randomUUID(), executor: "catcher" });
      await repos.turnos.assentar(doCatcher?.id ?? "", { estado: "concluido", sessaoCli: randomUUID() });
      const doCatcherLido = await repos.turnos.buscar(doCatcher?.id ?? "");
      expect(doCatcherLido?.executor).toBe("catcher");
      const { turno: outra } = await enfileirarRetomada(deps, { original: doCatcherLido!, entradaTexto: "[nod] siga", prazoEm: Date.now() + 600_000 });
      expect((await plano(outra?.id ?? "")).entrada.sessaoCli).toBeNull();
    });
  });
});
