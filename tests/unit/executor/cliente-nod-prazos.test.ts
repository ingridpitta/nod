import { afterEach, describe, expect, it, vi } from "vitest";
import { criarClienteNod, TIMEOUT_CLIENTE_NOD_MS } from "../../../src/adapters/executor/cliente-nod.ts";
import { CHAMADA_CONECTOR_MS, PRAZO_FERRAMENTA_PROXY_MS } from "../../../src/shared/constantes.ts";

/** fetch que nunca responde: só termina quando o proxy desiste (abort). */
const fetchPendurado: typeof fetch = (_url, init) =>
  new Promise((_ok, falhar) => {
    init?.signal?.addEventListener("abort", () => falhar(Object.assign(new Error("aborted"), { name: "AbortError" })));
  });

/**
 * definido em 2026-09-24: o proxy desistia da ferramenta aos 5 s enquanto o servidor ainda esperava
 * o conector (até 15 s por requisição) — a Nina ouvia "servidor fora" de uma chamada só lenta.
 */
describe("prazos do cliente do proxy", () => {
  afterEach(() => vi.useRealTimers());

  it("o prazo da ferramenta cobre initialize + chamada do servidor ao conector", () => {
    expect(PRAZO_FERRAMENTA_PROXY_MS).toBeGreaterThan(2 * CHAMADA_CONECTOR_MS);
  });

  it("ferramenta de conector espera além de 5 s; o plano continua desistindo em 5 s", async () => {
    vi.useFakeTimers();
    const c = criarClienteNod({ url: "http://nod", token: "t", fetchImpl: fetchPendurado });

    let ferramenta: unknown = "pendente";
    void c.ferramenta("gmail__GMAIL_FETCH_EMAILS", {}).then((r) => (ferramenta = r));
    let plano: unknown = "pendente";
    void c.plano().then((r) => (plano = r));

    await vi.advanceTimersByTimeAsync(TIMEOUT_CLIENTE_NOD_MS + 1_000);
    expect(ferramenta).toBe("pendente");
    expect(plano).toMatchObject({ ok: false, motivo: "servidor_fora" });

    await vi.advanceTimersByTimeAsync(PRAZO_FERRAMENTA_PROXY_MS);
    expect(ferramenta).toEqual({ transporte: "timeout", status: null });
  });
});
