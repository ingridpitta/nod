-- definido em 2026-09-28 (modo dev): mostrar a quem desenvolve o nod o que foi enviado em cada turno e quanto
-- cada chamada custou. Motivo medido: o turno da Clarice que acabou em "Autocompact is thrashing" (28/09) só
-- deixava ver o total da sessão; a parte fixa de 140 mil dos 200 mil tokens só apareceu lendo o .jsonl do CLI.
--
-- O Raio-X de um turno: a composição (o servidor grava na emissão do plano) e a execução (o driver manda junto
-- do resultado). Tamanhos e contagens sempre; os textos do prompt só com o modo dev ligado. Privado da pessoa
-- dona do turno (owner_id do escopo), como o resto. Apagável por nod_poda: o texto é prompt sobre dado da pessoa.
CREATE TABLE turno_raio_x (
  turno_id uuid NOT NULL,
  composicao jsonb,
  execucao jsonb,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  atualizado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- O repositório corta os textos em 60 mil caracteres por parte; o teto aqui é a segunda camada.
  CONSTRAINT turno_raio_x_composicao CHECK (composicao IS NULL OR octet_length(composicao::text) <= 2000000),
  CONSTRAINT turno_raio_x_execucao CHECK (execucao IS NULL OR octet_length(execucao::text) <= 500000)
);
SELECT nod_escopar_tabela('turno_raio_x');
ALTER TABLE turno_raio_x ADD PRIMARY KEY (tenant_id, turno_id);
ALTER TABLE turno_raio_x ADD FOREIGN KEY (tenant_id, turno_id) REFERENCES turnos (tenant_id, id);
GRANT SELECT, DELETE ON turno_raio_x TO nod_poda;

-- Preferências da pessoa que valem em qualquer computador. O app desktop limpa o localStorage a cada abertura
-- (desktop/main.ts), e `pessoas` é só leitura para nod_app: a preferência mora aqui. Uma linha por pessoa.
CREATE TABLE preferencias (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  modo_dev boolean NOT NULL DEFAULT false,
  atualizado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('preferencias');
ALTER TABLE preferencias ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE preferencias ADD CONSTRAINT preferencias_uma_por_pessoa UNIQUE (tenant_id, owner_id);

-- ROLLBACK:
-- DROP TABLE preferencias;
-- DROP TABLE turno_raio_x;
