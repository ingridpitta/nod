-- NOD-276 (definido em 2026-10-15, J3): a hora em que a máquina pegou o turno (`reivindicar`). "Trabalhando · há N" contava
-- de `criado_em`, que é quando o turno entrou na fila: o turno que esperou 20 min na fila nascia "trabalhando há 20 min".
-- null = turno de antes desta coluna, ou que nunca saiu da fila; quem lê usa `criado_em` no lugar.
-- Só adição (expand-only): o código anterior não lê esta coluna.
SET LOCAL lock_timeout = '5s';

ALTER TABLE turnos ADD COLUMN IF NOT EXISTS despachado_em timestamptz;

-- ROLLBACK:
-- -- O código anterior não lê esta coluna: voltar a imagem basta. Para tirar o que foi criado:
-- ALTER TABLE turnos DROP COLUMN IF EXISTS despachado_em;
