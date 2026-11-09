-- definido em 2026-10-22 (NOD-315, ADR-119): a frente guarda o `dono/nome` do GitHub que o `abrir_frentes` deu, para o
-- executor preparar o clone da máquina (~/nod/.clones/<dono>/<nome>.git) antes do turno. Null = sem repo válido: a frente
-- roda como antes. Só adição (expand-only): coluna nula, sem default; o código anterior não lê a coluna.
SET LOCAL lock_timeout = '5s';

ALTER TABLE trabalhos ADD COLUMN repo text;
ALTER TABLE trabalhos ADD CONSTRAINT trabalho_repo CHECK (repo IS NULL OR char_length(repo) BETWEEN 3 AND 200);

-- ROLLBACK:
-- ALTER TABLE trabalhos DROP CONSTRAINT trabalho_repo;
-- ALTER TABLE trabalhos DROP COLUMN repo;
