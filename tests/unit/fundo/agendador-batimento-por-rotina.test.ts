import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * NOD-385: o agendador bate a cada rotina processada e a cada pessoa — um tick longo, mas andando, não vira
 * `laco_parado:agendador` (nem 503 no `/lb`, nem reinício pelo watchdog). Uma única rotina presa além do limite
 * continua sendo pega. Sem banco: a tx por pessoa é falsa e cada "rotina" é uma tx que demora no relógio falso.
 */

type Roteiro = { rotinas: number; listarMs?: number; rotinaMs?: (i: number) => number | "nunca"; falhar?: (i: number) => boolean };
const roteiros = new Map<string, Roteiro>();

vi.mock("../../../src/db/tx.ts", async (original) => {
  const real = await original<typeof import("../../../src/db/tx.ts")>();
  return {
    ...real,
    // A 1ª tx da pessoa é a listagem das vencidas; cada tx seguinte é UMA rotina (não executa o fn: o disparo real é do
    // teste de integração). Só o tempo de cada tx e a falha interessam aqui.
    abrirTxEscopada: (_db: unknown, escopo: { pessoaId: string }) => {
      const r = roteiros.get(escopo.pessoaId);
      if (!r) throw new Error("pessoa sem roteiro");
      let chamada = 0;
      return async () => {
        const i = chamada++;
        if (i === 0) {
          if (r.listarMs) await new Promise((ok) => setTimeout(ok, r.listarMs));
          return Array.from({ length: r.rotinas }, (_, k) => ({ id: `${escopo.pessoaId}-r${k}`, proximaExecucao: 0 }));
        }
        const ms = r.rotinaMs?.(i - 1) ?? 0;
        if (ms === "nunca") return new Promise<never>(() => undefined);
        await new Promise((ok) => setTimeout(ok, ms));
        if (r.falhar?.(i - 1)) throw new Error("falhou");
        return undefined;
      };
    },
  };
});

const { definirDestinoDoLog } = await import("../../../src/obs/log.ts");
const { iniciarScheduler, tickPessoa } = await import("../../../src/adapters/fundo/scheduler-rotina.ts");
const { paraCadaPessoa } = await import("../../../src/adapters/fundo/escopos-de-fundo.ts");
const { criarBatimentos, criarVerificacaoSaude } = await import("../../../src/adapters/http/rotas/saude.ts");
const { iniciarWatchdog } = await import("../../../src/adapters/http/watchdog.ts");
type OpcoesTick = import("../../../src/adapters/fundo/scheduler-rotina.ts").OpcoesTick;
type Db = import("../../../src/shared/types.ts").Db;

const SEM_BANCO = {} as Db;
const opcoes = (aoBater?: () => void): OpcoesTick => ({
  machineId: "m",
  agora: () => Date.now(),
  aoBater,
  executor: {} as OpcoesTick["executor"],
  services: {} as OpcoesTick["services"],
  useCases: {} as OpcoesTick["useCases"],
});

