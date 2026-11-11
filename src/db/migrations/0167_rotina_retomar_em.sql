-- definido em 2026-11-11 (NOD-412): pausar uma rotina até uma data. `retomar_em` é o instante absoluto (UTC) em que o
-- agendador a reativa sozinho; null = pausa sem data (a de sempre). Só existe na pausada: ativar sempre limpa.
-- Aditiva: coluna nula, sem backfill. O servidor antigo (a cor velha nos 10 min do deploy, ou o rollback de imagem) não
-- lê a coluna, mas ESCREVE estado: o trigger nod_rotina_limpa_retomar apaga a data quando a pausada vira ativa, senão o
-- "Ativar" dele bateria no CHECK (revisão do PR #13).
SET LOCAL lock_timeout = '5s';

ALTER TABLE rotinas ADD COLUMN retomar_em timestamptz;

CREATE FUNCTION nod_rotina_limpa_retomar() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  NEW.retomar_em := NULL;
  RETURN NEW;
END $$;
CREATE TRIGGER nod_rotina_limpa_retomar BEFORE UPDATE OF estado ON rotinas
  FOR EACH ROW WHEN (OLD.estado = 'pausada' AND NEW.estado = 'ativa') EXECUTE FUNCTION nod_rotina_limpa_retomar();

ALTER TABLE rotinas ADD CONSTRAINT rotinas_retomar_so_pausada CHECK (retomar_em IS NULL OR estado = 'pausada');
-- O tick procura, por pessoa, as pausadas cuja data chegou.
CREATE INDEX rotinas_a_retomar ON rotinas (tenant_id, owner_id, retomar_em)
  WHERE estado = 'pausada' AND retomar_em IS NOT NULL AND excluido_em IS NULL;

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- DROP INDEX IF EXISTS rotinas_a_retomar;
-- ALTER TABLE rotinas DROP CONSTRAINT IF EXISTS rotinas_retomar_so_pausada;
-- DROP TRIGGER IF EXISTS nod_rotina_limpa_retomar ON rotinas;
-- DROP FUNCTION IF EXISTS nod_rotina_limpa_retomar();
-- ALTER TABLE rotinas DROP COLUMN retomar_em;
