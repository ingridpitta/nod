-- definido em 2026-11-07 (ADA-14, ADR-153 §7): sai o "um quadro por bot" (0133). Fase 2 da troca: o servidor novo grava
-- quadro_bots (0152) e cria o 2º quadro só com a flag NOD_QUADROS_N; até esta rodar, ele recusa com um_por_bot_ainda.
-- Risco registrado no PR: na janela da troca azul/verde, o servidor de antes cria quadro com
-- `on conflict (tenant_id, agente_id)`, que sem o índice único falha; só o criar_quadro do 1º quadro de um bot, por
-- minutos. O leitor novo trata o quadro sem linha em quadro_bots como do agente_id.
SET LOCAL lock_timeout = '5s';

DROP INDEX IF EXISTS quadros_um_por_agente;
CREATE INDEX IF NOT EXISTS quadros_do_agente ON quadros (tenant_id, agente_id);

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- -- Só volta se nenhum bot tem 2+ quadros (senão mova ou remova antes: a consulta abaixo lista quem tem).
-- -- select tenant_id, agente_id, count(*) from quadros group by 1, 2 having count(*) > 1;
-- DO $$ BEGIN IF EXISTS (SELECT 1 FROM quadros GROUP BY tenant_id, agente_id HAVING count(*) > 1) THEN RAISE EXCEPTION 'há bot com 2+ quadros: mova ou remova antes do rollback da 0156'; END IF; END $$;
-- DROP INDEX quadros_do_agente;
-- CREATE UNIQUE INDEX quadros_um_por_agente ON quadros (tenant_id, agente_id);
