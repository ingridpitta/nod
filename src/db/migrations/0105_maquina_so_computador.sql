-- definido em 2026-10-22 (NOD-94, emenda 11 da ADR-090): a máquina "só computador".
--
-- 1. `maquina_tokens.papel`: 'motor' (o de sempre: pega turno) ou 'computador' (só hospeda o computador do bot da pessoa e
--    nunca reivindica turno). Quem decide o papel é o servidor, no pareamento por convite; o anúncio da máquina só confere.
--    Default 'motor': toda chave que já existe continua como estava.
-- 2. No máximo UMA máquina só-computador viva por pessoa (`maquina_tokens_um_computador`). "Substituir" revoga a anterior
--    antes de parear a nova. O índice olha só `revogado_em`: a chave que venceu sem confirmação (`expira_em`, ADR-102)
--    segura a vaga até ser revogada — o pareamento novo revoga as vencidas da pessoa antes de gravar.
-- 3. `maquinas_ssh`: o que o nod guarda de uma instalação por SSH — host, porta, usuário e a impressão da host key (para
--    travar a reinstalação com StrictHostKeyChecking=yes). A credencial (chave, senha, frase-senha) NUNCA vem para cá nem
--    para log: o pedido vive só em memória (instalacoes-por-ssh.ts). Uma linha por (pessoa, host, porta): reinstalar no
--    mesmo endereço atualiza a linha. RLS por pessoa (nod_escopar_tabela), sem perna extra.
-- Só adição: o código anterior não lê a coluna nem a tabela.
SET LOCAL lock_timeout = '5s';

ALTER TABLE maquina_tokens ADD COLUMN IF NOT EXISTS papel text NOT NULL DEFAULT 'motor';
ALTER TABLE maquina_tokens ADD CONSTRAINT maquina_tokens_papel CHECK (papel IN ('motor', 'computador'));
CREATE UNIQUE INDEX maquina_tokens_um_computador ON maquina_tokens (tenant_id, owner_id)
  WHERE papel = 'computador' AND revogado_em IS NULL;

CREATE TABLE maquinas_ssh (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  maquina_id uuid NOT NULL,
  host text NOT NULL,
  porta integer NOT NULL DEFAULT 22,
  usuario text NOT NULL,
  impressao_host text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  atualizado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT maquinas_ssh_host CHECK (char_length(host) BETWEEN 1 AND 253),
  CONSTRAINT maquinas_ssh_porta CHECK (porta BETWEEN 1 AND 65535),
  CONSTRAINT maquinas_ssh_usuario CHECK (char_length(usuario) BETWEEN 1 AND 64),
  CONSTRAINT maquinas_ssh_impressao CHECK (char_length(impressao_host) BETWEEN 1 AND 200)
);
SELECT nod_escopar_tabela('maquinas_ssh');
ALTER TABLE maquinas_ssh ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE maquinas_ssh ADD FOREIGN KEY (tenant_id, maquina_id) REFERENCES maquina_tokens (tenant_id, id);
CREATE UNIQUE INDEX maquinas_ssh_endereco ON maquinas_ssh (tenant_id, owner_id, lower(host), porta);
CREATE INDEX maquinas_ssh_da_maquina ON maquinas_ssh (tenant_id, maquina_id);

-- ROLLBACK:
-- DROP TABLE IF EXISTS maquinas_ssh;
-- DROP INDEX IF EXISTS maquina_tokens_um_computador;
-- ALTER TABLE maquina_tokens DROP CONSTRAINT IF EXISTS maquina_tokens_papel;
-- ALTER TABLE maquina_tokens DROP COLUMN IF EXISTS papel;
