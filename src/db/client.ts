import postgres from "postgres";
import type { Db } from "../shared/types.ts";

/**
 * Pool do postgres.js.
 * prepare:false — definido em 2026-09-16: o deploy alvo usa pooler em modo transação, que não
 * suporta prepared statements (ADR-001; o sintoma está descrito em docs/praticas-herdadas.md). A emenda de 2026-10-15
 * registra que produção hoje vai direto ao Cloud SQL; fica false para o pooler poder voltar sem mudar código.
 * idle_timeout — é o parâmetro que de fato protege contra esgotamento, não o `max` (ADR-001).
 * onnotice — definido em 2026-09-16: NOTICE (ex. "drop cascades to ...") não é erro e o default do
 * postgres.js o imprime via console, fora do wrapper único de log (Práticas §10); silenciado aqui.
 */
/**
 * Tamanho do pool do servidor, de NOD_DB_POOL_MAX. definido em 2026-10-15 (NOD-266, emenda da ADR-001): padrão 15 —
 * o 5 fixo se esgotou com conectores lentos segurando conexão dentro da tx (15/10, ~2 h fora). O teto 50 fica abaixo
 * do max_connections 100 do Cloud SQL do deploy (sem pooler), com folga para o dono, a poda e as migrações. Valor fora de 1..50 (ou
 * não inteiro) derruba o boot em vez de cair num padrão em silêncio.
 */
export const POOL_MAX_PADRAO = 15;
export const POOL_MAX_TETO = 50;
export function lerPoolMax(env: Readonly<Record<string, string | undefined>>): number {
  const bruto = env.NOD_DB_POOL_MAX?.trim();
  if (bruto === undefined || bruto === "") return POOL_MAX_PADRAO;
  const n = Number(bruto);
  if (!/^\d+$/.test(bruto) || !Number.isInteger(n) || n < 1 || n > POOL_MAX_TETO) {
    throw new Error(`NOD_DB_POOL_MAX: "${bruto}" não é um inteiro de 1 a ${POOL_MAX_TETO}`);
  }
  return n;
}

export function criarDb(url: string, opcoes: { max?: number } = {}): Db {
  return postgres(url, {
    prepare: false,
    max: opcoes.max ?? 5,
    idle_timeout: 20,
    connect_timeout: 5,
    onnotice: () => {},
  });
}
