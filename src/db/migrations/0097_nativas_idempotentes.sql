-- definido em 2026-10-20 (NOD-293 E7, revisão do PR 424): o hook repete o POST /interno/nativas quando a conexão cai
-- (ECONNREFUSED/ECONNRESET). Se o servidor já tinha commitado e só a resposta se perdeu, a repetição duplicaria a
-- decisão de aprovação, o item, o evento e a trilha. O hook manda uma chave por tentativa lógica (a mesma nas
-- repetições); o servidor guarda a resposta na MESMA transação do efeito e, no reenvio, devolve a resposta guardada
-- sem refazer nada. A trava (advisory lock da transação) serializa dois reenvios que chegam antes de existir a linha.
--
-- A chave só importa durante a chamada do hook (minutos): o varredor de expiração poda as linhas com mais de 1 dia.
-- Só adição (expand-only): o servidor anterior não lê nem escreve a tabela e o hook novo segue funcionando com ele (o
-- cabeçalho é ignorado; volta o risco de duplicar no reenvio, como antes deste PR).
SET LOCAL lock_timeout = '5s';

CREATE TABLE nativas_idempotencia (
  turno_id uuid NOT NULL,
  chave uuid NOT NULL,
  resposta jsonb NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('nativas_idempotencia');
ALTER TABLE nativas_idempotencia ADD PRIMARY KEY (tenant_id, owner_id, turno_id, chave);
ALTER TABLE nativas_idempotencia ADD FOREIGN KEY (tenant_id, turno_id) REFERENCES turnos (tenant_id, id);
-- A poda de 1 dia pela dona (varredor de expiração).
CREATE INDEX nativas_idempotencia_por_dona ON nativas_idempotencia (tenant_id, owner_id, criado_em);

-- ROLLBACK:
-- -- O código anterior não lê a tabela: voltar a imagem basta. Para reverter o banco, rode o bloco numa transação só
-- -- (`psql -1 -v ON_ERROR_STOP=1`); só se perdem as chaves de idempotência (dado de minutos, sem valor depois).
-- DROP TABLE nativas_idempotencia;
