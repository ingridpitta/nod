import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";

// Diretório próprio: outras execuções em paralelo na máquina também criam nod-say-* no tmpdir do sistema.
const DIR = mkdtempSync(join(tmpdir(), "teste-say-"));
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { criarSintetizadorSay, palavrasPorMinuto } from "../../../src/adapters/voz/local-say.ts";

const ehMac = process.platform === "darwin";

/**
 * NOD-194: o `say` de verdade tem prazo de 30 s por síntese (TIMEOUT_SAY_MS em local-say.ts). Com o Mac em load
 * ~1000 (duas `test:unit` em paralelo), "1,5x sai mais curto que 1x" (duas sínteses em sequência) passou dos
 * 20 s fixos (medido em 2026-10-07). O teto do teste cobre duas sínteses no prazo do código, mais folga.
 */
const UMA_SINTESE_MS = 30_000;
const SAY = { timeout: 2 * UMA_SINTESE_MS + 10_000 };

async function temporariosDoSay(): Promise<string[]> {
  return (await readdir(DIR)).filter((f) => f.startsWith("nod-say-"));
}

describe("voz: say do macOS", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("velocidade vira palavras por minuto: 1→185, 1,25→230, 1,5→275", () => {
    expect([1, 1.25, 1.5].map(palavrasPorMinuto)).toEqual([185, 230, 275]);
    expect(palavrasPorMinuto(Number.NaN)).toBe(185);
  });

  it("binário ausente é configuração", async () => {
    const tts = criarSintetizadorSay({ bin: "/caminho/que/nao/existe/say" });
    const it = tts.sintetizar({ texto: "oi", voz: "clara", velocidade: 1 })[Symbol.asyncIterator]();
    await expect(it.next()).rejects.toThrow("integracao_nao_configurada");
  });

  it.skipIf(!ehMac)("gera PCM 24 kHz de verdade em pedaços de 100 ms e apaga os temporários", SAY, async () => {
    const antes = await temporariosDoSay();
    const tts = criarSintetizadorSay({ dirBase: DIR });
    const pedacos: Int16Array[] = [];
    // texto que começa com "-" prova que vai por arquivo, não por argumento
    for await (const p of tts.sintetizar({ texto: "-v Oi, tudo bem? Aqui é a Clara, do nod.", voz: "clara", velocidade: 1 })) pedacos.push(p);
    const total = pedacos.reduce((n, p) => n + p.length, 0);
    expect(total / 24_000).toBeGreaterThan(1);
    expect(total / 24_000).toBeLessThan(10);
    expect(pedacos.slice(0, -1).every((p) => p.length === 2400)).toBe(true);
    expect(pedacos.some((p) => p.some((v) => Math.abs(v) > 1000))).toBe(true);
    expect(await temporariosDoSay()).toEqual(antes);
  });

  it.skipIf(!ehMac)("1,5x sai mais curto que 1x", SAY, async () => {
    const tts = criarSintetizadorSay({ dirBase: DIR });
    const medir = async (velocidade: number) => {
      let n = 0;
      for await (const p of tts.sintetizar({ texto: "Tô montando a rotina, já te aviso quando terminar.", voz: "bento", velocidade })) n += p.length;
      return n;
    };
    expect(await medir(1.5)).toBeLessThan((await medir(1)) * 0.85);
  });

  it.skipIf(!ehMac)("o sinal mata o processo e apaga os temporários", SAY, async () => {
    const antes = await temporariosDoSay();
    const tts = criarSintetizadorSay({ dirBase: DIR });
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 30);
    const pedacos: Int16Array[] = [];
    for await (const p of tts.sintetizar({ texto: "Uma frase bem comprida ".repeat(40), voz: "clara", velocidade: 1, sinal: ac.signal })) pedacos.push(p);
    expect(pedacos).toEqual([]);
    expect(await temporariosDoSay()).toEqual(antes);
  });
});
