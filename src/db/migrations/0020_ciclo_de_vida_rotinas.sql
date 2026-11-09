-- definido em 2026-09-21: o agente passa a atualizar e excluir rotina, não só criar. Atualizar e
-- excluir NÃO são reversíveis em um clique como pausar, então passam por proposta/decisão — os dois
-- kinds novos abaixo. Pausar e reativar continuam aplicando direto (ADR-034 já trata rotina copiada
-- como pausada; aqui nada muda nesse caminho).
ALTER TYPE kind_proposta ADD VALUE IF NOT EXISTS 'rotina_atualizacao';
ALTER TYPE kind_proposta ADD VALUE IF NOT EXISTS 'rotina_exclusao';
ALTER TYPE tipo_decisao ADD VALUE IF NOT EXISTS 'rotina_atualizacao';
ALTER TYPE tipo_decisao ADD VALUE IF NOT EXISTS 'rotina_exclusao';

-- Exclusão RECUPERÁVEL, como a de agentes (ADR-034): retira de operação sem purgar. A trilha é
-- imutável (ADR-004) e as execuções passadas continuam existindo — por isso nunca DELETE FROM.
-- Nenhuma policy é ampliada: a tabela já passou por nod_escopar_tabela na 0002, e acrescentar
-- coluna não mexe em RLS (mesma forma das 0011/0012).
ALTER TABLE rotinas ADD COLUMN excluido_em timestamptz;

-- O índice parcial do scheduler (rotinas_ativas, 0002) passa a excluir as apagadas: sem isso uma
-- rotina excluída continuaria vencendo no tick. Recriado com o mesmo nome e mesmas colunas.
DROP INDEX rotinas_ativas;
CREATE INDEX rotinas_ativas ON rotinas (tenant_id, owner_id, proxima_execucao)
  WHERE estado = 'ativa' AND excluido_em IS NULL;

-- ROLLBACK:
-- DROP INDEX rotinas_ativas;
-- CREATE INDEX rotinas_ativas ON rotinas (tenant_id, owner_id, proxima_execucao) WHERE estado = 'ativa';
-- ALTER TABLE rotinas DROP COLUMN excluido_em;
-- Não há DROP VALUE em enum do Postgres: para tirar os kinds/tipos novos, apague antes as linhas
-- que os usam (DELETE FROM propostas WHERE kind IN ('rotina_atualizacao','rotina_exclusao'); idem
-- decisoes) e recrie os tipos. Só é seguro enquanto nenhuma proposta desse kind foi gravada.
