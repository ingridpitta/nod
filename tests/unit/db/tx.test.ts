import { afterEach, describe, expect, it, vi } from "vitest";
import { abrirTxEscopada, comPrazoDeConexao, ErroBancoOcupado, ErroTxEncerrada, TIMEOUTS_TX, txEscopadaOuDoContexto, vincularEscopo } from "../../../src/db/tx.ts";
import { ErroDeDominio } from "../../../src/domain/erro.ts";
import type { Db, Escopo, Tx } from "../../../src/shared/types.ts";

/** Sem banco: o que se prova aqui é que o escopo é OBRIGATÓRIO e não tem default (ADR-003). */
const dbQueNaoPodeSerTocado = new Proxy({} as Db, {
  get() {
    throw new Error("o banco não pode ser tocado sem escopo");
  },
});
const trxQueNaoPodeSerTocada = new Proxy({} as Tx, {
  get() {
    throw new Error("a transação não pode ser tocada sem escopo");
  },
});

/** Escopo que chegou incompleto de fora (JSON, env): um campo pode faltar. Um só `as`, nunca cast duplo. */
const escopoIncompleto = (parcial: Partial<Escopo>): Escopo => parcial as Escopo;

describe("tx: escopo obrigatório", () => {
  it.each([
    ["tenantId vazio", escopoIncompleto({ tenantId: "", pessoaId: "p" })],
    ["pessoaId vazio", escopoIncompleto({ tenantId: "t", pessoaId: "" })],
    ["tenantId ausente", escopoIncompleto({ pessoaId: "p" })],
    ["pessoaId ausente", escopoIncompleto({ tenantId: "t" })],
  ])("abrirTxEscopada lança escopo_vazio com %s, antes de tocar o banco", (_nome, escopo) => {
    try {
      abrirTxEscopada(dbQueNaoPodeSerTocado, escopo);
      expect.unreachable("deveria lançar");
    } catch (e) {
      expect(e).toBeInstanceOf(ErroDeDominio);
      expect((e as ErroDeDominio).codigo).toBe("escopo_vazio");
      expect((e as ErroDeDominio).seguro).toBe(true);
    }
  });

  it("vincularEscopo lança escopo_vazio antes de emitir qualquer SQL", async () => {
    await expect(vincularEscopo(trxQueNaoPodeSerTocada, { tenantId: "t", pessoaId: "" })).rejects.toMatchObject({ codigo: "escopo_vazio" });
    await expect(vincularEscopo(trxQueNaoPodeSerTocada, { tenantId: "", pessoaId: "p" })).rejects.toMatchObject({ codigo: "escopo_vazio" });
  });

  it("abrirTxEscopada recusa uma transação já aberta: no tipo e em runtime (escopo aninhado não existe)", () => {
    // Um objeto com a cara de TransactionSql (savepoint, sem begin). O SET LOCAL feito num SAVEPOINT
    // persiste após o RELEASE (medido em 2026-09-16 no psql), então isto seria escalada de escopo.
    const trxAberta = { savepoint: async (): Promise<void> => undefined };
    try {
      // @ts-expect-error o contrato é (db: Db): uma transação já aberta usa vincularEscopo
      abrirTxEscopada(trxAberta, { tenantId: "t", pessoaId: "p" });
      expect.unreachable("deveria lançar");
    } catch (e) {
      expect(e).toBeInstanceOf(ErroDeDominio);
      expect((e as ErroDeDominio).codigo).toBe("estado_invalido");
    }
  });

  it("ErroDeDominio guarda o detalhe em cause, nunca na mensagem", () => {
    const e = new ErroDeDominio("nao_encontrado", { cause: "agente 123 de marlon@acme" });
    expect(e.message).toBe("nao_encontrado");
    expect(e.cause).toBe("agente 123 de marlon@acme");
  });
});

/**
 * NOD-266: db falso em que o teste decide QUANDO a conexão chega (`entregar`) e como o begin assenta. A trx falsa grava
 * cada SQL emitido; o que se prova é a ordem dos fatos, não o Postgres (esse está em tests/concurrency/banco-ocupado.test.ts).
 */
