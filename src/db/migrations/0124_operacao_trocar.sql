-- definido em 2026-10-28 (NOD-365): "Trocar de máquina" é uma operação do computador da pessoa como Atualizar e
-- Redefinir: enquanto a loja de logins muda de máquina, os bots esperam (operacaoViva) e uma segunda troca é recusada.
-- Fica sozinha nesta migração porque um valor novo de enum não pode ser usado na mesma transação que o criou (como na 0112).
ALTER TYPE operacao_computador ADD VALUE IF NOT EXISTS 'trocar';

-- ROLLBACK:
-- -- O Postgres não remove valor de enum: o rollback recria o tipo sem 'trocar', com o mesmo nome e a mesma ordem.
-- -- Antes, zere as operações em curso que usam o valor novo:
-- UPDATE computadores SET operacao = NULL, operacao_desde = NULL, operacao_progresso = NULL, operacao_etapa = NULL
--   WHERE operacao = 'trocar';
-- -- Rode o bloco numa transação só (`psql -1 -v ON_ERROR_STOP=1`). Só computadores.operacao cita operacao_computador.
-- ALTER TYPE operacao_computador RENAME TO operacao_computador_0124;
-- CREATE TYPE operacao_computador AS ENUM ('atualizar', 'redefinir', 'sair_de_todos', 'esquecer_senhas');
-- ALTER TABLE computadores ALTER COLUMN operacao TYPE operacao_computador USING operacao::text::operacao_computador;
-- DROP TYPE operacao_computador_0124;
