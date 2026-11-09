-- definido em 2026-10-07 (ADR-081, a caixa do Nod): a pessoa conta ao Nod um bug, uma ideia de melhoria ou uma dúvida
-- que ele não soube responder, e isso vira um relato — sem uma mensagem de bot apontada (ADR-041 exigia uma). O Marlon
-- lê os relatos do banco, como já lia os do botão; a tela Relatos ganha o filtro por tipo.
--
-- tipo: bug | melhoria | duvida (os do botão são todos 'bug'). origem: botao (a mensagem relatada, ADR-041) | nod (a
-- conversa com o Nod). O título é texto da pessoa (escrito pelo Nod com as palavras dela): mora na prosa, privada e
-- apagável por nod_poda (ADR-004), nunca nos metadados que a equipe lê.
ALTER TABLE relatos ALTER COLUMN mensagem_id DROP NOT NULL;
ALTER TABLE relatos ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'bug';
ALTER TABLE relatos ADD CONSTRAINT relatos_tipo CHECK (tipo IN ('bug', 'melhoria', 'duvida'));
ALTER TABLE relatos ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'botao';
ALTER TABLE relatos ADD CONSTRAINT relatos_origem CHECK (origem IN ('botao', 'nod'));
-- O relato do botão continua apontando a mensagem; só o contado ao Nod nasce sem ela.
ALTER TABLE relatos ADD CONSTRAINT relatos_botao_tem_mensagem CHECK (origem <> 'botao' OR mensagem_id IS NOT NULL);
ALTER TABLE relato_prosa ADD COLUMN IF NOT EXISTS titulo text;
ALTER TABLE relato_prosa ADD CONSTRAINT relato_prosa_titulo CHECK (titulo IS NULL OR char_length(titulo) BETWEEN 1 AND 120);
CREATE INDEX IF NOT EXISTS relatos_por_tipo ON relatos (tenant_id, tipo, criado_em DESC);

-- ROLLBACK:
-- -- (apague ou arquive antes os relatos com origem 'nod': são os únicos sem mensagem)
-- DROP INDEX IF EXISTS relatos_por_tipo;
-- ALTER TABLE relato_prosa DROP CONSTRAINT IF EXISTS relato_prosa_titulo;
-- ALTER TABLE relato_prosa DROP COLUMN IF EXISTS titulo;
-- ALTER TABLE relatos DROP CONSTRAINT IF EXISTS relatos_botao_tem_mensagem;
-- ALTER TABLE relatos DROP CONSTRAINT IF EXISTS relatos_origem;
-- ALTER TABLE relatos DROP COLUMN IF EXISTS origem;
-- ALTER TABLE relatos DROP CONSTRAINT IF EXISTS relatos_tipo;
-- ALTER TABLE relatos DROP COLUMN IF EXISTS tipo;
-- ALTER TABLE relatos ALTER COLUMN mensagem_id SET NOT NULL;
