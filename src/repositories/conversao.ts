import type postgres from "postgres";
/**
 * Conversões de borda entre o Postgres (timestamptz → Date do postgres.js) e os contratos
 * (EpochMs em número; IsoUtc em string). Só aqui: os repositórios não espalham `new Date`.
 */
export function ms(v: Date | string | number): number {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  return Date.parse(v);
}

export function msOuNull(v: Date | string | number | null | undefined): number | null {
  return v === null || v === undefined ? null : ms(v);
}

export function iso(v: Date | string | number): string {
  return new Date(ms(v)).toISOString();
}

export function isoOuNull(v: Date | string | number | null | undefined): string | null {
  return v === null || v === undefined ? null : iso(v);
}

export function data(msEpoch: number): Date {
  return new Date(msEpoch);
}

export function dataOuNull(msEpoch: number | null | undefined): Date | null {
  return msEpoch === null || msEpoch === undefined ? null : new Date(msEpoch);
}

/** Payload livre (Record<string, unknown>) para o parâmetro jsonb do postgres.js, sem `as unknown as`. */
export function jsonb(conn: Pick<postgres.Sql, "json">, v: object): ReturnType<postgres.Sql["json"]> {
  return conn.json(v as postgres.JSONValue);
}
