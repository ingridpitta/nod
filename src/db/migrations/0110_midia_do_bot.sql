-- definido em 2026-10-23 (NOD-323, ADR-126): a mídia que o bot gera (imagem, gif, vídeo, áudio, pdf, zip) aparece direto
-- no chat, abaixo da fala final dele. O proxy MCP da máquina lê o arquivo da pasta do bot (`anexar_midia`) e sobe pela
-- rota interna com o token do turno; o anexo nasce SOLTO, com `turno_id`, e o assentar o prende à fala final.
--
-- `origem`: 'pessoa' (o upload de sempre), 'captura' (a tela ao fim do turno, NOD-200) e 'bot' (esta). As capturas antigas
-- ficam 'pessoa': a web já as distingue pela autoria da mensagem.
-- `caminho_relativo`: relativo a `~/nod` e começando pela pasta do bot ("Chico/saida/capa.png"), para o app do Mac achar o
-- arquivo (Mostrar no Finder) sem a web nunca mandar caminho. `machine_id`: a máquina onde o arquivo está.
-- `sem_bytes`: o arquivo passa do limite da família (vídeo 50 MiB) — fica só o cartão, os bytes ficam na máquina.
-- `sha256`: idempotência por turno (a nova tentativa do proxy e a varredura de links da fala devolvem o mesmo anexo).
--
-- Só adição. O ADD COLUMN com default constante é só catálogo, mas o ALTER TABLE segura ACCESS EXCLUSIVE em `anexos` e
-- `turnos` até o commit (NOT VALID + VALIDATE na mesma transação NÃO evita isso). O que roda sob o lock: os VALIDATE, que
-- leem só o cabeçalho de cada linha (octet_length do bytea não destoasta). `anexos` hoje são uploads da pessoa (poucos
-- milhares de linhas); o lock_timeout de 5 s faz o deploy falhar limpo em vez de enfileirar a cor que serve.
-- O insert do código anterior (pessoa, mimes de sempre, até 10 MiB) continua passando nos CHECKs.
SET LOCAL lock_timeout = '5s';

ALTER TABLE anexos
  ADD COLUMN origem text NOT NULL DEFAULT 'pessoa',
  ADD COLUMN turno_id uuid,
  ADD COLUMN machine_id uuid,
  ADD COLUMN caminho_relativo text,
  ADD COLUMN largura integer,
  ADD COLUMN altura integer,
  ADD COLUMN duracao_ms integer,
  ADD COLUMN sem_bytes boolean NOT NULL DEFAULT false,
  ADD COLUMN sha256 text;

-- Mídia já vem comprimida: sem TOAST comprimido, o `substring` do Range lê só a fatia pedida (vale para linhas novas).
ALTER TABLE anexos ALTER COLUMN conteudo SET STORAGE EXTERNAL;

ALTER TABLE anexos DROP CONSTRAINT anexo_tamanho;
ALTER TABLE anexos DROP CONSTRAINT anexo_mime;
ALTER TABLE anexos ADD CONSTRAINT anexo_tamanho CHECK (
  tamanho > 0 AND CASE
    WHEN origem = 'bot' AND sem_bytes THEN octet_length(conteudo) = 0
    WHEN origem = 'bot' THEN tamanho <= 52428800 AND tamanho = octet_length(conteudo)
    ELSE tamanho <= 10485760 AND tamanho = octet_length(conteudo)
  END) NOT VALID;
ALTER TABLE anexos ADD CONSTRAINT anexo_mime CHECK (
  mime IN ('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf',
    'text/plain', 'text/markdown', 'text/csv', 'application/json')
  OR (origem = 'bot' AND mime IN ('video/mp4', 'video/quicktime', 'video/webm', 'audio/mpeg', 'audio/mp4', 'audio/wav',
    'audio/ogg', 'application/zip'))) NOT VALID;
ALTER TABLE anexos ADD CONSTRAINT anexo_origem CHECK (origem IN ('pessoa', 'captura', 'bot')) NOT VALID;
ALTER TABLE anexos ADD CONSTRAINT anexo_do_bot CHECK (
  -- turno_id não entra: o FK zera a coluna quando o turno é apagado (o código sempre grava o turno no insert).
  origem <> 'bot' OR sha256 ~ '^[0-9a-f]{64}$') NOT VALID;
ALTER TABLE anexos ADD CONSTRAINT anexo_sem_bytes CHECK (NOT sem_bytes OR origem = 'bot') NOT VALID;
ALTER TABLE anexos ADD CONSTRAINT anexo_caminho_relativo CHECK (caminho_relativo IS NULL OR (
  char_length(caminho_relativo) BETWEEN 1 AND 1024 AND caminho_relativo !~ '^[/~]' AND caminho_relativo !~ '(^|/)\.\.(/|$)')) NOT VALID;
