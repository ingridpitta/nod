import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  criarProvedoresVoz,
  lerProvedorSttArquivo,
  lerTetoTts,
  provedorPadrao,
} from "../../../src/adapters/voz/fabrica.ts";

describe("voz: fábrica de provedores", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("padrão: produção → google; dev no macOS → local; dev fora do Mac → falso", () => {
    expect(provedorPadrao({ NODE_ENV: "production" }, "linux")).toBe("google");
    expect(provedorPadrao({ NODE_ENV: "production" }, "darwin")).toBe("google");
    expect(provedorPadrao({}, "darwin")).toBe("local");
    expect(provedorPadrao({ NODE_ENV: "development" }, "linux")).toBe("falso");
  });

  it("escolhe cada lado por NOD_VOZ_STT e NOD_VOZ_TTS", async () => {
    const a = criarProvedoresVoz(
      { NOD_VOZ_STT: "falso", NOD_VOZ_TTS: "falso" },
      "darwin",
    );
    expect([a.stt.id, a.tts.id]).toEqual(["falso", "falso"]);
    const b = criarProvedoresVoz(
      { NOD_VOZ_STT: "google", NOD_VOZ_TTS: "local", NOD_VOZ_PROJETO: "p" },
      "darwin",
    );
    expect([b.stt.id, b.tts.id]).toEqual(["google", "local"]);
    expect(b.stt.capacidades.parciais).toBe(true);
    const c = criarProvedoresVoz({}, "darwin");
    expect([c.stt.id, c.tts.id]).toEqual(["local", "local"]);
    expect(c.stt.capacidades.parciais).toBe(false);
    const d = criarProvedoresVoz(
      { NODE_ENV: "production", NOD_VOZ_PROJETO: "p" },
      "linux",
    );
    expect([d.stt.id, d.tts.id]).toEqual(["google", "google"]);
    await Promise.all([a.encerrar(), b.encerrar(), c.encerrar(), d.encerrar()]);
  });

  it("a voz do Google sai em streaming por padrão; NOD_VOZ_TTS_STREAMING=0 volta ao REST puro", async () => {
    const padrao = criarProvedoresVoz(
      { NOD_VOZ_STT: "falso", NOD_VOZ_TTS: "google", NOD_VOZ_PROJETO: "p" },
      "linux",
    );
    expect(padrao.tts.capacidades.streaming).toBe(true);
    const rest = criarProvedoresVoz(
      {
        NOD_VOZ_STT: "falso",
        NOD_VOZ_TTS: "google",
        NOD_VOZ_PROJETO: "p",
        NOD_VOZ_TTS_STREAMING: "0",
      },
      "linux",
    );
    expect(rest.tts.capacidades.streaming).toBe(false);
    // Encerrar fecha a sessão HTTP/2 (nenhuma foi aberta: ela só nasce no primeiro pedido).
    await Promise.all([padrao.encerrar(), rest.encerrar()]);
  });

  it("valor inválido e TTS local fora do Mac falham no boot", () => {
    expect(() =>
      criarProvedoresVoz({ NOD_VOZ_STT: "azure" }, "darwin"),
    ).toThrow("entrada_invalida");
    expect(() => criarProvedoresVoz({ NOD_VOZ_TTS: "local" }, "linux")).toThrow(
      "integracao_nao_configurada",
    );
  });

  it("NOD_VOZ_TTS_TETO_MIN: padrão 180, 0 desliga, inválido derruba a voz no boot com a explicação em pt-BR", async () => {
    expect([
      lerTetoTts(undefined),
      lerTetoTts(" "),
      lerTetoTts("120"),
      lerTetoTts("0"),
    ]).toEqual([180, 180, 120, 0]);
    const saida = vi.spyOn(console, "log").mockImplementation(() => {});
    for (const v of ["-1", "1.5", "muito", "180/min"])
      expect(() =>
        criarProvedoresVoz(
          {
            NOD_VOZ_TTS: "google",
            NOD_VOZ_PROJETO: "p",
            NOD_VOZ_TTS_TETO_MIN: v,
          },
          "linux",
        ),
      ).toThrow("entrada_invalida");
    expect(String(saida.mock.calls.at(-1)?.[0])).toContain(
      "NOD_VOZ_TTS_TETO_MIN precisa ser um número inteiro",
    );

    const comLimite = criarProvedoresVoz(
      { NOD_VOZ_STT: "falso", NOD_VOZ_TTS: "google", NOD_VOZ_PROJETO: "p" },
      "linux",
    );
    expect([
      comLimite.tts.id,
      typeof comLimite.tts.medirPico,
      comLimite.tts.capacidades.streaming,
    ]).toEqual(["google", "function", true]);
    const desligado = criarProvedoresVoz(
      {
        NOD_VOZ_STT: "falso",
        NOD_VOZ_TTS: "google",
        NOD_VOZ_PROJETO: "p",
        NOD_VOZ_TTS_TETO_MIN: "0",
      },
      "linux",
    );
    expect(desligado.tts.medirPico).toBeUndefined();
    // a cota é do Google: local e falso não passam pelo limitador
    const local = criarProvedoresVoz(
      { NOD_VOZ_STT: "falso", NOD_VOZ_TTS: "local" },
      "darwin",
    );
    const falso = criarProvedoresVoz(
      { NOD_VOZ_STT: "falso", NOD_VOZ_TTS: "falso", NOD_VOZ_TTS_TETO_MIN: "5" },
      "linux",
    );
    expect([local.tts.medirPico, falso.tts.medirPico]).toEqual([
      undefined,
      undefined,
    ]);
    await Promise.all([
      comLimite.encerrar(),
      desligado.encerrar(),
      local.encerrar(),
      falso.encerrar(),
    ]);
  });

  it("NOD_VOZ_STT_ARQUIVO (NOD-329): padrão google em produção e falso fora; desligado = null; inválido derruba no boot", async () => {
    expect([
      lerProvedorSttArquivo({ NODE_ENV: "production" }),
      lerProvedorSttArquivo({}),
      lerProvedorSttArquivo({ NOD_VOZ_STT_ARQUIVO: " desligado " }),
    ]).toEqual(["google", "falso", "desligado"]);
    const prod = criarProvedoresVoz(
      { NODE_ENV: "production", NOD_VOZ_PROJETO: "p" },
      "linux",
    );
    expect([prod.arquivo?.id, prod.arquivo?.modelo]).toEqual([
      "google",
      "chirp_2",
    ]);
    const outroModelo = criarProvedoresVoz(
      {
        NOD_VOZ_STT: "falso",
        NOD_VOZ_TTS: "falso",
        NOD_VOZ_STT_ARQUIVO: "google",
        NOD_VOZ_STT_ARQUIVO_MODELO: "chirp_3",
        NOD_VOZ_PROJETO: "p",
      },
      "linux",
    );
    expect(outroModelo.arquivo?.modelo).toBe("chirp_3");
    // o local (whisper) não dá tempo por palavra: fora de produção, mesmo no Mac, o padrão é o falso
    const dev = criarProvedoresVoz({}, "darwin");
    expect(dev.arquivo?.id).toBe("falso");
    const desligado = criarProvedoresVoz(
      {
        NOD_VOZ_STT: "falso",
        NOD_VOZ_TTS: "falso",
        NOD_VOZ_STT_ARQUIVO: "desligado",
      },
      "linux",
    );
    expect(desligado.arquivo).toBeNull();
    expect(() =>
      criarProvedoresVoz({ NOD_VOZ_STT_ARQUIVO: "local" }, "linux"),
    ).toThrow("entrada_invalida");
    await Promise.all([
      prod.encerrar(),
      outroModelo.encerrar(),
      dev.encerrar(),
      desligado.encerrar(),
    ]);
  });
});
