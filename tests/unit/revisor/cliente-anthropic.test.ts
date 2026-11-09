import { afterEach, describe, expect, it } from "vitest";
import { contaNoDisjuntor, criarClienteAnthropic, MAX_FICHAS_SAIDA, VERSAO_API_ANTHROPIC } from "../../../src/adapters/revisor/cliente-anthropic.ts";
import { ESQUEMA_VEREDITO, lerVeredito, PROMPT_REVISOR } from "../../../src/domain/revisor.ts";
import { apiAnthropicFalsa, erroApi, LIBERA_API, mensagem, PEDE_API } from "../../helpers/api-anthropic-falsa.ts";

/**
 * O cliente do revisor no servidor (ADR-115, 2026-10-25) contra a API FALSA (servidor HTTP local): nenhuma chamada real.
 * Uma chamada por revisão, sem nova tentativa, com o prazo cortando a chamada inteira.
 */
const CHAVE = "sk-ant-teste-0123456789abcdefghij";
const CHAMADA = { modelo: "claude-haiku-4-5-20251001", sistema: PROMPT_REVISOR, entrada: "CONFIÁVEL\n…\n<<<DADO\nComando: git push --force\nDADO>>>\n" };
// definido em 2026-10-25: prazo folgado para as respostas imediatas (a máquina roda a suíte de vários bots ao mesmo tempo);
// o caso do prazo usa um curto e afirma só o desfecho, nunca o relógio.
const FOLGA_MS = 10_000;

let api: Awaited<ReturnType<typeof apiAnthropicFalsa>> | null = null;
afterEach(async () => {
  await api?.fechar();
  api = null;
});

async function cliente(resposta: Parameters<typeof apiAnthropicFalsa>[0]) {
  api = await apiAnthropicFalsa(resposta);
  return { api, c: criarClienteAnthropic({ chave: CHAVE, url: api.url }) };
}

