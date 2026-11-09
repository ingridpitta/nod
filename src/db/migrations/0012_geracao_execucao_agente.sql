-- definido em 2026-09-17: restaurar um bot não revalida trabalho antigo, inclusive em salas de outras pessoas.
ALTER TABLE agentes ADD COLUMN geracao_execucao integer NOT NULL DEFAULT 0;
ALTER TABLE turnos ADD COLUMN geracao_execucao integer NOT NULL DEFAULT 0;
ALTER TABLE rotinas ADD COLUMN geracao_execucao integer NOT NULL DEFAULT 0;
CREATE OR REPLACE FUNCTION nod_agente_ativo() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW.tenant_id::text), hashtext(NEW.agente_id::text));
  SELECT geracao_execucao INTO NEW.geracao_execucao FROM agentes
    WHERE tenant_id = NEW.tenant_id AND id = NEW.agente_id AND excluido_em IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'agente inativo' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;

-- ROLLBACK:
-- Reinstalar a função nod_agente_ativo da 0011 antes de remover as colunas.
-- ALTER TABLE rotinas DROP COLUMN geracao_execucao;
-- ALTER TABLE turnos DROP COLUMN geracao_execucao;
-- ALTER TABLE agentes DROP COLUMN geracao_execucao;
