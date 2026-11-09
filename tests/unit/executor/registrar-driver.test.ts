import { describe, expect, it } from "vitest";
import { MOTIVO_NAO_REGISTRADO, registrarDriver, registryVazio } from "../../../src/adapters/executor/registry.ts";
import type { ConfigDriver, Driver, Instance } from "../../../src/adapters/executor/spi.ts";
import type { Inventario } from "../../../src/contracts/inventario.ts";

const cfg: ConfigDriver = { env: {}, cwdBase: "/tmp/nao-usado" };

function driverCom(sonda: () => Inventario, dispostos: string[], nome: string): Driver {
  return {
    meta: { id: "claude-cli", locality: "local" },
    async create(): Promise<Instance> {
      return {
        sondar: async () => sonda(),
        adapter: () => {
          throw new Error("não usado");
        },
        dispose: async () => {
          dispostos.push(nome);
        },
      };
    },
  };
}

describe("registrarDriver: liga um driver no registry DEPOIS do boot (interruptor de executor, definido em 2026-09-16)", () => {
  it("registry vazio: os dois drivers em sombra com o motivo fixo", () => {
    expect(registryVazio()).toEqual({
      "claude-cli": { estado: "sombra", motivo: MOTIVO_NAO_REGISTRADO },
      catcher: { estado: "sombra", motivo: MOTIVO_NAO_REGISTRADO },
    });
  });

  it("sonda fora de 'pronto' vira sombra 'estado: motivo' e libera a instância; sonda 'pronto' liga o driver no lugar", async () => {
    const registry = registryVazio();
    const dispostos: string[] = [];
    const inv = await registrarDriver(registry, cfg, driverCom(() => ({ estado: "nao_autenticado", motivo: "faça login", em: 1 }), dispostos, "a"));
    expect(inv?.estado).toBe("nao_autenticado");
    expect(registry["claude-cli"]).toEqual({ estado: "sombra", motivo: "nao_autenticado: faça login" });
    expect(dispostos).toEqual(["a"]);

    const pronto = await registrarDriver(registry, cfg, driverCom(() => ({ estado: "pronto", versao: "2.0.0", em: 2 }), dispostos, "b"));
    expect(pronto).toEqual({ estado: "pronto", versao: "2.0.0", em: 2 });
    expect(registry["claude-cli"].estado).toBe("pronto");
    expect(registry.catcher).toEqual({ estado: "sombra", motivo: MOTIVO_NAO_REGISTRADO });
    expect(dispostos).toEqual(["a"]);
  });

  it("re-registrar um driver pronto libera a instância anterior; create() que lança vira sombra create_falhou (e também libera)", async () => {
    const registry = registryVazio();
    const dispostos: string[] = [];
    await registrarDriver(registry, cfg, driverCom(() => ({ estado: "pronto", versao: "1", em: 1 }), dispostos, "velho"));
    await registrarDriver(registry, cfg, driverCom(() => ({ estado: "pronto", versao: "2", em: 2 }), dispostos, "novo"));
    expect(dispostos).toEqual(["velho"]);
    expect(registry["claude-cli"].estado).toBe("pronto");

    const quebrado: Driver = {
      meta: { id: "claude-cli", locality: "local" },
      async create() {
        throw new Error("sem permissão");
      },
    };
    expect(await registrarDriver(registry, cfg, quebrado)).toBeNull();
    expect(registry["claude-cli"]).toEqual({ estado: "sombra", motivo: "create_falhou: sem permissão" });
    expect(dispostos).toEqual(["velho", "novo"]);
  });
});
