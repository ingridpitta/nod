-- definido em 2026-10-18 (plano do chat limpo, PR 1; ADR-114): o assunto de cada item da conversa, gravado na escrita.
--
-- mensagens.assunto: o que a mensagem é ("negacao.ferramenta", "rotina.evento", "agente.criado"…), escolhido pelo
--   produtor (sistema sem payload) ou derivado do kind, do payload e da autoria (src/domain/destino-no-chat.ts). A
--   tabela DESTINO, no servidor, diz para onde cada assunto vai (chat, anexo ou Atividade); mudar uma regra é mudar a
--   tabela, sem regravar o banco. null = fala (ou linha antiga ainda sem backfill): fica no chat. O CHECK confere só a
--   forma (minúsculas com ponto), nunca a lista: os assuntos crescem com o código, e uma lista no banco pediria migração a
--   cada assunto novo. NOT VALID: a coluna nasce toda nula, e validar varreria `mensagens` inteira com a trava da
--   ALTER TABLE; as linhas novas e as do backfill passam pelo CHECK do mesmo jeito. Nenhum índice novo em mensagens:
--   mensagens_por_conversa (tenant_id, conversa_id, criado_em) serve à janela e ao recorte do dia.
--
-- trilha_negacoes_por_agente: a Atividade lê as negações de conector indisponível do bot num dia (GET
--   agentes/:id/atividade), por faixa de tempo. A trilha só tinha a chave primária (0001), e `filtrar` varre a tabela.
--   Parcial em kind = 'negacao', a única linha que a Atividade lê. Nada em `events` (a memória não é fonte da rota).
--
-- O deploy migra com o servidor antigo ainda no ar (docs/deploy-gcp.md) e cada migração roda numa transação
-- (migrar.ts), sem CONCURRENTLY: o índice trava as escritas na trilha enquanto é construído. lock_timeout de 5 s: se a
-- trava não vier, a migração falha e o deploy para, em vez de segurar o servidor esperando.
--
-- A ORDEM importa (revisão pré-merge de 2026-10-18): toda trava fica até o COMMIT. O índice vem primeiro e a ALTER TABLE
-- de mensagens por último: se a ALTER viesse antes, a trava ACCESS EXCLUSIVE de `mensagens` (que barra até a leitura)
-- ficaria presa durante toda a construção do índice na trilha, e o servidor antigo pararia de ler e gravar mensagens
-- nesse tempo. Assim, `mensagens` fica travada só do ADD COLUMN ao COMMIT (sem reescrever a tabela: coluna nula sem
-- default e CHECK NOT VALID não varrem nada).
SET LOCAL lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS trilha_negacoes_por_agente ON trilha (tenant_id, agente_id, em) WHERE kind = 'negacao';

ALTER TABLE mensagens ADD COLUMN IF NOT EXISTS assunto text;
ALTER TABLE mensagens ADD CONSTRAINT mensagem_assunto CHECK (assunto IS NULL OR assunto ~ '^[a-z_]+(\.[a-z_]+)*$') NOT VALID;

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- DROP INDEX IF EXISTS trilha_negacoes_por_agente;
-- ALTER TABLE mensagens DROP CONSTRAINT IF EXISTS mensagem_assunto;
-- ALTER TABLE mensagens DROP COLUMN IF EXISTS assunto;
