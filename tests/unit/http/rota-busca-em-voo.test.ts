import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { criarRotasBusca, MAXIMO_BUSCAS_EM_VOO, MAXIMO_BUSCAS_NA_INSTANCIA, MAXIMO_BUSCAS_POR_TENANT, tetoNaInstancia } from "../../../src/adapters/http/rotas/busca.ts";
import type { DepsRotas } from "../../../src/adapters/http/rotas/executar-caso.ts";
import type { Escopo } from "../../../src/shared/types.ts";

/**
 * A transação de mentira não roda o caso de uso: segura cada busca em voo até o teste soltar (ou falhar). Devolve a rota,
 * um `pedir(escopo)` e a fila de quem está em voo.
 */
function montar(o: { poolMax?: number } = {}) {
  const emVoo: { ok: () => void; falha: () => void }[] = [];
  const abrirTx: DepsRotas["abrirTx"] = () => <T>() =>
    new Promise<T>((ok, falha) => emVoo.push({ ok: () => ok({ itens: [], proximo: null } as T), falha: () => falha(new Error("statement timeout")) }));
  const [rota] = criarRotasBusca({ abrirTx, services: {} as DepsRotas["services"], useCases: {} as DepsRotas["useCases"] }, o);
  if (!rota || rota.publica) throw new Error("rota da busca");
  const pedir = (escopo: Escopo) => {
    const req = new IncomingMessage(new Socket());
    req.url = "/busca/mensagens?q=girassol";
    return rota.handler({ req, res: new ServerResponse(req), escopo, params: {}, corpo: async () => ({}), json: vi.fn() });
  };
  return { pedir, emVoo };
}
const quem = (tenantId: string, pessoaId: string): Escopo => ({ tenantId, pessoaId });
/** O que a busca deu até o próximo tique: o código do erro, "ok" ou "em voo" (sem o teto, ela ficaria em voo; QA: sem timeout). */
const desfecho = (p: Promise<unknown>): Promise<string> =>
  Promise.race([p.then(() => "ok", (e: { codigo?: string }) => e.codigo ?? "erro"), new Promise<string>((r) => setTimeout(() => r("em voo"), 0))]);

