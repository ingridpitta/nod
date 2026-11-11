-- definido em 2026-11-10 (labels e prazo nas tarefas, como no Multica/Linear): campos para filtrar o quadro.
-- quadro_labels: o catálogo de labels de cada quadro (nome até 40, único sem caixa no quadro; cor de uma paleta fixa do
--   design system, a lista em src/contracts/quadro-labels.ts). Da dona, como as outras tabelas do quadro (RLS de dona,
--   sem policy nova): quem participa lê e mexe pelo caso de uso, pela porta da dona.
-- quadro_tarefas.label_ids: as labels da tarefa (0..N), ids do catálogo do mesmo quadro. Array na própria linha (e não
--   tabela de junção) para o Desfazer do lote, que fotografa a tarefa inteira, devolver as labels de graça. Remover uma
--   label do catálogo a tira dos arrays no mesmo comando (o caso de uso).
-- quadro_tarefas.prazo_em: o prazo da tarefa (data, sem hora; null = sem prazo). Vencida/hoje/semana são lidos no fuso
--   de quem lê (src/domain/quadro-labels.ts).
-- Só aditiva: colunas com padrão constante ou nulas (sem reescrita); o servidor de antes não lê nenhuma.
SET LOCAL lock_timeout = '5s';

CREATE TABLE quadro_labels (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  quadro_id uuid NOT NULL,
  nome text NOT NULL CHECK (length(nome) BETWEEN 1 AND 40),
  cor text NOT NULL DEFAULT 'cinza' CHECK (cor IN ('cinza', 'azul', 'verde', 'ambar', 'laranja', 'vermelho', 'rosa', 'violeta', 'turquesa')),
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('quadro_labels');
ALTER TABLE quadro_labels ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE quadro_labels ADD FOREIGN KEY (tenant_id, quadro_id) REFERENCES quadros (tenant_id, id) ON DELETE CASCADE;
CREATE UNIQUE INDEX quadro_labels_nome ON quadro_labels (tenant_id, quadro_id, lower(nome));

ALTER TABLE quadro_tarefas ADD COLUMN label_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE quadro_tarefas ADD COLUMN prazo_em date;

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- -- O servidor de antes não lê nenhuma: perdem-se as labels e os prazos das tarefas.
-- ALTER TABLE quadro_tarefas DROP COLUMN prazo_em;
-- ALTER TABLE quadro_tarefas DROP COLUMN label_ids;
-- DROP TABLE IF EXISTS quadro_labels;
