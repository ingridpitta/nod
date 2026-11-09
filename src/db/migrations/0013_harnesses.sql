-- definido em 2026-09-18: escolha por agente; perfis existentes conservam o modelo e o fornecedor.
ALTER TABLE agentes ADD COLUMN harness text NOT NULL DEFAULT 'auto'
  CHECK (harness IN ('auto', 'claude-cli', 'codex-cli', 'cursor-cli', 'hermes'));
ALTER TABLE turnos ADD COLUMN harness text NOT NULL DEFAULT 'auto'
  CHECK (harness IN ('auto', 'claude-cli', 'codex-cli', 'cursor-cli', 'hermes'));
-- ROLLBACK: ALTER TABLE turnos DROP COLUMN harness; ALTER TABLE agentes DROP COLUMN harness;
