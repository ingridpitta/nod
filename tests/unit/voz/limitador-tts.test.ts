import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { montarWav } from "../../../src/adapters/voz/audio.ts";
import { criarSintetizadorGoogle } from "../../../src/adapters/voz/google-voz.ts";
import type { TransporteGrpc } from "../../../src/adapters/voz/google-voz-streaming.ts";
import { criarLimitadorTts, criarSintetizadorLimitado, ESPERA_MAX_FALA_DE_ESPERA_MS, JANELA_TTS_MS } from "../../../src/adapters/voz/limitador-tts.ts";
import type { PedidoTts, PrioridadeTts, Sintetizador } from "../../../src/adapters/voz/spi.ts";

const pedido = (prioridade?: PrioridadeTts, sinal?: AbortSignal): PedidoTts => ({ texto: "a", voz: "clara", velocidade: 1, prioridade, sinal });

async function coletar(it: AsyncIterable<Int16Array>): Promise<Int16Array[]> {
  const out: Int16Array[] = [];
  for await (const p of it) out.push(p);
  return out;
}

describe("voz: limitador da cota do TTS", () => {
  let saidaLog: MockInstance;
  const eventos = () => saidaLog.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>).filter((l) => l.evento === "voz_tts_limitado");
  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000_000 });
    saidaLog = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("abaixo do teto não espera nem loga", async () => {
    const l = criarLimitadorTts({ tetoPorMinuto: 3 });
    await expect(Promise.all([l.vaga(pedido()), l.vaga(pedido("espera")), l.vaga(pedido("previa"))])).resolves.toEqual([true, true, true]);
    expect(eventos()).toEqual([]);
  });

  it("no teto, sai na ordem conteúdo > leitura > espera/prévia, quando a janela de 60 s libera", async () => {
    const l = criarLimitadorTts({ tetoPorMinuto: 2 });
    await l.vaga(pedido());
    vi.advanceTimersByTime(10_000);
    await l.vaga(pedido());
    const ordem: string[] = [];
    const esperar = (nome: string, p: PedidoTts) => l.vaga(p).then((ok) => ordem.push(`${nome}:${ok}`));
    const todos = [esperar("previa", pedido("previa")), esperar("leitura", pedido("leitura")), esperar("conteudo", pedido("conteudo")), esperar("conteudo2", pedido())];
    await vi.advanceTimersByTimeAsync(JANELA_TTS_MS - 10_000 - 1);
    expect(ordem).toEqual([]);
    await vi.advanceTimersByTimeAsync(1); // a 1ª vaga venceu
    expect(ordem).toEqual(["conteudo:true"]);
    await vi.advanceTimersByTimeAsync(10_000); // a 2ª venceu
    expect(ordem).toEqual(["conteudo:true", "conteudo2:true"]);
    await vi.advanceTimersByTimeAsync(JANELA_TTS_MS);
    await vi.advanceTimersByTimeAsync(JANELA_TTS_MS);
    await Promise.all(todos);
    expect(ordem).toEqual(["conteudo:true", "conteudo2:true", "leitura:true", "previa:true"]);
    const primeiro = eventos()[0];
    expect(primeiro).toMatchObject({ prioridade: "conteudo", espera_ms: 50_000, descartado: false });
  });

  it("conteúdo que chega depois passa na frente das falas de espera já na fila", async () => {
    const l = criarLimitadorTts({ tetoPorMinuto: 1 });
    await l.vaga(pedido());
    const ordem: string[] = [];
    void l.vaga(pedido("previa")).then(() => ordem.push("previa"));
    void l.vaga(pedido("espera")).then((ok) => ordem.push(`espera:${ok}`));
    await vi.advanceTimersByTimeAsync(1_000);
    void l.vaga(pedido("conteudo")).then(() => ordem.push("conteudo"));
    await vi.advanceTimersByTimeAsync(JANELA_TTS_MS);
    // a espera passou de 2 s na fila e foi descartada antes de a vaga abrir; o conteúdo saiu antes da prévia
    expect(ordem).toEqual(["espera:false", "conteudo"]);
    await vi.advanceTimersByTimeAsync(JANELA_TTS_MS);
    expect(ordem).toEqual(["espera:false", "conteudo", "previa"]);
  });

  it("fala de espera com mais de 2 s na fila é descartada e logada; leitura e prévia só esperam", async () => {
    const l = criarLimitadorTts({ tetoPorMinuto: 1 });
    await l.vaga(pedido());
    const espera = l.vaga(pedido("espera"));
    const leitura = l.vaga(pedido("leitura"));
    await vi.advanceTimersByTimeAsync(ESPERA_MAX_FALA_DE_ESPERA_MS);
    await expect(espera).resolves.toBe(false);
    expect(eventos()).toEqual([expect.objectContaining({ prioridade: "espera", espera_ms: 2_000, descartado: true })]);
    await vi.advanceTimersByTimeAsync(JANELA_TTS_MS);
    await expect(leitura).resolves.toBe(true);
  });

  it("pedido cancelado sai da fila na hora, sem consumir vaga; já cancelado nem entra", async () => {
    const l = criarLimitadorTts({ tetoPorMinuto: 1 });
    await l.vaga(pedido());
    const ac = new AbortController();
    const cancelado = l.vaga(pedido("conteudo", ac.signal));
    const depois = l.vaga(pedido("previa"));
    ac.abort();
    await expect(cancelado).resolves.toBe(false);
    await expect(l.vaga(pedido("conteudo", AbortSignal.abort()))).resolves.toBe(false);
    await vi.advanceTimersByTimeAsync(JANELA_TTS_MS);
    await expect(depois).resolves.toBe(true);
    // a prévia ficou com a única vaga da janela: o cancelado não consumiu nada
    let terceiro = false;
    void l.vaga(pedido()).then(() => (terceiro = true));
    await vi.advanceTimersByTimeAsync(JANELA_TTS_MS - 1);
    expect(terceiro).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(terceiro).toBe(true);
  });

  it("mede o pico de pedidos por minuto desde que a ligação começou", async () => {
    const l = criarLimitadorTts({ tetoPorMinuto: 10 });
    await l.vaga(pedido());
    const ler = l.medirPico();
    await l.vaga(pedido());
    await l.vaga(pedido());
    vi.advanceTimersByTime(JANELA_TTS_MS);
    await l.vaga(pedido());
    expect(ler()).toBe(3);
  });

  it("decorator: no teto, o provedor só é chamado quando a vaga abre; descartado não chama o provedor", async () => {
    const chamadas: PedidoTts[] = [];
    const base: Sintetizador = {
      id: "x",
      capacidades: { streaming: true, velocidade: true },
      async *sintetizar(p) {
        chamadas.push(p);
        yield new Int16Array(1);
      },
    };
    const tts = criarSintetizadorLimitado(base, criarLimitadorTts({ tetoPorMinuto: 1 }));
    expect([tts.id, tts.capacidades.streaming, typeof tts.medirPico]).toEqual(["x", true, "function"]);
    expect(await coletar(tts.sintetizar(pedido()))).toHaveLength(1);
    const espera = coletar(tts.sintetizar(pedido("espera")));
    await vi.advanceTimersByTimeAsync(ESPERA_MAX_FALA_DE_ESPERA_MS);
    await expect(espera).resolves.toEqual([]);
    expect(chamadas).toHaveLength(1);
  });

  it("fallback REST do Google conta como pedido extra: streaming que falha antes do áudio + REST = 2 vagas", async () => {
    // rede caindo antes do primeiro áudio: o streaming falha com FalhaAntesDoAudio e o REST entra
    const transporte: TransporteGrpc = {
      abrir(_caminho, _headers, ev) {
        queueMicrotask(() => ev.aoErro(new Error("rede")));
        return { enviarTudo() {}, cancelar() {} };
      },
      reiniciar() {},
      fechar() {},
    };
    const pcm = new Int16Array(2400);
    const f = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({ audioContent: montarWav(pcm, 24_000).toString("base64") })));
    const limitador = criarLimitadorTts({ tetoPorMinuto: 2 });
    const tts = criarSintetizadorLimitado(criarSintetizadorGoogle({ token: async () => "tok", projeto: "p", fetchImpl: f, vagaExtra: limitador.vaga, streaming: { transporte } }), limitador);
    const ler = tts.medirPico?.();
    expect(await coletar(tts.sintetizar(pedido()))).toHaveLength(1);
    expect(f).toHaveBeenCalledTimes(1);
    expect(ler?.()).toBe(2);
    // as 2 vagas da janela foram gastas: o próximo pedido espera a janela
    let saiu = false;
    void coletar(tts.sintetizar(pedido())).then(() => (saiu = true));
    await vi.advanceTimersByTimeAsync(JANELA_TTS_MS - 1);
    expect(saiu).toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
  });
});
