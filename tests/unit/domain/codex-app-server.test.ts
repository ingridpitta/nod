import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CODIGO_RECUSA_NOD,
  idDaThread,
  idDoTurno,
  interpretarLinhaAppServer,
  modelosDaLista,
  notificacaoInitialized,
  pedidoAccountRateLimitsRead,
  pedidoInitialize,
  pedidoModelList,
  pedidoThreadStart,
  pedidoTurnInterrupt,
  pedidoTurnStart,
  pedidoTurnSteer,
  respostaNegando,
  usoDoPlanoDoRateLimits,
} from "../../../src/domain/codex-app-server.ts";

const ler = (linha: string): unknown => {
  expect(linha.endsWith("\n")).toBe(true);
  expect(linha.slice(0, -1)).not.toContain("\n");
  return JSON.parse(linha);
};

describe("mensagens do cliente", () => {
  it("initialize e initialized", () => {
    expect(ler(pedidoInitialize(1, { nome: "nod", versao: "1.2.3" }))).toEqual({ jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "nod", title: "nod", version: "1.2.3" } } });
    expect(ler(notificacaoInitialized())).toEqual({ jsonrpc: "2.0", method: "initialized" });
  });

  it("thread/start efêmera, sem aprovação, só leitura, com as instruções de voz", () => {
    expect(ler(pedidoThreadStart(2, { modelo: "gpt-6-luna", instrucoes: "Fale curto.\nSem markdown.", cwd: "/tmp/x" }))).toEqual({
      jsonrpc: "2.0",
      id: 2,
      method: "thread/start",
      params: { model: "gpt-6-luna", cwd: "/tmp/x", approvalPolicy: "never", sandbox: "read-only", developerInstructions: "Fale curto.\nSem markdown.", ephemeral: true },
    });
  });

  it("turn/start, turn/steer e turn/interrupt", () => {
    expect(ler(pedidoTurnStart(3, { threadId: "thr", texto: "oi", esforco: "low" }))).toEqual({ jsonrpc: "2.0", id: 3, method: "turn/start", params: { threadId: "thr", input: [{ type: "text", text: "oi" }], effort: "low" } });
    expect(ler(pedidoTurnSteer(4, { threadId: "thr", texto: "e mais", turnoEsperado: "t1" }))).toEqual({ jsonrpc: "2.0", id: 4, method: "turn/steer", params: { threadId: "thr", input: [{ type: "text", text: "e mais" }], expectedTurnId: "t1" } });
    expect(ler(pedidoTurnInterrupt(5, { threadId: "thr", turnId: "t1" }))).toEqual({ jsonrpc: "2.0", id: 5, method: "turn/interrupt", params: { threadId: "thr", turnId: "t1" } });
  });

  it("nega todo pedido do servidor, no formato do método quando ele é conhecido", () => {
    expect(ler(respostaNegando("a", "item/commandExecution/requestApproval"))).toEqual({ jsonrpc: "2.0", id: "a", result: { decision: "decline" } });
    expect(ler(respostaNegando(7, "item/fileChange/requestApproval"))).toEqual({ jsonrpc: "2.0", id: 7, result: { decision: "decline" } });
    expect(ler(respostaNegando(8, "execCommandApproval"))).toEqual({ jsonrpc: "2.0", id: 8, result: { decision: "denied" } });
    expect(ler(respostaNegando(9, "mcpServer/elicitation/request"))).toEqual({ jsonrpc: "2.0", id: 9, result: { action: "decline" } });
    expect(ler(respostaNegando(10, "item/permissions/requestApproval"))).toEqual({ jsonrpc: "2.0", id: 10, error: { code: CODIGO_RECUSA_NOD, message: "negado pelo nod" } });
    expect(ler(respostaNegando(11, "metodo/novo"))).toMatchObject({ id: 11, error: { code: CODIGO_RECUSA_NOD } });
  });
});

