import { describe, expect, it } from "vitest";
import { previaDeMover as doDominio } from "../../../src/domain/acionamento.ts";
import { dicaDeMover, previaDeMover as daWeb } from "../../../web/lib/acionamento.ts";
import { COLUNAS_DA_TABELA, TABELA } from "../../helpers/tabela-acionamento.ts";

describe("web/lib/acionamento.ts espelha a regra do domínio (2026-11-10)", () => {
  it.each(TABELA)("$caso", (l) => {
    const x = { colunas: COLUNAS_DA_TABELA, autorAgenteId: l.autor ?? null, viva: l.viva ?? false };
    const t = { status: l.de, agenteId: l.quem };
    expect(daWeb(t, l.para, x)).toEqual(doDominio(t, l.para, x));
    expect(daWeb(t, l.para, x)).toEqual(l.espera);
  });
  it("o código é o mesmo do domínio (depois da importação)", async () => {
    const { readFile } = await import("node:fs/promises");
    const corpo = (s: string) => s.slice(s.indexOf("\n", s.indexOf("import type")));
    const dom = corpo(await readFile("src/domain/acionamento.ts", "utf8"));
    const web = corpo(await readFile("web/lib/acionamento.ts", "utf8"));
    expect(web.startsWith(dom)).toBe(true);
  });
});

describe("dicaDeMover: a linha da dica ao arrastar e do Mover para…", () => {
  const nome = (id: string) => (id === "z" ? "Ze 1" : null);
  it("passa e começa, só passa, o mesmo começa e nada", () => {
    expect(dicaDeMover({ agenteId: "z", passa: true, aciona: true }, nome)).toBe("Soltar passa para Ze 1, que começa agora");
    expect(dicaDeMover({ agenteId: "z", passa: true, aciona: false }, nome)).toBe("Soltar passa para Ze 1");
    expect(dicaDeMover({ agenteId: "z", passa: false, aciona: true }, nome)).toBe("Ao soltar, Ze 1 começa agora");
    expect(dicaDeMover({ agenteId: "z", passa: false, aciona: false }, nome)).toBeNull();
    expect(dicaDeMover({ agenteId: null, passa: false, aciona: false }, nome)).toBeNull();
    expect(dicaDeMover({ agenteId: "z", passa: true, aciona: true }, nome, false)).toBe("Passa para Ze 1, que começa agora");
    expect(dicaDeMover({ agenteId: "z", passa: false, aciona: true }, nome, false)).toBe("Ze 1 começa agora");
  });
});
