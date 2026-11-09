-- definido em 2026-10-28 (NOD-58): diário da memória do bot. Cada criação, edição e remoção em agente_memorias grava aqui,
-- no mesmo statement (CTE no memorias.repo), o antes e o depois, quem fez e quando. Fonte própria, não `events`
-- (ADR-114 §6: o evento só leva o id). A pessoa desfaz uma entrada (vira entrada nova, com desfaz_id) e marca as do bot
-- como revisadas. Sem FK em memoria_id: a memória apagada some e a entrada fica. Escopada por nod_escopar_tabela (RLS da
-- dona e a policy nod_purga da 0110: a purga da conta já varre). Só CREATE: o servidor antigo no ar não a vê.
SET LOCAL lock_timeout = '5s';

CREATE TYPE memoria_diario_acao AS ENUM ('criada', 'editada', 'apagada');

CREATE TABLE memoria_diario (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  agente_id uuid NOT NULL,
  memoria_id uuid NOT NULL,
  acao memoria_diario_acao NOT NULL,
  autor autor_tipo NOT NULL,
  -- Origem e criado_em da memória: o desfazer de uma remoção a recria igual (mesmo id, tipo, texto, origem e data).
  memoria_origem autor_tipo NOT NULL,
  memoria_criado_em timestamptz NOT NULL,
  antes_tipo memoria_tipo,
  antes_texto text,
  depois_tipo memoria_tipo,
  depois_texto text,
  desfaz_id uuid,
  desfeita_em timestamptz,
  revisada_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT memoria_diario_forma CHECK (
    (acao = 'criada' AND antes_texto IS NULL AND antes_tipo IS NULL AND depois_texto IS NOT NULL AND depois_tipo IS NOT NULL)
    OR (acao = 'editada' AND antes_texto IS NOT NULL AND antes_tipo IS NOT NULL AND depois_texto IS NOT NULL AND depois_tipo IS NOT NULL)
    OR (acao = 'apagada' AND antes_texto IS NOT NULL AND antes_tipo IS NOT NULL AND depois_texto IS NULL AND depois_tipo IS NULL)
  )
);
SELECT nod_escopar_tabela('memoria_diario');
ALTER TABLE memoria_diario ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE memoria_diario ADD FOREIGN KEY (tenant_id, agente_id) REFERENCES agentes (tenant_id, id);
CREATE INDEX memoria_diario_por_agente ON memoria_diario (tenant_id, agente_id, criado_em DESC, id DESC);
CREATE INDEX memoria_diario_por_memoria ON memoria_diario (tenant_id, memoria_id, criado_em DESC, id DESC);
CREATE INDEX memoria_diario_a_revisar ON memoria_diario (tenant_id, agente_id) WHERE autor = 'agente' AND revisada_em IS NULL;

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- DROP TABLE IF EXISTS memoria_diario;
-- DROP TYPE IF EXISTS memoria_diario_acao;
