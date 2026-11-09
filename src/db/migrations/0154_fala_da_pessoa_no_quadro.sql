-- definido em 2026-11-07 (ADA-15, ADR-154): a aprovação da pessoa no chat vale no quadro. A resposta do card dada pela
-- fala da pessoa guarda de onde veio: a mensagem (resposta_mensagem_id), a conversa (resposta_conversa_id) e o bot com
-- quem ela falava (resposta_agente_id). O histórico da tarefa leva o mensagem_id do passo que a fala autorizou.
-- Só adição de colunas anuláveis: o servidor antigo no ar não as lê nem escreve (o insert dele as deixa nulas).
SET LOCAL lock_timeout = '5s';

ALTER TABLE quadro_tarefas
  ADD COLUMN resposta_mensagem_id uuid,
  ADD COLUMN resposta_conversa_id uuid,
  ADD COLUMN resposta_agente_id uuid;

ALTER TABLE quadro_tarefa_historico ADD COLUMN mensagem_id uuid;

-- ROLLBACK:
-- ALTER TABLE quadro_tarefa_historico DROP COLUMN IF EXISTS mensagem_id;
-- ALTER TABLE quadro_tarefas DROP COLUMN IF EXISTS resposta_agente_id, DROP COLUMN IF EXISTS resposta_conversa_id, DROP COLUMN IF EXISTS resposta_mensagem_id;
