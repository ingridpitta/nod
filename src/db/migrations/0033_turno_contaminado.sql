-- 0033 o turno que trouxe conteúdo da web pelas ferramentas nativas fica marcado. Convenção `-- ROLLBACK:`.
-- Só aditiva.
--
-- definido em 2026-09-28 (ADR-052): WebFetch e WebSearch nativos trazem conteúdo de fora para o turno SEM
-- passar pelo proxy — não há moldura, e o catálogo não encolhe no meio do turno (ADR-026). O hook do nod
-- avisa o servidor a cada chamada; a partir da marca, escrita em conector só por item aprovado (como o gate
-- de rotina) e "Sempre permitir" não vale — o equivalente dinâmico do catálogo reduzido.

ALTER TABLE turnos ADD COLUMN IF NOT EXISTS contaminado_em timestamptz;

-- ROLLBACK:
-- ALTER TABLE turnos DROP COLUMN IF EXISTS contaminado_em;
