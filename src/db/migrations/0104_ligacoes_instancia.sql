-- definido em 2026-10-22 (NOD-218, deploy azul/verde): a cor do processo que abriu a ligação (`NOD_COR`, azul|verde).
--
-- Durante o deploy há dois processos vivos (emenda da ADR-017). O orquestrador da ligação vive na memória de um deles: o
-- boot de uma cor só fecha as ligações vivas da PRÓPRIA cor (as da outra ainda têm orquestrador), e o
-- `scripts/ligacoes-orfas.ts --instancia <cor>` fecha as da cor que saiu. Sem `NOD_COR` (Mac, local, a imagem antiga) a
-- coluna fica nula. Aditiva e nullable: a imagem N-1 ignora a coluna (regra de migração compatível, docs/deploy-gcp.md).
ALTER TABLE ligacoes ADD COLUMN instancia text;

-- ROLLBACK:
-- -- O código anterior não lê a coluna: voltar a imagem basta; isto é só para desfazer o schema.
-- ALTER TABLE ligacoes DROP COLUMN instancia;
