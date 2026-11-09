import { describe, expect, it, vi } from "vitest";
import {
  BARRAS_ONDA,
  barrasPlanas,
  criarCacheDeOndas,
  decodificadorDoNavegador,
  LIMITE_BYTES_ONDA,
  picos,
  picosDeCanais,
  PISO_ONDA,
  TAXA_ONDA_HZ,
  type Decodificador,
} from "../../../web/lib/onda.ts";

/** Decodificador falso: devolve os canais dados, como o AudioBuffer faria. */
function decodificadorDe(...canais: Float32Array[]): Decodificador {
  return async () => ({
    numberOfChannels: canais.length,
    length: canais[0]?.length ?? 0,
    getChannelData: (c: number) => canais[c] ?? new Float32Array(0),
  });
}
/** Rampa: amostra i vale i/total, então o pico de cada balde cresce. */
const rampa = (total: number) =>
  Float32Array.from(
    { length: total },
    (_, i) => (i % 2 === 0 ? 1 : -1) * (i / total),
  );
const buf = (n = 100) => new ArrayBuffer(n);

describe("onda do memo (NOD-329)", () => {
  it("48 barras por padrão, normalizadas para piso..1, com a maior em 1", async () => {
    const barras = await picos(
      buf(),
      undefined,
      decodificadorDe(rampa(48 * 100)),
    );
    expect(barras).toHaveLength(BARRAS_ONDA);
    expect(barras.at(-1)).toBe(1);
    expect(Math.min(...barras)).toBe(PISO_ONDA);
    expect(barras.every((b, i) => i === 0 || b >= (barras[i - 1] ?? 0))).toBe(
      true,
    );
  });

  it("pico absoluto por balde, no canal mais alto; menos amostras que barras não quebra", () => {
    const esquerdo = new Float32Array([0, 0, -0.5, 0, 0, 0, 0, 1]);
    const direito = new Float32Array([0, 0, -0.5, 0, 0, 0, 0, 0]);
    expect(picosDeCanais([esquerdo, direito], 4)).toEqual([
      PISO_ONDA,
      0.5,
      PISO_ONDA,
      1,
    ]);
    expect(picosDeCanais([new Float32Array([0.2, 0.4])], 4)).toHaveLength(4);
    expect(picosDeCanais([new Float32Array([1])], 0)).toEqual([]);
  });

  it("QA NOD-329: estéreo com fase invertida não sai plano (o pico é o do canal mais alto, não o da média)", () => {
    const l = rampa(48 * 100);
    const r = l.map((v) => -v);
    const barras = picosDeCanais([l, r]);
    expect(barras).toEqual(picosDeCanais([l]));
    expect(barras.at(-1)).toBe(1);
    expect(barras).not.toEqual(barrasPlanas());
  });

  it("falha ao decodificar, silêncio, vazio, acima de 10 MB e navegador sem OfflineAudioContext → planas", async () => {
    const planas = barrasPlanas();
    expect(planas).toEqual(new Array(48).fill(PISO_ONDA));
    const falha: Decodificador = async () => {
      throw new DOMException("formato", "EncodingError");
    };
    expect(await picos(buf(), 48, falha)).toEqual(planas);
    expect(
      await picos(buf(), 48, decodificadorDe(new Float32Array(1000))),
    ).toEqual(planas);
    expect(await picos(buf(0), 48, decodificadorDe(rampa(100)))).toEqual(
      planas,
    );
    const grande = vi.fn(decodificadorDe(rampa(100)));
    expect(await picos(buf(LIMITE_BYTES_ONDA + 1), 48, grande)).toEqual(planas);
    expect(grande).not.toHaveBeenCalled();
    // QA NOD-329: exatamente 10 MB ainda decodifica (o corte é acima)
    await picos(buf(LIMITE_BYTES_ONDA), 48, grande);
    expect(grande).toHaveBeenCalledTimes(1);
    expect(await picos(buf(), 48, null)).toEqual(planas);
    expect(decodificadorDoNavegador()).toBeNull(); // node: sem Web Audio
  });

  it("decodifica com OfflineAudioContext(1, 1, 8000) e não desanexa o buffer de quem chamou", async () => {
    const criados: unknown[][] = [];
    const recebidos: ArrayBuffer[] = [];
    class OfflineFalso {
      constructor(...args: unknown[]) {
        criados.push(args);
      }
      async decodeAudioData(b: ArrayBuffer) {
        recebidos.push(b);
        return {
          numberOfChannels: 1,
          length: 4,
          getChannelData: () => new Float32Array([0, 1, 0, 0.5]),
        };
      }
    }
    vi.stubGlobal("OfflineAudioContext", OfflineFalso);
    try {
      const original = buf(16);
      const barras = await picos(original, 2);
      expect(criados).toEqual([[1, 1, TAXA_ONDA_HZ]]);
      expect(recebidos[0]).not.toBe(original);
      expect(original.byteLength).toBe(16);
      expect(barras).toEqual([1, 0.5]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("cache por anexo: um carregamento por anexo, pedido em voo compartilhado, falha não fica guardada, teto de entradas", async () => {
    const cache = criarCacheDeOndas({
      decodificar: decodificadorDe(rampa(480)),
      max: 2,
    });
    const carregar = vi.fn(async () => buf());
    const [a, b] = await Promise.all([
      cache.doAnexo("a1", carregar),
      cache.doAnexo("a1", carregar),
    ]);
    expect(a).toBe(b);
    expect(await cache.doAnexo("a1", carregar)).toBe(a);
    expect(carregar).toHaveBeenCalledTimes(1);
    expect(cache.pronta("a1")).toBe(a);

    const rede = vi.fn(async (): Promise<ArrayBuffer> => {
      throw new TypeError("fetch failed");
    });
    expect(await cache.doAnexo("a2", rede)).toEqual(barrasPlanas());
    expect(cache.pronta("a2")).toBeNull();
    await cache.doAnexo("a2", rede);
    expect(rede).toHaveBeenCalledTimes(2);

    await cache.doAnexo("a3", carregar);
    await cache.doAnexo("a4", carregar);
    expect(cache.tamanho).toBe(2);
    expect(cache.pronta("a1")).toBeNull();

    // decodificação que falha também não fica: o próximo render tenta de novo
    const ruim = criarCacheDeOndas({
      decodificar: async () => Promise.reject(new Error("x")),
    });
    await ruim.doAnexo("z", carregar);
    expect(ruim.pronta("z")).toBeNull();
    // áudio mudo é resultado de verdade: fica
    const mudo = criarCacheDeOndas({
      decodificar: decodificadorDe(new Float32Array(100)),
    });
    await mudo.doAnexo("m", carregar);
    expect(mudo.pronta("m")).toEqual(barrasPlanas());
  });
});