ALTER TABLE anexos ADD CONSTRAINT anexo_medidas CHECK (
  (largura IS NULL OR largura BETWEEN 1 AND 100000) AND (altura IS NULL OR altura BETWEEN 1 AND 100000)
  AND (duracao_ms IS NULL OR duracao_ms >= 0)) NOT VALID;
ALTER TABLE anexos VALIDATE CONSTRAINT anexo_tamanho;
ALTER TABLE anexos VALIDATE CONSTRAINT anexo_mime;
ALTER TABLE anexos VALIDATE CONSTRAINT anexo_origem;
ALTER TABLE anexos VALIDATE CONSTRAINT anexo_do_bot;
ALTER TABLE anexos VALIDATE CONSTRAINT anexo_sem_bytes;
ALTER TABLE anexos VALIDATE CONSTRAINT anexo_caminho_relativo;
ALTER TABLE anexos VALIDATE CONSTRAINT anexo_medidas;

-- SET NULL só da coluna (PG ≥ 15): apagar o turno ou a máquina não leva o anexo nem zera o tenant.
ALTER TABLE anexos ADD CONSTRAINT anexo_turno_fk FOREIGN KEY (tenant_id, turno_id) REFERENCES turnos (tenant_id, id) ON DELETE SET NULL (turno_id);
ALTER TABLE anexos ADD CONSTRAINT anexo_maquina_fk FOREIGN KEY (tenant_id, machine_id) REFERENCES maquinas (tenant_id, id) ON DELETE SET NULL (machine_id);

-- O assentar prende os soltos do turno; o varredor apaga os que sobraram.
CREATE INDEX anexos_por_turno ON anexos (tenant_id, turno_id) WHERE origem = 'bot' AND mensagem_id IS NULL;
CREATE UNIQUE INDEX anexos_do_bot_unicos ON anexos (tenant_id, turno_id, sha256) WHERE origem = 'bot';

-- O que o proxy não anexou (só código e contagem, nunca o caminho): a linha discreta "1 arquivo não foi anexado".
ALTER TABLE turnos ADD COLUMN midia_recusas jsonb;
ALTER TABLE turnos ADD CONSTRAINT turno_midia_recusas CHECK (midia_recusas IS NULL OR (
  jsonb_typeof(midia_recusas) = 'array' AND jsonb_array_length(midia_recusas) <= 40 AND octet_length(midia_recusas::text) <= 4000)) NOT VALID;
ALTER TABLE turnos VALIDATE CONSTRAINT turno_midia_recusas;

-- ROLLBACK:
-- -- O código anterior não lê as colunas novas. As linhas do bot não cabem nos CHECKs antigos: saem antes.
-- ALTER TABLE turnos DROP CONSTRAINT turno_midia_recusas;
-- ALTER TABLE turnos DROP COLUMN midia_recusas;
-- DROP INDEX anexos_do_bot_unicos;
-- DROP INDEX anexos_por_turno;
-- DELETE FROM anexos WHERE origem = 'bot';
-- ALTER TABLE anexos DROP CONSTRAINT anexo_maquina_fk;
-- ALTER TABLE anexos DROP CONSTRAINT anexo_turno_fk;
-- ALTER TABLE anexos DROP CONSTRAINT anexo_medidas;
-- ALTER TABLE anexos DROP CONSTRAINT anexo_caminho_relativo;
-- ALTER TABLE anexos DROP CONSTRAINT anexo_sem_bytes;
-- ALTER TABLE anexos DROP CONSTRAINT anexo_do_bot;
-- ALTER TABLE anexos DROP CONSTRAINT anexo_origem;
-- ALTER TABLE anexos DROP CONSTRAINT anexo_mime;
-- ALTER TABLE anexos DROP CONSTRAINT anexo_tamanho;
-- ALTER TABLE anexos ADD CONSTRAINT anexo_tamanho CHECK (tamanho > 0 AND tamanho <= 10485760 AND tamanho = octet_length(conteudo));
-- ALTER TABLE anexos ADD CONSTRAINT anexo_mime CHECK (mime IN ('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf',
--   'text/plain', 'text/markdown', 'text/csv', 'application/json'));
-- ALTER TABLE anexos ALTER COLUMN conteudo SET STORAGE EXTENDED;
-- ALTER TABLE anexos DROP COLUMN sha256;
-- ALTER TABLE anexos DROP COLUMN sem_bytes;
-- ALTER TABLE anexos DROP COLUMN duracao_ms;
-- ALTER TABLE anexos DROP COLUMN altura;
-- ALTER TABLE anexos DROP COLUMN largura;
-- ALTER TABLE anexos DROP COLUMN caminho_relativo;
-- ALTER TABLE anexos DROP COLUMN machine_id;
-- ALTER TABLE anexos DROP COLUMN turno_id;
-- ALTER TABLE anexos DROP COLUMN origem;
