-- definido em 2026-11-02 (NOD-443, ADR-143): o quadro com várias pessoas. A dona escolhe como o grupo conversa com o quadro
-- (só ela, cada um na sua conversa, ou uma conversa do grupo) e põe gente do time nele. O quadro, as tarefas, os lotes e o
-- histórico continuam da dona (RLS de dona, sem policy nova): quem participa lê e mexe pelo caso de uso, que confere a
-- participação no escopo dela e de novo no escopo da dona (a porta é a dona). Cada lote e cada tarefa guardam quem pediu
-- (o bot que fez é o autor_agente_id de sempre): é o "Ana, pela Ada" do mural e a base de quem decide uma pendência.
-- Só adição: o servidor antigo não lê as colunas nem as tabelas novas; o padrão do modo é o de hoje para quem não pôs ninguém.
SET LOCAL lock_timeout = '5s';

-- Revisão 8 do PR #628: a conversa do grupo ainda não existe, então o banco não aceita 'grupo' (a etapa que a trouxer
-- amplia o CHECK numa migração nova).
ALTER TABLE quadros ADD COLUMN modo_conversa text NOT NULL DEFAULT 'individual'
  CHECK (modo_conversa IN ('so_dono', 'individual'));
-- Revisão 4 do PR #628 (achado 4): o NULL de pedido_por, tabela por tabela. Em quadro_lotes, NULL = ninguém pediu em nome
-- próprio: um lote de antes da 0146, o do turno que o próprio quadro abriu (o bot com a tarefa, sem pessoa na conversa)
-- ou o do bot da dona sob a procuração de quem participa (porProcuracao: segue as regras dela, mas não pede em nome dela).
-- O Desfazer e o mural leem NULL como da dona. A coluna nasceu na 0143 (NOD-430, a dona que pediu pelo bot); aqui ela
-- passa a guardar também quem participa. IF NOT EXISTS porque a 0143 já a criou (e o ROLLBACK daqui não a apaga).
ALTER TABLE quadro_lotes ADD COLUMN IF NOT EXISTS pedido_por uuid;
-- O nome do bot pelo qual a pessoa pediu, no momento ("Ana, pela Ada"): o bot de quem participa é dela, e o escopo da
-- dona não o lê.
ALTER TABLE quadro_lotes ADD COLUMN via_nome text CHECK (length(via_nome) <= 200);
-- Em quadro_tarefas, NULL = a tarefa nasceu antes da 0146, num turno que o quadro abriu ou sob a procuração de quem
-- participa (os mesmos casos do lote). Quem decide a pendência (quemDecide) lê NULL como a dona.
ALTER TABLE quadro_tarefas ADD COLUMN pedido_por uuid;
-- Revisão 3 do PR #628 (achado 6): pedido_por fica SEM chave estrangeira para pessoas, nas três tabelas, de propósito.
-- Na maior parte das linhas quem pediu é a própria dona (a tela e a conversa dela), e o owner_id das tabelas escopadas
-- (nod_escopar_tabela) também não tem chave para pessoas: o banco de teste não tem seed (Práticas §6) e as pessoas dos
-- testes são só um escopo. O produto não exclui pessoa (não há caminho que apague a linha de pessoas), e quem sai do
-- quadro sai por quadro_membros (CASCADE abaixo): a pendência de quem não está mais na lista volta à dona pelo caso de
-- uso (quemDecide), não pelo banco. O valor nunca vem do pedido: é o escopo de quem pediu, conferido na porta.
-- Revisão 3 (achado 5): a chave que deixa o comentário apontar a tarefa E o quadro dela juntos (abaixo).
CREATE UNIQUE INDEX quadro_tarefas_do_quadro_e_id ON quadro_tarefas (tenant_id, quadro_id, id);

