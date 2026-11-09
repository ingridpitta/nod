-- definido em 2026-10-28 (NOD-54, ADR-134): checkpoints de arquivos por turno. A máquina tira a foto da pasta do bot
-- (num git sombra em ~/nod/.checkpoints, fora do repositório da pessoa) antes do turno e, no fim, manda só o resumo:
-- os caminhos que mudaram e a ação (criado, mudado, apagado). O conteúdo nunca sobe; o servidor guarda o resumo para a
-- web mostrar "Desfazer N arquivos" na fala e enfileira o pedido de desfazer para a máquina, que relata o resultado.
--
-- Uma linha por turno que mudou arquivo (`checkpoints_por_turno`). `maquina_id`, como em 0066 e 0070, sem FK: a chave
-- pode ser revogada. `pasta_do_bot` é relativa a `~/nod`. `estado`: disponivel → desfazendo → desfeito | falhou;
-- vencido quando a retenção da máquina (20 por bot, 7 dias) já apagou a foto. `forcar` = "Voltar mesmo assim": os caminhos
-- em conflito do desfazer anterior, que voltam por cima do que mudou depois. `mensagem_id` é a fala final do turno, onde
-- o "Desfazer" aparece (sem FK, como a âncora das mensagens de sistema: a fala não é apagada). `resultado` guarda os desfechos (até 200) e a contagem. Um desfazer por bot de cada vez
-- (`checkpoints_um_desfazendo_por_agente`). `tentativa` sobe a cada pedido: o relato traz a dele, e o relato velho reenviado
-- não fecha o pedido novo. `desfeito_em` fica quando o desfeito vence (o histórico).
-- Só adição (expand-only): tabela nova, que o código anterior não lê.
SET LOCAL lock_timeout = '5s';
CREATE TABLE checkpoints (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  agente_id uuid NOT NULL,
  conversa_id uuid NOT NULL,
  turno_id uuid NOT NULL,
  maquina_id uuid NOT NULL,
  pasta_do_bot text NOT NULL,
  arquivos jsonb NOT NULL,
  total integer NOT NULL,
  estado text NOT NULL DEFAULT 'disponivel',
  mensagem_id uuid,
  forcar jsonb NOT NULL DEFAULT '[]',
  feitos integer NOT NULL DEFAULT 0,
  tentativa integer NOT NULL DEFAULT 0,
  resultado jsonb,
  falha text,
  pedido_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  desfeito_em timestamptz,
  CONSTRAINT checkpoint_estado CHECK (estado IN ('disponivel', 'desfazendo', 'desfeito', 'falhou', 'vencido')),
  CONSTRAINT checkpoint_pasta CHECK (char_length(pasta_do_bot) BETWEEN 1 AND 300),
  CONSTRAINT checkpoint_arquivos CHECK (jsonb_typeof(arquivos) = 'array' AND jsonb_array_length(arquivos) BETWEEN 1 AND 200),
  CONSTRAINT checkpoint_total CHECK (total >= jsonb_array_length(arquivos) AND total <= 1000000),
  CONSTRAINT checkpoint_forcar CHECK (jsonb_typeof(forcar) = 'array' AND jsonb_array_length(forcar) <= 200),
  CONSTRAINT checkpoint_feitos CHECK (feitos >= 0),
  CONSTRAINT checkpoint_falha CHECK (falha IS NULL OR falha IN ('sem_checkpoint', 'erro')),
  CONSTRAINT checkpoint_tentativa CHECK (tentativa >= 0),
  CONSTRAINT checkpoint_desfeito CHECK (estado <> 'desfeito' OR desfeito_em IS NOT NULL)
);
SELECT nod_escopar_tabela('checkpoints');
ALTER TABLE checkpoints ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE checkpoints ADD FOREIGN KEY (tenant_id, agente_id) REFERENCES agentes (tenant_id, id);
ALTER TABLE checkpoints ADD FOREIGN KEY (tenant_id, conversa_id) REFERENCES conversas (tenant_id, id);
ALTER TABLE checkpoints ADD FOREIGN KEY (tenant_id, turno_id) REFERENCES turnos (tenant_id, id);
CREATE UNIQUE INDEX checkpoints_por_turno ON checkpoints (tenant_id, turno_id);
-- Um desfazer por bot de cada vez: o segundo pedido espera o primeiro acabar.
CREATE UNIQUE INDEX checkpoints_um_desfazendo_por_agente ON checkpoints (tenant_id, agente_id) WHERE estado = 'desfazendo';
-- O que cada máquina deve desfazer (o puxar, a cada 3 s).
CREATE INDEX checkpoints_desfazendo_por_maquina ON checkpoints (tenant_id, maquina_id) WHERE estado = 'desfazendo';
-- A leitura da conversa junta o checkpoint à fala.
CREATE INDEX checkpoints_por_mensagem ON checkpoints (tenant_id, mensagem_id) WHERE mensagem_id IS NOT NULL;
-- A retenção: os do bot por idade.
CREATE INDEX checkpoints_por_agente ON checkpoints (tenant_id, agente_id, criado_em DESC);

-- ROLLBACK:
-- -- O código anterior não lê a tabela: voltar a imagem basta. Os pedidos de desfazer em curso somem com o DROP; as fotos
-- -- da máquina ficam em ~/nod/.checkpoints e a retenção do motor novo as apaga (o antigo não as lê).
-- DROP INDEX checkpoints_por_agente;
-- DROP INDEX checkpoints_por_mensagem;
-- DROP INDEX checkpoints_desfazendo_por_maquina;
-- DROP INDEX checkpoints_um_desfazendo_por_agente;
-- DROP INDEX checkpoints_por_turno;
-- DROP TABLE checkpoints;
