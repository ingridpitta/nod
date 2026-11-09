import { expect, it } from "vitest";
import type { Executor } from "../../src/contracts/evento.ts";
import { autoriaAgente, evento } from "../../src/use-cases/autoria-evento.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * QA do PR #346 (0085, NOD-291, definido em 2026-10-16): o teste do PR grava os dois despachos na mesma transação, com o
 * mesmo `created_at` (now()), e prova "vale o último" só pelo desempate a favor do local. Aqui, instantes distintos e nos
 * dois sentidos (gravados com `gravarComOutbox`, que respeita `createdAt`); o gasto mais recente quando há mais de um; e um executor fora de ('local','catcher') que não pode vencer.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const HORA = 3_600_000;

describeIntegracao("0085 (QA #346): a ordem dos despachos e dos gastos decide o executor", () => {
  it("vale o despacho mais recente (nos dois sentidos), o gasto mais recente, e valor estranho no despacho não vence", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Ada" });
      const turno = async (executor: Executor) => {
        const t = await repos.turnos.enfileirar({ executor, conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
        if (!t) throw new Error("turno");
        await repos.turnos.assentar(t.id, { estado: "concluido" });
        return t.id;
      };
      const base = Date.now() - 5 * HORA;
      const despachado = (turnoId: string, executor: string, em: number) =>
        repos.events.gravarComOutbox([{ ...evento(MARLON, { kind: "turno_despachado", autoria: autoriaAgente({ agenteId, contaDeExecucao: PESSOA_MARLON, executor: "local" }), agora: em, conversaId, turnoId, dados: { executor } }), createdAt: em }]);
      const gasto = (turnoId: string, executor: Executor, em: number) =>
        repos.gastos.registrar({ turnoId, executor, tokensEntrada: 1, tokensSaida: 1, custoUsd: 0.1, modelo: "m", em });

      // 1. Rodou no catcher e foi redespachado no Mac depois: local (o primeiro despacho é o mais antigo).
      const localDepois = await turno("catcher");
      await despachado(localDepois, "local", base + 2 * HORA);
      await despachado(localDepois, "catcher", base);
      // 2. O sentido inverso: local primeiro, catcher depois → catcher, mesmo com o desempate a favor do local.
      const catcherDepois = await turno("local");
      await despachado(catcherDepois, "local", base);
      await despachado(catcherDepois, "catcher", base + 2 * HORA);
      // 3. Sem despacho e dois gastos: vale o mais recente.
      const gastoRecente = await turno("local");
      await gasto(gastoRecente, "local", base);
      await gasto(gastoRecente, "catcher", base + 2 * HORA);
      // 4. Despacho mais recente com valor fora da lista: é ignorado; vale o despacho válido anterior.
      const estranho = await turno("catcher");
      await despachado(estranho, "local", base);
      await despachado(estranho, "nuvem", base + 2 * HORA);

      const meus = [localDepois, catcherDepois, gastoRecente, estranho];
      const divergentes = await trx<{ turno_id: string; executor: string }[]>`select turno_id, executor from nod_executor_divergente() where turno_id = any(${meus}::uuid[])`;
      expect(new Map(divergentes.map((d) => [d.turno_id, d.executor]))).toEqual(
        new Map([[localDepois, "local"], [catcherDepois, "catcher"], [gastoRecente, "catcher"], [estranho, "local"]]),
      );

      await trx`select * from nod_alinhar_executor_dos_turnos()`;
      const executorDe = async (id: string) => (await repos.turnos.buscar(id))?.executor;
      expect(await executorDe(localDepois)).toBe("local");
      expect(await executorDe(catcherDepois)).toBe("catcher");
      expect(await executorDe(gastoRecente)).toBe("catcher");
      expect(await executorDe(estranho)).toBe("local");
    });
  });

  // Re-QA do #346 (Teodora, 2026-10-17): com despacho E gasto, quem decide é o despacho (o plano), mesmo que o gasto seja
  // mais recente e diga outro executor — a ordem da 0085 é "despacho; sem ele, gasto".
  it("despacho e gasto discordam: vale o despacho, mesmo com o gasto mais recente", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Ada" });
      const t = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
      if (!t) throw new Error("turno");
      await repos.turnos.assentar(t.id, { estado: "concluido" });
      const base = Date.now() - 5 * HORA;
      await repos.events.gravarComOutbox([{ ...evento(MARLON, { kind: "turno_despachado", autoria: autoriaAgente({ agenteId, contaDeExecucao: PESSOA_MARLON, executor: "local" }), agora: base, conversaId, turnoId: t.id, dados: { executor: "local" } }), createdAt: base }]);
      await repos.gastos.registrar({ turnoId: t.id, executor: "catcher", tokensEntrada: 1, tokensSaida: 1, custoUsd: 0.1, modelo: "m", em: base + 2 * HORA });
      const [d, ...resto] = await trx<{ executor: string }[]>`select executor from nod_executor_divergente() where turno_id = ${t.id}`;
      expect(resto).toHaveLength(0);
      expect(d?.executor).toBe("local");
      await trx`select * from nod_alinhar_executor_dos_turnos()`;
      expect((await repos.turnos.buscar(t.id))?.executor).toBe("local");
    });
  });
});
