-- definido em 2026-10-04 (ADR-072, modo ligação): o turno que é o cérebro de uma ligação por voz tem origem própria.
-- Ele não é 'conversa' (não serializa com o trabalho do bot nem absorve mensagens da fila) nem 'peer'. Fica sozinho
-- nesta migração porque um valor novo de enum não pode ser usado na mesma transação que o criou (como na 0028).
ALTER TYPE origem_turno ADD VALUE IF NOT EXISTS 'ligacao';

-- ROLLBACK:
-- (o valor 'ligacao' fica: Postgres não remove valor de enum; antes, UPDATE turnos SET origem = 'conversa' WHERE origem = 'ligacao')