describe("linhas do servidor", () => {
  const linha = (v: unknown) => JSON.stringify(v);

  it("resposta e resposta de erro a um pedido nosso", () => {
    expect(interpretarLinhaAppServer(linha({ id: 2, result: { thread: { id: "thr_1" } } }))).toEqual({ tipo: "resposta", id: 2, resultado: { thread: { id: "thr_1" } } });
    expect(interpretarLinhaAppServer(linha({ jsonrpc: "2.0", id: 3, error: { code: -32600, message: "sem turno" } }))).toEqual({ tipo: "resposta_erro", id: 3, codigo: -32600, mensagem: "sem turno" });
  });

  it("ids de thread e de turno nas respostas", () => {
    expect(idDaThread({ thread: { id: "thr_1" } })).toBe("thr_1");
    expect(idDaThread({ threadId: "thr_2" })).toBe("thr_2");
    expect(idDaThread({})).toBeNull();
    expect(idDoTurno({ turn: { id: "t1", status: "inProgress" } })).toBe("t1");
    expect(idDoTurno({ turnId: "t2" })).toBe("t2");
    expect(idDoTurno({ turn: {} })).toBeNull();
  });

  it("delta de texto do agente", () => {
    expect(interpretarLinhaAppServer(linha({ method: "item/agentMessage/delta", params: { threadId: "thr", turnId: "t1", itemId: "i1", delta: "Olá" } }))).toEqual({ tipo: "delta", threadId: "thr", turnId: "t1", itemId: "i1", texto: "Olá" });
    expect(interpretarLinhaAppServer(linha({ method: "item/agentMessage/delta", params: { turnId: "t1" } }))).toEqual({ tipo: "ignorado" });
  });

  it("ferramenta MCP começa e acaba com o nome no formato do Claude; mensagem completa traz o texto", () => {
    const inicio = { method: "item/started", params: { threadId: "thr", turnId: "t1", item: { type: "mcpToolCall", id: "m1", server: "nod", tool: "lembrar", status: "inProgress", arguments: { a: 1 } } } };
    expect(interpretarLinhaAppServer(linha(inicio))).toEqual({ tipo: "item", fase: "inicio", turnId: "t1", itemId: "m1", tipoItem: "mcpToolCall", ferramenta: "mcp__nod__lembrar", falhou: false, texto: null, entrada: null });
    const falhou = { method: "item/completed", params: { turnId: "t1", item: { type: "mcpToolCall", id: "m1", server: "nod", tool: "lembrar", status: "failed", error: { message: "x" } } } };
    expect(interpretarLinhaAppServer(linha(falhou))).toMatchObject({ fase: "fim", ferramenta: "mcp__nod__lembrar", falhou: true });
    const msg = { method: "item/completed", params: { turnId: "t1", item: { type: "agentMessage", id: "a1", text: "Pronto." } } };
    expect(interpretarLinhaAppServer(linha(msg))).toMatchObject({ tipo: "item", fase: "fim", tipoItem: "agentMessage", ferramenta: null, falhou: false, texto: "Pronto." });
  });

  // ADR-103: as nativas do Codex viram ferramenta com o nome que o hook do nod conhece, e o passo leva o que o identifica.
  it.each([
    [{ type: "commandExecution", id: "c1", command: "git status" }, "Bash", { command: "git status" }],
    [{ type: "fileChange", id: "c2", changes: [{ path: "/u/nod/x/a.ts", kind: "add" }], status: "inProgress" }, "apply_patch", { arquivos: ["/u/nod/x/a.ts"] }],
    [{ type: "webSearch", id: "c3", query: "preço do plano" }, "web_search", { query: "preço do plano" }],
    [{ type: "imageView", id: "c4", path: "/tmp/print.png" }, "view_image", { path: "/tmp/print.png" }],
    [{ type: "collabAgentToolCall", id: "c5", tool: "spawn_agent" }, "spawn_agent", null],
    [{ type: "reasoning", id: "c6" }, null, null],
  ])("item %j → ferramenta %j", (item, ferramenta, entrada) => {
    const ev = interpretarLinhaAppServer(linha({ method: "item/started", params: { turnId: "t1", item } }));
    expect(ev).toMatchObject({ tipo: "item", ferramenta, entrada });
  });

  it("turno iniciado e concluído (completo, interrompido, falhou)", () => {
    expect(interpretarLinhaAppServer(linha({ method: "turn/started", params: { threadId: "thr", turn: { id: "t1" } } }))).toEqual({ tipo: "turno_iniciado", turnId: "t1" });
    expect(interpretarLinhaAppServer(linha({ method: "turn/completed", params: { threadId: "thr", turn: { id: "t1", status: "completed" } } }))).toEqual({ tipo: "turno_concluido", turnId: "t1", status: "completed", erro: null });
    expect(interpretarLinhaAppServer(linha({ method: "turn/completed", params: { turn: { id: "t2", status: "interrupted" } } }))).toMatchObject({ status: "interrupted" });
    expect(interpretarLinhaAppServer(linha({ method: "turn/completed", params: { turn: { id: "t3", status: "failed", error: { message: "cota" } } } }))).toEqual({ tipo: "turno_concluido", turnId: "t3", status: "failed", erro: "cota" });
  });

  it("NOD-174: o erro chega redigido e cortado; sem mensagem fica null, e interrompido não é erro do fornecedor", () => {
    const falhou = (error: unknown, status = "failed") => interpretarLinhaAppServer(linha({ method: "turn/completed", params: { turn: { id: "t", status, error } } }));
    expect(falhou({})).toMatchObject({ status: "failed", erro: null });
    expect(falhou({ message: "cancelado" }, "interrupted")).toMatchObject({ status: "interrupted", erro: null });
    const comChave = falhou({ message: `401 Unauthorized OPENAI_API_KEY=sk-proj-${"a".repeat(40)} ${"x".repeat(900)}` });
    expect(comChave).toMatchObject({ erro: expect.stringContaining("OPENAI_API_KEY=«redigido: 48 caracteres»") });
    expect(comChave.tipo === "turno_concluido" && comChave.erro!.length).toBeLessThanOrEqual(500);
    expect(interpretarLinhaAppServer(linha({ method: "error", params: { error: {} } }))).toEqual({ tipo: "erro", mensagem: null, vaiRepetir: false });
  });

  it("pedido do servidor (método E id) precisa de resposta", () => {
    expect(interpretarLinhaAppServer(linha({ id: "srv1", method: "item/commandExecution/requestApproval", params: { command: "rm" } }))).toEqual({ tipo: "pedido_servidor", id: "srv1", metodo: "item/commandExecution/requestApproval" });
    expect(interpretarLinhaAppServer(linha({ id: 0, method: "mcpServer/elicitation/request", params: {} }))).toEqual({ tipo: "pedido_servidor", id: 0, metodo: "mcpServer/elicitation/request" });
  });

  it("uso de tokens e erro do servidor", () => {
    expect(interpretarLinhaAppServer(linha({ method: "thread/tokenUsage/updated", params: { tokenUsage: { total: { inputTokens: 10, cachedInputTokens: 4, outputTokens: 2 } } } }))).toEqual({ tipo: "uso", tokens: { entrada: 10, saida: 2, cacheLeitura: 4 } });
    expect(interpretarLinhaAppServer(linha({ method: "error", params: { error: { message: "caiu" }, willRetry: true } }))).toEqual({ tipo: "erro", mensagem: "caiu", vaiRepetir: true });
  });

  it("linha que não é JSON, não é objeto ou é notificação desconhecida é ignorada sem lançar", () => {
    for (const l of ["", "texto solto", "[1,2]", "null", linha({ result: {} })]) {
      expect(interpretarLinhaAppServer(l)).toEqual({ tipo: "ignorado" });
    }
    // NOD-167: a notificação desconhecida leva só o nome (cortado), nunca os parâmetros.
    expect(interpretarLinhaAppServer(linha({ method: "account/rateLimits/updated", params: { segredo: "x" } }))).toEqual({ tipo: "ignorado", metodo: "account/rateLimits/updated" });
    expect(interpretarLinhaAppServer(linha({ method: "x".repeat(200), params: {} }))).toEqual({ tipo: "ignorado", metodo: "x".repeat(80) });
  });
});

