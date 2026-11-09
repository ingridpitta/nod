-- 0004 policies por COMANDO em nod_escopar_tabela (pendência da L3.5, resolvida pela L9). Convenção `-- ROLLBACK:` no fim.
--
-- A 0001 criava UMA policy PERMISSIVE `nod_pessoa` FOR ALL cujo USING abria a linha ao dono OU a
-- 'equipe' OU à perna extra (decisora, grant de sala), e cujo WITH CHECK exigia owner_id = pessoa.
-- Só que USING vale para SELECT, UPDATE e DELETE — e DELETE não tem WITH CHECK: quem só devia LER
-- pela perna extra (a decisora de uma decisão, quem tem grant numa sala, qualquer pessoa do tenant
-- numa linha 'equipe') conseguia APAGAR a linha. medido em 2026-09-16 (tests/integration/repos/
-- policies-por-comando.test.ts, com a 0001 sozinha): `delete from decisoes` pela decisora → count 1.
--
-- Agora são QUATRO policies PERMISSIVE por tabela, uma por comando, com nomes fixos que o gate
-- (tests/conformidade/gate-rls.ts) confere no catálogo pelo `polcmd`:
--   nod_pessoa_select  FOR SELECT  USING (dono OU 'equipe' OU perna extra)   — a leitura ampla de antes
--   nod_pessoa_insert  FOR INSERT  WITH CHECK (dono)
--   nod_pessoa_update  FOR UPDATE  USING (dono) WITH CHECK (dono)
--   nod_pessoa_delete  FOR DELETE  USING (dono)
-- e a RESTRICTIVE `nod_tenant` continua conjuntiva. Quem precisa que a perna também ESCREVA continua
-- criando uma policy PERMISSIVE a mais para o comando (nod_decisora, 0003) com o trigger que fecha as
-- colunas — a regra do AGENTS.md não muda; ela ganha o chão certo.
--
-- A função é substituída (tabelas novas nascem assim) e todas as tabelas já escopadas são
-- re-escopadas preservando a perna extra: o USING da `nod_pessoa` antiga é copiado literalmente
-- (pg_get_expr) para a `nod_pessoa_select`. Partições de events não têm policy própria (cobertas
-- pelo pai; EMENDA 2 opção b) e ficam como estão.

CREATE OR REPLACE FUNCTION nod_escopar_tabela(tbl regclass, perna_extra text DEFAULT NULL)
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
  EXECUTE format('DROP POLICY IF EXISTS nod_pessoa_select ON %s', tbl);
  EXECUTE format('DROP POLICY IF EXISTS nod_pessoa_insert ON %s', tbl);
  EXECUTE format('DROP POLICY IF EXISTS nod_pessoa_update ON %s', tbl);
  EXECUTE format('DROP POLICY IF EXISTS nod_pessoa_delete ON %s', tbl);
  EXECUTE format('DROP POLICY IF EXISTS nod_tenant ON %s', tbl);
  EXECUTE format(
    $p$CREATE POLICY nod_pessoa_select ON %s AS PERMISSIVE FOR SELECT TO nod_app
       USING (tenant_id = current_setting('nod.tenant_id')::uuid
              AND (owner_id = current_setting('nod.pessoa_id')::uuid
                   OR visibility = 'equipe'
                   OR (%s)))$p$,
    tbl, extra);
  EXECUTE format(
    $p$CREATE POLICY nod_pessoa_insert ON %s AS PERMISSIVE FOR INSERT TO nod_app
       WITH CHECK (tenant_id = current_setting('nod.tenant_id')::uuid
                   AND owner_id = current_setting('nod.pessoa_id')::uuid)$p$,
    tbl);
  EXECUTE format(
    $p$CREATE POLICY nod_pessoa_update ON %s AS PERMISSIVE FOR UPDATE TO nod_app
       USING (tenant_id = current_setting('nod.tenant_id')::uuid
              AND owner_id = current_setting('nod.pessoa_id')::uuid)
       WITH CHECK (tenant_id = current_setting('nod.tenant_id')::uuid
                   AND owner_id = current_setting('nod.pessoa_id')::uuid)$p$,
    tbl);
  EXECUTE format(
    $p$CREATE POLICY nod_pessoa_delete ON %s AS PERMISSIVE FOR DELETE TO nod_app
       USING (tenant_id = current_setting('nod.tenant_id')::uuid
              AND owner_id = current_setting('nod.pessoa_id')::uuid)$p$,
    tbl);
  EXECUTE format(
    $p$CREATE POLICY nod_tenant ON %s AS RESTRICTIVE FOR ALL TO nod_app
       USING (tenant_id = current_setting('nod.tenant_id')::uuid)$p$,
    tbl);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO nod_app', tbl);
