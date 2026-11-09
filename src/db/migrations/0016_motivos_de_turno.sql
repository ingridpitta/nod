-- definido em 2026-09-18: o turno deixa de ser cortado por contador de passos e passa a ser vigiado
-- por atividade. Dois motivos novos, com sentidos distintos que 'sem_progresso' misturava:
--   turno_travado       — ficou mudo sem ferramenta pendente; o watchdog encerrou.
--   trabalho_incompleto — produziu saída e não concluiu (o caso que virava 'sem_progresso' mentindo).
-- 0015 é do ramo de pastas por projeto; esta migração é independente e pode ser aplicada antes dele.
ALTER TYPE motivo_interrupcao ADD VALUE IF NOT EXISTS 'turno_travado';
ALTER TYPE motivo_interrupcao ADD VALUE IF NOT EXISTS 'trabalho_incompleto';
-- ROLLBACK: não há DROP VALUE em enum do Postgres. Para reverter, recrie o tipo sem esses valores
-- depois de reescrever as linhas que os usam:
--   UPDATE turnos SET motivo_interrupcao = 'sem_progresso'
--    WHERE motivo_interrupcao IN ('turno_travado', 'trabalho_incompleto');
-- e então recrie o enum e reaplique as colunas. Seguro só enquanto nenhum turno os carregar.
