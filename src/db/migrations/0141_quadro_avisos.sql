-- definido em 2026-11-02 (NOD-420): o quadro só chama a pessoa quando precisa dela. Quatro marcas por tarefa, todas da
-- estadia na coluna atual:
-- `na_coluna_desde`: quando a tarefa entrou na coluna em que está (o `mudado_em` muda com qualquer edição). O prazo (SLA)
--   opcional da coluna conta daqui, e a janela que junta as decisões pendentes numa mensagem só também.
-- `avisada_em`: a pessoa já recebeu o aviso desta espera (Bloqueado / Precisa de você). Uma vez por entrada.
-- `cobrada_em`: o quadro já cobrou o responsável pelo prazo estourado. Uma vez.
-- `escalada_em`: continuou parada depois da cobrança e a pessoa foi avisada. Uma vez.
-- O gatilho zera as três e reinicia `na_coluna_desde` quando o status muda (qualquer caminho: lote, Desfazer, restauração),
-- então o código que grava a tarefa não precisa saber delas.
-- Só adição: o servidor de antes não lê estas colunas e o gatilho não muda o que ele grava. O default é now() (estável),
-- não clock_timestamp() (volátil): assim o ADD COLUMN não reescreve a tabela (revisão do PR #624).
SET LOCAL lock_timeout = '5s';

ALTER TABLE quadro_tarefas ADD COLUMN na_coluna_desde timestamptz NOT NULL DEFAULT now();
ALTER TABLE quadro_tarefas ADD COLUMN avisada_em timestamptz;
ALTER TABLE quadro_tarefas ADD COLUMN cobrada_em timestamptz;
ALTER TABLE quadro_tarefas ADD COLUMN escalada_em timestamptz;
-- Backfill sem rajada: a entrada na coluna é o último `mudado_em` (aproximação; nenhuma coluna tem prazo ainda, então
-- nada é cobrado por ela), e as que já esperam a pessoa ficam como avisadas: o aviso de antes (na hora) já saiu, e o
-- primeiro varredor não repete.
UPDATE quadro_tarefas SET na_coluna_desde = mudado_em, avisada_em = CASE WHEN status IN ('voce', 'bloqueado') THEN mudado_em END;

CREATE FUNCTION nod_quadro_tarefa_mudou_coluna()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.na_coluna_desde := clock_timestamp();
    NEW.avisada_em := NULL;
    NEW.cobrada_em := NULL;
    NEW.escalada_em := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER nod_quadro_tarefa_mudou_coluna BEFORE UPDATE ON quadro_tarefas
  FOR EACH ROW EXECUTE FUNCTION nod_quadro_tarefa_mudou_coluna();

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- DROP TRIGGER IF EXISTS nod_quadro_tarefa_mudou_coluna ON quadro_tarefas;
-- DROP FUNCTION IF EXISTS nod_quadro_tarefa_mudou_coluna();
-- ALTER TABLE quadro_tarefas DROP COLUMN escalada_em;
-- ALTER TABLE quadro_tarefas DROP COLUMN cobrada_em;
-- ALTER TABLE quadro_tarefas DROP COLUMN avisada_em;
-- ALTER TABLE quadro_tarefas DROP COLUMN na_coluna_desde;
