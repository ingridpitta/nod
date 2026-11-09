-- definido em 2026-10-16 (ADR-111): duas chaves de experimento da pessoa, ao lado do modo dev, para comparar ao longo
-- do tempo o efeito de mudanças no que o bot recebe. Nascem desligadas: com elas desligadas, nada muda.
--
-- exp_calibracao: o prompt de texto ganha a linha "Calibração:" (não negar a existência do que a busca não achou).
--   Motivo medido: no teste de 16/10, 17:16, o Nod afirmou duas vezes que "o Opus 5.5 não existe" (existe).
-- exp_memoria_longa: sem sessão retomada, o histórico leva as falas recentes até 8 mil caracteres (hoje 1 mil) e os
--   anexos anteriores da conversa voltam ao turno. Motivo medido: em 15/10, 15:46, a Frida 2 disse que o playbook
--   "não ficou salvo nesta máquina" e que a própria tabela "só chega inteira até a linha do Copy".
-- Uma linha por pessoa (0036); o turno lê as duas na emissão do plano e grava no Raio-X o que valeu.
ALTER TABLE preferencias ADD COLUMN IF NOT EXISTS exp_calibracao boolean NOT NULL DEFAULT false;
ALTER TABLE preferencias ADD COLUMN IF NOT EXISTS exp_memoria_longa boolean NOT NULL DEFAULT false;

-- ROLLBACK:
-- ALTER TABLE preferencias DROP COLUMN IF EXISTS exp_memoria_longa;
-- ALTER TABLE preferencias DROP COLUMN IF EXISTS exp_calibracao;
