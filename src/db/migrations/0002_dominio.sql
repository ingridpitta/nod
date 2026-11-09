-- 0002 domínio. Todas as tabelas de negócio passam por nod_escopar_tabela (0001): tenant_id + owner_id
-- + visibility, ENABLE + FORCE, policies nod_pessoa (PERMISSIVE) e nod_tenant (RESTRICTIVE), GRANT a
-- nod_app. PK (tenant_id, id) e FK COMPOSTAS em toda referência (ADR-003 três colunas / A-RLS-5).
-- criado_em/em usam clock_timestamp(): now() é o início da TRANSAÇÃO e empataria linhas criadas na
-- mesma tx (medido em 2026-09-16: a reivindicação ordenava por id aleatório dentro do withRollback).
-- custo_usd é numeric sem escala: o CLI reporta 7 casas (0.0207631, s3) e numeric(12,6) arredondava.
-- Enums de motivo vêm de src/contracts/motivos.ts (ADR-004): tests/conformidade/motivos-enum.test.ts
-- compara cada CREATE TYPE daqui com a lista `as const` de lá. Convenção `-- ROLLBACK:` no fim.

-- ---------------------------------------------------------------------------------------------
-- Enums de motivo (ADR-004, um enum só compartilhado por proxy, sala, turno e trilha).
CREATE TYPE motivo_passe AS ENUM ('passei_sem_nada_a_dizer', 'negado_fail_closed', 'ausente_offline', 'cota_esgotada');
CREATE TYPE motivo_negacao AS ENUM (
  'capacidade_desligada', 'teto_canal', 'alcance_insuficiente', 'fora_do_catalogo', 'plano_ausente',
  'plano_expirado', 'catalogo_vazio', 'conector_indisponivel', 'parada_ativa', 'args_invalidos',
  'falha_tecnica', 'timeout_transporte'
);
CREATE TYPE motivo_interrupcao AS ENUM (
  'parado_pela_pessoa', 'maquina_sem_contato', 'reinicio_servidor', 'sem_progresso',
  'lancamento_falhou', 'sessao_rejeitada', 'executor_indisponivel'
);
CREATE TYPE motivo_falha AS ENUM ('erro_max_turns', 'erro_execucao', 'motor_ausente', 'nao_autenticado');
CREATE TYPE motivo_localidade AS ENUM ('tudo_local_nesta_rodada', 'motor_ausente');
CREATE TYPE desfecho_item AS ENUM ('executado', 'retirado_pela_pessoa', 'sensivel_nao_aprovado', 'falhou_na_execucao');
CREATE TYPE desfecho_rotina AS ENUM ('executou', 'passou_em_branco', 'falhou');
CREATE TYPE codigo_erro AS ENUM (
  'nao_encontrado', 'entrada_invalida', 'escopo_vazio', 'limite_atingido', 'nao_permitido',
  'estado_invalido', 'executor_indisponivel', 'fuso_invalido', 'cron_sem_futuro', 'sala_tamanho',
  'http_toca_aprendiz', 'env_placeholder_chave_nova', 'dono_imutavel', 'texto_vazio'
);

