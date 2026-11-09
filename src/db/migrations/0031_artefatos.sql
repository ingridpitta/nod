-- definido em 2026-09-28 (ADR-051): o artefato do nod. O bot publica HTML que aparece DENTRO da conversa,
-- interativo (checkbox) e com estado salvo por pessoa; publicar de novo o mesmo artefato cria uma versão.
-- Motivo medido em 2026-09-28: pedido "num artefato do Claude" à Ada — o `claude -p` headless não tem a
-- ferramenta de artefato; ela contornou escrevendo HTML no computador do bot: 7 pedidos em 11 min,
-- 9 aprovações, 18 turnos, US$ 5,94, e o arquivo nunca abriu para a pessoa.
--
-- O HTML é do bot e é NÃO CONFIÁVEL: a web o roda num iframe sandbox sem allow-same-origin e sem rede
-- (CSP no srcdoc). Aqui só os tetos: título ≤ 120, HTML ≤ 500 000 caracteres, estado ≤ 64 KB.
--
-- O valor novo do enum só é USADO por código posterior a esta migração: ADD VALUE não pode ser usado na
-- mesma transação que o criou (mesma ressalva da 0028).
ALTER TYPE kind_mensagem ADD VALUE IF NOT EXISTS 'artefato';

-- O artefato: de um agente, nascido numa conversa. `versao_atual` sobe a cada publicação (UPDATE com a
-- linha travada serializa duas publicações simultâneas; o UNIQUE das versões é a segunda camada).
CREATE TABLE artefatos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  agente_id uuid NOT NULL,
  conversa_id uuid NOT NULL,
  titulo text NOT NULL,
  versao_atual int NOT NULL DEFAULT 1,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  atualizado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT artefato_titulo CHECK (char_length(titulo) BETWEEN 1 AND 120),
  CONSTRAINT artefato_versao_atual CHECK (versao_atual >= 1)
);
SELECT nod_escopar_tabela('artefatos');
ALTER TABLE artefatos ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE artefatos ADD FOREIGN KEY (tenant_id, agente_id) REFERENCES agentes (tenant_id, id);
ALTER TABLE artefatos ADD FOREIGN KEY (tenant_id, conversa_id) REFERENCES conversas (tenant_id, id);
CREATE INDEX artefatos_por_agente ON artefatos (tenant_id, agente_id, atualizado_em);

-- Uma linha por publicação: a mensagem da conversa aponta para (artefato, versão), e a web mostra o
-- HTML daquela versão. É conteúdo gerado sobre dado da pessoa: apagável por nod_poda como a prosa.
CREATE TABLE artefato_versoes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  artefato_id uuid NOT NULL,
  versao int NOT NULL,
  html text NOT NULL,
  mensagem_id uuid,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT artefato_versao_positiva CHECK (versao >= 1),
  CONSTRAINT artefato_html CHECK (char_length(html) BETWEEN 1 AND 500000)
);
SELECT nod_escopar_tabela('artefato_versoes');
ALTER TABLE artefato_versoes ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE artefato_versoes ADD CONSTRAINT artefato_versoes_unica UNIQUE (tenant_id, artefato_id, versao);
ALTER TABLE artefato_versoes ADD FOREIGN KEY (tenant_id, artefato_id) REFERENCES artefatos (tenant_id, id);
ALTER TABLE artefato_versoes ADD FOREIGN KEY (tenant_id, mensagem_id) REFERENCES mensagens (tenant_id, id);
GRANT SELECT, DELETE ON artefato_versoes TO nod_poda;

-- O que a pessoa marcou (window.nod.salvar no iframe). Um por PESSOA dona (owner_id vem do escopo):
-- o estado não é do artefato, é de quem o usa. O teto é medido no texto do jsonb (a forma normalizada que
-- o banco guarda), e o repositório só grava quando cabe — a borda não vê CHECK virar 500.
CREATE TABLE artefato_estados (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  artefato_id uuid NOT NULL,
  dados jsonb NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT artefato_estado_tamanho CHECK (octet_length(dados::text) <= 65536)
);
SELECT nod_escopar_tabela('artefato_estados');
ALTER TABLE artefato_estados ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE artefato_estados ADD CONSTRAINT artefato_estados_um_por_pessoa UNIQUE (tenant_id, artefato_id, owner_id);
ALTER TABLE artefato_estados ADD FOREIGN KEY (tenant_id, artefato_id) REFERENCES artefatos (tenant_id, id);
GRANT SELECT, DELETE ON artefato_estados TO nod_poda;

-- ROLLBACK:
-- DROP TABLE artefato_estados;
-- DROP TABLE artefato_versoes;
-- DROP TABLE artefatos;
-- (o valor 'artefato' do enum fica: Postgres não remove valor de enum; antes, UPDATE mensagens SET kind = 'sistema' WHERE kind = 'artefato')
