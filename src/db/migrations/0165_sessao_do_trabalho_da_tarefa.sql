-- definido em 2026-11-11 (ADA-10, emenda da ADR-163 §3): o número que a pessoa vê no trabalho da tarefa é a SESSÃO do bot,
-- não o gatilho. Antes, cada entrada numa coluna que aciona gravava uma linha com `numero` + 1 e a tela dizia
-- "Trabalho #7" na ADA-7, como se cada etapa abrisse uma sessão nova; desde a ADA-16 a etapa seguinte do mesmo bot já
-- continuava o mesmo trabalho e a mesma sessão (--resume), só o número mentia.
--
-- - sessao: a sessão do gatilho. O mesmo bot na mesma tarefa repete a sessão dele; outro bot, ou o Repetir, abre a
--   seguinte (max + 1). `numero` continua o gatilho (a ordem interna, o varredor e cadeiaDoQuadroEncerrada não mudam).
-- - agente_id: o bot do gatilho (o do turno raiz). Sem FK: o turno é podado e o bot pode ser excluído.
-- - coluna: a coluna da tarefa quando o gatilho abriu (a etapa, na linha do trabalho). Texto livre: a coluna pode sair.
-- Backfill: sessao = numero (o passado não se reescreve) e o bot pelo turno raiz, quando ele ainda existe.
-- Só adição: o servidor antigo no ar não lê as colunas novas; o insert dele deixa sessao null e o novo trata null como
-- "sem sessão" (coalesce no max), então a ida e a volta convivem no mesmo deploy.
SET LOCAL lock_timeout = '5s';

ALTER TABLE quadro_execucoes ADD COLUMN sessao integer CHECK (sessao IS NULL OR sessao >= 1);
ALTER TABLE quadro_execucoes ADD COLUMN agente_id uuid;
ALTER TABLE quadro_execucoes ADD COLUMN coluna text CHECK (coluna IS NULL OR length(coluna) <= 60);

UPDATE quadro_execucoes SET sessao = numero WHERE sessao IS NULL;
UPDATE quadro_execucoes e SET agente_id = t.agente_id
  FROM turnos t WHERE t.tenant_id = e.tenant_id AND t.id = e.turno_id AND e.agente_id IS NULL;

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- ALTER TABLE quadro_execucoes DROP COLUMN coluna;
-- ALTER TABLE quadro_execucoes DROP COLUMN agente_id;
-- ALTER TABLE quadro_execucoes DROP COLUMN sessao;
