-- definido em 2026-11-07 (ADA-232, ADR-155): todo trabalho de tarefa do quadro termina numa de 4 saídas (andou, precisa de
-- você, bloqueado, volta depois). O varredor lê a saída gravada na execução: concluído sem saída reaciona uma vez na
-- mesma cadeia e, na 2ª seguida, vai para Precisa de você.
-- - quadro_execucoes.saida: a saída do último turno da cadeia que assentou (null = cadeia viva ou dado anterior: nunca
--   reaciona). sem_saida conta os reacionamentos da série. Regravada a cada assentamento da cadeia: vale a última.
-- - turnos.acordar_quando/acordar_pr_url: a volta "quando a CI do PR terminar". O turno que chama me_chame_as anota a
--   condição; a retomada enfileirada a herda, com acordar_em = prazo máximo (24h). O varredor traz acordar_em para now()
--   quando os checks do PR terminam.
-- - trabalhos.tarefa_id: a frente aberta por um turno de tarefa (o card a mostra como trabalhando; absorve a ADA-230).
-- Só adição: o servidor antigo no ar não lê nem escreve estas colunas.
SET LOCAL lock_timeout = '5s';

ALTER TABLE quadro_execucoes
  ADD COLUMN IF NOT EXISTS saida text CHECK (saida IN ('andou', 'voce', 'bloqueado', 'volta', 'nenhuma')),
  ADD COLUMN IF NOT EXISTS saida_em timestamptz,
  -- Os reacionamentos sem saída já feitos na série (zera quando a cadeia assenta com saída).
  ADD COLUMN IF NOT EXISTS sem_saida smallint NOT NULL DEFAULT 0 CHECK (sem_saida >= 0);

ALTER TABLE turnos
  ADD COLUMN IF NOT EXISTS acordar_quando text CHECK (acordar_quando IN ('ci')),
  ADD COLUMN IF NOT EXISTS acordar_pr_url text CHECK (acordar_pr_url IS NULL OR length(acordar_pr_url) BETWEEN 1 AND 500);
CREATE INDEX IF NOT EXISTS turnos_acordar_ci_idx ON turnos (acordar_em) WHERE estado = 'pendente' AND acordar_quando = 'ci';

ALTER TABLE trabalhos ADD COLUMN IF NOT EXISTS tarefa_id uuid;
ALTER TABLE trabalhos ADD FOREIGN KEY (tenant_id, tarefa_id) REFERENCES quadro_tarefas (tenant_id, id) ON DELETE SET NULL (tarefa_id);
-- O card lê as frentes abertas por tarefa, e apagar a tarefa (ON DELETE SET NULL) procura os trabalhos dela: sem o índice,
-- os dois varrem trabalhos inteira (revisão do PR #705). Parcial: quase todo trabalho não tem tarefa.
CREATE INDEX IF NOT EXISTS trabalhos_por_tarefa ON trabalhos (tenant_id, tarefa_id) WHERE tarefa_id IS NOT NULL;

-- ROLLBACK:
-- DROP INDEX IF EXISTS trabalhos_por_tarefa;
-- ALTER TABLE trabalhos DROP COLUMN IF EXISTS tarefa_id;
-- DROP INDEX IF EXISTS turnos_acordar_ci_idx;
-- ALTER TABLE turnos DROP COLUMN IF EXISTS acordar_pr_url;
-- ALTER TABLE turnos DROP COLUMN IF EXISTS acordar_quando;
-- ALTER TABLE quadro_execucoes DROP COLUMN IF EXISTS sem_saida;
-- ALTER TABLE quadro_execucoes DROP COLUMN IF EXISTS saida_em;
-- ALTER TABLE quadro_execucoes DROP COLUMN IF EXISTS saida;
