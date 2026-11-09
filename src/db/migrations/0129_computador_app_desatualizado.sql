-- definido em 2026-10-30 (NOD-407): o app abaixo do piso próprio do computador falha com código fechado e não conta
-- para a saúde da máquina. Sozinho nesta migração: o valor novo só é usado pelo código depois do deploy.
SET LOCAL lock_timeout = '5s';

ALTER TYPE motivo_falha_computador ADD VALUE IF NOT EXISTS 'app_desatualizado';

-- ROLLBACK:
-- -- Antes: esvazie NOD_COMPUTADOR_VERSAO_MINIMA e volte o código anterior (nada mais grava o valor).
-- -- O Postgres não remove valor de enum: recria sem `app_desatualizado`, com o mesmo nome e ordem. Se alguma tentativa
-- -- já o gravou, o cast falha e a transação inteira volta; antes, troque essas linhas para `acao_falhou`. Rode o bloco
-- -- numa transação só (`psql -1 -v ON_ERROR_STOP=1`).
-- ALTER TYPE motivo_falha_computador RENAME TO motivo_falha_computador_0129;
-- CREATE TYPE motivo_falha_computador AS ENUM ('docker_indisponivel', 'imagem_ausente', 'nao_iniciou', 'cofre_invalido',
--   'navegador_nao_abriu', 'sem_resposta', 'acao_falhou', 'tela_alterada', 'ocupado', 'limite_de_computadores',
--   'maquina_sem_contato', 'faltam_pacotes', 'sem_suporte', 'nao_ficou_pronto', 'atualizando');
-- ALTER TABLE computador_acoes ALTER COLUMN motivo TYPE motivo_falha_computador USING motivo::text::motivo_falha_computador;
-- ALTER TABLE computadores ALTER COLUMN falha_motivo TYPE motivo_falha_computador USING falha_motivo::text::motivo_falha_computador;
-- ALTER TABLE computador_telas ALTER COLUMN falha_motivo TYPE motivo_falha_computador USING falha_motivo::text::motivo_falha_computador;
-- DROP TYPE motivo_falha_computador_0129;
