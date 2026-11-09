import { expect, it } from "vitest";
import { TRILHA } from "../../src/db/schema/trilha.ts";
import { db } from "../helpers/db.ts";
import { describeIntegracao } from "../helpers/integracao.ts";

/** ADR-004: trigger e CHECK lidos do catálogo, com os nomes declarados em src/db/schema/trilha.ts. */
describeIntegracao("gate: trilha imutável no catálogo", () => {
  it("os dois triggers existem, com a função nod_trilha_imutavel", async () => {
    const linhas = await db<{ tgname: string; proname: string }[]>`
      select t.tgname, p.proname from pg_trigger t join pg_proc p on p.oid = t.tgfoid
      where t.tgrelid = ${TRILHA.tabela}::regclass and not t.tgisinternal order by t.tgname`;
    expect(linhas.map((l) => l.tgname).sort()).toEqual([...TRILHA.triggers].sort());
    for (const l of linhas) expect(l.proname).toBe(TRILHA.funcao);
  });

  it("o CHECK trilha_sem_texto_livre existe com as quatro expressões declaradas", async () => {
    const [c] = await db<{ def: string }[]>`
      select pg_get_constraintdef(oid) as def from pg_constraint
      where conrelid = ${TRILHA.tabela}::regclass and conname = ${TRILHA.check.nome} and contype = 'c'`;
    expect(c).toBeDefined();
    for (const fragmento of TRILHA.check.fragmentos) expect(c?.def).toContain(fragmento);
  });

  it("nod_app não pode alterar, apagar nem esvaziar a trilha; a prosa é apagável por nod_poda", async () => {
    for (const priv of TRILHA.revogados) {
      const [r] = await db`select has_table_privilege('nod_app', ${TRILHA.tabela}, ${priv}) as tem`;
      expect(r?.tem, priv).toBe(false);
    }
    const [poda] = await db`select has_table_privilege('nod_poda', ${TRILHA.prosa}, 'DELETE') as tem`;
    expect(poda?.tem).toBe(true);
    const [podaTrilha] = await db`select has_table_privilege('nod_poda', ${TRILHA.tabela}, 'DELETE') as tem`;
    expect(podaTrilha?.tem).toBe(false);
  });

  it("a coluna hash existe, é nullable e ninguém a preenche", async () => {
    const [col] = await db`select is_nullable from information_schema.columns where table_name = ${TRILHA.tabela} and column_name = 'hash'`;
    expect(col?.is_nullable).toBe("YES");
  });
});
