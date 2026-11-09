-- definido em 2026-09-18 (ADR-037): um computador privado por bot; perfil e arquivos fora do banco.
CREATE TABLE computadores (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  habilitado boolean NOT NULL DEFAULT true,
  controle text NOT NULL DEFAULT 'bot' CHECK (controle IN ('bot','pessoa','aguardando_pessoa')),
  politica text NOT NULL DEFAULT 'supervisionado' CHECK (politica IN ('supervisionado','autonomo')),
  ajuda text,
  ajuda_decisao_id uuid,
  operacao_id uuid,
  ocupado_ate timestamptz,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('computadores');
ALTER TABLE computadores ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE agentes ADD COLUMN computador_id uuid;
ALTER TABLE agentes ADD FOREIGN KEY (tenant_id, computador_id) REFERENCES computadores(tenant_id,id);
ALTER TABLE agentes ADD UNIQUE (tenant_id, computador_id);
ALTER TABLE computadores ADD CHECK (visibility = 'privado');

CREATE TABLE computador_acoes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  computador_id uuid NOT NULL,
  turno_id uuid,
  autor text NOT NULL CHECK (autor IN ('bot','pessoa')),
  tipo text NOT NULL,
  estado text NOT NULL CHECK (estado IN ('pendente','executando','concluida','falhou','recusada')),
  argumentos_cifrados text,
  em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('computador_acoes');
ALTER TABLE computador_acoes ADD PRIMARY KEY (tenant_id,id);
ALTER TABLE computador_acoes ADD FOREIGN KEY (tenant_id,computador_id) REFERENCES computadores(tenant_id,id);
ALTER TABLE computador_acoes ADD CHECK (visibility = 'privado');
CREATE INDEX computador_acoes_recentes ON computador_acoes(tenant_id, computador_id, em DESC);
-- ROLLBACK:
-- DROP TABLE computador_acoes;
-- ALTER TABLE agentes DROP COLUMN computador_id;
-- DROP TABLE computadores;
