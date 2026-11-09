-- definido em 2026-10-24 (NOD-97 PR 6, emenda da ADR-122): "Esquecer senhas salvas" é uma operação do computador da
-- pessoa como Atualizar, Redefinir e Sair de todos os sites. Apaga as senhas que o Chrome guardou (a loja em comum e o
-- Login Data de cada perfil) e religa as telas abertas. Fica sozinha nesta migração porque um valor novo de enum não
-- pode ser usado na mesma transação que o criou (como na 0047).
ALTER TYPE operacao_computador ADD VALUE IF NOT EXISTS 'esquecer_senhas';

-- ROLLBACK:
-- -- O Postgres não remove valor de enum: o rollback recria o tipo sem 'esquecer_senhas' (NOD-195), com o mesmo nome e
-- -- a mesma ordem. Antes, zere as operações em curso que usam o valor novo:
-- -- UPDATE computadores SET operacao = NULL, operacao_desde = NULL, operacao_progresso = NULL, operacao_etapa = NULL
-- --   WHERE operacao = 'esquecer_senhas';
-- -- Com alguma linha ainda no valor, o cast falha e a transação inteira volta. Rode o bloco numa transação só
-- -- (`psql -1 -v ON_ERROR_STOP=1`). Nenhum índice, default ou função cita operacao_computador (só computadores.operacao).
-- ALTER TYPE operacao_computador RENAME TO operacao_computador_0112;
-- CREATE TYPE operacao_computador AS ENUM ('atualizar', 'redefinir', 'sair_de_todos');
-- ALTER TABLE computadores ALTER COLUMN operacao TYPE operacao_computador USING operacao::text::operacao_computador;
-- DROP TYPE operacao_computador_0112;
