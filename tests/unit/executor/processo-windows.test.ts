import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProcessoVisto } from "../../../src/adapters/executor/plataforma.ts";

/**
 * ADA-11 (ADR-147), revisão do PR #642: o caminho Windows do processo.ts, com a plataforma fingida e o taskkill e a foto
 * do CIM simulados (o filho é um node de verdade). Prova a ordem do Parar (raiz com /T antes de qualquer foto, M1), que um
 * visto só morre com o início batendo e sem /T, e que o líder que já saiu nunca leva taskkill (pid reaproveitado, A1).
 */
const eventos: string[] = [];
let foto: ProcessoVisto[] = [];
let fotoSync: ProcessoVisto[] = [];
let segurarFoto: Promise<void> | null = null;

vi.mock("../../../src/adapters/executor/plataforma.ts", async (original) => {
  const real = await original<typeof import("../../../src/adapters/executor/plataforma.ts")>();
  return {
    ...real,
    resolverBinario: (bin: string) => ({ bin, args: [] }),
    processosDoWindows: async () => {
      eventos.push("foto");
      if (segurarFoto) await segurarFoto;
      return foto;
    },
    processosDoWindowsSync: () => {
      eventos.push("foto-sync");
      return fotoSync;
    },
    matarArvoreSync: (pid: number, o: { arvore?: boolean } = {}) => {
      eventos.push(`kill ${pid}${o.arvore === false ? "" : " /T"}`);
    },
    matarArvore: async (pid: number, o: { arvore?: boolean } = {}) => {
      eventos.push(`kill ${pid}${o.arvore === false ? "" : " /T"}`);
    },
  };
});

const { iniciarProcesso, encerrarGruposVivos, registrarGruposEm, decidirVistos, arvoreDaRaiz, VIGIA_DE_DESCENDENTES_MS } = await import("../../../src/adapters/executor/processo.ts");
const { lerArquivoDeGrupos } = await import("../../../src/adapters/executor/grupos-orfaos.ts");
const { mkdtempSync, writeFileSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");

const plataformaReal = process.platform;
beforeAll(() => Object.defineProperty(process, "platform", { value: "win32" }));
afterAll(() => Object.defineProperty(process, "platform", { value: plataformaReal }));
beforeEach(() => {
  eventos.length = 0;
  foto = [];
  fotoSync = [];
  segurarFoto = null;
});

const env = (): Record<string, string> => Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined));
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const NETO = 999_991;
const REUSADO = 999_992;

describe("processo no Windows (ADR-147, revisão do PR #642)", () => {
  it("o Parar manda /T na raiz antes da foto; visto só morre com o início batendo, e sem /T", { timeout: 20_000 }, async () => {
    const p = iniciarProcesso({ bin: process.execPath, args: ["-e", "setInterval(() => {}, 1000)"], env: env(), cwd: process.cwd(), aoLinha: () => undefined, sigtermParaSigkillMs: 200, repartir: false });
    const pid = p.pid!;
    const t = Date.now();
    foto = [{ pid, ppid: process.pid, inicioMs: t }, { pid: NETO, ppid: pid, inicioMs: t + 100 }, { pid: REUSADO, ppid: NETO, inicioMs: t + 200 }];
    await esperar(VIGIA_DE_DESCENDENTES_MS + 600); // a vigia viu os dois
    eventos.length = 0;
    // No Parar o REUSADO aparece com outro início: o pid é de outro processo agora.
    foto = [{ pid: NETO, ppid: 1, inicioMs: t + 100 }, { pid: REUSADO, ppid: 1, inicioMs: t + 60_000 }];
    await p.interromper();
    expect(eventos.slice(0, 3)).toEqual([`kill ${pid} /T`, "foto", `kill ${NETO}`]);
    expect(eventos).not.toContain(`kill ${REUSADO}`);
    expect(eventos).not.toContain(`kill ${REUSADO} /T`);
  });

  it("o líder que já saiu não leva taskkill no exit do nod, nem enquanto a foto dos vistos não volta", { timeout: 20_000 }, async () => {
    let soltar!: () => void;
    const p = iniciarProcesso({ bin: process.execPath, args: ["-e", `setTimeout(() => {}, ${VIGIA_DE_DESCENDENTES_MS + 1_500})`], env: env(), cwd: process.cwd(), aoLinha: () => undefined, repartir: false });
    const pid = p.pid!;
    const t = Date.now();
    foto = [{ pid, ppid: process.pid, inicioMs: t }, { pid: NETO, ppid: pid, inicioMs: t + 100 }];
    await esperar(VIGIA_DE_DESCENDENTES_MS + 600);
    // A foto pedida no fim do líder fica presa: a janela em que o pid dele pode ser de outro.
    segurarFoto = new Promise((r) => { soltar = () => r(); });
    await p.fim;
    await esperar(50);
    eventos.length = 0;
    fotoSync = [{ pid, ppid: 1, inicioMs: t + 60_000 }, { pid: NETO, ppid: 1, inicioMs: t + 100 }];
    encerrarGruposVivos();
    expect(eventos).toEqual(["foto-sync", `kill ${NETO}`]);
    soltar();
  });
});

