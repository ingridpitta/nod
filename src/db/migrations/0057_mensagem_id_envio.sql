-- definido em 2026-10-06 (NOD-156, idempotência de envio): a mesma fala reenviada pelo cliente (resposta perdida, duplo
-- clique, Enter + botão) virava duas mensagens e dois turnos. O cliente agora manda `idEnvio` (UUID, um por fala) e o
-- servidor grava a chave na mensagem da pessoa. O índice é ÚNICO e PARCIAL: só as mensagens com chave entram, então
-- cliente antigo (sem chave), agente e sistema seguem como antes. A chave vale por conversa e não expira.
--
-- O caso de uso insere com `on conflict (tenant_id, conversa_id, id_envio) where id_envio is not null do nothing`: o
-- índice parcial exige repetir o `where` no `on conflict`. Só adição: o código anterior nunca lê a coluna, então esta
-- migração pode entrar antes do código novo.
ALTER TABLE mensagens ADD COLUMN id_envio uuid;
CREATE UNIQUE INDEX mensagens_id_envio_unico ON mensagens (tenant_id, conversa_id, id_envio) WHERE id_envio IS NOT NULL;

-- ROLLBACK:
-- DROP INDEX mensagens_id_envio_unico;
-- ALTER TABLE mensagens DROP COLUMN id_envio;
