import { describe, expect, it } from "vitest";
import { duracaoMs } from "../../../src/domain/duracao-audio.ts";
import { BYTES_POR_FRAME_128K, m4a, mp3Cbr, mp3Vbri, mp3Xing, mp3XingMono, MS_FRAME_128K, oggOpus, oggOpusUltimaSemGranule, oggVorbis, wav } from "../../fixtures/audio/construir.ts";

describe("duracao-audio: duração pelo cabeçalho (NOD-329)", () => {
  it("wav: byteRate e tamanho do data; data com tamanho 0 usa o resto do arquivo; chunk ímpar antes do data", () => {
    expect(duracaoMs(wav(1500), "audio/wav")).toBe(1500);
    expect(duracaoMs(wav(61_000, 8000), "audio/x-wav")).toBe(61_000);
    expect(duracaoMs(wav(2000, 16_000, { dataTamanhoZero: true }), "audio/wav")).toBe(2000);
    expect(duracaoMs(wav(750, 16_000, { chunkExtra: true }), "audio/wav")).toBe(750);
  });

  it("mp3 CBR: bytes × 8 / bitrate, pulando ID3v2 e ID3v1", () => {
    const esperado = Math.round((100 * BYTES_POR_FRAME_128K * 8 * 1000) / 128_000);
    expect(duracaoMs(mp3Cbr(100), "audio/mpeg")).toBe(esperado);
    expect(duracaoMs(mp3Cbr(100, { id3: true, id3v1: true }), "audio/mpeg")).toBe(esperado);
  });

  it("mp3 VBR: frames do Xing/Info × 1152 / taxa", () => {
    expect(duracaoMs(mp3Xing(2000), "audio/mpeg")).toBe(Math.round(2000 * MS_FRAME_128K));
    expect(duracaoMs(mp3Xing(500, "Info"), "audio/mp3")).toBe(Math.round(500 * MS_FRAME_128K));
    expect(duracaoMs(mp3Vbri(1200), "audio/mpeg")).toBe(Math.round(1200 * MS_FRAME_128K));
  });

  it("mp3 VBR mono (QA NOD-329): Xing depois do side info de 17 (MPEG1) e de 9 bytes (MPEG2, 576 amostras, o mp3 de 24 kHz do TTS)", () => {
    expect(duracaoMs(mp3XingMono(2000, "mpeg1"), "audio/mpeg")).toBe(Math.round(2000 * MS_FRAME_128K));
    expect(duracaoMs(mp3XingMono(1000, "mpeg2"), "audio/mpeg")).toBe(24_000);
    // Xing sem o bit de frames: não dá para confiar na contagem, cai no CBR (bytes × 8 / bitrate)
    const semFrames = mp3XingMono(1000, "mpeg2", { semFrames: true });
    expect(duracaoMs(semFrames, "audio/mpeg")).toBe(Math.round((semFrames.length * 8 * 1000) / 32_000));
  });

  it("m4a: moov/mvhd versão 0 e 1", () => {
    expect(duracaoMs(m4a(12_340), "audio/mp4")).toBe(12_340);
    expect(duracaoMs(m4a(90_000, 1), "audio/x-m4a")).toBe(90_000);
  });

  it("ogg: granule da última página (Opus menos o pre-skip; Vorbis pela taxa)", () => {
    expect(duracaoMs(oggOpus(3210), "audio/ogg")).toBe(3210);
    expect(duracaoMs(oggVorbis(45_000), "audio/ogg")).toBe(45_000);
    // QA NOD-329: última página com granule -1 (pacote que continua) é pulada; vale a anterior
    expect(duracaoMs(oggOpusUltimaSemGranule(3210), "audio/ogg")).toBe(3210);
  });

  it("mime desconhecido fareja pelo cabeçalho; mime com parâmetros", () => {
    expect(duracaoMs(wav(1000), "application/octet-stream")).toBe(1000);
    expect(duracaoMs(oggOpus(500), "")).toBe(500);
    expect(duracaoMs(m4a(800), "")).toBe(800);
    expect(duracaoMs(oggOpus(500), "audio/ogg; codecs=opus")).toBe(500);
  });

  it("sem certeza devolve null: lixo, vazio, truncado, ogg sem cabeçalho conhecido", () => {
    expect(duracaoMs(new Uint8Array(0), "audio/wav")).toBeNull();
    expect(duracaoMs(Uint8Array.from("isto não é áudio", (c) => c.charCodeAt(0) & 0xff), "audio/mpeg")).toBeNull();
    expect(duracaoMs(Uint8Array.from("isto não é áudio", (c) => c.charCodeAt(0) & 0xff), "application/octet-stream")).toBeNull();
    expect(duracaoMs(wav(1000).slice(0, 30), "audio/wav")).toBeNull();
    expect(duracaoMs(m4a(1000).slice(0, 40), "audio/mp4")).toBeNull();
    const ogg = oggOpus(1000);
    ogg.set(Uint8Array.from("XXXXXXXX", (c) => c.charCodeAt(0)), 28);
    expect(duracaoMs(ogg, "audio/ogg")).toBeNull();
  });
});
