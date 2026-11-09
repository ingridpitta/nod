-- definido em 2026-10-28 (NOD-365): a máquina de onde o computador saiu sem receber o `marcar_saida` (estava sem
-- contato na troca, ou não respondeu). A lista também registra o destino antes da importação, para uma queda do servidor
-- não deixar uma cópia sem limpeza. Quando uma máquina volta, recebe `marcar_saida` e sai da lista.
ALTER TABLE computadores ADD COLUMN IF NOT EXISTS saidas_pendentes_de uuid[] NOT NULL DEFAULT '{}';

-- ROLLBACK:
-- ALTER TABLE computadores DROP COLUMN IF EXISTS saidas_pendentes_de;
