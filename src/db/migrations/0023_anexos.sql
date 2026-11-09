-- definido em 2026-09-24 (ADR-046): a pessoa manda arquivos na conversa para o MODELO ler naquele
-- turno — imagem, PDF ou texto. O arquivo nasce solto (mensagem_id nulo) quando o upload termina e é
-- preso à mensagem no envio. Os bytes ficam aqui, não no disco da máquina: o servidor é a fonte
-- da verdade da conversa e o driver baixa pela rota interna com o token do turno.
--
-- É conteúdo da pessoa (pode ter dado pessoal, ADR-002): apagável por nod_poda como a prosa.
CREATE TABLE anexos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  conversa_id uuid NOT NULL,
  mensagem_id uuid,
  nome text NOT NULL,
  mime text NOT NULL,
  tamanho int NOT NULL,
  conteudo bytea NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT anexo_tamanho CHECK (tamanho > 0 AND tamanho <= 10485760 AND tamanho = octet_length(conteudo)),
  CONSTRAINT anexo_nome CHECK (char_length(nome) BETWEEN 1 AND 200),
  CONSTRAINT anexo_mime CHECK (mime IN ('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf',
    'text/plain', 'text/markdown', 'text/csv', 'application/json'))
);
SELECT nod_escopar_tabela('anexos');
ALTER TABLE anexos ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE anexos ADD FOREIGN KEY (tenant_id, conversa_id) REFERENCES conversas (tenant_id, id);
ALTER TABLE anexos ADD FOREIGN KEY (tenant_id, mensagem_id) REFERENCES mensagens (tenant_id, id);
CREATE INDEX anexos_por_mensagem ON anexos (tenant_id, mensagem_id);
GRANT SELECT, DELETE ON anexos TO nod_poda;

-- O turno lembra quais anexos entraram nele: o plano lista os metadados e a rota interna só entrega
-- o que está aqui (token de turno ↔ anexo do próprio turno, nunca outro).
ALTER TABLE turnos ADD COLUMN entrada_anexos uuid[] NOT NULL DEFAULT '{}';

-- ROLLBACK:
-- ALTER TABLE turnos DROP COLUMN entrada_anexos;
-- DROP TABLE anexos;
