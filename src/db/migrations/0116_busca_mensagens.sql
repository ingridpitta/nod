-- definido em 2026-10-28 (NOD-380): a busca de mensagens do celular (`GET /busca/mensagens`) acha um pedaço de palavra
-- ("desig" acha "design") ignorando acento e caixa. Por pedaço, e não por radical, por isso `like` e não o tsvector da
-- ADR-008 (que é da busca de documentos por palavra inteira); a emenda está na ADR-008.
--
-- Só adição: o código anterior não lê nada daqui. A busca roda como nod_app, sob a RLS de `mensagens` e `conversas` que já
-- existe (dona, 'equipe' e a perna da sala, ADR-027): nenhuma policy nova.
--
-- SEM índice de texto, de propósito (revisão do PR #551; medido em 2026-10-28 no Postgres 17.11 com o EXPLAIN do nod_app
-- sobre uma base de teste com um GIN trigram criado à mão: o índice não entrou no plano): `mensagens` tem RLS com FORCE, e sob RLS o
-- planner só usa como condição de índice um filtro LEAKPROOF; o `like` (textlike) e esta função não são, então um GIN trigram
-- sobre `nod_sem_acento(texto)` nunca entra no plano do nod_app (vira Filter depois da policy). Marcar LEAKPROOF exige
-- superusuário, que o Cloud SQL não dá, e uma função SECURITY DEFINER não escapa do FORCE. O índice só custaria a trava da
-- construção e cada insert. A busca varre as mensagens do tenant (a policy já usa o btree do tenant), com statement_timeout
-- de 4 s na consulta; o gatilho de revisão está na emenda da ADR-008.
--
-- O unaccent de um argumento é STABLE (acha o dicionário pelo search_path); `nod_sem_acento` fixa o dicionário pelo nome
-- qualificado, então o resultado só depende do texto e ela é declarada IMMUTABLE (é o mesmo padrão usado com unaccent em
-- expressões de índice). Não há índice que a use hoje; ela só centraliza a normalização da consulta.
CREATE FUNCTION nod_sem_acento(texto text)
RETURNS text
LANGUAGE sql
IMMUTABLE STRICT PARALLEL SAFE
AS $$ SELECT lower(public.unaccent('public.unaccent'::regdictionary, texto)) $$;

-- ROLLBACK:
-- DROP FUNCTION IF EXISTS nod_sem_acento(text);
