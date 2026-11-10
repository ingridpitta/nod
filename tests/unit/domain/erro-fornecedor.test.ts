import { describe, expect, it } from "vitest";
import { appSemJanelaReal, CLASSES_ERRO_FORNECEDOR, classificarErroFornecedor, ehErroTransitorio, FRASE_ERRO_FORNECEDOR, fraseDoErroFornecedor, fraseDoLimiteDoPlano, horaDaFrase, VERSAO_APP_ATUALIZA_SOZINHO, VERSAO_APP_JANELA_REAL } from "../../../src/domain/erro-fornecedor.ts";
import { redigir } from "../../../src/domain/redacao.ts";
import { redigirSegredos } from "../../../src/domain/segredos.ts";

/**
 * Amostras no formato do `erroCru` de cada driver: o Claude junta `subtype | error | errors | result` (stream-json.ts) e
 * o Codex manda `turn.failed.error.message` ou o evento `error` (codex-stream.ts, codex-app-server.ts).
 */
const AMOSTRAS: Record<(typeof CLASSES_ERRO_FORNECEDOR)[number], string[]> = {
  login_expirado: [
    "success | Invalid API key · Please run /login",
    "success | OAuth token has expired. Please obtain a new token or refresh your existing token.",
    "success | Not logged in · Please run /login",
    'success | API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
    "unexpected status 401 Unauthorized: Missing bearer or basic authentication in header",
    "Your access token could not be refreshed because your refresh token has expired. Please log out and sign in again.",
  ],
  limite_de_uso: [
    "You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), or try again in 2 days 3 hours 12 minutes.",
    'unexpected status 429 Too Many Requests: {"error":{"type":"usage_limit_reached","message":"The usage limit has been reached"}}',
    "success | Claude AI usage limit reached|1791306000",
    // NOD-293 (C19): as frases novas do Claude Code para o limite do plano (sessão de 5 h e semanal).
    "success | You've hit your session limit · resets 3pm (America/Sao_Paulo)",
    "success | Weekly limit reached ∙ resets Oct 27, 9am",
    "success | You've hit your weekly limit · resets Mon 9am",
    "success | You've hit your opus limit · resets 3pm",
  ],
  teto_de_gasto: [
    "success | You've hit your monthly spend limit · raise it in Settings > Usage",
    "API Error: 400 Your organization has reached its monthly spend limit",
  ],
  autocompactacao: [
    "success | Autocompact is thrashing: the context refilled to the limit within 3 turns of the previous compact",
    "error_during_execution | Autocompact is thrashing",
    "error_during_execution | api_error: autocompact_thrashing",
  ],
  contexto_cheio: [
    "success | Prompt is too long",
    'error_during_execution | API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long: 212345 tokens > 200000 maximum"}}',
    "Your input exceeds the context window of this model. Please adjust your input and try again.",
    "context_length_exceeded",
  ],
  transitorio: [
    'success | API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
    "error_during_execution | Repeated 529 Overloaded errors",
    "unexpected status 503 Service Unavailable: upstream connect error",
    // NOD-309: 5xx e rede.
    'success | API Error: 500 {"type":"error","error":{"type":"api_error","message":"Internal server error"}}',
    "unexpected status 502 Bad Gateway",
    "API Error: 504 Gateway Timeout",
    "success | API Error: Connection error. (cause: read ECONNRESET)",
    "request to https://api.anthropic.com/v1/messages failed, reason: connect ETIMEDOUT 160.79.104.10:443",
    "socket hang up",
    "TypeError: fetch failed",
    "stream disconnected before completion: error sending request",
  ],
  desconhecido: [
    "success | Credit balance is too low",
    // 429 da API não é o plano: sem "usage limit", fica a frase de sempre.
    'API Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"Number of request tokens has exceeded your per-minute rate limit"}}',
    // NOD-293 (QA): "hit your rate limit" é o 429 por minuto, não o plano — não pode disparar a troca de conta.
    "success | You've hit your rate limit. Please wait a moment and try again.",
    "API Error: 429 You have hit your rate limit for requests per minute",
    "error_max_turns",
    // "500" solto (contagem de tokens) não é 5xx.
    "prompt used 500 tokens of cache",
    "user cancelled MCP tool call",
  ],
};

const INGLES = /\b(?:error|failed|please|login|overloaded|expired|retry|context)\b/i;

