-- definido em 2026-10-07 (ADR-081/082, o Nod: bot fixo da pessoa): os valores de enum que o Nod usa, sozinhos nesta
-- migração porque um valor novo não pode ser usado na mesma transação que o criou (como na 0028, 0047 e 0050).
-- nod_protegido: a recusa de excluir, ocultar, renomear, mover ou duplicar o Nod (403).
-- lote_bots: o card das mudanças em vários bots que o Nod pede de uma vez (gerir_bots).
ALTER TYPE codigo_erro ADD VALUE IF NOT EXISTS 'nod_protegido';
ALTER TYPE kind_proposta ADD VALUE IF NOT EXISTS 'lote_bots';
ALTER TYPE tipo_decisao ADD VALUE IF NOT EXISTS 'lote_bots';

-- ROLLBACK:
-- -- O Postgres não remove valor de enum: o rollback recria cada tipo sem os valores novos (NOD-195), com o mesmo nome
-- -- e a mesma ordem. Antes, apague ou recuse as propostas/decisões 'lote_bots': com alguma linha usando o valor,
-- -- o cast das colunas falha e a transação inteira volta (nada é apagado aqui). Rode o bloco numa transação só
-- -- (`psql -1 -v ON_ERROR_STOP=1`): solto, instrução por instrução, o erro do cast deixa o índice fora e
-- -- propostas.kind no kind_proposta_0060 (medido na QA do #205).
-- -- O índice parcial da 0026 cita 'acesso'::kind_proposta: sai antes da troca de tipo e volta igual depois.
-- DROP INDEX propostas_acesso_de_rotina_aberta;
-- ALTER TYPE kind_proposta RENAME TO kind_proposta_0060;
-- CREATE TYPE kind_proposta AS ENUM ('perfil', 'rotina', 'acesso', 'pasta', 'rotina_atualizacao', 'rotina_exclusao', 'bot');
-- ALTER TABLE propostas ALTER COLUMN kind TYPE kind_proposta USING kind::text::kind_proposta;
-- DROP TYPE kind_proposta_0060;
-- CREATE UNIQUE INDEX propostas_acesso_de_rotina_aberta
--   ON propostas (tenant_id, owner_id, agente_id, (payload->>'conector'))
--   WHERE kind = 'acesso' AND estado = 'pendente' AND payload ? 'rotinaId';
-- ALTER TYPE tipo_decisao RENAME TO tipo_decisao_0060;
-- CREATE TYPE tipo_decisao AS ENUM ('aprovacao', 'acesso', 'retomar_turno', 'gate_rotina', 'perfil', 'rotina', 'pergunta',
--   'falta_de_dado', 'permissao', 'rotina_atualizacao', 'rotina_exclusao', 'bot');
-- ALTER TABLE decisoes ALTER COLUMN tipo TYPE tipo_decisao USING tipo::text::tipo_decisao;
-- DROP TYPE tipo_decisao_0060;
-- -- codigo_erro não é tipo de coluna nem de função: basta recriar.
-- ALTER TYPE codigo_erro RENAME TO codigo_erro_0060;
-- CREATE TYPE codigo_erro AS ENUM ('nao_encontrado', 'entrada_invalida', 'escopo_vazio', 'limite_atingido', 'nao_permitido',
--   'estado_invalido', 'executor_indisponivel', 'fuso_invalido', 'cron_sem_futuro', 'sala_tamanho', 'http_toca_dado_pessoal',
--   'env_placeholder_chave_nova', 'dono_imutavel', 'texto_vazio', 'conector_indisponivel', 'integracao_nao_configurada',
--   'integracao_autenticacao');
-- DROP TYPE codigo_erro_0060;
