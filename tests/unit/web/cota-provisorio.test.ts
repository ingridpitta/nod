import { describe, expect, it } from "vitest";
import { reagirACota, textoDepoisDaCota } from "../../../web/lib/cota-provisorio.ts";

describe("cota do espaço provisório (NOD-408)", () => {
  it("repõe a mensagem barrada sem apagar o próximo rascunho", () => {
    expect(textoDepoisDaCota("mensagem barrada", "")).toBe("mensagem barrada");
    expect(textoDepoisDaCota("mensagem barrada", "próxima mensagem")).toBe("mensagem barrada\npróxima mensagem");
    expect(textoDepoisDaCota("mensagem barrada", "mensagem barrada")).toBe("mensagem barrada");
  });

  it("o envio barrado tira a fala, repõe o rascunho e abre o cartão de conta", async () => {
    const efeitos: string[] = [];
    await reagirACota({
      enviado: "mensagem barrada",
      atual: "próxima",
      retirarFala: () => efeitos.push("tirou"),
      repor: (texto) => efeitos.push(`repôs:${texto}`),
      abrirConta: async () => { efeitos.push("abriu"); },
    });
    expect(efeitos).toEqual(["tirou", "repôs:mensagem barrada\npróxima", "abriu"]);
  });
});
