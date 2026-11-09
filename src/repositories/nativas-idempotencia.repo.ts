import type { Conn, Escopo } from "../shared/types.ts";
import { data, jsonb } from "./conversao.ts";

/** `credencial: "permitida"` (PR 6 dos modos de aprovação): a credencial que o modo liberou; o hook só aceita assim. */
export type RespostaNativaIdempotente = { ok: true; credencial?: "permitida" } | { aguardar: string };

/** Resposta durável do POST de nativa; a trava serializa dois reenvios antes de existir uma linha. */
export function nativasIdempotenciaRepo(conn: Conn, escopo: Escopo) {
  return {
    async travar(turnoId: string, chave: string): Promise<RespostaNativaIdempotente | null> {
      await conn`select pg_advisory_xact_lock(hashtextextended(${`${escopo.tenantId}:${escopo.pessoaId}:${turnoId}:${chave}`}, 0))`;
      const [l] = await conn<{ resposta: RespostaNativaIdempotente }[]>`
        select resposta from nativas_idempotencia
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and turno_id = ${turnoId} and chave = ${chave}`;
      return l?.resposta ?? null;
    },

    async registrar(turnoId: string, chave: string, resposta: RespostaNativaIdempotente): Promise<void> {
      await conn`
        insert into nativas_idempotencia (tenant_id, owner_id, turno_id, chave, resposta)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${turnoId}, ${chave}, ${jsonb(conn, resposta)})`;
    },

    /** Retenção de 1 dia (0097): a dona apaga as próprias chaves mais velhas que `antesDe`. Devolve quantas. */
    async podar(antesDe: number): Promise<number> {
      const r = await conn`delete from nativas_idempotencia where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and criado_em < ${data(antesDe)}`;
      return r.count;
    },
  };
}
