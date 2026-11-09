-- definido em 2026-10-20 (NOD-309, PR 1 de 4: domínio e migração): o trabalho de fundo não se perde por nenhuma queda.
-- Generaliza a espera da cota (0087, NOD-274) para reinício do servidor, máquina offline e erro transitório do provedor.
--
-- turnos.tentativas_transitorias: quantas vezes a CADEIA de retomadas deste turno já caiu por erro transitório do
-- provedor (5xx, sobrecarga, rede). A retomada copia e incrementa; o teto (3) vira `falhou` com aviso único
-- (domain/espera-no-fundo.ts). 0 = nunca caiu assim (todos os turnos de antes).
-- lotes_de_frentes.retorno_concluido_em: quando o turno de retorno do lote terminou `concluido`. `devolvido_em`
-- continua gravado ao enfileirar o retorno (é a trava contra dois fechos ao mesmo tempo); só este campo diz "entregue",
-- e enquanto ele é nulo o retorno é refeito em toda queda. Nulo = ainda não entregue, ou lote de antes desta migração.
--
-- rotina_execucoes.motivo é text (sem enum): os motivos novos de 'nao_rodou' (maquina_sem_contato, reinicio_servidor,
-- erro_do_provedor) não pedem ALTER TYPE.
-- Só adição (expand-only): o código anterior não lê nem escreve as colunas novas.
SET LOCAL lock_timeout = '5s';

ALTER TABLE turnos ADD COLUMN IF NOT EXISTS tentativas_transitorias smallint NOT NULL DEFAULT 0;
ALTER TABLE lotes_de_frentes ADD COLUMN IF NOT EXISTS retorno_concluido_em timestamptz;

-- ROLLBACK:
-- -- O código anterior não lê as colunas: voltar a imagem basta.
-- ALTER TABLE lotes_de_frentes DROP COLUMN IF EXISTS retorno_concluido_em;
-- ALTER TABLE turnos DROP COLUMN IF EXISTS tentativas_transitorias;
