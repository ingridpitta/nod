import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * NOD-455 (revisão 3, "nada privado"): a tela da participante só fala com a porta da dona, `/api/t/:t/quadros/…`;
 * nunca `/agentes/:id/…` com o bot da dona. O teste chama cada método de verdade e lê a URL que saiu no fetch.
 * api.ts usa DOM: o módulo entra por `vi.importActual`, como em api-erros.test.ts.
 */
type Metodos = {
  compartilhados(): Promise<unknown>;
  quadroPorId(qid: string): Promise<unknown>;
  atividadeDoQuadro(qid: string): Promise<unknown>;
  criarTarefaNoQuadro(qid: string, c: { titulo: string }): Promise<unknown>;
  mudarTarefaNoQuadro(qid: string, tid: string, c: { status?: string; excluir?: true }): Promise<unknown>;
  responderNoQuadro(qid: string, tid: string, r: string): Promise<unknown>;
  desfazerNoQuadro(qid: string, lid: string): Promise<unknown>;
  comentarNoQuadro(qid: string, c: { texto: string }): Promise<unknown>;
};
const { criarApi } = await vi.importActual<{ criarApi: (e: { tenantId: string; pessoaId: string }) => Metodos }>("../../../web/lib/api.ts");

afterEach(() => vi.unstubAllGlobals());

describe("NOD-455: a api da participante só usa /quadros/…", () => {
  it("cada método vai para /api/t/t1/quadros/… com o método certo, e nenhum para /agentes/", async () => {
    const saidas: { metodo: string; url: string }[] = [];
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      saidas.push({ metodo: String(init?.method ?? "GET"), url: String(url) });
      return new Response(JSON.stringify({ ok: true, quadros: [], linhas: [] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const api = criarApi({ tenantId: "t1", pessoaId: "p1" });
    const Q = "q/1";
    await api.compartilhados();
    await api.quadroPorId(Q);
    await api.atividadeDoQuadro(Q);
    await api.criarTarefaNoQuadro(Q, { titulo: "x" });
    await api.mudarTarefaNoQuadro(Q, "t9", { status: "feito" });
    await api.mudarTarefaNoQuadro(Q, "t9", { excluir: true });
    await api.responderNoQuadro(Q, "t9", "sim");
    await api.desfazerNoQuadro(Q, "l1");
    await api.comentarNoQuadro(Q, { texto: "oi" });
    expect(saidas).toEqual([
      { metodo: "GET", url: "/api/t/t1/quadros/compartilhados" },
      { metodo: "GET", url: "/api/t/t1/quadros/q%2F1" },
      { metodo: "GET", url: "/api/t/t1/quadros/q%2F1/atividade" },
      { metodo: "POST", url: "/api/t/t1/quadros/q%2F1/tarefas" },
      { metodo: "PATCH", url: "/api/t/t1/quadros/q%2F1/tarefas/t9" },
      { metodo: "PATCH", url: "/api/t/t1/quadros/q%2F1/tarefas/t9" },
      { metodo: "POST", url: "/api/t/t1/quadros/q%2F1/tarefas/t9/resposta" },
      { metodo: "POST", url: "/api/t/t1/quadros/q%2F1/lotes/l1/desfazer" },
      { metodo: "POST", url: "/api/t/t1/quadros/q%2F1/comentarios" },
    ]);
    for (const s of saidas) expect(s.url).not.toMatch(/\/agentes\//);
  });
});
