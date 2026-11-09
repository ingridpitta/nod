-- definido em 2026-11-07 (ADA-242, ADR-157): conta sem senha. Quem cria a conta pelo código do e-mail ganha a
-- identidade `email` (sem senha e sem Google: a posse do e-mail, provada a cada entrada por um código de 6 dígitos).
-- E o Google dentro do app (loopback + troca com prova) guarda a identidade da volta num código `google_app` de uso
-- único até o processo principal do app provar que foi ele quem pediu.
-- Só amplia os dois CHECK: o servidor antigo no ar nunca grava `email` nem `google_app`, e lê as linhas novas como
-- qualquer outra (contaDaPessoa conta só `senha` e `google`).
SET LOCAL lock_timeout = '5s';

ALTER TABLE identidades_conta DROP CONSTRAINT identidades_conta_tipo;
ALTER TABLE identidades_conta ADD CONSTRAINT identidades_conta_tipo CHECK (tipo IN ('google', 'senha', 'email'));
ALTER TABLE identidades_conta DROP CONSTRAINT identidades_conta_forma;
ALTER TABLE identidades_conta ADD CONSTRAINT identidades_conta_forma CHECK (
  (tipo = 'google' AND google_iss IS NOT NULL AND google_sub IS NOT NULL AND senha_hash IS NULL
     AND length(google_iss) <= 100 AND length(google_sub) <= 255)
  OR (tipo = 'senha' AND senha_hash IS NOT NULL AND google_iss IS NULL AND google_sub IS NULL AND length(senha_hash) <= 400)
  OR (tipo = 'email' AND senha_hash IS NULL AND google_iss IS NULL AND google_sub IS NULL)
);
-- Uma identidade `email` por conta (como a senha).
CREATE UNIQUE INDEX identidades_conta_um_email ON identidades_conta (conta_id) WHERE tipo = 'email';

ALTER TABLE codigos_conta DROP CONSTRAINT codigos_conta_finalidade;
ALTER TABLE codigos_conta ADD CONSTRAINT codigos_conta_finalidade
  CHECK (finalidade IN ('verificacao', 'recuperacao', 'troca_app', 'troca_email', 'reautenticacao', 'google_app'));

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- -- Falha (e volta inteiro) se já houver identidade `email` ou código `google_app`: apagar dado não é rollback.
-- ALTER TABLE codigos_conta DROP CONSTRAINT codigos_conta_finalidade;
-- ALTER TABLE codigos_conta ADD CONSTRAINT codigos_conta_finalidade CHECK (finalidade IN ('verificacao', 'recuperacao', 'troca_app', 'troca_email', 'reautenticacao'));
-- DROP INDEX IF EXISTS identidades_conta_um_email;
-- ALTER TABLE identidades_conta DROP CONSTRAINT identidades_conta_forma;
-- ALTER TABLE identidades_conta ADD CONSTRAINT identidades_conta_forma CHECK ((tipo = 'google' AND google_iss IS NOT NULL AND google_sub IS NOT NULL AND senha_hash IS NULL AND length(google_iss) <= 100 AND length(google_sub) <= 255) OR (tipo = 'senha' AND senha_hash IS NOT NULL AND google_iss IS NULL AND google_sub IS NULL AND length(senha_hash) <= 400));
-- ALTER TABLE identidades_conta DROP CONSTRAINT identidades_conta_tipo;
-- ALTER TABLE identidades_conta ADD CONSTRAINT identidades_conta_tipo CHECK (tipo IN ('google', 'senha'));