describe("QA do PR #642 (médio): o Parar depois do exit do líder não manda taskkill na raiz", () => {
  it("o líder saiu (um neto segura o stdout): a raiz não leva taskkill, nem com /T", { timeout: 20_000 }, async () => {
    // O líder sai na hora e deixa um neto com o stdout herdado: o `exit` chega, o `close` não.
    const neto = "require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 3000)'], { stdio: 'inherit' }).unref()";
    const p = iniciarProcesso({ bin: process.execPath, args: ["-e", neto], env: env(), cwd: process.cwd(), aoLinha: () => undefined, sigtermParaSigkillMs: 200, repartir: false });
    const pid = p.pid!;
    foto = [{ pid: NETO, ppid: 1, inicioMs: Date.now() }];
    await esperar(800); // o líder já saiu
    eventos.length = 0;
    await p.interromper();
    expect(eventos).not.toContain(`kill ${pid} /T`);
    expect(eventos).not.toContain(`kill ${pid}`);
  });
});

describe("QA do PR #642 (M10): a raiz com um filho mais velho que ela não leva /T", () => {
  it("arvoreDaRaiz só dá /T à raiz viva sem filho mais velho (o pid dela foi reaproveitado)", () => {
    const raiz = { pid: 10, ppid: 1, inicioMs: 5_000 };
    expect(arvoreDaRaiz(10, [raiz, { pid: 11, ppid: 10, inicioMs: 6_000 }])).toEqual({ arvore: true });
    expect(arvoreDaRaiz(10, [raiz, { pid: 11, ppid: 10, inicioMs: 1_000 }])).toEqual({ arvore: false });
  });
});

describe("revisão 16 do PR #642 (médio 4): o exit do nod confere o início do líder antes do /T", () => {
  it("o pid do líder na foto com outro início (reaproveitado) morre sem /T", { timeout: 20_000 }, async () => {
    const p = iniciarProcesso({ bin: process.execPath, args: ["-e", "setInterval(() => {}, 1000)"], env: env(), cwd: process.cwd(), aoLinha: () => undefined, repartir: false });
    const pid = p.pid!;
    const t = Date.now();
    foto = [{ pid, ppid: process.pid, inicioMs: t }, { pid: NETO, ppid: pid, inicioMs: t + 100 }];
    await esperar(VIGIA_DE_DESCENDENTES_MS + 600);
    eventos.length = 0;
    fotoSync = [{ pid, ppid: 1, inicioMs: t + 60_000 }, { pid: NETO, ppid: 1, inicioMs: t + 100 }];
    encerrarGruposVivos();
    expect(eventos).toContain(`kill ${pid}`);
    expect(eventos).not.toContain(`kill ${pid} /T`);
    await p.interromper();
  });
});

