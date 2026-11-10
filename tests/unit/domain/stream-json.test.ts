import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { EventoStream } from "../../../src/contracts/turno.ts";
import { interpretarCodex } from "../../../src/domain/codex-stream.ts";
import { classificarErroFornecedor } from "../../../src/domain/erro-fornecedor.ts";
import { classificarResultado, classificarSessao, comporFala, interpretarLinhaStreamJson, NARRACAO_MAX_CHARS, reduzirSinais, SINAIS_ZERADOS, textoDaRodada } from "../../../src/domain/stream-json.ts";

const FIXTURES = new URL("../../fixtures/stream-json/", import.meta.url);
function eventosDe(nome: string): EventoStream[] {
  const texto = readFileSync(new URL(nome, FIXTURES), "utf8");
  return texto.split("\n").map(interpretarLinhaStreamJson);
}

/** stderr real de s2c (sonda 2026-09-16); stdout vazio, exit 1. */
const STDERR_S2C = "Error: Session ID b086c652-7e33-44f6-8d2e-b7643f69274c is already in use.\n";

describe("interpretarLinhaStreamJson", () => {
  it("ADR-124: Claude e Codex não expõem extras sensíveis de abrir_conta no EventoStream", () => {
    const input = { pedido: "entrar", senha: "segredo que não pode aparecer" };
    const claude = interpretarLinhaStreamJson(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "u1", name: "mcp__nod__abrir_conta", input }] } }));
    const codex = interpretarCodex(JSON.stringify({ type: "item.started", item: { type: "mcp_tool_call", id: "u2", server: "nod", tool: "abrir_conta", arguments: input } }));
    expect(claude).toMatchObject({ tipo: "tool_use", input: { pedido: "entrar" } });
    expect(codex[0]).toMatchObject({ tipo: "tool_use", input: { pedido: "entrar" } });
    expect(JSON.stringify([claude, codex])).not.toContain("segredo que não pode aparecer");
  });

  it("init, delta, tool_use, tool_result, result e rate_limit saem do s3 real; o resto é ignorado sem falhar", () => {
    const evs = eventosDe("s3-mcp-ok.jsonl");
    const init = evs.find((e) => e.tipo === "init");
    expect(init).toMatchObject({ tipo: "init", sessaoCli: "ff68ffc2-f8ba-44ed-9f8a-483e3c4b3684", ferramentas: ["mcp__nod__somar"], versaoCli: "2.1.272", apiKeySource: "none" });
    expect(evs.find((e) => e.tipo === "tool_use")).toMatchObject({ nome: "mcp__nod__somar", input: { a: 17, b: 25 } });
    expect(evs.find((e) => e.tipo === "tool_result")).toMatchObject({ isError: false, texto: "RESULTADO_SOMA=42" });
    expect(evs.find((e) => e.tipo === "rate_limit")).toMatchObject({ status: "allowed", utilizacaoCincoHoras: 0.1 });
    const deltas = evs.filter((e) => e.tipo === "delta").map((e) => (e.tipo === "delta" ? e.texto : "")).join("");
    expect(deltas.startsWith("SONDA_OK")).toBe(true);
    const ignorados = evs.filter((e) => e.tipo === "ignorado");
    expect(ignorados.length).toBeGreaterThan(0);
    expect(ignorados.every((e) => e.tipo === "ignorado" && (e.razao === "tipo_desconhecido" || e.razao === "linha_vazia"))).toBe(true);
  });

  it("NOD-179: o rate_limit traz as duas janelas com o resetsAt em epoch ms", () => {
    expect(eventosDe("s3-mcp-ok.jsonl").find((e) => e.tipo === "rate_limit")).toEqual({
      tipo: "rate_limit",
      status: "allowed",
      utilizacaoCincoHoras: 0.1,
      utilizacaoSeteDias: 0.03,
      renovaCincoHorasEm: 1789537800000,
      renovaSeteDiasEm: 1789747200000,
      voltaEm: 1789537800000,
    });
  });

  it("NOD-179: rate_limit sem unifiedWindows, ou com resetsAt inválido, vira janelas nulas sem lançar", () => {
    expect(interpretarLinhaStreamJson('{"type":"rate_limit_event","rate_limit_info":{"status":"allowed_warning"}}')).toEqual({
      tipo: "rate_limit", status: "allowed_warning", utilizacaoCincoHoras: null, utilizacaoSeteDias: null, renovaCincoHorasEm: null, renovaSeteDiasEm: null, voltaEm: null,
    });
    const ruim = '{"type":"rate_limit_event","rate_limit_info":{"unifiedWindows":{"five_hour":{"utilization":0.5,"resetsAt":0},"seven_day":{"utilization":0.2,"resetsAt":"amanhã"}}}}';
    expect(interpretarLinhaStreamJson(ruim)).toMatchObject({ status: "desconhecido", utilizacaoCincoHoras: 0.5, renovaCincoHorasEm: null, renovaSeteDiasEm: null });
  });

  it("linha vazia e JSON inválido viram ignorado, nunca exceção", () => {
    expect(interpretarLinhaStreamJson("")).toEqual({ tipo: "ignorado", razao: "linha_vazia", tipoBruto: null });
    expect(interpretarLinhaStreamJson("{nope")).toEqual({ tipo: "ignorado", razao: "json_invalido", tipoBruto: null });
    expect(interpretarLinhaStreamJson('{"type":"system","subtype":"status"}')).toMatchObject({ tipo: "ignorado", razao: "tipo_desconhecido", tipoBruto: "system/status" });
  });

  it("reduzirSinais: init → promptSubmitted; saída → producedOutput; ignorado não muda nada", () => {
    let s = SINAIS_ZERADOS;
    s = reduzirSinais(s, { tipo: "ignorado", razao: "linha_vazia", tipoBruto: null });
    expect(s).toEqual(SINAIS_ZERADOS);
    s = reduzirSinais(s, { tipo: "init", sessaoCli: "x", ferramentas: [], modelo: "m", versaoCli: "v", apiKeySource: "none" });
    expect(s).toMatchObject({ attempted: true, promptSubmitted: true, producedOutput: false });
    s = reduzirSinais(s, { tipo: "delta", texto: "a" });
    expect(s.producedOutput).toBe(true);
  });

  it("NOD-293 (N6): o result com is_error não é saída — o erro do CLI não liga producedOutput; o result de sucesso liga", () => {
    const init = interpretarLinhaStreamJson(JSON.stringify({ type: "system", subtype: "init", session_id: "s", tools: [], model: "m" }));
    const erro = interpretarLinhaStreamJson(JSON.stringify({ type: "result", subtype: "success", is_error: true, result: "Credit balance is too low", session_id: "s", num_turns: 1 }));
    const ok = interpretarLinhaStreamJson(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "Pronto.", session_id: "s", num_turns: 1 }));
    const comInit = reduzirSinais(SINAIS_ZERADOS, init);
    expect(reduzirSinais(comInit, erro)).toEqual({ attempted: true, rejected: false, promptSubmitted: true, producedOutput: false });
    expect(reduzirSinais(SINAIS_ZERADOS, erro)).toMatchObject({ attempted: true, producedOutput: false });
    expect(reduzirSinais(comInit, ok).producedOutput).toBe(true);
    // No classificar: init + result de erro, sem nada do modelo, não é trabalho feito (vira sem_progresso, não trabalho_incompleto).
    expect(classificarResultado({ eventos: [init, erro], exitCode: 1, signal: null, stderr: "" }).sinais.producedOutput).toBe(false);
  });
});

