-- definido em 2026-10-28 (NOD-362): índices da consulta de pedidos abertos entre bots (pedidos-de-colega.repo.ts, `abertos`),
-- chamada no disparo de cada rotina e no pedir_a_bot. Sem eles a consulta lia todas as mensagens da janela de 8 dias e
-- levava de 12 a 83 s em produção, travando o tick do agendador.
--
-- Parciais por `kind` e com colunas simples, não com `payload->>…`: sob RLS (FORCE ROW LEVEL SECURITY) o Postgres só usa
-- como condição de índice o que é leakproof, e `->>` (jsonb_object_field_text) não é; `kind = 'handoff'` (texteq) é,
-- e prova o predicado do índice parcial (conferido com EXPLAIN como nod_app):
-- - mensagens_handoffs_por_tempo: os handoffs do tenant desde o piso, sem passar pelas mensagens comuns.
-- - mensagens_peer_ask_por_conversa: o `not exists` da resposta (peer_ask) da mesma conversa.
--
-- Cada migração roda numa transação (migrar.ts), sem CONCURRENTLY: o índice trava as escritas em `mensagens` enquanto é
-- construído (~32 mil linhas em produção, menos de um segundo). lock_timeout de 5 s: sem a trava, a migração falha e o
-- deploy para, em vez de segurar o servidor esperando (o padrão da 0091).
SET LOCAL lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS mensagens_handoffs_por_tempo ON mensagens (tenant_id, criado_em) WHERE kind = 'handoff';
CREATE INDEX IF NOT EXISTS mensagens_peer_ask_por_conversa ON mensagens (tenant_id, conversa_id) WHERE kind = 'peer_ask';

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- DROP INDEX IF EXISTS mensagens_handoffs_por_tempo;
-- DROP INDEX IF EXISTS mensagens_peer_ask_por_conversa;
