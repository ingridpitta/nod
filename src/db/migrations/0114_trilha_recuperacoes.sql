-- definido em 2026-10-27 (NOD-374, revisão 3 do PR #538): a Atividade do bot lê as voltas do app ("Gmail voltou sozinho",
-- kind conector_recuperado) por bot e dia: índice parcial como o das negações (0091). Sozinho nesta migração (cada uma
-- roda numa transação, migrar.ts): a construção trava só as escritas na trilha, sem nenhuma outra trava presa junto — a
-- fase 2 da chamada (que trava o conector e depois grava na trilha) só espera, sem deadlock. Sem CONCURRENTLY (a migração
-- roda em transação); o índice é parcial e nasce vazio de entradas, mas a construção ainda varre a trilha. lock_timeout de
-- 5 s: se a trava não vier, a migração falha e o deploy para, em vez de segurar o servidor esperando.
SET LOCAL lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS trilha_recuperacoes_por_agente ON trilha (tenant_id, agente_id, em) WHERE kind = 'conector_recuperado';

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- DROP INDEX IF EXISTS trilha_recuperacoes_por_agente;
