-- 0001 fundação. SQL puro (postgres.js não entende \i). Roda como nod_dono; a aplicação é nod_app.
-- Eixo PESSOA (ADR-003 revisado): toda tabela escopada tem tenant_id + owner_id + visibility,
-- ENABLE + FORCE ROW LEVEL SECURITY, policy PERMISSIVE nod_pessoa e RESTRICTIVE nod_tenant.
-- Convenção `-- ROLLBACK:` no fim (o runner só aplica o que vem antes).

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE TYPE visibilidade AS ENUM ('privado', 'equipe');
CREATE TYPE autor_tipo AS ENUM ('pessoa', 'agente');

-- ---------------------------------------------------------------------------------------------
-- Identidade: SEM RLS por pessoa (exceção nomeada no gate tests/conformidade/rls.test.ts).
-- Motivo: catálogo de identidade sem dado pessoal; lido para enumerar donos dos laços de fundo.
-- nod_app SÓ LÊ (GRANT SELECT): quem escreve identidade é o seed, como nod_dono. Testes que
-- precisam de pessoas as criam como nod_dono sob rollback (tests/helpers/db-dono.ts).
CREATE TABLE tenants (
  id uuid PRIMARY KEY,
  nome text NOT NULL
);

CREATE TABLE pessoas (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL,
  nome text NOT NULL,
  iniciais text NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

GRANT SELECT ON tenants, pessoas TO nod_app;

-- ---------------------------------------------------------------------------------------------
-- nod_escopar_tabela(tbl, perna_extra): as três colunas, ENABLE + FORCE, as duas policies, o GRANT.
-- perna_extra é SQL booleano avaliado com a linha (ex.: EXISTS (...) da sala, ADR-027; decisor_id da
-- decisão, EMENDA 1). NULL = só dono ou 'equipe'.
--
-- medido no spike 2026-09-16 (tests/integration/spike-rls-rollback.test.ts): só RESTRICTIVE nega tudo
-- — até o INSERT do próprio escopo cai em 42501 e o SELECT devolve 0. PERMISSIVE concede,
-- RESTRICTIVE aperta; por isso são DUAS policies, e a de tenant fica como perna conjuntiva
-- para o dia do SaaS custar dias.
CREATE FUNCTION nod_escopar_tabela(tbl regclass, perna_extra text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  extra text := COALESCE(perna_extra, 'false');
BEGIN
  -- DEFAULT do tenant = TENANT_PADRAO (src/db/seed/index.ts).
  EXECUTE format('ALTER TABLE %s ADD COLUMN IF NOT EXISTS tenant_id uuid NOT NULL DEFAULT %L',
                 tbl, '172e1fdf-428d-48cb-b052-3bd7d2573e18');
  EXECUTE format('ALTER TABLE %s ADD COLUMN IF NOT EXISTS owner_id uuid NOT NULL', tbl);
  EXECUTE format('ALTER TABLE %s ADD COLUMN IF NOT EXISTS visibility visibilidade NOT NULL DEFAULT ''privado''', tbl);
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', tbl);
  EXECUTE format('DROP POLICY IF EXISTS nod_pessoa ON %s', tbl);
  EXECUTE format('DROP POLICY IF EXISTS nod_tenant ON %s', tbl);
  EXECUTE format(
    $p$CREATE POLICY nod_pessoa ON %s AS PERMISSIVE FOR ALL TO nod_app
       USING (tenant_id = current_setting('nod.tenant_id')::uuid
              AND (owner_id = current_setting('nod.pessoa_id')::uuid
                   OR visibility = 'equipe'
                   OR (%s)))
       WITH CHECK (tenant_id = current_setting('nod.tenant_id')::uuid
                   AND owner_id = current_setting('nod.pessoa_id')::uuid)$p$,
    tbl, extra);
  EXECUTE format(
    $p$CREATE POLICY nod_tenant ON %s AS RESTRICTIVE FOR ALL TO nod_app
       USING (tenant_id = current_setting('nod.tenant_id')::uuid)$p$,
    tbl);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO nod_app', tbl);
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- Trilha imutável (ADR-004): só enum/uuid/timestamp/numérico, CHECK sem texto livre, trigger que
-- recusa UPDATE/DELETE/TRUNCATE inclusive para o dono, REVOKE para nod_app, prosa em tabela irmã
-- apagável por nod_poda, hash nullable nunca preenchido.
CREATE TABLE trilha (
  tenant_id uuid NOT NULL DEFAULT '172e1fdf-428d-48cb-b052-3bd7d2573e18',
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  visibility visibilidade NOT NULL DEFAULT 'privado',
  agente_id uuid NOT NULL,
  turno_id uuid,
  conector_id uuid,
  ferramenta text NOT NULL,
  kind text NOT NULL,
  motivo text,
  regra text NOT NULL,
  regra_versao int NOT NULL,
  em timestamptz NOT NULL DEFAULT now(),
  hash bytea,
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT trilha_sem_texto_livre CHECK (
    kind ~ '^[a-z0-9_]+$'
    AND regra ~ '^[a-z0-9_:]+$'
    AND ferramenta ~ '^[A-Za-z0-9_-]+$'
    AND (motivo IS NULL OR motivo ~ '^[a-z_]+$')
  )
);
SELECT nod_escopar_tabela('trilha');

CREATE TABLE trilha_prosa (
  tenant_id uuid NOT NULL DEFAULT '172e1fdf-428d-48cb-b052-3bd7d2573e18',
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  visibility visibilidade NOT NULL DEFAULT 'privado',
  trilha_id uuid NOT NULL,
  texto text NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, trilha_id) REFERENCES trilha (tenant_id, id)
);
SELECT nod_escopar_tabela('trilha_prosa');

CREATE FUNCTION nod_trilha_imutavel()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trilha é imutável (ADR-004): % recusado', TG_OP USING ERRCODE = 'P0001';
END;
$$;

CREATE TRIGGER trilha_no_update
  BEFORE UPDATE OR DELETE ON trilha
  FOR EACH ROW EXECUTE FUNCTION nod_trilha_imutavel();

CREATE TRIGGER trilha_no_truncate
  BEFORE TRUNCATE ON trilha
  FOR EACH STATEMENT EXECUTE FUNCTION nod_trilha_imutavel();

REVOKE UPDATE, DELETE, TRUNCATE ON trilha FROM nod_app;
GRANT SELECT, DELETE ON trilha_prosa TO nod_poda;

-- ---------------------------------------------------------------------------------------------
-- events: append-only, particionada por mês (ADR-005/006), 12 partições desde 2026-09 e NENHUMA
-- DEFAULT — INSERT fora da faixa falha alto (tests/integration/events-particao.test.ts).
-- Autoria composta desde a 0001 (ADR-023/025) e localidade/decisão (ADR-022/013).
-- RLS: policies no PAI valem para toda consulta pelo pai; nod_app NÃO recebe GRANT nas partições
-- (gate: partição = exceção nomeada, ver tests/conformidade/rls.test.ts, EMENDA 2 opção b).
CREATE TABLE events (
  tenant_id uuid NOT NULL DEFAULT '172e1fdf-428d-48cb-b052-3bd7d2573e18',
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  visibility visibilidade NOT NULL DEFAULT 'privado',
  created_at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL,
  autor_tipo autor_tipo NOT NULL,
  autor_id uuid NOT NULL,
  sob_procuracao_de uuid,
  conta_de_execucao uuid NOT NULL,
  executor text NOT NULL,
  locality text NOT NULL,
  locality_reason text NOT NULL,
  machine_id uuid,
  decidido_por text NOT NULL,
  regra_versao int NOT NULL,
  pessoa_destino_id uuid NOT NULL,
  conversa_id uuid,
  turno_id uuid,
  dados jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (tenant_id, id, created_at)
) PARTITION BY RANGE (created_at);
SELECT nod_escopar_tabela('events');

CREATE TABLE events_2026_09 PARTITION OF events FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE events_2026_10 PARTITION OF events FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE events_2026_11 PARTITION OF events FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE events_2026_12 PARTITION OF events FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE events_2027_01 PARTITION OF events FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');
CREATE TABLE events_2027_02 PARTITION OF events FOR VALUES FROM ('2027-02-01') TO ('2027-03-01');
CREATE TABLE events_2027_03 PARTITION OF events FOR VALUES FROM ('2027-03-01') TO ('2027-04-01');
CREATE TABLE events_2027_04 PARTITION OF events FOR VALUES FROM ('2027-04-01') TO ('2027-05-01');
CREATE TABLE events_2027_05 PARTITION OF events FOR VALUES FROM ('2027-05-01') TO ('2027-06-01');
CREATE TABLE events_2027_06 PARTITION OF events FOR VALUES FROM ('2027-06-01') TO ('2027-07-01');
CREATE TABLE events_2027_07 PARTITION OF events FOR VALUES FROM ('2027-07-01') TO ('2027-08-01');
CREATE TABLE events_2027_08 PARTITION OF events FOR VALUES FROM ('2027-08-01') TO ('2027-09-01');

-- ---------------------------------------------------------------------------------------------
-- Outbox transacional (ADR-010 refinado, Práticas §7): gravado na MESMA transação do evento.
-- owner_id = pessoa_destino_id: o frame é da pessoa que vai recebê-lo (ADR-016, buffer por pessoa).
-- Abandono exige DUAS condições (tentativas >= teto E idade >= mínima); abandonado é CONTADO, não apagado.
CREATE TABLE events_outbox (
  tenant_id uuid NOT NULL DEFAULT '172e1fdf-428d-48cb-b052-3bd7d2573e18',
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  visibility visibilidade NOT NULL DEFAULT 'privado',
  evento_id uuid NOT NULL,
  tipo text NOT NULL,
  dados jsonb NOT NULL DEFAULT '{}'::jsonb,
  tentativas int NOT NULL DEFAULT 0,
  criado_em timestamptz NOT NULL DEFAULT now(),
  entregue_em timestamptz,
  abandonado_em timestamptz,
  cancelado_em timestamptz,
  PRIMARY KEY (tenant_id, id)
);
SELECT nod_escopar_tabela('events_outbox');
CREATE INDEX events_outbox_pendentes
  ON events_outbox (tenant_id, owner_id, criado_em)
  WHERE entregue_em IS NULL AND abandonado_em IS NULL;

-- ---------------------------------------------------------------------------------------------
-- Máquinas que puxam trabalho (ADR-021): inventário sem credencial, sem email do fornecedor (ADR-019).
CREATE TABLE maquinas (
  tenant_id uuid NOT NULL DEFAULT '172e1fdf-428d-48cb-b052-3bd7d2573e18',
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  visibility visibilidade NOT NULL DEFAULT 'privado',
  nome text NOT NULL,
  inventario jsonb NOT NULL DEFAULT '{}'::jsonb,
  visto_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
SELECT nod_escopar_tabela('maquinas');

-- ROLLBACK:
DROP TABLE IF EXISTS maquinas;
DROP INDEX IF EXISTS events_outbox_pendentes;
DROP TABLE IF EXISTS events_outbox;
DROP TABLE IF EXISTS events;
DROP TRIGGER IF EXISTS trilha_no_truncate ON trilha;
DROP TRIGGER IF EXISTS trilha_no_update ON trilha;
DROP FUNCTION IF EXISTS nod_trilha_imutavel();
DROP TABLE IF EXISTS trilha_prosa;
DROP TABLE IF EXISTS trilha;
DROP FUNCTION IF EXISTS nod_escopar_tabela(regclass, text);
DROP TABLE IF EXISTS pessoas;
DROP TABLE IF EXISTS tenants;
DROP TYPE IF EXISTS autor_tipo;
DROP TYPE IF EXISTS visibilidade;
