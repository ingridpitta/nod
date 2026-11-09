-- definido em 2026-10-26 (NOD-374): disjuntor por app (src/domain/disjuntor-conector.ts). Um timeout de `tools/call`
-- sozinho não põe mais o app em "Fora do ar": a sonda de confirmação decide, uma chamada bem-sucedida limpa e um laço de
-- fundo re-sonda a falha aberta com espera crescente (1, 2, 5, 15, 30 min, ±25%).
--
-- `falhas_seguidas`: sondas seguidas falhando desde que a falha abriu.
-- `timeouts_seguidos`: chamadas seguidas que estouraram o tempo sem nenhum sucesso no meio (existe com `ultima_falha` nula).
-- `ultimo_timeout_em`: o último timeout contado; um timeout mais de 24h30 depois dele, sem falha aberta, recomeça a contagem.
-- `proxima_sonda_em`: quando o laço sonda de novo (nula = no próximo ciclo).
-- `fora_do_ar_desde`: desde quando a falha aparece em Fora do ar (nula = ainda não persistiu o bastante).
-- `ultima_falha` (jsonb) ganha `causa` opcional ('acesso_recusado', 401/403): não precisa de coluna.
--
-- Só adição, sem backfill: o carimbo antigo fica com `fora_do_ar_desde` nula (sai de Fora do ar no deploy) e
-- `proxima_sonda_em` nula (o laço sonda no primeiro ciclo). O ADD COLUMN com default constante é só catálogo; o
-- lock_timeout faz o deploy falhar limpo em vez de enfileirar a cor que serve.
SET LOCAL lock_timeout = '5s';

-- O índice da trilha para a Atividade fica na 0114, numa transação própria (revisão 3 do PR #538): aqui ele seguraria a
-- trilha travada até o COMMIT junto com a ACCESS EXCLUSIVE de `conectores`, e a fase 2 (que trava o conector e depois
-- grava na trilha) entraria em deadlock com a migração.

ALTER TABLE conectores
  ADD COLUMN falhas_seguidas integer NOT NULL DEFAULT 0,
  ADD COLUMN timeouts_seguidos integer NOT NULL DEFAULT 0,
  ADD COLUMN ultimo_timeout_em timestamptz,
  ADD COLUMN proxima_sonda_em timestamptz,
  ADD COLUMN fora_do_ar_desde timestamptz,
  ADD CONSTRAINT conectores_falhas_seguidas_nao_negativa CHECK (falhas_seguidas >= 0),
  ADD CONSTRAINT conectores_timeouts_seguidos_nao_negativo CHECK (timeouts_seguidos >= 0);

-- O laço de fundo lê só os conectores com falha aberta (poucos): índice parcial.
CREATE INDEX conectores_com_falha ON conectores (tenant_id, owner_id) WHERE ultima_falha IS NOT NULL;

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- DROP INDEX IF EXISTS conectores_com_falha;
-- ALTER TABLE conectores
--   DROP CONSTRAINT IF EXISTS conectores_timeouts_seguidos_nao_negativo,
--   DROP CONSTRAINT IF EXISTS conectores_falhas_seguidas_nao_negativa,
--   DROP COLUMN IF EXISTS fora_do_ar_desde,
--   DROP COLUMN IF EXISTS proxima_sonda_em,
--   DROP COLUMN IF EXISTS ultimo_timeout_em,
--   DROP COLUMN IF EXISTS timeouts_seguidos,
--   DROP COLUMN IF EXISTS falhas_seguidas;
