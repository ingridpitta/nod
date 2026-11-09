import { afterAll, expect, it } from "vitest";
import { criarDb } from "../../src/db/client.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { db } from "../helpers/db.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * vincularEscopo (src/db/tx.ts) desliga o JIT junto com o escopo, e só dentro da transação: é um SET LOCAL, como o
 * tenant e a pessoa. A conexão que volta ao pool fica com o valor da sessão — a próxima transação, de quem quer que
 * seja, não herda nada (a mesma garantia que o pooler em modo transação exige do escopo).
 */
const ESCOPO = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };

// Pool de UMA conexão: a consulta seguinte cai, com certeza, na mesma conexão em que a transação rodou.
const umaConexao = criarDb(process.env.DATABASE_URL_TEST ?? "postgres://sem-banco", { max: 1 });

afterAll(async () => {
  await umaConexao.end({ timeout: 1 });
});

describeIntegracao("jit desligado só dentro da transação escopada", () => {
  it("withRollback + vincularEscopo: jit = 'off' com tenant e pessoa; as conexões do pool seguem com o padrão", async () => {
    const padrao = (await db`select current_setting('jit') as jit`)[0]?.jit as string;
    const dentro = await withRollback(ESCOPO, async (trx) => (await trx`select current_setting('jit') as jit, current_setting('nod.tenant_id') as t, current_setting('nod.pessoa_id') as p`)[0]);
    expect(dentro).toEqual({ jit: "off", t: TENANT_PADRAO, p: PESSOA_MARLON });
    // Esgota o pool inteiro (max 4) para reencontrar a conexão usada acima, como o spike (b) faz com o escopo.
    const depois = await Promise.all(Array.from({ length: 8 }, () => db.begin(async (trx) => (await trx`select current_setting('jit') as jit`)[0]?.jit as string)));
    expect(depois).toEqual(Array.from({ length: 8 }, () => padrao));
  });

  it("a mesma conexão, fora da transação, volta ao valor da sessão", async () => {
    // Liga o jit na SESSÃO desta conexão única: o que se prova é que o SET LOCAL da transação não sobrevive a ela,
    // qualquer que seja o padrão do servidor.
    await umaConexao`set jit = on`;
    const dentro = await umaConexao.begin(async (trx) => {
      await vincularEscopo(trx, ESCOPO);
      return (await trx`select current_setting('jit') as jit`)[0]?.jit as string;
    });
    const depois = (await umaConexao`select current_setting('jit') as jit`)[0]?.jit as string;
    expect(dentro).toBe("off");
    expect(depois).toBe("on");
  });
});
