import type { AcaoDiario, AutorMemoria, EntradaDiario, TipoMemoria } from "../contracts/memoria.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { ms, msOuNull } from "./conversao.ts";

interface Linha {
  id: string;
  agente_id: string;
  memoria_id: string;
  acao: AcaoDiario;
  autor: AutorMemoria;
  memoria_origem: AutorMemoria;
  memoria_criado_em: Date;
  antes_tipo: TipoMemoria | null;
  antes_texto: string | null;
  depois_tipo: TipoMemoria | null;
  depois_texto: string | null;
  desfaz_id: string | null;
  desfeita_em: Date | null;
  revisada_em: Date | null;
  criado_em: Date;
}

const COLUNAS =
  "id, agente_id, memoria_id, acao, autor, memoria_origem, memoria_criado_em, antes_tipo, antes_texto, depois_tipo, depois_texto, desfaz_id, desfeita_em, revisada_em, criado_em";

/** A entrada com o que o desfazer precisa para recriar a memória igual (origem e data). */
export type EntradaDiarioCompleta = EntradaDiario & { memoriaOrigem: AutorMemoria; memoriaCriadoEm: number };

const paraEntrada = (l: Linha): EntradaDiarioCompleta => ({
  id: l.id,
  agenteId: l.agente_id,
  memoriaId: l.memoria_id,
  acao: l.acao,
  autor: l.autor,
  antes: l.antes_texto !== null && l.antes_tipo !== null ? { tipo: l.antes_tipo, texto: l.antes_texto } : null,
  depois: l.depois_texto !== null && l.depois_tipo !== null ? { tipo: l.depois_tipo, texto: l.depois_texto } : null,
  desfazId: l.desfaz_id,
  desfeitaEm: msOuNull(l.desfeita_em),
  revisadaEm: msOuNull(l.revisada_em),
  criadoEm: ms(l.criado_em),
  memoriaOrigem: l.memoria_origem,
  memoriaCriadoEm: ms(l.memoria_criado_em),
});

/** definido em 2026-10-28 (NOD-58): 50 por página, como pede a issue ("a tela mostra 50 com Mostrar mais"). */
export const POR_PAGINA = 50;

/** NOD-58: diário da memória do bot. A gravação das entradas mora no memorias.repo (mesmo statement da escrita). */
export function memoriasDiarioRepo(conn: Conn, escopo: Escopo) {
  return {
    /** Mais novas primeiro; `antes` é o id da última entrada já mostrada (cursor por (criado_em, id)). */
    async listar(agenteId: string, antes?: string | null, limite = POR_PAGINA): Promise<{ entradas: EntradaDiarioCompleta[]; mais: boolean }> {
      const cursor = antes
        ? conn`and (criado_em, id) < (select c.criado_em, c.id from memoria_diario c where c.tenant_id = ${escopo.tenantId} and c.agente_id = ${agenteId} and c.id = ${antes})`
        : conn``;
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from memoria_diario
        where tenant_id = ${escopo.tenantId} and agente_id = ${agenteId} ${cursor}
        order by criado_em desc, id desc limit ${limite + 1}`;
      return { entradas: linhas.slice(0, limite).map(paraEntrada), mais: linhas.length > limite };
    },

    /** Só as mudanças do bot ainda não revisadas: as da pessoa nunca contam. */
    async contarARevisar(agenteId: string): Promise<number> {
      const [l] = await conn<{ n: number }[]>`
        select count(*)::int as n from memoria_diario
        where tenant_id = ${escopo.tenantId} and agente_id = ${agenteId} and autor = 'agente' and revisada_em is null`;
      return l?.n ?? 0;
    },

    async buscar(agenteId: string, id: string): Promise<EntradaDiarioCompleta | null> {
      const [l] = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from memoria_diario where tenant_id = ${escopo.tenantId} and agente_id = ${agenteId} and id = ${id}`;
      return l ? paraEntrada(l) : null;
    },

    /** A entrada mais nova da memória: só ela pode ser desfeita. */
    async ultimaDaMemoria(memoriaId: string): Promise<EntradaDiarioCompleta | null> {
      const [l] = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from memoria_diario where tenant_id = ${escopo.tenantId} and memoria_id = ${memoriaId}
        order by criado_em desc, id desc limit 1`;
      return l ? paraEntrada(l) : null;
    },

    /** A desfeita sai também do contador (revisada junto). */
    async marcarDesfeita(id: string): Promise<EntradaDiarioCompleta | null> {
      const [l] = await conn<Linha[]>`
        update memoria_diario set desfeita_em = clock_timestamp(), revisada_em = coalesce(revisada_em, clock_timestamp())
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and desfeita_em is null
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraEntrada(l) : null;
    },

    /** Marca como revisadas as mudanças do bot: uma (`entradaId`) ou todas. Devolve quantas mudaram. */
    async revisar(agenteId: string, entradaId?: string | null): Promise<number> {
      const so = entradaId ? conn`and id = ${entradaId}` : conn``;
      const r = await conn`
        update memoria_diario set revisada_em = clock_timestamp()
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and agente_id = ${agenteId}
          and autor = 'agente' and revisada_em is null ${so}`;
      return r.count;
    },
  };
}
