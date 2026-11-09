import type postgres from "postgres";
import type { Conn } from "../shared/types.ts";
import { data } from "./conversao.ts";

type Fragmento = postgres.PendingQuery<postgres.Row[]>;

/**
 * ADR-121 (NOD-92): enquanto a máquina na nuvem é criada, adormece, dorme ou acorda, os prazos de quem espera por ela
 * não correm (órfão preso sem contato, fundo preso, rotina vencida). Fora disso, o relógio conta também da última troca
 * de estado (`estado_desde`): a máquina que acabou de falhar ao acordar ganha o prazo inteiro a partir da falha.
 */
export const ESTADOS_QUE_SUSPENDEM_PRAZO = ["criando", "adormecendo", "dormindo", "acordando"] as const;

/**
 * O "último contato" da nuvem para a máquina `maquinaId` (fragmento SQL que dá o id em texto ou uuid): `agora` enquanto o
 * prazo está suspenso, `estado_desde` fora disso, null quando não é máquina na nuvem. Entra num `greatest(...)` (o
 * Postgres ignora o null).
 */
export function relogioDaNuvem(sql: Conn, tenant: Fragmento, maquinaId: Fragmento, agora: number) {
  return sql`(select case when mn.estado::text = any(${[...ESTADOS_QUE_SUSPENDEM_PRAZO]}::text[]) then ${data(agora)}::timestamptz else mn.estado_desde end
    from maquinas_nuvem mn where mn.tenant_id = ${tenant} and mn.maquina_id::text = (${maquinaId})::text)`;
}

/** A máquina `maquinaId` está na nuvem e dormindo ou acordando agora (o prazo dela não corre). */
export function nuvemSuspendePrazo(sql: Conn, tenant: Fragmento, maquinaId: Fragmento) {
  return sql`exists (select 1 from maquinas_nuvem mn where mn.tenant_id = ${tenant} and mn.maquina_id::text = (${maquinaId})::text
    and mn.estado::text = any(${[...ESTADOS_QUE_SUSPENDEM_PRAZO]}::text[]))`;
}
