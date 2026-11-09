-- definido em 2026-10-15 (pacote B2: NOD-243, NOD-271, NOD-272): a agenda da rotina deixa rastro e não trava.
-- desfecho_rotina += 'adiada' (NOD-243): a janela que a execução anterior ainda aberta segurou vira uma execução
--   'adiada', com a causa e o id de quem segura — antes ela era pulada sem nenhuma linha.
-- motivo_interrupcao += 'vencido' (NOD-243, decisão da NOD-228): o turno pendente que nunca começou e já passou de
--   max(período do cron, 30 min) é encerrado quando a janela seguinte chega.
-- turnos.pessoa_esperando (NOD-272, I9): o "Testar agora" e o "Permitir e rodar agora" são atos da pessoa, que olha a
--   tela; o turno deles (e o das frentes que ele abre) não espera a reserva da cota nem o portão do Mac (ADR-085).
-- NOD-271: a cadeia de retomadas de turnoAberto segue `retoma_turno_id` pelo índice turnos_por_retoma da 0086 (main);
--   o turnos_retoma_idx que esta migração criava saiu na integração (mesmas colunas, índice duplicado).
-- Os valores novos só são usados pelo código, nunca nesta transação (como na 0060).
-- revisto em 2026-10-16 (integração da main no #335): renumerada 0082→0088, depois da 0087 (NOD-274, 'nao_rodou'),
--   para 'adiada' cair depois de 'nao_rodou' no enum também no banco que já tem a 0087 (o gate motivos-enum compara a ordem).
SET LOCAL lock_timeout = '5s';

ALTER TYPE desfecho_rotina ADD VALUE IF NOT EXISTS 'adiada';
ALTER TYPE motivo_interrupcao ADD VALUE IF NOT EXISTS 'vencido';

ALTER TABLE turnos ADD COLUMN IF NOT EXISTS pessoa_esperando boolean NOT NULL DEFAULT false;

-- ROLLBACK:
-- -- O Postgres não remove valor de enum: o rollback recria cada tipo sem o valor novo (modelo da 0060), com o mesmo
-- -- nome e a mesma ordem. Com alguma linha usando 'adiada' ou 'vencido', o cast falha e a transação inteira volta
-- -- (nada é apagado aqui): antes, troque essas linhas. Rode o bloco numa transação só (`psql -1 -v ON_ERROR_STOP=1`).
-- ALTER TABLE turnos DROP COLUMN IF EXISTS pessoa_esperando;
-- ALTER TYPE desfecho_rotina RENAME TO desfecho_rotina_0088;
-- CREATE TYPE desfecho_rotina AS ENUM ('executou', 'passou_em_branco', 'sem_novidade', 'falhou', 'interrompida', 'bloqueada', 'nao_rodou');
-- ALTER TABLE rotina_execucoes ALTER COLUMN desfecho TYPE desfecho_rotina USING desfecho::text::desfecho_rotina;
-- DROP TYPE desfecho_rotina_0088;
-- ALTER TYPE motivo_interrupcao RENAME TO motivo_interrupcao_0088;
-- CREATE TYPE motivo_interrupcao AS ENUM ('parado_pela_pessoa', 'maquina_sem_contato', 'reinicio_servidor', 'sem_progresso',
--   'lancamento_falhou', 'sessao_rejeitada', 'executor_indisponivel', 'turno_travado', 'trabalho_incompleto', 'absorvido');
-- ALTER TABLE turnos ALTER COLUMN motivo_interrupcao TYPE motivo_interrupcao USING motivo_interrupcao::text::motivo_interrupcao;
-- ALTER TABLE relatos ALTER COLUMN motivo_interrupcao TYPE motivo_interrupcao USING motivo_interrupcao::text::motivo_interrupcao;
-- DROP TYPE motivo_interrupcao_0088;
