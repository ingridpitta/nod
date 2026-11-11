-- definido em 2026-11-11 (NOD-413): "roda agora a rotina das 9h" pelo chat vira o card comum (Rodar agora · Agora não).
-- A proposta 'rotina_execucao' e a decisão de mesmo id guardam qual rotina rodar; só o clique dispara, pelo mesmo
-- executor do Testar agora (rotinas.executar). Valor novo de enum não pode ser usado na mesma transação que o criou
-- (0060, 0117, 0135, 0148): nada aqui o usa. O kind_mensagem 'rotina_execucao' é outro tipo e fica como está.
SET LOCAL lock_timeout = '5s';

ALTER TYPE kind_proposta ADD VALUE IF NOT EXISTS 'rotina_execucao';
ALTER TYPE tipo_decisao ADD VALUE IF NOT EXISTS 'rotina_execucao';

-- ROLLBACK:
-- -- Antes, apague o que usa o valor novo (delete from decisoes where tipo = 'rotina_execucao'; delete from propostas
-- -- where kind = 'rotina_execucao'). O Postgres não remove valor de enum: cada tipo é recriado sem ele, com o mesmo
-- -- nome e a mesma ordem (padrão da 0135 e da 0148). Rode o bloco numa transação só (`psql -1 -v ON_ERROR_STOP=1`).
-- SET LOCAL lock_timeout = '5s';
-- DROP INDEX propostas_acesso_de_rotina_aberta;
-- ALTER TYPE kind_proposta RENAME TO kind_proposta_0166;
-- CREATE TYPE kind_proposta AS ENUM ('perfil', 'rotina', 'acesso', 'pasta', 'rotina_atualizacao', 'rotina_exclusao', 'bot', 'lote_bots', 'credencial', 'colunas_quadro', 'quadro_exclusao', 'app', 'importacao_linear', 'assumir_quadro');
-- ALTER TABLE propostas ALTER COLUMN kind TYPE kind_proposta USING kind::text::kind_proposta;
-- DROP TYPE kind_proposta_0166;
-- CREATE UNIQUE INDEX propostas_acesso_de_rotina_aberta
--   ON propostas (tenant_id, owner_id, agente_id, (payload->>'conector'))
--   WHERE kind = 'acesso' AND estado = 'pendente' AND payload ? 'rotinaId';
-- ALTER TYPE tipo_decisao RENAME TO tipo_decisao_0166;
-- CREATE TYPE tipo_decisao AS ENUM ('aprovacao', 'acesso', 'retomar_turno', 'gate_rotina', 'perfil', 'rotina', 'pergunta',
--   'falta_de_dado', 'permissao', 'rotina_atualizacao', 'rotina_exclusao', 'bot', 'lote_bots', 'credencial', 'colunas_quadro', 'quadro_exclusao', 'app', 'importacao_linear', 'assumir_quadro');
-- ALTER TABLE decisoes ALTER COLUMN tipo TYPE tipo_decisao USING tipo::text::tipo_decisao;
-- DROP TYPE tipo_decisao_0166;
