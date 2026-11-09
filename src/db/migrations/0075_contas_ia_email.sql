-- definido em 2026-10-15 (ADR-105, emenda a ADR-019 e a ADR-102 item 6): o e-mail e a organização de cada conta de IA
-- passam a morar no servidor, para a lista de Provedores dizer qual conta é qual em qualquer máquina. Até aqui só o app
-- do Mac que conhecia a conta mostrava o e-mail; a conta logada só noutro Mac ou na VM aparecia sem ele.
-- A máquina manda o que o CLI informa no anúncio; null = "não sei agora" e nunca apaga o que já está guardado.
-- Continua cosmético (ADR-019 regra 2): nada autoriza nem casa conta por e-mail; a chave segue sendo a impressão.
-- Só adição (expand-only): o código anterior não lê estas colunas.
SET LOCAL lock_timeout = '5s';

ALTER TABLE contas_ia ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE contas_ia ADD COLUMN IF NOT EXISTS organizacao text;
-- Os mesmos tetos de emailDaConta e organizacaoDaConta (src/domain/estado-ia.ts).
ALTER TABLE contas_ia ADD CONSTRAINT conta_ia_email CHECK (email IS NULL OR (char_length(email) BETWEEN 3 AND 254 AND position('@' in email) > 0));
ALTER TABLE contas_ia ADD CONSTRAINT conta_ia_organizacao CHECK (organizacao IS NULL OR char_length(organizacao) BETWEEN 1 AND 80);

-- ROLLBACK:
-- -- O código anterior não lê estas colunas: voltar a imagem basta. Para tirar o que foi criado (apaga os e-mails):
-- ALTER TABLE contas_ia DROP CONSTRAINT IF EXISTS conta_ia_organizacao;
-- ALTER TABLE contas_ia DROP CONSTRAINT IF EXISTS conta_ia_email;
-- ALTER TABLE contas_ia DROP COLUMN IF EXISTS organizacao;
-- ALTER TABLE contas_ia DROP COLUMN IF EXISTS email;
