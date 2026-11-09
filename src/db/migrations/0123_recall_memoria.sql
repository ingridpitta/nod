-- NOD-60 (ADR-136): recall de memória por busca léxica, sem modelo. A cada turno de texto de um bot cuja memória não
-- cabe inteira, o servidor procura as que casam com a mensagem (ou a instrução da rotina) e as junta ao núcleo fixo
-- (preferências + recentes). A coluna gerada segue o padrão de agentes.search_tsv (0002, configuração nod_pt).
-- Sem GIN: sob a RLS com FORCE o `@@` (ts_match_vq) não é LEAKPROOF e não vira condição de índice (ADR-008, emenda
-- NOD-380); a busca vai por agente_memorias_por_agente e filtra a coluna já calculada. O ADD COLUMN gerado reescreve
-- a tabela sob ACCESS EXCLUSIVE; lock_timeout de 5 s (padrão da 0115): sem a trava, a migração falha e o deploy para,
-- em vez de enfileirar os turnos atrás dela. A versão anterior não lê a coluna (azul/verde seguro).
SET LOCAL lock_timeout = '5s';
ALTER TABLE agente_memorias
  ADD COLUMN search_tsv tsvector GENERATED ALWAYS AS (to_tsvector('nod_pt'::regconfig, texto)) STORED;

-- ROLLBACK:
-- -- O código anterior não lê a coluna (o repo lista colunas por nome): voltar a imagem basta.
-- SET LOCAL lock_timeout = '5s';
-- ALTER TABLE agente_memorias DROP COLUMN search_tsv;
