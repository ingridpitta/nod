-- definido em 2026-10-12 (ADR-099, partes 3/4, issue I1): o modelo de dados das frentes e dos lotes, sem comportamento.
-- Cada bot tem um dono (a conversa dele); o paralelismo fica por baixo, em frentes que devolvem um resumo ao dono. A
-- frente é uma linha de `trabalhos` (reaproveita pasta, sessão, custo, memória e limpeza) com `forma = 'frente'`; nada
-- muda em `origem` (ADR-085 e "Fazer aqui" leem a origem). Cada pedido tem o seu lote: as frentes abertas juntas para o
-- mesmo pedido voltam juntas (o dono acorda uma vez, quando a última termina) ou uma a uma (`avisar_a_cada_uma`), e um
-- pedido nunca espera frentes de outro.
--
-- `lotes_de_frentes`: `aberto_por_turno_id` é o turno do dono que abriu o lote (a retomada do retorno aponta para ele);
-- `trabalho_id` nulo = lote da conversa do dono; preenchido = o trabalho onde o retorno nasce. `retorno_turno_id` é
-- UNIQUE: um retorno por lote, mesmo com duas frentes fechando ao mesmo tempo. `devolvido_em` marca que o lote foi
-- devolvido (com ou sem turno de retorno: o dono parado não ganha retomada).
--
-- `trabalhos.resumo`: o que a frente devolve ({feito, pr?, sha?, branch?, falta?}, validado em
-- src/domain/resumo-da-frente.ts). definido em 2026-10-12: teto de 16000 bytes no banco — os textos têm até 1000
-- caracteres cada (até 4 bytes por caractere em UTF-8) e o resto é número e sha; o teto só segura o que passou da
-- validação por engano.
--
-- Só adição (expand-only): colunas com default constante ou nulas e uma tabela nova; o código anterior roda sobre este
-- schema (não lê nada daqui, e toda task de hoje continua `forma = 'task'` sem lote).
SET LOCAL lock_timeout = '5s';

CREATE TABLE lotes_de_frentes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  agente_id uuid NOT NULL,
  aberto_por_turno_id uuid NOT NULL,
  trabalho_id uuid,
  avisar_a_cada_uma boolean NOT NULL DEFAULT false,
  retorno_turno_id uuid,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  devolvido_em timestamptz,
  -- O turno de retorno só existe depois da devolução; a devolução sem turno (o dono parou) é permitida.
  CONSTRAINT lote_retorno_devolvido CHECK (retorno_turno_id IS NULL OR devolvido_em IS NOT NULL),
  CONSTRAINT lote_retorno_outro_turno CHECK (retorno_turno_id IS NULL OR retorno_turno_id <> aberto_por_turno_id)
);
SELECT nod_escopar_tabela('lotes_de_frentes');
ALTER TABLE lotes_de_frentes ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE lotes_de_frentes ADD FOREIGN KEY (tenant_id, agente_id) REFERENCES agentes (tenant_id, id);
ALTER TABLE lotes_de_frentes ADD FOREIGN KEY (tenant_id, aberto_por_turno_id) REFERENCES turnos (tenant_id, id);
ALTER TABLE lotes_de_frentes ADD FOREIGN KEY (tenant_id, retorno_turno_id) REFERENCES turnos (tenant_id, id);
ALTER TABLE lotes_de_frentes ADD FOREIGN KEY (tenant_id, trabalho_id) REFERENCES trabalhos (tenant_id, id);
-- Um retorno por lote (o fecho concorrente de duas frentes perde no UNIQUE, não duplica a retomada).
CREATE UNIQUE INDEX lotes_de_frentes_retorno ON lotes_de_frentes (tenant_id, retorno_turno_id);

ALTER TABLE trabalhos ADD COLUMN forma text NOT NULL DEFAULT 'task';
ALTER TABLE trabalhos ADD CONSTRAINT trabalho_forma CHECK (forma IN ('task', 'frente'));
ALTER TABLE trabalhos ADD COLUMN lote_id uuid;
-- definido em 2026-10-12: apagar um lote (só a limpeza dos testes apaga) solta as frentes dele em vez de travar; o
-- código não apaga lote.
ALTER TABLE trabalhos ADD FOREIGN KEY (tenant_id, lote_id) REFERENCES lotes_de_frentes (tenant_id, id) ON DELETE SET NULL (lote_id);
-- Só frente entra em lote.
ALTER TABLE trabalhos ADD CONSTRAINT trabalho_lote_so_frente CHECK (lote_id IS NULL OR forma = 'frente');
ALTER TABLE trabalhos ADD COLUMN resumo jsonb;
ALTER TABLE trabalhos ADD CONSTRAINT trabalho_resumo CHECK (resumo IS NULL OR (jsonb_typeof(resumo) = 'object' AND octet_length(resumo::text) <= 16000));
-- O fecho do lote lê as frentes dele.
CREATE INDEX trabalhos_por_lote ON trabalhos (tenant_id, lote_id) WHERE lote_id IS NOT NULL;
-- Os pedidos de colega abertos por quem pediu: a espera circular (A espera B, B espera A) se detecta por aqui.
CREATE INDEX trabalhos_pedidos_abertos ON trabalhos (tenant_id, pedido_por_agente_id, agente_id)
  WHERE pedido_por_agente_id IS NOT NULL AND estado IN ('na_fila', 'rodando', 'precisa_de_voce', 'fechado_ocioso');

-- ROLLBACK:
-- -- O código anterior não lê nada daqui: voltar a imagem basta. Frentes e lotes que existirem perdem a forma e o lote
-- -- (viram tasks soltas, como antes da ADR-099) e os resumos somem com a coluna.
-- DROP INDEX trabalhos_pedidos_abertos;
-- DROP INDEX trabalhos_por_lote;
-- ALTER TABLE trabalhos DROP CONSTRAINT trabalho_resumo;
-- ALTER TABLE trabalhos DROP COLUMN resumo;
-- ALTER TABLE trabalhos DROP CONSTRAINT trabalho_lote_so_frente;
-- ALTER TABLE trabalhos DROP COLUMN lote_id;
-- ALTER TABLE trabalhos DROP CONSTRAINT trabalho_forma;
-- ALTER TABLE trabalhos DROP COLUMN forma;
-- DROP INDEX lotes_de_frentes_retorno;
-- DROP TABLE lotes_de_frentes;