let logs: { evento: string; laco?: string; motivo?: string; duracao_ms?: number }[];
let paradas: (() => unknown)[];
beforeEach(() => {
  vi.useFakeTimers();
  roteiros.clear();
  logs = [];
  paradas = [];
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  definirDestinoDoLog((linha) => logs.push(JSON.parse(linha) as { evento: string }));
});
afterEach(() => {
  for (const p of paradas) void p();
  definirDestinoDoLog(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** O agendador de verdade (timer de 30 s), a verificação de saúde e o watchdog, como no boot do compartilhado. */
function montar(pessoas: string[]) {
  const batimentos = criarBatimentos({ agora: () => Date.now() });
  const verificar = criarVerificacaoSaude({ verificarBanco: async () => 1, batimentos });
  const s = iniciarScheduler(SEM_BANCO, { ...opcoes(batimentos.registrar("agendador", 30_000)), intervaloMs: 30_000 }, {
    listarPessoas: async () => pessoas.map((id) => ({ tenantId: "t", id })),
    sortearInicio: () => 0,
  });
  const sair = vi.fn();
  const w = iniciarWatchdog({ verificar, sair, agora: () => Date.now(), carenciaAte: 0 });
  paradas.push(() => s.parar(), () => w.parar());
  return { verificar, sair };
}

describe("NOD-385: o agendador bate a cada rotina processada", () => {
  it("tick com 6 rotinas de 30 s (3 min) → nunca laco_parado:agendador, o watchdog não sai, laco_tick_lento com o tick inteiro", async () => {
    roteiros.set("p1", { rotinas: 6, rotinaMs: () => 30_000 });
    const { verificar, sair } = montar(["p1"]);

    // 1º tick aos 30 s; as 6 rotinas terminam aos 60, 90, ..., 210 s. Confere a saúde a cada 5 s do caminho.
    for (let t = 0; t < 240_000; t += 5_000) {
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await verificar()).toBeNull();
    }
    expect(logs.some((l) => l.evento === "saude_falhou")).toBe(false);
    expect(sair).not.toHaveBeenCalled();
    const lento = logs.find((l) => l.evento === "laco_tick_lento" && l.laco === "agendador");
    expect(lento?.duracao_ms).toBe(180_000);
  });

  it("uma única rotina presa mais de 90 s → laco_parado:agendador e o watchdog sai com 1", async () => {
    roteiros.set("p1", { rotinas: 2, rotinaMs: (i) => (i === 0 ? 30_000 : "nunca") });
    const { verificar, sair } = montar(["p1"]);

    await vi.advanceTimersByTimeAsync(60_000); // a 1ª rotina terminou aos 60 s e bateu; a 2ª fica presa
    expect(await verificar()).toBeNull();
    await vi.advanceTimersByTimeAsync(90_000); // 150 s: exatamente 90 s depois da última batida — ainda no limite
    expect(await verificar()).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(await verificar()).toBe("laco_parado:agendador");
    await vi.advanceTimersByTimeAsync(4 * 15_000);
    expect(sair).toHaveBeenCalledWith(1);
  });

  it("tickPessoa bate depois de CADA rotina, inclusive a que falha", async () => {
    roteiros.set("p1", { rotinas: 4, rotinaMs: () => 1_000, falhar: (i) => i % 2 === 1 });
    const batidas: number[] = [];
    const inicio = Date.now();
    const { abrirTxEscopada } = await import("../../../src/db/tx.ts");
    const feito = tickPessoa({ tenantId: "t", pessoaId: "p1" }, abrirTxEscopada(SEM_BANCO, { tenantId: "t", pessoaId: "p1" }), opcoes(() => batidas.push(Date.now() - inicio)));
    await vi.advanceTimersByTimeAsync(4_000);
    const r = await feito;
    expect(r.falhas).toEqual(["p1-r1", "p1-r3"]);
    expect(batidas).toEqual([1_000, 2_000, 3_000, 4_000]);
  });

  it("paraCadaPessoa bate depois de cada pessoa (com ou sem falha)", async () => {
    for (const id of ["a", "b", "c"]) roteiros.set(id, { rotinas: 0, listarMs: 10_000 });
    const batidas: number[] = [];
    const inicio = Date.now();
    const volta = paraCadaPessoa(
      SEM_BANCO,
      async (escopo, tx) => {
        await tx(async () => undefined);
        if (escopo.pessoaId === "b") throw new Error("falhou");
      },
      { listarPessoas: async () => ["a", "b", "c"].map((id) => ({ tenantId: "t", id })), sortearInicio: () => 0, aoFalhar: () => undefined, aoBater: () => batidas.push(Date.now() - inicio) },
    );
    await vi.advanceTimersByTimeAsync(30_000);
    await volta;
    expect(batidas).toEqual([10_000, 20_000, 30_000]);
  });

  it("6 pessoas com a listagem lenta (30 s cada, sem rotina vencida) → o laço segue saudável", async () => {
    const pessoas = ["a", "b", "c", "d", "e", "f"];
    for (const id of pessoas) roteiros.set(id, { rotinas: 0, listarMs: 30_000 });
    const { verificar, sair } = montar(pessoas);
    for (let t = 0; t < 240_000; t += 5_000) {
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await verificar()).toBeNull();
    }
    expect(sair).not.toHaveBeenCalled();
  });
});
