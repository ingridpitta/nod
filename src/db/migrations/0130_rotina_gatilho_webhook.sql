-- definido em 2026-10-30 (NOD-84, ADR-139): rotina disparada por webhook. A rotina continua em `rotinas` (mesma lista,
-- mesmo card, mesmos casos de uso); `gatilho` diz se ela roda por horário ou quando chega uma chamada. A rotina webhook
-- guarda um cron sentinela e `proxima_execucao` em 9999-01-01 (mais de 30 leitores de `rotina.cron` não precisam de
-- null); quem decide é `gatilho`, e o agendador e a agenda filtram `gatilho = 'horario'`.
--
-- `rotina_gatilhos`: o endereço secreto. `hash` é o SHA-256 do token inteiro (bytea de 32, comparação em tempo
-- constante no Node, como 0007); `token_cifrado` é o token cifrado com a NOD_CREDENTIAL_KEY (cifra.ts, AES-GCM), só
-- para o Copiar devolver o endereço ao dono depois; o bot nunca o lê. `segredo_hmac_cifrado` é um segredo SEPARADO para
-- o `X-Hub-Signature-256` do GitHub (vazar o endereço não basta para assinar); `assinado_em` marca a 1ª chamada assinada
-- válida, e dali em diante a assinatura vira obrigatória. Um vivo por rotina: gerar novo revoga o anterior na mesma
-- transação. `prefixo` são 8 caracteres da metade aleatória, só para mostrar mascarado.
--
-- `rotina_chamadas`: o log das chamadas — as 50 mais novas ou as das últimas 72 h, e das recusadas só as 10 mais novas
-- (a poda é do repositório). `entrega_id` é o id de entrega
-- do provedor (X-GitHub-Delivery, Idempotency-Key, evt_ do Stripe): o UNIQUE parcial é o dedupe, firme sob concorrência.
-- Só adição: colunas com default e tabelas novas, que o código anterior não lê.
SET LOCAL lock_timeout = '5s';

ALTER TABLE rotinas ADD COLUMN gatilho text NOT NULL DEFAULT 'horario';
ALTER TABLE rotinas ADD CONSTRAINT rotinas_gatilho CHECK (gatilho IN ('horario', 'webhook'));
ALTER TABLE rotinas ADD COLUMN provedor text;
ALTER TABLE rotinas ADD CONSTRAINT rotinas_provedor CHECK (provedor IS NULL OR char_length(provedor) BETWEEN 1 AND 40);
ALTER TABLE rotinas ADD COLUMN eventos text[];
ALTER TABLE rotinas ADD CONSTRAINT rotinas_eventos CHECK (eventos IS NULL OR cardinality(eventos) <= 20);
-- Coerência (revisão da NOD-84): só a rotina webhook tem provedor, e toda rotina webhook tem; filtro de evento só nela.
-- (O NOT VALID + VALIDATE aqui não poupa trava: o ADD COLUMN acima já segura a exclusiva até o commit. Inofensivo no
-- tamanho atual de `rotinas`; vale como molde se a coerência for separada numa migração própria.)
ALTER TABLE rotinas ADD CONSTRAINT rotinas_webhook_tem_provedor CHECK ((gatilho = 'webhook') = (provedor IS NOT NULL)) NOT VALID;
ALTER TABLE rotinas ADD CONSTRAINT rotinas_eventos_so_webhook CHECK (eventos IS NULL OR gatilho = 'webhook') NOT VALID;
ALTER TABLE rotinas VALIDATE CONSTRAINT rotinas_webhook_tem_provedor;
ALTER TABLE rotinas VALIDATE CONSTRAINT rotinas_eventos_so_webhook;

CREATE TABLE rotina_gatilhos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  rotina_id uuid NOT NULL,
  prefixo text NOT NULL,
  hash bytea NOT NULL,
  token_cifrado text NOT NULL,
  segredo_hmac_cifrado text NOT NULL,
  assinado_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  revogado_em timestamptz,
  CONSTRAINT rotina_gatilhos_hash_tamanho CHECK (octet_length(hash) = 32),
  CONSTRAINT rotina_gatilhos_prefixo_curto CHECK (length(prefixo) = 8)
);
SELECT nod_escopar_tabela('rotina_gatilhos');
ALTER TABLE rotina_gatilhos ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE rotina_gatilhos ADD FOREIGN KEY (tenant_id, rotina_id) REFERENCES rotinas (tenant_id, id);
ALTER TABLE rotina_gatilhos ADD CONSTRAINT rotina_gatilhos_hash_unico UNIQUE (tenant_id, hash);
CREATE UNIQUE INDEX rotina_gatilhos_um_vivo ON rotina_gatilhos (tenant_id, rotina_id) WHERE revogado_em IS NULL;

CREATE TABLE rotina_chamadas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  rotina_id uuid NOT NULL,
  em timestamptz NOT NULL DEFAULT clock_timestamp(),
  desfecho text NOT NULL,
  motivo text,
  evento text,
  entrega_id text,
  turno_id uuid,
  CONSTRAINT rotina_chamadas_desfecho CHECK (desfecho IN ('rodou', 'ignorada', 'fila_cheia', 'recusada', 'pausada', 'bloqueada', 'teste')),
  CONSTRAINT rotina_chamadas_motivo CHECK (motivo IS NULL OR motivo IN ('endereco', 'assinatura')),
  CONSTRAINT rotina_chamadas_evento CHECK (evento IS NULL OR char_length(evento) BETWEEN 1 AND 120),
  CONSTRAINT rotina_chamadas_entrega CHECK (entrega_id IS NULL OR char_length(entrega_id) BETWEEN 1 AND 200)
);
SELECT nod_escopar_tabela('rotina_chamadas');
ALTER TABLE rotina_chamadas ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE rotina_chamadas ADD FOREIGN KEY (tenant_id, rotina_id) REFERENCES rotinas (tenant_id, id);
CREATE UNIQUE INDEX rotina_chamadas_dedupe ON rotina_chamadas (tenant_id, rotina_id, entrega_id) WHERE entrega_id IS NOT NULL;
CREATE INDEX rotina_chamadas_recentes ON rotina_chamadas (tenant_id, rotina_id, em DESC);

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- -- Antes de soltar as colunas: a rotina webhook viraria uma de horário com o cron sentinela (sem futuro); o código antigo
-- -- quebraria ao reativá-la ou ao listar as janelas puladas. Pausa e exclui (a dona vê na lixeira e restaura se quiser).
-- UPDATE rotinas SET estado = 'pausada', excluido_em = coalesce(excluido_em, now()) WHERE gatilho = 'webhook';
-- DROP TABLE IF EXISTS rotina_chamadas;
-- DROP TABLE IF EXISTS rotina_gatilhos;
-- ALTER TABLE rotinas DROP CONSTRAINT IF EXISTS rotinas_eventos_so_webhook;
-- ALTER TABLE rotinas DROP CONSTRAINT IF EXISTS rotinas_webhook_tem_provedor;
-- ALTER TABLE rotinas DROP CONSTRAINT IF EXISTS rotinas_eventos;
-- ALTER TABLE rotinas DROP COLUMN IF EXISTS eventos;
-- ALTER TABLE rotinas DROP CONSTRAINT IF EXISTS rotinas_provedor;
-- ALTER TABLE rotinas DROP COLUMN IF EXISTS provedor;
-- ALTER TABLE rotinas DROP CONSTRAINT IF EXISTS rotinas_gatilho;
-- ALTER TABLE rotinas DROP COLUMN IF EXISTS gatilho;
