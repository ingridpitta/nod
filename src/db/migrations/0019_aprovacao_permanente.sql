-- definido em 2026-09-21 (ADR-042): "Sempre permitir isto" é regra da PESSOA para um AGENTE sobre
-- uma FERRAMENTA inteira, criada só por clique explícito — nada é inferido de histórico (ADR-038).
-- Tabela separada de `concessoes` de propósito: concessão responde "PODE chamar?" e alimenta o
-- catálogo do plano; esta responde "quando chamar, precisa de gente?" e alimenta a execução.
-- Revogar aqui não pode derrubar a ferramenta do catálogo.
CREATE TYPE motivo_aprovacao_manual AS ENUM (
  'sem_regra_permanente',
  'regra_suspensa_conteudo_nao_confiavel',
  'regra_inativa',
  'origem_sensivel',
  'destino_computador',
  'gate_de_rotina',
  'fora_do_catalogo',
  'sem_plano'
);
CREATE TYPE motivo_inatividade_permissao AS ENUM (
  'revogada_pela_pessoa',
  'concessao_revogada',
  'conector_desabilitado',
  'capacidade_fora_do_catalogo',
  'agente_excluido'
);

-- Por que o item precisou de pessoa. NULO = resolvido por regra (ADR-029: suspensão em silêncio é
-- negação seca, então a pessoa lê o motivo no card).
ALTER TABLE itens_aprovacao ADD COLUMN motivo_manual motivo_aprovacao_manual;

CREATE TABLE permissoes_permanentes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  agente_id uuid NOT NULL,
  conector_id uuid NOT NULL,
  -- Capacidade como o catálogo da sonda a nomeia; o mesmo CHECK de trilha.ferramenta (0001).
  capacidade text NOT NULL CHECK (capacidade ~ '^[A-Za-z0-9_-]+$'),
  -- O item que a pessoa estava vendo quando clicou: único elo que responde "o que ela clicou".
  item_origem_id uuid NOT NULL,
  -- Consentimento imutável e citável, como concessoes.mensagem_id (0002).
  mensagem_id uuid NOT NULL,
  -- Sob qual semântica a pessoa CONSENTIU; pode diferir da versão vigente quando a regra executa.
  regra_versao int NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- Revogação é MARCA, nunca DELETE: permissão de efeito externo que some sem rastro é o oposto
  -- do que este produto vende (ADR-004).
  inativo_em timestamptz,
  inativo_motivo motivo_inatividade_permissao,
  CONSTRAINT permissao_inativa_tem_motivo CHECK ((inativo_em IS NULL) = (inativo_motivo IS NULL))
);
SELECT nod_escopar_tabela('permissoes_permanentes');
ALTER TABLE permissoes_permanentes ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE permissoes_permanentes ADD FOREIGN KEY (tenant_id, agente_id) REFERENCES agentes (tenant_id, id);
ALTER TABLE permissoes_permanentes ADD FOREIGN KEY (tenant_id, conector_id) REFERENCES conectores (tenant_id, id);
ALTER TABLE permissoes_permanentes ADD FOREIGN KEY (tenant_id, item_origem_id) REFERENCES itens_aprovacao (tenant_id, id);
ALTER TABLE permissoes_permanentes ADD FOREIGN KEY (tenant_id, mensagem_id) REFERENCES mensagens (tenant_id, id);
-- Uma regra ATIVA por (pessoa, agente, conector, capacidade); o histórico de inativas fica.
CREATE UNIQUE INDEX permissao_permanente_ativa_unica
  ON permissoes_permanentes (tenant_id, owner_id, agente_id, conector_id, capacidade)
  WHERE inativo_em IS NULL;
CREATE INDEX permissoes_permanentes_do_agente ON permissoes_permanentes (tenant_id, agente_id) WHERE inativo_em IS NULL;

-- ROLLBACK:
-- ALTER TABLE itens_aprovacao DROP COLUMN motivo_manual;
-- DROP TABLE permissoes_permanentes;
-- DROP TYPE motivo_inatividade_permissao;
-- DROP TYPE motivo_aprovacao_manual;
