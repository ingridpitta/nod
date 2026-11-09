-- definido em 2026-10-30 (NOD-429, decisão do Marlon): a quarta chave de experimento da pessoa, ao lado da Calibração,
-- da Memória longa (0088, ADR-111) e do Modo WhatsApp (0089, ADR-112). Nasce desligada: com ela desligada, nada muda.
--
-- exp_quadro: o par Conversa | Quadro aparece na pílula das conversas com os bots da própria pessoa. Substitui a chave
--   local `localStorage nod.quadro` (que exigia o devtools, fechado no app do Mac) até a flag do servidor da NOD-415.
-- Uma linha por pessoa (0036); a web lê a chave das preferências.
SET LOCAL lock_timeout = '5s';

ALTER TABLE preferencias ADD COLUMN IF NOT EXISTS exp_quadro boolean NOT NULL DEFAULT false;

-- ROLLBACK:
-- ALTER TABLE preferencias DROP COLUMN IF EXISTS exp_quadro;
