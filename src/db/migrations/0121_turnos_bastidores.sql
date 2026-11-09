-- definido em 2026-10-26 (ADR-130): a conversa do bot tem duas faixas, a da pessoa e a dos bastidores.
--
-- Até aqui a faixa da conversa era uma só (ADR-083 §3, ADR-099 I7): a triagem de uma rotina ou de um pedido de colega
-- roda na conversa do bot, sem trabalho, e a fala da pessoa esperava ela terminar ("Na fila · Ada lê quando terminar o
-- turno atual"). Esses turnos não ouvem a pessoa no meio (sessao-viva.ts, aceitaMensagemNaSessao), não usam a sessão do
-- CLI da conversa (emitir-plano-turno.ts) nem a gravam (sessao-do-turno.ts) e a rede de 2 min não os promove: a espera
-- ia até o fim deles, sem teto. Com a coluna, o `reivindicar` só segura um turno da conversa por outro da MESMA faixa.
--
-- `bastidores` nasce no INSERT (turnos.repo.ts, enfileirar): origem rotina, delegação ou peer, ou sob procuração; a
-- retomada e a repetição herdam do turno que continuam. Aqui, o mesmo para as linhas que já existem, subindo a cadeia de
-- `retoma_turno_id` desde a raiz (índice turnos_por_retoma, 0086; teto de 50 saltos contra ciclo, como raizDaCadeia).
-- ADD COLUMN com DEFAULT constante não reescreve a tabela; o UPDATE só toca as linhas que viram true.
--
-- Dado de tabela escopada escrito como nod_dono: NO FORCE só em volta do UPDATE, religado no MESMO bloco (regra da
-- 0005/0026/0096/0101) — sem isso o UPDATE muda 0 linhas em silêncio.
SET LOCAL lock_timeout = '5s';

ALTER TABLE turnos ADD COLUMN IF NOT EXISTS bastidores boolean NOT NULL DEFAULT false;

ALTER TABLE turnos NO FORCE ROW LEVEL SECURITY;

WITH RECURSIVE cadeia(tenant_id, id, bastidores, saltos) AS (
  SELECT tenant_id, id, (origem IN ('rotina', 'delegacao', 'peer') OR sob_procuracao_de IS NOT NULL), 0
  FROM turnos WHERE retoma_turno_id IS NULL
  UNION ALL
  SELECT t.tenant_id, t.id, (c.bastidores OR t.origem IN ('rotina', 'delegacao', 'peer') OR t.sob_procuracao_de IS NOT NULL), c.saltos + 1
  FROM turnos t JOIN cadeia c ON t.tenant_id = c.tenant_id AND t.retoma_turno_id = c.id
  WHERE c.saltos < 50
)
UPDATE turnos t SET bastidores = true
FROM cadeia c
WHERE c.tenant_id = t.tenant_id AND c.id = t.id AND c.bastidores AND NOT t.bastidores;

ALTER TABLE turnos FORCE ROW LEVEL SECURITY;

-- ROLLBACK:
-- -- O código anterior não lê a coluna: sem ela, a faixa volta a ser uma só por conversa.
-- ALTER TABLE turnos DROP COLUMN IF EXISTS bastidores;
