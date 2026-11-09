-- definido em 2026-11-02 (NOD-418): os trabalhos de uma tarefa do quadro e os recados da pessoa para eles.
-- quadro_execucoes: cada vez que a tarefa aciona o bot responsável (o começo, a volta da resposta, o comentário, o
-- Repetir, a nova tentativa automática, o recado que virou trabalho) é uma linha, com o turno raiz da cadeia dele. O
-- estado ao vivo sai da cadeia de turnos (como o card); aqui fica o que o turno não guarda: a origem, o cancelar pedido
-- pela tarefa e, quando o fim é tratado (a nova tentativa ou o Bloqueado já aconteceu), o desfecho e o motivo em palavras.
-- O desfecho gravado vale quando a cadeia não diz mais (a poda) e o cancelado por fora (lote, Parar) não vira concluído.
-- Uma retomada que nasce depois do tratamento reabre o trabalho (tratada_em, desfecho e motivo voltam a null).
-- nova_tentativa_em: a falha transitória abre a nova tentativa sozinha só depois de um intervalo desde tratada_em (o
-- varredor a agenda no tratamento e a abre quando passa; o Repetir, o Cancelar e a retomada a desfazem).
-- Sem FK no turno: a poda apaga turnos e o trabalho fica com o desfecho gravado.
-- quadro_recados: o recado da pessoa pela tela da tarefa (ADR-083, emenda NOD-418). Entra na sessão viva do trabalho
-- (`entregue_em`); sem sessão, fica pendente e vira o próximo trabalho (`execucao_id`). Cancelar o trabalho cancela os
-- pendentes. `repassado_por`: o bot que repassou o recado pedido na conversa (gerir_quadro, ADR-047/062); null = a tela.
-- Só adição: o servidor antigo no ar não lê nem escreve estas tabelas.
SET LOCAL lock_timeout = '5s';

CREATE TABLE quadro_execucoes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tarefa_id uuid NOT NULL,
  numero integer NOT NULL CHECK (numero >= 1),
  origem text NOT NULL CHECK (origem IN ('inicio', 'resposta', 'comentario', 'repetir', 'automatica', 'recado')),
  turno_id uuid NOT NULL,
  motivo text CHECK (motivo IS NULL OR length(motivo) <= 500),
  desfecho text CHECK (desfecho IS NULL OR desfecho IN ('concluido', 'falhou', 'cancelado')),
  cancelada_em timestamptz,
  tratada_em timestamptz,
  nova_tentativa_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('quadro_execucoes');
ALTER TABLE quadro_execucoes ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE quadro_execucoes ADD FOREIGN KEY (tenant_id, tarefa_id) REFERENCES quadro_tarefas (tenant_id, id) ON DELETE CASCADE;
CREATE UNIQUE INDEX quadro_execucoes_numero ON quadro_execucoes (tenant_id, tarefa_id, numero);
-- Um turno raiz é um trabalho só (o comentário que se junta ao turno na fila não abre outro).
CREATE UNIQUE INDEX quadro_execucoes_turno ON quadro_execucoes (tenant_id, tarefa_id, turno_id);
-- A renovação da sessão viva acha o trabalho pelo turno raiz da cadeia (doTurnoRaiz), sem saber a tarefa.
CREATE INDEX quadro_execucoes_turno_raiz ON quadro_execucoes (tenant_id, turno_id);
-- O varredor passa a cada 30 s só pelo que ainda não foi tratado.
CREATE INDEX quadro_execucoes_abertas ON quadro_execucoes (tenant_id, owner_id) WHERE tratada_em IS NULL;
-- E pela nova tentativa agendada (poucas: só no intervalo depois de uma queda).
CREATE INDEX quadro_execucoes_nova_tentativa ON quadro_execucoes (tenant_id, owner_id) WHERE nova_tentativa_em IS NOT NULL;

CREATE TABLE quadro_recados (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tarefa_id uuid NOT NULL,
  texto text NOT NULL CHECK (length(texto) BETWEEN 1 AND 4000),
  entregue_em timestamptz,
  entregue_turno_id uuid,
  execucao_id uuid,
  repassado_por uuid,
  cancelado_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('quadro_recados');
ALTER TABLE quadro_recados ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE quadro_recados ADD FOREIGN KEY (tenant_id, tarefa_id) REFERENCES quadro_tarefas (tenant_id, id) ON DELETE CASCADE;
-- O trabalho que levou o recado (os dois somem com a tarefa; SET NULL só da coluna, para a ordem das cascatas não importar).
ALTER TABLE quadro_recados ADD FOREIGN KEY (tenant_id, execucao_id) REFERENCES quadro_execucoes (tenant_id, id) ON DELETE SET NULL (execucao_id);
CREATE INDEX quadro_recados_pendentes ON quadro_recados (tenant_id, tarefa_id, criado_em)
  WHERE entregue_em IS NULL AND execucao_id IS NULL AND cancelado_em IS NULL;

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- DROP INDEX IF EXISTS quadro_execucoes_turno_raiz;
-- DROP TABLE IF EXISTS quadro_recados;
-- DROP TABLE IF EXISTS quadro_execucoes;
