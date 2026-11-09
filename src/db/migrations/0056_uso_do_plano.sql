-- definido em 2026-10-06 (NOD-179, recorte da NOD-12): o uso do plano da IA, como o próprio CLI informa a cada turno.
--
-- O Claude Code manda no stream-json um `rate_limit_event` com duas janelas (5 horas e a semana): quanto já foi usado
-- e quando renova. O app do Mac entrega o último do turno junto do resultado; o servidor guarda uma linha por pessoa
-- e CLI, sem histórico. Com dois Macs vence a leitura mais nova (`medido_em`). É informação para a pessoa, nunca gate
-- (emenda à ADR-036): nenhum turno é bloqueado por este número.
CREATE TABLE uso_do_plano (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  harness text NOT NULL,
  situacao text NOT NULL,
  -- {utilizacao, renovaEm} ou null quando o CLI não informou a janela; renovaEm em epoch ms.
  cinco_horas jsonb,
  semana jsonb,
  -- O computador que mediu (o id que o app anuncia, como em turnos.machine_id); null no executor do servidor.
  machine_id uuid,
  medido_em timestamptz NOT NULL,
  recebido_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uso_do_plano_harness CHECK (harness IN ('claude-cli', 'codex-cli', 'cursor-cli', 'hermes')),
  CONSTRAINT uso_do_plano_situacao CHECK (situacao IN ('normal', 'perto', 'esgotado', 'desconhecida')),
  CONSTRAINT uso_do_plano_tamanho CHECK (octet_length(coalesce(cinco_horas::text, '')) + octet_length(coalesce(semana::text, '')) <= 2000)
);
SELECT nod_escopar_tabela('uso_do_plano');
ALTER TABLE uso_do_plano ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE uso_do_plano ADD CONSTRAINT uso_do_plano_um_por_pessoa_e_cli UNIQUE (tenant_id, owner_id, harness);

-- ROLLBACK:
-- DROP TABLE uso_do_plano;
