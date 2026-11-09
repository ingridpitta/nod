import { expect, it } from "vitest";
import { criarRepos } from "../../src/repositories/index.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { withRollback } from "../helpers/with-rollback.ts";
import { expectRejected } from "../helpers/expect-rejected.ts";

const marlon = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const ana = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA };

/**
 * revisto em 2026-09-21 (ADR-041): até aqui este arquivo provava o oposto — "credenciais Composio
 * são privadas por pessoa", a garantia da ADR-033. A chave passou a ser do TENANT para que ninguém
 * precise colá-la de novo para ver o Marketplace; o que continua privado é a SESSÃO (o login
 * OAuth), coberta pelo caso de baixo.
 */
describeIntegracao("a chave Composio é do tenant, a sessão é da pessoa", () => {
  it("quem não cadastrou lê e troca a chave, mas só a chave", async () => {
    await withRollback(marlon, async (tx) => {
      const m = criarRepos(tx, marlon);
      await m.composio.salvarChave("cifrado-apenas-teste");
      expect(await m.composio.chave()).toBe("cifrado-apenas-teste");

      await vincularEscopo(tx, ana);
      const a = criarRepos(tx, ana);
      // Lê: é a policy nod_pessoa_select da 0004 sobre visibility = 'equipe'.
      expect(await a.composio.chave()).toBe("cifrado-apenas-teste");
      // Troca: é a nod_equipe_update da 0017. Sem ela, esta linha afetaria 0 registros.
      await a.composio.salvarChave("cifrado-trocado-pela-ana");
      expect(await a.composio.chave()).toBe("cifrado-trocado-pela-ana");

      // A policy FOR UPDATE não distingue coluna; o trigger nod_composio_pernas_imutaveis distingue.
      await expectRejected(tx, () => tx`update composio_configuracoes set visibility = 'privado'`, "P0001");
      await expectRejected(tx, () => tx`update composio_configuracoes set owner_id = ${ana.pessoaId}`, "P0001");
      // A remoção da chave continua só com a dona: nod_equipe_update é FOR UPDATE e não toca no
      // DELETE, coberto pela nod_pessoa_delete da 0004. Não asseverado aqui porque a regra de lint
      // contra limpeza de tabela em teste de integração casa com o comando — o gate de RLS
      // (tests/conformidade) já prova que a policy de DELETE existe com o comando certo.

      await vincularEscopo(tx, marlon);
      expect(await m.composio.chave()).toBe("cifrado-trocado-pela-ana");
    });
  });

  it("a sessão de login continua privada: ana não vê nem altera a de marlon", async () => {
    await withRollback(marlon, async (tx) => {
      const m = criarRepos(tx, marlon);
      const [conector] = await tx<{ id: string }[]>`
        insert into conectores (tenant_id, owner_id, nome, slug, transporte, url, declaracao)
        values (${marlon.tenantId}, ${marlon.pessoaId}, 'Slack', 'slack', 'http', 'https://exemplo.invalid/mcp', 'toca')
        returning id`;
      await m.composio.salvarSessao({ toolkit: "slack", sessaoId: "sess_1", contaId: "ca_1", conectorId: conector!.id });
      expect((await m.composio.sessao("slack"))?.sessaoId).toBe("sess_1");

      await vincularEscopo(tx, ana);
      expect(await criarRepos(tx, ana).composio.sessao("slack")).toBeNull();
      expect(await tx`select id from composio_sessoes`).toEqual([]);
      expect((await tx`update composio_sessoes set conta_id = 'ca_da_ana'`).count).toBe(0);
    });
  });
});
