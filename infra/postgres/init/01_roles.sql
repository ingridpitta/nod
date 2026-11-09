-- Roles e bancos do nod (ADR-003, Práticas §5). Roda como superusuário no primeiro boot do container
-- e, no CI, via psql contra o service container. Idempotente.
--
-- nod_dono: dono dos bancos; só a migração conecta com ele. CREATEDB (2026-10-05) para a suíte criar o
--           banco de teste de cada worktree (tests/setup/banco-por-worktree.ts); não dá RLS nem superuser.
-- nod_app:  a aplicação e a suíte de testes. NOBYPASSRLS e não-dono, para que FORCE ROW LEVEL SECURITY
--           valha de verdade (o gate tests/conformidade/rls.test.ts assere rolbypassrls = false).
-- nod_poda: apaga prosa da trilha (trilha_prosa) — nunca a trilha (ADR-004). Sem LOGIN nesta rodada.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nod_dono') THEN
    CREATE ROLE nod_dono LOGIN PASSWORD 'nod' NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nod_app') THEN
    CREATE ROLE nod_app LOGIN PASSWORD 'nod' NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nod_poda') THEN
    CREATE ROLE nod_poda NOLOGIN NOBYPASSRLS;
  END IF;
  ALTER ROLE nod_dono CREATEDB;
END
$$;

SELECT 'CREATE DATABASE nod OWNER nod_dono'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'nod') \gexec

SELECT 'CREATE DATABASE nod_test OWNER nod_dono'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'nod_test') \gexec