describe("cliente da API de mensagens do revisor (ADR-115, revisor no servidor)", () => {
  it("libera: um POST com a chave do Nod, a versão da API, o modelo, o system fixo e a entrada; devolve o texto cru e as fichas", async () => {
    const { api, c } = await cliente(() => LIBERA_API);
    const r = await c.revisar({ ...CHAMADA, prazoMs: FOLGA_MS });
    expect(r).toMatchObject({ ok: true, texto: '{"decisao":"libera","motivo":"você pediu"}', fichasEntrada: 1_200, fichasSaida: 40 });
    expect(r.ok && lerVeredito(r.texto)).toEqual({ decisao: "libera", motivo: "você pediu" });
    expect(api.pedidos).toHaveLength(1);
    const [p] = api.pedidos;
    expect(p?.cabecalhos["x-api-key"]).toBe(CHAVE);
    expect(p?.cabecalhos["anthropic-version"]).toBe(VERSAO_API_ANTHROPIC);
    expect(p?.cabecalhos["content-type"]).toBe("application/json");
    // Revisão do #524, item 2: a saída estruturada (JSON schema) prende a geração ao veredito.
    expect(p?.corpo).toEqual({
      model: CHAMADA.modelo,
      max_tokens: MAX_FICHAS_SAIDA,
      system: PROMPT_REVISOR,
      messages: [{ role: "user", content: CHAMADA.entrada }],
      output_config: { format: { type: "json_schema", schema: ESQUEMA_VEREDITO } },
    });
  });

  it("revisão do #524 (item 3): conta no disjuntor só a falha do serviço, nunca a que o conteúdo do pedido provoca", () => {
    const falha = (motivo: string, status?: number, prazo = false) => ({ ok: false as const, falha: prazo ? ("prazo" as const) : ("api" as const), motivo, ...(status === undefined ? {} : { status }), ms: 1 });
    for (const f of [falha("prazo", undefined, true), falha("rede"), falha("formato", 200), ...[401, 403, 404, 408, 429, 500, 502, 503, 529].map((s) => falha(`http_${s}`, s))]) expect(contaNoDisjuntor(f), f.motivo).toBe(true);
    for (const f of [falha("recusa", 200), ...[400, 409, 413, 422].map((s) => falha(`http_${s}`, s))]) expect(contaNoDisjuntor(f), f.motivo).toBe(false);
  });

  it("pede: o texto volta igual (quem lê o veredito é o domínio)", async () => {
    const { c } = await cliente(() => PEDE_API);
    const r = await c.revisar({ ...CHAMADA, prazoMs: FOLGA_MS });
    expect(r.ok && lerVeredito(r.texto)).toEqual({ decisao: "pede", motivo: "apaga mais do que você pediu" });
  });

  it("lixo: texto fora do esquema volta como texto (a fase 3 o recusa); corpo que não é a mensagem é falha `api` (formato)", async () => {
    const { api, c } = await cliente(() => mensagem('Claro! {"decisao":"libera","motivo":"ok"}'));
    const r = await c.revisar({ ...CHAMADA, prazoMs: FOLGA_MS });
    expect(r.ok).toBe(true);
    expect(r.ok && lerVeredito(r.texto)).toBeNull();
    api.responder(() => ({ status: 200, corpo: "<html>proxy</html>" }));
    expect(await c.revisar({ ...CHAMADA, prazoMs: FOLGA_MS })).toMatchObject({ ok: false, falha: "api", motivo: "formato" });
    api.responder(() => ({ status: 200, corpo: JSON.stringify({ type: "message", content: "não é lista" }) }));
    expect(await c.revisar({ ...CHAMADA, prazoMs: FOLGA_MS })).toMatchObject({ ok: false, falha: "api", motivo: "formato" });
  });

  it("recusa do modelo (`stop_reason: refusal`): falha `api`, com as fichas para o teto", async () => {
    const { c } = await cliente(() => mensagem("", { stop: "refusal", entrada: 900, saida: 3 }));
    expect(await c.revisar({ ...CHAMADA, prazoMs: FOLGA_MS })).toMatchObject({ ok: false, falha: "api", motivo: "recusa", fichasEntrada: 900, fichasSaida: 3 });
  });

  it.each([
    [500, "api_error"],
    [529, "overloaded_error"],
    [429, "rate_limit_error"],
    [401, "authentication_error"],
  ])("HTTP %i: falha `api` com o status, numa chamada só (sem nova tentativa)", async (status, tipo) => {
    const { api, c } = await cliente(() => erroApi(status, tipo));
    expect(await c.revisar({ ...CHAMADA, prazoMs: FOLGA_MS })).toMatchObject({ ok: false, falha: "api", motivo: `http_${status}`, status });
    expect(api.pedidos).toHaveLength(1);
  });

  it("a API não responde: o prazo corta a chamada inteira e dá `prazo`, sem nova tentativa", async () => {
    const { api, c } = await cliente(() => "pendurar");
    expect(await c.revisar({ ...CHAMADA, prazoMs: 300 })).toMatchObject({ ok: false, falha: "prazo", motivo: "prazo" });
    expect(api.pedidos).toHaveLength(1);
  });

  it("prazo já vencido: nem chama", async () => {
    const { api, c } = await cliente(() => LIBERA_API);
    expect(await c.revisar({ ...CHAMADA, prazoMs: 0 })).toMatchObject({ ok: false, falha: "prazo" });
    expect(api.pedidos).toHaveLength(0);
  });

  it("rede fora (conexão recusada): falha `api` (rede), nunca lança", async () => {
    const { api, c } = await cliente(() => LIBERA_API);
    await api.fechar();
    expect(await c.revisar({ ...CHAMADA, prazoMs: FOLGA_MS })).toMatchObject({ ok: false, falha: "api", motivo: "rede" });
  });

  it("só os blocos de texto contam (um modelo com raciocínio manda `thinking` antes)", async () => {
    const corpo = JSON.stringify({ type: "message", content: [{ type: "thinking", thinking: "" }, { type: "text", text: '{"decisao":"pede",' }, { type: "text", text: '"motivo":"dúvida"}' }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 7 } });
    const { c } = await cliente(() => ({ status: 200, corpo }));
    expect(await c.revisar({ ...CHAMADA, prazoMs: FOLGA_MS })).toMatchObject({ ok: true, texto: '{"decisao":"pede","motivo":"dúvida"}', fichasEntrada: 17, fichasSaida: 5 });
  });
});
