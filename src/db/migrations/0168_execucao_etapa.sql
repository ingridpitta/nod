-- definido em 2026-11-10 (decisão do Marlon, o `stepMoved` do Multica; ADR-142 §acionamento): o trabalho fica preso à
-- etapa em que começou. quadro_execucoes.etapa = a coluna da tarefa quando o trabalho nasceu. Mover a tarefa para outra
-- etapa não corta o turno vivo do anterior (a não ser que a pessoa peça "Parar"); ele termina, mas não muda mais o status:
-- o lote dele que tenta mudar a coluna é recusado ("a tarefa foi movida por X para Y enquanto você trabalhava").
-- Null = trabalho de antes desta migração (não fica preso a nada).
-- Só adição: o servidor antigo no ar não lê nem grava a coluna.
SET LOCAL lock_timeout = '5s';

ALTER TABLE quadro_execucoes ADD COLUMN etapa text CHECK (etapa IS NULL OR length(etapa) <= 48);

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- ALTER TABLE quadro_execucoes DROP COLUMN etapa;