-- Enums de estado (contratos em src/contracts/*.ts; declarados também em src/db/schema/*.ts).
CREATE TYPE estado_turno AS ENUM ('pendente', 'despachando', 'concluido', 'interrompido');
CREATE TYPE origem_turno AS ENUM ('conversa', 'sala', 'rotina', 'retomada', 'peer');
CREATE TYPE confianca AS ENUM ('confiavel', 'nao_confiavel');
CREATE TYPE dono_agente AS ENUM ('pessoa', 'empresa');
CREATE TYPE politica_resposta AS ENUM ('so_mencoes', 'lead', 'todos');
-- EMENDA 16: pergunta ≠ permissão; os três valores novos entram aqui (a rota responder é da L9).
CREATE TYPE tipo_decisao AS ENUM ('aprovacao', 'acesso', 'retomar_turno', 'gate_rotina', 'perfil', 'rotina', 'pergunta', 'falta_de_dado', 'permissao');
CREATE TYPE estado_decisao AS ENUM ('pendente', 'decidida', 'vencida', 'reaberta');
CREATE TYPE kind_mensagem AS ENUM (
  'texto', 'sistema', 'handoff', 'passe', 'consentimento', 'rotina_execucao',
  'resultado_aprovacao', 'negacao', 'parada', 'peer_ask'
);
CREATE TYPE memoria_tipo AS ENUM ('preferencia', 'fato', 'resumo');
CREATE TYPE transporte_conector AS ENUM ('stdio', 'http');
CREATE TYPE declaracao_sensibilidade AS ENUM ('toca', 'nao-toca', 'nao-declarou');
CREATE TYPE tipo_conversa AS ENUM ('propria', 'sala');
CREATE TYPE kind_proposta AS ENUM ('perfil', 'rotina', 'acesso');
CREATE TYPE estado_proposta AS ENUM ('pendente', 'confirmada', 'recusada');
CREATE TYPE estado_rotina AS ENUM ('ativa', 'pausada');
CREATE TYPE estado_inventario AS ENUM ('ausente', 'nao_autenticado', 'pronto');

-- ---------------------------------------------------------------------------------------------
-- Busca (ADR-008 revisado): só a configuração como OBJETO DE BANCO e a coluna STORED. Sem GIN,
-- sem btree_gin, sem rebuild — esperam conteúdo.
CREATE TEXT SEARCH CONFIGURATION nod_pt (COPY = portuguese);
ALTER TEXT SEARCH CONFIGURATION nod_pt
  ALTER MAPPING FOR asciiword, asciihword, hword_asciipart, word, hword, hword_part
  WITH unaccent, portuguese_stem;

-- ---------------------------------------------------------------------------------------------
-- Agentes (bots). dono é imutável por trigger (E1.2; erro dono_imutavel na borda).
-- Sem cwd (EMENDA 11): o driver cria mkdtemp por turno.
CREATE TABLE agentes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  titulo text NOT NULL DEFAULT '',
  descricao text NOT NULL DEFAULT '',
  dono dono_agente NOT NULL,
  forma text NOT NULL,
  cor text NOT NULL,
  fixado boolean NOT NULL DEFAULT false,
  oculto boolean NOT NULL DEFAULT false,
  confirmado boolean NOT NULL DEFAULT false,
  modelo text NOT NULL,
  duplicado_de uuid,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  search_tsv tsvector GENERATED ALWAYS AS (to_tsvector('nod_pt'::regconfig, nome || ' ' || descricao)) STORED
);
SELECT nod_escopar_tabela('agentes');
ALTER TABLE agentes ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE agentes ADD FOREIGN KEY (tenant_id, duplicado_de) REFERENCES agentes (tenant_id, id);

CREATE FUNCTION nod_agente_dono_imutavel()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.dono IS DISTINCT FROM OLD.dono THEN
    RAISE EXCEPTION 'o dono do agente é imutável (E1.2)' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER nod_agente_dono_imutavel
  BEFORE UPDATE OF dono ON agentes
  FOR EACH ROW EXECUTE FUNCTION nod_agente_dono_imutavel();

-- Memória por bot (preferência/fato/resumo), editável pela pessoa; origem lê autor_tipo (ADR-023).
CREATE TABLE agente_memorias (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  agente_id uuid NOT NULL,
  tipo memoria_tipo NOT NULL,
  texto text NOT NULL,
  origem autor_tipo NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('agente_memorias');
ALTER TABLE agente_memorias ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE agente_memorias ADD FOREIGN KEY (tenant_id, agente_id) REFERENCES agentes (tenant_id, id);
CREATE INDEX agente_memorias_por_agente ON agente_memorias (tenant_id, agente_id, criado_em);

-- ---------------------------------------------------------------------------------------------
-- Salas antes de conversas por causa da perna extra (ADR-027): ser membro (ou ter bot membro)
-- é grant explícito de leitura. sala_membros tem perna própria (pessoa_leitora_id) para que a
-- subconsulta das outras policies enxergue o grant da pessoa que lê.
CREATE TABLE sala_membros (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  sala_id uuid NOT NULL,
  agente_id uuid NOT NULL,
  pessoa_leitora_id uuid NOT NULL,
  log_inteiro boolean NOT NULL DEFAULT true,
  removido_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('sala_membros', $p$sala_membros.pessoa_leitora_id = current_setting('nod.pessoa_id')::uuid$p$);
ALTER TABLE sala_membros ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE sala_membros ADD CONSTRAINT sala_membros_unico UNIQUE (tenant_id, sala_id, agente_id);
ALTER TABLE sala_membros ADD FOREIGN KEY (tenant_id, agente_id) REFERENCES agentes (tenant_id, id);

CREATE TABLE salas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  conversa_id uuid NOT NULL,
  politica politica_resposta NOT NULL DEFAULT 'lead',
  lead_agente_id uuid,
  -- ORCAMENTO_INICIAL de src/domain/canal-orcamento.ts, persistido na SALA (GRUPO.orcamento-sala).
  orcamento jsonb NOT NULL DEFAULT '{"ultimosPostsAgenteIds":[],"postsSemHumano":0,"ultimoPostEm":null,"ultimaFalaHumanaEm":null,"handoffsNaRodada":0}'::jsonb,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('salas', $p$EXISTS (
  SELECT 1 FROM sala_membros m
  WHERE m.tenant_id = salas.tenant_id AND m.sala_id = salas.id
    AND m.pessoa_leitora_id = current_setting('nod.pessoa_id')::uuid AND m.removido_em IS NULL)$p$);
ALTER TABLE salas ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE salas ADD FOREIGN KEY (tenant_id, lead_agente_id) REFERENCES agentes (tenant_id, id);
ALTER TABLE sala_membros ADD FOREIGN KEY (tenant_id, sala_id) REFERENCES salas (tenant_id, id);

-- Conversas: própria do bot ou da sala. A da sala é lida por quem tem grant (perna via sala_id).
CREATE TABLE conversas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tipo tipo_conversa NOT NULL,
  agente_id uuid,
  sala_id uuid,
  sessao_cli text,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT conversa_propria_tem_agente CHECK (tipo <> 'propria' OR agente_id IS NOT NULL),
  CONSTRAINT conversa_de_sala_tem_sala CHECK (tipo <> 'sala' OR sala_id IS NOT NULL)
);
SELECT nod_escopar_tabela('conversas', $p$conversas.sala_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM sala_membros m
  WHERE m.tenant_id = conversas.tenant_id AND m.sala_id = conversas.sala_id
    AND m.pessoa_leitora_id = current_setting('nod.pessoa_id')::uuid AND m.removido_em IS NULL)$p$);
ALTER TABLE conversas ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE conversas ADD FOREIGN KEY (tenant_id, agente_id) REFERENCES agentes (tenant_id, id);
-- Sala e sua conversa nascem na MESMA tx (criarSala): os dois lados do ciclo são DEFERRABLE.
ALTER TABLE conversas ADD CONSTRAINT conversas_sala_fkey FOREIGN KEY (tenant_id, sala_id) REFERENCES salas (tenant_id, id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE salas ADD CONSTRAINT salas_conversa_fkey FOREIGN KEY (tenant_id, conversa_id) REFERENCES conversas (tenant_id, id) DEFERRABLE INITIALLY DEFERRED;

-- ---------------------------------------------------------------------------------------------
-- Turnos: fila por conversa no Postgres (ADR-010 revisado): 4 estados, lease, motivo tipado,
-- quatro sinais write-ahead (ADR-009), retomar = turno NOVO (nunca requeue).
CREATE TABLE turnos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  conversa_id uuid NOT NULL,
  agente_id uuid NOT NULL,
  origem origem_turno NOT NULL,
  estado estado_turno NOT NULL DEFAULT 'pendente',
  attempted boolean NOT NULL DEFAULT false,
  rejected boolean NOT NULL DEFAULT false,
  prompt_submitted boolean NOT NULL DEFAULT false,
  produced_output boolean NOT NULL DEFAULT false,
  machine_id uuid,
  lease_ate timestamptz,
  prazo_em timestamptz NOT NULL,
  motivo_interrupcao motivo_interrupcao,
  motivo_falha motivo_falha,
  retoma_turno_id uuid,
  profundidade smallint NOT NULL DEFAULT 0,
  reenvios int NOT NULL DEFAULT 0,
  parar_solicitado_em timestamptz,
  entrada_texto text NOT NULL,
  entrada_confianca confianca NOT NULL,
  locality text NOT NULL DEFAULT 'local',
  locality_reason motivo_localidade NOT NULL DEFAULT 'tudo_local_nesta_rodada',
  executor text NOT NULL DEFAULT 'catcher',
  decidido_por text NOT NULL DEFAULT 'regra:localidade',
  custo_usd numeric,
  tokens_entrada int NOT NULL DEFAULT 0,
  tokens_saida int NOT NULL DEFAULT 0,
  modelo text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT turnos_interrompido_tem_motivo CHECK (estado <> 'interrompido' OR motivo_interrupcao IS NOT NULL),
  CONSTRAINT turnos_profundidade CHECK (profundidade IN (0, 1))
);
SELECT nod_escopar_tabela('turnos');
ALTER TABLE turnos ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE turnos ADD FOREIGN KEY (tenant_id, conversa_id) REFERENCES conversas (tenant_id, id);
ALTER TABLE turnos ADD FOREIGN KEY (tenant_id, agente_id) REFERENCES agentes (tenant_id, id);
ALTER TABLE turnos ADD FOREIGN KEY (tenant_id, retoma_turno_id) REFERENCES turnos (tenant_id, id);
-- Índice parcial: a reivindicação e o varredor só olham o que está vivo.
CREATE INDEX turnos_vivos ON turnos (tenant_id, owner_id, criado_em) WHERE estado IN ('pendente', 'despachando');

-- Entrega idempotente (ADR-021): UNIQUE (tenant_id, turno_id, seq_local).
CREATE TABLE turno_entregas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  turno_id uuid NOT NULL,
  seq_local int NOT NULL,
  em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('turno_entregas');
ALTER TABLE turno_entregas ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE turno_entregas ADD CONSTRAINT turno_entregas_unica UNIQUE (tenant_id, turno_id, seq_local);
ALTER TABLE turno_entregas ADD FOREIGN KEY (tenant_id, turno_id) REFERENCES turnos (tenant_id, id);

-- ---------------------------------------------------------------------------------------------
-- Mensagens com autoria composta (ADR-023/025) e confiança NOT NULL (ADR-026).
-- Perna extra: mensagem de sala é lida por quem tem grant na sala da conversa (ADR-027).
CREATE TABLE mensagens (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  conversa_id uuid NOT NULL,
  turno_id uuid,
  autor_tipo autor_tipo NOT NULL,
  autor_id uuid NOT NULL,
  sob_procuracao_de uuid,
  conta_de_execucao uuid NOT NULL,
  executor text NOT NULL,
  locality text NOT NULL,
  locality_reason motivo_localidade NOT NULL,
  machine_id uuid,
  decidido_por text NOT NULL,
  regra_versao int NOT NULL,
  kind kind_mensagem NOT NULL,
  texto text NOT NULL,
  payload jsonb,
  confianca confianca NOT NULL,
  parcial boolean NOT NULL DEFAULT false,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('mensagens', $p$EXISTS (
  SELECT 1 FROM conversas c JOIN sala_membros m ON m.tenant_id = c.tenant_id AND m.sala_id = c.sala_id
  WHERE c.tenant_id = mensagens.tenant_id AND c.id = mensagens.conversa_id
    AND m.pessoa_leitora_id = current_setting('nod.pessoa_id')::uuid AND m.removido_em IS NULL)$p$);
ALTER TABLE mensagens ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE mensagens ADD FOREIGN KEY (tenant_id, conversa_id) REFERENCES conversas (tenant_id, id);
ALTER TABLE mensagens ADD FOREIGN KEY (tenant_id, turno_id) REFERENCES turnos (tenant_id, id);
CREATE INDEX mensagens_por_conversa ON mensagens (tenant_id, conversa_id, criado_em);

-- Propostas do modelo (ferramenta tipada): nada aplicado antes da confirmação (E1.1).
CREATE TABLE propostas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  conversa_id uuid NOT NULL,
  agente_id uuid NOT NULL,
  kind kind_proposta NOT NULL,
  estado estado_proposta NOT NULL DEFAULT 'pendente',
  payload jsonb NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('propostas');
ALTER TABLE propostas ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE propostas ADD FOREIGN KEY (tenant_id, conversa_id) REFERENCES conversas (tenant_id, id);
ALTER TABLE propostas ADD FOREIGN KEY (tenant_id, agente_id) REFERENCES agentes (tenant_id, id);

-- ---------------------------------------------------------------------------------------------
-- Decisões ("Sua vez", ADR-007): duas pernas de RLS (EMENDA 1) — o dono vê pela owner_id, o
-- decisor designado vê pela perna extra decisor_id. A perna só ABRE LEITURA: o WITH CHECK da
-- nod_escopar_tabela continua exigindo owner_id = pessoa da sessão (medido em 2026-09-16 em
-- tests/integration/isolamento-pessoa.test.ts); decidir como decisor ≠ dono é pendência da L9.
CREATE TABLE decisoes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tipo tipo_decisao NOT NULL,
  estado estado_decisao NOT NULL DEFAULT 'pendente',
  decisor_id uuid NOT NULL,
  agente_id uuid NOT NULL,
  conversa_id uuid NOT NULL,
  turno_id uuid,
  prazo_decisao_em timestamptz NOT NULL,
  prazo_execucao_em timestamptz,
  frase text NOT NULL,
  desfecho jsonb,
  vista_em timestamptz,
  decidida_em timestamptz,
  decidida_por uuid,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('decisoes', $p$decisoes.decisor_id = current_setting('nod.pessoa_id')::uuid$p$);
ALTER TABLE decisoes ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE decisoes ADD FOREIGN KEY (tenant_id, agente_id) REFERENCES agentes (tenant_id, id);
ALTER TABLE decisoes ADD FOREIGN KEY (tenant_id, conversa_id) REFERENCES conversas (tenant_id, id);
ALTER TABLE decisoes ADD FOREIGN KEY (tenant_id, turno_id) REFERENCES turnos (tenant_id, id);
CREATE INDEX decisoes_sua_vez ON decisoes (tenant_id, decisor_id, estado, prazo_decisao_em);

-- Idempotência do varredor de expiração (ADR-011): UNIQUE (tenant_id, decisao_id, tipo_de_evento).
CREATE TABLE decisao_eventos_varridos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  decisao_id uuid NOT NULL,
  tipo_de_evento text NOT NULL,
  em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT decisao_eventos_varridos_tipo CHECK (tipo_de_evento ~ '^[a-z_]+$')
);
SELECT nod_escopar_tabela('decisao_eventos_varridos');
ALTER TABLE decisao_eventos_varridos ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE decisao_eventos_varridos ADD CONSTRAINT decisao_eventos_varridos_unico UNIQUE (tenant_id, decisao_id, tipo_de_evento);
ALTER TABLE decisao_eventos_varridos ADD FOREIGN KEY (tenant_id, decisao_id) REFERENCES decisoes (tenant_id, id);

-- Aprovação em lista tipada (E4.1/E4.2): item sensível marcado exige pessoa (CHECK).
CREATE TABLE itens_aprovacao (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  decisao_id uuid NOT NULL,
  idx int NOT NULL,
  texto_original text NOT NULL,
  texto_final text NOT NULL,
  destino jsonb NOT NULL,
  selecionado boolean NOT NULL DEFAULT false,
  origem_sensivel boolean NOT NULL DEFAULT false,
  justificativa text,
  marcado_por uuid,
  marcado_em timestamptz,
  editado_por uuid,
  desfecho desfecho_item,
  CONSTRAINT item_sensivel_marcado_exige_pessoa CHECK (NOT (origem_sensivel AND selecionado) OR (marcado_por IS NOT NULL AND marcado_em IS NOT NULL))
);
SELECT nod_escopar_tabela('itens_aprovacao', $p$EXISTS (
  SELECT 1 FROM decisoes d
  WHERE d.tenant_id = itens_aprovacao.tenant_id AND d.id = itens_aprovacao.decisao_id
    AND d.decisor_id = current_setting('nod.pessoa_id')::uuid)$p$);
ALTER TABLE itens_aprovacao ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE itens_aprovacao ADD CONSTRAINT itens_aprovacao_idx_unico UNIQUE (tenant_id, decisao_id, idx);
ALTER TABLE itens_aprovacao ADD FOREIGN KEY (tenant_id, decisao_id) REFERENCES decisoes (tenant_id, id);

-- ---------------------------------------------------------------------------------------------
-- Rotinas (ADR-011): fuso IANA por CHECK (offset recusado), exige_aprovacao DEFAULT true (E7.3),
-- proxima_execucao calculada pelo servidor (único lugar que avalia cron).
CREATE TABLE rotinas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  agente_id uuid NOT NULL,
  conversa_id uuid NOT NULL,
  cron text NOT NULL,
  fuso_iana text NOT NULL,
  instrucao text NOT NULL,
  fonte text NOT NULL,
  entregavel text NOT NULL,
  limites_aprovacao text NOT NULL,
  politica_sem_dado text NOT NULL,
  exige_aprovacao boolean NOT NULL DEFAULT true,
  estado estado_rotina NOT NULL DEFAULT 'ativa',
  proxima_execucao timestamptz NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT rotinas_fuso_iana CHECK (fuso_iana ~ '^[A-Za-z_]+/[A-Za-z_/+-]+$')
);
SELECT nod_escopar_tabela('rotinas');
ALTER TABLE rotinas ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE rotinas ADD FOREIGN KEY (tenant_id, agente_id) REFERENCES agentes (tenant_id, id);
ALTER TABLE rotinas ADD FOREIGN KEY (tenant_id, conversa_id) REFERENCES conversas (tenant_id, id);
CREATE INDEX rotinas_ativas ON rotinas (tenant_id, owner_id, proxima_execucao) WHERE estado = 'ativa';

-- Reivindicação de janela (ADR-011): UNIQUE (tenant_id, rotina_id, instante_agendado) e QUAL
-- executor ganhou. turno_id entra depois da reivindicação (o turno nasce na mesma tx, em seguida).
CREATE TABLE rotina_janelas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  rotina_id uuid NOT NULL,
  instante_agendado timestamptz NOT NULL,
  executor text NOT NULL,
  machine_id uuid NOT NULL,
  turno_id uuid,
  em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('rotina_janelas');
ALTER TABLE rotina_janelas ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE rotina_janelas ADD CONSTRAINT rotina_janelas_unica UNIQUE (tenant_id, rotina_id, instante_agendado);
ALTER TABLE rotina_janelas ADD FOREIGN KEY (tenant_id, rotina_id) REFERENCES rotinas (tenant_id, id);
ALTER TABLE rotina_janelas ADD FOREIGN KEY (tenant_id, turno_id) REFERENCES turnos (tenant_id, id);

-- Execuções guardadas (20 por rotina, poda no repositório). passou_em_branco ≠ falhou (E7.3).
CREATE TABLE rotina_execucoes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  rotina_id uuid NOT NULL,
  instante_agendado timestamptz NOT NULL,
  turno_id uuid,
  desfecho desfecho_rotina NOT NULL,
  motivo text,
  em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT rotina_execucoes_motivo_sem_texto_livre CHECK (motivo IS NULL OR motivo ~ '^[a-z_]+$')
);
SELECT nod_escopar_tabela('rotina_execucoes');
ALTER TABLE rotina_execucoes ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE rotina_execucoes ADD FOREIGN KEY (tenant_id, rotina_id) REFERENCES rotinas (tenant_id, id);
ALTER TABLE rotina_execucoes ADD FOREIGN KEY (tenant_id, turno_id) REFERENCES turnos (tenant_id, id);
CREATE INDEX rotina_execucoes_por_rotina ON rotina_execucoes (tenant_id, rotina_id, em DESC);

-- ---------------------------------------------------------------------------------------------
-- Conectores = servidores MCP registrados pela pessoa (ADR-013 revisado). Nascem desabilitados;
-- env fica CIFRADO no servidor (env_cifrado) e só as CHAVES ficam legíveis (placeholder `true`).
-- http só para quem NÃO toca dado pessoal — e 'nao-declarou' é toca (ADR-002, default fechado).
CREATE TABLE conectores (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  slug text NOT NULL,
  transporte transporte_conector NOT NULL,
  comando text,
  args text[] NOT NULL DEFAULT '{}',
  url text,
  env_cifrado text,
  env_chaves text[] NOT NULL DEFAULT '{}',
  declaracao declaracao_sensibilidade NOT NULL,
  habilitado boolean NOT NULL DEFAULT false,
  catalogo jsonb NOT NULL DEFAULT '[]'::jsonb,
  sondado_em timestamptz,
  ultima_falha jsonb,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT conector_http_nao_toca CHECK (NOT (transporte = 'http' AND declaracao <> 'nao-toca')),
  CONSTRAINT conector_slug CHECK (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  CONSTRAINT conector_transporte_completo CHECK ((transporte = 'stdio' AND comando IS NOT NULL) OR (transporte = 'http' AND url IS NOT NULL))
);
SELECT nod_escopar_tabela('conectores');
ALTER TABLE conectores ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE conectores ADD CONSTRAINT conectores_slug_unico UNIQUE (tenant_id, owner_id, slug);

-- Concessão por agente e por capacidade, com mensagem de consentimento imutável citável (E6).
CREATE TABLE concessoes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  agente_id uuid NOT NULL,
  conector_id uuid NOT NULL,
  capacidade text NOT NULL,
  mensagem_id uuid NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('concessoes');
ALTER TABLE concessoes ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE concessoes ADD CONSTRAINT concessoes_unica UNIQUE (tenant_id, agente_id, conector_id, capacidade);
ALTER TABLE concessoes ADD FOREIGN KEY (tenant_id, agente_id) REFERENCES agentes (tenant_id, id);
ALTER TABLE concessoes ADD FOREIGN KEY (tenant_id, conector_id) REFERENCES conectores (tenant_id, id);
ALTER TABLE concessoes ADD FOREIGN KEY (tenant_id, mensagem_id) REFERENCES mensagens (tenant_id, id);

-- Procuração entre agentes de donos diferentes (ADR-025): nasce na 0002, sem rota nesta rodada.
CREATE TABLE procuracoes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  agente_concedente_id uuid NOT NULL,
  agente_beneficiario_id uuid NOT NULL,
  classes_permitidas text[] NOT NULL DEFAULT '{}',
  teto_diario int NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('procuracoes');
ALTER TABLE procuracoes ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE procuracoes ADD FOREIGN KEY (tenant_id, agente_concedente_id) REFERENCES agentes (tenant_id, id);
ALTER TABLE procuracoes ADD FOREIGN KEY (tenant_id, agente_beneficiario_id) REFERENCES agentes (tenant_id, id);

-- ---------------------------------------------------------------------------------------------
-- Inventário de motores por pessoa (ADR-019): estado, motivo, versão do CLI, instante. SEM email.
CREATE TABLE inventario_motores (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  pessoa_id uuid NOT NULL,
  motor text NOT NULL,
  estado estado_inventario NOT NULL,
  motivo text,
  versao_cli text,
  visto_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('inventario_motores');
ALTER TABLE inventario_motores ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE inventario_motores ADD CONSTRAINT inventario_motores_unico UNIQUE (tenant_id, pessoa_id, motor);

-- Gasto por turno (ADR-015): gravado desde já, mesmo no turno local sem cobrança.
CREATE TABLE gastos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  turno_id uuid NOT NULL,
  executor text NOT NULL,
  tokens_entrada int NOT NULL DEFAULT 0,
  tokens_saida int NOT NULL DEFAULT 0,
  custo_usd numeric,
  modelo text NOT NULL,
  em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('gastos');
ALTER TABLE gastos ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE gastos ADD FOREIGN KEY (tenant_id, turno_id) REFERENCES turnos (tenant_id, id);

-- Parar (E5.4): estado persistido; a faixa é gravada ao encerrar.
CREATE TABLE paradas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  pessoa_id uuid NOT NULL,
  conversa_id uuid,
  ativa_desde timestamptz NOT NULL DEFAULT clock_timestamp(),
  encerrada_em timestamptz,
  faixa jsonb
);
SELECT nod_escopar_tabela('paradas');
ALTER TABLE paradas ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE paradas ADD FOREIGN KEY (tenant_id, conversa_id) REFERENCES conversas (tenant_id, id);
CREATE INDEX paradas_ativas ON paradas (tenant_id, pessoa_id) WHERE encerrada_em IS NULL;

-- Catcher (Práticas §11): o que o proxy decidiu e o que o executor teria chamado, inspecionável em
-- dev por toda a equipe (visibility DEFAULT 'equipe').
CREATE TABLE catcher_registros (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  turno_id uuid NOT NULL,
  tipo text NOT NULL,
  dados jsonb NOT NULL DEFAULT '{}'::jsonb,
  em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT catcher_registros_tipo CHECK (tipo ~ '^[a-z_]+$')
);
SELECT nod_escopar_tabela('catcher_registros');
ALTER TABLE catcher_registros ALTER COLUMN visibility SET DEFAULT 'equipe';
ALTER TABLE catcher_registros ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE catcher_registros ADD FOREIGN KEY (tenant_id, turno_id) REFERENCES turnos (tenant_id, id);
CREATE INDEX catcher_registros_por_turno ON catcher_registros (tenant_id, turno_id, em);

-- ROLLBACK:
DROP TABLE IF EXISTS catcher_registros;
DROP TABLE IF EXISTS paradas;
DROP TABLE IF EXISTS gastos;
DROP TABLE IF EXISTS inventario_motores;
DROP TABLE IF EXISTS procuracoes;
DROP TABLE IF EXISTS concessoes;
DROP TABLE IF EXISTS conectores;
DROP TABLE IF EXISTS rotina_execucoes;
DROP TABLE IF EXISTS rotina_janelas;
DROP TABLE IF EXISTS rotinas;
DROP TABLE IF EXISTS itens_aprovacao;
DROP TABLE IF EXISTS decisao_eventos_varridos;
DROP TABLE IF EXISTS decisoes;
DROP TABLE IF EXISTS propostas;
DROP TABLE IF EXISTS mensagens;
DROP TABLE IF EXISTS turno_entregas;
DROP TABLE IF EXISTS turnos;
ALTER TABLE salas DROP CONSTRAINT IF EXISTS salas_conversa_fkey;
DROP TABLE IF EXISTS conversas;
DROP TABLE IF EXISTS salas CASCADE;
DROP TABLE IF EXISTS sala_membros;
DROP TABLE IF EXISTS agente_memorias;
DROP TRIGGER IF EXISTS nod_agente_dono_imutavel ON agentes;
DROP FUNCTION IF EXISTS nod_agente_dono_imutavel();
DROP TABLE IF EXISTS agentes;
DROP TEXT SEARCH CONFIGURATION IF EXISTS nod_pt;
DROP TYPE IF EXISTS estado_inventario;
DROP TYPE IF EXISTS estado_rotina;
DROP TYPE IF EXISTS estado_proposta;
DROP TYPE IF EXISTS kind_proposta;
DROP TYPE IF EXISTS tipo_conversa;
DROP TYPE IF EXISTS declaracao_sensibilidade;
DROP TYPE IF EXISTS transporte_conector;
DROP TYPE IF EXISTS memoria_tipo;
DROP TYPE IF EXISTS kind_mensagem;
DROP TYPE IF EXISTS estado_decisao;
DROP TYPE IF EXISTS tipo_decisao;
DROP TYPE IF EXISTS politica_resposta;
DROP TYPE IF EXISTS dono_agente;
DROP TYPE IF EXISTS confianca;
DROP TYPE IF EXISTS origem_turno;
DROP TYPE IF EXISTS estado_turno;
DROP TYPE IF EXISTS codigo_erro;
DROP TYPE IF EXISTS desfecho_rotina;
DROP TYPE IF EXISTS desfecho_item;
DROP TYPE IF EXISTS motivo_localidade;
DROP TYPE IF EXISTS motivo_falha;
DROP TYPE IF EXISTS motivo_interrupcao;
DROP TYPE IF EXISTS motivo_negacao;
DROP TYPE IF EXISTS motivo_passe;
