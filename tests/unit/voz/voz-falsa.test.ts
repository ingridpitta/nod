import { describe, expect, it } from "vitest";
import type { ResultadoStt } from "../../../src/adapters/voz/spi.ts";
import {
  criarProvedoresFalsos,
  criarSintetizadorFalso,
  criarTranscritorDeArquivoFalso,
  criarTranscritorFalso,
  duracaoFalaFalsaMs,
  MS_POR_PALAVRA_FALSA,
} from "../../../src/adapters/voz/voz-falsa.ts";
import { wav } from "../../fixtures/audio/construir.ts";

const quadro = () => new Int16Array(320).fill(1000);
const microtasks = () => new Promise((r) => setTimeout(r, 0));

async function sessao(t: ReturnType<typeof criarTranscritorFalso>) {
  const resultados: ResultadoStt[] = [];
  const s = await t.abrir({
    idioma: "pt-BR",
    aoResultado: (r) => resultados.push(r),
    aoErro: () => {},
  });
  return { s, resultados };
}

describe("voz: provedor falso", () => {
  it("cada trecho vira o próximo texto do roteiro, com confiança 0.95; esgotado vira vazio", async () => {
    const t = criarTranscritorFalso(["oi, tudo bem?", "cria uma rotina"]);
    expect(t.capacidades).toEqual({
      parciais: false,
      vocabulario: true,
      fimDeFalaManual: true,
    });
    const { s, resultados } = await sessao(t);
    s.enviar(quadro());
    s.enviar(quadro());
    s.fimDeFala();
    expect(resultados).toEqual([]); // nunca dentro da própria chamada
    await microtasks();
    s.enviar(quadro());
    s.fimDeFala();
    s.enviar(quadro());
    s.fimDeFala();
    await microtasks();
    expect(resultados).toEqual([
      { texto: "oi, tudo bem?", final: true, confianca: 0.95 },
      { texto: "cria uma rotina", final: true, confianca: 0.95 },
      { texto: "", final: true, confianca: 0.95 },
    ]);
  });

  it("fimDeFala sem áudio não é trecho; descartar não consome o roteiro", async () => {
    const t = criarTranscritorFalso(["primeira"]);
    const { s, resultados } = await sessao(t);
    s.fimDeFala();
    s.enviar(new Int16Array(0));
    s.fimDeFala();
    s.enviar(quadro());
    s.descartar();
    s.fimDeFala();
    await microtasks();
    expect(resultados).toEqual([]);
    expect(t.restantes).toBe(1);
    s.enviar(quadro());
    s.fimDeFala();
    await microtasks();
    expect(resultados.map((r) => r.texto)).toEqual(["primeira"]);
  });

  it("com parciais, o primeiro áudio emite a primeira metade das palavras; empurrarTexto enfileira", async () => {
    const t = criarTranscritorFalso([], { parciais: true });
    t.empurrarTexto("quero ver minhas tarefas de hoje");
    const { s, resultados } = await sessao(t);
    s.enviar(quadro());
    s.enviar(quadro());
    s.fimDeFala();
    await microtasks();
    expect(resultados).toEqual([
      { texto: "quero ver minhas", final: false, confianca: null },
      {
        texto: "quero ver minhas tarefas de hoje",
        final: true,
        confianca: 0.95,
      },
    ]);
  });

  it("depois de fechar, nada sai e enviar não lança", async () => {
    const t = criarTranscritorFalso(["x"]);
    const { s, resultados } = await sessao(t);
    s.enviar(quadro());
    s.fimDeFala();
    await s.fechar();
    s.enviar(quadro());
    await microtasks();
    expect(resultados).toEqual([]);
  });

  it("sintetizador: duração proporcional ao texto, mínimo 200 ms, pedaços de 100 ms a 24 kHz", async () => {
    const tts = criarSintetizadorFalso();
    const pedacos: Int16Array[] = [];
    for await (const p of tts.sintetizar({
      texto: "Tô vendo aqui.",
      voz: "clara",
      velocidade: 1,
    }))
      pedacos.push(p);
    const total = pedacos.reduce((n, p) => n + p.length, 0);
    expect(total).toBe((duracaoFalaFalsaMs("Tô vendo aqui.") * 24_000) / 1000);
    expect(duracaoFalaFalsaMs("Tô vendo aqui.")).toBe(14 * 60);
    expect(pedacos.slice(0, -1).every((p) => p.length === 2400)).toBe(true);
    expect(pedacos.some((p) => p.some((v) => v !== 0))).toBe(true);
    expect(duracaoFalaFalsaMs("ok")).toBe(200);
    expect(duracaoFalaFalsaMs("Tô vendo aqui.", 1.5)).toBe(560);
  });

  it("sintetizador respeita o sinal: aborta no meio sem erro", async () => {
    const tts = criarSintetizadorFalso({ silencioso: true });
    const ac = new AbortController();
    let n = 0;
    for await (const p of tts.sintetizar({
      texto: "x".repeat(100),
      voz: "clara",
      velocidade: 1,
      sinal: ac.signal,
    })) {
      expect(p.every((v) => v === 0)).toBe(true);
      if (++n === 3) ac.abort();
    }
    expect(n).toBe(3);
  });

  it("criarProvedoresFalsos junta os dois", async () => {
    const p = criarProvedoresFalsos({ roteiro: ["a"], parciais: true });
    expect(p.stt.capacidades.parciais).toBe(true);
    expect(p.tts.id).toBe("falso");
    await p.encerrar();
  });

  it("STT de arquivo falso (NOD-329): espalha as palavras pela duração, roteiro vazio = sem fala, conta as chamadas", async () => {
    const pedido = {
      bytes: new Uint8Array(10),
      mime: "audio/wav",
      idioma: "pt-BR" as const,
    };
    const t = criarTranscritorDeArquivoFalso("o verde ganhou", {
      duracaoMs: 3000,
    });
    expect([t.id, t.modelo, t.chamadas]).toEqual(["falso", "falso", 0]);
    expect(await t.transcrever(pedido)).toEqual({
      palavras: [
        { texto: "o", inicioMs: 0, fimMs: 1000 },
        { texto: "verde", inicioMs: 1000, fimMs: 2000 },
        { texto: "ganhou", inicioMs: 2000, fimMs: 3000 },
      ],
      cobradoMs: null,
    });
    const semDuracao = criarTranscritorDeArquivoFalso("a b");
    expect((await semDuracao.transcrever(pedido)).palavras.at(-1)?.fimMs).toBe(
      2 * MS_POR_PALAVRA_FALSA,
    );
    // sem duração dada, usa a do cabeçalho: as palavras não passam do fim do áudio
    const doCabecalho = await semDuracao.transcrever({ ...pedido, bytes: wav(5000) });
    expect(doCabecalho.palavras).toEqual([
      { texto: "a", inicioMs: 0, fimMs: 2500 },
      { texto: "b", inicioMs: 2500, fimMs: 5000 },
    ]);
    const mudo = criarTranscritorDeArquivoFalso();
    expect(await mudo.transcrever(pedido)).toEqual({
      palavras: [],
      cobradoMs: null,
    });
    await t.transcrever(pedido);
    expect([t.chamadas, semDuracao.chamadas, mudo.chamadas]).toEqual([2, 2, 1]);
    const ac = new AbortController();
    ac.abort();
    await expect(
      t.transcrever({ ...pedido, sinal: ac.signal }),
    ).rejects.toThrow("abortado");
  });

  it("criarProvedoresFalsos traz o STT de arquivo falso com o roteiro dado", async () => {
    const p = criarProvedoresFalsos({ roteiroArquivo: "oi" });
    expect(
      (
        await p.arquivo.transcrever({
          bytes: new Uint8Array(1),
          mime: "audio/ogg",
          idioma: "pt-BR",
        })
      ).palavras.map((w) => w.texto),
    ).toEqual(["oi"]);
    expect(p.arquivo.chamadas).toBe(1);
  });
});
