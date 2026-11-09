-- definido em 2026-10-30 (NOD-84, ADR-139): o código de erro da rotina por webhook pedida no modo local (o servidor do Mac
-- não tem endereço público). Sozinho nesta migração porque um valor novo de enum não pode ser usado na mesma transação
-- que o criou (como na 0060, 0117 e 0126).
ALTER TYPE codigo_erro ADD VALUE IF NOT EXISTS 'webhook_so_compartilhado';

-- ROLLBACK:
-- -- codigo_erro não é tipo de coluna nem de função: basta recriar sem o valor (modelo da 0060 e da 0126).
-- ALTER TYPE codigo_erro RENAME TO codigo_erro_0131;
-- CREATE TYPE codigo_erro AS ENUM ('nao_encontrado', 'entrada_invalida', 'escopo_vazio', 'limite_atingido', 'nao_permitido',
--   'estado_invalido', 'executor_indisponivel', 'fuso_invalido', 'cron_sem_futuro', 'sala_tamanho', 'http_toca_dado_pessoal',
--   'env_placeholder_chave_nova', 'dono_imutavel', 'texto_vazio', 'conector_indisponivel', 'integracao_nao_configurada',
--   'integracao_autenticacao', 'nod_protegido', 'mudou_depois', 'cota_provisorio');
-- DROP TYPE codigo_erro_0131;
