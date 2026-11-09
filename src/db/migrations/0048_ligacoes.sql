-- definido em 2026-10-04 (ADR-075, dados da ligação): a ligação por voz com um bot. Registro tipado em `ligacoes`
-- (estado, horários, provedores, custo, latência) e a prosa em `ligacao_falas` (o que cada lado falou), que a dona
-- apaga sem perder o registro nem o resumo. Nenhum áudio é gravado em lugar nenhum. Só adição (expand-only): o
-- código anterior continua rodando sobre este schema durante a drenagem do deploy.
CREATE TABLE ligacoes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  agente_id uuid NOT NULL,
  conversa_id uuid NOT NULL,
  estado text NOT NULL DEFAULT 'chamando',
  iniciada_por text NOT NULL DEFAULT 'pessoa',
  harness text,
  modelo text,
  provedor_stt text NOT NULL,
  provedor_tts text NOT NULL,
  voz text NOT NULL,
  mensagem_id uuid,
  iniciada_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  atendida_em timestamptz,
  encerrada_em timestamptz,
  motivo_fim text,
  duracao_ms integer,
  religacoes smallint NOT NULL DEFAULT 0,
  trocas integer NOT NULL DEFAULT 0,
  interrupcoes integer NOT NULL DEFAULT 0,
  stt_segundos integer NOT NULL DEFAULT 0,
  tts_caracteres integer NOT NULL DEFAULT 0,
  custo_estimado_usd numeric(10, 4),
  latencia_p50_ms integer,
  latencia_p95_ms integer,
  avaliacao text,
  avaliacao_motivo text,
  transcricao_apagada_em timestamptz,
  resumida boolean NOT NULL DEFAULT false,
  CONSTRAINT ligacao_estado CHECK (estado IN ('chamando', 'em_curso', 'encerrada', 'nao_atendida')),
  CONSTRAINT ligacao_iniciada_por CHECK (iniciada_por IN ('pessoa', 'produto')),
  CONSTRAINT ligacao_provedores CHECK (provedor_stt ~ '^[a-z0-9_-]{1,32}$' AND provedor_tts ~ '^[a-z0-9_-]{1,32}$'),
  CONSTRAINT ligacao_voz CHECK (voz ~ '^[a-z0-9_-]{1,40}$'),
  CONSTRAINT ligacao_motivo_fim CHECK (motivo_fim IS NULL OR motivo_fim IN (
    'pessoa_desligou', 'bot_desligou', 'tempo_maximo', 'limite_diario', 'cerebro_caiu', 'midia_caiu',
    'reinicio_servidor', 'drenagem', 'nao_atendida', 'recusada', 'voz_indisponivel', 'ociosidade', 'limite_da_assinatura', 'erro'
  )),
  CONSTRAINT ligacao_encerrada CHECK ((estado IN ('encerrada', 'nao_atendida')) = (encerrada_em IS NOT NULL AND motivo_fim IS NOT NULL)),
  CONSTRAINT ligacao_avaliacao CHECK (avaliacao IS NULL OR avaliacao IN ('boa', 'ruim')),
  CONSTRAINT ligacao_avaliacao_motivo CHECK (avaliacao_motivo IS NULL OR avaliacao_motivo IN ('demorou', 'nao_entendeu', 'interrompeu', 'voz', 'outro'))
);
SELECT nod_escopar_tabela('ligacoes');
-- Ligação é sempre só da pessoa (bots da equipe ficam fora na v1): nem a equipe a lê.
ALTER TABLE ligacoes ADD CONSTRAINT ligacao_privada CHECK (visibility = 'privado');
ALTER TABLE ligacoes ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE ligacoes ADD FOREIGN KEY (tenant_id, agente_id) REFERENCES agentes (tenant_id, id);
ALTER TABLE ligacoes ADD FOREIGN KEY (tenant_id, conversa_id) REFERENCES conversas (tenant_id, id);
-- Uma ligação viva por pessoa (o app só tem um microfone).
CREATE UNIQUE INDEX ligacoes_uma_viva_por_pessoa ON ligacoes (tenant_id, owner_id) WHERE estado IN ('chamando', 'em_curso');
-- O limite diário soma as ligações da pessoa a partir do início do dia.
CREATE INDEX ligacoes_por_dona_e_inicio ON ligacoes (tenant_id, owner_id, iniciada_em);