describe("model/list (NOD-167)", () => {
  it("o pedido não leva parâmetros", () => {
    expect(ler(pedidoModelList(7))).toEqual({ jsonrpc: "2.0", id: 7, method: "model/list", params: {} });
  });

  it("lê id, padrão e esforços no formato do protocolo v2", () => {
    expect(modelosDaLista({ data: [
      { id: "gpt-5.6-sol", model: "gpt-5.6-sol", isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "high" }], defaultReasoningEffort: "high" },
      { id: "gpt-5.6-luna", isDefault: false, supportedReasoningEfforts: [{ reasoningEffort: "minimal" }, { reasoningEffort: "low" }], defaultReasoningEffort: "low" },
    ], nextCursor: null })).toEqual([
      { id: "gpt-5.6-sol", padrao: true, esforcos: ["low", "high"], esforcoPadrao: "high" },
      { id: "gpt-5.6-luna", padrao: false, esforcos: ["minimal", "low"], esforcoPadrao: "low" },
    ]);
  });

  it("tolera variações (models, model no lugar de id, esforço como texto ou {effort}) e descarta item sem id", () => {
    expect(modelosDaLista({ models: [{ model: "m1", supportedReasoningEfforts: ["low", { effort: "medium" }, 3] }, { displayName: "sem id" }, "lixo"] })).toEqual([
      { id: "m1", padrao: false, esforcos: ["low", "medium"], esforcoPadrao: null },
    ]);
    expect(modelosDaLista({})).toEqual([]);
  });
});