END;
$$;

-- Re-escopa toda tabela que tem a policy antiga, copiando o USING dela (é onde a perna extra mora).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.polrelid::regclass AS tbl, pg_get_expr(p.polqual, p.polrelid) AS qual
    FROM pg_policy p
    WHERE p.polname = 'nod_pessoa'
  LOOP
    EXECUTE format('DROP POLICY nod_pessoa ON %s', r.tbl);
    EXECUTE format('CREATE POLICY nod_pessoa_select ON %s AS PERMISSIVE FOR SELECT TO nod_app USING (%s)', r.tbl, r.qual);
    EXECUTE format(
      $p$CREATE POLICY nod_pessoa_insert ON %s AS PERMISSIVE FOR INSERT TO nod_app
         WITH CHECK (tenant_id = current_setting('nod.tenant_id')::uuid
                     AND owner_id = current_setting('nod.pessoa_id')::uuid)$p$,
      r.tbl);
    EXECUTE format(
      $p$CREATE POLICY nod_pessoa_update ON %s AS PERMISSIVE FOR UPDATE TO nod_app
         USING (tenant_id = current_setting('nod.tenant_id')::uuid
                AND owner_id = current_setting('nod.pessoa_id')::uuid)
         WITH CHECK (tenant_id = current_setting('nod.tenant_id')::uuid
                     AND owner_id = current_setting('nod.pessoa_id')::uuid)$p$,
      r.tbl);
    EXECUTE format(
      $p$CREATE POLICY nod_pessoa_delete ON %s AS PERMISSIVE FOR DELETE TO nod_app
         USING (tenant_id = current_setting('nod.tenant_id')::uuid
                AND owner_id = current_setting('nod.pessoa_id')::uuid)$p$,
      r.tbl);
  END LOOP;
END;
$$;

-- A trilha continua sem UPDATE/DELETE para nod_app (REVOKE da 0001): a policy de delete existe no
-- catálogo por uniformidade do gate, mas o privilégio não — o trigger e o REVOKE seguem mandando.
REVOKE UPDATE, DELETE, TRUNCATE ON trilha FROM nod_app;

-- Pendência L7 §5: rotinaJanelasRepo.buscarPorTurno (o turno de rotina acha a rotina pela janela).
CREATE INDEX IF NOT EXISTS rotina_janelas_turno_idx ON rotina_janelas (tenant_id, turno_id);

-- ROLLBACK:
DROP INDEX IF EXISTS rotina_janelas_turno_idx;
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.polrelid::regclass AS tbl, pg_get_expr(p.polqual, p.polrelid) AS qual
    FROM pg_policy p
    WHERE p.polname = 'nod_pessoa_select'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS nod_pessoa_select ON %s', r.tbl);
    EXECUTE format('DROP POLICY IF EXISTS nod_pessoa_insert ON %s', r.tbl);
    EXECUTE format('DROP POLICY IF EXISTS nod_pessoa_update ON %s', r.tbl);
    EXECUTE format('DROP POLICY IF EXISTS nod_pessoa_delete ON %s', r.tbl);
    EXECUTE format(
      $p$CREATE POLICY nod_pessoa ON %s AS PERMISSIVE FOR ALL TO nod_app USING (%s)
         WITH CHECK (tenant_id = current_setting('nod.tenant_id')::uuid
                     AND owner_id = current_setting('nod.pessoa_id')::uuid)$p$,
      r.tbl, r.qual);
  END LOOP;
END;
$$;
CREATE OR REPLACE FUNCTION nod_escopar_tabela(tbl regclass, perna_extra text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  extra text := COALESCE(perna_extra, 'false');
BEGIN
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
