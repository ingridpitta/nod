-- definido em 2026-09-24 (ADR-047): tarefa delegada carrega o pedido da pessoa. `delegar_tarefa` agenda no
-- alvo um turno de origem própria — nem 'peer' (outro bot, não supervisionado, catálogo só `lembrar`) nem
-- 'conversa' (a pessoa não falou com o alvo). O valor novo só é USADO por código posterior a esta
-- migração: ADD VALUE não pode ser usado na mesma transação que o criou.
ALTER TYPE origem_turno ADD VALUE IF NOT EXISTS 'delegacao';

-- Quem PEDIU o trabalho do turno (ADR-025: sob_procuracao_de ≠ conta_de_execucao). NULL em todo turno
-- anterior e em todo turno que não seja delegação: a pessoa falou direto, ou ninguém pediu (rotina, peer).
-- Mesma forma da coluna em events e mensagens (0001/0002): uuid sem FK.
ALTER TABLE turnos ADD COLUMN sob_procuracao_de uuid;

-- ROLLBACK:
-- ALTER TABLE turnos DROP COLUMN sob_procuracao_de;
-- (o valor 'delegacao' do enum fica: Postgres não remove valor de enum; antes, UPDATE turnos SET origem = 'peer' WHERE origem = 'delegacao')
