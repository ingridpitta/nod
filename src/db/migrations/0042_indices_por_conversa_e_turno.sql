-- medido em 2026-09-30 (banco efêmero com 30 bots, 6,8 mil turnos e 14,5 mil mensagens; EXPLAIN ANALYZE como nod_app):
-- turnos não tinha índice por conversa, e toda leitura "turnos da conversa" varria a tabela inteira —
-- turnosRepo.listarDaConversa lia 6.817 linhas para devolver 50 (GET conversa, fios da pergunta, raio-x), e
-- pendentesRenderizaveis fazia o mesmo a cada GET conversa. Com o índice: listarDaConversa(50) de 17,6 para 8 ms, e a
-- contagem de execuções da frota (as 30 conversas numa consulta só) de 290 para 42 ms.
CREATE INDEX IF NOT EXISTS turnos_por_conversa ON turnos (tenant_id, conversa_id, criado_em);

-- medido em 2026-09-30 (mesmo banco): as leituras de mensagens por turno_id — marcarParciaisDoTurno (assentamento de
-- turno interrompido) e pedidoDaTarefa (plano da tarefa delegada) — varriam as 14,5 mil mensagens: 1.152 buffers,
-- 10,6 ms e 6,1 ms. Com o índice, 3 buffers, 1,8 ms e 0,15 ms. Parcial: fala de pessoa sem turno não entra.
CREATE INDEX IF NOT EXISTS mensagens_por_turno ON mensagens (tenant_id, turno_id) WHERE turno_id IS NOT NULL;

-- ROLLBACK:
-- DROP INDEX IF EXISTS mensagens_por_turno;
-- DROP INDEX IF EXISTS turnos_por_conversa;
