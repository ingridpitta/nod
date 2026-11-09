-- definido em 2026-10-20 (NOD-282, frente de lote chega certa ao dono):
-- 1) G6: o item de aprovação cuja ação equivalente já saiu numa decisão posterior da mesma faixa fecha como
--    'ja_executado' — o conector não é chamado de novo. O valor novo não é usado nesta transação.
-- 2) G7: a frente reaberta que já tinha voltado ao dono guarda o resumo de antes em `resumo_anterior`; quando ela volta a
--    final com o lote já devolvido, o retorno complementar só sai se o resumo novo for diferente.
-- Só adição (expand-only): valor de enum novo e coluna nula, sem default; o código anterior não lê nenhum dos dois.
SET LOCAL lock_timeout = '5s';

ALTER TYPE desfecho_item ADD VALUE IF NOT EXISTS 'ja_executado';

ALTER TABLE trabalhos ADD COLUMN resumo_anterior jsonb;

-- ROLLBACK:
-- -- O Postgres não remove valor de enum: o rollback recria o tipo sem 'ja_executado' (NOD-195), com o mesmo nome e a
-- -- mesma ordem. Antes, troque os itens 'ja_executado' (a ação saiu, só não de novo) por 'executado':
-- -- UPDATE itens_aprovacao SET desfecho = 'executado' WHERE desfecho = 'ja_executado';
-- -- Com alguma linha ainda usando o valor, o cast falha e a transação inteira volta. Rode o bloco numa transação só
-- -- (`psql -1 -v ON_ERROR_STOP=1`). Nenhum índice, default ou função cita desfecho_item (só itens_aprovacao.desfecho).
-- ALTER TABLE trabalhos DROP COLUMN resumo_anterior;
-- ALTER TYPE desfecho_item RENAME TO desfecho_item_0100;
-- CREATE TYPE desfecho_item AS ENUM ('executado', 'retirado_pela_pessoa', 'sensivel_nao_aprovado', 'falhou_na_execucao');
-- ALTER TABLE itens_aprovacao ALTER COLUMN desfecho TYPE desfecho_item USING desfecho::text::desfecho_item;
-- DROP TYPE desfecho_item_0100;
