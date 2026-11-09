-- definido em 2026-11-01 (NOD-415, ADR-141): o fluxo contínuo é o padrão do quadro. A meta passa a ser opcional: sem
-- ela, o quadro não mostra fração nem progresso e não tem risco de prazo; com ela, mostra "X de Y" e pode avisar. O check
-- de tamanho (1 a 200) continua valendo quando há meta (CHECK com NULL passa).
-- `meta_desde` (revisões 2 e 3): quando a meta foi posta (de sem meta para com meta). O período do risco e as tarefas que
-- contam para a meta partem dali — num quadro que viveu semanas sem meta, a meta nova não nasce "em risco" nem "cumprida"
-- pelas tarefas que já tinham terminado antes dela. Os quadros que já existem partem da criação (era o que valia).
-- `quadro_tarefas.terminada_em` (revisão 3): quando a tarefa entrou em feito/cancelado (NULL aberta). É o que decide se
-- ela terminou antes da meta; o `mudado_em` muda com qualquer edição (título, ordem) e devolveria a tarefa antiga à meta.
-- Voltar o código sem voltar o banco: o servidor de antes não lê meta nula (começar tarefa num quadro sem meta falha);
-- rode o rollback abaixo. A flag NOD_QUADROS deixa quadros só com os admins (o Marlon), então o alcance é dele.
SET LOCAL lock_timeout = '5s';

ALTER TABLE quadros ALTER COLUMN meta DROP NOT NULL;
ALTER TABLE quadros ADD COLUMN meta_desde timestamptz NOT NULL DEFAULT now();
UPDATE quadros SET meta_desde = criado_em;
ALTER TABLE quadro_tarefas ADD COLUMN terminada_em timestamptz;
-- Pelo grupo da coluna (ADR-140): a 0134 pode já estar no ar com colunas da pessoa (`c-…`) dos grupos Feito e Fechado.
UPDATE quadro_tarefas t SET terminada_em = t.mudado_em FROM quadros q
 WHERE q.tenant_id = t.tenant_id AND q.id = t.quadro_id
   AND (t.status IN ('feito', 'cancelado')
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(q.colunas) c WHERE c->>'id' = t.status AND c->>'grupo' IN ('feito', 'fechado')));

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- -- Antes do NOT NULL: o quadro sem meta (o padrão agora) ganha uma meta genérica, senão o SET NOT NULL falha.
-- UPDATE quadros SET meta = 'Quadro' WHERE meta IS NULL;
-- ALTER TABLE quadros ALTER COLUMN meta SET NOT NULL;
-- ALTER TABLE quadros DROP COLUMN meta_desde;
-- ALTER TABLE quadro_tarefas DROP COLUMN terminada_em;
