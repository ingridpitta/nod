-- definido em 2026-10-06 (pedido do Marlon): aviso da tela que a pessoa fechou não volta.
--
-- O aviso do modo de aprovação ("… está sem aprovações", "… aprova as próprias ações") guardava o "fechado" no
-- localStorage, por bot e por modo — e o app do Mac limpa o armazenamento da página a cada conexão
-- (desktop/main.ts, clearStorageData). O aviso voltava a cada abertura, em cada bot, a cada troca de modo. Aqui
-- fica a chave de cada aviso fechado, por pessoa (ex.: 'modo:total'), na linha de preferências dela (0036).
-- Sem RLS nova: preferencias já é escopada pela 0036.
ALTER TABLE preferencias ADD COLUMN IF NOT EXISTS avisos_fechados text[] NOT NULL DEFAULT '{}';
ALTER TABLE preferencias ADD CONSTRAINT preferencias_avisos_fechados CHECK (cardinality(avisos_fechados) <= 50);

-- ROLLBACK:
-- ALTER TABLE preferencias DROP CONSTRAINT preferencias_avisos_fechados;
-- ALTER TABLE preferencias DROP COLUMN avisos_fechados;
