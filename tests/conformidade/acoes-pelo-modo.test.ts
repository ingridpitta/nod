import { expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import { db } from "../helpers/db.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * 0093 (ADR-115): `acoes_pelo_modo` guarda texto livre (o resumo redigido da ação e o motivo do revisor), por isso é
 * apagável por nod_poda e privada da dona; a ordem dos enums novos (estado_decisao, motivo_aprovacao_manual) é conferida
 * pelo gate motivos-enum, e o rollback pelo rollback-ida-e-volta.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const ANA = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA };

describeIntegracao("gate: acoes_pelo_modo (0093)", () => {
  it("nod_poda lê e apaga; não insere nem altera", async () => {
    for (const [priv, esperado] of [["SELECT", true], ["DELETE", true], ["INSERT", false], ["UPDATE", false]] as const) {
      const [r] = await db`select has_table_privilege('nod_poda', 'acoes_pelo_modo', ${priv}) as tem`;
      expect(r?.tem, priv).toBe(esperado);
    }
  });

  it("os enums ganharam os valores novos no fim, e o índice parcial não cita 'em_revisao' (valor novo nunca usado na mesma transação)", async () => {
    const [e] = await db<{ ultimo: string }[]>`select e.enumlabel as ultimo from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'estado_decisao' order by e.enumsortorder desc limit 1`;
    expect(e?.ultimo).toBe("em_revisao");
    const indices = await db<{ def: string }[]>`select pg_get_indexdef(indexrelid) as def from pg_index where indrelid = 'acoes_pelo_modo'::regclass`;
    expect(indices.map((i) => i.def).join("\n")).not.toContain("em_revisao");
    expect(indices.length).toBeGreaterThanOrEqual(5);
  });

  it("a RLS: a dona vê a linha dela; outra pessoa do mesmo tenant não vê nem apaga", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 60_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
      const id = await repos.acoesPeloModo.registrar({ agenteId, conversaId, turnoId: turno!.id, decisaoId: null, modo: "automatico", tipo: "comando", resumo: "git push --force", gatilho: "arriscado", risco: "push forçado", revisorModelo: "claude-haiku-4-5-20251001", revisorHarness: "servidor" });
      expect((await repos.acoesPeloModo.doTurno(turno!.id)).map((a) => a.id)).toEqual([id]);
      await vincularEscopo(trx, ANA);
      const daAna = criarRepos(trx, ANA);
      expect(await daAna.acoesPeloModo.doTurno(turno!.id)).toEqual([]);
      expect(await daAna.acoesPeloModo.podar(Date.now() + 60_000)).toBe(0);
      await vincularEscopo(trx, MARLON);
      expect(await repos.acoesPeloModo.podar(Date.now() + 60_000)).toBe(1);
    });
  });
});
