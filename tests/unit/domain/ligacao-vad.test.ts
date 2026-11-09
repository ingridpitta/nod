import { describe, expect, it } from "vitest";
import { criarVad, energiaRms, type EventoVad, VOZ_MINIMA_MS } from "../../../src/domain/ligacao-vad.ts";

/** Quadro de 20 ms (320 amostras a 16 kHz) com uma senoide de amplitude `amp` (0..1). */
const quadro = (amp: number): Int16Array => {
  const q = new Int16Array(320);
  for (let i = 0; i < q.length; i++) q[i] = Math.round(Math.sin((2 * Math.PI * 440 * i) / 16000) * amp * 32767);
  return q;
};
const silencio = quadro(0.002);
const voz = quadro(0.2);

/** Passa `n` quadros iguais a partir de `t0`, devolvendo os eventos e o próximo instante. */
function passar(vad: ReturnType<typeof criarVad>, q: Int16Array, n: number, t0: number): { eventos: EventoVad[]; t: number } {
  const eventos: EventoVad[] = [];
  let t = t0;
  for (let i = 0; i < n; i++) {
    const e = vad.passo(q, t);
    if (e) eventos.push(e);
    t += 20;
  }
  return { eventos, t };
}

describe("energiaRms", () => {
  it("vai de 0 a 1", () => {
    expect(energiaRms(new Int16Array(0))).toBe(0);
    expect(energiaRms(new Int16Array(320))).toBe(0);
    expect(energiaRms(new Int16Array(320).fill(-32768))).toBe(1);
    expect(energiaRms(quadro(1))).toBeCloseTo(Math.SQRT1_2, 2);
  });
});

