import type { EpochMs } from "../contracts/ids.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, ms } from "./conversao.ts";

/**
 * O "Agora não" do cartão de liberar apps (0054): uma linha por pessoa, bot e app, com o instante da dispensa.
 * Só a pessoa da sessão lê e grava as dela (owner_id no filtro, além do RLS).
 */
export function liberacoesDispensadasRepo(conn: Conn, escopo: Escopo) {
  return {
    /** conectorId → quando a pessoa dispensou a oferta daquele app para este bot. */
    async doAgente(agenteId: string): Promise<Record<string, EpochMs>> {
      const linhas = await conn<{ conector_id: string; dispensado_em: Date }[]>`
        select conector_id, dispensado_em from liberacoes_dispensadas
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and agente_id = ${agenteId}`;
      return Object.fromEntries(linhas.map((l) => [l.conector_id, ms(l.dispensado_em)]));
    },

    /** Dispensar de novo só anda para a frente (duas abas, um clique atrasado). */
    async dispensar(agenteId: string, conectorIds: readonly string[], agora: EpochMs): Promise<number> {
      let gravadas = 0;
      for (const conectorId of new Set(conectorIds)) {
        const r = await conn`
          insert into liberacoes_dispensadas (tenant_id, owner_id, agente_id, conector_id, dispensado_em)
          values (${escopo.tenantId}, ${escopo.pessoaId}, ${agenteId}, ${conectorId}, ${data(agora)})
          on conflict (tenant_id, owner_id, agente_id, conector_id)
          do update set dispensado_em = greatest(liberacoes_dispensadas.dispensado_em, excluded.dispensado_em)`;
        gravadas += r.count;
      }
      return gravadas;
    },
  };
}
