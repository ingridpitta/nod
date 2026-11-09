-- definido em 2026-10-24 (NOD-326): a Biblioteca da gaveta do bot lista a mídia que o bot anexou numa conversa, do mais
-- recente ao mais antigo, paginada pela chave (criado_em, id). Só um índice parcial: a mídia do bot já presa a uma fala.
-- `anexos` ainda é pequena (uploads da pessoa e a mídia do bot desde a NOD-323): o CREATE INDEX comum segura o SHARE lock
-- por pouco; o lock_timeout faz o deploy falhar limpo em vez de enfileirar a cor que serve.
SET LOCAL lock_timeout = '5s';

CREATE INDEX anexos_da_biblioteca ON anexos (tenant_id, conversa_id, criado_em DESC, id DESC)
  WHERE origem = 'bot' AND mensagem_id IS NOT NULL;

-- ROLLBACK:
-- -- O código anterior não usa o índice: voltar a imagem basta.
-- DROP INDEX anexos_da_biblioteca;
