-- definido em 2026-10-22 (NOD-311, emenda da ADR-083; decisão do Marlon em 19/10): o Parar do chat principal para só o
-- turno do chat e encerra a parada na mesma transação, então ele não segura mais o despacho (rotinas, pedidos de
-- colegas, retorno de frentes). As paradas de chat que o código anterior deixou abertas seguiriam segurando esses bots
-- até a pessoa falar de novo: esta migração as encerra. Paradas de sala e a global (conversa_id nulo) ficam como estão.
-- Só dado (expand-only, sem DDL) e idempotente: o código anterior encerra as paradas da mesma forma (encerrarAbertas).
SET LOCAL lock_timeout = '5s';

-- Dado de tabela escopada escrito como nod_dono: NO FORCE só em volta do comando, religado no MESMO bloco (regra da
-- 0005/0017/0096) — sem isso o UPDATE afeta 0 linhas em silêncio; o gate rls.test.ts acusa se sobrar.
ALTER TABLE paradas NO FORCE ROW LEVEL SECURITY;
ALTER TABLE conversas NO FORCE ROW LEVEL SECURITY;
UPDATE paradas p SET encerrada_em = now()
  FROM conversas c
 WHERE p.encerrada_em IS NULL AND c.tenant_id = p.tenant_id AND c.id = p.conversa_id AND c.tipo = 'propria';
ALTER TABLE conversas FORCE ROW LEVEL SECURITY;
ALTER TABLE paradas FORCE ROW LEVEL SECURITY;

-- ROLLBACK:
-- -- Só dado. Voltar a imagem basta: o código anterior volta a abrir parada a cada Parar do chat.
-- -- As encerradas aqui não são reabertas (a pessoa já estaria liberada ao falar).
-- SELECT 1;
