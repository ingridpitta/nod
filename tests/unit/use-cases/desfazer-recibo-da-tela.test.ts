import { describe, expect, it } from "vitest";
import { ErroDeDominio } from "../../../src/domain/erro.ts";
import { desfazerRecibo, desfazerReciboDaTela } from "../../../src/use-cases/nao-lidos-no-chat.ts";
import type { Deps } from "../../../src/use-cases/tipos.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "../../helpers/ids.ts";

/**
 * NOD-449 (revisão do PR #616): ver o recibo (sala, bot de equipe) não basta para desfazer — a conversa tem de ser da
 * pessoa. O repo devolve a mensagem para a Ana (como faria a RLS numa conversa que ela lê) e nada além disso: se a
 * cerca sumisse, o Desfazer seguiria e quebraria em outro repo em vez de dizer nao_encontrado.
 */
describe("desfazerReciboDaTela", () => {
  it("o recibo de uma conversa que não é da pessoa dá nao_encontrado, sem desfazer nada", async () => {
    const recibo = { id: "r1", conversaId: "c1", kind: "sistema", payload: { kind: "recibo_leitura", leituras: [], nomes: ["Bia"], desfeito: false } };
    const mudou: string[] = [];
    const deps = {
      escopo: { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA },
      repos: {
        mensagens: { buscar: async () => recibo, atualizarSistema: async (id: string) => (mudou.push(id), true) },
        conversas: { buscar: async () => ({ id: "c1", ownerId: PESSOA_MARLON }) },
      },
    } as unknown as Deps;
    const erro = await desfazerReciboDaTela(deps, { mensagemId: "r1" }).then(() => null, (e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroDeDominio);
    expect((erro as ErroDeDominio).codigo).toBe("nao_encontrado");
    expect(mudou).toEqual([]);
  });

  it.each([
    ["uma fala comum com o mesmo payload", { kind: "texto", payload: { kind: "recibo_leitura", leituras: [], nomes: ["Bia"] } }],
    ["um sistema que não é recibo", { kind: "sistema", payload: { kind: "outro" } }],
    ["um recibo já desfeito", { kind: "sistema", payload: { kind: "recibo_leitura", leituras: [], nomes: ["Bia"], desfeito: true } }],
  ])("desfazerRecibo ignora %s (QA do PR #616, M33)", async (_n, extra) => {
    const mudou: string[] = [];
    const deps = { repos: { mensagens: { buscar: async () => ({ id: "r1", conversaId: "c1", ...extra }), atualizarSistema: async (id: string) => (mudou.push(id), true) } } } as unknown as Deps;
    expect(await desfazerRecibo(deps, "r1")).toBeNull();
    expect(mudou).toEqual([]);
  });
});
