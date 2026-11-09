-- definido em 2026-11-07 (ADA-241, ADR-158): permissões dos apps em lote e padrão por app.
-- acessos_padrao: o nível com que o bot novo nasce no app (Nenhum, Ler, Ler e alterar). Sem linha = Nenhum.
-- acessos_definidos: quem já teve o nível escolhido pela pessoa (origem 'pessoa') ou recebeu o padrão (origem 'padrao').
--   Sem linha e sem concessão no app = "não definido": herda o padrão quando ele muda.
-- acessos_lotes: cada mudança em lote, com o antes e o depois de cada bot (as capacidades), para o Desfazer.
-- Só adição: o servidor antigo no ar não lê nem escreve estas tabelas.
SET LOCAL lock_timeout = '5s';

CREATE TABLE acessos_padrao (
  conector_id uuid NOT NULL,
  nivel text NOT NULL CHECK (nivel IN ('nenhum', 'leitura', 'escrita')),
  atualizado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('acessos_padrao');
ALTER TABLE acessos_padrao ADD PRIMARY KEY (tenant_id, conector_id);
ALTER TABLE acessos_padrao ADD FOREIGN KEY (tenant_id, conector_id) REFERENCES conectores (tenant_id, id) ON DELETE CASCADE;

CREATE TABLE acessos_definidos (
  agente_id uuid NOT NULL,
  conector_id uuid NOT NULL,
  origem text NOT NULL CHECK (origem IN ('pessoa', 'padrao')),
  atualizado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('acessos_definidos');
ALTER TABLE acessos_definidos ADD PRIMARY KEY (tenant_id, agente_id, conector_id);
ALTER TABLE acessos_definidos ADD FOREIGN KEY (tenant_id, agente_id) REFERENCES agentes (tenant_id, id) ON DELETE CASCADE;
ALTER TABLE acessos_definidos ADD FOREIGN KEY (tenant_id, conector_id) REFERENCES conectores (tenant_id, id) ON DELETE CASCADE;

CREATE TABLE acessos_lotes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  conector_id uuid NOT NULL,
  nivel text NOT NULL CHECK (nivel IN ('nenhum', 'leitura', 'escrita')),
  -- A chave de idempotência do clique (o mesmo lote reenviado não aplica duas vezes).
  chave text NOT NULL CHECK (length(chave) BETWEEN 8 AND 80),
  -- {agenteId: [capacidades]} antes e depois; o Desfazer só volta quem ainda está no depois.
  antes jsonb NOT NULL CHECK (jsonb_typeof(antes) = 'object' AND octet_length(antes::text) <= 500000),
  depois jsonb NOT NULL CHECK (jsonb_typeof(depois) = 'object' AND octet_length(depois::text) <= 500000),
  -- {agenteId: 'pessoa'|'padrao'} de quem já tinha marca antes do lote; quem falta era "não definido" (volta a herdar).
  marcas_antes jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(marcas_antes) = 'object' AND octet_length(marcas_antes::text) <= 100000),
  autor_tipo text NOT NULL CHECK (autor_tipo IN ('pessoa', 'bot')),
  autor_id uuid,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  desfeito_em timestamptz
);
SELECT nod_escopar_tabela('acessos_lotes');
ALTER TABLE acessos_lotes ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE acessos_lotes ADD FOREIGN KEY (tenant_id, conector_id) REFERENCES conectores (tenant_id, id) ON DELETE CASCADE;
CREATE UNIQUE INDEX acessos_lotes_chave ON acessos_lotes (tenant_id, owner_id, chave);

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- DROP TABLE IF EXISTS acessos_lotes;
-- DROP TABLE IF EXISTS acessos_definidos;
-- DROP TABLE IF EXISTS acessos_padrao;
