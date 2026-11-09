import { expect, it } from "vitest";
import { pastaDoBot } from "../../../src/domain/nativas.ts";
import { caminhoDaPastaDoBot } from "../../../web/lib/pasta-do-bot.ts";

it("o painel mostra a mesma pasta que o driver cria (ADR-052)", () => {
  for (const nome of ["Ada", "Dev 1 (cópia)", "a/b:c", "..", "  Nina   da Acme ", "Café"]) {
    expect(caminhoDaPastaDoBot(nome), nome).toBe(`~/nod/${pastaDoBot(nome)}`);
  }
});
