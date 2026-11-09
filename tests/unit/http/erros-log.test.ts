import type { ServerResponse } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MENSAGEM_FALHA_INTERNA, responderErro } from "../../../src/adapters/http/erros.ts";
import { ErroBancoOcupado, ErroTxEncerrada } from "../../../src/db/tx.ts";
import { ErroDeDominio } from "../../../src/domain/erro.ts";

function resposta(): { res: ServerResponse; status: () => number; corpo: () => unknown } {
  let status = 0;
  let corpo = "";
  const res = {
    writeHead(s: number) { status = s; return res; },
    end(d: string) { corpo = d; return res; },
  };
  return { res: res as Pick<ServerResponse, "writeHead" | "end"> as ServerResponse, status: () => status, corpo: () => JSON.parse(corpo) };
}

describe("responderErro registra a recusa no log", () => {
  const saida = vi.spyOn(console, "log").mockImplementation(() => {});
  afterEach(() => saida.mockClear());
  const linhas = () => saida.mock.calls.map((c) => JSON.parse(String(c[0])));

  it("4xx de domínio vira linha com código, status, método, rota sem ids e cause; o cliente segue sem o cause", () => {
    const r = resposta();
    const id = "9ad2843f-f636-461d-9134-fabb31f6f14d";
    responderErro(r.res, new ErroDeDominio("entrada_invalida", { cause: "capacidade fora do catálogo do conector" }), {
      metodo: "POST",
      caminho: `/api/t/172e1fdf-428d-48cb-b052-3bd7d2573e18/decisoes/${id}/decidir?x=1`,
    });
    expect(r.status()).toBe(400);
    expect(r.corpo()).toEqual({ codigo: "entrada_invalida", mensagem: "Algum dado do pedido não está certo. Confira e tente de novo." });
    expect(linhas()).toEqual([expect.objectContaining({
      nivel: "aviso",
      evento: "requisicao_recusada",
      codigo: "entrada_invalida",
      status: 400,
      metodo: "POST",
      rota: "/api/t/:id/decisoes/:id/decidir",
      causa: "capacidade fora do catálogo do conector",
    })]);
  });

  it("cause que não é texto não vai para o log; JSON malformado vira 'json_malformado'", () => {
    responderErro(resposta().res, new ErroDeDominio("nao_permitido", { cause: { segredo: "x" } }));
    responderErro(resposta().res, new ErroDeDominio("entrada_invalida", { cause: new SyntaxError("Unexpected token") }));
    const [a, b] = linhas();
    expect(a).not.toHaveProperty("causa");
    expect(JSON.stringify(a)).not.toContain("segredo");
    expect(b?.causa).toBe("json_malformado");
  });

  it("o cause é redigido ANTES do corte de 200 (NOD-158): nenhum pedaço do segredo sobra", () => {
    const tok = "ghp_" + "a1B2".repeat(9);
    responderErro(resposta().res, new ErroDeDominio("entrada_invalida", { cause: `${"x".repeat(190)} ${tok}` }));
    const causa = String(linhas()[0]?.causa);
    expect(causa.length).toBeLessThanOrEqual(200);
    expect(causa).not.toContain("ghp_");
  });

  it("id malformado do Postgres (22P02) também deixa rastro", () => {
    const r = resposta();
    responderErro(r.res, Object.assign(new Error("invalid input syntax for type uuid: \"abc\""), { code: "22P02" }), { metodo: "GET", caminho: "/api/x" });
    expect(r.status()).toBe(400);
    expect(linhas()[0]).toMatchObject({ evento: "requisicao_recusada", causa: "id_malformado", rota: "/api/x" });
    expect(JSON.stringify(linhas()[0])).not.toContain("abc");
  });

  it("NOD-266: banco_ocupado vira 503 com a mensagem genérica e o correlation_id do log, sem nada do driver", () => {
    const r = resposta();
    const cid = "5b3f1c2e-7d4a-4e8b-9c1d-2a3b4c5d6e7f";
    responderErro(r.res, new ErroBancoOcupado(cid, 10_004), { metodo: "GET", caminho: "/api/t/172e1fdf-428d-48cb-b052-3bd7d2573e18/conversas" });
    expect(r.status()).toBe(503);
    expect(r.corpo()).toEqual({ codigo: "banco_ocupado", mensagem: MENSAGEM_FALHA_INTERNA, correlation_id: cid });
    expect(linhas()).toEqual([expect.objectContaining({ nivel: "aviso", evento: "requisicao_recusada", codigo: "banco_ocupado", status: 503, rota: "/api/t/:id/conversas", correlation_id: cid })]);
  });

  it.each(["57014", "55P03", "25P02"])("revisão do PR #321: timeout da tx (%s) vira 503 banco_ocupado, sem a mensagem do driver", (code) => {
    const r = resposta();
    responderErro(r.res, Object.assign(new Error("canceling statement due to lock timeout: segredo-da-linha"), { code }), { metodo: "POST", caminho: "/api/x" });
    expect(r.status()).toBe(503);
    expect(r.corpo()).toMatchObject({ codigo: "banco_ocupado", mensagem: MENSAGEM_FALHA_INTERNA });
    expect(linhas()).toEqual([expect.objectContaining({ nivel: "aviso", evento: "requisicao_recusada", codigo: "banco_ocupado", status: 503, causa: code })]);
    expect(JSON.stringify(linhas())).not.toContain("segredo-da-linha");
    expect(JSON.stringify(r.corpo())).not.toContain("segredo-da-linha");
  });

  it("NOD-266: tx_encerrada é falha interna (500), não banco ocupado", () => {
    const r = resposta();
    responderErro(r.res, new ErroTxEncerrada());
    expect(r.status()).toBe(500);
    expect(r.corpo()).toMatchObject({ codigo: "falha_interna" });
    expect(linhas()[0]).toMatchObject({ evento: "falha_interna", erro: "ErroTxEncerrada" });
  });
});
