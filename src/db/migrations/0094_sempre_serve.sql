-- definido em 2026-10-19 (plano dos modos de aprovação, PR 5; decisão 8 do Marlon de 2026-10-18): "Sempre permitir" só
-- onde funciona. Com o revisor nos apps, o cartão que sobra de uma revisão (motivo 'revisor_pediu' ou 'revisor_falhou')
-- só oferece a regra por ferramenta quando ela de fato tira o revisor das próximas vezes: no apagar de um app num turno
-- limpo (a regra da pessoa cai antes de ser lida num turno contaminado, e o envio só vai ao revisor contaminado). Quem
-- decide é a função pura `sempreServe` (src/domain/aprovacao-permanente.ts), gravada no item pelo servidor; a tela e
-- `podeVirarRegra` leem a coluna e não recalculam.
--
-- Nulo = o item não veio do revisor (todos os de antes e os de hoje fora do Automático): vale a regra de sempre do botão.
-- Só adição (expand-only): coluna nula, sem default; o código anterior não a lê nem a escreve. A decisora não a muda
-- (o trigger da 0003 fecha toda coluna fora da lista livre).
SET LOCAL lock_timeout = '5s';

ALTER TABLE itens_aprovacao ADD COLUMN sempre_serve boolean;

-- ROLLBACK:
-- -- O código anterior não lê a coluna: voltar a imagem basta. Sem ela, o cartão do revisor volta a oferecer "Sempre
-- -- permitir" pela regra de antes (REGRA_NAO_PULA).
-- ALTER TABLE itens_aprovacao DROP COLUMN sempre_serve;
