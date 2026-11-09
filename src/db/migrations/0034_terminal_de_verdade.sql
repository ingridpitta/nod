-- 0034 o terminal de verdade no Mac da pessoa: cada comando que altera algo pede aprovação. Convenção
-- `-- ROLLBACK:`. Só aditiva.
--
-- definido em 2026-09-28 (ADR-055, "terminal de verdade, como o inhouse"): o Bash do bot roda sem sandbox, com
-- a rede e as credenciais da pessoa. O que só lê roda direto; o resto vira item de aprovação com destino
-- 'terminal', e o motivo do card é o destino (como o computador do bot).
--
-- turnos.terminal_liberado_em: a pessoa respondeu "Pode fazer e o resto desta tarefa" num comando — vale para o
-- turno raiz e as retomadas dele, nunca para outra tarefa (a mesma regra de computador_liberado_em, 0032).

ALTER TYPE motivo_aprovacao_manual ADD VALUE IF NOT EXISTS 'destino_terminal';
ALTER TABLE turnos ADD COLUMN IF NOT EXISTS terminal_liberado_em timestamptz;

-- ROLLBACK:
-- ALTER TABLE turnos DROP COLUMN IF EXISTS terminal_liberado_em;
-- (o valor 'destino_terminal' do enum fica: Postgres não remove valor de enum; antes,
--  UPDATE itens_aprovacao SET motivo_manual = 'destino_computador' WHERE motivo_manual = 'destino_terminal')
