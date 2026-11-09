// Tipos que DUAS camadas exigem hoje. Estreito de propósito: revisar quando passar de ~200 linhas
// (Práticas §O que não trazer, src/types.ts de 350 linhas). Só tipos — nada de lógica.
import type postgres from "postgres";

/** Pool do postgres.js (produção e helpers de teste). */
export type Db = postgres.Sql;
/** Transação aberta (BEGIN ... ou SAVEPOINT quando aninhada). */
export type Tx = postgres.TransactionSql;
/** Repositórios aceitam os dois na PRIMEIRA linha escrita — zero `as unknown as` (ADR-018 refinado). */
export type Conn = Db | Tx;

/** Escopo obrigatório de toda transação: tenant E pessoa, sem default (ADR-003 revisado). */
export interface Escopo {
  tenantId: string;
  pessoaId: string;
}

/** Relógio injetado: o domínio nunca lê Date.now(). */
export type Relogio = () => number;

/**
 * Transação como FÁBRICA (Práticas §1): em produção abre envelope real; no teste devolve o
 * envelope condenado do withRollback; no unitário `(fn) => fn(reposFalsos)`.
 */
export type Transacao = <T>(fn: (trx: Tx) => Promise<T>) => Promise<T>;