describe("classificarResultado (ADR-009: estado de protocolo, nunca string de erro)", () => {
  it("s3 → sucesso, sinais true, custo 0.0207631, sessão do init, ferramenta chamada, sem negação", () => {
    const r = classificarResultado({ eventos: eventosDe("s3-mcp-ok.jsonl"), exitCode: 0, signal: null, stderr: "" });
    expect(r.desfecho).toBe("sucesso");
    expect(r.sinais).toEqual({ attempted: true, rejected: false, promptSubmitted: true, producedOutput: true });
    expect(r.custoUsd).toBe(0.0207631);
    expect(r.sessaoCli).toBe("ff68ffc2-f8ba-44ed-9f8a-483e3c4b3684");
    expect(r.ferramentasChamadas).toEqual(["mcp__nod__somar"]);
    expect(r.negacoesPermissao).toEqual([]);
    expect(r.tokens).toEqual({ entrada: 18, saida: 712, cacheLeitura: 7341, cacheCriacao: 7716 });
    expect(r.texto.startsWith("SONDA_OK")).toBe(true);
  });

  it("s4b → negacoesPermissao=['mcp__nod__somar'] com desfecho sucesso (negação NÃO é erro no CLI)", () => {
    const r = classificarResultado({ eventos: eventosDe("s4b-negado.jsonl"), exitCode: 0, signal: null, stderr: "" });
    expect(r.desfecho).toBe("sucesso");
    expect(r.negacoesPermissao).toEqual(["mcp__nod__somar"]);
    expect(r.ferramentasChamadas).toEqual(["mcp__nod__somar"]);
  });

  it("s6 → interrompido sem result (SIGTERM, exit 143); motivo fica para o servidor decidir", () => {
    const evs = eventosDe("s6-sigterm.jsonl");
    expect(evs.some((e) => e.tipo === "result")).toBe(false);
    const r = classificarResultado({ eventos: evs, exitCode: 143, signal: null, stderr: "" });
    expect(r.desfecho).toBe("interrompido");
    expect(r.motivoInterrupcao).toBeUndefined();
    expect(r.sinais).toMatchObject({ attempted: true, promptSubmitted: true, producedOutput: true, rejected: false });
    expect(r.sessaoCli).toBe("ed815b86-9773-4d0a-8081-72f1aed09d19");
    expect(r.texto.length).toBeGreaterThan(0);
    expect(r.custoUsd).toBeNull();
  });

  it("s2c → sessao_rejeitada: stdout vazio, exit 1, sem init (rejected=true)", () => {
    const r = classificarResultado({ eventos: eventosDe("s2c-session-in-use.jsonl"), exitCode: 1, signal: null, stderr: STDERR_S2C });
    expect(r.desfecho).toBe("interrompido");
    expect(r.motivoInterrupcao).toBe("sessao_rejeitada");
    expect(r.sinais).toEqual({ attempted: true, rejected: true, promptSubmitted: false, producedOutput: false });
  });

  it("SIGTERM ANTES do init (driver chamou interromper(); exit 143, signal null) → interrompido com motivo indefinido, NÃO sessao_rejeitada", () => {
    const r = classificarResultado({ eventos: [], exitCode: 143, signal: null, stderr: "", interrompidoPeloDriver: true });
    expect(r.desfecho).toBe("interrompido");
    expect(r.motivoInterrupcao).toBeUndefined();
    expect(r.sinais).toEqual({ attempted: true, rejected: false, promptSubmitted: false, producedOutput: false });
    // signal presente (SIGKILL após os 5s) segue a mesma regra, com ou sem init
    expect(classificarResultado({ eventos: [], exitCode: null, signal: "SIGKILL", stderr: "" }).motivoInterrupcao).toBeUndefined();
    expect(classificarResultado({ eventos: eventosDe("s6-sigterm.jsonl"), exitCode: null, signal: "SIGKILL", stderr: "" }).motivoInterrupcao).toBeUndefined();
  });

  it("sem init, exit 0 e sem signal (CLI saiu limpo sem dizer nada) → sem_progresso", () => {
    expect(classificarResultado({ eventos: [], exitCode: 0, signal: null, stderr: "" })).toMatchObject({ desfecho: "interrompido", motivoInterrupcao: "sem_progresso" });
  });

  it("spawn que não aconteceu (exitCode null, sem signal, sem eventos) → lancamento_falhou", () => {
    const r = classificarResultado({ eventos: [], exitCode: null, signal: null, stderr: "spawn ENOENT" });
    expect(r.motivoInterrupcao).toBe("lancamento_falhou");
    expect(r.sinais.attempted).toBe(false);
  });

  it("adversarial (E9.1): variar stderr não muda o resultado em nenhum cenário", () => {
    const cenarios: { nome: string; exitCode: number | null }[] = [
      { nome: "s3-mcp-ok.jsonl", exitCode: 0 },
      { nome: "s4b-negado.jsonl", exitCode: 0 },
      { nome: "s6-sigterm.jsonl", exitCode: 143 },
      { nome: "s2c-session-in-use.jsonl", exitCode: 1 },
    ];
    for (const c of cenarios) {
      const evs = eventosDe(c.nome);
      const a = classificarResultado({ eventos: evs, exitCode: c.exitCode, signal: null, stderr: "" });
      const b = classificarResultado({ eventos: evs, exitCode: c.exitCode, signal: null, stderr: STDERR_S2C });
      const d = classificarResultado({ eventos: evs, exitCode: c.exitCode, signal: null, stderr: "Error: max turns\nis_error true success" });
      expect(b).toEqual(a);
      expect(d).toEqual(a);
    }
  });

  it("NOD-174: na falha, o result do CLI e o assistant sintético não entram no texto; os blocos do modelo ficam", () => {
    const erro = "Credit balance is too low";
    const linhas = [
      { type: "system", subtype: "init", session_id: "s", tools: [], model: "m" },
      { type: "assistant", message: { model: "claude-sonnet", content: [{ type: "text", text: "Vou conferir." }] } },
      { type: "assistant", message: { model: "<synthetic>", content: [{ type: "text", text: erro }] } },
      { type: "result", subtype: "success", is_error: true, result: erro, session_id: "s", num_turns: 1 },
    ].map((l) => interpretarLinhaStreamJson(JSON.stringify(l)));
    expect(linhas[2]).toEqual({ tipo: "ignorado", razao: "sintetico", tipoBruto: "assistant" });
    const r = classificarResultado({ eventos: linhas, exitCode: 1, signal: null, stderr: "" });
    expect(r).toMatchObject({ desfecho: "falha", motivoFalha: "erro_execucao", texto: "Vou conferir." });
    expect(r.erroCru).toBe(`success | ${erro}`);
    // Sem nada do modelo antes do erro, a fala fica vazia (o servidor escreve só o aviso).
    expect(classificarResultado({ eventos: [linhas[0]!, linhas[2]!, linhas[3]!], exitCode: 1, signal: null, stderr: "" }).texto).toBe("");
    // O sucesso continua usando o result como fala.
    const ok = interpretarLinhaStreamJson(JSON.stringify({ type: "result", subtype: "success", result: "Pronto.", session_id: "s", num_turns: 1 }));
    expect(classificarResultado({ eventos: [linhas[0]!, ok], exitCode: 0, signal: null, stderr: "" }).texto).toBe("Pronto.");
  });

  // Regression: o `api_error` do result (2.1.312) não chegava ao erroCru; o padrão /autocompact_thrashing/ da NOD-480 era
  // código morto e a classe dependia só do texto em inglês. Found by /qa on 2026-11-09 (repro real, haiku, PR #721).
  it("NOD-480: o api_error do result entra no erroCru (o código do disjuntor classifica mesmo com outro texto)", () => {
    const linha = (result: string) => interpretarLinhaStreamJson(JSON.stringify({ type: "result", subtype: "success", is_error: true, api_error_status: null, api_error: "autocompact_thrashing", terminal_reason: "rapid_refill_breaker", result, session_id: "s", num_turns: 11 }));
    const real = "Autocompact is thrashing: the context refilled to the limit within 3 turns of the previous compact, 3 times in a row.";
    const r = classificarResultado({ eventos: [linha(real)], exitCode: 0, signal: null, stderr: "" });
    expect(r).toMatchObject({ desfecho: "falha", motivoFalha: "erro_execucao" });
    expect(r.erroCru).toContain("autocompact_thrashing");
    expect(classificarErroFornecedor(r.erroCru)).toBe("autocompactacao");
    // Um CLI que mude a frase mantém o código.
    expect(classificarErroFornecedor(classificarResultado({ eventos: [linha("Context keeps refilling after compaction.")], exitCode: 0, signal: null, stderr: "" }).erroCru)).toBe("autocompactacao");
  });

  it("result com subtype error_max_turns → falha erro_max_turns; outro erro → erro_execucao", () => {
    const init: EventoStream = { tipo: "init", sessaoCli: "s", ferramentas: [], modelo: "m", versaoCli: "v", apiKeySource: "none" };
    const res = (subtype: string): EventoStream => ({ tipo: "result", sucesso: false, subtype, sessaoCli: "s", texto: "", custoUsd: 0.01, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, numTurnos: 1, negacoesPermissao: [], erroCru: null });
    expect(classificarResultado({ eventos: [init, res("error_max_turns")], exitCode: 0, signal: null, stderr: "" })).toMatchObject({ desfecho: "falha", motivoFalha: "erro_max_turns" });
    expect(classificarResultado({ eventos: [init, res("error_during_execution")], exitCode: 1, signal: null, stderr: "" })).toMatchObject({ desfecho: "falha", motivoFalha: "erro_execucao" });
  });
});

