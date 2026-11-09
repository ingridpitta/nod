-- definido em 2026-10-22 (NOD-96 PR1, ADR-122 "O computador da pessoa roda no motor"): um computador por pessoa,
-- numa máquina dela pelo motor, com uma tela (e um Chrome) por bot e os logins em comum.
-- 1) computadores ganha o modelo ('por_bot' é o de hoje, docker por bot; 'por_pessoa' é o do motor), a máquina
--    (contrato da NOD-94: nula = "onde o nod roda"), a hospedeira, a chave X25519 do supervisor (TOFU), a operação em
--    curso (Atualizar, Redefinir, Sair de todos os sites) e o arquivamento do legado.
-- 2) Desvio do plano (registrado na ADR-122): o índice único (tenant, owner) vale só para o modelo 'por_pessoa'. Sem o
--    discriminador ele quebraria a flag desligada (o modo docker cria uma linha por bot da mesma pessoa) e o deploy
--    falharia em quem já tem dois bots com computador.
-- 3) agentes.computador_id deixa de ser único: vários bots da pessoa apontam para o mesmo computador.
-- 4) computador_telas: uma tela por bot no computador da pessoa, com a fila de espera da régua (ADR-085/097).
-- 5) computador_acoes ganha o bot (nulo = a pessoa) e a tela; o índice novo serve a Atividade por bot.
-- 6) Motivos de falha novos do motor. Os valores novos não são usados nesta transação.
-- Só adição (expand-only): colunas nulas ou com default, tabela nova, enum novo e drop de UNIQUE; o código anterior
-- não lê nada disso e, com NOD_COMPUTADORES diferente de 'motor', nenhuma linha 'por_pessoa' nasce.
SET LOCAL lock_timeout = '5s';

ALTER TYPE motivo_falha_computador ADD VALUE IF NOT EXISTS 'maquina_sem_contato';
ALTER TYPE motivo_falha_computador ADD VALUE IF NOT EXISTS 'faltam_pacotes';
ALTER TYPE motivo_falha_computador ADD VALUE IF NOT EXISTS 'sem_suporte';
ALTER TYPE motivo_falha_computador ADD VALUE IF NOT EXISTS 'nao_ficou_pronto';
ALTER TYPE motivo_falha_computador ADD VALUE IF NOT EXISTS 'atualizando';

CREATE TYPE estado_tela_computador AS ENUM ('fechada', 'esperando', 'abrindo', 'aberta', 'fechando');
CREATE TYPE operacao_computador AS ENUM ('atualizar', 'redefinir', 'sair_de_todos');

ALTER TABLE computadores
  ADD COLUMN modelo text NOT NULL DEFAULT 'por_bot'
    CONSTRAINT computadores_modelo CHECK (modelo IN ('por_bot', 'por_pessoa')),
  ADD COLUMN maquina_id uuid,
  ADD COLUMN hospedeira_id uuid,
  -- Chave pública X25519 do supervisor, gravada no primeiro contato (TOFU) e trocada só pelo Redefinir.
  ADD COLUMN supervisor_pub bytea
    CONSTRAINT computadores_supervisor_pub CHECK (octet_length(supervisor_pub) = 32),
  ADD COLUMN operacao operacao_computador,
  ADD COLUMN operacao_progresso smallint,
  ADD COLUMN operacao_etapa text
    CONSTRAINT computadores_operacao_etapa CHECK (char_length(operacao_etapa) <= 80),
  ADD COLUMN operacao_desde timestamptz,
  -- O computador por bot do legado é arquivado quando a pessoa passa ao motor; o do motor nasce do zero.
  ADD COLUMN arquivado_em timestamptz;
ALTER TABLE computadores ADD CONSTRAINT computadores_operacao CHECK (
  (operacao IS NULL) = (operacao_desde IS NULL)
  AND (operacao IS NOT NULL OR (operacao_progresso IS NULL AND operacao_etapa IS NULL))
  AND (operacao_progresso IS NULL OR operacao_progresso BETWEEN 0 AND 100)
);
ALTER TABLE computadores ADD CONSTRAINT computadores_maquina_id_fkey
  FOREIGN KEY (tenant_id, maquina_id) REFERENCES maquina_tokens (tenant_id, id) ON DELETE SET NULL (maquina_id);
ALTER TABLE computadores ADD CONSTRAINT computadores_hospedeira_id_fkey
  FOREIGN KEY (tenant_id, hospedeira_id) REFERENCES maquina_tokens (tenant_id, id) ON DELETE SET NULL (hospedeira_id);
-- Um computador vivo por pessoa no motor.
CREATE UNIQUE INDEX computadores_um_por_pessoa ON computadores (tenant_id, owner_id)
  WHERE arquivado_em IS NULL AND modelo = 'por_pessoa';

ALTER TABLE agentes DROP CONSTRAINT agentes_tenant_id_computador_id_key;

