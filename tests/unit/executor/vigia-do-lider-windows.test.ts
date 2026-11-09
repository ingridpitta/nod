import { describe, expect, it } from "vitest";
import { descendentesDoLider, temFilhoMaisVelhoQueOPai, type ProcessoVisto } from "../../../src/adapters/executor/plataforma.ts";

// Revisão 3 do PR #642 (médio 3): a vigia só anota os filhos do líder quando a própria raiz da foto é o nosso líder.
describe("descendentesDoLider", () => {
  const grupo = { desdeMs: 10_000, ateMs: 10_100 };
  const filhos: ProcessoVisto[] = [{ pid: 11, ppid: 10, inicioMs: 10_500 }, { pid: 12, ppid: 11, inicioMs: 10_600 }];
  it("anota os descendentes quando o líder da foto tem o início do grupo", () => {
    expect(descendentesDoLider(10, grupo, [{ pid: 10, ppid: 1, inicioMs: 10_050 }, ...filhos]).map((p) => p.pid)).toEqual([11, 12]);
  });
  it("pid reaproveitado (outro início): nada", () => {
    expect(descendentesDoLider(10, grupo, [{ pid: 10, ppid: 1, inicioMs: 90_000 }, ...filhos])).toEqual([]);
  });
  it("líder fora da foto: nada", () => {
    expect(descendentesDoLider(10, grupo, filhos)).toEqual([]);
  });
});

// Revisão 4 do PR #642 (médio 4): o `/T` do taskkill segue o ParentProcessId velho.
describe("temFilhoMaisVelhoQueOPai", () => {
  const lider = { pid: 10, ppid: 1, inicioMs: 50_000 };
  it("filho de verdade (nasceu depois): pode usar /T", () => {
    expect(temFilhoMaisVelhoQueOPai(10, [lider, { pid: 11, ppid: 10, inicioMs: 50_100 }])).toBe(false);
  });
  it("processo antigo com o ppid reaproveitado: sem /T", () => {
    expect(temFilhoMaisVelhoQueOPai(10, [lider, { pid: 11, ppid: 10, inicioMs: 1_000 }])).toBe(true);
  });
  it("sem foto do líder: não dá para saber, segue com /T", () => {
    expect(temFilhoMaisVelhoQueOPai(10, [{ pid: 11, ppid: 10, inicioMs: 1_000 }])).toBe(false);
  });
});

describe("taskkill /T e o neto de outro dono (revisão 11 do PR #642, médio 3)", () => {
  it("o neto mais velho que o seu pai (pid reaproveitado no meio) faz a raiz morrer sem /T", () => {
    const foto: ProcessoVisto[] = [
      { pid: 10, ppid: 1, inicioMs: 1000 },
      { pid: 30, ppid: 10, inicioMs: 2000 },
      { pid: 99, ppid: 30, inicioMs: 500 },
    ];
    expect(temFilhoMaisVelhoQueOPai(10, foto)).toBe(true);
  });
  it("a árvore em ordem de nascimento continua com /T", () => {
    expect(temFilhoMaisVelhoQueOPai(10, [{ pid: 10, ppid: 1, inicioMs: 1000 }, { pid: 30, ppid: 10, inicioMs: 2000 }, { pid: 40, ppid: 30, inicioMs: 3000 }])).toBe(false);
  });
});

