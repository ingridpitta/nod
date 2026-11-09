import { describe, expect, it } from "vitest";
import { resolverLocalidade } from "../../../src/domain/localidade-turno.ts";

const pronto = { estado: "pronto", versao: "2.1.272", em: 1 } as const;

describe("resolverLocalidade", () => {
  it("conversa, sala, rotina, retomada e peer rodam local com motivo honesto (um driver só nesta rodada)", () => {
    for (const origem of ["conversa", "sala", "rotina", "retomada", "peer"] as const) {
      const r = resolverLocalidade({ origem, tocaDadoPessoal: true, motorExigido: "claude-haiku-4-5-20251001", inventario: pronto });
      expect(r).toEqual({ localidade: "local", motivo: "tudo_local_nesta_rodada", decididoPor: "regra:localidade", regraVersao: 1 });
    }
  });

  it("motor ausente ou não autenticado RECUSA com motivo, nunca promove em silêncio", () => {
    const ausente = resolverLocalidade({ origem: "conversa", tocaDadoPessoal: false, motorExigido: "x", inventario: { estado: "ausente", motivo: "claude não encontrado", em: 1 } });
    expect(ausente).toMatchObject({ recusado: true, motivo: "motor_ausente" });
    const naoAut = resolverLocalidade({ origem: "rotina", tocaDadoPessoal: false, motorExigido: "x", inventario: { estado: "nao_autenticado", motivo: "sem login", em: 1 } });
    expect(naoAut).toMatchObject({ recusado: true, motivo: "motor_ausente" });
  });
});
