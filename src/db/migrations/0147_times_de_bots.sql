-- definido em 2026-11-02 (NOD-437): o time de bots vira uma entidade da pessoa (nome, posição, recolhido). Quem está em
-- cada time continua em agentes.secao (o nome do time), para o servidor de antes seguir lendo e gravando igual: o time
-- casa com os bots pela chave do nome (sem caixa, sem acento, espaços colapsados; src/domain/times.ts). A linha de chave
-- '' é o "Sem time" (só guarda a posição e o recolhido dele). As seções que já existem viram times na primeira leitura
-- (sincronizarTimes, src/use-cases/acoes/times.ts), sem reescrever agentes: a chave é calculada no TypeScript, o único
-- lugar que a calcula.
-- Só adição: o servidor antigo no ar não lê nem escreve esta tabela.
SET LOCAL lock_timeout = '5s';

CREATE TABLE times (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  nome text NOT NULL CHECK (length(nome) <= 60),
  nome_chave text NOT NULL CHECK (length(nome_chave) <= 60),
  posicao integer NOT NULL DEFAULT 0 CHECK (posicao >= 0),
  recolhido boolean NOT NULL DEFAULT false,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((nome = '') = (nome_chave = ''))
);
SELECT nod_escopar_tabela('times');
ALTER TABLE times ADD PRIMARY KEY (tenant_id, id);
-- Um time por nome (pela chave) por pessoa; também é o índice da leitura da lista (owner_id) e do Sem time (chave '').
CREATE UNIQUE INDEX times_um_por_nome ON times (tenant_id, owner_id, nome_chave);

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- -- Pare o servidor novo antes: o de antes agrupa só por agentes.secao, que fica intacta; perdem-se a ordem, o recolhido
-- -- e os times vazios. O índice sai junto com a tabela.
-- DROP TABLE times;
