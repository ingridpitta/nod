import { describe, expect, it } from "vitest";
import { complementoCapacidades } from "../../../src/domain/catalogo-conectores.ts";

const conector = {
  catalogo: [
    { nome: "listar_contatos", descricao: "Lista contatos" },
    { nome: "enviar_email", descricao: "Envia e-mail" },
  ],
};

describe("catalogo-conectores", () => {
  it("capacidades começam todas fora do complemento ligado — E2.4", () => {
    expect(complementoCapacidades(conector, [])).toHaveLength(2);
  });

  it("o complemento diz exatamente o que NÃO foi ligado", () => {
    expect(complementoCapacidades(conector, ["listar_contatos"])).toEqual(["enviar_email: Envia e-mail"]);
  });
});
