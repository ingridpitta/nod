-- definido em 2026-10-28 (NOD-50): o cartão de pedido de credencial. O bot pede uma chave com pedir_credencial e a pessoa
-- cola o valor num campo que vai direto ao cofre; proposta e decisão nascem com o mesmo id, tipo 'credencial'. Sozinhos
-- nesta migração porque um valor novo de enum não pode ser usado na mesma transação que o criou (como na 0060).
ALTER TYPE kind_proposta ADD VALUE IF NOT EXISTS 'credencial';
ALTER TYPE tipo_decisao ADD VALUE IF NOT EXISTS 'credencial';

-- ROLLBACK:
-- -- O Postgres não remove valor de enum: o rollback recria cada tipo sem 'credencial', com o mesmo nome e a mesma ordem
-- -- (padrão da 0060). Antes, apague ou recuse as propostas/decisões 'credencial': com alguma linha usando o valor, o cast
-- -- falha e a transação inteira volta. Rode o bloco numa transação só (`psql -1 -v ON_ERROR_STOP=1`).
-- -- O índice parcial da 0026 cita 'acesso'::kind_proposta: sai antes da troca de tipo e volta igual depois.
-- DROP INDEX propostas_acesso_de_rotina_aberta;
-- ALTER TYPE kind_proposta RENAME TO kind_proposta_0117;
-- CREATE TYPE kind_proposta AS ENUM ('perfil', 'rotina', 'acesso', 'pasta', 'rotina_atualizacao', 'rotina_exclusao', 'bot', 'lote_bots');
-- ALTER TABLE propostas ALTER COLUMN kind TYPE kind_proposta USING kind::text::kind_proposta;
-- DROP TYPE kind_proposta_0117;
-- CREATE UNIQUE INDEX propostas_acesso_de_rotina_aberta
--   ON propostas (tenant_id, owner_id, agente_id, (payload->>'conector'))
--   WHERE kind = 'acesso' AND estado = 'pendente' AND payload ? 'rotinaId';
-- ALTER TYPE tipo_decisao RENAME TO tipo_decisao_0117;
-- CREATE TYPE tipo_decisao AS ENUM ('aprovacao', 'acesso', 'retomar_turno', 'gate_rotina', 'perfil', 'rotina', 'pergunta',
--   'falta_de_dado', 'permissao', 'rotina_atualizacao', 'rotina_exclusao', 'bot', 'lote_bots');
-- ALTER TABLE decisoes ALTER COLUMN tipo TYPE tipo_decisao USING tipo::text::tipo_decisao;
-- DROP TYPE tipo_decisao_0117;
