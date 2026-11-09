import { expect, it } from "vitest";
import { CONTAS } from "../../src/db/schema/contas.ts";
import { db } from "../helpers/db.ts";
import { describeIntegracao } from "../helpers/integracao.ts";

/**
 * NOD-345 (ADR-124 §1), contra o CATÁLOGO: as tabelas globais de conta ficam sem RLS (exceção em gate-rls.ts), então o
 * que as protege é o privilégio exato do nod_app. E o espaço provisório abre UM caminho de escrita em tenants/pessoas: a
 * função do dono. Se alguém "simplificar" com um GRANT, é aqui que aparece.
 */
const DESFAZER: unique symbol = Symbol("desfazer");

describeIntegracao("gate: contas (0109)", () => {
  it("nod_app tem exatamente os privilégios declarados em cada tabela global de conta", async () => {
    for (const [tabela, esperados] of Object.entries(CONTAS.privilegios)) {
      const tem: string[] = [];
      for (const priv of CONTAS.todos) {
        const [r] = await db`select has_table_privilege('nod_app', ${tabela}, ${priv}) as tem`;
        if (r?.tem) tem.push(priv);
      }
      expect(tem.sort(), tabela).toEqual([...esperados].sort());
    }
  });

  it("nod_app só atualiza as colunas declaradas (UPDATE por coluna)", async () => {
    for (const [tabela, colunas] of Object.entries(CONTAS.colunasAtualizaveis)) {
      const linhas = await db<{ coluna: string }[]>`
        select column_name as coluna from information_schema.column_privileges
        where grantee = 'nod_app' and table_name = ${tabela} and privilege_type = 'UPDATE'`;
      expect(linhas.map((l) => l.coluna).sort(), tabela).toEqual([...colunas].sort());
    }
  });

  it("nod_app continua sem escrita em pessoas e tenants", async () => {
    for (const tabela of ["pessoas", "tenants"]) {
      // eslint-disable-next-line no-restricted-syntax -- a palavra é NOME de privilégio consultado, não comando
      for (const priv of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
        const [r] = await db`select has_table_privilege('nod_app', ${tabela}, ${priv}) as tem`;
        expect(r?.tem, `${tabela} ${priv}`).toBe(false);
      }
    }
  });

  it("a função do espaço provisório é do dono, SECURITY DEFINER, com search_path fixo, e só nod_app a executa", async () => {
    const [f] = await db<{ dono: string; definer: boolean; config: string[] | null; acl: string[] | null }[]>`
      select r.rolname as dono, p.prosecdef as definer, p.proconfig as config, p.proacl::text[] as acl
      from pg_proc p join pg_roles r on r.oid = p.proowner where p.oid = ${CONTAS.funcao}::regprocedure`;
    expect(f?.dono).toBe("nod_dono");
    expect(f?.definer).toBe(true);
    expect((f?.config ?? []).some((c) => c.startsWith("search_path=") && c.includes("pg_catalog") && c.endsWith("pg_temp"))).toBe(true);
    expect((f?.acl ?? []).filter((a) => a.startsWith("="))).toEqual([]);
    expect((f?.acl ?? []).map((a) => a.split("=")[0]).sort()).toEqual([...CONTAS.executam]);
    const [poda] = await db`select has_function_privilege('nod_poda', ${CONTAS.funcao}, 'EXECUTE') as tem`;
    expect(poda?.tem).toBe(false);
  });

  it("a função só cria tenant e pessoa sem e-mail, e recusa nome fora da forma", async () => {
    // Como nod_app (o pool de teste), numa transação desfeita: a função é o único caminho de escrita.
    await db.begin(async (tx) => {
      const [ok] = await tx<{ o_tenant_id: string; o_pessoa_id: string }[]>`select * from nod_criar_espaco_provisorio('Você', 'VC')`;
      expect(ok?.o_tenant_id).toBeTruthy();
      const [p] = await tx<{ email: string | null; nome: string }[]>`select email, nome from pessoas where tenant_id = ${ok!.o_tenant_id} and id = ${ok!.o_pessoa_id}`;
      expect(p).toEqual({ email: null, nome: "Você" });
      expect(await tx`select * from nod_criar_espaco_provisorio('', 'VC')`).toHaveLength(0);
      expect(await tx`select * from nod_criar_espaco_provisorio(${"x".repeat(81)}, 'VC')`).toHaveLength(0);
      expect(await tx`select * from nod_criar_espaco_provisorio('Ana', 'ABCD')`).toHaveLength(0);
      throw DESFAZER;
    }).catch((e: unknown) => { if (e !== DESFAZER) throw e; });
  });
});
