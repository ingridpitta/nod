import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { expectRejected } from "../helpers/expect-rejected.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * ADR-004: 'o trigger recusou E a linha original continua lá' — só possível com SAVEPOINT
 * (expectRejected). Para nod_app a recusa vem antes, pelo REVOKE (42501); o trigger é a segunda
 * camada, que vale inclusive para o dono.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };

async function inserirLinha(trx: Parameters<Parameters<typeof withRollback>[1]>[0]): Promise<string> {
  const id = randomUUID();
  await trx`insert into trilha (id, owner_id, agente_id, ferramenta, kind, regra, regra_versao)
    values (${id}, ${PESSOA_MARLON}, ${randomUUID()}, 'lembrar', 'tool_call', 'regra:montagem_ferramentas', 1)`;
  return id;
}

describeIntegracao("trilha imutável", () => {
  it("alterar, apagar e esvaziar são recusados e a linha continua intacta", async () => {
    await withRollback(MARLON, async (trx) => {
      const id = await inserirLinha(trx);

      await expectRejected(trx, () => trx`update trilha set kind = 'outro' where id = ${id}`, /42501|P0001/);
      // eslint-disable-next-line no-restricted-syntax -- a prova É que apagar a trilha é recusado (ADR-004)
      await expectRejected(trx, () => trx`delete from trilha where id = ${id}`, /42501|P0001/);
      // eslint-disable-next-line no-restricted-syntax -- idem: TRUNCATE recusado por REVOKE + trigger
      await expectRejected(trx, () => trx`truncate trilha`, /42501|P0001/);

      const depois = await trx`select id, kind from trilha where id = ${id}`;
      expect(depois).toEqual([{ id, kind: "tool_call" }]);
    });
  });

  it("CHECK trilha_sem_texto_livre recusa prosa nos campos tipados", async () => {
    await withRollback(MARLON, async (trx) => {
      const erro = await expectRejected(
        trx,
        () => trx`insert into trilha (owner_id, agente_id, ferramenta, kind, regra, regra_versao)
          values (${PESSOA_MARLON}, ${randomUUID()}, 'lembrar', 'texto livre!', 'regra:x', 1)`,
        "23514",
      );
      expect(erro.message).toContain("trilha_sem_texto_livre");
      await expectRejected(
        trx,
        () => trx`insert into trilha (owner_id, agente_id, ferramenta, kind, motivo, regra, regra_versao)
          values (${PESSOA_MARLON}, ${randomUUID()}, 'lembrar', 'negacao', 'Motivo Com Prosa', 'regra:x', 1)`,
        "23514",
      );
    });
  });

  it("a prosa mora na tabela irmã e some sem tocar a trilha", async () => {
    await withRollback(MARLON, async (trx) => {
      const id = await inserirLinha(trx);
      await trx`insert into trilha_prosa (owner_id, trilha_id, texto) values (${PESSOA_MARLON}, ${id}, 'o agente escreveu isto')`;
      // eslint-disable-next-line no-restricted-syntax -- apagar a PROSA é o desenho (ADR-004: prosa apagável)
      await trx`delete from trilha_prosa where trilha_id = ${id}`;
      expect(await trx`select id from trilha where id = ${id}`).toHaveLength(1);
      expect(await trx`select id from trilha_prosa where trilha_id = ${id}`).toHaveLength(0);
    });
  });
});
