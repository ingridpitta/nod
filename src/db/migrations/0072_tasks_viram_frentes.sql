-- definido em 2026-10-12 (ADR-099, parte 5, issue I10; decisão 8 do plano "um dono por bot"): as tasks abertas viram
-- frentes. Mesmo id, pasta e sessão; só `forma` muda. Elas ficam SEM lote (`lote_id` nulo), e o código trata a frente
-- sem lote como a task de antes (`formaEfetiva`, src/domain/frente.ts): o catálogo, o prompt, o histórico e a limpeza
-- continuam os de task, o fecho do lote (I3) e o varredor das frentes caídas (I9) a ignoram, e o resultado dela segue
-- como balão na conversa. O que muda é a tela: na Parte 5 ela aparece como frente do dono, não como task solta.
--
-- Só dado (expand-only): nenhuma coluna, CHECK ou índice muda. `forma = 'frente'` sem lote já é válido na 0071 (o CHECK
-- `trabalho_lote_so_frente` só proíbe lote em task). O código anterior roda igual sobre o resultado: até a I10 ele só
-- lia `forma` no fecho do lote, que exige lote, e nas três leituras que a I10 passou a fazer pela forma efetiva.
SET LOCAL lock_timeout = '5s';

-- Dado de tabela escopada escrito como nod_dono: NO FORCE só em volta do comando, religado no MESMO bloco (regra da
-- 0005/0026/0039/0049/0061/0068) — o gate rls.test.ts (relforcerowsecurity) acusa se sobrar.
ALTER TABLE trabalhos NO FORCE ROW LEVEL SECURITY;
UPDATE trabalhos SET forma = 'frente'
  WHERE forma = 'task' AND lote_id IS NULL AND estado IN ('na_fila', 'rodando', 'precisa_de_voce', 'fechado_ocioso');
ALTER TABLE trabalhos FORCE ROW LEVEL SECURITY;

-- ROLLBACK:
-- -- Só dado: o schema não muda. As frentes sem lote voltam a ser tasks (as abertas aqui e as que tiverem aberto e
-- -- fechado depois — antes da 0072 não existia frente sem lote, então nenhuma frente de verdade é tocada).
-- ALTER TABLE trabalhos NO FORCE ROW LEVEL SECURITY;
-- UPDATE trabalhos SET forma = 'task' WHERE forma = 'frente' AND lote_id IS NULL;
-- ALTER TABLE trabalhos FORCE ROW LEVEL SECURITY;
