-- definido em 2026-09-18: o agente descobre a pasta do projeto e propõe na conversa; a pessoa
-- autoriza em um clique. A proposta de pasta é um kind próprio — não é acesso a conector: não tem
-- conector, capacidades nem nível, e se autoriza pela rota de workspace, não por decisão.
ALTER TYPE kind_proposta ADD VALUE IF NOT EXISTS 'pasta';
-- ROLLBACK: não há DROP VALUE em enum do Postgres. Para reverter, recrie o tipo sem 'pasta' depois
-- de apagar as propostas desse kind: DELETE FROM propostas WHERE kind = 'pasta'; e então recrie o
-- enum e reaplique a coluna. Rollback só é seguro enquanto nenhuma proposta de pasta foi gravada.
