-- definido em 2026-11-10 (ADR-165, tarefa aberta como o Multica, Passo 2): os passos do run deixam de ser só frames SSE
-- efêmeros (turno.delta / turno.atividade / turno.acao_fim). Reabrir a tarefa no meio do run voltava a "Começando…" e o
-- run concluído perdia a lista. Um passo por linha:
-- - seq: identity GLOBAL, a ordem dos passos e o cursor `depois` da rota paginada (nunca reusado, nunca reordenado);
-- - raiz_id: o turno raiz da cadeia (retoma_turno_id) — a tela lê por run = raiz; turno_id: o turno real (a retomada).
--   Só a raiz tem FK (ON DELETE CASCADE, coberta pelo índice abaixo); turno_id fica sem FK para o apagar de um turno não
--   varrer a tabela (a retomada só some junto da raiz);
-- - tipo/classe: o que o passo é e o ícone; ferramenta: o nome curto (agrupa 3 ou mais iguais seguidas); rotulo: o texto
--   humano que já saía no frame; resumo: UMA linha do argumento (ou o começo do bloco de fala), já redigida no executor e
--   de novo no servidor, até 160 (o CHECK é a segunda camada); acao_id: o id do tool_use (o fim marca `falhou`).
-- O teto de 2000 passos por raiz (PASSOS_POR_TURNO_MAX) é aplicado na gravação (turno-passos.repo.ts); a dona poda os de
-- mais de 90 dias no varredor de expiração; apagável por nod_poda (como o turno_raio_x, 0036). Só adição: o servidor de
-- antes não lê nem grava a tabela.
SET LOCAL lock_timeout = '5s';

CREATE TABLE turno_passos (
  seq bigint GENERATED ALWAYS AS IDENTITY,
  raiz_id uuid NOT NULL,
  turno_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('texto', 'ferramenta', 'fim', 'erro')),
  classe text NOT NULL CHECK (classe IN ('comando', 'arquivo', 'busca', 'app', 'texto', 'erro', 'outro')),
  ferramenta text CHECK (ferramenta IS NULL OR length(ferramenta) BETWEEN 1 AND 80),
  rotulo text NOT NULL CHECK (length(rotulo) <= 200),
  resumo text CHECK (resumo IS NULL OR length(resumo) <= 160),
  acao_id text CHECK (acao_id IS NULL OR length(acao_id) <= 200),
  falhou boolean NOT NULL DEFAULT false,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('turno_passos');
ALTER TABLE turno_passos ADD PRIMARY KEY (tenant_id, seq);
ALTER TABLE turno_passos ADD CONSTRAINT turno_passos_raiz_fk FOREIGN KEY (tenant_id, raiz_id) REFERENCES turnos (tenant_id, id) ON DELETE CASCADE;
-- A leitura do run (daCadeia, resumo), o teto por raiz e o CASCADE da raiz.
CREATE INDEX turno_passos_da_raiz ON turno_passos (tenant_id, raiz_id, seq);
-- A poda por idade da dona (varredor de expiração).
CREATE INDEX turno_passos_por_dona ON turno_passos (tenant_id, owner_id, criado_em);
GRANT SELECT, DELETE ON turno_passos TO nod_poda;

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- -- O servidor de antes não lê a tabela: perdem-se os passos gravados (os frames ao vivo seguem).
-- DROP TABLE IF EXISTS turno_passos;
