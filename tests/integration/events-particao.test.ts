import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { MESES_A_FRENTE, mesesAPartirDe } from "../../src/adapters/fundo/particoes.ts";
import type { Autoria } from "../../src/contracts/evento.ts";
import { eventsRepo } from "../../src/repositories/events.repo.ts";
import { expectRejected } from "../helpers/expect-rejected.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };

// Tipada pelo contrato: locality_reason é MotivoLocalidade (coluna enum desde a 0003).
const autoria: Autoria = {
  autor_tipo: "pessoa",
  autor_id: PESSOA_MARLON,
  sob_procuracao_de: null,
  conta_de_execucao: PESSOA_MARLON,
  executor: "catcher",
  locality: "local",
  locality_reason: "tudo_local_nesta_rodada",
  machine_id: null,
  decidido_por: "regra:localidade",
  regra_versao: 1,
};

describeIntegracao("events particionada sem catch-all (ADR-006)", () => {
  it("INSERT dentro da faixa entra; no primeiro mês depois da janela falha alto (sem partição DEFAULT)", async () => {
    // definido em 2026-10-01: o mês fixo (2027-10) venceria em 2026-11-01, quando o boot de um servidor de teste o cria.
    const fora = mesesAPartirDe(Date.now(), MESES_A_FRENTE + 1).at(-1)!;
    await withRollback(MARLON, async (trx) => {
      const repo = eventsRepo(trx, MARLON);
      const { ids } = await repo.gravarComOutbox([
        { kind: "mensagem_criada", createdAt: Date.UTC(2026, 8, 16), autoria, pessoaDestinoId: PESSOA_MARLON, dados: { n: 1 } },
      ]);
      expect(ids).toHaveLength(1);

      const erro = await expectRejected(
        trx,
        () => repo.gravarComOutbox([{ kind: "mensagem_criada", createdAt: Date.UTC(fora.ano, fora.mes - 1, 1), autoria, pessoaDestinoId: PESSOA_MARLON }]),
        "23514",
      );
      expect(erro.message).toContain("no partition of relation");
    });
  });

  it("gravarComOutbox grava evento e outbox na MESMA transação", async () => {
    await withRollback(MARLON, async (trx) => {
      const conversaId = randomUUID();
      const { ids } = await eventsRepo(trx, MARLON).gravarComOutbox([
        { kind: "turno_criado", autoria, pessoaDestinoId: PESSOA_MARLON, conversaId },
      ]);
      const ev = await trx`select kind, conversa_id from events where id = ${ids[0] ?? ""}`;
      expect(ev).toEqual([{ kind: "turno_criado", conversa_id: conversaId }]);
      const ob = await trx`select tipo, tentativas, entregue_em from events_outbox where evento_id = ${ids[0] ?? ""}`;
      expect(ob).toEqual([{ tipo: "turno_criado", tentativas: 0, entregue_em: null }]);
    });
  });
});
