import { describe, expect, it } from "vitest";
import { novasMarcas, percentilMs, resumoDaVez } from "../../../src/domain/ligacao-medicao.ts";

describe("resumoDaVez", () => {
  it("vez falada: tempos antes da vez contam do fim da voz; depois, da vez; voz a voz é o silêncio que a pessoa ouve", () => {
    const m = novasMarcas({ n: 3, origem: "voz", vezEm: 11_050 });
    Object.assign(m, {
      fimDaVozEm: 10_000,
      trechoFechadoEm: 10_600,
      fechou: "vad",
      finalSttEm: 11_050,
      trechos: 2,
      iniciosQueCancelaram: 1,
      esperaFimDeTurnoMs: 600,
      primeiroDeltaEm: 11_700,
      primeiroTrechoEm: 11_900,
      primeiroAudioEm: 13_100,
      primeiroTocadoEm: 13_400,
      ferramentaInicioEm: 12_000,
      ferramentaFimEm: 12_450,
      textoDepoisDaFerramenta: true,
      maiorBuracoDeAudioMs: 120.4,
    });
    expect(resumoDaVez(m, "respondida")).toEqual({
      n: 3,
      origem: "voz",
      desfecho: "respondida",
      trechos: 2,
      fechou: "vad",
      inicios_que_cancelaram: 1,
      espera_fim_de_turno_ms: 600,
      trecho_fechado_ms: 600,
      stt_final_ms: 1050,
      vez_ms: 1050,
      primeiro_delta_ms: 650,
      primeiro_trecho_ms: 850,
      primeiro_audio_ms: 2050,
      primeiro_tocado_ms: 2350,
      voz_a_voz_ms: 3100,
      ferramenta_antes_do_texto: false,
      texto_depois_da_ferramenta: true,
      ferramenta_ms: 450,
      maior_buraco_de_audio_ms: 120,
    });
  });

  it("vez digitada que nunca teve som: o que não aconteceu fica null, nunca zero", () => {
    const r = resumoDaVez(novasMarcas({ n: 1, origem: "texto", vezEm: 500 }), "substituida");
    expect(r).toMatchObject({ origem: "texto", desfecho: "substituida", fechou: null, vez_ms: null, stt_final_ms: null, primeiro_delta_ms: null, primeiro_audio_ms: null, voz_a_voz_ms: null, ferramenta_ms: null });
    expect(r.trechos).toBe(0);
  });

  it("relógios fora de ordem não dão tempo negativo", () => {
    const m = novasMarcas({ n: 1, origem: "voz", vezEm: 1000 });
    m.fimDaVozEm = 1200;
    expect(resumoDaVez(m, "respondida").vez_ms).toBe(0);
  });

  it("o resumo não tem nenhum campo de texto falado", () => {
    const chaves = Object.keys(resumoDaVez(novasMarcas({ n: 1, origem: "voz", vezEm: 0 }), "respondida"));
    expect(chaves.some((k) => /texto|fala|legenda/.test(k) && k !== "texto_depois_da_ferramenta" && k !== "ferramenta_antes_do_texto")).toBe(false);
  });
});

describe("percentilMs", () => {
  it("p50 e p95 de uma lista, e null sem medidas", () => {
    expect(percentilMs([], 50)).toBeNull();
    expect(percentilMs([300], 95)).toBe(300);
    expect(percentilMs([5000, 1000, 3000, 2000, 4000], 50)).toBe(3000);
    expect(percentilMs([5000, 1000, 3000, 2000, 4000], 95)).toBe(5000);
  });
});
