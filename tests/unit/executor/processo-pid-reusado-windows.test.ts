import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ProcessoVisto } from "../../../src/adapters/executor/plataforma.ts";

/**
 * Revisão 14b do PR #642 (M1): no Windows o pid fica livre logo no `exit`. O `interromper()` tardio do turno A (o codex
 * chama em todo `finally`) não pode matar os vistos nem soltar o registro do turno B que herdou o mesmo pid.
 */
const PID = 424_242;
const NETO_DE_B = 424_243;
const eventos: string[] = [];
let foto: ProcessoVisto[] = [];

type Falso = EventEmitter & { pid: number; stdout: PassThrough; stderr: PassThrough; stdin: PassThrough; kill: (s?: string) => boolean };
const filhos: Falso[] = [];

vi.mock("node:child_process", async (original) => {
  const real = await original<typeof import("node:child_process")>();
  return {
    ...real,
    spawn: () => {
      const f = Object.assign(new EventEmitter(), { pid: PID, stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill: () => true }) as Falso;
      filhos.push(f);
      return f;
    },
  };
});
vi.mock("../../../src/adapters/executor/plataforma.ts", async (original) => {
  const real = await original<typeof import("../../../src/adapters/executor/plataforma.ts")>();
  return {
    ...real,
    resolverBinario: (bin: string) => ({ bin, args: [] }),
    processosDoWindows: async () => foto,
    processosDoWindowsSync: () => foto,
    matarArvoreSync: (pid: number, o: { arvore?: boolean } = {}) => {
      eventos.push(`kill ${pid}${o.arvore === false ? "" : " /T"}`);
    },
    matarArvore: async (pid: number, o: { arvore?: boolean } = {}) => {
      eventos.push(`kill ${pid}${o.arvore === false ? "" : " /T"}`);
    },
  };
});

const { iniciarProcesso, gruposDeProcessoVivos, encerrarGruposVivos, VIGIA_DE_DESCENDENTES_MS } = await import("../../../src/adapters/executor/processo.ts");

const plataformaReal = process.platform;
beforeAll(() => Object.defineProperty(process, "platform", { value: "win32" }));
afterAll(() => {
  encerrarGruposVivos();
  Object.defineProperty(process, "platform", { value: plataformaReal });
});

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sair = (f: Falso) => {
  f.emit("exit", 0, null);
  f.stdout.end();
  f.stderr.end();
  f.emit("close", 0, null);
};

describe("pid reaproveitado no Windows (revisão 14b do PR #642, M1)", () => {
  it("o interromper() tardio do turno A não mata nem solta o turno B com o mesmo pid", { timeout: 20_000 }, async () => {
    const a = iniciarProcesso({ bin: "claude", args: [], env: {}, cwd: process.cwd(), aoLinha: () => undefined, repartir: false });
    sair(filhos[0]!);
    await a.fim;
    await esperar(50);

    const t = Date.now();
    const b = iniciarProcesso({ bin: "codex", args: [], env: {}, cwd: process.cwd(), aoLinha: () => undefined, repartir: false });
    foto = [{ pid: PID, ppid: process.pid, inicioMs: t }, { pid: NETO_DE_B, ppid: PID, inicioMs: t + 100 }];
    await esperar(VIGIA_DE_DESCENDENTES_MS + 600); // a vigia viu o neto de B
    eventos.length = 0;

    await a.interromper();
    expect(eventos).toEqual([]);
    expect(gruposDeProcessoVivos()).toContain(PID);

    // O Parar de B continua levando a árvore dele e o neto visto.
    const parar = b.interromper();
    await esperar(50);
    sair(filhos[1]!);
    await parar;
    expect(eventos).toContain(`kill ${PID} /T`);
    expect(eventos).toContain(`kill ${NETO_DE_B}`);
    expect(gruposDeProcessoVivos()).not.toContain(PID);
  });
});