describe("erro do fornecedor em classe fechada (NOD-174)", () => {
  for (const [classe, amostras] of Object.entries(AMOSTRAS)) {
    it(`amostras reais caem em ${classe}`, () => {
      for (const a of amostras) expect(classificarErroFornecedor(a), a).toBe(classe);
    });
  }

  it("NOD-293 (C19): o teto de gasto não é o limite do plano (é da organização: trocar de conta não resolve)", () => {
    expect(classificarErroFornecedor("You've hit your monthly spend limit")).toBe("teto_de_gasto");
    expect(classificarErroFornecedor("You've hit your session limit")).toBe("limite_de_uso");
    expect(fraseDoErroFornecedor("claude-cli", AMOSTRAS.teto_de_gasto[0])).toBe("a organização atingiu o teto de gasto do mês no Claude Code; peça a quem administra a conta para subir o teto");
    expect(fraseDoErroFornecedor(null, AMOSTRAS.teto_de_gasto[1])).toBe("a organização atingiu o teto de gasto do mês na sua IA; peça a quem administra a conta para subir o teto");
    expect(fraseDoErroFornecedor("claude-cli", AMOSTRAS.autocompactacao[0])).toBe("o histórico enche de novo logo depois de resumido e o Claude Code parou, mesmo numa sessão nova; divida o pedido em partes menores ou escolha um modelo com mais contexto");
  });

  it("2026-11-09: o laço de compactação num app anterior à rc.7 manda atualizar; na rc.7, sem versão ou noutra IA, a frase de sempre", () => {
    const antiga = "o histórico enche de novo logo depois de resumido e o Claude Code parou; o nod deste computador está na versão 1.0.0-rc.6, que resume cedo demais: reinicie o nod para atualizar e peça de novo";
    expect(fraseDoErroFornecedor("claude-cli", AMOSTRAS.autocompactacao[0], { versaoApp: "1.0.0-rc.6" })).toBe(antiga);
    expect(fraseDoErroFornecedor("claude-cli", AMOSTRAS.autocompactacao[1], { versaoApp: "0.9.3" })).toContain("versão 0.9.3, que resume cedo demais");
    const deSempre = FRASE_ERRO_FORNECEDOR.autocompactacao.replace("{o}", "o Claude Code");
    for (const versaoApp of ["1.0.0-rc.7", "1.0.0", "1.2.0-rc.1", null, undefined, "", "lixo; rm -rf", "1.0.0-beta.1"]) {
      expect(fraseDoErroFornecedor("claude-cli", AMOSTRAS.autocompactacao[0], { versaoApp })).toBe(deSempre);
    }
    // O driver antigo é o do Claude Code: o Codex no mesmo app não ganha a frase de atualizar.
    expect(fraseDoErroFornecedor("codex-cli", AMOSTRAS.autocompactacao[0], { versaoApp: "1.0.0-rc.6" })).toBe(FRASE_ERRO_FORNECEDOR.autocompactacao.replace("{o}", "o Codex"));
    // Outra classe no app antigo segue com a frase dela.
    expect(fraseDoErroFornecedor("claude-cli", AMOSTRAS.login_expirado[0], { versaoApp: "1.0.0-rc.6" })).toBe(fraseDoErroFornecedor("claude-cli", AMOSTRAS.login_expirado[0]));
    expect(appSemJanelaReal(VERSAO_APP_JANELA_REAL)).toBe(false);
    expect(appSemJanelaReal("1.0.0-rc.6")).toBe(true);
  });

  it("revisão do #718: app anterior à rc.4 não tem atualização automática — reiniciar não atualiza, a frase manda baixar", () => {
    const baixar = (v: string) => `o histórico enche de novo logo depois de resumido e o Claude Code parou; o nod deste computador está na versão ${v}, que resume cedo demais e não se atualiza sozinha: baixe a versão nova em nodbot.ai e peça de novo`;
    for (const v of ["1.0.0-rc.3", "1.0.0-rc.1", "0.4.0-rc.9", "0.9.3"]) {
      expect(fraseDoErroFornecedor("claude-cli", AMOSTRAS.autocompactacao[0], { versaoApp: v })).toBe(baixar(v));
    }
    expect(VERSAO_APP_ATUALIZA_SOZINHO).toBe("1.0.0-rc.4");
    for (const v of ["1.0.0-rc.4", "1.0.0-rc.5", "1.0.0-rc.6"]) {
      expect(fraseDoErroFornecedor("claude-cli", AMOSTRAS.autocompactacao[0], { versaoApp: v })).toContain(`versão ${v}, que resume cedo demais: reinicie o nod para atualizar`);
    }
  });

  it("vazio, nulo e só espaço são desconhecido, sem frase", () => {
    for (const v of [null, undefined, "", "   "]) {
      expect(classificarErroFornecedor(v)).toBe("desconhecido");
      expect(fraseDoErroFornecedor("claude-cli", v)).toBeNull();
    }
  });

  it("texto que bate em duas classes segue a ordem login > limite > contexto > transitório", () => {
    expect(classificarErroFornecedor("529 overloaded; then 401 Unauthorized")).toBe("login_expirado");
    expect(classificarErroFornecedor("usage limit reached; 401 Unauthorized")).toBe("login_expirado");
    expect(classificarErroFornecedor("Overloaded… You've hit your usage limit")).toBe("limite_de_uso");
    expect(classificarErroFornecedor("Overloaded… Prompt is too long")).toBe("contexto_cheio");
  });

  it("NOD-309: só o transitório repete; contexto cheio e login expirado nunca, mesmo junto de um 5xx ou de rede", () => {
    for (const a of AMOSTRAS.transitorio) expect(ehErroTransitorio(a), a).toBe(true);
    for (const classe of ["login_expirado", "limite_de_uso", "contexto_cheio", "desconhecido"] as const) {
      for (const a of AMOSTRAS[classe]) expect(ehErroTransitorio(a), a).toBe(false);
    }
    expect(ehErroTransitorio("API Error: 503 Service Unavailable… Prompt is too long")).toBe(false);
    expect(ehErroTransitorio("fetch failed; OAuth token has expired")).toBe(false);
    expect(ehErroTransitorio(null)).toBe(false);
  });

  it("a frase sai em pt-BR, com o nome da IA e sem código snake_case nem inglês", () => {
    expect(fraseDoErroFornecedor("claude-cli", AMOSTRAS.login_expirado[0])).toBe("sua conta do Claude Code saiu deste Mac; use Conectar IA para entrar de novo");
    expect(fraseDoErroFornecedor("codex-cli", AMOSTRAS.contexto_cheio[2])).toBe("a conversa ficou longa demais para o Codex; use /compactar e peça de novo");
    expect(fraseDoErroFornecedor(null, AMOSTRAS.transitorio[0])).toBe("o serviço da sua IA está instável ou fora do ar; tente de novo em alguns minutos");
    for (const harness of ["claude-cli", "codex-cli", null] as const) {
      for (const classe of Object.keys(FRASE_ERRO_FORNECEDOR) as (keyof typeof FRASE_ERRO_FORNECEDOR)[]) {
        const frase = fraseDoErroFornecedor(harness, AMOSTRAS[classe][0])!;
        expect(frase).not.toMatch(/[{}]|[a-z]+_[a-z]+|claude-cli|codex-cli/);
        expect(frase).not.toMatch(INGLES);
      }
    }
  });

  it("NOD-171: limite no Codex manda conferir o plano no ChatGPT; o motivo continua o do protocolo", () => {
    expect(fraseDoErroFornecedor("codex-cli", AMOSTRAS.limite_de_uso[0])).toBe("seu plano do Codex atingiu o limite de uso; confira seu plano no ChatGPT");
    expect(fraseDoErroFornecedor("claude-cli", AMOSTRAS.limite_de_uso[2])).toBe("seu plano do Claude Code atingiu o limite de uso; espere o uso renovar e tente de novo");
    expect(fraseDoErroFornecedor(null, AMOSTRAS.limite_de_uso[1])).toBe("seu plano da sua IA atingiu o limite de uso; espere o uso renovar e tente de novo");
  });

  it("NOD-171: a frase do limite do plano diz quando volta, no fuso de São Paulo, e nunca uma hora que já passou", () => {
    const agora = Date.UTC(2026, 9, 6, 15, 0); // 12:00 em SP
    expect(fraseDoLimiteDoPlano("claude-cli", Date.UTC(2026, 9, 6, 17, 30), agora)).toBe("seu plano do Claude Code atingiu o limite de uso; volta a funcionar às 14:30");
    expect(fraseDoLimiteDoPlano("claude-cli", Date.UTC(2026, 9, 9, 13, 5), agora)).toBe("seu plano do Claude Code atingiu o limite de uso; volta a funcionar em 09/10 às 10:05");
    // 02:30 UTC do dia 7 ainda é dia 6 em SP (23:30).
    expect(fraseDoLimiteDoPlano("claude-cli", Date.UTC(2026, 9, 7, 2, 30), agora)).toBe("seu plano do Claude Code atingiu o limite de uso; volta a funcionar às 23:30");
    for (const voltaEm of [null, undefined, agora - 1, agora]) {
      expect(fraseDoLimiteDoPlano("claude-cli", voltaEm, agora)).toBe("seu plano do Claude Code atingiu o limite de uso; espere o uso renovar e tente de novo");
    }
    expect(fraseDoLimiteDoPlano(null, null, agora)).not.toMatch(/[{}]|[a-z]+_[a-z]+|claude-cli/);
  });

  it("UX-02: o 'desde' de executor indisponível sai na hora de São Paulo, nunca em ISO/UTC", () => {
    const agora = Date.UTC(2026, 9, 6, 15, 0); // 12:00 em SP
    expect(horaDaFrase(Date.UTC(2026, 9, 6, 13, 20, 54), agora)).toBe("10:20");
    expect(horaDaFrase(Date.UTC(2026, 9, 5, 14, 46), agora)).toBe("05/10 às 11:46");
    const texto = redigir("executor-indisponivel", agora, { motivo: "claude-cli: conta sem acesso", desde: horaDaFrase(agora, agora) });
    expect(texto).toBe("Nenhum trabalho começa: executor indisponível (claude-cli: conta sem acesso) desde 12:00.");
    expect(texto).not.toMatch(/\d{4}-\d{2}-\d{2}T|Z\./);
  });

  it("segredo no erro cru: o redator roda antes e a frase não carrega o valor", () => {
    const chave = "sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
    const cru = redigirSegredos(`success | Invalid API key ${chave} · Please run /login`);
    expect(cru).not.toContain(chave);
    expect(classificarErroFornecedor(cru)).toBe("login_expirado");
    expect(fraseDoErroFornecedor("claude-cli", cru)).not.toContain("sk-ant");
  });
});
