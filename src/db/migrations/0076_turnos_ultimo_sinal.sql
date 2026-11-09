-- definido em 2026-10-15 (NOD-241, emenda da ADR-084): o último sinal de vida do turno que caiu. `interromper` e
-- `assentar` zeram `lease_ate` (os terminais afirmam `leaseAte: null`), e as consultas da retomada automática
-- (frentesCaidas, triagensParadas, pedidosAColegaParados) mediam a queda por `coalesce(lease_ate, criado_em)` — a
-- criação do turno. Toda frente ou pedido com mais de 30 min falhava num deploy. Esta coluna guarda o instante real
-- da queda: a última renovação do lease (lease_ate − LEASE_MS) quando o varredor ou a entrega notam a máquina fora,
-- ou a hora da recusa no despacho. Gravada uma vez (o primeiro valor vence, `coalesce` no UPDATE).
-- Nula, sem default, sem índice: os turnos interrompidos antes desta migração seguem a régua antiga até saírem da
-- janela de 24 h. Só adição (expand-only): o código anterior não lê esta coluna.
SET LOCAL lock_timeout = '5s';

ALTER TABLE turnos ADD COLUMN IF NOT EXISTS ultimo_sinal_em timestamptz;

-- ROLLBACK:
-- ALTER TABLE turnos DROP COLUMN IF EXISTS ultimo_sinal_em;
