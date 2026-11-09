import { describe, expect, it } from "vitest";
import type { EfeitoAposCommit } from "../../../src/contracts/acoes.ts";
import { REGISTRO_DE_ACOES } from "../../../src/domain/acoes/index.ts";
import { EXECUTORES_BOTS } from "../../../src/use-cases/acoes/bots.ts";
import { EXECUTORES } from "../../../src/use-cases/acoes/index.ts";
import { depsFalsos } from "./deps-l5.ts";

/** NOD-391 (ADR-135): a tabela id → executor único e o efeito pós-commit do excluir. */

describe("executores únicos", () => {
  it("todo id vivo do registro aponta para um executor que existe, e todo executor é de um id vivo", () => {
    const vivos = REGISTRO_DE_ACOES.filter((a) => a.chat.estado === "vivo").map((a) => ("casoDeUso" in a ? a.casoDeUso : undefined));
    expect(vivos.every((c) => c !== undefined && c in EXECUTORES), JSON.stringify(vivos)).toBe(true);
    expect(Object.keys(EXECUTORES).sort()).toEqual([...(vivos as string[])].sort());
  });

  it("bots.excluir agenda o desligamento do computador para depois do commit; criar não agenda nada", async () => {
    const { deps } = depsFalsos();
    const efeitos: EfeitoAposCommit[] = [];
    const d = { ...deps, aposCommit: (e: EfeitoAposCommit) => void efeitos.push(e) };
    const criado = await EXECUTORES_BOTS["bots.criar"](d, { dono: "pessoa", nome: "Revisor", descricao: "revisa PRs", secao: "Time" });
    expect(efeitos).toEqual([]);
    expect(criado.data.agente.secao).toBe("Time");
    await EXECUTORES_BOTS["bots.excluir"](d, { agenteId: criado.data.agente.id });
    expect(efeitos).toEqual([{ tipo: "desligar_computador", agenteId: criado.data.agente.id }]);
  });

  it("bots.excluir sem aposCommit (Deps que não rodam efeito) não quebra", async () => {
    const { deps } = depsFalsos();
    const criado = await EXECUTORES_BOTS["bots.criar"](deps, { dono: "pessoa", nome: "Revisor", descricao: "revisa PRs" });
    const r = await EXECUTORES_BOTS["bots.excluir"](deps, { agenteId: criado.data.agente.id });
    expect(r.data.agente.excluidoEm).not.toBeNull();
  });
});
