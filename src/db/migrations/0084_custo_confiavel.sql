-- definido em 2026-10-15 (NOD-273 + NOD-291, pacote E3): o custo que o Nod mostra passa a ser confiável.
--
-- 1. `turnos.sessao_origem_cli` (NOD-291, C14 da forense): a sessão-mãe do turno que rodou numa CÓPIA dela
--    (`--resume <mãe> --fork-session`, a rede de 2 min da ADR-083 §2). O CLI devolve um id novo e o `total_cost_usd`
--    carrega o histórico da mãe; sem saber de onde a cópia saiu, `totalAnteriorDaSessao` não achava anterior e o turno
--    gravava o total inteiro (US$ 670 em 4 turnos de 08/10). Null = o turno não bifurcou.
-- 2. `trabalhos.custo_parcial` (NOD-273): a frente (ou task) que teve turno com consumo e sem custo informado (o Codex
--    não informa custo) — o valor dela é só parte do que custou, e a tela diz "(parcial)".
-- 3. Índice de `gastos` por pessoa e instante (NOD-273): o "custo de hoje" passa a somar `gastos` por `em` (quando o
--    gasto aconteceu), em 8 janelas por leitura; sem índice a soma lia a tabela inteira da pessoa.
--
-- Só adição (expand-only): o código anterior não lê nem escreve estas colunas, e o DEFAULT cobre o INSERT dele.
SET LOCAL lock_timeout = '5s';

ALTER TABLE turnos ADD COLUMN IF NOT EXISTS sessao_origem_cli text;
ALTER TABLE trabalhos ADD COLUMN IF NOT EXISTS custo_parcial boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS gastos_por_instante ON gastos (tenant_id, owner_id, em);

-- ROLLBACK:
-- -- O código anterior não lê estas colunas: voltar a imagem basta. Para tirar o que foi criado (apaga a sessão-mãe
-- -- gravada e a marca de parcial):
-- DROP INDEX IF EXISTS gastos_por_instante;
-- ALTER TABLE trabalhos DROP COLUMN IF EXISTS custo_parcial;
-- ALTER TABLE turnos DROP COLUMN IF EXISTS sessao_origem_cli;
