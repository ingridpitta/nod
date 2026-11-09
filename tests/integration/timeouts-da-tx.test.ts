import { afterAll, expect, it } from "vitest";
import { criarDb } from "../../src/db/client.ts";
import { abrirTxEscopada, TIMEOUTS_TX, txEscopadaOuDoContexto } from "../../src/db/tx.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";

/**
 * NOD-266 (emenda de 2026-10-15 da ADR-001): a tx escopada leva statement_timeout, lock_timeout e
 * idle_in_transaction_session_timeout por SET LOCAL. O Postgres aplica de verdade (critério 3) e os valores morrem com a
 * transação — a conexão que volta ao pool fica com o padrão da sessão, como o escopo e o jit (jit-local.test.ts).
 * Valores reduzidos por opção: o testTimeout é 20 s.
 */
const ESCOPO = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const url = process.env.DATABASE_URL_TEST ?? "postgres://sem-banco";
// Uma conexão: a consulta seguinte cai, com certeza, na mesma conexão em que a transação rodou.
const umaConexao = criarDb(url, { max: 1 });
const duasConexoes = criarDb(url, { max: 2 });

afterAll(async () => {
  await umaConexao.end({ timeout: 1 });
  await duasConexoes.end({ timeout: 1 });
});

const codigoDe = (e: unknown): unknown => (typeof e === "object" && e !== null ? (e as { code?: unknown }).code : undefined);

describeIntegracao("timeouts da tx escopada (NOD-266)", () => {
  it("revisão do PR #321: o erro de quem reusa a tx do contexto não envenena a tx de fora (savepoint)", async () => {
    const resultado = await abrirTxEscopada(umaConexao, ESCOPO)(async (trx) => {
      const erro = await txEscopadaOuDoContexto(umaConexao, ESCOPO)((t) => t`select 1/0`).catch((e: unknown) => e);
      // Sem o savepoint, a transação de fora estaria abortada (25P02) e esta consulta falharia.
      const [r] = await trx<{ t: string }[]>`select current_setting('nod.tenant_id') as t`;
      return { codigo: codigoDe(erro), tenant: r?.t };
    });
    expect(resultado).toEqual({ codigo: "22012", tenant: ESCOPO.tenantId });
  });

  it("critério 3: consulta acima do statement_timeout é cancelada pelo Postgres (57014)", async () => {
    const inicio = Date.now();
    const erro = await abrirTxEscopada(umaConexao, ESCOPO, { timeouts: { statement: "200ms" } })((trx) => trx`select pg_sleep(5)`).catch((e: unknown) => e);
    expect(codigoDe(erro)).toBe("57014");
    expect(Date.now() - inicio).toBeLessThan(3_000);
    // A conexão voltou ao pool e serve a próxima.
    expect((await umaConexao`select 1 as um`)[0]?.um).toBe(1);
  });

  it("esperar uma trava além do lock_timeout falha (55P03) em vez de segurar a conexão", async () => {
    const chave = 266_001;
    let soltar: () => void = () => {};
    const segurando = new Promise<void>((r) => (soltar = r));
    let travou: () => void = () => {};
    const travada = new Promise<void>((r) => (travou = r));
    const dona = abrirTxEscopada(duasConexoes, ESCOPO)(async (trx) => {
      await trx`select pg_advisory_xact_lock(${chave})`;
      travou();
      await segurando;
    });
    await travada;
    try {
      const erro = await abrirTxEscopada(duasConexoes, ESCOPO, { timeouts: { lock: "200ms" } })((trx) => trx`select pg_advisory_xact_lock(${chave})`).catch((e: unknown) => e);
      expect(codigoDe(erro)).toBe("55P03");
    } finally {
      soltar();
      await dona;
    }
  });

  it("os três valores valem só dentro da transação; a mesma conexão, fora dela, volta ao padrão da sessão", async () => {
    const sessao = (await umaConexao`select current_setting('statement_timeout') as s, current_setting('lock_timeout') as l, current_setting('idle_in_transaction_session_timeout') as i`)[0];
    const dentro = await abrirTxEscopada(umaConexao, ESCOPO)(async (trx) => (await trx`select current_setting('statement_timeout') as s, current_setting('lock_timeout') as l, current_setting('idle_in_transaction_session_timeout') as i`)[0]);
    const depois = (await umaConexao`select current_setting('statement_timeout') as s, current_setting('lock_timeout') as l, current_setting('idle_in_transaction_session_timeout') as i`)[0];
    expect(dentro).toEqual({ s: "1min", l: "10s", i: "1min" });
    expect(TIMEOUTS_TX).toEqual({ statement: "60s", lock: "10s", idleNaTx: "60s" });
    expect(depois).toEqual(sessao);
  });
});
