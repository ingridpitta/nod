-- definido em 2026-11-02 (NOD-416, ADR-144): a tarefa ganha um código por quadro (prefixo do quadro + número, ex.: ZE-12),
-- estável, que vira o link (`?tarefa=ZE-12`) e o branch sugerido. Ao mudar de quadro ela ganha o código do destino e o
-- antigo continua abrindo a tarefa: todo código que ela já teve mora em `quadro_tarefa_codigos`. O histórico registra
-- status, responsável e quadro, com horário e autor (pessoa, agente ou regra).
-- Prefixo: as 3 primeiras letras do nome do bot anfitrião, sem acento, em maiúsculas (vazio vira Q); colisão no mesmo dono
-- ganha 2, 3… (a mesma regra de `prefixoDoNome`, em src/domain/codigo-tarefa.ts). `prefixo` e `numero` ficam nuláveis: o
-- servidor de antes, no ar durante o deploy, cria quadro e tarefa sem eles; o novo completa no próximo lote.
-- Só adição: o servidor antigo não lê as colunas nem as tabelas novas.
SET LOCAL lock_timeout = '5s';

ALTER TABLE quadros ADD COLUMN prefixo text CHECK (prefixo ~ '^[A-Z]{1,3}[0-9]*$');
ALTER TABLE quadros ADD COLUMN proximo_numero integer NOT NULL DEFAULT 1;
ALTER TABLE quadro_tarefas ADD COLUMN numero integer;

WITH base AS (
  SELECT q.tenant_id, q.id, q.owner_id, q.criado_em,
         coalesce(nullif(upper(left(regexp_replace(
           translate(coalesce(a.nome, ''), 'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
                                           'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN'),
           '[^A-Za-z]', '', 'g'), 3)), ''), 'Q') AS raiz
    FROM quadros q LEFT JOIN agentes a ON a.tenant_id = q.tenant_id AND a.id = q.agente_id
), numerados AS (
  SELECT tenant_id, id, raiz,
         row_number() OVER (PARTITION BY tenant_id, owner_id, raiz ORDER BY criado_em, id) AS n
    FROM base
)
UPDATE quadros q SET prefixo = CASE WHEN n.n = 1 THEN n.raiz ELSE n.raiz || n.n END
  FROM numerados n WHERE q.tenant_id = n.tenant_id AND q.id = n.id;
CREATE UNIQUE INDEX quadros_prefixo ON quadros (tenant_id, owner_id, prefixo) WHERE prefixo IS NOT NULL;

UPDATE quadro_tarefas t SET numero = n.n
  FROM (SELECT tenant_id, id, row_number() OVER (PARTITION BY tenant_id, quadro_id ORDER BY ordem, criado_em, id) AS n
          FROM quadro_tarefas) n
 WHERE t.tenant_id = n.tenant_id AND t.id = n.id;
UPDATE quadros q SET proximo_numero = coalesce((SELECT max(t.numero) FROM quadro_tarefas t
                                                 WHERE t.tenant_id = q.tenant_id AND t.quadro_id = q.id), 0) + 1;
CREATE UNIQUE INDEX quadro_tarefas_numero ON quadro_tarefas (tenant_id, quadro_id, numero) WHERE numero IS NOT NULL;

-- Todo código que a tarefa já teve (o atual também): o link velho resolve depois de mudar de quadro. Sem FK para a
-- tarefa: o Desfazer de uma exclusão devolve o mesmo id. Ao remover o quadro, os códigos dele FICAM (revisão 5 do PR
-- #623): reservam o prefixo e o número, e o link velho dá "não encontrada" em vez de abrir a tarefa de um quadro novo.
CREATE TABLE quadro_tarefa_codigos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  prefixo text NOT NULL,
  numero integer NOT NULL CHECK (numero > 0),
  tarefa_id uuid NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('quadro_tarefa_codigos');
ALTER TABLE quadro_tarefa_codigos ADD PRIMARY KEY (tenant_id, id);
CREATE UNIQUE INDEX quadro_tarefa_codigos_unico ON quadro_tarefa_codigos (tenant_id, owner_id, prefixo, numero);
CREATE INDEX quadro_tarefa_codigos_da_tarefa ON quadro_tarefa_codigos (tenant_id, tarefa_id);
INSERT INTO quadro_tarefa_codigos (tenant_id, owner_id, prefixo, numero, tarefa_id)
SELECT t.tenant_id, t.owner_id, q.prefixo, t.numero, t.id
  FROM quadro_tarefas t JOIN quadros q ON q.tenant_id = t.tenant_id AND q.id = t.quadro_id
 WHERE t.numero IS NOT NULL AND q.prefixo IS NOT NULL;

-- O histórico da tarefa: uma linha por mudança. `de`/`para` são o id da coluna (status), do bot (agente, '' = ninguém) ou
-- do quadro; `restaurada` = o Desfazer devolveu a tarefa excluída. `regra` = o motor (cair para a espera, Fazendo ao
-- começar, coluna que saiu, o grupo no quadro de destino).
CREATE TABLE quadro_tarefa_historico (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tarefa_id uuid NOT NULL,
  quadro_id uuid NOT NULL,
  campo text NOT NULL CHECK (campo IN ('criada', 'status', 'agente', 'quadro', 'restaurada')),
  de text,
  para text,
  autor text NOT NULL CHECK (autor IN ('pessoa', 'agente', 'regra')),
  autor_agente_id uuid,
  lote_id uuid,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT quadro_tarefa_historico_autor CHECK (autor <> 'agente' OR autor_agente_id IS NOT NULL)
);
SELECT nod_escopar_tabela('quadro_tarefa_historico');
ALTER TABLE quadro_tarefa_historico ADD PRIMARY KEY (tenant_id, id);
CREATE INDEX quadro_tarefa_historico_da_tarefa ON quadro_tarefa_historico (tenant_id, tarefa_id, criado_em);
-- Revisão 3 do PR #623: `mudouDeQuadroDepois` (montarQuadro e Desfazer) procura a tarefa que entrou no quadro (quadro_id) ou
-- saiu dele (de) depois do lote; sem estes dois índices a busca varria o histórico inteiro da pessoa. Revisão 4: a consulta
-- tem um `exists` por índice (um OR num só não combinava os dois) e os índices levam a dona, como os outros filtros por dono.
CREATE INDEX quadro_tarefa_historico_entrou ON quadro_tarefa_historico (tenant_id, owner_id, quadro_id, criado_em) WHERE campo = 'quadro';
CREATE INDEX quadro_tarefa_historico_saiu ON quadro_tarefa_historico (tenant_id, owner_id, de, criado_em) WHERE campo = 'quadro';

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- DROP INDEX IF EXISTS quadro_tarefa_historico_saiu;
-- DROP INDEX IF EXISTS quadro_tarefa_historico_entrou;
-- DROP TABLE IF EXISTS quadro_tarefa_historico;
-- DROP TABLE IF EXISTS quadro_tarefa_codigos;
-- DROP INDEX IF EXISTS quadro_tarefas_numero;
-- DROP INDEX IF EXISTS quadros_prefixo;
-- ALTER TABLE quadro_tarefas DROP COLUMN numero;
-- ALTER TABLE quadros DROP COLUMN proximo_numero;
-- ALTER TABLE quadros DROP COLUMN prefixo;
