import { expect, it } from "vitest";
import { db } from "../helpers/db.ts";
import { describeIntegracao } from "../helpers/integracao.ts";

/**
 * definido em 2026-10-30 (NOD-20, critério 4): as versões do perfil só acrescentam. Lido do catálogo: nod_app tem SELECT
 * e INSERT e nada de UPDATE, DELETE nem TRUNCATE; a tabela está sob RLS forçada; a poda é a função SECURITY DEFINER.
 */
const TABELA = "agente_perfil_versoes";

describeIntegracao("gate: versões do perfil só acrescentam (NOD-20)", () => {
  it("nod_app lê e insere, mas não altera, apaga nem esvazia", async () => {
    // eslint-disable-next-line no-restricted-syntax -- "DELETE"/"TRUNCATE" aqui são o nome do privilégio lido no catálogo, não uma limpeza
    for (const [priv, esperado] of [["SELECT", true], ["INSERT", true], ["UPDATE", false], ["DELETE", false], ["TRUNCATE", false]] as const) {
      const [r] = await db<{ tem: boolean }[]>`select has_table_privilege('nod_app', ${TABELA}, ${priv}) as tem`;
      expect(r?.tem, priv).toBe(esperado);
    }
  });

  it("RLS ligada e forçada; a poda é SECURITY DEFINER com search_path fixo", async () => {
    const [t] = await db<{ rls: boolean; forcada: boolean }[]>`select relrowsecurity as rls, relforcerowsecurity as forcada from pg_class where oid = ${TABELA}::regclass`;
    expect(t).toEqual({ rls: true, forcada: true });
    const [f] = await db<{ definer: boolean; config: string[] | null }[]>`select prosecdef as definer, proconfig as config from pg_proc where proname = 'nod_podar_versoes_perfil'`;
    expect(f?.definer).toBe(true);
    expect((f?.config ?? []).some((c) => c.startsWith("search_path="))).toBe(true);
  });
});
