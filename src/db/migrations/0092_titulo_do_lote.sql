-- definido em 2026-10-18 (plano chat limpo, PR 5, decisão 17): o lote de frentes ganha título. O `abrir_frentes` aceita
-- `titulo_do_lote` ("o que o lote faz, em 2 a 4 palavras": "frentes de hero"), e a pílula das frentes (PR 8) e o
-- progresso na fala (PR 7) precisam dele mesmo quando a fala que abriu o lote saiu da janela. Nulo = o modelo não mandou
-- (os lotes de antes, a rede de 2 min e o `abrir_task`); a tela cai no título da frente (lote de uma) ou em "N frentes"
-- (`tituloDoLote`, src/domain/frente.ts).
--
-- O teto é o do título da frente (CHECK trabalho_titulo da 0063, 1 a 200): o pedido de 2 a 4 palavras fica na descrição
-- da ferramenta e é medido, e o código corta em 80 antes de gravar (`tituloOuNada`, src/domain/trabalho.ts); o CHECK só
-- segura o que passou disso por engano. Vazio nunca é gravado: o código grava null.
--
-- Só adição (expand-only): coluna nula, sem default; o código anterior não a lê nem a escreve.
SET LOCAL lock_timeout = '5s';

ALTER TABLE lotes_de_frentes ADD COLUMN titulo text;
ALTER TABLE lotes_de_frentes ADD CONSTRAINT lote_titulo CHECK (titulo IS NULL OR char_length(titulo) BETWEEN 1 AND 200);

-- ROLLBACK:
-- -- O código anterior não lê a coluna: voltar a imagem basta. Os títulos gravados somem com ela.
-- ALTER TABLE lotes_de_frentes DROP CONSTRAINT lote_titulo;
-- ALTER TABLE lotes_de_frentes DROP COLUMN titulo;
