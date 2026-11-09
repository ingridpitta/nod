-- 0007 chave (token) de máquina (ADR-021, ADR-031): o servidor guarda SÓ o SHA-256 da chave.
-- Roda como nod_dono. Convenção `-- ROLLBACK:` no fim.
--
-- Tabela SEPARADA de `maquinas` (0001) de propósito: aquela é o inventário ("sem credencial",
-- ADR-021), tocado pelo poll a cada batida; esta é credencial. Uma pessoa pode ter N chaves (dois
-- laptops, rotação sem perder o inventário). A dona da linha (owner_id) é a PESSOA que emitiu; sem
-- perna extra — ninguém além dela lê, lista ou revoga. `visibility` fica no default 'privado'.
--
-- `hash` é bytea de 32 bytes, nunca text: a comparação em tempo constante mora no Node
-- (timingSafeEqual); o banco só acha a linha pelo índice. A chave crua não tem coluna.
-- `prefixo` são os 8 primeiros caracteres da metade ALEATÓRIA (nunca a do escopo), só para a lista
-- dizer "…a1b2c3d4"; sozinho não reconstrói nada.

CREATE TABLE maquina_tokens (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  prefixo text NOT NULL,
  hash bytea NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  ultimo_uso_em timestamptz,
  expira_em timestamptz,
  revogado_em timestamptz,
  CONSTRAINT maquina_tokens_hash_tamanho CHECK (octet_length(hash) = 32),
  CONSTRAINT maquina_tokens_prefixo_curto CHECK (length(prefixo) = 8),
  CONSTRAINT maquina_tokens_nome CHECK (length(btrim(nome)) BETWEEN 1 AND 60)
);
SELECT nod_escopar_tabela('maquina_tokens');
ALTER TABLE maquina_tokens ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE maquina_tokens ADD CONSTRAINT maquina_tokens_hash_unico UNIQUE (tenant_id, hash);
CREATE INDEX maquina_tokens_da_pessoa ON maquina_tokens (tenant_id, owner_id, criado_em DESC);

-- ROLLBACK:
-- DROP TABLE IF EXISTS maquina_tokens;
