-- definido em 2026-10-09 (ADR-090): o sistema da máquina de cada chave, gravado quando ela se conecta pela ponte ('darwin'
-- = o app do Mac, 'linux' = o motor sem janela). O aviso de queda dizia "seu Mac parou de responder" quando quem parou foi
-- a VM: a conexão viva sabia a plataforma, mas some 90 s depois do último contato, antes de o lease vencer. Null = a
-- máquina ainda não se conectou depois desta migração (o aviso continua o do Mac).
-- Coluna nula sem default: só metadado, mas o ALTER pega a trava da tabela — desiste em 5 s com o servidor de pé.
SET LOCAL lock_timeout = '5s';
ALTER TABLE maquina_tokens ADD COLUMN IF NOT EXISTS plataforma text;
ALTER TABLE maquina_tokens ADD CONSTRAINT maquina_tokens_plataforma CHECK (plataforma IN ('darwin', 'linux'));

-- ROLLBACK:
-- -- O código antigo não lê a coluna: num rollback de emergência, dá para deixá-la.
-- ALTER TABLE maquina_tokens DROP CONSTRAINT IF EXISTS maquina_tokens_plataforma;
-- ALTER TABLE maquina_tokens DROP COLUMN IF EXISTS plataforma;
