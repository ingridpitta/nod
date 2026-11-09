import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FILTRO_DECISAO } from "../../../src/repositories/trilha.repo.ts";

const normalizar = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

describe("NOD-70: o recorte da decisão é o predicado do índice 0128", () => {
  it("FILTRO_DECISAO e o WHERE do índice parcial são o mesmo texto (o planejador só usa o índice se casarem)", () => {
    const sql = readFileSync(new URL("../../../src/db/migrations/0128_trilha_decisoes_por_agente.sql", import.meta.url), "utf8");
    const where = /CREATE INDEX[^;]*?\bWHERE\b([^;]*);/i.exec(sql.split("-- ROLLBACK")[0] ?? "")?.[1];
    expect(where).toBeDefined();
    expect(normalizar(where ?? "")).toBe(normalizar(FILTRO_DECISAO));
  });
});
