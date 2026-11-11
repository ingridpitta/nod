-- definido em 2026-11-10 (comparação Multica × nod, aprovada pelo Marlon; os wakeups --until-pr merged/conflicts e
-- --until-issue do Multica): me_chame_as ganha três esperas por evento além da CI, todas pelo mesmo varredor da volta por CI.
-- - acordar_quando 'merge': o PR da tarefa mergeou (ou fechou sem merge: não vai mais mergear);
-- - acordar_quando 'conflito': o PR aberto ficou com conflito (ou saiu de aberto);
-- - acordar_quando 'tarefa': outra tarefa do quadro (acordar_tarefa_id) chegou no estado esperado (acordar_tarefa_estado:
--   feito, revisao, bloqueado; null = qualquer um dos três), foi cancelada ou apagada.
-- Só adição: o servidor antigo no ar só grava 'ci' (o CHECK novo aceita) e não lê as colunas novas.
SET LOCAL lock_timeout = '5s';

ALTER TABLE turnos DROP CONSTRAINT turnos_acordar_quando_check;
ALTER TABLE turnos ADD CONSTRAINT turnos_acordar_quando_check CHECK (acordar_quando IN ('ci', 'merge', 'conflito', 'tarefa'));
ALTER TABLE turnos
  ADD COLUMN acordar_tarefa_id uuid,
  ADD COLUMN acordar_tarefa_estado text CHECK (acordar_tarefa_estado IN ('feito', 'revisao', 'bloqueado'));
-- O varredor lê as voltas por evento que dormem (antes só as de CI, pelo turnos_acordar_ci_idx).
CREATE INDEX turnos_acordar_evento_idx ON turnos (acordar_em) WHERE estado = 'pendente' AND acordar_quando IS NOT NULL;

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- DROP INDEX turnos_acordar_evento_idx;
-- ALTER TABLE turnos DROP COLUMN acordar_tarefa_estado;
-- ALTER TABLE turnos DROP COLUMN acordar_tarefa_id;
-- -- O servidor de antes só conhece 'ci': as voltas por evento que ainda dormem viram volta por hora (acordam no prazo).
-- UPDATE turnos SET acordar_quando = NULL, acordar_pr_url = NULL WHERE acordar_quando IN ('merge', 'conflito', 'tarefa');
-- ALTER TABLE turnos DROP CONSTRAINT turnos_acordar_quando_check;
-- ALTER TABLE turnos ADD CONSTRAINT turnos_acordar_quando_check CHECK (acordar_quando IN ('ci'));
