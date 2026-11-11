-- definido em 2026-11-10 (NOD-463, quadro minimalista): a prioridade da tarefa, como no Linear e no Multica — sem,
-- urgente, alta, média ou baixa (PRIORIDADES em src/contracts/quadro-opcoes.ts). O card mostra as barrinhas; a tela
-- filtra e ordena por ela; criar_tarefa e mudar_tarefa a recebem (tela e gerir_quadro).
-- Só aditiva: coluna com padrão constante (sem reescrita); toda tarefa de antes fica 'sem'. O servidor de antes não a lê
-- e o INSERT dele cai no padrão.
SET LOCAL lock_timeout = '5s';

ALTER TABLE quadro_tarefas ADD COLUMN prioridade text NOT NULL DEFAULT 'sem'
  CONSTRAINT quadro_tarefas_prioridade_ck CHECK (prioridade IN ('sem', 'urgente', 'alta', 'media', 'baixa'));

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- -- O servidor de antes não lê a coluna; perde-se a prioridade escolhida (as tarefas voltam a não ter nenhuma).
-- ALTER TABLE quadro_tarefas DROP COLUMN prioridade;
