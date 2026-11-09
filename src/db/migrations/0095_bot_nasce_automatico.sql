-- NOD-316 (decisão do Marlon na NOD-231; emenda da ADR-059 §1): todo bot nasce em Aprovar automaticamente.
-- O código grava MODO_APROVACAO_INICIAL no INSERT; o DEFAULT cobre os INSERTs crus (seed). Só o catálogo muda:
-- não reescreve a tabela nem atualiza linhas — os bots que já existem mantêm o modo.
SET LOCAL lock_timeout = '5s';
ALTER TABLE agentes ALTER COLUMN modo_aprovacao SET DEFAULT 'automatico';
-- ROLLBACK:
-- ALTER TABLE agentes ALTER COLUMN modo_aprovacao SET DEFAULT 'manual';
-- -- As linhas criadas no meio ficam em 'automatico'; a dona muda em Aprovações. Voltar a imagem sem o rollback é
-- -- seguro: o código antigo não grava a coluna e cai no DEFAULT.
