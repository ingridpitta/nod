import { describe, expect, it } from "vitest";
import {
  aposAcessoRecusado,
  aposSondaFalha,
  aposSondaOk,
  aposSucessoDaChamada,
  aposTimeoutDaChamada,
  deveRessondar,
  ESTADO_LIMPO,
  esperaDaRessonda,
  mesmoEstado,
  falhaVisivel,
  normalizar,
  promover,
  temFalha,
  type EstadoDisjuntor,
} from "../../../src/domain/disjuntor-conector.ts";

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 26, 12, 0);
const MEIO = 0.5; // aleatório no meio = sem jitter

describe("disjuntor do conector (NOD-374)", () => {
  it("timeout isolado com sonda ok: só conta o timeout, sem falha aberta nem Fora do ar", () => {
    const e = aposSondaOk(aposTimeoutDaChamada(ESTADO_LIMPO, T0, MEIO), T0 + 1000, MEIO);
    expect(e.ultimaFalha).toBeNull();
    expect(e.foraDoArDesde).toBeNull();
    expect(e.timeoutsSeguidos).toBe(1);
  });

  it("timeout com sonda falhando: falhasSeguidas = 1, ultimaFalha preenchida, ainda não visível", () => {
    const e = aposSondaFalha(aposTimeoutDaChamada(ESTADO_LIMPO, T0, MEIO), "timeout_transporte", T0 + 1000, MEIO);
    expect(e.falhasSeguidas).toBe(1);
    expect(e.ultimaFalha).toEqual({ motivo: "timeout_transporte", em: T0 + 1000 });
    expect(e.foraDoArDesde).toBeNull();
    expect(e.proximaSondaEm).toBe(T0 + 1000 + MIN);
  });

  it("sucesso de chamada limpa tudo; temFalha diz quando é preciso escrever", () => {
    const aberto = aposSondaFalha(ESTADO_LIMPO, "conector_indisponivel", T0, MEIO);
    expect(temFalha(aberto)).toBe(true);
    expect(aposSucessoDaChamada(aberto)).toEqual(ESTADO_LIMPO);
    expect(temFalha(ESTADO_LIMPO)).toBe(false);
    expect(temFalha({ ...ESTADO_LIMPO, timeoutsSeguidos: 2 })).toBe(true);
  });

  it("sonda ok com falha aberta: o app voltou, limpa tudo", () => {
    let e = aposSondaFalha(ESTADO_LIMPO, "conector_indisponivel", T0, MEIO);
    e = aposSondaFalha(e, "conector_indisponivel", T0 + 11 * MIN, MEIO);
    expect(e.foraDoArDesde).not.toBeNull();
    expect(aposSondaOk(e, T0 + 12 * MIN, MEIO)).toEqual(ESTADO_LIMPO);
  });

  it("revisão 2 (A2): confirmações seguidas antes da hora não sobem a escada; a vencida sobe", () => {
    let e = aposSondaFalha(ESTADO_LIMPO, "conector_indisponivel", T0, MEIO);
    for (let i = 1; i <= 5; i++) e = aposSondaFalha(e, "conector_indisponivel", T0 + i * 1000, MEIO);
    expect(e).toMatchObject({ falhasSeguidas: 1, proximaSondaEm: T0 + MIN, foraDoArDesde: null });
    e = aposSondaFalha(e, "conector_indisponivel", T0 + MIN, MEIO);
    expect(e).toMatchObject({ falhasSeguidas: 2, proximaSondaEm: T0 + MIN + 2 * MIN });
    // Duas sondas falhando a 1 min uma da outra não bastam: falta a falha durar 10 min.
    expect(e.foraDoArDesde).toBeNull();
  });

  describe("espera da re-sonda (backoff e jitter)", () => {
    it("1, 2, 5, 15 e 30 min, depois 30 min sempre", () => {
      expect([1, 2, 3, 4, 5, 6, 50].map((n) => esperaDaRessonda(n, MEIO) / MIN)).toEqual([1, 2, 5, 15, 30, 30, 30]);
    });
    it("jitter de ±25% nos limites", () => {
      expect(esperaDaRessonda(5, 0)).toBe(Math.round(30 * MIN * 0.75));
      expect(esperaDaRessonda(5, 0.999999)).toBeLessThanOrEqual(Math.round(30 * MIN * 1.25));
      expect(esperaDaRessonda(5, 0.999999)).toBeGreaterThan(30 * MIN * 1.24);
      expect(esperaDaRessonda(1, 0)).toBe(45_000);
      expect(esperaDaRessonda(1, 1)).toBe(75_000);
    });
    it("aleatório fora de [0,1] e n inválido não estouram os limites", () => {
      expect(esperaDaRessonda(0, -3)).toBe(45_000);
      expect(esperaDaRessonda(99, 7)).toBe(Math.round(30 * MIN * 1.25));
    });
    it("a próxima sonda segue a escada a cada falha", () => {
      let e: EstadoDisjuntor = ESTADO_LIMPO;
      let t = T0;
      const esperas: number[] = [];
      for (let i = 0; i < 6; i++) {
        e = aposSondaFalha(e, "conector_indisponivel", t, MEIO);
        esperas.push((e.proximaSondaEm! - t) / MIN);
        t = e.proximaSondaEm!;
      }
      expect(esperas).toEqual([1, 2, 5, 15, 30, 30]);
    });
  });

  describe("persistência até o limiar", () => {
    it("9 min com 2 sondas falhando: ainda não aparece", () => {
      let e = aposSondaFalha(ESTADO_LIMPO, "conector_indisponivel", T0, MEIO);
      e = aposSondaFalha(e, "conector_indisponivel", T0 + 9 * MIN, MEIO);
      expect(e.falhasSeguidas).toBe(2);
      expect(e.foraDoArDesde).toBeNull();
    });
    it("10 min com 2 sondas falhando: aparece", () => {
      let e = aposSondaFalha(ESTADO_LIMPO, "conector_indisponivel", T0, MEIO);
      e = aposSondaFalha(e, "conector_indisponivel", T0 + 10 * MIN, MEIO);
      expect(e.foraDoArDesde).toBe(T0 + 10 * MIN);
    });
    it("10 min com 1 sonda só: não aparece; promover depois do tempo também não", () => {
      const e = aposSondaFalha(ESTADO_LIMPO, "conector_indisponivel", T0, MEIO);
      expect(promover(e, T0 + 60 * MIN).foraDoArDesde).toBeNull();
    });
    it("promover vira visível quando o tempo passa com 2 sondas (o laço chama sem sondar)", () => {
      let e = aposSondaFalha(ESTADO_LIMPO, "conector_indisponivel", T0, MEIO);
      e = aposSondaFalha(e, "conector_indisponivel", T0 + 2 * MIN, MEIO);
      expect(promover(e, T0 + 9 * MIN).foraDoArDesde).toBeNull();
      expect(promover(e, T0 + 10 * MIN).foraDoArDesde).toBe(T0 + 10 * MIN);
      const visivel = promover(e, T0 + 10 * MIN);
      expect(promover(visivel, T0 + 50 * MIN)).toBe(visivel);
    });
    it("carimbo antigo (antes do deploy): a 1ª sonda falhando não mostra, a 2ª mostra", () => {
      const antigo: EstadoDisjuntor = { ...ESTADO_LIMPO, ultimaFalha: { motivo: "timeout_transporte", em: T0 - 24 * 60 * MIN } };
      expect(deveRessondar(antigo, T0)).toBe(true);
      const um = aposSondaFalha(antigo, "conector_indisponivel", T0, MEIO);
      expect(um.foraDoArDesde).toBeNull();
      expect(um.ultimaFalha!.em).toBe(antigo.ultimaFalha!.em);
      expect(aposSondaFalha(um, "conector_indisponivel", T0 + MIN, MEIO).foraDoArDesde).toBe(T0 + MIN);
    });
  });

  it("401/403: aparece na hora com acesso_recusado e não re-sonda", () => {
    const e = aposAcessoRecusado(ESTADO_LIMPO, T0);
    expect(e.ultimaFalha).toEqual({ motivo: "falha_tecnica", em: T0, causa: "acesso_recusado" });
    expect(e.foraDoArDesde).toBe(T0);
    expect(deveRessondar(e, T0 + 99 * MIN)).toBe(false);
  });

  it("acesso recusado depois de uma falha comum troca a causa e mantém a data de visível", () => {
    let e = aposSondaFalha(ESTADO_LIMPO, "conector_indisponivel", T0, MEIO);
    e = aposSondaFalha(e, "conector_indisponivel", T0 + 10 * MIN, MEIO);
    const r = aposAcessoRecusado(e, T0 + 12 * MIN);
    expect(r.ultimaFalha!.causa).toBe("acesso_recusado");
    expect(r.foraDoArDesde).toBe(T0 + 10 * MIN);
  });

  describe("5 timeouts seguidos", () => {
    it("o 4º não aparece, o 5º abre a falha e aparece", () => {
      let e: EstadoDisjuntor = ESTADO_LIMPO;
      for (let i = 0; i < 4; i++) e = aposSondaOk(aposTimeoutDaChamada(e, T0 + i * MIN, MEIO), T0 + i * MIN + 1000, MEIO);
      expect(e.timeoutsSeguidos).toBe(4);
      expect(e.foraDoArDesde).toBeNull();
      e = aposTimeoutDaChamada(e, T0 + 4 * MIN, MEIO);
      expect(e.ultimaFalha).toEqual({ motivo: "timeout_transporte", em: T0 + 4 * MIN });
      expect(e.foraDoArDesde).toBe(T0 + 4 * MIN);
      // Aberta só pelos timeouts: a sonda vem no teto da espera (30 min), não no 1º degrau.
      expect(e.proximaSondaEm).toBe(T0 + 4 * MIN + 30 * MIN);
      expect(deveRessondar(e, T0 + 4 * MIN + 30 * MIN - 1)).toBe(false);
      expect(deveRessondar(e, T0 + 4 * MIN + 30 * MIN)).toBe(true);
    });
    it("a confirmação que responde antes da hora não fecha a falha dos 5 timeouts (revisão B1); a chamada que dá certo fecha", () => {
      let e: EstadoDisjuntor = ESTADO_LIMPO;
      for (let i = 0; i < 5; i++) e = aposTimeoutDaChamada(e, T0 + i * MIN, MEIO);
      const depois = aposSondaOk(e, T0 + 5 * MIN, MEIO);
      expect(depois).toBe(e);
      expect(depois.foraDoArDesde).toBe(T0 + 4 * MIN);
      expect(aposSucessoDaChamada(depois)).toEqual(ESTADO_LIMPO);
    });
    it("revisão 5: timeouts espalhados (mais de 10 min entre um e outro) não somam 5 seguidos; 5 dentro da janela abrem", () => {
      let e: EstadoDisjuntor = ESTADO_LIMPO;
      for (let i = 0; i < 4; i++) e = aposTimeoutDaChamada(e, T0 + i * 3 * 24 * 60 * MIN, MEIO);
      expect(e.timeoutsSeguidos).toBe(1);
      e = aposTimeoutDaChamada(e, T0 + 12 * 24 * 60 * MIN, MEIO);
      expect(e.timeoutsSeguidos).toBe(1);
      expect(falhaVisivel(e)).toBe(false);
      expect(e.ultimaFalha).toBeNull();
      let j: EstadoDisjuntor = ESTADO_LIMPO;
      for (let i = 0; i < 5; i++) j = aposTimeoutDaChamada(j, T0 + i * 9 * MIN, MEIO);
      expect(j.timeoutsSeguidos).toBe(5);
      expect(falhaVisivel(j)).toBe(true);
      // Revisão 6: a rotina de hora em hora (e a diária) que sempre estoura chega a Fora do ar.
      for (const passo of [60 * MIN, 24 * 60 * MIN]) {
        let r: EstadoDisjuntor = ESTADO_LIMPO;
        for (let i = 0; i < 5; i++) r = aposTimeoutDaChamada(r, T0 + i * passo, MEIO);
        expect(falhaVisivel(r)).toBe(true);
      }
      // Estado antigo sem o campo conta como antigo: recomeça do 1.
      const legado = { ...ESTADO_LIMPO, timeoutsSeguidos: 4 } as EstadoDisjuntor;
      delete (legado as { ultimoTimeoutEm?: unknown }).ultimoTimeoutEm;
      expect(aposTimeoutDaChamada(legado, T0, MEIO).timeoutsSeguidos).toBe(1);
      expect(mesmoEstado(e, { ...e, ultimoTimeoutEm: T0 })).toBe(false);
    });

    it("revisão 3: cada timeout novo empurra a sonda; a sonda vencida que responde (um teto sem timeout) fecha sozinha", () => {
      let e: EstadoDisjuntor = ESTADO_LIMPO;
      for (let i = 0; i < 5; i++) e = aposTimeoutDaChamada(e, T0 + i * MIN, MEIO);
      e = aposTimeoutDaChamada(e, T0 + 20 * MIN, MEIO);
      expect(e).toMatchObject({ timeoutsSeguidos: 6, proximaSondaEm: T0 + 50 * MIN, ultimaFalha: { em: T0 + 4 * MIN } });
      // A sonda da hora antiga (T0+34) já não vence: houve timeout no meio.
      expect(aposSondaOk(e, T0 + 34 * MIN, MEIO)).toBe(e);
      expect(aposSondaOk(e, T0 + 50 * MIN, MEIO)).toEqual(ESTADO_LIMPO);
    });
    it("revisão 2 (A1): se uma sonda falhou (o app caiu de fato), a sonda que responde fecha mesmo com 5 timeouts", () => {
      let e = aposSondaFalha(ESTADO_LIMPO, "conector_indisponivel", T0, MEIO);
      for (let i = 0; i < 5; i++) e = aposTimeoutDaChamada(e, T0 + i * 1000, MEIO);
      expect(e.timeoutsSeguidos).toBe(5);
      expect(e.foraDoArDesde).not.toBeNull();
      expect(aposSondaOk(e, T0 + 2 * MIN, MEIO)).toEqual(ESTADO_LIMPO);
    });
    it("o acesso recusado depois dos 5 timeouts sai com a sonda que responde (a regra dos 5 só vale para timeout)", () => {
      let e: EstadoDisjuntor = ESTADO_LIMPO;
      for (let i = 0; i < 5; i++) e = aposTimeoutDaChamada(e, T0 + i * MIN, MEIO);
      e = aposSondaFalha(e, "conector_indisponivel", T0 + 6 * MIN, MEIO);
      e = aposAcessoRecusado(e, T0 + 7 * MIN);
      expect(aposSondaOk(e, T0 + 8 * MIN, MEIO)).toEqual(ESTADO_LIMPO);
    });
    it("normalizar: sem falha, nada de contagem de sonda, próxima nem Fora do ar (só os timeouts ficam)", () => {
      const torto = { ultimaFalha: null, falhasSeguidas: 3, timeoutsSeguidos: 2, proximaSondaEm: T0, foraDoArDesde: T0 };
      expect(normalizar(torto)).toEqual({ ...ESTADO_LIMPO, timeoutsSeguidos: 2 });
      const aberto = aposSondaFalha(ESTADO_LIMPO, "conector_indisponivel", T0, MEIO);
      expect(normalizar(aberto)).toBe(aberto);
    });
    it("acesso recusado repetido mantém a data do começo da falha", () => {
      const r1 = aposAcessoRecusado(ESTADO_LIMPO, T0);
      const r2 = aposAcessoRecusado(r1, T0 + 5 * MIN);
      expect(r2.ultimaFalha!.em).toBe(T0);
      expect(r2.foraDoArDesde).toBe(T0);
    });
    it("um sucesso no meio zera a contagem", () => {
      let e: EstadoDisjuntor = ESTADO_LIMPO;
      for (let i = 0; i < 4; i++) e = aposTimeoutDaChamada(e, T0, MEIO);
      e = aposSucessoDaChamada(e);
      e = aposTimeoutDaChamada(e, T0, MEIO);
      expect(e.timeoutsSeguidos).toBe(1);
      expect(e.foraDoArDesde).toBeNull();
    });
  });

  it("deveRessondar: sem falha não; vencida sim; antes da hora não; próxima nula sim", () => {
    expect(deveRessondar(ESTADO_LIMPO, T0)).toBe(false);
    const e = aposSondaFalha(ESTADO_LIMPO, "conector_indisponivel", T0, MEIO);
    expect(deveRessondar(e, T0 + MIN - 1)).toBe(false);
    expect(deveRessondar(e, T0 + MIN)).toBe(true);
    expect(deveRessondar({ ...e, proximaSondaEm: null }, T0)).toBe(true);
  });

  it("mesmoEstado compara campo a campo", () => {
    const e = aposSondaFalha(ESTADO_LIMPO, "conector_indisponivel", T0, MEIO);
    expect(mesmoEstado(e, { ...e, ultimaFalha: { ...e.ultimaFalha! } })).toBe(true);
    expect(mesmoEstado(e, { ...e, falhasSeguidas: 2 })).toBe(false);
    expect(mesmoEstado(ESTADO_LIMPO, { ...ESTADO_LIMPO })).toBe(true);
    expect(mesmoEstado(ESTADO_LIMPO, e)).toBe(false);
  });
});
