import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { montarWav } from "../../../src/adapters/voz/audio.ts";
import {
  audioDaResposta,
  CAMINHO_STREAMING,
  criarLeitorGrpc,
  FalhaAntesDoAudio,
  FalhaNoMeioDoAudio,
  pedidoDeConfig,
  pedidoDeTexto,
  quadroGrpc,
  sintetizarEmStreaming,
  type EventosFluxoGrpc,
  type PedidoStreaming,
  type TransporteGrpc,
} from "../../../src/adapters/voz/google-voz-streaming.ts";
import { criarSintetizadorGoogle } from "../../../src/adapters/voz/google-voz.ts";

/**
 * O streaming do Chirp 3 HD com transporte falso (definido em 2026-10-04): sem rede e sem custo. O que só a rede de
 * verdade prova (o servidor aceita estes bytes, e em quanto tempo responde) está em scripts/voz/sonda-tts-streaming.ts.
 */
type FluxoFalso = { caminho: string; headers: Record<string, string>; enviados: Uint8Array[]; ev: EventosFluxoGrpc; cancelado: boolean };

function transporteFalso() {
  const fluxos: FluxoFalso[] = [];
  const estado = { reinicios: 0 };
  const transporte: TransporteGrpc = {
    abrir(caminho, headers, ev) {
      const f: FluxoFalso = { caminho, headers, enviados: [], ev, cancelado: false };
      fluxos.push(f);
      return { enviarTudo: (quadros) => void f.enviados.push(...quadros), cancelar: () => void (f.cancelado = true) };
    },
    reiniciar: () => void estado.reinicios++,
    fechar: () => undefined,
  };
  return { transporte, fluxos, estado };
}

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const ascii = (s: string) => Buffer.from(s, "utf8").toString("hex");
/** Uma StreamingSynthesizeResponse com `audio_content` (campo 1), já no quadro gRPC. */
function respostaComAudio(bytes: Uint8Array): Uint8Array {
  const tamanho: number[] = [];
  let n = bytes.length;
  while (n > 0x7f) {
    tamanho.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  tamanho.push(n);
  return quadroGrpc(Uint8Array.from([0x0a, ...tamanho, ...bytes]));
}
/** `amostras` de PCM16 com valores 0, 1, 2… (para conferir a ordem). */
const pcm = (amostras: number, de = 0) => new Uint8Array(Int16Array.from({ length: amostras }, (_, i) => (de + i) % 30_000).buffer);
const OK = { httpStatus: 200, grpcStatus: 0 };
const pedido = (extra: Partial<PedidoStreaming> = {}): PedidoStreaming => ({ texto: "Oi, tudo bem?", voz: "pt-BR-Chirp3-HD-Erinome", velocidade: 1, token: "tok", projeto: "proj", prazoPrimeiroAudioMs: 5_000, folgaInicialMs: 0, amostrasPorPedaco: 2400, ...extra });
const tique = () => new Promise((r) => setTimeout(r, 0));

async function coletar(it: AsyncIterable<Int16Array>): Promise<Int16Array[]> {
  const out: Int16Array[] = [];
  for await (const p of it) out.push(p);
  return out;
}

describe("voz: protobuf e quadros gRPC do streaming", () => {
  it("o pedido de configuração tem os bytes do proto: voz (1) e áudio (4) dentro de streaming_config (1)", () => {
    const voz = `0a05${ascii("pt-BR")}1217${ascii("pt-BR-Chirp3-HD-Erinome")}`;
    // audio_encoding = PCM (7), sample_rate_hertz = 24000 (c0 bb 01)
    const audio = "08" + "07" + "10" + "c0bb01";
    expect(hex(pedidoDeConfig({ voz: "pt-BR-Chirp3-HD-Erinome", idioma: "pt-BR", velocidade: 1 }))).toBe(`0a2a0a20${voz}2206${audio}`);
    // speaking_rate (3) é double little-endian; 1.25 = 3ff4000000000000
    expect(hex(pedidoDeConfig({ voz: "pt-BR-Chirp3-HD-Erinome", idioma: "pt-BR", velocidade: 1.25 }))).toBe(`0a330a20${voz}220f${audio}19000000000000f43f`);
  });

  it("o pedido de texto é input (2) com text (1), em UTF-8; texto longo usa tamanho em dois bytes", () => {
    expect(hex(pedidoDeTexto("Olá"))).toBe(`12060a04${ascii("Olá")}`);
    const longo = "a".repeat(300);
    // 300 = ac 02; a mensagem de fora tem 303 = af 02
    expect(hex(pedidoDeTexto(longo)).slice(0, 12)).toBe("12af020aac02");
    expect(pedidoDeTexto(longo).length).toBe(306);
  });

  it("audioDaResposta lê o campo 1 e pula os outros; truncado é erro", () => {
    const audio = Uint8Array.from([1, 2, 3, 4]);
    // campo 2 varint, campo 3 de 64 bits, campo 4 de bytes, campo 5 de 32 bits, e o áudio no meio
    const msg = Uint8Array.from([0x10, 0x96, 0x01, 0x19, 0, 0, 0, 0, 0, 0, 0, 0, 0x0a, 4, ...audio, 0x22, 2, 9, 9, 0x2d, 0, 0, 0, 0]);
    expect([...audioDaResposta(msg)]).toEqual([1, 2, 3, 4]);
    expect(audioDaResposta(new Uint8Array(0))).toHaveLength(0);
    expect(() => audioDaResposta(Uint8Array.from([0x0a, 10, 1, 2]))).toThrow("truncado");
  });

  it("o leitor remonta mensagens partidas entre pedaços da rede e separa duas no mesmo pedaço; comprimida é erro", () => {
    const a = quadroGrpc(Uint8Array.from([1, 2, 3, 4, 5, 6, 7]));
    const b = quadroGrpc(Uint8Array.from([8, 9]));
    const leitor = criarLeitorGrpc();
    expect(leitor.alimentar(a.subarray(0, 3))).toEqual([]);
    expect(leitor.alimentar(a.subarray(3, 9))).toEqual([]);
    const prontas = leitor.alimentar(Uint8Array.from([...a.subarray(9), ...b]));
    expect(prontas.map((m) => [...m])).toEqual([[1, 2, 3, 4, 5, 6, 7], [8, 9]]);
    expect(hex(quadroGrpc(Uint8Array.from([0xff])))).toBe("0000000001ff");
    expect(() => criarLeitorGrpc().alimentar(Uint8Array.from([1, 0, 0, 0, 0]))).toThrow("comprimida");
  });
});

describe("voz: síntese em streaming (transporte falso)", () => {
  it("manda config e texto num envio só, com token e projeto, e devolve o PCM em pedaços de 100 ms mesmo com áudio partido em tamanhos ímpares", async () => {
    const t = transporteFalso();
    const saida = coletar(sintetizarEmStreaming(t.transporte, pedido()));
    await tique();
    const f = t.fluxos[0]!;
    expect(f.caminho).toBe(CAMINHO_STREAMING);
    expect(f.headers).toEqual({ authorization: "Bearer tok", "x-goog-user-project": "proj" });
    expect(f.enviados.map(hex)).toEqual([hex(quadroGrpc(pedidoDeConfig({ voz: "pt-BR-Chirp3-HD-Erinome", idioma: "pt-BR", velocidade: 1 }))), hex(quadroGrpc(pedidoDeTexto("Oi, tudo bem?")))]);
    // 6000 amostras (12000 bytes) em três mensagens de tamanho ímpar, a segunda partida em dois pedaços da rede.
    const tudo = pcm(6000);
    const m1 = respostaComAudio(tudo.subarray(0, 3001));
    const m2 = respostaComAudio(tudo.subarray(3001, 9998));
    const m3 = respostaComAudio(tudo.subarray(9998));
    f.ev.aoDado(m1);
    f.ev.aoDado(m2.subarray(0, 1000));
    f.ev.aoDado(Uint8Array.from([...m2.subarray(1000), ...m3]));
    f.ev.aoFim(OK);
    const pedacos = await saida;
    expect(pedacos.map((p) => p.length)).toEqual([2400, 2400, 1200]);
    expect([...pedacos[0]!.subarray(0, 3)]).toEqual([0, 1, 2]);
    expect(pedacos[2]!.at(-1)).toBe(5999);
    expect(f.cancelado).toBe(true);
  });

  it("sem projeto não manda x-goog-user-project", async () => {
    const t = transporteFalso();
    const saida = coletar(sintetizarEmStreaming(t.transporte, pedido({ projeto: null })));
    await tique();
    expect(t.fluxos[0]!.headers).toEqual({ authorization: "Bearer tok" });
    t.fluxos[0]!.ev.aoDado(respostaComAudio(pcm(100)));
    t.fluxos[0]!.ev.aoFim(OK);
    expect((await saida).reduce((n, p) => n + p.length, 0)).toBe(100);
  });

  it("a folga inicial segura o primeiro pedaço até juntar o áudio pedido; depois sai o que chegar", async () => {
    const t = transporteFalso();
    const it = sintetizarEmStreaming(t.transporte, pedido({ folgaInicialMs: 200 }))[Symbol.asyncIterator]();
    let primeiro: IteratorResult<Int16Array> | null = null;
    void it.next().then((r) => (primeiro = r));
    await tique();
    const f = t.fluxos[0]!;
    // 150 ms de áudio (3600 amostras): ainda não sai.
    f.ev.aoDado(respostaComAudio(pcm(3600)));
    await tique();
    expect(primeiro).toBeNull();
    // Mais 100 ms: passou dos 200 ms, sai.
    f.ev.aoDado(respostaComAudio(pcm(2400, 3600)));
    await tique();
    expect(primeiro!.value).toHaveLength(2400);
    expect((await it.next()).value).toHaveLength(2400);
    f.ev.aoFim(OK);
    expect((await it.next()).value).toHaveLength(1200);
    expect((await it.next()).done).toBe(true);
  });

  it("fluxo curto que acaba antes da folga sai inteiro no fim", async () => {
    const t = transporteFalso();
    const saida = coletar(sintetizarEmStreaming(t.transporte, pedido({ folgaInicialMs: 200 })));
    await tique();
    t.fluxos[0]!.ev.aoDado(respostaComAudio(pcm(1000)));
    t.fluxos[0]!.ev.aoFim(OK);
    expect((await saida).map((p) => p.length)).toEqual([1000]);
  });

  it("erro antes de qualquer áudio é FalhaAntesDoAudio: grpc-status, HTTP, rede, fluxo vazio e resposta que não é gRPC", async () => {
    const casos: [string, (f: FluxoFalso) => void][] = [
      ["grpc_8_http_200", (f) => f.ev.aoFim({ httpStatus: 200, grpcStatus: 8 })],
      ["grpc_sem_status_http_404", (f) => f.ev.aoFim({ httpStatus: 404, grpcStatus: null })],
      ["rede", (f) => f.ev.aoErro(new Error("ECONNRESET"))],
      ["vazio", (f) => f.ev.aoFim(OK)],
      ["quadro", (f) => f.ev.aoDado(Buffer.from("<html>404</html>"))],
    ];
    for (const [motivo, agir] of casos) {
      const t = transporteFalso();
      const saida = coletar(sintetizarEmStreaming(t.transporte, pedido()));
      await tique();
      agir(t.fluxos[0]!);
      const erro = await saida.catch((e: unknown) => e);
      expect(erro, motivo).toBeInstanceOf(FalhaAntesDoAudio);
      expect((erro as FalhaAntesDoAudio).motivo).toBe(motivo);
      expect(t.fluxos[0]!.cancelado).toBe(true);
    }
  });

  it("áudio guardado na folga e nunca entregue ainda é falha ANTES do áudio; entregue, é falha no meio", async () => {
    const guardado = transporteFalso();
    const a = coletar(sintetizarEmStreaming(guardado.transporte, pedido({ folgaInicialMs: 200 })));
    await tique();
    guardado.fluxos[0]!.ev.aoDado(respostaComAudio(pcm(1000)));
    guardado.fluxos[0]!.ev.aoFim({ httpStatus: 200, grpcStatus: 14 });
    expect(await a.catch((e: unknown) => e)).toBeInstanceOf(FalhaAntesDoAudio);

    const entregue = transporteFalso();
    const b = coletar(sintetizarEmStreaming(entregue.transporte, pedido()));
    await tique();
    entregue.fluxos[0]!.ev.aoDado(respostaComAudio(pcm(4800)));
    await tique();
    entregue.fluxos[0]!.ev.aoFim({ httpStatus: 200, grpcStatus: 14 });
    const erro = await b.catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(FalhaNoMeioDoAudio);
    expect((erro as FalhaNoMeioDoAudio).motivo).toBe("grpc_14_http_200");
  });

  it("sem áudio no prazo: FalhaAntesDoAudio('prazo'), fluxo cancelado e a sessão largada", async () => {
    vi.useFakeTimers();
    try {
      const t = transporteFalso();
      const saida = coletar(sintetizarEmStreaming(t.transporte, pedido({ prazoPrimeiroAudioMs: 2_500 }))).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(2_499);
      expect(t.estado.reinicios).toBe(0);
      await vi.advanceTimersByTimeAsync(1);
      const erro = await saida;
      expect(erro).toBeInstanceOf(FalhaAntesDoAudio);
      expect((erro as FalhaAntesDoAudio).motivo).toBe("prazo");
      expect(t.estado.reinicios).toBe(1);
      expect(t.fluxos[0]!.cancelado).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("o prazo não corta um fluxo que já está entregando áudio", async () => {
    vi.useFakeTimers();
    try {
      const t = transporteFalso();
      const saida = coletar(sintetizarEmStreaming(t.transporte, pedido({ prazoPrimeiroAudioMs: 1_000 })));
      await vi.advanceTimersByTimeAsync(10);
      t.fluxos[0]!.ev.aoDado(respostaComAudio(pcm(2400)));
      await vi.advanceTimersByTimeAsync(5_000);
      t.fluxos[0]!.ev.aoDado(respostaComAudio(pcm(2400)));
      t.fluxos[0]!.ev.aoFim(OK);
      expect((await saida).map((p) => p.length)).toEqual([2400, 2400]);
      expect(t.estado.reinicios).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("abortar: antes de começar não abre fluxo; no meio, encerra sem erro e cancela o fluxo", async () => {
    const antes = new AbortController();
    antes.abort();
    const t0 = transporteFalso();
    expect(await coletar(sintetizarEmStreaming(t0.transporte, pedido({ sinal: antes.signal })))).toEqual([]);
    expect(t0.fluxos).toHaveLength(0);

    const meio = new AbortController();
    const t = transporteFalso();
    const saida = coletar(sintetizarEmStreaming(t.transporte, pedido({ sinal: meio.signal })));
    await tique();
    t.fluxos[0]!.ev.aoDado(respostaComAudio(pcm(2400)));
    await tique();
    meio.abort();
    expect((await saida).map((p) => p.length)).toEqual([2400]);
    expect(t.fluxos[0]!.cancelado).toBe(true);
  });
});

describe("voz: TTS Chirp 3 HD com streaming e o REST de rede de segurança", () => {
  let saidaLog: MockInstance;
  const linhasLog = () => saidaLog.mock.calls.map((c) => String(c[0])).join("\n");
  beforeEach(() => {
    saidaLog = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  const respostaWav = (amostras: number) => new Response(JSON.stringify({ audioContent: montarWav(new Int16Array(amostras).fill(7), 24_000).toString("base64") }));

  it("com streaming, o áudio vem do fluxo e o REST não é chamado; a voz do catálogo vira o nome do Chirp", async () => {
    const t = transporteFalso();
    const f = vi.fn<typeof fetch>();
    const tts = criarSintetizadorGoogle({ token: async () => "tok", projeto: "proj", fetchImpl: f, streaming: { transporte: t.transporte, folgaInicialMs: 0 } });
    expect(tts.capacidades).toEqual({ streaming: true, velocidade: true });
    const saida = coletar(tts.sintetizar({ texto: "Oi!", voz: "clara", velocidade: 1 }));
    await tique();
    await tique();
    expect(hex(t.fluxos[0]!.enviados[0]!)).toContain(ascii("pt-BR-Chirp3-HD-Erinome"));
    t.fluxos[0]!.ev.aoDado(respostaComAudio(pcm(2400)));
    t.fluxos[0]!.ev.aoFim(OK);
    expect((await saida).map((p) => p.length)).toEqual([2400]);
    expect(f).not.toHaveBeenCalled();
  });

  it("falha antes do áudio cai no REST na mesma chamada; o log diz o motivo e nunca o texto", async () => {
    const t = transporteFalso();
    const f = vi.fn<typeof fetch>().mockResolvedValue(respostaWav(4800));
    const tts = criarSintetizadorGoogle({ token: async () => "tok", projeto: "proj", fetchImpl: f, streaming: { transporte: t.transporte } });
    const saida = coletar(tts.sintetizar({ texto: "segredo falado", voz: "clara", velocidade: 1 }));
    await tique();
    await tique();
    t.fluxos[0]!.ev.aoFim({ httpStatus: 200, grpcStatus: 14 });
    expect((await saida).reduce((n, p) => n + p.length, 0)).toBe(4800);
    expect(f).toHaveBeenCalledTimes(1);
    expect(linhasLog()).toContain('"evento":"voz_tts_streaming_falhou"');
    expect(linhasLog()).toContain('"motivo":"grpc_14_http_200"');
    expect(linhasLog()).not.toContain("segredo");
  });

  it("falha com áudio já entregue não refaz o trecho pelo REST: conector_indisponivel", async () => {
    const t = transporteFalso();
    const f = vi.fn<typeof fetch>().mockResolvedValue(respostaWav(4800));
    const tts = criarSintetizadorGoogle({ token: async () => "tok", projeto: "proj", fetchImpl: f, streaming: { transporte: t.transporte, folgaInicialMs: 0 } });
    const saida = coletar(tts.sintetizar({ texto: "Oi!", voz: "clara", velocidade: 1 }));
    await tique();
    await tique();
    t.fluxos[0]!.ev.aoDado(respostaComAudio(pcm(2400)));
    await tique();
    t.fluxos[0]!.ev.aoErro(new Error("ECONNRESET"));
    await expect(saida).rejects.toThrow("conector_indisponivel");
    expect(f).not.toHaveBeenCalled();
  });

  it("três falhas seguidas antes do áudio: só REST por 5 min; depois o streaming é tentado de novo; um sucesso zera a conta", async () => {
    const t = transporteFalso();
    let agora = 1_000_000;
    const f = vi.fn<typeof fetch>().mockImplementation(async () => respostaWav(2400));
    const tts = criarSintetizadorGoogle({ token: async () => "tok", projeto: "proj", fetchImpl: f, streaming: { transporte: t.transporte, folgaInicialMs: 0, agora: () => agora } });
    const falhar = async () => {
      const antes = t.fluxos.length;
      const saida = coletar(tts.sintetizar({ texto: "Oi!", voz: "clara", velocidade: 1 }));
      await tique();
      await tique();
      if (t.fluxos.length > antes) t.fluxos.at(-1)!.ev.aoFim({ httpStatus: 200, grpcStatus: 14 });
      await saida;
      return t.fluxos.length > antes;
    };
    const acertar = async () => {
      const saida = coletar(tts.sintetizar({ texto: "Oi!", voz: "clara", velocidade: 1 }));
      await tique();
      await tique();
      t.fluxos.at(-1)!.ev.aoDado(respostaComAudio(pcm(2400)));
      t.fluxos.at(-1)!.ev.aoFim(OK);
      await saida;
    };
    // Duas falhas, um sucesso: a conta zera, e mais duas falhas não abrem o disjuntor.
    expect(await falhar()).toBe(true);
    expect(await falhar()).toBe(true);
    await acertar();
    expect(await falhar()).toBe(true);
    expect(await falhar()).toBe(true);
    // A terceira seguida abre: os próximos pedidos nem tentam o streaming.
    expect(await falhar()).toBe(true);
    expect(await falhar()).toBe(false);
    agora += 5 * 60_000 - 1;
    expect(await falhar()).toBe(false);
    agora += 1;
    expect(await falhar()).toBe(true);
    expect(linhasLog()).toContain('"so_rest":true');
  });

  it("sem token, o streaming nem abre e o REST classifica o erro", async () => {
    const t = transporteFalso();
    const tts = criarSintetizadorGoogle({ token: async () => { throw new Error("sem token"); }, projeto: "proj", fetchImpl: vi.fn<typeof fetch>(), streaming: { transporte: t.transporte } });
    await expect(coletar(tts.sintetizar({ texto: "Oi!", voz: "clara", velocidade: 1 }))).rejects.toThrow();
    expect(t.fluxos).toHaveLength(0);
  });
});
