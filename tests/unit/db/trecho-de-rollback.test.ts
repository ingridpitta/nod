import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { trechoAplicavel, trechoDeRollback } from "../../../src/db/migrar.ts";

describe("trechoDeRollback (NOD-195)", () => {
  it("sem marcador devolve null", () => {
    expect(trechoDeRollback("CREATE TABLE a (id int);\n")).toBeNull();
    // Menção ao marcador no meio da linha não é marcador (mesma regra do trechoAplicavel).
    expect(trechoDeRollback("CREATE TABLE a (id int); -- ROLLBACK: drop\n")).toBeNull();
  });

  it("bloco vazio: marcador no fim do arquivo ou só linhas em branco e `--`", () => {
    expect(trechoDeRollback("CREATE TABLE a (id int);\n-- ROLLBACK:")).toBe("");
    expect(trechoDeRollback("CREATE TABLE a (id int);\n-- ROLLBACK:\n")?.trim()).toBe("");
    expect(trechoDeRollback("CREATE TABLE a (id int);\n-- ROLLBACK:\n--\n\n-- \n")?.trim()).toBe("");
  });

  it("tira o `-- ` de cada linha e mantém as linhas em branco", () => {
    const sql = "ALTER TABLE a ADD COLUMN b int;\n-- ROLLBACK:\n-- ALTER TABLE a\n--   DROP COLUMN b;\n\n-- DROP INDEX IF EXISTS x;\n";
    expect(trechoDeRollback(sql)).toBe("ALTER TABLE a\n  DROP COLUMN b;\n\nDROP INDEX IF EXISTS x;\n");
  });

  it("`-- -- texto` é comentário de verdade e não vira SQL; texto na linha do marcador também não", () => {
    const sql = "X;\n-- ROLLBACK: desfaz a coluna\n-- -- a constraint sai antes da coluna\n-- ALTER TABLE a DROP CONSTRAINT c;\n--   -- recuado também\n";
    expect(trechoDeRollback(sql)).toBe("\nALTER TABLE a DROP CONSTRAINT c;\n\n");
  });

  it("CRLF: o `\\r` não vai para o SQL", () => {
    expect(trechoDeRollback("X;\r\n-- ROLLBACK:\r\n-- DROP TABLE a;\r\n")).toBe("DROP TABLE a;\n");
  });

  it("aplicável + rollback cobrem o arquivo: o marcador é a fronteira dos dois", () => {
    const sql = "ALTER TABLE a ADD COLUMN b int;\n\n-- ROLLBACK:\n-- ALTER TABLE a DROP COLUMN b;\n";
    expect(trechoAplicavel(sql)).toBe("ALTER TABLE a ADD COLUMN b int;\n\n");
    expect(trechoDeRollback(sql)).toBe("ALTER TABLE a DROP COLUMN b;\n");
  });

  it("a 0059 real: o rollback são os dois comandos, na ordem", async () => {
    const conteudo = await readFile(new URL("../../../src/db/migrations/0059_avisos_fechados.sql", import.meta.url), "utf8");
    const comandos = (trechoDeRollback(conteudo) ?? "").split("\n").filter((l) => l.trim() !== "");
    expect(comandos).toEqual([
      "ALTER TABLE preferencias DROP CONSTRAINT preferencias_avisos_fechados;",
      "ALTER TABLE preferencias DROP COLUMN avisos_fechados;",
    ]);
  });
});

describe("a 0148 (NOD-422, revisão 11 do PR #630): os CHECKs recriados entram NOT VALID e são validados em seguida", () => {
  const TABELAS = ["quadro_comentarios", "quadro_tarefa_historico"];
  /** Cada ADD CONSTRAINT ... CHECK das tabelas vem com NOT VALID e é seguido do VALIDATE da mesma constraint. */
  const conferir = (sql: string) => {
    const comandos = sql.split(";").map((c) => c.replace(/\s+/g, " ").trim()).filter(Boolean);
    const checks = comandos.filter((c) => TABELAS.some((t) => c.startsWith(`ALTER TABLE ${t} ADD CONSTRAINT`)) && / CHECK /.test(c));
    expect(checks.length).toBeGreaterThan(0);
    for (const c of checks) {
      expect(c, c).toMatch(/ NOT VALID$/);
      const [, tabela, nome] = /^ALTER TABLE (\S+) ADD CONSTRAINT (\S+)/.exec(c)!;
      expect(comandos.slice(comandos.indexOf(c) + 1), c).toContain(`ALTER TABLE ${tabela} VALIDATE CONSTRAINT ${nome}`);
    }
  };

  it("na ida e no ROLLBACK", async () => {
    const conteudo = await readFile(new URL("../../../src/db/migrations/0148_importar_linear_no_quadro.sql", import.meta.url), "utf8");
    conferir(trechoAplicavel(conteudo));
    conferir(trechoDeRollback(conteudo) ?? "");
  });
});
