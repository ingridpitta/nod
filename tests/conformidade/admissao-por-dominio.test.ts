import { expect, it } from "vitest";
import { ADMISSAO } from "../../src/db/schema/admissao.ts";
import { db } from "../helpers/db.ts";
import { describeIntegracao } from "../helpers/integracao.ts";

/**
 * Emenda de 2026-10-05 da ADR-030, contra o CATÁLOGO: a admissão por domínio abriu UM caminho de escrita em
 * `pessoas` (a função do dono) e nenhum outro. Se alguém "simplificar" com um GRANT, é aqui que aparece.
 */
describeIntegracao("gate: admissão por domínio só pela função do dono", () => {
  it("nod_app continua só lendo pessoas e tenants", async () => {
    for (const tabela of ADMISSAO.identidade) {
      const [leitura] = await db`select has_table_privilege('nod_app', ${tabela}, 'SELECT') as tem`;
      expect(leitura?.tem, tabela).toBe(true);
      for (const priv of ADMISSAO.escritas) {
        const [r] = await db`select has_table_privilege('nod_app', ${tabela}, ${priv}) as tem`;
        expect(r?.tem, `${tabela} ${priv}`).toBe(false);
      }
    }
  });

  it("nod_app não tem privilégio nenhum em dominios_admitidos, nem por PUBLIC", async () => {
    for (const priv of ADMISSAO.todos) {
      const [r] = await db`select has_table_privilege('nod_app', ${ADMISSAO.tabela}, ${priv}) as tem`;
      expect(r?.tem, priv).toBe(false);
    }
  });

  it("a função é do dono, SECURITY DEFINER, com search_path fixo, e só nod_app (além do dono) a executa", async () => {
    const [f] = await db<{ dono: string; definer: boolean; config: string[] | null; acl: string[] | null }[]>`
      select r.rolname as dono, p.prosecdef as definer, p.proconfig as config, p.proacl::text[] as acl
      from pg_proc p join pg_roles r on r.oid = p.proowner where p.oid = ${ADMISSAO.funcao}::regprocedure`;
    expect(f?.dono).toBe("nod_dono");
    expect(f?.definer).toBe(true);
    // Sem search_path fixo, quem chama uma função SECURITY DEFINER escolhe de onde vêm os nomes.
    expect((f?.config ?? []).some((c) => c.startsWith("search_path=") && c.includes("pg_catalog") && c.endsWith("pg_temp"))).toBe(true);
    // Uma entrada de ACL que começa com "=" é PUBLIC: não pode existir.
    expect((f?.acl ?? []).filter((a) => a.startsWith("="))).toEqual([]);
    expect((f?.acl ?? []).map((a) => a.split("=")[0]).sort()).toEqual([...ADMISSAO.executam]);
    const [app] = await db`select has_function_privilege('nod_app', ${ADMISSAO.funcao}, 'EXECUTE') as tem`;
    expect(app?.tem).toBe(true);
    const [poda] = await db`select has_function_privilege('nod_poda', ${ADMISSAO.funcao}, 'EXECUTE') as tem`;
    expect(poda?.tem).toBe(false);
  });
});
