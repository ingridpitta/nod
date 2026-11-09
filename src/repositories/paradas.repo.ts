import type { FaixaParada } from "../contracts/turno.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, ms, msOuNull } from "./conversao.ts";

export interface Parada {
  id: string;
  pessoaId: string;
  conversaId: string | null;
  ativaDesde: number;
  encerradaEm: number | null;
  faixa: FaixaParada | null;
}

interface Linha {
  id: string;
  pessoa_id: string;
  conversa_id: string | null;
  ativa_desde: Date;
  encerrada_em: Date | null;
  faixa: FaixaParada | null;
}

const COLUNAS = "id, pessoa_id, conversa_id, ativa_desde, encerrada_em, faixa";

const paraParada = (l: Linha): Parada => ({
  id: l.id,
  pessoaId: l.pessoa_id,
  conversaId: l.conversa_id,
  ativaDesde: ms(l.ativa_desde),
  encerradaEm: msOuNull(l.encerrada_em),
  faixa: l.faixa,
});

/**
 * Parar (E5.4) com estado persistido. EMENDA 10: `ativa` devolve boolean | null — null = a
 * CONSULTA falhou, e quem trata isso como parada é o caso de uso (fail-closed mora lá, não aqui).
 */
export function paradasRepo(conn: Conn, escopo: Escopo) {
  return {
    async ativar(p: { conversaId: string | null; agora: number }): Promise<Parada | null> {
      const [l] = await conn<Linha[]>`
        insert into paradas (tenant_id, owner_id, pessoa_id, conversa_id, ativa_desde)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${escopo.pessoaId}, ${p.conversaId}, ${data(p.agora)})
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraParada(l) : null;
    },

    /** Grava a faixa e encerra; a parada deixa de bloquear despacho. */
    async encerrar(id: string, p: { faixa: FaixaParada; agora: number }): Promise<Parada | null> {
      const [l] = await conn<Linha[]>`
        update paradas set encerrada_em = ${data(p.agora)}, faixa = ${conn.json(p.faixa)}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and encerrada_em is null returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraParada(l) : null;
    },

    /** Nova mensagem da pessoa libera a fila: encerra as paradas abertas que cobrem a conversa (ou todas). */
    async encerrarAbertas(p: { conversaId: string | null; agora: number }): Promise<number> {
      const r = await conn`
        update paradas set encerrada_em = ${data(p.agora)}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and pessoa_id = ${escopo.pessoaId} and encerrada_em is null
          and (${p.conversaId === null} or conversa_id is null or conversa_id = ${p.conversaId})`;
      return r.count;
    },

    /**
     * true = há parada aberta que cobre esta conversa (global ou da conversa); false = não há;
     * null = a consulta falhou (o caso de uso trata como parada).
     */
    async ativa(pessoaId: string, conversaId: string | null): Promise<boolean | null> {
      try {
        const [l] = await conn<{ n: number }[]>`
          select count(*)::int as n from paradas
          where tenant_id = ${escopo.tenantId} and pessoa_id = ${pessoaId} and encerrada_em is null
            and (conversa_id is null or conversa_id = ${conversaId})`;
        return (l?.n ?? 0) > 0;
      } catch {
        return null;
      }
    },

    async listarAbertas(): Promise<Parada[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from paradas where tenant_id = ${escopo.tenantId} and pessoa_id = ${escopo.pessoaId} and encerrada_em is null order by ativa_desde`;
      return linhas.map(paraParada);
    },
  };
}
