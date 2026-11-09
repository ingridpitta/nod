import { describe, expect, it } from "vitest";
import { bytesParaPcm, concatenar, duracaoMs, fatiar, lerWav, misturarParaMono, montarWav, pcmParaBytes, reamostrar, rms, silencio } from "../../../src/adapters/voz/audio.ts";

function chunk(id: string, dados: Buffer): Buffer {
  const cab = Buffer.alloc(8);
  cab.write(id, 0, "ascii");
  cab.writeUInt32LE(dados.length, 4);
  return Buffer.concat([cab, dados, dados.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}

function fmt(taxa: number, canais: number, bits = 16, formato = 1): Buffer {
  const b = Buffer.alloc(16);
  b.writeUInt16LE(formato, 0);
  b.writeUInt16LE(canais, 2);
  b.writeUInt32LE(taxa, 4);
  b.writeUInt32LE(taxa * canais * (bits / 8), 8);
  b.writeUInt16LE(canais * (bits / 8), 12);
  b.writeUInt16LE(bits, 14);
  return b;
}

function riff(...chunks: Buffer[]): Buffer {
  const corpo = Buffer.concat([Buffer.from("WAVE", "ascii"), ...chunks]);
  const cab = Buffer.alloc(8);
  cab.write("RIFF", 0, "ascii");
  cab.writeUInt32LE(corpo.length, 4);
  return Buffer.concat([cab, corpo]);
}

describe("voz: audio", () => {
  it("montarWav e lerWav fazem ida e volta", () => {
    const pcm = Int16Array.from([0, 1, -1, 32767, -32768, 1234]);
    const wav = lerWav(montarWav(pcm, 16_000));
    expect(wav).toEqual({ taxa: 16_000, canais: 1, pcm });
  });

  it("lerWav pula chunks extras (LIST, FLLR, ímpar com enchimento) antes e depois do fmt", () => {
    const dados = pcmParaBytes(Int16Array.from([10, -20, 30]));
    const wav = riff(chunk("LIST", Buffer.from("abc")), chunk("fmt ", fmt(24_000, 1)), chunk("FLLR", Buffer.alloc(10)), chunk("data", dados));
    expect(lerWav(wav)).toEqual({ taxa: 24_000, canais: 1, pcm: Int16Array.from([10, -20, 30]) });
  });

  it("lerWav aceita data antes do fmt e data com tamanho de streaming (0xFFFFFFFF)", () => {
    const dados = pcmParaBytes(Int16Array.from([5, 6]));
    const dataStreaming = Buffer.concat([Buffer.from("data", "ascii"), Buffer.from([0xff, 0xff, 0xff, 0xff]), dados]);
    expect(lerWav(riff(chunk("fmt ", fmt(16_000, 1)), dataStreaming)).pcm).toEqual(Int16Array.from([5, 6]));
    expect(lerWav(riff(chunk("data", dados), chunk("fmt ", fmt(8_000, 2)))).taxa).toBe(8_000);
  });

  it("lerWav recusa o que não é PCM16", () => {
    expect(() => lerWav(Buffer.from("não é wav"))).toThrow("entrada_invalida");
    expect(() => lerWav(riff(chunk("fmt ", fmt(16_000, 1, 8)), chunk("data", Buffer.alloc(4))))).toThrow("entrada_invalida");
    expect(() => lerWav(riff(chunk("fmt ", fmt(16_000, 1, 16, 3)), chunk("data", Buffer.alloc(4))))).toThrow("entrada_invalida");
    expect(() => lerWav(riff(chunk("fmt ", fmt(16_000, 1))))).toThrow("entrada_invalida");
  });

  it("bytesParaPcm lê de Buffer desalinhado", () => {
    const b = Buffer.alloc(7);
    b.writeInt16LE(-2, 1);
    b.writeInt16LE(300, 3);
    expect(bytesParaPcm(b.subarray(1, 5))).toEqual(Int16Array.from([-2, 300]));
  });

  it("reamostrar muda o tamanho na proporção e preserva um sinal constante", () => {
    const pcm = new Int16Array(1600).fill(1000);
    const r = reamostrar(pcm, 16_000, 24_000);
    expect(r.length).toBe(2400);
    expect(r.every((v) => v === 1000)).toBe(true);
    expect(reamostrar(pcm, 24_000, 16_000).length).toBe(1067);
    expect(reamostrar(Int16Array.from([0, 100]), 1, 2)).toEqual(Int16Array.from([0, 50, 100, 100]));
    expect(() => reamostrar(pcm, 0, 16_000)).toThrow("entrada_invalida");
  });

  it("misturarParaMono tira a média dos canais intercalados", () => {
    expect(misturarParaMono(Int16Array.from([100, 300, -10, 10]), 2)).toEqual(Int16Array.from([200, 0]));
    expect(misturarParaMono(Int16Array.from([1, 2]), 1)).toEqual(Int16Array.from([1, 2]));
  });

  it("fatiar, silencio, duracaoMs, rms e concatenar", () => {
    const pcm = new Int16Array(250);
    expect(fatiar(pcm, 100).map((p) => p.length)).toEqual([100, 100, 50]);
    expect(silencio(100, 24_000).length).toBe(2400);
    expect(duracaoMs(new Int16Array(320), 16_000)).toBe(20);
    expect(rms(new Int16Array(10).fill(-500))).toBe(500);
    expect(rms(new Int16Array(0))).toBe(0);
    expect(concatenar([Int16Array.from([1]), Int16Array.from([2, 3])])).toEqual(Int16Array.from([1, 2, 3]));
    expect(() => fatiar(pcm, 0)).toThrow("entrada_invalida");
  });
});
