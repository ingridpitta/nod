import type { AutorMemoria, Memoria, TipoMemoria } from "../contracts/memoria.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { ms } from "./conversao.ts";

interface Linha {
  tenant_id: string;
  id: string;
  agente_id: string;
  tipo: TipoMemoria;
  texto: string;
  origem: AutorMemoria;
  criado_em: Date;
}

const COLUNAS = "tenant_id, id, agente_id, tipo, texto, origem, criado_em";

const paraMemoria = (l: Linha): Memoria => ({
  tenantId: l.tenant_id,
  id: l.id,
  agenteId: l.agente_id,
  tipo: l.tipo,
  texto: l.texto,
  origem: l.origem,
  criadoEm: ms(l.criado_em),
});

export type NovaMemoria = {
  id?: string;
  agenteId: string;
  tipo: TipoMemoria;
  texto: string;
  origem: AutorMemoria;
  /** Recriar no lugar (desfazer uma remoção): a data original da memória. */
  criadoEm?: number;
};

/**
 * Como a escrita entra no diário (NOD-58). `autor` é quem fez a mudança (na criação, por padrão, a origem);
 * `desfazId` marca que esta escrita desfaz aquela entrada; `diario: false` só para cópia (duplicar bot), que não é mudança.
 */
export type OpcoesDiario = { autor?: AutorMemoria; desfazId?: string | null; diario?: boolean };

/**
 * Memória por bot: editável pela pessoa; injetada no prompt com "não substitui fonte autoritativa".
 * NOD-58: criar, atualizar e apagar gravam a entrada do diário NO MESMO STATEMENT (CTE): a escrita e o diário
 * nunca se separam, venha de onde vier a chamada.
 */
export function memoriasRepo(conn: Conn, escopo: Escopo) {
  return {
    async criar(m: NovaMemoria, op: OpcoesDiario = {}): Promise<Memoria | null> {
      const autor = op.autor ?? m.origem;
      const criadoEm = m.criadoEm === undefined ? conn`clock_timestamp()` : conn`${new Date(m.criadoEm)}::timestamptz`;
      const [l] = await conn<Linha[]>`
        with m as (
          insert into agente_memorias (tenant_id, id, owner_id, agente_id, tipo, texto, origem, criado_em)
          values (${escopo.tenantId}, ${m.id ?? conn`gen_random_uuid()`}, ${escopo.pessoaId}, ${m.agenteId}, ${m.tipo}, ${m.texto}, ${m.origem}, ${criadoEm})
          returning *
        ), d as (
          insert into memoria_diario (tenant_id, owner_id, agente_id, memoria_id, acao, autor, memoria_origem, memoria_criado_em, depois_tipo, depois_texto, desfaz_id)
          select m.tenant_id, m.owner_id, m.agente_id, m.id, 'criada', ${autor}, m.origem, m.criado_em, m.tipo, m.texto, ${op.desfazId ?? null}
          from m where ${op.diario !== false}
        )
        select ${conn.unsafe(COLUNAS)} from m`;
      return l ? paraMemoria(l) : null;
    },

    async buscar(id: string): Promise<Memoria | null> {
      const [l] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from agente_memorias where tenant_id = ${escopo.tenantId} and id = ${id}`;
      return l ? paraMemoria(l) : null;
    },

    async listarDoAgente(agenteId: string): Promise<Memoria[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from agente_memorias where tenant_id = ${escopo.tenantId} and agente_id = ${agenteId} order by criado_em, id`;
      return linhas.map(paraMemoria);
    },

    /**
     * NOD-60 (ADR-136): as memórias do bot que casam com `consulta` (busca léxica `nod_pt` na coluna gerada da 0123,
     * pelo índice do bot), da mais relevante para a menos. Um termo basta (OU entre os termos): a pergunta
     * "qual o CNPJ da Lumen?" acha "o CNPJ da Lumen é X" mesmo sem "qual". Consulta só de stopwords não acha nada.
     * O rank divide pelo log do tamanho (normalização 1): a memória longa não vence só por ser longa. O `&` do plainto_tsquery vira `|`: os lexemas saem entre aspas e sem espaço, então o separador " & " é único.
     */
    async buscarPorTexto(agenteId: string, consulta: string, limite: number): Promise<Memoria[]> {
      const linhas = await conn<Linha[]>`
        with q as (select replace(plainto_tsquery('nod_pt', ${consulta})::text, ' & ', ' | ')::tsquery as q)
        select ${conn.unsafe(COLUNAS)} from agente_memorias, q
        where tenant_id = ${escopo.tenantId} and agente_id = ${agenteId} and search_tsv @@ q.q
        order by ts_rank(search_tsv, q.q, 1) desc, criado_em desc, id
        limit ${limite}`;
      return linhas.map(paraMemoria);
    },

    /** Edição sem mudança real (mesmo texto e tipo) não entra no diário. */
    async atualizar(id: string, campos: { texto?: string; tipo?: TipoMemoria }, op: OpcoesDiario & { autor: AutorMemoria }): Promise<Memoria | null> {
      const [l] = await conn<Linha[]>`
        with velha as (
          select * from agente_memorias where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} for update
        ), m as (
          update agente_memorias a set texto = coalesce(${campos.texto ?? null}, a.texto), tipo = coalesce(${campos.tipo ?? null}, a.tipo)
          from velha v where a.tenant_id = v.tenant_id and a.id = v.id
          returning a.*
        ), d as (
          insert into memoria_diario (tenant_id, owner_id, agente_id, memoria_id, acao, autor, memoria_origem, memoria_criado_em, antes_tipo, antes_texto, depois_tipo, depois_texto, desfaz_id)
          select m.tenant_id, m.owner_id, m.agente_id, m.id, 'editada', ${op.autor}, m.origem, m.criado_em, v.tipo, v.texto, m.tipo, m.texto, ${op.desfazId ?? null}
          from m join velha v on v.tenant_id = m.tenant_id and v.id = m.id
          where ${op.diario !== false} and (v.texto is distinct from m.texto or v.tipo is distinct from m.tipo)
        )
        select ${conn.unsafe(COLUNAS)} from m`;
      return l ? paraMemoria(l) : null;
    },

    /** Devolve a memória como era antes de sair (null se não havia). */
    async apagar(id: string, op: OpcoesDiario & { autor: AutorMemoria }): Promise<Memoria | null> {
      const [l] = await conn<Linha[]>`
        with m as (
          delete from agente_memorias where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} returning *
        ), d as (
          insert into memoria_diario (tenant_id, owner_id, agente_id, memoria_id, acao, autor, memoria_origem, memoria_criado_em, antes_tipo, antes_texto, desfaz_id)
          select m.tenant_id, m.owner_id, m.agente_id, m.id, 'apagada', ${op.autor}, m.origem, m.criado_em, m.tipo, m.texto, ${op.desfazId ?? null}
          from m where ${op.diario !== false}
        )
        select ${conn.unsafe(COLUNAS)} from m`;
      return l ? paraMemoria(l) : null;
    },

    /** Serializa quem mexe na mesma memória (editar, apagar, desfazer) até o fim da transação. */
    async travar(id: string): Promise<void> {
      await conn`select pg_advisory_xact_lock(hashtext(${escopo.tenantId}), hashtext(${`memoria:${id}`}))`;
    },
  };
}
