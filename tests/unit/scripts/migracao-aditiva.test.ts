import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BASE_ADITIVA, ehNova, formatar, semComentarios, verificarMigracao, verificarPasta, verificarRollback } from "../../../scripts/migracao-aditiva.ts";

/** NOD-186: migração nova só adiciona; o rollback de código (NOD-173) depende disso. */
const MIGRACOES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "src", "db", "migrations");
const verificar = (sql: string) => verificarMigracao("0059_x.sql", sql);

describe("scripts/migracao-aditiva.ts (NOD-186)", () => {
  it("só CREATE / ADD COLUMN passa", () => {
    expect(
      verificar(`CREATE TABLE t (id uuid PRIMARY KEY);
ALTER TABLE t ADD COLUMN nome text NOT NULL DEFAULT '';
ALTER TABLE t ALTER COLUMN nome DROP NOT NULL, ALTER COLUMN nome DROP DEFAULT, DROP CONSTRAINT t_ck;
CREATE INDEX t_nome ON t (nome);
`),
    ).toEqual([]);
  });

  it.each([
    ["DROP TABLE", "DROP TABLE IF EXISTS velha;", 2],
    ["DROP COLUMN", "ALTER TABLE t DROP COLUMN nome;", 2],
    ["DROP COLUMN", "ALTER TABLE t ADD COLUMN a int, DROP nome;", 2],
    ["RENAME", "ALTER TABLE t RENAME COLUMN a TO b;", 2],
    ["RENAME", "ALTER TYPE codigo_erro RENAME VALUE 'x' TO 'y';", 2],
    ["ALTER COLUMN … TYPE", "ALTER TABLE t\n  ALTER COLUMN a TYPE bigint;", 3],
    ["ALTER COLUMN … TYPE", "ALTER TABLE t ALTER a SET DATA TYPE bigint;", 2],
    ["SET NOT NULL", "ALTER TABLE t\n  ALTER COLUMN a SET NOT NULL;", 3],
  ] as const)("barra %s: %s", (comando, sql, linha) => {
    const problemas = verificar(`-- cabeçalho\n${sql}\n`);
    // Linha no arquivo original (o cabeçalho é a 1), onde o comando começa.
    expect(problemas).toEqual([{ arquivo: "0059_x.sql", linha, comando, motivo: "destrutiva" }]);
  });

  it("a linha reportada é a do arquivo original, depois de comentários de bloco", () => {
    const sql = "/* longo\n   comentário\n*/\nCREATE TABLE a (id int);\n\nDROP TABLE b;\n";
    expect(verificar(sql)).toEqual([{ arquivo: "0059_x.sql", linha: 6, comando: "DROP TABLE", motivo: "destrutiva" }]);
  });

  it("DROP só depois de `-- ROLLBACK:` passa", () => {
    expect(verificar("CREATE TABLE t (id int);\n\n-- ROLLBACK:\nDROP TABLE t;\nALTER TABLE x DROP COLUMN y;\n")).toEqual([]);
  });

  it("DROP dentro de comentário ou de literal passa", () => {
    expect(
      verificar(`-- antes era DROP TABLE velha; agora só adiciona
/* ALTER TABLE t RENAME COLUMN a TO b; */
COMMENT ON TABLE t IS 'não use DROP TABLE nem SET NOT NULL aqui; it''s RENAME-free';
`),
    ).toEqual([]);
  });

  it.each([
    ["aspa solta em $$…$$", "COMMENT ON TABLE t IS $$it's$$;\nDROP TABLE x;\nSELECT 'a';\n"],
    ["aspa solta em $tag$…$tag$", "COMMENT ON TABLE t IS $c$it's$c$;\nDROP TABLE x;\nSELECT 'a';\n"],
    ["E'…' com \\'", "SELECT E'a\\'b';\nDROP TABLE x;\nSELECT 'c';\n"],
    ['identificador "a--b"', 'CREATE TABLE "a--b" (id int);\nDROP TABLE x;\n'],
    ["/* aninhado */", "/* a /* b */ c */\nDROP TABLE x;\n"],
  ])("literal ou comentário não esconde o SQL depois dele: %s", (_, sql) => {
    expect(verificar(sql)).toEqual([{ arquivo: "0059_x.sql", linha: 2, comando: "DROP TABLE", motivo: "destrutiva" }]);
  });

  it("corpo de DO $$…$$ é código e é verificado; literal dentro dele não", () => {
    expect(verificar("DO $$ BEGIN\n  RAISE NOTICE 'DROP TABLE y';\n  ALTER TABLE t DROP COLUMN c;\nEND $$;\n")).toEqual([
      { arquivo: "0059_x.sql", linha: 3, comando: "DROP COLUMN", motivo: "destrutiva" },
    ]);
  });

  it("tabela chamada type não é ALTER … TYPE; DROP IF EXISTS sem COLUMN barra", () => {
    expect(verificar('ALTER TABLE type ADD COLUMN a int;\nALTER TABLE "rename" ADD COLUMN b int;\n')).toEqual([]);
    expect(verificar("ALTER TABLE t DROP IF EXISTS c;\n")).toEqual([
      { arquivo: "0059_x.sql", linha: 1, comando: "DROP COLUMN", motivo: "destrutiva" },
    ]);
  });

  it("a marca não cobre a instrução seguinte na mesma linha; cobre a cláusula logo abaixo", () => {
    expect(verificar("-- destrutiva-ok: m\nDROP TABLE a; DROP TABLE b;\n")).toEqual([
      { arquivo: "0059_x.sql", linha: 2, comando: "DROP TABLE", motivo: "destrutiva" },
    ]);
    expect(verificar("ALTER TABLE t\n  ADD COLUMN n int,\n  -- destrutiva-ok: coluna morta\n  DROP COLUMN v;\n")).toEqual([]);
  });

  it("exceção com motivo passa; sem motivo falha", () => {
    const comMotivo = "-- destrutiva-ok: coluna nunca lida desde a 0040 (NOD-999)\nALTER TABLE t DROP COLUMN velha;\n";
    expect(verificar(comMotivo)).toEqual([]);
    // Marca antes da instrução de várias linhas também vale.
    expect(verificar("-- destrutiva-ok: tipo só alarga\nALTER TABLE t\n  ALTER COLUMN a TYPE bigint;\n")).toEqual([]);
    expect(verificar("-- destrutiva-ok:   \nALTER TABLE t DROP COLUMN velha;\n")).toEqual([
      { arquivo: "0059_x.sql", linha: 2, comando: "DROP COLUMN", motivo: "excecao_sem_motivo" },
    ]);
    // A marca vale só para o comando seguinte, não para o arquivo.
    expect(verificar(`${comMotivo}DROP TABLE outra;\n`)).toEqual([{ arquivo: "0059_x.sql", linha: 3, comando: "DROP TABLE", motivo: "destrutiva" }]);
  });

  describe("QA (NOD-186): furos achados na sonda", () => {
    it.each([
      ["coluna chamada type, sem COLUMN", "ALTER TABLE t ALTER type TYPE bigint;", "ALTER COLUMN … TYPE"],
      ["coluna chamada index, sem COLUMN", "ALTER TABLE public.t ALTER index SET DATA TYPE bigint;", "ALTER COLUMN … TYPE"],
      ["coluna chamada type, com COLUMN", "ALTER TABLE t ALTER COLUMN type TYPE bigint;", "ALTER COLUMN … TYPE"],
      ["ALTER FOREIGN TABLE", "ALTER FOREIGN TABLE t DROP COLUMN c;", "DROP COLUMN"],
      ["EXECUTE com literal em DO", "DO $$ BEGIN EXECUTE 'DROP TABLE x'; END $$;", "DROP TABLE"],
      ["EXECUTE format(…) em DO", "DO $$ BEGIN EXECUTE format('ALTER TABLE %I DROP COLUMN c', 't'); END $$;", "DROP COLUMN"],
    ] as const)("barra %s", (_, sql, comando) => {
      expect(verificar(`${sql}\n`)).toEqual([{ arquivo: "0059_x.sql", linha: 1, comando, motivo: "destrutiva" }]);
    });

    it("objeto chamado type continua sem falso positivo", () => {
      expect(verificar("ALTER TYPE type ADD VALUE 'x';\nALTER DOMAIN type SET DEFAULT 1;\nALTER TABLE type ADD COLUMN a int;\n")).toEqual([]);
    });

    it("marca de exceção comentada em /* */ ou dentro de literal não vale", () => {
      const barrado = [{ arquivo: "0059_x.sql", linha: 4, comando: "DROP TABLE", motivo: "destrutiva" }];
      expect(verificar("/*\n-- destrutiva-ok: m\n*/\nDROP TABLE a;\n")).toEqual(barrado);
      expect(verificar("SELECT '\n-- destrutiva-ok: m\n';\nDROP TABLE a;\n")).toEqual(barrado);
    });

    it("marca de exceção vale em arquivo com CRLF", () => {
      expect(verificar("-- destrutiva-ok: tabela morta (NOD-999)\r\nDROP TABLE a;\r\n")).toEqual([]);
    });
  });

  /* eslint-disable no-restricted-syntax -- aqui TRUNCATE é texto de migração dado ao gate (NOD-191), nunca roda no banco */
  describe("NOD-191: DROP VIEW/TYPE/DOMAIN/FUNCTION, TRUNCATE e ALTER TYPE … ATTRIBUTE", () => {
    it.each([
      ["DROP TYPE", "DROP TYPE IF EXISTS estado_velho;"],
      ["DROP TYPE", "DROP TYPE public.t CASCADE;"],
      ["DROP VIEW", "DROP VIEW v;"],
      ["DROP VIEW", "DROP MATERIALIZED VIEW IF EXISTS mv;"],
      ["DROP DOMAIN", "DROP DOMAIN email;"],
      ["DROP FUNCTION", "DROP FUNCTION IF EXISTS f(text);"],
      ["DROP FUNCTION", "DROP PROCEDURE p();"],
      ["DROP FUNCTION", "DROP ROUTINE r;"],
      ["TRUNCATE", "TRUNCATE avisos;"],
      ["TRUNCATE", "TRUNCATE TABLE ONLY a, b RESTART IDENTITY;"],
      // ON/OR só livram como palavra inteira: ONLY e uma tabela orders/online não escapam.
      ["TRUNCATE", "TRUNCATE ONLY a;"],
      ["TRUNCATE", "TRUNCATE orders, online;"],
      ["ALTER ATTRIBUTE … TYPE", "ALTER TYPE par ALTER ATTRIBUTE a TYPE bigint;"],
      ["ALTER ATTRIBUTE … TYPE", "ALTER TYPE public.par\n  ALTER ATTRIBUTE a SET DATA TYPE bigint;"],
      ["DROP ATTRIBUTE", "ALTER TYPE par DROP ATTRIBUTE IF EXISTS a;"],
    ] as const)("barra %s: %s", (comando, sql) => {
      const p = verificar(`${sql}\n`);
      expect(p).toHaveLength(1);
      expect(p[0]).toMatchObject({ comando, motivo: "destrutiva" });
    });

    it("a linha reportada é a da cláusula em ALTER TYPE de várias linhas", () => {
      expect(verificar("ALTER TYPE par\n  ADD ATTRIBUTE b int,\n  DROP ATTRIBUTE a;\n")).toEqual([
        { arquivo: "0059_x.sql", linha: 3, comando: "DROP ATTRIBUTE", motivo: "destrutiva" },
      ]);
    });

    it("os vizinhos que não apagam nada passam", () => {
      expect(
        verificar(`ALTER TYPE estado ADD VALUE IF NOT EXISTS 'novo' AFTER 'velho';
ALTER TYPE par ADD ATTRIBUTE c text;
ALTER TYPE type ADD VALUE 'x';
ALTER TYPE type ADD ATTRIBUTE type int;
CREATE OR REPLACE VIEW v AS SELECT 1;
CREATE OR REPLACE FUNCTION f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;
DROP INDEX IF EXISTS i;
DROP TRIGGER IF EXISTS tg ON t;
DROP POLICY IF EXISTS p ON t;
ALTER TABLE t ALTER COLUMN a DROP NOT NULL, ALTER COLUMN a DROP DEFAULT, DROP CONSTRAINT t_ck;
ALTER DOMAIN email DROP DEFAULT;
ALTER DOMAIN email DROP CONSTRAINT email_ck;
CREATE TRIGGER tg BEFORE TRUNCATE ON t EXECUTE FUNCTION f();
CREATE TRIGGER tg2 BEFORE INSERT OR TRUNCATE OR DELETE ON t EXECUTE FUNCTION f();
CREATE TRIGGER tg3 AFTER TRUNCATE OR UPDATE ON t EXECUTE FUNCTION f();
REVOKE UPDATE, DELETE, TRUNCATE ON trilha FROM nod_app;
GRANT TRUNCATE, SELECT ON t TO nod_app;
RAISE NOTICE 'TRUNCATE x';
COMMENT ON VIEW v IS 'não use DROP VIEW nem DROP FUNCTION nem TRUNCATE';
-- TRUNCATE x; DROP TYPE y;
DO $$ BEGIN RAISE NOTICE 'DROP TYPE y'; END $$;
`),
      ).toEqual([]);
    });

    it("ALTER TABLE … ALTER COLUMN … TYPE continua sendo de coluna, não de ALTER TYPE", () => {
      expect(verificar("ALTER TABLE t ALTER COLUMN a TYPE bigint;\n")).toEqual([
        { arquivo: "0059_x.sql", linha: 1, comando: "ALTER COLUMN … TYPE", motivo: "destrutiva" },
      ]);
      // Coluna chamada type: o ALTER `type` TYPE não vira ALTER ATTRIBUTE nem some.
      expect(verificar("ALTER TABLE t ALTER type TYPE bigint;\n")).toEqual([
        { arquivo: "0059_x.sql", linha: 1, comando: "ALTER COLUMN … TYPE", motivo: "destrutiva" },
      ]);
    });

    it("em ALTER TABLE, DROP de coluna chamada type/view/function é DROP COLUMN", () => {
      expect(verificar("ALTER TABLE t DROP type, DROP view, DROP function;\n").map((p) => p.comando)).toEqual([
        "DROP COLUMN",
        "DROP COLUMN",
        "DROP COLUMN",
      ]);
    });

    it.each([
      ["DROP TYPE", "DROP TYPE x;"],
      ["DROP VIEW", "DROP VIEW x;"],
      ["DROP FUNCTION", "DROP FUNCTION x();"],
      ["TRUNCATE", "TRUNCATE x;"],
      ["ALTER ATTRIBUTE … TYPE", "ALTER TYPE x ALTER ATTRIBUTE a TYPE int;"],
    ] as const)("%s não se esconde depois de $$it's$$ nem de E'a\\'b'", (comando, sql) => {
      for (const antes of ["COMMENT ON TABLE t IS $$it's$$;", "SELECT E'a\\'b';"]) {
        expect(verificar(`${antes}\n${sql}\nSELECT 'c';\n`)).toEqual([{ arquivo: "0059_x.sql", linha: 2, comando, motivo: "destrutiva" }]);
      }
    });

    it.each([
      ["DROP VIEW", 'DROP VIEW "minha view";'],
      ["DROP TYPE", 'DROP TYPE "Meu Tipo";'],
      ["TRUNCATE", 'TRUNCATE "tabela; x";'],
      ["ALTER ATTRIBUTE … TYPE", 'ALTER TYPE "t" ALTER ATTRIBUTE "a" TYPE bigint;'],
      ["ALTER ATTRIBUTE … TYPE", 'ALTER TYPE "s"."t" ALTER ATTRIBUTE "a b" SET DATA TYPE bigint;'],
      ["DROP ATTRIBUTE", 'ALTER TYPE "t" DROP ATTRIBUTE "a";'],
    ] as const)("identificador entre aspas não esconde %s: %s", (comando, sql) => {
      expect(verificar(`${sql}\n`)).toEqual([{ arquivo: "0059_x.sql", linha: 1, comando, motivo: "destrutiva" }]);
    });

    it.each([
      ["DROP TYPE", "EXECUTE 'DROP TYPE x';"],
      ["DROP VIEW", "EXECUTE 'DROP MATERIALIZED VIEW ' || quote_ident(v);"],
      ["DROP FUNCTION", "EXECUTE format('DROP FUNCTION %I()', f);"],
      ["TRUNCATE", "EXECUTE 'TRUNCATE ' || quote_ident(t);"],
      ["ALTER ATTRIBUTE … TYPE", "EXECUTE 'ALTER TYPE x ALTER ATTRIBUTE a TYPE int';"],
      ["DROP ATTRIBUTE", "EXECUTE format('ALTER TYPE %I DROP ATTRIBUTE a', t);"],
    ] as const)("EXECUTE dentro de DO $$ não esconde %s", (comando, sql) => {
      expect(verificar(`DO $$ BEGIN ${sql} END $$;\n`)).toEqual([{ arquivo: "0059_x.sql", linha: 1, comando, motivo: "destrutiva" }]);
    });

    // Revisão NOD-191 (Eng 3): a exceção de privilégio/trigger não pode deixar passar um TRUNCATE de verdade.
    it.each([
      ["tabela on$log (o $ não é fim de palavra)", "TRUNCATE on$log;"],
      ["tabela or$x", "TRUNCATE or$x;"],
      ["literal concatenado com ||", "DO $$ BEGIN EXECUTE 'TRUNCATE' || ' avisos'; END $$;"],
      ["literal como argumento de concat()", "DO $$ BEGIN EXECUTE concat('TRUNCATE', ' avisos'); END $$;"],
      ["quebra de linha antes do alvo", "TRUNCATE\n  avisos;"],
    ])("TRUNCATE de verdade barra: %s", (_nome, sql) => {
      expect(verificar(`${sql}\n`)).toEqual([{ arquivo: "0059_x.sql", linha: 1, comando: "TRUNCATE", motivo: "destrutiva" }]);
    });

    it.each([
      ["= 'TRUNCATE'", "IF TG_OP = 'TRUNCATE' THEN EXECUTE 'SELECT 1'; END IF;"],
      ["<> 'TRUNCATE'", "IF TG_OP <> 'TRUNCATE' THEN EXECUTE 'SELECT 1'; END IF;"],
      ["WHEN 'TRUNCATE'", "CASE TG_OP WHEN 'TRUNCATE' THEN EXECUTE 'SELECT 1'; END CASE;"],
      ["IN (…, 'TRUNCATE')", "IF TG_OP IN ('DELETE', 'TRUNCATE') THEN EXECUTE 'SELECT 1'; END IF;"],
    ])("TG_OP comparado com 'TRUNCATE' num corpo com EXECUTE passa: %s", (_nome, corpo) => {
      expect(verificar(`CREATE FUNCTION f() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN ${corpo} RETURN NULL; END $$;\n`)).toEqual([]);
    });

    it("a marca libera só o comando seguinte: dois na mesma linha, o 2º barra; motivo vazio falha", () => {
      expect(verificar("-- destrutiva-ok: tabela de cache (NOD-999)\nTRUNCATE a; TRUNCATE b;\n")).toEqual([
        { arquivo: "0059_x.sql", linha: 2, comando: "TRUNCATE", motivo: "destrutiva" },
      ]);
      expect(verificar("-- destrutiva-ok: recria com outra assinatura\nDROP FUNCTION f(int); DROP VIEW v;\n")).toEqual([
        { arquivo: "0059_x.sql", linha: 2, comando: "DROP VIEW", motivo: "destrutiva" },
      ]);
      expect(verificar("-- destrutiva-ok: recria com outra assinatura\nDROP FUNCTION f(int);\nCREATE FUNCTION f(bigint) RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;\n")).toEqual([]);
      expect(verificar("-- destrutiva-ok:\nDROP TYPE t;\n")).toEqual([
        { arquivo: "0059_x.sql", linha: 2, comando: "DROP TYPE", motivo: "excecao_sem_motivo" },
      ]);
    });

    it("tudo isso depois de `-- ROLLBACK:` passa", () => {
      expect(verificar("CREATE TYPE t AS (a int);\n-- ROLLBACK:\nDROP TYPE t;\nDROP VIEW v;\nTRUNCATE x;\nDROP FUNCTION f();\n")).toEqual([]);
    });

    // QA NOD-191: o Postgres aceita letra não ASCII em identificador sem aspas (conferido no PG:
    // `TRUNCATE orçamentos` apaga as linhas). `ON`/`OR` seguidos de `ç` não são as palavras reservadas,
    // e `preço` não pode cortar o ID antes do TYPE.
    it.each([
      ["TRUNCATE", "TRUNCATE orçamentos;"],
      ["TRUNCATE", "TRUNCATE onça, online;"],
      ["ALTER COLUMN … TYPE", "ALTER TABLE t ALTER COLUMN preço TYPE numeric;"],
      ["ALTER COLUMN … TYPE", "ALTER TABLE t ALTER preço SET DATA TYPE numeric;"],
      ["ALTER ATTRIBUTE … TYPE", "ALTER TYPE endereço ALTER ATTRIBUTE preço TYPE numeric;"],
      ["DROP COLUMN", "ALTER TABLE ação DROP preço;"],
    ] as const)("identificador acentuado sem aspas não escapa: %s em %s", (comando, sql) => {
      const p = verificar(`${sql}\n`);
      expect(p).toHaveLength(1);
      expect(p[0]).toMatchObject({ comando, motivo: "destrutiva" });
    });

    it("identificador acentuado nos vizinhos que não apagam nada passa", () => {
      expect(
        verificar("ALTER TABLE ação ADD COLUMN preço int;\nALTER TYPE endereço ADD ATTRIBUTE preço int;\nGRANT TRUNCATE ON orçamentos TO nod_app;\n"),
      ).toEqual([]);
    });
  });
  /* eslint-enable no-restricted-syntax */

  it(`arquivo com prefixo ≤ ${BASE_ADITIVA} é ignorado; acima, verificado`, async () => {
    expect(ehNova("0058_limite_do_plano.sql")).toBe(false);
    expect(ehNova("0059_nova.sql")).toBe(true);
    const dir = await mkdtemp(join(tmpdir(), "nod-186-"));
    try {
      await writeFile(join(dir, "0058_antiga.sql"), "DROP TABLE antiga;\n");
      await writeFile(join(dir, "0059_nova.sql"), "ALTER TABLE t RENAME TO u;\n-- ROLLBACK:\n-- ALTER TABLE u RENAME TO t;\n");
      const r = await verificarPasta(dir);
      expect(r.verificadas).toEqual(["0059_nova.sql"]);
      expect(r.problemas).toEqual([{ arquivo: "0059_nova.sql", linha: 1, comando: "RENAME", motivo: "destrutiva" }]);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("o repositório real passa, e sem o corte as duas antigas conhecidas seriam barradas", async () => {
    expect((await verificarPasta(MIGRACOES)).problemas).toEqual([]);
    const todas = (await verificarPasta(MIGRACOES, 0)).problemas;
    const destrutivas = todas.filter((p) => p.motivo === "destrutiva").map((p) => `${p.arquivo}:${p.linha} ${p.comando}`);
    expect(destrutivas).toEqual(["0003_decisora_escreve.sql:114 ALTER COLUMN … TYPE", "0046_codigo_dado_pessoal.sql:11 RENAME"]);
    // NOD-195: as 4 sem marcador da issue e a 0013 (comando na linha do marcador) seriam barradas sem o corte.
    const semRollback = todas.filter((p) => p.motivo !== "destrutiva").map((p) => `${p.arquivo}:${p.linha} ${p.motivo}`);
    expect(semRollback).toEqual([
      "0008_conectores_https.sql:5 sem_rollback",
      "0010_rotinas_utc.sql:5 sem_rollback",
      "0013_harnesses.sql:6 rollback_vazio",
      "0043_profundidade_ate_3.sql:11 sem_rollback",
      "0055_ligacao_sem_ia.sql:22 sem_rollback",
    ]);
  });

  it("semComentarios preserva posições e quebras de linha", () => {
    const sql = "a -- x\n/* y\nz */ 'q''r' b";
    const limpo = semComentarios(sql);
    expect(limpo).toHaveLength(sql.length);
    expect(limpo.split("\n")).toHaveLength(3);
    expect(limpo.replace(/\s+/g, "")).toBe("a''b");
  });
  describe("NOD-195: migração nova traz o bloco -- ROLLBACK: com comando", () => {
    const ida = "ALTER TABLE a ADD COLUMN b int;\n";
    it("com rollback de verdade passa", () => {
      expect(verificarRollback("0060_x.sql", `${ida}\n-- ROLLBACK:\n-- -- tira a coluna\n-- ALTER TABLE a DROP COLUMN b;\n`)).toEqual([]);
    });
    it("sem marcador: sai com a última linha do arquivo", () => {
      expect(verificarRollback("0060_x.sql", `-- cabeçalho\n${ida}`)).toEqual([{ arquivo: "0060_x.sql", linha: 2, comando: "-- ROLLBACK:", motivo: "sem_rollback" }]);
    });
    it("marcador que não está no início da linha não conta", () => {
      expect(verificarRollback("0060_x.sql", `${ida}  -- ROLLBACK:\n-- ALTER TABLE a DROP COLUMN b;\n`)[0]?.motivo).toBe("sem_rollback");
    });
    it("bloco vazio, só com linhas em branco, `--` ou comentário `-- --`: sai com a linha do marcador", () => {
      for (const bloco of ["", "\n\n", "--\n-- \n", "-- -- não há o que desfazer\n", "-- /* nada */\n", "-- ;\n--  ;\n"]) {
        expect(verificarRollback("0060_x.sql", `${ida}\n-- ROLLBACK:\n${bloco}`)).toEqual([{ arquivo: "0060_x.sql", linha: 3, comando: "-- ROLLBACK:", motivo: "rollback_vazio" }]);
      }
    });
    it("comando na mesma linha do marcador não vale (é comentário): o SQL vai nas linhas de baixo", () => {
      expect(verificarRollback("0060_x.sql", `${ida}-- ROLLBACK: ALTER TABLE a DROP COLUMN b;\n`)[0]?.motivo).toBe("rollback_vazio");
    });
    it("verificarPasta junta as duas regras, e as ≤ 0058 continuam ignoradas", async () => {
      const dir = await mkdtemp(join(tmpdir(), "nod-195-"));
      try {
        await writeFile(join(dir, "0058_antiga.sql"), ida);
        await writeFile(join(dir, "0059_sem.sql"), ida);
        await writeFile(join(dir, "0060_vazia.sql"), `${ida}-- ROLLBACK:\n`);
        await writeFile(join(dir, "0061_ok.sql"), `${ida}-- ROLLBACK:\n-- ALTER TABLE a DROP COLUMN b;\n`);
        const r = await verificarPasta(dir);
        expect(r.verificadas).toEqual(["0059_sem.sql", "0060_vazia.sql", "0061_ok.sql"]);
        expect(r.problemas.map((p) => `${p.arquivo}:${p.linha} ${p.motivo}`)).toEqual(["0059_sem.sql:1 sem_rollback", "0060_vazia.sql:2 rollback_vazio"]);
        expect(r.problemas.map(formatar)).toEqual([
          expect.stringMatching(/^src\/db\/migrations\/0059_sem\.sql:1 {2}falta o bloco "-- ROLLBACK:"/),
          expect.stringMatching(/^src\/db\/migrations\/0060_vazia\.sql:2 {2}bloco "-- ROLLBACK:" sem comando/),
        ]);
      } finally {
        await rm(dir, { recursive: true });
      }
    });
  });
});
