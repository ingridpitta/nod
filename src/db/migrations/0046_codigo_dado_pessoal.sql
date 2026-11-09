-- definido em 2026-10-02: o código de erro de conector http que acessa dado pessoal ganha o nome da
-- regra que ele aplica (ADR-002, classificação de dado pessoal por origem). Só o rótulo muda: a ordem
-- do enum e as linhas já gravadas acompanham o RENAME VALUE. Condicional porque a primeira versão
-- desta migração circulou como 0042 numa branch e já renomeou alguns bancos de teste.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'codigo_erro' AND e.enumlabel = 'http_toca_aprendiz'
  ) THEN
    ALTER TYPE codigo_erro RENAME VALUE 'http_toca_aprendiz' TO 'http_toca_dado_pessoal';
  END IF;
END
$$;

-- ROLLBACK:
-- ALTER TYPE codigo_erro RENAME VALUE 'http_toca_dado_pessoal' TO 'http_toca_aprendiz';
