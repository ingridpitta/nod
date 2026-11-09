import { describe, expect, it } from "vitest";
import { raioXDoTurno } from "../../../src/use-cases/raio-x.ts";
import type { Deps } from "../../../src/use-cases/tipos.ts";

// NOD-352 (QA, mutantes M22/M23): o caso de uso manda o nome amigável de cada id, sem depender do Postgres.
const ferramenta = (nome: string) => ({ nome, resultadoChars: null, erro: false });
const turno = {
  turnoId: "t1",
  estado: "concluido",
  criadoEm: 0,
  custoUsd: 0,
  composicao: null,
  execucao: {
    janela: 200000,
    chamadas: [
      { em: 1, contexto: 1, cacheLido: 0, entrada: 1, cacheNovo: 0, saida: 1, pensamento: 0, ferramentas: [ferramenta("Monitor"), ferramenta("mcp__nod__lembrar")] },
      { em: 2, contexto: 1, cacheLido: 0, entrada: 1, cacheNovo: 0, saida: 1, pensamento: 0, ferramentas: [ferramenta("Monitor"), ferramenta("constructor")] },
    ],
    compactacoes: [],
    chamadasOmitidas: 0,
  },
};
const deps = (t: unknown) => ({ repos: { raioX: { doTurno: async () => t } } }) as unknown as Deps;

describe("raioXDoTurno — nomesDasFerramentas (NOD-352)", () => {
  it("mapeia cada id ao rótulo do passado, uma vez por id", async () => {
    const { data } = await raioXDoTurno(deps(turno), { turnoId: "t1" });
    expect(data.nomesDasFerramentas).toEqual({
      Monitor: "Acompanhou um processo",
      mcp__nod__lembrar: "Anotou na memória",
      constructor: "Usou uma ferramenta",
    });
  });

  it("turno sem execução devolve o mapa vazio", async () => {
    const { data } = await raioXDoTurno(deps({ ...turno, execucao: null }), { turnoId: "t1" });
    expect(data.nomesDasFerramentas).toEqual({});
  });
});
