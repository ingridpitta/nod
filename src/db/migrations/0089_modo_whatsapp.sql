-- definido em 2026-10-17 (ADR-112): a terceira chave de experimento da pessoa, ao lado da Calibração e da Memória longa
-- (0088, ADR-111). Nasce desligada: com ela desligada, nada muda.
--
-- exp_whatsapp: o prompt de texto troca a linha "Formatação:" pela linha "Tom:" (uma a três frases curtas, sem títulos,
--   tabelas ou listas, sem repetir o pedido) e o "Progresso:" deixa de pedir relatório completo. A ligação não muda.
--   Motivo medido: em 17/10, teste offline com o prompt conversa-manual (Sonnet 5.5, 10 mensagens × 2 rodadas): hoje
--   mediana de 1.229 caracteres e 85% das respostas com lista; com a linha, −64% (444 caracteres) e 0% com lista.
-- Uma linha por pessoa (0036); o turno lê a chave na emissão do plano e grava no Raio-X o que valeu.
ALTER TABLE preferencias ADD COLUMN IF NOT EXISTS exp_whatsapp boolean NOT NULL DEFAULT false;

-- ROLLBACK:
-- ALTER TABLE preferencias DROP COLUMN IF EXISTS exp_whatsapp;
