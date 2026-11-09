import { describe, expect, it } from "vitest";
import { VOZES_NOD } from "../../../src/contracts/vozes.ts";
import { apurarMos, aprovado, avaliarStt, embaralhar, FRASES_TESTE_TTS, lerCorpus, lerNotas, temNome, type ItemCorpus } from "../../../scripts/voz/medidas-teste-cego.ts";

describe("voz: contas do teste cego (NOD-166)", () => {
  const corpus: ItemCorpus[] = [
    { arquivo: "1.wav", texto: "Oi Nina, tudo bem?", nomes: ["Nina"] },
    { arquivo: "2.wav", texto: "Chama a Íris e o Theo", nomes: ["Íris", "Theo"] },
    { arquivo: "3.wav", texto: "eu aprovo", comando: { perfil: "estrito", acao: "aprovar" } },
    { arquivo: "4.wav", texto: "não aprovo", comando: { perfil: "estrito", acao: "recusar" } },
    { arquivo: "5.wav", texto: "pode criar", comando: { perfil: "proposta", acao: "aprovar" } },
  ];

  it("nome conta sem acento e caixa, só como palavra inteira", () => {
    expect(temNome("oi, NINA!", "Nina")).toBe(true);
    expect(temNome("chama a iris", "Íris")).toBe(true);
    expect(temNome("Ouina", "Nina")).toBe(false);
    expect(temNome("teodoro", "Theo")).toBe(false);
  });

  it("mede nomes e comandos pelo classificador do orquestrador e acha a recusa que virou aprovação", () => {
    const certo = new Map([["1.wav", "Oi Nina tudo bem"], ["2.wav", "chama a Íris e o Theo"], ["3.wav", "Eu aprovo."], ["4.wav", "Não, aprovo não"], ["5.wav", "pode criar"]]);
    const r = avaliarStt(corpus, certo);
    expect([r.nomes, r.comandos, r.aprovacoesFalsas]).toEqual([{ acertos: 3, total: 3 }, { acertos: 3, total: 3 }, []]);
    expect(aprovado(r)).toBe(true);

    // o STT comeu o "não": a recusa virou aprovação, o pior erro possível
    const errado = new Map([...certo, ["1.wav", "Ouina tudo bem"], ["4.wav", "aprovo"]]);
    const e = avaliarStt(corpus, errado);
    expect(e.nomes.acertos).toBe(2);
    expect(e.aprovacoesFalsas).toEqual([{ arquivo: "4.wav", transcrito: "aprovo" }]);
    expect(aprovado(e)).toBe(false);
  });

  it("esperado.json malformado falha com a explicação", () => {
    expect(() => lerCorpus({})).toThrow("lista de itens");
    expect(() => lerCorpus([{ arquivo: "1.wav" }])).toThrow("item 0");
  });

  it("TTS: 25 frases × 8 vozes, embaralhadas de forma reproduzível pela semente", () => {
    expect(FRASES_TESTE_TTS).toHaveLength(25);
    const pares = VOZES_NOD.flatMap((v) => FRASES_TESTE_TTS.map((_, frase) => ({ voz: v.id, frase })));
    const a = embaralhar(pares, 166);
    expect(a).toHaveLength(200);
    expect(a).toEqual(embaralhar(pares, 166));
    expect(a).not.toEqual(pares);
    expect(new Set(a.map((p) => `${p.voz}:${p.frase}`)).size).toBe(200);
  });

  it("apura o MOS por voz e marca quem cai abaixo de 3,5; linha sem nota válida é ignorada", () => {
    const gabarito = [
      { amostra: "A001", voz: "clara", frase: 0 },
      { amostra: "A002", voz: "rui", frase: 0 },
      { amostra: "A003", voz: "luna", frase: 1 },
    ];
    const notas = lerNotas("amostra,ouvinte,nota\nA001,ana,4\nA001,bia,5\nA002,ana,3\nA002,bia,3.5\nA001,caio,\nA002,caio,9\n");
    expect(notas).toHaveLength(4);
    expect(apurarMos(gabarito, notas)).toEqual([
      { voz: "clara", mos: 4.5, notas: 2, ouvintes: 2, sai: false },
      { voz: "rui", mos: 3.25, notas: 2, ouvintes: 2, sai: true },
      { voz: "luna", mos: null, notas: 0, ouvintes: 0, sai: false },
    ]);
  });
});
