-- 0005 a sessão do CLI pertence ao EXECUTOR, não à conversa. Convenção `-- ROLLBACK:` no fim.
--
-- medido em 2026-09-16 (teste manual do Marlon, conversa "Teste 1"): a conversa nasceu no executor
-- catcher, que gerava um session_id de mentira (randomUUID) e o assentar-turno o gravava em
-- conversas.sessao_cli sem olhar de onde veio. Ao trocar NOD_EXECUTOR para claude-cli, o primeiro
-- turno real montou `--resume <uuid-que-o-claude-nunca-viu>` e o CLI devolveu result com falha:
-- turno interrompido com erro_execucao, sinais attempted/prompt_submitted/produced_output todos true.
-- O E2E nunca pegou porque cada executor sempre rodou em conversas próprias.
--
-- Correção: guardar QUEM criou a sessão. O plano só reaproveita `--resume` quando o executor do
-- turno é o mesmo que gravou; caso contrário começa sessão nova (--session-id) e sobrescreve.

ALTER TABLE conversas ADD COLUMN IF NOT EXISTS sessao_executor text
  CHECK (sessao_executor IS NULL OR sessao_executor IN ('local', 'catcher'));

-- Sessões já gravadas não têm dono conhecido: invalidar é mais seguro que adivinhar (ADR-009:
-- desfecho desconhecido é tratado como perigoso). O próximo turno abre sessão nova.
--
-- medido em 2026-09-16: este UPDATE rodado como nod_dono afetou 0 linhas em SILÊNCIO — FORCE ROW
-- LEVEL SECURITY sujeita o DONO às policies, e todas são `TO nod_app`; uma policy PERMISSIVE extra
-- para nod_dono também deu 0 (a RESTRICTIVE nod_tenant exige current_setting que o dono não tem).
-- É a primeira migração que mexe em DADO de tabela escopada. Regra que fica: NO FORCE só em volta
-- do comando, religado no MESMO bloco — a transação do runner garante que um erro no meio não
-- deixa a tabela destravada, e o gate rls.test.ts (relforcerowsecurity) acusa se sobrar.
ALTER TABLE conversas NO FORCE ROW LEVEL SECURITY;
UPDATE conversas SET sessao_cli = NULL WHERE sessao_cli IS NOT NULL AND sessao_executor IS NULL;
ALTER TABLE conversas FORCE ROW LEVEL SECURITY;

-- ROLLBACK:
-- ALTER TABLE conversas DROP COLUMN IF EXISTS sessao_executor;
