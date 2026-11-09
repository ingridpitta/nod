-- 0006 e-mail na identidade (ADR-030): a allowlist do login Google é a própria tabela pessoas.
-- Roda como nod_dono. Convenção `-- ROLLBACK:` no fim.
--
-- pessoas NÃO tem RLS (exceção nomeada em tests/conformidade/gate-rls.ts) e nod_app só tem GRANT
-- SELECT de TABELA inteira (0001), sem lista de colunas: a coluna nova já entra no grant, nenhum
-- GRANT novo aqui. Quem escreve o e-mail é só o seed, como nod_dono.
--
-- NULLABLE de propósito (definido em 2026-09-16): pessoa sem e-mail é pessoa que não loga —
-- fail-closed por ausência de dado — e as linhas já semeadas não precisam de backfill adivinhado.
ALTER TABLE pessoas ADD COLUMN IF NOT EXISTS email text;

-- Forma mínima garantida no banco: com '@' e sempre em minúsculas. A normalização é do seed; o CHECK
-- impede que alguém contorne inserindo por psql e crie um e-mail que o login nunca casaria.
ALTER TABLE pessoas DROP CONSTRAINT IF EXISTS pessoas_email_formato;
ALTER TABLE pessoas ADD CONSTRAINT pessoas_email_formato
  CHECK (email IS NULL OR (email = lower(email) AND email LIKE '%_@_%._%'));

-- Único GLOBAL (não por tenant) e sem diferenciar caixa. O e-mail é a chave do LOGIN, e o login
-- acontece antes de existir tenant: buscarPorEmail consulta só por lower(email). Medido em
-- 2026-09-16 com um índice por (tenant_id, lower(email)): o banco ACEITAVA o mesmo e-mail em dois
-- tenants e a busca via 2 linhas, então buscarPorEmail devolvia null e a pessoa PERDIA o login, sem
-- erro em lugar nenhum. O escopo do índice tem de casar o escopo da consulta.
-- Sem citext (seria extensão a mais, hoje só pgcrypto e unaccent): o índice funcional lower()
-- resolve e é o mesmo que a consulta usa — com a coluna líder no predicado, vira busca pontual.
-- PARCIAL: várias pessoas sem e-mail continuam válidas.
DROP INDEX IF EXISTS pessoas_email_unico;
CREATE UNIQUE INDEX IF NOT EXISTS pessoas_email_unico
  ON pessoas (lower(email)) WHERE email IS NOT NULL;

-- ROLLBACK:
-- DROP INDEX IF EXISTS pessoas_email_unico;
-- ALTER TABLE pessoas DROP CONSTRAINT IF EXISTS pessoas_email_formato;
-- ALTER TABLE pessoas DROP COLUMN IF EXISTS email;