describe("revisão 14 do PR #642 (M1): sem foto, os vistos não saem do arquivo", () => {
  const vistosNoArquivo = (arquivo: string) => lerArquivoDeGrupos(arquivo).grupos.flatMap((g) => (g.vistos ?? []).map((v) => v.pid));

  it("decidirVistos: só solta com foto (ou sem visto) e nunca mata o líder", () => {
    expect(decidirVistos(10, [{ pid: 11, inicioMs: 5 }], [])).toEqual({ matar: [], soltar: false });
    expect(decidirVistos(10, [], [])).toEqual({ matar: [], soltar: true });
    expect(decidirVistos(10, [{ pid: 10, inicioMs: 1 }, { pid: 11, inicioMs: 5 }], [{ pid: 10, ppid: 1, inicioMs: 1 }, { pid: 11, ppid: 1, inicioMs: 5 }])).toEqual({ matar: [11], soltar: true });
  });

  it("o Parar com a foto falhando deixa o grupo e os vistos no arquivo para o boot", { timeout: 20_000 }, async () => {
    const arquivo = join(mkdtempSync(join(tmpdir(), "nod-r14-")), "grupos.json");
    registrarGruposEm(arquivo);
    try {
      const p = iniciarProcesso({ bin: process.execPath, args: ["-e", "setInterval(() => {}, 1000)"], env: env(), cwd: process.cwd(), aoLinha: () => undefined, sigtermParaSigkillMs: 200, repartir: false });
      const pid = p.pid!;
      const t = Date.now();
      foto = [{ pid, ppid: process.pid, inicioMs: t }, { pid: NETO, ppid: pid, inicioMs: t + 100 }];
      await esperar(VIGIA_DE_DESCENDENTES_MS + 600);
      expect(vistosNoArquivo(arquivo)).toContain(NETO);
      foto = []; // o CIM falha a partir daqui
      await p.interromper();
      await esperar(100);
      expect(eventos).not.toContain(`kill ${NETO}`);
      expect(vistosNoArquivo(arquivo)).toContain(NETO);
      // O exit do nod também sem foto: o grupo continua anotado.
      fotoSync = [];
      encerrarGruposVivos();
      expect(vistosNoArquivo(arquivo)).toContain(NETO);
      // Com a foto de volta, o exit confere, mata o visto e esvazia o arquivo.
      eventos.length = 0;
      fotoSync = [{ pid: NETO, ppid: 1, inicioMs: t + 100 }];
      encerrarGruposVivos();
      expect(eventos).toContain(`kill ${NETO}`);
      expect(eventos).not.toContain(`kill ${pid} /T`);
      expect(vistosNoArquivo(arquivo)).toEqual([]);
    } finally {
      encerrarGruposVivos();
      registrarGruposEm(null);
    }
  });

  it("o líder que sai sozinho com a foto falhando não apaga os vistos do arquivo", { timeout: 20_000 }, async () => {
    const arquivo = join(mkdtempSync(join(tmpdir(), "nod-r14-")), "grupos.json");
    registrarGruposEm(arquivo);
    try {
      const p = iniciarProcesso({ bin: process.execPath, args: ["-e", `setTimeout(() => {}, ${VIGIA_DE_DESCENDENTES_MS + 1_500})`], env: env(), cwd: process.cwd(), aoLinha: () => undefined, repartir: false });
      const pid = p.pid!;
      const t = Date.now();
      foto = [{ pid, ppid: process.pid, inicioMs: t }, { pid: NETO, ppid: pid, inicioMs: t + 100 }];
      await esperar(VIGIA_DE_DESCENDENTES_MS + 600);
      foto = [];
      await p.fim;
      await esperar(100);
      expect(vistosNoArquivo(arquivo)).toContain(NETO);
    } finally {
      fotoSync = [];
      encerrarGruposVivos();
      registrarGruposEm(null);
    }
  });

  it("o arquivo com vistos corrompidos não derruba a leitura (B3)", () => {
    const arquivo = join(mkdtempSync(join(tmpdir(), "nod-r14-")), "grupos.json");
    writeFileSync(arquivo, JSON.stringify({ dono: null, grupos: [{ pid: 50, desdeMs: 1, ateMs: 2, programa: "claude", marca: "", vistos: {} }, { pid: 51, desdeMs: 1, ateMs: 2, programa: "claude", marca: "", vistos: [{ pid: "x" }, { pid: 52, inicioMs: 3 }] }] }));
    const lido = lerArquivoDeGrupos(arquivo);
    expect(lido.grupos.map((g) => g.vistos)).toEqual([[], [{ pid: 52, inicioMs: 3 }]]);
  });
});
