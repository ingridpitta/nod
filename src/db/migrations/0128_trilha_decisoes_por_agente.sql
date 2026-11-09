-- definido em 2026-10-29 (NOD-70): a aba Decisões do bot lê as decisões de autorização (tool_call, negacao, cartao) por
-- bot e período, mais novas primeiro, paginadas por (em, id). Índice parcial como o das recuperações (0114). Sozinho nesta
-- migração: a construção trava só as escritas na trilha. Sem CONCURRENTLY (a migração roda em transação). lock_timeout de
-- 5 s: se a trava não vier, a migração falha e o deploy para, em vez de segurar o servidor esperando.
SET LOCAL lock_timeout = '5s';

-- O predicado é o mesmo FILTRO_DECISAO de src/repositories/trilha.repo.ts (o planejador só usa o índice parcial se a
-- consulta trouxer as mesmas cláusulas; tests/unit/db/filtro-decisao.test.ts compara os dois): sem as chamadas do
-- próprio nod pela regra legada, o grosso da trilha, e sem as negações que não são decisão (MOTIVOS_FORA_DA_DECISAO).
CREATE INDEX IF NOT EXISTS trilha_decisoes_por_agente ON trilha (tenant_id, agente_id, em, id)
  WHERE kind in ('tool_call', 'negacao', 'cartao') and (conector_id is not null or regra <> 'regra:chamar_ferramenta') and coalesce(motivo, '') not in ('plano_ausente', 'alcance_insuficiente', 'conector_indisponivel', 'timeout_transporte', 'falha_tecnica');

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- DROP INDEX IF EXISTS trilha_decisoes_por_agente;
