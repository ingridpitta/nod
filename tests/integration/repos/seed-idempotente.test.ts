import { expect, it } from "vitest";
import { AGENTE_TUCA, AGENTE_VERA, EMAIL_ANA, EMAIL_MARLON, SALA_GERAL, semearCom } from "../../../src/db/seed/index.ts";
import { vincularEscopo } from "../../../src/db/tx.ts";
import { criarRepos } from "../../../src/repositories/index.ts";
import type { Transacao } from "../../../src/shared/types.ts";
import { withRollbackDono } from "../../helpers/db-dono.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "../../helpers/ids.ts";
import { describeIntegracao } from "../../helpers/integracao.ts";
import { withRollback } from "../../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const ANA = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA };

/**
 * O seed roda sob DOIS envelopes de rollback (identidade como nod_dono, exemplos como nod_app):
 * nada fica no banco de teste — o CI nunca semeia (Práticas §6) e este teste tampouco.
 */
describeIntegracao("seed idempotente por id determinístico (Práticas §12)", () => {
  it("a primeira passagem cria; a segunda devolve zero mudanças e o estado é o mesmo; Ana vê a sala geral e não vê a Vera", async () => {
    await withRollbackDono(async (trxDono) => {
      await withRollback(MARLON, async (trxApp) => {
        const txPorPessoa = (pessoaId: string): Transacao => async (fn) => {
          await vincularEscopo(trxApp, { tenantId: TENANT_PADRAO, pessoaId });
          return fn(trxApp);
        };
        const deps = { dono: trxDono, txPorPessoa };

        const primeira = await semearCom(deps);
        expect(primeira.mudancas).toBeGreaterThan(0);
        const antes = await trxDono`select id, nome, email from pessoas where tenant_id = ${TENANT_PADRAO} order by nome`;
        // As duas do seed levam o e-mail da allowlist (ADR-030); o e2e pode ter deixado outras pessoas no tenant.
        expect(antes.filter((p) => p.id === PESSOA_MARLON || p.id === PESSOA_ANA)).toEqual([
          { id: PESSOA_ANA, nome: "Ana", email: EMAIL_ANA },
          { id: PESSOA_MARLON, nome: "Marlon", email: EMAIL_MARLON },
        ]);

        const segunda = await semearCom(deps);
        expect(segunda.mudancas).toBe(0);
        expect(await trxDono`select id, nome, email from pessoas where tenant_id = ${TENANT_PADRAO} order by nome`).toEqual(antes);

        await vincularEscopo(trxApp, MARLON);
        const marlon = criarRepos(trxApp, MARLON);
        expect(await marlon.agentes.buscar(AGENTE_VERA)).toMatchObject({ nome: "Vera", ownerId: PESSOA_MARLON, confirmado: true });
        expect(await marlon.agentes.buscar(AGENTE_TUCA)).toBeNull();
        expect((await marlon.conversas.buscarPropriaDoAgente(AGENTE_VERA))?.agenteId).toBe(AGENTE_VERA);
        expect((await marlon.salas.membros(SALA_GERAL)).map((m) => m.agenteId).sort()).toEqual([AGENTE_TUCA, AGENTE_VERA].sort());

        await vincularEscopo(trxApp, ANA);
        const ana = criarRepos(trxApp, ANA);
        expect(await ana.agentes.buscar(AGENTE_TUCA)).toMatchObject({ nome: "Tuca", ownerId: PESSOA_ANA });
        expect(await ana.agentes.buscar(AGENTE_VERA)).toBeNull();
        expect(await ana.salas.buscar(SALA_GERAL)).toMatchObject({ nome: "geral", leadAgenteId: AGENTE_VERA });
        expect((await ana.salas.membros(SALA_GERAL)).map((m) => m.agenteId)).toEqual([AGENTE_TUCA]);
      });
    });
  });
});
