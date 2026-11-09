import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { criarExecutor, type DepsRotas } from "../../../src/adapters/http/rotas/executar-caso.ts";
import type { EfeitoAposCommit } from "../../../src/contracts/acoes.ts";
import type { Tx } from "../../../src/shared/types.ts";
import type { CasoDeUso } from "../../../src/use-cases/tipos.ts";

/**
 * NOD-391 (ADR-135 §4): o efeito que o caso de uso agenda pela rota roda DEPOIS do commit, na ordem, e nunca quando a
 * transação desfaz. A transação aqui é falsa e escreve no diário quando "commita"; o efeito escreve quando roda.
 */
const ESCOPO = { tenantId: randomUUID(), pessoaId: randomUUID() };

function montar() {
  const diario: string[] = [];
  const d: DepsRotas = {
    abrirTx: () => async (fn) => {
      const r = await fn({} as Tx);
      diario.push("commit");
      return r;
    },
    services: {} as DepsRotas["services"],
    useCases: {} as DepsRotas["useCases"],
    prazoDecisaoMs: 60_000,
    executor: "catcher",
    rodarAposCommit: async (_escopo, e) => {
      diario.push(`efeito ${e.tipo === "desligar_computador" ? e.agenteId : e.tipo === "remover_computador" ? e.maquinaId : e.importacaoId}`);
    },
  };
  return { executar: criarExecutor(d), diario };
}

const desligar = (agenteId: string): EfeitoAposCommit => ({ tipo: "desligar_computador", agenteId });

describe("criarExecutor: efeito pós-commit (ADR-135 §4)", () => {
  it("roda depois do commit, na ordem em que o caso de uso agendou", async () => {
    const { executar, diario } = montar();
    const caso: CasoDeUso<null, string> = async (deps) => {
      deps.aposCommit?.(desligar("a"));
      deps.aposCommit?.(desligar("b"));
      diario.push("caso");
      return { data: "ok" };
    };
    expect(await executar(ESCOPO, caso, null)).toBe("ok");
    expect(diario).toEqual(["caso", "commit", "efeito a", "efeito b"]);
  });

  it("caso de uso que lança depois de agendar: a transação desfaz e o efeito não roda", async () => {
    const { executar, diario } = montar();
    const caso: CasoDeUso<null, never> = async (deps) => {
      deps.aposCommit?.(desligar("a"));
      throw new Error("falhou");
    };
    await expect(executar(ESCOPO, caso, null)).rejects.toThrow("falhou");
    expect(diario).toEqual([]);
  });
});