CREATE TABLE computador_telas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  computador_id uuid NOT NULL,
  agente_id uuid NOT NULL,
  estado estado_tela_computador NOT NULL DEFAULT 'fechada',
  -- Quando entrou na fila da régua; a fila sai pela ordem de chegada.
  esperando_desde timestamptz,
  controle text NOT NULL DEFAULT 'bot'
    CONSTRAINT computador_telas_controle CHECK (controle IN ('bot', 'pessoa', 'aguardando_pessoa')),
  politica text NOT NULL DEFAULT 'supervisionado'
    CONSTRAINT computador_telas_politica CHECK (politica IN ('supervisionado', 'autonomo')),
  ajuda text,
  ajuda_decisao_id uuid,
  operacao_id uuid,
  ocupado_ate timestamptz,
  ultima_atividade_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- Medida pelo supervisor (RSS do Chrome da tela); a régua usa a estimativa da ADR-122 até haver medida.
  memoria_mb integer CONSTRAINT computador_telas_memoria_mb CHECK (memoria_mb >= 0),
  falha_motivo motivo_falha_computador,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT computador_telas_fila CHECK ((estado = 'esperando') = (esperando_desde IS NOT NULL))
);
SELECT nod_escopar_tabela('computador_telas');
ALTER TABLE computador_telas ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE computador_telas ADD CHECK (visibility = 'privado');
ALTER TABLE computador_telas ADD FOREIGN KEY (tenant_id, computador_id) REFERENCES computadores (tenant_id, id);
ALTER TABLE computador_telas ADD FOREIGN KEY (tenant_id, agente_id) REFERENCES agentes (tenant_id, id) ON DELETE CASCADE;
ALTER TABLE computador_telas ADD CONSTRAINT computador_telas_uma_por_bot UNIQUE (tenant_id, computador_id, agente_id);
-- A fila da régua: as telas esperando, da mais antiga para a mais nova.
CREATE INDEX computador_telas_fila_idx ON computador_telas (tenant_id, esperando_desde) WHERE estado = 'esperando';

ALTER TABLE computador_acoes
  ADD COLUMN agente_id uuid,
  ADD COLUMN tela_id uuid;
ALTER TABLE computador_acoes ADD CONSTRAINT computador_acoes_agente_id_fkey
  FOREIGN KEY (tenant_id, agente_id) REFERENCES agentes (tenant_id, id) ON DELETE SET NULL (agente_id);
ALTER TABLE computador_acoes ADD CONSTRAINT computador_acoes_tela_id_fkey
  FOREIGN KEY (tenant_id, tela_id) REFERENCES computador_telas (tenant_id, id) ON DELETE SET NULL (tela_id);
CREATE INDEX computador_acoes_por_bot ON computador_acoes (tenant_id, computador_id, agente_id, em DESC);

-- ROLLBACK:
-- -- Desligue NOD_COMPUTADORES=motor antes. O Postgres não remove valor de enum: o rollback recria
-- -- motivo_falha_computador sem os 5 valores novos (NOD-195), com o mesmo nome e a mesma ordem. Antes, limpe as linhas
-- -- que usam um valor novo (`update computador_acoes set motivo = 'acao_falhou' where motivo::text in
-- -- ('maquina_sem_contato','faltam_pacotes','sem_suporte','nao_ficou_pronto','atualizando')`, e em computadores troque
-- -- falha_motivo por 'nao_iniciou'). O UNIQUE de agentes volta só se nenhum computador tiver dois bots: apague antes os
-- -- computadores 'por_pessoa' (`update agentes set computador_id = null where computador_id in (select id from
-- -- computadores where modelo = 'por_pessoa')`; depois, nesta ordem, apague as telas deles, que referenciam
-- -- computadores sem ON DELETE (`delete from computador_telas where computador_id in (select id from computadores
-- -- where modelo = 'por_pessoa')`), as ações deles e, por último, os computadores deles). Com alguma linha
-- -- sobrando, o cast ou o UNIQUE falha e a transação inteira volta. Rode o bloco numa transação só
-- -- (`psql -1 -v ON_ERROR_STOP=1`). Nenhum índice, default ou função cita motivo_falha_computador.
-- DROP INDEX computador_acoes_por_bot;
-- ALTER TABLE computador_acoes DROP CONSTRAINT computador_acoes_tela_id_fkey;
-- ALTER TABLE computador_acoes DROP CONSTRAINT computador_acoes_agente_id_fkey;
-- ALTER TABLE computador_acoes DROP COLUMN tela_id, DROP COLUMN agente_id;
-- DROP TABLE computador_telas;
-- ALTER TABLE agentes ADD CONSTRAINT agentes_tenant_id_computador_id_key UNIQUE (tenant_id, computador_id);
-- DROP INDEX computadores_um_por_pessoa;
-- ALTER TABLE computadores DROP CONSTRAINT computadores_hospedeira_id_fkey;
-- ALTER TABLE computadores DROP CONSTRAINT computadores_maquina_id_fkey;
-- ALTER TABLE computadores DROP CONSTRAINT computadores_operacao;
-- ALTER TABLE computadores DROP COLUMN arquivado_em, DROP COLUMN operacao_desde, DROP COLUMN operacao_etapa,
--   DROP COLUMN operacao_progresso, DROP COLUMN operacao, DROP COLUMN supervisor_pub, DROP COLUMN hospedeira_id,
--   DROP COLUMN maquina_id, DROP COLUMN modelo;
-- DROP TYPE operacao_computador;
-- DROP TYPE estado_tela_computador;
-- ALTER TYPE motivo_falha_computador RENAME TO motivo_falha_computador_0106;
-- CREATE TYPE motivo_falha_computador AS ENUM ('docker_indisponivel', 'imagem_ausente', 'nao_iniciou', 'cofre_invalido',
--   'navegador_nao_abriu', 'sem_resposta', 'acao_falhou', 'tela_alterada', 'ocupado', 'limite_de_computadores');
-- ALTER TABLE computador_acoes ALTER COLUMN motivo TYPE motivo_falha_computador USING motivo::text::motivo_falha_computador;
-- ALTER TABLE computadores ALTER COLUMN falha_motivo TYPE motivo_falha_computador
--   USING falha_motivo::text::motivo_falha_computador;
-- DROP TYPE motivo_falha_computador_0106;
