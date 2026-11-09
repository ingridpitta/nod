-- definido em 2026-11-02 (NOD-419, migração 0140): o histórico de movimentos das tarefas do quadro. Cada mudança de coluna ou de
-- responsável (da pessoa, do agente, do terminei, da passagem de coluna, do freio) vira uma linha: de onde, para onde,
-- quem era o responsável antes e depois, quem moveu e quando. A tela mostra discreto na tarefa aberta e desfaz um
-- movimento; o domínio lê para o limite de recusas (nao_e_comigo), o laço de idas e voltas e o freio de acionamentos.
-- As travas das colunas moram no jsonb quadros.colunas (sem DDL). Só adição: o servidor antigo não lê esta tabela.
-- Sem FK para a tarefa (revisão do PR #629, como a 0138): o Desfazer de um lote que tirou a tarefa a devolve com o mesmo
-- id, e o histórico volta junto (a CASCADE apagava e zerava a conta de passes e do laço). O quadro que sai leva tudo.
SET LOCAL lock_timeout = '5s';

CREATE TABLE quadro_movimentos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  quadro_id uuid NOT NULL,
  tarefa_id uuid NOT NULL,
  -- O lote em que aconteceu (o Desfazer do lote marca os dele como desfeitos). Sem FK: o lote é só referência.
  lote_id uuid,
  tipo text NOT NULL CHECK (tipo IN ('mover', 'nao_e_comigo', 'laco', 'freio', 'desfazer', 'acionou')),
  de text NOT NULL CHECK (length(de) BETWEEN 1 AND 60),
  para text NOT NULL CHECK (length(para) BETWEEN 1 AND 60),
  agente_antes uuid,
  agente_depois uuid,
  autor text NOT NULL CHECK (autor IN ('pessoa', 'agente')),
  autor_agente_id uuid,
  motivo text CHECK (motivo IS NULL OR length(motivo) <= 600),
  -- O movimento abriu um turno do responsável (o freio conta estes).
  acionou boolean NOT NULL DEFAULT false,
  -- 'desfazer': o movimento que este desfez (o Desfazer do lote que o trouxe devolve a marca). Sem FK: só referência.
  desfaz uuid,
  -- O motivo foi escrito por um agente (ADR-047): texto de bot é dado de fora.
  de_fora boolean NOT NULL DEFAULT false,
  desfeito_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT quadro_movimentos_autor CHECK ((autor = 'agente') = (autor_agente_id IS NOT NULL))
);
SELECT nod_escopar_tabela('quadro_movimentos');
ALTER TABLE quadro_movimentos ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE quadro_movimentos ADD FOREIGN KEY (tenant_id, quadro_id) REFERENCES quadros (tenant_id, id) ON DELETE CASCADE;
CREATE INDEX quadro_movimentos_do_quadro ON quadro_movimentos (tenant_id, quadro_id, criado_em DESC);
CREATE INDEX quadro_movimentos_da_tarefa ON quadro_movimentos (tenant_id, tarefa_id, criado_em DESC);
CREATE INDEX quadro_movimentos_do_lote ON quadro_movimentos (tenant_id, lote_id) WHERE lote_id IS NOT NULL;

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- -- A tabela leva junto as FKs, os índices e as policies de nod_escopar_tabela (não há FK para quadro_tarefas a tirar).
-- DROP TABLE IF EXISTS quadro_movimentos;
