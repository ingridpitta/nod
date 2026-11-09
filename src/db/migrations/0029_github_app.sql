-- definido em 2026-09-24 (ADR-048): o GitHub App da organização, jeito 4 de conectar o GitHub, é do
-- TENANT, como a chave do Composio (ADR-041): um admin (NOD_ADMINS) cadastra uma vez e só turno de
-- ROTINA usa os tokens de instalação dele. A chave privada fica CIFRADA pelo servidor
-- (src/db/cifra.ts), como o env dos conectores; app id e instalação são números públicos.
-- Só aditiva: tabela nova, nenhuma coluna mexida.
--
-- IDEMPOTENTE de propósito: a primeira versão deste arquivo se chamou 0027_github_app.sql e chegou a
-- ser aplicada no nod_test compartilhado (5434) antes de a numeração ser acertada com a main. Lá a
-- tabela já existe; aqui ela só nasce se ainda não existir, e o banco novo recebe tudo igual.
DO $$
BEGIN
  IF to_regclass('public.github_app_configuracoes') IS NULL THEN
    CREATE TABLE github_app_configuracoes (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      app_id text NOT NULL CHECK (app_id ~ '^[0-9]{1,12}$'),
      instalacao_id text NOT NULL CHECK (instalacao_id ~ '^[0-9]{1,15}$'),
      chave_privada_cifrada text NOT NULL,
      criado_em timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    PERFORM nod_escopar_tabela('github_app_configuracoes');
    ALTER TABLE github_app_configuracoes ADD PRIMARY KEY (tenant_id, id);
    ALTER TABLE github_app_configuracoes ADD UNIQUE (tenant_id);
    -- 'equipe' faz a nod_pessoa_select da 0004 abrir a LEITURA ao tenant: a rotina de qualquer pessoa
    -- usa o App. Escrita continua só de quem cadastrou (sem policy extra, diferente da 0017): trocar a
    -- chave da organização é ato de admin, e a troca por outra pessoa passa por nod_dono.
    ALTER TABLE github_app_configuracoes ADD CHECK (visibility = 'equipe');
  END IF;
END
$$;

-- ROLLBACK:
-- DROP TABLE github_app_configuracoes;
