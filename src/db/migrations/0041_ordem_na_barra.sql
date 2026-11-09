-- definido em 2026-09-30 (canvas "Menu, sidebar e gaveta"): arrastar um bot na barra lateral fixa, move de seção e
-- ordena. A posição vale dentro do grupo em que ele aparece (a grade de fixados ou a seção): quem arrasta manda a
-- ordem inteira do grupo de destino e cada bot recebe o próprio índice. null = nunca arrastado; fica depois dos
-- ordenados, pela ordem de criação (o comportamento de antes desta coluna).
ALTER TABLE agentes ADD COLUMN IF NOT EXISTS posicao integer;

-- ROLLBACK:
-- ALTER TABLE agentes DROP COLUMN posicao;
