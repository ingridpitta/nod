ALTER TYPE codigo_erro ADD VALUE IF NOT EXISTS 'conector_indisponivel';
ALTER TYPE codigo_erro ADD VALUE IF NOT EXISTS 'integracao_nao_configurada';
ALTER TYPE codigo_erro ADD VALUE IF NOT EXISTS 'integracao_autenticacao';

-- definido em 2026-09-17: ADR-033; chave Composio e sessões pertencem à pessoa, nunca à equipe.
CREATE TABLE composio_configuracoes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  chave_cifrada text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('composio_configuracoes');
ALTER TABLE composio_configuracoes ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE composio_configuracoes ADD UNIQUE (tenant_id, owner_id);
ALTER TABLE composio_configuracoes ADD CHECK (visibility = 'privado');

CREATE TABLE composio_sessoes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  toolkit text NOT NULL,
  sessao_id text NOT NULL,
  conta_id text NOT NULL,
  conector_id uuid NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('composio_sessoes');
ALTER TABLE composio_sessoes ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE composio_sessoes ADD UNIQUE (tenant_id, owner_id, toolkit);
ALTER TABLE composio_sessoes ADD FOREIGN KEY (tenant_id, conector_id) REFERENCES conectores (tenant_id, id);
ALTER TABLE composio_sessoes ADD CHECK (visibility = 'privado');

-- ROLLBACK:
-- DROP TABLE composio_sessoes;
-- DROP TABLE composio_configuracoes;
