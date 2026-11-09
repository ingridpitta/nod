import { describe, expect, it } from "vitest";
import { classificarFalhaHttp, ehRedirecionamentoRecusado, esperaAntes, lerRetryAfterMs, podeRepetir, prazoDaTentativa, type PedidoNovaTentativa } from "../../../src/domain/nova-tentativa.ts";

const base: PedidoNovaTentativa = { classe: "transitoria", status: 503, somenteLeitura: true, tentativa: 1, restanteMs: 30_000, prazoMs: 15_000 };

describe("classificarFalhaHttp (por status e transporte, nunca por texto)", () => {
  it("429, 5xx e rede são transitórios; 401/403 autenticação; 4xx de pedido; timeout à parte", () => {
    for (const s of [429, 500, 502, 503, 504, "rede"] as const) expect(classificarFalhaHttp(s)).toBe("transitoria");
    for (const s of [401, 403]) expect(classificarFalhaHttp(s)).toBe("autenticacao");
    for (const s of [400, 404, 409, 422]) expect(classificarFalhaHttp(s)).toBe("pedido");
    expect(classificarFalhaHttp("timeout")).toBe("timeout");
  });
});

describe("podeRepetir", () => {
  it("leitura repete em 429, 5xx e rede", () => {
    for (const status of [429, 500, 502, 503, 504]) expect(podeRepetir({ ...base, status })).toBe(true);
    expect(podeRepetir({ ...base, status: undefined })).toBe(true);
  });
  it("escrita repete só em 429: 5xx e rede têm desfecho desconhecido (ADR-009)", () => {
    expect(podeRepetir({ ...base, somenteLeitura: false, status: 429 })).toBe(true);
    for (const status of [500, 502, 503, 504]) expect(podeRepetir({ ...base, somenteLeitura: false, status })).toBe(false);
    expect(podeRepetir({ ...base, somenteLeitura: false, status: undefined })).toBe(false);
  });
  it("nunca repete autenticação, pedido nem timeout", () => {
    for (const status of [401, 403, 400, 404, 409, 422]) expect(podeRepetir({ ...base, classe: classificarFalhaHttp(status), status })).toBe(false);
    expect(podeRepetir({ ...base, classe: "timeout", status: undefined })).toBe(false);
  });
  it("a terceira tentativa é a última", () => {
    expect(podeRepetir({ ...base, tentativa: 2 })).toBe(true);
    expect(podeRepetir({ ...base, tentativa: 3 })).toBe(false);
  });
  it("Retry-After de 2 s é respeitado; de 120 s (ou 6 s) não repete", () => {
    expect(podeRepetir({ ...base, retryAfterMs: 2_000 })).toBe(true);
    expect(podeRepetir({ ...base, retryAfterMs: 5_000 })).toBe(true);
    expect(podeRepetir({ ...base, retryAfterMs: 6_000 })).toBe(false);
    expect(podeRepetir({ ...base, retryAfterMs: 120_000 })).toBe(false);
  });
  it("não repete quando a espera mais 15 s passa do orçamento que sobra", () => {
    expect(podeRepetir({ ...base, restanteMs: 16_250 })).toBe(true);
    expect(podeRepetir({ ...base, restanteMs: 16_249 })).toBe(false);
    expect(podeRepetir({ ...base, tentativa: 2, restanteMs: 18_749 })).toBe(false);
    expect(podeRepetir({ ...base, retryAfterMs: 2_000, restanteMs: 16_999 })).toBe(false);
  });
  it("a conta usa o prazo do chamador, não 15 s fixos", () => {
    expect(podeRepetir({ ...base, prazoMs: 6_000, restanteMs: 7_250 })).toBe(true);
    expect(podeRepetir({ ...base, prazoMs: 6_000, restanteMs: 7_249 })).toBe(false);
  });
});

describe("esperaAntes", () => {
  it("~1 s depois da primeira e ~3 s depois da segunda, ±25% com aleatório fixo nos extremos", () => {
    expect([esperaAntes(1, 0), esperaAntes(1, 0.5), esperaAntes(1, 1)]).toEqual([750, 1_000, 1_250]);
    expect([esperaAntes(2, 0), esperaAntes(2, 0.5), esperaAntes(2, 1)]).toEqual([2_250, 3_000, 3_750]);
  });
  it("Retry-After substitui a base", () => {
    expect(esperaAntes(1, 0.9, 2_000)).toBe(2_000);
  });
});

describe("lerRetryAfterMs", () => {
  it("segundos, data HTTP e lixo", () => {
    const agora = Date.parse("2026-10-05T12:00:00Z");
    expect(lerRetryAfterMs("2", agora)).toBe(2_000);
    expect(lerRetryAfterMs("Mon, 05 Oct 2026 12:00:03 GMT", agora)).toBe(3_000);
    expect(lerRetryAfterMs("Mon, 05 Oct 2026 11:59:00 GMT", agora)).toBe(0);
    expect(lerRetryAfterMs("logo", agora)).toBeUndefined();
    expect(lerRetryAfterMs(null, agora)).toBeUndefined();
  });

  it("número fora do formato (fração, sinal) não vira data de 2001 com espera 0: usa a base", () => {
    const agora = Date.parse("2026-10-05T12:00:00Z");
    for (const v of ["1.5", "-1", "+3", "0.5"]) expect(lerRetryAfterMs(v, agora)).toBeUndefined();
    expect(lerRetryAfterMs("Monday, 05-Oct-26 12:00:04 GMT", agora)).toBe(4_000);
  });

  // Regression: ISSUE-001 — data asctime (sem fuso) lida no fuso da máquina; a leste de UTC virava passado e espera 0
  // Found by /qa on 2026-10-05
  it("data asctime é GMT (RFC 9110), em qualquer fuso da máquina", () => {
    const tz = process.env.TZ;
    try {
      for (const fuso of ["Asia/Tokyo", "America/Sao_Paulo", "UTC"]) {
        process.env.TZ = fuso;
        expect(lerRetryAfterMs("Mon Oct  5 12:00:05 2026", Date.parse("2026-10-05T12:00:00Z")), fuso).toBe(5_000);
      }
    } finally {
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
    }
  });

  it("prazo da tentativa: o teto, cortado ao que sobra do orçamento, nunca abaixo de 1 ms", () => {
    expect(prazoDaTentativa(15_000, 30_000)).toBe(15_000);
    expect(prazoDaTentativa(15_000, 6_000)).toBe(6_000);
    expect(prazoDaTentativa(8_000, 12_000)).toBe(8_000);
    expect(prazoDaTentativa(15_000, -500)).toBe(1);
  });

  it("redirecionamento recusado só pela causa do fetch; corte de rede não é", () => {
    expect(ehRedirecionamentoRecusado(new TypeError("fetch failed", { cause: new Error("unexpected redirect") }))).toBe(true);
    expect(ehRedirecionamentoRecusado(new TypeError("fetch failed", { cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }) }))).toBe(false);
    expect(ehRedirecionamentoRecusado(new TypeError("fetch failed"))).toBe(false);
    expect(ehRedirecionamentoRecusado("unexpected redirect")).toBe(false);
  });

  it("403 com Retry-After é limitação conhecida: continua autenticação e não repete", () => {
    expect(classificarFalhaHttp(403)).toBe("autenticacao");
    expect(podeRepetir({ ...base, classe: "autenticacao", status: 403, retryAfterMs: 1_000 })).toBe(false);
  });
});
