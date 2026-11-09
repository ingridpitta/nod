-- definido em 2026-11-01 (NOD-448, ADR-140): o card que troca o conjunto de colunas do quadro pela conversa
-- (substituir_colunas). Proposta e decisão nascem com o mesmo id, tipo 'colunas_quadro'. Sozinhos nesta migração porque
-- um valor novo de enum não pode ser usado na mesma transação que o criou (como na 0060 e na 0117).
ALTER TYPE kind_proposta ADD VALUE IF NOT EXISTS 'colunas_quadro';
ALTER TYPE tipo_decisao ADD VALUE IF NOT EXISTS 'colunas_quadro';

-- ROLLBACK:
-- -- O Postgres não remove valor de enum: o rollback recria cada tipo sem 'colunas_quadro', com o mesmo nome e a mesma
-- -- ordem (padrão da 0117). Antes, apague as propostas/decisões 'colunas_quadro' (delete from decisoes where tipo =
-- -- 'colunas_quadro'; delete from propostas where kind = 'colunas_quadro'): com alguma linha usando o valor, o cast falha
-- -- e a transação inteira volta. Rode o bloco numa transação só (`psql -1 -v ON_ERROR_STOP=1`).
-- DROP INDEX propostas_acesso_de_rotina_aberta;
-- ALTER TYPE kind_proposta RENAME TO kind_proposta_0135;
-- CREATE TYPE kind_proposta AS ENUM ('perfil', 'rotina', 'acesso', 'pasta', 'rotina_atualizacao', 'rotina_exclusao', 'bot', 'lote_bots', 'credencial');
-- ALTER TABLE propostas ALTER COLUMN kind TYPE kind_proposta USING kind::text::kind_proposta;
-- DROP TYPE kind_proposta_0135;
-- CREATE UNIQUE INDEX propostas_acesso_de_rotina_aberta
--   ON propostas (tenant_id, owner_id, agente_id, (payload->>'conector'))
--   WHERE kind = 'acesso' AND estado = 'pendente' AND payload ? 'rotinaId';
-- ALTER TYPE tipo_decisao RENAME TO tipo_decisao_0135;
-- CREATE TYPE tipo_decisao AS ENUM ('aprovacao', 'acesso', 'retomar_turno', 'gate_rotina', 'perfil', 'rotina', 'pergunta',
--   'falta_de_dado', 'permissao', 'rotina_atualizacao', 'rotina_exclusao', 'bot', 'lote_bots', 'credencial');
-- ALTER TABLE decisoes ALTER COLUMN tipo TYPE tipo_decisao USING tipo::text::tipo_decisao;
-- DROP TYPE tipo_decisao_0135;
