import { describe, expect, it } from "vitest";
import { criarPonteHttp } from "../../../src/adapters/executor/ponte-http.ts";
import { lerOpcoesRemover } from "../../../src/shared/opcoes-remover.ts";

/** ADA-245 (jornada D): o pedido de limpeza local viaja na puxada das contas (com "Continuar ligado", sem `desconectar`). */
describe("ponte: contas/puxar com remover", () => {
  const ponteQueResponde = (corpo: unknown) =>
    criarPonteHttp({ url: "http://servidor", chave: "k", versao: "1.0.0", fetchImpl: (async () => new Response(JSON.stringify(corpo), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch });

  it("passa as opções só na forma certa; com 'Continuar ligado' elas vêm sem desconectar (revisão do PR #694)", async () => {
    const remover = { manterIas: false, manterConexao: false };
    expect(await ponteQueResponde({ logins: [], sair: [], desconectar: true, remover }).contas.puxar()).toEqual({ logins: [], sair: [], desconectar: true, remover });
    const mantendo = { manterIas: false, manterConexao: true };
    expect(await ponteQueResponde({ logins: [], sair: [], desconectar: false, remover: mantendo }).contas.puxar()).toEqual({ logins: [], sair: [], desconectar: false, remover: mantendo });
    expect(await ponteQueResponde({ desconectar: true, remover: { manterIas: "nao", manterConexao: true } }).contas.puxar()).toEqual({ logins: [], sair: [], desconectar: true });
  });

  it("lerOpcoesRemover aceita só os dois booleanos", () => {
    expect(lerOpcoesRemover({ manterIas: true, manterConexao: false })).toEqual({ manterIas: true, manterConexao: false });
    for (const v of [null, undefined, "x", [], {}, { manterIas: true }, { manterIas: 1, manterConexao: false }, { manterIas: true, manterConexao: false, pasta: "C:\\" }]) {
      expect(lerOpcoesRemover(v)).toBeNull();
    }
  });
});
