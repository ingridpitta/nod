-- definido em 2026-10-27 (ADR-131): motivo_interrupcao += 'reinicio_do_motor'. O motor da máquina (o nod do Mac ou o motor
-- da VM) parou no meio do turno e entregou com a causa `reinicio_do_motor` — o motor que se atualiza sozinho (ADR-100),
-- o `systemctl restart`, o app fechado. É queda, não trabalho incompleto: o fundo volta para a fila na hora, com a sessão
-- do CLI, e não gasta o teto de quedas da cadeia. Sozinho nesta migração: o valor novo só é usado pelo código, nunca
-- nesta transação (como na 0060 e na 0099).
SET LOCAL lock_timeout = '5s';

ALTER TYPE motivo_interrupcao ADD VALUE IF NOT EXISTS 'reinicio_do_motor';

-- ROLLBACK:
-- -- Na prática basta reverter o código: o valor novo fica no enum sem ninguém o gravar, e o código antigo o lê como
-- -- motivo sem tradução (motivoEmPortugues devolve o próprio código). Este bloco desfaz o schema de verdade (NOD-195):
-- -- o Postgres não remove valor de enum, então o tipo é recriado sem ele, com o mesmo nome e a mesma ordem (modelo da
-- -- 0060/0088/0099). Com alguma linha usando 'reinicio_do_motor', o cast falha e a transação inteira volta (nada é
-- -- apagado aqui): antes, troque essas linhas, por exemplo
-- -- UPDATE turnos SET motivo_interrupcao = 'trabalho_incompleto' WHERE motivo_interrupcao = 'reinicio_do_motor';
-- -- UPDATE relatos SET motivo_interrupcao = 'trabalho_incompleto' WHERE motivo_interrupcao = 'reinicio_do_motor';
-- -- Rode o bloco numa transação só (`psql -1 -v ON_ERROR_STOP=1`).
-- ALTER TYPE motivo_interrupcao RENAME TO motivo_interrupcao_0122;
-- CREATE TYPE motivo_interrupcao AS ENUM ('parado_pela_pessoa', 'maquina_sem_contato', 'reinicio_servidor', 'sem_progresso',
--   'lancamento_falhou', 'sessao_rejeitada', 'executor_indisponivel', 'turno_travado', 'trabalho_incompleto', 'absorvido',
--   'vencido', 'maquina_removida');
-- ALTER TABLE turnos ALTER COLUMN motivo_interrupcao TYPE motivo_interrupcao USING motivo_interrupcao::text::motivo_interrupcao;
-- ALTER TABLE relatos ALTER COLUMN motivo_interrupcao TYPE motivo_interrupcao USING motivo_interrupcao::text::motivo_interrupcao;
-- DROP TYPE motivo_interrupcao_0122;
