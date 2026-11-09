-- definido em 2026-10-04 (ADR-077, onboarding por ligação): o progresso do onboarding e o que a pessoa contou na
-- entrevista moram nas preferências dela (uma linha por pessoa, 0036). Só adição (expand-only): o código anterior
-- continua rodando sobre este schema durante a drenagem do deploy.
--
-- onboarding_etapa: onde a pessoa está (null = nunca começou). onboarding_guia_id: a bot guia (a Nina) desta pessoa,
-- reaproveitada em "Ver o onboarding de novo". onboarding_bot_id: o bot novo que o onboarding criou — só ele aceita o
-- `para_bot` de pedir_acesso e criar_rotina. apelido: como ela quer ser chamada (vira o nome dela nos prompts).
ALTER TABLE preferencias ADD COLUMN IF NOT EXISTS onboarding_etapa text;
ALTER TABLE preferencias ADD CONSTRAINT preferencias_onboarding_etapa
  CHECK (onboarding_etapa IS NULL OR onboarding_etapa IN ('ola', 'executor', 'chamando', 'entrevista', 'configurando', 'concluido'));
ALTER TABLE preferencias ADD COLUMN IF NOT EXISTS onboarding_guia_id uuid;
ALTER TABLE preferencias ADD COLUMN IF NOT EXISTS onboarding_bot_id uuid;
ALTER TABLE preferencias ADD COLUMN IF NOT EXISTS onboarding_concluido_em timestamptz;
ALTER TABLE preferencias ADD COLUMN IF NOT EXISTS apelido text;
ALTER TABLE preferencias ADD CONSTRAINT preferencias_apelido CHECK (apelido IS NULL OR char_length(apelido) BETWEEN 1 AND 60);
ALTER TABLE preferencias ADD COLUMN IF NOT EXISTS como_conheceu text;
ALTER TABLE preferencias ADD CONSTRAINT preferencias_como_conheceu CHECK (como_conheceu IS NULL OR char_length(como_conheceu) BETWEEN 1 AND 200);
ALTER TABLE preferencias ADD COLUMN IF NOT EXISTS objetivo text;
ALTER TABLE preferencias ADD CONSTRAINT preferencias_objetivo CHECK (objetivo IS NULL OR char_length(objetivo) BETWEEN 1 AND 500);
ALTER TABLE preferencias ADD COLUMN IF NOT EXISTS tamanho_time text;
ALTER TABLE preferencias ADD CONSTRAINT preferencias_tamanho_time CHECK (tamanho_time IS NULL OR tamanho_time IN ('so_eu', '2_10', '11_50', '51_mais'));
-- Os dois bots apontam para agentes da mesma pessoa (FK composta, como as outras tabelas escopadas).
ALTER TABLE preferencias ADD FOREIGN KEY (tenant_id, onboarding_guia_id) REFERENCES agentes (tenant_id, id);
ALTER TABLE preferencias ADD FOREIGN KEY (tenant_id, onboarding_bot_id) REFERENCES agentes (tenant_id, id);

-- Quem já usa o nod não vê o onboarding: quem tem algum bot confirmado OU uma chave de máquina ganha a conclusão
-- agora. É dado de tabela escopada lido e escrito como nod_dono: NO FORCE só em volta dos comandos, religado no MESMO
-- bloco (regra da 0005/0026/0039) — o gate rls.test.ts (relforcerowsecurity) acusa se sobrar.
ALTER TABLE preferencias NO FORCE ROW LEVEL SECURITY;
ALTER TABLE agentes NO FORCE ROW LEVEL SECURITY;
ALTER TABLE maquina_tokens NO FORCE ROW LEVEL SECURITY;

INSERT INTO preferencias (tenant_id, owner_id, onboarding_etapa, onboarding_concluido_em)
SELECT quem.tenant_id, quem.owner_id, 'concluido', clock_timestamp()
FROM (
  SELECT tenant_id, owner_id FROM agentes WHERE confirmado AND dono = 'pessoa'
  UNION
  SELECT tenant_id, owner_id FROM maquina_tokens
) quem
ON CONFLICT (tenant_id, owner_id) DO UPDATE
  SET onboarding_etapa = 'concluido', onboarding_concluido_em = clock_timestamp()
  WHERE preferencias.onboarding_concluido_em IS NULL;

ALTER TABLE maquina_tokens FORCE ROW LEVEL SECURITY;
ALTER TABLE agentes FORCE ROW LEVEL SECURITY;
ALTER TABLE preferencias FORCE ROW LEVEL SECURITY;

-- ROLLBACK:
-- ALTER TABLE preferencias DROP COLUMN onboarding_etapa, DROP COLUMN onboarding_guia_id, DROP COLUMN onboarding_bot_id,
--   DROP COLUMN onboarding_concluido_em, DROP COLUMN apelido, DROP COLUMN como_conheceu, DROP COLUMN objetivo,
--   DROP COLUMN tamanho_time;