/**
 * definido em 2026-09-28: o `result` do CLI traz só a última mensagem. Relatório escrito antes de uma
 * ferramenta (lembrar → "Anotado.") sumia da fala da pessoa e da resposta ao colega.
 */
describe("NOD-171: limite do plano pelo protocolo (rate_limit rejected + result com erro)", () => {
  const init = '{"type":"system","subtype":"init","session_id":"ff68ffc2-f8ba-44ed-9f8a-483e3c4b3684","tools":[],"model":"sonnet","claude_code_version":"2.1.290"}';
  const limite = (status: string, extra = "") =>
    `{"type":"rate_limit_event","rate_limit_info":{"status":"${status}"${extra},"rateLimitType":"five_hour","unifiedWindows":{"five_hour":{"utilization":1,"resetsAt":1791306000}}}}`;
  const erro = '{"type":"result","subtype":"success","is_error":true,"result":"Claude AI usage limit reached","num_turns":1,"usage":{}}';
  const ok = '{"type":"result","subtype":"success","is_error":false,"result":"feito","num_turns":1,"usage":{}}';
  const classificar = (...linhas: string[]) => classificarSessao({ eventos: linhas.map(interpretarLinhaStreamJson), exitCode: 0, signal: null, stderr: "" });

  it("rejected e result com erro: limite_do_plano, com a hora em que volta (o resetsAt de cima vence o da janela)", () => {
    expect(classificar(init, limite("rejected", ',"resetsAt":1791309600'), erro)).toMatchObject({ desfecho: "falha", motivoFalha: "limite_do_plano", limiteVoltaEm: 1791309600000 });
    // Sem o resetsAt de cima, vale o da janela do rateLimitType.
    expect(classificar(init, limite("rejected"), erro)).toMatchObject({ motivoFalha: "limite_do_plano", limiteVoltaEm: 1791306000000 });
    // O formato do claude-falso: sem resetsAt nenhum, o limite continua, sem hora.
    const semHora = '{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","rateLimitType":"five_hour","unifiedWindows":{"five_hour":{"utilization":1}}}}';
    expect(classificar(init, semHora, erro)).toMatchObject({ motivoFalha: "limite_do_plano", limiteVoltaEm: null });
  });

  it("allowed e allowed_warning não mudam nada: o erro continua erro_execucao, e o sucesso continua sucesso", () => {
    for (const status of ["allowed", "allowed_warning"]) {
      const r = classificar(init, limite(status), erro);
      expect(r).toMatchObject({ desfecho: "falha", motivoFalha: "erro_execucao" });
      expect(r.limiteVoltaEm).toBeUndefined();
    }
    expect(classificar(init, limite("rejected"), ok).desfecho).toBe("sucesso");
  });

  it("rejected com o overage em uso, ou o max_turns, não é limite do plano: o erro é outro", () => {
    expect(classificar(init, limite("rejected", ',"isUsingOverage":true'), erro)).toMatchObject({ motivoFalha: "erro_execucao" });
    expect(classificar(init, limite("rejected", ',"isUsingOverage":false'), erro)).toMatchObject({ motivoFalha: "limite_do_plano" });
    const maxTurns = '{"type":"result","subtype":"error_max_turns","is_error":true,"num_turns":30,"usage":{}}';
    expect(classificar(init, limite("rejected"), maxTurns)).toMatchObject({ motivoFalha: "erro_max_turns" });
  });

  it("o texto do erro não decide: o mesmo result sem rate_limit é erro_execucao (ADR-009)", () => {
    expect(classificar(init, erro)).toMatchObject({ motivoFalha: "erro_execucao" });
  });

  it("sessão viva: o rejected de uma rodada anterior não marca a rodada seguinte", () => {
    const r = classificar(init, limite("rejected"), ok, '{"type":"assistant","message":{"content":[{"type":"text","text":"de novo"}]}}', erro);
    expect(r).toMatchObject({ desfecho: "falha", motivoFalha: "erro_execucao" });
  });
});

