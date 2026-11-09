-- definido em 2026-11-02 (NOD-422): trazer o trabalho do Linear para o quadro. A importação é uma proposta com card
-- ('importacao_linear', proposta e decisão de mesmo id); confirmar grava uma linha em quadro_importacoes e o servidor
-- traz as issues em segundo plano (progresso em trazidas/total) e aplica tudo num lote só, com Desfazer.
-- Os comentários trazidos do Linear ficam em quadro_comentarios com autor 'linear' (nome do autor, id no Linear para
-- reimportar sem duplicar e o lote, para o Desfazer apagar só os trazidos). O histórico ganha a linha 'linear'
-- ("No Linear em X desde dd/mm", "fechada no Linear").
-- Para o PR 2 da mesma issue (o quadro assume): o valor 'assumir_quadro' e quadros.assumido_em. Valor novo de enum não
-- pode ser usado na mesma transação que o criou (0060, 0117, 0135): nada aqui o usa.
SET LOCAL lock_timeout = '5s';

ALTER TYPE kind_proposta ADD VALUE IF NOT EXISTS 'importacao_linear';
ALTER TYPE kind_proposta ADD VALUE IF NOT EXISTS 'assumir_quadro';
ALTER TYPE tipo_decisao ADD VALUE IF NOT EXISTS 'importacao_linear';
ALTER TYPE tipo_decisao ADD VALUE IF NOT EXISTS 'assumir_quadro';

