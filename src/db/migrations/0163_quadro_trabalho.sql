-- Renumerada de 0152 para 0163 no merge com a main (2026-11-10); sem teto próprio desde então (ADR-163 §4).
-- definido em 2026-11-07 (ADA-16, ADR-163): cada tarefa do quadro roda num trabalho próprio do bot responsável, com sessão
-- e pasta próprias, em paralelo com as outras tarefas do mesmo bot. Antes o turno da tarefa entrava sem trabalho, nascia
-- nos bastidores (ADR-130) e esperava a faixa de bastidores da conversa do bot: duas tarefas do mesmo bot andavam uma
-- depois da outra (medido em 2026-11-06 no quadro do EngApp: 5 tarefas em andamento, 1 rodando, 4 "na fila").
--
-- - trabalhos.quadro_tarefa_id: a tarefa de que o trabalho é. Um trabalho só por (bot, tarefa), para sempre: a etapa
--   seguinte do mesmo bot na mesma tarefa reabre o mesmo trabalho e continua a sessão (ADA-10), e duas etapas dele na
--   mesma tarefa entram em sequência (a faixa do reivindicar é o trabalho). A tarefa apagada não apaga o trabalho: só
--   solta o vínculo (o histórico da task continua na tela de Trabalhos).
-- - trabalhos.origem ganha 'quadro'.
-- Só adição: o servidor antigo no ar não lê as colunas novas nem grava 'quadro' (o CHECK novo aceita tudo o que o antigo aceitava).
SET LOCAL lock_timeout = '5s';

ALTER TABLE trabalhos ADD COLUMN quadro_tarefa_id uuid;
ALTER TABLE trabalhos ADD CONSTRAINT trabalhos_quadro_tarefa_fk FOREIGN KEY (tenant_id, quadro_tarefa_id)
  REFERENCES quadro_tarefas (tenant_id, id) ON DELETE SET NULL (quadro_tarefa_id);
-- Só a origem 'quadro' tem tarefa (e a tem enquanto a tarefa existir: o SET NULL acima pode zerá-la).
ALTER TABLE trabalhos ADD CONSTRAINT trabalho_quadro_tarefa_so_quadro CHECK (quadro_tarefa_id IS NULL OR origem = 'quadro');

ALTER TABLE trabalhos DROP CONSTRAINT trabalho_origem;
ALTER TABLE trabalhos ADD CONSTRAINT trabalho_origem CHECK (origem IN ('pessoa', 'rotina', 'colega', 'rede', 'quadro'));

-- Um trabalho por (bot, tarefa): a corrida de duas etapas criando ao mesmo tempo cai no ON CONFLICT (trabalhos.repo.ts).
CREATE UNIQUE INDEX trabalhos_da_tarefa ON trabalhos (tenant_id, agente_id, quadro_tarefa_id) WHERE quadro_tarefa_id IS NOT NULL;

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- DROP INDEX trabalhos_da_tarefa;
-- -- O servidor de antes não conhece a origem 'quadro': os trabalhos de tarefa viram task da pessoa (forma 'task'),
-- -- que é como o servidor antigo os mostraria; o turno deles segue ligado ao trabalho e roda à parte, como qualquer task.
-- -- O CHECK de tarefa só no 'quadro' cai antes do UPDATE: com ele de pé, o trabalho de tarefa não vira 'pessoa'.
-- ALTER TABLE trabalhos DROP CONSTRAINT trabalho_quadro_tarefa_so_quadro;
-- UPDATE trabalhos SET origem = 'pessoa' WHERE origem = 'quadro';
-- ALTER TABLE trabalhos DROP CONSTRAINT trabalho_origem;
-- ALTER TABLE trabalhos ADD CONSTRAINT trabalho_origem CHECK (origem IN ('pessoa', 'rotina', 'colega', 'rede'));
-- ALTER TABLE trabalhos DROP COLUMN quadro_tarefa_id;
