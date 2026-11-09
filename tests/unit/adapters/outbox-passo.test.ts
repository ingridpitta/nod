import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { iniciarDespachanteOutbox } from "../../../src/adapters/fundo/despachar-outbox.ts";
import { criarBarramento } from "../../../src/services/barramento.ts";
import { avisarOutbox } from "../../../src/shared/sinal-outbox.ts";
import type { Db } from "../../../src/shared/types.ts";

/**
 * #218 (2026-10-09): o despachante do outbox passava a cada 250 ms, com uma transação por pessoa, mesmo com o Nod
 * parado (~345 mil transações por dia). Agora o passo dobra a cada passada vazia até 5 s e volta a 250 ms quando o
 * processo grava no outbox. Cada passada lista as pessoas: contar `listarPessoas` é contar passadas (sem pessoas, o
 * banco nem é tocado).
 */
const db = {} as Db;

describe("despachante do outbox: passo adaptativo (#218)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function montar() {
    let passadas = 0;
    const laco = iniciarDespachanteOutbox(db, criarBarramento(), {
      listarPessoas: async () => {
        passadas += 1;
        return [];
      },
    });
    return { laco, passadas: () => passadas };
  }

  it("ocioso: menos de uma passada por segundo depois do aquecimento (antes eram 4)", async () => {
    const m = montar();
    await vi.advanceTimersByTimeAsync(10_000); // os 5 s de passo curto do início e o passo crescendo
    const antes = m.passadas();
    await vi.advanceTimersByTimeAsync(60_000);
    await m.laco.parar();
    const porSegundo = (m.passadas() - antes) / 60;
    expect(porSegundo).toBeLessThan(1);
    expect(porSegundo).toBeGreaterThanOrEqual(0.2 - 0.02); // o teto de 5 s: o frame de outro processo ainda sai
  });

  it("linha gravada neste processo acorda o despachante: a próxima passada sai em 250 ms, não no passo ocioso", async () => {
    const m = montar();
    await vi.advanceTimersByTimeAsync(30_000);
    const antes = m.passadas();
    avisarOutbox();
    await vi.advanceTimersByTimeAsync(250);
    expect(m.passadas()).toBe(antes + 1);
    // Fica no passo curto por um tempo (cobre o commit de quem gravou), depois volta a espaçar.
    await vi.advanceTimersByTimeAsync(4_000);
    expect(m.passadas()).toBeGreaterThanOrEqual(antes + 15);
    await m.laco.parar();
  });

  it("parado, o aviso não agenda nada", async () => {
    const m = montar();
    await m.laco.parar();
    const antes = m.passadas();
    avisarOutbox();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(m.passadas()).toBe(antes);
  });
});

/**
 * NOD-331: `parar()` é definitivo. Na drenagem com prazo, o `soLigacoes` pode ainda estar esperando a passada em voo
 * quando o fechar() chama `parar()`; ao acordar, ele não pode religar o modo "só ligações".
 */
describe("despachante do outbox: soLigacoes depois do parar (NOD-331)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("soLigacoes cuja passada em voo só termina depois de parar() não agenda nada", async () => {
    // O `select now()` do soLigacoes: o único uso do banco aqui (sem pessoas, a passada não toca nele).
    const dbComRelogio = (async () => [{ desde: new Date() }]) as unknown as Db;
    let soltar: () => void = () => undefined;
    let passadas = 0;
    const laco = iniciarDespachanteOutbox(dbComRelogio, criarBarramento(), {
      listarPessoas: () => {
        passadas += 1;
        // A 1ª passada fica presa até o teste soltar.
        return passadas === 1 ? new Promise((r) => { soltar = () => r([]); }) : Promise.resolve([]);
      },
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(passadas).toBe(1);

    let consultasDasLigacoes = 0;
    const so = laco.soLigacoes(() => {
      consultasDasLigacoes += 1;
      return [{ tenantId: "t", id: "p" }];
    });
    const parar = laco.parar();
    soltar();
    await Promise.all([so, parar]);
    await vi.advanceTimersByTimeAsync(10_000);
    // Nem o log de entrada no modo nem uma passada "só ligações": nada religou.
    expect(consultasDasLigacoes).toBe(0);
    expect(passadas).toBe(1);
  });

  // QA NOD-331: o teste de concorrência (c) prende o varredor, não o despachante, e passava com o `desde` lido depois da
  // espera. Aqui a passada do despachante é que está presa: a hora do banco tem de sair antes de ela terminar.
  it("o desde (hora do banco) é lido antes de esperar a passada em voo", async () => {
    let leuHora = 0;
    const dbComRelogio = (async () => {
      leuHora += 1;
      return [{ desde: new Date() }];
    }) as unknown as Db;
    let soltar: () => void = () => undefined;
    let passadas = 0;
    const laco = iniciarDespachanteOutbox(dbComRelogio, criarBarramento(), {
      listarPessoas: () => {
        passadas += 1;
        return passadas === 1 ? new Promise((r) => { soltar = () => r([]); }) : Promise.resolve([]);
      },
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(passadas).toBe(1);
    const so = laco.soLigacoes(() => []);
    await vi.advanceTimersByTimeAsync(0);
    expect(leuHora).toBe(1); // a passada segue presa
    soltar();
    await so;
    await laco.parar();
  });

  // QA NOD-331: o `select now()` falhando (soluço do banco na hora do SIGTERM) rejeitava o soLigacoes antes de parar o
  // laço normal: a drenagem caía em exit(1) sem esperar a ligação viva, e o laço normal seguia marcando entregue.
  it("select now() falhando: soLigacoes não rejeita, para o laço normal e liga o modo só ligações", async () => {
    const dbSemRelogio = (async () => {
      throw new Error("banco fora");
    }) as unknown as Db;
    let passadas = 0;
    const laco = iniciarDespachanteOutbox(dbSemRelogio, criarBarramento(), {
      listarPessoas: async () => {
        passadas += 1;
        return [];
      },
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(passadas).toBe(1);

    let consultasDasLigacoes = 0;
    await expect(
      laco.soLigacoes(() => {
        consultasDasLigacoes += 1;
        return [];
      }),
    ).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(passadas).toBe(1); // o laço normal parou
    expect(consultasDasLigacoes).toBeGreaterThan(0); // o modo só ligações está ligado
    await laco.parar();
  });
});
