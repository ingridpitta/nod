-- 0032 uma decisão, uma continuação; o resultado da ação aprovada volta; "e o resto desta tarefa".
-- Convenção `-- ROLLBACK:` no fim. Só aditiva.
--
-- medido em 2026-09-28: a Ada fez 10 turnos em 3 minutos numa tarefa no computador do bot. Cada ação
-- pedia aprovação; aprovada dentro da espera de 20 s, o turno original seguia E assentarAprovacao criava
-- uma retomada (decidir.ts), em cascata. E o resultado da ação aprovada era descartado
-- (computadores.ts executarAprovado): a saída do terminal nunca voltava.
--
-- continuada_em / continuada_por: QUEM continuou a decisão — o próprio turno, que a recebeu esperando
-- ('turno'), ou uma retomada ('retomada'). Reivindicado com `where continuada_em is null`: o primeiro
-- ganha, o outro não cria nada.
-- computador_acoes.resultado_cifrado: o resultado da ação aprovada, cifrado como os argumentos (ADR-037) e
-- apagado quando entregue ao turno.
-- turnos.computador_liberado_em: a pessoa respondeu "Pode fazer e o resto desta tarefa" — vale para o
-- turno raiz e as retomadas dele, nunca para outra tarefa.

ALTER TABLE decisoes ADD COLUMN IF NOT EXISTS continuada_em timestamptz;
ALTER TABLE decisoes ADD COLUMN IF NOT EXISTS continuada_por text
  CHECK (continuada_por IS NULL OR continuada_por IN ('turno', 'retomada'));
ALTER TABLE computador_acoes ADD COLUMN IF NOT EXISTS resultado_cifrado text;
ALTER TABLE turnos ADD COLUMN IF NOT EXISTS computador_liberado_em timestamptz;

-- ROLLBACK:
-- ALTER TABLE turnos DROP COLUMN IF EXISTS computador_liberado_em;
-- ALTER TABLE computador_acoes DROP COLUMN IF EXISTS resultado_cifrado;
-- ALTER TABLE decisoes DROP COLUMN IF EXISTS continuada_por;
-- ALTER TABLE decisoes DROP COLUMN IF EXISTS continuada_em;
