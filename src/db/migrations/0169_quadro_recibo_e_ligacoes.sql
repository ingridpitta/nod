-- definido em 2026-11-10 (comparação Multica × nod da tarefa aberta, Passos 2 e 3): as ligações exatas que a tela casava
-- por heurística.
--
-- - quadro_comentarios.turno_id: o turno RAIZ do run em que o agente escreveu o comentário. A tela ligava o run à
--   resposta pela janela "entre o início e o fim + 120 s"; agora é pelo turno.
-- - quadro_comentarios.pergunta: o comentário é a pergunta à pessoa (ADR-162). A tela achava a pergunta pelo comentário
--   que "termina com o texto" de quadro_tarefas.pergunta (frágil com edição e @menção no fim).
-- - quadro_recados.comentario_id: o recado nasceu do "manda agora" de um comentário. O recibo do comentário
--   (aguardando / lido / não entrou) lê o entregue_em dele, e o recado que não entrou fica na thread, não vira trabalho
--   novo fora dela (bug 13 da comparação).
-- Sem FK: o comentário apagado é lógico (a linha fica) e o turno podado não deve apagar a ligação.
-- Só adição: o servidor antigo no ar não lê as colunas novas (o default cobre o insert dele).
SET LOCAL lock_timeout = '5s';

ALTER TABLE quadro_comentarios ADD COLUMN turno_id uuid;
ALTER TABLE quadro_comentarios ADD COLUMN pergunta boolean NOT NULL DEFAULT false;
ALTER TABLE quadro_recados ADD COLUMN comentario_id uuid;
CREATE INDEX quadro_recados_do_comentario ON quadro_recados (tenant_id, comentario_id) WHERE comentario_id IS NOT NULL;

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- DROP INDEX quadro_recados_do_comentario;
-- ALTER TABLE quadro_recados DROP COLUMN comentario_id;
-- ALTER TABLE quadro_comentarios DROP COLUMN pergunta;
-- ALTER TABLE quadro_comentarios DROP COLUMN turno_id;