describe("fala inteira: relatório antes da última ferramenta + texto final", () => {
  const init: EventoStream = { tipo: "init", sessaoCli: "s", ferramentas: [], modelo: "m", versaoCli: "v", apiKeySource: "none" };
  const ok = (texto: string): EventoStream => ({ tipo: "result", sucesso: true, subtype: "success", sessaoCli: "s", texto, custoUsd: 0.01, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, numTurnos: 2, negacoesPermissao: [], erroCru: null });
  const ferramenta = (id: string): EventoStream[] => [
    { tipo: "tool_use", id, nome: "mcp__nod__lembrar", input: {} },
    { tipo: "tool_result", toolUseId: id, isError: false, texto: "ok" },
  ];
  /** Deltas e depois o bloco completo, como o CLI emite. */
  const bloco = (texto: string): EventoStream[] => [{ tipo: "delta", texto }, { tipo: "texto_bloco", texto }];
  const relatorio = `Relatório das tasks: ${"NOD-101 aberto há 3 dias, sem revisão; ".repeat(10)}fim.`;
  const texto = (eventos: EventoStream[]) => classificarResultado({ eventos, exitCode: 0, signal: null, stderr: "" }).texto;

  it("chat limpo (PR 1): o resultado diz quantos blocos colou acima da final (blocosColados, para o Raio-X)", () => {
    const colados = (eventos: EventoStream[]) => classificarResultado({ eventos, exitCode: 0, signal: null, stderr: "" }).blocosColados;
    expect(colados([init, ...bloco("Buscando…"), ...ferramenta("u1"), ok("Achei.")])).toBe(0);
    expect(colados([init, ...bloco(relatorio), ...ferramenta("u1"), ok("Anotado.")])).toBe(1);
    expect(colados([init, ...bloco(relatorio), ...ferramenta("u1"), ...bloco(`${relatorio} Mais.`), ...ferramenta("u2"), ok("Anotado.")])).toBe(2);
    // Sem `result` (interrompido) não há composição: o campo não vem.
    expect(classificarResultado({ eventos: [init, ...bloco(relatorio)], exitCode: null, signal: "SIGTERM", stderr: "" }).blocosColados).toBeUndefined();
  });

  it("o parser devolve texto_bloco para o bloco de texto completo e continua devolvendo tool_use", () => {
    const evs = eventosDe("relatorio-lembrar.jsonl");
    const blocos = evs.filter((e) => e.tipo === "texto_bloco");
    expect(blocos).toHaveLength(2);
    expect(blocos[0]).toMatchObject({ texto: expect.stringMatching(/^Relatório das tasks da semana:/) });
    expect(blocos[1]).toEqual({ tipo: "texto_bloco", texto: "Anotado." });
    expect(evs.find((e) => e.tipo === "tool_use")).toMatchObject({ nome: "mcp__nod__lembrar", input: { texto: "Marlon quer o relatório de tasks às segundas" } });
    // bloco só de thinking continua ignorado (s3)
    expect(eventosDe("s3-mcp-ok.jsonl").filter((e) => e.tipo === "texto_bloco")).toHaveLength(1);
  });

  it("fixture real de formato: relatório > 280 → lembrar → 'Anotado.' vira relatório + linha em branco + 'Anotado.'", () => {
    const r = classificarResultado({ eventos: eventosDe("relatorio-lembrar.jsonl"), exitCode: 0, signal: null, stderr: "" });
    expect(r.desfecho).toBe("sucesso");
    expect(r.ferramentasChamadas).toEqual(["mcp__nod__lembrar"]);
    expect(r.texto.startsWith("Relatório das tasks da semana:\n\n- NOD-101")).toBe(true);
    expect(r.texto.endsWith("destravar a revisão do NOD-101 hoje.\n\nAnotado.")).toBe(true);
  });

  it("narração curta (≤ 280) antes das ferramentas fica só no cartão de atividade", () => {
    const narracao = "Buscando tasks no Linear…";
    expect(texto([init, ...bloco(narracao), ...ferramenta("u1"), ...bloco("Achei 3 tasks."), ok("Achei 3 tasks.")])).toBe("Achei 3 tasks.");
    // o limite é estrito: exatamente NARRACAO_MAX_CHARS ainda é narração
    const noLimite = "a".repeat(NARRACAO_MAX_CHARS);
    expect(texto([init, ...bloco(noLimite), ...ferramenta("u1"), ok("Pronto.")])).toBe("Pronto.");
    expect(texto([init, ...bloco(`${noLimite}b`), ...ferramenta("u1"), ok("Pronto.")])).toBe(`${noLimite}b\n\nPronto.`);
  });

  it("vários passos: só o relatório entra, na ordem, e o texto final fecha a fala", () => {
    const evs = [init, ...bloco("Buscando tasks…"), ...ferramenta("u1"), ...bloco(relatorio), ...ferramenta("u2"), ...bloco("Salvando na memória."), ...ferramenta("u3"), ...bloco("Anotado."), ok("Anotado.")];
    expect(texto(evs)).toBe(`${relatorio}\n\nAnotado.`);
  });

  it("sem duplicar: o final que repete o relatório (mesmo com espaços diferentes) sai uma vez só", () => {
    const final = `Pronto, aqui vai de novo:\n\n${relatorio.replaceAll("; ", ";\n")}`;
    expect(texto([init, ...bloco(relatorio), ...ferramenta("u1"), ...bloco(final), ok(final)])).toBe(final);
    // o mesmo relatório escrito duas vezes antes das ferramentas também entra uma vez
    expect(texto([init, ...bloco(relatorio), ...ferramenta("u1"), ...bloco(relatorio), ...ferramenta("u2"), ok("Anotado.")])).toBe(`${relatorio}\n\nAnotado.`);
  });

  it("sem ferramenta, ou com o relatório depois da última ferramenta, a fala é o result intacto (s3)", () => {
    expect(texto([init, ...bloco(relatorio), ok(relatorio)])).toBe(relatorio);
    expect(texto([init, ...bloco("Buscando…"), ...ferramenta("u1"), ...bloco(relatorio), ok(relatorio)])).toBe(relatorio);
  });

  it("result sem texto: o final são os blocos depois da última ferramenta; sem eles, todos os blocos separados", () => {
    expect(texto([init, ...bloco(relatorio), ...ferramenta("u1"), ...bloco("Anotado."), ok("")])).toBe(`${relatorio}\n\nAnotado.`);
    expect(texto([init, ...bloco("Buscando…"), ...ferramenta("u1"), ...bloco("Achei."), ...ferramenta("u2"), ok("")])).toBe("Buscando…\n\nAchei.");
    // sem blocos (catcher), os deltas colados, como antes
    expect(texto([init, { tipo: "delta", texto: "oi " }, { tipo: "delta", texto: "tudo bem" }, ok("")])).toBe("oi tudo bem");
  });

  it("turno interrompido (sem result): todos os blocos separados + o trecho que não fechou bloco", () => {
    const evs: EventoStream[] = [init, ...bloco("Buscando tasks…"), ...ferramenta("u1"), ...bloco(relatorio), ...ferramenta("u2"), { tipo: "delta", texto: "Agora vou " }, { tipo: "delta", texto: "salvar" }];
    const r = classificarResultado({ eventos: evs, exitCode: 143, signal: null, stderr: "", interrompidoPeloDriver: true });
    expect(r.desfecho).toBe("interrompido");
    expect(r.texto).toBe(`Buscando tasks…\n\n${relatorio}\n\nAgora vou salvar`);
    // sem blocos, os deltas colados continuam sendo o texto (s6)
    const s6 = classificarResultado({ eventos: eventosDe("s6-sigterm.jsonl"), exitCode: 143, signal: null, stderr: "" });
    const deltas = eventosDe("s6-sigterm.jsonl").map((e) => (e.tipo === "delta" ? e.texto : "")).join("");
    expect(s6.texto).toBe(deltas);
  });

  it("Codex: cada agent_message vira delta (ao vivo) e texto_bloco; a última é o final e as anteriores só se forem relatório", () => {
    const linha = (v: unknown) => interpretarCodex(JSON.stringify(v));
    const msg = (text: string) => linha({ type: "item.completed", item: { type: "agent_message", text } });
    const tool = (id: string) => [...linha({ type: "item.started", item: { id, type: "mcp_tool_call", server: "nod", tool: "lembrar", arguments: {} } }), ...linha({ type: "item.completed", item: { id, type: "mcp_tool_call", status: "completed" } })];
    expect(msg("Olá.")).toEqual([{ tipo: "delta", texto: "Olá." }, { tipo: "texto_bloco", texto: "Olá." }]);
    const fim = linha({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } });
    const evs = [...linha({ type: "thread.started" }), ...msg("Vou consultar."), ...tool("t1"), ...msg(relatorio), ...tool("t2"), ...msg("Anotado."), ...fim];
    const r = classificarResultado({ eventos: evs, exitCode: 0, signal: null, stderr: "" });
    expect(r.desfecho).toBe("sucesso");
    expect(r.texto).toBe(`${relatorio}\n\nAnotado.`);
  });

  it("comporFala sem relatório devolve o final intacto, inclusive vazio", () => {
    expect(comporFala([], "  pronto  ")).toBe("  pronto  ");
    expect(comporFala(["curto"], "")).toBe("");
    expect(comporFala([relatorio], "")).toBe(relatorio);
  });
});