interface Emitido { sql: string; valores: unknown[] }
function trxFalsa(emitidos: Emitido[]): Tx {
  const membros: Record<string, unknown> = {
    unsafe: (texto: string) => { emitidos.push({ sql: texto, valores: [] }); return Promise.resolve([]); },
    savepoint: async (cb: (s: Tx) => Promise<unknown>) => cb(trxFalsa(emitidos)),
  };
  // Alvo chamável (o template `trx\`...\`` é uma chamada): o Proxy grava o SQL e responde os membros que o código usa.
  const alvo: object = () => undefined;
  return new Proxy(alvo as Tx, {
    apply(_alvo, _este, [partes, ...valores]: [TemplateStringsArray, ...unknown[]]) {
      emitidos.push({ sql: partes.join("?"), valores });
      return Promise.resolve([]);
    },
    get(_alvo, prop) {
      return typeof prop === "string" ? membros[prop] : undefined;
    },
  });
}
function dbFalso() {
  const emitidos: Emitido[] = [];
  let entregar: () => Promise<unknown> = async () => undefined;
  let fecharConexao: (e: Error) => void = () => {};
  const begin = (cb: (trx: Tx) => Promise<unknown>) =>
    new Promise<unknown>((resolver, rejeitar) => {
      fecharConexao = rejeitar;
      entregar = () => {
        const p = cb(trxFalsa(emitidos));
        p.then(resolver, rejeitar);
        return p;
      };
    });
  return {
    db: { begin } as Pick<Db, "begin"> as Db,
    emitidos,
    entregar: () => entregar(),
    fecharConexao: (e: Error) => fecharConexao(e),
  };
}
const ESCOPO: Escopo = { tenantId: "t1", pessoaId: "p1" };
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("tx: prazo para pegar conexão (NOD-266)", () => {
  const saida = vi.spyOn(console, "log").mockImplementation(() => {});
  afterEach(() => saida.mockClear());
  const linhas = () => saida.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>);

  it("sem conexão no prazo: lança ErroBancoOcupado com correlation_id e loga banco_ocupado com a espera", async () => {
    const f = dbFalso();
    const fn = vi.fn(async () => "x");
    const erro = await abrirTxEscopada(f.db, ESCOPO, { prazoConexaoMs: 30 })(fn).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroBancoOcupado);
    const e = erro as ErroBancoOcupado;
    expect(e.codigo).toBe("banco_ocupado");
    expect(e.message).toBe("banco_ocupado");
    expect(e.esperaMs).toBeGreaterThanOrEqual(25);
    expect(e.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(linhas()).toEqual([expect.objectContaining({ nivel: "aviso", evento: "banco_ocupado", correlation_id: e.correlationId, tenant_id: "t1", pessoa_id: "p1" })]);
    expect(fn).not.toHaveBeenCalled();
  });

  it("a conexão que chega DEPOIS da desistência não roda vincularEscopo nem fn: o callback lança e o begin faz rollback", async () => {
    const f = dbFalso();
    const fn = vi.fn(async () => "x");
    await expect(abrirTxEscopada(f.db, ESCOPO, { prazoConexaoMs: 20 })(fn)).rejects.toBeInstanceOf(ErroBancoOcupado);
    await expect(f.entregar()).rejects.toBeInstanceOf(ErroBancoOcupado);
    expect(fn).not.toHaveBeenCalled();
    expect(f.emitidos).toEqual([]);
  });

  it("o erro tardio do begin (perdeu para o prazo) não vira unhandled rejection", async () => {
    const soltas: unknown[] = [];
    const ouvir = (r: unknown) => soltas.push(r);
    process.on("unhandledRejection", ouvir);
    try {
      const f = dbFalso();
      await expect(abrirTxEscopada(f.db, ESCOPO, { prazoConexaoMs: 10 })(async () => 1)).rejects.toBeInstanceOf(ErroBancoOcupado);
      f.fecharConexao(new Error("CONNECTION_CLOSED"));
      await f.entregar().catch(() => {});
      await esperar(20);
      expect(soltas).toEqual([]);
    } finally {
      process.off("unhandledRejection", ouvir);
    }
  });

  it("conexão dentro do prazo: escopo e timeouts no MESMO select, fn roda e o timer é limpo", async () => {
    vi.useFakeTimers();
    try {
      const f = dbFalso();
      const p = abrirTxEscopada(f.db, ESCOPO, { prazoConexaoMs: 1_000 })(async () => "ok");
      expect(vi.getTimerCount()).toBe(1);
      await f.entregar();
      await expect(p).resolves.toBe("ok");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("vincularEscopo manda escopo, jit e os três timeouts num select só, com os valores da emenda da ADR-001", async () => {
    const emitidos: Emitido[] = [];
    await vincularEscopo(trxFalsa(emitidos), ESCOPO);
    expect(emitidos).toHaveLength(1);
    const [um] = emitidos;
    expect(um?.sql).toContain("set_config('statement_timeout', ?, true)");
    expect(um?.sql).toContain("set_config('lock_timeout', ?, true)");
    expect(um?.sql).toContain("set_config('idle_in_transaction_session_timeout', ?, true)");
    expect(um?.valores).toEqual(["t1", "p1", "60s", "10s", "60s"]);
    expect(TIMEOUTS_TX).toEqual({ statement: "60s", lock: "10s", idleNaTx: "60s" });
  });

  it("tx acima do limiar loga tx_longa com o correlation_id; abaixo, não", async () => {
    const f = dbFalso();
    const p = abrirTxEscopada(f.db, ESCOPO, { limiarTxLongaMs: 15 })(() => esperar(30));
    await f.entregar();
    await p;
    const rapida = dbFalso();
    const q = abrirTxEscopada(rapida.db, ESCOPO, { limiarTxLongaMs: 1_000 })(async () => undefined);
    await rapida.entregar();
    await q;
    const longas = linhas().filter((l) => l.evento === "tx_longa");
    expect(longas).toEqual([expect.objectContaining({ nivel: "aviso", tenant_id: "t1", pessoa_id: "p1", correlation_id: expect.stringMatching(/^[0-9a-f-]{36}$/) })]);
    expect(Number(longas[0]?.duracao_ms)).toBeGreaterThanOrEqual(15);
  });
});

describe("tx: a trx guardada não fala com o banco depois que a transação assentou (spike NOD-266)", () => {
  it("depois que fn termina, template, unsafe e savepoint lançam tx_encerrada sem emitir SQL", async () => {
    const f = dbFalso();
    const vazada: { trx?: Tx } = {};
    const p = abrirTxEscopada(f.db, ESCOPO)(async (trx) => {
      vazada.trx = trx;
    });
    await f.entregar();
    await p;
    const antes = f.emitidos.length;
    const t = vazada.trx;
    if (!t) throw new Error("fn não rodou");
    expect(() => t`select 1`).toThrow(ErroTxEncerrada);
    expect(() => t.unsafe("select 1")).toThrow(ErroTxEncerrada);
    expect(() => t.savepoint(async () => undefined)).toThrow(ErroTxEncerrada);
    expect(f.emitidos.length).toBe(antes);
  });

  it("a conexão encerrada (begin rejeita) com fn ainda viva: a consulta seguinte de fn lança em vez de rodar sem escopo", async () => {
    const f = dbFalso();
    let liberar: () => void = () => {};
    const segue = new Promise<void>((r) => (liberar = r));
    const resultado: { erro?: unknown } = {};
    const p = abrirTxEscopada(f.db, ESCOPO)(async (trx) => {
      await segue;
      try {
        await trx`select depois_do_kill`;
      } catch (e) {
        resultado.erro = e;
      }
    });
    void f.entregar().catch(() => {});
    await esperar(5);
    f.fecharConexao(Object.assign(new Error("write CONNECTION_CLOSED"), { code: "CONNECTION_CLOSED" }));
    await expect(p).rejects.toMatchObject({ code: "CONNECTION_CLOSED" });
    liberar();
    await esperar(5);
    expect(resultado.erro).toBeInstanceOf(ErroTxEncerrada);
    expect(f.emitidos.map((e) => e.sql).some((s) => s.includes("depois_do_kill"))).toBe(false);
  });

  it.each([
    ["termina", async () => "ok"],
    ["lança", async () => { throw new Error("fn falhou"); }],
  ])("a conexão encerrada com fn viva: quando fn %s depois, o callback do begin não assenta (o begin não manda COMMIT/ROLLBACK)", async (_, fim) => {
    const f = dbFalso();
    let liberar: () => void = () => {};
    const segue = new Promise<void>((r) => (liberar = r));
    const p = abrirTxEscopada(f.db, ESCOPO)(async () => {
      await segue;
      return fim();
    });
    const assentou = vi.fn();
    void f.entregar().then(assentou, assentou);
    await esperar(5);
    f.fecharConexao(Object.assign(new Error("write CONNECTION_CLOSED"), { code: "CONNECTION_CLOSED" }));
    await expect(p).rejects.toMatchObject({ code: "CONNECTION_CLOSED" });
    liberar();
    await esperar(20);
    expect(assentou).not.toHaveBeenCalled();
  });

  it("sem queda, o callback do begin assenta com o valor ou o erro de fn", async () => {
    const ok = dbFalso();
    const p = abrirTxEscopada(ok.db, ESCOPO)(async () => "ok");
    await expect(ok.entregar()).resolves.toBeUndefined();
    await expect(p).resolves.toBe("ok");
    const falha = dbFalso();
    const q = abrirTxEscopada(falha.db, ESCOPO)(async () => { throw new Error("fn falhou"); });
    await expect(falha.entregar()).rejects.toThrow("fn falhou");
    await expect(q).rejects.toThrow("fn falhou");
  });

  it("o savepoint de dentro da tx também recebe uma trx guardada", async () => {
    const f = dbFalso();
    const doSavepoint: { trx?: Tx } = {};
    const p = abrirTxEscopada(f.db, ESCOPO)(async (trx) => {
      await trx.savepoint(async (s) => {
        doSavepoint.trx = s;
        await s`select dentro_do_savepoint`;
      });
    });
    await f.entregar();
    await p;
    expect(f.emitidos.some((e) => e.sql.includes("dentro_do_savepoint"))).toBe(true);
    const s = doSavepoint.trx;
    if (!s) throw new Error("savepoint não rodou");
    expect(() => s`select 1`).toThrow(ErroTxEncerrada);
  });
});

describe("txEscopadaOuDoContexto: reusa a tx viva da mesma pessoa (NOD-266, tx aninhada)", () => {
  it("dentro da tx da mesma pessoa usa a trx do contexto; outra pessoa ou fora de tx abre a própria", async () => {
    const f = dbFalso();
    const outro = dbFalso();
    const p = abrirTxEscopada(f.db, ESCOPO)(async (trx) => {
      // Mesma pessoa: nem toca o pool (o db aqui lança em qualquer acesso) — roda num savepoint da trx de fora.
      const mesma = await txEscopadaOuDoContexto(dbQueNaoPodeSerTocado, ESCOPO)(async (t) => t !== trx && typeof t === "function");
      const q = txEscopadaOuDoContexto(outro.db, { tenantId: "t1", pessoaId: "p2" })(async (t) => t === trx);
      await outro.entregar();
      return { mesma, outraPessoa: await q };
    });
    await f.entregar();
    await expect(p).resolves.toEqual({ mesma: true, outraPessoa: false });
    const fora = dbFalso();
    const r = txEscopadaOuDoContexto(fora.db, ESCOPO)(async () => "propria");
    await fora.entregar();
    await expect(r).resolves.toBe("propria");
  });
});

describe("comPrazoDeConexao: consulta solta no pool com prazo", () => {
  it("estoura → ErroBancoOcupado; dentro do prazo devolve o valor", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(comPrazoDeConexao(new Promise(() => {}), 10)).rejects.toBeInstanceOf(ErroBancoOcupado);
    await expect(comPrazoDeConexao(Promise.resolve(7), 1_000)).resolves.toBe(7);
  });
});
