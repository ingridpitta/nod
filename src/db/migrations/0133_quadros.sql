-- definido em 2026-10-31 (NOD-442): o quadro-agente de verdade. Um quadro por bot anfitrião (meta, prazo e o fecho da
-- meta), as tarefas dele (status, bot responsável, item do Linear, PR, pergunta e resposta do bloqueio, o turno que a
-- tarefa abriu) e os lotes (cada chamada da ferramenta ou ação da tela vira um lote, com a foto do antes para o Desfazer).
-- O conteúdo mora aqui; a trilha só leva ids (ADR-004).
-- Só adição: o servidor antigo no ar não lê nem escreve estas tabelas.
SET LOCAL lock_timeout = '5s';

CREATE TABLE quadros (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  agente_id uuid NOT NULL,
  meta text NOT NULL CHECK (length(meta) BETWEEN 1 AND 200),
  prazo date,
  cumprido_em timestamptz,
  resumo text,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  atualizado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('quadros');
ALTER TABLE quadros ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE quadros ADD FOREIGN KEY (tenant_id, agente_id) REFERENCES agentes (tenant_id, id) ON DELETE CASCADE;
-- Um quadro por bot anfitrião (a aba Quadro da conversa dele).
CREATE UNIQUE INDEX quadros_um_por_agente ON quadros (tenant_id, agente_id);

CREATE TABLE quadro_tarefas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  quadro_id uuid NOT NULL,
  titulo text NOT NULL CHECK (length(titulo) BETWEEN 1 AND 200),
  descricao text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN ('backlog', 'afazer', 'fazendo', 'voce', 'revisao', 'bloqueado', 'feito', 'cancelado')),
  agente_id uuid,
  ordem integer NOT NULL DEFAULT 0,
  linear_id text,
  linear_url text,
  pr_url text,
  pergunta text,
  resposta text,
  -- O conteúdo (título, descrição, pergunta) veio de fora ou de um turno contaminado (ADR-062): o turno que a tarefa abrir
  -- nasce contaminado. Pegajoso: uma vez de fora, fica de fora.
  de_fora boolean NOT NULL DEFAULT false,
  -- O último turno que a tarefa abriu no bot responsável (a execução do card sai do estado dele). Sem FK: o turno é
  -- apagado pela poda e o card só perde o "rodando".
  turno_id uuid,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  mudado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('quadro_tarefas');
ALTER TABLE quadro_tarefas ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE quadro_tarefas ADD FOREIGN KEY (tenant_id, quadro_id) REFERENCES quadros (tenant_id, id) ON DELETE CASCADE;
CREATE INDEX quadro_tarefas_do_quadro ON quadro_tarefas (tenant_id, quadro_id, ordem);
-- O gerir_quadro acha o quadro pelo turno da tarefa (doTurno) a cada chamada de bot.
CREATE INDEX quadro_tarefas_do_turno ON quadro_tarefas (tenant_id, turno_id) WHERE turno_id IS NOT NULL;
-- O mesmo item do Linear não entra duas vezes no mesmo quadro (importar de novo atualiza, não duplica).
CREATE UNIQUE INDEX quadro_tarefas_linear ON quadro_tarefas (tenant_id, quadro_id, lower(linear_id)) WHERE linear_id IS NOT NULL;

CREATE TABLE quadro_lotes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  quadro_id uuid NOT NULL,
  -- pessoa = a tela; agente = a ferramenta (autor_agente_id).
  autor text NOT NULL CHECK (autor IN ('pessoa', 'agente')),
  autor_agente_id uuid,
  resumo text NOT NULL,
  -- A foto do antes, para o Desfazer: {quadro: {...}|null, tarefas: [{id, antes: {...}|null}]}. antes null = a tarefa
  -- nasceu no lote (desfazer apaga); quadro null = o quadro nasceu no lote (desfazer apaga o quadro).
  antes jsonb NOT NULL,
  tarefa_ids uuid[] NOT NULL DEFAULT '{}',
  desfeito_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT quadro_lotes_autor CHECK ((autor = 'agente') = (autor_agente_id IS NOT NULL))
);
SELECT nod_escopar_tabela('quadro_lotes');
ALTER TABLE quadro_lotes ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE quadro_lotes ADD FOREIGN KEY (tenant_id, quadro_id) REFERENCES quadros (tenant_id, id) ON DELETE CASCADE;
CREATE INDEX quadro_lotes_recentes ON quadro_lotes (tenant_id, quadro_id, criado_em DESC);

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- DROP TABLE IF EXISTS quadro_lotes;
-- DROP TABLE IF EXISTS quadro_tarefas;
-- DROP TABLE IF EXISTS quadros;
