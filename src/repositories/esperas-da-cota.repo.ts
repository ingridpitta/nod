import type { IaComConta } from "../contracts/contas-ia.ts";
import { ENTRADA_DA_VOLTA_DA_COTA } from "../domain/cota-da-ia.ts";
import type { ContaLivreDaIa, RetomadaDaCota } from "../domain/espera-da-cota.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { ms } from "./conversao.ts";

/**
 * definido em 2026-10-15 (NOD-277, pacote A3): a leitura da task esperando a cota, num arquivo próprio para não disputar o
 * trabalhos.repo.ts e o contas-ia.repo.ts. Só leitura; o "Seguir com" é o `POST contas-ia/:id/seguir` de sempre.
 */
type LinhaRetomada = { trabalho_id: string; acordar_em: Date; entrada_texto: string; conta_id: string | null; conta_ia: IaComConta | null; conta_apelido: string | null };

export function esperasDaCotaRepo(conn: Conn, escopo: Escopo) {
  return {
    /**
     * A primeira retomada da cota pendente e no futuro de cada trabalho. A conta é a do turno mais recente da cadeia
     * (a raiz em `retoma_turno_id` ou uma retomada intermediária dela, que pode ter batido no limite com outra conta; sem
     * `retoma_turno_id`, o último interrompido do trabalho com conta), só se for da pessoa e estiver no limite.
     */
    async doTrabalhos(ids: readonly string[]): Promise<Map<string, RetomadaDaCota>> {
      if (ids.length === 0) return new Map();
      const linhas = await conn<LinhaRetomada[]>`
        select distinct on (r.trabalho_id) r.trabalho_id, r.acordar_em, r.entrada_texto, c.id as conta_id, c.ia as conta_ia, c.apelido as conta_apelido
        from turnos r
        left join lateral (
          select i.conta_id from turnos i
          where i.tenant_id = r.tenant_id and i.trabalho_id = r.trabalho_id and i.conta_id is not null
            and i.id <> r.id
            and (i.id = r.retoma_turno_id or i.retoma_turno_id = r.retoma_turno_id
              or (r.retoma_turno_id is null and i.estado = 'interrompido'))
          order by i.criado_em desc, (i.id = r.retoma_turno_id) asc limit 1
        ) i on true
        left join contas_ia c on c.tenant_id = r.tenant_id and c.owner_id = ${escopo.pessoaId} and c.id = i.conta_id
          and c.removida_em is null and c.no_limite_ate > now()
        where r.tenant_id = ${escopo.tenantId} and r.trabalho_id = any(${[...ids]}::uuid[]) and r.estado = 'pendente'
          and r.acordar_em > now() and starts_with(r.entrada_texto, ${ENTRADA_DA_VOLTA_DA_COTA})
        order by r.trabalho_id, r.acordar_em`;
      return new Map(linhas.map((l) => [l.trabalho_id, {
        voltaEm: ms(l.acordar_em),
        entrada: l.entrada_texto,
        conta: l.conta_id && l.conta_ia && l.conta_apelido !== null ? { id: l.conta_id, ia: l.conta_ia, apelido: l.conta_apelido } : null,
      }]));
    },

    /** As contas da pessoa destas IAs, não removidas, fora do limite e prontas em alguma máquina (sem saída pedida). */
    async livres(ias: readonly IaComConta[]): Promise<ContaLivreDaIa[]> {
      if (ias.length === 0) return [];
      return conn<ContaLivreDaIa[]>`
        select c.id, c.ia, c.apelido from contas_ia c
        where c.tenant_id = ${escopo.tenantId} and c.owner_id = ${escopo.pessoaId} and c.ia = any(${[...ias]}::text[])
          and c.removida_em is null and (c.no_limite_ate is null or c.no_limite_ate <= now())
          and exists (select 1 from contas_ia_maquinas m where m.tenant_id = c.tenant_id and m.conta_id = c.id and m.estado = 'pronta' and m.sair_pedido_em is null)
        order by c.posicao, c.criada_em`;
    },
  };
}
