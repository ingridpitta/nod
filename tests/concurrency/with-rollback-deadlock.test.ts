import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { criarRepos } from "../../src/repositories/index.ts";
import { db } from "../helpers/db.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * ADA-289 (PR #723, pendência 2): o deadlock intermitente da suíte completa (modo-dev 0036, ADA-232 "PR mergeado acorda",
 * comentários NOD-417, esperas de colega; também na main). Dois testes da MESMA pessoa, em arquivos paralelos, cada um
 * numa transação longa, com as travas em ordem trocada: um grava as preferências (linha) e depois reivindica (trava
 * consultiva tenant:pessoa); o outro reivindica e depois grava. Reproduzido aqui com duas conexões: o Postgres derruba
 * uma com 40P01 ("deadlock detected"). Em produção cada passo é uma transação curta, então a ordem não se cruza; nos
 * testes o withRollback repete o corpo da vítima (a transação dela já foi desfeita inteira).
 */
const PESSOA = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };

async function esperarAlguemTravado(): Promise<void> {
  for (;;) {
    const [l] = await db<{ n: number }[]>`select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database()`;
    if ((l?.n ?? 0) > 0) return;
    await new Promise((r) => setImmediate(r));
  }
}

function portao(): { abrir: () => void; aberto: Promise<void> } {
  let abrir = () => undefined as void;
  const aberto = new Promise<void>((r) => { abrir = r; });
  return { abrir, aberto };
}

describeIntegracao("concorrência: deadlock entre dois testes da mesma pessoa (ADA-289)", () => {
  it("gravar → reivindicar × reivindicar → gravar: o Postgres escolhe uma vítima, o withRollback a repete e os dois terminam", async () => {
    const gravou = portao();
    let tentativasA = 0;
    let tentativasB = 0;
    const a = withRollback(PESSOA, async (trx) => {
      tentativasA++;
      const repos = criarRepos(trx, PESSOA);
      await repos.preferencias.gravar({ modoDev: true });
      gravou.abrir();
      // Só na 1ª vez espera o outro chegar na trava: na repetição o outro já foi desfeito ou terminou.
      if (tentativasA === 1) await esperarAlguemTravado();
      await repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() });
      return "a";
    });
    await gravou.aberto;
    const b = withRollback(PESSOA, async (trx) => {
      tentativasB++;
      const repos = criarRepos(trx, PESSOA);
      await repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() });
      await repos.preferencias.gravar({ modoDev: false });
      return "b";
    });
    const [ra, rb] = await Promise.allSettled([a, b]);
    expect(ra.status, ra.status === "rejected" ? String(ra.reason) : "").toBe("fulfilled");
    expect(rb.status, rb.status === "rejected" ? String(rb.reason) : "").toBe("fulfilled");
    // Houve deadlock de verdade: uma das duas rodou o corpo mais de uma vez.
    expect(tentativasA + tentativasB).toBeGreaterThan(2);
  }, 20_000);
});
