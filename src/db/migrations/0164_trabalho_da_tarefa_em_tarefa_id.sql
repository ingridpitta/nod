-- definido em 2026-11-10 (ADA-289, PR #723): uma coluna só para "a tarefa do quadro deste trabalho".
-- A 0153 (ADA-232, main) criou trabalhos.tarefa_id para a FRENTE aberta por um turno de tarefa; a 0163 (ADA-16, #698)
-- criou trabalhos.quadro_tarefa_id para o TRABALHO da própria tarefa (origem 'quadro'). As duas apontam para
-- quadro_tarefas com o mesmo ON DELETE SET NULL. A 0163 fica como está (já rodou no servidor de teste); esta copia
-- quadro_tarefa_id para tarefa_id e apaga quadro_tarefa_id. O código passa a ler só tarefa_id:
-- - trabalho da tarefa = origem 'quadro' e forma 'task' (um por bot e tarefa, índice trabalhos_da_tarefa refeito);
-- - frente da tarefa = forma 'frente' (pode ter origem 'quadro' quando nasce do trabalho da tarefa; fica fora do índice).
-- O servidor antigo no ar (main) não lê quadro_tarefa_id; o do servidor de teste (#723 antes desta) lê, mas é trocado no
-- mesmo deploy que roda esta migração.
SET LOCAL lock_timeout = '5s';

DROP INDEX IF EXISTS trabalhos_da_tarefa;
ALTER TABLE trabalhos DROP CONSTRAINT IF EXISTS trabalho_quadro_tarefa_so_quadro;
UPDATE trabalhos SET tarefa_id = quadro_tarefa_id WHERE quadro_tarefa_id IS NOT NULL AND tarefa_id IS NULL;
-- Derruba junto a FK trabalhos_quadro_tarefa_fk.
-- destrutiva-ok: a coluna nasceu na 0163 deste mesmo PR (nunca esteve em produção), o valor foi copiado para tarefa_id na linha acima e o ROLLBACK a refaz com os dados.
ALTER TABLE trabalhos DROP COLUMN quadro_tarefa_id;
-- Um trabalho por (bot, tarefa): a corrida de duas etapas criando ao mesmo tempo cai no ON CONFLICT (trabalhos.repo.ts).
CREATE UNIQUE INDEX trabalhos_da_tarefa ON trabalhos (tenant_id, agente_id, tarefa_id)
  WHERE tarefa_id IS NOT NULL AND origem = 'quadro' AND forma = 'task';

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- DROP INDEX IF EXISTS trabalhos_da_tarefa;
-- ALTER TABLE trabalhos ADD COLUMN quadro_tarefa_id uuid;
-- UPDATE trabalhos SET quadro_tarefa_id = tarefa_id WHERE tarefa_id IS NOT NULL AND origem = 'quadro' AND forma = 'task';
-- UPDATE trabalhos SET tarefa_id = NULL WHERE origem = 'quadro' AND forma = 'task';
-- -- A FK depois do UPDATE: os valores vêm de tarefa_id, que já tem a mesma FK.
-- ALTER TABLE trabalhos ADD CONSTRAINT trabalhos_quadro_tarefa_fk FOREIGN KEY (tenant_id, quadro_tarefa_id)
--   REFERENCES quadro_tarefas (tenant_id, id) ON DELETE SET NULL (quadro_tarefa_id);
-- ALTER TABLE trabalhos ADD CONSTRAINT trabalho_quadro_tarefa_so_quadro CHECK (quadro_tarefa_id IS NULL OR origem = 'quadro');
-- CREATE UNIQUE INDEX trabalhos_da_tarefa ON trabalhos (tenant_id, agente_id, quadro_tarefa_id) WHERE quadro_tarefa_id IS NOT NULL;
