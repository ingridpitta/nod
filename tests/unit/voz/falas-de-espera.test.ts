import { mkdtemp, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pcmParaBytes } from "../../../src/adapters/voz/audio.ts";
import { chaveDaFala, criarCacheDeFalas } from "../../../src/adapters/voz/falas-de-espera.ts";
import type { PedidoTts, Sintetizador } from "../../../src/adapters/voz/spi.ts";
import { criarSintetizadorFalso } from "../../../src/adapters/voz/voz-falsa.ts";

const ENTENDI = { id: "reconhecimento-entendi", versao: 1, texto: "Entendi." };
const PENSANDO = { id: "pensando-1", versao: 2, texto: "Hum, deixa eu ver…" };

function ttsContado(base: Sintetizador = criarSintetizadorFalso()) {
  const pedidos: PedidoTts[] = [];
  const tts: Sintetizador = {
    id: base.id,
    capacidades: base.capacidades,
    sintetizar(p) {
      pedidos.push(p);
      return base.sintetizar(p);
    },
  };
  return { tts, pedidos };
}

describe("voz: cache das falas de espera", () => {
  let dir: string;
  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    dir = await mkdtemp(join(tmpdir(), "nod-falas-teste-"));
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it("obterPronto é null até alguém gerar; obter gera uma vez e guarda na memória", async () => {
    const { tts, pedidos } = ttsContado();
    const cache = criarCacheDeFalas({ tts, provedor: "falso" });
    expect(cache.obterPronto(ENTENDI, "clara", 1)).toBeNull();
    const [a, b] = await Promise.all([cache.obter(ENTENDI, "clara", 1), cache.obter(ENTENDI, "clara", 1)]);
    expect(a).not.toBeNull();
    expect(a).toBe(b);
    expect(pedidos).toHaveLength(1);
    expect(cache.obterPronto(ENTENDI, "clara", 1)).toBe(a);
    // voz, velocidade e versão diferentes são outro clipe
    expect(cache.obterPronto(ENTENDI, "clara", 1.25)).toBeNull();
    expect(cache.obterPronto(ENTENDI, "bento", 1)).toBeNull();
    expect(cache.obterPronto({ ...ENTENDI, versao: 2 }, "clara", 1)).toBeNull();
  });

  it("aquecer gera em segundo plano, um por vez, e o clipe fica pronto na hora", async () => {
    const { tts, pedidos } = ttsContado();
    const cache = criarCacheDeFalas({ tts, provedor: "falso" });
    const aquecendo = cache.aquecer([ENTENDI, PENSANDO], "luna", 1.5);
    expect(cache.obterPronto(PENSANDO, "luna", 1.5)).toBeNull(); // nunca espera: devolve null na hora
    await aquecendo;
    expect(cache.obterPronto(ENTENDI, "luna", 1.5)).not.toBeNull();
    expect(cache.obterPronto(PENSANDO, "luna", 1.5)).not.toBeNull();
    expect(pedidos.map((p) => [p.texto, p.voz, p.velocidade])).toEqual([
      ["Entendi.", "luna", 1.5],
      ["Hum, deixa eu ver…", "luna", 1.5],
    ]);
    expect(cache.tamanho).toBe(2);
  });

  it("grava .pcm no diretório e um cache novo lê do disco sem chamar o TTS", async () => {
    const primeiro = criarCacheDeFalas({ tts: criarSintetizadorFalso(), provedor: "local", diretorio: dir });
    const pcm = await primeiro.obter(PENSANDO, "clara", 1);
    const arquivo = join(dir, `${chaveDaFala("local", "clara", 1, PENSANDO)}.pcm`);
    expect(arquivo).toBe(join(dir, "local", "clara", "100", "pensando-1-v2.pcm"));
    expect((await readdir(join(dir, "local", "clara", "100"))).filter((f) => f.endsWith(".tmp"))).toEqual([]);

    const { tts, pedidos } = ttsContado();
    const segundo = criarCacheDeFalas({ tts, provedor: "local", diretorio: dir });
    expect(await segundo.obter(PENSANDO, "clara", 1)).toEqual(pcm);
    expect(pedidos).toHaveLength(0);
  });

  it("lê clipe já existente no disco (gerado antes por outro processo)", async () => {
    const chave = chaveDaFala("google", "theo", 1.25, ENTENDI);
    await mkdir(join(dir, "google", "theo", "125"), { recursive: true });
    await writeFile(join(dir, `${chave}.pcm`), pcmParaBytes(Int16Array.from([1, 2, 3])));
    const { tts, pedidos } = ttsContado();
    const cache = criarCacheDeFalas({ tts, provedor: "google", diretorio: dir });
    await cache.aquecer([ENTENDI], "theo", 1.25);
    expect(cache.obterPronto(ENTENDI, "theo", 1.25)).toEqual(Int16Array.from([1, 2, 3]));
    expect(pedidos).toHaveLength(0);
  });

  it("TTS que falha devolve null, não guarda a falha e aquecer não rejeita", async () => {
    let falhar = true;
    const tts: Sintetizador = {
      id: "x",
      capacidades: { streaming: false, velocidade: true },
      async *sintetizar() {
        if (falhar) throw new Error("fora");
        yield new Int16Array(10);
      },
    };
    const cache = criarCacheDeFalas({ tts, provedor: "x" });
    await expect(cache.aquecer([ENTENDI], "clara", 1)).resolves.toBeUndefined();
    expect(await cache.obter(ENTENDI, "clara", 1)).toBeNull();
    falhar = false;
    expect(await cache.obter(ENTENDI, "clara", 1)).toHaveLength(10);
  });

  it("a chave nunca sai da pasta", () => {
    expect(chaveDaFala("local", "../../etc", 1, { id: "a/b", versao: 1 })).toBe("local/______etc/100/a_b-v1");
  });
});
