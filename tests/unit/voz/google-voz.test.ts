import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { montarWav } from "../../../src/adapters/voz/audio.ts";
import { criarSintetizadorGoogle, URL_TTS_GOOGLE } from "../../../src/adapters/voz/google-voz.ts";

function respostaWav(amostras: number, taxa = 24_000): Response {
  const pcm = new Int16Array(amostras).map((_, i) => i % 100);
  return new Response(JSON.stringify({ audioContent: montarWav(pcm, taxa).toString("base64") }));
}

async function coletar(it: AsyncIterable<Int16Array>): Promise<Int16Array[]> {
  const out: Int16Array[] = [];
  for await (const p of it) out.push(p);
  return out;
}

describe("voz: TTS Chirp 3 HD", () => {
  let saidaLog: MockInstance;
  const linhasLog = () => saidaLog.mock.calls.map((c) => String(c[0])).join("\n");
  beforeEach(() => {
    saidaLog = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("monta o pedido REST com voz, LINEAR16 24 kHz, speakingRate, token e projeto; devolve pedaços de 100 ms", async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(respostaWav(6000));
    const tts = criarSintetizadorGoogle({ token: async () => "tok", projeto: "proj", fetchImpl: f });
    expect(tts.capacidades).toEqual({ streaming: false, velocidade: true });
    const pedacos = await coletar(tts.sintetizar({ texto: "Oi, tudo bem?", voz: "clara", velocidade: 1.25 }));
    expect(pedacos.map((p) => p.length)).toEqual([2400, 2400, 1200]);
    const [url, init] = f.mock.calls[0] ?? [];
    expect(url).toBe(URL_TTS_GOOGLE);
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer tok", "x-goog-user-project": "proj" });
    expect(JSON.parse(String(init?.body))).toEqual({
      input: { text: "Oi, tudo bem?" },
      voice: { languageCode: "pt-BR", name: "pt-BR-Chirp3-HD-Erinome" },
      audioConfig: { audioEncoding: "LINEAR16", sampleRateHertz: 24_000, speakingRate: 1.25 },
    });
  });

  it("sem projeto não manda x-goog-user-project; WAV em outra taxa é reamostrado; resposta crua vira PCM", async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValueOnce(respostaWav(1600, 16_000)).mockResolvedValueOnce(new Response(JSON.stringify({ audioContent: Buffer.alloc(4800).toString("base64") })));
    const tts = criarSintetizadorGoogle({ token: async () => "tok", projeto: null, fetchImpl: f });
    const a = await coletar(tts.sintetizar({ texto: "a", voz: "bento", velocidade: 1 }));
    expect(a.reduce((n, p) => n + p.length, 0)).toBe(2400);
    expect(f.mock.calls[0]?.[1]?.headers).not.toHaveProperty("x-goog-user-project");
    const b = await coletar(tts.sintetizar({ texto: "b", voz: "bento", velocidade: 1 }));
    expect(b.reduce((n, p) => n + p.length, 0)).toBe(2400);
  });

  it("uma nova tentativa em 429/5xx; na segunda falha, conector_indisponivel", async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("", { status: 429 })).mockResolvedValueOnce(respostaWav(2400));
    const tts = criarSintetizadorGoogle({ token: async () => "tok", projeto: "p", fetchImpl: f });
    expect((await coletar(tts.sintetizar({ texto: "a", voz: "clara", velocidade: 1 }))).length).toBe(1);
    expect(f).toHaveBeenCalledTimes(2);

    const g = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("", { status: 503 })).mockRejectedValueOnce(new TypeError("fetch failed"));
    const tts2 = criarSintetizadorGoogle({ token: async () => "tok", projeto: "p", fetchImpl: g });
    await expect(coletar(tts2.sintetizar({ texto: "a", voz: "clara", velocidade: 1 }))).rejects.toThrow("conector_indisponivel");
    expect(g).toHaveBeenCalledTimes(2);
  });

  it("401/403 é autenticação e 400 é entrada inválida, sem nova tentativa; o texto não vai ao log", async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("", { status: 403 })).mockResolvedValueOnce(new Response("", { status: 400 }));
    const tts = criarSintetizadorGoogle({ token: async () => "tok", projeto: "p", fetchImpl: f });
    await expect(coletar(tts.sintetizar({ texto: "segredo falado", voz: "clara", velocidade: 1 }))).rejects.toThrow("integracao_autenticacao");
    await expect(coletar(tts.sintetizar({ texto: "segredo falado", voz: "clara", velocidade: 1 }))).rejects.toThrow("entrada_invalida");
    expect(f).toHaveBeenCalledTimes(2);
    expect(linhasLog()).not.toContain("segredo");
  });

  it("respeita o sinal: abortado antes não chama; abortado no meio para sem erro", async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(respostaWav(24_000));
    const tts = criarSintetizadorGoogle({ token: async () => "tok", projeto: "p", fetchImpl: f });
    const antes = new AbortController();
    antes.abort();
    expect(await coletar(tts.sintetizar({ texto: "a", voz: "clara", velocidade: 1, sinal: antes.signal }))).toEqual([]);
    expect(f).not.toHaveBeenCalled();

    const meio = new AbortController();
    let n = 0;
    for await (const _ of tts.sintetizar({ texto: "a", voz: "clara", velocidade: 1, sinal: meio.signal })) if (++n === 2) meio.abort();
    expect(n).toBe(2);

    const noFetch = new AbortController();
    const h = vi.fn<typeof fetch>().mockImplementation(async (_u, init) => {
      noFetch.abort();
      throw init?.signal?.reason ?? new DOMException("abortado", "AbortError");
    });
    const tts3 = criarSintetizadorGoogle({ token: async () => "tok", projeto: "p", fetchImpl: h });
    expect(await coletar(tts3.sintetizar({ texto: "a", voz: "clara", velocidade: 1, sinal: noFetch.signal }))).toEqual([]);
    expect(h).toHaveBeenCalledTimes(1);
  });
});
