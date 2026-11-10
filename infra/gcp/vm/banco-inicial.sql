-- Papéis, banco e extensões do nod no Cloud SQL (equivalente a infra/postgres/init/01_roles.sql, ADR-003).
-- Roda UMA vez, como o usuário postgres (cloudsqlsuperuser), pelo banco-inicial.sh na VM. Idempotente.
-- As senhas chegam como variáveis do psql (-v senha_dono=… -v senha_app=…), lidas do Secret Manager.
--
-- Diferenças em relação ao local, todas porque o Cloud SQL não dá superusuário:
--  - os papéis nascem por SQL, não pelo gcloud: usuário criado pela API entra em cloudsqlsuperuser,
--    e o gate tests/conformidade exige nod_app sem privilégio além do próprio;
--  - postgres vira membro de nod_dono para poder criar o banco em nome dele;
--  - pgcrypto e unaccent são criadas aqui; o CREATE EXTENSION IF NOT EXISTS da 0001 vira no-op.
\set ON_ERROR_STOP on

SELECT format('CREATE ROLE nod_dono LOGIN PASSWORD %L NOBYPASSRLS', :'senha_dono')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nod_dono') \gexec
SELECT format('CREATE ROLE nod_app LOGIN PASSWORD %L NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE', :'senha_app')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nod_app') \gexec
SELECT 'CREATE ROLE nod_poda NOLOGIN NOBYPASSRLS'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nod_poda') \gexec

-- Mantém a senha em dia com o Secret Manager quando o script roda de novo.
SELECT format('ALTER ROLE nod_dono PASSWORD %L', :'senha_dono') \gexec
SELECT format('ALTER ROLE nod_app PASSWORD %L', :'senha_app') \gexec

GRANT nod_dono TO postgres;

SELECT 'CREATE DATABASE nod OWNER nod_dono'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'nod') \gexec

\connect nod
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS unaccent;
