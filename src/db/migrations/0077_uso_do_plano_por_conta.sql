-- definido em 2026-10-15 (NOD-253, decisão da NOD-221): o uso do plano por CONTA de IA. O portão da cota olhava a IA
-- inteira (uma linha de `uso_do_plano` por pessoa e CLI): com a Max do Claude no limite, todo o fundo dos bots fixos no
-- Claude parava mesmo com a Team livre (38 turnos presos ~40 h em 14/10). A leitura do turno que rodou numa conta da
-- lista (`turnos.conta_id`, 0074) passa a ser guardada também por conta, e o portão segura a IA só quando a conta que o
-- turno usaria não está livre.
--
-- Tabela nova em vez de `uso_do_plano.conta_id` com a troca do UNIQUE: o código anterior faz `on conflict (tenant_id,
-- owner_id, harness)` e quebraria a entrega do turno se o UNIQUE sumisse (rollback de imagem, NOD-173). A linha por IA
-- continua sendo gravada como sempre; esta é a mais.
SET LOCAL lock_timeout = '5s';

CREATE TABLE uso_do_plano_contas (
  conta_id uuid NOT NULL,
  harness text NOT NULL,
  situacao text NOT NULL,
  -- {utilizacao, renovaEm} ou null quando o CLI não informou a janela; renovaEm em epoch ms (como em uso_do_plano).
  cinco_horas jsonb,
  semana jsonb,
  machine_id uuid,
  medido_em timestamptz NOT NULL,
  recebido_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uso_conta_harness CHECK (harness IN ('claude-cli', 'codex-cli')),
  CONSTRAINT uso_conta_situacao CHECK (situacao IN ('normal', 'perto', 'esgotado', 'desconhecida')),
  CONSTRAINT uso_conta_tamanho CHECK (octet_length(coalesce(cinco_horas::text, '')) + octet_length(coalesce(semana::text, '')) <= 2000)
);
SELECT nod_escopar_tabela('uso_do_plano_contas');
ALTER TABLE uso_do_plano_contas ADD PRIMARY KEY (tenant_id, conta_id);
ALTER TABLE uso_do_plano_contas ADD FOREIGN KEY (tenant_id, conta_id) REFERENCES contas_ia (tenant_id, id) ON DELETE CASCADE;

-- definido em 2026-10-15 (NOD-283, C4/A5): quando o vínculo da conta virou `sem_acesso` (o turno ou a sonda voltou com
-- "conta sem acesso"). O anúncio de `pronta` só a solta com um login mais novo que isto; o app anterior, que anunciava
-- `pronta` pela conferência de login, não a devolve à fila. O CHECK da 0074 já aceita `sem_acesso`.
ALTER TABLE contas_ia_maquinas ADD COLUMN sem_acesso_em timestamptz;

-- ROLLBACK:
-- -- O código anterior não lê esta tabela: voltar a imagem basta. Para tirar o que foi criado (apaga as leituras por conta):
-- DROP TABLE IF EXISTS uso_do_plano_contas;
-- ALTER TABLE contas_ia_maquinas DROP COLUMN IF EXISTS sem_acesso_em;
