import { describe, expect, it } from "vitest";
import { codificarCursor, lerCursor, limiteDaBiblioteca } from "../../../src/domain/biblioteca.ts";

const ID = "0b9c6a7e-1f2d-4c3b-9a8e-7d6c5b4a3f21";

describe("cursor e limite da Biblioteca (NOD-326)", () => {
  it("o cursor vai e volta com os microssegundos", () => {
    const c = { criadoEm: "2026-10-24T03:32:00.123456Z", id: ID };
    expect(lerCursor(codificarCursor(c))).toEqual(c);
  });

  it("recusa o que este servidor não emitiu", () => {
    for (const t of ["", "x", `2026-10-24T03:32:00Z_${ID}`, `2026-10-24T03:32:00.123456Z_nao-e-uuid`, `2026-10-24T03:32:00.123456Z_${ID}_mais`, `2026-13-40T99:99:99.000000Z_${ID}`, `${"9".repeat(100)}`, `2026-10-24T03:32:00.123456Z_${ID.toUpperCase()}`]) {
      expect(lerCursor(t), t).toBeNull();
    }
  });

  it("recusa data que não existe no calendário (o Postgres daria 500)", () => {
    for (const d of ["2026-02-30", "2026-04-31", "2025-02-29", "0000-01-01", "0000-12-31"]) expect(lerCursor(`${d}T00:00:00.000000Z_${ID}`), d).toBeNull();
    expect(lerCursor(`2028-02-29T23:59:59.999999Z_${ID}`)).not.toBeNull();
  });

  it("limite: padrão 60, de 1 a 200, nada fora disso", () => {
    expect(limiteDaBiblioteca(null)).toBe(60);
    expect(limiteDaBiblioteca("")).toBe(60);
    expect(limiteDaBiblioteca("1")).toBe(1);
    expect(limiteDaBiblioteca("200")).toBe(200);
    for (const t of ["0", "201", "-1", "1.5", "abc", "99999"]) expect(limiteDaBiblioteca(t), t).toBeNull();
  });
});