describe("revisão 12 do PR #642: a árvore só com o líder conferido", () => {
  it("o filho que nasceu antes do pai, mesmo por menos de 1 s, não é descendente (médio E)", async () => {
    const { descendentes } = await import("../../../src/adapters/executor/plataforma.ts");
    const foto: ProcessoVisto[] = [{ pid: 100, ppid: 1, inicioMs: 10_000 }, { pid: 200, ppid: 100, inicioMs: 9_400 }];
    expect(descendentes(100, foto).map((p) => p.pid)).toEqual([]);
    expect(temFilhoMaisVelhoQueOPai(100, foto)).toBe(true);
  });
  it("sem o líder na foto, a raiz morre sem /T (médio F)", async () => {
    const { arvoreDaRaiz } = await import("../../../src/adapters/executor/processo.ts");
    expect(arvoreDaRaiz(100, [])).toEqual({ arvore: false });
    expect(arvoreDaRaiz(100, [{ pid: 7, ppid: 1, inicioMs: 1 }])).toEqual({ arvore: false });
    expect(arvoreDaRaiz(100, [{ pid: 100, ppid: 1, inicioMs: 1 }, { pid: 101, ppid: 100, inicioMs: 2 }])).toEqual({ arvore: true });
  });
  it("revisão 16 do PR #642 (médio 4): com a janela do spawn, o líder com outro início (pid reaproveitado) não leva /T", async () => {
    const { arvoreDaRaiz } = await import("../../../src/adapters/executor/processo.ts");
    const foto = (inicioMs: number): ProcessoVisto[] => [{ pid: 100, ppid: 1, inicioMs }, { pid: 101, ppid: 100, inicioMs: inicioMs + 1 }];
    const janela = { desdeMs: 50_000, ateMs: 50_100 };
    expect(arvoreDaRaiz(100, foto(50_050), janela)).toEqual({ arvore: true });
    expect(arvoreDaRaiz(100, foto(50_100 + 2_000), janela)).toEqual({ arvore: true });
    expect(arvoreDaRaiz(100, foto(50_100 + 2_001), janela)).toEqual({ arvore: false });
    expect(arvoreDaRaiz(100, foto(50_000 - 2_001), janela)).toEqual({ arvore: false });
  });
});

describe("revisão 13 do PR #642: as fotos do Parar têm prazo (C1)", () => {
  it("a foto que demora volta vazia no prazo, e a que falha também", async () => {
    const { fotoComPrazo } = await import("../../../src/adapters/executor/processo.ts");
    const inicio = Date.now();
    expect(await fotoComPrazo(50, () => new Promise(() => {}))).toEqual([]);
    expect(Date.now() - inicio).toBeLessThan(1_000);
    expect(await fotoComPrazo(50, () => Promise.reject(new Error("CIM")))).toEqual([]);
    expect(await fotoComPrazo(1_000, async () => [{ pid: 1, ppid: 0, inicioMs: 1 }])).toEqual([{ pid: 1, ppid: 0, inicioMs: 1 }]);
  });
  it("os prazos somados cabem nos 7 s do critério", async () => {
    const { FOTO_ANTES_DO_T_MS, FOTO_DEPOIS_DO_T_MS } = await import("../../../src/adapters/executor/processo.ts");
    expect(FOTO_ANTES_DO_T_MS + FOTO_DEPOIS_DO_T_MS).toBeLessThanOrEqual(5_000);
  });
});

describe("revisão 14 do PR #642: sem foto, o /T não vai (médio 3)", () => {
  it("o líder fora da foto (o CIM falhou ou demorou) mata só a raiz", async () => {
    const { arvoreDaRaiz } = await import("../../../src/adapters/executor/processo.ts");
    expect(arvoreDaRaiz(100, [])).toEqual({ arvore: false });
    expect(arvoreDaRaiz(100, [{ pid: 7, ppid: 1, inicioMs: 1 }])).toEqual({ arvore: false });
  });
  it("o Parar decide o /T só pelo arvoreDaRaiz, sem atalho para { arvore: true }", async () => {
    const { readFileSync } = await import("node:fs");
    const fonte = readFileSync(new URL("../../../src/adapters/executor/processo.ts", import.meta.url), "utf8");
    const corpo = fonte.slice(fonte.indexOf("const matarArvoreNoWindows"), fonte.indexOf("let stderr"));
    expect(corpo).toContain("matarArvore(pid, { ...arvoreDaRaiz(pid, fotoAntes, meu ?? undefined), prazoMs: TASKKILL_DO_PARAR_MS })");
    // Revisão 16 (médio 5): a foto do Parar leva o prazo ao PowerShell, e os vistos morrem pelo taskkill assíncrono.
    expect(fonte).toContain("() => processosDoWindows({ prazoMs: ms })");
    expect(corpo).toContain("await Promise.all(matar.map((v) => matarArvore(v, { arvore: false, prazoMs: TASKKILL_DO_PARAR_MS })));");
    expect(corpo).not.toContain("arvore: true");
  });
});
