-- definido em 2026-10-22 (ADR-121, NOD-92): a máquina na nuvem que dorme e acorda sozinha.
--
-- A VM é uma `maquina_tokens` comum (ADR-090); `maquinas_nuvem` fica ao lado e diz onde ela mora no Google, o estado
-- (o que o nod acha) e o desejo (o que os gatilhos pedem). O servidor chama a API do Google; nunca disca para a VM
-- (ADR-021). `maquina_id` é nulo enquanto a VM criada pelo nod ainda não pareou (PR 2).
--
-- `credenciais_nuvem`: a chave da conta de serviço do projeto da pessoa, cifrada com NOD_CREDENTIAL_KEY (cifrar(),
-- src/db/cifra.ts). Só a dona lê: sem perna extra e `visibility` presa em 'privado'.
-- `maquinas_nuvem_eventos`: só acrescenta (de, para, motivo, em), para ver por que uma máquina não acordou.
-- Reserva de operação (`operacao_id`, `ocupado_ate`) no padrão de `computadores` (0035): uma operação por máquina.
-- Só adição: o código anterior não lê nenhuma destas tabelas.
SET LOCAL lock_timeout = '5s';

CREATE TYPE estado_maquina_nuvem AS ENUM ('criando', 'acordada', 'adormecendo', 'dormindo', 'acordando', 'falhou_ao_acordar', 'excluida');
CREATE TYPE motivo_falha_nuvem AS ENUM ('credencial_nuvem', 'cota_ou_cobranca', 'sem_capacidade', 'motor_sem_contato', 'excluida');

CREATE TABLE credenciais_nuvem (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  provedor text NOT NULL,
  projeto text NOT NULL,
  conta_servico text NOT NULL,
  chave_cifrada text NOT NULL,
  -- NOD-92 (revisão B2): o nome da chave no Google (projects/…/keys/…); ao reconectar/revogar, as outras são apagadas.
  chave_nome text,
  criada_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  revogada_em timestamptz,
  CONSTRAINT credenciais_nuvem_provedor CHECK (provedor IN ('gcp')),
  CONSTRAINT credenciais_nuvem_projeto CHECK (char_length(projeto) BETWEEN 1 AND 64)
);
SELECT nod_escopar_tabela('credenciais_nuvem');
ALTER TABLE credenciais_nuvem ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE credenciais_nuvem ADD CONSTRAINT credenciais_nuvem_privada CHECK (visibility = 'privado');
CREATE UNIQUE INDEX credenciais_nuvem_uma_por_projeto ON credenciais_nuvem (tenant_id, owner_id, provedor, projeto);

CREATE TABLE maquinas_nuvem (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  credencial_id uuid NOT NULL,
  maquina_id uuid,
  provedor text NOT NULL DEFAULT 'gcp',
  projeto text NOT NULL,
  zona text NOT NULL,
  subrede text,
  nome_instancia text NOT NULL,
  request_id uuid,
  tamanho text,
  criada_pelo_nod boolean NOT NULL DEFAULT false,
  estado estado_maquina_nuvem NOT NULL DEFAULT 'acordada',
  estado_desde timestamptz NOT NULL DEFAULT clock_timestamp(),
  desejado text NOT NULL DEFAULT 'acordada',
  ligou_em timestamptz,
  -- NOD-92 (revisão B1): a última vez que um turno foi pego/estava rodando nesta máquina. O ocioso conta daqui, não de
  -- maquina_tokens.ultimo_uso_em (o poll do motor o atualiza a cada poucos segundos, e a máquina nunca dormiria).
  ultima_atividade_em timestamptz,
  motivo motivo_falha_nuvem,
  proxima_tentativa_em timestamptz,
  reiniciou_em timestamptz,
  dormir_apos_min integer DEFAULT 30,
  convite_cifrado text,
  convite_expira_em timestamptz,
  convite_confirmado_em timestamptz,
  operacao_id uuid,
  ocupado_ate timestamptz,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT maquinas_nuvem_provedor CHECK (provedor IN ('gcp')),
  CONSTRAINT maquinas_nuvem_desejado CHECK (desejado IN ('acordada', 'dormindo')),
  CONSTRAINT maquinas_nuvem_dormir_apos CHECK (dormir_apos_min IN (15, 30, 60, 120)),
  CONSTRAINT maquinas_nuvem_tamanho CHECK (tamanho IN ('padrao', 'menor')),
  CONSTRAINT maquinas_nuvem_nome CHECK (nome_instancia ~ '^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$')
);
SELECT nod_escopar_tabela('maquinas_nuvem');
ALTER TABLE maquinas_nuvem ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE maquinas_nuvem ADD FOREIGN KEY (tenant_id, credencial_id) REFERENCES credenciais_nuvem (tenant_id, id);
ALTER TABLE maquinas_nuvem ADD FOREIGN KEY (tenant_id, maquina_id) REFERENCES maquina_tokens (tenant_id, id) ON DELETE SET NULL (maquina_id);
CREATE UNIQUE INDEX maquinas_nuvem_uma_por_maquina ON maquinas_nuvem (tenant_id, maquina_id) WHERE estado <> 'excluida';
CREATE UNIQUE INDEX maquinas_nuvem_instancia ON maquinas_nuvem (tenant_id, projeto, zona, nome_instancia) WHERE estado <> 'excluida';
-- NOD-92 (revisão B3): uma criação por pessoa de cada vez (o pedido duplo perde no índice, além da trava da pessoa).
CREATE UNIQUE INDEX maquinas_nuvem_uma_criando ON maquinas_nuvem (tenant_id, owner_id) WHERE estado = 'criando';
CREATE INDEX maquinas_nuvem_da_pessoa ON maquinas_nuvem (tenant_id, owner_id) WHERE estado <> 'excluida';

CREATE TABLE maquinas_nuvem_eventos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  maquina_nuvem_id uuid NOT NULL,
  de estado_maquina_nuvem,
  para estado_maquina_nuvem NOT NULL,
  motivo motivo_falha_nuvem,
  em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('maquinas_nuvem_eventos');
ALTER TABLE maquinas_nuvem_eventos ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE maquinas_nuvem_eventos ADD FOREIGN KEY (tenant_id, maquina_nuvem_id) REFERENCES maquinas_nuvem (tenant_id, id) ON DELETE CASCADE;
CREATE INDEX maquinas_nuvem_eventos_da_maquina ON maquinas_nuvem_eventos (tenant_id, maquina_nuvem_id, em DESC);
-- Só acrescenta: nod_app não reescreve nem apaga a história (o CASCADE da máquina roda como dona da FK).
REVOKE UPDATE, DELETE ON maquinas_nuvem_eventos FROM nod_app;

-- ROLLBACK:
-- DROP TABLE IF EXISTS maquinas_nuvem_eventos;
-- DROP TABLE IF EXISTS maquinas_nuvem;
-- DROP TABLE IF EXISTS credenciais_nuvem;
-- DROP TYPE IF EXISTS motivo_falha_nuvem;
-- DROP TYPE IF EXISTS estado_maquina_nuvem;