-- O que cada lado falou, na ordem. Do bot, o texto realmente falado (cortado na interrupção).
CREATE TABLE ligacao_falas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  ligacao_id uuid NOT NULL,
  seq integer NOT NULL,
  autor_tipo text NOT NULL,
  tipo text NOT NULL DEFAULT 'fala',
  texto text NOT NULL,
  inicio_ms integer NOT NULL DEFAULT 0,
  fim_ms integer NOT NULL DEFAULT 0,
  interrompida boolean NOT NULL DEFAULT false,
  confianca real,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ligacao_fala_autor CHECK (autor_tipo IN ('pessoa', 'bot')),
  CONSTRAINT ligacao_fala_tipo CHECK (tipo IN ('fala', 'texto', 'leitura')),
  CONSTRAINT ligacao_fala_texto CHECK (char_length(texto) BETWEEN 1 AND 4000),
  CONSTRAINT ligacao_fala_seq CHECK (seq >= 0)
);
SELECT nod_escopar_tabela('ligacao_falas');
ALTER TABLE ligacao_falas ADD CONSTRAINT ligacao_fala_privada CHECK (visibility = 'privado');
ALTER TABLE ligacao_falas ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE ligacao_falas ADD FOREIGN KEY (tenant_id, ligacao_id) REFERENCES ligacoes (tenant_id, id) ON DELETE CASCADE;
ALTER TABLE ligacao_falas ADD CONSTRAINT ligacao_falas_seq_unica UNIQUE (tenant_id, ligacao_id, seq);
GRANT SELECT, DELETE ON ligacao_falas TO nod_poda;

-- O turno-cérebro aponta para a ligação; os turnos de trabalho pedidos durante ela (iniciar_tarefa) também. Mão
-- única: todo turno 'ligacao' tem ligação, mas um turno com ligação pode ter outra origem.
ALTER TABLE turnos ADD COLUMN ligacao_id uuid;
ALTER TABLE turnos ADD FOREIGN KEY (tenant_id, ligacao_id) REFERENCES ligacoes (tenant_id, id);
ALTER TABLE turnos ADD CONSTRAINT turno_ligacao_tem_ligacao CHECK (origem <> 'ligacao' OR ligacao_id IS NOT NULL);
CREATE INDEX turnos_por_ligacao ON turnos (tenant_id, ligacao_id) WHERE ligacao_id IS NOT NULL;

-- A voz de cada bot (id neutro do catálogo VOZES_NOD; nulo = derivada do id do bot) e a velocidade da fala.
ALTER TABLE agentes ADD COLUMN IF NOT EXISTS voz text;
ALTER TABLE agentes ADD CONSTRAINT agente_voz CHECK (voz IS NULL OR voz ~ '^[a-z0-9_-]{1,40}$');
ALTER TABLE agentes ADD COLUMN IF NOT EXISTS voz_velocidade real NOT NULL DEFAULT 1;
ALTER TABLE agentes ADD CONSTRAINT agente_voz_velocidade CHECK (voz_velocidade IN (1, 1.25, 1.5));

-- Consentimento de voz (ADR-075): a versão do aviso que a pessoa aceitou e quando. Sobe quando muda o provedor.
ALTER TABLE preferencias ADD COLUMN IF NOT EXISTS voz_consentimento_versao smallint;
ALTER TABLE preferencias ADD COLUMN IF NOT EXISTS voz_consentimento_em timestamptz;

-- ROLLBACK:
-- ALTER TABLE preferencias DROP COLUMN voz_consentimento_em, DROP COLUMN voz_consentimento_versao;
-- ALTER TABLE agentes DROP CONSTRAINT agente_voz_velocidade, DROP COLUMN voz_velocidade, DROP CONSTRAINT agente_voz, DROP COLUMN voz;
-- ALTER TABLE turnos DROP CONSTRAINT turno_ligacao_tem_ligacao, DROP COLUMN ligacao_id;
-- DROP TABLE ligacao_falas;
-- DROP TABLE ligacoes;
