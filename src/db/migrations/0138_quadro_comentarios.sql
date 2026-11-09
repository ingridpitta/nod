-- definido em 2026-11-02 (NOD-417): os comentários de uma tarefa do quadro. Autor pessoa (a tela) ou bot (gerir_quadro
-- comentar). O comentário da pessoa aciona o bot responsável; a @menção aciona o bot mencionado, sem trocar o responsável.
-- `turnos`: os turnos que este comentário abriu ou em que se juntou (o dedup acha ali o turno ainda na fila do mesmo bot
-- na mesma tarefa). `de_fora`: o texto veio de um bot (ADR-062): quem o recebe recebe dado de fora.
-- Sem FK para a tarefa: o Desfazer de um lote que tirou a tarefa a devolve com o mesmo id, e os comentários voltam junto.
-- Só adição: o servidor antigo no ar não lê nem escreve esta tabela.
SET LOCAL lock_timeout = '5s';

CREATE TABLE quadro_comentarios (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  quadro_id uuid NOT NULL,
  tarefa_id uuid NOT NULL,
  autor text NOT NULL CHECK (autor IN ('pessoa', 'agente')),
  autor_agente_id uuid,
  texto text NOT NULL CHECK (length(texto) BETWEEN 1 AND 4000),
  de_fora boolean NOT NULL DEFAULT false,
  turnos uuid[] NOT NULL DEFAULT '{}',
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT quadro_comentarios_autor CHECK ((autor = 'agente') = (autor_agente_id IS NOT NULL))
);
SELECT nod_escopar_tabela('quadro_comentarios');
ALTER TABLE quadro_comentarios ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE quadro_comentarios ADD FOREIGN KEY (tenant_id, quadro_id) REFERENCES quadros (tenant_id, id) ON DELETE CASCADE;
CREATE INDEX quadro_comentarios_da_tarefa ON quadro_comentarios (tenant_id, tarefa_id, criado_em);

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- DROP TABLE IF EXISTS quadro_comentarios;
