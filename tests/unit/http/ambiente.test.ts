import { describe, expect, it } from "vitest";
import { ambienteDoBanco } from "../../../src/adapters/http/rotas/ambiente.ts";

describe("ambiente do banco", () => {
  it("expõe o regime declarado e a porta da conexão", () => {
    expect(ambienteDoBanco({ NOD_BANCO_AMBIENTE: "efemero", DATABASE_URL: "postgres://nod_app:nod@127.0.0.1:5435/nod" })).toEqual({ regime: "efemero", porta: 5435 });
  });

  it("reconhece a instalação local persistente existente pela porta 5434", () => {
    expect(ambienteDoBanco({ DATABASE_URL: "postgres://nod_app:nod@127.0.0.1:5434/nod" })).toEqual({ regime: "persistente", porta: 5434 });
  });

  it("não chama banco remoto ou configuração desconhecida de efêmero", () => {
    expect(ambienteDoBanco({ DATABASE_URL: "postgres://nod_app:segredo@db.exemplo.test/nod" })).toEqual({ regime: "desconhecido", porta: 5432 });
    expect(ambienteDoBanco({ NOD_BANCO_AMBIENTE: "errado", DATABASE_URL: "invalida" })).toEqual({ regime: "desconhecido", porta: null });
  });
});
