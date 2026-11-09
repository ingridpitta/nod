-- definido em 2026-11-02 (NOD-430): pedir a qualquer agente para mexer em um quadro. Duas coisas, só adição:
-- 1. `pedido_por` no lote e no comentário: quando o bot X mexe no quadro a pedido da pessoa na conversa, o histórico
--    mostra "Você, pela X" (o X já é o `autor_agente_id`). O agente sozinho (tarefa, rotina, colega) grava só o autor,
--    sem `pedido_por`. Sem FK de propósito: o valor é sempre a pessoa dona da linha (o mesmo `owner_id`, que também não
--    tem FK nestas tabelas), e `pessoas` é tabela de identidade sem escrita do nod_app (ADR-003, 0109).
-- 2. A proposta 'quadro_exclusao' (excluir o quadro de um bot pela conversa, com card, como excluir rotina). O valor
--    novo de enum não é usado nesta transação; as colunas podem vir junto.
-- O servidor antigo no ar não lê nem escreve as colunas novas (nulas por padrão).
SET LOCAL lock_timeout = '5s';

ALTER TYPE kind_proposta ADD VALUE IF NOT EXISTS 'quadro_exclusao';
ALTER TYPE tipo_decisao ADD VALUE IF NOT EXISTS 'quadro_exclusao';

ALTER TABLE quadro_lotes ADD COLUMN IF NOT EXISTS pedido_por uuid;
ALTER TABLE quadro_comentarios ADD COLUMN IF NOT EXISTS pedido_por uuid;

-- ROLLBACK:
-- -- Antes, apague as propostas/decisões 'quadro_exclusao' (delete from decisoes where tipo = 'quadro_exclusao';
-- -- delete from propostas where kind = 'quadro_exclusao'): com alguma linha usando o valor, o cast falha e a transação
-- -- inteira volta. Rode o bloco numa transação só (`psql -1 -v ON_ERROR_STOP=1`). Padrão da 0135.
-- ALTER TABLE quadro_comentarios DROP COLUMN IF EXISTS pedido_por;
-- ALTER TABLE quadro_lotes DROP COLUMN IF EXISTS pedido_por;
-- DROP INDEX propostas_acesso_de_rotina_aberta;
-- ALTER TYPE kind_proposta RENAME TO kind_proposta_0143;
-- CREATE TYPE kind_proposta AS ENUM ('perfil', 'rotina', 'acesso', 'pasta', 'rotina_atualizacao', 'rotina_exclusao', 'bot', 'lote_bots', 'credencial', 'colunas_quadro');
-- ALTER TABLE propostas ALTER COLUMN kind TYPE kind_proposta USING kind::text::kind_proposta;
-- DROP TYPE kind_proposta_0143;
-- CREATE UNIQUE INDEX propostas_acesso_de_rotina_aberta
--   ON propostas (tenant_id, owner_id, agente_id, (payload->>'conector'))
--   WHERE kind = 'acesso' AND estado = 'pendente' AND payload ? 'rotinaId';
-- ALTER TYPE tipo_decisao RENAME TO tipo_decisao_0143;
-- CREATE TYPE tipo_decisao AS ENUM ('aprovacao', 'acesso', 'retomar_turno', 'gate_rotina', 'perfil', 'rotina', 'pergunta',
--   'falta_de_dado', 'permissao', 'rotina_atualizacao', 'rotina_exclusao', 'bot', 'lote_bots', 'credencial', 'colunas_quadro');
-- ALTER TABLE decisoes ALTER COLUMN tipo TYPE tipo_decisao USING tipo::text::tipo_decisao;
-- DROP TYPE tipo_decisao_0143;
