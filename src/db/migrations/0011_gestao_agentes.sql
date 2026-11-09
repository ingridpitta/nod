-- definido em 2026-09-17: exclusão recuperável; ocultar não interrompe trabalho.
ALTER TABLE agentes ADD COLUMN secao text NOT NULL DEFAULT '' CHECK (length(secao) <= 60);
ALTER TABLE agentes ADD COLUMN nao_lido boolean NOT NULL DEFAULT false;
ALTER TABLE agentes ADD COLUMN excluido_em timestamptz;

-- definido em 2026-09-17: a trava serializa exclusão com novos turnos/rotinas, inclusive por outras pessoas.
CREATE FUNCTION nod_agente_ativo() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW.tenant_id::text), hashtext(NEW.agente_id::text));
  PERFORM 1 FROM agentes WHERE tenant_id = NEW.tenant_id AND id = NEW.agente_id AND excluido_em IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'agente inativo' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER nod_turno_agente_ativo BEFORE INSERT ON turnos FOR EACH ROW EXECUTE FUNCTION nod_agente_ativo();
CREATE TRIGGER nod_rotina_agente_ativo BEFORE INSERT OR UPDATE OF estado ON rotinas
  FOR EACH ROW WHEN (NEW.estado = 'ativa') EXECUTE FUNCTION nod_agente_ativo();

-- ROLLBACK:
-- DROP TRIGGER nod_rotina_agente_ativo ON rotinas;
-- DROP TRIGGER nod_turno_agente_ativo ON turnos;
-- DROP FUNCTION nod_agente_ativo();
-- ALTER TABLE agentes DROP COLUMN secao, DROP COLUMN nao_lido, DROP COLUMN excluido_em;