describe("criarVad", () => {
  it("emite início depois de 3 quadros com voz, datado no primeiro, e fim depois de 600 ms de silêncio", () => {
    const vad = criarVad();
    let r = passar(vad, silencio, 50, 0);
    expect(r.eventos).toEqual([]);
    expect(vad.silencioMs()).toBe(1000);
    const inicioVoz = r.t;
    r = passar(vad, voz, 2, r.t);
    expect(r.eventos).toEqual([]);
    expect(vad.falando()).toBe(false);
    r = passar(vad, voz, 1, r.t);
    expect(r.eventos).toEqual([{ tipo: "inicio", em: inicioVoz }]);
    expect(vad.falando()).toBe(true);
    r = passar(vad, voz, 47, r.t);
    const fimVoz = r.t;
    r = passar(vad, silencio, 29, r.t);
    expect(r.eventos).toEqual([]);
    expect(vad.silencioMs()).toBe(580);
    r = passar(vad, silencio, 1, r.t);
    expect(r.eventos).toEqual([{ tipo: "fim", em: fimVoz, duracaoMs: fimVoz - inicioVoz, vozMs: 1000 }]);
    expect(vad.falando()).toBe(false);
  });

  it("o fim conta só os quadros com voz: uma batida de 100 ms fica abaixo de VOZ_MINIMA_MS (o orquestrador descarta)", () => {
    const vad = criarVad();
    let r = passar(vad, voz, 5, 0);
    expect(r.eventos).toEqual([{ tipo: "inicio", em: 0 }]);
    r = passar(vad, silencio, 30, r.t);
    const fim = r.eventos[0];
    expect(fim).toMatchObject({ tipo: "fim", vozMs: 100 });
    expect(fim?.tipo === "fim" && fim.vozMs < VOZ_MINIMA_MS).toBe(true);
  });

  it("estalo isolado (1–2 quadros) não vira fala", () => {
    const vad = criarVad();
    let t = 0;
    for (let i = 0; i < 20; i++) {
      expect(vad.passo(i % 3 === 0 ? voz : silencio, t)).toBeNull();
      t += 20;
    }
  });

  it("pausa curta no meio da fala não fecha (só o silêncio contínuo conta)", () => {
    const vad = criarVad({ silencioParaFimMs: 600 });
    let r = passar(vad, voz, 10, 0);
    r = passar(vad, silencio, 20, r.t);
    r = passar(vad, voz, 5, r.t);
    expect(r.eventos).toEqual([]);
    expect(vad.falando()).toBe(true);
    expect(vad.silencioMs()).toBe(0);
  });

  it("ruído constante que ligou no meio (ventilador) vira piso em ~2 s e a \"fala\" fecha", () => {
    const vad = criarVad();
    const ruido = quadro(0.02);
    let r = passar(vad, silencio, 50, 0);
    r = passar(vad, ruido, 200, r.t);
    expect(r.eventos.map((e) => e.tipo)).toEqual(["inicio", "fim"]);
    expect(vad.falando()).toBe(false);
    expect(vad.limiar()).toBeGreaterThan(energiaRms(ruido));
    // depois de aprendido, o mesmo ruído não dispara de novo
    expect(passar(vad, ruido, 100, r.t).eventos).toEqual([]);
  });

  it("voz desde o primeiro quadro não vira piso nos primeiros 2 s", () => {
    const vad = criarVad();
    const r = passar(vad, voz, 90, 0);
    expect(r.eventos).toEqual([{ tipo: "inicio", em: 0 }]);
    expect(vad.falando()).toBe(true);
  });

  it("fundo silencioso aprendido: ruído que já virou piso não dispara, voz de verdade dispara", () => {
    const vad = criarVad();
    passar(vad, quadro(0.004), 100, 0);
    expect(vad.limiar()).toBeCloseTo(0.01, 5);
    const r = passar(vad, voz, 3, 2000);
    expect(r.eventos[0]?.tipo).toBe("inicio");
  });

  it("com o bot falando o limiar sobe: eco fraco não dispara, a mesma energia dispara com o bot calado", () => {
    const eco = quadro(0.02);
    const comBot = criarVad();
    comBot.definirBotFalando(true);
    expect(passar(comBot, eco, 10, 0).eventos).toEqual([]);
    expect(comBot.limiar()).toBeCloseTo(0.025, 5);
    const semBot = criarVad();
    expect(passar(semBot, eco, 3, 0).eventos[0]?.tipo).toBe("inicio");
  });

  it("o eco não ensina o piso", () => {
    const vad = criarVad();
    vad.definirBotFalando(true);
    passar(vad, quadro(0.01), 100, 0);
    expect(vad.piso()).toBe(0);
  });

  it("teto do trecho: ruído que nunca dá 600 ms de silêncio fecha sozinho aos 30 s, e o que vem depois é um trecho novo", () => {
    const vad = criarVad();
    // Um estalo acima do limiar a cada 400 ms: nunca há 600 ms seguidos de silêncio.
    const eventos: EventoVad[] = [];
    let t = 0;
    passar(vad, voz, 3, t).eventos.forEach((e) => eventos.push(e));
    t = 60;
    while (t < 31_000) {
      const q = t % 400 === 0 ? voz : silencio;
      const e = vad.passo(q, t);
      if (e) eventos.push(e);
      t += 20;
    }
    const fim = eventos.find((e) => e.tipo === "fim");
    expect(fim).toMatchObject({ tipo: "fim", teto: true });
    expect(fim && fim.tipo === "fim" ? fim.duracaoMs : 0).toBeGreaterThanOrEqual(29_000);
    expect(eventos.filter((e) => e.tipo === "fim")).toHaveLength(1);
    // Fala de verdade depois do teto começa outro trecho.
    expect(passar(vad, voz, 3, t).eventos[0]?.tipo).toBe("inicio");
  });

  it("o teto é opção: com 1 s, fala contínua fecha em 1 s", () => {
    const vad = criarVad({ maxFalaMs: 1000 });
    const r = passar(vad, voz, 60, 0);
    expect(r.eventos[1]).toEqual({ tipo: "fim", em: 1000, duracaoMs: 1000, vozMs: 1000, teto: true });
  });

  it("encerrarTrecho fecha o trecho em curso sem esperar o silêncio; sem ninguém falando, devolve null", () => {
    const vad = criarVad();
    expect(vad.encerrarTrecho()).toBeNull();
    passar(vad, voz, 20, 0);
    expect(vad.falando()).toBe(true);
    expect(vad.encerrarTrecho()).toEqual({ tipo: "fim", em: 400, duracaoMs: 400, vozMs: 400 });
    expect(vad.falando()).toBe(false);
    expect(vad.encerrarTrecho()).toBeNull();
    // O ruído que segue precisa de 3 quadros de novo para abrir outro trecho.
    expect(passar(vad, voz, 2, 400).eventos).toEqual([]);
    expect(passar(vad, voz, 1, 440).eventos).toEqual([{ tipo: "inicio", em: 400 }]);
  });

  it("trecho fechado como ruído ensina o piso na hora: o mesmo ruído não abre outro trecho; fechado sem isso, abre", () => {
    const ruido = quadro(0.02);
    const semAprender = criarVad();
    let r = passar(semAprender, ruido, 75, 0);
    expect(semAprender.encerrarTrecho()).toMatchObject({ tipo: "fim" });
    expect(passar(semAprender, ruido, 3, r.t).eventos[0]?.tipo).toBe("inicio");

    const aprendendo = criarVad();
    r = passar(aprendendo, ruido, 75, 0);
    expect(aprendendo.encerrarTrecho(true)).toMatchObject({ tipo: "fim" });
    expect(aprendendo.limiar()).toBeGreaterThan(energiaRms(ruido));
    expect(passar(aprendendo, ruido, 20, r.t).eventos).toEqual([]);
    // Voz de verdade por cima do ruído ainda dispara.
    expect(passar(aprendendo, voz, 3, r.t + 400).eventos[0]?.tipo).toBe("inicio");
  });

  it("vozMs conta só os quadros com voz do trecho em curso", () => {
    const vad = criarVad();
    expect(vad.vozMs()).toBe(0);
    let r = passar(vad, voz, 5, 0);
    expect(vad.vozMs()).toBe(100);
    r = passar(vad, silencio, 10, r.t);
    expect(vad.vozMs()).toBe(100);
    passar(vad, silencio, 25, r.t);
    expect(vad.falando()).toBe(false);
    expect(vad.vozMs()).toBe(0);
  });

  it("opções mudam o número de quadros e o silêncio do fim", () => {
    const vad = criarVad({ quadrosParaInicio: 1, silencioParaFimMs: 100 });
    expect(vad.passo(voz, 0)).toEqual({ tipo: "inicio", em: 0 });
    const r = passar(vad, silencio, 5, 20);
    expect(r.eventos).toEqual([{ tipo: "fim", em: 20, duracaoMs: 20, vozMs: 20 }]);
  });
});
