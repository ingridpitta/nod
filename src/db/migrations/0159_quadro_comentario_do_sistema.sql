-- definido em 2026-11-10 (ADR-162, quadro sem "Precisa de você", fluxo Multica): quando o quadro deixa a tarefa
-- esperando a pessoa sozinho (o bot parou 2x sem saída, o freio, o agente da etapa que sumiu), o card fica na coluna e
-- sai um comentário DO SISTEMA explicando. O comentário do sistema não aciona ninguém e não é de uma pessoa nem de um bot.
--
-- Só troca o CHECK do autor (o da 0148) por um com o valor novo, no mesmo padrão da 0148: NOT VALID e VALIDATE em
-- seguida (as linhas antigas já passaram pelo CHECK de antes, que é um subconjunto deste).
SET LOCAL lock_timeout = '5s';

ALTER TABLE quadro_comentarios DROP CONSTRAINT quadro_comentarios_autor_check;
ALTER TABLE quadro_comentarios ADD CONSTRAINT quadro_comentarios_autor_check CHECK (autor IN ('pessoa', 'agente', 'linear', 'sistema')) NOT VALID;
ALTER TABLE quadro_comentarios VALIDATE CONSTRAINT quadro_comentarios_autor_check;

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- -- O comentário do sistema é só a explicação de uma espera: sai, senão o CHECK de antes não valida.
-- DELETE FROM quadro_comentarios WHERE autor = 'sistema';
-- ALTER TABLE quadro_comentarios DROP CONSTRAINT quadro_comentarios_autor_check;
-- ALTER TABLE quadro_comentarios ADD CONSTRAINT quadro_comentarios_autor_check CHECK (autor IN ('pessoa', 'agente', 'linear')) NOT VALID;
-- ALTER TABLE quadro_comentarios VALIDATE CONSTRAINT quadro_comentarios_autor_check;
