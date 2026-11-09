import { describe, expect, it } from "vitest";
import type { Autoria } from "../../../src/contracts/evento.ts";
import { assinatura } from "../../../web/lib/assinatura.ts";

const VERA = "aaaaaaaa-0000-4000-8000-000000000001";
const CAROLINA = "bbbbbbbb-0000-4000-8000-000000000002";
const NOMES = { [VERA]: "Vera", [CAROLINA]: "Carolina" };

function autoria(parte: Partial<Autoria>): Autoria {
  return {
    autor_tipo: "agente",
    autor_id: VERA,
    sob_procuracao_de: null,
    conta_de_execucao: CAROLINA,
    executor: "local",
    locality: "local",
    locality_reason: "tudo_local_nesta_rodada",
    machine_id: null,
    decidido_por: "regra:localidade",
    regra_versao: 1,
    ...parte,
  };
}

describe("assinatura derivada da autoria composta (ADR-023)", () => {
  it("'Vera · por Carolina' com procuração; só 'Vera' sem", () => {
    expect(assinatura(autoria({ sob_procuracao_de: CAROLINA }), NOMES)).toBe("Vera · por Carolina");
    expect(assinatura(autoria({}), NOMES)).toBe("Vera");
    expect(assinatura(autoria({ autor_tipo: "pessoa", autor_id: CAROLINA }), NOMES)).toBe("Carolina");
  });

  it("id desconhecido cai no genérico por autor_tipo, nunca mostra o uuid", () => {
    const desconhecido = "cccccccc-0000-4000-8000-000000000003";
    expect(assinatura(autoria({ autor_id: desconhecido }), NOMES)).toBe("agente");
    expect(assinatura(autoria({ autor_tipo: "pessoa", autor_id: desconhecido }), NOMES)).toBe("pessoa");
    expect(assinatura(autoria({ sob_procuracao_de: desconhecido }), NOMES)).toBe("Vera · por pessoa");
    expect(assinatura(autoria({ autor_id: desconhecido }), NOMES)).not.toContain(desconhecido);
  });

  it("aceita função de resolução e trata nome vazio como desconhecido", () => {
    expect(assinatura(autoria({ sob_procuracao_de: CAROLINA }), (id) => (id === VERA ? "Vera" : undefined))).toBe("Vera · por pessoa");
    expect(assinatura(autoria({}), { [VERA]: "  " })).toBe("agente");
  });
});
