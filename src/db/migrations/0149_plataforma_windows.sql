-- definido em 2026-11-03 (ADA-11, ADR-147): o motor roda no Windows nativo e se conecta com plataforma 'win32'. A 0067
-- só aceitava 'darwin' e 'linux'; o CHECK é recriado mais largo (amplia, não apaga nada).
-- NOT VALID + VALIDATE, como a 0148. O migrar.ts roda o arquivo numa transação, então o VALIDATE fica sob a trava do
-- ADD (ACCESS EXCLUSIVE) até o COMMIT; a maquina_tokens é pequena (uma linha por máquina) e o lock_timeout limita a espera.
SET LOCAL lock_timeout = '5s';
ALTER TABLE maquina_tokens DROP CONSTRAINT IF EXISTS maquina_tokens_plataforma;
ALTER TABLE maquina_tokens ADD CONSTRAINT maquina_tokens_plataforma CHECK (plataforma IN ('darwin', 'linux', 'win32')) NOT VALID;
ALTER TABLE maquina_tokens VALIDATE CONSTRAINT maquina_tokens_plataforma;

-- ROLLBACK:
-- -- O código antigo lê a coluna como cast e trataria 'win32' como Mac: a linha volta a "ainda não se conectou" (null).
-- UPDATE maquina_tokens SET plataforma = NULL WHERE plataforma = 'win32';
-- ALTER TABLE maquina_tokens DROP CONSTRAINT IF EXISTS maquina_tokens_plataforma;
-- ALTER TABLE maquina_tokens ADD CONSTRAINT maquina_tokens_plataforma CHECK (plataforma IN ('darwin', 'linux'));
