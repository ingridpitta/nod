-- definido em 2026-10-08 (ADR-086): "me chame às 16:00". O bot que vai esperar algo demorado (um CI, um deploy, uma
-- resposta de fora) não fica num laço com `sleep` segurando processo e memória no Mac:
-- - `me_chame_as` só ANOTA o pedido no turno que chama (`despertar_em`, `despertar_motivo`);
-- - quando esse turno termina bem, o assentamento enfileira a retomada com `acordar_em` (revisão do #212: a marca de
--   conteúdo de fora, o Parar e o trabalho já estão decididos nessa hora, e fica uma volta por turno);
-- - o `reivindicar` só entrega a retomada a partir de `acordar_em`, na mesma sessão (--resume).
-- Null = a fila de sempre. Colunas nulas sem default: só metadado, mas o ALTER pega a trava da tabela — com o servidor
-- de pé (é assim que o diário aplica), a migração desiste em 5 s em vez de enfileirar a API atrás dela.
SET LOCAL lock_timeout = '5s';
ALTER TABLE turnos ADD COLUMN IF NOT EXISTS acordar_em timestamptz;
ALTER TABLE turnos ADD COLUMN IF NOT EXISTS despertar_em timestamptz;
ALTER TABLE turnos ADD COLUMN IF NOT EXISTS despertar_motivo text;

-- ROLLBACK:
-- -- Antes de voltar o código: o reivindicar antigo não conhece acordar_em e entregaria todas as voltas marcadas na hora.
-- UPDATE turnos SET estado = 'interrompido', motivo_interrupcao = 'parado_pela_pessoa' WHERE estado = 'pendente' AND acordar_em > now();
-- ALTER TABLE turnos DROP COLUMN IF EXISTS despertar_motivo;
-- ALTER TABLE turnos DROP COLUMN IF EXISTS despertar_em;
-- ALTER TABLE turnos DROP COLUMN IF EXISTS acordar_em;