describe("uso do plano pelo app-server (NOD-12)", () => {
  const MEDIDO = 1_792_671_687_000;
  // A resposta real do Codex 0.162.0 (capturada em 2026-10-22 pelo app-server, numa conta ChatGPT Plus logada; o id da
  // conta e os dos créditos redigidos). Só a linha `id` do RPC: o app-server não manda `jsonrpc`.
  const MEDIDA = (JSON.parse(readFileSync(new URL("../../fixtures/codex-rate-limits-0.162.json", import.meta.url), "utf8")) as { result: Record<string, unknown> }).result;

  it("account/rateLimits/read sem parâmetros", () => {
    expect(ler(pedidoAccountRateLimitsRead(7))).toEqual({ jsonrpc: "2.0", id: 7, method: "account/rateLimits/read", params: {} });
  });

  it("a medida real: percentual vira fração, segundos viram ms, 300 min é a janela de 5 h e 10080 a semana", () => {
    expect(usoDoPlanoDoRateLimits(MEDIDA, MEDIDO)).toEqual({
      harness: "codex-cli", situacao: "normal", medidoEm: MEDIDO,
      cincoHoras: { utilizacao: 0.02, renovaEm: 1792689422000 }, semana: { utilizacao: 0.02, renovaEm: 1793164566000 },
    });
  });

  it("a duração manda (primary e secondary trocados), e sem duração primary é 5 h e secondary a semana", () => {
    const trocado = { rateLimits: { primary: { usedPercent: 50, windowDurationMins: 10080, resetsAt: 2 }, secondary: { usedPercent: 10, windowDurationMins: 300, resetsAt: 1 } } };
    expect(usoDoPlanoDoRateLimits(trocado, MEDIDO)).toMatchObject({ cincoHoras: { utilizacao: 0.1, renovaEm: 1000 }, semana: { utilizacao: 0.5, renovaEm: 2000 } });
    const semDuracao = { rateLimits: { primary: { usedPercent: 30 }, secondary: null } };
    expect(usoDoPlanoDoRateLimits(semDuracao, MEDIDO)).toMatchObject({ cincoHoras: { utilizacao: 0.3, renovaEm: null }, semana: null });
  });

  it("situação: perto a partir de 80%, esgotado em 100% ou quando o Codex diz que atingiu", () => {
    const com = (p: number, s: number, atingido: string | null = null) => usoDoPlanoDoRateLimits({ rateLimits: { primary: { usedPercent: p, windowDurationMins: 300 }, secondary: { usedPercent: s, windowDurationMins: 10080 }, rateLimitReachedType: atingido } }, MEDIDO)?.situacao;
    expect(com(79, 10)).toBe("normal");
    expect(com(10, 85)).toBe("perto");
    expect(com(100, 10)).toBe("esgotado");
    expect(com(40, 40, "rate_limit_reached")).toBe("esgotado");
  });

  it("resposta sem janela legível vira null, nunca lança", () => {
    for (const r of [{}, { rateLimits: null }, { rateLimits: { primary: null, secondary: null } }, { rateLimits: { primary: { usedPercent: "x" } } }, { rateLimits: { primary: { usedPercent: -1 } } }, { rateLimits: { primary: { usedPercent: 10, windowDurationMins: 1440 } } }]) {
      expect(usoDoPlanoDoRateLimits(r, MEDIDO)).toBeNull();
    }
  });
});
