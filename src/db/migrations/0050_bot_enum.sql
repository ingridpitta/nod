-- definido em 2026-10-04 (ADR-077, onboarding por ligação): a Nina propõe o primeiro bot da pessoa (propor_bot) como
-- um card que ela confirma clicando ou falando. Proposta e decisão ganham o tipo 'bot'. Sozinha nesta migração porque
-- um valor novo de enum não pode ser usado na mesma transação que o criou (como na 0028 e na 0047).
ALTER TYPE kind_proposta ADD VALUE IF NOT EXISTS 'bot';
ALTER TYPE tipo_decisao ADD VALUE IF NOT EXISTS 'bot';

-- ROLLBACK:
-- (os valores ficam: Postgres não remove valor de enum; antes, recuse as propostas/decisões 'bot' pendentes)
