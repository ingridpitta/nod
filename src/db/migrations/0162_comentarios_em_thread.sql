-- definido em 2026-11-10 (tarefa aberta como a issue do Multica): os comentários da tarefa ganham thread de um nível e
-- edição/remoção do próprio.
-- quadro_comentarios.pai_id: a raiz da thread (a resposta aponta sempre para a raiz, nunca para outra resposta: um nível
--   só). A resposta vai ao agente daquela thread, não ao responsável; o turno que ela abre se junta só ao turno da fila da
--   mesma thread (coalesce por thread). ON DELETE CASCADE: só a exclusão da tarefa/quadro apaga linhas (o apagar do
--   comentário é lógico, por apagado_em, e a resposta continua pendurada na raiz).
-- quadro_comentarios.editado_em / apagado_em: o autor edita ou apaga o próprio comentário; o apagado com respostas fica
--   como marcador sem texto na lista. Nulas: o servidor de antes não lê nenhuma das três.
SET LOCAL lock_timeout = '5s';

ALTER TABLE quadro_comentarios ADD COLUMN pai_id uuid;
ALTER TABLE quadro_comentarios ADD CONSTRAINT quadro_comentarios_pai_fk FOREIGN KEY (tenant_id, pai_id)
  REFERENCES quadro_comentarios (tenant_id, id) ON DELETE CASCADE;
ALTER TABLE quadro_comentarios ADD CONSTRAINT quadro_comentarios_pai_outro CHECK (pai_id IS NULL OR pai_id <> id);
CREATE INDEX quadro_comentarios_da_thread ON quadro_comentarios (tenant_id, pai_id, criado_em) WHERE pai_id IS NOT NULL;
ALTER TABLE quadro_comentarios ADD COLUMN editado_em timestamptz;
ALTER TABLE quadro_comentarios ADD COLUMN apagado_em timestamptz;

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- -- O servidor de antes não lê as colunas; perde-se a thread (as respostas viram comentários soltos) e a marca de
-- -- editado/apagado (o texto do apagado já foi trocado por um marcador e não volta).
-- ALTER TABLE quadro_comentarios DROP COLUMN apagado_em;
-- ALTER TABLE quadro_comentarios DROP COLUMN editado_em;
-- DROP INDEX quadro_comentarios_da_thread;
-- ALTER TABLE quadro_comentarios DROP CONSTRAINT quadro_comentarios_pai_outro;
-- ALTER TABLE quadro_comentarios DROP CONSTRAINT quadro_comentarios_pai_fk;
-- ALTER TABLE quadro_comentarios DROP COLUMN pai_id;
