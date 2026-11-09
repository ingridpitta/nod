import { describe, expect, it } from "vitest";
import { cabecalhosDoApp as doApp } from "../../../web/lib/desafio-app.ts";
import { AppDesatualizado } from "../../../web/lib/erro-api.ts";
import { fraseDoErro } from "../../../web/telas/conta-no-chat.ts";

/**
 * NOD-345 (revisão do PR 504): no app, entrar/importar/redefinir só saem com a ponte inteira e o desafio. O app de antes
 * (sem `trocarConta`) trocaria o cookie da tela e deixaria o executor na chave do espaço velho.
 */
describe("doApp", () => {
  it("no navegador (sem ponte), o pedido sai sem desafio", async () => {
    expect(await doApp(undefined)).toEqual({});
  });

  it("app de antes, sem a ponte de troca: o pedido não sai e a frase pede para atualizar", async () => {
    await expect(doApp({})).rejects.toBeInstanceOf(AppDesatualizado);
    await expect(doApp({ desafioConta: async () => "d" })).rejects.toBeInstanceOf(AppDesatualizado);
    expect(fraseDoErro(new AppDesatualizado())).toMatch(/Atualize o app/);
  });

  it("app com a ponte inteira: o desafio vai no cabeçalho", async () => {
    expect(await doApp({ desafioConta: async () => "abc", trocarConta: async () => true })).toEqual({ cabecalhos: { "x-nod-app-desafio": "abc" } });
  });
});
