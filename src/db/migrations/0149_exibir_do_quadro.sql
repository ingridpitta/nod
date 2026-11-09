-- definido em 2026-11-04 (NOD-460): o Exibir do quadro em tela cheia (mostrar as colunas recolhidas e a densidade
-- compacta) é da pessoa e de cada quadro. Fica nas preferências de quem lê, chaveado pelo id do quadro:
-- {"<quadro_id>": {"recolhidas": true, "compacto": false}}. Quem participa do quadro de outra pessoa guarda o dele.
-- Só aditiva: a coluna nova tem padrão, o servidor de antes não a lê.
SET LOCAL lock_timeout = '5s';

ALTER TABLE preferencias ADD COLUMN quadro_exibir jsonb NOT NULL DEFAULT '{}'::jsonb
  CHECK (jsonb_typeof(quadro_exibir) = 'object');

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- -- O servidor de antes não lê a coluna; perde-se só o Exibir guardado (a tela volta ao padrão).
-- ALTER TABLE preferencias DROP COLUMN quadro_exibir;
