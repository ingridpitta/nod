-- definido em 2026-10-11 (ADR-097, fase 0c: medir a task inteira). `memoria_mb` guarda a ÚLTIMA leitura do turno; para
-- calibrar a reserva por agente e a fila do trabalho pesado, o que importa é o PICO da task. Medido na nod-motor-teste em
-- 11/10: a tela dizia "925 MB" com 5,4 GB em uso, porque os Postgres de teste saem do grupo do turno e ficavam fora da
-- conta. O amostrador passa a somá-los (pela marca NOD_GRUPO) e o servidor guarda o maior valor que viu.
SET LOCAL lock_timeout = '5s';

ALTER TABLE trabalhos ADD COLUMN IF NOT EXISTS memoria_pico_mb integer;
ALTER TABLE trabalhos ADD CONSTRAINT trabalho_memoria_pico CHECK (memoria_pico_mb IS NULL OR memoria_pico_mb >= 0);

-- ROLLBACK:
-- ALTER TABLE trabalhos DROP CONSTRAINT trabalho_memoria_pico;
-- ALTER TABLE trabalhos DROP COLUMN memoria_pico_mb;
