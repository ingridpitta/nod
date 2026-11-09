-- 0030 a sessão do CLI pertence ao HARNESS, não só ao executor. Convenção `-- ROLLBACK:` no fim.
--
-- medido em 2026-09-28: desde os harnesses (59aaed2, 2026-09-18) o plano desligava o --resume para
-- TODO turno com harness escolhido (`!escolha` em emitir-plano-turno.ts), porque a 0005 só sabia dizer
-- 'local' ou 'catcher' e não havia como provar que a sessão era do Claude Code. Cada mensagem abria uma
-- sessão nova com 20 falas de 1.000 caracteres: o bot perdia o próprio trabalho entre turnos e cada
-- retomada reescrevia o resumo (Ada: 10 turnos em 3 min, 28/09).
--
-- Correção: guardar QUAL harness criou a sessão e QUANDO ela avançou pela última vez. O plano só retoma
-- quando o harness do turno é o mesmo que gravou; o que a conversa ganhou depois (rotina, colega,
-- retomada em sessão própria) entra no plano como "desde a sua última vez".
-- Só aditiva. Sessões já gravadas ficam sem harness e não são retomadas: o próximo turno abre sessão
-- nova e grava o harness (desfecho desconhecido é tratado como perigoso, ADR-009).

ALTER TABLE conversas ADD COLUMN IF NOT EXISTS sessao_harness text
  CHECK (sessao_harness IS NULL OR sessao_harness IN ('claude-cli', 'codex-cli', 'cursor-cli', 'hermes'));
ALTER TABLE conversas ADD COLUMN IF NOT EXISTS sessao_em timestamptz;

-- ROLLBACK:
-- ALTER TABLE conversas DROP COLUMN IF EXISTS sessao_em;
-- ALTER TABLE conversas DROP COLUMN IF EXISTS sessao_harness;
