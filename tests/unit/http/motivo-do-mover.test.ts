import { describe, expect, it } from "vitest";
import { motivoDoMover } from "../../../src/adapters/http/rotas/quadro.ts";
import { ErroDeDominio } from "../../../src/domain/erro.ts";
import { ErroDoMover } from "../../../src/use-cases/acoes/quadro.ts";
import { RECUSAS_DO_MOVER } from "../../../src/use-cases/quadro.ts";

/** Revisão 7 do PR #623: o `motivo` do mover vem da chave tipada no erro, não do texto da causa. */
describe("motivoDoMover", () => {
  it("a recusa do mover sai com a chave que o caso de uso pôs no erro", () => {
    const r = motivoDoMover(new ErroDoMover("estado_invalido", "mudou_de_quadro", RECUSAS_DO_MOVER.mudou_de_quadro));
    expect(r).toMatchObject({ status: 409, corpo: { codigo: "estado_invalido", motivo: "mudou_de_quadro" } });
    expect(JSON.stringify(r)).not.toContain(RECUSAS_DO_MOVER.mudou_de_quadro);
  });

  it("um erro qualquer cuja causa é igual ao texto de uma recusa não ganha motivo", () => {
    for (const texto of Object.values(RECUSAS_DO_MOVER)) {
      expect(motivoDoMover(new ErroDeDominio("nao_encontrado", { cause: texto }))).toBeNull();
    }
    expect(motivoDoMover(new Error("a tarefa sumiu"))).toBeNull();
  });
});
