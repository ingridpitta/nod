-- 0035 o custo do turno deixa de ser o total da sessão do Claude Code. Convenção `-- ROLLBACK:`. Só aditiva.
--
-- medido em 2026-09-28: nos turnos de conversa e retomada (sessão retomada com --resume), o `total_cost_usd` do
-- CLI é o ACUMULADO da sessão — na Clarice, 8,35 → 8,80 → 9,68 → 9,95 → 10,07 → 10,15 → 11,17 em turnos
-- seguidos, enquanto as rotinas (sessão nova) marcavam ~0,21. A soma gravada do dia deu US$ 132,82 para um
-- gasto real perto de US$ 22,67. Agora o turno guarda a sessão e o total que o CLI informou, e custo_usd é a
-- diferença para o turno anterior da MESMA sessão.
--
-- Turnos gravados antes desta migração ficam como estão (sem a sessão, não há como separar o acumulado).

ALTER TABLE turnos ADD COLUMN IF NOT EXISTS sessao_cli text;
ALTER TABLE turnos ADD COLUMN IF NOT EXISTS custo_sessao_usd numeric;
CREATE INDEX IF NOT EXISTS turnos_por_sessao_cli ON turnos (tenant_id, sessao_cli, criado_em DESC) WHERE sessao_cli IS NOT NULL;

-- ROLLBACK:
-- DROP INDEX IF EXISTS turnos_por_sessao_cli;
-- ALTER TABLE turnos DROP COLUMN IF EXISTS custo_sessao_usd;
-- ALTER TABLE turnos DROP COLUMN IF EXISTS sessao_cli;
