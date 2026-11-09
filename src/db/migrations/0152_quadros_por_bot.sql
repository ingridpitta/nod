-- definido em 2026-11-07 (ADA-14, ADR-153): o quadro deixa de ser um por bot. `quadro_bots` (N:N) diz em que bots o
-- quadro aparece, e um é o padrão de cada bot; `quadros.agente_id` segue como o bot dono. O projeto é da pessoa (0 ou 1
-- por quadro). `preferencias.quadro_aberto` guarda o último quadro aberto em cada bot: {"<agente_id>": "<quadro_id>"}.
-- Só aditiva: o servidor de antes não lê nada disto, e o índice `quadros_um_por_agente` FICA (sai na 0153, depois de o
-- servidor novo estar no ar). O backfill faz de todo quadro de hoje o padrão do seu bot, sem tocar nas tarefas.
SET LOCAL lock_timeout = '5s';

CREATE TABLE projetos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  nome text NOT NULL CHECK (length(nome) BETWEEN 1 AND 60),
  nome_chave text NOT NULL CHECK (length(nome_chave) BETWEEN 1 AND 60),
  descricao text NOT NULL DEFAULT '' CHECK (length(descricao) <= 2000),
  meta text CHECK (meta IS NULL OR length(meta) BETWEEN 1 AND 200),
  prazo date,
  posicao integer NOT NULL DEFAULT 0 CHECK (posicao >= 0),
  arquivado_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  atualizado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('projetos');
ALTER TABLE projetos ADD PRIMARY KEY (tenant_id, id);
-- Um projeto ativo por nome (pela chave sem caixa e sem acento, src/domain/quadros-do-bot.ts) por pessoa.
CREATE UNIQUE INDEX projetos_um_por_nome ON projetos (tenant_id, owner_id, nome_chave) WHERE arquivado_em IS NULL;

-- nome NULL = "Tarefas" (o quadro migrado e o criado sem nome).
ALTER TABLE quadros ADD COLUMN nome text CHECK (nome IS NULL OR length(nome) BETWEEN 1 AND 60);
ALTER TABLE quadros ADD COLUMN projeto_id uuid;
ALTER TABLE quadros ADD CONSTRAINT quadros_projeto_fk FOREIGN KEY (tenant_id, projeto_id) REFERENCES projetos (tenant_id, id) ON DELETE SET NULL (projeto_id);
CREATE INDEX quadros_do_projeto ON quadros (tenant_id, projeto_id) WHERE projeto_id IS NOT NULL;

CREATE TABLE quadro_bots (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  quadro_id uuid NOT NULL,
  agente_id uuid NOT NULL,
  padrao boolean NOT NULL DEFAULT false,
  posicao integer NOT NULL DEFAULT 0 CHECK (posicao >= 0),
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('quadro_bots');
ALTER TABLE quadro_bots ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE quadro_bots ADD CONSTRAINT quadro_bots_quadro_fk FOREIGN KEY (tenant_id, quadro_id) REFERENCES quadros (tenant_id, id) ON DELETE CASCADE;
ALTER TABLE quadro_bots ADD CONSTRAINT quadro_bots_agente_fk FOREIGN KEY (tenant_id, agente_id) REFERENCES agentes (tenant_id, id) ON DELETE CASCADE;
CREATE UNIQUE INDEX quadro_bots_unico ON quadro_bots (tenant_id, quadro_id, agente_id);
-- Um padrão por bot (o que abre sem `?quadro=` e quando não há último aberto).
CREATE UNIQUE INDEX quadro_bots_um_padrao ON quadro_bots (tenant_id, agente_id) WHERE padrao;
CREATE INDEX quadro_bots_do_bot ON quadro_bots (tenant_id, agente_id, posicao);

-- O quadro único de hoje vira o padrão do seu bot (o dono). Idempotente pelo índice único.
INSERT INTO quadro_bots (tenant_id, owner_id, quadro_id, agente_id, padrao, posicao)
  SELECT tenant_id, owner_id, id, agente_id, true, 0 FROM quadros
  ON CONFLICT DO NOTHING;

ALTER TABLE preferencias ADD COLUMN quadro_aberto jsonb NOT NULL DEFAULT '{}'::jsonb
  CHECK (jsonb_typeof(quadro_aberto) = 'object');

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- -- Rode antes o ROLLBACK da 0153 (o índice um por bot de volta). O servidor de antes não lê nada disto: perdem-se os
-- -- nomes dos quadros, os projetos, os vínculos extras e o último aberto; nenhuma tarefa se perde.
-- ALTER TABLE preferencias DROP COLUMN quadro_aberto;
-- DROP TABLE quadro_bots;
-- DROP INDEX quadros_do_projeto;
-- ALTER TABLE quadros DROP CONSTRAINT quadros_projeto_fk;
-- ALTER TABLE quadros DROP COLUMN projeto_id;
-- ALTER TABLE quadros DROP COLUMN nome;
-- DROP TABLE projetos;
