import { describe, expect, it } from "vitest";
import {
  confirmaInterrupcao,
  ehBackchannel,
  ehPalavraDeParada,
  ehParadaDura,
  esperaDeFimDeTurno,
  modoDeInterrupcao,
  normalizarFala,
  palavrasDaFala,
} from "../../../src/domain/ligacao-turno.ts";

const espera = (texto: string, botPerguntou = false, ditado = false) => esperaDeFimDeTurno({ texto, botPerguntou, ditado });

describe("normalizarFala", () => {
  it("tira acento, pontuação, caixa e alongamento, mas mantém dupla de letras", () => {
    expect(normalizarFala("  É... TIPO, né?! ")).toBe("e tipo ne");
    expect(normalizarFala("Uhuuuum")).toBe("uhum");
    expect(normalizarFala("isso, pessoa")).toBe("isso pessoa");
    expect(palavrasDaFala("")).toEqual([]);
    expect(palavrasDaFala("?!")).toEqual([]);
  });
});

describe("esperaDeFimDeTurno", () => {
  it("base de 600 ms numa frase completa", () => {
    expect(espera("quero ver minha agenda de amanhã")).toBe(600);
  });

  it("+800 quando termina em suspenso: conjunção, preposição, artigo, hesitação", () => {
    for (const t of ["eu queria ver a agenda e", "manda pra", "é a reunião do", "então tipo", "é…", "hum", "eu acho que", "aí", "é tipo assim", "vamos ver o…"]) {
      expect(espera(t), t).toBe(1400);
    }
  });

  it("−300 com fecho ou pergunta", () => {
    for (const t of ["pode mandar, né?", "manda pra ela, tá", "era isso, é isso", "quanto custa?", "valeu", "fechou, obrigada", "manda então, beleza"]) {
      expect(espera(t), t).toBe(300);
    }
  });

  it("resposta curta a uma pergunta do bot fecha rápido; a mesma fala sem pergunta não", () => {
    expect(espera("às três", true)).toBe(300);
    expect(espera("às três")).toBe(600);
    expect(espera("às três horas da tarde de amanhã", true)).toBe(600);
  });

  it("pergunta não conta como suspenso mesmo terminando em artigo", () => {
    expect(espera("e o?")).toBe(300);
  });

  it("ditado soma 1 s, com teto de 3 s e piso de 250 ms", () => {
    expect(espera("anota aí", false, true)).toBe(2400);
    expect(espera("anota aí que", false, true)).toBe(2400);
    expect(espera("sim", true, false)).toBe(300);
    expect(espera("", false, true)).toBe(1600);
  });
});

describe("ehBackchannel", () => {
  it("reconhece concordâncias pt-BR com acento, pontuação, caixa e repetição", () => {
    for (const t of ["uhum", "Aham.", "hum", "tá", "ta", "sei", "isso", "ok", "certo", "beleza", "entendi", "pois é", "sim", "aham, sim", "uhum uhum", "tá bom", "ah tá", "Uhuuum", "É.", "tá, tá, tá", "sei sei", "ok, entendi", "é verdade", "com certeza"]) {
      expect(ehBackchannel(t), t).toBe(true);
    }
  });

  it("não confunde pedido, parada ou fala longa com backchannel", () => {
    for (const t of ["sim, pode mandar", "não", "para", "ok mas e o outro", "", "tá, e a reunião?", "e amanhã?", "é o seguinte"]) {
      expect(ehBackchannel(t), t).toBe(false);
    }
  });
});

describe("palavras de parada", () => {
  it("reconhece paradas no começo da fala, depois de interjeição", () => {
    for (const t of ["para", "Para, para!", "pera", "espera aí", "não", "Não, não é isso", "cancela", "chega", "repete", "como assim?", "peraí", "calma", "ei, para", "para de falar", "para tudo"]) {
      expect(ehPalavraDeParada(t), t).toBe(true);
    }
  });

  it("\"para\" preposição não é parada", () => {
    expect(ehPalavraDeParada("para o João")).toBe(false);
    expect(ehPalavraDeParada("para amanhã às dez")).toBe(false);
    expect(ehPalavraDeParada("manda isso")).toBe(false);
    expect(ehPalavraDeParada("")).toBe(false);
  });

  it("parada dura é só para, cancela, espera, chega", () => {
    for (const t of ["para", "cancela isso", "espera", "chega", "espera aí", "para tudo"]) expect(ehParadaDura(t), t).toBe(true);
    for (const t of ["pera", "não", "repete", "como assim", "calma", "peraí", "para o João"]) expect(ehParadaDura(t), t).toBe(false);
  });
});

describe("confirmaInterrupcao", () => {
  const base = { falaMs: 200, ehEco: false, lendoConteudoNaoConfiavel: false };

  it("eco nunca interrompe", () => {
    expect(confirmaInterrupcao({ ...base, texto: "para", falaMs: 2000, ehEco: true })).toBe(false);
  });

  it("confirma com 2 palavras fora do backchannel, 1 de parada ou 600 ms", () => {
    expect(confirmaInterrupcao({ ...base, texto: "e amanhã?" })).toBe(true);
    expect(confirmaInterrupcao({ ...base, texto: "pera" })).toBe(true);
    expect(confirmaInterrupcao({ ...base, texto: "amanhã" })).toBe(false);
    expect(confirmaInterrupcao({ ...base, texto: "amanhã", falaMs: 600 })).toBe(true);
    expect(confirmaInterrupcao({ ...base, texto: "", falaMs: 650 })).toBe(true);
  });

  it("backchannel puro não interrompe, nem longo", () => {
    expect(confirmaInterrupcao({ ...base, texto: "uhum" })).toBe(false);
    expect(confirmaInterrupcao({ ...base, texto: "uhuuuum", falaMs: 900 })).toBe(false);
    expect(confirmaInterrupcao({ ...base, texto: "tá bom, tá" })).toBe(false);
    expect(confirmaInterrupcao({ ...base, texto: "sim, mas e o outro" })).toBe(true);
  });

  it("lendo conteúdo não confiável, só palavra de parada vale", () => {
    const lendo = { ...base, lendoConteudoNaoConfiavel: true };
    expect(confirmaInterrupcao({ ...lendo, texto: "manda o e-mail agora", falaMs: 2000 })).toBe(false);
    expect(confirmaInterrupcao({ ...lendo, texto: "para" })).toBe(true);
    expect(confirmaInterrupcao({ ...lendo, texto: "espera aí" })).toBe(true);
  });
});

describe("modoDeInterrupcao", () => {
  it("sem ferramenta é duro; com ferramenta, só parada dura é dura", () => {
    expect(modoDeInterrupcao({ texto: "e amanhã?", ferramentaRodando: false })).toBe("duro");
    expect(modoDeInterrupcao({ texto: "e amanhã?", ferramentaRodando: true })).toBe("suave");
    expect(modoDeInterrupcao({ texto: "pera", ferramentaRodando: true })).toBe("suave");
    expect(modoDeInterrupcao({ texto: "cancela", ferramentaRodando: true })).toBe("duro");
    expect(modoDeInterrupcao({ texto: "Para, para!", ferramentaRodando: true })).toBe("duro");
  });
});