CREATE TABLE quadro_importacoes (
  -- O mesmo id da proposta/decisão do card.
  id uuid NOT NULL,
  quadro_id uuid NOT NULL,
  time text NOT NULL CHECK (length(time) BETWEEN 1 AND 20),
  filtro text CHECK (filtro IN ('sem_backlog')),
  estado text NOT NULL CHECK (estado IN ('trazendo', 'aplicada', 'falhou', 'desfeita')),
  total integer NOT NULL DEFAULT 0 CHECK (total >= 0),
  trazidas integer NOT NULL DEFAULT 0 CHECK (trazidas >= 0),
  -- A frase do erro (sem dado do Linear): "o Linear não respondeu".
  erro text CHECK (length(erro) <= 300),
  lote_id uuid,
  -- Depois de aplicada: em quantas colunas as tarefas caíram ("Trouxe 190 tarefas para 11 colunas").
  colunas integer CHECK (colunas >= 0),
  conversa_id uuid,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  atualizado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('quadro_importacoes');
ALTER TABLE quadro_importacoes ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE quadro_importacoes ADD FOREIGN KEY (tenant_id, quadro_id) REFERENCES quadros (tenant_id, id) ON DELETE CASCADE;
-- Uma importação trazendo por quadro: o segundo Confirmar (outra aba) esbarra aqui.
CREATE UNIQUE INDEX quadro_importacoes_trazendo ON quadro_importacoes (tenant_id, quadro_id) WHERE estado = 'trazendo';
CREATE INDEX quadro_importacoes_recentes ON quadro_importacoes (tenant_id, quadro_id, criado_em DESC);
-- Revisão 8 do PR #630: o Desfazer acha a importação pelo lote (doLote).
CREATE INDEX quadro_importacoes_lote ON quadro_importacoes (tenant_id, lote_id) WHERE lote_id IS NOT NULL;

-- Revisão 11 do PR #630: os CHECKs recriados entram NOT VALID e são validados em seguida (o padrão da 0130). Aqui não
-- poupa trava (o ADD COLUMN da mesma transação já segura a exclusiva até o commit); vale como molde, inofensivo no tamanho atual.
ALTER TABLE quadro_comentarios DROP CONSTRAINT quadro_comentarios_autor_check;
ALTER TABLE quadro_comentarios ADD CONSTRAINT quadro_comentarios_autor_check CHECK (autor IN ('pessoa', 'agente', 'linear')) NOT VALID;
ALTER TABLE quadro_comentarios VALIDATE CONSTRAINT quadro_comentarios_autor_check;
ALTER TABLE quadro_comentarios ADD COLUMN autor_nome text CHECK (length(autor_nome) <= 200);
ALTER TABLE quadro_comentarios ADD COLUMN linear_id text CHECK (length(linear_id) <= 100);
ALTER TABLE quadro_comentarios ADD COLUMN lote_id uuid;
ALTER TABLE quadro_comentarios ADD CONSTRAINT quadro_comentarios_do_linear CHECK ((autor = 'linear') = (linear_id IS NOT NULL)) NOT VALID;
ALTER TABLE quadro_comentarios VALIDATE CONSTRAINT quadro_comentarios_do_linear;
CREATE UNIQUE INDEX quadro_comentarios_linear ON quadro_comentarios (tenant_id, tarefa_id, linear_id) WHERE linear_id IS NOT NULL;
-- Revisão 8 do PR #630: o Desfazer apaga os comentários trazidos pelo lote (apagarComentariosDoLote) sem varrer os da pessoa.
CREATE INDEX quadro_comentarios_lote ON quadro_comentarios (tenant_id, lote_id) WHERE lote_id IS NOT NULL;

ALTER TABLE quadro_tarefa_historico DROP CONSTRAINT quadro_tarefa_historico_campo_check;
ALTER TABLE quadro_tarefa_historico ADD CONSTRAINT quadro_tarefa_historico_campo_check CHECK (campo IN ('criada', 'status', 'agente', 'quadro', 'restaurada', 'linear')) NOT VALID;
ALTER TABLE quadro_tarefa_historico VALIDATE CONSTRAINT quadro_tarefa_historico_campo_check;
-- Revisão 8 do PR #630: a coluna lote_id é da 0137, mas só esta migração a lê pelo lote: o Desfazer apaga as linhas
-- 'linear' do lote (apagarLinhasDoLote) e as importadas saem da meta pelo lote da linha 'criada' (importadas).
CREATE INDEX quadro_tarefa_historico_lote ON quadro_tarefa_historico (tenant_id, lote_id) WHERE lote_id IS NOT NULL;

ALTER TABLE quadros ADD COLUMN assumido_em timestamptz;

-- ROLLBACK:
-- -- Antes, apague o que usa os valores novos (delete from quadro_comentarios where autor = 'linear'; delete from
-- -- quadro_tarefa_historico where campo = 'linear'; delete from decisoes where tipo in ('importacao_linear',
-- -- 'assumir_quadro'); delete from propostas where kind in ('importacao_linear', 'assumir_quadro')). O Postgres não
-- -- remove valor de enum: cada tipo é recriado sem os dois valores, com o mesmo nome e a mesma ordem (padrão da 0135).
-- -- Rode o bloco numa transação só (`psql -1 -v ON_ERROR_STOP=1`).
-- -- O 'quadro_exclusao' (0143, NOD-430) e o 'app' (0145, NOD-445) ficam: vieram antes desta migração (ela era a 0144 e
-- -- passou a 0148 no merge com a main) e os CREATE TYPE abaixo os mantêm na posição, logo antes dos dois valores dela.
-- SET LOCAL lock_timeout = '5s';
-- ALTER TABLE quadros DROP COLUMN IF EXISTS assumido_em;
-- DROP INDEX IF EXISTS quadro_tarefa_historico_lote;
-- ALTER TABLE quadro_tarefa_historico DROP CONSTRAINT quadro_tarefa_historico_campo_check;
-- ALTER TABLE quadro_tarefa_historico ADD CONSTRAINT quadro_tarefa_historico_campo_check CHECK (campo IN ('criada', 'status', 'agente', 'quadro', 'restaurada')) NOT VALID;
-- ALTER TABLE quadro_tarefa_historico VALIDATE CONSTRAINT quadro_tarefa_historico_campo_check;
-- DROP INDEX IF EXISTS quadro_comentarios_lote;
-- DROP INDEX IF EXISTS quadro_comentarios_linear;
-- ALTER TABLE quadro_comentarios DROP CONSTRAINT IF EXISTS quadro_comentarios_do_linear;
-- ALTER TABLE quadro_comentarios DROP COLUMN IF EXISTS lote_id;
-- ALTER TABLE quadro_comentarios DROP COLUMN IF EXISTS linear_id;
-- ALTER TABLE quadro_comentarios DROP COLUMN IF EXISTS autor_nome;
-- ALTER TABLE quadro_comentarios DROP CONSTRAINT quadro_comentarios_autor_check;
-- ALTER TABLE quadro_comentarios ADD CONSTRAINT quadro_comentarios_autor_check CHECK (autor IN ('pessoa', 'agente')) NOT VALID;
-- ALTER TABLE quadro_comentarios VALIDATE CONSTRAINT quadro_comentarios_autor_check;
-- DROP INDEX IF EXISTS quadro_importacoes_lote;
-- DROP TABLE IF EXISTS quadro_importacoes;
-- DROP INDEX propostas_acesso_de_rotina_aberta;
-- ALTER TYPE kind_proposta RENAME TO kind_proposta_0148;
-- CREATE TYPE kind_proposta AS ENUM ('perfil', 'rotina', 'acesso', 'pasta', 'rotina_atualizacao', 'rotina_exclusao', 'bot', 'lote_bots', 'credencial', 'colunas_quadro', 'quadro_exclusao', 'app');
-- ALTER TABLE propostas ALTER COLUMN kind TYPE kind_proposta USING kind::text::kind_proposta;
-- DROP TYPE kind_proposta_0148;
-- CREATE UNIQUE INDEX propostas_acesso_de_rotina_aberta
--   ON propostas (tenant_id, owner_id, agente_id, (payload->>'conector'))
--   WHERE kind = 'acesso' AND estado = 'pendente' AND payload ? 'rotinaId';
-- ALTER TYPE tipo_decisao RENAME TO tipo_decisao_0148;
-- CREATE TYPE tipo_decisao AS ENUM ('aprovacao', 'acesso', 'retomar_turno', 'gate_rotina', 'perfil', 'rotina', 'pergunta',
--   'falta_de_dado', 'permissao', 'rotina_atualizacao', 'rotina_exclusao', 'bot', 'lote_bots', 'credencial', 'colunas_quadro', 'quadro_exclusao', 'app');
-- ALTER TABLE decisoes ALTER COLUMN tipo TYPE tipo_decisao USING tipo::text::tipo_decisao;
-- DROP TYPE tipo_decisao_0148;
