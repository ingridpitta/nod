// NOD-365: a rota POST /computador/lugar. A recusa da origem sem contato é 409 com a frase fixa (AGENTS.md: a mensagem
// de erro sai de uma tabela fixa) e o nome da máquina num campo à parte.
import { describe, expect, it } from "vitest";
import type { Computadores } from "../../../src/adapters/fundo/computadores.ts";
import type { Ctx } from "../../../src/adapters/http/roteador.ts";
import { MENSAGEM_ORIGEM_SEM_CONTATO, rotasComputadores } from "../../../src/adapters/http/rotas/computadores.ts";
import { FalhaComputador } from "../../../src/domain/computador.ts";

const MAQ = "11111111-2222-3333-4444-555555555555";

function chamar(trocar: Computadores["trocarLugarDaPessoa"], corpo: unknown) {
  const rota = rotasComputadores({ trocarLugarDaPessoa: trocar } as Computadores).find((r) => r.padrao.test("/computador/lugar") && r.metodo === "POST")!;
  const resposta: { status?: number; body?: unknown } = {};
  const ctx = { escopo: { tenantId: "t", pessoaId: "p" }, params: {}, corpo: async () => corpo, json: (status: number, body: unknown) => { resposta.status = status; resposta.body = body; } } as unknown as Ctx;
  return { feito: (rota.handler as (c: Ctx) => Promise<void>)(ctx), resposta };
}

describe("POST /computador/lugar (NOD-365)", () => {
  it("origem sem contato: 409 origem_sem_contato com a frase fixa e o nome à parte (o nome não entra na frase)", async () => {
    const { feito, resposta } = chamar(async () => { throw new FalhaComputador("maquina_sem_contato", { maquina: "<b>Servidor</b>" }); }, { maquinaId: MAQ });
    await feito;
    expect(resposta).toEqual({ status: 409, body: { codigo: "origem_sem_contato", mensagem: MENSAGEM_ORIGEM_SEM_CONTATO, maquina: "<b>Servidor</b>" } });
    expect(MENSAGEM_ORIGEM_SEM_CONTATO).not.toContain("Servidor");
  });

  it("ok: repassa a máquina e o semLogins; corpo inválido é entrada_invalida; outra falha sobe", async () => {
    const pedidos: unknown[] = [];
    const ok = chamar(async (_e, p) => { pedidos.push(p); return { concluida: Promise.resolve() }; }, { maquinaId: MAQ, semLogins: true });
    await ok.feito;
    expect(ok.resposta).toEqual({ status: 200, body: { ok: true } });
    expect(pedidos).toEqual([{ maquinaId: MAQ, semLogins: true }]);
    for (const corpo of [null, { maquinaId: "x" }, { maquinaId: MAQ, semLogins: "sim" }]) {
      await expect(chamar(async () => ({ concluida: Promise.resolve() }), corpo).feito).rejects.toMatchObject({ codigo: "entrada_invalida" });
    }
    await expect(chamar(async () => { throw new FalhaComputador("nao_iniciou"); }, { maquinaId: MAQ }).feito).rejects.toMatchObject({ motivo: "nao_iniciou" });
  });
});
