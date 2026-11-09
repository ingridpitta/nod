import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Computador, DriverComputador } from "../../../src/contracts/computador.ts";
import { criarComputadores } from "../../../src/adapters/fundo/computadores.ts";
import { MARLON } from "../use-cases/deps-l5.ts";

/**
 * NOD-433: a ociosidade no docker por bot. Os `parar` vão um depois do outro: a reserva dos computadores que ainda esperam
 * a vez é renovada (senão pareceria órfã em 15 s) e só se é dela; e a liberação que falha num não prende os seguintes.
 */
const T0 = 1_700_000_000_000;
const LIMITE = 15 * 60_000;
let agora: number;
let linhas: Map<string, Computador>;
let aoParar: ((id: string) => Promise<void>) | null;
let liberarFalha: Set<string>;

const pc = (id: string): Computador => ({ id, agenteId: `agente-${id}`, habilitado: true, controle: "bot", operacaoId: null, ocupadoAte: null, ultimaAtividadeEm: T0 - LIMITE - 1 } as unknown as Computador);
const driver = { parar: async (id: string) => { await aoParar?.(id); } } as unknown as DriverComputador;
const deps = () => ({
  escopo: MARLON,
  agora: () => agora,
  repos: {
    computadores: {
      ociosos: async (_l: number, _a: number, id?: string) => [...linhas.values()].filter((c) => (!id || c.id === id) && (!c.ocupadoAte || c.ocupadoAte <= agora)),
      travar: async (id: string) => linhas.get(id) ?? null,
      ocupar: async (id: string, operacaoId: string, ate: number) => { linhas.set(id, { ...linhas.get(id)!, operacaoId, ocupadoAte: ate }); },
      liberar: async (id: string, operacaoId: string) => {
        if (liberarFalha.has(id)) throw new Error("banco caiu");
        const c = linhas.get(id)!;
        if (c.operacaoId === operacaoId) linhas.set(id, { ...c, operacaoId: null, ocupadoAte: null });
      },
    },
  },
});
const computadores = criarComputadores({
  executor: () => "catcher", porPessoa: false, driver, cifrar: (s: string) => s, decifrar: (s: string) => s, mudou: () => {}, agora: () => agora,
  dentro: async <T>(_e: unknown, fn: (d: never) => Promise<T>) => fn(deps() as never),
  dormir: async () => {},
} as never);

beforeEach(() => {
  agora = T0;
  linhas = new Map([pc("c1"), pc("c2")].map((c) => [c.id, c]));
  aoParar = null;
  liberarFalha = new Set();
});
afterEach(() => { vi.useRealTimers(); });

it("renova a reserva dos que esperam enquanto o primeiro para; a que outra operação tomou não é renovada nem desligada (revisão r5)", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  linhas.set("c3", pc("c3"));
  const OUTRA = "00000000-0000-8000-8000-0000000000cc";
  const paradas: string[] = [];
  let renovada: number | null = null;
  let depoisDaPerda: number | null = null;
  aoParar = async (id) => {
    paradas.push(id);
    if (id !== "c1") return;
    agora += 20_000;
    await vi.advanceTimersByTimeAsync(5_000);
    renovada = linhas.get("c2")!.ocupadoAte;
    // Outra operação toma o c2; a renovação o solta, mas segue segurando o c3 nas voltas seguintes.
    linhas.set("c2", { ...linhas.get("c2")!, operacaoId: OUTRA, ocupadoAte: agora + 1_000 });
    agora += 5_000;
    await vi.advanceTimersByTimeAsync(5_000);
    agora += 5_000;
    await vi.advanceTimersByTimeAsync(5_000);
    depoisDaPerda = linhas.get("c3")!.ocupadoAte;
  };
  expect(await computadores.desligarOciosos(MARLON, new Set(["c1", "c2", "c3"]), LIMITE)).toBe(2);
  expect(renovada).toBe(T0 + 20_000 + 300_000);
  expect(depoisDaPerda).toBe(agora + 300_000);
  expect(paradas).toEqual(["c1", "c3"]);
  expect(linhas.get("c2")).toMatchObject({ operacaoId: OUTRA, ocupadoAte: agora + 1_000 - 10_000 });
  expect(linhas.get("c3")).toMatchObject({ operacaoId: null, ocupadoAte: null });
  expect(vi.getTimerCount()).toBe(0);
});

it("a reserva tomada sem tique de renovação no meio também não é desligada: confere no banco antes do parar (revisão r5)", async () => {
  const OUTRA = "00000000-0000-8000-8000-0000000000cc";
  const paradas: string[] = [];
  aoParar = async (id) => {
    paradas.push(id);
    if (id === "c1") linhas.set("c2", { ...linhas.get("c2")!, operacaoId: OUTRA, ocupadoAte: agora + 300_000 });
  };
  expect(await computadores.desligarOciosos(MARLON, new Set(["c1", "c2"]), LIMITE)).toBe(1);
  expect(paradas).toEqual(["c1"]);
  expect(linhas.get("c2")!.operacaoId).toBe(OUTRA);
});

it("a liberação que falha num computador não deixa os seguintes reservados", async () => {
  liberarFalha.add("c1");
  expect(await computadores.desligarOciosos(MARLON, new Set(["c1", "c2"]), LIMITE)).toBe(2);
  expect(linhas.get("c2")).toMatchObject({ operacaoId: null, ocupadoAte: null });
});
