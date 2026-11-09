-- definido em 2026-10-13 (ADR-102, plano docs/plano-contas-mac-vm.md): as contas de IA são da pessoa, em todas as
-- máquinas. Até aqui o app do Mac guardava as contas (ADR-101) e a VM tinha uma conta por IA, logada no terminal, sem
-- relação com as do Mac. Agora o servidor guarda a lista (uma ordem só, Claude e ChatGPT intercalados), o apelido, o
-- plano e o limite de cada conta; e, por máquina, se a conta está logada nela. E-mail e organização nunca chegam aqui:
-- a máquina manda só a impressão (sha256 da conta com a pessoa, ADR-102 item 4).
--
-- `contas_ia`: uma linha por conta da pessoa e IA. `impressao` casa a mesma conta entre máquinas (única por pessoa e IA).
-- `removida_em`: "Remover de todas" — some da lista; a máquina que a anunciar com um login mais velho que isso sai dela
-- (R4 da revisão). `no_limite_ate`: o limite é da conta, vale em todas as máquinas.
-- `contas_ia_maquinas`: o vínculo conta × máquina (a chave da máquina, ADR-031; sem FK, como em 0066/0070, a chave pode
-- ser revogada). `sair_pedido_em`: "Sair desta máquina" — ela faz o logout no próximo contato e o vínculo some.
-- `preferencias.contas_modo` / `contas_escolhidas`: o "Perguntar antes"/"Trocar sozinho" da lista e a conta escolhida
-- ("Seguir com") por IA. `turnos.conta_id`: a conta que o plano mandou usar. `sessao_conta_id` (conversas e trabalhos):
-- a conta da sessão do CLI — a sessão do Codex mora na pasta da conta (R1 da revisão).
-- Só adição (expand-only): o código anterior não lê nada disto.
SET LOCAL lock_timeout = '5s';

CREATE TABLE contas_ia (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  ia text NOT NULL,
  impressao text NOT NULL,
  apelido text NOT NULL,
  plano text,
  corporativa boolean NOT NULL DEFAULT false,
  posicao integer NOT NULL,
  entra_na_troca_automatica boolean NOT NULL DEFAULT false,
  no_limite_ate timestamptz,
  removida_em timestamptz,
  criada_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT conta_ia_ia CHECK (ia IN ('claude-cli', 'codex-cli')),
  CONSTRAINT conta_ia_impressao CHECK (impressao ~ '^[0-9a-f]{64}$'),
  CONSTRAINT conta_ia_apelido CHECK (char_length(apelido) BETWEEN 1 AND 40),
  CONSTRAINT conta_ia_plano CHECK (plano IS NULL OR char_length(plano) BETWEEN 1 AND 40),
  CONSTRAINT conta_ia_posicao CHECK (posicao >= 1)
);
SELECT nod_escopar_tabela('contas_ia');
ALTER TABLE contas_ia ADD PRIMARY KEY (tenant_id, id);
CREATE UNIQUE INDEX contas_ia_por_impressao ON contas_ia (tenant_id, owner_id, ia, impressao);

CREATE TABLE contas_ia_maquinas (
  conta_id uuid NOT NULL,
  maquina_id uuid NOT NULL,
  estado text NOT NULL,
  sair_pedido_em timestamptz,
  visto_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT conta_maquina_estado CHECK (estado IN ('pronta', 'sem_login', 'sem_acesso'))
);
SELECT nod_escopar_tabela('contas_ia_maquinas');
ALTER TABLE contas_ia_maquinas ADD PRIMARY KEY (tenant_id, conta_id, maquina_id);
ALTER TABLE contas_ia_maquinas ADD FOREIGN KEY (tenant_id, conta_id) REFERENCES contas_ia (tenant_id, id) ON DELETE CASCADE;
-- A puxada de contas de cada máquina (a cada 3 s) lê as saídas pendentes dela (R10 da revisão).
CREATE INDEX contas_ia_maquinas_sair ON contas_ia_maquinas (tenant_id, maquina_id) WHERE sair_pedido_em IS NOT NULL;

ALTER TABLE preferencias ADD COLUMN IF NOT EXISTS contas_modo text NOT NULL DEFAULT 'perguntar';
ALTER TABLE preferencias ADD CONSTRAINT preferencias_contas_modo CHECK (contas_modo IN ('perguntar', 'automatico'));
ALTER TABLE preferencias ADD COLUMN IF NOT EXISTS contas_escolhidas jsonb NOT NULL DEFAULT '{}';
ALTER TABLE preferencias ADD CONSTRAINT preferencias_contas_escolhidas CHECK (jsonb_typeof(contas_escolhidas) = 'object' AND octet_length(contas_escolhidas::text) <= 500);

ALTER TABLE turnos ADD COLUMN IF NOT EXISTS conta_id uuid;
ALTER TABLE conversas ADD COLUMN IF NOT EXISTS sessao_conta_id uuid;
ALTER TABLE trabalhos ADD COLUMN IF NOT EXISTS sessao_conta_id uuid;

-- ROLLBACK:
-- -- O código anterior não lê nada disto: voltar a imagem basta. Para tirar o que foi criado:
-- ALTER TABLE trabalhos DROP COLUMN IF EXISTS sessao_conta_id;
-- ALTER TABLE conversas DROP COLUMN IF EXISTS sessao_conta_id;
-- ALTER TABLE turnos DROP COLUMN IF EXISTS conta_id;
-- ALTER TABLE preferencias DROP CONSTRAINT IF EXISTS preferencias_contas_escolhidas;
-- ALTER TABLE preferencias DROP COLUMN IF EXISTS contas_escolhidas;
-- ALTER TABLE preferencias DROP CONSTRAINT IF EXISTS preferencias_contas_modo;
-- ALTER TABLE preferencias DROP COLUMN IF EXISTS contas_modo;
-- DROP INDEX IF EXISTS contas_ia_maquinas_sair;
-- DROP TABLE IF EXISTS contas_ia_maquinas;
-- DROP TABLE IF EXISTS contas_ia;