-- Quem participa do quadro. A linha é da dona; a perna extra deixa a própria pessoa ler a SUA participação (e só ela):
-- é por aqui que a pessoa acha os quadros em que está, sem ler nada do quadro direto.
CREATE TABLE quadro_membros (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  quadro_id uuid NOT NULL,
  pessoa_id uuid NOT NULL,
  adicionado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('quadro_membros', $p$quadro_membros.pessoa_id = current_setting('nod.pessoa_id')::uuid$p$);
ALTER TABLE quadro_membros ADD PRIMARY KEY (tenant_id, id);
-- A dona não participa do próprio quadro: ela já é a dona.
ALTER TABLE quadro_membros ADD CONSTRAINT quadro_membros_nao_a_dona CHECK (pessoa_id <> owner_id);
ALTER TABLE quadro_membros ADD FOREIGN KEY (tenant_id, quadro_id) REFERENCES quadros (tenant_id, id) ON DELETE CASCADE;
ALTER TABLE quadro_membros ADD FOREIGN KEY (tenant_id, pessoa_id) REFERENCES pessoas (tenant_id, id) ON DELETE CASCADE;
CREATE UNIQUE INDEX quadro_membros_unico ON quadro_membros (tenant_id, quadro_id, pessoa_id);
CREATE INDEX quadro_membros_da_pessoa ON quadro_membros (tenant_id, pessoa_id);

-- D7: no modo "só a dona", o pedido de quem participa (por qualquer bot) vira um comentário na tarefa, para a dona.
CREATE TABLE quadro_tarefa_comentarios (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  quadro_id uuid NOT NULL,
  tarefa_id uuid,
  texto text NOT NULL CHECK (length(texto) BETWEEN 1 AND 4000), -- o mesmo teto da 0138 (LIMITES_QUADRO.comentario)
  -- Revisão 3 do PR #628 (pós-merge, achado 4): nulo = o bot da dona escreveu sob a procuração de quem participa. Não é
  -- pedido de ninguém (nem dela, nem da dona): assina só o bot (via_nome) e conta no teto do bot (via_agente_id). Aqui,
  -- diferente do lote e da tarefa, NULL não quer dizer a dona: a dona e quem participa sempre gravam o próprio id.
  pedido_por uuid,
  via_agente_id uuid,
  via_nome text CHECK (length(via_nome) <= 200),
  -- Escrito num turno não confiável ou por quem participa: conteúdo de fora para os bots da dona (como quadro_tarefas.de_fora).
  de_fora boolean NOT NULL DEFAULT false,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('quadro_tarefa_comentarios');
ALTER TABLE quadro_tarefa_comentarios ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE quadro_tarefa_comentarios ADD FOREIGN KEY (tenant_id, quadro_id) REFERENCES quadros (tenant_id, id) ON DELETE CASCADE;
-- O comentário sai com a tarefa (o comentário do quadro, sem tarefa, fica). Revisão 3 (achado 5): a tarefa é deste quadro
-- (a chave inclui o quadro_id), e mover a tarefa de quadro leva o comentário junto (ON UPDATE CASCADE). Sem tarefa, a
-- chave não é conferida (MATCH SIMPLE) e vale só a do quadro.
ALTER TABLE quadro_tarefa_comentarios ADD FOREIGN KEY (tenant_id, quadro_id, tarefa_id) REFERENCES quadro_tarefas (tenant_id, quadro_id, id) ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX quadro_tarefa_comentarios_do_quadro ON quadro_tarefa_comentarios (tenant_id, quadro_id, criado_em);
CREATE INDEX quadro_tarefa_comentarios_da_tarefa ON quadro_tarefa_comentarios (tenant_id, tarefa_id, pedido_por);
-- Revisão 4 do PR #628 (achado 4): o teto do bot (contarComentarios com pedido_por NULL) conta por via_agente_id; o índice
-- de cima só serve à pessoa. Parcial: só as linhas sem pessoa, que são as do bot sob a procuração.
CREATE INDEX quadro_tarefa_comentarios_do_bot ON quadro_tarefa_comentarios (tenant_id, tarefa_id, via_agente_id) WHERE pedido_por IS NULL;

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- DROP INDEX IF EXISTS quadro_tarefa_comentarios_do_bot;
-- DROP TABLE IF EXISTS quadro_tarefa_comentarios;
-- DROP TABLE IF EXISTS quadro_membros;
-- DROP INDEX IF EXISTS quadro_tarefas_do_quadro_e_id;
-- ALTER TABLE quadro_tarefas DROP COLUMN pedido_por;
-- ALTER TABLE quadro_lotes DROP COLUMN via_nome;
-- ALTER TABLE quadros DROP COLUMN modo_conversa;
