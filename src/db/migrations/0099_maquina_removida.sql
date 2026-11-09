-- definido em 2026-10-20 (NOD-293 A7): motivo_interrupcao += 'maquina_removida'. A pessoa revogou a chave da máquina com
-- um turno rodando nela: o varredor de lease assenta o turno com este motivo, sem aviso de "sem contato" (incidente) —
-- a máquina não caiu, foi removida. O Retomar do turno segue a regra de alvo normal (alvo-da-maquina.ts ignora chave
-- revogada). Sozinho nesta migração: o valor novo só é usado pelo código, nunca nesta transação (como na 0060).
SET LOCAL lock_timeout = '5s';

ALTER TYPE motivo_interrupcao ADD VALUE IF NOT EXISTS 'maquina_removida';

-- ROLLBACK:
-- -- Na prática basta reverter o código: o valor novo fica no enum sem ninguém o gravar, e o código antigo o lê como
-- -- motivo sem tradução (motivoEmPortugues devolve o próprio código). Este bloco desfaz o schema de verdade (NOD-195):
-- -- o Postgres não remove valor de enum, então o tipo é recriado sem ele, com o mesmo nome e a mesma ordem (modelo da
-- -- 0060/0088). Com alguma linha usando 'maquina_removida', o cast falha e a transação inteira volta (nada é apagado
-- -- aqui): antes, troque essas linhas, por exemplo
-- -- UPDATE turnos SET motivo_interrupcao = 'maquina_sem_contato' WHERE motivo_interrupcao = 'maquina_removida';
-- -- UPDATE relatos SET motivo_interrupcao = 'maquina_sem_contato' WHERE motivo_interrupcao = 'maquina_removida';
-- -- Rode o bloco numa transação só (`psql -1 -v ON_ERROR_STOP=1`).
-- ALTER TYPE motivo_interrupcao RENAME TO motivo_interrupcao_0099;
-- CREATE TYPE motivo_interrupcao AS ENUM ('parado_pela_pessoa', 'maquina_sem_contato', 'reinicio_servidor', 'sem_progresso',
--   'lancamento_falhou', 'sessao_rejeitada', 'executor_indisponivel', 'turno_travado', 'trabalho_incompleto', 'absorvido',
--   'vencido');
-- ALTER TABLE turnos ALTER COLUMN motivo_interrupcao TYPE motivo_interrupcao USING motivo_interrupcao::text::motivo_interrupcao;
-- ALTER TABLE relatos ALTER COLUMN motivo_interrupcao TYPE motivo_interrupcao USING motivo_interrupcao::text::motivo_interrupcao;
-- DROP TYPE motivo_interrupcao_0099;
