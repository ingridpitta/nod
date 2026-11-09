import { expect, it } from "vitest";
import type { Executor } from "../../src/contracts/evento.ts";
import { autoriaAgente, evento } from "../../src/use-cases/autoria-evento.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * 0085 (NOD-291, C13/C23): o executor dos turnos antigos passa a ser o real. A regra mora em nod_executor_divergente() e
 * nod_alinhar_executor_dos_turnos() (SECURITY INVOKER): aqui elas rodam como nod_app, sob RLS, só com as linhas do teste.
 *
 * Desvio registrado (2026-10-15): o plano previa uma conformidade da tabela inteira ("catcher ⇒ custo 0 e sessão nula").
 * Não vale: o driver catcher emite sessão e custo a partir do roteiro (adapters/executor/drivers/catcher.ts). O que a
 * migração garante — e este teste prova — é o executor do despacho (ou do gasto) e o catcher de verdade intacto.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };

describeIntegracao("0085: o executor dos turnos vira o real", () => {
  it("alinha pelo último despacho, cai no gasto sem despacho, não toca o catcher real e é idempotente", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Ada" });
      const turno = async () => {
        const t = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
        if (!t) throw new Error("turno");
        await repos.turnos.assentar(t.id, { estado: "concluido" });
        return t.id;
      };
      const despachado = (turnoId: string, executor: Executor) =>
        repos.events.gravarSemOutbox([evento(MARLON, { kind: "turno_despachado", autoria: autoriaAgente({ agenteId, contaDeExecucao: PESSOA_MARLON, executor }), agora: Date.now(), conversaId, turnoId, dados: { executor } })]);

      // 1. Rodou no Mac: o despacho diz local (o redespacho vale pelo último).
      const noMac = await turno();
      await despachado(noMac, "catcher");
      await despachado(noMac, "local");
      // 2. Sem despacho: o gasto diz local.
      const peloGasto = await turno();
      await repos.gastos.registrar({ turnoId: peloGasto, executor: "local", tokensEntrada: 1, tokensSaida: 1, custoUsd: 0.1, modelo: "m", em: Date.now() });
      // 3. O catcher de verdade (catcher_registros) fica catcher, mesmo com despacho local.
      const catcherReal = await turno();
      await despachado(catcherReal, "local");
      await trx`insert into catcher_registros (tenant_id, owner_id, turno_id, tipo) values (${TENANT_PADRAO}, ${PESSOA_MARLON}, ${catcherReal}, 'passo')`;
      // 4. Sem fonte nenhuma: fica como está.
      const semFonte = await turno();

      const meus = [noMac, peloGasto, catcherReal, semFonte];
      const divergentes = await trx<{ turno_id: string; executor: string }[]>`select turno_id, executor from nod_executor_divergente() where turno_id = any(${meus}::uuid[])`;
      expect(new Map(divergentes.map((d) => [d.turno_id, d.executor]))).toEqual(new Map([[noMac, "local"], [peloGasto, "local"]]));

      const [r] = await trx<{ divergentes_antes: number; alterados: number; divergentes_depois: number }[]>`select * from nod_alinhar_executor_dos_turnos()`;
      expect(r?.alterados).toBeGreaterThanOrEqual(2);
      expect(r?.divergentes_depois).toBe(0);
      const executorDe = async (id: string) => (await repos.turnos.buscar(id))?.executor;
      expect(await executorDe(noMac)).toBe("local");
      expect(await executorDe(peloGasto)).toBe("local");
      expect(await executorDe(catcherReal)).toBe("catcher");
      expect(await executorDe(semFonte)).toBe("catcher");

      const [segunda] = await trx<{ alterados: number }[]>`select * from nod_alinhar_executor_dos_turnos()`;
      expect(segunda?.alterados).toBe(0);
    });
  });
});
