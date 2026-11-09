-- definido em 2026-10-15 (NOD-281, ADR-107): a sessão do CLI é da máquina onde nasceu. O turno só retoma a sessão
-- (Claude `--resume`, Codex `thread/resume`) se cair na mesma máquina, com a mesma IA e a mesma conta; senão, vai o
-- histórico pelo prompt. Para isso a sessão guarda a máquina dela (conversas e trabalhos), e o turno guarda a IA que
-- de fato rodou (`turnos.harness` é a preferência, muitas vezes 'auto') — a retomada da cadeia (ADR-066) compara as
-- duas. A conta do turno já mora em `turnos.conta_id` (0074) e a da sessão em `sessao_conta_id`.
-- Só adição (expand-only): o código anterior não lê estas colunas. A sessão de antes fica sem máquina: no modo
-- compartilhado ela não é retomada (o próximo turno vai com o histórico e grava a sessão nova com a máquina).
SET LOCAL lock_timeout = '5s';

ALTER TABLE conversas ADD COLUMN IF NOT EXISTS sessao_maquina_id text;
ALTER TABLE trabalhos ADD COLUMN IF NOT EXISTS sessao_maquina_id text;
ALTER TABLE turnos ADD COLUMN IF NOT EXISTS harness_efetivo text;

-- ROLLBACK:
-- -- O código anterior não lê estas colunas: voltar a imagem basta. Para tirar o que foi criado:
-- ALTER TABLE turnos DROP COLUMN IF EXISTS harness_efetivo;
-- ALTER TABLE trabalhos DROP COLUMN IF EXISTS sessao_maquina_id;
-- ALTER TABLE conversas DROP COLUMN IF EXISTS sessao_maquina_id;
