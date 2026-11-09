import type { ChamadaWebhook } from "../contracts/rotina.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, ms } from "./conversao.ts";

interface Linha {
  id: string;
  rotina_id: string;
  em: Date;
  desfecho: ChamadaWebhook["desfecho"];
  motivo: ChamadaWebhook["motivo"];
  evento: string | null;
  turno_id: string | null;
}

const paraChamada = (l: Linha): ChamadaWebhook => ({ id: l.id, rotinaId: l.rotina_id, em: ms(l.em), desfecho: l.desfecho, motivo: l.motivo, evento: l.evento, turnoId: l.turno_id });

/** Fica no log: as 50 mais novas da rotina, e tudo das últimas 72 h (definido em 2026-10-30, spec da NOD-84). */
const GUARDAR_HORAS = 72;
/**
 * Recusadas: só as 10 mais novas, dentro das 72 h ou não (revisão da NOD-84). Quem martela um token errado — que passa
 * no limite por IP trocando de IP — não enche a tabela; o "!" só precisa da mais nova.
 */
export const RECUSADAS_NO_LOG = 10;

/**
 * O log de chamadas do webhook (NOD-84, ADR-139). `entrega_id` com UNIQUE parcial é o dedupe: a 2ª chamada com o
 * mesmo id de entrega não grava (registrar devolve null) e a rota responde "duplicada". Não guarda o payload.
 */
export function rotinaChamadasRepo(conn: Conn, escopo: Escopo) {
  return {
    async registrar(c: { rotinaId: string; em: number; desfecho: ChamadaWebhook["desfecho"]; motivo?: ChamadaWebhook["motivo"]; evento?: string | null; entregaId?: string | null; turnoId?: string | null }): Promise<ChamadaWebhook | null> {
      const [l] = await conn<Linha[]>`
        insert into rotina_chamadas (tenant_id, owner_id, rotina_id, em, desfecho, motivo, evento, entrega_id, turno_id)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${c.rotinaId}, ${data(c.em)}, ${c.desfecho}, ${c.motivo ?? null}, ${c.evento ?? null}, ${c.entregaId ?? null}, ${c.turnoId ?? null})
        on conflict (tenant_id, rotina_id, entrega_id) where entrega_id is not null do nothing
        returning id, rotina_id, em, desfecho, motivo, evento, turno_id`;
      return l ? paraChamada(l) : null;
    },

    async jaEntregue(rotinaId: string, entregaId: string): Promise<boolean> {
      const [l] = await conn`select 1 from rotina_chamadas
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and rotina_id = ${rotinaId} and entrega_id = ${entregaId}`;
      return Boolean(l);
    },

    /** As mais novas primeiro. */
    async listar(rotinaId: string, n: number): Promise<ChamadaWebhook[]> {
      const linhas = await conn<Linha[]>`select id, rotina_id, em, desfecho, motivo, evento, turno_id from rotina_chamadas
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and rotina_id = ${rotinaId}
        order by em desc, id desc limit ${n}`;
      return linhas.map(paraChamada);
    },

    /** Quantas chegaram desde `desde` (o "N hoje" do card). */
    async contarDesde(rotinaId: string, desde: number, desfecho?: ChamadaWebhook["desfecho"]): Promise<number> {
      const [l] = await conn<{ n: number }[]>`select count(*)::int as n from rotina_chamadas
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and rotina_id = ${rotinaId} and em >= ${data(desde)}
          and (${desfecho ?? null}::text is null or desfecho = ${desfecho ?? null})`;
      return l?.n ?? 0;
    },

    /** As rotinas da pessoa com recusa pendente: a recusada mais nova é posterior à aceita mais nova (o "!" da lista). */
    async comRecusaPendente(): Promise<string[]> {
      const linhas = await conn<{ rotina_id: string }[]>`
        select rotina_id from rotina_chamadas
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}
        group by rotina_id
        having max(em) filter (where desfecho = 'recusada') > coalesce(max(em) filter (where desfecho not in ('recusada', 'teste')), '-infinity'::timestamptz)`;
      return linhas.map((l) => l.rotina_id);
    },

    /** Poda: fica o que está entre as 50 mais novas OU nas últimas 72 h; das recusadas, só as 10 mais novas. */
    async podar(rotinaId: string, agora: number, manter: number): Promise<number> {
      const r = await conn`delete from rotina_chamadas c
        where c.tenant_id = ${escopo.tenantId} and c.owner_id = ${escopo.pessoaId} and c.rotina_id = ${rotinaId}
          and (
            (c.em < ${data(agora)}::timestamptz - make_interval(hours => ${GUARDAR_HORAS})
              and c.id not in (select id from rotina_chamadas
                where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and rotina_id = ${rotinaId}
                order by em desc, id desc limit ${manter}))
            or (c.desfecho = 'recusada' and c.id not in (select id from rotina_chamadas
                where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and rotina_id = ${rotinaId} and desfecho = 'recusada'
                order by em desc, id desc limit ${RECUSADAS_NO_LOG}))
          )`;
      return r.count;
    },
  };
}
