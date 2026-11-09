import { expect, it } from "vitest";
import { criarConectoresVivos } from "../../../src/services/conectores-vivos.ts";
import { CAMINHO_MCP_SOMAR } from "../../helpers/l5.ts";

it("credencial com validade (token de instalação do App, ADR-048): depois de expiraEm o cliente vivo é trocado por um recarregado", async () => {
  let agora = 0;
  let cargas = 0;
  const vivos = criarConectoresVivos({
    agora: () => agora,
    carregar: async () => {
      cargas += 1;
      return { nome: "somar", transporte: "stdio", comando: process.execPath, args: [CAMINHO_MCP_SOMAR], env: {}, expiraEm: 1_000 };
    },
  });
  try {
    expect((await vivos.chamar("c1", "somar", { a: 1, b: 2 })).isError).toBe(false);
    agora = 999;
    await vivos.chamar("c1", "somar", { a: 1, b: 2 });
    expect(cargas).toBe(1);
    agora = 1_000;
    await vivos.chamar("c1", "somar", { a: 1, b: 2 });
    expect(cargas).toBe(2);
    expect(vivos.vivos()).toBe(1);
    // Rotina e turno interativo têm clientes separados (só a rotina pode usar o App); fechar fecha os dois.
    await vivos.chamar("c1", "somar", { a: 1, b: 2 }, { rotina: true });
    expect(vivos.vivos()).toBe(2);
    await vivos.fechar();
    expect(vivos.vivos()).toBe(0);
  } finally {
    await vivos.fechar();
  }
}, 20_000); // processo de verdade: ver o teto em tests/unit/conectores-locais/github-gh.test.ts
