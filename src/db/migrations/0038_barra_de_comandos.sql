-- definido em 2026-09-28: o "/" do chat (canvas "Nod — tela do agente", página "Comandos /").
--
-- O catálogo do Mac da pessoa: as skills e os comandos que o Claude Code dela carrega, com descrição e origem. Vem
-- do app do Mac junto da entrega de um turno, só quando muda; fica aqui para o "/" abrir mesmo com o Mac fora do ar
-- (a tela diz de quando é a lista). Uma linha por pessoa, privada dela.
CREATE TABLE catalogo_comandos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  catalogo jsonb NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT catalogo_comandos_tamanho CHECK (octet_length(catalogo::text) <= 1000000)
);
SELECT nod_escopar_tabela('catalogo_comandos');
ALTER TABLE catalogo_comandos ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE catalogo_comandos ADD CONSTRAINT catalogo_comandos_um_por_pessoa UNIQUE (tenant_id, owner_id);

-- /nova-sessao: o bot começa do zero e a conversa continua na tela. Medido no CLI 2.1.284: o /clear numa sessão
-- retomada NÃO esquece — a sessão original, retomada depois, ainda lembrava o que foi dito antes. Então é o nod quem
-- recomeça: zera a sessão e marca o instante; o histórico recente que vai no prompt só leva o que veio depois.
ALTER TABLE conversas ADD COLUMN IF NOT EXISTS recomeco_em timestamptz;

-- ROLLBACK:
-- ALTER TABLE conversas DROP COLUMN recomeco_em;
-- DROP TABLE catalogo_comandos;
