-- definido em 2026-10-28 (NOD-408, ADR-137): o código de erro da cota do espaço provisório (429). Sozinho nesta migração
-- porque um valor novo de enum não pode ser usado na mesma transação que o criou (como na 0060 e na 0117).
ALTER TYPE codigo_erro ADD VALUE IF NOT EXISTS 'cota_provisorio';

-- A classificação nasce junto do turno: depois do INSERT não dá para reconstruir `contaminadoDe` quando a origem era
-- limpa. O DEFAULT protege writers antigos durante o deploy; o repositório novo grava a decisão exata.
ALTER TABLE turnos ADD COLUMN IF NOT EXISTS conta_cota_provisorio boolean NOT NULL DEFAULT true;
UPDATE turnos SET conta_cota_provisorio = false
WHERE origem = 'retomada' OR retoma_turno_id IS NOT NULL OR reenvios > 0;

-- A poda global dos contadores procura pela janela, inclusive desafios de nonce único que nunca seriam revisitados.
CREATE INDEX IF NOT EXISTS limites_conta_janela_idx ON limites_conta (janela);

-- ROLLBACK:
-- DROP INDEX IF EXISTS limites_conta_janela_idx;
-- ALTER TABLE turnos DROP COLUMN IF EXISTS conta_cota_provisorio;
-- -- codigo_erro não é tipo de coluna nem de função: basta recriar sem o valor (modelo da 0060).
-- ALTER TYPE codigo_erro RENAME TO codigo_erro_0126;
-- CREATE TYPE codigo_erro AS ENUM ('nao_encontrado', 'entrada_invalida', 'escopo_vazio', 'limite_atingido', 'nao_permitido',
--   'estado_invalido', 'executor_indisponivel', 'fuso_invalido', 'cron_sem_futuro', 'sala_tamanho', 'http_toca_dado_pessoal',
--   'env_placeholder_chave_nova', 'dono_imutavel', 'texto_vazio', 'conector_indisponivel', 'integracao_nao_configurada',
--   'integracao_autenticacao', 'nod_protegido', 'mudou_depois');
-- DROP TYPE codigo_erro_0126;
