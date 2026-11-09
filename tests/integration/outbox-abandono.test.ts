import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { outboxRepo } from "../../src/repositories/outbox.repo.ts";
import { OUTBOX_IDADE_MIN_MS, OUTBOX_TETO_TENTATIVAS } from "../../src/shared/constantes.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const AGORA = Date.UTC(2026, 8, 16, 12, 0, 0);

async function pendente(trx: Parameters<Parameters<typeof withRollback>[1]>[0], tentativas: number, idadeMs: number): Promise<string> {
  const id = randomUUID();
  await trx`insert into events_outbox (id, owner_id, evento_id, tipo, tentativas, criado_em)
    values (${id}, ${PESSOA_MARLON}, ${randomUUID()}, 'mensagem_criada', ${tentativas}, ${new Date(AGORA - idadeMs)})`;
  return id;
}

describeIntegracao("outbox: abandono exige DUAS condições (ADR-010 refinado)", () => {
  it("só tentativas → não; só idade → não; ambas → abandona e conta", async () => {
    await withRollback(MARLON, async (trx) => {
      const repo = outboxRepo(trx, MARLON);
      const soTentativas = await pendente(trx, OUTBOX_TETO_TENTATIVAS + 1, 1_000);
      const soIdade = await pendente(trx, 0, OUTBOX_IDADE_MIN_MS * 2);
      const ambas = await pendente(trx, OUTBOX_TETO_TENTATIVAS, OUTBOX_IDADE_MIN_MS * 2);

      const n = await repo.abandonar({ teto: OUTBOX_TETO_TENTATIVAS, idadeMinMs: OUTBOX_IDADE_MIN_MS, agora: AGORA });
      expect(n).toBe(1);
      expect(await repo.contarAbandonados()).toBe(1);

      const pendentes = await repo.pendentes();
      expect(pendentes.map((p) => p.id).sort()).toEqual([soTentativas, soIdade].sort());
      // Abandonado é contado, não apagado.
      expect(await trx`select abandonado_em from events_outbox where id = ${ambas}`).toEqual([{ abandonado_em: new Date(AGORA) }]);
    });
  });

  it("marcarEntregue, incrementarTentativa e cancelarPendentesDaPessoa", async () => {
    await withRollback(MARLON, async (trx) => {
      const repo = outboxRepo(trx, MARLON);
      const a = await pendente(trx, 0, 0);
      const b = await pendente(trx, 0, 0);
      expect(await repo.incrementarTentativa(a)).toBe(1);
      expect(await repo.marcarEntregue(a)).toBe(true);
      expect(await repo.marcarEntregue(a)).toBe(false);
      expect(await repo.cancelarPendentesDaPessoa(AGORA)).toBe(1);
      expect(await repo.pendentes()).toHaveLength(0);
      expect(await trx`select cancelado_em is not null as c from events_outbox where id = ${b}`).toEqual([{ c: true }]);
    });
  });
});
