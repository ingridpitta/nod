-- definido em 2026-10-28 (NOD-23): /configurar liga a entrevista de reconfiguração de um bot já confirmado por até 2 h
-- (JANELA_RECONFIGURACAO_MS, src/domain/reconfiguracao.ts). A coluna guarda quando a pessoa pediu; nula = fora do modo.
-- Confirmar ou recusar a proposta de perfil a zera. A expiração é lida no turno (agora - configurando_desde), sem laço.
--
-- Só adição, nula, sem default e sem backfill: o ADD COLUMN é só catálogo e o insert do código anterior continua
-- passando. A policy de UPDATE de `agentes` já é só da dona (nod_escopar_tabela), então ninguém liga o modo do bot alheio.
-- lock_timeout de 5 s: se a trava não vier, a migração falha e o deploy para limpo.
SET LOCAL lock_timeout = '5s';

ALTER TABLE agentes ADD COLUMN configurando_desde timestamptz;
ALTER TABLE agentes ADD COLUMN configurando_turno_id uuid;

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- ALTER TABLE agentes DROP COLUMN IF EXISTS configurando_turno_id;
-- ALTER TABLE agentes DROP COLUMN IF EXISTS configurando_desde;
