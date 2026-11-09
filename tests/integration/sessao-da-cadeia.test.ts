import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { criarTokenTurno } from "../../src/services/token-turno.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const pronto = { estado: "pronto", versao: "teste", em: Date.now() } as const;

/**
 * ADR-066 (o C do Marlon): a continuação de um pedido de colega — depois de uma aprovação, de uma resposta, de um
 * acesso — volta na sessão do turno que ela continua, e não do zero. Em 30/09 o Milton, retomado 13 min depois de uma
 * aprovação cujo comentário falhou, começou sem a sessão e encerrou em silêncio. Com o terminal no pedido de colega, a
 * sessão é o que guarda os arquivos mexidos e o resultado dos testes.
 */
describeIntegracao("a continuação de pedido de colega volta na sessão dele (ADR-066)", () => {
  it("retomada de delegação: --resume na sessão do turno continuado, com o terminal; de outro executor, sessão nova", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Dev 4" });
      await repos.agentes.atualizarPerfil(agenteId, { confirmado: true });
      const agora = () => Date.now();
      const deps = depsSobre(repos, MARLON, { services: servicosDeTeste({ agora, tokens: criarTokenTurno({ agora }) }), agora, trx });
      const novo = (extra: { origem: "delegacao" | "retomada"; retomaTurnoId?: string; executor: "local" | "catcher" }) =>
        repos.turnos.enfileirar({ conversaId, agenteId, prazoEm: Date.now() + 600_000, profundidade: 1, entradaTexto: "implementa a 86akr9u9u", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", sobProcuracaoDe: PESSOA_MARLON, ...extra });
      const plano = async (turnoId: string) => (await emitirPlanoTurno(deps, { turnoId, machineId: randomUUID(), executor: "local", harnesses: { "claude-cli": pronto } })).data;

      const pedido = await novo({ origem: "delegacao", executor: "local" });
      if (!pedido) throw new Error("turno");
      const sessao = randomUUID();
      await repos.turnos.assentar(pedido.id, { estado: "concluido", sessaoCli: sessao });
      const retomada = await novo({ origem: "retomada", retomaTurnoId: pedido.id, executor: "local" });
      const p = await plano(retomada?.id ?? "");
      expect(p.modoTurno).toBe("delegacao");
      expect(p.entrada.sessaoCli).toBe(sessao);
      expect(p.nativas).toContain("Bash");

      // A sessão de outro executor (o catcher não abre sessão real) nunca vira --resume.
      const doCatcher = await novo({ origem: "delegacao", executor: "catcher" });
      await repos.turnos.assentar(doCatcher?.id ?? "", { estado: "concluido", sessaoCli: randomUUID() });
      await trx`update turnos set executor = 'catcher' where id = ${doCatcher?.id ?? ""}`;
      const outra = await novo({ origem: "retomada", retomaTurnoId: doCatcher?.id ?? "", executor: "local" });
      expect((await plano(outra?.id ?? "")).entrada.sessaoCli).toBeNull();
    });
  });
});
