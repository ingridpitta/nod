-- definido em 2026-10-15 (NOD-291, C13/C23 da forense de produção): o executor dos turnos antigos passa a ser o real.
--
-- Até o 9c6c7ddc (NOD-206, 11/10 12:11) o INSERT gravava `t.executor ?? 'catcher'` e nada escrevia o executor em que o
-- turno de fato rodou: 2.179 turnos que rodaram no Mac ficaram com o DEFAULT 'catcher' (2.335 rotulados, só 129 com
-- `catcher_registros`, que é o catcher de verdade). A retomada de rotina e de pedido compara esse rótulo para dar
-- --resume (emitir-plano-turno.ts, `daCadeia.executor === executor`) e refazia o histórico; custo e Raio-X mentiam.
--
-- A fonte do executor real: o `turno_despachado` mais recente do turno (`dados.executor`, gravado pelo plano — o
-- redespacho vale pelo último); sem ele, o `gastos` mais recente (o executor que a máquina informou na entrega). Só
-- valores 'local'/'catcher', só onde diverge, e nunca num turno com `catcher_registros` (o catcher real fica catcher).
--
-- A regra mora em duas funções (SECURITY INVOKER) para o teste rodá-la sob RLS, como nod_app, com as próprias linhas
-- (tests/integration/migracao-executor-backfill.test.ts); aqui ela roda como nod_dono sobre a tabela inteira. É
-- idempotente: a segunda passada altera 0 linhas. O NOTICE diz quantas divergiam antes, quantas mudaram e quantas
-- sobraram (o runner engole NOTICE; rode `select * from nod_alinhar_executor_dos_turnos()` para ver numa cópia).
SET LOCAL lock_timeout = '5s';

-- Os turnos cujo executor diverge do real (visíveis a quem chama: sob RLS, só os da pessoa).
CREATE OR REPLACE FUNCTION nod_executor_divergente()
RETURNS TABLE (tenant_id uuid, turno_id uuid, executor text)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  -- Um DISTINCT ON por fonte (uma passada em `events` e uma em `gastos`), não um LATERAL por turno: nenhuma das duas tem
  -- índice por turno_id, e o LATERAL virava seq scan por turno (QA do #346: 155 s com 4.000 turnos × 80 mil eventos,
  -- segurando ACCESS EXCLUSIVE nas 4 tabelas; assim, 0,2 s). Mesma ordem e mesmo desempate do LATERAL de antes.
  WITH d AS (
    SELECT DISTINCT ON (e.tenant_id, e.turno_id) e.tenant_id, e.turno_id, e.dados->>'executor' AS executor
    FROM events e
    WHERE e.kind = 'turno_despachado' AND e.turno_id IS NOT NULL AND e.dados->>'executor' IN ('local', 'catcher')
    -- Vale o último despacho; empate no instante (dois despachos na mesma transação): vale o local, onde a sessão mora.
    ORDER BY e.tenant_id, e.turno_id, e.created_at DESC, (e.dados->>'executor' = 'local') DESC
  ), g AS (
    SELECT DISTINCT ON (x.tenant_id, x.turno_id) x.tenant_id, x.turno_id, x.executor
    FROM gastos x
    WHERE x.executor IN ('local', 'catcher')
    ORDER BY x.tenant_id, x.turno_id, x.em DESC
  )
  SELECT t.tenant_id, t.id, coalesce(d.executor, g.executor)
  FROM turnos t
  LEFT JOIN d ON d.tenant_id = t.tenant_id AND d.turno_id = t.id
  LEFT JOIN g ON g.tenant_id = t.tenant_id AND g.turno_id = t.id
  WHERE NOT EXISTS (SELECT 1 FROM catcher_registros c WHERE c.tenant_id = t.tenant_id AND c.turno_id = t.id)
    AND coalesce(d.executor, g.executor) IS NOT NULL
    AND t.executor IS DISTINCT FROM coalesce(d.executor, g.executor)
$$;

CREATE OR REPLACE FUNCTION nod_alinhar_executor_dos_turnos()
RETURNS TABLE (divergentes_antes int, alterados int, divergentes_depois int)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  divergentes_antes := (SELECT count(*) FROM nod_executor_divergente());
  UPDATE turnos t SET executor = r.executor
  FROM nod_executor_divergente() r
  WHERE t.tenant_id = r.tenant_id AND t.id = r.turno_id;
  GET DIAGNOSTICS alterados = ROW_COUNT;
  divergentes_depois := (SELECT count(*) FROM nod_executor_divergente());
  RAISE NOTICE 'nod_alinhar_executor_dos_turnos: % divergentes antes, % alterados, % depois', divergentes_antes, alterados, divergentes_depois;
  RETURN NEXT;
END;
$$;

-- Dado de tabela escopada lido e escrito como nod_dono: NO FORCE só em volta do comando, religado no MESMO bloco (regra
-- da 0005/0026/0039/0049/0061/0068/0072) — o gate rls.test.ts (relforcerowsecurity) acusa se sobrar.
ALTER TABLE turnos NO FORCE ROW LEVEL SECURITY;
ALTER TABLE events NO FORCE ROW LEVEL SECURITY;
ALTER TABLE gastos NO FORCE ROW LEVEL SECURITY;
ALTER TABLE catcher_registros NO FORCE ROW LEVEL SECURITY;
SELECT * FROM nod_alinhar_executor_dos_turnos();
ALTER TABLE catcher_registros FORCE ROW LEVEL SECURITY;
ALTER TABLE gastos FORCE ROW LEVEL SECURITY;
ALTER TABLE events FORCE ROW LEVEL SECURITY;
ALTER TABLE turnos FORCE ROW LEVEL SECURITY;

-- ROLLBACK:
-- -- O dado não volta: o rótulo de antes era o DEFAULT errado (o código anterior roda igual com o executor real, e o
-- -- 9c6c7ddc já grava o real nos turnos novos). Só as funções saem.
-- DROP FUNCTION IF EXISTS nod_alinhar_executor_dos_turnos();
-- DROP FUNCTION IF EXISTS nod_executor_divergente();
