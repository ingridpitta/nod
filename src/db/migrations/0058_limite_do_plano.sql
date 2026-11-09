-- definido em 2026-10-06 (NOD-171): o plano do Claude Code atingiu o limite de uso.
--
-- Até aqui o turno barrado pelo limite virava `erro_execucao` e a pessoa lia "a IA parou por um erro; tente de novo",
-- sem saber que esperar resolve. O motivo vem do PROTOCOLO (ADR-009): `rate_limit_event` com status `rejected` na
-- rodada, seguido de `result` com erro (src/domain/stream-json.ts). No fim da lista, como em MOTIVOS_FALHA (o gate
-- motivos-enum compara a ordem). Nenhum valor novo é usado nesta migração.
ALTER TYPE motivo_falha ADD VALUE IF NOT EXISTS 'limite_do_plano';

-- ROLLBACK:
-- (o valor 'limite_do_plano' fica: Postgres não remove valor de enum; antes, troque as linhas que o usam)
