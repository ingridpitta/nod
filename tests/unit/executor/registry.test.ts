import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { catcherDriver } from "../../../src/adapters/executor/drivers/catcher.ts";
import { criarClaudeCliDriver } from "../../../src/adapters/executor/drivers/claude-cli.ts";
import { configDosDrivers, criarRegistry, criarRegistryDetalhado, executorPadrao, lerNodExecutor, motivoNodExecutorDesconhecido, nodHome, VALIDOS_NOD_EXECUTOR } from "../../../src/adapters/executor/registry.ts";
import type { Driver, Registry } from "../../../src/adapters/executor/spi.ts";
import type { Inventario } from "../../../src/contracts/inventario.ts";
import { criarInventario } from "../../../src/services/inventario.ts";

const lig = { urlNod: "http://127.0.0.1:1", proxyPath: "/nao/importa/proxy.ts" };

describe("registry (ADR-012 sombra, ADR-019 gate pré-spawn)", () => {
  let home: string;
  beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), "nod-registry-home-"));
  });
  afterAll(() => rm(home, { recursive: true, force: true }));

  it("NOD_CLAUDE_BIN inválido → claude-cli em sombra com motivo (ausente); catcher pronto; sem gastar turno", async () => {
    const env = { HOME: home, PATH: "/usr/bin:/bin", NOD_CLAUDE_BIN: "/nao/existe/claude", NOD_HOME: join(home, ".nod"), ANTHROPIC_API_KEY: "vazou" };
    const { registry, inventarios } = await criarRegistryDetalhado(env, [criarClaudeCliDriver(lig), catcherDriver], { shellDeLogin: false });
    expect(registry["claude-cli"]).toEqual({ estado: "sombra", motivo: "ausente: binario_nao_encontrado" });
    expect(registry.catcher.estado).toBe("pronto");
    expect(inventarios["claude-cli"]?.estado).toBe("ausente");
    expect(inventarios.catcher?.estado).toBe("pronto");
  });

  it("sem NOD_CLAUDE_BIN e sem claude no PATH → sombra 'claude_fora_do_path'", async () => {
    // home explícito: sem ele, ~/.local/bin do PATH aumentado seria o da pessoa (onde o claude real mora)
    const registry = await criarRegistry({ HOME: home, PATH: "/nao/existe" }, [criarClaudeCliDriver(lig)], { shellDeLogin: false, home });
    expect(registry["claude-cli"]).toEqual({ estado: "sombra", motivo: "ausente: claude_fora_do_path" });
    expect(registry.catcher).toEqual({ estado: "sombra", motivo: "driver não registrado" });
  });

  it("create() que lança vira sombra com o motivo, e os outros drivers seguem", async () => {
    const quebrado: Driver = {
      meta: { id: "claude-cli", locality: "local" },
      async create() {
        throw new Error("sem permissão no diretório");
      },
    };
    const registry = await criarRegistry({ HOME: home }, [quebrado, catcherDriver], { shellDeLogin: false });
    expect(registry["claude-cli"]).toEqual({ estado: "sombra", motivo: "create_falhou: sem permissão no diretório" });
    expect(registry.catcher.estado).toBe("pronto");
  });

  it("configDosDrivers: env sem a denylist (ANTHROPIC_*, CLAUDECODE, NOD_*), PATH aumentado, cwdBase em NOD_HOME/turnos, bin com ~ expandido", async () => {
    const cfg = await configDosDrivers(
      { HOME: home, PATH: "/usr/bin", ANTHROPIC_API_KEY: "x", CLAUDECODE: "1", CLAUDE_CODE_ENTRYPOINT: "cli", NOD_SESSAO_SEGREDO: "s", NOD_CLAUDE_BIN: "~/bin/claude", NOD_HOME: "~/.nod-teste", LANG: "pt_BR" },
      { shellDeLogin: false, home },
    );
    expect(cfg.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(cfg.env.CLAUDECODE).toBeUndefined();
    expect(cfg.env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
    expect(cfg.env.NOD_SESSAO_SEGREDO).toBeUndefined();
    expect(cfg.env.LANG).toBe("pt_BR");
    expect(cfg.env.HOME).toBe(home);
    expect(cfg.env.PATH?.split(":")).toContain(join(home, ".local/bin"));
    expect(cfg.bin).toBe(join(home, "bin/claude"));
    expect(cfg.cwdBase).toBe(join(home, ".nod-teste", "turnos"));
    expect(nodHome({}, "/h")).toBe("/h/.nod");
  });

  it("revisão do PR 1 (ADR-093): o ambiente dos drivers nunca leva ELECTRON_RUN_AS_NODE nem o node do nod no PATH", async () => {
    const cfg = await configDosDrivers({ HOME: home, PATH: "/usr/bin", ELECTRON_RUN_AS_NODE: "1" }, { shellDeLogin: false, home });
    expect(cfg.env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(cfg.env.PATH).not.toContain("node-do-nod");
    expect(cfg.camadas?.some((c) => c.origem === "node_do_nod" || c.origem === "nod")).toBe(false);
  });

  describe("executorPadrao", () => {
    const registry: Registry = {
      "claude-cli": { estado: "sombra", motivo: "ausente: binario_nao_encontrado" },
      catcher: { estado: "pronto", driver: catcherDriver, instance: { sondar: async () => ({ estado: "pronto", versao: "catcher", em: 0 }), adapter: () => ({ rodarTurno: async () => { throw new Error("não usado"); }, interromper: async () => {} }), dispose: async () => {} } },
    };

    it("sem NOD_EXECUTOR fora de produção → catcher", () => {
      expect(executorPadrao({}, registry)).toEqual({ id: "catcher" });
      expect(executorPadrao({ NOD_EXECUTOR: "catcher" }, registry)).toEqual({ id: "catcher" });
    });

    it("claude-cli só é padrão quando a sonda disse pronto; em sombra devolve o motivo", () => {
      expect(executorPadrao({ NOD_EXECUTOR: "claude-cli" }, registry)).toEqual({ id: null, motivo: "claude-cli em sombra: ausente: binario_nao_encontrado" });
      expect(executorPadrao({ NODE_ENV: "production" }, registry)).toEqual({ id: null, motivo: "claude-cli em sombra: ausente: binario_nao_encontrado" });
      const pronto: Registry = { ...registry, "claude-cli": registry.catcher };
      expect(executorPadrao({ NOD_EXECUTOR: "claude-cli" }, pronto)).toEqual({ id: "claude-cli" });
      expect(executorPadrao({ NODE_ENV: "production" }, pronto)).toEqual({ id: "claude-cli" });
    });

    // NOD-160 critério 3: os quatro valores válidos e o ausente escolhem o mesmo driver de antes, dentro e fora de produção.
    const tudoPronto: Registry = { ...registry, "claude-cli": registry.catcher, "codex-cli": registry.catcher };
    it.each([
      [undefined, undefined, "catcher"],
      [undefined, "production", "claude-cli"],
      ["", undefined, "catcher"],
      ["", "production", "claude-cli"],
      ["auto", undefined, "claude-cli"],
      ["auto", "production", "claude-cli"],
      ["claude-cli", undefined, "claude-cli"],
      ["claude-cli", "production", "claude-cli"],
      ["codex-cli", undefined, "codex-cli"],
      ["codex-cli", "production", "codex-cli"],
      ["catcher", undefined, "catcher"],
      ["catcher", "production", "catcher"],
      ["  catcher  ", undefined, "catcher"],
      [" codex-cli\n", "production", "codex-cli"],
    ])("NOD_EXECUTOR=%j, NODE_ENV=%j → %s (regra de hoje)", (valor, nodeEnv, esperado) => {
      expect(executorPadrao({ NOD_EXECUTOR: valor, NODE_ENV: nodeEnv }, tudoPronto)).toEqual({ id: esperado });
    });

    it("auto sem Claude pronto escolhe o Codex pronto (regra do modo auto intacta)", () => {
      expect(executorPadrao({ NOD_EXECUTOR: "auto" }, { ...registry, "codex-cli": registry.catcher })).toEqual({ id: "codex-cli" });
    });

    it("NOD-207: auto sem nenhum harness pronto cai no legado (claude-cli) e diz o motivo, como antes", () => {
      expect(executorPadrao({ NOD_EXECUTOR: "auto" }, registry)).toEqual({ id: null, motivo: "claude-cli em sombra: ausente: binario_nao_encontrado" });
      const semCodex: Registry = { ...registry, "codex-cli": { estado: "sombra", motivo: "ausente" } };
      expect(executorPadrao({ NOD_EXECUTOR: "auto" }, semCodex)).toEqual({ id: null, motivo: "claude-cli em sombra: ausente: binario_nao_encontrado" });
    });

    // NOD-160 critério 2: valor desconhecido falha fechado, com o motivo escrito, nos dois ambientes; não cai em outro driver.
    it.each(["claude", "Claude-CLI", "codex", "box"])("NOD_EXECUTOR=%j → { id: null } com o motivo, dentro e fora de produção", (valor) => {
      const motivo = `NOD_EXECUTOR desconhecido: "${valor}" (válidos: auto, claude-cli, codex-cli, catcher)`;
      expect(executorPadrao({ NOD_EXECUTOR: valor }, tudoPronto)).toEqual({ id: null, motivo });
      expect(executorPadrao({ NOD_EXECUTOR: valor, NODE_ENV: "production" }, tudoPronto)).toEqual({ id: null, motivo });
      expect(motivoNodExecutorDesconhecido(valor)).toBe(motivo);
    });
  });

  // NOD-160 critério 1.
  describe("lerNodExecutor", () => {
    it.each(VALIDOS_NOD_EXECUTOR)("reconhece %s, com e sem espaços nas pontas", (valor) => {
      expect(lerNodExecutor({ NOD_EXECUTOR: valor })).toEqual({ pedido: valor });
      expect(lerNodExecutor({ NOD_EXECUTOR: `  ${valor}\t` })).toEqual({ pedido: valor });
    });

    it("ausente, vazio ou só espaços → null (regra do ambiente)", () => {
      expect(lerNodExecutor({})).toEqual({ pedido: null });
      expect(lerNodExecutor({ NOD_EXECUTOR: "" })).toEqual({ pedido: null });
      expect(lerNodExecutor({ NOD_EXECUTOR: "   " })).toEqual({ pedido: null });
    });

    it.each(["claude", "Claude-CLI", "codex", "CATCHER", "claude cli", "hermes", "cursor-cli"])("%j → desconhecido (valor exato, sem maiúsculas)", (valor) => {
      expect(lerNodExecutor({ NOD_EXECUTOR: valor })).toEqual({ desconhecido: valor });
    });

    it("desconhecido guarda o valor já aparado", () => {
      expect(lerNodExecutor({ NOD_EXECUTOR: " claude " })).toEqual({ desconhecido: "claude" });
    });

    it("os válidos são exatamente os quatro da spec", () => {
      expect(VALIDOS_NOD_EXECUTOR).toEqual(["auto", "claude-cli", "codex-cli", "catcher"]);
    });
  });
});

describe("services/inventario: cache da sonda por pessoa com persistência por callback (EMENDA 3)", () => {
  const pronto = (em: number): Inventario => ({ estado: "pronto", versao: "2.1.272", em });

  it("sonda uma vez dentro do TTL, persiste, e sonda de novo depois do TTL ou com forcar", async () => {
    let agora = 1_000;
    let sondas = 0;
    const persistidos: [string, Inventario][] = [];
    const inv = criarInventario({
      sondar: async () => {
        sondas += 1;
        return pronto(agora);
      },
      persistir: async (p, i) => {
        persistidos.push([p, i]);
      },
      relogio: () => agora,
      ttlMs: 100,
    });
    expect(inv.ultimo("p1")).toBeNull();
    await inv.obter("p1");
    await inv.obter("p1");
    expect(sondas).toBe(1);
    expect(persistidos).toEqual([["p1", pronto(1_000)]]);
    agora = 1_150;
    await inv.obter("p1");
    expect(sondas).toBe(2);
    await inv.obter("p1", { forcar: true });
    expect(sondas).toBe(3);
    expect(inv.ultimo("p1")).toEqual(pronto(1_150));
    inv.invalidar("p1");
    expect(inv.ultimo("p1")).toBeNull();
  });

  it("NOD-178: snapshot de sonda lenta não fica no cache; a próxima consulta sonda de novo mesmo dentro do TTL", async () => {
    let sondas = 0;
    const lenta: Inventario = { estado: "ausente", motivo: "O Claude demorou para responder; o Mac está carregado. Tente de novo em instantes.", causa: "sonda_lenta", em: 1_000 };
    const inv = criarInventario({ sondar: async () => (++sondas === 1 ? lenta : pronto(1_000)), relogio: () => 1_000, ttlMs: 100 });
    expect(await inv.obter("p1")).toEqual(lenta);
    expect(await inv.obter("p1")).toEqual(pronto(1_000));
    expect(await inv.obter("p1")).toEqual(pronto(1_000));
    expect(sondas).toBe(2);
  });

  it("chamadas concorrentes da mesma pessoa compartilham UMA sonda; pessoas diferentes não", async () => {
    let sondas = 0;
    const inv = criarInventario({
      sondar: async () => {
        sondas += 1;
        await new Promise((r) => setTimeout(r, 10));
        return pronto(Date.now());
      },
      relogio: Date.now,
    });
    await Promise.all([inv.obter("a"), inv.obter("a"), inv.obter("b")]);
    expect(sondas).toBe(2);
  });

  it("persistir que falha não derruba nem esconde o snapshot", async () => {
    const inv = criarInventario({
      sondar: async () => ({ estado: "ausente", motivo: "binario_nao_encontrado", em: 5 }),
      persistir: async () => {
        throw new Error("banco fora");
      },
      relogio: () => 5,
    });
    expect(await inv.obter("p")).toEqual({ estado: "ausente", motivo: "binario_nao_encontrado", em: 5 });
    expect(inv.ultimo("p")?.estado).toBe("ausente");
  });
});