/** NOD-380: sem índice, cada busca varre o tenant; tetos de buscas em voo por pessoa, por tenant e na instância. */
describe("GET /busca/mensagens: teto de buscas em voo", () => {
  it("a terceira simultânea da mesma pessoa é recusada; outra pessoa não é afetada; ao terminar, a vaga volta", async () => {
    const { pedir, emVoo } = montar();
    const ana = quem("t1", "ana");
    const a1 = pedir(ana);
    const a2 = pedir(ana);
    expect(await desfecho(pedir(ana))).toBe("limite_atingido");
    const b1 = pedir(quem("t2", "bia"));
    expect(emVoo).toHaveLength(3);
    emVoo.shift()!.ok();
    await a1;
    const a3 = pedir(ana);
    expect(emVoo).toHaveLength(3);
    for (const s of emVoo.splice(0)) s.ok();
    await Promise.all([a2, b1, a3]);
  });

  it("no máximo 3 em voo por tenant, acima das 2 de uma pessoa: o tenant grande não tira a vaga dos outros, e uma pessoa não tira a dos colegas", async () => {
    expect(MAXIMO_BUSCAS_POR_TENANT).toBeGreaterThan(MAXIMO_BUSCAS_EM_VOO);
    const { pedir, emVoo } = montar();
    const voando = [pedir(quem("t1", "ana")), pedir(quem("t1", "ana")), pedir(quem("t1", "bia"))];
    expect(await desfecho(pedir(quem("t1", "caio")))).toBe("limite_atingido");
    const deFora = pedir(quem("t2", "duda"));
    expect(emVoo).toHaveLength(4);
    for (const s of emVoo.splice(0)) s.ok();
    await Promise.all([...voando, deFora]);
  });

  it("acima de 4 em voo na instância, somando tenants, a próxima leva 429 até uma terminar", async () => {
    const { pedir, emVoo } = montar();
    expect(MAXIMO_BUSCAS_NA_INSTANCIA).toBe(4);
    const voando = ["t1", "t2", "t3", "t4"].map((t) => pedir(quem(t, "p")));
    expect(await desfecho(pedir(quem("t5", "p")))).toBe("limite_atingido");
    expect(emVoo).toHaveLength(4);
    emVoo.shift()!.ok();
    await voando[0];
    const quinta = pedir(quem("t5", "p"));
    expect(emVoo).toHaveLength(4);
    for (const s of emVoo.splice(0)) s.ok();
    await Promise.all([...voando, quinta]);
  });

  it("o teto da instância é um terço do pool, de 1 a 4 (pool pequeno não fica todo com a busca)", async () => {
    expect([1, 3, 5, 6, 9, 12, 15, 50].map(tetoNaInstancia)).toEqual([1, 1, 1, 2, 3, 4, 4, 4]);
    const { pedir, emVoo } = montar({ poolMax: 5 });
    const uma = pedir(quem("t1", "ana"));
    expect(await desfecho(pedir(quem("t2", "bia")))).toBe("limite_atingido");
    emVoo.splice(0)[0]!.ok();
    await uma;
  });

  it("a busca que falha (timeout) devolve as vagas de pessoa, tenant e instância", async () => {
    const { pedir, emVoo } = montar();
    const ana = quem("t1", "ana");
    const falhas = [pedir(ana), pedir(ana)];
    for (const s of emVoo.splice(0)) s.falha();
    for (const f of falhas) await expect(f).rejects.toThrow();
    const de = [pedir(ana), pedir(ana)];
    expect(emVoo).toHaveLength(2);
    for (const s of emVoo.splice(0)) s.ok();
    await Promise.all(de);
  });

  it("a resposta que fecha antes de sair (a web abortou) aborta a busca, que não vira erro e devolve as vagas; a que saiu, não (revisões 7 e 8)", async () => {
    const sinais: AbortSignal[] = [];
    const emVoo: { falha: () => void }[] = [];
    const abrirTx: DepsRotas["abrirTx"] = () => <T>() => new Promise<T>((_ok, falha) => emVoo.push({ falha: () => falha(Object.assign(new Error("cancelada"), { name: "AbortError" })) }));
    const [rota] = criarRotasBusca({ abrirTx, services: {} as DepsRotas["services"], useCases: {} as DepsRotas["useCases"] });
    if (!rota || rota.publica) throw new Error("rota da busca");
    const abortar = vi.spyOn(AbortController.prototype, "abort").mockImplementation(function (this: AbortController) {
      sinais.push(this.signal);
    });
    const pedido = (pessoa: string, saiu: boolean) => {
      const req = new IncomingMessage(new Socket());
      req.url = "/busca/mensagens?q=girassol";
      const res = new ServerResponse(req);
      const p = rota.handler({ req, res, escopo: quem("t1", pessoa), params: {}, corpo: async () => ({}), json: vi.fn() });
      if (saiu) Object.defineProperty(res, "writableFinished", { value: true });
      res.emit("close");
      return { p, res };
    };
    pedido("ana", true);
    expect(abortar).not.toHaveBeenCalled();
    abortar.mockRestore();
    // Sem o mock: a que fechou sem sair aborta de verdade; a falha que vem do cancelamento não vira 500.
    const { p, res } = pedido("bia", false);
    emVoo.at(-1)!.falha();
    await expect(p).resolves.toBeUndefined();
    expect(res.writableEnded).toBe(true);
    // A vaga de Bia voltou: duas buscas dela de novo cabem.
    const de = [pedido("bia", true).p, pedido("bia", true).p];
    expect(emVoo).toHaveLength(4);
    void de;
  });
});
