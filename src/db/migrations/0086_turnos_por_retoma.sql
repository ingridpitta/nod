-- definido em 2026-10-16 (incidente em produção): índice para descer a cadeia de retomadas (`retoma_turno_id = X`). Sem ele,
-- `rotinaJanelas.turnoAberto` (ADR-099, I7 revista) varria `turnos` inteira uma vez por janela da rotina: com 1.518 janelas
-- (rotina de 10 em 10 min desde 28/09) e 11 mil turnos, a consulta levou 33 s, o disparo passou dos 60 s da tx (NOD-263),
-- o agendador parou e o watchdog reiniciou o servidor. A mesma descida aparece em pedidos-de-colega e em turnos.repo.
-- Parcial: 4 de 5 turnos não são retomada. Só adição (expand-only): o código anterior não depende do índice.
SET LOCAL lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS turnos_por_retoma ON turnos (tenant_id, retoma_turno_id) WHERE retoma_turno_id IS NOT NULL;

-- ROLLBACK:
-- -- O código anterior não depende do índice: voltar a imagem basta. Para tirar o que foi criado:
-- DROP INDEX IF EXISTS turnos_por_retoma;
