-- definido em 2026-11-07 (ADA-28, ADR-159 "a tarefa é a casa do trabalho"): o que nasce num turno de tarefa leva o
-- tarefa_id, materializado onde a cadeia de turnos o perde.
-- decisoes.tarefa_id: a pergunta ou a aprovação feita durante uma tarefa (pedir_a_pessoa, pedir_aprovacao, pedir_acesso,
--   pedir_credencial, o status voce de bot) é a espera da tarefa. A Sua vez e o card leem por índice; responder em
--   qualquer um resolve os dois. Sem backfill (S5): a decisão de backfill nasceria sem turno para retomar e venceria em
--   massa em 24 h. ON DELETE SET NULL (tarefa_id): a decisão fica com a tarefa excluída (PG 15+, o CI e o compose usam 16).
-- decisoes.tarefa_pede_done: a decisão "ADA-28 está pronta para o Done" do quadro em que quem fecha é a pessoa. É uma
--   pergunta (sem tipo novo de enum, sem o rollback de ALTER TYPE); a marca diz que "Dar Done" leva a tarefa a Feito.
--   Sem CHECK (tarefa_pede_done exige tarefa_id): o ON DELETE SET NULL (tarefa_id) da exclusão da tarefa (ou do quadro,
--   em cascata) zera só o tarefa_id e o CHECK recusaria a exclusão. Quem lê a marca exige o tarefa_id junto.
-- trabalhos.tarefa_id: já vem da 0153_saida_obrigatoria (ADA-232), com FK e índice; esta não a recria.
-- quadros.quem_fecha: quem dá o Done — 'bot' (hoje) ou 'pessoa' (o bot para em Revisando e pede o Done).
-- Só aditiva: colunas nulas ou com padrão constante (sem reescrita); o servidor de antes não lê nenhuma.
SET LOCAL lock_timeout = '5s';

ALTER TABLE decisoes ADD COLUMN tarefa_id uuid;
ALTER TABLE decisoes ADD CONSTRAINT decisoes_da_tarefa_fk FOREIGN KEY (tenant_id, tarefa_id)
  REFERENCES quadro_tarefas (tenant_id, id) ON DELETE SET NULL (tarefa_id);
ALTER TABLE decisoes ADD COLUMN tarefa_pede_done boolean NOT NULL DEFAULT false;
CREATE INDEX decisoes_da_tarefa ON decisoes (tenant_id, tarefa_id) WHERE tarefa_id IS NOT NULL AND estado IN ('pendente', 'reaberta');

ALTER TABLE quadros ADD COLUMN quem_fecha text NOT NULL DEFAULT 'bot' CHECK (quem_fecha IN ('bot', 'pessoa'));

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- -- O servidor de antes não lê nenhuma das colunas; perde-se a ligação decisão → tarefa e a escolha de quem fecha
-- -- (o quadro volta a fechar pelo bot).
-- ALTER TABLE quadros DROP COLUMN quem_fecha;
-- DROP INDEX decisoes_da_tarefa;
-- ALTER TABLE decisoes DROP COLUMN tarefa_pede_done;
-- ALTER TABLE decisoes DROP CONSTRAINT decisoes_da_tarefa_fk;
-- ALTER TABLE decisoes DROP COLUMN tarefa_id;
