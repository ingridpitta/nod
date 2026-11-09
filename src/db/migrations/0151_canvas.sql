-- definido em 2026-11-04 (ADA-13, ADR-150): o app Canvas de protótipos. App nativo do nod (sem conector): a pessoa o
-- instala uma vez (canvas_instalacoes) e dá a cada bot um nível (canvas_acessos: ver e comentar, ou criar e publicar).
-- O bot publica pelo gerir_canvas; cada publicação é uma versão (canvas_versoes) cuja estrutura aponta para blobs
-- deduplicados por hash (canvas_blobs: o HTML de cada tela, o CSS, o JS e as miniaturas). Os comentários
-- (canvas_comentarios) são presos ao endereço (tela_id 'J1-2' ou jornada 'J1'), não à versão: versão nova arquiva o da
-- tela que saiu e desarquiva o da que voltou, nunca apaga. O card na conversa é uma mensagem 'sistema' com payload
-- {kind:'canvas'}: o enum kind_mensagem não muda (rollback sem recriar tipo).
-- Só adição: o servidor antigo no ar não lê nem escreve estas tabelas.
SET LOCAL lock_timeout = '5s';

CREATE TABLE canvas_instalacoes (
  instalado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('canvas_instalacoes');
ALTER TABLE canvas_instalacoes ADD PRIMARY KEY (tenant_id, owner_id);

CREATE TABLE canvas_acessos (
  agente_id uuid NOT NULL,
  nivel text NOT NULL CHECK (nivel IN ('ver_comentar', 'criar_publicar')),
  atualizado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('canvas_acessos');
ALTER TABLE canvas_acessos ADD PRIMARY KEY (tenant_id, owner_id, agente_id);
ALTER TABLE canvas_acessos ADD FOREIGN KEY (tenant_id, agente_id) REFERENCES agentes (tenant_id, id) ON DELETE CASCADE;

CREATE TABLE canvas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  agente_id uuid NOT NULL,
  issue text CHECK (issue IS NULL OR length(issue) BETWEEN 3 AND 20),
  titulo text NOT NULL CHECK (length(titulo) BETWEEN 1 AND 200),
  versao_atual int NOT NULL DEFAULT 1 CHECK (versao_atual >= 1),
  -- A pasta de nod-prototipos de onde veio (importar); null = publicado direto pelo bot.
  origem_url text CHECK (origem_url IS NULL OR length(origem_url) BETWEEN 1 AND 500),
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  atualizado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('canvas');
ALTER TABLE canvas ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE canvas ADD FOREIGN KEY (tenant_id, agente_id) REFERENCES agentes (tenant_id, id);
-- Um canvas por issue no bot: publicar de novo a mesma issue é versão nova, não folha nova.
CREATE UNIQUE INDEX canvas_por_issue ON canvas (tenant_id, owner_id, agente_id, issue) WHERE issue IS NOT NULL;
CREATE INDEX canvas_do_agente ON canvas (tenant_id, owner_id, agente_id, atualizado_em);

CREATE TABLE canvas_versoes (
  canvas_id uuid NOT NULL,
  versao int NOT NULL CHECK (versao >= 1),
  -- EstruturaCanvas<hash> (src/domain/canvas.ts): jornadas, telas (ids, títulos, legendas, tamanho, hash do html),
  -- notas, links, css e js por hash.
  estrutura jsonb NOT NULL CHECK (jsonb_typeof(estrutura) = 'object' AND octet_length(estrutura::text) <= 2000000),
  -- A confiança da entrada do turno que publicou (ADR-026): a página mostra "não confiável" quando veio de turno sujo.
  confianca confianca NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('canvas_versoes');
ALTER TABLE canvas_versoes ADD PRIMARY KEY (tenant_id, canvas_id, versao);
ALTER TABLE canvas_versoes ADD FOREIGN KEY (tenant_id, canvas_id) REFERENCES canvas (tenant_id, id) ON DELETE CASCADE;

CREATE TABLE canvas_blobs (
  hash text NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$'),
  conteudo text NOT NULL CHECK (char_length(conteudo) <= 2000000),
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('canvas_blobs');
ALTER TABLE canvas_blobs ADD PRIMARY KEY (tenant_id, owner_id, hash);

CREATE TABLE canvas_comentarios (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  canvas_id uuid NOT NULL,
  tela_id text CHECK (tela_id IS NULL OR tela_id ~ '^J[0-9]{1,3}-[0-9]{1,3}$'),
  jornada text CHECK (jornada IS NULL OR jornada ~ '^J[0-9]{1,3}$'),
  tipo text NOT NULL CHECK (tipo IN ('pino', 'nota')),
  x double precision CHECK (x IS NULL OR (x >= 0 AND x <= 1)),
  y double precision CHECK (y IS NULL OR (y >= 0 AND y <= 1)),
  texto text NOT NULL CHECK (length(texto) BETWEEN 1 AND 4000),
  -- 'importado': veio da API velha do Gil pelo importar; nunca se passa por pessoa (entra no turno como não confiável).
  autor_tipo text NOT NULL CHECK (autor_tipo IN ('pessoa', 'bot', 'importado')),
  autor_id uuid,
  autor_nome text CHECK (autor_nome IS NULL OR length(autor_nome) BETWEEN 1 AND 120),
  pai_id uuid,
  -- A versão em que foi feito (só informativa: o comentário vale enquanto o endereço existir).
  versao int NOT NULL CHECK (versao >= 1),
  confianca confianca NOT NULL DEFAULT 'confiavel',
  resolvido_em timestamptz,
  arquivado_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT canvas_comentario_endereco CHECK (pai_id IS NOT NULL OR tela_id IS NOT NULL OR jornada IS NOT NULL),
  CONSTRAINT canvas_comentario_pino CHECK (tipo <> 'pino' OR pai_id IS NOT NULL OR (tela_id IS NOT NULL AND x IS NOT NULL AND y IS NOT NULL))
);
SELECT nod_escopar_tabela('canvas_comentarios');
ALTER TABLE canvas_comentarios ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE canvas_comentarios ADD FOREIGN KEY (tenant_id, canvas_id) REFERENCES canvas (tenant_id, id) ON DELETE CASCADE;
ALTER TABLE canvas_comentarios ADD FOREIGN KEY (tenant_id, pai_id) REFERENCES canvas_comentarios (tenant_id, id) ON DELETE CASCADE;
CREATE INDEX canvas_comentarios_do_canvas ON canvas_comentarios (tenant_id, canvas_id, criado_em);
-- O ON DELETE CASCADE do pai_id procura as respostas por este índice (revisão 1 do #649, M4).
CREATE INDEX canvas_comentarios_respostas ON canvas_comentarios (tenant_id, pai_id) WHERE pai_id IS NOT NULL;

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- DROP INDEX IF EXISTS canvas_comentarios_respostas;
-- DROP TABLE IF EXISTS canvas_comentarios;
-- DROP TABLE IF EXISTS canvas_blobs;
-- DROP TABLE IF EXISTS canvas_versoes;
-- DROP TABLE IF EXISTS canvas;
-- DROP TABLE IF EXISTS canvas_acessos;
-- DROP TABLE IF EXISTS canvas_instalacoes;
