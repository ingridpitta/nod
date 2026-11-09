import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import { db } from "../helpers/db.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * 0106 (NOD-96, ADR-122): o computador da pessoa, as telas dos bots e as ações delas ficam privados da dona. Outra
 * pessoa do mesmo tenant e a mesma pessoa noutro tenant não veem, não mudam e não abrem tela nele. A ordem dos enums
 * novos é do gate motivos-enum; o rollback, do rollback-ida-e-volta.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const ANA = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA };
const OUTRO_TENANT = { tenantId: randomUUID(), pessoaId: PESSOA_MARLON };

describeIntegracao("gate: computador da pessoa (0106)", () => {
  it("computador_telas tem RLS forçada e só é privada; agentes.computador_id deixou de ser único", async () => {
    const [t] = await db<{ rls: boolean; forcada: boolean }[]>`select relrowsecurity as rls, relforcerowsecurity as forcada from pg_class where oid = 'computador_telas'::regclass`;
    expect(t).toEqual({ rls: true, forcada: true });
    const unicos = await db<{ conname: string }[]>`select conname from pg_constraint where conrelid = 'agentes'::regclass and contype = 'u' and conname like '%computador%'`;
    expect(unicos).toEqual([]);
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId } = await agenteComConversa(trx, MARLON);
      const c = await repos.computadores.obterDaPessoa();
      await expect(trx`insert into computador_telas (tenant_id, owner_id, computador_id, agente_id, visibility)
        values (${MARLON.tenantId}, ${MARLON.pessoaId}, ${c.id}, ${agenteId}, 'equipe')`).rejects.toThrow(/check/i);
    });
  });

  it("outra pessoa do tenant não vê, não muda e não abre tela no computador da dona", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId } = await agenteComConversa(trx, MARLON);
      const c = await repos.computadores.obterDaPessoa();
      expect(await repos.computadores.vincularBot(c.id, agenteId)).toBe(true);
      const tela = (await repos.computadorTelas.obter(c.id, agenteId))!;
      const registro = await repos.computadores.registrar({ computadorId: c.id, autor: "bot", tipo: "navegar", estado: "concluida", agenteId, telaId: tela.id });

      await vincularEscopo(trx, ANA);
      const daAna = criarRepos(trx, ANA);
      expect(await daAna.computadores.travarDaPessoa(c.id)).toBeNull();
      expect(await daAna.computadorTelas.travar(tela.id)).toBeNull();
      expect(await daAna.computadorTelas.doComputador(c.id)).toEqual([]);
      expect(await daAna.computadorTelas.obter(c.id, agenteId)).toBeNull();
      expect(await daAna.computadorTelas.mudarEstado(tela.id, "aberta", Date.now())).toBe(false);
      expect(await daAna.computadores.fixarSupervisor(c.id, new Uint8Array(32).fill(7))).toBeNull();
      expect(await daAna.computadores.iniciarOperacao(c.id, "redefinir", Date.now())).toBe(false);
      expect(await daAna.computadores.vincularBot(c.id, agenteId)).toBe(false);
      expect(await daAna.computadores.atividadeDoBot(c.id, agenteId)).toEqual([]);
      expect(await daAna.computadores.buscarAcao(registro.id)).toBeNull();
      // Sem política que deixe: a contagem crua também é zero.
      const [n] = await trx<{ telas: number; computadores: number }[]>`select (select count(*)::int from computador_telas) as telas,
        (select count(*)::int from computadores where id = ${c.id}) as computadores`;
      expect(n).toEqual({ telas: 0, computadores: 0 });
      // E não escreve com a dona errada (WITH CHECK).
      await expect(trx`insert into computador_telas (tenant_id, owner_id, computador_id, agente_id)
        values (${ANA.tenantId}, ${MARLON.pessoaId}, ${c.id}, ${agenteId})`).rejects.toThrow(/row-level security/);
    });
  });

  it("a mesma pessoa noutro tenant não vê o computador, as telas nem as ações", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId } = await agenteComConversa(trx, MARLON);
      const c = await repos.computadores.obterDaPessoa();
      const tela = (await repos.computadorTelas.obter(c.id, agenteId))!;
      await repos.computadores.registrar({ computadorId: c.id, autor: "pessoa", tipo: "navegar", estado: "concluida", telaId: tela.id });

      await vincularEscopo(trx, OUTRO_TENANT);
      const fora = criarRepos(trx, OUTRO_TENANT);
      expect(await fora.computadores.daPessoa()).toBeNull();
      expect(await fora.computadores.travarDaPessoa(c.id)).toBeNull();
      expect(await fora.computadorTelas.buscar(c.id, agenteId)).toBeNull();
      const [n] = await trx<{ telas: number; acoes: number }[]>`select (select count(*)::int from computador_telas) as telas,
        (select count(*)::int from computador_acoes where computador_id = ${c.id}) as acoes`;
      expect(n).toEqual({ telas: 0, acoes: 0 });
    });
  });
});
