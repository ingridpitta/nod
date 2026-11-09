import { describe, expect, it, vi } from "vitest";
import { criarFonteLinearComposio, FERRAMENTA_LINEAR, lerIssue, PAGINAS_COMPLETA, PAGINAS_LEVE, PRAZO_PAGINA_LINEAR_MS, type ExecutarComposio } from "../../../src/adapters/integracoes/linear-composio.ts";
import { criarClienteComposio } from "../../../src/adapters/integracoes/composio.ts";
import { LIMITE_IMPORTACAO } from "../../../src/domain/importar-linear.ts";
import { LIMITES_QUADRO } from "../../../src/contracts/quadro.ts";

const no = (k: number, o: Record<string, unknown> = {}) => ({
  identifier: `NOD-${k}`, number: k, title: `T${k}`, url: `https://linear.app/nod/issue/NOD-${k}`, createdAt: "2026-10-01T00:00:00Z",
  state: { name: "Implementando" }, labels: { nodes: [{ name: "ux" }] }, ...o,
});
const cred = { chaveCifrada: "cifrada", contaId: "ca_1", userId: "nod:t:p" };

describe("a fonte do Linear pelo Composio (NOD-422)", () => {
  it("revisão 5 do PR #630: uma página que não responde estoura o prazo por chamada (35 s) e vira conector_indisponivel", async () => {
    vi.useFakeTimers();
    try {
      expect(PRAZO_PAGINA_LINEAR_MS).toBe(35_000);
      let chamadas = 0;
      const presa: ExecutarComposio = () => { chamadas++; return new Promise(() => undefined); };
      const r = criarFonteLinearComposio(() => presa).listar(cred, { time: "nod", completo: false });
      const pego = r.catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(PRAZO_PAGINA_LINEAR_MS - 1);
      let resolvido = false;
      void pego.then(() => { resolvido = true; });
      await Promise.resolve();
      expect(resolvido).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await pego).toMatchObject({ codigo: "conector_indisponivel" });
      expect(chamadas).toBe(1);
      // O prazo é injetável e a página que responde a tempo passa (o timer é limpo).
      const rapida: ExecutarComposio = async () => ({ issues: { nodes: [no(1)], pageInfo: { hasNextPage: false } } });
      expect((await criarFonteLinearComposio(() => rapida, { prazoMs: 10 }).listar(cred, { time: "nod", completo: false })).length).toBe(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("pagina, só consulta (nunca mutation) e avisa o progresso a cada página", async () => {
    const chamadas: { ferramenta: string; argumentos: Record<string, unknown> }[] = [];
    const paginas = [
      { data: { issues: { nodes: [no(1), no(2)], pageInfo: { hasNextPage: true, endCursor: "c1" } } } },
      { issues: { nodes: [no(3)], pageInfo: { hasNextPage: false, endCursor: null } } },
    ];
    const executar: ExecutarComposio = async (ferramenta, p) => {
      chamadas.push({ ferramenta, argumentos: p.argumentos });
      return paginas[chamadas.length - 1]!;
    };
    const chaves: string[] = [];
    const fonte = criarFonteLinearComposio((c) => { chaves.push(c); return executar; });
    const avancos: number[] = [];
    const r = await fonte.listar(cred, { time: "nod", completo: true, aoAvancar: async (n) => { avancos.push(n); } });
    expect(r.map((i) => i.identificador)).toEqual(["NOD-1", "NOD-2", "NOD-3"]);
    expect(avancos).toEqual([2, 3]);
    expect(chaves).toEqual(["cifrada"]);
    expect(chamadas.every((c) => c.ferramenta === FERRAMENTA_LINEAR)).toBe(true);
    expect(chamadas.map((c) => (c.argumentos.variables as { depois: unknown }).depois)).toEqual([null, "c1"]);
    for (const c of chamadas) {
      const q = String(c.argumentos.query_or_mutation);
      expect(q.trimStart().startsWith("query")).toBe(true);
      expect(q).not.toMatch(/mutation/i);
      expect(q).toContain(`nin: ["completed", "canceled"]`);
    }
  });

  it("revisão 3 do PR #630: a issue que não se lê é descartada e avisada (com o identificador, se legível)", async () => {
    const pagina = { issues: { nodes: [no(1), no(2, { state: null }), no(3, { identifier: "???", number: null })], pageInfo: { hasNextPage: false, endCursor: null } } };
    const descartadas: (string | null)[] = [];
    const r = await criarFonteLinearComposio(() => async () => pagina).listar(cred, { time: "NOD", completo: true, aoDescartar: (x) => { descartadas.push(x); } });
    expect(r.map((i) => i.identificador)).toEqual(["NOD-1"]);
    expect(descartadas).toEqual(["NOD-2", null]);
  });

  it("revisão 4 do PR #630: comentário com id acima de 100 caracteres descarta a issue pelo aoDescartar (não aborta a aplicação)", async () => {
    const comentario = (id: string) => ({ comments: { nodes: [{ id, body: "oi", user: { name: "Ana" }, createdAt: "2026-10-02T00:00:00Z" }] } });
    expect(lerIssue(no(1, comentario("c".repeat(100))))?.comentarios).toHaveLength(1);
    expect(lerIssue(no(1, comentario("c".repeat(101))))).toBeNull();
    const pagina = { issues: { nodes: [no(1), no(2, comentario("c".repeat(101)))], pageInfo: { hasNextPage: false, endCursor: null } } };
    const descartadas: (string | null)[] = [];
    const r = await criarFonteLinearComposio(() => async () => pagina).listar(cred, { time: "NOD", completo: true, aoDescartar: (x) => { descartadas.push(x); } });
    expect(r.map((i) => i.identificador)).toEqual(["NOD-1"]);
    expect(descartadas).toEqual(["NOD-2"]);
  });

  /** Um Linear com `total` issues, 25 (completa) ou 100 (leve) por página, como o de verdade. */
  const linearCom = (total: number) => {
    const consultas: string[] = [];
    const executar: ExecutarComposio = async (_f, p) => {
      const q = String(p.argumentos.query_or_mutation);
      consultas.push(q);
      const por = Number(/issues\(first: (\d+)/.exec(q)![1]);
      const de = Number((p.argumentos.variables as { depois: string | null }).depois ?? 0);
      const ate = Math.min(total, de + por);
      return { issues: { nodes: Array.from({ length: ate - de }, (_, i) => no(de + i + 1)), pageInfo: { hasNextPage: ate < total, endCursor: ate < total ? String(ate) : null } } };
    };
    return { consultas, fonte: criarFonteLinearComposio(() => executar) };
  };

  it("revisão do PR #630: a busca completa passa de 12 páginas e traz o teto inteiro (500 = 20 páginas de 25)", async () => {
    const { consultas, fonte } = linearCom(LIMITE_IMPORTACAO);
    const r = await fonte.listar(cred, { time: "NOD", completo: true });
    expect(r).toHaveLength(LIMITE_IMPORTACAO);
    expect(consultas.length).toBeGreaterThan(12);
    // Uma a mais que o teto ainda cabe (o caso de uso recusa com a contagem certa, não com a lista cortada).
    expect(await linearCom(LIMITE_IMPORTACAO + 1).fonte.listar(cred, { time: "NOD", completo: true })).toHaveLength(LIMITE_IMPORTACAO + 1);
  });

  it("revisão do PR #630: acabar as páginas com hasNextPage verdadeiro lança limite_atingido, nunca devolve a lista cortada", async () => {
    const completa = linearCom(PAGINAS_COMPLETA * 25 + 1);
    await expect(completa.fonte.listar(cred, { time: "NOD", completo: true })).rejects.toMatchObject({ codigo: "limite_atingido" });
    expect(completa.consultas).toHaveLength(PAGINAS_COMPLETA);
    await expect(linearCom(PAGINAS_LEVE * 100 + 1).fonte.listar(cred, { time: "NOD", completo: false })).rejects.toMatchObject({ codigo: "limite_atingido" });
    // Um cursor que nunca acaba também para no teto (não vira laço).
    const sem: ExecutarComposio = async () => ({ issues: { nodes: [no(1)], pageInfo: { hasNextPage: true, endCursor: "sempre" } } });
    await expect(criarFonteLinearComposio(() => sem).listar(cred, { time: "NOD", completo: true })).rejects.toMatchObject({ codigo: "limite_atingido" });
  });

  it("revisão do PR #630: sem_backlog tira o Backlog na própria consulta; o histórico vem do fim (last: 30)", async () => {
    const a = linearCom(3);
    await a.fonte.listar(cred, { time: "NOD", completo: true, filtro: "sem_backlog" });
    expect(a.consultas[0]).toContain(`name: { nin: ["Backlog"] }`);
    expect(a.consultas[0]).toContain("history(last: 30)");
    expect(a.consultas[0]).not.toContain("history(first");
    const b = linearCom(3);
    await b.fonte.listar(cred, { time: "NOD", completo: false });
    expect(b.consultas[0]).not.toContain("Backlog");
  });

  it("revisão 7 do PR #630: a issue que volta em duas páginas (mudou durante a paginação) vem uma vez só, com a leitura mais nova", async () => {
    const paginas = [
      { issues: { nodes: [no(1), no(2)], pageInfo: { hasNextPage: true, endCursor: "c1" } } },
      { issues: { nodes: [no(2, { title: "T2 nova" }), no(3)], pageInfo: { hasNextPage: false } } },
    ];
    let k = 0;
    const progresso: number[] = [];
    const executar: ExecutarComposio = async () => paginas[k++]!;
    const r = await criarFonteLinearComposio(() => executar).listar(cred, { time: "NOD", completo: true, aoAvancar: async (n) => { progresso.push(n); } });
    expect(r.map((i) => [i.identificador, i.titulo])).toEqual([["NOD-1", "T1"], ["NOD-2", "T2 nova"], ["NOD-3", "T3"]]);
    expect(progresso).toEqual([2, 3]);
  });

  it("erro do GraphQL vira conector_indisponivel", async () => {
    const fonte = criarFonteLinearComposio(() => async () => ({ errors: [{ message: "x" }] }));
    await expect(fonte.listar(cred, { time: "NOD", completo: false })).rejects.toMatchObject({ codigo: "conector_indisponivel" });
  });

  it("lê a issue completa: bloqueios, mãe, comentários, anexos e quando entrou no estado", () => {
    const i = lerIssue(no(7, {
      description: "corpo", parent: { identifier: "NOD-1" },
      inverseRelations: { nodes: [{ type: "blocks", issue: { identifier: "NOD-2" } }, { type: "related", issue: { identifier: "NOD-3" } }] },
      comments: { nodes: [{ id: "c1", body: "oi", createdAt: "2026-10-02T00:00:00Z", user: { name: "Ada" } }, { id: "c2", body: "", createdAt: null }] },
      attachments: { nodes: [{ url: "https://github.com/gamefik/nod/pull/9", createdAt: "2026-10-03T00:00:00Z" }] },
      history: { nodes: [{ createdAt: "2026-10-05T00:00:00Z", toState: { name: "Implementando" } }, { createdAt: "2026-10-04T00:00:00Z", toState: { name: "QA" } }] },
    }));
    expect(i).toMatchObject({
      identificador: "NOD-7", numero: 7, estado: "Implementando", mae: "NOD-1", bloqueadaPor: ["NOD-2"], etiquetas: ["ux"],
      noEstadoDesde: Date.parse("2026-10-05T00:00:00Z"),
    });
    expect(i?.comentarios).toEqual([{ id: "c1", autor: "Ada", texto: "oi", criadoEm: Date.parse("2026-10-02T00:00:00Z") }]);
    expect(i?.anexos).toHaveLength(1);
    expect(lerIssue(no(8, { history: { nodes: [] } }))?.noEstadoDesde).toBe(Date.parse("2026-10-01T00:00:00Z"));
    expect(lerIssue({ identifier: "x", number: 1, state: { name: "QA" } })).toBeNull();
  });

  it("revisão do PR #630: a URL que não é do Linear ou passa do teto é descartada (só ela; a issue vem); o anexo só https", () => {
    const longa = `https://linear.app/nod/issue/NOD-9/${"x".repeat(LIMITES_QUADRO.url)}`;
    for (const url of ["javascript:alert(1)", "https://evil.example/NOD-9", "http://linear.app/nod/issue/NOD-9", longa, 7]) {
      const i = lerIssue(no(9, { url }));
      expect(i).toMatchObject({ identificador: "NOD-9", url: null });
    }
    expect(lerIssue(no(9))?.url).toBe("https://linear.app/nod/issue/NOD-9");
    const anexos = lerIssue(no(9, { attachments: { nodes: [{ url: "javascript:x", createdAt: null }, { url: `https://github.com/a/b/pull/${"1".repeat(LIMITES_QUADRO.url)}` }, { url: "https://github.com/a/b/pull/1" }] } }))?.anexos;
    expect(anexos?.map((a) => a.url)).toEqual(["https://github.com/a/b/pull/1"]);
  });

  it("o cliente executa a ferramenta com a conta da pessoa; successful false não vaza o texto do provedor", async () => {
    const pedidos: { url: string; corpo: unknown }[] = [];
    const respostas = [{ successful: true, data: { issues: {} } }, { successful: false, error: "segredo do provedor: connected account expired", data: null }];
    const f = (async (url: string, init: RequestInit) => {
      pedidos.push({ url, corpo: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify(respostas[pedidos.length - 1]), { status: 200 });
    }) as unknown as typeof fetch;
    const c = criarClienteComposio("k", f);
    expect(await c.executar(FERRAMENTA_LINEAR, { userId: "u", contaId: "ca", argumentos: { a: 1 } })).toEqual({ issues: {} });
    expect(pedidos[0]).toEqual({ url: `https://backend.composio.dev/api/v3.1/tools/execute/${FERRAMENTA_LINEAR}`, corpo: { user_id: "u", connected_account_id: "ca", arguments: { a: 1 } } });
    // Revisão 6 do PR #630: a ferramenta recusada com a conta da pessoa é recusa de acesso, não queda.
    await expect(c.executar(FERRAMENTA_LINEAR, { userId: "u", contaId: "ca", argumentos: {} })).rejects.toMatchObject({ codigo: "integracao_autenticacao" });
    await expect(c.executar("../x", { userId: "u", contaId: "ca", argumentos: {} })).rejects.toMatchObject({ codigo: "conector_indisponivel" });
  });

  it("revisão 6 do PR #630: só 401/403 do Composio são recusa da conta; os outros 4xx (400/404/410/408/429), 5xx e rede são indisponível (conector_indisponivel)", async () => {
    const executarCom = (status: number | "rede") => criarClienteComposio("k", (async () => {
      if (status === "rede") throw new TypeError("fetch failed");
      return new Response(JSON.stringify({ error: "x" }), { status });
    }) as unknown as typeof fetch, { dormir: async () => undefined }).executar(FERRAMENTA_LINEAR, { userId: "u", contaId: "ca", argumentos: {} });
    // Revisão 7: só 401 e 403 são recusa da conta; 400/404/410 (pedido ou ferramenta errada) são indisponível, não "reconecte".
    for (const s of [401, 403]) await expect(executarCom(s)).rejects.toMatchObject({ codigo: "integracao_autenticacao" });
    for (const s of [400, 404, 410, 408, 429, 500, 502, 503, "rede" as const]) await expect(executarCom(s)).rejects.toMatchObject({ codigo: "conector_indisponivel" });
  });

  it("revisão 7 do PR #630: successful false só pede reconexão quando o erro diz autenticação; erro do GraphQL e o resto são indisponível", async () => {
    const executarCom = (error: unknown) => criarClienteComposio("k", (async () =>
      new Response(JSON.stringify({ successful: false, error, data: null }), { status: 200 })) as unknown as typeof fetch).executar(FERRAMENTA_LINEAR, { userId: "u", contaId: "ca", argumentos: {} });
    for (const e of ["401 Unauthorized", "Connected account is not active", "The connected account has expired", "Authentication failed: invalid_grant", "403 Forbidden"]) {
      await expect(executarCom(e), e).rejects.toMatchObject({ codigo: "integracao_autenticacao" });
    }
    for (const e of ["GraphQL error: Entity not found: Team", "400 Bad Request: Argument Validation Error", "404 Not Found", "Internal error", null, undefined]) {
      await expect(executarCom(e), String(e)).rejects.toMatchObject({ codigo: "conector_indisponivel" });
    }
  });

  it("revisão 6 do PR #630: busca 20 comentários e traz os 10 mais recentes com texto (os vazios não tomam lugar)", () => {
    const nodes = Array.from({ length: 20 }, (_, k) => ({ id: `c${k}`, body: k % 2 ? "" : `t${k}`, user: { name: "Ada" }, createdAt: new Date(Date.UTC(2026, 9, 1, k)).toISOString() }));
    const i = lerIssue(no(1, { comments: { nodes } }));
    expect(i?.comentarios.map((c) => c.id)).toEqual(["c0", "c2", "c4", "c6", "c8", "c10", "c12", "c14", "c16", "c18"]);
    const muitos = Array.from({ length: 14 }, (_, k) => ({ id: `m${k}`, body: "oi", createdAt: new Date(Date.UTC(2026, 9, 1, k)).toISOString() }));
    expect(lerIssue(no(1, { comments: { nodes: muitos } }))?.comentarios.map((c) => c.id)).toEqual(muitos.slice(-10).map((c) => c.id));
  });

  it("revisão 6 do PR #630: a busca completa pede comments(last: 20)", async () => {
    const consultas: string[] = [];
    const executar: ExecutarComposio = async (_f, p) => { consultas.push(String(p.argumentos.query_or_mutation)); return { issues: { nodes: [], pageInfo: { hasNextPage: false } } }; };
    await criarFonteLinearComposio(() => executar).listar({ chaveCifrada: "k", contaId: "ca", userId: "u" }, { time: "NOD", completo: true });
    expect(consultas[0]).toContain("comments(last: 20)");
  });
});