/**
 * Sessão viva (ADR-067). s7 é a medição M1 de 01/10/2026 no CLI 2.1.286, com a entrada stream-json aberta: o modelo
 * pôs um Bash de 40 s em segundo plano, a pessoa mandou "quanto é 2+2?" no meio, ele respondeu às duas juntas
 * ("Disparado\n\n4"); 40 s depois o comando terminou e o CLI chamou o modelo de novo sozinho ("bg-pronto"). Cada volta
 * abre com um `system/init` próprio e fecha com um `result`.
 */
describe("sessão viva (ADR-067)", () => {
  const s7 = () => eventosDe("s7-sessao-viva.jsonl").filter((e) => e.tipo !== "ignorado");

  it("comando em segundo plano: task_started (is_backgrounded) abre; task_updated e task_notification com status final fecham", () => {
    const tarefas = s7().filter((e) => e.tipo === "tarefa_fundo");
    expect(tarefas).toEqual([
      { tipo: "tarefa_fundo", id: "bcwaxdzy5", estado: "iniciada", natureza: "comando" },
      { tipo: "tarefa_fundo", id: "bcwaxdzy5", estado: "terminada", final: "concluido" },
      { tipo: "tarefa_fundo", id: "bcwaxdzy5", estado: "terminada", final: "concluido" },
    ]);
    // Comando em primeiro plano segue ignorado; subagente em primeiro plano entra na lista, mas não segura a sessão (NOD-350).
    expect(interpretarLinhaStreamJson(JSON.stringify({ type: "system", subtype: "task_started", task_id: "a1", is_backgrounded: false })).tipo).toBe("ignorado");
    expect(interpretarLinhaStreamJson(JSON.stringify({ type: "system", subtype: "task_started", task_id: "a2", is_backgrounded: false, task_type: "local_agent", description: "Ler" }))).toEqual({
      tipo: "tarefa_fundo",
      id: "a2",
      estado: "iniciada",
      natureza: "agente",
      descricao: "Ler",
      emFundo: false,
    });
    expect(interpretarLinhaStreamJson(JSON.stringify({ type: "system", subtype: "task_updated", task_id: "a1", patch: { status: "running" } })).tipo).toBe("ignorado");
    expect(interpretarLinhaStreamJson(JSON.stringify({ type: "system", subtype: "task_updated", task_id: "a1", patch: { status: "killed" } }))).toMatchObject({ estado: "terminada" });
  });

  it("duas voltas: o texto junta as duas; custo é o do último result (acumulado); tokens somam as voltas", () => {
    const evs = s7();
    const results = evs.filter((e): e is Extract<EventoStream, { tipo: "result" }> => e.tipo === "result");
    expect(results).toHaveLength(2);
    const r = classificarSessao({ eventos: evs, exitCode: 0, signal: null, stderr: "" });
    expect(r.desfecho).toBe("sucesso");
    expect(r.texto).toBe("Disparado\n\n4\n\nbg-pronto");
    expect(r.custoUsd).toBe(results[1]!.custoUsd);
    expect(r.tokens.saida).toBe(results[0]!.tokens.saida + results[1]!.tokens.saida);
    expect(r.tokens.cacheLeitura).toBe(results[0]!.tokens.cacheLeitura + results[1]!.tokens.cacheLeitura);
    expect(r.sessaoCli).toBe("a40747bc-97db-4a63-b621-99a40d0dda85");
    expect(r.ferramentasChamadas).toEqual(["Bash"]);
  });

  it("a volta já entregue como fala intermediária não entra de novo na fala final", () => {
    const r = classificarSessao({ eventos: s7(), exitCode: 0, signal: null, stderr: "", rodadasJaFaladas: 1 });
    expect(r.texto).toBe("bg-pronto");
    const nada = classificarSessao({ eventos: s7(), exitCode: 0, signal: null, stderr: "", rodadasJaFaladas: 2 });
    expect(nada.texto).toBe("");
    expect(nada.desfecho).toBe("sucesso");
  });

  it("um result só: exatamente o que classificarResultado devolve (o turno de sempre não muda)", () => {
    for (const nome of ["s3-mcp-ok.jsonl", "s4b-negado.jsonl"]) {
      const evs = eventosDe(nome);
      expect(classificarSessao({ eventos: evs, exitCode: 0, signal: null, stderr: "" })).toEqual(classificarResultado({ eventos: evs, exitCode: 0, signal: null, stderr: "" }));
    }
  });

  it("Parar no meio da volta seguinte: interrompido com o que ela escreveu, e não o sucesso da volta anterior", () => {
    const evs = s7();
    const primeiraVolta = evs.slice(0, evs.findIndex((e) => e.tipo === "result") + 1);
    const depois: EventoStream[] = [{ tipo: "delta", texto: "Rodando a suíte inteira…" }, { tipo: "tool_use", id: "u9", nome: "Bash", input: { command: "npm test" } }];
    const r = classificarSessao({ eventos: [...primeiraVolta, ...depois], exitCode: 143, signal: null, stderr: "", interrompidoPeloDriver: true, rodadasJaFaladas: 1 });
    expect(r.desfecho).toBe("interrompido");
    expect(r.texto).toBe("Rodando a suíte inteira…");
    expect(r.custoUsd).toBe((primeiraVolta.at(-1) as Extract<EventoStream, { tipo: "result" }>).custoUsd);
    expect(r.sessaoCli).toBe("a40747bc-97db-4a63-b621-99a40d0dda85");
  });

  it("Parar com um comando ainda em segundo plano (o modelo só esperava): interrompido, mesmo sem nada escrito depois", () => {
    const evs = s7();
    const ateOPrimeiroResult = evs.slice(0, evs.findIndex((e) => e.tipo === "result") + 1);
    expect(ateOPrimeiroResult.some((e) => e.tipo === "tarefa_fundo" && e.estado === "iniciada")).toBe(true);
    const r = classificarSessao({ eventos: ateOPrimeiroResult, exitCode: 143, signal: null, stderr: "", interrompidoPeloDriver: true });
    expect(r.desfecho).toBe("interrompido");
    expect(r.texto).toBe("Disparado\n\n4");
    // Sem Parar, o mesmo stream (o -p de antes matava o comando ao sair) continua sucesso.
    expect(classificarSessao({ eventos: ateOPrimeiroResult, exitCode: 0, signal: null, stderr: "" }).desfecho).toBe("sucesso");
  });

  it("textoDaRodada compõe a fala de uma volta como o fim do turno", () => {
    const evs = s7();
    expect(textoDaRodada(evs.slice(0, evs.findIndex((e) => e.tipo === "result") + 1))).toBe("Disparado\n\n4");
  });
});

