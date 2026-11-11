import { describe, expect, it } from "vitest";
import { previaDeMover } from "../../../src/domain/acionamento.ts";
import { COLUNAS_DA_TABELA, TABELA } from "../../helpers/tabela-acionamento.ts";

describe("previaDeMover (a regra única de vai começar, 2026-11-10)", () => {
  it.each(TABELA)("$caso", (l) => {
    expect(previaDeMover({ status: l.de, agenteId: l.quem }, l.para, { colunas: COLUNAS_DA_TABELA, autorAgenteId: l.autor ?? null, viva: l.viva ?? false })).toEqual(l.espera);
  });
});
