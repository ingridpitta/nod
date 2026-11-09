-- definido em 2026-10-15 (NOD-274, NOD-269): o trabalho de fundo espera a cota da IA em vez de falhar.
--
-- desfecho_rotina 'nao_rodou': a janela da rotina que não rodou — a cota só volta depois da próxima execução, ou a
-- execução anterior ainda estava aberta. Antes a janela sumia sem rastro (a rotina ficava "falhou" ou nem aparecia).
-- motivo_falha 'sem_conta': a máquina não tem nenhuma conta da IA livre (todas no limite) na hora do despacho. Antes
-- o turno caía como 'limite_do_plano' e se confundia com o limite visto no meio da rodada.
-- rotina_execucoes.volta_em: quando a cota volta, para o histórico dizer "não rodou · cota, volta HH:MM".
-- Os dois valores vão no fim, como em MOTIVOS_FALHA e DESFECHOS_ROTINA (o gate motivos-enum compara a ordem).
-- Nenhum valor novo é usado nesta migração (um valor de enum não serve na mesma transação que o criou).
SET LOCAL lock_timeout = '5s';

ALTER TYPE desfecho_rotina ADD VALUE IF NOT EXISTS 'nao_rodou';
ALTER TYPE motivo_falha ADD VALUE IF NOT EXISTS 'sem_conta';
ALTER TABLE rotina_execucoes ADD COLUMN IF NOT EXISTS volta_em timestamptz;

-- ROLLBACK:
-- -- O Postgres não remove valor de enum: o rollback recria cada tipo sem o valor novo (NOD-195), com o mesmo nome e a
-- -- mesma ordem, como na 0060. Antes, troque as linhas que usam os valores novos (por exemplo
-- -- UPDATE rotina_execucoes SET desfecho = 'interrompida' WHERE desfecho = 'nao_rodou';
-- -- UPDATE turnos SET motivo_falha = 'limite_do_plano' WHERE motivo_falha = 'sem_conta'; e o mesmo em relatos):
-- -- com alguma linha no valor, o cast falha e a transação inteira volta. Rode o bloco numa transação só
-- -- (`psql -1 -v ON_ERROR_STOP=1`). Nenhum índice, constraint ou função cita os dois tipos.
-- ALTER TABLE rotina_execucoes DROP COLUMN IF EXISTS volta_em;
-- ALTER TYPE desfecho_rotina RENAME TO desfecho_rotina_0087;
-- CREATE TYPE desfecho_rotina AS ENUM ('executou', 'passou_em_branco', 'sem_novidade', 'falhou', 'interrompida', 'bloqueada');
-- ALTER TABLE rotina_execucoes ALTER COLUMN desfecho TYPE desfecho_rotina USING desfecho::text::desfecho_rotina;
-- DROP TYPE desfecho_rotina_0087;
-- ALTER TYPE motivo_falha RENAME TO motivo_falha_0087;
-- CREATE TYPE motivo_falha AS ENUM ('erro_max_turns', 'erro_execucao', 'motor_ausente', 'nao_autenticado', 'limite_do_plano');
-- ALTER TABLE turnos ALTER COLUMN motivo_falha TYPE motivo_falha USING motivo_falha::text::motivo_falha;
-- ALTER TABLE relatos ALTER COLUMN motivo_falha TYPE motivo_falha USING motivo_falha::text::motivo_falha;
-- DROP TYPE motivo_falha_0087;