/**
 * NOD-350: fixture REAL do CLI 2.1.296 (2026-10-23, haiku), filtrada e com o 2º agente editado para `failed` (LEIA-ME).
 * Dois `Agent` em segundo plano; as linhas assistant/user deles chegam no stream principal com `parent_tool_use_id`.
 */
describe("subagentes no stream principal (NOD-350)", () => {
  const s8 = () => eventosDe("s8-subagentes.jsonl");
  const A1 = "ae5ad90904c8b0ae8";
  const A2 = "a3a699a434ffdd5ca";

  it("as linhas dos subagentes viram ignorado/subagente: o Bash do subagente não é ferramenta do bot", () => {
    const evs = s8();
    expect(evs.filter((e) => e.tipo === "ignorado" && e.razao === "subagente").length).toBeGreaterThan(5);
    const ferramentas = evs.filter((e): e is Extract<EventoStream, { tipo: "tool_use" }> => e.tipo === "tool_use").map((e) => e.nome);
    expect(ferramentas).toEqual(["Agent", "Agent"]);
    expect(evs.filter((e) => e.tipo === "tool_result")).toHaveLength(2);
    // O texto final do subagente não vira bloco da fala do bot.
    const blocos = evs.filter((e): e is Extract<EventoStream, { tipo: "texto_bloco" }> => e.tipo === "texto_bloco").map((e) => e.texto);
    expect(blocos).toHaveLength(3);
    expect(blocos.join(" ")).not.toMatch(/tem \*\*3 linhas\*\*|Os dois comandos rodaram/);
  });

  it("task_started abre cada agente com a descrição; o fim traz concluido e falhou; comando nenhum", () => {
    const tarefas = s8().filter((e) => e.tipo === "tarefa_fundo");
    expect(tarefas.filter((t) => t.estado === "iniciada")).toEqual([
      { tipo: "tarefa_fundo", id: A1, estado: "iniciada", natureza: "agente", descricao: "Contar linhas do um.txt" },
      { tipo: "tarefa_fundo", id: A2, estado: "iniciada", natureza: "agente", descricao: "Falhar de propósito" },
    ]);
    const fins = tarefas.filter((t) => t.estado === "terminada").map((t) => [t.id, t.final]);
    expect(new Set(fins.map((f) => f.join(":")))).toEqual(new Set([`${A1}:concluido`, `${A2}:falhou`]));
  });

  it("task_progress vira tarefa_progresso só com contagem, nome cru da ferramenta e duração (sem summary nem description)", () => {
    const prog = s8().filter((e) => e.tipo === "tarefa_progresso");
    expect(prog[0]).toEqual({ tipo: "tarefa_progresso", id: A1, chamadas: 1, ultimaFerramenta: "Read", duracaoMs: 898 });
    for (const p of prog) expect(Object.keys(p).sort()).toEqual(["chamadas", "duracaoMs", "id", "tipo", "ultimaFerramenta"]);
    expect(JSON.stringify(prog)).not.toMatch(/Reading|Running|nao-existe/);
    // QA: summary e description de uma palavra (passariam pela regex do nome) não viram o passo, nem campo nenhum.
    const linha = { type: "system", subtype: "task_progress", task_id: "a", description: "Segredo1", summary: "Segredo2", last_tool_name: "Bash", usage: { tool_uses: 2, duration_ms: 10 } };
    const ev = interpretarLinhaStreamJson(JSON.stringify(linha));
    expect(ev).toEqual({ tipo: "tarefa_progresso", id: "a", chamadas: 2, ultimaFerramenta: "Bash", duracaoMs: 10 });
    expect(interpretarLinhaStreamJson(JSON.stringify({ ...linha, last_tool_name: undefined }))).toMatchObject({ ultimaFerramenta: null });
  });

  it("a sessão fecha certo: três voltas, texto final do bot, sem a fala do subagente", () => {
    const evs = s8().filter((e) => e.tipo !== "ignorado");
    const r = classificarSessao({ eventos: evs, exitCode: 0, signal: null, stderr: "" });
    expect(r.desfecho).toBe("sucesso");
    expect(evs.filter((e) => e.tipo === "result")).toHaveLength(3);
    expect(r.ferramentasChamadas).toEqual(["Agent", "Agent"]);
  });

  it("delta de stream_event com parent_tool_use_id é do subagente; message_delta segue como chamada (subagente: true)", () => {
    const delta = { type: "stream_event", parent_tool_use_id: "toolu_x", event: { type: "content_block_delta", delta: { type: "text_delta", text: "oi" } } };
    expect(interpretarLinhaStreamJson(JSON.stringify(delta))).toMatchObject({ tipo: "ignorado", razao: "subagente" });
    expect(interpretarLinhaStreamJson(JSON.stringify({ ...delta, parent_tool_use_id: null }))).toEqual({ tipo: "delta", texto: "oi" });
    const md = { type: "stream_event", parent_tool_use_id: "toolu_x", event: { type: "message_delta", usage: { output_tokens: 3 } } };
    expect(interpretarLinhaStreamJson(JSON.stringify(md))).toMatchObject({ tipo: "chamada", subagente: true });
  });

  it("descrição do modelo (QA): sem sobra de ANSI nem bidi, e o corte não parte emoji", () => {
    const desc = (d: string) => (interpretarLinhaStreamJson(JSON.stringify({ type: "system", subtype: "task_started", task_id: "a", task_type: "local_agent", description: d })) as { descricao?: string }).descricao;
    expect(desc("Extra\u0007\u001b[31m<b>x</b>\u001b[0m fim")).toBe("Extra <b>x</b> fim");
    expect(desc("a\u202Eb\u2066c")).toBe("a b c");
    const comEmoji = desc(`${"x".repeat(78)}😀😀`)!;
    expect(comEmoji).toBe(`${"x".repeat(78)}…`);
    expect(comEmoji).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it("descrição do modelo: uma linha, sem controle, redigida e com até 80 caracteres", () => {
    const longa = `Linha um\n\tdois\u0007 ${"x".repeat(120)}`;
    const ev = interpretarLinhaStreamJson(JSON.stringify({ type: "system", subtype: "task_started", task_id: "a", is_backgrounded: true, task_type: "local_agent", description: longa }));
    const d = (ev as Extract<EventoStream, { tipo: "tarefa_fundo" }>).descricao!;
    expect(d.length).toBeLessThanOrEqual(80);
    expect(d).toMatch(/^Linha um dois x+…$/);
    const segredo = interpretarLinhaStreamJson(JSON.stringify({ type: "system", subtype: "task_started", task_id: "b", is_backgrounded: true, task_type: "local_agent", description: "usar sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789" }));
    expect((segredo as Extract<EventoStream, { tipo: "tarefa_fundo" }>).descricao).not.toMatch(/abcdefghijklmnop/);
    const vazia = interpretarLinhaStreamJson(JSON.stringify({ type: "system", subtype: "task_started", task_id: "c", is_backgrounded: true, task_type: "local_agent" }));
    expect((vazia as Extract<EventoStream, { tipo: "tarefa_fundo" }>).descricao).toBe("Subagente");
  });

  it("comando em segundo plano: nunca leva a description (é o próprio comando)", () => {
    const ev = interpretarLinhaStreamJson(JSON.stringify({ type: "system", subtype: "task_started", task_id: "b1", is_backgrounded: true, task_type: "local_bash", description: "rm -rf /tmp/x" }));
    expect(ev).toEqual({ tipo: "tarefa_fundo", id: "b1", estado: "iniciada", natureza: "comando" });
  });

  it("killed e stopped param; progresso com usage estranho não quebra", () => {
    for (const status of ["killed", "stopped", "cancelled"]) {
      expect(interpretarLinhaStreamJson(JSON.stringify({ type: "system", subtype: "task_notification", task_id: "a", status }))).toMatchObject({ final: "parado" });
    }
    expect(interpretarLinhaStreamJson(JSON.stringify({ type: "system", subtype: "task_progress", task_id: "a", usage: { tool_uses: -3, duration_ms: "x" } }))).toEqual({
      tipo: "tarefa_progresso",
      id: "a",
      chamadas: 0,
      ultimaFerramenta: null,
      duracaoMs: null,
    });
  });
});
