-- definido em 2026-10-01 (item 7 da ADR-066): rotina que só acorda com pendência. Os Devs tinham rotina de 20 em
-- 20 minutos só para perguntar "tem algo pra mim?": cada execução custa ~US$ 0,30 e quase todas terminam em
-- sem_novidade. O trabalho passa a chegar por pedido de colega (pedir_a_bot); a rotina do Dev só existe para
-- RETOMAR o que ele deixou pela metade, e o que ele deixou pela metade são as pendências da ADR-064 (0044).
--
-- true = o disparo agendado lê as pendências visíveis do agente (abertas e com a_partir_de já passado) e, sem
-- nenhuma, registra a execução sem_novidade com motivo sem_pendencia e SEM turno: nenhum modelo roda, custo zero.
-- "Executar agora" da pessoa roda sempre. DEFAULT false: toda rotina que já existe segue acordando em toda janela.
--
-- O motivo novo vai em rotina_execucoes.motivo, text com CHECK '^[a-z_]+$' (0002): passa sem migração. Nenhuma
-- policy muda: coluna nova não mexe em RLS (mesma forma das 0011/0012/0020/0027).
ALTER TABLE rotinas ADD COLUMN so_com_pendencia boolean NOT NULL DEFAULT false;

-- ROLLBACK:
-- ALTER TABLE rotinas DROP COLUMN so_com_pendencia;
-- As execuções 'sem_novidade'/'sem_pendencia' já registradas continuam no histórico (motivo é texto livre de enum).
