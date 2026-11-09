-- definido em 2026-11-01 (NOD-448): as colunas do quadro passam a ser da pessoa. Ficam no próprio quadro (jsonb, a lista
-- na ordem: {id, nome, grupo}), para mudar no mesmo lote travado das tarefas e voltar pela foto do Desfazer (ADR-140).
-- null = as colunas padrão: todo quadro de antes fica igual. O status da tarefa passa a ser o id da coluna (uma das 8
-- chaves padrão ou c-<slug>), então o CHECK da lista fixa vira um CHECK de forma; a coluna existir é regra do domínio
-- (src/domain/colunas.ts), conferida com o quadro travado. voltar_para guarda a coluna de onde a tarefa saiu para
-- esperar a pessoa (a resposta a devolve para lá, não mais sempre para Fazendo).
-- Só adição: o servidor antigo no ar não lê colunas nem voltar_para; ele só escreve status padrão, que o CHECK novo aceita.
SET LOCAL lock_timeout = '5s';

ALTER TABLE quadros ADD COLUMN colunas jsonb;
ALTER TABLE quadros ADD CONSTRAINT quadros_colunas_lista CHECK (colunas IS NULL OR (jsonb_typeof(colunas) = 'array' AND jsonb_array_length(colunas) BETWEEN 1 AND 30));

ALTER TABLE quadro_tarefas ADD COLUMN voltar_para text CHECK (voltar_para IS NULL OR voltar_para ~ '^[a-z0-9-]{1,48}$');
ALTER TABLE quadro_tarefas DROP CONSTRAINT quadro_tarefas_status_check;
ALTER TABLE quadro_tarefas ADD CONSTRAINT quadro_tarefas_status_forma CHECK (status ~ '^[a-z0-9-]{1,48}$');

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- -- Ordem: pare o servidor novo (ou ponha em manutenção), rode este bloco e só então suba a versão de antes da NOD-448;
-- -- o servidor antigo no ar com tarefas em colunas c-… as mostraria sem coluna. As tarefas nas colunas da pessoa voltam à coluna padrão do grupo (nenhuma se perde); só
-- -- os lotes cuja foto guarda colunas DA PESSOA ficam desfeitos (o Desfazer antigo não sabe voltar colunas; a foto de
-- -- um quadro com as padrão tem colunas null e segue desfazível). Rode numa transação só.
-- UPDATE quadro_tarefas t SET status = CASE c->>'grupo' WHEN 'iniciado' THEN 'fazendo' WHEN 'feito' THEN 'feito'
--     WHEN 'fechado' THEN 'cancelado' ELSE 'backlog' END
--   FROM quadros q, jsonb_array_elements(q.colunas) c
--   WHERE q.tenant_id = t.tenant_id AND q.id = t.quadro_id AND c->>'id' = t.status
--     AND t.status NOT IN ('backlog', 'afazer', 'fazendo', 'voce', 'revisao', 'bloqueado', 'feito', 'cancelado');
-- UPDATE quadro_tarefas SET status = 'backlog' WHERE status NOT IN ('backlog', 'afazer', 'fazendo', 'voce', 'revisao', 'bloqueado', 'feito', 'cancelado');
-- UPDATE quadro_lotes SET desfeito_em = clock_timestamp() WHERE desfeito_em IS NULL AND jsonb_typeof(antes->'quadro'->'colunas') = 'array';
-- ALTER TABLE quadro_tarefas DROP CONSTRAINT quadro_tarefas_status_forma;
-- ALTER TABLE quadro_tarefas ADD CONSTRAINT quadro_tarefas_status_check CHECK (status IN ('backlog', 'afazer', 'fazendo', 'voce', 'revisao', 'bloqueado', 'feito', 'cancelado'));
-- ALTER TABLE quadro_tarefas DROP COLUMN voltar_para;
-- ALTER TABLE quadros DROP CONSTRAINT quadros_colunas_lista;
-- ALTER TABLE quadros DROP COLUMN colunas;
