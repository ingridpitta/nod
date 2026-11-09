-- definido em 2026-11-02 (NOD-421): o PR na tarefa e as linhas de sistema dela. O laço de fundo lê os PRs do GitHub
-- (src/adapters/fundo/prs-do-quadro.ts) e casa cada um com a tarefa pelo id no branch ou pelo pr_url que o agente gravou.
-- quadro_tarefa_prs guarda o último estado visto de cada PR ligado (só a transição gera linha). quadro_tarefa_linhas são as
-- linhas de sistema da tarefa (CI, conflito, merge): um lugar próprio e mínimo até o histórico da tarefa da NOD-416 chegar
-- à main; quando chegar, o histórico passa a ler daqui (ou copia daqui, com autor GitHub) e esta tabela pode sair.
-- quadro_tarefas.pr_url continua sendo o PR do card e do resumo da meta (compatível com o servidor de antes).
-- Só adição: o servidor antigo no ar não lê nem escreve estas tabelas (nem a coluna nova de quadros).
SET LOCAL lock_timeout = '5s';

CREATE TABLE quadro_tarefa_prs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  quadro_id uuid NOT NULL,
  tarefa_id uuid NOT NULL,
  repo text NOT NULL CHECK (repo ~ '^[A-Za-z0-9-]{1,39}/[A-Za-z0-9_.-]{1,100}$'),
  numero integer NOT NULL CHECK (numero > 0),
  url text NOT NULL CHECK (length(url) <= 300),
  branch text NOT NULL DEFAULT '' CHECK (length(branch) <= 300),
  estado text NOT NULL CHECK (estado IN ('aberto', 'mergeado', 'fechado')),
  ci text CHECK (ci IS NULL OR ci IN ('pendente', 'ok', 'falhou')),
  conflito boolean NOT NULL DEFAULT false,
  -- 4ª revisão do PR #621: um merge da tarefa que ainda não teve desfecho porque havia outro PR aberto. Só com ele o
  -- fechamento sem merge de outro PR leva a tarefa a Feito (o merge que já moveu ou já "ficou em" não conta de novo).
  -- Vale para a tarefa: o caso de uso grava o mesmo valor em todos os PRs dela.
  merge_pendente boolean NOT NULL DEFAULT false,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  visto_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('quadro_tarefa_prs');
ALTER TABLE quadro_tarefa_prs ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE quadro_tarefa_prs ADD FOREIGN KEY (tenant_id, tarefa_id) REFERENCES quadro_tarefas (tenant_id, id) ON DELETE CASCADE;
-- O mesmo PR não liga duas vezes na mesma tarefa (o laço faz upsert por esta chave). Também é o índice da leitura por
-- tarefa (prsDoQuadro lê `tarefa_id in (…)`) e da cascata da FK: começa por (tenant_id, tarefa_id), sem um segundo índice.
-- 3ª revisão do PR #621: sem índice por quadro_id. Nenhuma leitura filtra por ele (as duas leem pela tarefa) e não há FK
-- em quadro_id para a cascata usar.
CREATE UNIQUE INDEX quadro_tarefa_prs_unico ON quadro_tarefa_prs (tenant_id, tarefa_id, repo, numero);

CREATE TABLE quadro_tarefa_linhas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  quadro_id uuid NOT NULL,
  tarefa_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo ~ '^[a-z_]{1,40}$'),
  texto text NOT NULL CHECK (length(texto) BETWEEN 1 AND 300),
  dados jsonb NOT NULL DEFAULT '{}'::jsonb,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('quadro_tarefa_linhas');
ALTER TABLE quadro_tarefa_linhas ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE quadro_tarefa_linhas ADD FOREIGN KEY (tenant_id, tarefa_id) REFERENCES quadro_tarefas (tenant_id, id) ON DELETE CASCADE;
-- 2ª revisão do PR #621: linhasDoQuadro lê por tarefa (`tarefa_id in (…)`, as N mais recentes de cada) e a cascata da FK
-- apaga por tarefa. criado_em no fim serve o "mais recentes" da janela. É o único índice desta tabela além da PK.
CREATE INDEX quadro_tarefa_linhas_da_tarefa ON quadro_tarefa_linhas (tenant_id, tarefa_id, criado_em);

-- Revisão do PR #621: o aviso do GitHub no topo do quadro ("GitHub não conectado no servidor: os PRs não sincronizam",
-- "GitHub · sem acesso a dono/repo"). O laço só grava quando muda: uma vez por quadro até mudar. Nulo = nada a avisar.
ALTER TABLE quadros ADD COLUMN aviso_github text CHECK (aviso_github IS NULL OR length(aviso_github) BETWEEN 1 AND 300);

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- ALTER TABLE quadros DROP COLUMN aviso_github;
-- -- Pare o servidor novo antes: o de antes não lê estas tabelas, então só se perdem os PRs extras e as linhas de sistema
-- -- (o pr_url da tarefa fica).
-- -- Os índices (quadro_tarefa_prs_unico e quadro_tarefa_linhas_da_tarefa) saem junto com as tabelas.
-- DROP TABLE quadro_tarefa_linhas;
-- DROP TABLE quadro_tarefa_prs;
