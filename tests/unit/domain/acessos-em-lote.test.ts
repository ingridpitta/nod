import { describe, expect, it } from "vitest";
import { alvosDoLote, ehNivelDeAcesso, fraseDoLote, nivelDoConjunto, planoDeVolta, planoDoNivel, segueOPadrao } from "../../../src/domain/acessos-em-lote.ts";

/** ADA-241 (ADR-158): as regras puras do lote e do padrão do app. */
const CAT = [
  { nome: "LER", readOnlyHint: true },
  { nome: "CRIAR", readOnlyHint: false },
  { nome: "APAGAR", readOnlyHint: false, destructiveHint: true },
];

describe("acessos em lote (domínio)", () => {
  it("o nível é o conjunto exato; o resto é personalizado", () => {
    expect(nivelDoConjunto(CAT, [])).toBe("nenhum");
    expect(nivelDoConjunto(CAT, ["LER"])).toBe("leitura");
    expect(nivelDoConjunto(CAT, ["CRIAR", "LER"])).toBe("escrita");
    expect(nivelDoConjunto(CAT, ["LER", "APAGAR"])).toBe("personalizado");
  });

  it("escolher um nível mexe só no que é dele; Nenhum tira tudo, até o apagar dado à parte", () => {
    expect(planoDoNivel(CAT, ["LER", "APAGAR"], "escrita")).toEqual({ revogar: [], conceder: ["CRIAR"], depois: ["APAGAR", "CRIAR", "LER"] });
    expect(planoDoNivel(CAT, ["LER", "CRIAR", "APAGAR"], "leitura")).toEqual({ revogar: ["CRIAR"], conceder: [], depois: ["APAGAR", "LER"] });
    expect(planoDoNivel(CAT, ["LER", "APAGAR"], "nenhum").revogar.sort()).toEqual(["APAGAR", "LER"]);
  });

  it("o Desfazer volta o conjunto exato de antes", () => {
    expect(planoDeVolta(["LER", "CRIAR"], ["LER", "APAGAR"])).toEqual({ revogar: ["CRIAR"], conceder: ["APAGAR"] });
  });

  it("todos com Ler não rebaixa Ler e alterar nem personalizado; a seleção manual recebe o nível exato; quem já está no nível fica de fora", () => {
    const bots = [{ agenteId: "a", atual: "nenhum" as const }, { agenteId: "b", atual: "escrita" as const }, { agenteId: "c", atual: "personalizado" as const }, { agenteId: "d", atual: "leitura" as const }];
    expect(alvosDoLote(bots, "leitura", true)).toEqual({ alvos: ["a"], mantidos: ["b", "c", "d"] });
    expect(alvosDoLote(bots, "leitura", false)).toEqual({ alvos: ["a", "b", "c"], mantidos: ["d"] });
    expect(alvosDoLote(bots, "nenhum", true)).toEqual({ alvos: ["b", "c", "d"], mantidos: ["a"] });
  });

  it("segue o padrão: sem marca e sem acesso, ou marcado 'padrao' ainda no nível do padrão; a escolha da pessoa nunca", () => {
    expect(segueOPadrao(null, "nenhum", "leitura")).toBe(true);
    expect(segueOPadrao(null, "leitura", "leitura")).toBe(false);
    expect(segueOPadrao("padrao", "leitura", "leitura")).toBe(true);
    expect(segueOPadrao("padrao", "personalizado", "leitura")).toBe(false);
    expect(segueOPadrao("pessoa", "nenhum", "nenhum")).toBe(false);
  });

  it("frase e nível válido", () => {
    expect(fraseDoLote(1, "leitura", "Gmail")).toBe("1 bot com Ler no Gmail");
    expect(fraseDoLote(3, "nenhum", "Gmail")).toBe("3 bots sem acesso ao Gmail");
    expect(fraseDoLote(2, "escrita", "Gmail")).toBe("2 bots com Ler e alterar no Gmail");
    expect(ehNivelDeAcesso("leitura")).toBe(true);
    expect(ehNivelDeAcesso("personalizado")).toBe(false);
  });
});
